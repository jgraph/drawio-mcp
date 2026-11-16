# The fast mode: `create_semantic_diagram` on request

The app server has two ways to draw a flowchart:

- **`create_diagram`:** the model writes draw.io XML and places every shape itself, or writes Mermaid.
- **`create_semantic_diagram`:** the model writes a description of what the diagram contains: the steps with their kind, the lanes, the transitions, and a row and a column for every step (`FORMAT.md`). This engine lays it out, routes the lines and styles it.

The description is the fast mode. It takes Sonnet a third and Opus a quarter of the time to the diagram, with less than half the output tokens. On flowcharts without lanes, though, the model's own XML still wins more often. So the server lists the tool by default for flowcharts and swimlanes, and its description tells the model to take it only when the user asks for speed or economy.

This file is the reference for that mode:

- when models use it, and its limits;
- why it is a tool of its own;
- the measurement it was decided on;
- what to measure again when something changes.

The engine itself is in `AGENTS.md`, the earlier measurements are in `MEASUREMENTS.md`, and how to run the bench is in `bench/README.md`.

## When models use it

The tool's description starts with this condition (`onRequestText` and `WISH` in `description.js`, 1,471 characters with flowcharts and swimlanes offered):

> Only for a diagram the user explicitly asked to get fast or cheap: a quick, fast or rough diagram, a sketch or a draft, little effort or few tokens, in any language ("schnell", "Skizze", "wenig Aufwand", "sparsam"). A request without such words, however simple the diagram, goes to create_diagram, never here, and so do the types not listed here: create_diagram places the shapes with more care. A change to a diagram drawn here comes back here.

The table shows what Sonnet and Opus did with the held-out prompts of the measurement below, three runs each. The wish is in quotes, and the requests are shortened.

| Request | Tool taken |
|---|---|
| "**Quickly** draw a simple flowchart of returning a book at a library self-service kiosk …" | the description, 6 of 6 |
| "Draw a swimlane diagram … for requesting a new laptop … **Just a rough sketch is fine.**" | the description, 6 of 6 |
| "Draw a flowchart of an express parcel delivery … **Keep it cheap: use as few tokens as possible.**" | the description, 6 of 6 |
| "Zeichne **schnell** ein Flussdiagramm für eine Pizzabestellung in einer App …" | the description, 6 of 6 |
| "Zeichne ein übersichtliches Swimlane-Diagramm … für einen Urlaubsantrag … **Bitte mit wenig Aufwand.**" | the description, 6 of 6 |
| "Erstelle **sparsam** ein Swimlane-Diagramm … für eine Reklamation im Onlineshop …" | the description, 6 of 6 |
| The same six without the wish ("Draw a simple flowchart …", "ein übersichtliches Swimlane-Diagramm", the "express" delivery) | `create_diagram`, 35 of 36 (Sonnet took the description once, for the laptop lanes) |
| "Draw **a quick draft** of an architecture diagram of a web shop on AWS …" | `create_diagram`, 6 of 6 |
| A sequence diagram of signing in with a passkey … "**A rough sketch is enough, I need it fast.**" | `create_diagram`, 6 of 6 |
| "Zeichne ein ER-Diagramm für … eine Stadtbibliothek … **Schnell bitte, und verbrauche wenig Tokens.**" | `create_diagram`, 6 of 6 |
| "Erstelle mir **auf die Schnelle** ein Organigramm einer Arztpraxis …" | `create_diagram`, 5 of 6 (Sonnet drew it once as a flowchart description) |
| The four other types without the wish | `create_diagram`, 24 of 24 |

In short: with the wish, a flowchart or swimlane diagram goes to the description. Without it, and for every other type, the request goes to `create_diagram`.

## What it draws, and its limits

- **Types:** `flowchart` and `swimlane` (a flowchart with lanes), the types in `SEMANTIC_TYPES_ON` (`mcp-app-server/src/shared.js`). ER, architecture and network diagrams are offered only by name, for trying them out. They have not passed the blind judgement.
- **Size:** a flowchart without lanes of more than 24 steps is refused with an error that sends the model to `create_diagram`. Where architecture or network diagrams are offered by name, the limit for them is 18 nodes. Lane diagrams have no limit. The model isn't told these numbers: when it knew them, it left steps out to stay under them (`MEASUREMENTS.md`, seventh measurement). The viewer shows a short note in place of the refused diagram.
- **Look:** the calm theme only. The description has no coordinates, sizes, colors or styles, so a request for a particular look is better served by `create_diagram`.
- **Changes:** a change is the whole changed description, with the same ids and the `layout` text of the last result, so the shapes the change doesn't touch stay in place (`AGENTS.md`, **A change keeps the layout**). The description asks the model to send changes to a diagram drawn here back to this tool. Whether it does so for a change asked for without the wish is not measured.
- **Hosts:** every measurement ran in Claude Code (`claude -p`). Other hosts are not measured, nor is the time to the diagram in a host that renders the app.
- **With the drawio skill:** the plugins' skill (`plugins/*/skills/drawio/SKILL.md`) tells the model to call `create_diagram` in a chat that shows diagrams inline, and doesn't name this tool. With the skill loaded, a quick request may still go to `create_diagram`; that is not measured.

