# Semantic diagrams

The model describes what a diagram contains (nodes, groups, edges, a direction, see `FORMAT.md`) and never where anything goes or how it looks; this engine turns the description into draw.io XML. Placing every shape itself is where a model spends most of its time on a diagram: in the bench (`bench/`), Sonnet took about 50 s to an ER diagram as XML and about 6 s as a description, Opus 228 s and 12 s, and the engine takes 15 to 70 ms.

Not wired into a server yet, so nothing is offered to models: `bench/semantic-server.mjs` offers it as a tool for the measurements. The servers will offer it as a tool of its own, `create_semantic_diagram`, next to `create_diagram` rather than as a third parameter of it (its own description, within the 2048 characters, lists only the types switched on). A type is switched on only once a blind judgement of the rendered images rates its layouts at least equal to the model placing the XML itself (`bench/README.md`).

## Rules

- **Headless and deterministic.** No DOM, no `fetch`, no timers, no randomness: the same description gives the same XML byte for byte, in the Cloudflare Worker, in Node (both servers, the skill's scripts) and in the browser. Text is measured with Helvetica's widths (`text-width.js`), which is what the viewer falls back to.
- **Own code or public packages.** Everything here is written for this engine or comes from a public npm package. What the layouts need beyond that (a lane layout, text measurement with line wrapping, icons by name, scoring layouts) is written here too. ELK is optional and passed in (`options.elk`, `new ELK()` from elkjs or the browser's global), never imported, so each host brings its own copy. The Cloudflare Worker passes none for now (no elkjs in its bundle), so there ER schemas above 16 tables go on the grid as well.
- **The look of `shared/chat-view-xml.md`.** Each layout follows the pattern that file asks models for, in the calm theme (`theme.js`, the colors of the "Calm" theme in `shared/xml-reference.md`), so a diagram drawn from a description and one the model places look the same. When a pattern changes there, change it here too.
- **Leniency with warnings.** `spec.js` reads what models get wrong (a JSON string, `source`/`target`, any case, field lists as one string) and drops what can't be drawn with a warning instead of failing the call.
- **XML stays the way out.** The engine's output is plain draw.io XML that goes through the server's usual passes (repair, normalization, waypoint snapping, label perimeters) without them finding anything to change; ids follow the description (`table.field` for rows, `child-parent` for relations).

## Files

| File | Purpose |
|------|---------|
| `index.js` | `semanticToXml(input, {elk})` → `{xml, error, warnings, stats}`, and `SUPPORTED_TYPES` (the types with a layout) |
| `spec.js` | `normalizeSpec`: reads a description into one shape (`TYPES`, aliases, warnings) |
| `description.js` | `describeTool(types)`: the tool description for the switched-on types (each server caps descriptions at 2048 characters) |
| `er.js` | ER schemas: fields (`parseField`), relations from foreign-key rows to primary-key rows (`resolveRelations`), table sizes, grid or ELK layout, the cells |
| `grid.js` | Grid placement (`placeOnGrid`: link costs, swaps from three deterministic starts, an optional refinement on routed results) and channel routing (`routeGrid`: one track per link in the gutters between columns and the gaps between rows, track order searched for the fewest crossings) |
| `theme.js` | Calm colors by role, edge colors, font sizes by shape count |
| `text-width.js` | Helvetica advance widths for headless text measurement |
| `xml-writer.js` | Escaping, html labels, unique ids, `writeModel(cells)` |
| `FORMAT.md` | The format, for every planned type |

## ER layout

Up to 16 tables go on a grid of two to four columns (`gridGeometry` in `er.js`). Each column count is placed (`placeOnGrid` with `linkCost`: a link between neighbouring columns in one row costs nothing and 0.8 per row apart, one in the same column needs a C-shaped route, one across a column costs most) and routed (`routeGrid`), and the result with the lowest badness is kept: link cost, crossings ×3, collinear overlaps ×4, bends ×0.1, the lines' length per 250 px and how much the diagram would have to shrink to fit the 800 × 800 chat frame ×40. A relation whose rows are within half a row of each other is drawn straight. Relations that end on the same row (several tables referencing one key) get their own points on it, 10 px apart and ordered by where they come from, so no two share a stub or a track. Larger schemas use ELK's layered algorithm (`elkGeometry`) with fixed ports at the row centres when an ELK instance is passed in, and the grid otherwise. Above 16 tables the grid is placed by the link costs alone: the refinement routes the whole grid for every swap it tries, which took 40 s for 50 tables; without it they take about 0.1 s, and 100 tables 0.3 s. The search by link costs sums only the two swapped boxes' links for each swap (`improveByLinks`), with the same result as summing all of them.

How the layouts compare with the XML models place themselves is measured with `bench/` (blind judgement of the rendered images). What the judge asked for so far: related tables side by side in one row, few crossings, short lines, and no relations sharing a line. A first version laid every schema out with ELK's layered algorithm (one tall column of layers, the relations bundled in narrow gaps) and lost every comparison; the grid, the separate points per relation and the weights above came from those judgements. In November 2026 the grid tied with the schemas Sonnet placed as XML (9 of 18 judgements on three prompts, mean score 6.9 against 6.6) and still lost to the one Opus placed (2 of 2).

## Tests

`mcp-app-server/test/semantic-er.test.js` (`npm test` there): reading fields and multiplicities (crow's-foot words, `(min,max)`, a warning for one it can't read), the rows a relation connects (two references to one table, a reference to its own table, the direction from a named row), types and notes in parentheses, leniency and warnings, determinism, the server's passes finding nothing to change, no crossings or overlaps for a chain and a star, the description length, a large schema on the grid in bounded time, and the ELK path when `elkjs` can be resolved (`NODE_PATH`, or `bench/node_modules`).
