// Runs benchmark cases: for every variant × prompt × model × repeat, one
// `claude -p` session with only the variant's MCP server, every stream line
// timestamped (<tag>.jsonl), and a summary (<tag>-summary.json) with the time
// to the diagram, the time to the end of the answer, thinking and writing
// time, tokens and tool calls. The diagram's arguments go to
// <tag>-diagram.json for render.mjs; a description the size rule refused
// goes to <tag>-refused.json, for preview.mjs.
//
// With --edits, the prompt's follow-up request ("edit" in prompts.json) is
// sent as a second user turn in the same session once the first answer is
// complete. The summary has that turn under "edit", measured from the moment
// the request was sent, and its diagram goes to <tag>-edit-diagram.json.
//
// usage: node run.mjs --variants today,semantic [--prompts er,er-clinic]
//          [--type architecture] [--split dev] [--size large]
//          [--models sonnet] [--repeats 3] [--first-repeat 1] [--parallel 4]
//          [--edits | --edits dev | --edits held-out] [--timeout 900]
//          [--out DIR]
//
// Variants:
//   today          the app server as it is (the model picks XML or Mermaid
//                  from the tool description, fetches the reference, places
//                  the shapes)
//   mermaid        the app server, with "Use Mermaid." after the prompt
//   semantic       semantic-server.mjs: the model describes the diagram, the
//                  engine in shared/semantic lays it out
//   semantic-auto  the same without placement hints (SEMANTIC_HINTS=off):
//                  neither offered in the description nor used by the engine
//   semantic-rows  the same with the hints asked for (SEMANTIC_HINTS=ask):
//                  the model gives every node and group a row and a column
//   both           one server with the app server's three tools and
//                  create_semantic_diagram, to see which one the model picks
//   both-rule      the same, with a sentence in the create_diagram
//                  description that sends architecture, cloud, network and
//                  swimlane-flowchart diagrams to the semantic tool
//                  (BENCH_FORMAT_RULE=1, which `both` also passes on when set)
//   switch-on      the app server itself with its switch on
//                  (DRAWIO_SEMANTIC_TYPES, "on" unless set): its own
//                  create_semantic_diagram for the types that passed the
//                  judgement next to create_diagram, as staging has it

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BENCH, APP_SERVER, parseArgs, outDir, loadPrompts, selectKeys, runTag, pool, round } from "./lib/common.mjs";

const VARIANTS = ["today", "mermaid", "semantic", "semantic-auto", "semantic-rows", "both", "both-rule", "switch-on"];
const SEMANTIC_TOOL = "create_semantic_diagram";

const args = parseArgs(process.argv.slice(2));
const out = outDir(args);
const prompts = loadPrompts();
const variants = String(args.variants || "today,semantic").split(",");
const keys = selectKeys(prompts, args);
const models = String(args.models || "sonnet").split(",");
const repeats = Number(args.repeats || 1);
const parallel = Number(args.parallel || 4);
const first = Number(args["first-repeat"] || 1);
const timeout = Number(args.timeout || 900) * 1000;
// --edits: every prompt; --edits dev / held-out: the prompts of that split
const edits = args.edits === true ? "all" : (args.edits || null);

for (const v of variants)
{
  if (!VARIANTS.includes(v))
  {
    console.error("Unknown variant: " + v + " (" + VARIANTS.join(", ") + ")");
    process.exit(1);
  }
}

fs.mkdirSync(out, { recursive: true });

// The app server itself: as it is, or with its own semantic tool switched on.
function usesAppServer(variant)
{
  return variant === "today" || variant === "mermaid" || variant === "switch-on";
}

function usesSemanticServer(variant)
{
  return !usesAppServer(variant);
}

function offersBoth(variant)
{
  return variant === "both" || variant === "both-rule" || variant === "switch-on";
}

function formatRule(variant)
{
  return variant === "both-rule" || (variant === "both" && process.env.BENCH_FORMAT_RULE === "1");
}

