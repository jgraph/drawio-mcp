# Draw.io Plugin for Antigravity

An [Antigravity](https://antigravity.google) plugin that generates native `.drawio` files.
The agent authors each diagram as **Mermaid** (converted and laid out by the draw.io desktop
CLI) or as **draw.io XML** directly — with optional **ELK auto-layout** for XML, export to
PNG/SVG/PDF (with embedded XML so the file remains editable in draw.io), or a browser URL
that opens the diagram directly in `app.diagrams.net`. No MCP setup required.

This is the Antigravity port of the [Claude Code plugin](../claude-code/README.md); it ships
the same `drawio` skill. Only the host wrapping (manifest, installation) differs — the
draw.io guidance itself is the shared single source of truth in [`shared/`](../../shared).

## How It Works

When you ask the agent to create a diagram, it will:

1. Choose how to author it — **Mermaid** for standard types (flowchart, sequence, class,
   state, ER, gantt, mindmap…) when the desktop app is installed, or **draw.io XML** for
   custom styling, precise positioning, specific shape libraries, or when no desktop app is
   present
2. Produce a native `.drawio` file — convert the Mermaid with the desktop CLI, or write the
   XML directly (optionally running an ELK `--layout` pass so you don't hand-place cells)
3. Handle the requested output:
   - PNG / SVG / PDF — export using the draw.io desktop CLI
   - `url` — compress the XML with Node.js's built-in `zlib` and open
     `https://app.diagrams.net/#R...` in your browser (keeps the `.drawio` file as a
     local copy)
   - *(default)* — leave the `.drawio` file as-is
4. Open the result

## Prerequisites

- The [Antigravity CLI](https://antigravity.google/docs/getting-started) (`agy`). The
  Antigravity app and IDE read plugins from the same folder (`~/.gemini/config/plugins/`),
  but only the CLI has been tested
- [draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases) installed — required
  for Mermaid conversion, ELK layout, and PNG/SVG/PDF export. Not needed for plain XML
  `.drawio` or `url` output

## Installation

Install the plugin straight from this directory on GitHub:

```bash
agy plugin install https://github.com/jgraph/drawio-mcp/tree/main/plugins/antigravity
```

Inside an `agy` session, the same works as
`/plugin install https://github.com/jgraph/drawio-mcp/tree/main/plugins/antigravity`.
`agy plugin list` shows it as `drawio`; `/skills list` in a session shows the skill.

Use this directory's URL, not the repository's: `agy plugin install
https://github.com/jgraph/drawio-mcp` installs every plugin it finds in the repository, all
named `drawio`, and the last one wins.

### Updating

Run the install command again — it replaces the installed copy.

### Local development

Point `agy plugin install` at a local clone (and check the manifest with `agy plugin
validate`):

```bash
agy plugin validate /path/to/drawio-mcp/plugins/antigravity
agy plugin install /path/to/drawio-mcp/plugins/antigravity
```

### Diagrams via MCP instead

Antigravity can also use the hosted [MCP App Server](../../mcp-app-server/README.md). In a
terminal there is no inline viewer, so each diagram comes back as a link that opens it in
draw.io:

```bash
agy mcp add drawio https://mcp.draw.io/mcp
```

Keep one of the two: with both installed, the agent tends to mix them.

## Usage

Just ask for a diagram ("draw a flowchart for user login") — the skill triggers from its
description. By default this writes a `.drawio` file and opens it in draw.io. To export to an
image format or open the diagram in the browser, mention the format in your request:

```
png flowchart for user login       → login-flow.drawio.png
svg: ER diagram for e-commerce     → er-diagram.drawio.svg
pdf architecture overview          → architecture-overview.drawio.pdf
url flowchart for user login       → opens app.diagrams.net in browser, keeps login-flow.drawio locally
```

In `agy -p` (print mode) the agent can't ask before running the draw.io CLI, so approve
commands up front, for example with `--dangerously-skip-permissions` in a folder you trust.

## Output Formats

| Format | Output | Editor | Dependency |
|--------|--------|--------|------------|
| (default) | `.drawio` file | draw.io Desktop, or the browser app | None |
| `png` | `.drawio.png` (embedded XML) | draw.io Desktop, or any viewer | draw.io Desktop (for export) |
| `svg` | `.drawio.svg` (embedded XML) | draw.io Desktop, or any viewer | draw.io Desktop (for export) |
| `pdf` | `.drawio.pdf` (embedded XML) | draw.io Desktop, or any PDF viewer | draw.io Desktop (for export) |
| `url` | Browser tab at `app.diagrams.net` + `.drawio` file kept locally | draw.io editor in browser | Node.js |

The `.drawio.*` double extension signals that the file contains embedded diagram XML. Open
any of these in draw.io to recover and edit the full diagram.

## References

The skill fetches shared guides from GitHub at runtime — the single source of truth for
all draw.io prompts across the repository. No extra files are bundled in the plugin.

- [`shared/xml-essentials.md`](../../shared/xml-essentials.md) — the condensed XML rules,
  used when authoring XML
- [`shared/xml-reference.md`](../../shared/xml-reference.md) — the full XML reference, fetched only
  for layers, tags, metadata, tables, cross-functional grids and dark-mode colors
- [`shared/mermaid-reference.md`](../../shared/mermaid-reference.md) — Mermaid syntax for
  all supported diagram types plus flowchart styling, used when authoring Mermaid

## Other Variants

This repository offers multiple ways to integrate draw.io with AI assistants:

- **[Claude Code Plugin](../claude-code/README.md)** — the same `drawio` skill for Claude Code
- **[Codex Plugin](../codex/drawio/README.md)** — the same `drawio` skill for Codex CLI
- **[Copilot Plugin](../copilot/README.md)** — the same `drawio` skill for GitHub Copilot CLI
- **[MCP App Server](../../mcp-app-server/README.md)** — Inline diagrams in chat (Claude.ai, ChatGPT, VS Code, Cursor)
- **[MCP Tool Server](../../mcp-tool-server/README.md)** — Opens diagrams in browser via MCP
