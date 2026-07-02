# MCP Tool Server

The original draw.io MCP server. Opens diagrams directly in the draw.io editor via browser.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.js` | Single-file server (stdio transport, vanilla JS, no build step) |
| `src/libavoid-pass.js` | Server-side libavoid edge-routing pass for `open_drawio_xml` (`routing: "libavoid"`) — parses the mxGraphModel XML, runs the vendored routing core (`AvoidRouting.computeRoutes`), writes waypoints back |
| `vendor/libavoid/` | Vendored libavoid-js **node** build + `libavoid.wasm` (see its README). Loaded by path in plain Node — no inlining/base64 (that's the app server's sandbox concern) |

## Tools

### `open_drawio_xml`

Opens draw.io with native XML content. Full control over styling and positioning.

**`routing: "libavoid"`** (optional) runs an obstacle-avoiding orthogonal edge-routing pass server-side before the URL is built: vertices stay put, connectors are recomputed to route *around* shapes in clean right angles (draw.io's built-in router has no obstacle avoidance). The routing math is `AvoidRouting.computeRoutes` from the vendored `vendor/libavoid/libavoid-routing.js` — a verbatim copy of the canonical `drawio-dev js/libavoid-js/libavoid-routing.js`, identical to the app server's and the draw.io editor's. Fails safe — any parse/route issue returns the original XML unrouted.

### `open_drawio_csv`

Opens draw.io with CSV data converted to a diagram. Useful for org charts, but CSV processing can fail — prefer Mermaid when possible.

**Avoid** using `%column%` placeholders in style attributes (like `fillColor=%color%`) — causes "URI malformed" errors.

### `open_drawio_mermaid`

Opens draw.io with Mermaid.js syntax. **Recommended default** — handles flowcharts, sequences, ER diagrams, Gantt charts, and more reliably.

### `search_shapes`

Searches the draw.io shape library (~10,000 shapes) by keywords and returns matching shapes with their exact `style` strings, dimensions, and titles — for feeding industry-specific icons (AWS, Azure, GCP, Cisco, Kubernetes, P&ID, electrical, BPMN) into `open_drawio_xml`. The algorithm is the shared `buildTagMap`/`searchShapes` (canonical in `shared/shape-search.js`, copied into `src/` by `copy-shared`), identical to the app server's.

To keep the npm package lean, the ~4.6 MB `search-index.json` is **not** bundled. It is loaded lazily on the **first** `search_shapes` call and cached in memory for the process lifetime; the tag lookup map is built once at that point. An in-repo checkout reads the local `shape-search/search-index.json` (so dev and tests need no network); a published install fetches it from the CDN (`https://cdn.jsdelivr.net/gh/jgraph/drawio-mcp@main/shape-search/search-index.json`, overridable via `DRAWIO_SHAPE_INDEX_URL`). The tool is always advertised; if the index can't be loaded, the call returns a clear error instead of the tool being hidden.

## URL Generation

1. Content is encoded with `encodeURIComponent`
2. Compressed using pako `deflateRaw`
3. Encoded as base64
4. Wrapped in a JSON object: `{ type, compressed: true, data }`
5. Appended to the draw.io URL as `#create={...}`

## Quick Decision Guide

| Need | Use | Reliability |
|------|-----|-------------|
| Flowchart, sequence, ER diagram | `open_drawio_mermaid` | High |
| Custom styling, precise positioning | `open_drawio_xml` | High |
| Org chart from data | `open_drawio_csv` | Medium |

## XML Reference

The `open_drawio_xml` tool description is loaded at startup from `shared/xml-reference.md` (single source of truth for all prompts). The `copy-shared` script (run on `prestart` and `prepack`) copies it — plus `shared/mermaid-reference.md` and `shared/shape-search.js` — into `src/` so the npm package is self-contained. These copies are gitignored; the `search_shapes` loader imports the helper from the local copy with a fallback to `../../shared/` for in-repo runs. (The libavoid routing core is NOT part of copy-shared — it lives in `vendor/libavoid/libavoid-routing.js`, synced from drawio-dev. The ~4.6 MB `search-index.json` is deliberately **not** copied/bundled — it is fetched at runtime; see `search_shapes` above.)

## Coding Conventions

- **Allman brace style**: Opening braces go on their own line for all control structures, functions, objects, and callbacks.
- Prefer `function()` expressions over arrow functions for callbacks.
- See the root `CLAUDE.md` for examples.

## Development

```bash
npm install
npm start
```

Published as `@drawio/mcp` on npm. Run with `npx @drawio/mcp`.
