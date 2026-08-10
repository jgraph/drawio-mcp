# Draw.io Plugin for Codex

A [Codex CLI](https://github.com/openai/codex) plugin that generates native `.drawio`
files. Codex authors each diagram as **Mermaid** (converted and laid out by the draw.io
desktop CLI) or as **draw.io XML** directly — with optional **ELK auto-layout** for XML,
export to PNG/SVG/PDF (with embedded XML so the file remains editable in draw.io), or a
browser URL that opens the diagram directly in `app.diagrams.net`. No MCP setup required.

This is the Codex port of the [Claude Code plugin](../../claude-code/README.md); it ships
the same `drawio` skill. Only the host wrapping (manifest schema, invocation, logo) differs —
the draw.io guidance itself is the shared single source of truth in [`shared/`](../../../shared).

## How It Works

When you ask Codex to create a diagram, it will:

1. Choose how to author it — **Mermaid** for standard types (flowchart, sequence, class,
   state, ER, gantt, mindmap…) when the desktop app is installed, or **draw.io XML** for
   custom styling, precise positioning, specific shape libraries, or when no desktop app is
   present
2. Produce a native `.drawio` file — convert the Mermaid with the desktop CLI, or write the
   XML directly (optionally running an ELK `--layout` pass so you don't hand-place cells)
3. Run the bundled `fix_edge_parents.py` over the file so every connector is parented to the
   innermost container holding both of its endpoints — the rule the draw.io editor applies,
   and what keeps a layout pass from laying the diagram out wrongly
4. Handle the requested output:
   - PNG / SVG / PDF — export using the draw.io desktop CLI
   - `url` — compress the XML with Node.js's built-in `zlib` and open
     `https://app.diagrams.net/#create=...` in your browser (keeps the `.drawio` file as a
     local copy)
   - *(default)* — leave the `.drawio` file as-is
5. Open the result

## Prerequisites

- [Codex CLI](https://github.com/openai/codex) installed
- [draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases) installed — required
  for Mermaid conversion, ELK layout, and PNG/SVG/PDF export. Not needed for plain XML
  `.drawio` or `url` output, which Codex can produce with no desktop app
- Python 3 on your `PATH` — used by the bundled edge-parent fixer (standard library only, no
  packages to install). Without it Codex sets the edge parents itself while authoring

## Installation

### Via the drawio marketplace (recommended)

Add this repository as a Codex plugin marketplace, then install the plugin:

```bash
codex plugin marketplace add jgraph/drawio-mcp
codex plugin add drawio@drawio
```

The Codex marketplace manifest lives at
[`.agents/plugins/marketplace.json`](../../../.agents/plugins/marketplace.json) at the repo
root and points at this directory (`./plugins/codex/drawio`). The rest of the plugin's
metadata is inherited from [`.codex-plugin/plugin.json`](.codex-plugin/plugin.json).

### Local development

To add the marketplace from a local clone (e.g. while iterating on the skill), point
`codex plugin marketplace add` at the repo root instead of the `owner/repo` slug:

```bash
codex plugin marketplace add /path/to/drawio-mcp
codex plugin add drawio@drawio
```

## Usage

In most cases you don't type a command at all — just ask Codex for a diagram ("draw a
flowchart for user login") and the skill triggers automatically from its description. To
invoke it explicitly, Codex namespaces plugin skills as `/<plugin>:<skill>`, so the command
is `/drawio:drawio`:

```
/drawio:drawio create a flowchart for user login
```

By default, this writes a `.drawio` file and opens it in draw.io. To export to an image
format or open the diagram in the browser, mention the format in your request:

```
/drawio:drawio png flowchart for user login       → login-flow.drawio.png
/drawio:drawio svg: ER diagram for e-commerce     → er-diagram.drawio.svg
/drawio:drawio pdf architecture overview          → architecture-overview.drawio.pdf
/drawio:drawio url flowchart for user login       → opens app.diagrams.net in browser, keeps login-flow.drawio locally
```

## Output Formats

| Format | Output | Editor | Dependency |
|--------|--------|--------|------------|
| (default) | `.drawio` file | draw.io Desktop, or the browser app | None |
| `png` | `.drawio.png` (embedded XML) | draw.io Desktop, or any viewer | draw.io Desktop (for export) |
| `svg` | `.drawio.svg` (embedded XML) | draw.io Desktop, or any viewer | draw.io Desktop (for export) |
| `pdf` | `.drawio.pdf` (embedded XML) | draw.io Desktop, or any PDF viewer | draw.io Desktop (for export) |
| `url` | Browser tab at `app.diagrams.net` + `.drawio` file kept locally | draw.io editor in browser | Node.js |

The `.drawio.*` double extension signals that the file contains embedded diagram XML. Open
any of these in draw.io to recover and edit the full diagram. The intermediate `.drawio`
source file is deleted after image export since the exported file contains the complete
diagram. In `url` mode, the `.drawio` file is kept so you have a persistent local copy to
re-edit or share.

`url` mode uses only Node.js's built-in `zlib` (deflate-raw compression) and `child_process`
(browser open) — no external dependencies. The resulting `https://app.diagrams.net/#create=...`
URL is the same format used by the [MCP Tool Server](../../../mcp-tool-server/README.md), so
behavior is identical.

## References

The skill fetches two shared guides from GitHub at runtime — the single source of truth for
all draw.io prompts across the repository. No extra files are bundled in the plugin.

- [`shared/xml-reference.md`](../../../shared/xml-reference.md) — draw.io XML generation
  (edge routing, containers, layers, tags, metadata, dark mode, etc.), used when authoring XML
- [`shared/mermaid-reference.md`](../../../shared/mermaid-reference.md) — Mermaid syntax for
  all supported diagram types plus flowchart styling, used when authoring Mermaid

## Logo

The Codex `interface` uses the official draw.io logo
([`assets/drawio-logo.svg`](assets/drawio-logo.svg), the vector
[`drawio-desktop` icon](https://github.com/jgraph/drawio-desktop/blob/dev/build/icon.svg))
for the composer icon and the light/dark plugin logo, with `brandColor` `#F08705`.

## Other Variants

This repository offers multiple ways to integrate draw.io with AI assistants:

- **[Claude Code Plugin](../../claude-code/README.md)** — the same `drawio` skill for Claude Code
- **[GitHub Copilot Plugin](../../copilot/README.md)** — the same `drawio` skill for GitHub Copilot
- **[MCP App Server](../../../mcp-app-server/README.md)** — Inline diagrams in chat (Claude.ai, VS Code)
- **[MCP Tool Server](../../../mcp-tool-server/README.md)** — Opens diagrams in browser via MCP (Claude Desktop)
- **[Project Instructions](../../../project-instructions/README.md)** — Claude.ai Projects, no install needed
