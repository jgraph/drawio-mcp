# MCP App Server

Renders draw.io diagrams inline in AI chat interfaces using the MCP Apps protocol.

## Key Files

| File | Purpose |
|------|---------|
| `src/shared.js` | Shared logic: `buildHtml()`, `processAppBundle()`, `createServer()` |
| `src/index.js` | Node.js entry (Express + stdio transports) |
| `src/worker.js` | Cloudflare Workers entry (Web Standard fetch handler) |
| `src/build-html.js` | Build script: generates `generated-html.js` for the Worker |

## Architecture

### How the HTML is built

At startup (Node.js) or build time (Workers), the HTML is assembled. The draw.io **viewer**, **drawio-elk**, and **drawio-mermaid** load from the `viewer.diagrams.net` CDN via `<script src>` — they're large, cached cross-session by the browser, and stay version-synced with each draw.io release (same host + release cadence as the viewer). The remaining bundles are inlined so the sandboxed iframe needs no further fetches for them:

- **`app-with-deps.js`** (~319 KB, from `node_modules/@modelcontextprotocol/ext-apps`) — MCP Apps SDK browser bundle. The bundle is ESM (ends with `export { ... as App }`), so `processAppBundle()` strips the export statement and creates a local `var App = <minifiedName>` alias. This makes it safe to inline in a plain `<script>` tag inside the sandboxed iframe.
- **`pako_deflate.min.js`** (~28 KB, from `node_modules/pako`) — for compressing XML into the `#create=` URL format.
- **libavoid** (the obstacle-avoiding orthogonal edge router behind `routing: "libavoid"`) is **not vendored/inlined** — the HTML loads glue + base64 wasm payload + loader + shared routing core from the `viewer.diagrams.net` CDN (`js/libavoid-js/`), like drawio-elk and drawio-mermaid. The wasm rides as base64 inside `libavoid-wasm.js` and is decoded by the loader (still no fetch, so the sandbox CSP is satisfied by plain script-src). The routing math is `AvoidRouting.computeRoutes` from `libavoid-routing.js` — the canonical `drawio-dev js/libavoid-js/` artifact, byte-identical to what the draw.io editor bundles and the mcp-tool-server vendors. `buildHtml` still accepts `options.libavoidJs`/`libavoidWasmB64` to inline a local build (dev). See `vendor/libavoid/README.md`.

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
| **Session management** | In-memory Map (process-scoped) | Single Durable Object (cost-optimized) |

### Cloudflare Workers Architecture

The Worker uses **4 sharded Durable Objects** (`MCPSessionManager`) to manage all MCP sessions:

- Sessions are spread across 4 shards (`shard-0` through `shard-3`) using `idFromName("shard-N")`
- Routing: `parseInt(sessionId.charAt(0), 16) % 4` determines the shard
- New sessions (no session ID) go to a random shard; the DO generates a UUID whose first hex char routes back to that shard
- Each DO maintains a `Map` of session IDs to server/transport instances
- Sessions are kept alive for **5 minutes** of inactivity, then cleaned up (runs every 60 seconds)

**Why sharded DOs?**
- Durable Objects charge per request + per GB-seconds of active memory
- Sharding across 4 DOs spreads memory pressure vs a single DO holding all sessions
- More cost-effective than one DO per session
- Session cleanup prevents unbounded memory growth

**DOMAIN secret:**
- Set via `wrangler secret put DOMAIN`
- Value format: `{hash}.claudemcpcontent.com` where hash is SHA-256 of the endpoint URL (first 32 hex chars)
- Current value: SHA-256 of `https://mcp.draw.io/mcp`, truncated to 32 hex chars + `.claudemcpcontent.com`
- Used in `resources/read` response `_meta.ui.domain` for Claude.ai iframe sandbox origin

**wrangler.toml migrations:**
- The v3 migration tag is already applied in production
- Do NOT add a new `[[migrations]]` tag unless the DO class name changes — it will cause deploy conflicts
- The 4-shard routing is done in code via `idFromName("shard-N")`, not via wrangler config

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

The `search_shapes` tool uses a pre-built index from `shape-search/search-index.json` (~10,000 shapes). The index is embedded in `generated-html.js` at build time (adds ~4 MB to the Worker bundle). The search runs in-process — no external HTTP calls. The tag lookup map is built once per session when `createServer()` is called. If the index file is missing, `search_shapes` is silently not registered.

## Coding Conventions

- **Allman brace style**: Opening braces go on their own line for all control structures, functions, objects, and callbacks.
- Prefer `function()` expressions over arrow functions for callbacks.
- See the root `CLAUDE.md` for examples.

## Accept Header / JSON Mode

Claude.ai sends `Accept: application/json, text/event-stream` (both). The server prefers JSON when both are present:

```js
const wantsSSE = acceptsSSE && !acceptsJson; // JSON wins when both present
```

- **JSON mode** (Claude.ai): sets `transport._enableJsonResponse = true` before handling, resets after
- **SSE mode** (Claude Desktop): standard SSE streaming via `handleRequest()`
- This was a critical fix — the original code matched on `text/event-stream` alone, routing Claude.ai to SSE mode which it can't consume

## Debug Logging (`wrangler tail`)

Debug logging is **off by default**. Enable via `wrangler secret put DEBUG` (set to `"true"`). The worker includes diagnostic logging for debugging MCP protocol issues:

| Tag | Content |
|-----|---------|
| `[request]` | HTTP method, session ID (first 8 chars) |
| `[rpc]` | JSON-RPC method name, session ID, `NEW` flag for fresh sessions |
| `[session-create]` | DOMAIN value, session ID |
| `[transport-error]` | SDK-internal errors (e.g. "Server not initialized", "Only one SSE stream") |
| `[response]` | Method, session, mode (SSE/JSON), HTTP status, elapsed ms |
| `[response-body]` | Full response for `resources/list`, `resources/read`, `tools/list`, `tools/call` |
| `[cleanup]` | Session count, oldest age, max idle, idle>1m count (once/minute) |
| `[sessions] REJECTED` | GET requests for non-existent session IDs |

**Note:** At high traffic, `wrangler tail` enters sampling mode and drops messages. Use `wrangler tail --format json | grep` to filter for specific methods.

## Known Issues (as of 2026-03-23)

- **Server works end-to-end via curl** — all 6 MCP protocol steps succeed (initialize → notifications/initialized → tools/list → resources/list → resources/read → tools/call)
- **Claude.ai never sends `resources/read` or `tools/call`** — completes the handshake (through `resources/subscribe`) but stops. This is a Claude.ai-side issue, not a server bug
- **MCP Apps for custom connectors** may not be fully supported on Claude.ai yet. Contact `mcp-apps@anthropic.com` for status
- **"Session not found" (404)** — returned when clients resume stale session IDs after cleanup (5-minute idle timeout) or after deploys. Clients should re-initialize with a fresh session
- **SSE stream conflicts** (`409 Conflict: Only one SSE stream`) are benign — clients reconnecting SSE on sessions that already have an active stream

## Scripts

```bash
npm start              # Node.js server on port 3001
npm run build:worker   # Generate generated-html.js
npm run dev:worker     # Wrangler local dev (port 8787)
npm run deploy         # Build + deploy to Cloudflare Workers
```
