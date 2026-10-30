# Draw.io MCP Server

The official draw.io MCP (Model Context Protocol) server that enables LLMs to open and create diagrams in the draw.io editor.

## Repository Structure

- **`.claude-plugin/marketplace.json`** — Claude Code plugin marketplace manifest. Lists this repo's plugins (currently just `drawio`, sourced from `./plugins/claude-code`); plugin metadata is inherited from each plugin's own `plugin.json`. Users install with `/plugin marketplace add jgraph/drawio-mcp` then `/plugin install drawio@drawio`.
- **`.agents/plugins/marketplace.json`** — Codex CLI plugin marketplace manifest (Codex's format: `source` object + `policy` + `category`). Lists the `drawio` plugin sourced from `./plugins/codex/drawio`; metadata is inherited from that plugin's own `.codex-plugin/plugin.json`. Users install with `codex plugin marketplace add jgraph/drawio-mcp` then `codex plugin add drawio@drawio`.
- **`.github/plugin/marketplace.json`** — GitHub Copilot CLI plugin marketplace manifest (same schema family as Claude's, but plugin metadata is inlined in the `plugins[]` entry rather than inherited — keep it in sync with `plugins/copilot/plugin.json`). Lists the `drawio` plugin sourced from `./plugins/copilot`. Users install with `copilot plugin marketplace add jgraph/drawio-mcp` then `copilot plugin install drawio@drawio`. Copilot CLI checks this path first and falls back to `.claude-plugin/marketplace.json`.
- **`.cursor-plugin/marketplace.json`** — Cursor plugin marketplace manifest (Cursor's format: `owner` + `plugins[]` entries whose `source` is the plugin directory). Lists the `drawio` plugin sourced from `plugins/cursor`; metadata comes from that plugin's own `.cursor-plugin/plugin.json`. Users install from the Cursor Marketplace (every version is reviewed by Cursor, submitted at cursor.com/marketplace/publish); Teams/Enterprise admins can import this repo as a team marketplace.
- **`glama.json`** — Ownership file for the [Glama](https://glama.ai/mcp/servers/jgraph/drawio-mcp) MCP directory: lists the GitHub users (`maintainers`) who may claim the listing of this org-hosted repo, which a GitHub sign-in alone can't. After editing it, run Glama's Claim flow again.
- **`shared/`** — Single source of truth shared by every delivery mechanism: the LLM-facing references (`xml-reference.md`, its condensed `xml-essentials.md`, `mermaid-reference.md`, `style-reference.md`) and the shared logic both MCP servers run (`shape-search.js`, `icon-search.js`, `mermaid-elk.js`, the repairs for common LLM slips in XML `repair-xml.js`, plus the headless mxGraph stack `mx-model.js` / `mx-xml.js` / `normalize-model.js`, and `label-perimeter.js`, which marks labels outside the shape so edges end at them).
- **`mcp-app-server/`** — MCP App server (renders diagrams inline in chat via iframe). Hosted at `https://mcp.draw.io/mcp`. Can also be self-hosted via Node.js, the `jgraph/drawio-mcp` Docker Hub image (built and pushed by `.github/workflows/publish-app-server-image.yml`; Hub page text in `mcp-app-server/DOCKER_HUB.md`) or Cloudflare Workers. Its `server.json` is the MCP Community Registry manifest (`io.draw/mcp` — feeds github.com/mcp and VS Code's MCP browser); publish runbook in its README.
- **`mcp-tool-server/`** — Original MCP tool server (stdio-based, opens browser). Published as `@drawio/mcp` on npm.
- **`project-instructions/`** — Claude Project instructions (no MCP required, no install).
- **`plugins/`** — Assistant-side plugins grouped by host, one subdirectory per AI assistant.
  - **`plugins/claude-code/`** — Claude Code plugin: ships the `drawio` skill (generates native `.drawio` files, authored as Mermaid — converted + laid out by the desktop CLI — or as XML directly with optional ELK `--layout`; exports to PNG/SVG/PDF, or opens as a browser URL via `app.diagrams.net`). For shape-library and brand icons the skill runs its bundled `scripts/find-shapes.js`, which searches the `search_shapes` index (from jsDelivr) and the draw.io icon service. Mermaid conversion, ELK layout, and image export need draw.io Desktop; plain XML `.drawio`/`url` output does not. Installable via the repo-root marketplace or `claude --plugin-dir ./plugins/claude-code`. Since 1.2.3 it also bundles the hosted MCP App Server (`.mcp.json`, `https://mcp.draw.io/mcp`), so its Claude directory listing can be paired with the draw.io connector listing and the skill can defer to `create_diagram` where Claude shows diagrams inline (Claude.ai); in Claude Code's terminal the skill still writes the files. The Codex and Copilot ports stay skill-only.
  - **`plugins/codex/drawio/`** — Codex CLI plugin: the Codex port of the Claude Code plugin, shipping the same `drawio` skill. `skills/drawio/` (`SKILL.md` and `scripts/`) is byte-identical to the Claude plugin's copy (Codex uses the same `/drawio:drawio` invocation and fetches the same shared references from GitHub). Differs only in host wrapping: a `.codex-plugin/plugin.json` manifest with an `interface` block (official draw.io SVG logo, `brandColor`, default prompts). Nested under `codex/` because Codex requires the plugin root folder name to equal `plugin.json` `"name"` (`drawio`). No MCP required.
  - **`plugins/copilot/`** — GitHub Copilot CLI plugin: the Copilot port of the Claude Code plugin, shipping the same `drawio` skill. `skills/drawio/` (`SKILL.md` and `scripts/`) is byte-identical to the Claude plugin's copy (the in-skill `/drawio:drawio` example lines are model-facing; Copilot's user-facing command is plain `/drawio` since Copilot doesn't prefix plugin skills). Differs only in host wrapping: a root `plugin.json` manifest (Copilot's format, `skills` directory list); no folder-name rule, so `copilot/` is itself the plugin root. The same skill folder also works in other Copilot surfaces (VS Code agent mode, coding agent, code review) when copied to a repo's `.github/skills/`. No MCP required.
  - **`plugins/cursor/`** — Cursor plugin: the same `drawio` skill (`skills/drawio/`, `SKILL.md` and `scripts/`, byte-identical to the Claude plugin's copy) plus an `mcp.json` that adds the hosted MCP App Server (`https://mcp.draw.io/mcp`), because Cursor's Agent chat (≥ 2.6) renders MCP Apps inline; the skill's own instructions already defer to `create_diagram` in such a chat and keep files and exports for the skill. Manifest `.cursor-plugin/plugin.json` (only `name` is required; `logo` is a repo-relative path, here the draw.io SVG in `assets/`). No folder-name rule, so `cursor/` is itself the plugin root.
  - **`plugins/antigravity/`** — Antigravity plugin: the same `drawio` skill (`skills/drawio/`, `SKILL.md` and `scripts/`, byte-identical to the Claude plugin's copy) with a minimal root `plugin.json` (Antigravity's schema allows only `name`, `description`, `$schema`; components are found by folder). Skill-only: Antigravity's converter turns a Claude plugin's HTTP MCP server into an empty command, and a terminal can only get links from the hosted server, so the README shows `agy mcp add` separately. No marketplace for other publishers: users install from the directory URL (`agy plugin install https://github.com/jgraph/drawio-mcp/tree/main/plugins/antigravity`); the repository URL installs every plugin in the repo under the same name. Porting notes in its `DEVELOPING.md`.
- **`shape-search/`** — Shape search index generator. Loads draw.io's `app.min.js` via jsdom to extract all shape styles and tags into `search-index.json`, which powers the `search_shapes` MCP tool and the skill's `scripts/find-shapes.js` (it reads `title`, `tags`, `w`, `h` and `style` from the `@main` copy on jsDelivr, so renaming a field breaks every installed skill). Re-run after updating `drawio-dev` to pick up new or changed shapes.

Most subdirectories have their own `AGENTS.md` with implementation details. Every `AGENTS.md` is the single source for its directory: the `CLAUDE.md` beside it only imports it (`@AGENTS.md`) for Claude Code, so edit `AGENTS.md`, never the `CLAUDE.md`.

## MCP App Server Tool

### `create_diagram`

- **Input**: `{ xml?: string, mermaid?: string, postLayout?: "elk", direction?: "vertical" | "horizontal", routing?: "libavoid" }` - exactly one of `xml` (draw.io XML in mxGraphModel format) or `mermaid` (28 diagram types, converted to draw.io natively); `direction` and `routing` apply to XML only
- **Output**: Interactive diagram rendered inline via the draw.io viewer library
- **Format rule (in the description)**: XML that the model places itself, laid out for the chat frame, for diagrams of boxes and lines up to about 30 shapes (flowcharts, pipelines, decision trees, org charts, ER, UML class/state/use case, mind maps, timelines, architecture, cloud, network, swimlanes); Mermaid for sequence diagrams, gantt, charts and the other Mermaid-only types, and for larger flowcharts with `postLayout: "elk"`. In a side-by-side benchmark against Excalidraw (October 2026), Mermaid's own layouts of flowcharts, class, state, mind map and timeline diagrams came out tall, cropped or tangled; the per-type patterns are in `shared/chat-view-xml.md`
- **Routing in the viewer**: `routing: "libavoid"` reroutes the right-angle edges only (straight and curved lines stay), with floating ends on the sides that face each other; placed XML is routed anyway when a right-angle edge would run through a shape or an outside label — see `mcp-app-server/AGENTS.md`
- **Features**: Zoom, pan, layers, fullscreen, "Open in draw.io" button, download as `.drawio` (hosts with `ui/download-file`)
- **The model sees the diagram as shown**: when it differs from the arguments (Mermaid converted to XML, a layout or routing pass, the user's layout toggle), the viewer sends the flat draw.io XML to the model's context (`ui/update-model-context`; ChatGPT's `setWidgetState` `modelContent` as a fallback), so a follow-up edits that diagram — see `mcp-app-server/AGENTS.md`
- **Clients without an MCP Apps UI** (plain MCP clients — Codex CLI, terminal agents, scripts) get an extra text block with an `app.diagrams.net` URL (`#R` for XML, `#create=` for Mermaid), since nothing would render the diagram for them otherwise. Detected from the client's declared `io.modelcontextprotocol/ui` capability, plus whether it ever fetched the app resource
- **Mechanical slips are repaired** first (`shared/repair-xml.js`): text around the diagram (a leaked tool-call tag after it), `<` or a stray `&` in attribute values, the default layer written as its own parent. Pass options the model wrote into the XML string (`</xml>\n<parameter name="postLayout">elk`) are recovered when valid. A well-formed diagram passes byte-identical
- **Slips in the arguments are forgiven** instead of failing the call: text before the XML (a code fence, a sentence), a diagram passed under the other parameter (Mermaid as `xml`, XML as `mermaid` — drawn as what it is, with a note telling the model), and `null` / `"none"` / `"off"` / any case for an option, with `LR`/`RL` → horizontal and `TB`/`TD`/`BT` → vertical (`normalizeOptionValue` in `mcp-app-server/src/normalize-diagram-xml.js`). `get_drawio_reference` takes its format in any case, and `drawio` for `xml`. The schemas are wrapped in `z.preprocess`, so `tools/list` doesn't change, and unknown values still fail so the model learns the real ones (`mcp-app-server/test/lenient-input.test.js`)
- **The model is normalized** on every XML diagram before anything else sees it (`shared/normalize-model.js`, the same repairs as the desktop CLI's `--normalize`): edges filed at the nearest common ancestor of their terminals (an edge parked on the layer between two cells inside one container lays out in the wrong coordinate frame), a geometry for edges written without one (they don't render at all), and containers grown around children they would clip
- **Edges end at labels outside the shape**: after the normalization, `shared/label-perimeter.js` adds `labelPerimeter=1` to every vertex whose label sits outside the shape, centered on one side (an icon's name below it), as draw.io's sidebar and Position control do for new shapes. draw.io then ends an edge that meets the vertex on that side at the label's far edge instead of letting it cross the label, and libavoid routing goes around the label (draw.io releases after 32.5.5; older viewers ignore the key). Existing cells with the key, or with `labelPerimeter=0`, are left alone
- **Edge labels fit their edges**: then `fitEdgeLabels` (same module) gives every edge, labeled or not, and every labeled edge label cell the label gap (`labelBackgroundColor=default;defaultLabelBackgroundColor=page`, _Transparent_ in the _Background_ list of draw.io's Text tab: draw.io after 32.5.5 stops the line at the text instead of painting a white box; 32.0.2 to 32.5.5 paint the page color, older viewers the white box; the value `gap` that draw.io 32.5.6 to 32.5.8 wrote means the same and is left alone), unless the diagram sets a background — unlabeled edges too, because new edges in draw.io have the gap in the default edge style and a label added later in the editor should get it, and puts the label of a straight horizontal edge just above the line (`verticalAlign=bottom`) where it fits between the shapes, so the line stays whole; labels on vertical and bent edges stay on the line; every labeled edge also gets `labelPlacement=auto`, with which draw.io (after 32.5.5) picks the side by the segment under the label when it paints it, so bent and rerouted edges follow the rule too (the generic placement rule, "Where edge labels go" in `shared/xml-reference.md`)

### `search_shapes`

- **Input**: `{ query: string, limit?: number }` - Search keywords and optional max results (default: 10, max: 50)
- **Output**: Array of matching shapes with `{style, w, h, title}` — style strings can be used directly in mxCell attributes
- **Search**: AND logic across space-separated terms, exact + Soundex phonetic matching
- **Coverage**: ~10,000+ shapes across all draw.io libraries (AWS, Azure, GCP, P&ID, electrical, Cisco, Kubernetes, UML, BPMN, etc.), supplemented live by the draw.io icon service (`icons.diagrams.net` — brand logos and general-purpose concept icons, returned as `shape=image` styles) when the local index has no strong match
- **Use case**: Call before `create_diagram` only for diagrams needing industry-specific, branded, or pictorial icons (cloud, network, P&ID, electrical, Cisco, Kubernetes, product logos). Skip for standard diagrams (flowcharts, UML, ERD, org charts) that use basic geometric shapes

### `get_drawio_reference`

- **Input**: `{ format: "xml" | "mermaid" }`
- **Output**: `shared/xml-reference.md` or `shared/mermaid-reference.md`, verbatim
- **Why a tool**: the `create_diagram` description stays short (the format decision, the XML essentials, and a pointer to this tool) instead of carrying the references. Appended, they made it ~55k characters, and VS Code Copilot's tool search, which embeds descriptions in batches, rejected the whole batch, other servers' tools included ([#76](https://github.com/jgraph/drawio-mcp/issues/76)). `mcp-app-server/test/tools.test.js` caps every description at 2048 characters

## MCP Tool Server Tools

### `open_drawio_xml`

Opens the draw.io editor with XML content.

Mechanical slips are repaired, the model is normalized and labels outside the shape get `labelPerimeter=1` on every call (see `create_diagram` above) — the layout itself never touches the cell hierarchy.

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
- `postLayout` (optional): `"elk"` switches a Mermaid **flowchart** to the layered ELK layout. Nothing is computed server-side — it writes the `config: { layout: elk }` frontmatter (`shared/mermaid-elk.js`) and draw.io applies the layout while converting the diagram. Ignored for non-flowchart types, which lay themselves out.

### `search_shapes`

Searches the draw.io shape library by keywords (same tool as the app server's `search_shapes`, sharing `shared/shape-search.js` and `shared/icon-search.js`). The ~4.6 MB index is not bundled in the npm package — it is fetched from the CDN on first use through the same ETag-revalidated per-user disk cache as the ELK bundle (`src/cdn-cache.js`: 20 s timeout, 304 on a warm start, the last cached copy when offline; `DRAWIO_SHAPE_INDEX_URL` overrides with another URL or a local path), or read locally in an in-repo checkout. Results are supplemented live from the draw.io icon service when the local index has no strong match (overridable via `DRAWIO_ICON_SERVICE_URL`, set to `off` to disable).

**Parameters:**
- `query` (required): Space-separated search keywords (e.g. `aws lambda`, `cisco router`, `kubernetes pod`)
- `limit` (optional): Maximum results to return (default: 10, max: 50)

**Output:** Array of matching shapes with `{style, w, h, title}` — style strings can be used directly in `mxCell` style attributes. Use only for diagrams needing industry-specific icons; skip for standard flowcharts, UML, ERD, and org charts.

### `list_pages` / `get_page` / `set_page`

Page-level access to a local multi-page `.drawio` file, so a large file doesn't need to be loaded whole into context just to inspect or edit one page.

- **`list_pages`**: `{ path: string }` → `[{index, id, name, approxSizeBytes}]` for every page, without decompressing page content
- **`get_page`**: `{ path: string, page: string }` (`page` is a zero-based index, exact page name, or page id) → raw `mxGraphModel` XML for that page
- **`set_page`**: `{ path: string, page: string, content: string }` → replaces that page's content with new `mxGraphModel` XML (a single `<mxGraphModel>` element, no `<diagram>` tags), leaving all other pages untouched

These are the only tools that read/write local files by path; paths must end in `.drawio` or `.xml`.

**Use case**: Call `list_pages` first on any large multi-page file to find the page you need by name/index/id, then `get_page`/`set_page` to work on just that page instead of the whole file.

### `get_drawio_reference`

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

## Shared References (Single Source of Truth)

Two canonical reference files live in `shared/` and feed every delivery mechanism (MCP App Server, MCP Tool Server, Claude Code Plugin, Project Instructions), plus a condensed XML one for tool descriptions:

- **`shared/xml-reference.md`** — draw.io XML generation reference: styles, the looks users ask for (shadows, hand-drawn, gradients, fonts, …) and eight named color themes, edge routing, containers, layers, tags, metadata, dark mode, well-formedness rules. Returned by `get_drawio_reference` in both servers, for `create_diagram` (mcp-app-server) and `open_drawio_xml` (mcp-tool-server).
- **`shared/xml-essentials.md`** — the condensed XML reference (~1.3k characters): skeleton, vertex and edge templates, labels, basic shapes, the grid, containers and edge parents, lanes and edge styles. Tool-neutral: the tool server inlines it in the `open_drawio_xml` description and appends its own `search_shapes` and `postLayout` / `routing` lines; the skill and the project instructions use it in place of the full reference, which they fetch or add only for layers, tags, metadata, tables, cross-functional grids and dark-mode colors. In LLM tests (Haiku, Sonnet and Opus on six XML diagram tasks) it did as well as the full reference inlined, and reliably better than a minimal description at the structural parts: real containment for lanes and containers, ELK for flowcharts, routing for hand-placed layouts. When a rule it summarizes changes in `xml-reference.md`, change it here too, and keep the `open_drawio_xml` description under the 2048-character cap its test enforces.
- **`shared/chat-view-xml.md`**, **`shared/chat-view-mermaid.md`** — the MCP App Server's additions to the two references: designing for the inline chat frame (size, text, labels, box size, complete content, groups, color by role, one consistent look) and, for XML, one layout pattern per diagram type for diagrams the model places itself (flowcharts, pipelines, architecture, network, org charts, ER, UML class/state/use case, mind maps, timelines, decision trees, fault trees, server racks, scenes with icons), plus changing a diagram on request and choosing a look from the request (a theme for slides, sketches or a brand color, and one offer of a fitting next step after the first diagram). Its `get_drawio_reference` inserts them before the first section and leaves out the sections a chat diagram doesn't use (layers, tags, metadata, cross-functional grids), keeping the XML reference under the 50,000 characters above which Claude Code shows the model only a preview (`mcp-app-server/src/references.js`, checked by `test/references.test.js`); the tool server, skill and project instructions don't use them, since their diagrams open in the editor and their format rules differ.
- **`shared/mermaid-reference.md`** — Mermaid syntax reference for all 28 supported diagram types (flowchart, sequence, class, state, ER, gantt, mindmap, timeline, quadrant, C4, architecture, radar, packet, venn, treemap, kanban, zenuml, wardley, event modeling, …) plus flowchart styling (`style`, `classDef`, `linkStyle`) and the ELK layout selector for complex flowcharts. Returned by `get_drawio_reference` in both servers, for `open_drawio_mermaid` (mcp-tool-server) and `create_diagram` (mcp-app-server).

`shared/` also holds the shared *logic* both servers run: `shape-search.js` / `icon-search.js` (the `search_shapes` algorithm), `mermaid-elk.js` (the Mermaid ELK layout selector — `withElkLayout` + drawio-dev's diagram-type detection) and the headless mxGraph stack — `mx-model.js` (the slice of mxGraph the passes need, incl. `mxGraphModel.updateEdgeParents`), `mx-xml.js` (mxGraphModel XML ↔ that model, rewriting only what a pass changed) and `normalize-model.js` (the normalization both servers apply to every XML diagram, mirroring the desktop CLI's `--normalize`), plus `repair-xml.js`, which both servers run before it (the skill's repair pass and the project instructions' Python script carry compact copies of the same repairs). The tool server gets its copies through `copy-shared`; the app server imports them directly.

The MCP servers read these files at startup and return the full references from their `get_drawio_reference` tool; the diagram tools' descriptions stay short and point at it (each server's `test/tools.test.js` caps every description at 2048 characters). The tool server's `open_drawio_xml` also inlines `xml-essentials.md`. The skill and project instructions reference them via GitHub URL — `xml-essentials.md` for XML, the full `xml-reference.md` only for advanced topics.

When updating diagram-generation guidance, edit only these files — changes propagate to all consumers automatically.

## Release Cycle

A release cycle ships everything on `main` that isn't live yet to every channel it affects. First compare each channel's live version with what changed since its last release; skip the channels with nothing to ship.

| Channel | Gets a release when | How |
|---|---|---|
| Hosted app server (`mcp.draw.io/mcp`, Worker `drawio-mcp-app`) | `mcp-app-server/`, `shared/`, `shape-search/search-index.json` or its lockfile changed | Bump `version` in `mcp-app-server/package.json`, `package-lock.json` and `server.json` (lockstep). `npx wrangler deploy --env staging` from `mcp-app-server/`, smoke test (initialize → tools/list → create_diagram, check `_buildId`), then `npx wrangler deploy --env ""` for production (ask first, every time) |
| Docker Hub (`jgraph/drawio-mcp`) | the app server version changed | `gh workflow run publish-app-server-image.yml --ref main` (pushes `<version>` and `latest`, syncs `DOCKER_HUB.md`) |
| MCP Registry (`io.draw/mcp`) | the app server version changed | `mcp-publisher login dns …` and `mcp-publisher publish` from `mcp-app-server/` (runbook in its README) |
| npm (`@drawio/mcp`) | `mcp-tool-server/`, `shared/` or its lockfile changed | Bump `mcp-tool-server/package.json` and `package-lock.json`, push, `gh workflow run publish-tool-server.yml --ref main` (Trusted Publishing, no token) |
| Glama (release of the tool server) | npm got a release | Build & Release from the latest commit on the listing's admin page |
| Plugins (Claude Code, Codex, Copilot, Cursor, Antigravity) | the skill changed | Bump the version in every plugin manifest and `.github/plugin/marketplace.json` in the commit that changes the skill. Live on push: the marketplaces read `main`, the Claude directory scans it every few hours; Cursor reviews each version by hand |
| ChatGPT app (OpenAI) | `tools/list` changed (compare its hash on staging and production) | Rescan and resubmit, `mcp-app-server/OPENAI-SUBMISSION.md` |

Version bumps are their own commits (`chore(app-server): bump version to x.y.z`); pushing main deploys nothing by itself.

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
