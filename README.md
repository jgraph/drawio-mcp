# Draw.io MCP Server

The official [draw.io](https://www.draw.io) MCP (Model Context Protocol) server that enables LLMs to create and open diagrams in the draw.io editor.

## Four Ways to Create Diagrams

This repository offers four approaches for integrating draw.io with AI assistants. Pick the one that fits your setup:

| | [MCP App Server](#mcp-app-server) | [MCP Tool Server](#mcp-tool-server) | [Claude Code Plugin](#claude-code-plugin) | [Project Instructions](#alternative-project-instructions-no-mcp-required) |
|---|---|---|---|---|
| **How it works** | Renders diagrams inline in chat | Opens diagrams in your browser | Generates `.drawio` files, optional PNG/SVG/PDF export or browser URL | Claude generates draw.io URLs via Python |
| **Diagram output** | Interactive viewer embedded in conversation | draw.io editor in a new tab | `.drawio`, `.drawio.png` / `.svg` / `.pdf`, or browser URL | Clickable link to draw.io |
| **Requires installation** | No (hosted at `mcp.draw.io`) | Yes (npm package) | One-line plugin install (draw.io Desktop only for PNG/SVG/PDF export) | No — just paste instructions |
| **Supports XML, CSV, Mermaid** | XML only | ✅ All three | XML only (native format) | ✅ All three |
| **Editable in draw.io** | Via "Open in draw.io" button | ✅ Directly | ✅ Directly | Via link |
| **Works with** | Claude.ai, VS Code, any MCP Apps host | Claude Desktop, any MCP client | Claude Code | Claude.ai (with Projects) |
| **Best for** | Inline previews in chat | Local desktop workflows | Local development workflows | Quick setup, no install needed |

---

## MCP App Server

The MCP App server renders draw.io diagrams **inline** in AI chat interfaces using the [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) protocol. Instead of opening a browser tab, diagrams appear directly in the conversation as interactive iframes.

The official hosted endpoint is available at:

```
https://mcp.draw.io/mcp
```

Add this URL as a remote MCP server in Claude.ai or any MCP Apps-compatible host — no installation required.

You can also run the server locally via Node.js or deploy your own instance to Cloudflare Workers.

**Tools:**
- **`create_diagram`** — Renders draw.io XML as an interactive diagram inline in chat
- **`search_shapes`** — Searches 10,000+ shapes across all draw.io libraries (AWS, Azure, GCP, P&ID, electrical, Cisco, Kubernetes, UML, BPMN, etc.) by keyword. Returns exact style strings that can be used directly in XML. Use this to find the correct shape before calling `create_diagram`.

**[Full documentation →](mcp-app-server/README.md)**

> **Note:** Inline diagram rendering requires an MCP host that supports the MCP Apps extension. In hosts without MCP Apps support, the tool still works but returns the XML as text.

---

## MCP Tool Server

The original MCP server that opens diagrams directly in the draw.io editor. Supports XML, CSV, and Mermaid.js formats with lightbox and dark mode options. Published as [`@drawio/mcp`](https://www.npmjs.com/package/@drawio/mcp) on npm.

Quick start: `npx @drawio/mcp`

**[Full documentation →](mcp-tool-server/README.md)**

---

## Claude Code Plugin

A Claude Code plugin (under [`plugins/claude-code/`](plugins/claude-code/README.md)) that generates native `.drawio` files, with optional export to PNG, SVG, or PDF (with embedded XML so the exported file remains editable in draw.io) — or a browser URL that opens the diagram directly in `app.diagrams.net`. No MCP setup required.

Install from this repo's marketplace inside Claude Code:

```
/plugin marketplace add jgraph/drawio-mcp
/plugin install drawio@jgraph
```

Or load it directly from a local clone with `claude --plugin-dir ./plugins/claude-code`.

By default, the plugin writes a `.drawio` file and opens it in draw.io. Mention a format in your request to change the output:
- `/drawio:drawio png ...` / `svg` / `pdf` — exports using the draw.io desktop CLI with `--embed-diagram`
- `/drawio:drawio url ...` — compresses the XML with Node.js's built-in `zlib` and opens the result at `app.diagrams.net`. No draw.io Desktop needed; the `.drawio` file is kept locally as a persistent copy.

**[Full documentation →](plugins/claude-code/README.md)**

---

## Alternative: Project Instructions (No MCP Required)

An alternative approach that works **without installing anything**. Add instructions to a Claude Project that teach Claude to generate draw.io URLs using Python code execution. No MCP server, no desktop app — just paste and go.

**[Full documentation →](project-instructions/README.md)**

---

## Diagram layouts

Two optional, independent layout passes can run after the AI generates a diagram — one re-arranges the nodes, the other only reroutes the edges. Which are available depends on the approach:

| Layout pass | What it does | App Server (`create_diagram`) | Tool Server (`open_drawio_xml`) | Claude Code Plugin | Project Instructions |
|---|---|---|---|---|---|
| **ELK auto-layout** (`postLayout: "elk"`) | Re-arranges nodes into a clean layered layout; routes the edges as part of it | ✅ | — | planned (via draw.io Desktop ELK) | — |
| **libavoid routing** (`routing: "libavoid"`) | Keeps node positions; reroutes connectors orthogonally *around* the shapes | ✅ | ✅ from **v1.3.0** | — | — |

- These apply to **draw.io XML** diagrams. **Mermaid** diagrams are auto-laid-out already, so neither pass is needed.
- The **App Server** applies these in the inline viewer after the diagram renders; the **Tool Server** applies libavoid server-side before opening the draw.io editor.
- Pick one, not both: ELK already routes its own edges, so adding libavoid on top is redundant. Use `postLayout` to re-arrange a layout, or `routing` to tidy the connectors on a layout you placed deliberately.

---

## Data Residency & Offline Use

If you're deploying in an environment with strict data restrictions, here is exactly
where diagram data goes for each approach.

**No component sends your diagram to a cloud rasterizer.** `convert.diagrams.net` (or
any cloud export endpoint) is not called anywhere in this repository, and there is no
"local dependency missing → fall back to cloud" path. PNG/SVG/PDF export happens only
in the Claude Code Plugin, which shells out to your **locally installed draw.io Desktop CLI**
(located via `which drawio`); if it isn't installed, the `.drawio` file is kept and
nothing is sent.

### Does your diagram leave the machine?

| Approach | Diagram leaves the machine? |
|---|---|
| **MCP App Server — hosted (`mcp.draw.io`)** | **Yes** — it is sent to the draw.io server as the MCP request. Self-host instead (below) to keep it local. |
| **MCP App Server — self-hosted** (local Node or your own Cloudflare) | No — processed by your server and embedded in HTML that renders client-side. |
| **MCP Tool Server** (`@drawio/mcp`) | No — carried in the URL `#fragment`, which browsers do not transmit to the server. |
| **Claude Code Plugin** | No — written locally and exported by your local draw.io Desktop CLI. |

By default the servers do not write diagram content to their logs — only request
metadata (method, session, status, timing). The Cloudflare-hosted App Server logs
response bodies only when run with `DEBUG=true`.

### Reducing external requests

Even when the diagram itself stays local, the rendering loads draw.io's web-app /
viewer **code** from `app.diagrams.net` and `viewer.diagrams.net` by default. These
fetch application code and assets — not your diagram — but they are still outbound
requests. To reduce or remove them:

- **App Server:** build with the `VIEWER_PATH` environment variable to inline the
  viewer instead of loading it from `viewer.diagrams.net`.
- **Tool Server:** set the `DRAWIO_BASE_URL` environment variable to a self-hosted
  draw.io instance.
- **Claude Code Plugin:** the opt-in `/drawio:drawio url` mode opens the diagram at
  `app.diagrams.net` (hardcoded — no `DRAWIO_BASE_URL` equivalent). Use the default
  `.drawio` output or local Desktop export instead if you need to avoid that request.

### Your LLM is a separate consideration

The diagram is *generated* by the LLM. If you use a hosted model, the diagram content
is produced in that provider's cloud regardless of where this MCP server runs.
End-to-end isolation requires a locally hosted model as well.

### Verifying

The only reliable way to confirm a deployment makes **no** outbound calls is to run it
with network egress blocked (or watch the browser's Network tab) and verify it still
renders. We recommend this for any strict-isolation deployment.

---

## XML Reference (Single Source of Truth)

The draw.io XML generation reference — covering edge routing, containers, layers, tags, metadata, dark mode, style properties, and XML well-formedness — lives in a single canonical file:

**[`shared/xml-reference.md`](shared/xml-reference.md)**

All four approaches above use this file as their single source of truth for LLM prompts:

| Approach | How it accesses the reference |
|----------|-------------------------------|
| MCP App Server | Reads the file at startup / build time and includes it in the tool description |
| MCP Tool Server | Reads the file at startup (from repo or bundled copy via `prepack`) |
| Claude Code Plugin | References the [GitHub raw URL](https://raw.githubusercontent.com/jgraph/drawio-mcp/main/shared/xml-reference.md) |
| Project Instructions | Users copy its contents into their Claude Project |

When updating XML generation guidance, edit only `shared/xml-reference.md` — changes propagate to all consumers automatically.

---

## Shape Search Index

The `search_shapes` tool is powered by a pre-built index of all draw.io shapes. The index is generated from the live draw.io client (`https://app.diagrams.net/js/app.min.js`) by running all sidebar palette initializations in Node.js via jsdom and capturing the shape data.

`shape-search/search-index.json` is committed to the repository and is **automatically refreshed on every draw.io release** via the [Update Shape Search Index](.github/workflows/update-search-index.yml) GitHub Action — no manual step is required to stay in sync with the latest shapes.

To regenerate the index manually (e.g. when iterating on the generator itself):

```bash
cd shape-search
npm install
npm run generate

# Rebuild the MCP App Server worker to embed the updated index
cd ../mcp-app-server
npm run build:worker
```

The generator fetches `app.min.js` directly from the public draw.io web app, so no local checkout of the draw.io source is needed.

---

## Development

```bash
# MCP App Server
cd mcp-app-server
npm install
npm start

# MCP Tool Server
cd mcp-tool-server
npm install
npm start
```

## Related Resources

- [draw.io](https://www.draw.io) - Free online diagram editor
- [draw.io Desktop](https://github.com/jgraph/drawio-desktop) - Desktop application
- [@drawio/mcp on npm](https://www.npmjs.com/package/@drawio/mcp) - This package on npm
- [drawio-mcp on GitHub](https://github.com/jgraph/drawio-mcp) - Source code repository
- [Mermaid.js Documentation](https://mermaid.js.org/intro/)
- [MCP Specification](https://modelcontextprotocol.io/)
- [MCP Apps Extension](https://modelcontextprotocol.io/docs/extensions/apps)
