# Draw.io Plugin for Claude Code

A Claude Code plugin that generates native `.drawio` files, with optional export to PNG, SVG, or PDF (with embedded XML so the exported file remains editable in draw.io) or as a browser URL that opens the diagram directly in `app.diagrams.net`. No MCP setup required.

## How It Works

When you ask Claude Code to create a diagram, it will:

1. Generate draw.io XML for your requested diagram
2. Write it to a `.drawio` file in your current directory
3. Handle the requested output:
   - PNG / SVG / PDF — export using the draw.io desktop CLI
   - `url` — compress the XML with Node.js's built-in `zlib` and open `https://app.diagrams.net/#create=...` in your browser (keeps the `.drawio` file as a local copy)
   - *(default)* — leave the `.drawio` file as-is
4. Open the result

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- [draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases) installed (only required for PNG/SVG/PDF export — not needed for `.drawio` or `url` modes)

## Installation

### Via the drawio marketplace (recommended)

Inside Claude Code, add this repository as a plugin marketplace, then install:

```
/plugin marketplace add jgraph/drawio-mcp
/plugin install drawio@jgraph
```

The marketplace manifest lives at [`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json) at the repo root and points at this directory.

### Local development

To load the plugin directly from a local clone (e.g. while iterating on the skill):

```bash
claude --plugin-dir ./plugins/claude-code
```

The plugin loads the `drawio` skill from `skills/drawio/SKILL.md` — nothing else needs to be copied into your `~/.claude/skills/` directory.

## Usage

```
/drawio:drawio create a flowchart for user login
```

Claude Code namespaces plugin skills as `/<plugin>:<skill>`, so the invocation is `/drawio:drawio …` — the first `drawio` is the plugin name, the second is the skill folder. Additional skills added to this plugin later (e.g. `/drawio:search-shapes`) share the same prefix.

By default, this writes a `.drawio` file and opens it in draw.io. To export to an image format or open the diagram in the browser, mention the format in your request:

```
/drawio:drawio png flowchart for user login       → login-flow.drawio.png
/drawio:drawio svg: ER diagram for e-commerce     → er-diagram.drawio.svg
/drawio:drawio pdf architecture overview          → architecture-overview.drawio.pdf
/drawio:drawio url flowchart for user login       → opens app.diagrams.net in browser, keeps login-flow.drawio locally
```

More examples:

```
/drawio:drawio sequence diagram for API auth
/drawio:drawio png class diagram for the models in src/
/drawio:drawio url architecture overview
```

## Output Formats

| Format | Output | Editor | Dependency |
|--------|--------|--------|------------|
| (default) | `.drawio` file | draw.io Desktop, or the browser app | None |
| `png` | `.drawio.png` (embedded XML) | draw.io Desktop, or any viewer | draw.io Desktop (for export) |
| `svg` | `.drawio.svg` (embedded XML) | draw.io Desktop, or any viewer | draw.io Desktop (for export) |
| `pdf` | `.drawio.pdf` (embedded XML) | draw.io Desktop, or any PDF viewer | draw.io Desktop (for export) |
| `url` | Browser tab at `app.diagrams.net` + `.drawio` file kept locally | draw.io editor in browser | Node.js (bundled with Claude Code) |

The `.drawio.*` double extension signals that the file contains embedded diagram XML. Open any of these in draw.io to recover and edit the full diagram. The intermediate `.drawio` source file is deleted after image export since the exported file contains the complete diagram. In `url` mode, the `.drawio` file is kept so you have a persistent local copy to re-edit or share.

`url` mode uses only Node.js's built-in `zlib` (deflate-raw compression) and `child_process` (browser open) — no external dependencies. The resulting `https://app.diagrams.net/#create=...` URL is the same format used by the [MCP Tool Server](../../mcp-tool-server/README.md), so behavior is identical.

## XML Reference

The skill references the shared XML generation guide (edge routing, containers, layers, tags, metadata, dark mode, etc.) from GitHub at runtime:
[`shared/xml-reference.md`](../../shared/xml-reference.md)

This is the single source of truth for all draw.io MCP prompts across the repository. No extra files need to be copied during installation.

## Why XML Only?

A `.drawio` file is just mxGraphModel XML. Mermaid and CSV formats require draw.io's server-side conversion — they can't be saved as native files. Claude generates XML directly for all diagram types, which means:

- No server dependency
- No conversion step
- Files are immediately editable in draw.io

## Other Variants

This repository offers multiple ways to integrate draw.io with AI assistants:

- **[MCP App Server](../../mcp-app-server/README.md)** — Inline diagrams in chat (Claude.ai, VS Code)
- **[MCP Tool Server](../../mcp-tool-server/README.md)** — Opens diagrams in browser via MCP (Claude Desktop)
- **[Project Instructions](../../project-instructions/README.md)** — Claude.ai Projects, no install needed