function mcpConfig(variant, tag)
{
  let server;

  if (usesSemanticServer(variant))
  {
    const env = { BENCH_RUN_DIR: out, BENCH_TAG: tag, NODE_PATH: process.env.NODE_PATH || "" };

    for (const name of ["SEMANTIC_TYPES", "SEMANTIC_RESULT", "SEMANTIC_HINTS", "SEMANTIC_PARTS"])
    {
      if (process.env[name])
      {
        env[name] = process.env[name];
      }
    }

    if (variant === "semantic-auto")
    {
      env.SEMANTIC_HINTS = "off";
    }
    else if (variant === "semantic-rows")
    {
      env.SEMANTIC_HINTS = "ask";
    }

    if (offersBoth(variant))
    {
      env.BENCH_WITH_APP = "1";
      env.BENCH_FORMAT_RULE = formatRule(variant) ? "1" : "0";
    }

    server = { type: "stdio", command: process.execPath, args: [path.join(BENCH, "semantic-server.mjs")], env: env };
  }
  else
  {
    server = { type: "stdio", command: process.execPath, args: [APP_SERVER, "--stdio"] };

    // the switch as a deploy sets it; the other variants are the baseline,
    // create_diagram alone, whatever the shell or the server's default has
    server.env = { DRAWIO_SEMANTIC_TYPES: variant === "switch-on" ? (process.env.DRAWIO_SEMANTIC_TYPES || "on") : "off" };
  }

  const file = path.join(out, tag + "-mcp.json");
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { drawio: server } }));

  return file;
}

function allowedTools(variant)
{
  const app = ["mcp__drawio__create_diagram", "mcp__drawio__get_drawio_reference", "mcp__drawio__search_shapes"];
  const semantic = ["mcp__drawio__" + SEMANTIC_TOOL];

  return offersBoth(variant) ? app.concat(semantic) : usesSemanticServer(variant) ? semantic : app;
}

function promptFor(variant, key)
{
  return prompts[key].prompt + (variant === "mermaid" ? " Use Mermaid." : "");
}

function userMessage(text)
{
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: text }] } }) + "\n";
}

function shortName(name)
{
  return name.replace(/^mcp__\w+?__/, "");
}

// The nodes of a description, also when the list came as JSON text.
function countNodes(input)
{
  let nodes = input.nodes;

  if (typeof nodes === "string")
  {
    try
    {
      nodes = JSON.parse(nodes);
    }
    catch (e)
    {
      return null;
    }
  }

  return Array.isArray(nodes) ? nodes.length : null;
}

/**
 * One turn of a session: the events from `start` ms (when its request was
 * sent) up to its `result` event. Times are seconds from the turn's start.
 */