## Switching it off, or offering other types

`DRAWIO_SEMANTIC_TYPES` sets the types (`resolveSemanticTypes` in `mcp-app-server/src/shared.js`). The Node server reads it at startup (also in Docker), the Worker when its HTML is built for the deploy.

| Value | Effect |
|---|---|
| unset, `on`, `true`, `1` | flowcharts and swimlanes, on request (the default) |
| `off` | no `create_semantic_diagram`: `tools/list` has `create_diagram`, `search_shapes` and `get_drawio_reference` alone |
| a list, e.g. `on,er` or `architecture` | the types it names; `on` in the list adds the default types |

Every type offered is offered on request: the condition is part of every description the server lists.

## Why a tool of its own

Two designs carried the condition, and both were measured on the same prompts:

- **`fast-tool`:** a tool of its own, `create_semantic_diagram`, whose description starts with the condition. `create_diagram` stays as it is.
- **`fast-param`:** an argument `quick` of `create_diagram`. Its schema description started with the condition, and a pointer to it replaced a sentence of `create_diagram`'s description, so that description stayed under 2,048 characters.

The parameter failed. With the wish, Sonnet passed the AWS architecture and the org chart as `quick` descriptions of a flowchart in all six runs. The tool of its own did that once: its description says that other types go to `create_diagram`, and its schema offers only the flowchart types. A tool of its own also leaves `create_diagram`'s definition unchanged, and with it the definitions the ChatGPT and Claude directory listings were reviewed against.

The parameter's code is in the commit "feat(app-server): the description path offered on request, as a tool or as create_diagram's quick". It was removed in the next one.

Before this, offered for every request (`DRAWIO_SEMANTIC_TYPES=on`), the tool failed the live staging test of 14 November 2026 for Sonnet on flowcharts without lanes, while it won on lane diagrams (`MEASUREMENTS.md`, ninth measurement). That is why it is taken only on request.

## The measurement, 15 November 2026

**Setup:**

- **Source:** the app server as built from the branch (Node, stdio), with `claude -p` running Sonnet 5.5 and Opus 5.5.
- **Prompts:** the set `fast-2026-11-15` in `bench/prompts.json`, written for this test and committed before its runs:
  - ten requests, five in English and five in German, each with and without a wish;
  - six flowcharts, three of them with lanes;
  - four other types: AWS architecture, ER, sequence and org chart.
- **Wording:** tried only on the separate set `fast-dev`.
- **Rule:** declared before the runs, in `bench/README.md` (**The tool choice on request**) and `bench/choice.mjs`.
- **What counts:** the way of each session's first diagram call. Fast is a description; normal is `create_diagram`'s `xml` or `mermaid`.

**The rule:**

| Rule | Prompts | Sessions per model | Passes with |
|---|---|---|---|
| R1: no fast path without the wish | the ten without the wish | 30 | at least 95 % normal |
| R2: the fast path with the wish | the six flowcharts with the wish | 18 | at least 90 % fast |
| R3: the wish on a type the fast path doesn't draw | the four others with the wish | 12 | at least 90 % normal |

How a design is chosen:

- A design passes when all three rules hold for both models.
- Of the designs that pass, the one with more correct sessions wins, and a tie goes to the tool of its own.
- A session without a diagram call counts against the design.

**The choice** (240 sessions, each ended at its first diagram call):

| Rule (passes with) | `fast-tool`, Sonnet | `fast-tool`, Opus | `fast-param`, Sonnet | `fast-param`, Opus |
|---|---|---|---|---|
| R1 (≥ 95 %) | 29 of 30 | 30 of 30 | 30 of 30 | 30 of 30 |
| R2 (≥ 90 %) | 18 of 18 | 18 of 18 | 18 of 18 | 18 of 18 |
| R3 (≥ 90 %) | 11 of 12 | 12 of 12 | 6 of 12: **fail** | 12 of 12 |
| Correct sessions | 118 of 120: passes | | 114 of 120: fails | |

- **Two sessions were run again.** Two Opus sessions of `fast-tool` on the library flowchart without the wish reached the run's limit of 600 s before their first diagram call. Both had fetched the XML reference and were still thinking, at about 62,000 thinking tokens. Run again with a limit of 1,800 s, both went to `create_diagram` with XML, after 690 and 702 s, and the table counts the reruns. Counted as sessions without a diagram call, Opus would have 28 of 30 in R1 and neither design would pass.
- **Not watertight on small flowcharts.** The wording was tried first on the dev prompts: Sonnet, four runs per prompt without the wish.
  - A shorter condition sent Sonnet to the description in 8 of 16 sessions, and `fast-param` in 0 of 16.
  - The wording in the code did so in 5 of 16, all on the two short flowcharts without lanes; a German airport check-in went there 4 of 4 times.
  - On the held-out prompts it happened in 1 of 30.

