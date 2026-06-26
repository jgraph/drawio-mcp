# Claude Code Plugin: drawio

A Claude Code plugin that ships the `drawio` skill: it generates native `.drawio` files, with optional export to PNG/SVG/PDF (with embedded XML) using the draw.io desktop CLI, or a browser URL that opens the diagram directly at `app.diagrams.net`. No MCP server required.

Previously distributed as a bare `SKILL.md` users copied into `~/.claude/skills/`; now packaged as a real plugin so it loads via `claude --plugin-dir ./plugins/claude-code` and is distributed through the [`jgraph` marketplace](../../.claude-plugin/marketplace.json) at the repo root (`/plugin install drawio@jgraph`).

## Key Files

| File | Purpose |
|------|---------|
| `.claude-plugin/plugin.json` | Plugin manifest — name, version, description, author |
| `skills/drawio/SKILL.md` | The skill itself (its folder name `drawio` becomes the second half of the `/drawio:drawio` invocation) |
| `README.md` | Installation and usage documentation |
| `../../.claude-plugin/marketplace.json` | Marketplace manifest at the repo root that lists this plugin with `source: "./plugins/claude-code"` |

## How It Works

1. User invokes `/drawio:drawio` or Claude detects a diagram request
2. Claude generates mxGraphModel XML for the requested diagram
3. The XML is written to a `.drawio` file in the working directory via the Write tool
4. Format-specific handling:
   - **png/svg/pdf** — the draw.io CLI exports to `.drawio.png` / `.drawio.svg` / `.drawio.pdf` with `--embed-diagram`, then deletes the source `.drawio` file
   - **url** — a `node -e` one-liner reads the `.drawio` file, compresses it with `zlib.deflateRawSync` + base64, builds `https://app.diagrams.net/?...#create={type,compressed,data}`, and opens it in the browser. The `.drawio` file is kept for persistence.
   - **default** — no extra step, the `.drawio` file is the output
5. The result is opened for viewing (`open` / `xdg-open` / `start`; on Windows/WSL2, `url` mode uses a temp `.url` file because `cmd.exe` strips the `#create=...` fragment)

Default output is `.drawio` (no export). The user requests another output mode by mentioning the format: `/drawio:drawio png ...`, `/drawio:drawio svg: ...`, `/drawio:drawio url ...`, etc.

## URL Mode Compatibility

The `url` mode produces the exact same `https://app.diagrams.net/#create=...` URL format as the MCP Tool Server (`mcp-tool-server/src/index.js`). Node.js's built-in `zlib.deflateRawSync` and `pako.deflateRaw` both implement RFC 1951, so their outputs are interchangeable. No external npm dependencies are added to the skill — only Node.js built-ins (`zlib`, `child_process`, `fs`, `os`, `path`).

## draw.io CLI Locations

- **macOS**: `/Applications/draw.io.app/Contents/MacOS/draw.io`
- **Linux**: `drawio` (on PATH via snap/apt/flatpak)
- **Windows**: `"C:\Program Files\draw.io\draw.io.exe"`
- **WSL2**: `` `/mnt/c/Program Files/draw.io/draw.io.exe` `` (detect via `grep -qi microsoft /proc/version`)

The skill tries `drawio` first, then falls back to the platform-specific path. On WSL2, use `wslpath -w` to convert paths when opening files with `cmd.exe /c start`.

## Why XML Only?

A `.drawio` file is native mxGraphModel XML. Mermaid and CSV formats require draw.io's server-side conversion and cannot be saved as native files. The skill generates XML directly for all diagram types.

## XML Reference

The XML generation reference lives in `shared/xml-reference.md` at the repo root (single source of truth for all prompts). The SKILL.md references it via the GitHub raw URL so it works after install without copying extra files.

## Coding Conventions

- **Allman brace style**: Opening braces go on their own line for all control structures, functions, objects, and callbacks.
- Prefer `function()` expressions over arrow functions for callbacks.
- See the root `CLAUDE.md` for examples.
