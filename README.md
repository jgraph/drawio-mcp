[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/jgraph-drawio-mcp-badge.png)](https://mseep.ai/app/jgraph-drawio-mcp)

# Draw.io MCP Server

The official [draw.io](https://www.draw.io) MCP (Model Context Protocol) server that enables LLMs to create and open diagrams in the draw.io editor.

## Four Ways to Create Diagrams

This repository offers four approaches for integrating draw.io with AI assistants. Pick the one that fits your setup:

| | [MCP App Server](#mcp-app-server) | [MCP Tool Server](#mcp-tool-server) | [Skill + CLI](#skill--cli) | [Project Instructions](#alternative-project-instructions-no-mcp-required) |
|---|---|---|---|---|
| **How it works** | Renders diagrams inline in chat | Opens diagrams in your browser | Generates `.drawio` files, optional PNG/SVG/PDF export | Claude generates draw.io URLs via Python |
| **Diagram output** | Interactive viewer embedded in conversation | draw.io editor in a new tab | `.drawio` or `.drawio.png` / `.svg` / `.pdf` | Clickable link to draw.io |
| **Requires installation** | No (hosted at `mcp.draw.io`) | Yes (npm package) | Copy skill file + draw.io Desktop | No — just paste instructions |
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

## Skill + CLI

A Claude Code skill that generates native `.drawio` files, with optional export to PNG, SVG, or PDF (with embedded XML so the exported file remains editable in draw.io). No MCP setup required — just copy a skill file.

By default, the skill writes a `.drawio` file and opens it in draw.io. Mention a format in your request (`/drawio png ...`) to export using the draw.io desktop CLI with `--embed-diagram`.

**[Full documentation →](skill-cli/README.md)**

---

## Alternative: Project Instructions (No MCP Required)

An alternative approach that works **without installing anything**. Add instructions to a Claude Project that teach Claude to generate draw.io URLs using Python code execution. No MCP server, no desktop app — just paste and go.

**[Full documentation →](project-instructions/README.md)**

---

## XML Reference (Single Source of Truth)

The draw.io XML generation reference — covering edge routing, containers, layers, tags, metadata, dark mode, style properties, and XML well-formedness — lives in a single canonical file:

**[`shared/xml-reference.md`](shared/xml-reference.md)**

All four approaches above use this file as their single source of truth for LLM prompts:

| Approach | How it accesses the reference |
|----------|-------------------------------|
| MCP App Server | Reads the file at startup / build time and includes it in the tool description |
| MCP Tool Server | Reads the file at startup (from repo or bundled copy via `prepack`) |
| Skill + CLI | References the [GitHub raw URL](https://raw.githubusercontent.com/jgraph/drawio-mcp/main/shared/xml-reference.md) |
| Project Instructions | Users copy its contents into their Claude Project |

When updating XML generation guidance, edit only `shared/xml-reference.md` — changes propagate to all consumers automatically.

---

## Shape Search Index

The `search_shapes` tool is powered by a pre-built index of all draw.io shapes. The index is generated from the draw.io client source code (`app.min.js`) by running all sidebar palette initializations in Node.js via jsdom and capturing the shape data.

```bash
# Generate the shape search index (requires ../drawio-dev checkout)
cd shape-search
npm install
DRAWIO_DEV_PATH=../../drawio-dev node generate-index.js

# Rebuild the MCP App Server worker to embed the updated index
cd ../mcp-app-server
npm run build:worker
```

**When to regenerate:** Re-run `generate-index.js` after updating `drawio-dev` (new shapes, renamed stencils, updated style strings). The script loads `app.min.js` and all sidebar palettes, so it captures any changes to the shape libraries automatically.

The generated `search-index.json` is committed to the repository so that the MCP App Server can be built and deployed without a local `drawio-dev` checkout.

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
