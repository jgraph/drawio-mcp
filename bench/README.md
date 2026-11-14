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

## Setup

The bench needs Node 20+, the `claude` CLI (signed in) and a Chrome or `chrome-headless-shell` for the renders. Its two packages (`elkjs`, `puppeteer-core`) install here (`npm ci` in `bench/`) or anywhere else with `NODE_PATH` pointing at that `node_modules`. The app server's own packages must be installed (`npm ci` in `mcp-app-server/`), since the renders run its viewer.

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

Per run, `run.mjs` writes the timestamped stream (`<tag>.jsonl`), a summary (`<tag>-summary.json`: seconds to the diagram and to the end of the answer, thinking and writing time, tokens, tool calls; the edit turn under `edit`, measured from the moment its request was sent) and the diagram's arguments (`<tag>-diagram.json`, `<tag>-edit-diagram.json`). The semantic server also saves every call with the engine's XML, warnings and stats (`<tag>-call<n>.json`).

`render.mjs` runs a minimal MCP Apps host in headless Chrome (an 800 px frame, a screen 1000 px high, which sets the viewer's inline height) and saves what the chat shows (`<tag>-inline.png`), the PNG the viewer sends to the model (`<tag>-full.png`), the layout check (`<tag>-check.txt`), the XML as shown (`<tag>-rendered.xml`) and the issue count, the number of shapes and their median font size (`<tag>-render.json`). Semantic descriptions are converted by the engine as it is now and then go through `create_diagram` as XML, like every other diagram, so after a change to a layout `--force` renders the saved descriptions again without new model runs. `--routing viewer` leaves their edges to the viewer's router (`routing: "libavoid"`) instead of the engine's, to compare the two on the same placements.

`judge.mjs` shows a judge model (Opus by default) the two images of one prompt and repeat as "X" and "Y", once in each order, with the prompt, and asks which one the user would prefer and for a score of each. It shows the inline image by default: the 800 px frame as the chat shows it, scaled down and cut where the viewer cuts it, because that is what the user reads; `--image full` shows the whole diagram at its own size. A tie counts half; the share of B is its points over all judgements.

`report.mjs` writes `report.md` and `report.json`: the runs per type and prompt, the edit turns (seconds, tokens, and of the shapes in both diagrams the share that kept its id and the share that moved by more than 10 px once the common shift is removed), the tool choice (the share of runs whose first diagram call was the semantic tool) and the judgements with the gate.

## When a type is switched on

The semantic tool only offers a diagram type (`describeTool` in `shared/semantic/description.js`) once its layouts are at least as good as what the model places itself today. `report.mjs` checks that per type, on the judgements of the inline images:

- the semantic share on the **held-out** prompts is 0.5 or more (`--threshold`);
- **every** prompt's share is 0.3 or more (`--floor`), so one prompt that always loses isn't hidden by the others; both read on three runs per prompt (`run.mjs --repeats 3`), since a single run passed a type that three runs failed;
- the layout check finds no more issues in the semantic diagrams than in today's.

Both sides are drawn in the calm theme with the same font rule (14 px up to 12 shapes, 16 above). Where the median font sizes of a pair still differ by 2 px or more, the judgement says more about text size than about layout: the report counts those pairs separately and the gate leaves them out. Time and tokens alone don't switch a type on, and neither does a judgement of the prompts a layout was developed on.

A judge model is one opinion. `pairs.mjs` writes a page of pairs for a person to judge blind (`node pairs.mjs --a today --b semantic-rows --count 20`): `pairs/index.html` shows each pair in random order as A and B with the prompt, the choices are kept in the page and exported as JSON, and `pairs/key.json` says which side was which.

A type that passed goes into `SEMANTIC_TYPES_READY` in `mcp-app-server/src/shared.js` (flowcharts and swimlanes so far): the app server then offers it with `DRAWIO_SEMANTIC_TYPES=on`, in the Node server at startup and in the Worker at build time, which is how staging tests it. After that test it moves to `SEMANTIC_TYPES_ON`, which lists `create_semantic_diagram` for everybody. `DRAWIO_SEMANTIC_TYPES=er` offers any other type for trying it out. The `switch-on` variant runs prompts against the app server with the switch on.

The wording of the tool description is measured the same way: `SEMANTIC_PARTS` (a list out of `placement`, `groups`, `completeness`; `none` for none of them, unset for the default) tells `semantic-server.mjs` which parts of the description are in their later wording (`PARTS` in `shared/semantic/description.js`), so one part can be judged against the same `today` diagrams without the others.

`preview.mjs` checks the app server's tool in the viewer, which `render.mjs` doesn't (it draws descriptions with the engine and shows them as XML): the app server with the switch on, and every saved description of an offered type shown twice in headless Chrome, the result alone and with the arguments streamed in first, as a host hands them over while the model writes them (`node preview.mjs --chrome /path/to/chrome --match 'semantic-rows-(lanes|flow)'`). It reports, per description and in `preview.json`, what the preview drew at every step and how long a layout took, how often the lanes turned while the diagram grew, whether the streamed diagram ends with the same cells as the result alone, whether the model is told that the diagram came from its description, the layout check's findings and script errors.
