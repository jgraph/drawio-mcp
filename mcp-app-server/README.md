# Draw.io MCP App Server

[![LightNow capabilities](https://lightnow.ai/badge/io.draw/mcp)](https://lightnow.ai/servers/io.draw/mcp)

The MCP App server renders draw.io diagrams **inline** in AI chat interfaces using the [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) protocol. Instead of opening a browser tab, diagrams appear directly in the conversation as interactive iframes.

## How It Works

1. The LLM calls the `create_diagram` tool with draw.io XML
2. The host fetches the UI resource and renders it in a sandboxed iframe
3. The diagram is rendered using the official [draw.io viewer](https://viewer.diagrams.net)
4. The user sees an interactive diagram inline with zoom, pan, and layers support

## Tool: `create_diagram`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `xml` | string | One of `xml` / `mermaid` | draw.io XML in mxGraphModel format. Mutually exclusive with `mermaid`. |
| `mermaid` | string | One of `xml` / `mermaid` | Mermaid.js diagram definition (28 supported diagram types — flowchart, sequence, class, state, ER, gantt, mindmap, timeline, quadrant, C4, architecture, …). Parsed and laid out natively, then converted to draw.io. Mutually exclusive with `xml`. |
| `postLayout` | enum | No | Optional ELK layered-flow pass applied after render. Only value: `"elk"`. Vertex positions are replaced; only edge topology survives. |
| `direction` | enum | No | XML-only flow direction for `postLayout: "elk"`: `"vertical"` (default) or `"horizontal"`. Ignored for Mermaid (direction comes from the `flowchart TD/LR` code). |

Provide exactly one of `xml` or `mermaid` as a plain string — not an object or array.

The rendered diagram includes:
- Interactive zoom, pan, and navigation
- Layer toggling and lightbox mode
- "Open in draw.io" button to edit the diagram in the full editor
- Fullscreen mode

## Tool: `get_drawio_reference`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | enum | Yes | `"xml"` returns [`shared/xml-reference.md`](../shared/xml-reference.md), `"mermaid"` returns [`shared/mermaid-reference.md`](../shared/mermaid-reference.md), verbatim. |

The `create_diagram` description tells the model to call this once per format before its first diagram in a conversation. The references used to be part of that description, which made it about 55,000 characters, too long for clients that index tool descriptions, such as VS Code Copilot's tool search ([#76](https://github.com/jgraph/drawio-mcp/issues/76)).

## Official Hosted Endpoint

The official draw.io MCP App server is hosted at:

```
https://mcp.draw.io/mcp
```

Add this URL as a remote MCP server in Claude.ai, ChatGPT, VS Code (GitHub Copilot), Cursor, or any MCP Apps-compatible host — no installation or setup required.

> **Note:** Diagrams appear **inline**, right in the chat, in hosts that support [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps): Claude.ai, ChatGPT, VS Code with GitHub Copilot (1.109 or later) and Cursor (2.6 or later). In other hosts, such as Claude Code, the server answers with a link that opens the diagram in draw.io. If you'd rather have diagrams open in your browser automatically, use the stdio [`@drawio/mcp`](../mcp-tool-server) tool server.

### Using with ChatGPT

1. Open [ChatGPT Plugins](https://chatgpt.com/plugins), select **+**, then **Add custom MCP server**.
2. Enter a name, for example *draw.io*, and under **Connection** the URL `https://mcp.draw.io/mcp`. The server needs no sign-in, so leave authentication off.
3. Confirm the warning with **I understand and want to continue**, select **Create as a plugin**, and install it.

In a new conversation, type `@`, pick draw.io, and ask for a diagram. If the option to add a custom MCP server is missing, your workspace admin may have turned it off.

### Using with VS Code

VS Code 1.109 and later shows diagrams inline in GitHub Copilot Chat. Add the server to `.vscode/mcp.json` in your workspace, or run **MCP: Open User Configuration** to add it for every workspace:

```json
{
  "servers": {
    "drawio": {
      "type": "http",
      "url": "https://mcp.draw.io/mcp"
    }
  }
}
```

Click **Start** above the server entry, confirm that you trust the folder if VS Code asks, then ask Copilot Chat in **Agent** mode to create a diagram.

### Using with GitHub Copilot CLI

Add the hosted endpoint from your terminal:

```bash
copilot mcp add --transport http drawio https://mcp.draw.io/mcp
```

Or, in a Copilot CLI session, enter `/mcp add`, name the server *drawio*, choose **HTTP** as the server type, paste `https://mcp.draw.io/mcp` as the URL, and press <kbd>Ctrl</kbd>+<kbd>S</kbd>. Both store it in `~/.copilot/mcp-config.json`, which you can also edit directly:

```json
{
  "mcpServers": {
    "drawio": {
      "type": "http",
      "url": "https://mcp.draw.io/mcp",
      "tools": ["*"]
    }
  }
}
```

Copilot CLI doesn't read VS Code's `.vscode/mcp.json`. To share the server with everyone working in a repository, put the same `mcpServers` entry in `.github/mcp.json`. See [Adding MCP servers for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

A terminal can't show the diagram inline, so `create_diagram` returns an `app.diagrams.net` link that opens it in the draw.io editor. If you'd rather have diagrams open in your browser directly, use the stdio [`@drawio/mcp`](../mcp-tool-server) tool server: `copilot mcp add drawio -- npx -y @drawio/mcp`. To create `.drawio` files and PNG, SVG or PDF exports in your project instead, install the [draw.io plugin for Copilot CLI](../plugins/copilot/README.md).

### Using with Cursor

Cursor supports the MCP Apps extension (Cursor **≥ 2.6**), so diagrams render inline in the Agent chat. On older builds the server still connects, but there's nothing to render inline; use the stdio [`@drawio/mcp`](../mcp-tool-server) tool server instead, which opens diagrams in the browser.

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=drawio&config=eyJ1cmwiOiJodHRwczovL21jcC5kcmF3LmlvL21jcCJ9)

Click the button above for one-click install, or add the hosted endpoint manually to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "drawio": {
      "url": "https://mcp.draw.io/mcp"
    }
  }
}
```

Enable the server when prompted (or under **Cursor Settings → MCP**), then ask the Agent to create a diagram.

### Using with OpenCode

[OpenCode](https://opencode.ai) connects to the hosted endpoint as a remote MCP server. Add it under the `mcp` key of `opencode.json` in your project root (or `~/.config/opencode/opencode.json` for every project):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "drawio": {
      "type": "remote",
      "url": "https://mcp.draw.io/mcp",
      "enabled": true
    }
  }
}
```

OpenCode has no MCP Apps UI, so nothing renders inline: `create_diagram` detects that and returns an `app.diagrams.net` link that opens the diagram in the editor instead. If you would rather have diagrams open in your browser directly (and also author them as Mermaid or CSV), use the stdio [`@drawio/mcp`](../mcp-tool-server/README.md#opencode) tool server.

## Self-Hosting

If you prefer to run your own instance, you can use Node.js, Docker, or deploy to Cloudflare Workers.

### Installation

```bash
cd mcp-app-server
npm install
```

### Running (Node.js)

Start the HTTP server (for Claude.ai and other web-based hosts):

```bash
npm start
```

The server listens on `http://localhost:3001/mcp` by default, on the loopback interface only. Set `PORT` to change the port, `LISTEN=0.0.0.0` to accept connections from the network, and `ALLOWED_HOSTS` (comma-separated hostnames) to reject requests whose `Host` header names anything else. The server has no authentication of its own — put it behind an authenticating reverse proxy before exposing it beyond your machine. `GET /health` answers `200 ok`, for uptime monitors and container health checks.

### Running (Docker)

A prebuilt image for `linux/amd64` and `linux/arm64` is published to Docker Hub as [`jgraph/drawio-mcp`](https://hub.docker.com/r/jgraph/drawio-mcp), tagged `latest` and with each server version:

```bash
docker run --rm -p 127.0.0.1:3001:3001 jgraph/drawio-mcp
```

The endpoint is `http://localhost:3001/mcp`, as with `npm start`. The image listens on all interfaces inside the container (`LISTEN=0.0.0.0`), so the `-p` mapping decides who can reach it: `127.0.0.1:3001:3001` is this machine only, a plain `3001:3001` is everyone on your network. Pass `-e PORT=8080 -p 127.0.0.1:8080:8080` to change the port, `-e ALLOWED_HOSTS=…` to restrict the accepted hostnames, and `-e DRAWIO_ICON_SERVICE_URL=off` to keep `search_shapes` from querying the draw.io icon service. The container is stateless (no volume, no diagram content in its logs) and needs no outbound access to render diagrams — see [Deployment boundary](DOCKER_HUB.md#deployment-boundary) and [Data Residency & Offline Use](../README.md#data-residency--offline-use).

To build the image yourself, use the [`Dockerfile`](Dockerfile) from the **repository root**, not from this directory — at startup the server reads the shared references and the shape index from the sibling `shared/` and `shape-search/` directories:

```bash
docker build -f mcp-app-server/Dockerfile -t drawio-mcp-app .
docker run --rm -p 127.0.0.1:3001:3001 drawio-mcp-app
```

### Connecting to Claude.ai

Since Claude.ai needs a public URL, use a tunnel:

```bash
npx cloudflared tunnel --url http://localhost:3001
```

Then add the tunnel URL (with `/mcp` appended) as a custom connector in Claude.ai settings.

### Using with Claude Desktop (stdio)

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "drawio-app": {
      "command": "node",
      "args": ["path/to/mcp-app-server/src/index.js", "--stdio"]
    }
  }
}
```

> **Note:** Diagrams appear inline in hosts that support the MCP Apps extension. In other hosts the tool still works and answers with a link that opens the diagram in draw.io.

## Deploying to Cloudflare Workers

The server can be deployed to Cloudflare Workers for a public endpoint without tunnels.

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- Node.js 18+

### Deploy

```bash
npm install
npx wrangler login        # One-time: authenticate with Cloudflare
npm run deploy             # Build + deploy to Workers
```

The deploy script runs `node src/build-html.js` (pre-inlines the SDK bundles into the HTML) then `wrangler deploy`.

### Local development with Wrangler

```bash
npm run dev:worker
```

This starts a local Workers dev server at `http://localhost:8787/mcp`.

### How the Worker entry differs from Node.js

| | Node.js (`src/index.js`) | Worker (`src/worker.js`) |
|---|---|---|
| **Transport** | `StreamableHTTPServerTransport` (Express) | `WebStandardStreamableHTTPServerTransport` (Web Standard `Request`/`Response`) |
| **HTML build** | Reads bundles from `node_modules` at startup | Pre-built at deploy time via `src/build-html.js` → `src/generated-html.js` |
| **Schema validation** | Default (Zod-based) | Default (Zod-based) |

## Publishing to the MCP Registry

The hosted server is listed in the [MCP Community Registry](https://github.com/modelcontextprotocol/registry) as **`io.draw/mcp`**, defined by [`server.json`](server.json) in this directory. The community registry feeds downstream surfaces such as [GitHub's MCP Registry](https://github.com/mcp) and VS Code's *MCP: Browse Servers* (GitHub additionally curates what it features on its own page).

**One-time setup** — prove ownership of the `draw.io` domain. Generate a keypair (macOS's system LibreSSL lacks Ed25519 — use Homebrew OpenSSL 3) and publish the public key as a DNS TXT record:

```bash
brew install mcp-publisher openssl@3
OPENSSL=/opt/homebrew/opt/openssl@3/bin/openssl
$OPENSSL genpkey -algorithm Ed25519 -out ~/.drawio-mcp-registry-key.pem
echo "draw.io. IN TXT \"v=MCPv1; k=ed25519; p=$($OPENSSL pkey -in ~/.drawio-mcp-registry-key.pem -pubout -outform DER | tail -c 32 | base64)\""
```

Add the printed TXT record on the **apex** of `draw.io` (record name `@` in Cloudflare DNS — not under a selector like `_mcp-auth`, which the registry will not see). Keep the key file for future publishes, and keep it outside the repository; losing it only means generating a new key and replacing the TXT record (remove the stale record — leftovers are tried first and break verification).

**Publish / update** — bump `version` in `server.json` first (kept in lockstep with `package.json`), then from this directory:

```bash
OPENSSL=/opt/homebrew/opt/openssl@3/bin/openssl
mcp-publisher login dns --domain draw.io --private-key "$($OPENSSL pkey -in ~/.drawio-mcp-registry-key.pem -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"
mcp-publisher publish
```

The `io.draw` namespace is the reverse-DNS form of the verified `draw.io` domain (the same pattern as the registry's own `io.modelcontextprotocol/everything`). The alternative would be `io.github.jgraph/...` via `mcp-publisher login github`, but that requires jgraph org-owner rights and gives up the brand naming.

## Architecture

### File layout

```
src/
  shared.js          Shared logic: buildHtml(), processAppBundle(), createServer()
  index.js           Node.js entry (Express + stdio transports)
  worker.js          Cloudflare Workers entry (Web Standard fetch handler)
  build-html.js      Build script: generates generated-html.js + the references
  generated-html.js  (gitignored) Pre-built HTML string + references for the Worker
test/
  tools.test.js      Tool description length cap + get_drawio_reference (npm test)
wrangler.toml        Wrangler configuration
../shared/
  xml-reference.md      Shared XML generation reference (single source of truth)
  mermaid-reference.md  Shared Mermaid syntax reference
```

The references `get_drawio_reference` returns are loaded from `shared/xml-reference.md` and `shared/mermaid-reference.md` at startup (Node.js) or pre-built into `generated-html.js` at deploy time (Workers). These files are the single source of truth for diagram generation guidance across all four approaches in the repository.

### How the HTML is built

The server inlines two bundles into a self-contained HTML string:

- **`app-with-deps.js`** (~319 KB) — MCP Apps SDK browser bundle from `@modelcontextprotocol/ext-apps`. The bundle is ESM (ends with `export { ... as App }`), so the server strips the export statement and creates a local `var App = <minifiedName>` alias. This makes it safe to inline in a plain `<script>` tag inside the sandboxed iframe.
- **`pako_deflate.min.js`** (~28 KB) — for compressing XML into the "Open in draw.io" `#create=` link.

Both are inlined into the HTML served via `registerAppResource`. The draw.io viewer (`viewer-static.min.js`) is loaded from CDN at runtime.

For **Node.js**, this happens at startup (bundles read from `node_modules` via `fs`). For **Workers**, the `build-html.js` script does this at build time and writes `generated-html.js`.

### Key constraints

- The MCP Apps sandbox uses `sandbox="allow-scripts"` but **not** `allow-same-origin`, so Blob URL module imports fail silently. That's why the ESM export statement is stripped and a plain `var` alias is created.
- `app.openLink()` must be used instead of `<a target="_blank">` since the sandbox doesn't have `allow-popups`.
- `GraphViewer.processElements()` requires the container to have a nonzero `offsetWidth`, hence the `min-width: 200px` on `#diagram-container`.
