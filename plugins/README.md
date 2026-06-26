# AI Assistant Plugins

This directory groups assistant-side integrations by **host** — one subdirectory per AI assistant. Each subdirectory is the plugin root for its respective host, packaging the draw.io skill in whatever format that host expects (manifest schema, file layout, invocation convention).

| Directory | Host | Status |
|-----------|------|--------|
| [`claude-code/`](claude-code/README.md) | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | ✅ Available |

The Claude Code plugin is published through a marketplace at the repo root ([`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json)), so users can install it with:

```
/plugin marketplace add jgraph/drawio-mcp
/plugin install drawio@jgraph
```

## Adding a plugin for another assistant

To package the draw.io skill for a new host (Cursor, Codex, etc.), add a sibling directory at this level:

```
plugins/
├── claude-code/              ← existing Claude Code plugin
├── cursor/                   ← future
└── codex/                    ← future
```

The skill content itself — *how* to generate `.drawio` files, embed XML in PNG/SVG/PDF, and produce `app.diagrams.net` URLs — is the same across hosts. Only the wrapping (manifest format, file layout, invocation prefix) differs per assistant.

The single source of truth for the draw.io XML generation guidance lives at [`../shared/xml-reference.md`](../shared/xml-reference.md) — every plugin should reference that file rather than duplicating its contents.

## Other delivery mechanisms in this repo

Plugins are one of four ways to integrate draw.io with AI assistants. See the [root README](../README.md) for the full comparison with the MCP App Server, MCP Tool Server, and Claude Project Instructions approaches.
