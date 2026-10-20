# MCP Tool Server

The original draw.io MCP server. Opens diagrams directly in the draw.io editor via browser.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.js` | Single-file server (stdio transport, vanilla JS, no build step) |
| `src/libavoid-pass.js` | Server-side libavoid edge-routing pass for `open_drawio_xml` (`routing: "libavoid"`) — runs the routing core (`AvoidRouting.computeRoutes`) over each page's model through `mx-xml.js`'s `transformPages`, writes waypoints back. Covered by `test/libavoid-pass.test.js` |
| `src/elk-pass.js` | Server-side ELK layout pass for `open_drawio_xml` (`postLayout: "elk"`) — drives the drawio-elk `ElkLayout` bridge over the model `mx-xml.js` parses. Covered by `test/elk-pass.test.js` |
| `src/mx-model.js` | Copy of `shared/mx-model.js` (copy-shared): headless mxGraph model — cells, geometry, `getCellStyle`, the ancestry/reparenting methods (`updateEdgeParents`), `normalizeModel`, the `mxPoint`/`mxConstants`/`mxUtils` globals. The slice of mxGraph the drawio-elk bridge and the edge-parent normalization touch, so both run unchanged without a renderer |
| `src/mx-xml.js` | Copy of `shared/mx-xml.js` (copy-shared): mxGraphModel XML ↔ that model. `transformPages(xml, fn)` parses each page, hands the transform a graph, and writes back ONLY the cells it changed |
| `src/repair-xml.js` | Copy of `shared/repair-xml.js` (copy-shared): repairs the mechanical slips in LLM XML before anything parses it, and recovers pass options leaked into the XML string. Covered by `test/repair-xml.test.js` |
| `src/normalize-model.js` | Copy of `shared/normalize-model.js` (copy-shared): the model repairs, driven through `mx-xml.js`. Covered by `test/normalize-model.test.js` |
| `src/label-perimeter.js` | Copy of `shared/label-perimeter.js` (copy-shared): adds `labelPerimeter=1` to vertices with a label outside the shape on one side, so draw.io ends edges there at the label, and (`fitEdgeLabels`) the label gap to all edges and labeled edge label cells, `labelPlacement=auto` to labeled edges and, on straight horizontal edges, the label just above the line. Covered by `test/label-perimeter.test.js` |
| `src/elk-engine.js` | Loads + memoizes the drawio-elk bundle (CDN via `cdn-cache.js`, indirect `eval` into the globals) |
| `src/cdn-cache.js` | ETag-revalidated per-user disk cache for the three CDN sources (`ROUTING_CORE`, `ELK_BUNDLE`, `SHAPE_INDEX`), atomic single-artifact writes |
| `src/shape-index.js` | Loads the `search_shapes` index through `cdn-cache.js`; the JSON parse doubles as the cache validator |
| `src/mermaid-elk.js` | Copy of `shared/mermaid-elk.js` (copy-shared): the Mermaid ELK layout selector behind `open_drawio_mermaid`'s `postLayout`. Covered by `test/mermaid-elk.test.js` |
| `src/pages.js` | Local `.drawio` file page access for `list_pages`/`get_page`/`set_page` — regex-scans `<diagram>` blocks (same tag-boundary technique as `mx-xml.js`), decompresses/compresses per-page with `pako` as needed. Covered by `test/pages.test.js` (`npm test`) |
| `vendor/libavoid/` | Vendored libavoid-js **node** build + `libavoid.wasm` (see its README). Loaded by path in plain Node — no inlining/base64 (that's the app server's sandbox concern) |

## Tools

### `open_drawio_xml`

Opens draw.io with native XML content. Full control over styling and positioning.

**Repair** runs first, on the raw string (`shared/repair-xml.js`, `repairDiagramXml`). It fixes the mechanical slips that made every broken diagram in the LLM tests (see `get_drawio_reference` below): text around the diagram — mostly a leaked tool-call tag after it, `…</mxGraphModel></content>` — `<` or a stray `&` in an attribute value (an unescaped HTML label, "R&D", `&nbsp;`), and the default layer written as its own parent (`<mxCell id="1" parent="1"/>`, which hides the whole diagram). A model that leaks the tag usually leaks the next argument with it (`</content>\n<parameter name="postLayout">elk`); `leakedArguments` recovers `postLayout`, `direction` and `routing` from that text when the value is one the schema accepts and the argument wasn't passed for real, so the pass the model asked for still runs. A well-formed diagram passes byte-identical; markup too broken to scan safely is left as it was.

**Model normalization** runs on every call, before any other pass (`shared/normalize-model.js`, driving `MxGraph.normalizeModel` in `mx-model.js`). It repairs three mistakes generated XML carries, and nothing else:

1. **Edge parents.** An mxGraph edge belongs to the nearest common ancestor of its terminals; LLM XML parks every edge on the layer (`parent="1"`), which is what `shared/xml-reference.md` asks for and renders correctly — but lays out wrong, because ELK reads an edge's coordinates in the frame of the node containing it, so a connector between two cells inside one container escapes that container ([#64](https://github.com/jgraph/drawio-mcp/issues/64)). Fixed the way the editor's own model does it, `mxGraphModel.updateEdgeParents`, rather than making the layout rewrite the hierarchy as a side effect — which is exactly what a layout must not do.
2. **Edges written without a geometry**, which draw.io does not render at all, get the standard relative one.
3. **Containers that would clip a child** are grown to contain it — never shrunk, no child moved.

`MxGraph.normalizeModel` is a port of drawio-dev's `Graph.normalizeModel` (the desktop CLI's `--normalize`), so a diagram repaired here and one repaired by the CLI come out identical — verified cell for cell. Only the changed cells are rewritten; the pass is idempotent, needs no layout engine, and leaves a page it can't parse untouched.

**Edges and edge labels** then get the label gap (`defaultLabelBackgroundColor=page`, the _Page_ option in draw.io's Text tab, also on unlabeled edges for labels added later in draw.io, so the line stops at the text without a white box in draw.io after 32.5.5), and the label of a straight horizontal edge sits just above the line where it fits (`fitEdgeLabels`). **Labels outside the shape** get `labelPerimeter=1` right after the normalization (`shared/label-perimeter.js`): draw.io (after 32.5.5) then ends an edge that meets such a vertex on the label's side at the label's far edge, as on icons from its own sidebar. The headless libavoid pass has no rendered labels to route around, so it routes to the shape; the editor's perimeter still ends the last segment at the label.

**`postLayout: "elk"`** (optional, with `direction: "vertical"|"horizontal"`) runs a full ELK re-layout server-side before the URL is built — the same `ElkLayout` facade from the `drawio-elk` bundle that the editor's *Arrange ▸ Layout* menu and the app server's `postLayout` use, with the same canonical edge treatment (`ElkLayout.CANONICAL_EDGE`), so the result matches what the editor produces for the same diagram.

Since there is no renderer here, `src/mx-model.js` provides the headless mxGraph slice the bridge reads and writes (model traversal, geometry, `getCellStyle` incl. draw.io's named styles — `swimlane;…` must resolve to `shape=swimlane` or containers lose their title inset). `src/elk-pass.js` parses the XML, runs the layout per `<mxGraphModel>` page, and rewrites only the cells the layout changed; everything else stays byte-identical. Node **sizes are pinned** (`applierOptions.resizeParent: false`, as on the app server): with nothing to measure label text against, the authored width/height stay authoritative and ELK lays out with them.

The ~900 KB bundle is not vendored — `src/elk-engine.js` pulls it from `viewer.diagrams.net` through `src/cdn-cache.js` on first use (`DRAWIO_ELK_URL` overrides the source with a local build for testing an unreleased drawio-elk). Fails loudly, unlike routing: if the bundle can't be loaded the tool result says the layout didn't run, since an unlaid-out diagram is exactly what the caller asked to avoid. A parse problem still fails safe (the page comes back as authored).

**`routing: "libavoid"`** (optional) runs an obstacle-avoiding orthogonal edge-routing pass server-side before the URL is built: vertices stay put, connectors are recomputed to route *around* shapes in clean right angles (draw.io's built-in router has no obstacle avoidance). The routing math is `AvoidRouting.computeRoutes` from the vendored `vendor/libavoid/libavoid-routing.js` — a verbatim copy of the canonical `drawio-dev js/libavoid-js/libavoid-routing.js`, identical to the app server's and the draw.io editor's. Like the other passes it runs through `mx-xml.js`'s `transformPages`, one `<mxGraphModel>` page at a time: cell ids and obstacles never cross pages ([#73](https://github.com/jgraph/drawio-mcp/pull/73) — two pages reusing ids used to get each other's routes, and a shape on one page used to be an obstacle on another), `<object>`/`<UserObject>`-wrapped cells route like plain ones, and only the routed edges are rewritten. Cells are collected in `mxGraphModel.cells` order, as in the editor and the app server, since libavoid's nudging depends on registration order. Routes also depend on heap ADDRESSES (libavoid breaks coordinate ties by object address), so the core must leave the long-lived wasm heap exactly as it found it — this build's `displayRoute()`/`at()` return owned copies the core frees, and a leak there made the same page route differently from call to call (covered by the "whatever the process routed before" test). Edges attached to the same connection point share one libavoid pin (two pins at one point leave the second connector unrouted); a connector libavoid finds no route for is retried alone at half the clearance, down to 2 px; and one that stays unroutable gets no entry, so its authored waypoints and style are left alone instead of being replaced by libavoid's straight-line fallback (all three covered under "Unroutable connectors" in the test). Rotated, turned (`direction`) and flipped shapes are routed as drawn: each vertex passes its style's transform (`AvoidRouting.shapeFrame`, named styles resolved by `getCellStyle`) and the core routes around the rotated box and pins each end where draw.io draws its connection point, `exitPerimeter`/`entryPerimeter` included (covered under "Rotated shapes"). A CDN core from before rotation support has no `shapeFrame`; shapes then route unrotated, as before. Legacy `stencilFlipH/V` is ignored here (only a renderer knows whether a shape is a stencil). Fails safe — any parse/route issue leaves that page unrouted.

### `open_drawio_csv`

Opens draw.io with CSV data converted to a diagram. Useful for org charts, but CSV processing can fail — prefer Mermaid when possible.

**Avoid** using `%column%` placeholders in style attributes (like `fillColor=%color%`) — causes "URI malformed" errors.

### `open_drawio_mermaid`

Opens draw.io with Mermaid.js syntax. **Recommended default** — handles flowcharts, sequences, ER diagrams, Gantt charts, and more reliably.

**`postLayout: "elk"`** (optional) switches a Mermaid **flowchart** to the layered ELK layout. Nothing is computed here: selecting ELK is a text transform on the source (`withElkLayout` from `shared/mermaid-elk.js` writes the `config: { layout: elk }` frontmatter), and draw.io runs the layout itself when it converts the Mermaid behind the `#create=` URL (drawio-mermaid lays ELK flowcharts out with Mermaid's own ELK options; older draw.io builds re-run their ElkLayout via `EditorUi.isMermaidElkFlowchart` / `applyMermaidElkPostPass`).

