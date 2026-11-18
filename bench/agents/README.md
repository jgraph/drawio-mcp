# Diagrams by coding agents: formats, draw.io and the fast mode

A measurement of what coding agents make when they are asked for a diagram, run on 18 November 2026:

1. which format an agent picks on its own for a "make me a diagram" request;
2. what the same agents make with draw.io's MCP server or plugin;
3. draw.io's fast mode against the formats an agent can write itself (Mermaid, SVG and draw.io XML): output tokens, time, whether the diagram is valid, whether it can be edited, what a layout check finds, and which diagram a judge prefers.

The code, the prompts and the summary of the numbers (`results.json`) are in this folder; the sessions, files and images stay with whoever runs it.

## Results

354 sessions on 18 November 2026: Claude Code with Sonnet 5.5 and with Opus 5.5 and Codex CLI with GPT-6.1-sol, ten prompts, seven conditions, one session per prompt for the agent on its own and two for every other condition. Medians for seconds and tokens, means for the rest; the judge's scores are from 1 to 5. With one or two sessions per prompt the differences between neighbouring numbers are not reliable; the large ones are.

### On its own: not measured yet

| Agent | Sessions | The diagram was written as |
|---|---|---|
| Claude Code, Sonnet 5.5 | 10 | draw.io 8, Mermaid 2 |
| Claude Code, Opus 5.5 | 10 | draw.io 10 |
| Codex CLI, GPT-6.1-sol | 10 | draw.io 9, Mermaid 1 |

These numbers say little. The sessions ran in folders whose path contained the name of this repository, next to the folders of the other sessions, which were named after their conditions, and the agents see their folder's path and look around it: in 8 of Codex's 10 sessions the first command searched the folder for draw.io files. A run in folders whose path names no format (`run.mjs --work`) is still to be made; until then this measurement has no answer to the first question.

### With draw.io

What the agents made with the hosted MCP server or the plugin, beside what they made on their own (in this run mostly draw.io XML written by the agent, see above). The judge saw the three diagrams of the same request side by side.

| Agent | With | Sessions | Seconds to the diagram | Output tokens | Valid | Connectors attached | Layout findings | Judge: overall | Judge: ranked first |
|---|---|---|---|---|---|---|---|---|---|
| Claude Code, Sonnet 5.5 | on its own | 10 | 39 | 6,361 | 100 % | 85 % | 2.2 | 3.9 | 25 % |
| Claude Code, Sonnet 5.5 | MCP server | 20 | 56 | 9,195 | 100 % | 100 % | 0.4 | 4.4 | 55 % |
| Claude Code, Sonnet 5.5 | plugin | 20 | 32 | 5,152 | 100 % | 67 % | 4.4 | 3.2 | 20 % |
| Claude Code, Opus 5.5 | on its own | 10 | 86 | 9,955 | 100 % | 72 % | 0.2 | 4.7 | 70 % |
| Claude Code, Opus 5.5 | MCP server | 20 | 94 | 12,021 | 100 % | 100 % | 0.4 | 3.7 | 10 % |
| Claude Code, Opus 5.5 | plugin | 20 | 65 | 7,547 | 100 % | 70 % | 0.1 | 3.7 | 20 % |
| Codex CLI, GPT-6.1-sol | on its own | 10 | 125 | 5,750 | 90 % | 54 % | 0.4 | 3.8 | 45 % |
| Codex CLI, GPT-6.1-sol | MCP server | 20 | 40 | 1,561 | 100 % | 100 % | 0.8 | 3.6 | 20 % |
| Codex CLI, GPT-6.1-sol | plugin | 20 | 119 | 4,766 | 100 % | 68 % | 0.7 | 4.0 | 35 % |

