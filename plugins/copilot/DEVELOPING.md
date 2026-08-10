# Copilot Plugin: drawio

A GitHub Copilot CLI plugin that ships the `drawio` skill: it generates native `.drawio`
files, authored either as Mermaid (converted + laid out by the draw.io desktop CLI) or as
draw.io XML directly, with optional ELK `--layout` for XML, export to PNG/SVG/PDF (with
embedded XML) via the desktop CLI, or a browser URL that opens the diagram directly at
`app.diagrams.net`. No MCP server required.

This is the Copilot counterpart of the [Claude Code plugin](../claude-code/README.md). The
skill body is host-agnostic — it drives the draw.io Desktop CLI directly — so
`skills/drawio/SKILL.md` and the helper it ships (`skills/drawio/scripts/fix_edge_parents.py`)
are kept **byte-identical** to the Claude plugin's copies. That includes the `/drawio:drawio` lines in its examples section: those are model-facing
(request → output mapping), while the user-facing explicit command in Copilot is plain
`/drawio` — Copilot does not prefix skills with the plugin name. Only the host wrapping
differs: the manifest (root `plugin.json` vs `.claude-plugin/plugin.json`) and the
marketplace manifest location and schema.

## Key Files

| File | Purpose |
|------|---------|
| `plugin.json` | Copilot plugin manifest at the plugin root — name, version, description, author, license, keywords, and the `skills` directory list |
| `skills/drawio/SKILL.md` | The skill itself (its frontmatter `name` becomes the `/drawio` command); byte-identical to the Claude plugin's copy |
| `skills/drawio/scripts/fix_edge_parents.py` | Bundled helper the skill runs on every generated `.drawio` — sets each edge's `parent` to the nearest common ancestor of its `source` and `target`, which a layout pass needs in order to lay the diagram out correctly; byte-identical to the Claude plugin's copy (documented in [its DEVELOPING.md](../claude-code/DEVELOPING.md#edge-parents)) |
| `README.md` | Installation and usage documentation |
| `../../.github/plugin/marketplace.json` | Copilot marketplace manifest at the repo root; lists this plugin with `source: "./plugins/copilot"` |

## Layout

Copilot does not require the plugin folder name to match `plugin.json` `"name"` (unlike
Codex), so this directory is itself the plugin root — the same shape as `claude-code/`:

```
plugins/copilot/        ← Copilot plugin root
├── plugin.json
├── skills/drawio/SKILL.md
├── skills/drawio/scripts/fix_edge_parents.py
├── README.md
└── DEVELOPING.md
```

Copilot accepts the manifest at the plugin root (`plugin.json`) as well as in `.plugin/`,
`.github/plugin/`, or `.claude-plugin/`; the root form matches GitHub's official
plugin-authoring docs and the plugins in GitHub's own
[`copilot-plugins`](https://github.com/github/copilot-plugins) marketplace.

## Marketplace metadata is duplicated

Unlike Claude Code's marketplace (which inherits plugin metadata from the plugin's own
manifest), Copilot's marketplace schema carries the metadata inline in each `plugins[]`
entry. The `drawio` entry in `.github/plugin/marketplace.json` therefore mirrors
`plugin.json` — when bumping `version` (kept in lockstep with the Claude and Codex plugin
manifests) or editing the description, update **both** files.

Copilot CLI resolves a marketplace repo via `.github/plugin/marketplace.json` first, falling
back to `.claude-plugin/marketplace.json`. This repo has both; the fallback serves Claude
Code and points at `plugins/claude-code` — the same skill either way, since Copilot also
understands Claude-format plugins.

## References (fetched, not bundled)

Like the Claude plugin, `SKILL.md` fetches the two shared guides via their GitHub raw URLs at
runtime — the single source of truth for all draw.io prompts — so nothing is duplicated in
the plugin:

- `https://raw.githubusercontent.com/jgraph/drawio-mcp/main/shared/xml-reference.md`
- `https://raw.githubusercontent.com/jgraph/drawio-mcp/main/shared/mermaid-reference.md`

When updating diagram-generation guidance, edit only the files under `shared/` — changes
propagate to this plugin (and every other consumer) automatically.

## URL Mode Compatibility

The `url` mode produces the exact same `https://app.diagrams.net/#create=...` URL format as
the [MCP Tool Server](../../mcp-tool-server/README.md) (`mcp-tool-server/src/index.js`).
Node.js's built-in `zlib.deflateRawSync` and `pako.deflateRaw` both implement RFC 1951, so
their outputs are interchangeable. No external npm dependencies are added to the skill — only
Node.js built-ins (`zlib`, `child_process`, `fs`, `os`, `path`).

## draw.io CLI Locations

- **macOS**: `/Applications/draw.io.app/Contents/MacOS/draw.io`
- **Linux**: `drawio` (on PATH via snap/apt/flatpak)
- **Windows**: `"C:\Program Files\draw.io\draw.io.exe"`
- **WSL2**: `"/mnt/c/Program Files/draw.io/draw.io.exe"` (detect via `grep -qi microsoft /proc/version`)

The skill tries `drawio` first, then falls back to the platform-specific path. On WSL2, use
`wslpath -w` to convert paths when opening files with `cmd.exe /c start`.

## Testing Locally

```bash
copilot plugin marketplace add /path/to/drawio-mcp
copilot plugin install drawio@drawio
copilot plugin list            # confirm drawio appears
```

Or skip the marketplace and install the plugin directory directly:

```bash
copilot plugin install /path/to/drawio-mcp/plugins/copilot
```

Then ask Copilot for a diagram, or invoke `/drawio ...` (confirm it's listed via
`/skills list`), and check the `.drawio` file (or export / URL) is produced.

## Coding Conventions

- **Allman brace style**: Opening braces go on their own line for all control structures,
  functions, objects, and callbacks.
- Prefer `function()` expressions over arrow functions for callbacks.
- See the root `CLAUDE.md` for examples.
