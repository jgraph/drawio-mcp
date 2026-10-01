# Submitting draw.io to the OpenAI plugin directory

Runbook for publishing this server as a plugin in the universal Plugins Directory
shared by ChatGPT and Codex. Submission path: **With MCP**, MCP-only for the first
review round — the `drawio` skill follows as a later version (see §5).

Guides: [Submit your Claude Code plugin](https://developers.openai.com/plugins/guides/submit-claude-plugin),
[Submit plugins](https://developers.openai.com/plugins/deploy/submission),
portal at <https://platform.openai.com/plugins>.

Claude marketplace listings and Connectors Directory approvals do **not** transfer —
this is a separate review, and the server has to be submitted from scratch (an
already-published integration cannot be referenced).

## 1. Account prerequisites (before the portal is usable)

Both are on the OpenAI Platform, not in this repo:

1. **Apps Management: Write** for the submitting user, in the organization that
   will own the plugin — <https://platform.openai.com/settings/organization/people/roles>,
   open the submitter's role and set Apps Management to Write. Organization
   owners already have it.
2. **Business identity verification** for draw.io Ltd in that same organization —
   <https://platform.openai.com/settings/organization/general>. Reviewers match
   the listing's name, website, support contact, privacy policy and terms against
   this identity, so verify as the company, not as an individual.

If the identity verifies but the submission form doesn't offer it, the submitter
is in a different org/project or still lacks Apps Management write access.

## 2. Domain verification

The portal generates a token and fetches it from the MCP host:

```
https://mcp.draw.io/.well-known/openai-apps-challenge
```

The response must be that token and nothing else — no JSON, no list, no second
token. The Worker serves it (`src/worker.js`), the route is in `wrangler.toml`
(`mcp.draw.io/.well-known/*`), and the value comes from `OPENAI_APPS_CHALLENGE`.
Unset ⇒ the path 404s, which is the pre-verification state.

The token the portal issued (2026-09-18, for the first plugin) is in
`wrangler.toml` under `[vars]`. The verification stuck to the domain: the
replacement plugin created on 2026-10-01 showed "Domain verified" without a
new token. Keep serving it. It is public by design — the whole point is that anyone fetching that
URL sees it — so it is committed rather than kept in `wrangler secret`, which
means a redeploy from a fresh checkout keeps the domain verified.

Deploy and check:

```bash
cd mcp-app-server
CLOUDFLARE_ACCOUNT_ID=b6f268167b445abeef954325cd0290cb npx wrangler deploy
curl -s https://mcp.draw.io/.well-known/openai-apps-challenge   # must echo the token
```

⚠️ `routes` in `wrangler.toml` **replaces** the Worker's entire route set on every
deploy. Every entry (`/mcp*`, `/.well-known/*`, `/health`, …) must stay —
dropping `/mcp*` takes production down.

## 3. Portal form — ready-to-paste values

### Info

The listing metadata is a package, not form fields: `openai-plugin/` holds it
in Codex format (`.codex-plugin/plugin.json`, package name `drawio`, plugin
`plugin_asdk_app_6abea666ca5081919375ed8d1d38da95`). To change the listing,
edit that file, bump `version`, zip the folder's *contents* and choose
**Upload new version**:

```bash
cd mcp-app-server/openai-plugin && zip -r "${TMPDIR:-/tmp}/drawio-openai-plugin.zip" .codex-plugin .mcp.json assets
```

- **The MCP server is part of the package** (`.mcp.json`, key `drawio`,
  referenced by `"mcpServers"`), and it must be in the plugin's *first* zip:
  an existing plugin refuses any later zip that adds, removes or replaces an
  MCP server ("Create a new plugin to change MCP servers"). Keep `.mcp.json`
  byte-for-byte as it is.
- **One MCP URL per organization.** Connecting a second plugin to
  `https://mcp.draw.io/mcp` fails with "url is already used by another app in
  your org" (shown only as a toast).
- **The zip must carry the icon** (`interface.logo` + `composerIcon` →
  `assets/drawio-logo.png`, a 512 px render of the Codex plugin's SVG). Without
  it the metadata check fails with "App icon required"; the portal does not
  carry a logo over between versions.
- Re-uploading over an unsubmitted draft replaces it ("Reupload draft") and
  keeps the MCP connection and the review information; still bump `version`.
  The "…" menu has **Download release ZIP** for the current version.
- The upload zone has no `<input type=file>` in the DOM (clicking it opens a
  native picker). To automate, inject a temporary file input, fill it, and
  dispatch `dragenter`/`dragover`/`drop` with a `DataTransfer` on the zone.

| Field | Value |
|---|---|
| Display name | draw.io |
| Short description | Create editable diagrams (max 30 chars) |
| Long description | See `longDescription` in `openai-plugin/.codex-plugin/plugin.json`. Plain language, no host or AI-product names, no claims about popularity or quality, no implementation terms (ELK, libavoid, XML) |
| Developer identity | draw.io Ltd (verified business identity); `developerName` "draw.io" |
| Category | Creativity — with Productivity the metadata check said "We couldn't confirm the selected category" (non-blocking, and it passed the same text once before, so the check is not deterministic) |
| Website | <https://www.drawio.com> |
| Support | <https://github.com/jgraph/drawio-mcp/issues> |
| Privacy policy | <https://www.drawio.com/trust/privacy-ai-assistants/> — this service's own policy (source: drawusaurus `src/pages/trust/privacy-ai-assistants.md`). Not the general `/trust/` page, which never mentions the MCP server |
| Terms | <https://www.drawio.com/trust/terms-of-use/> |
| Brand color | `#F08705` |

### Review history

- **1.0.0 — changes required (2026-10-01).** (1) The privacy policy (general
  `/trust/`) didn't describe the data the tools actually receive, its
  recipients, retention or user controls. (2) Name/description below quality
  standards: the long description had been pasted from the Claude connector
  listing — it opened with "Create diagrams in Claude", ended with "trusted by
  millions of users" (unverifiable claim) and leaned on terms like "obstacle-
  avoiding connector routing".
- **Old plugin deleted (2026-10-01).** Fixing it in place failed: uploading the
  first zip converted the 2026-09-18 app into a plugin record whose app link
  had `mcp_url: null` ("MCP configuration: Unavailable", Rescan disabled, no
  setup control), and a zip that declares the server was refused as an MCP
  change. The URL was still bound to that app, so the old plugin
  (`plugin_asdk_app_6aad…`, package `app-6aad…`) was deleted to free it.
- **New plugin `drawio` 1.0.1 — submitted, in review (2026-10-01).** Dedicated
  privacy page, rewritten descriptions, icon, `.mcp.json`, category
  Creativity. Metadata: no issues; MCP scan: no issues; domain already
  verified (the challenge token is per domain, not per plugin — no redeploy).

When the privacy page changes, keep it in step with what the server does:
tool inputs/outputs, the icon-service forwarding (`search_shapes` →
`icons.diagrams.net`: Workers AI embedding, 30-day result cache, 3-month
Analytics Engine stats, 7-day Workers Logs), the per-session UI flag (24 h),
and the fact that the `mcp.draw.io` Worker has no persisted logs (no
`[observability]` block, no `DEBUG` secret). Turning on Workers Logs or
`DEBUG` in production changes what the policy has to say.

### MCP

| Field | Value |
|---|---|
| URL type | Universal (one fixed endpoint for everyone — not Template) |
| MCP Server URL | `https://mcp.draw.io/mcp` |
| Transport | Streamable HTTP |
| Authentication | None. The server holds no accounts and no user data, so there is no OAuth, no UserInfo endpoint and no reviewer credentials to supply. |
| Custom UI | Yes — ChatGPT renders the MCP-UI (`ui://`) resource inline, streaming animation and viewer toolbar included (verified in the desktop app). Content security policy: `https://viewer.diagrams.net` (viewer, ELK, Mermaid and libavoid scripts), `https://app.diagrams.net` (favicon, the shape images the viewer resolves against that base, and the "Open in draw.io" target), `https://icons.diagrams.net` (images for icon-service shapes). `github.com` appears only as the help button's link target, not as a fetch. Clients without an MCP Apps UI get an `app.diagrams.net/#create=` link in a second text block. |
| Domain verification | see §2 |

Setup in the portal: **MCPs** tab → **Connect** → the panel shows the URL from
`.mcp.json`, "No Auth" and "Domain verified" → **Connect** → **Continue**. The
scan then lists `create_diagram` and `search_shapes` ("Not live" until
published). Then **Add review information** (countries, five test cases, three
negative test cases, video URL + release notes) → **Save details**.

Before connecting: confirm `DEBUG` is **not** set in the production Worker
(`npx wrangler secret list`, and no `DEBUG` var in `wrangler.toml`). With
`DEBUG=true` the Worker writes truncated `tools/call` response bodies — i.e.
diagram content — to the Cloudflare log stream.

### Tools and annotations

| Tool | readOnlyHint | openWorldHint | destructiveHint | Rationale |
|---|---|---|---|---|
| `create_diagram` | true | false | false | Renders the XML/Mermaid it is given. No state is created or changed anywhere, no outbound calls. |
| `search_shapes` | true | true | false | Read-only lookup, but the local index is supplemented live from the draw.io icon service (`icons.diagrams.net`), so it does reach the public internet. |

Both also carry `idempotentHint: true`. Tool responses contain only the diagram
the caller supplied, the shape styles, and the `app.diagrams.net` link — no
personal data, no secrets, no internal identifiers.

The portal recommends an `outputSchema`. `search_shapes` declares one
(`{ shapes: [{style, w, h, title}] }`, returned as `structuredContent` beside the
existing text block). It was held back during the 1.0.0 review — the reviewer
works from the `Scan Tools` snapshot, so the live tool definitions must not move
while a review is open — and went live with app server 1.0.6 (2026-09-30), so
the rescan for the resubmission picks it up. `create_diagram` keeps none: its result is
the rendered view plus a link, and a host that surfaces `structuredContent`
instead of the app would put a raw XML blob in the chat.

Rule of thumb: once **Scan Tools** has run for a submission, don't deploy tool
definition changes until that review is decided.

### Skills — not in v1

Left out of the first submission (see §5). When it is added later, the bundle is
`plugins/codex/drawio` (`skills/drawio/SKILL.md` + manifest), which is already
provider-neutral: no Claude references, no `userConfig`, no hooks, no
commands/agents, no live-artifact instructions.

### Starter prompts

- Create a flowchart for a user login flow with a password-reset branch.
- Draw an AWS architecture diagram for a serverless image pipeline.
- Turn this Mermaid sequence diagram into an editable draw.io diagram.

### Testing — five positive cases (as submitted for 1.0.1)

Portal fields per case: scenario (200 chars), user prompt (500, single line),
tool triggered (200), expected output (300).

| # | Scenario | User prompt | Tool triggered | Expected output |
|---|---|---|---|---|
| 1 | Flowchart with a decision branch, from a plain-language description | Use draw.io to create a flowchart for a user login flow, including the password-reset branch. | create_diagram | An interactive flowchart rendered inline: login steps, a valid/invalid password decision and a password-reset branch, with zoom, pan and an Open in draw.io button. Clients without inline UI get an app.diagrams.net link instead. |
| 2 | Cloud architecture diagram using the official AWS icons (shape search, then diagram) | Use draw.io to draw an AWS architecture diagram: CloudFront to S3, and API Gateway to Lambda to DynamoDB, with the official AWS icons. | search_shapes, then create_diagram | search_shapes returns AWS shape styles for CloudFront, S3, API Gateway, Lambda and DynamoDB; create_diagram renders the architecture inline with those icons and arrows between them, editable in draw.io. |
| 3 | Sequence diagram from a description | Use draw.io to draw a sequence diagram: the browser sends a login request to the API, the API checks the password with the auth service, and the API returns a session token to the browser. | create_diagram | An inline sequence diagram with three participants (Browser, API, Auth service) and the login request, password check and session token messages in order. |
| 4 | Entity-relationship diagram | Use draw.io to make an ER diagram for a bookstore with customers, orders and books. | create_diagram | An inline ER diagram with Customer, Order and Book entities, their key attributes, and relationships: a customer places orders, and an order contains books. |
| 5 | Hand-placed layout with a connector routed around a shape | Use draw.io to place Web, Cache and DB as three boxes side by side and connect Web to DB. The connector must route around the Cache box, not through it. | create_diagram | Three boxes in one row in the given order. The Web to DB connector is orthogonal and goes around the Cache box instead of crossing it. |

No test accounts, credentials or fixture data are required — every case runs
against the public endpoint anonymously.

### Testing — three negative cases (as submitted for 1.0.1)

The portal means prompts where the plugin should **not** trigger although the
model might think it relevant (fields: scenario, user prompt).

| # | Scenario | User prompt |
|---|---|---|
| 1 | Conceptual question about diagram types; the user wants an explanation in text, not a diagram | What is the difference between a flowchart and a UML activity diagram? |
| 2 | Request for photorealistic artwork; draw.io creates structured diagrams, not images or illustrations | Generate a photorealistic illustration of a mountain landscape at sunset. |
| 3 | Numeric data chart; draw.io is for diagrams, not data plotting, so the model's own charting should handle it | Make a bar chart of our monthly revenue: January 12k, February 15k, March 9k. |

Video walkthrough URL: <https://mcp.draw.io/demo/drawio-plugin-demo.mp4>
(reviewers only). Countries: all supported. Translations: none.

### Global

Availability: worldwide. The service is anonymous, has no regional data
residency requirements, and support/legal terms are global.

### Release notes (1.0.1, as submitted)

Shown to users of the plugin, so written for them, not for the reviewer:

> First release. Describe a diagram in the conversation and draw.io creates it:
> flowcharts, sequence, class and entity-relationship diagrams, cloud and
> network architecture diagrams and more. Zoom, pan and view diagrams full
> screen in the conversation, and open them in the draw.io editor to keep
> editing. Technical diagrams can use shapes from the draw.io libraries,
> including AWS, Azure, Google Cloud, Kubernetes and Cisco.

## 4. After submission

Submitting starts review; it does not publish. After approval, publishing is a
separate action in the portal. Once published, OpenAI periodically re-fetches the
tool list: deleted tools drop out immediately, changed definitions go live after
automated checks. Listing changes and skill updates need a new version, a new
review and a new publish.

## 5. Open decisions / risks

- **Decided: v1 is MCP-only.** The skill needs a local draw.io Desktop install —
  `skills/drawio/SKILL.md`
  shells out to the `drawio` CLI for Mermaid conversion, ELK layout and
  PNG/SVG/PDF export, and writes files into the user's working directory. That
  works in Codex, but not in plain ChatGPT, and OpenAI asks developers to talk to
  their partner contact when a plugin's value depends on local execution. The
  plain-XML path degrades gracefully (no CLI needed), but the skill scanner may
  still flag the bundled shell commands. So: MCP-only through review round one,
  skill in the next version once the listing is live — that version needs its own
  review and publish anyway.
- **Prompts have to name draw.io.** In ChatGPT the plugin does not reliably
  trigger on "create a flowchart …" alone; "use draw.io to create a flowchart …"
  does. Test-case prompts are worded that way, since a reviewer who types them
  verbatim would otherwise see nothing happen. Starter prompts are exempt: the
  composer sends them with the `@draw.io` mention attached.
- **Portable manifest.** `plugins/codex/drawio` uses the `.codex-plugin/plugin.json`
  compatibility layout. OpenAI's current recommendation is a root `plugin.json`
  with the Agent Plugins schema and the OpenAI settings under
  `extensions.com.openai`; the old layout stays supported as a fallback.
