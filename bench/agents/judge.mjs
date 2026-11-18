// The blind judgement of the cross-agent measurement, by a model that is
// not Claude: Codex CLI (BENCH_CODEX, default `codex`) with gpt-6.1-sol
// (BENCH_JUDGE_MODEL, effort BENCH_JUDGE_EFFORT, default medium) in an empty folder, read-only, without the
// user's config. For each agent, prompt and repeat, the images of one set of
// conditions are shown as "A", "B", "C" … in a shuffled order, with the
// request and nothing about how any of them was made, and scored on a fixed
// rubric (content, layout, readability and overall, 1 to 5 each, anchors in
// RUBRIC) and ranked. Every set is judged twice, the second time in the
// reverse order of the first, so a preference for a position cancels out.
//
// Sets (--set):
//   help     plain, mcp, plugin: what draw.io adds to what the agent does
//            on its own
//   formats  mermaid, svg, drawio, fast: the formats on the same request
//            (fast only for flowcharts and swimlanes)
//
// A condition without an image (no diagram, or one that didn't render) is
// not shown; report.mjs ranks it last.
//
// Results: <out>/judge/<set>-<agent>-<key>-<repeat>-<order>.json, and
// <out>/judge-<set>.json with every judgement.
//
// usage: node agents/judge.mjs --set help [--agents …] [--prompts …]
//          [--repeats 1] [--parallel 3] [--out DIR]

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, outDir, pool, readJson } from "../lib/common.mjs";
import { SETS, loadAgentPrompts, tagOf, listArg } from "./lib/conditions.mjs";

const RUBRIC =
  "Score every image from 1 to 5 on each of these, using the whole range:\n" +
  "- content: 5 = everything the request asks for is there and correct; 3 = a few things missing or wrong; " +
  "1 = most of it missing or wrong, or no diagram at all.\n" +
  "- layout: 5 = a clear reading order, related things together, lines short and easy to follow, nothing " +
  "overlapping; 3 = readable with effort (some crossings, detours or crowding); 1 = hard to follow (overlaps, " +
  "lines that end nowhere or run through boxes).\n" +
  "- readability: 5 = every label legible at this size and inside its shape; 3 = some labels small, cramped or " +
  "partly hidden; 1 = labels unreadable or cut off.\n" +
  "- overall: 5 = you would hand it to a colleague as it is; 3 = usable after some fixes; 1 = not usable.\n" +
  "Differences of style (colors, fonts, the look of a tool) are not a reason for a score unless they hurt " +
  "readability.";

const args = parseArgs(process.argv.slice(2));
const out = outDir(args);
const set = args.set || "help";
const conditions = SETS[set];
const prompts = loadAgentPrompts();
const agents = listArg(args.agents, "claude-sonnet,claude-opus,codex");
const keys = listArg(args.prompts, Object.keys(prompts).join(","));
const repeats = Number(args.repeats || 1);
const parallel = Number(args.parallel || 3);
const judgeDir = path.join(out, "judge");
const JUDGE_MODEL = process.env.BENCH_JUDGE_MODEL || "gpt-6.1-sol";
const renders = path.join(out, "render");

if (conditions == null)
{
  console.error("Unknown set: " + set + " (" + Object.keys(SETS).join(", ") + ")");
  process.exit(1);
}

fs.mkdirSync(judgeDir, { recursive: true });

const schema =
{
  type: "object",
  additionalProperties: false,
  required: ["images", "ranking", "reason"],
  properties:
  {
    images:
    {
      type: "array",
      items:
      {
        type: "object",
        additionalProperties: false,
        required: ["label", "content", "layout", "readability", "overall"],
        properties:
        {
          label: { type: "string" },
          content: { type: "integer" },
          layout: { type: "integer" },
          readability: { type: "integer" },
          overall: { type: "integer" }
        }
      }
    },
    ranking: { type: "array", items: { type: "string" } },
    reason: { type: "string" }
  }
};
const schemaFile = path.join(judgeDir, "schema.json");
fs.writeFileSync(schemaFile, JSON.stringify(schema));

// A shuffle that is the same for the same set, so a judgement can be run again.
function shuffled(list, seed)
{
  return list.map(function(x, i)
  {
    return { x: x, k: crypto.createHash("sha1").update(seed + ":" + i).digest("hex") };
  }).sort(function(a, b) { return a.k.localeCompare(b.k); }).map(function(e) { return e.x; });
}

function question(request, labels)
{
  return "You are judging diagrams that were made for the same request. You see " + labels.length +
    " images, attached in this order: " + labels.map(function(l, i) { return l + " is image " + (i + 1); }).join(", ") +
    ". Each is shown at its own size or scaled down to fit 1200 x 1400 px. Judge only what you see.\n\n" +
    "The request was:\n\n\"" + request + "\"\n\n" + RUBRIC + "\n\n" +
    "Then rank all images from best to worst by label (" + labels.join(", ") + "), no ties, and give the main " +
    "reason for the ranking in one sentence. Do not run any commands.";
}

