# MCP App Server

Renders draw.io diagrams inline in AI chat interfaces using the MCP Apps protocol.

## Key Files

| File | Purpose |
|------|---------|
| `src/shared.js` | Shared logic: `buildHtml()`, `processAppBundle()`, `createServer()` |
| `src/index.js` | Node.js entry (Express + stdio transports) |
| `src/worker.js` | Cloudflare Workers entry (Web Standard fetch handler) |
| `src/build-html.js` | Build script: generates `generated-html.js` for the Worker |
| `server.json` | MCP Community Registry manifest (`io.draw/mcp`, remote `https://mcp.draw.io/mcp`) — publish runbook in README "Publishing to the MCP Registry"; keep `version` in lockstep with `package.json` |
| `openai-plugin/` | OpenAI Plugins Directory package (`.codex-plugin/plugin.json`: names, descriptions, starter prompts, policy URLs, icon; `.mcp.json`: the server, which can never change on an existing plugin) — zipped and uploaded as a new version in the portal; its own `version`, runbook in `OPENAI-SUBMISSION.md` |

## Architecture

### How the HTML is built

At startup (Node.js) or build time (Workers), the HTML is assembled. The draw.io **viewer**, **drawio-elk**, and **drawio-mermaid** load from the `viewer.diagrams.net` CDN via `<script src>` — they're large, cached cross-session by the browser, and stay version-synced with each draw.io release (same host + release cadence as the viewer). The remaining bundles are inlined so the sandboxed iframe needs no further fetches for them:

- **`app-with-deps.js`** (~319 KB, from `node_modules/@modelcontextprotocol/ext-apps`) — MCP Apps SDK browser bundle. The bundle is ESM (ends with `export { ... as App }`), so `processAppBundle()` strips the export statement and creates a local `var App = <minifiedName>` alias. This makes it safe to inline in a plain `<script>` tag inside the sandboxed iframe.
- **`pako_deflate.min.js`** (~28 KB, from `node_modules/pako`) — for compressing XML into the `#create=` URL format.
- **libavoid** (the obstacle-avoiding orthogonal edge router behind `routing: "libavoid"`) is **not vendored/inlined** — the HTML loads the pure-JS router bundle (`libavoid.min.js`, a self-contained classic script that publishes `globalThis.Avoid` and parks `window.__libavoidReady` synchronously — no WASM, no fetch, no `wasm-unsafe-eval` needed) + shared routing core from the `viewer.diagrams.net` CDN (`js/libavoid-js/`), like drawio-elk and drawio-mermaid. Requires the draw.io release that ships the pure-JS two-file layout there. The routing math is `AvoidRouting.computeRoutes` from `libavoid-routing.js` — the canonical `drawio-dev js/libavoid-js/` artifact, byte-identical to what the draw.io editor bundles and the mcp-tool-server vendors. `buildHtml` accepts `options.libavoidJs` to inline a local build instead (dev). See `vendor/libavoid/README.md`. `routeWithLibavoid` passes each vertex's style transform (`libavoidShapeFrame` → `AvoidRouting.shapeFrame`: rotation, direction, flips) and each pin's `exitPerimeter`/`entryPerimeter`, so rotated shapes are routed as drawn; against a CDN core from before rotation support (no `shapeFrame`) it routes them unrotated, as before.

Loaded from the CDN (not inlined):

- **`viewer-static.min.js`** — the draw.io viewer (`GraphViewer`, `Graph`, `mxCodec`, `mxUtils`, …).
- **`drawio-mermaid.min.js`** (`/js/mermaid/`) — native Mermaid parser + layout that emits draw.io cells via `mxMermaidToDrawio.parseText(text, config)`. Replaces the upstream ~2.7 MB `mermaid.min.js` + `extensions.min.js` runtime. Supports 26 diagram types. Reads `globalThis.ELK` on init. Built from `jgraph/drawio-mermaid`.
- **`drawio-elk.min.js`** (`/js/elk/`) — Eclipse Layout Kernel + the mxGraph ↔ ELK bridge, self-publishing IIFE. Defines `var ELK` (engine) plus `ElkLayout` / `ElkAdapter` / `ElkApplier` as globals, consumed by drawio-mermaid and the `postLayout` pass. `ElkLayout` is the single source for the layout pipeline (`prepare`/`execute`), the per-algorithm `DEFAULTS`, the `MENU_PRESETS` (layout name → algorithm + direction) and the `CANONICAL_EDGE` treatment (`edgeStyleMode` + `corners`) — shared verbatim with drawio-dev's editor. The MCP's `applyPostLayout` drives it via `new ElkLayout(...).prepare(...)`. Built from `jgraph/drawio-elk`.

