# Semantic diagrams

The model describes what a diagram contains (nodes, groups, edges, see `FORMAT.md`), never coordinates, sizes or styles, at most a row and a column per node; this engine turns the description into draw.io XML. Placing every shape itself is where a model spends most of its time on a diagram: in the bench (`bench/`), Sonnet took about 50 s to an ER diagram as XML and about 6 s as a description, Opus 228 s and 12 s, and the engine takes 15 to 70 ms.

Not wired into a server yet, so nothing is offered to models: `bench/semantic-server.mjs` offers it as a tool for the measurements, with the types and the kind of placement hints set per run. The servers will offer it as a tool of its own, `create_semantic_diagram`, next to `create_diagram` rather than as a third parameter of it (its own description, within the 2048 characters, lists only the types switched on). A type is switched on only once a blind judgement of the rendered images rates its layouts at least equal to the model placing the XML itself (`bench/README.md`).

## Rules

- **Headless and deterministic.** No DOM, no `fetch`, no timers, no randomness: the same description gives the same XML byte for byte, in the Cloudflare Worker, in Node (both servers, the skill's scripts) and in the browser. Text is measured with Helvetica's widths (`text-width.js`), which is what the viewer falls back to.
- **Own code or public packages.** Everything here is written for this engine or comes from a public npm package. What the layouts need beyond that (a lane layout, text measurement with line wrapping, icons by name, scoring layouts) is written here too. ELK is optional and passed in (`options.elk`, `new ELK()` from elkjs or the browser's global), never imported, so each host brings its own copy. The Cloudflare Worker passes none for now (no elkjs in its bundle), so there ER schemas above 16 tables go on the grid as well.
- **The look of `shared/chat-view-xml.md`.** Each layout follows the pattern that file asks models for, in the calm theme (`theme.js`, the colors of the "Calm" theme in `shared/xml-reference.md`), so a diagram drawn from a description and one the model places look the same. When a pattern changes there, change it here too.
- **Leniency with warnings.** `spec.js` reads what models get wrong (a JSON string, `source`/`target`, any case, field lists as one string) and drops what can't be drawn with a warning instead of failing the call.
- **XML stays the way out.** The engine's output is plain draw.io XML that goes through the server's usual passes (repair, normalization, waypoint snapping, label perimeters) without them finding anything to change; ids follow the description (`table.field` for rows, `child-parent` for relations).

## Files

| File | Purpose |
|------|---------|
| `index.js` | `semanticToXml(input, {elk, hints, route})` → `{xml, error, warnings, stats}`, and `SUPPORTED_TYPES` (the types with a layout). `hints`: `false` ignores `row` / `col`, `"ask"` reads them as the cells of one grid for the whole diagram, anything else as cells in each group's grid; `route: false` leaves the edges to the viewer |
| `spec.js` | `normalizeSpec`: reads a description into one shape (`TYPES`, aliases, warnings, `row` / `col`, `lanes` as groups) |
| `description.js` | `describeTool(types, {hints})`: the tool description for the switched-on types (each server caps descriptions at 2048 characters), and `describeSchema(types, {hints})`: the input schema with the keys of nodes, groups and edges, which don't count towards that cap. `hints`: `false` (not mentioned), `true` (optional, per group) or `"ask"` (a cell for every node in one grid for the diagram); pass the same value to `semanticToXml` |
| `boxes.js` | Architecture, network, flowchart and swimlane: writes the description as compact XML without positions (`compactXml`: `role=`, `icon=`, `row=`/`col=`, `lane=1`; people get the users icon of the provider most of the diagram's icons come from, a stick figure otherwise) and has the passes of the XML path place it (`placeCompactXml`: shorthand expansion, icon resolver, normalization, `shared/grid-layout.js`) |
| `er.js` | ER schemas: fields (`parseField`), relations from foreign-key rows to primary-key rows (`resolveRelations`), table sizes, grid or ELK layout, the cells |
| `grid.js` | Grid placement (`placeOnGrid`: link costs, swaps from three deterministic starts, an optional refinement on routed results) and channel routing (`routeGrid`: one track per link in the gutters between columns and the gaps between rows, track order searched for the fewest crossings) |
| `theme.js` | Calm colors by role, edge colors, font sizes by shape count |
| `text-width.js` | Helvetica advance widths for headless text measurement |
| `xml-writer.js` | Escaping, html labels, unique ids, `writeModel(cells)` |
| `FORMAT.md` | The format, for every planned type |

## ER layout

Up to 16 tables go on a grid of two to four columns (`gridGeometry` in `er.js`). Each column count is placed (`placeOnGrid` with `linkCost`: a link between neighbouring columns in one row costs nothing and 0.8 per row apart, one in the same column needs a C-shaped route, one across a column costs most) and routed (`routeGrid`), and the result with the lowest badness is kept: link cost, crossings ×3, collinear overlaps ×4, bends ×0.1, the lines' length per 250 px and how much the diagram would have to shrink to fit the 800 × 800 chat frame ×40. A relation whose rows are within half a row of each other is drawn straight. Relations that end on the same row (several tables referencing one key) get their own points on it, 10 px apart and ordered by where they come from, so no two share a stub or a track. Larger schemas use ELK's layered algorithm (`elkGeometry`) with fixed ports at the row centres when an ELK instance is passed in, and the grid otherwise.

How the layouts compare with the XML models place themselves is measured with `bench/` (blind judgement of the rendered images). What the judge asked for so far: related tables side by side in one row, few crossings, short lines, and no relations sharing a line. A first version laid every schema out with ELK's layered algorithm (one tall column of layers, the relations bundled in narrow gaps) and lost every comparison; the grid, the separate points per relation and the weights above came from those judgements. In November 2026 the grid tied with the schemas Sonnet placed as XML (9 of 18 judgements on three prompts, mean score 6.9 against 6.6) and still lost to the one Opus placed (2 of 2).

## Architecture, network, flowchart and swimlane: one grid pass

These four types have no layout module of their own. `boxes.js` writes what a model could write itself, compact XML without any geometry, and `shared/grid-layout.js` places it: a pass over the draw.io model like the normalization (`gridLayoutDiagram(xml, {mode, direction, hints, frame})`, geometry-less cells in, geometry and routed edges out). So the XML path can use the same pass for a diagram whose cells have no positions, and whatever the pass learns, both get. It only touches pages with a vertex that has no position, unless `all` is set.

- **Sizes** come from the text (`text-width.js`, with line wrapping): boxes of one kind share the size of the fullest one, icons are 60 px with their label below, a decision is at least 160 × 90.
- **With hints** (`row=`, `col=` in a cell's style, removed by the pass): the model's cells, on a grid with a column as wide as its widest cell and a gap as wide as the label of a line that runs straight through it needs. Read per container by default: every container has its own grid, and frames alone in their cells get one height per row and one width per column.
- **One grid for the page** (`hints: "page"`, what `semanticToXml` passes for `hints: "ask"`): every shape names its cell in one grid for the whole page, as a model does when it writes coordinates (`placeOnPage`). Columns and rows are as large as their fullest cell and hold across the frames; a frame is drawn around the cells of its members, with room in the gaps for its border and title and for those of the frames nested in it. A shape in the block of a container it isn't in moves out by the shortest way (`moveStrangers`). Lanes are bands of that grid, rows or columns each lane has to itself, and the pass turns them the other way when the chat then shows clearly more of the diagram (`TURN_MARGIN`) and shows it whole. Cells that can't be drawn so (a shape without one, lanes that share rows and columns) fall back to a grid per container, each frame taking the first cell of its members.
- **Without hints, tiers** (`mode: "tiers"`, architecture): ranks by the connections, the order in a rank by the barycenter of its neighbours, every rank centered and moved towards what it connects to. A run of ranks without frames beside a rank with one is folded into one rank; a level without frames that is longer than the chat frame continues beside itself.
- **Without hints, flow** (`mode: "flow"`, flowcharts): the main path in one line, branches beside the step they leave, a snake when the path is longer than the frame. Lanes (`lane=1`) share one grid and become columns or rows.
- **Direction**: every nesting level can run down or to the right. The page is placed once per policy (each level for itself, all down, all right, alternating either way) and the one of which the chat shows most wins, shorter connections second. A level can't decide that for itself: it doesn't know how much of the frame the levels around it leave.
- **What the chat shows** (`shown`): the frame is 736 × 664 px (`FRAME`: the viewer's card in an 800 px chat on a screen 1000 px high, less its padding, measured on the bench's screenshots). A diagram is shown whole down to a scale of 0.75; below that the viewer shows the top of a tall one at the scale of its width and cuts the rest off, which the score counts as the scale times the square of the visible share. A page that doesn't fit at full size is placed again with less room between its cells and inside its frames (`SPACING.tight`).
- **Edges**: for every right-angle edge a handful of candidate routes (straight, one bend, two bends, around the outside) is scored by bends, length, shapes in the way, crossings with routes already chosen and the sides already in use; the winner is written as exit and entry points and waypoints.

What the measurements in `bench/` say so far (November 2026, Sonnet and Opus, 12 prompts per type, half held out) is in **Results** below. In short: the description is 3 to 9 times faster to write than placed XML, the layouts the pass finds on its own lose against the ones a model places by hand, and the ones where the model names the cells win a quarter of the comparisons, with one grid for the page four in ten of Sonnet's on the held-out prompts and still a sixth of Opus's. Nothing is offered to models.

## Results

First measurement, 13 November 2026: 12 prompts for architecture, cloud and network and 12 for swimlanes and flowcharts, half of each held out, one run per prompt, model and variant, each with a follow-up change; `today` is the app server with the table-row, role and icon-name shorthands. The numbers below are for the held-out prompts; the judge (Opus) saw the inline images in both orders.

| | Sonnet, architecture | Sonnet, swimlane | Opus, architecture | Opus, swimlane |
|---|---|---|---|---|
| Seconds to the diagram, `today` (median) | 59 | 77 | 384 | 367 |
| … hints asked (`semantic-rows`) | 12 | 20 | 43 | 115 |
| … no hints (`semantic-auto`) | 12 | 10 | 25 | 15 |
| Output tokens, `today` / hints asked / no hints | 8,721 / 1,338 / 1,503 | 10,924 / 2,608 / 1,245 | 41,335 / 5,219 / 3,183 | 41,814 / 13,083 / 1,992 |
| Seconds to the changed diagram, `today` / hints asked | 44 / 15 | 34 / 14 | 226 / 24 | 79 / 38 |
| Judge's share for hints asked, first diagram | 0.25 | 0.25 | 0 | 0.33 |
| … after the change | 0.08 | 0.17 | 0.08 | 0.33 |
| Judge's share for no hints, first diagram | 0 | 0 | 0 | 0 |
| Layout-check findings per diagram, `today` / hints asked / no hints | 4.7 / 5.3 / 9.2 | 2.2 / 1.3 / 1.8 | 2.2 / 8.5 / 9.5 | 0.8 / 1.0 / 0.8 |
| Shapes moved by the change, `today` / hints asked | 0.28 / 0.76 | 0.40 / 0.45 | 0.67 / 0.76 | 0.71 / 0.48 |

- **Speed is there, the layouts are not.** With hints asked, a description takes Sonnet a fifth to a quarter of the time of placed XML and Opus a ninth (architecture) to a third (swimlanes); without hints Opus is 15 to 25 times faster. No type passes the gate (0.5 on the held-out prompts, 0.3 for every prompt).
- **The pass on its own loses every pair** (1 of 120 judgements over both models and turns). The judge names tangled and crossing lines, labels on each other and diagrams cut off at the bottom of the frame. With hints offered as optional, Sonnet gave them in 2 of 12 runs, and the result is the same (1 of 48).
- **With the model naming the cells it wins a quarter** (Sonnet 13 of 48 on all 24 prompts, 6 of 24 held out; Opus 4 of 24). What it still loses on: the diagram is about 1.5 times the frame, because every group brings its own grid and its own padding, so it is shown smaller or cut off, where a model placing XML composes for the frame; lines through a dense group; a lane diagram with one row per step gets tall.
- **Opus thinks about the cells:** with hints asked a large flowchart took it 677 s and 73,780 output tokens (the same as XML: 533 s), where Sonnet took 41 s.
- **Changes** are 2 to 9 times faster, but three quarters of an architecture diagram's shapes move, since the whole description is laid out again; Sonnet's own XML moves about a quarter, Opus's two thirds.
- **Tool choice:** offered both tools, Sonnet called the semantic one first in 11 of 12 runs and Opus in 12 of 12, with or without a sentence in `create_diagram` that sends these types there.
- **Fonts:** the engine follows the chat rule (16 px above 12 shapes) and Sonnet's own XML mostly doesn't (14 px in 43 of 48 diagrams), so most Sonnet pairs differ by 2 px in the engine's favor; the judge still preferred the smaller text for its layout.

### Second measurement: one grid for the page

Same day, same prompts and the same `today` runs, one run per prompt, first diagram only (no follow-up change). The hints are asked for as cells of one grid for the whole diagram (`hints: "ask"`), and the pass has the measured frame, the tighter spacing, the cut-off in its score and the provider's users icon. Held-out prompts unless it says otherwise.

| | Sonnet, architecture | Sonnet, swimlane | Opus, architecture | Opus, swimlane |
|---|---|---|---|---|
| Seconds to the diagram, hints asked, one grid (median) | 13 | 22 | 47 | 138 |
| Output tokens | 1,766 | 2,989 | 5,413 | 15,355 |
| Judge's share, first diagram | 0.33 | 0.50 | 0.17 | 0.17 |
| … in the first measurement | 0.25 | 0.25 | 0 | 0.33 |
| Layout-check findings per diagram, `today` / one grid | 4.7 / 6.8 | 2.2 / 0.8 | 2.2 / 5.0 | 0.8 / 0.5 |

- **Sonnet: 10 of 24 judgements on the held-out prompts** (0.42, mean scores 6.25 against 6.08) after 6 of 24, but 6 of 24 on the dev prompts after 7 of 24: over all 24 prompts 16 of 48 after 13 of 48. With one run per prompt that is within what a repeat changes. Every held-out prompt was won or lost in both orders: five won (a cloud analytics platform, a three-tier application, an expense and a release process, a large refund flowchart), seven lost. No type passes the gate, which wants every prompt at 0.3.
- **Opus: 4 of 24, as before**, and it thinks about one grid as long as about its own: a median of 138 s for a swimlane diagram, 556 s and 57,262 output tokens for one of them.
- **Where it loses, it is the lines** (the judge's reasons on the dev prompts): tangled or long connectors, labels on each other or on a line, two branches merged onto one line; then a diagram cut off at the bottom. Where it wins, today's diagram was small in the frame and this one stayed readable.
- **The router is not the whole of it:** with the viewer's own router on the same placements (`render.mjs --routing viewer`) the dev prompts gave 5 of 24 instead of 6. The viewer reroutes most diagrams anyway: 21 of the 24 Sonnet placed as XML, because a line ran through a shape or a label, and 8 of the engine's 24. What a model does when it writes coordinates and doesn't when it names cells is leave room for the lines.
- **Cut off loses against small:** a lane diagram turned into columns and cut off before its last steps lost both orders with scores of 7 to 4; left in rows at a third of its size it lost with 7 to 6 and 8 to 7. So the pass turns lanes only when the result is shown whole. The judge sees one screenshot and can't drag the diagram, which a user can.
- **The frame is smaller than assumed:** the viewer's card leaves 736 × 664 px for a diagram, not 752 × 752, so diagrams the pass took to fit were cut off.

## Tests

`mcp-app-server/test/grid-layout.test.js` covers the grid pass on XML (placed diagrams left alone, sizes, hints, containers, lanes, the snake, routes around shapes) and the four types that use it (icons, nested frames, lanes, hints on and off, one grid for the page with its frames, strangers, lanes as bands and their turning, the description length for every way of offering hints, the schema). `mcp-app-server/test/semantic-er.test.js` (`npm test` there): reading fields and multiplicities, the rows a relation connects (two references to one table, a reference to its own table), leniency and warnings, determinism, the server's passes finding nothing to change, no crossings or overlaps for a chain and a star, the description length, and the ELK path when `elkjs` can be resolved (`NODE_PATH`, or `bench/node_modules`).
