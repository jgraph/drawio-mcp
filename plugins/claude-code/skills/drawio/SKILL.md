---
name: drawio
description: "Always use when user asks to create, generate, draw, or design a diagram, flowchart, architecture diagram, ER diagram, sequence diagram, class diagram, network diagram, mockup, wireframe, or UI sketch, or mentions draw.io, drawio, drawoi, .drawio files, or diagram export to PNG/SVG/PDF. Exception: in a chat that shows diagrams inline (VS Code's or Cursor's own chat, Claude.ai, ChatGPT) where the draw.io MCP server's create_diagram tool is available, call that tool instead, unless the user asks for a file or an export. Claude Code, Codex and Copilot CLI, also in their VS Code and JetBrains extensions, don't show diagrams inline: use this skill there."
---

# Draw.io Diagram Skill

Generate draw.io diagrams as native `.drawio` files. Author each diagram either as **Mermaid** (concise text that the draw.io desktop CLI converts and lays out for you) or as **draw.io XML** directly. Optionally auto-layout XML-authored diagrams with **ELK**, export to PNG/SVG/PDF with the diagram XML embedded (so the exported file stays editable in draw.io), or generate a browser URL that opens the diagram directly in the draw.io editor.

**Inline viewer first.** This skill writes files and opens them with a shell command. If the draw.io MCP server's `create_diagram` tool is available in a chat that shows diagrams inline (VS Code's or Cursor's own chat, Claude.ai, ChatGPT), and the user hasn't asked for a `.drawio` file, an export or a URL, call `create_diagram` instead: the diagram appears in the conversation, with no file and no shell command. Claude Code, Codex and Copilot CLI don't show diagrams inline, not even in their VS Code or JetBrains extensions: there `create_diagram` only returns a link, so use this skill.

## Authoring: Mermaid or XML?

The desktop CLI converts Mermaid to a native `.drawio` file and lays it out automatically, which is far more reliable than hand-positioning cells in XML.

| Author as | Best for | Needs desktop CLI? |
|-----------|----------|--------------------|
| **Mermaid** | Flowcharts, sequence, class, state, ER, gantt, mindmap, timeline, user journey, quadrant, C4, git graph, pie, and other standard types | Yes — to convert to `.drawio` |
| **XML** | Custom styling, precise/hand positioning, specific shape libraries (AWS, Azure, network, UML detail…), or when the desktop CLI is not installed | No (optional ELK `--layout` needs the CLI) |

