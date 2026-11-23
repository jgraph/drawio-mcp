# Draw.io MCP App Server

The MCP App server renders draw.io diagrams **inline** in AI chat interfaces using the [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) protocol. Instead of opening a browser tab, diagrams appear directly in the conversation as interactive iframes.

## How It Works

1. The LLM calls the `create_diagram` tool with draw.io XML or Mermaid (or PlantUML or draw.io CSV the user gives it), or, when the user asks for a quick or cheap flowchart, `create_semantic_diagram` with a description that the server lays out
2. The host fetches the UI resource and renders it in a sandboxed iframe
3. The diagram is rendered using the official [draw.io viewer](https://viewer.diagrams.net)
4. The user sees an interactive diagram inline with zoom, pan, and layers support

## Tool: `create_diagram`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `xml` | string | One of the four | draw.io XML in mxGraphModel format. |
| `mermaid` | string | One of the four | Mermaid.js diagram definition (28 supported diagram types — flowchart, sequence, class, state, ER, gantt, mindmap, timeline, quadrant, C4, architecture, …). Flowcharts, ER and sequence diagrams are converted on the server into editable draw.io shapes, laid out and styled; the other types are parsed and laid out natively in the viewer, then converted to draw.io. |
| `plantuml` | string | One of the four | PlantUML from `@startuml` to `@enduml` (or the `@start…`/`@end…` lines of its type). Sequence diagrams and activity diagrams in the new syntax are converted on the server into editable draw.io shapes, laid out and styled. The other types are converted in the viewer by draw.io's PlantUML converter (drawio-plantuml), as draw.io's *Arrange > Insert > Advanced > PlantUML* does; no PlantUML server. "Open in draw.io" keeps their source, so the diagram can be edited as PlantUML there. |
| `csv` | string | One of the four | draw.io CSV: `#` configuration lines (label, style, connect, layout, …), a header line and one line per shape, as *Arrange > Insert > Advanced > CSV* imports it. `%column%` placeholders work in labels and styles. Converted on the server into editable draw.io shapes, each row keeping its columns as shape data; `# list`, `# container` and the `circle` and custom layouts are imported in the viewer instead (with `DRAWIO_CONVERT=off` everything is, in every layout but `orgchart`). |
| `postLayout` | enum | No | Optional ELK layered-flow pass applied after render. Only value: `"elk"`. Vertex positions are replaced; only edge topology survives. |
| `direction` | enum | No | XML-only flow direction for `postLayout: "elk"`: `"vertical"` (default) or `"horizontal"`. Ignored for Mermaid (direction comes from the `flowchart TD/LR` code). |

Provide exactly one of `xml`, `mermaid`, `plantuml` or `csv` as a plain string — not an object or array. `postLayout`, `direction` and `routing` don't apply to PlantUML and CSV.

The rendered diagram includes:
- Interactive zoom, pan, and navigation
- Layer toggling and lightbox mode
- "Open in draw.io" button to edit the diagram in the full editor
- Copy the diagram XML; download it as a `.drawio` file, PNG or SVG and copy it as a PNG or SVG where the host allows it
- Fullscreen mode

## Tool: `get_drawio_reference`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | enum | Yes | `"xml"` returns [`shared/xml-reference.md`](../shared/xml-reference.md), `"mermaid"` returns [`shared/mermaid-reference.md`](../shared/mermaid-reference.md), verbatim. |

The `create_diagram` description tells the model to call this once per format before its first diagram in a conversation. The references used to be part of that description, which made it about 55,000 characters, too long for clients that index tool descriptions, such as VS Code Copilot's tool search ([#76](https://github.com/jgraph/drawio-mcp/issues/76)).

## Tool: `create_semantic_diagram` (on request)

The fast mode: a second way to draw flowcharts and swimlane diagrams, for when the user asks for a quick one. The model describes what the diagram contains: the steps with their kind (start, step, decision, end, …), the lanes, the transitions, and a row and a column for every step in one grid. It never writes coordinates, sizes or styles. The server lays the description out, routes the lines and styles it in the calm theme. Writing a description is quicker than placing every shape as XML, and it needs fewer tokens.

The diagram is shown like one from `create_diagram`, with the same viewer, toolbar, "Open in draw.io" and layout check, and the viewer draws it while the description streams in. To change the diagram, the model sends the whole description again with the change, the same ids and the `layout` of the last result, a short text that keeps the shapes the change doesn't touch in place (the server stores nothing).

The tool is listed by default, but its description has the model use it only when the user asks for a quick, rough or cheap diagram, in so many words and in any language. For every other request, however simple the diagram, and for every other type the model uses `create_diagram`, which places the shapes with more care.

| Request | Tool |
|---|---|
| "**Quickly** draw a simple flowchart of returning a book at a library kiosk …" | `create_semantic_diagram` |
| "Draw a swimlane diagram … for requesting a new laptop. **Just a rough sketch is fine.**" | `create_semantic_diagram` |
| "Draw a flowchart of an express parcel delivery … **Keep it cheap: use as few tokens as possible.**" | `create_semantic_diagram` |
| "Zeichne **schnell** ein Flussdiagramm für eine Pizzabestellung …" | `create_semantic_diagram` |
| "Zeichne ein Swimlane-Diagramm … für einen Urlaubsantrag. **Bitte mit wenig Aufwand.**" | `create_semantic_diagram` |
| "Erstelle **sparsam** ein Swimlane-Diagramm …" | `create_semantic_diagram` |
| "Draw a simple flowchart of …", "Zeichne ein übersichtliches Swimlane-Diagramm …" (no wish) | `create_diagram` |
| "Draw **a quick draft** of an architecture diagram on AWS …", "Erstelle mir **auf die Schnelle** ein Organigramm …" (another type) | `create_diagram` |

Measured on 15 November 2026 with the bench in [`bench/`](../bench/README.md#the-tool-choice-on-request) (Claude Code with Sonnet 5.5 and Opus 5.5; 20 prompts in English and German written for the test, with and without the wish; three runs each):

- **The tool choice:** the models chose as above in 118 of 120 sessions.
- **Time and tokens:** with the wish, the flowcharts reached the diagram in a median 14 s instead of 46 s (Sonnet) and 27 s instead of 108 s (Opus), with less than half the output tokens.
- **Quality:** in blind judgements against the XML the models placed themselves, the flowcharts won 0.61 (Sonnet) and 0.67 (Opus). Each model lost on one flowchart without lanes.
- **Earlier measurement:** offered for every request, on held-out flowchart and swimlane prompts without any wish, Sonnet took a median 17 s to the diagram instead of 63 s and Opus 56 s instead of 339 s ([`MEASUREMENTS.md`](../shared/semantic/MEASUREMENTS.md), seventh measurement, November 2026).

Details, and what to measure again when the wording changes, are in [`shared/semantic/FAST-MODE.md`](../shared/semantic/FAST-MODE.md).

`DRAWIO_SEMANTIC_TYPES` changes what it offers:

| Value | Offers |
|---|---|
| unset, or `on` (or `true`, `1`) | Flowcharts and swimlane diagrams, the types that passed the blind judgement (the default) |
| A comma-separated list, e.g. `on,er` | The types it names: `flowchart`, `swimlane`, `architecture`, `network`, `er`. `on` in the list adds the types of `on`, and unknown names are dropped. `swimlane` offers flowcharts too, and `network` offers architecture diagrams. The types other than flowcharts and swimlanes are for trying out: they have not passed the judgement |
| `off` | Nothing: the tool isn't listed, and `tools/list` has `create_diagram`, `search_shapes` and `get_drawio_reference` alone |

Every type offered is offered on request. Where to set it:

- **Node.js** reads it at startup, for HTTP and `--stdio`: `DRAWIO_SEMANTIC_TYPES=off npm start`
- **Docker**: `docker run --rm -e DRAWIO_SEMANTIC_TYPES=off -p 127.0.0.1:3001:3001 jgraph/drawio-mcp`
- **Cloudflare Workers** read it when the HTML is built, before the upload, so set it in the shell that deploys: `DRAWIO_SEMANTIC_TYPES=off npm run deploy`. A deploy without the variable offers the default.

**Size rules.** A diagram above a type's limit gets an error that sends the model to `create_diagram`, so it draws the diagram as XML instead, and the frame of the refused call shows a short note in place of the diagram. The model isn't told the limits: when it knew them, it left steps out to stay under them. So it describes the whole diagram, and the size of that description decides. The limits come from the blind judgements, where larger diagrams lost against the model's own XML:

- A flowchart without lanes (no step in a lane or group) is drawn with up to 24 steps. Diagrams with lanes have no limit.
- Architecture and network diagrams (offered only by name) are drawn with up to 18 nodes.

## Official Hosted Endpoint

The official draw.io MCP App server is hosted at:

```
https://mcp.draw.io/mcp
```

Add this URL as a remote MCP server in Claude.ai, ChatGPT, VS Code (GitHub Copilot), Cursor, or any MCP Apps-compatible host — no installation or setup required.

> **Note:** Diagrams appear **inline**, right in the chat, in hosts that support [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps): Claude.ai, ChatGPT, VS Code with GitHub Copilot (1.109 or later) and Cursor (2.6 or later). In other hosts, such as Claude Code, the server answers with a link that opens the diagram in draw.io. If you'd rather have diagrams open in your browser automatically, use the stdio [`@drawio/mcp`](../mcp-tool-server) tool server.

### Using with ChatGPT

draw.io is listed in OpenAI's plugin directory, shared by ChatGPT and Codex: open [draw.io in ChatGPT Plugins](https://chatgpt.com/plugins/plugin_asdk_app_6abea666ca5081919375ed8d1d38da95) and select **Install plugin**. To add the server yourself instead:

1. Open [ChatGPT Plugins](https://chatgpt.com/plugins), select **+**, then **Add custom MCP server**.
2. Enter a name, for example *draw.io*, and under **Connection** the URL `https://mcp.draw.io/mcp`. The server needs no sign-in, so leave authentication off.
3. Confirm the warning with **I understand and want to continue**, select **Create as a plugin**, and install it.

In a new conversation, type `@`, pick draw.io, and ask for a diagram. If the option to add a custom MCP server is missing, your workspace admin may have turned it off.

The server lists four tools: `create_diagram`, `search_shapes`, `get_drawio_reference` and [`create_semantic_diagram`](#tool-create_semantic_diagram-on-request), the fast mode. ChatGPT keeps the tool list it scanned, so a deploy that changes the list reaches the published plugin only after a rescan ([`OPENAI-SUBMISSION.md`](OPENAI-SUBMISSION.md)).

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

OpenCode has no MCP Apps UI, so nothing renders inline: `create_diagram` detects that and returns an `app.diagrams.net` link that opens the diagram in the editor instead. If you would rather have diagrams open in your browser directly, use the stdio [`@drawio/mcp`](../mcp-tool-server/README.md#opencode) tool server.

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

The server listens on `http://localhost:3001/mcp` by default, on the loopback interface only. Set `PORT` to change the port and `LISTEN=0.0.0.0` to accept connections from the network. `AUTH_TOKEN` (or `AUTH_TOKEN_FILE`) requires a bearer token, `ALLOWED_ORIGINS` sets the browser origins it answers and `ALLOWED_HOSTS` the hostnames: see [Security](#security) before you run it on a machine you share or open it to the network. Set `DRAWIO_BASE_URL` to a self-hosted draw.io (e.g. `https://drawio.example.com/`) to have "Open in draw.io" and the link for clients without inline diagrams open there instead of `https://app.diagrams.net/`; the inline viewer still loads from diagrams.net, so it needs no sign-in to your draw.io. Set `DRAWIO_SEMANTIC_TYPES=off` to leave out [`create_semantic_diagram`](#tool-create_semantic_diagram-on-request), the fast mode, which is listed by default, and `DRAWIO_CONVERT=off` to leave Mermaid, PlantUML and CSV to the viewer's converters instead of converting them on the server. `GET /health` answers `200 ok`, for uptime monitors and container health checks. At startup the server prints its bind address, whether authentication is on, and the hosts and origins it answers, with a warning when it listens beyond loopback without a token.

### Running (Docker)

A prebuilt image for `linux/amd64` and `linux/arm64` is published to Docker Hub as [`jgraph/drawio-mcp`](https://hub.docker.com/r/jgraph/drawio-mcp), tagged `latest` and with each server version:

```bash
docker run --rm -p 127.0.0.1:3001:3001 jgraph/drawio-mcp
```

The endpoint is `http://localhost:3001/mcp`, as with `npm start`. The image listens on all interfaces inside the container (`LISTEN=0.0.0.0`), so the `-p` mapping decides who can reach it: `127.0.0.1:3001:3001` is this machine only, a plain `3001:3001` is everyone on your network, and Docker's port rules bypass ufw and firewalld, so your firewall doesn't stop it ([Security](#security)). Pass `-e PORT=8080 -p 127.0.0.1:8080:8080` to change the port, `-e AUTH_TOKEN` or `-e AUTH_TOKEN_FILE=…` to require a token, `-e ALLOWED_HOSTS=…` to restrict the accepted hostnames, `-e DRAWIO_BASE_URL=https://drawio.example.com/` to open diagrams in a self-hosted draw.io, `-e DRAWIO_ICON_SERVICE_URL=off` to keep `search_shapes` from querying the draw.io icon service, and `-e DRAWIO_SEMANTIC_TYPES=off` to leave out [`create_semantic_diagram`](#tool-create_semantic_diagram-on-request). The container is stateless (no volume, no diagram content in its logs) and needs no outbound access to render diagrams — see [Deployment boundary](DOCKER_HUB.md#deployment-boundary) and [Data Residency & Offline Use](../README.md#data-residency--offline-use).

To build the image yourself, use the [`Dockerfile`](Dockerfile) from the **repository root**, not from this directory — at startup the server reads the shared references and the shape index from the sibling `shared/` and `shape-search/` directories:

```bash
docker build -f mcp-app-server/Dockerfile -t drawio-mcp-app .
docker run --rm -p 127.0.0.1:3001:3001 drawio-mcp-app
```

### Security

The Node server and the Docker image are built for one person on their own machine: by default they are reachable from this machine only (the image with `-p 127.0.0.1:…`), keep no state and need no sign-in. What a caller can do is use the four tools. The server stores nothing (no diagrams, files, credentials or sessions to read), so a caller can't see your diagrams, but they can have it render diagrams for them, use its CPU and have it query the draw.io icon service. Before it runs on a machine you share or on a network, check these:

- **Loopback is not an auth boundary.** `127.0.0.1` keeps the server off the network, not off the machine: every user and every process on it (another agent, a script, a package's install script) can call the port. On a shared dev box or a team server, set a token. With `AUTH_TOKEN`, or `AUTH_TOKEN_FILE` naming a file that holds it (a Docker or Compose secret), `/mcp` answers only requests that send `Authorization: Bearer <token>`; others get `401` with a `WWW-Authenticate: Bearer` header. The token is compared in constant time and never logged, `GET /health` stays open for health checks, and a setting that would leave authentication off by mistake (both variables, an empty token, a file it can't read) stops the server at startup. It is off by default, so existing setups keep working. What it can't do: a process running as your own user can read the token from your MCP client's configuration, as it can read anything else of yours, so the token keeps out other users, the network and callers that don't have it, not code you run yourself.
- **Docker publishes past your firewall.** `-p 3001:3001` (or `ports: ["3001:3001"]` in Compose) publishes the port on every interface of the host, and Docker inserts its own packet filter rules ahead of ufw and firewalld, so the firewall doesn't block it. Always name the address, `-p 127.0.0.1:3001:3001`. The image has to listen on all interfaces inside the container for `-p` to work, so it can't see how you published it, and it warns at startup whenever no token is set.
- **The Origin check stops DNS rebinding.** A web page you open can point its own hostname at `127.0.0.1` and call a local server from your browser. As the [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#security-warning) requires, the server checks the `Origin` header: requests that carry one are answered only from `http(s)://localhost`, `127.0.0.1` or `[::1]` (any port), others get `403`. Requests without an `Origin` pass, since MCP clients outside a browser (Claude Code, VS Code, Cursor, Copilot CLI, and the cloud hosts behind a tunnel) send none. For a client that runs in a browser, list its origins in `ALLOWED_ORIGINS` (comma-separated, e.g. `https://chat.example.com`), which replaces the default; `*` turns the check off.
- **`ALLOWED_HOSTS` checks the `Host` header.** With a comma-separated list of hostnames, the server refuses requests addressed to any other name. That stops DNS rebinding too, since a rebound page sends its own name, and pins a team server to the name it is reached by. It is off by default because tunnels such as cloudflared and Tailscale Funnel connect to localhost but forward their public hostname.
- **For a team, put a reverse proxy in front.** Let a reverse proxy terminate TLS (the token travels in plain HTTP otherwise) and authenticate clients in a way your MCP clients support, keep the server on loopback or an internal network behind it, and set `ALLOWED_HOSTS` to the proxy's hostname. The token can stay on as a second check.
- **The hosted endpoint and the Worker are public by design.** `https://mcp.draw.io/mcp` and the [Cloudflare Workers](#deploying-to-cloudflare-workers) entry have none of these settings; to restrict a Worker of your own, put Cloudflare Access in front of it.

Run with a token, generated once and kept out of your shell history:

```bash
export DRAWIO_MCP_TOKEN="$(openssl rand -hex 32)"
AUTH_TOKEN="$DRAWIO_MCP_TOKEN" npm start
# or
AUTH_TOKEN="$DRAWIO_MCP_TOKEN" docker run --rm -e AUTH_TOKEN -p 127.0.0.1:3001:3001 jgraph/drawio-mcp
```

`-e AUTH_TOKEN` without a value passes the variable from your shell, so the token isn't on the command line; `docker inspect` still shows it to anyone who can use Docker. A file doesn't show there. In Compose, as a secret:

```yaml
services:
  drawio-mcp:
    image: jgraph/drawio-mcp
    ports:
      - "127.0.0.1:3001:3001"
    environment:
      AUTH_TOKEN_FILE: /run/secrets/drawio_mcp_token
    secrets:
      - drawio_mcp_token

secrets:
  drawio_mcp_token:
    file: ./drawio-mcp-token   # the token alone, readable by the container's user node (uid 1000)
```

With plain `docker run`, mount the file instead: `-v "$PWD/drawio-mcp-token:/run/secrets/drawio_mcp_token:ro" -e AUTH_TOKEN_FILE=/run/secrets/drawio_mcp_token`.

The client then sends the header. In VS Code, `.vscode/mcp.json` asks for the token once and stores it encrypted:

```json
{
  "inputs": [
    { "type": "promptString", "id": "drawio-token", "description": "draw.io MCP token", "password": true }
  ],
  "servers": {
    "drawio": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": { "Authorization": "Bearer ${input:drawio-token}" }
    }
  }
}
```

| Client | Where the header goes |
|---|---|
| Claude Code | `claude mcp add --transport http drawio http://localhost:3001/mcp --header "Authorization: Bearer $DRAWIO_MCP_TOKEN"` |
| GitHub Copilot CLI | `"headers": { "Authorization": "Bearer <token>" }` in the server's entry in `~/.copilot/mcp-config.json` |
| Cursor | `"headers": { "Authorization": "Bearer ${env:DRAWIO_MCP_TOKEN}" }` next to `"url"` in `mcp.json` |
| OpenCode | `"headers": { "Authorization": "Bearer {env:DRAWIO_MCP_TOKEN}" }` in the remote server's entry in `opencode.json` |
| Claude.ai, through a tunnel | Not possible: custom connectors sign in with OAuth or not at all (see [Connecting to Claude.ai](#connecting-to-claudeai)) |

The startup output says which of this is in effect, before any client connects:

```
MCP App server listening on http://127.0.0.1:3001/mcp
  Bind address:     127.0.0.1 (loopback: only this machine can connect)
  Authentication:   off: anyone who can connect can call the tools (set AUTH_TOKEN or AUTH_TOKEN_FILE)
  Allowed hosts:    any Host header (set ALLOWED_HOSTS to restrict)
  Allowed origins:  http(s)://localhost, 127.0.0.1 and [::1], any port (set ALLOWED_ORIGINS to change); requests without an Origin header (MCP clients outside a browser) pass
  Shared machine:   NOT SAFE: the bind address is no auth boundary, any user or process on this machine can call it; set AUTH_TOKEN
```

### Connecting to Claude.ai

Since Claude.ai needs a public URL, use a tunnel:

```bash
npx cloudflared tunnel --url http://localhost:3001
```

Then add the tunnel URL (with `/mcp` appended) as a custom connector in Claude.ai settings. The tunnel makes the server public: anyone who has the URL can use it, and Claude.ai's custom connectors sign in with OAuth or not at all, so they can't send an `AUTH_TOKEN`. Stop the tunnel when you're done.

Claude.ai and the draw.io plugin for Claude Code, which bundles the hosted server, read the tool list from the server, so [`create_semantic_diagram`](#tool-create_semantic_diagram-on-request) appears there with the deploy that lists it; `DRAWIO_SEMANTIC_TYPES=off` leaves it out of a self-hosted server.

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

To open diagrams in a self-hosted draw.io, set `DRAWIO_BASE_URL` in the shell that deploys, since the HTML is built before the upload (a `[vars]` entry in `wrangler.toml` would come too late):

```bash
DRAWIO_BASE_URL=https://drawio.example.com/ npm run deploy
```

[`create_semantic_diagram`](#tool-create_semantic_diagram-on-request) is set the same way: `DRAWIO_SEMANTIC_TYPES=off npm run deploy` deploys without it, or `DRAWIO_SEMANTIC_TYPES=off npx wrangler deploy --env staging` for staging (`wrangler deploy` builds the HTML itself, in the same shell).

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

**The npm package** — `server.json` also lists the tool server, `@drawio/mcp` on npm, under `packages`, next to the hosted endpoint under `remotes`. The registry accepts that entry only when the `package.json` of the npm version it names carries `"mcpName": "io.draw/mcp"`, the server's name: 1.13.1 is the first release with it, 1.13.0 and earlier were published without it. Before each publish, set `packages[0].version` to the current npm release (release the tool server first when it has changes of its own) and check that npm has it with `mcpName`:

```bash
npm view "@drawio/mcp@$(node -p "require('./server.json').packages[0].version")" mcpName   # must print io.draw/mcp
```

The registry takes each `version` of `io.draw/mcp` once, and that `version` follows the app server's, so a tool server release alone can't be published here: it is listed with the next app server release. `test/server-json.test.js` checks the entry against the tool server's `package.json`: the same package and name, and a version from 1.13.1 up to the one there.

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
