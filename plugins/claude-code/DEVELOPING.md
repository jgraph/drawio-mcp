# Claude Code Plugin: drawio

A Claude Code plugin that ships the `drawio` skill: it generates native `.drawio` files, authored either as Mermaid (converted + laid out by the draw.io desktop CLI, or without it by `scripts/mermaid-to-drawio.js` in a headless Chrome, Edge or Chromium) or as draw.io XML directly, with optional ELK `--layout` for XML, export to PNG/SVG/PDF (with embedded XML) via the desktop CLI, or a browser URL that opens the diagram directly at `app.diagrams.net`. No MCP server required.

Previously distributed as a bare `SKILL.md` users copied into `~/.claude/skills/`; now packaged as a real plugin so it loads via `claude --plugin-dir ./plugins/claude-code` and is distributed through the [`drawio` marketplace](../../.claude-plugin/marketplace.json) at the repo root (`/plugin install drawio@drawio`).

## Key Files

| File | Purpose |
|------|---------|
| `.claude-plugin/plugin.json` | Plugin manifest — the single source of truth for name, version, description, author, license |
| `skills/drawio/SKILL.md` | The skill itself (its folder name `drawio` becomes the second half of the `/drawio:drawio` invocation) |
| `skills/drawio/scripts/find-shapes.js` | The shape and icon lookup the skill runs for XML diagrams (see [Shape and icon lookup](#shape-and-icon-lookup)) |
| `README.md` | Installation and usage documentation |
| `../../.claude-plugin/marketplace.json` | Marketplace manifest at the repo root; lists this plugin with `source: "./plugins/claude-code"` and inherits the rest of its metadata from `plugin.json` |

**⚠️ Mirrored skill:** the Codex, Copilot, Cursor and Antigravity plugins ship byte-identical copies of the `skills/drawio/` folder (`SKILL.md` and `scripts/find-shapes.js`). Any edit to the skill must be applied to every copy — CI ([`check-skill-sync.yml`](../../.github/workflows/check-skill-sync.yml)) fails if the copies drift, if a script doesn't parse, or if the body (after the front matter) reaches 24,000 bytes, the most Antigravity loads, or if the front matter isn't valid YAML. Claude Code forgives an unquoted `: ` in the `description`, but Copilot CLI and other strict parsers drop the skill, so the description is a double-quoted string.

## How It Works

Everything becomes a native `.drawio` file first, then is delivered in the requested output format.

1. User invokes `/drawio:drawio` or Claude detects a diagram request
2. Claude picks an authoring route:
   - **Mermaid** (preferred for standard types) — writes a `.mmd` file, then `drawio -x -f xml -o name.drawio name.mmd` converts and lays it out, or without the desktop CLI `node scripts/mermaid-to-drawio.js name.mmd` (see [Mermaid without the desktop app](#mermaid-without-the-desktop-app)); the `.mmd` is deleted
   - **XML** — writes mxGraphModel XML to `name.drawio`; optionally `drawio -x -f xml --layout <preset|json> -o name.drawio name.drawio` applies an ELK layout (reading and overwriting the same path is supported)
3. Format-specific handling (identical for both routes, since both produce a `.drawio`):
   - **png/svg/pdf** — the draw.io CLI exports to `.drawio.png` / `.drawio.svg` / `.drawio.pdf` with `--embed-diagram`, then deletes the source `.drawio` file
   - **url** — a `node -e` one-liner reads the `.drawio` file, compresses it with `zlib.deflateRawSync` + base64, builds `https://app.diagrams.net/?...#R<compressed XML>`, and opens it in the browser. The `.drawio` file is kept for persistence.
   - **default** — no extra step, the `.drawio` file is the output
4. The result is opened for viewing (`open` / `xdg-open` / `start`; on Windows/WSL2, `url` mode uses a temp `.url` file because `cmd.exe` strips the `#R...` fragment)

Default output is `.drawio` (no export). The user requests another output mode by mentioning the format: `/drawio:drawio png ...`, `/drawio:drawio svg: ...`, `/drawio:drawio url ...`, etc.

**Mermaid → PNG caveat:** direct `.mmd` → PNG with `-e` crashes in current draw.io Desktop (`writePngWithText` receives an undefined `args.xml` at the embed step in `electron.js`). The skill always converts Mermaid to `.drawio` first and exports that, which sidesteps the bug and yields a correct embed. The layout names, JSON schema, and CLI verification are documented in `SKILL.md`.

## URL Mode Compatibility

The `url` mode produces the same `https://app.diagrams.net/#R...` URL format as the MCP Tool Server's XML links (`mcp-tool-server/src/index.js`). Node.js's built-in `zlib.deflateRawSync` and `pako.deflateRaw` both implement RFC 1951, so draw.io decompresses either, though their bytes differ. That difference is one reason the skill doesn't use `#create=` for XML: draw.io rewrites a `#create` hash after loading it, and when the rewrite differs from the link it asks "All changes will be lost!". draw.io never rewrites a `#R` hash. No external npm dependencies are added to the skill — only Node.js built-ins (`zlib`, `child_process`, `fs`, `os`, `path`).

## draw.io CLI Locations

- **macOS**: `/Applications/draw.io.app/Contents/MacOS/draw.io`, or `~/Applications/…` for a per-user install
- **Linux**: `drawio` (on PATH via snap/apt/flatpak)
- **Windows**: `"C:\Program Files\draw.io\draw.io.exe"` (default) — the installer neither registers PATH nor forces a drive
- **WSL2**: `"/mnt/c/Program Files/draw.io/draw.io.exe"` (detect via `grep -qi microsoft /proc/version`)

The skill tries `drawio` first, then falls back to the platform-specific path. On WSL2, use `wslpath -w` to convert paths when opening files with `cmd.exe /c start`.

On macOS the skill tries `drawio` on PATH (the Homebrew cask's wrapper script), `/Applications`, the per-user `~/Applications`, then Spotlight (`mdfind` on the bundle ID `com.jgraph.drawio.desktop`) for an app moved anywhere else. The binary only runs inside its `.app` bundle: a copy or a symlink elsewhere dies with `Unable to find helper app`, which is why Homebrew installs a wrapper script and not a symlink.

On Windows and WSL2 the default path is only the start of the chain: draw.io Desktop can be installed to any drive or directory, so `SKILL.md` also has the skill check the per-user install (`%LOCALAPPDATA%\Programs\draw.io`), the registry uninstall keys (`InstallLocation` / `DisplayIcon`), and `Program Files\draw.io` on the other drives before reporting the CLI as absent.

## Authoring routes

A `.drawio` file is native mxGraphModel XML. The skill produces one two ways: **Mermaid** (converted to `.drawio` by the desktop CLI, `-f xml`, or by `scripts/mermaid-to-drawio.js`) or **XML** (generated directly). Both need no server: Mermaid conversion and ELK layout run locally, in the desktop app's headless export path or in a local headless browser. Without the desktop app, ELK layout and image export are not available; without a browser either, Mermaid goes out as a `#create=` link that draw.io converts when it opens, or the diagram is authored as XML.

## References

Shared references live at the repo root (single source of truth for all prompts); `SKILL.md` fetches each via its GitHub raw URL so they work after install without copying extra files:

- `shared/xml-essentials.md` — the condensed XML rules (used when authoring XML)
- `shared/xml-reference.md` — the full XML generation guide (only for layers, tags, metadata, tables, cross-functional grids, dark-mode colors)
- `shared/mermaid-reference.md` — Mermaid syntax for all supported diagram types (used when authoring Mermaid)

## Shape and icon lookup

`scripts/find-shapes.js` gives the skill what the MCP servers' `search_shapes` tool gives them ([#90](https://github.com/jgraph/drawio-mcp/issues/90)), so it never guesses `mxgraph.*` names. It downloads `shape-search/search-index.json` from jsDelivr (`@main`, the URL the tool server uses, ~430 KB brotli) and lists, in index order, up to six shapes whose tags contain every word of a query. With fewer than six it adds up to three results from the draw.io icon service, styled with `ICON_STYLE_PREFIX` from `shared/icon-search.js`. Relative library images (`image=img/lib/…`) become `https://app.diagrams.net/` URLs, as `shared/shape-search.js` does for the MCP servers: an SVG export from draw.io Desktop would otherwise point them at the local app bundle.

It is a bundled script rather than an inline `node -e` because the skill body must stay under 24,000 bytes. It matches whole words rather than reusing the shared Soundex ranking, which keeps it small; a library name in the query (`aws4 lambda`, `azure2 sql`) does the narrowing, since every shape's first tag is its library.

## Mermaid without the desktop app

`scripts/mermaid-to-drawio.js` converts Mermaid to a `.drawio` file when draw.io Desktop isn't installed. With Node's built-ins only, it starts an installed Chrome, Edge, Chromium or Brave headless (`CHROME_PATH`, else the usual install paths and `PATH` names) over `--remote-debugging-pipe`, loads `viewer-static.min.js`, `drawio-elk.min.js` and `drawio-mermaid.min.js` from `viewer.diagrams.net` into a blank page and runs `HeadlessEditorUi.parseMermaidDiagram`, as the desktop CLI's `-x -f xml` does, then `createMermaidPageXml`. So shapes, connectors and labels come out as native cells, as in the editor. Only the scripts and the diagram's fonts (Recursive, from Google Fonts) are downloaded; the Mermaid is converted in the page and sent nowhere. It passes Mermaid 12's defaults (`version: "12"`), as the MCP servers do; the desktop CLI passes none (Mermaid 11's).

- **Without a browser or the CDN** it exits with 3, and the skill falls back to `--link`: a `#create=` link of type `mermaid` (the tool server's format) that draw.io converts when it opens, or to XML.
- **Sandbox:** Chrome for Testing and Chromium builds without the AppArmor profile of an installed Chrome can't start their sandbox on Ubuntu 23.10+. The script retries those once with `--no-sandbox`, since the page runs only draw.io's scripts on the Mermaid text.
- **Swimlanes:** the editor routes the edges of `swimlane-beta` diagrams with libavoid, which isn't on the CDN, so here they keep the layout's routes.
- **Tests:** `mcp-app-server/test/mermaid-types.test.js` runs every Mermaid type through it and through the app server's viewer, and checks that the result is editable (see the app server's `AGENTS.md`, **Mermaid Conversion**).

It is a script rather than a `node -e` block in `SKILL.md` for the same reason as `find-shapes.js`.

## Coding Conventions

- **Allman brace style**: Opening braces go on their own line for all control structures, functions, objects, and callbacks.
- Prefer `function()` expressions over arrow functions for callbacks.
- See the root `AGENTS.md` for examples.
