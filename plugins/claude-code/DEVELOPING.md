# Claude Code Plugin: drawio

A Claude Code plugin that ships the `drawio` skill: it generates native `.drawio` files, authored either as Mermaid (converted + laid out by the draw.io desktop CLI) or as draw.io XML directly, with optional ELK `--layout` for XML, export to PNG/SVG/PDF (with embedded XML) via the desktop CLI, or a browser URL that opens the diagram directly at `app.diagrams.net`. No MCP server required.

Previously distributed as a bare `SKILL.md` users copied into `~/.claude/skills/`; now packaged as a real plugin so it loads via `claude --plugin-dir ./plugins/claude-code` and is distributed through the [`drawio` marketplace](../../.claude-plugin/marketplace.json) at the repo root (`/plugin install drawio@drawio`).

## Key Files

| File | Purpose |
|------|---------|
| `.claude-plugin/plugin.json` | Plugin manifest — the single source of truth for name, version, description, author, license |
| `skills/drawio/SKILL.md` | The skill itself (its folder name `drawio` becomes the second half of the `/drawio:drawio` invocation) |
| `skills/drawio/scripts/fix_edge_parents.py` | Bundled helper the skill runs on every generated `.drawio`: sets each edge's `parent` to the nearest common ancestor of its `source` and `target` (see [Edge parents](#edge-parents)) |
| `README.md` | Installation and usage documentation |
| `../../.claude-plugin/marketplace.json` | Marketplace manifest at the repo root; lists this plugin with `source: "./plugins/claude-code"` and inherits the rest of its metadata from `plugin.json` |

**⚠️ Mirrored skill:** the Codex and Copilot plugins ship byte-identical copies of `skills/drawio/SKILL.md` and `skills/drawio/scripts/fix_edge_parents.py` at `plugins/codex/drawio/skills/drawio/` and `plugins/copilot/skills/drawio/`. Any edit to either file must be applied to all copies — CI ([`check-skill-sync.yml`](../../.github/workflows/check-skill-sync.yml)) fails if they drift.

## How It Works

Everything becomes a native `.drawio` file first, then is delivered in the requested output format.

1. User invokes `/drawio:drawio` or Claude detects a diagram request
2. Claude picks an authoring route:
   - **Mermaid** (preferred for standard types when the desktop CLI is present) — writes a `.mmd` file, then `drawio -x -f xml -o name.drawio name.mmd` converts and lays it out; the `.mmd` is deleted
   - **XML** — writes mxGraphModel XML to `name.drawio`; optionally `drawio -x -f xml --layout <preset|json> -o name.drawio name.drawio` applies an ELK layout (reading and overwriting the same path is supported)
