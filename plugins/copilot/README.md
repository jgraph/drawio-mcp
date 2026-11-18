# Draw.io Plugin for GitHub Copilot

A [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) plugin that
generates native `.drawio` files. Copilot authors each diagram as **Mermaid** (converted to editable draw.io shapes and laid out by the draw.io desktop CLI or, without it, by draw.io's converter in a headless Chrome, Edge or Chromium) or as **draw.io XML** directly — with optional **ELK
auto-layout** for XML, export to PNG/SVG/PDF (with embedded XML so the file remains editable
in draw.io), or a browser URL that opens the diagram directly in `app.diagrams.net`. No MCP
setup required.

This is the Copilot port of the [Claude Code plugin](../claude-code/README.md); it ships the
same `drawio` skill. Only the host wrapping (manifest schema, marketplace format, invocation)
differs — the draw.io guidance itself is the shared single source of truth in
[`shared/`](../../shared).

## How It Works

When you ask Copilot to create a diagram, it will:

1. Choose how to author it — **Mermaid** for standard types (flowchart, sequence, class, state, ER, gantt, mindmap…), or **draw.io XML** for
   custom styling, precise positioning, specific shape libraries, or when nothing can convert Mermaid
2. Produce a native `.drawio` file — convert the Mermaid with the desktop CLI (without it, with the bundled `scripts/mermaid-to-drawio.js`), or write the
   XML directly (optionally running an ELK `--layout` pass so you don't hand-place cells)
3. Handle the requested output:
   - PNG / SVG / PDF — export using the draw.io desktop CLI
   - `url` — compress the XML with Node.js's built-in `zlib` and open
     `https://app.diagrams.net/#R...` in your browser (keeps the `.drawio` file as a
     local copy)
   - *(default)* — leave the `.drawio` file as-is
4. Open the result

## Prerequisites

- [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) installed
- [draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases) installed — required for ELK layout and PNG/SVG/PDF export. Not needed for `.drawio` or `url` output: without it, Mermaid is converted in an installed Chrome, Edge or Chromium (or opened as a link that draw.io converts in the browser), and XML needs nothing, which Copilot can produce with no desktop app

## Installation

### Via the drawio marketplace (recommended)

Add this repository as a Copilot plugin marketplace, then install the plugin:

```bash
copilot plugin marketplace add jgraph/drawio-mcp
copilot plugin install drawio@drawio
```

The same commands work inside a Copilot session as `/plugin marketplace add jgraph/drawio-mcp`
and `/plugin install drawio@drawio`.

The Copilot marketplace manifest lives at
[`.github/plugin/marketplace.json`](../../.github/plugin/marketplace.json) at the repo root
and points at this directory (`./plugins/copilot`); the plugin's own manifest is
[`plugin.json`](plugin.json).

### Updating

Copilot keeps the version you installed until you update it:

```bash
copilot plugin update drawio
```

### Local development

To install straight from a local clone (e.g. while iterating on the skill), point
`copilot plugin install` at this directory — no marketplace needed:

```bash
copilot plugin install /path/to/drawio-mcp/plugins/copilot
```

### Other Copilot surfaces (VS Code, coding agent, code review)

Plugins are a Copilot CLI feature, but the skill itself is a standard
[agent skill](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills), which
other Copilot surfaces load from a repository: copy [`skills/drawio/`](skills/drawio) into
your repo as `.github/skills/drawio/` and agent mode in VS Code / JetBrains, the Copilot
coding agent, and Copilot code review will pick it up from there. For a per-user install
without the plugin, copy it to `~/.copilot/skills/drawio/` instead (Copilot CLI only).

## Usage

In most cases you don't type a command at all — just ask Copilot for a diagram ("draw a
flowchart for user login") and the skill triggers automatically from its description. To
invoke it explicitly, use the skill name as a slash command — Copilot addresses skills
without a plugin prefix, so the command is `/drawio`:

```
/drawio create a flowchart for user login
```

(`/skills list` shows the skill once the plugin is installed.)

By default, this writes a `.drawio` file and opens it in draw.io. To export to an image
format or open the diagram in the browser, mention the format in your request:

```
/drawio png flowchart for user login       → login-flow.drawio.png
/drawio svg: ER diagram for e-commerce     → er-diagram.drawio.svg
/drawio pdf architecture overview          → architecture-overview.drawio.pdf
/drawio url flowchart for user login       → opens app.diagrams.net in browser, keeps login-flow.drawio locally
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
(browser open) — no external dependencies. The resulting `https://app.diagrams.net/#R...`
URL is the same format the [MCP Tool Server](../../mcp-tool-server/README.md) uses for XML,
so behavior is identical.

## References

The skill fetches shared guides from GitHub at runtime — the single source of truth for
all draw.io prompts across the repository. No extra files are bundled in the plugin.

- [`shared/xml-essentials.md`](../../shared/xml-essentials.md) — the condensed XML rules
  (skeleton, cell templates, labels, shapes, the layout grid, containers, swimlanes, edge styles),
  used when authoring XML
- [`shared/xml-reference.md`](../../shared/xml-reference.md) — the full XML reference, fetched only
  for layers, tags, metadata, tables, cross-functional grids and dark-mode colors
- [`shared/mermaid-reference.md`](../../shared/mermaid-reference.md) — Mermaid syntax for
  all supported diagram types plus flowchart styling, used when authoring Mermaid

## Other Variants

This repository offers multiple ways to integrate draw.io with AI assistants:

- **[Claude Code Plugin](../claude-code/README.md)** — the same `drawio` skill for Claude Code
- **[Codex Plugin](../codex/drawio/README.md)** — the same `drawio` skill for Codex CLI
- **[MCP App Server](../../mcp-app-server/README.md)** — Inline diagrams in chat (Claude.ai, VS Code)
- **[MCP Tool Server](../../mcp-tool-server/README.md)** — Opens diagrams in browser via MCP (Claude Desktop)
- **[Project Instructions](../../project-instructions/README.md)** — Claude.ai Projects, no install needed
