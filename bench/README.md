# Bench

Measures the ways a model can draw a diagram with the draw.io MCP servers against each other, end to end: how long until the diagram is there, how many tokens it takes, what the viewer's layout check finds in the rendering, and which diagram a judge prefers when shown both images without knowing how either was made.

Variants (`run.mjs`):

| Variant | What the model gets |
|---|---|
| `today` | the app server as it is: the model picks XML or Mermaid from the `create_diagram` description, fetches the reference and places the shapes |
| `mermaid` | the same, with "Use Mermaid." after the prompt |
| `semantic` | `semantic-server.mjs`: one tool, `create_semantic_diagram`, the model describes the diagram and the engine in `shared/semantic` lays it out |

## Setup

The bench needs Node 20+, the `claude` CLI (signed in) and a Chrome or `chrome-headless-shell` for the renders. Its two packages (`elkjs`, `puppeteer-core`) install here (`npm ci` in `bench/`) or anywhere else with `NODE_PATH` pointing at that `node_modules`. The app server's own packages must be installed (`npm ci` in `mcp-app-server/`), since the renders run its viewer.

Output goes to `bench/out/` (ignored), `--out DIR` or `BENCH_OUT`.

## Steps

```bash
# 1. the runs: one `claude -p` session per variant, prompt, model and repeat
node run.mjs --variants today,semantic --prompts er,er-clinic,er-shop --models sonnet --repeats 3

# 2. render every diagram in the app server's viewer, as a chat host shows it
node render.mjs --chrome /path/to/chrome

# 3. blind judgement of the pairs, both orders
node judge.mjs --a today --b semantic --prompts er,er-clinic,er-shop --runs-model sonnet

# 4. the tables
node report.mjs
```

Prompts are in `prompts.json`. Per run, `run.mjs` writes the timestamped stream (`<tag>.jsonl`), a summary (`<tag>-summary.json`: seconds to the diagram and to the end of the answer, thinking and writing time, tokens, tool calls) and the diagram's arguments (`<tag>-diagram.json`). The semantic server also saves every call with the engine's XML, warnings and stats (`<tag>-call<n>.json`).

`render.mjs` runs a minimal MCP Apps host in headless Chrome (an 800 px frame, a screen 1000 px high, which sets the viewer's inline height) and saves what the chat shows (`<tag>-inline.png`), the PNG the viewer sends to the model (`<tag>-full.png`), the layout check (`<tag>-check.txt`) and the issue count (`<tag>-render.json`). Semantic descriptions are converted by the engine first and then go through `create_diagram` as XML, like every other diagram.

`judge.mjs` shows a judge model (Opus by default) the two full images of one prompt and repeat as "X" and "Y", once in each order, with the prompt and the chat frame's size, and asks which one the user would prefer and for a score of each. A tie counts half; the share of B is its points over all judgements.

## When a type is switched on

The semantic tool only offers a diagram type (`describeTool` in `shared/semantic/description.js`) once its layouts are at least as good as what the model places itself today: in a blind judgement of at least three prompts with three repeats each, both orders, the semantic share is 0.5 or more, and the layout check finds no more issues than today. Time and tokens alone don't switch a type on.