3. `python3 scripts/fix_edge_parents.py name.drawio` repairs the edge `parent` attributes before any layout pass (see [Edge parents](#edge-parents))
4. Format-specific handling (identical for both routes, since both produce a `.drawio`):
   - **png/svg/pdf** — the draw.io CLI exports to `.drawio.png` / `.drawio.svg` / `.drawio.pdf` with `--embed-diagram`, then deletes the source `.drawio` file
   - **url** — a `node -e` one-liner reads the `.drawio` file, compresses it with `zlib.deflateRawSync` + base64, builds `https://app.diagrams.net/?...#create={type,compressed,data}`, and opens it in the browser. The `.drawio` file is kept for persistence.
   - **default** — no extra step, the `.drawio` file is the output
5. The result is opened for viewing (`open` / `xdg-open` / `start`; on Windows/WSL2, `url` mode uses a temp `.url` file because `cmd.exe` strips the `#create=...` fragment)

Default output is `.drawio` (no export). The user requests another output mode by mentioning the format: `/drawio:drawio png ...`, `/drawio:drawio svg: ...`, `/drawio:drawio url ...`, etc.

**Mermaid → PNG caveat:** direct `.mmd` → PNG with `-e` crashes in current draw.io Desktop (`writePngWithText` receives an undefined `args.xml` at the embed step in `electron.js`). The skill always converts Mermaid to `.drawio` first and exports that, which sidesteps the bug and yields a correct embed. The layout names, JSON schema, and CLI verification are documented in `SKILL.md`.

## Edge parents

mxGraph expects an edge's `parent` to be the nearest common ancestor of its `source` and `target` cells. LLM-authored XML (and, for `subgraph` blocks, Mermaid conversion) tends to leave every edge on the default layer (`parent="1"`) instead. Such a file renders correctly, but the ELK/`--layout` passes lay it out wrongly.

`skills/drawio/scripts/fix_edge_parents.py` is the fix, and `SKILL.md` makes running it a pipeline step of its own — after authoring, before `--layout` and before delivery:

```bash
python3 scripts/fix_edge_parents.py diagram.drawio
```

- **Rule** — a faithful port of [`mxGraphModel.updateEdgeParent`](https://github.com/jgraph/drawio/blob/v31.1.8/src/main/webapp/mxgraph/src/model/mxGraphModel.js#L832-L885) (with [`getOrigin`](https://github.com/jgraph/drawio/blob/v31.1.8/src/main/webapp/mxgraph/src/model/mxGraphModel.js#L893-L918), [`getNearestCommonAncestor`](https://github.com/jgraph/drawio/blob/v31.1.8/src/main/webapp/mxgraph/src/model/mxGraphModel.js#L930-L970) and [`mxGeometry.translate`](https://github.com/jgraph/drawio/blob/v31.1.8/src/main/webapp/mxgraph/src/model/mxGeometry.js#L299-L337), as bundled with draw.io v31.1.8): a relative source (a port, a label) resolves to its owner, a self-loop takes its terminal's parent, the root layer's own children are never pulled into a sibling layer, and the edge geometry (`x`/`y`, `sourcePoint`, `targetPoint`, `Array as="points"`) is translated by the origin delta so the edge does not move on screen. `as="offset"` points are left alone, matching `mxGeometry.translate`. The port is deliberately transcription-close: `update_edge_parent()` follows the JavaScript statement by statement, and the model helpers keep the upstream names (`get_parent`, `get_terminal`, `get_origin`, `get_nearest_common_ancestor`, `is_ancestor`, `is_edge`, `translate`) and its local variable names (`source`, `target`, `cell`, `geo`, `origin1`/`origin2`, `dx`/`dy`).
- **draw.io's override** — draw.io sets [`ignoreRelativeEdgeParent = false`](https://github.com/jgraph/drawio/blob/v31.1.8/src/main/webapp/js/grapheditor/Graph.js#L175) ("Keeps edges between relative child cells inside parent"), where bare mxGraph defaults it to `true`. So a relative *target* is **not** resolved to its owner and the edge stays inside the cell that owns the port. The script follows draw.io, not the mxGraph default; `IGNORE_RELATIVE_EDGE_PARENT` at the top of the file is the switch. No other `mxGraphModel`/`mxGeometry`/`mxCell` prototype override in the draw.io webapp touches the ported code paths.
- **Byte-preserving** — the file is parsed with `expat` while recording start-tag offsets (`parser.CurrentByteIndex`), and only the attributes that must change are spliced back into the original bytes. No reformatting, no attribute reordering, no dropped declaration. Re-running it is a no-op.
- **Inputs** — a bare `<mxGraphModel>` or an `<mxfile>`; every page is processed, compressed pages included (`deflateRaw` + base64, re-encoded the same way). A compressed page is read as the concatenation of its text runs, the string `Editor.parseDiagramNode` decodes, so character references and CDATA framing are handled; a page that ends up rewritten has its whole content replaced, which drops any comment sitting inside it. Non-ASCII content (labels, ids, escaped markup, a UTF-8 BOM, single-byte encodings such as `ISO-8859-1`) is handled byte-for-byte; UTF-16/32 input is rejected with an error rather than patched, since byte-offset splicing assumes single-byte markup.
- **Dependencies** — Python 3 standard library only. No draw.io Desktop, no network, no npm/pip packages.
- **CLI** — one or more paths (in place), `-` for stdin → stdout, `-n`/`--dry-run` to report only, `-q`/`--quiet` to silence the per-file report on stderr. Exit status is 1 if a file could not be read or parsed. The report names every edge it touched:

  ```
  diagram.drawio: 1 edge parent(s) fixed
    e2: parent="1" -> parent="vpc"
  ```

- **Deviations from upstream** — kept to these three, everything else follows the JavaScript: (1) `updateEdgeParent` finishes with `this.add(cell, edge, this.getChildCount(cell))`, making the edge the *last* child of its new parent; the script only rewrites the `parent` attribute and leaves the element where it is in the document, so the child index (z-order within the parent) can differ. (2) A zero origin delta skips the geometry translation instead of adding `x="0" y="0"`. (3) Parent walks stop on a cell parented to itself or to a cycle, which upstream cannot represent and would recurse on forever.
- **Attribute semantics** — flags are read the way mxGraph evaluates them (`edge != 0`, `if (geo.relative)`), so only a missing, empty or numerically zero value is false; coordinates are read with JavaScript `parseFloat` semantics and non-finite results become 0, matching `mxObjectCodec.convertAttributeFromXml`; numbers are written back with shortest-round-trip formatting, as JavaScript stringifies them.
- **Tests** — [`plugins/tests/`](../tests/README.md), `python3 -m unittest discover -s plugins/tests` from the repo root (stdlib only, also run by [`test-scripts.yml`](../../.github/workflows/test-scripts.yml)). The fixtures are compared byte for byte, so a change that reformats anything fails the suite.
- **Attribution** — the ported files carry `Copyright (c) 2006-2018, JGraph Holdings Ltd` / `Copyright (c) 2006-2018, draw.io AG` (`mxGraphModel.js`) and `Copyright (c) 2006-2015, JGraph Holdings Ltd` / `Copyright (c) 2006-2015, draw.io AG` (`mxGeometry.js`). The script's docstring reproduces both notices, links each ported function, and points at [draw.io's `LICENSE`](https://github.com/jgraph/drawio/blob/v31.1.8/LICENSE) (Apache 2.0) for the terms.

The shared `shared/xml-reference.md` still tells authors to give cross-container edges `parent="1"`; `SKILL.md` states that the nearest-common-ancestor rule takes precedence, and the script repairs the output either way.

### Why byte-preserving

Rewriting the file through a DOM (`ElementTree` or similar) would have been far less code. Splicing bytes was chosen anyway, for two reasons:

- **The agent's context stays accurate.** Nothing changes except the `parent` attributes, plus any waypoints that have to shift with them, so the file on disk still matches the XML the agent holds in context apart from exactly those attributes — and the report (`e2: parent="1" -> parent="vpc"`) accounts for that difference one-to-one.
- **Users can run it on existing diagrams.** Re-serializing changes the XML declaration, indentation, attribute order (draw.io writes `id` → `value` → `style` …) and `<mxfile>` framing. Semantically identical, but in a Git-tracked `.drawio` a one-attribute fix would surface as a whole-file diff.

The script works as follows:

1. The script records the byte offsets of each start/end tag reported by the Expat parser.
2. After modifying the attributes of the in-memory model, the script re-scans the open tag and records the byte offsets of the attributes.
3. The script makes patches.
4. The script applies the patches from end to beginning.

## URL Mode Compatibility

The `url` mode produces the exact same `https://app.diagrams.net/#create=...` URL format as the MCP Tool Server (`mcp-tool-server/src/index.js`). Node.js's built-in `zlib.deflateRawSync` and `pako.deflateRaw` both implement RFC 1951, so their outputs are interchangeable. No external npm dependencies are added to the skill — only Node.js built-ins (`zlib`, `child_process`, `fs`, `os`, `path`).

## draw.io CLI Locations

- **macOS**: `/Applications/draw.io.app/Contents/MacOS/draw.io`
- **Linux**: `drawio` (on PATH via snap/apt/flatpak)
- **Windows**: `"C:\Program Files\draw.io\draw.io.exe"`
- **WSL2**: `"/mnt/c/Program Files/draw.io/draw.io.exe"` (detect via `grep -qi microsoft /proc/version`)

The skill tries `drawio` first, then falls back to the platform-specific path. On WSL2, use `wslpath -w` to convert paths when opening files with `cmd.exe /c start`.

## Authoring routes

A `.drawio` file is native mxGraphModel XML. The skill produces one two ways: **Mermaid** (converted to `.drawio` by the desktop CLI, `-f xml`) or **XML** (generated directly). Both need no server — Mermaid conversion and ELK layout run locally in the desktop app's headless export path. When no desktop CLI is available, only the XML route is usable (`.drawio` file or `url`); Mermaid conversion, ELK layout, and image export all require the desktop app.

## References

Two shared references live at the repo root (single source of truth for all prompts); `SKILL.md` fetches each via its GitHub raw URL so they work after install without copying extra files:

- `shared/xml-reference.md` — draw.io XML generation guide (used when authoring XML)
- `shared/mermaid-reference.md` — Mermaid syntax for all supported diagram types (used when authoring Mermaid)

## Coding Conventions

- **Allman brace style**: Opening braces go on their own line for all control structures, functions, objects, and callbacks.
- Prefer `function()` expressions over arrow functions for callbacks.
- See the root `CLAUDE.md` for examples.
