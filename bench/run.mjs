// Runs benchmark cases: for every variant × prompt × model × repeat, one
// `claude -p` session with only the variant's MCP server, every stream line
// timestamped (<tag>.jsonl), and a summary (<tag>-summary.json) with the time
// to the diagram, the time to the end of the answer, thinking and writing
// time, tokens and tool calls. The diagram's arguments go to
// <tag>-diagram.json for render.mjs.
//
// usage: node run.mjs --variants today,semantic --prompts er,er-clinic
//          --models sonnet --repeats 3 [--parallel 4] [--out DIR]
//
// Variants:
//   today     the app server as it is (the model picks XML or Mermaid from
//             the tool description, fetches the reference, places shapes)
//   mermaid   the app server, with "Use Mermaid." after the prompt
//   semantic  semantic-server.mjs: the model describes the diagram, the
//             engine in shared/semantic lays it out

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BENCH, APP_SERVER, parseArgs, outDir } from "./lib/common.mjs";

const args = parseArgs(process.argv.slice(2));
const out = outDir(args);
const prompts = JSON.parse(fs.readFileSync(path.join(BENCH, "prompts.json"), "utf8"));
const variants = String(args.variants || "today,semantic").split(",");
const keys = String(args.prompts || Object.keys(prompts).join(",")).split(",");
const models = String(args.models || "sonnet").split(",");
const repeats = Number(args.repeats || 1);
const parallel = Number(args.parallel || 4);
const first = Number(args["first-repeat"] || 1);

fs.mkdirSync(out, { recursive: true });

function mcpConfig(variant, tag)
{
  let server;

  if (variant === "semantic")
  {
    server = { type: "stdio", command: process.execPath, args: [path.join(BENCH, "semantic-server.mjs")],
      env: Object.assign({ BENCH_RUN_DIR: out, BENCH_TAG: tag, NODE_PATH: process.env.NODE_PATH || "" },
        process.env.SEMANTIC_TYPES ? { SEMANTIC_TYPES: process.env.SEMANTIC_TYPES } : {}) };
  }
  else
  {
    server = { type: "stdio", command: process.execPath, args: [APP_SERVER, "--stdio"] };
  }

  const file = path.join(out, tag + "-mcp.json");
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { drawio: server } }));

  return file;
}

function allowedTools(variant)
{
  return (variant === "semantic") ? ["mcp__drawio__create_semantic_diagram"] :
    ["mcp__drawio__create_diagram", "mcp__drawio__get_drawio_reference", "mcp__drawio__search_shapes"];
}

function promptFor(variant, key)
{
  return prompts[key] + (variant === "mermaid" ? " Use Mermaid." : "");
}