**Time, tokens and quality with the wish:** whole sessions on the six flowcharts with the wish, three runs per prompt and model, against `create_diagram` alone (`today`). They were rendered in chrome-headless-shell with an 800 px frame, and Opus judged the inline images blind, in both orders. These numbers are reported, not gated, because the user asked for speed.

| Six flowcharts with the wish | Sonnet, `create_diagram` | Sonnet, description | Opus, `create_diagram` | Opus, description |
|---|---|---|---|---|
| Diagrams | 18 (15 XML, 3 Mermaid) | 18 descriptions | 18 (15 XML, 3 Mermaid) | 18 descriptions |
| Seconds to the diagram (median) | 46 | 14 | 108 | 27 |
| Seconds to the end of the answer (median) | 51 | 30 | 143 | 63 |
| Output tokens (median) | 7,592 | 3,515 | 14,908 | 5,163 |
| Total tokens (median) | 81,268 | 31,168 | 97,634 | 34,897 |
| Layout-check findings per diagram (mean) | 0.56 | 0.61 | 0.33 | 0.17 |
| Judge's share for the description (36 judgements) | | 0.61 | | 0.67 |
| … per prompt: library, pizza, express (no lanes); laptop, vacation, return (lanes) | | 0, 0.5, 1; 1, 0.5, 0.67 | | 0.83, 0, 1; 1, 0.67, 0.5 |

- **Faster, with fewer tokens:** Sonnet reached the diagram 3.3 times sooner and Opus 4 times, with less than half the output tokens and about a third of the total, since there is no XML reference to read.
- **Quality mostly at least equal, not on every flowchart without lanes:**
  - Each model lost one flowchart without lanes in all six judgements: Sonnet the library, Opus the pizza order. The judge named crossing lines, detours and a retry loop merged into the main flow, the weak spot of the ninth measurement.
  - The lane diagrams won at least half.
  - The "express" request went to Mermaid in all six `create_diagram` runs, and the description won all twelve judgements there.
- **A longer answer in Claude Code:** Claude Code renders no app, so both servers append the `app.diagrams.net` link. The answers after a description repeated it in 33 of 36 sessions, those after `create_diagram` in 24 of 36. In a host that shows the diagram there is no link.

## What a deploy changes

- **`tools/list` gets a fourth tool**, `create_semantic_diagram`. It has the same annotations as `create_diagram`: read-only, idempotent, not destructive, not open world. `create_diagram`, `search_shapes` and `get_drawio_reference` are listed as before.
- **ChatGPT:** the ChatGPT app holds the scanned tool list. After the deploy, run **MCPs → Rescan** (`mcp-app-server/OPENAI-SUBMISSION.md`).
- **Claude:** Claude.ai's connector and the Claude Code plugin, which bundles the hosted server in its `.mcp.json`, read the tool list from the server, so they get the tool with the deploy, without a plugin release.
- **The viewer HTML** always carries the engine for the preview: about 315 KB, 91 KB gzipped.
- **Deploying without it:** `DRAWIO_SEMANTIC_TYPES=off`.

## What to measure again

The condition is a matter of wording: models follow it, but not perfectly, and a small change can move the share. The tests (`mcp-app-server/test/semantic-tool.test.js`, `tools.test.js`) check that the condition starts the description and that every description stays under 2,048 characters, not whether models follow it. So measure again with the bench (`bench/README.md`, **The tool choice on request**, for the commands):

| When this changes | Measure |
|---|---|
| The condition or `WISH` (`description.js`), or the rest of the tool's description | The tool choice: both models, three runs, R1 to R3, on a new held-out set written and committed before the runs. The set `fast-2026-11-15` has been read now, so tune on `fast-dev` and keep the next held-out set unread. |
| `create_diagram`'s description, especially its first sentences | The tool choice, as above: the model reads both descriptions when it chooses. |
| A type added to `SEMANTIC_TYPES_ON` | First the blind judgement of that type (`bench/README.md`, **When a type is switched on**), then the tool choice with prompts of that type with and without the wish. R3 then needs other types that remain outside. |
| The engine's layout of flowcharts or swimlanes | Time, tokens and quality with the wish: `today` against `fast-tool`, rendered and judged. |
| The size rules (`MAX_NODES_WITHOUT_LANES`, `MAX_NODES`) | The large prompts of the judgement, read without the pairs the rule sends to `create_diagram` (`bench/README.md`). |
| A new host where the mode matters | The tool choice in that host, since every measurement so far ran in Claude Code. |

Not measured yet:

- a change asked for without the wish to a diagram drawn on request;
- hosts other than Claude Code;
- the choice with the drawio skill loaded.
