# AI Assistant Plugins

This directory groups assistant-side integrations by **host** — one subdirectory per AI assistant. Each subdirectory is the plugin root for its host, packaging the draw.io skill in whatever format that host expects (manifest schema, file layout, invocation convention).

| Directory | Host | Status |
|-----------|------|--------|
| [`claude-code/`](claude-code/README.md) | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | ✅ Available |
| [`codex/drawio/`](codex/drawio/README.md) | [Codex CLI](https://github.com/openai/codex) | ✅ Available |
| [`copilot/`](copilot/README.md) | [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) | ✅ Available |
| [`cursor/`](cursor/README.md) | [Cursor](https://cursor.com) | ✅ Available (Marketplace listing in review) |

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

**Cursor** — via [`.cursor-plugin/marketplace.json`](../.cursor-plugin/marketplace.json): install from the Cursor Marketplace (**Customize** → **drawio** → **Install**). Teams and Enterprise admins can also import this repo as a team marketplace; to try it locally, copy [`cursor/`](cursor/README.md) to `~/.cursor/plugins/local/drawio`. Unlike the other ports, it also bundles the hosted MCP App Server ([`cursor/mcp.json`](cursor/mcp.json)), because Cursor's Agent chat shows its diagrams inline.

## OpenCode (no plugin needed)

[OpenCode](https://opencode.ai) implements the Agent Skills layout directly: it looks for `SKILL.md` files in `.opencode/skills/`, `.claude/skills/` and `.agents/skills/` (walking up from the working directory to the git root) and in their global equivalents `~/.config/opencode/skills/`, `~/.claude/skills/` and `~/.agents/skills/`. The Claude Code skill folder therefore works unchanged — no manifest, no marketplace. The skill is a single file, so one download installs it for every project:

```bash
curl -fsSL --create-dirs -o ~/.config/opencode/skills/drawio/SKILL.md \
  https://raw.githubusercontent.com/jgraph/drawio-mcp/main/plugins/claude-code/skills/drawio/SKILL.md
```

Or, per project, from a clone of this repo:

```bash
mkdir -p .opencode/skills && cp -r plugins/claude-code/skills/drawio .opencode/skills/
```

The agent loads it through its `skill` tool whenever a request matches the skill's description (a diagram, flowchart, `.drawio` file, PNG/SVG/PDF export, …). For the MCP servers, see the OpenCode sections of the [tool server](../mcp-tool-server/README.md#opencode) and [app server](../mcp-app-server/README.md#using-with-opencode) READMEs.

## Adding a plugin for another host

Support for a new assistant lands as a sibling directory at this level:

```
plugins/
├── claude-code/             ← Claude Code plugin (plugin root)
├── codex/                   ← Codex host group
│   └── drawio/              ← Codex plugin root (folder name == plugin.json "name")
├── copilot/                 ← GitHub Copilot CLI plugin (plugin root)
└── cursor/                  ← Cursor plugin (plugin root)
```

Codex normalizes a plugin's root folder name to match its `plugin.json` `"name"`, so the
Codex plugin root is nested one level (`codex/drawio/`) inside the host group directory;
Claude Code, Copilot and Cursor have no such rule, so `claude-code/`, `copilot/` and
`cursor/` are themselves the plugin roots. Another assistant added later follows the same
pattern in its own way.

The draw.io guidance itself — *how* to generate `.drawio` files, embed XML in PNG/SVG/PDF, and produce `app.diagrams.net` URLs — is shared. Only the wrapping (manifest format, file layout, invocation prefix) differs per host, and each host has its own plugin/skill model, so the wrapping is not assumed to be uniform.

The single source of truth for draw.io XML generation guidance lives at [`../shared/xml-reference.md`](../shared/xml-reference.md) — every plugin references that file rather than duplicating its contents.

## Other delivery mechanisms in this repo

Plugins are one of four ways to integrate draw.io with AI assistants. See the [root README](../README.md) for the full comparison with the MCP App Server, MCP Tool Server, and Claude Project Instructions approaches.