**Mermaid defaults version.** `#create=` links of type `mermaid` carry `version: "12"` (`MERMAID_DEFAULTS_VERSION`): draw.io converts them with Mermaid 12's defaults (ELK layout, `redux-color` theme, `neo` look for flowchart, class, state, ER, requirement, sequence, swimlane, venn, use case and agent flow) and stores the version in the diagram, so it keeps that look on later edits. It matches the app server's `MERMAID_DEFAULTS_VERSION`; older draw.io builds ignore it. Non-flowchart types are left alone and the tool result says so (type detection is `mermaidDiagramType`, a verbatim port of drawio-dev's `getMermaidDiagramType`).

### `get_drawio_reference`

Returns `shared/xml-reference.md` (`format: "xml"`) or `shared/mermaid-reference.md` (`format: "mermaid"`) verbatim. `open_drawio_mermaid` asks the model to call it once before its first Mermaid diagram. `open_drawio_xml` doesn't need it for most diagrams: its description inlines `shared/xml-essentials.md`, the condensed XML reference (tool-neutral — the server appends its own `search_shapes` and `postLayout` / `routing` lines, and leaves `defaultLabelBackgroundColor=page` out of the edge template, as `fitEdgeLabels` adds it to every edge), and points here only for layers, tags, metadata and placeholders, tables, cross-functional grids and dark-mode colors.

The references used to be appended to those two descriptions, which made them ~35k / 14k characters (the XML one ~16k tokens). Clients index descriptions: VS Code Copilot embeds them in batches for its tool search, and one description over the embedding limit fails the whole batch, so no tool in it can be found, other servers' tools included ([#76](https://github.com/jgraph/drawio-mcp/issues/76)). `test/tools.test.js` runs the server over stdio, fails if any tool description exceeds 2048 characters, and checks that `open_drawio_xml` carries the essentials verbatim.

**Why the essentials, and why inline.** The size was chosen with LLM tests: Claude Haiku, Sonnet and Opus drew six XML tasks (AWS architecture with a VPC, a cross-functional swimlane, an XML flowchart, an office network, a mobile wireframe, microservices with HTML labels and a legend) through this server's real tool schemas with different `open_drawio_xml` descriptions. The 474 runs were scored by a checker (validity, overlaps, label overflow, containment, layout and routing use) and by a blind Opus judge grading a rendering. Findings:

- The judge's overall grade barely moved with description size: 35 tokens, the ~900-token essentials and the full ~16k-token reference all averaged about 6/10. The models already know draw.io XML.
- The structural, server-specific parts did depend on guidance. With a one-line description, nodes ended up inside their swimlanes in 14% of runs, the XML flowchart used `postLayout: "elk"` in 57%, and Lambdas were nested in the VPC in 71%. The essentials reached 100% on all three, and the full reference inlined 82–100% (its key rules sit deep in 34k characters).
- When a description pointed at `get_drawio_reference`, the models fetched it 88–100% of the time. That roughly doubled the cost per diagram on Sonnet and Opus (the reference stays in context for every later turn) without a measurable quality gain, so the XML pointer is limited to the topics the essentials leave out.
- All 15 broken diagrams (3%) were mechanical slips, whatever the description: a leaked `</content>` after the XML (8), the layer written as `<mxCell id="1" parent="1"/>` (6), an unescaped HTML label (1). The repair step fixes all 15 and leaves the other 458 byte-identical. Re-scored with it, the essentials and the full reference both reach 100% valid XML with the same judge grade (6.1/10).

### `search_shapes`

Searches the draw.io shape library (~10,000 shapes) by keywords and returns matching shapes with their exact `style` strings, dimensions, and titles — for feeding industry-specific icons (AWS, Azure, GCP, Cisco, Kubernetes, P&ID, electrical, BPMN) into `open_drawio_xml`. The algorithm is the shared `buildTagMap`/`searchShapes` (canonical in `shared/shape-search.js`, copied into `src/` by `copy-shared`), identical to the app server's.

When the local index has no strong match for a query (no result exact-matched every term), results are supplemented live from the draw.io icon service (`icons.diagrams.net` — brand logos and general-purpose concept icons, returned as `shape=image` styles referencing the remote SVG). The merge pipeline is `searchShapesAndIcons` (canonical in `shared/icon-search.js`, also copied by `copy-shared`; covered by `test/icon-search.test.js`): strong local results lead and icons only fill spare slots; weak (Soundex/OR-fallback) local results keep at most half the budget. A full page of strong local results makes no network request; a service failure degrades to local-only results. Override the endpoint with `DRAWIO_ICON_SERVICE_URL` (a self-hosted service base URL, or `off` to disable icon supplementation).

To keep the npm package lean, the ~4.6 MB `search-index.json` is **not** bundled. It is loaded lazily on the **first** `search_shapes` call and cached in memory for the process lifetime; the tag lookup map is built once at that point. An in-repo checkout reads the local `shape-search/search-index.json` (so dev and tests need no network); a published install fetches it from the CDN (`https://cdn.jsdelivr.net/gh/jgraph/drawio-mcp@main/shape-search/search-index.json`) through the same ETag-revalidated per-user disk cache as the ELK bundle (`SHAPE_INDEX` in `src/cdn-cache.js`, loaded by `src/shape-index.js`, covered by `test/shape-index.test.js`): the first call downloads it (~400 KB brotli on the wire, 20 s timeout), later process starts revalidate with `If-None-Match`, and an unreachable CDN or a truncated download falls back to the last cached copy. `DRAWIO_SHAPE_INDEX_URL` overrides the source with another http(s) URL (cached too) or a local file path (read straight off disk, never cached). The tool is always advertised; if the index can't be loaded, the call returns a clear error instead of the tool being hidden.

### `list_pages` / `get_page` / `set_page`

Local-file, page-level access for large multi-page `.drawio` files, so an LLM doesn't have to load the whole file into context to inspect or edit one page.

- **`list_pages(path)`** — returns `[{index, id, name, approxSizeBytes}]` for every `<diagram>` in the file. Regex-scans tag boundaries only; never decompresses page bodies, so it stays cheap even for large files.
- **`get_page(path, page)`** — returns the raw `mxGraphModel` XML for one page (`page` is a zero-based index, the page's exact `name`, or its `id`), decompressing it first if that page is stored compressed.
- **`set_page(path, page, content)`** — replaces one page's content with new `mxGraphModel` XML (`content`), re-compressing to match that page's original compression state. Every other page, and the rest of the file, is left byte-for-byte untouched.

Draw.io stores each `<diagram>` body as either plain `mxGraphModel` XML or a base64(`pako.deflateRaw`) blob, independently per page — `src/pages.js` detects which per page (body starts with `<` vs. not) rather than trusting the outer `<mxfile compressed="...">` attribute, since files can mix compression states across pages. Duplicate page names are resolved by erroring with the ambiguous indices rather than guessing (use the index or `id` instead; a page whose name is all digits is parsed as an index, so address it by `id`).

These are the only tools whose arguments touch the local filesystem, so they are deliberately constrained: paths must end in `.drawio` or `.xml` (checked before existence, so arbitrary paths aren't probed); `set_page` content must be a single `<mxGraphModel>` element and is rejected if it contains raw `<diagram>` tags (which would escape the page body and rewrite the file's page structure); decompression is capped at 64 MB against deflate bombs; writes go through a temp file + rename so a crash can't truncate the target. Self-closing `<diagram/>` pages (empty pages) are handled on both read and write.

## URL Generation

1. Content is encoded with `encodeURIComponent`
2. Compressed using pako `deflateRaw`
3. Encoded as base64
4. XML: appended to the draw.io URL as `#R` + the percent-encoded base64
5. Mermaid and CSV: wrapped in a JSON object, `{ type, compressed: true, data }` (Mermaid adds `version`), and appended as `#create={...}`

XML uses `#R` because draw.io rewrites a `#create` hash after loading it, and when the rewrite differs from the link it loads the link again and asks "All changes will be lost!". A host that re-encodes the link on the way to the browser makes them differ: VS Code opens links as `encodeURI(uri.toString(true))`. draw.io never rewrites a `#R` hash. Mermaid and CSV need `#create`, since draw.io converts them in the browser, and the converted diagram never matches the link: in draw.io 32.4.1 every Mermaid link shows that dialog, even opened directly. The fix for that is in draw.io (drawio-dev, after 32.4.5): `executeCreateObject` stores the hash it rewrites to on the created file, and the `hashchange` handler doesn't load that hash again.

## Quick Decision Guide

| Need | Use | Reliability |
|------|-----|-------------|
| Flowchart, sequence, ER diagram | `open_drawio_mermaid` | High |
| Custom styling, precise positioning | `open_drawio_xml` | High |
| Org chart from data | `open_drawio_csv` | Medium |

## XML Reference

`get_drawio_reference` serves `shared/xml-reference.md` and `shared/mermaid-reference.md` (single source of truth for all prompts), and `open_drawio_xml` inlines `shared/xml-essentials.md`; all three are read once at startup. The `copy-shared` script (run on `prestart` and `prepack`) copies them — plus `shared/repair-xml.js`, `shared/shape-search.js`, `shared/icon-search.js`, `shared/mermaid-elk.js`, `shared/mx-model.js`, `shared/mx-xml.js`, `shared/normalize-model.js` and `shared/label-perimeter.js` — into `src/` so the npm package is self-contained. These copies are gitignored; the `search_shapes` loader imports the helper from the local copy with a fallback to `../../shared/` for in-repo runs. (The two CDN sources are NOT part of copy-shared: the libavoid routing core and the drawio-elk bundle come from `viewer.diagrams.net` through the per-user cache in `src/cdn-cache.js`, with `vendor/libavoid/libavoid-routing.js` as the routing core's last-resort fallback. The ~4.6 MB `search-index.json` is deliberately **not** copied/bundled — it is fetched at runtime; see `search_shapes` above.)

## Coding Conventions

- **Allman brace style**: Opening braces go on their own line for all control structures, functions, objects, and callbacks.
- Prefer `function()` expressions over arrow functions for callbacks.
- See the root `AGENTS.md` for examples.

## Development

```bash
npm install
npm start
```

Published as `@drawio/mcp` on npm. Run with `npx @drawio/mcp`.

## Releasing

Bump `version` in `package.json`, commit, then run the **Publish Tool Server** workflow (`.github/workflows/publish-tool-server.yml`) — `gh workflow run publish-tool-server.yml`, or with `-f dry_run=true` to pack and verify without publishing. It runs the tests, refuses a version that is already on the registry, and publishes through **npm Trusted Publishing**: the registry trusts the workflow's OIDC identity, so there is no npm token in the repo or on a laptop, nothing expires, no 2FA prompt, and npm attaches a provenance attestation automatically.

This matters beyond convenience: the account's 2FA is `auth-and-writes`, so a local `npm publish` demands an OTP (recovery codes are rejected for writes), and npm is removing direct-publish access from granular tokens in January 2027.

The trust is registered on npmjs.com (Package settings → Publishing access → Trusted publisher) against the repository **and the workflow filename** — renaming `publish-tool-server.yml` breaks publishing until it is updated there too.
