# Bench

Measures the ways a model can draw a diagram with the draw.io MCP servers against each other, end to end: how long until the diagram is there, how many tokens it takes, what the viewer's layout check finds in the rendering, which diagram a judge prefers when shown both images without knowing how either was made, what a follow-up change costs and moves, and which tool a model picks when it has the choice.

Variants (`run.mjs`):

| Variant | What the model gets |
|---|---|
| `today` | the app server without the semantic tool: the model picks XML or Mermaid from the `create_diagram` description, fetches the reference and places the shapes |
| `mermaid` | the same, with "Use Mermaid." after the prompt |
| `semantic` | `semantic-server.mjs`: one tool, `create_semantic_diagram`, the model describes the diagram and the engine in `shared/semantic` lays it out. Placement hints (`row`, `col`) are offered as optional |
| `semantic-auto` | the same without placement hints: not in the description or the schema, and ignored by the engine |
| `semantic-rows` | the same with the hints asked for: the model gives every node its cell (a row and a column) in one grid for the whole diagram, the engine sizes the cells, draws the frames of the groups around their members and routes the lines |
| `both` | one server with the app server's three tools and `create_semantic_diagram`, to see which one the model picks |
| `both-rule` | the same, with a sentence in the `create_diagram` description that sends architecture, cloud, network and swimlane-flowchart diagrams to the semantic tool |
| `switch-on` | the app server itself with its switch on (`DRAWIO_SEMANTIC_TYPES`, `on` unless set): its own `create_semantic_diagram` for the types that passed the judgement next to `create_diagram`, as staging has it. Shows which tool a model picks per diagram type and that the server's tool takes what models send |
| `staging` | the staging Worker as deployed, over HTTP (`BENCH_STAGING_URL`, else `drawio-mcp-app-staging` on workers.dev): `create_diagram` and, where the deploy switched it on, `create_semantic_diagram` |
| `production` | the production server, over HTTP (`BENCH_PRODUCTION_URL`, else `https://mcp.draw.io/mcp`): `create_diagram` only |
| `fast-tool` | the app server as built, with no switch set: `create_diagram` and its own `create_semantic_diagram` for flowcharts and swimlanes, whose description has the model take it only when the user asks for a quick diagram |

## Setup

The bench needs Node 20+, the `claude` CLI (signed in) and `chrome-headless-shell` for the renders. Headless Chrome reports a screen of 800 × 600, so the viewer caps the inline frame at 540 px instead of 800 and cuts tall diagrams off in the images the judge sees (`render.mjs` warns); `chrome-headless-shell` reports the window's 1280 × 1000. Its two packages (`elkjs`, `puppeteer-core`) install here (`npm ci` in `bench/`) or anywhere else with `NODE_PATH` pointing at that `node_modules`. The app server's own packages must be installed (`npm ci` in `mcp-app-server/`), since the renders run its viewer.

Output goes to `bench/out/` (ignored), `--out DIR` or `BENCH_OUT`.

## Prompts

`prompts.json` has, per prompt: the `type` it measures, a `split` (`dev` or `held-out`), an optional `size` (`large`: 25 to 35 elements) and an `edit`, the follow-up request of the second turn. Layouts are developed on the `dev` prompts only; the `held-out` prompts decide whether a type is switched on, and nobody looks at their renders while changing a layout. Architecture, cloud and network have 14 prompts (8 and 6), swimlanes and flowcharts 13 (7 and 6): the large diagrams lost every judgement of the third measurement, so three large `dev` prompts were added to develop on (a streaming platform, a Google Cloud landing zone, a loan flowchart without lanes). `--type`, `--split`, `--size` and `--prompts` select.

## Steps

```bash
# 1. the runs: one `claude -p` session per variant, prompt, model and repeat;
#    --edits sends the prompt's follow-up request as a second turn
node run.mjs --variants today,semantic-rows --type architecture,swimlane --split held-out --models sonnet,opus --repeats 3 --edits

# 2. render every diagram in the app server's viewer, as a chat host shows it
node render.mjs --chrome /path/to/chrome

# 3. blind judgement of the pairs, both orders; --edits judges the changed diagrams
node judge.mjs --a today --b semantic-rows --type architecture,swimlane --runs-model sonnet
node judge.mjs --a today --b semantic-rows --type architecture,swimlane --runs-model sonnet --edits

# 4. the tool choice
node run.mjs --variants both,both-rule --type architecture,swimlane --split held-out --models sonnet,opus

# 5. the tables and the gate
node report.mjs
```

