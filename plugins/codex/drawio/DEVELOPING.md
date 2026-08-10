# Codex Plugin: drawio

A Codex CLI plugin that ships the `drawio` skill: it generates native `.drawio` files,
authored either as Mermaid (converted + laid out by the draw.io desktop CLI) or as draw.io
XML directly, with optional ELK `--layout` for XML, export to PNG/SVG/PDF (with embedded XML)
via the desktop CLI, or a browser URL that opens the diagram directly at `app.diagrams.net`.
No MCP server required.

This is the Codex counterpart of the [Claude Code plugin](../../claude-code/README.md). The
skill body is host-agnostic — it drives the draw.io Desktop CLI directly — so
`skills/drawio/SKILL.md` and the helper it ships (`skills/drawio/scripts/fix_edge_parents.py`)
are kept **byte-identical** to the Claude plugin's copies (including the `/drawio:drawio`
invocation examples, which Codex uses too). Only the host wrapping differs: the manifest schema (`.codex-plugin/plugin.json` vs `.claude-plugin/plugin.json`),
the `interface` block (Codex-only — logo, brand color, default prompts), and the marketplace
format.

## Key Files

| File | Purpose |
|------|---------|
| `.codex-plugin/plugin.json` | Codex plugin manifest — name, version, description, author, license, and the `interface` block (display name, logo, `brandColor`, default prompts) |
| `skills/drawio/SKILL.md` | The skill itself (its folder name `drawio` becomes the second half of the `/drawio:drawio` invocation); byte-identical to the Claude plugin's copy |
| `skills/drawio/scripts/fix_edge_parents.py` | Bundled helper the skill runs on every generated `.drawio` — sets each edge's `parent` to the nearest common ancestor of its `source` and `target`, which a layout pass needs in order to lay the diagram out correctly; byte-identical to the Claude plugin's copy (documented in [its DEVELOPING.md](../../claude-code/DEVELOPING.md#edge-parents)) |
| `assets/drawio-logo.svg` | Official draw.io logo (vector `drawio-desktop` icon), referenced by `interface.composerIcon`/`logo`/`logoDark` |
| `README.md` | Installation and usage documentation |
| `../../../.agents/plugins/marketplace.json` | Codex marketplace manifest at the repo root; lists this plugin with `source.path: "./plugins/codex/drawio"` and inherits the rest of its metadata from `plugin.json` |

## Layout

Codex normalizes a plugin's root folder name to match `plugin.json` `"name"`. To keep the
repo's one-directory-per-host convention (`plugins/<host>/`, see
[`plugins/README.md`](../../README.md)) **and** satisfy Codex's folder==name rule, the plugin
root is nested one level inside the host directory:

```
plugins/codex/          ← host group directory
└── drawio/             ← Codex plugin root (folder name == plugin.json "name" = "drawio")
    ├── .codex-plugin/plugin.json
    ├── skills/drawio/SKILL.md
    ├── skills/drawio/scripts/fix_edge_parents.py
    ├── assets/drawio-logo.svg
    ├── README.md
    └── DEVELOPING.md
```

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
the [MCP Tool Server](../../../mcp-tool-server/README.md) (`mcp-tool-server/src/index.js`).
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
codex plugin marketplace add /path/to/drawio-mcp
codex plugin add drawio@drawio
codex plugin list            # confirm drawio@drawio appears
```

Then ask Codex for a diagram, or invoke `/drawio:drawio ...`, and confirm the `.drawio` file
(or export / URL) is produced.

## Coding Conventions

- **Allman brace style**: Opening braces go on their own line for all control structures,
  functions, objects, and callbacks.
- Prefer `function()` expressions over arrow functions for callbacks.
- See the root `CLAUDE.md` for examples.