Script load order is `viewer → pako → elk → mermaid`, preserved because all are classic (non-async) `<script>` tags and execute in document order — external CDN tags block parsing just like inline ones. drawio-elk defines `var ELK` + `ElkLayout` and must come before drawio-mermaid (mermaid reads `globalThis.ELK` on init and throws otherwise); mermaid must come after the viewer so its `mermaidShapes.js` side-effect sees `mxCellRenderer`/`mxActor`. The viewer code reaches `ElkLayout` straight off the (CDN-loaded) bundle for the `postLayout` pass — no separate shim script.

For local dev, set `VIEWER_PATH` / `ELK_PATH` / `MERMAID_PATH` to a built bundle to inline it instead of hitting the CDN (e.g. testing a drawio-elk/mermaid build before it's published). `processElkBundle` / `processMermaidBundle` accept both the published IIFE form and an ESM build. The published CDN files self-publish their globals (no `export{}`), so those functions are no-ops on them.

### Sandbox constraints

- The MCP Apps sandbox uses `sandbox="allow-scripts"` but **not** `allow-same-origin` — Blob URL module imports fail silently. That's why we strip the ESM export and use a plain `var` alias.
- `app.openLink({ url })` must be used instead of `<a target="_blank">` — no `allow-popups`.
- `GraphViewer.processElements()` requires nonzero `offsetWidth` on the container — hence `min-width: 200px` on `#diagram-container`.

### Node.js vs Workers

| | Node.js (`src/index.js`) | Worker (`src/worker.js`) |
|---|---|---|
| **Transport** | `StreamableHTTPServerTransport` (Express) | `WebStandardStreamableHTTPServerTransport` |
| **HTML build** | Reads bundles from `node_modules` + `vendor/` at startup | Pre-built via `build-html.js` → `generated-html.js` |
| **Session management** | In-memory Map (process-scoped) | None — a server per request; the session's one bit of state rides in its id |

### Cloudflare Workers Architecture

The Worker serves `/mcp` **statelessly**: every request gets its own `createServer()` + `WebStandardStreamableHTTPServerTransport`, built in the Worker and dropped with the response. Nothing is held between requests, so it scales out with the Workers runtime and there is no Durable Object on the request path.

- **Sessions (2025-era protocol):** an `initialize` is answered with a minted `Mcp-Session-Id`, `ui-<uuid>` or `noui-<uuid>` — whether the client declared the `io.modelcontextprotocol/ui` capability, the one piece of per-session state the server needs (see [Clients without an MCP Apps UI](#clients-without-an-mcp-apps-ui)). A later request's server reads it back from the header (`uiSession` option of `createServer`), and its transport is marked initialized (`_initialized`) since it never saw the handshake. Any session id is accepted — there is no "session not found" anymore; an id without either prefix (issued before this scheme) reads as "not declared".
- **Session-less requests** other than `initialize` get the transport's own `400 Server not initialized` — the answer MCP 2026-07-28 clients (claude-code, copilot-cli, some Claude.ai traffic) get for their `server/discover` probe before falling back to `initialize`.
- **`GET /mcp` → 405** (no standalone SSE stream: the server never sends anything outside a response), **`DELETE` → 200** (nothing to release).
- **`MCPSessionManager`** is now one Durable Object per session id (`idFromName(sessionId)`, RPC methods `markUiResourceRead` / `uiResourceRead`), holding only the "fetched the app resource" flag in storage, dropped by an alarm 24 h after the last fetch. Only clients that did *not* declare the UI capability ever reach it — on `resources/read` of the app and on `create_diagram` — so it sees a tiny fraction of the traffic. A failed lookup counts as "not read", which only appends the fallback link. The class name is kept from the old design to avoid a wrangler migration.
- **`/health`** is the uptime probe (Pingdom watches `https://mcp.draw.io/health`): it runs an `initialize` through the same per-request path as `/mcp` and answers `200 ok` (`503` otherwise). It exists because monitors count the non-2xx of a session-less `GET /mcp` as down. The Node server answers `/health` directly.

**Why stateless?** Until 2026-09-30 every session's server + transport lived in the memory of sharded Durable Objects (4, then 16, routed by the session id's first hex char). A DO handles its requests one at a time and has 128 MB: with each session building its own shape-search tag map (~8 MB), the shards hit their memory limit ~1,200 times an hour and reset (dropping every session), and on 2026-09-30 they overloaded outright ("Durable Object is overloaded"). Claude.ai opens a new session per connector refresh (`initialize` → `tools/list` → `resources/list`, rarely a call, never a `DELETE`), so the DOs mostly held idle sessions — ~0.3 MB each once they had served `tools/list`. The DOs were also the dominant cost (billed per active object, 128 MB each). The only state a session needs is one bit, which fits in its id.

**MCP 2026-07-28** drops sessions and `initialize` altogether (capabilities arrive per request in `_meta`). Supporting it natively means SDK v2 (`@modelcontextprotocol/server` + `ext-apps` 2.x); v2's default handling of 2025-era clients is stateless too but loses their `initialize` capabilities, so the capability-in-session-id scheme stays for them.

**DOMAIN secret:**
- Set via `wrangler secret put DOMAIN`
- Value format: `{hash}.claudemcpcontent.com` where hash is SHA-256 of the endpoint URL (first 32 hex chars)
- Current value: SHA-256 of `https://mcp.draw.io/mcp`, truncated to 32 hex chars + `.claudemcpcontent.com`
- Used in `resources/read` response `_meta.ui.domain` for Claude.ai iframe sandbox origin

**wrangler.toml migrations:**
- The v3 migration tag is already applied in production
- Do NOT add a new `[[migrations]]` tag unless the DO class name changes — it will cause deploy conflicts

## Clients without an MCP Apps UI

`create_diagram` appends a second text block carrying an `app.diagrams.net/?pv=0&grid=0#create=` URL when the connected client doesn't render the app — a plain MCP client (Codex CLI, a terminal agent, a script) otherwise receives the JSON payload and nothing renders the diagram anywhere. Detection is `capabilitiesDeclareUi()` (the `io.modelcontextprotocol/ui` capability from `getUiCapability`, carrying `RESOURCE_MIME_TYPE`) OR `uiResourceRead`, a per-session flag set when the client actually fetches the `ui://` resource — which covers a host that renders through its own negotiation without declaring the capability.

Where the two signals live depends on how long the server instance lives. The Node server keeps one per session, so both sit on the instance. The Worker builds one per request and passes `createServer` a `uiSession`: `declared` comes from the session id minted at `initialize` (`ui-` / `noui-`), and the resource flag from that session's `MCPSessionManager` Durable Object — see [Cloudflare Workers Architecture](#cloudflare-workers-architecture).

The block is only ever *appended*: the app reads the FIRST text block (`content.find`), so a host that renders but wasn't detected keeps working, and the wording stays conditional ("if this client doesn't show the diagram inline") so it can't assert something false there. XML goes into the URL as-is, so a requested `postLayout` adds a note saying the link opens the authored coordinates (that pass lives in the app). Mermaid goes in as `type: "mermaid"` and the editor converts + lays it out on open — and a requested `postLayout: "elk"` *does* survive, because it is selected in the source: `withElkLayout` from `shared/mermaid-elk.js` (the canonical copy; the browser-side `withElkRenderer` in the app HTML is the same transform, kept in sync by hand since the self-contained HTML can't import).

## Model normalization

Every XML diagram passes through `normalizeDiagram` (`shared/normalize-model.js`) right after `normalizeDiagramXml`, before the payload reaches the app. It repairs three things generated XML carries: edges parked on the layer although both terminals sit inside one container (they render, but ELK reads an edge's coordinates in the frame of the node containing it, so the connector escapes the container — [#64](https://github.com/jgraph/drawio-mcp/issues/64)), edges written without a geometry (not rendered at all), and containers that would clip a child (grown, never shrunk).

Doing it here rather than inside the layout keeps `postLayout` free of hierarchy side effects, and the corrected diagram is what the viewer renders, what "Open in draw.io" exports, and what the fallback URL carries. The implementation is `MxGraph.normalizeModel` in `shared/mx-model.js` — a port of drawio-dev's `Graph.normalizeModel`, i.e. the desktop CLI's `--normalize` — driven over the XML by `shared/mx-xml.js`; idempotent, and it rewrites nothing else.

## MCP Apps SDK Patterns

- `registerAppTool` `inputSchema` uses Zod shapes (`{ key: z.string() }`), not JSON Schema objects
- CSP config goes on the **resource contents** `_meta.ui.csp`, not on the tool's `_meta.ui`
- TypeScript narrowing: use `if (block.type === "text")` before accessing `.text` on content blocks

## XML and Mermaid References

The tool description for `create_diagram` is composed at startup from two canonical reference files in `shared/`:

- **`shared/xml-reference.md`** — loaded as the `xmlReference` option on `createServer()`; covers draw.io XML styles, edge routing, containers, metadata.
- **`shared/mermaid-reference.md`** — loaded as the `mermaidReference` option; covers syntax for all 26 supported Mermaid diagram types plus flowchart styling (`style`, `classDef`, `linkStyle`). Appended after the XML reference in the final description.

For the Cloudflare Worker, both files are pre-built into `generated-html.js` (exported as named strings) by `build-html.js` and re-imported by `worker.js`. The Node.js path reads them directly from `shared/` at startup.

## Mermaid Conversion

`convertMermaidToXml()` in `shared.js` is a thin synchronous wrapper around `mxMermaidToDrawio.parseText(text, config)` exposed by the inlined drawio-mermaid bundle. No listener plumbing, no 10 s timeout, no upstream mermaid runtime — `parseText` runs the full parse + layout pipeline and returns draw.io XML directly. The only wait before calling it is `waitForGraphViewer()`, because the cell factory still needs `Graph`, `mxCodec`, and `mxUtils` from `viewer-static.min.js`.

Returns `null` for unsupported diagram types — the wrapper converts that to a rejected promise so the UI surfaces a clear error.

## Shape Search Index

The `search_shapes` tool uses a pre-built index from `shape-search/search-index.json` (~10,000 shapes). The index is embedded in `generated-html.js` at build time (adds ~4 MB to the Worker bundle). The local search runs in-process; the tag lookup map (~100 ms to build, several MB) is built once per process or Worker isolate, on the first search, and shared by every server (`getTagMap`). If the index file is missing, `search_shapes` is silently not registered.

When the local index has no strong match for a query (no result exact-matched every term), results are supplemented live from the draw.io icon service (`icons.diagrams.net` — brand logos and general-purpose concept icons, returned as `shape=image` styles). The merge pipeline is `searchShapesAndIcons` in `shared/icon-search.js`: strong local results lead and icons only fill spare slots; weak (Soundex/OR-fallback) local results keep at most half the budget. A full page of strong local results makes no network request; a service failure degrades to local-only results. The endpoint is configurable via `createServer`'s `iconServiceUrl` option, wired to `DRAWIO_ICON_SERVICE_URL` in both entries (set to `off` to disable). `https://icons.diagrams.net` is whitelisted in the iframe CSP `resourceDomains` so the referenced icon images render in the inline viewer.

## Coding Conventions

- **Allman brace style**: Opening braces go on their own line for all control structures, functions, objects, and callbacks.
- Prefer `function()` expressions over arrow functions for callbacks.
- See the root `AGENTS.md` for examples.

## Accept Header / JSON Mode

Claude.ai sends `Accept: application/json, text/event-stream` (both). The server prefers JSON when both are present:

```js
const wantsSSE = acceptsSSE && !acceptsJson; // JSON wins when both present
```

- **JSON mode** (Claude.ai): the Worker's per-request transport is created with `enableJsonResponse: true`
- **SSE mode** (Claude Desktop): standard SSE streaming via `handleRequest()`
- This was a critical fix — the original code matched on `text/event-stream` alone, routing Claude.ai to SSE mode which it can't consume

## Debug Logging (`wrangler tail`)

Debug logging is **off by default**. Enable via `wrangler secret put DEBUG` (set to `"true"`). The worker includes diagnostic logging for debugging MCP protocol issues:

| Tag | Content |
|-----|---------|
| `[rpc]` | HTTP method, JSON-RPC method name, session ID (prefix + first chars), `NEW` for an `initialize` |
| `[transport-error]` | SDK-internal errors (e.g. "Server not initialized") |
| `[response]` | Method, session, mode (SSE/JSON), HTTP status, elapsed ms |
| `[response-body]` | Full response for `resources/list`, `resources/read`, `tools/list`, `tools/call` |
| `[ui-flag]` | A failed read/write of a session's "fetched the app resource" Durable Object |

Unexpected exceptions are always logged (`[error]`, with the stack) and answered with a JSON-RPC `500`.

**Note:** At high traffic, `wrangler tail` enters sampling mode and drops messages. Use `wrangler tail --format json | grep` to filter for specific methods.

## Known Issues (as of 2026-03-23)

- **Server works end-to-end via curl** — all 6 MCP protocol steps succeed (initialize → notifications/initialized → tools/list → resources/list → resources/read → tools/call)
- **Claude.ai never sends `resources/read` or `tools/call`** — completes the handshake (through `resources/subscribe`) but stops. This is a Claude.ai-side issue, not a server bug
- **MCP Apps for custom connectors** may not be fully supported on Claude.ai yet. Contact `mcp-apps@anthropic.com` for status

## Scripts

```bash
npm start              # Node.js server on port 3001
npm run build:worker   # Generate generated-html.js
npm run dev:worker     # Wrangler local dev (port 8787)
npm run deploy         # Build + deploy to Cloudflare Workers
```

## Docker

`Dockerfile` packages the Node.js entry. It must be built from the **repository root** (`docker build -f mcp-app-server/Dockerfile -t drawio-mcp-app .`) because `src/index.js` reads `../../shared/*.md` and `../../shape-search/search-index.json` at startup and `src/shared.js` imports `../../shared/*.js` — a build context of just this directory cannot see them. The root `.dockerignore` trims the context to what the `COPY` lines need (no `node_modules`, `.git`, `public/`, or the other packages). `wrangler` is a devDependency and is left out of the image (`npm ci --omit=dev`). The Node entry binds to `LISTEN` (default `127.0.0.1`); the image sets `LISTEN=0.0.0.0` so `-p` works, and the docs recommend `-p 127.0.0.1:3001:3001`. `ALLOWED_HOSTS` turns on the SDK's Host header check — deliberately not implied by a loopback bind, since tunnels (cloudflared, Tailscale Funnel) connect to localhost but forward their public Host.

**Publishing to Docker Hub** — `.github/workflows/publish-app-server-image.yml` (manual `workflow_dispatch`, like the tool server's npm publish) builds the Dockerfile for `linux/amd64` + `linux/arm64`, smoke-tests the native build first (`initialize` must answer as `drawio-mcp-app` and the `io.modelcontextprotocol.server.name=io.draw/mcp` label must be present — the label the MCP registry requires before an OCI package can be listed in `server.json`), then pushes `jgraph/drawio-mcp:<version>` and `:latest`, where `<version>` is this `package.json`'s — bump and commit it first; a tag that already exists on Docker Hub fails the run before anything is built. It also syncs `DOCKER_HUB.md` to the Hub page (that step needs a token with Read, Write and Delete scope and is `continue-on-error`). Needs the `DOCKERHUB_USER` / `DOCKERHUB_TOKEN` repository secrets (the same names as jgraph/docker-drawio). Run with `gh workflow run publish-app-server-image.yml`; `-f dry_run=true` builds and smoke-tests without logging in or pushing.
