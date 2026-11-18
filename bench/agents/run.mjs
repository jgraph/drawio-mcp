// Runs the agent sessions of the cross-agent measurement: for every agent ×
// condition × prompt × repeat, one session in an empty working folder
// (<out>/work/<tag>), its timestamped stream in <out>/runs/<tag>.jsonl and a
// summary in <out>/runs/<tag>-summary.json: seconds to the end of the
// answer, the files the agent wrote with the time each appeared and last
// changed, tokens, tool calls, the draw.io MCP calls (arguments and results
// in <tag>-mcp.json) and the final answer.
//
// Conditions:
//   plain    the prompt as it is, no draw.io anything: which format does the
//            agent pick on its own?
//   mcp      the hosted draw.io MCP server (BENCH_MCP_URL, else
//            https://mcp.draw.io/mcp), as a user adds it
//   plugin   the draw.io plugin as the agent's marketplace installs it: for
//            Claude Code plugins/claude-code (the skill and the hosted MCP
//            server), for Codex its skill (plugins/codex/drawio, skill only)
//   mermaid  the prompt + " Write it in Mermaid and save it as diagram.mmd."
//   svg      the prompt + " Draw it as an SVG image and save it as diagram.svg."
//   drawio   the prompt + " Make it a draw.io diagram and save it as
//            diagram.drawio." (the agent writes the XML on its own)
//   fast     the fast mode: a server with create_semantic_diagram alone
//            (../semantic-server.mjs, flowcharts and swimlanes, cells asked
//            for, as the app server's own tool); only the prompts of those
//            types
//
// Already finished sessions are skipped (--force runs them again).
//
// The agents read the path of their working folder and look around it:
// Codex searched for draw.io files first when the path had the name of this
// repository in it, and listed the folders next to its own. --work DIR
// (BENCH_WORK) runs each session in DIR/s-<hash of its tag>, where neither
// the path nor the folders next to it name a format or a condition, and
// moves its files to <out>/work/<tag> when it ends.
//
// usage: node agents/run.mjs --agents claude-sonnet,codex
//          --conditions plain,mcp [--prompts flow-ticket,…] [--type er]
//          [--repeats 1] [--first-repeat 1] [--parallel 3] [--timeout 900]
//          [--force] [--work DIR] [--out DIR]
//
// Env: BENCH_CLAUDE, BENCH_CODEX (the CLIs, default claude and codex on
// PATH), BENCH_CODEX_MODEL, BENCH_CODEX_EFFORT, BENCH_MCP_URL, CODEX_HOME,
// NODE_PATH (for the fast mode's server: elkjs).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BENCH, REPO, parseArgs, outDir, pool } from "../lib/common.mjs";
import { CONDITIONS, loadAgentPrompts, tagOf, listArg } from "./lib/conditions.mjs";
import { AGENTS, runSession } from "./lib/sessions.mjs";
import { summarize } from "./lib/summary.mjs";

const MCP_URL = process.env.BENCH_MCP_URL || "https://mcp.draw.io/mcp";
const args = parseArgs(process.argv.slice(2));
const out = outDir(args);
const prompts = loadAgentPrompts();
const list = listArg;
const agents = list(args.agents, "claude-sonnet");
const conditions = list(args.conditions, "plain");
const types = args.type ? list(args.type) : null;
const keys = list(args.prompts, Object.keys(prompts).join(",")).filter(function(k)
{
  return prompts[k] != null && (types == null || types.includes(prompts[k].type));
});
const repeats = Number(args.repeats || 1);
const first = Number(args["first-repeat"] || 1);
const parallel = Number(args.parallel || 3);
const timeout = Number(args.timeout || 900) * 1000;
const workRoot = args.work || process.env.BENCH_WORK || null;

for (const a of agents)
{
  if (AGENTS[a] == null)
  {
    console.error("Unknown agent: " + a + " (" + Object.keys(AGENTS).join(", ") + ")");
    process.exit(1);
  }
}

for (const c of conditions)
{
  if (CONDITIONS[c] == null)
  {
    console.error("Unknown condition: " + c + " (" + Object.keys(CONDITIONS).join(", ") + ")");
    process.exit(1);
  }
}

const runs = path.join(out, "runs");
fs.mkdirSync(runs, { recursive: true });