function summarizeTurn(events, start)
{
  const blocks = [];
  const open = {};
  const calls = [];
  let result = null;
  let resultT = null;
  let outputTokens = 0;
  let inputTokens = 0;
  let streamed = false;

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
      else if (ev.type === "message_start" && ev.message && ev.message.usage)
      {
        const u = ev.message.usage;
        streamed = true;
        inputTokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      }
      else if (ev.type === "message_delta" && ev.usage)
      {
        // one per request to the model, with that message's output tokens
        outputTokens += ev.usage.output_tokens || 0;
      }
    }
    else if (e.type === "assistant")
    {
      for (const c of e.message.content || [])
      {
        if (c.type === "tool_use")
        {
          calls.push({ id: c.id, name: c.name, input: c.input || {}, callT: t });
        }
      }
    }
    else if (e.type === "user")
    {
      for (const c of (e.message && Array.isArray(e.message.content) ? e.message.content : []))
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
            // the size rule refused the description (shared/semantic/index.js; while
            // it named the limit, the error said "are drawn with up to")
            call.tooLarge = call.isError && shortName(call.name) === SEMANTIC_TOOL &&
              /too large to lay out|are drawn with up to/.test(text);
          }
        }
      }
    }
    else if (e.type === "result")
    {
      result = e;
      resultT = t;
    }
  }

  const secs = function(t) { return t == null ? null : round((t - start) / 1000, 2); };
  const diagramCalls = calls.filter(function(c) { return /create_/.test(c.name); });
  const good = diagramCalls.filter(function(c) { return !c.isError; });
  const last = good[good.length - 1];
  const usage = (result && result.usage) || {};
  const sum = function(kind) { return blocks.filter(function(b) { return b.kind === kind; }).reduce(function(a, b) { return a + b.secs; }, 0); };
  const called = function(name) { return calls.some(function(c) { return shortName(c.name) === name; }); };

  if (!streamed)
  {
    outputTokens = usage.output_tokens;
    inputTokens = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  }

  return {
    last: last,
    refused: diagramCalls.find(function(c) { return c.tooLarge; }),
    summary:
    {
      ok: last != null,
      endSecs: secs(resultT),
      diagramSecs: last ? secs(last.resultT || last.callT) : null,
      turns: result && result.num_turns,
      outputTokens: outputTokens,
      totalTokens: (inputTokens || 0) + (outputTokens || 0),
      // what the session's result event reports, for a cross-check (it may count the whole session)
      resultOutputTokens: usage.output_tokens,
      thinkSecs: round(sum("thinking"), 1),
      textSecs: round(sum("text"), 1),
      diagramWriteSecs: round(blocks.filter(function(b) { return b.kind === "tool_use" && /create_/.test(b.name); })
        .reduce(function(a, b) { return a + b.secs; }, 0), 1),
      diagramChars: last ? JSON.stringify(last.input).length : null,
      format: last ? (shortName(last.name) === SEMANTIC_TOOL ? "semantic" : last.input.mermaid ? "mermaid" : "xml") : null,
      // which diagram tool the model reached for first, whether or not the call succeeded
      firstDiagramTool: diagramCalls.length > 0 ? shortName(diagramCalls[0].name) : null,
      diagramTool: last ? shortName(last.name) : null,
      diagramCalls: diagramCalls.length,
      // the size rule sent the diagram to create_diagram: the description was
      // refused as too large, and the diagram came from the other tool
      sentOn: last != null && shortName(last.name) !== SEMANTIC_TOOL &&
        diagramCalls.some(function(c) { return c.tooLarge; }),
      usedReference: called("get_drawio_reference"),
      usedSearch: called("search_shapes"),
      calls: calls.map(function(c)
      {
        return { name: shortName(c.name), t: secs(c.callT), inputChars: JSON.stringify(c.input).length,
          resultChars: c.resultChars, isError: c.isError, tooLarge: c.tooLarge || undefined,
          nodes: (shortName(c.name) === SEMANTIC_TOOL) ? countNodes(c.input) : undefined,
          query: c.input.query || c.input.format };
      }),
      finalText: result && typeof result.result === "string" ? result.result.slice(0, 600) : null
    }
  };
}

// How the variant offers the placement hints, as render.mjs has to read
// them again: not at all, asked for (one grid for the page) or optional.
function hintsOf(variant)
{
  if (variant === "semantic-auto" || process.env.SEMANTIC_HINTS === "off")
  {
    return false;
  }

  // the app server's own tool asks for the cells (SEMANTIC_HINTS in its src/shared.js)
  return (variant === "semantic-rows" || variant === "switch-on" || process.env.SEMANTIC_HINTS === "ask") ? "ask" : true;
}

function saveDiagram(file, variant, call)
{
  if (call)
  {
    fs.writeFileSync(path.join(out, file), JSON.stringify({ tool: shortName(call.name), arguments: call.input,
      hints: hintsOf(variant) }, null, 1));
  }
}

