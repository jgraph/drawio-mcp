# libavoid (app server) — loaded from the CDN

Obstacle-avoiding orthogonal **edge routing** (the `routing: "libavoid"`
pass). Since the draw.io release that ships `js/libavoid-js/` on
`viewer.diagrams.net`, the viewer HTML loads libavoid from the CDN like
drawio-elk and drawio-mermaid — nothing is vendored here anymore:

```html
<script src="https://viewer.diagrams.net/js/libavoid-js/libavoid.min.js"></script>
<script src="https://viewer.diagrams.net/js/libavoid-js/libavoid-wasm.js"></script>
<script src="https://viewer.diagrams.net/js/libavoid-js/libavoid-loader.js"></script>
<script src="https://viewer.diagrams.net/js/libavoid-js/libavoid-routing.js"></script>
```

(glue → base64 wasm payload → loader → shared routing core; see
`buildHtml`'s `libavoidBlock` in `src/shared.js`). The wasm rides as base64
inside `libavoid-wasm.js` and is decoded by the loader — still **no
`fetch`**, so the sandboxed iframe (no `allow-same-origin`, no `data:` in
`connect-src`) is satisfied by plain `script-src`. The loader parks
`window.__libavoidReady` (resolves to the `Avoid` namespace, or `null` on
failure); the routing core defines `globalThis.AvoidRouting` — the same
canonical artifact the draw.io editor bundles into `extensions.min.js` and
the mcp-tool-server vendors (`mcp-tool-server/vendor/libavoid/`, which stays
vendored: it runs server-side in Node and ships in the npm package).

`buildHtml` still supports inlining a local build instead (pass
`options.libavoidJs` — a `processLibavoidBundle`-processed glue with
`libavoid-routing.js` appended — plus `options.libavoidWasmB64`), e.g. for
testing unreleased libavoid changes.

Remaining files:

- `libavoid.d.ts` — TypeScript typings for the `Avoid` API
  (`Router`, `ShapeRef`, `ConnRef`, `ConnEnd`, `Rectangle`, `Point`,
  `displayRoute()`, `processTransaction()`, routing parameters/options) —
  kept as a dev reference for the viewer-side routing code in `shared.js`.
- `LICENSE` — libavoid-js is LGPL-2.1-or-later (kept for reference; the
  binaries are served by the CDN, not shipped from this repo).

> ⚠️ WebAssembly must instantiate inside the Claude.ai MCP-app iframe,
> which requires the host CSP to allow wasm compilation
> (`'wasm-unsafe-eval'`) and `viewer.diagrams.net` in `script-src` (the
> same allowance drawio-elk/drawio-mermaid already rely on).
