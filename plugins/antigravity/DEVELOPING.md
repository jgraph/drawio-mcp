# Antigravity Plugin: drawio

An Antigravity plugin that ships the `drawio` skill: it generates native `.drawio` files,
authored either as Mermaid (converted + laid out by the draw.io desktop CLI) or as draw.io
XML directly, with optional ELK `--layout` for XML, export to PNG/SVG/PDF (with embedded
XML) via the desktop CLI, or a browser URL that opens the diagram directly at
`app.diagrams.net`. No MCP server required.

This is the Antigravity counterpart of the [Claude Code plugin](../claude-code/README.md).
`skills/drawio/` (`SKILL.md` and `scripts/find-shapes.js`) is kept **byte-identical** to the
Claude plugin's copy (`.github/workflows/check-skill-sync.yml` checks it). Only the host wrapping differs.

## Key Files

| File | Purpose |
|------|---------|
| `plugin.json` | Antigravity plugin manifest at the plugin root. Its schema allows only `name`, `description` and `$schema` — skills, MCP servers, rules and hooks are found by folder (`skills/`, `mcp_config.json`, `rules/`, `hooks.json`) |
| `skills/drawio/SKILL.md` | The skill itself; byte-identical to the Claude plugin's copy |
| `skills/drawio/scripts/find-shapes.js` | The shape and icon lookup the skill runs; byte-identical to the Claude plugin's copy |
| `README.md` | Installation and usage documentation |

## Layout

```
plugins/antigravity/    ← Antigravity plugin root
├── plugin.json
├── skills/drawio/SKILL.md, scripts/find-shapes.js
├── README.md
└── DEVELOPING.md
```

Antigravity reads `plugin.json` at the plugin root, or in `.antigravity-plugin/` or
`.gemini-plugin/`. There is no marketplace manifest: Antigravity's only marketplace is
`antigravity-plugins-official`, so users install from this directory's GitHub URL.

## Things found while porting (Antigravity CLI 1.4.2, October 2026)

- **Install by directory URL.** `agy plugin install https://github.com/jgraph/drawio-mcp`
  installs every plugin it finds in the repository (here the Claude Code and Copilot ones,
  both named `drawio`), and the last one overwrites the others. The directory URL
  `…/tree/main/plugins/antigravity` installs just this one.
- **No MCP server in the plugin.** `agy plugin install` converts Claude Code plugins, but
  turns their HTTP MCP server (`.mcp.json`, `"type": "http", "url"`) into an empty stdio
  command; Antigravity's own field is `serverUrl` in `mcp_config.json`. The plugin stays
  skill-only like the Codex and Copilot ports: in a terminal the hosted server can only
  answer with a link, and with both installed the agent mixed the two (one run: the server's
  XML saved to a file, 199 s, about 120k tokens). The README shows `agy mcp add` for people
  who want the server instead.
- **Skill size.** Antigravity loads the first 24,000 bytes of a skill body, and
  `agy plugin validate` warns about the rest. The body was 27,138 bytes (the agent read the
  whole file with its file tool anyway); 1.2.4 trims it to about 23,400 by removing repeated
  commands and prose, and `check-skill-sync.yml` now fails at 24,000.
- **Print mode.** `agy -p` can't ask before running commands, so the draw.io CLI call is
  denied unless commands are approved (`--dangerously-skip-permissions`, or an allow rule in
  `settings.json`). `--sandbox` blocks draw.io Desktop (an Electron app) entirely.

Tested: `.drawio` file, PNG and SVG export with embedded XML (Mermaid via the desktop CLI),
with Gemini 3.8 Flash on the free plan.

## References (fetched, not bundled)

Like the Claude plugin, `SKILL.md` fetches the shared guides via their GitHub raw URLs at
runtime — the single source of truth for all draw.io prompts — so nothing is duplicated in
the plugin. When updating diagram-generation guidance, edit only the files under `shared/`.