- The MCP server's diagrams were all valid and had every connector attached to its shapes. Where the agent wrote the draw.io XML itself (on its own or through the plugin's skill), 54 to 85 % were attached: 490 of the 544 others were the messages of sequence diagrams, drawn between two points beside the lifelines (29 of 519 attached), which stay where they are when a lifeline is moved.
- Time and tokens depend on the agent: through the MCP server, Codex reached the diagram in 40 s against 119 s with the plugin and 125 s on its own; Claude Code was faster with the plugin (32 s for Sonnet, 65 s for Opus) than with the MCP server (56 s and 94 s), where every session first fetched the XML reference with `get_drawio_reference`.
- The judge preferred the MCP server's diagrams for Sonnet (ranked first in 55 % of the judgements, above the diagram on its own in 14 of 20) and Opus's own draw.io XML for Opus (70 %, above the MCP server's in 18 of 20); for Codex the three were close (3.6 to 4.0).
- The layout findings are means over few diagrams and carried by a few broken ones: the plugin's 4.4 for Sonnet comes from one sequence diagram with 60 findings and two ER diagrams with 9 and 15.

### Formats: flowcharts and swimlanes, with the fast mode

The four flowchart and swimlane prompts, the types the fast mode draws, two sessions each. The judge saw the four diagrams of the same request side by side.

| Agent | Format | Sessions | Output tokens | Diagram characters | Seconds to the diagram | Valid | Labels in their shape | Connectors attached | Moves keep lines | Layout findings | Judge: overall | Judge: ranked first |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude Code, Sonnet 5.5 | Mermaid | 8 | 925 | 907 | 5 | 100 % | 100 % | 100 % | no | 0.1 | 2.8 | 0 % |
| Claude Code, Sonnet 5.5 | SVG | 8 | 5,143 | 4,703 | 32 | 100 % | 1 % | 0 % | no | 0.5 | 4.8 | 75 % |
| Claude Code, Sonnet 5.5 | draw.io XML | 8 | 5,902 | 8,360 | 36 | 100 % | 100 % | 100 % | yes | 0.0 | 4.1 | 13 % |
| Claude Code, Sonnet 5.5 | fast mode | 8 | 2,053 | 1,777 | 14 | 100 % | 94 % | 100 % | yes | 0.0 | 3.9 | 13 % |
| Claude Code, Opus 5.5 | Mermaid | 8 | 1,304 | 989 | 9 | 100 % | 100 % | 100 % | no | 0.0 | 2.7 | 0 % |
| Claude Code, Opus 5.5 | SVG | 8 | 6,436 | 5,333 | 54 | 100 % | 6 % | 0 % | no | 0.0 | 4.9 | 75 % |
| Claude Code, Opus 5.5 | draw.io XML | 8 | 8,300 | 10,238 | 66 | 100 % | 100 % | 100 % | yes | 0.0 | 3.8 | 13 % |
| Claude Code, Opus 5.5 | fast mode | 8 | 1,971 | 2,069 | 21 | 100 % | 94 % | 100 % | yes | 0.0 | 3.9 | 13 % |
| Codex CLI, GPT-6.1-sol | Mermaid | 8 | 711 | 1,041 | 22 | 100 % | 100 % | 100 % | no | 0.0 | 2.4 | 0 % |
| Codex CLI, GPT-6.1-sol | SVG | 8 | 3,472 | 6,508 | 81 | 100 % | 0 % | 0 % | no | 0.5 | 4.7 | 69 % |
| Codex CLI, GPT-6.1-sol | draw.io XML | 8 | 2,793 | 16,309 | 73 | 100 % | 91 % | 100 % | yes | 0.3 | 4.4 | 31 % |
| Codex CLI, GPT-6.1-sol | fast mode | 8 | 1,167 | 2,243 | 31 | 100 % | 95 % | 100 % | yes | 0.0 | 3.8 | 0 % |

- The fast mode reached the diagram in 14 s (Sonnet), 21 s (Opus) and 31 s (Codex) with about 2,000 characters of description, against 36, 66 and 73 s for draw.io XML written by the agent (8,000 to 16,000 characters) and 32, 54 and 81 s for SVG. Only Mermaid was faster (5, 9 and 22 s) and shorter (about 1,000 characters).
- Every fast-mode and draw.io XML diagram here was valid, with every connector attached; the fast mode's labels are 94 to 95 % in their shape because its title on the page counts as a loose label.
- SVG has nothing to edit: its labels were almost never grouped with their shapes (0 to 6 %) and its lines are not attached to anything. Mermaid's lines are attached, but Mermaid places every shape itself, so none can be moved.
- The judge ranked SVG first in 69 to 75 % of the judgements (scores 4.7 to 4.9), then draw.io XML (3.8 to 4.4) and the fast mode (3.8 to 3.9) close together, and Mermaid last (2.4 to 2.8). Head to head, the fast mode was ranked above the agent's draw.io XML in 19 of 48 judgements, above Mermaid in 40 and above SVG in 5.

### Formats: all prompts

The ten prompts, two sessions each, without the fast mode (flowcharts and swimlanes only).

| Agent | Format | Sessions | Output tokens | Diagram characters | Seconds to the diagram | Valid | Labels in their shape | Connectors attached | Moves keep lines | Layout findings | Judge: overall | Judge: ranked first |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude Code, Sonnet 5.5 | Mermaid | 20 | 1,194 | 1,463 | 6 | 100 % | 100 % | 100 % | no | 0.1 | 3.0 | 0 % |
| Claude Code, Sonnet 5.5 | SVG | 20 | 5,806 | 6,150 | 39 | 100 % | 3 % | 0 % | no | 0.3 | 4.7 | 70 % |
| Claude Code, Sonnet 5.5 | draw.io XML | 20 | 6,187 | 9,739 | 38 | 100 % | 99 % | 72 % | yes | 0.5 | 4.2 | 25 % |
| Claude Code, Opus 5.5 | Mermaid | 20 | 1,674 | 1,547 | 11 | 100 % | 100 % | 100 % | no | 0.1 | 3.0 | 0 % |
| Claude Code, Opus 5.5 | SVG | 20 | 9,999 | 8,282 | 94 | 100 % | 29 % | 0 % | no | 0.0 | 5.0 | 90 % |
| Claude Code, Opus 5.5 | draw.io XML | 20 | 9,214 | 12,508 | 71 | 100 % | 97 % | 72 % | yes | 0.2 | 3.8 | 5 % |
| Codex CLI, GPT-6.1-sol | Mermaid | 20 | 842 | 1,850 | 24 | 85 % | 100 % | 100 % | no | 0.2 | 2.3 | 0 % |
| Codex CLI, GPT-6.1-sol | SVG | 20 | 4,366 | 9,113 | 105 | 100 % | 28 % | 0 % | no | 0.5 | 4.7 | 80 % |
| Codex CLI, GPT-6.1-sol | draw.io XML | 20 | 3,829 | 21,444 | 87 | 100 % | 90 % | 69 % | yes | 0.5 | 4.1 | 20 % |

- Three of Codex's 20 Mermaid diagrams did not parse: sequence diagrams with a semicolon in a message, which Mermaid reads as the end of the statement. Everything else was valid.
- Where the agent wrote draw.io XML, 69 to 72 % of the connectors were attached over all prompts against 100 % on flowcharts and swimlanes: 337 of the 340 unattached were the messages of sequence diagrams, drawn between points, none attached to a lifeline.
- The judge's order is the same as above: SVG (4.7 to 5.0), draw.io XML (3.8 to 4.2), Mermaid (2.3 to 3.0). Mermaid was ranked last in 95 of the 114 judgements it was shown in, and most of their reasons name small or illegible labels: Mermaid draws at its own size and its layouts were wide, so half of its images (28 of 57) were shown at less than 60 % of their size.

### Caveats

- One judge, GPT-6.1-sol, which also ran Codex's sessions. It sees images only, not whether a diagram can be edited. SVG was ranked first for the diagrams of every agent, so its preference is not a preference for its own model's work.
- The judge sees every image fitted into 1,200 × 1,400 px, as a user sees a diagram that fits the screen. Wide or tall layouts lose there, Mermaid's most.
- Codex's reported output tokens are lower than what it writes would need at the usual three to four characters per token (866 tokens for a 7,224-character tool call in one session); compare Codex by seconds and diagram characters, and tokens only between Claude Code's rows. Where Codex wrote a script that writes the diagram, the diagram's characters are the file's, not what it typed.
- The draw.io skill could not use draw.io Desktop (no display, see Conditions) and wrote its XML directly; with draw.io Desktop it lays out Mermaid input with it.
- The fast mode was offered alone, as the only tool; the hosted MCP server offers it beside `create_diagram`, and its description has the agent take it only when the user asks for a quick diagram.
- The layout check is a heuristic on the drawn SVG; its findings are worth reading per diagram (`report.md` and `render/<tag>-render.json` name examples) rather than as a score.


## Agents

| Agent | Version | Model |
|---|---|---|
| Claude Code | 2.1.322 | Claude Sonnet 5.5 (`claude-sonnet-5-5`) |
| Claude Code | 2.1.322 | Claude Opus 5.5 (`claude-opus-5-5`) |
| Codex CLI | 0.167.0-alpha.3.2 | GPT-6.1-sol, reasoning effort medium |

GitHub Copilot CLI, Gemini CLI, Antigravity and Cursor's CLI were not installed on the test machine and are not in this run. `lib/sessions.mjs` has one entry per agent; another CLI needs its command line, its isolation and a reader for its event stream (`lib/summary.mjs`).

Every session starts in an empty folder with the agent's defaults and nothing of the user's: Claude Code with `--setting-sources project,local`, `--strict-mcp-config`, no session persistence and no auto memory (so no user settings, skills, plugins, MCP servers or memory); Codex with `--ignore-user-config`, `--ephemeral`, apps and plugins off and an empty home folder (no user config, skills or MCP servers). Commands that open a browser are replaced by stubs that log the call. Claude Code ran without permission prompts (`--dangerously-skip-permissions`, its sandbox was not available on the test machine), Codex in its `workspace-write` sandbox with network access. A session ends after 900 seconds.

## Prompts

`prompts.json`: ten requests, two per diagram type (flowchart, swimlane, architecture, sequence, entity-relationship), each phrased as a user would ask ("Make me a …") and none naming a format or a tool. One session per agent and prompt on its own, two for every other condition.

## Conditions

| Condition | What the agent gets |
|---|---|
| on its own | the prompt as it is, no draw.io anything |
| draw.io MCP server | the hosted MCP server, `https://mcp.draw.io/mcp` (app server 1.10.0), added as a user adds it |
| draw.io plugin | the plugin as its marketplace installs it: for Claude Code `plugins/claude-code` (the `drawio` skill and the hosted MCP server), for Codex `plugins/codex/drawio` (the skill only) |
| asked for Mermaid | the prompt + " Write it in Mermaid and save it as diagram.mmd." |
| asked for SVG | the prompt + " Draw it as an SVG image and save it as diagram.svg." |
| asked for draw.io XML | the prompt + " Make it a draw.io diagram and save it as diagram.drawio." |
| draw.io fast mode | an MCP server with `create_semantic_diagram` alone (`../semantic-server.mjs`): the agent lists the nodes, groups and edges, the engine in `shared/semantic` lays them out. Only the flowchart and swimlane prompts, the types the fast mode draws |

The draw.io skill turns Mermaid into draw.io and exports images with draw.io Desktop's command line. The test machine had no display, so draw.io Desktop could not start and the skill wrote its draw.io XML directly, as it does where draw.io Desktop is missing.

## Measures

- **The diagram**: what went to a draw.io diagram tool; else the file the condition asked for; else the first diagram file the agent wrote, sources before renderings (draw.io, Mermaid, DOT, PlantUML, D2, Excalidraw, then SVG, HTML and images); else a Mermaid, DOT or PlantUML block or text art in the final answer (`lib/artifacts.mjs`).
- **Seconds to the diagram**: from the start of the session to the diagram tool's call or the last write of the diagram file; **seconds to the end**: to the end of the agent's answer.
- **Output tokens**: as the CLI reports them for the whole session (for Claude Code the sum of its turns' output tokens, for Codex the `output_tokens` of its turn). **Diagram characters**: the size of what the agent wrote for the diagram: the diagram tool's arguments, the file or the block in the answer.
- **Valid**: it parses (draw.io XML and SVG with the browser's XML parser, Mermaid 11.17.2 with `mermaid.parse()`, DOT with Graphviz) and it renders to at least one shape or label (draw.io in the app server's viewer, Mermaid with `mermaid.render()`, SVG as it is, DOT with Graphviz).
- **Editable**: **labels in their shape**, the share of labels that belong to a shape, so that an editor moves them with it (draw.io: the shape's own label or a text cell inside a shape, such as a table's row, not a text cell on the page; SVG: the text sits in a group with its shape; Mermaid: always, by its syntax); **connectors attached**, the share of connectors with both ends on a shape (draw.io: `source` and `target` set; Mermaid: always, its edges name their nodes; SVG: never, an SVG line has no ends to attach); **moves keep lines**, whether a shape can be moved in an editor and its connectors follow (draw.io: yes; Mermaid: no, the layout places every shape; SVG: no).
- **Layout findings**: one check for every format, on the drawn SVG in headless Chrome (`lib/geometry.mjs`): labels that overlap each other, labels that stick out of the shape they are in, shapes that overlap without one containing the other (an overlap of half the smaller shape or more counts as parts of one shape, such as a shadow or a header, drawn apart), and labels outside the drawing. It reads only what is on screen and is a heuristic: a format that draws a label across a line or a frame on purpose can count. For draw.io the viewer's own layout check is reported beside it.
- **The judge**: GPT-6.1-sol through Codex CLI, so that no Claude model judges Claude's diagrams (it may favour GPT's). It sees the images of one set of conditions for the same request, named A, B, C …, in a shuffled order, each at its own size or scaled down to fit 1,200 × 1,400 px, with the request and nothing about how they were made, scores each from 1 to 5 on content, layout, readability and overall against a fixed rubric (`judge.mjs`), and ranks them. Every set is judged twice, the second time in the reverse order, so a preference for a position cancels out. A condition without a valid diagram is not shown; it counts as 1 and is never ranked first. Sets: on its own, MCP server and plugin; and Mermaid, SVG, draw.io XML and the fast mode (the fast mode only on its prompts).

## Run it

It needs Node 20+, Claude Code and Codex CLI signed in (`BENCH_CLAUDE`, `BENCH_CODEX` if they are not on the `PATH`), `chrome-headless-shell` and Graphviz for DOT. The judge runs Codex CLI too. This run: `run.mjs --repeats 1` with all seven conditions, then `--first-repeat 2 --repeats 1` with all but `plain`; `judge.mjs --set help` and `--set formats --repeats 2`.

```sh
cd bench && npm ci          # elkjs, mermaid, puppeteer-core
(cd ../mcp-app-server && npm ci)

# 1. the sessions (each agent's CLI signed in); --work puts the working folders
#    where their path names no format, the agents read it
node agents/run.mjs --agents claude-sonnet,claude-opus,codex \
  --conditions plain,mcp,plugin,mermaid,svg,drawio,fast --work /tmp/sessions --out out/agents

# 2. draw every diagram and measure it
node agents/render.mjs --chrome /path/to/chrome-headless-shell --out out/agents

# 3. the blind judgements, both orders (--repeats: the sessions per prompt)
node agents/judge.mjs --set help --out out/agents
node agents/judge.mjs --set formats --repeats 2 --out out/agents

# 4. the tables (report.md) and results.json
node agents/report.mjs --out out/agents
```
