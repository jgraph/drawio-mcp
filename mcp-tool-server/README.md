# Draw.io MCP Tool Server

The official [draw.io](https://www.draw.io) MCP server that opens diagrams directly in the draw.io editor. Supports XML, CSV, and Mermaid.js formats with lightbox and dark mode options.

This package is part of the [drawio-mcp](https://github.com/jgraph/drawio-mcp) repository, which also includes:

- **[MCP App Server](https://github.com/jgraph/drawio-mcp/tree/main/mcp-app-server)** — Renders diagrams inline in AI chat interfaces. Hosted at `https://mcp.draw.io/mcp` — no install required.
- **[Claude Code Plugin](https://github.com/jgraph/drawio-mcp/tree/main/plugins/claude-code)** — Claude Code plugin that generates native `.drawio` files with optional PNG/SVG/PDF export.
- **[Project Instructions](https://github.com/jgraph/drawio-mcp/tree/main/project-instructions)** — Zero-install approach using Claude Project instructions.

## Features

- **Open XML diagrams**: Load native draw.io/mxGraph XML format
- **Import CSV data**: Convert tabular data to diagrams (org charts, flowcharts, etc.)
- **Render Mermaid.js**: Transform Mermaid syntax into editable draw.io diagrams
- **Customizable display**: Lightbox mode, dark mode, and more

## Installation

### Using npx (recommended)

```bash
npx @drawio/mcp
```

### Global installation

```bash
npm install -g @drawio/mcp
drawio-mcp
```

### From source

```bash
git clone https://github.com/jgraph/drawio-mcp.git
cd drawio-mcp/mcp-tool-server
npm install
npm start
```

## Configuration

### Claude Desktop

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "drawio": {
      "command": "npx",
      "args": ["@drawio/mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add drawio -- npx -y @drawio/mcp
```

Or manually in `.claude/settings.json`:

```json
{
  "mcpServers": {
    "drawio": {
      "command": "npx",
      "args": ["-y", "@drawio/mcp"]
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json` in your workspace (or run **MCP: Open User Configuration** for a global config):

```json
{
  "servers": {
    "drawio": {
      "command": "npx",
      "args": ["-y", "@drawio/mcp"]
    }
  }
}
```

Then click **Start** above the server entry, **trust** the server when prompted, switch Copilot Chat to **Agent mode**, and make sure the drawio tools are enabled under **Configure Tools** (🔧) in the chat input.

Other clients that use stdio (Windsurf, etc.) use the same config shape as above.

> **Tip:** VS Code 1.109 and later also supports the [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) extension, so the hosted [MCP App Server](../mcp-app-server) at `https://mcp.draw.io/mcp` works in Copilot Chat too, rendering diagrams *inline* in chat instead of opening a browser tab. To use it, replace `command` and `args` above with `"type": "http"` and `"url": "https://mcp.draw.io/mcp"`. Use this stdio server if you prefer diagrams to open in the full draw.io editor.

### Cursor

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=drawio&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBkcmF3aW8vbWNwIl19)

Click the button above for one-click install, or add the server manually to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "drawio": {
      "command": "npx",
      "args": ["-y", "@drawio/mcp"]
    }
  }
}
```

Enable the server when prompted (or under **Cursor Settings → MCP**), then ask the Agent to create a diagram — it opens in the draw.io editor in your browser.

> **Tip:** Cursor also supports the [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) extension, so the hosted [MCP App Server](../mcp-app-server) at `https://mcp.draw.io/mcp` works in Cursor too, rendering diagrams *inline* in chat instead of opening a browser tab. Use this stdio server if you prefer diagrams to open in the full draw.io editor.

### OpenCode

Add the server under the `mcp` key of `opencode.json` in your project root (or `~/.config/opencode/opencode.json` for every project):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "drawio": {
      "type": "local",
      "command": ["npx", "-y", "@drawio/mcp"],
      "enabled": true
    }
  }
}
```

The tools are available on the next start; ask the agent to create a diagram and it opens in the draw.io editor in your browser.

> **Tip:** OpenCode also loads the `drawio` *skill* (native `.drawio` files, PNG/SVG/PDF export) without any plugin wrapper — see the [plugins README](../plugins/README.md#opencode-no-plugin-needed).

### Other MCP Clients

Configure your MCP client to run the server via stdio:

```bash
npx @drawio/mcp
```

### Self-hosted draw.io

To open diagrams in a self-hosted draw.io instance, set the `DRAWIO_BASE_URL` environment variable to your instance URL (default: `https://app.diagrams.net/`):

```json
{
  "mcpServers": {
    "drawio": {
      "command": "npx",
      "args": ["-y", "@drawio/mcp"],
      "env": {
        "DRAWIO_BASE_URL": "https://drawio.example.com/"
      }
    }
  }
}
```

### Return the link without opening a browser

Every `open_drawio_*` call opens the diagram in your default browser and returns its URL. Set `DRAWIO_BROWSER` to `off` to get only the URL. Use this for headless agents, CI and SSH sessions, where there is no browser or it would open on the wrong machine:

```json
{
  "mcpServers": {
    "drawio": {
      "command": "npx",
      "args": ["-y", "@drawio/mcp"],
      "env": {
        "DRAWIO_BROWSER": "off"
      }
    }
  }
}
```

## Tools

### `open_drawio_xml`

Opens the draw.io editor with XML content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | Yes | Draw.io XML content |
| `lightbox` | boolean | No | Read-only view mode (default: false) |
| `dark` | string | No | "auto", "true", or "false" (default: "auto") |
| `postLayout` | string | No | `"elk"` re-lays out the diagram (ELK layered flow) before opening: vertices are placed, edges routed |
| `direction` | string | No | Flow direction for `postLayout`: `"vertical"` (default) or `"horizontal"` |
| `routing` | string | No | `"libavoid"` reroutes connectors around shapes (obstacle-avoiding orthogonal routing) before opening, leaving positions untouched |

Every diagram is repaired first: text around it is dropped (a leaked tool-call tag, a code fence), `<` and stray `&` in attribute values are escaped, and a layer written as its own parent is re-parented — the slips that broke 3% of LLM-written diagrams in tests. A layout or routing option the model wrote into the XML string by mistake is still applied. Then every diagram is normalized on the way through, the way the draw.io editor maintains its own model: edges are filed at the nearest common ancestor of their terminals (so you can keep writing `parent="1"` on every edge and containers still lay out correctly), an edge written without a geometry gets one (it would not render otherwise), and a container that would clip a child is grown to fit it. The same repairs the draw.io Desktop CLI applies with `--normalize`.

`postLayout` and `routing` are alternatives: ELK places the vertices *and* routes the edges, libavoid only fixes the connectors of a layout you placed yourself. Both run on the server before the diagram is compressed into the URL; the diagram itself still never leaves your machine (it travels in the URL fragment). The ELK pass loads the `drawio-elk` bundle from the draw.io CDN on first use and caches it per user, so the first layout after an update pays a one-off download.

### `open_drawio_csv`

Opens the draw.io editor with CSV data converted to a diagram.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | Yes | CSV content |
| `lightbox` | boolean | No | Read-only view mode (default: false) |
| `dark` | string | No | "auto", "true", or "false" (default: "auto") |

### `open_drawio_mermaid`

Opens the draw.io editor with a Mermaid.js diagram.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | Yes | Mermaid.js syntax |
| `lightbox` | boolean | No | Read-only view mode (default: false) |
| `dark` | string | No | "auto", "true", or "false" (default: "auto") |
| `postLayout` | string | No | `"elk"` switches a Mermaid **flowchart** to the layered ELK layout (direction still follows the flowchart code). Ignored for other diagram types |

`postLayout` costs nothing here: it selects the layout in the Mermaid source (a `config: { layout: elk }` frontmatter block) and draw.io applies it while converting the diagram — the same result as writing that frontmatter yourself.

### `get_drawio_reference`

Returns a full diagram generation reference: [`shared/mermaid-reference.md`](../shared/mermaid-reference.md), which the model reads before its first Mermaid diagram, or [`shared/xml-reference.md`](../shared/xml-reference.md), which `open_drawio_xml` only needs for layers, tags, metadata, tables, cross-functional grids and dark-mode colors — its description already carries the condensed [`shared/xml-essentials.md`](../shared/xml-essentials.md).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | Yes | `"xml"` or `"mermaid"` |

### `search_shapes`

Searches the draw.io shape library (~10,000 shapes: AWS, Azure, GCP, Cisco, Kubernetes, P&ID, electrical, BPMN, …) and returns matching shapes with ready-to-use style strings for `open_drawio_xml`. When the built-in libraries have no good match, results are supplemented from the draw.io icon service (brand logos and general-purpose concept icons, e.g. `react`, `slack`, `shopping cart`). Use only for diagrams needing industry-specific, branded, or pictorial icons — standard flowcharts, UML, ERD, and org charts don't need it.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Space-separated keywords (e.g. `aws lambda`, `cisco router`) |
| `limit` | number | No | Max results (default: 10, max: 50) |

### `list_pages` / `get_page` / `set_page`

Page-level access to a local multi-page `.drawio` file, so one page can be inspected or edited without loading the whole file. Pages are addressed by zero-based index, exact name, or id (as returned by `list_pages`). Compressed pages are decompressed/re-compressed transparently. Paths must end in `.drawio` or `.xml`.

| Tool | Parameters | Result |
|------|------------|--------|
| `list_pages` | `path` | `[{index, id, name, approxSizeBytes}]` for every page |
| `get_page` | `path`, `page` | The page's `mxGraphModel` XML |
| `set_page` | `path`, `page`, `content` | Replaces that page's content (a single `<mxGraphModel>` element); all other pages stay untouched |

#### Diagrams in Google Drive, OneDrive, Dropbox, GitHub or GitLab

These tools work on local files only. The server can't read your cloud storage, and a draw.io link always opens a new, untitled diagram, never a file you saved. A link that changed a saved file would let anyone who sends you a link rewrite your diagrams. To have the agent change a diagram in the cloud, go through the draw.io tab where you have it open:

1. In draw.io, choose **Extras > Edit Diagram** (**Insert > Advanced > Edit Diagram** in the Simple and Minimal themes). Copy the XML of the current page and give it to the agent.
2. Ask the agent to reply with the changed XML.
3. Open **Edit Diagram** again, replace the XML with the agent's, and click **Apply**. draw.io saves the change to the same file, under the same link, like any other edit.

This works one page at a time. Downloading the file, changing it with `set_page` and uploading it again also works, but a draw.io tab that has the file open can save over your upload.

## Example Prompts

- "Use `open_drawio_mermaid` to create a sequence diagram showing OAuth2 authentication flow"
- "Use `open_drawio_csv` to create an org chart: CEO → CTO, CFO; CTO → 3 Engineers"
- "Use `open_drawio_xml` to create a detailed AWS architecture diagram with VPC, subnets, and security groups"

> **Tip:** Claude Desktop may have multiple ways to create diagrams. To ensure it uses the draw.io MCP, mention the tool name explicitly or add a system instruction:
> *"Always use the draw.io MCP tools to create diagrams."*

## How It Works

1. The MCP server receives diagram content (XML, CSV, or Mermaid)
2. Content is compressed using pako deflateRaw and encoded as base64
3. A draw.io URL is generated with the diagram in its hash: `#R` for XML, `#create=` for Mermaid and CSV, which draw.io converts in the browser
4. The URL is returned to the LLM, which can present it to the user
5. Opening the URL loads draw.io with the diagram ready to view/edit

The `open_drawio_xml` description carries the condensed XML rules from [`shared/xml-essentials.md`](../shared/xml-essentials.md) (~1.5k characters). The full XML generation reference (edge routing, containers, layers, tags, metadata, dark mode, etc.) in [`shared/xml-reference.md`](../shared/xml-reference.md), the single source of truth for all draw.io MCP prompts, and the Mermaid reference in [`shared/mermaid-reference.md`](../shared/mermaid-reference.md) are fetched with `get_drawio_reference`. That keeps every tool description short: clients like VS Code Copilot index tool descriptions, and a description carrying a whole reference is too long for them. A `prepack` script bundles the three files into the npm package so they work after `npm install`.

## Related Resources

- [draw.io](https://www.draw.io) - Free online diagram editor
- [draw.io Desktop](https://github.com/jgraph/drawio-desktop) - Desktop application
- [drawio-mcp on GitHub](https://github.com/jgraph/drawio-mcp) - Full repository with all four approaches
- [MCP Specification](https://modelcontextprotocol.io/)
