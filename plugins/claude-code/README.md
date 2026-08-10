# Draw.io Plugin for Claude Code

A Claude Code plugin that generates native `.drawio` files. Claude authors each diagram as **Mermaid** (converted and laid out by the draw.io desktop CLI) or as **draw.io XML** directly — with optional **ELK auto-layout** for XML, export to PNG/SVG/PDF (with embedded XML so the file remains editable in draw.io), or a browser URL that opens the diagram directly in `app.diagrams.net`. No MCP setup required.

## How It Works

When you ask Claude Code to create a diagram, it will:

1. Choose how to author it — **Mermaid** for standard types (flowchart, sequence, class, state, ER, gantt, mindmap…) when the desktop app is installed, or **draw.io XML** for custom styling, precise positioning, specific shape libraries, or when no desktop app is present
2. Produce a native `.drawio` file — convert the Mermaid with the desktop CLI, or write the XML directly (optionally running an ELK `--layout` pass so you don't hand-place cells)
3. Run the bundled `fix_edge_parents.py` over the file so every connector is parented to the innermost container holding both of its endpoints — the rule the draw.io editor applies, and what keeps a layout pass from laying the diagram out wrongly
4. Handle the requested output:
   - PNG / SVG / PDF — export using the draw.io desktop CLI
   - `url` — compress the XML with Node.js's built-in `zlib` and open `https://app.diagrams.net/#create=...` in your browser (keeps the `.drawio` file as a local copy)
   - *(default)* — leave the `.drawio` file as-is
5. Open the result

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- [draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases) installed — required for Mermaid conversion, ELK layout, and PNG/SVG/PDF export. Not needed for plain XML `.drawio` or `url` output, which Claude can produce with no desktop app
- Python 3 on your `PATH` — used by the bundled edge-parent fixer (standard library only, no packages to install). Without it Claude sets the edge parents itself while authoring

## Installation

### Via the drawio marketplace (recommended)

Inside Claude Code, add this repository as a plugin marketplace, then install:

```
/plugin marketplace add jgraph/drawio-mcp
/plugin install drawio@drawio
```

The marketplace manifest lives at [`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json) at the repo root and points at this directory.

### Local development

To load the plugin directly from a local clone (e.g. while iterating on the skill):

```bash
claude --plugin-dir ./plugins/claude-code
```

The plugin loads the `drawio` skill from `skills/drawio/SKILL.md` — nothing else needs to be copied into your `~/.claude/skills/` directory.

## Usage

In most cases you don't type a command at all — just ask Claude Code for a diagram ("draw a flowchart for user login") and the skill triggers automatically from its description. To invoke it explicitly, Claude Code namespaces plugin skills as `/<plugin>:<skill>`, so the command is `/drawio:drawio`:

```
/drawio:drawio create a flowchart for user login
```

(The first `drawio` is the plugin name, the second is the skill folder. Any skills added to this plugin later — e.g. `/drawio:search-shapes` — share the same prefix.)

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

## References

The skill fetches two shared guides from GitHub at runtime — the single source of truth for all draw.io MCP prompts across the repository. No extra files need to be copied during installation.

- [`shared/xml-reference.md`](../../shared/xml-reference.md) — draw.io XML generation (edge routing, containers, layers, tags, metadata, dark mode, etc.), used when authoring XML
- [`shared/mermaid-reference.md`](../../shared/mermaid-reference.md) — Mermaid syntax for all supported diagram types plus flowchart styling, used when authoring Mermaid

## Authoring: Mermaid or XML?

A `.drawio` file is native mxGraphModel XML. Claude produces one two ways:

- **Mermaid** — terse text that the desktop CLI converts to `.drawio` and lays out automatically. Preferred for standard diagram types when the desktop app is installed.
- **XML** — generated directly, for custom styling, precise positioning, or specific shape libraries. Needs no desktop app, so it's the universal fallback (`.drawio` file or `url`).

Both routes end up as the same native `.drawio` format, immediately editable in draw.io. Mermaid conversion and ELK layout run locally via the desktop CLI — there is no server dependency.

## Other Variants

This repository offers multiple ways to integrate draw.io with AI assistants:

- **[Codex Plugin](../codex/drawio/README.md)** — the same `drawio` skill for Codex CLI
- **[GitHub Copilot Plugin](../copilot/README.md)** — the same `drawio` skill for GitHub Copilot
- **[MCP App Server](../../mcp-app-server/README.md)** — Inline diagrams in chat (Claude.ai, VS Code)
- **[MCP Tool Server](../../mcp-tool-server/README.md)** — Opens diagrams in browser via MCP (Claude Desktop)
- **[Project Instructions](../../project-instructions/README.md)** — Claude.ai Projects, no install needed