- **Prefer Mermaid** when the desktop CLI is available and the request is one of the standard types above.
- **Use XML** for precise control, or as the universal fallback: XML needs no CLI, so it's the only option when the desktop app isn't installed (deliver a `.drawio` file or a `url`). For XML you can let the CLI apply an [ELK auto-layout](#elk-layout-for-xml) instead of computing coordinates yourself.

If you're unsure whether the desktop CLI is present, detect it first (see [Locating the CLI](#locating-the-cli)).

## The pipeline

Every diagram becomes a native `.drawio` file first, then is delivered in the requested output format, whether you authored Mermaid or XML.

1. **Author → `.drawio`**
   - **Mermaid**: write the Mermaid to a `.mmd` file, then convert it with the CLI:
     ```bash
     drawio -x -f xml -o diagram.drawio diagram.mmd
     ```
     Delete the `.mmd` afterward — the `.drawio` is the artifact.
   - **XML**: write the mxGraphModel XML to `diagram.drawio` (see [XML format](#xml-format)), then run the [repair pass](#repair-pass) on it. Optionally apply an [ELK layout](#elk-layout-for-xml).
2. **Deliver** (identical for both sources):
   - *(no format)* → keep `diagram.drawio` and open it.
   - **png / svg / pdf** → export from the `.drawio` with embedded XML, then delete the source `.drawio`:
     ```bash
     drawio -x -f png -e -b 10 -o diagram.drawio.png diagram.drawio
     ```
   - **url** → build a browser URL from the `.drawio` XML, open it, and keep the `.drawio` as a local copy (see [Browser URL output](#browser-url-output)).
3. **Open the result** — the exported file, the URL, or the `.drawio` (see [Opening the result](#opening-the-result)). If the open command fails, print the absolute path (or URL) so the user can open it manually.

**Always convert Mermaid to `.drawio` first, then export** — direct Mermaid → PNG export with `-e` is broken in current draw.io Desktop (the embedded-XML step crashes); the two-step path is reliable and produces an editable embed.

If Mermaid was requested but no desktop CLI is available, author the same diagram as XML.

## ELK layout for XML

The CLI's `--layout` step auto-positions XML-authored diagrams with the same ELK layouts as the editor's *Arrange ▸ Layout* menu and the draw.io MCP app server. Generate the cells with approximate (or even `0,0`) positions and get the graph *structure* — nodes and edges — right. Use `verticalFlow` / `horizontalFlow` for flow-style diagrams and `organic` for networks. Mermaid-authored diagrams are already laid out — don't add `--layout`.

Lay out in place after you write the file (reading and overwriting the same path is supported), or combine layout with export in one call:

```bash
drawio -x -f xml --layout verticalFlow -o diagram.drawio diagram.drawio
drawio -x -f png -e -b 10 --layout verticalFlow -o diagram.drawio.png diagram.drawio
```

### Layout presets

| Name | Layout |
|------|--------|
| `verticalFlow` | Layered, top-to-bottom — flowcharts, pipelines |
| `horizontalFlow` | Layered, left-to-right |
| `verticalTree` | Tree, top-down — hierarchies, org charts |
| `horizontalTree` | Tree, left-to-right |
| `radialTree` | Radial tree |
| `organic` | Force-directed — networks, mind-map-like graphs |

### Custom layout JSON

For finer control, pass a JSON **array** (starting with `[`) instead of a preset name — the format of the editor's custom-layout dialog:

```bash
drawio -x -f xml --layout '[{"layout":"elkLayered","config":{"elk.direction":"RIGHT"}}]' -o diagram.drawio diagram.drawio
```

Each entry is `{"layout": <algorithm>, "config": { … }}`. Algorithms: `elkLayered`, `elkTree`, `elkRadial`, `elkOrganic`, `elkStress`, `elkBox`. Config entries starting with `elk.` are ELK options, e.g. `elk.direction` (`UP` / `DOWN` / `LEFT` / `RIGHT`), `elk.spacing.nodeNode`, `elk.layered.spacing.nodeNodeBetweenLayers`; `edgeStyle` (e.g. `orthogonal`) and `corners` (e.g. `rounded`) control connector rendering.

### Orthogonal edge routing

`--layout libavoid` routes the **edges** orthogonally around the shapes (*Arrange ▸ Layout ▸ Orthogonal Routing*) without moving any vertex. Run it in place on hand-positioned XML whose connectors cross shapes; skip it after a flow/tree preset, which already routes its edges:

```bash
drawio -x -f xml --layout libavoid -o diagram.drawio diagram.drawio
```

## Mermaid syntax reference

When authoring Mermaid, fetch and follow the shared Mermaid reference (all supported diagram types plus flowchart styling — `style`, `classDef`, `linkStyle`):

https://raw.githubusercontent.com/jgraph/drawio-mcp/main/shared/mermaid-reference.md

Match the language of the diagram labels to the user's language.

## Choosing the output format

Check the user's request for a format preference. Examples:

- `/drawio:drawio create a flowchart` → Mermaid → `flowchart.drawio`
- `/drawio:drawio png flowchart for login` → Mermaid → `login-flow.drawio.png`
- `/drawio:drawio svg: ER diagram` → Mermaid → `er-diagram.drawio.svg`
- `/drawio:drawio pdf AWS architecture overview` → XML (needs AWS shapes) → `architecture-overview.drawio.pdf`
- `/drawio:drawio url flowchart for user login` → opens browser at `app.diagrams.net` with the diagram, keeps `login-flow.drawio` locally

If no format is mentioned, produce the `.drawio` file and open it; the user can ask to export later.

PNG, SVG and PDF are exported with `-e` (`--embed-diagram`): the file contains the full diagram XML, so opening it in draw.io recovers the editable diagram. `jpg` is lossy and can't embed the XML.

## Browser URL output

For `url` format, keep the `.drawio` file on disk as the user's local copy, compress its XML with Node.js's built-in `zlib` into a `https://app.diagrams.net/#R...` URL, and open that in the default browser — no draw.io Desktop needed to *view* it.

### URL generation

Run this `node -e` one-liner to read the `.drawio` file and print the URL (replace `DIAGRAM.drawio` with the actual filename):

```bash
URL=$(node -e '
const fs = require("fs");
const zlib = require("zlib");
const xml = fs.readFileSync(process.argv[1], "utf8");
const compressed = zlib.deflateRawSync(encodeURIComponent(xml)).toString("base64");
console.log("https://app.diagrams.net/?grid=0&pv=0&border=10&edit=_blank#R" + encodeURIComponent(compressed));
' "DIAGRAM.drawio")
```

This is the MCP Tool Server's XML link format. Don't use a `#create=` URL for XML: draw.io rewrites that hash after loading it, and when the rewrite differs from the link (it does for Node's `zlib` output, which isn't byte-identical to draw.io's pako) it asks "All changes will be lost!".

### Opening the URL

| Environment | Command |
|-------------|---------|
| macOS | `open "$URL"` |
| Linux (native) | `xdg-open "$URL"` |
| WSL2 | Write a temp `.url` file, open via `cmd.exe` (see below) |
| Windows (native) | Write a temp `.url` file, open via `start` (see below) |

`cmd.exe`'s `start` command treats `&` as a command separator and strips everything after `#`, which is where the diagram lives, so on Windows and WSL2 put the URL in a `.url` shortcut file instead.

**WSL2:**

```bash
TMPFILE=$(mktemp --suffix=.url)
printf '[InternetShortcut]\r\nURL=%s\r\n' "$URL" > "$TMPFILE"
cmd.exe /c start "" "$(wslpath -w "$TMPFILE")"
```

**Windows (native):** do **not** build the `.url` file with `echo URL=%URL%` — the `&` characters (`?grid=0&pv=0&...`) cut the shortcut short and the diagram is lost. Let Node write the file and open only its path, which never contains `&`:

```bash
TMPFILE=$(node -e '
const fs = require("fs");
const os = require("os");
const path = require("path");
const p = path.join(os.tmpdir(), "drawio.url");
fs.writeFileSync(p, "[InternetShortcut]\r\nURL=" + process.argv[1] + "\r\n");
process.stdout.write(p);
' "$URL")
cmd.exe /c start "" "$TMPFILE"
```

Then print the URL and the local file so the user can share or re-edit it:

```
Opened in browser: <URL>
Local file: DIAGRAM.drawio
```

Very large diagrams may exceed the browser's URL length limit (roughly 32K–2MB depending on the browser); then open the `.drawio` file locally instead.

## draw.io CLI

The draw.io desktop app's command-line interface **converts Mermaid** to `.drawio`, applies **ELK layouts** (`--layout`), and **exports** to PNG/SVG/PDF. All three need the desktop app installed.

### Locating the CLI

Detect the environment first, then locate the CLI. On Windows (native and WSL2) the installer does **not** put draw.io on PATH and the install directory is user-selectable, so work through the whole fallback chain before concluding the CLI is absent.

#### WSL2 (Windows Subsystem for Linux)

WSL2 is detected when `/proc/version` contains `microsoft` or `WSL`:

```bash
grep -qi microsoft /proc/version 2>/dev/null && echo "WSL2"
```

On WSL2, use the Windows draw.io Desktop executable via `/mnt/c/...`:

```bash
DRAWIO_CMD="/mnt/c/Program Files/draw.io/draw.io.exe"
```

Double-quote the path so the space in `Program Files` stays part of it. Do **not** wrap it in backticks — in bash that is command substitution, which would *execute* the binary instead of storing its path.

If draw.io is installed in a non-default location, check common alternatives:

```bash
# Default install path
"/mnt/c/Program Files/draw.io/draw.io.exe"

# Per-user install (if the above does not exist)
"/mnt/c/Users/$WIN_USER/AppData/Local/Programs/draw.io/draw.io.exe"
```

If neither exists, the install is on another drive or in a custom directory — scan the other mounted drives, then ask the registry:

```bash
# Program Files on the other drives (D:, E:, …)
ls /mnt/*/Program\ Files/draw.io/draw.io.exe 2>/dev/null | head -1

# Registry — the installer records the directory the user picked
for REG_PATH in 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall' \
                'HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall' \
                'HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'; do
  WIN_DIR=$(reg.exe query "$REG_PATH" /s /v InstallLocation 2>/dev/null |
            grep -i 'REG_SZ.*draw\.io' | head -1 |
            sed 's/.*REG_SZ[[:space:]]*//' | tr -d '\r')
  [ -n "$WIN_DIR" ] && DRAWIO_CMD="$(wslpath -u "${WIN_DIR%\\}")/draw.io.exe" && break
done
```

#### macOS and Linux

- **Linux (native)**: `drawio`, typically on PATH via snap/apt/flatpak — confirm with `which drawio`
- **macOS**: this prints the first of `drawio` on PATH (Homebrew), `/Applications`, the per-user `~/Applications` and Spotlight, or nothing if draw.io is absent:

```bash
{ command -v drawio; ls /Applications/draw.io.app/Contents/MacOS/draw.io ~/Applications/draw.io.app/Contents/MacOS/draw.io
  mdfind "kMDItemCFBundleIdentifier == 'com.jgraph.drawio.desktop'" | sed 's|$|/Contents/MacOS/draw.io|'; } 2>/dev/null | head -1
```

Call the binary inside the `.app`: a copy or symlink outside it dies with `Unable to find helper app`.

#### Windows (native, non-WSL2)

Check, in order — a missing PATH entry or a non-`C:` install drive is normal, not a sign that draw.io is missing:

1. **PATH**: `where.exe draw.io` (note the dot — the executable is `draw.io.exe`, not `drawio.exe`)
2. **Default install paths**: `C:\Program Files\draw.io\draw.io.exe`, then the per-user install `%LOCALAPPDATA%\Programs\draw.io\draw.io.exe`
3. **The registry** uninstall entries, which record the directory the user picked
4. **The other drives**: `Program Files\draw.io\draw.io.exe` on `D:`, `E:`, …

Save this as `find-drawio.ps1` to run the whole chain at once — it prints the first executable it finds, and nothing at all if draw.io really is not installed:

```powershell
$c = @()
$c += (where.exe draw.io 2>$null)
$c += "$env:ProgramFiles\draw.io\draw.io.exe", "$env:LOCALAPPDATA\Programs\draw.io\draw.io.exe"
$c += Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                       'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                       'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like '*draw.io*' } |
      ForEach-Object { if ($_.InstallLocation) { Join-Path $_.InstallLocation 'draw.io.exe' } else { ($_.DisplayIcon -split ',')[0] } }
$c += (Get-PSDrive -PSProvider FileSystem).Root | ForEach-Object { Join-Path $_ 'Program Files\draw.io\draw.io.exe' }
$c | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
```

From a bash or cmd shell, run it with:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File find-drawio.ps1
```

Quote the resulting path on every call — it almost always contains spaces:

```
& "D:\Program Files\draw.io\draw.io.exe" -x -f xml -o diagram.drawio diagram.mmd
```

Only once every step comes up empty should you treat the CLI as absent and fall back to XML authoring with `.drawio` / `url` output. When you find it outside PATH, mention that adding its folder (e.g. `D:\Program Files\draw.io`) to PATH makes it discoverable next time.

### Export command

```bash
drawio -x -f <format> -e -b 10 -o "<output>" "<input.drawio>"
```

On WSL2, call the Windows executable, e.g. `"/mnt/c/Program Files/draw.io/draw.io.exe" -x -f png -e -b 10 -o "diagram.drawio.png" "diagram.drawio"`. The convert and layout commands are in [The pipeline](#the-pipeline) and [ELK layout for XML](#elk-layout-for-xml).

Key flags:
- `-x` / `--export`: export mode (also used for Mermaid conversion and layouts)
- `-f` / `--format`: output format (`xml`, png, svg, pdf, jpg) — use `xml` to produce a `.drawio` from Mermaid or a layout
- `--layout`: run a layout before writing the output — an ELK preset name, `libavoid` edge routing, or a custom-layout JSON array
- `--mermaid-image 1`: convert Mermaid to a single static SVG image cell (the Mermaid source stays on the cell for re-editing) instead of an editable diagram — only when the user explicitly asks for a non-editable image cell
- `-e` / `--embed-diagram`: embed diagram XML in the output (PNG, SVG, PDF only)
- `-o` / `--output`: output file path
- `-b` / `--border`: border width around diagram (default: 0)
- `-t` / `--transparent`: transparent background (PNG only)
- `-s` / `--scale`: scale the diagram size
- `--width` / `--height`: fit into specified dimensions (preserves aspect ratio)
- `-a` / `--all-pages`: export all pages (PDF only)
- `-p` / `--page-index`: select a specific page (1-based)
- `--disable-gpu`: skip GPU initialisation — add it when a command dies with `GPU process isn't usable` (Windows remote-desktop sessions, VMs, CI runners); no convert, layout, or export path needs the GPU

### Opening the result

**Inside VS Code** (also Cursor or Windsurf, with their `cursor` / `windsurf` commands in place of `code`), open the file in an editor tab, next to the chat: with the [Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio) extension installed, VS Code shows `.drawio`, `.drawio.svg` and `.drawio.png` files as editable diagrams. One command checks for the extension and otherwise falls back to the platform's command below (`open` on macOS):

```bash
code --list-extensions 2>/dev/null | grep -qi '^hediet.vscode-drawio$' && code <file> || open <file>
```

PDFs and `url` mode always use the platform's command:

| Environment | Command |
|-------------|---------|
| macOS | `open <file>` |
| Linux (native) | `xdg-open <file>` |
| WSL2 | `cmd.exe /c start "" "$(wslpath -w <file>)"` |
| Windows | `start <file>` |

On WSL2, `wslpath -w` turns the path into a Windows path, since `cmd.exe` can't resolve `/mnt/c/...`, and the empty `""` keeps `start` from reading the filename as a window title.

## File naming

- Use a descriptive, lowercase, hyphenated name based on the content (e.g., `login-flow`, `database-schema`)
- Exports use double extensions — `name.drawio.png`, `name.drawio.svg`, `name.drawio.pdf` — to signal the embedded diagram XML
- For `url` mode, keep the `.drawio` file (no double extension) — the URL is a view/edit handle and the local file is the persistent copy

## XML format

A `.drawio` file is native mxGraphModel XML, the same format the CLI converts Mermaid to.

### Basic structure

Every diagram must have this structure:

```xml
<mxGraphModel adaptiveColors="auto">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
  </root>
</mxGraphModel>
```

- Cell `id="0"` is the root layer
- Cell `id="1"` is the default parent layer
- All diagram elements use `parent="1"` unless using multiple layers
- **Cells inside a container** use `parent="<container_id>"` and coordinates relative to that container
- **Edges belong to the innermost container that holds BOTH endpoints** — same container (at any nesting depth) → that container's id; one end outside every container → `parent="1"`. An auto-layout reads an edge's coordinates in its parent's frame, so an edge parked further out than its endpoints is laid out in the wrong place

### CRITICAL: XML well-formedness

- **NEVER include ANY XML comments (`<!-- -->`) in the output.** XML comments are strictly forbidden — they waste tokens, can cause parse errors, and serve no purpose in diagram XML.
- Escape special characters in attribute values: `&amp;`, `&lt;`, `&gt;`, `&quot;`
- Always use unique `id` values for each `mxCell`
- Every edge needs a child `<mxGeometry relative="1" as="geometry" />` — a self-closing edge `mxCell` doesn't render

### Repair pass

Run this right after writing XML to a `.drawio` file, before any layout, export or URL step. It fixes the mechanical slips that make draw.io reject a diagram: text around the diagram (a code fence, a sentence, a stray closing tag), `<` or a stray `&` inside an attribute value (an unescaped HTML label, "R&D", `&nbsp;`), and the default layer written as its own parent (`<mxCell id="1" parent="1"/>`, which hides everything). It changes nothing in a well-formed file, and needs only Node.js (skip it if `node` isn't installed). Replace `DIAGRAM.drawio` with the actual filename:

```bash
node -e '
const fs = require("fs");
const file = process.argv[1];
let xml = fs.readFileSync(file, "utf8");
const diagram = xml.match(/<mxfile[\s\S]*?<\/mxfile>|<mxGraphModel[\s\S]*?<\/mxGraphModel>/);
if (diagram && xml.trim() !== diagram[0]) xml = diagram[0];
xml = xml.replace(/="([^"]*)"/g, function(m, v)
{
  return "=\"" + v.replace(/</g, "&lt;").replace(/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/g, "&amp;") + "\"";
});
xml = xml.replace(/<mxCell id="([^"]+)" parent="\1"\s*\/>/g, "<mxCell id=\"$1\" parent=\"0\"/>");
fs.writeFileSync(file, xml);
' "DIAGRAM.drawio"
```

## XML reference

Before authoring XML, fetch and follow the condensed XML rules — skeleton, vertex and edge templates, labels, shapes, the layout grid, containers, swimlanes and edge styles:
https://raw.githubusercontent.com/jgraph/drawio-mcp/main/shared/xml-essentials.md

They cover most diagrams. Only when a diagram needs layers, tags, metadata and placeholders, tables, cross-functional grids or dark-mode colors, also fetch the full XML reference (it describes the draw.io MCP servers: for their `search_shapes` tool use the [lookup below](#shapes-and-icons), for `postLayout` / `routing` the CLI's [`--layout`](#elk-layout-for-xml)):
https://raw.githubusercontent.com/jgraph/drawio-mcp/main/shared/xml-reference.md

### Shapes and icons

When a diagram needs cloud, network or brand icons (AWS, Azure, GCP, Cisco, Kubernetes, GitHub, Slack…), never guess `mxgraph.*` names: look them all up in one call to `scripts/find-shapes.js` in this skill's folder (Node.js 18+, network), one query per icon, narrowed by library (`aws4`, `azure2`, `cisco19`). It searches draw.io's shape libraries, then its icon service, and prints `title width×height style` lines; use a style as is:

```bash
node <skill-folder>/scripts/find-shapes.js "aws4 lambda" "github" "slack"
```

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| draw.io CLI not found | Desktop app not installed or not on PATH | Work through [Locating the CLI](#locating-the-cli); if it's really absent, author as XML and deliver a `.drawio` file or `url`, and tell the user that installing the draw.io desktop app enables Mermaid conversion, layouts and image export |
| Mermaid → PNG export crashes | Direct `.mmd` → PNG with `-e` is broken in current draw.io Desktop | Convert Mermaid to `.drawio` first (`-f xml`), then export the `.drawio` |
| Blank diagram from Mermaid | Misspelled type keyword, or a syntax error (bad node ID, unquoted label) | Check the [Mermaid reference](#mermaid-syntax-reference); the first non-directive line's keyword selects the diagram type |
| Layout does nothing / errors | Unknown preset name, custom JSON not an array, or a desktop build too old for `--layout` / `.mmd` input | Use a [preset](#layout-presets) or a JSON array starting with `[`; on an old desktop build, author as XML with explicit positions and tell the user updating draw.io Desktop enables Mermaid conversion and layouts |
| Export produces empty/corrupt file, or the diagram looks blank | Invalid XML, or missing root cells `id="0"` and `id="1"` | Run the [repair pass](#repair-pass) and check the [basic structure](#basic-structure) |
| `GPU process isn't usable. Goodbye.` during convert/layout/export | Electron cannot start a GPU process — typical on Windows remote-desktop sessions, VMs, and CI runners. The `os_crypt` / `Failed to decrypt` lines printed before it are unrelated noise | Retry the same command with `--disable-gpu` added; draw.io Desktop's own `--disable-acceleration` switch has the same effect |
| Browser opens with an empty diagram in `url` mode | `cmd.exe` stripped the `#R...` fragment | Use the `.url` file workaround on Windows/WSL2 (see [Opening the URL](#opening-the-url)) — never pass the URL directly to `cmd.exe /c start` |
