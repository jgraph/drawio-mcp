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
| `snippet/mcp_edge.js` | Cloudflare Snippet in front of the Worker on `mcp.draw.io`: answers pings, notifications, session-less requests, GET/HEAD/DELETE/OPTIONS and OAuth discovery probes without a Worker invocation — see [Edge snippet](#edge-snippet) |
| `openai-plugin/` | OpenAI Plugins Directory package (`.codex-plugin/plugin.json`: names, descriptions, starter prompts, policy URLs, icon; `.mcp.json`: the server, which can never change on an existing plugin) — zipped and uploaded as a new version in the portal; its own `version`, runbook in `OPENAI-SUBMISSION.md` |

## Architecture

### How the HTML is built

At startup (Node.js) or build time (Workers), the HTML is assembled. The draw.io **viewer**, **drawio-elk**, and **drawio-mermaid** load from the `viewer.diagrams.net` CDN via `<script src>` — they're large, cached cross-session by the browser, and stay version-synced with each draw.io release (same host + release cadence as the viewer). The remaining bundles are inlined so the sandboxed iframe needs no further fetches for them:

- **`app-with-deps.js`** (~319 KB, from `node_modules/@modelcontextprotocol/ext-apps`) — MCP Apps SDK browser bundle. The bundle is ESM (ends with `export { ... as App }`), so `processAppBundle()` strips the export statement and creates a local `var App = <minifiedName>` alias. This makes it safe to inline in a plain `<script>` tag inside the sandboxed iframe.
- **`pako_deflate.min.js`** (~28 KB, from `node_modules/pako`) — for compressing XML into the `#create=` URL format.
- **libavoid** (the obstacle-avoiding orthogonal edge router behind `routing: "libavoid"`) is **not vendored/inlined** — the HTML loads the pure-JS router bundle (`libavoid.min.js`, a self-contained classic script that publishes `globalThis.Avoid` and parks `window.__libavoidReady` synchronously — no WASM, no fetch, no `wasm-unsafe-eval` needed) + shared routing core from the `viewer.diagrams.net` CDN (`js/libavoid-js/`), like drawio-elk and drawio-mermaid. Requires the draw.io release that ships the pure-JS two-file layout there. The routing math is `AvoidRouting.computeRoutes` from `libavoid-routing.js` — the canonical `drawio-dev js/libavoid-js/` artifact, byte-identical to what the draw.io editor bundles and the mcp-tool-server vendors. `buildHtml` accepts `options.libavoidJs` to inline a local build instead (dev). See `vendor/libavoid/README.md`. `routeWithLibavoid` passes each vertex's style transform (`libavoidShapeFrame` → `AvoidRouting.shapeFrame`: rotation, direction, flips) and each pin's `exitPerimeter`/`entryPerimeter`, so rotated shapes are routed as drawn; against a CDN core from before rotation support (no `shapeFrame`) it routes them unrotated, as before. A floating edge end gets one candidate pin at the middle of each side (`LIBAVOID_SIDE_MIDPOINTS`) instead of the shape's centre, and the pass asks the core to nudge apart the segments attached to a shape (`opts.nudgeShapeSegments`): from the centre, every edge leaving a shape shared its first segment and their labels piled up. Of those midpoints, a floating end only gets the sides that face the other end (`libavoidFacingPins`), as draw.io's orthogonal edge style draws them: shapes stacked vertically connect bottom to top, shapes side by side connect side to side, a diagonal pair gets both facing sides. Alone, libavoid takes the route with the fewest bends, which entered a shape below from its side, so a load balancer's edges to two servers under it left its bottom and turned into the servers' sides. When another shape blocks the corridor between the two ends (a loop back along a flowchart column), all four sides stay allowed; shapes drawn around an end (a container, a background band) don't block. A row of a table (an ER column, a class attribute: a child of a `stackLayout`/`tableLayout`/`table` container) only gets its left and right side (`libavoidRowPins`), since its top and bottom border the rows next to it; with all sides, relations entered tables through their header. The pass reroutes only right-angle edges (`libavoidRoutesEdge`: `orthogonalEdgeStyle`, `elbowEdgeStyle`, `entityRelationEdgeStyle` and the other segment styles, not `curved=1`). Straight and curved lines are a choice the diagram type makes (use case links, network cables, state transitions, mind maps) that orthogonal routes would undo, so they stay as drawn. XML without `postLayout` or `routing` is routed anyway when a right-angle edge, as the built-in router draws it, runs through a shape it doesn't connect, through a label outside a shape or through a lane's title band (`edgesCrossShapes`, checked at finalize, `opts.autoRoute`): the model can't see where the basic router draws its lines. Containers and shapes drawn around an end don't count, as in the routing core's `filterEnclosing`. A vertex with `labelPerimeter=1` and a label outside the shape also passes that label (`libavoidOutsideLabel`, from the viewer's `getLabelPerimeterSide`), so the core routes around it and ends edges on that side at its far edge, where draw.io ends them. Both need the draw.io release after 32.5.5: an older CDN core ignores the option and the label (the midpoint pins then share their first segment like the centre did), and an older viewer has no `getLabelPerimeterSide`. `LIBAVOID_PATH` (a directory with `libavoid.min.js` and `libavoid-routing.js`, e.g. drawio-dev's `src/main/webapp/js/libavoid-js`) inlines a local build in the Node server for testing before that release, next to `VIEWER_PATH`.

Loaded from the CDN (not inlined):

- **`viewer-static.min.js`** — the draw.io viewer (`GraphViewer`, `Graph`, `mxCodec`, `mxUtils`, …).
- **`drawio-mermaid.min.js`** (`/js/mermaid/`) — native Mermaid parser + layout that emits draw.io cells via `mxMermaidToDrawio.parseText(text, config)`. Replaces the upstream ~2.7 MB `mermaid.min.js` + `extensions.min.js` runtime. Supports 28 diagram types. Reads `globalThis.ELK` on init. Built from `jgraph/drawio-mermaid`.
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
| **Session management** | None — a server per request; the session's one bit of state rides in its id, the resource flag sits in an in-memory Map | None — a server per request; the session's one bit of state rides in its id |

### Cloudflare Workers Architecture

The Worker serves `/mcp` **statelessly**: every request gets its own `createServer()` + `WebStandardStreamableHTTPServerTransport`, built in the Worker and dropped with the response. Nothing is held between requests, so it scales out with the Workers runtime and there is no Durable Object on the request path.

- **Sessions (2025-era protocol):** an `initialize` is answered with a minted `Mcp-Session-Id`, `ui-<uuid>` or `noui-<uuid>` — whether the client declared the `io.modelcontextprotocol/ui` capability, the one piece of per-session state the server needs (see [Clients without an MCP Apps UI](#clients-without-an-mcp-apps-ui)). A later request's server reads it back from the header (`uiSession` option of `createServer`), and its transport is marked initialized (`_initialized`) since it never saw the handshake. Any session id is accepted — there is no "session not found" anymore; an id without either prefix (issued before this scheme) reads as "not declared".
- **Session-less requests** other than `initialize` get the transport's own `400 Server not initialized` — the answer MCP 2026-07-28 clients (claude-code, copilot-cli, some Claude.ai traffic) get for their `server/discover` probe before falling back to `initialize`.
- **`GET /mcp` → 405** (no standalone SSE stream: the server never sends anything outside a response), **`DELETE` → 200** (nothing to release).
- **`MCPSessionManager`** is now one Durable Object per session id (`idFromName(sessionId)`, RPC methods `markUiResourceRead` / `uiResourceRead`), holding only the "fetched the app resource" flag in storage, dropped by an alarm 24 h after the last fetch. Only clients that did *not* declare the UI capability ever reach it — on `resources/read` of the app and on `create_diagram` — so it sees a tiny fraction of the traffic. A failed lookup counts as "not read", which only appends the fallback link. The class name is kept from the old design to avoid a wrangler migration.
- **`/health`** is the uptime probe (Pingdom watches `https://mcp.draw.io/health`): it runs an `initialize` through the same per-request path as `/mcp` and answers `200 ok` (`503` otherwise). It exists because monitors count the non-2xx of a session-less `GET /mcp` as down. The Node server answers `/health` directly.

**Why stateless?** Until 2026-09-30 every session's server + transport lived in the memory of sharded Durable Objects (4, then 16, routed by the session id's first hex char). A DO handles its requests one at a time and has 128 MB: with each session building its own shape-search tag map (~8 MB), the shards hit their memory limit ~1,200 times an hour and reset (dropping every session), and on 2026-09-30 they overloaded outright ("Durable Object is overloaded"). Claude.ai opens a new session per connector refresh (`initialize` → `tools/list` → `resources/list`, rarely a call, never a `DELETE`), so the DOs mostly held idle sessions — ~0.3 MB each once they had served `tools/list`. The DOs were also the dominant cost (billed per active object, 128 MB each). The only state a session needs is one bit, which fits in its id.

**MCP 2026-07-28** drops sessions and `initialize` altogether (capabilities arrive per request in `_meta`). Supporting it natively means SDK v2 (`@modelcontextprotocol/server` + `ext-apps` 2.x); v2's default handling of 2025-era clients is stateless too but loses their `initialize` capabilities, so the capability-in-session-id scheme stays for them.

### Edge snippet

`snippet/mcp_edge.js` is a [Cloudflare Snippet](https://developers.cloudflare.com/rules/snippets/) (snippet `mcp_edge`, zone `draw.io`, Enterprise). Snippets run before Workers and cost nothing per request, so the requests whose reply never depends on the server are answered there and never invoke the Worker:

- a `ping` (200, the `id` echoed, `mcp-session-id` echoed) and a `notifications/*` message (202), both within a session
- any JSON-RPC message but `initialize` without a session (400 "Server not initialized")
- `GET` (405), `HEAD` (405), `DELETE` (200, or 400 without a session) and `OPTIONS` (204) on `/mcp`
- OAuth/OIDC discovery probes (`/.well-known/oauth-*`, `/.well-known/openid-configuration`, `/mcp/.well-known/…`: 404)

Everything else is passed on with `fetch(request)` and reaches the Worker unchanged. That includes `initialize`, `tools/*` and `resources/*`, batches, bodies over 1 KB or of unknown length, a Content-Type whose media type isn't `application/json` (the SDK parses it, so `text/plain; a=application/json` gets its 415), SSE-only clients, unknown `mcp-protocol-version`s and any message the SDK's strict JSON-RPC schemas might reject (ids and progress tokens must be safe integers). Every reply the snippet makes carries `x-drawio-mcp-edge: snippet`.

**Why:** Copilot CLI pings each open session every 21 s, forever, so windows left open keep pinging. In October 2026 that was ~71% of all Worker requests. Worker requests had grown from 2.3M a day (2026-09-29) to 7.1M a day (2026-10-12), and an 88 s `wrangler tail` sample put ~85% of them in the categories above.

**Keeping it exact:** the snippet must answer exactly as the Worker would. `test/edge-snippet.test.js` holds the Worker's recorded replies, checks the pass-through cases, and fails when the SDK's `SUPPORTED_PROTOCOL_VERSIONS` no longer matches the snippet's copy. `EDGE_COMPARE_URL=<worker origin> npm test` also compares every answered case live. Run it against staging after an SDK update or a change to `worker.js`'s trivial paths (CORS headers, GET/DELETE handling), and redeploy the snippet when they change.

**Rule:**

```
http.host eq "mcp.draw.io" and (http.request.uri.path eq "/mcp" or starts_with(http.request.uri.path, "/.well-known/oauth-") or starts_with(http.request.uri.path, "/.well-known/openid-configuration") or starts_with(http.request.uri.path, "/mcp/.well-known/"))
```

**The zone's snippet rules belong to drawio-dev.** `src/main/server/cf/cf-snippets/rules/draw.io.json` there is the `draw.io` zone's complete rule list, and every draw.io production deploy (`cf-deploy.yml`) replaces the zone's rules with it. It lists this rule since drawio-dev `970f312abc`; before that, the 32.5.1 deploy (2026-10-13 14:47 UTC) deleted it and the Worker took all the traffic again until it was restored at 16:32. So change the rule in that file as well as on the zone. The code is not in drawio-dev (no `cf-snippets/mcp_edge/`, so its deploy skips it): deploy it from here, `cf snippets update mcp_edge --zone <zone id> --file snippet/mcp_edge.js --metadata '{"main_module":"mcp_edge.js"}'`. Updating rules on the zone by hand (`PUT /zones/{zone}/snippets/snippet_rules`, which **replaces all rules in the zone**): GET them first and send them all back.

**Rollout:** deploy with ` and any(http.request.headers["x-drawio-mcp-edge-test"][*] eq "1")` appended to the rule, so only requests carrying that header reach the snippet. Check them against production (the `x-drawio-mcp-edge` header shows which side answered), then drop the condition. **Rollback:** disable or remove the rule, which takes effect at once. Snippets have no logs: watch the Worker's daily requests in `workersInvocationsAdaptive` (GraphQL) drop instead.

**DOMAIN secret:**
- Set via `wrangler secret put DOMAIN`
- Value format: `{hash}.claudemcpcontent.com` where hash is SHA-256 of the endpoint URL (first 32 hex chars)
- Current value: SHA-256 of `https://mcp.draw.io/mcp`, truncated to 32 hex chars + `.claudemcpcontent.com`
- Used in `resources/read` response `_meta.ui.domain` for Claude.ai iframe sandbox origin

**wrangler.toml migrations:**
- The v3 migration tag is already applied in production
- Do NOT add a new `[[migrations]]` tag unless the DO class name changes — it will cause deploy conflicts

## Clients without an MCP Apps UI

`create_diagram` appends a second text block carrying an `app.diagrams.net/?pv=0&grid=0` URL (`#R` with the XML, like "Open in draw.io" below; `#create=` with the source for Mermaid, which draw.io converts) when the connected client doesn't render the app — a plain MCP client (Codex CLI, a terminal agent, a script) otherwise receives the JSON payload and nothing renders the diagram anywhere. Detection is `capabilitiesDeclareUi()` (the `io.modelcontextprotocol/ui` capability from `getUiCapability`, carrying `RESOURCE_MIME_TYPE`) OR `uiResourceRead`, a per-session flag set when the client actually fetches the `ui://` resource — which covers a host that renders through its own negotiation without declaring the capability.

Where the two signals live depends on how long the server instance lives. The stdio server has one instance for the whole session, so both sit on the instance. Both HTTP entries build one per request and pass `createServer` a `uiSession`: `declared` comes from the session id minted at `initialize` (`ui-` / `noui-`), and the resource flag from that session's `MCPSessionManager` Durable Object (Worker — see [Cloudflare Workers Architecture](#cloudflare-workers-architecture)) or an in-memory Map with the same 24 h expiry (Node). The Node HTTP transport stays stateless: `src/index.js` sends the minted id in `Mcp-Session-Id` itself and reads it back from the header. Until 2026-10-13 it minted none, so every Node and Docker client got the link, VS Code (which declares the capability) included.

The block is only ever *appended*: the app reads the FIRST text block (`content.find`), so a host that renders but wasn't detected keeps working, and the wording stays conditional ("if this client doesn't show the diagram inline") so it can't assert something false there. XML goes into the URL as-is, so a requested `postLayout` adds a note saying the link opens the authored coordinates (that pass lives in the app). Mermaid goes in as `type: "mermaid"` and the editor converts + lays it out on open — and a requested `postLayout: "elk"` *does* survive, because it is selected in the source: `withElkLayout` from `shared/mermaid-elk.js` (the canonical copy; the browser-side `withElkRenderer` in the app HTML is the same transform, kept in sync by hand since the self-contained HTML can't import).

## Model normalization

Before that, `repairDiagramXml` (`shared/repair-xml.js`, shared with the tool server) fixes the mechanical slips LLMs make in the XML string: text around the diagram (a leaked tool-call tag after it, `…</mxGraphModel></xml>`), `<` or a stray `&` in attribute values, and the default layer written as its own parent. When the leaked text carries a `postLayout`, `direction` or `routing` argument with a value `XML_OPTION_VALUES` accepts (the same arrays the `create_diagram` schema uses) and the real argument is missing, `leakedArguments` recovers it. A well-formed diagram passes byte-identical. In LLM tests of the tool server these slips caused every broken diagram, 15 of 473; see `mcp-tool-server/AGENTS.md`.

Every XML diagram passes through `normalizeDiagram` (`shared/normalize-model.js`) right after `normalizeDiagramXml` and the repair, before the payload reaches the app. It repairs three things generated XML carries: edges parked on the layer although both terminals sit inside one container (they render, but ELK reads an edge's coordinates in the frame of the node containing it, so the connector escapes the container — [#64](https://github.com/jgraph/drawio-mcp/issues/64)), edges written without a geometry (not rendered at all), and containers that would clip a child (grown, never shrunk).

Doing it here rather than inside the layout keeps `postLayout` free of hierarchy side effects, and the corrected diagram is what the viewer renders, what "Open in draw.io" exports, and what the fallback URL carries. The implementation is `MxGraph.normalizeModel` in `shared/mx-model.js` — a port of drawio-dev's `Graph.normalizeModel`, i.e. the desktop CLI's `--normalize` — driven over the XML by `shared/mx-xml.js`; idempotent, and it rewrites nothing else.

After it, `addLabelPerimeters` (`shared/label-perimeter.js`) adds `labelPerimeter=1` to vertices with a label outside the shape, centered on one side (`verticalLabelPosition` top or bottom, or `labelPosition` left or right), unless their style already has the key: draw.io ends edges on that side at the label's far edge, the convention of cloud architecture diagrams. The editor sets the key the same way on new shapes; existing diagrams don't have it. Rewrites only those cells, idempotent.

## The diagram as shown, for the model

The model only has the arguments it sent, but the viewer can show something else: Mermaid converted to draw.io XML, an ELK layout or libavoid routing pass, the user's layout toggle. Every change to what is shown goes through `commitDiagramXml`, which schedules `sendModelContext` (500 ms, so a render and its layout pass coalesce; the layout and routing state is taken with the XML, since a render's first commit comes before the layout state is set). `modelContextText` writes what the diagram is and how to change it (start from this XML, pass it as `xml` without `postLayout` / `routing` so the positions stay; for Mermaid, simple changes can stay in the Mermaid source), followed by the flat XML as shown — for Mermaid the converted cells, not the `wrapGroup` wrapper "Open in draw.io" uses.

- **When:** plain XML shown as sent isn't repeated. Mermaid and any pass are sent, and once a diagram has been sent, every later change is (so the toggle back to "as authored" updates the model too). Above `MODEL_CONTEXT_MAX_CHARS` (60,000) nothing is sent.
- **How:** `app.updateModelContext` (`ui/update-model-context`) when the host declares the `updateModelContext` capability. The host keeps only the last update and passes it on with the user's next message. Otherwise, in ChatGPT, `window.openai.setWidgetState({ modelContent })`. `[model-context]` console lines say which channel was used, or that there was none.
- **Nothing reaches draw.io:** the XML goes from the iframe to the host's conversation, so the privacy page doesn't change.
- `test/model-context.test.js` runs `modelContextText` from the template source.

## Inline height and the readable top view

Inline, the iframe grows to the diagram's natural height up to `inlineHeightCap()`: 800 px, at most 90 % of `screen.availHeight` (the screen, because the iframe's own height follows our `sendSizeChanged` and would feed back), never below 480 px. `--inline-max-h` on the root carries the same value to the CSS. Hosts resize the iframe both ways on `sendSizeChanged`, Claude.ai included. Expand switches the cap to 1000 px; fullscreen fills the window.

Where fitting a tall diagram whole would shrink it below `STREAM_READABLE_MIN_SCALE` (0.75, so 12 px labels stay 9 px), the camera settles on its top at that scale instead: `computeDefaultViewTransform`, used after drawing, layout passes, the layout toggle and Expand, and by `streamFollowNewCells` once there is nothing left to follow, so the window resize that follows the host's size change keeps the top view instead of zooming back out to fit-whole. The card's bottom edge fades while the diagram continues below (`.more-below`, from `updateMoreBelowCue`), and the Fit button and double-click still show the whole diagram. A diagram limited by its width keeps fit-whole. Before this, a fixed 480 px cap shrank tall flowcharts and sequence diagrams until their labels were unreadable: the 2026-10-16 benchmark spike scored draw.io's readability below Excalidraw's for exactly that. `[inline-height]` console lines show the cap, the host's reported height and when the top view is used.

## Viewer toolbar

**Labels.** "Open in draw.io" and "Copy" carry text labels; the other buttons are 30 px icons. A label never wraps (`white-space: nowrap`, an ellipsis if it is ever squeezed): `fitToolbarLabels` puts the toolbar in `compact` mode, icons only and every button square, whenever the labels can't be shown whole. It re-measures with the labels shown when the toolbar's width changes (`ResizeObserver`), when a button is shown or hidden, and when a label changes ("Copied!") (`MutationObserver`). The icon buttons never shrink (`flex-shrink: 0`), so the labels are what gives way.

**"Open in draw.io"** opens `#create={"type":"xml","compressed":true,"data":…,"effect":"pop"}`: the XML the viewer shows (for a Mermaid diagram, the converted XML wrapped by `wrapGroup` with its source in mermaidData), with the "pop" animation as draw.io creates the diagram. The plain links have no animation: the fallback link for clients without an MCP Apps UI and the tool server's links open XML as a raw `#R` link, and use `#create=` only for Mermaid (and the tool server's CSV), which draw.io converts in the browser because nothing has converted it to XML there. `?pv=0&grid=0` apply to both (draw.io reads them for every loaded diagram). `test/links.test.js` checks both forms.

**The "All changes will be lost!" dialog** (draw.io up to 32.4.5): after a `#create`, draw.io rewrites the hash with the diagram it created, and its `hashchange` handler compares the result with the hash from before the load. If they differ, it loads the link again and asks. They differ whenever the link isn't exactly what draw.io writes back: a Mermaid or CSV link, another deflate or JSON encoder, or a host that re-encodes the link on the way to the browser. VS Code does the last: a link opened as a URI goes out as `encodeURI(uri.toString(true))`, which leaves `:` `,` `+` `/` `=` unescaped. draw.io never rewrites a `#R` hash, which is why the button used `#R` from 2026-10-12 until the fix: drawio-dev `5170e37146` and `6ee7e71444` (2026-10-13, first release after 32.4.5) have `executeCreateObject` store the hash it rewrites to on the created file, and the `hashchange` handler doesn't load that hash again. Tested with every link format here, it removes the dialog; comparing decoded hashes only covers re-encoded XML links, and `history.replaceState` alone covers none, because `fileLoaded` has already cleared the hash. Deploy the button's `#create` only once app.diagrams.net runs that release, or VS Code users get the dialog again.

## MCP Apps SDK Patterns

- `registerAppTool` `inputSchema` uses Zod shapes (`{ key: z.string() }`), not JSON Schema objects
- CSP config goes on the **resource contents** `_meta.ui.csp`, not on the tool's `_meta.ui`
- `resourceDomains` includes `https://fonts.googleapis.com` and `https://fonts.gstatic.com` so Google fonts of `fontSource` styles load in the viewer (the font CSS is linked, it loads the font files) — e.g. the Recursive font of Mermaid 12 diagrams (`redux-color` theme)
- TypeScript narrowing: use `if (block.type === "text")` before accessing `.text` on content blocks
- To accept more than a schema advertises, wrap it in `z.preprocess` (`lenient` in `src/shared.js`): the JSON schema in `tools/list` stays byte-identical to the wrapped one, so a tool can get more forgiving without a new tool definition (which the OpenAI and Claude directory listings were reviewed against). Put `.optional()` inside the wrapper: outside, it lets only `undefined` through and `null` fails before it is mapped. The SDK (1.32) answers a value the schema rejects with an `isError` tool result ("Input validation error"), which the Claude directory counts as a tool error
- The viewer renders from the raw tool input (`ontoolinputpartial`, `ontoolinput`) before the result arrives, so input the server corrects has to be read the same way there: `normalizeOptionValue` is inlined for the options, `diagramXmlStart` skips text before the XML, and a diagram under the other parameter is left to the result

## XML and Mermaid References

The `get_drawio_reference` tool (`{ format: "xml" | "mermaid" }`) returns one of two canonical reference files in `shared/`, with this server's chat-view sections inserted before their first section (`src/references.js`, `readReference`): `shared/chat-view-xml.md` (designing for the inline frame, and one layout pattern per diagram type for XML the model places itself) and `shared/chat-view-mermaid.md`. Only `create_diagram` shows diagrams in the chat frame, and only its format rule has the model place flowcharts, class, state and other diagrams as XML; the tool server, the skill and the project instructions use the shared references without these sections.

- **`shared/xml-reference.md`** — loaded as the `xmlReference` option on `createServer()`; covers draw.io XML styles, the layout grid, edge routing, containers, metadata.
- **`shared/mermaid-reference.md`** — loaded as the `mermaidReference` option; covers syntax for all 28 supported Mermaid diagram types plus flowchart styling (`style`, `classDef`, `linkStyle`).

The `create_diagram` description stays short (~1.8k characters): the Mermaid-vs-XML decision with every Mermaid header keyword, the XML essentials, and an instruction to call `get_drawio_reference` once per format before the first diagram. Through app server 1.0.6 it carried both references (~55k characters), which broke VS Code Copilot's tool search: Copilot embeds tool descriptions in batches, and one description over the embedding limit fails the whole batch, other servers' tools included ([#76](https://github.com/jgraph/drawio-mcp/issues/76)). `test/tools.test.js` (`npm test`) caps every tool description at 2048 characters and checks that the tool returns both files. Guidance that only matters once a format is chosen belongs in the references, not in the description.

For the Cloudflare Worker, both files are pre-built into `generated-html.js` (exported as named strings) by `build-html.js` and re-imported by `worker.js`. The Node.js path reads them directly from `shared/` at startup.

## Mermaid Conversion

`convertMermaidToXml()` in `shared.js` is a thin synchronous wrapper around `mxMermaidToDrawio.parseText(text, null, {version: MERMAID_DEFAULTS_VERSION})` exposed by the inlined drawio-mermaid bundle. `MERMAID_DEFAULTS_VERSION` ("12", top of `shared.js`) is also passed by the streaming preview, stored by `wrapGroup` in the mermaidData behind "Open in draw.io" and added to `#create=` links of type `mermaid`, so the preview, the opened diagram and draw.io's re-conversion on edit all use Mermaid 12's defaults (no theme is forced; draw.io adapts the light themes to dark hosts). Version 12 diagrams of the redux themes use the Recursive Google font, which the viewer loads from Google Fonts (both hosts are in the CSP `resourceDomains`, see [MCP Apps SDK Patterns](#mcp-apps-sdk-patterns)). No listener plumbing, no 10 s timeout, no upstream mermaid runtime — `parseText` runs the full parse + layout pipeline and returns draw.io XML directly. The only wait before calling it is `waitForGraphViewer()`, because the cell factory still needs `Graph`, `mxCodec`, and `mxUtils` from `viewer-static.min.js`.

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
