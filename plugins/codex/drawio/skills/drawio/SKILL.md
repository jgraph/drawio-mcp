---
name: drawio
description: Always use when user asks to create, generate, draw, or design a diagram, flowchart, architecture diagram, ER diagram, sequence diagram, class diagram, network diagram, mockup, wireframe, or UI sketch, or mentions draw.io, drawio, drawoi, .drawio files, or diagram export to PNG/SVG/PDF. Exception: in a chat that shows diagrams inline (VS Code's or Cursor's own chat, Claude.ai, ChatGPT) where the draw.io MCP server's create_diagram tool is available, call that tool instead, unless the user asks for a file or an export. Claude Code, Codex and Copilot CLI, also in their VS Code and JetBrains extensions, don't show diagrams inline: use this skill there.
---

# Draw.io Diagram Skill

Generate draw.io diagrams as native `.drawio` files. Author each diagram either as **Mermaid** (concise text that the draw.io desktop CLI converts and lays out for you) or as **draw.io XML** directly. Optionally auto-layout XML-authored diagrams with **ELK**, export to PNG/SVG/PDF with the diagram XML embedded (so the exported file stays editable in draw.io), or generate a browser URL that opens the diagram directly in the draw.io editor.

**Inline viewer first.** This skill writes files and opens them with a shell command. If the draw.io MCP server's `create_diagram` tool is available in a chat that shows diagrams inline (VS Code's or Cursor's own chat, Claude.ai, ChatGPT), and the user hasn't asked for a `.drawio` file, an export or a URL, call `create_diagram` instead: the diagram appears in the conversation, with no file and no shell command. Claude Code, Codex and Copilot CLI don't show diagrams inline, not even in their VS Code or JetBrains extensions: there `create_diagram` only returns a link, so use this skill.

## Authoring: Mermaid or XML?

The desktop CLI can convert Mermaid to a native `.drawio` file, so **prefer Mermaid** for the diagram types it handles well — its parser lays the diagram out automatically, which is far more reliable than hand-positioning cells in XML.

| Author as | Best for | Needs desktop CLI? |
|-----------|----------|--------------------|
| **Mermaid** | Flowcharts, sequence, class, state, ER, gantt, mindmap, timeline, user journey, quadrant, C4, git graph, pie, and other standard types | Yes — to convert to `.drawio` |
| **XML** | Custom styling, precise/hand positioning, specific shape libraries (AWS, Azure, network, UML detail…), or when the desktop CLI is not installed | No (optional ELK `--layout` needs the CLI) |

- **Prefer Mermaid** when the desktop CLI is available and the request is one of the standard types above — write terse Mermaid and let draw.io lay it out.
- **Use XML** for precise control, or as the universal fallback: XML needs no CLI at all, so it's the only option when the desktop app isn't installed (output a `.drawio` file or a `url`).
- For XML-authored diagrams you can ask the CLI to apply an **ELK auto-layout** (`--layout`) instead of computing coordinates yourself — the same layouts the draw.io editor's *Arrange ▸ Layout* menu applies, and the same engine the draw.io MCP app server uses. See [ELK layout for XML](#elk-layout-for-xml).

If you're unsure whether the desktop CLI is present, detect it first (see [Locating the CLI](#locating-the-cli)). No CLI → author as XML and deliver a `.drawio` file or a `url`.

## The pipeline

Every diagram becomes a native `.drawio` file first, then is delivered in the requested output format. This keeps the delivery step identical whether you authored Mermaid or XML.

