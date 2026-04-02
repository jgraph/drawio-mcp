# Draw.io MCP Tool Server

The official [draw.io](https://www.draw.io) MCP server that opens diagrams directly in the draw.io editor. Supports XML, CSV, and Mermaid.js formats with lightbox and dark mode options.

This package is part of the [drawio-mcp](https://github.com/jgraph/drawio-mcp) repository, which also includes:

- **[MCP App Server](https://github.com/jgraph/drawio-mcp/tree/main/mcp-app-server)** — Renders diagrams inline in AI chat interfaces. Hosted at `https://mcp.draw.io/mcp` — no install required.
- **[Skill + CLI](https://github.com/jgraph/drawio-mcp/tree/main/skill-cli)** — Claude Code skill that generates native `.drawio` files with optional PNG/SVG/PDF export.
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

<details>
<summary>Claude Desktop</summary>

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

</details>

<details>
<summary>Claude Code</summary>

Add the MCP server to Claude Code using the CLI:

```bash
claude mcp add drawio -- npx -y @drawio/mcp
```

Or add it manually to your Claude Code settings file (`.claude/settings.json`):

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

</details>

<details>
<summary>Other MCP Clients</summary>

Configure your MCP client to run the server via stdio:

```bash
npx @drawio/mcp
```

</details>

## Tools

### `open_drawio_xml`

Opens the draw.io editor with XML content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | Yes | Draw.io XML content |
| `lightbox` | boolean | No | Read-only view mode (default: false) |
| `dark` | string | No | "auto", "true", or "false" (default: "auto") |

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

## Example Prompts

- "Use `open_drawio_mermaid` to create a sequence diagram showing OAuth2 authentication flow"
- "Use `open_drawio_csv` to create an org chart: CEO → CTO, CFO; CTO → 3 Engineers"
- "Use `open_drawio_xml` to create a detailed AWS architecture diagram with VPC, subnets, and security groups"

> **Tip:** Claude Desktop may have multiple ways to create diagrams. To ensure it uses the draw.io MCP, mention the tool name explicitly or add a system instruction:
> *"Always use the draw.io MCP tools to create diagrams."*

## How It Works

1. The MCP server receives diagram content (XML, CSV, or Mermaid)
2. Content is compressed using pako deflateRaw and encoded as base64
3. A draw.io URL is generated with the `#create` hash parameter
4. The URL is returned to the LLM, which can present it to the user
5. Opening the URL loads draw.io with the diagram ready to view/edit

## Related Resources

- [draw.io](https://www.draw.io) - Free online diagram editor
- [draw.io Desktop](https://github.com/jgraph/drawio-desktop) - Desktop application
- [drawio-mcp on GitHub](https://github.com/jgraph/drawio-mcp) - Full repository with all four approaches
- [MCP Specification](https://modelcontextprotocol.io/)