function summarize(tag, meta, events, wall)
{
  const blocks = [];
  const open = {};
  const calls = [];
  let result = null;

  for (const { t, e } of events)
  {
    if (e.type === "stream_event")
    {
      const ev = e.event;

      if (ev.type === "content_block_start")
      {
        open[ev.index] = { kind: ev.content_block.type, name: ev.content_block.name, start: t };
      }
      else if (ev.type === "content_block_stop" && open[ev.index])
      {
        const b = open[ev.index];
        b.secs = (t - b.start) / 1000;
        blocks.push(b);
        delete open[ev.index];
      }
    }
    else if (e.type === "assistant")
    {
      for (const c of e.message.content || [])
      {
        if (c.type === "tool_use")
        {
          calls.push({ id: c.id, name: c.name, input: c.input, callT: t });
        }
      }
    }
    else if (e.type === "user")
    {
      for (const c of (e.message && e.message.content) || [])
      {
        if (c.type === "tool_result")
        {
          const call = calls.find(function(x) { return x.id === c.tool_use_id; });
          const text = Array.isArray(c.content) ? c.content.map(function(x) { return x.text || ""; }).join("") : String(c.content);

          if (call)
          {
            call.resultT = t;
            call.resultChars = text.length;
            call.isError = !!c.is_error;
          }
        }
      }
    }
    else if (e.type === "result")
    {
      result = e;
    }
  }

  const diagramCalls = calls.filter(function(c) { return /create_/.test(c.name) && !c.isError; });
  const last = diagramCalls[diagramCalls.length - 1];

  if (last)
  {
    fs.writeFileSync(path.join(out, tag + "-diagram.json"), JSON.stringify({ tool: last.name.replace(/^mcp__\w+__/, ""),
      arguments: last.input }, null, 1));
  }

  const usage = (result && result.usage) || {};
  const sum = function(kind) { return blocks.filter(function(b) { return b.kind === kind; }).reduce(function(a, b) { return a + b.secs; }, 0); };

  return Object.assign({}, meta, {
    tag: tag,
    ok: last != null,
    wallSecs: wall / 1000,
    diagramSecs: last ? (last.resultT || last.callT) / 1000 : null,
    turns: result && result.num_turns,
    outputTokens: usage.output_tokens,
    totalTokens: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0) + (usage.output_tokens || 0),
    thinkSecs: Math.round(sum("thinking") * 10) / 10,
    textSecs: Math.round(sum("text") * 10) / 10,
    diagramWriteSecs: Math.round(blocks.filter(function(b) { return b.kind === "tool_use" && /create_/.test(b.name); })
      .reduce(function(a, b) { return a + b.secs; }, 0) * 10) / 10,
    diagramChars: last ? JSON.stringify(last.input).length : null,
    format: last ? (last.input.xml ? "xml" : last.input.mermaid ? "mermaid" : "semantic") : null,
    calls: calls.map(function(c)
    {
      return { name: c.name.replace(/^mcp__\w+__/, ""), t: c.callT / 1000, inputChars: JSON.stringify(c.input).length,
        resultChars: c.resultChars, isError: c.isError, query: c.input && (c.input.query || c.input.format) };
    }),
    finalText: result && typeof result.result === "string" ? result.result.slice(0, 600) : null
  });
}

function runCase(variant, key, model, rep)
{
  const tag = [variant, key, model, rep].join("-");
  const cli = ["-p", promptFor(variant, key), "--model", model, "--tools", "", "--strict-mcp-config",
    "--mcp-config", mcpConfig(variant, tag), "--allowedTools", allowedTools(variant).join(","),
    "--no-session-persistence", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];

  return new Promise(function(resolve)
  {
    const t0 = Date.now();
    const log = fs.createWriteStream(path.join(out, tag + ".jsonl"));
    const child = spawn("claude", cli, { cwd: out, stdio: ["ignore", "pipe", "pipe"] });
    const events = [];
    let buf = "";

    child.stdout.on("data", function(d)
    {
      buf += d.toString();
      let i;

      while ((i = buf.indexOf("\n")) >= 0)
      {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);

        if (line.trim() !== "")
        {
          const ev = { t: Date.now() - t0, e: JSON.parse(line) };
          events.push(ev);
          log.write(JSON.stringify(ev) + "\n");
        }
      }
    });

    child.stderr.on("data", function(d)
    {
      fs.appendFileSync(path.join(out, tag + ".stderr"), d);
    });

    child.on("close", function()
    {
      log.end();
      const s = summarize(tag, { variant: variant, key: key, model: model, repeat: rep }, events, Date.now() - t0);
      fs.writeFileSync(path.join(out, tag + "-summary.json"), JSON.stringify(s, null, 1));
      console.log(tag, s.ok ? "diagram " + s.diagramSecs + " s, end " + s.wallSecs + " s, " + s.outputTokens +
        " output tokens, " + s.format : "NO DIAGRAM");
      resolve(s);
    });
  });
}

const jobs = [];

for (let r = first; r < first + repeats; r++)
{
  for (const model of models)
  {
    for (const key of keys)
    {
      for (const variant of variants)
      {
        jobs.push([variant, key, model, r]);
      }
    }
  }
}

let next = 0;

async function worker()
{
  while (next < jobs.length)
  {
    const job = jobs[next++];
    await runCase.apply(null, job);
  }
}

await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker));