1. **Author → `.drawio`**
   - **Mermaid**: write the Mermaid to a `.mmd` file, then convert it with the CLI:
     ```bash
     drawio -x -f xml -o diagram.drawio diagram.mmd
     ```
     Delete the `.mmd` afterward — the `.drawio` is the artifact. draw.io's Mermaid parser has already laid the diagram out, so no `--layout` is needed.
   - **XML**: write the mxGraphModel XML to `diagram.drawio` (see [XML format](#xml-format)), then run the [repair pass](#repair-pass) on it. Optionally apply an ELK layout (see [ELK layout for XML](#elk-layout-for-xml)).
2. **Deliver** (identical for both sources):
   - *(no format)* → keep `diagram.drawio` and open it.
   - **png / svg / pdf** → export from the `.drawio` with embedded XML, then delete the source `.drawio`:
     ```bash
     drawio -x -f png -e -b 10 -o diagram.drawio.png diagram.drawio
     ```
   - **url** → build a browser URL from the `.drawio` XML, open it, and keep the `.drawio` as a local copy (see [Browser URL output](#browser-url-output)).
3. **Open the result** — the exported file, the URL, or the `.drawio`. If the open command fails, print the absolute path (or URL) so the user can open it manually.

**Always convert Mermaid to `.drawio` first, then export** — do not export a `.mmd` straight to an image. Direct Mermaid → PNG export with `-e` is broken in current draw.io Desktop (the embedded-XML step crashes); the two-step path (convert, then export the `.drawio`) is reliable and produces an editable embed. See [Troubleshooting](#troubleshooting).

If Mermaid was requested but no desktop CLI is available, fall back to authoring the same diagram directly as XML.

## ELK layout for XML

XML-authored diagrams can be auto-positioned by the CLI's `--layout` pass — the same ELK layouts as the editor's *Arrange ▸ Layout* menu and the same engine the draw.io MCP app server uses. Generate the cells with approximate (or even `0,0`) positions and let ELK place them; you only have to get the graph *structure* — nodes and edges — right.

Add `--layout <name>` to any CLI call that reads your XML. The simplest form lays out in place after you write the file (reading and overwriting the same path is supported):

```bash
drawio -x -f xml --layout verticalFlow -o diagram.drawio diagram.drawio
```

Or combine layout with export in a single call (works for XML input):

```bash
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

For finer control, pass a JSON **array** (starting with `[`) instead of a preset name — the same format as the editor's custom-layout dialog:

```bash
drawio -x -f xml --layout '[{"layout":"elkLayered","config":{"elk.direction":"RIGHT"}}]' -o diagram.drawio diagram.drawio
```

Each entry is `{"layout": <algorithm>, "config": { … }}`:

- **Algorithms**: `elkLayered`, `elkTree`, `elkRadial`, `elkOrganic`, `elkStress`, `elkBox`.
- **`config`**: keys starting with `elk.` are ELK options — e.g. `elk.direction` (`UP` / `DOWN` / `LEFT` / `RIGHT`), `elk.spacing.nodeNode`, `elk.layered.spacing.nodeNodeBetweenLayers`. The keys `edgeStyle` (e.g. `orthogonal`) and `corners` (e.g. `rounded`) control connector rendering.

### Orthogonal edge routing

`--layout libavoid` routes the **edges** orthogonally around the shapes (the editor's *Arrange ▸ Layout ▸ Orthogonal Routing*) without moving any vertex — the complement of the node layouts above. Use it as an in-place pass on hand-positioned XML whose connectors cross shapes:

```bash
drawio -x -f xml --layout libavoid -o diagram.drawio diagram.drawio
```

Skip it after a flow/tree preset — those already route their edges.

**When to use it:** author the graph structure as XML without worrying about coordinates, then apply `verticalFlow` / `horizontalFlow` for flow-style diagrams or `organic` for networks. Mermaid-authored diagrams are already laid out — don't add `--layout`.

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

If no format is mentioned, just produce the `.drawio` file and open it in draw.io. The user can always ask to export later.

### Supported export formats

| Format | Embed XML | Notes |
|--------|-----------|-------|
| `png` | Yes (`-e`) | Viewable everywhere, editable in draw.io |
| `svg` | Yes (`-e`) | Scalable, editable in draw.io |
| `pdf` | Yes (`-e`) | Printable, editable in draw.io |
| `jpg` | No | Lossy, no embedded XML support |

PNG, SVG, and PDF all support `--embed-diagram` — the exported file contains the full diagram XML, so opening it in draw.io recovers the editable diagram.

## Browser URL output

When the user requests `url` format, generate a draw.io URL that opens the diagram directly in the browser editor at `app.diagrams.net` — no draw.io Desktop required to *view* it. (Mermaid-authored diagrams still need the desktop CLI to convert to `.drawio` first; if no CLI is available, author the diagram as XML and build the URL from that.)

### How it works

1. The `.drawio` file is written to disk as usual (gives the user a persistent local copy they can re-edit)
2. The XML is compressed with Node.js's built-in `zlib` and base64-encoded
3. The result is embedded in a `https://app.diagrams.net/#R...` URL
4. The URL is opened in the default browser

This uses only Node.js built-in modules (`zlib`, `child_process`) — no external dependencies.

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

The URL format matches the MCP Tool Server's XML links: `#R` followed by the compressed XML, which draw.io opens as it is. Don't use a `#create=` URL for XML: draw.io rewrites that hash after loading it, and when the rewrite differs from the link (it does for Node's `zlib` output, which isn't byte-identical to draw.io's pako) it asks "All changes will be lost!".

### Opening the URL

| Environment | Command |
|-------------|---------|
| macOS | `open "$URL"` |
| Linux (native) | `xdg-open "$URL"` |
| WSL2 | Write a temp `.url` file, open via `cmd.exe` (see below) |
| Windows (native) | Write a temp `.url` file, open via `start` (see below) |

**Why the `.url` workaround on Windows/WSL2?** `cmd.exe`'s `start` command treats `&` as a command separator and strips everything after `#` in URLs. The diagram payload lives in the `#R...` fragment, so passing the URL directly causes it to be silently lost. A `.url` shortcut file preserves the URL intact.

**macOS / Linux example:**

```bash
open "$URL"      # macOS
xdg-open "$URL"  # Linux
```

**WSL2 example:**

```bash
TMPFILE=$(mktemp --suffix=.url)
printf '[InternetShortcut]\r\nURL=%s\r\n' "$URL" > "$TMPFILE"
cmd.exe /c start "" "$(wslpath -w "$TMPFILE")"
```

**Windows (native) example:**

Do **not** build the `.url` file with `echo URL=%URL%`. The generated URL contains `&` characters (`?grid=0&pv=0&...`) that `cmd.exe` treats as command separators, so the shortcut is written truncated and the diagram payload is lost — the exact failure the `.url` file is meant to prevent. Let Node write the file directly (it already holds the URL string) and open only the resulting path, which never contains `&`:

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

### After opening

Print the URL so the user can copy or share it, and confirm the local file path:

```
Opened in browser: <URL>
Local file: DIAGRAM.drawio
```

The `.drawio` file stays on disk so the user can re-edit it later, attach it elsewhere, or export it to an image format on demand.

### URL length

The URL embeds the full compressed diagram in its hash fragment. Very large diagrams may hit browser URL length limits (typically ~32K–2MB depending on the browser). For complex diagrams that exceed the limit, fall back to writing the `.drawio` file and opening it locally.

## draw.io CLI

The draw.io desktop app includes a command-line interface used for **converting Mermaid** to `.drawio`, applying **ELK layouts** (`--layout`), and **exporting** to PNG/SVG/PDF. All three require the desktop app to be installed.

### Locating the CLI

First, detect the environment, then locate the CLI accordingly. On Windows (native and WSL2) the installer does **not** put draw.io on PATH and the install directory is user-selectable, so work through the whole fallback chain before concluding the CLI is absent.

#### WSL2 (Windows Subsystem for Linux)

WSL2 is detected when `/proc/version` contains `microsoft` or `WSL`:

```bash
grep -qi microsoft /proc/version 2>/dev/null && echo "WSL2"
```

On WSL2, use the Windows draw.io Desktop executable via `/mnt/c/...`:

```bash
DRAWIO_CMD="/mnt/c/Program Files/draw.io/draw.io.exe"
```

Double-quote the path so the space in `Program Files` is treated as part of the path. Do **not** wrap it in backticks — in bash, backticks are command substitution, which would try to *execute* the binary at locate-time instead of storing its path.

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

#### macOS

```bash
/Applications/draw.io.app/Contents/MacOS/draw.io
```

#### Linux (native)

```bash
drawio   # typically on PATH via snap/apt/flatpak
```

Use `which drawio` to confirm it is on PATH.

#### Windows (native, non-WSL2)

Check, in order — a missing PATH entry or a non-`C:` install drive is normal, not a sign that draw.io is missing:

1. **PATH**: `where.exe draw.io` (note the dot — the executable is `draw.io.exe`, not `drawio.exe`)
2. **Default install paths**: `C:\Program Files\draw.io\draw.io.exe`, then the per-user install `%LOCALAPPDATA%\Programs\draw.io\draw.io.exe`
3. **The registry** uninstall keys, which record the directory the user picked
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

Only once every step comes up empty should you treat the CLI as absent and fall back to XML authoring with `.drawio` / `url` output. When you do find it outside PATH, mention to the user that adding that folder (e.g. `D:\Program Files\draw.io`) to PATH makes it discoverable next time.

### Convert / layout / export commands

**Convert Mermaid to `.drawio`:**

```bash
drawio -x -f xml -o diagram.drawio diagram.mmd
```

**Apply an ELK layout to XML** (see [ELK layout for XML](#elk-layout-for-xml)):

```bash
drawio -x -f xml --layout verticalFlow -o diagram.drawio diagram.drawio
```

**Export to an image format:**

```bash
drawio -x -f <format> -e -b 10 -o "<output>" "<input.drawio>"
```

**WSL2 export example:**

```bash
"/mnt/c/Program Files/draw.io/draw.io.exe" -x -f png -e -b 10 -o "diagram.drawio.png" "diagram.drawio"
```

Key flags:
- `-x` / `--export`: export mode (also used for Mermaid conversion and layout passes)
- `-f` / `--format`: output format (`xml`, png, svg, pdf, jpg) — use `xml` to produce a `.drawio` from Mermaid or a layout pass
- `--layout`: run a layout before writing the output — an ELK preset name, the `libavoid` edge-routing pass, or a custom-layout JSON array
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

**WSL2 notes:**
- `wslpath -w <file>` converts a WSL2 path (e.g. `/home/user/diagram.drawio`) to a Windows path (e.g. `C:\Users\...`). This is required because `cmd.exe` cannot resolve `/mnt/c/...` style paths.
- The empty string `""` after `start` is required to prevent `start` from interpreting the filename as a window title.

**WSL2 example:**

```bash
cmd.exe /c start "" "$(wslpath -w diagram.drawio)"
```

## File naming

- Use a descriptive filename based on the diagram content (e.g., `login-flow`, `database-schema`)
- Use lowercase with hyphens for multi-word names
- When authoring Mermaid, write it to a matching `.mmd` file, convert to `.drawio`, then delete the `.mmd` — the `.drawio` is the artifact
- For export, use double extensions: `name.drawio.png`, `name.drawio.svg`, `name.drawio.pdf` — this signals the file contains embedded diagram XML
- After a successful export, delete the intermediate `.drawio` file — the exported file contains the full diagram
- For `url` mode, keep the `.drawio` file (no double extension) — the URL is a view/edit handle and the local file is the persistent copy

## XML format

A `.drawio` file is native mxGraphModel XML. When authoring as XML, generate it directly; Mermaid is converted to this same format by the CLI (`-f xml`), so both authoring routes end up as a native `.drawio`.

### Basic structure

Every diagram must have this structure:

```xml
<mxGraphModel adaptiveColors="auto">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <!-- Diagram cells go here with parent="1" -->
  </root>
</mxGraphModel>
```

- Cell `id="0"` is the root layer
- Cell `id="1"` is the default parent layer
- All diagram elements use `parent="1"` unless using multiple layers
- **Cells inside a container** use `parent="<container_id>"` and coordinates relative to that container
- **Edges belong to the innermost container that holds BOTH endpoints** — same container (at any nesting depth) → that container's id; one end outside every container → `parent="1"`. An auto-layout reads an edge's coordinates in its parent's frame, so an edge parked further out than its endpoints is laid out in the wrong place

(The example above uses an XML comment only to point out where cells go — never emit comments in real output; see [XML well-formedness](#critical-xml-well-formedness).)

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

They cover most diagrams. Only when a diagram needs layers, tags, metadata and placeholders, tables, cross-functional grids or dark-mode colors, also fetch the full XML reference (it describes the draw.io MCP servers, so where it mentions their `search_shapes` tool or `postLayout` / `routing` options, use the CLI's [`--layout`](#elk-layout-for-xml) here instead):
https://raw.githubusercontent.com/jgraph/drawio-mcp/main/shared/xml-reference.md

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| draw.io CLI not found | Desktop app not installed or not on PATH | Author as XML and deliver a `.drawio` file or `url` (Mermaid conversion, ELK layout, and image export all need the desktop app). Tell the user they can install the draw.io desktop app to enable those |
| Mermaid → PNG export crashes | Direct `.mmd` → PNG with `-e` is broken in current draw.io Desktop (embedded-XML step) | Use the two-step path: convert Mermaid to `.drawio` first (`-f xml`), then export the `.drawio` to PNG — the intermediate file embeds correctly |
| Blank diagram from Mermaid | Misspelled type keyword, or a syntax error (bad node ID, unquoted label) | Check the [Mermaid reference](#mermaid-syntax-reference); the first non-directive line's keyword selects the diagram type |
| Layout does nothing / errors | Unknown preset name, custom JSON not an array, or a desktop build too old for `--layout` / `.mmd` input | Use a preset from [Layout presets](#layout-presets) or a JSON array starting with `[`; on an old desktop build, author as XML with explicit positions and tell the user updating draw.io Desktop enables Mermaid conversion and layouts |
| Export produces empty/corrupt file | Invalid XML (e.g. double hyphens in comments, unescaped special characters) | Validate XML well-formedness before writing; see the XML well-formedness section below |
| Diagram opens but looks blank | Missing root cells `id="0"` and `id="1"` | Ensure the basic mxGraphModel structure is complete |
| Edges not rendering | Edge mxCell is self-closing (no child mxGeometry element) | Every edge must have `<mxGeometry relative="1" as="geometry" />` as a child element |
| File won't open after export | Incorrect file path or missing file association | Print the absolute file path so the user can open it manually |
| `GPU process isn't usable. Goodbye.` during convert/layout/export | Electron cannot start a GPU process — typical on Windows remote-desktop sessions, VMs, and CI runners. The `os_crypt` / `Failed to decrypt` lines printed before it are unrelated noise | Retry the same command with `--disable-gpu` added; draw.io Desktop's own `--disable-acceleration` switch has the same effect |
| Browser opens with empty diagram in `url` mode | `cmd.exe` stripped the `#R...` fragment | Use the `.url` temp-file workaround on Windows/WSL2 (see [Opening the URL](#opening-the-url)) — never pass the URL directly to `cmd.exe /c start` |
| URL is too long for the browser | Very large diagram exceeds browser URL length limit | Fall back to writing the `.drawio` file and opening it locally |

## CRITICAL: XML well-formedness

- **NEVER include ANY XML comments (`<!-- -->`) in the output.** XML comments are strictly forbidden — they waste tokens, can cause parse errors, and serve no purpose in diagram XML.
- Escape special characters in attribute values: `&amp;`, `&lt;`, `&gt;`, `&quot;`
- Always use unique `id` values for each `mxCell`