Per run, `run.mjs` writes the timestamped stream (`<tag>.jsonl`), a summary (`<tag>-summary.json`: seconds to the diagram and to the end of the answer, thinking and writing time, tokens, tool calls; the edit turn under `edit`, measured from the moment its request was sent) and the diagram's arguments (`<tag>-diagram.json`, `<tag>-edit-diagram.json`; a description the size rule refused goes to `<tag>-refused.json`). The semantic server also saves every call with the engine's XML, warnings and stats (`<tag>-call<n>.json`). `render.mjs` draws a changed description that passed a layout back with the layout of the first description as the current engine draws it, so a change of the engine since the run doesn't leave a layout that no longer fits.

`render.mjs` runs a minimal MCP Apps host in headless Chrome (an 800 px frame, a screen 1000 px high, which sets the viewer's inline height) and saves what the chat shows (`<tag>-inline.png`), the PNG the viewer sends to the model (`<tag>-full.png`), the layout check (`<tag>-check.txt`), the XML as shown (`<tag>-rendered.xml`) and the issue count, the number of shapes and their median font size (`<tag>-render.json`). Semantic descriptions are converted by the engine as it is now and then go through `create_diagram` as XML, like every other diagram, so after a change to a layout `--force` renders the saved descriptions again without new model runs. `--routing viewer` leaves their edges to the viewer's router (`routing: "libavoid"`) instead of the engine's, to compare the two on the same placements.

`judge.mjs` shows a judge model (Opus by default) the two images of one prompt and repeat as "X" and "Y", once in each order, with the prompt, and asks which one the user would prefer and for a score of each. It shows the inline image by default: the 800 px frame as the chat shows it, scaled down and cut where the viewer cuts it, because that is what the user reads; `--image full` shows the whole diagram at its own size. A tie counts half; the share of B is its points over all judgements.

`report.mjs` writes `report.md` and `report.json`: the runs per type and prompt, the edit turns (seconds, tokens, and of the shapes in both diagrams the share that kept its id and the share that moved by more than 10 px once the common shift is removed; the share that stayed in place, within 10 px with no shift removed; for changes of a description, the nodes the change left as they were, with the same id, lane, cell, label and kind, and how many of them moved, with no shift removed and once the shift they share is removed (a page that grows at its top moves them all alike), which is what the engine moved and not what the model renumbered; and how many changes passed the first result's `layout` back), the tool choice (the share of runs whose first diagram call was the semantic tool) and the judgements with the gate.

## The live test of staging

`staging` and `production` run the prompts against the deployed servers instead of a local one. The summary records the server and the `_buildId` of each diagram's result, the diagram file keeps the result as the server returned it, and `render.mjs` draws that XML in the local viewer, with the local layout check, without calling a local server.

The prompts `live-*` (`"set": "live-2026-11-14"`) were written for the staging test of 14 November 2026 and committed before its runs; no layout or wording was tuned on them. Seven are flowcharts (type `swimlane`), each with a follow-up change: three without lanes (small, normal, large; the large one has more nodes than the size rule lets through without lanes) and four with lanes (small, two normal, large). The other four (an architecture, a sequence, an ER diagram and an org chart) show which tool a model picks with the switch on; staging offers them `create_diagram` only.

The prompts of `"set": "er-2026-11-14"` were written for the check of the ER diagrams of `create_diagram` between production (fee698b) and main (310aa3c) and committed before its runs: four ER schemas (small, two normal, large) and a mind map, all `held-out`, without a follow-up change.

```bash
node run.mjs --variants production,staging --prompts live-flow-vending,…,live-org-studio --models sonnet,opus --repeats 3 --edits
node render.mjs --chrome /path/to/chrome
node judge.mjs --a production --b staging --prompts live-… --runs-model sonnet
node judge.mjs --a production --b staging --prompts live-… --runs-model sonnet --edits
node report.mjs
```

The rule, declared before the runs: for each model (Sonnet and Opus, three runs per prompt, judged blind by Opus on the inline images in both orders), staging passes when `report.mjs`'s gate with its defaults (below: share at least 0.5, every prompt at least 0.3, staging's layout-check findings not above production's, the pairs a size rule sends on left out) passes on the flowchart prompts, for the first diagrams and for the changed diagrams. A fail on the changed diagrams counts as a clear loss of quality. Staging is a candidate for production only when both models pass and its median time to the diagram is lower; the other four prompts are reported, not gated. Production served `fee698b` (1.9.0, built 10 November 2026, main before #100 to #103) and staging `3a1818f` (main `310aa3c` with #106, #107, #109 and #110 merged), so the `create_diagram` of the two differs too.

**Result (14 November 2026): the gate fails for Sonnet, so the switch is not used in production.** 132 sessions, every diagram with its server's build id; the details are in `shared/semantic/AGENTS.md`, ninth measurement.

| Flowchart prompts, 21 runs per model and server | Sonnet | Opus |
|---|---|---|
| Seconds to the diagram (median), production / staging | 67 / 17 | 283 / 156 |
| Seconds to the changed diagram (median) | 30 / 10 | 68 / 33 |
| Output tokens (median) | 10,787 / 4,806 | 32,652 / 17,792 |
| Diagrams, timeouts, tool errors | all 21, 0, 0 on both | all 21, 0, 0 on both |
| Layout-check findings per diagram (mean) | 1.38 / 0.67 | 0.86 / 0.19 |
| Judge's share for staging, first diagram | 0.64, vending 0 and triage 0.17 under the floor: **fail** | 0.75, lowest 0.33: pass |
| … changed diagram | 0.64, vending 0 and triage 0 under the floor: **fail** | 0.56, lowest 0.33: pass |

The lane diagrams won (Sonnet 22 of 24 first diagrams, Opus 20 of 24); the flowcharts without lanes lost for Sonnet and are at the floor for Opus. The large flowchart without lanes was sent on to `create_diagram` by the size rule (Sonnet 3 of 3 runs, Opus 2 of 3, its third run went there directly) and is left out of the gate. With the switch on, the models took the description for 41 of 42 flowcharts and `create_diagram` for all 24 other prompts.

## The tool choice on request

The description path is offered by default but taken only when the user asks for a quick diagram: in so many words, fast, rough, a sketch or a draft, little effort or few tokens, in any language. Otherwise the model uses `create_diagram` as before. Two designs carried that condition, and the bench measured which one models follow more reliably:

- **`fast-tool`**: a tool of its own, `create_semantic_diagram`, whose description starts with the condition; `create_diagram` stays as it is. The app server has this design.
- **`fast-param`**: an argument `quick` of `create_diagram`, whose schema description started with the condition, and a pointer to it in the first sentence of `create_diagram`'s description. That pointer took the place of the remark on misspelled Mermaid headers, so the description stayed under 2048 characters. It failed the rule below and was removed with its variant (`DRAWIO_SEMANTIC_MODE=parameter` in the app server). Its code is in the commit "feat(app-server): the description path offered on request, as a tool or as create_diagram's quick".

The prompts of `"set": "fast-2026-11-15"` were written for this test and committed before its runs. There are ten requests, each twice, word for word the same except for the wish (`"wish": true`, keys ending in `-wish`):

- **Languages:** five in English and five in German.
- **Six flowcharts the fast path draws** (`"covered": true`): three without lanes and three with lanes.
- **Four other types** (`"covered": false`): an AWS architecture, an ER schema, a sequence diagram and an org chart.
- **The wishes:** "Quickly", "schnell", "Just a rough sketch is fine", "Bitte mit wenig Aufwand", "Keep it cheap: use as few tokens as possible", "sparsam … Ein grober Entwurf reicht", "a quick draft", "Schnell bitte, und verbrauche wenig Tokens", "A rough sketch is enough, I need it fast" and "auf die Schnelle".
- **Requests without the wish that come close to one:** "a simple flowchart", "ein übersichtliches Swimlane-Diagramm", and an "express" parcel delivery.

The wording was tried on the four requests of `"set": "fast-dev"` (each with and without a wish), never on these.

```bash
# the choice: three runs per prompt and model, each ended at its first diagram call
# (Opus took up to 702 s to its first call without the wish)
node run.mjs --variants fast-tool --set fast-2026-11-15 --models sonnet,opus --repeats 3 --choice-only --timeout 1800
node choice.mjs --variants fast-tool --set fast-2026-11-15

# time, tokens and quality of the fast prompts: the chosen design against create_diagram alone, whole sessions
node run.mjs --variants today,fast-tool --set fast-2026-11-15 --wish yes --type swimlane --models sonnet,opus --repeats 3 --out out/fast-full
node render.mjs --chrome /path/to/chrome-headless-shell --out out/fast-full
node judge.mjs --a today --b fast-tool --set fast-2026-11-15 --wish yes --type swimlane --runs-model sonnet --out out/fast-full
node judge.mjs --a today --b fast-tool --set fast-2026-11-15 --wish yes --type swimlane --runs-model opus --out out/fast-full
node report.mjs --out out/fast-full
```

**The rule, declared before the runs** (`choice.mjs`). The choice is the way of a session's first diagram call:

- **Fast:** a description, through `create_semantic_diagram` or `create_diagram`'s `quick`.
- **Normal:** `create_diagram`'s `xml` or `mermaid`.
- **Counted per model**, Sonnet and Opus, three runs per prompt.
- **A session without a diagram call** counts against the design.

| Rule | Prompts | Sessions per model | Passes with |
|---|---|---|---|
| R1: no fast path without the wish | the ten without the wish | 30 | at least 95 % normal (at most 1 fast) |
| R2: the fast path with the wish | the six flowcharts with the wish | 18 | at least 90 % fast (at most 1 normal) |
| R3: the wish on a type the fast path doesn't draw | the four others with the wish | 12 | at least 90 % normal (at most 1 fast) |

**Choosing a design:**

- A design passes when R1, R2 and R3 hold for both models.
- If both pass, the one with more correct sessions wins. A tie goes to `fast-tool`, which leaves `create_diagram` as it is.
- If neither passes, the description path is not offered by default.

**Time, tokens and quality** come from whole sessions of the chosen design: three runs per flowchart prompt with the wish and model. They are compared with `today`, which has `create_diagram` alone, on the same prompts:

- seconds to the diagram (median);
- output tokens (median);
- layout-check findings;
- the judge's share: Opus, blind, on the inline images, both orders.

These are reported, not gated, because the user asked for speed. The choices of these sessions are reported beside R2.

### Results, 15 November 2026

The app server as built from this branch (Node, stdio), `claude -p` with Sonnet 5.5 and Opus 5.5, three runs per prompt, model and design: 240 sessions ended at their first diagram call.

| Rule (passes with) | `fast-tool`, Sonnet | `fast-tool`, Opus | `fast-param`, Sonnet | `fast-param`, Opus |
|---|---|---|---|---|
| R1: no fast path without the wish (≥ 95 %) | 29 of 30 | 30 of 30 | 30 of 30 | 30 of 30 |
| R2: the fast path with the wish (≥ 90 %) | 18 of 18 | 18 of 18 | 18 of 18 | 18 of 18 |
| R3: the wish on a type the fast path doesn't draw (≥ 90 %) | 11 of 12 | 12 of 12 | 6 of 12: **fail** | 12 of 12 |
| Correct sessions | 118 of 120: passes | | 114 of 120: fails | |

- **Chosen: `fast-tool`.** It passes all three rules for both models. `fast-param` fails R3: Sonnet passed the AWS architecture and the org chart with the wish as `quick` descriptions of a flowchart in all six runs, which the tool of its own, whose description says that other types go to `create_diagram`, did once.
- **The misses of `fast-tool`:** Sonnet took the description once for the laptop request without the wish (a lane diagram) and once for the German org chart with the wish ("auf die Schnelle"), drawn as a flowchart.
- **Two sessions run again.** Two Opus sessions of `fast-tool` on the library flowchart without the wish reached the run's limit of 600 s before their first diagram call: both had fetched the XML reference and were still thinking (about 62,000 thinking tokens). Run again with a limit of 1,800 s, both went to `create_diagram` with XML, after 690 and 702 s, and the table counts the reruns. Counted as sessions without a diagram call, as the rule counts a session that ends without one, Opus would have 28 of 30 in R1 and neither design would pass. The commands above set the longer limit.
- **The wording was tried on the dev prompts first** (Sonnet, four runs per prompt without the wish). A shorter condition sent it to the description in 8 of 16 sessions, `fast-param` in 0 of 16; the wording in the code ("A request without such words, however simple the diagram, goes to create_diagram, never here, and so do the types not listed here") in 5 of 16, all on the two flowcharts without lanes. The held-out prompts were run once, with this wording.

Whole sessions on the six flowcharts with the wish, three runs per prompt and model, rendered in chrome-headless-shell (an 800 px frame) and judged blind by Opus on the inline images, both orders:

| Six flowcharts with the wish | Sonnet, `today` | Sonnet, `fast-tool` | Opus, `today` | Opus, `fast-tool` |
|---|---|---|---|---|
| Diagrams | 18 of 18 (15 XML, 3 Mermaid) | 18 of 18, all descriptions | 18 of 18 (15 XML, 3 Mermaid) | 18 of 18, all descriptions |
| Seconds to the diagram (median) | 46 | 14 | 108 | 27 |
| Seconds to the end of the answer (median) | 51 | 30 | 143 | 63 |
| Output tokens (median) | 7,592 | 3,515 | 14,908 | 5,163 |
| Total tokens (median) | 81,268 | 31,168 | 97,634 | 34,897 |
| Layout-check findings per diagram (mean) | 0.56 | 0.61 | 0.33 | 0.17 |
| Judge's share for `fast-tool` (36 judgements) | | 0.61 | | 0.67 |
| … per prompt: library, pizza, express (no lanes); laptop, vacation, return (lanes) | | 0, 0.5, 1; 1, 0.5, 0.67 | | 0.83, 0, 1; 1, 0.67, 0.5 |

- **Faster, with fewer tokens:** Sonnet reached the diagram 3.3 times sooner and Opus 4 times, with less than half the output tokens and about a third of the total (no XML reference to read). The slowest: Opus on the library flowchart thought for 2 to 3 minutes before its description (155 s to the diagram, against 455 s with XML).
- **The answer after the diagram takes longer.** Claude Code renders no app, so both servers append the `app.diagrams.net` link; the answers after a description repeated it in 33 of 36 sessions, those after `create_diagram` in 24 of 36, as in the ninth measurement. In a host that shows the diagram there is no link.
- **Quality is mostly at least equal, but not on every flowchart without lanes.** The description won on five of six prompts per model, and both models' lane diagrams won at least half. Each model lost one flowchart without lanes in all six judgements (Sonnet the library, Opus the pizza order), the judge naming crossing lines, long detours, a retry loop merged into the main flow, and for Sonnet a payment choice collapsed into one edge: the weak spot of the ninth measurement. The "express" request ("use as few tokens as possible") went to Mermaid in all six `today` runs, and the description won all twelve judgements there.
- **Not measured:** a change asked for without the wish to a diagram drawn on request (the description asks the model to come back to the tool), and hosts other than Claude Code.

## When a type is switched on

The semantic tool only offers a diagram type (`describeTool` in `shared/semantic/description.js`) once its layouts are at least as good as what the model places itself today. `report.mjs` checks that per type, on the judgements of the inline images:

- the semantic share on the **held-out** prompts is 0.5 or more (`--threshold`);
- **every** prompt's share is 0.3 or more (`--floor`), so one prompt that always loses isn't hidden by the others; both read on three runs per prompt (`run.mjs --repeats 3`), since a single run passed a type that three runs failed. When several wordings of the tool description are measured, the gate is read on the three runs of the wording that is kept, never on the runs of all wordings together, which hide a prompt that loses with the kept one: in the fifth measurement the large flowchart without lanes was at the floor for Opus over the five wordings (9 of 30) and under it with the kept wording (1 of 6), and the second reading decided;
- the layout check finds no more issues in the semantic diagrams than in today's.

A prompt that the size rule sends to `create_diagram` for a model is left out of all three with every pair whose semantic side came from `create_diagram`, refused or not. The rule sends a prompt on when it refused one of that model's descriptions of it (`sentOn` in `run.mjs`'s summary: the description was refused as too large, and the diagram came from the other tool). Its pairs from `create_diagram` compare the model's XML (or Mermaid) with its own XML and measure nothing of the semantic tool; a model may also skip the description of a large prompt and go there at once, as Opus did in two of three sessions in the seventh measurement. A description of the prompt that the rule let through still counts. A prompt whose pairs are all left out has no share and no floor; the report gives the number of pairs left out (`left out`) and the share of all pairs beside it (`share of all`). In the sixth measurement the tool's description still named the limit, so the models went to `create_diagram` without a refused call: `report.mjs --sent-on flow-refund-large` names the prompt by hand (`shared/semantic/AGENTS.md`).

Both sides are drawn in the calm theme with the same font rule (14 px up to 12 shapes, 16 above). Where the median font sizes of a pair still differ by 2 px or more, the judgement says more about text size than about layout: the report counts those pairs separately and gives the share without them (`share without`), which the gate doesn't read. Time and tokens alone don't switch a type on, and neither does a judgement of the prompts a layout was developed on.

A judge model is one opinion. `pairs.mjs` writes a page of pairs for a person to judge blind (`node pairs.mjs --a today --b semantic-rows --count 20`): `pairs/index.html` shows each pair in random order as A and B with the prompt, the choices are kept in the page and exported as JSON, and `pairs/key.json` says which side was which.

A type that passed goes into `SEMANTIC_TYPES_READY` in `mcp-app-server/src/shared.js` (flowcharts and swimlanes so far): the app server then offers it with `DRAWIO_SEMANTIC_TYPES=on`, in the Node server at startup and in the Worker at build time, which is how staging tests it. After that test it moves to `SEMANTIC_TYPES_ON`, which lists `create_semantic_diagram` for everybody, on request (**The tool choice on request**). `DRAWIO_SEMANTIC_TYPES=er` offers any other type for trying it out. The `switch-on` variant runs prompts against the app server with the switch on, so a prompt above a size rule (`MAX_NODES`, `MAX_NODES_WITHOUT_LANES` in `shared/semantic/index.js`) is drawn with whatever tool the model then takes and judged as what the user gets, outside the gate (above). A description the rule refused is saved as `<tag>-refused.json`, and the summary has the nodes of every description the session sent (`calls[].nodes`).

The wording of the tool description is measured the same way: `SEMANTIC_PARTS` (a list out of `placement`, `groups`, `completeness`; `none` for none of them, unset for the default) tells `semantic-server.mjs` which parts of the description are in their later wording (`PARTS` in `shared/semantic/description.js`), so one part can be judged against the same `today` diagrams without the others.

`preview.mjs` checks the app server's tool in the viewer, which `render.mjs` doesn't (it draws descriptions with the engine and shows them as XML): the app server with the switch on, and every saved description of an offered type shown twice in headless Chrome, the result alone and with the arguments streamed in first, as a host hands them over while the model writes them (`node preview.mjs --chrome /path/to/chrome --match 'semantic-rows-(lanes|flow)'`). It reports, per description and in `preview.json`, what the preview drew at every step and how long a layout took, which way the diagram lay at every step, with the whole input and with the result, and how often it turned (lanes `r` for rows and `c` for columns, read from where two lanes are; a flowchart without lanes `t` turned or `n` as written, from the viewer's `semanticShownTurned` and, for the result, the engine's own layout), whether the streamed diagram ends with the same cells as the result alone, whether the model is told that the diagram came from its description, the layout check's findings and script errors. A description the size rule refused (`<tag>-refused.json`) is streamed in the same way, and its row says what the frame shows in place of the diagram (`shown`: the note, or an error).