function specFor(condition, key, agent, repeat)
{
  const c = CONDITIONS[condition];
  const tag = tagOf(condition, key, agent, repeat);
  const family = AGENTS[agent].family;
  const spec = { agent: agent, prompt: prompts[key].prompt + (c.suffix || ""), workdir: workRoot != null ?
    path.join(workRoot, "s-" + crypto.createHash("sha1").update(tag).digest("hex").slice(0, 8)) : path.join(out, "work", tag),
    logFile: path.join(runs, tag + ".jsonl"), timeout: timeout, out: out };

  if (c.mcp === "hosted")
  {
    spec.mcp = { url: MCP_URL };
  }
  else if (c.mcp === "fast")
  {
    spec.mcp = { command: process.execPath, args: [path.join(BENCH, "semantic-server.mjs")],
      env: { BENCH_RUN_DIR: runs, BENCH_TAG: tag, NODE_PATH: process.env.NODE_PATH || "",
        SEMANTIC_TYPES: c.types.join(","), SEMANTIC_HINTS: "ask" } };
  }

  if (c.plugin && family === "claude")
  {
    spec.pluginDir = path.join(REPO, "plugins", "claude-code");
  }
  else if (c.plugin)
  {
    spec.skillDir = path.join(REPO, "plugins", "codex", "drawio", "skills", "drawio");
  }

  return spec;
}

async function runCase(condition, key, agent, repeat)
{
  const tag = tagOf(condition, key, agent, repeat);
  const summaryFile = path.join(runs, tag + "-summary.json");

  if (!args.force && fs.existsSync(summaryFile))
  {
    return;
  }

  const spec = specFor(condition, key, agent, repeat);
  fs.rmSync(spec.workdir, { recursive: true, force: true });

  for (const suffix of [".stderr", "-mcp.json"])
  {
    fs.rmSync(path.join(runs, tag + suffix), { force: true });
  }

  const started = new Date().toISOString();
  const r = await runSession(spec);
  const s = summarize(AGENTS[agent].family, r.events);

  // the files where render.mjs reads them
  if (workRoot != null)
  {
    const kept = path.join(out, "work", tag);
    fs.rmSync(kept, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(kept), { recursive: true });
    fs.cpSync(spec.workdir, kept, { recursive: true });
    fs.rmSync(spec.workdir, { recursive: true, force: true });
  }

  const mcpCalls = s.calls.filter(function(c) { return c.mcp; });

  if (mcpCalls.length > 0)
  {
    fs.writeFileSync(path.join(runs, tag + "-mcp.json"), JSON.stringify(mcpCalls, null, 1));
  }

  const summary =
  {
    tag: tag, condition: condition, key: key, type: prompts[key].type, agent: agent, family: AGENTS[agent].family,
    model: s.model || AGENTS[agent].model, effort: AGENTS[agent].effort, version: s.version, repeat: repeat,
    started: started, prompt: spec.prompt, mcpUrl: spec.mcp && spec.mcp.url ? spec.mcp.url : undefined,
    mcpServers: s.mcpServers, wallSecs: r.secs, timedOut: r.timedOut || undefined, exitCode: r.exitCode, error: s.error,
    outputTokens: s.outputTokens, inputTokens: s.inputTokens, reasoningTokens: s.reasoningTokens, turns: s.turns,
    toolCounts: s.toolCounts, diagramCalls: s.diagramCalls,
    diagramTool: s.lastDiagramCall ? s.lastDiagramCall.name : null,
    diagramPath: s.lastDiagramCall ? (s.lastDiagramCall.name === "create_semantic_diagram" ? "fast" :
      s.lastDiagramCall.input.mermaid != null ? "mermaid" : "xml") : null,
    diagramCallSecs: s.diagramCallSecs, usedReference: s.usedReference, usedSearch: s.usedSearch, skillUsed: s.skillUsed,
    files: r.files, finalText: s.finalText, command: r.command,
    calls: s.calls.map(function(c) { return { name: c.name, mcp: c.mcp || undefined, t: c.t, isError: c.isError || undefined }; })
  };
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 1));
  console.log(tag, r.timedOut ? "TIMED OUT" : "", r.secs + " s,", s.outputTokens + " output tokens,",
    s.diagramCalls ? s.diagramCalls + " diagram call(s) " + summary.diagramPath : "",
    "files: " + r.files.map(function(f) { return f.path; }).join(" "), s.error ? "ERROR " + s.error : "");
}

const jobs = [];

for (let r = first; r < first + repeats; r++)
{
  for (const key of keys)
  {
    for (const condition of conditions)
    {
      const c = CONDITIONS[condition];

      if (c.types != null && !c.types.includes(prompts[key].type))
      {
        continue;
      }

      for (const agent of agents)
      {
        jobs.push([condition, key, agent, r]);
      }
    }
  }
}

console.log(jobs.length + " sessions, output in " + out);

await pool(jobs, parallel, function(job)
{
  return runCase.apply(null, job);
});
