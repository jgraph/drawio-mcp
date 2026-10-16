# Draw.io Plugin for Cursor

The official draw.io plugin for [Cursor](https://cursor.com). It bundles two things:

- **The hosted draw.io MCP server** (`https://mcp.draw.io/mcp`), so diagrams appear right in
  Cursor's Agent chat as interactive draw.io diagrams you can zoom, pan, copy or open in the
  draw.io editor (Cursor 2.6 or later).
- **The `drawio` skill**, which writes native `.drawio` files into your project when you ask for
  a file or an export: authored as **Mermaid** (converted and laid out by the draw.io desktop
  CLI) or as **draw.io XML**, with optional **ELK auto-layout**, export to PNG/SVG/PDF (with the
  diagram embedded, so the file stays editable in draw.io), or a browser URL that opens the
  diagram in `app.diagrams.net`.

This is the Cursor port of the [Claude Code plugin](../claude-code/README.md); the skill is the
same file, and the draw.io guidance itself is the shared single source of truth in
[`shared/`](../../shared).

## How It Works

- **In the chat**, ask for a diagram ("draw the request flow of this service") and the agent
  calls the server's `create_diagram` tool: the diagram renders inline. Mermaid (28 diagram
  types) and draw.io XML both work, and `search_shapes` finds the right icons among more than
  10,000 shapes (AWS, Azure, Google Cloud, Kubernetes, Cisco, P&ID and more).
- **As a file**, ask for a `.drawio` file or an export ("save the architecture as a PNG in
  docs/") and the skill writes it into your project:
  - PNG / SVG / PDF: exported with the draw.io desktop CLI
  - `url`: opens `https://app.diagrams.net/#R...` in your browser and keeps the `.drawio` file
  - *(default)*: a `.drawio` file, opened in draw.io

## Prerequisites

- [Cursor](https://cursor.com) 2.6 or later for inline diagrams in the chat
- [draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases) for Mermaid files, ELK
  layout and PNG/SVG/PDF export. Not needed for inline diagrams, plain XML `.drawio` files or
  `url` output

## Installation

### From the Cursor Marketplace

Open **Customize** in the sidebar, find **drawio**, select **Install** and choose the project or
user scope.

### From a local clone

Before the marketplace listing, or to try changes to the skill, install the plugin as a local
plugin:

```bash
git clone --depth 1 https://github.com/jgraph/drawio-mcp.git
mkdir -p ~/.cursor/plugins/local
cp -r drawio-mcp/plugins/cursor ~/.cursor/plugins/local/drawio
```

Then run **Developer: Reload Window** (or restart Cursor) and check under **Customize** that the
skill and the MCP server loaded. On Teams and Enterprise plans an admin may first need to allow
**Allow Local Plugin Imports**.

### As a team marketplace (Teams and Enterprise)

Admins can add this repository under **Dashboard → Plugins & MCPs → Add Marketplace → Import
from Repo**. The marketplace manifest is
[`.cursor-plugin/marketplace.json`](../../.cursor-plugin/marketplace.json) at the repo root and
points at this directory; the plugin's own manifest is
[`.cursor-plugin/plugin.json`](.cursor-plugin/plugin.json).

### Only the MCP server

For inline diagrams without the skill, use the one-click install link in the
[main README](../../README.md#mcp-app-server) instead.

## Data

Inline diagrams are drawn by the hosted server, so the diagram you ask for is sent to
`mcp.draw.io` to render it. It isn't stored, and no account is needed: see the
[privacy policy for AI assistants](https://www.drawio.com/trust/privacy-ai-assistants/). To keep
diagrams on your machine, self-host the [MCP App Server](../../mcp-app-server/README.md) and
change the URL in [`mcp.json`](mcp.json), or use only the skill, which writes files locally and
exports with your local draw.io Desktop.

## Other Variants

- **[Claude Code Plugin](../claude-code/README.md)**, **[Codex Plugin](../codex/drawio/README.md)**
  and **[GitHub Copilot Plugin](../copilot/README.md)**: the same `drawio` skill for those hosts
- **[MCP App Server](../../mcp-app-server/README.md)**: the inline viewer on its own, for any
  MCP Apps host
- **[MCP Tool Server](../../mcp-tool-server/README.md)**: opens diagrams in the draw.io editor
  in your browser (`npx @drawio/mcp`)
