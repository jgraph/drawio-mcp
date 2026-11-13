// Blind image judgement: for each prompt, the diagram of variant A and of
// variant B from the same repeat are shown to a model as "X" and "Y",
// without saying how either was made, once in each order (so a preference
// for the first or second image cancels out). The model answers which one a
// user would prefer and scores both. Results: judge-<a>-vs-<b>.json.
//
// usage: node judge.mjs --a today --b semantic [--prompts er,er-clinic]
//          [--runs-model sonnet] [--model opus] [--parallel 3] [--out DIR]

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BENCH, parseArgs, outDir } from "./lib/common.mjs";

const args = parseArgs(process.argv.slice(2));
const out = outDir(args);
const prompts = JSON.parse(fs.readFileSync(path.join(BENCH, "prompts.json"), "utf8"));
const a = args.a || "today";
const b = args.b || "semantic";
const runsModel = args["runs-model"] || "sonnet";
const judgeModel = args.model || "opus";
const keys = String(args.prompts || Object.keys(prompts).join(",")).split(",");
const parallel = Number(args.parallel || 3);

const QUESTION =
  "Two diagrams were drawn for the same request in a chat, where they are shown about 800 px wide and scaled " +
  "down to fit. The request was:\n\n\"{prompt}\"\n\n" +
  "Diagram X is the first image, diagram Y the second. Which one would the user prefer? Judge, in this order: " +
  "the content (everything the request asks for, correct), the layout (related things close together, short and " +
  "straight lines, few crossings and bends, nothing overlapping, a clear reading order), readability at chat size, " +
  "and tidiness (alignment, consistent sizes and colors). Differences in naming or in the exact columns are not " +
  "a reason to prefer one unless something requested is missing or wrong.\n\n" +
  "Answer with JSON only, no other text: {\"better\": \"X\" | \"Y\" | \"tie\", \"scoreX\": 1-10, \"scoreY\": 1-10, " +
  "\"reason\": \"one sentence\"}";

function image(file)
{
  return { type: "image", source: { type: "base64", media_type: "image/png", data: fs.readFileSync(file).toString("base64") } };
}

function ask(first, second, prompt)
{
  const message = { type: "user", message: { role: "user", content: [
    { type: "text", text: "Diagram X:" }, image(first),
    { type: "text", text: "Diagram Y:" }, image(second),
    { type: "text", text: QUESTION.replace("{prompt}", prompt) }] } };
  const cli = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--model", judgeModel,
    "--tools", "", "--strict-mcp-config", "--no-session-persistence"];

  return new Promise(function(resolve)
  {
    const child = spawn("claude", cli, { cwd: out, stdio: ["pipe", "pipe", "ignore"] });
    let buf = "";

    child.stdout.on("data", function(d) { buf += d.toString(); });
    child.on("close", function()
    {
      const result = buf.split("\n").filter(Boolean).map(function(l) { try { return JSON.parse(l); } catch (e) { return {}; } })
        .find(function(e) { return e.type === "result"; });
      const text = result && typeof result.result === "string" ? result.result : "";
      const m = /\{[\s\S]*\}/.exec(text);
      let verdict = null;

      try
      {
        verdict = m ? JSON.parse(m[0]) : null;
      }
      catch (e)
      {
        verdict = null;
      }

      resolve(verdict || { error: text.slice(0, 300) });
    });
    child.stdin.end(JSON.stringify(message) + "\n");
  });
}

const pairs = [];

for (const key of keys)
{
  for (let r = 1; r <= 20; r++)
  {
    const fa = path.join(out, [a, key, runsModel, r].join("-") + "-full.png");
    const fb = path.join(out, [b, key, runsModel, r].join("-") + "-full.png");

    if (fs.existsSync(fa) && fs.existsSync(fb))
    {
      pairs.push({ key: key, repeat: r, order: "ab", first: fa, second: fb });
      pairs.push({ key: key, repeat: r, order: "ba", first: fb, second: fa });
    }
  }
}

const results = [];
let next = 0;

async function worker()
{
  while (next < pairs.length)
  {
    const p = pairs[next++];
    const v = await ask(p.first, p.second, prompts[p.key]);
    // back from X / Y to the variants
    const isA = function(xy) { return (p.order === "ab") === (xy === "X"); };
    const winner = v.better === "tie" ? "tie" : (v.better === "X" || v.better === "Y") ? (isA(v.better) ? a : b) : null;
    const row = { key: p.key, repeat: p.repeat, order: p.order, winner: winner,
      scoreA: p.order === "ab" ? v.scoreX : v.scoreY, scoreB: p.order === "ab" ? v.scoreY : v.scoreX,
      reason: v.reason || v.error };
    results.push(row);
    console.log(p.key, p.repeat, p.order, "→", winner, row.scoreA, row.scoreB, "|", row.reason);
  }
}

await Promise.all(Array.from({ length: Math.min(parallel, pairs.length) }, worker));

const valid = results.filter(function(r) { return r.winner != null; });
const points = valid.reduce(function(s, r) { return s + (r.winner === b ? 1 : r.winner === "tie" ? 0.5 : 0); }, 0);
const avg = function(k) { return valid.length ? valid.reduce(function(s, r) { return s + (r[k] || 0); }, 0) / valid.length : null; };
const summary = { a: a, b: b, judge: judgeModel, runsModel: runsModel, judgements: valid.length,
  winsB: valid.filter(function(r) { return r.winner === b; }).length,
  winsA: valid.filter(function(r) { return r.winner === a; }).length,
  ties: valid.filter(function(r) { return r.winner === "tie"; }).length,
  shareB: valid.length ? Math.round(points / valid.length * 100) / 100 : null,
  meanScoreA: avg("scoreA"), meanScoreB: avg("scoreB"), results: results };
fs.writeFileSync(path.join(out, "judge-" + a + "-vs-" + b + "-" + runsModel + ".json"), JSON.stringify(summary, null, 1));
console.log(b, "preferred in", summary.winsB, "of", valid.length, "(ties", summary.ties + "), share", summary.shareB,
  "mean score", a, summary.meanScoreA && summary.meanScoreA.toFixed(2), b, summary.meanScoreB && summary.meanScoreB.toFixed(2));
