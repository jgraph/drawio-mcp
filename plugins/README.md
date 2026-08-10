# AI Assistant Plugins

This directory groups assistant-side integrations by **host** — one subdirectory per AI assistant. Each subdirectory is the plugin root for its host, packaging the draw.io skill in whatever format that host expects (manifest schema, file layout, invocation convention).

| Directory | Host | Status |
|-----------|------|--------|
| [`claude-code/`](claude-code/README.md) | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | ✅ Available |
| [`codex/drawio/`](codex/drawio/README.md) | [Codex CLI](https://github.com/openai/codex) | ✅ Available |
| [`copilot/`](copilot/README.md) | [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) | ✅ Available |

Each host has its own marketplace manifest at the repo root, so users install with that
host's own commands.

**Claude Code** — via [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json):

```
/plugin marketplace add jgraph/drawio-mcp
/plugin install drawio@drawio
```

**Codex** — via [`.agents/plugins/marketplace.json`](../.agents/plugins/marketplace.json):

```bash
codex plugin marketplace add jgraph/drawio-mcp
codex plugin add drawio@drawio
```

**GitHub Copilot CLI** — via [`.github/plugin/marketplace.json`](../.github/plugin/marketplace.json):

```bash
copilot plugin marketplace add jgraph/drawio-mcp
copilot plugin install drawio@drawio
```

## Adding a plugin for another host

Support for a new assistant lands as a sibling directory at this level:

```
plugins/
├── claude-code/             ← Claude Code plugin (plugin root)
├── codex/                   ← Codex host group
│   └── drawio/              ← Codex plugin root (folder name == plugin.json "name")
├── copilot/                 ← GitHub Copilot CLI plugin (plugin root)
└── tests/                   ← tests for the scripts the plugins bundle
```

Codex normalizes a plugin's root folder name to match its `plugin.json` `"name"`, so the
Codex plugin root is nested one level (`codex/drawio/`) inside the host group directory;
Claude Code and Copilot have no such rule, so `claude-code/` and `copilot/` are themselves
the plugin roots. If another assistant (Cursor, etc.) is added later, it follows the same
pattern in its own way.

[`tests/`](tests/README.md) is not a plugin: it holds the Python `unittest` suite for the
scripts the plugins bundle (`python3 -m unittest discover -s plugins/tests` from the repo
root).

The draw.io guidance itself — *how* to generate `.drawio` files, embed XML in PNG/SVG/PDF, and produce `app.diagrams.net` URLs — is shared. Only the wrapping (manifest format, file layout, invocation prefix) differs per host, and each host has its own plugin/skill model, so the wrapping is not assumed to be uniform.

The single source of truth for draw.io XML generation guidance lives at [`../shared/xml-reference.md`](../shared/xml-reference.md) — every plugin references that file rather than duplicating its contents.

## Other delivery mechanisms in this repo

Plugins are one of four ways to integrate draw.io with AI assistants. See the [root README](../README.md) for the full comparison with the MCP App Server, MCP Tool Server, and Claude Project Instructions approaches.
