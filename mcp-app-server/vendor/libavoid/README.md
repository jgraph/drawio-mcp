# libavoid Vendor

Obstacle-avoiding orthogonal **edge routing** (the `routing: "libavoid"`
pass), vendored from the upstream [`libavoid-js`](https://github.com/Aksem/libavoid-js)
npm package. Unlike drawio-elk (which both *places* nodes and routes
edges), libavoid never moves a vertex — it only computes edge paths that
route around the vertices as obstacles. (drawio-elk and drawio-mermaid load
from the `viewer.diagrams.net` CDN; libavoid stays vendored because WASM
can't be a plain CDN `<script src>`.)

Artifacts:

- `libavoid.min.js` — the browser glue (`libavoid-js` `dist/index.js`).
  Ships as ESM (`export { … as AvoidLib }`) and uses `import.meta.url`.
  `processLibavoidBundle` in `shared.js` neutralizes `import.meta.url`,
  patches the loader to accept an inlined `wasmBinary`, then strips the
  export and aliases `globalThis.AvoidLib`.
- `libavoid.wasm` — the Emscripten WebAssembly binary (~492 KB). There is
  **no** SINGLE_FILE build, so the wasm is a separate artifact. It is
  base64-inlined into the HTML and handed to the Emscripten module as
  `Module.wasmBinary` (a `Uint8Array`), so the router instantiates with
  **no `fetch`** — the sandboxed iframe has no `allow-same-origin` and the
  host CSP's `connect-src` doesn't permit `data:` URIs.
- `libavoid-routing.js` — the shared routing core (`globalThis.AvoidRouting`:
  `computeRoutes` incl. fixed-connection-point pins and jettySize stub
  checkpoints, plus the pure geometry helpers). Appended to the processed glue
  and inlined with it (`build-html.js` / `index.js`). **Verbatim copy** — the
  canonical source is `drawio-dev src/main/webapp/js/libavoid-js/
  libavoid-routing.js` (the same artifact the draw.io editor bundles and the
  tool server imports); copy it over when it changes there.
- `libavoid.d.ts` — TypeScript typings for the `Avoid` API
  (`Router`, `ShapeRef`, `ConnRef`, `ConnEnd`, `Rectangle`, `Point`,
  `displayRoute()`, `processTransaction()`, routing parameters/options).
- `LICENSE` — libavoid-js is LGPL-2.1-or-later.

## Browser API

```js
await AvoidLib.load();               // wasmBinary is injected by the loader
var Avoid = AvoidLib.getInstance();
var router = new Avoid.Router(Avoid.OrthogonalRouting);
new Avoid.ShapeRef(router, new Avoid.Rectangle(topLeft, bottomRight)); // obstacle per vertex
var conn = new Avoid.ConnRef(router, srcConnEnd, dstConnEnd);          // one per edge
router.processTransaction();
var route = conn.displayRoute();     // PolyLine: route.size(), route.at(i).{x,y}
```

> ⚠️ WebAssembly must instantiate inside the Claude.ai MCP-app iframe,
> which requires the host CSP to allow wasm compilation
> (`'wasm-unsafe-eval'`). This works locally (no CSP) but must be
> confirmed on staging in the real sandbox.

## Versioning

Vendored from `libavoid-js@0.5.0-beta.5`. The package has no version
banner in the dist, so the version is recorded here.

## Refreshing

```sh
npm pack libavoid-js
tar -xzf libavoid-js-*.tgz
cp package/dist/index.js   vendor/libavoid/libavoid.min.js
cp package/dist/libavoid.wasm vendor/libavoid/libavoid.wasm
cp package/typings/libavoid.d.ts vendor/libavoid/libavoid.d.ts
cp package/LICENSE         vendor/libavoid/LICENSE
```

Then update the version recorded above.
