# libavoid Vendor (tool server)

Obstacle-avoiding orthogonal **edge routing** for the `routing: "libavoid"`
option on `open_drawio_xml`. Vendored from [`libavoid-js`](https://github.com/Aksem/libavoid-js).

Unlike the app server (which inlines the *browser* build + base64 wasm into a
sandboxed iframe), the tool server runs in plain Node, so we vendor the **node
build** and let it read the wasm from disk — no patching, no base64.

Artifacts:

- `libavoid-node.mjs` — the Node ESM build (`libavoid-js` `dist/index-node.mjs`).
  Exposes `AvoidLib.load(wasmPath)` / `AvoidLib.getInstance()`. It reads the
  wasm via `fs.readFileSync` (no fetch).
- `libavoid.wasm` — the Emscripten binary (~492 KB). Loaded by path:
  `await AvoidLib.load(join(__dirname, "vendor/libavoid/libavoid.wasm"))`.
- `libavoid-routing.js` — the shared routing core (`globalThis.AvoidRouting`:
  `computeRoutes` incl. fixed-connection-point pins and jettySize stub
  checkpoints, plus the pure geometry helpers). **Verbatim copy** — the
  canonical source is `drawio-dev src/main/webapp/js/libavoid-js/
  libavoid-routing.js` (the same artifact the draw.io editor bundles and the
  app server loads from the CDN); copy it over when it changes there. At
  runtime `libavoid-pass.js` loads the CURRENT core through an
  ETag-revalidated per-user disk cache (`src/routing-core-cache.js`, primed
  by npm postinstall, revalidated against
  `https://viewer.diagrams.net/js/libavoid-js/libavoid-routing.js` once per
  process — a 304 unless a draw.io release changed it), so routing fixes
  ship here automatically. This copy is the last fallback — CDN unreachable
  with a cold cache, path not yet in a release, or the source failing the
  sanity check.
- `libavoid.d.ts` — TypeScript typings.
- `LICENSE` — libavoid-js is LGPL-2.1-or-later.

## Usage

```js
import { AvoidLib } from "./vendor/libavoid/libavoid-node.mjs";
// Plain browser script that assigns globalThis.AvoidRouting — a script
// without import/export is valid ESM, so import it for its side effect:
await import("./vendor/libavoid/libavoid-routing.js");
await AvoidLib.load(join(__dirname, "vendor", "libavoid", "libavoid.wasm"));
const Avoid = AvoidLib.getInstance();
const routes = globalThis.AvoidRouting.computeRoutes(Avoid, vertices, edges); // edgeId -> waypoints
```

## Versioning

Vendored from `libavoid-js@0.5.0-beta.5`.

## Refreshing

```sh
npm pack libavoid-js && tar -xzf libavoid-js-*.tgz
cp package/dist/index-node.mjs  vendor/libavoid/libavoid-node.mjs
cp package/dist/libavoid.wasm   vendor/libavoid/libavoid.wasm
cp package/dist/index-node.d.ts vendor/libavoid/libavoid.d.ts
cp package/LICENSE              vendor/libavoid/LICENSE
```

`libavoid-routing.js` is NOT part of the upstream package — refresh it from
drawio-dev (`cp ../drawio-dev/src/main/webapp/js/libavoid-js/libavoid-routing.js
vendor/libavoid/`).