function ask(images, labels, request, file)
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "judge-"));
  const cmd = process.env.BENCH_CODEX || "codex";
  const last = path.join(work, "answer.json");
  const argv = ["exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--json",
    "--disable", "apps", "--disable", "plugins", "--disable", "remote_plugin", "--disable", "shell_snapshot",
    "-s", "read-only", "-C", work, "--output-schema", schemaFile, "-o", last];

  argv.push("-m", JUDGE_MODEL);
  argv.push("-c", "model_reasoning_effort=\"" + (process.env.BENCH_JUDGE_EFFORT || "medium") + "\"");

  for (const img of images)
  {
    argv.push("-i", img);
  }

  // the request on stdin: --image takes every value after it
  argv.push("--", "-");

  return new Promise(function(resolve)
  {
    const env = Object.assign({}, process.env, { HOME: work, CODEX_HOME: process.env.CODEX_HOME || path.join(os.homedir(), ".codex") });
    delete env.NODE_PATH;
    const child = spawn(cmd, argv, { cwd: work, env: env, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.end(question(request, labels));
    let stdout = "";

    child.stdout.on("data", function(d) { stdout += d.toString(); });
    child.on("close", function()
    {
      let verdict = null;

      try
      {
        verdict = JSON.parse(fs.readFileSync(last, "utf8"));
      }
      catch (e)
      {
        verdict = { error: stdout.slice(-400) };
      }

      const usage = stdout.split("\n").filter(Boolean).map(function(l) { try { return JSON.parse(l); } catch (e) { return {}; } })
        .find(function(e) { return e.type === "turn.completed"; });
      fs.rmSync(work, { recursive: true, force: true });
      resolve(Object.assign(verdict, { judgeUsage: usage ? usage.usage : null }));
    });
  });
}

const jobs = [];

for (const agent of agents)
{
  for (const key of keys)
  {
    for (let r = 1; r <= repeats; r++)
    {
      const shown = conditions.filter(function(c)
      {
        return fs.existsSync(path.join(renders, tagOf(c, key, agent, r) + "-view.png"));
      });

      if (shown.length < 2)
      {
        continue;
      }

      const first = shuffled(shown, [set, agent, key, r].join("|"));
      jobs.push({ agent: agent, key: key, repeat: r, order: 1, conditions: first });
      jobs.push({ agent: agent, key: key, repeat: r, order: 2, conditions: first.slice().reverse() });
    }
  }
}

console.log(jobs.length + " judgements of the set " + set + " (" + conditions.join(", ") + ")");

await pool(jobs, parallel, async function(j)
{
  const file = path.join(judgeDir, [set, j.agent, j.key, j.repeat, j.order].join("-") + ".json");

  if (fs.existsSync(file) && !args.force)
  {
    return;
  }

  const labels = j.conditions.map(function(c, i) { return String.fromCharCode(65 + i); });
  const images = j.conditions.map(function(c) { return path.join(renders, tagOf(c, j.key, j.agent, j.repeat) + "-view.png"); });
  const v = await ask(images, labels, prompts[j.key].prompt, file);
  const byLabel = {};

  for (const img of v.images || [])
  {
    byLabel[img.label] = img;
  }

  const row = { set: set, agent: j.agent, key: j.key, type: prompts[j.key].type, repeat: j.repeat, order: j.order,
    shown: j.conditions, scores: {}, rank: {}, reason: v.reason || v.error, usage: v.judgeUsage };

  j.conditions.forEach(function(c, i)
  {
    row.scores[c] = byLabel[labels[i]] || null;
    const at = (v.ranking || []).indexOf(labels[i]);
    row.rank[c] = at >= 0 ? at + 1 : null;
  });

  fs.writeFileSync(file, JSON.stringify(row, null, 1));
  console.log(set, j.agent, j.key, j.repeat, j.order, "ranking:", (v.ranking || []).map(function(l) { return j.conditions[l.charCodeAt(0) - 65]; }).join(" > ") || "none",
    "|", (v.reason || v.error || "").slice(0, 140));
});

// every judgement of the set in one file
const all = fs.readdirSync(judgeDir).filter(function(f) { return f.startsWith(set + "-") && f.endsWith(".json"); })
  .map(function(f) { return readJson(path.join(judgeDir, f)); });
fs.writeFileSync(path.join(out, "judge-" + set + ".json"), JSON.stringify({ set: set, conditions: conditions,
  judge: "Codex CLI, " + JUDGE_MODEL, rubric: RUBRIC, judgements: all }, null, 1));
console.log(all.length + " judgements in judge-" + set + ".json");