function runCase(variant, key, model, rep)
{
  const tag = runTag(variant, key, model, rep);
  const p = prompts[key];
  const withEdit = edits != null && (edits === "all" || edits === p.split) && typeof p.edit === "string";
  const cli = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--include-partial-messages", "--model", model, "--tools", "", "--strict-mcp-config",
    "--mcp-config", mcpConfig(variant, tag), "--allowedTools", allowedTools(variant).join(","),
    "--no-session-persistence"];

  for (const suffix of [".stderr", "-diagram.json", "-edit-diagram.json", "-refused.json"])
  {
    fs.rmSync(path.join(out, tag + suffix), { force: true });
  }

  return new Promise(function(resolve)
  {
    const t0 = Date.now();
    const log = fs.createWriteStream(path.join(out, tag + ".jsonl"));
    const child = spawn("claude", cli, { cwd: out, stdio: ["pipe", "pipe", "pipe"] });
    const events = [];
    let buf = "";
    let editStart = null;
    let editIndex = null;
    let timedOut = false;

    const timer = setTimeout(function()
    {
      timedOut = true;
      child.kill();
    }, timeout);

    function onEvent(ev)
    {
      events.push(ev);
      log.write(JSON.stringify(ev) + "\n");

      if (ev.e.type === "result")
      {
        // the first answer is complete: ask for the change, or end the session
        if (withEdit && editStart == null && summarizeTurn(events, 0).last != null)
        {
          editIndex = events.length;
          editStart = Date.now() - t0;
          child.stdin.write(userMessage(p.edit));
        }
        else
        {
          child.stdin.end();
        }
      }
    }

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
          let e;

          try
          {
            e = JSON.parse(line);
          }
          catch (err)
          {
            continue;
          }

          onEvent({ t: Date.now() - t0, e: e });
        }
      }
    });

    child.stderr.on("data", function(d)
    {
      fs.appendFileSync(path.join(out, tag + ".stderr"), d);
    });

    child.stdin.on("error", function() {});

    child.on("close", function()
    {
      clearTimeout(timer);
      log.end();

      const firstTurn = summarizeTurn(editIndex != null ? events.slice(0, editIndex) : events, 0);
      const editTurn = editIndex != null ? summarizeTurn(events.slice(editIndex), editStart) : null;
      const f = firstTurn.summary;
      saveDiagram(tag + "-diagram.json", variant, firstTurn.last);
      saveDiagram(tag + "-refused.json", variant, firstTurn.refused);

      if (editTurn)
      {
        saveDiagram(tag + "-edit-diagram.json", variant, editTurn.last);
      }

      const s = Object.assign({ variant: variant, key: key, type: p.type, split: p.split, size: p.size, model: model,
        repeat: rep, tag: tag, formatRule: usesSemanticServer(variant) && offersBoth(variant) ? formatRule(variant) : undefined,
        timedOut: timedOut || undefined,
        // seconds until the first answer was complete (as before: "wall"), and of the whole session
        wallSecs: f.endSecs != null ? f.endSecs : round((Date.now() - t0) / 1000, 2),
        sessionSecs: round((Date.now() - t0) / 1000, 2) }, f,
        { edit: editTurn ? Object.assign({ request: p.edit }, editTurn.summary) : null });
      delete s.endSecs;
      fs.writeFileSync(path.join(out, tag + "-summary.json"), JSON.stringify(s, null, 1));
      console.log(tag, s.ok ? "diagram " + s.diagramSecs + " s, end " + s.wallSecs + " s, " + s.outputTokens +
        " output tokens, " + s.format : (timedOut ? "TIMED OUT" : "NO DIAGRAM"),
        s.edit ? (s.edit.ok ? "| edit: diagram " + s.edit.diagramSecs + " s, end " + s.edit.endSecs + " s, " +
          s.edit.outputTokens + " output tokens" : "| edit: NO DIAGRAM") : "");
      resolve(s);
    });

    child.stdin.write(userMessage(promptFor(variant, key)));
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

console.log(jobs.length + " runs" + (edits ? ", with the edit turn (" + edits + ")" : "") + ", output in " + out);

await pool(jobs, parallel, function(job)
{
  return runCase.apply(null, job);
});
