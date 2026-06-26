# Draw.io MCP Server

The official draw.io MCP (Model Context Protocol) server that enables LLMs to open and create diagrams in the draw.io editor.

## Repository Structure

- **`.claude-plugin/marketplace.json`** — Claude Code plugin marketplace manifest. Lists this repo's plugins (currently just `drawio`, sourced from `./plugins/claude-code`). Users install with `/plugin marketplace add jgraph/drawio-mcp` then `/plugin install drawio@jgraph`.
- **`shared/`** — Shared XML generation reference (`xml-reference.md`), the single source of truth for all LLM prompts.
- **`mcp-app-server/`** — MCP App server (renders diagrams inline in chat via iframe). Hosted at `https://mcp.draw.io/mcp`. Can also be self-hosted via Node.js or Cloudflare Workers.
- **`mcp-tool-server/`** — Original MCP tool server (stdio-based, opens browser). Published as `@drawio/mcp` on npm.
- **`project-instructions/`** — Claude Project instructions (no MCP required, no install).
- **`plugins/`** — Assistant-side plugins grouped by host. One subdirectory per AI assistant.
  - **`plugins/claude-code/`** — Claude Code plugin: ships the `drawio` skill (generates native `.drawio` files, opens in desktop app, or as a browser URL via `app.diagrams.net`). Installable via the repo-root marketplace or `claude --plugin-dir ./plugins/claude-code`. No MCP required.
- **`shape-search/`** — Shape search index generator. Loads draw.io's `app.min.js` via jsdom to extract all shape styles and tags into `search-index.json`, which powers the `search_shapes` MCP tool. Re-run after updating `drawio-dev` to pick up new or changed shapes.

Each subdirectory has its own `CLAUDE.md` with implementation details.

## MCP App Server Tool

### `create_diagram`

- **Input**: `{ xml: string }` - draw.io XML in mxGraphModel format
- **Output**: Interactive diagram rendered inline via the draw.io viewer library
- **Features**: Zoom, pan, layers, fullscreen, "Open in draw.io" button

### `search_shapes`

- **Input**: `{ query: string, limit?: number }` - Search keywords and optional max results (default: 10, max: 50)
- **Output**: Array of matching shapes with `{style, w, h, title}` — style strings can be used directly in mxCell attributes
- **Search**: AND logic across space-separated terms, exact + Soundex phonetic matching
- **Coverage**: ~10,000+ shapes across all draw.io libraries (AWS, Azure, GCP, P&ID, electrical, Cisco, Kubernetes, UML, BPMN, etc.)
- **Use case**: Call before `create_diagram` only for diagrams needing industry-specific icons (cloud, network, P&ID, electrical, Cisco, Kubernetes). Skip for standard diagrams (flowcharts, UML, ERD, org charts) that use basic geometric shapes

## MCP Tool Server Tools

### `open_drawio_xml`

Opens the draw.io editor with XML content.

**Parameters:**
- `content` (required): Draw.io XML content
- `lightbox` (optional): Open in read-only lightbox mode (default: false)
- `dark` (optional): Dark mode - "true" or "false" (default: false)
- `routing` (optional): `"libavoid"` runs a server-side obstacle-avoiding orthogonal edge-routing pass before opening — keeps vertex positions, reroutes connectors around shapes. Use for hand-placed diagrams where edges would otherwise cross boxes.

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

### `open_drawio_csv`

Opens the draw.io editor with CSV data that gets converted to a diagram.

**⚠️ Note:** CSV relies on draw.io's server-side processing and may occasionally fail or be unavailable. Consider using Mermaid for org charts when possible.

**Parameters:**
- `content` (required): CSV content
- `lightbox` (optional): Open in read-only lightbox mode (default: false)
- `dark` (optional): Dark mode - "true" or "false" (default: false)

**⚠️ Avoid** using `%column%` placeholders in style attributes (like `fillColor=%color%`) - this can cause "URI malformed" errors.

### `open_drawio_mermaid`

Opens the draw.io editor with a Mermaid.js diagram definition.

**Parameters:**
- `content` (required): Mermaid.js syntax
- `lightbox` (optional): Open in read-only lightbox mode (default: false)
- `dark` (optional): Dark mode - "true" or "false" (default: false)

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

## Shared References (Single Source of Truth)

Two canonical reference files live in `shared/` and feed every delivery mechanism (MCP App Server, MCP Tool Server, Claude Code Plugin, Project Instructions):

- **`shared/xml-reference.md`** — draw.io XML generation reference: styles, edge routing, containers, layers, tags, metadata, dark mode, well-formedness rules. Consumed by `create_diagram` (mcp-app-server) and `open_drawio_xml` (mcp-tool-server).
- **`shared/mermaid-reference.md`** — Mermaid syntax reference for all 26 supported diagram types (flowchart, sequence, class, state, ER, gantt, mindmap, timeline, quadrant, C4, architecture, radar, packet, venn, treemap, kanban, zenuml, …) plus flowchart styling (`style`, `classDef`, `linkStyle`). Consumed by `open_drawio_mermaid` (mcp-tool-server).

The MCP servers read these files at startup and append them to the relevant tool description. The skill and project instructions reference them via GitHub URL.

When updating diagram-generation guidance, edit only these files — changes propagate to all consumers automatically.

## Coding Conventions

- **Allman brace style**: Opening braces go on their own line for all control structures, functions, objects, and callbacks.

```js
function example()
{
  if (condition)
  {
    doSomething();
  }
  else
  {
    doOther();
  }
}
```

- Prefer `function()` expressions over arrow functions for callbacks.

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| XML comments in output | `<!-- -->` comments found in generated XML | Remove all XML comments — they are strictly forbidden |
| "URI malformed" | Special characters in CSV style attributes | Use hardcoded colors instead of `%column%` placeholders |
| "Service nicht verfügbar" | draw.io CSV server unavailable | Retry later or use Mermaid instead |
| Blank diagram | Invalid Mermaid/XML syntax | Check syntax, ensure proper escaping |
| Diagram doesn't match expected | Mermaid version differences | Simplify syntax, avoid edge cases |
