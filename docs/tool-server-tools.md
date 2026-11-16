# MCP Tool Server Tools

Every `open_drawio_*` tool returns the `app.diagrams.net` URL and opens it in the default browser; `DRAWIO_BROWSER=off` only returns it (headless agents, CI, SSH sessions — [#94](https://github.com/jgraph/drawio-mcp/issues/94)). The result ends, like `create_diagram`'s, with a note that the user sees the diagram in draw.io (with `DRAWIO_BROWSER=off`: opens it through the URL) and that a reply of at most two sentences besides the URL will do.

## `open_drawio_xml`

Opens the draw.io editor with XML content.

Mechanical slips are repaired, icon names are resolved, the model is normalized, waypoints a pixel or two off a fixed connection point are snapped onto its line and labels outside the shape get `labelPerimeter=1` on every call (see `create_diagram` in `docs/app-server-tools.md`) — the layout itself never touches the cell hierarchy.

**Parameters:**
- `content` (required): Draw.io XML content
- `lightbox` (optional): Open in read-only lightbox mode (default: false)
- `dark` (optional): Dark mode - "true" or "false" (default: false)
- `postLayout` (optional): `"elk"` runs a server-side ELK re-layout before opening — places the vertices and routes the edges, via the same `drawio-elk` `ElkLayout` bridge the editor and the app server use (loaded from the CDN on first use, cached per user; `DRAWIO_ELK_URL` overrides the source). Use for flowcharts and other directional/hierarchical diagrams. Node sizes are never changed, only positions.
- `direction` (optional): flow direction for `postLayout` — `"vertical"` (default) or `"horizontal"`.
- `routing` (optional): `"libavoid"` runs a server-side obstacle-avoiding orthogonal edge-routing pass before opening — keeps vertex positions, reroutes connectors around shapes. Use for hand-placed diagrams where edges would otherwise cross boxes. Alternative to `postLayout`, not a companion.

**Example XML:**
```xml
<mxGraphModel adaptiveColors="auto">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="2" value="Hello" style="rounded=1;" vertex="1" parent="1">
      <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>
```

## `open_drawio_csv`

Opens the draw.io editor with CSV data that gets converted to a diagram.

**⚠️ Note:** CSV relies on draw.io's server-side processing and may occasionally fail or be unavailable. Consider using Mermaid for org charts when possible.

**Parameters:**
- `content` (required): CSV content
- `lightbox` (optional): Open in read-only lightbox mode (default: false)
- `dark` (optional): Dark mode - "true" or "false" (default: false)

**⚠️ Avoid** using `%column%` placeholders in style attributes (like `fillColor=%color%`) - this can cause "URI malformed" errors.

## `open_drawio_mermaid`

Opens the draw.io editor with a Mermaid.js diagram definition.

**Parameters:**
- `content` (required): Mermaid.js syntax
- `lightbox` (optional): Open in read-only lightbox mode (default: false)
- `dark` (optional): Dark mode - "true" or "false" (default: false)
- `postLayout` (optional): `"elk"` switches a Mermaid **flowchart** to the layered ELK layout. Nothing is computed server-side — it writes the `config: { layout: elk }` frontmatter (`shared/mermaid-elk.js`) and draw.io applies the layout while converting the diagram. Ignored for non-flowchart types, which lay themselves out.

## `search_shapes`

Searches the draw.io shape library by keywords (same tool as the app server's `search_shapes`, sharing `shared/shape-search.js` and `shared/icon-search.js`). The ~4.6 MB index is not bundled in the npm package — it is fetched from the CDN on first use through the same ETag-revalidated per-user disk cache as the ELK bundle (`src/cdn-cache.js`: 20 s timeout, 304 on a warm start, the last cached copy when offline; `DRAWIO_SHAPE_INDEX_URL` overrides with another URL or a local path), or read locally in an in-repo checkout. Results are supplemented live from the draw.io icon service when the local index has no strong match (overridable via `DRAWIO_ICON_SERVICE_URL`, set to `off` to disable).

**Parameters:**
- `query` (required): Space-separated search keywords (e.g. `aws lambda`, `cisco router`, `kubernetes pod`)
- `limit` (optional): Maximum results to return (default: 10, max: 50)

**Output:** Array of matching shapes with `{style, w, h, title}` — style strings can be used directly in `mxCell` style attributes. Use only for diagrams needing industry-specific icons; skip for standard flowcharts, UML, ERD, and org charts.

## `list_pages` / `get_page` / `set_page`

Page-level access to a local multi-page `.drawio` file, so a large file doesn't need to be loaded whole into context just to inspect or edit one page.

- **`list_pages`**: `{ path: string }` → `[{index, id, name, approxSizeBytes}]` for every page, without decompressing page content
- **`get_page`**: `{ path: string, page: string }` (`page` is a zero-based index, exact page name, or page id) → raw `mxGraphModel` XML for that page
- **`set_page`**: `{ path: string, page: string, content: string }` → replaces that page's content with new `mxGraphModel` XML (a single `<mxGraphModel>` element, no `<diagram>` tags), leaving all other pages untouched

These are the only tools that read/write local files by path; paths must end in `.drawio` or `.xml`. Diagrams saved to Google Drive, OneDrive, Dropbox, GitHub or GitLab are out of reach: the server can't read them, and a draw.io link only opens a new diagram, never a stored file. The tool server README documents editing them through _Edit Diagram_ in the open draw.io tab ([#94](https://github.com/jgraph/drawio-mcp/issues/94)).

**Use case**: Call `list_pages` first on any large multi-page file to find the page you need by name/index/id, then `get_page`/`set_page` to work on just that page instead of the whole file.

## `get_drawio_reference`

- **Input**: `{ format: "xml" | "mermaid" }`
- **Output**: `shared/xml-reference.md` or `shared/mermaid-reference.md`, verbatim
- **Why a tool**: the full references made the tool descriptions too long — appended, `open_drawio_xml` / `open_drawio_mermaid` were ~35k / 14k characters (the XML one ~16k tokens), and VS Code Copilot's tool search, which embeds descriptions in batches, rejected the whole batch, other servers' tools included ([#76](https://github.com/jgraph/drawio-mcp/issues/76)). `open_drawio_xml` now inlines the condensed `shared/xml-essentials.md` and points here only for layers, tags, metadata, tables, cross-functional grids and dark-mode colors; `open_drawio_mermaid` asks for the Mermaid reference before the first Mermaid diagram. `test/tools.test.js` caps every description at 2048 characters

## Quick Decision Guide

| Need | Use | Reliability |
|------|-----|-------------|
| Flowchart, sequence, ER diagram | `open_drawio_mermaid` | High |
| Custom styling, precise positioning | `open_drawio_xml` | High |
| Org chart from data | `open_drawio_csv` | Medium |

**Default to Mermaid** — it handles most diagram types reliably.

## Best Practices for LLMs

1. **Default to Mermaid**: It handles flowcharts, sequences, ER diagrams, Gantt charts, and more — all reliably
2. **Use XML for precision**: When you need exact positioning, custom colors, or complex layouts
3. **Avoid CSV for critical diagrams**: CSV processing can fail; prefer Mermaid for org charts when possible
4. **Validate syntax**: Ensure Mermaid/CSV/XML syntax is correct before sending
5. **Return the URL to users**: Always provide the generated URL so users can open the diagram in their browser

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| XML comments in output | `<!-- -->` comments found in generated XML | Remove all XML comments — they are strictly forbidden |
| "URI malformed" | Special characters in CSV style attributes | Use hardcoded colors instead of `%column%` placeholders |
| "Service nicht verfügbar" | draw.io CSV server unavailable | Retry later or use Mermaid instead |
| Blank diagram | Invalid Mermaid/XML syntax | Check syntax, ensure proper escaping |
| Diagram doesn't match expected | Mermaid version differences | Simplify syntax, avoid edge cases |
