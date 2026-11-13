// Blind image judgement: for each prompt, the diagram of variant A and of
// variant B from the same repeat are shown to a model as "X" and "Y",
// without saying how either was made, once in each order (so a preference
// for the first or second image cancels out). The model answers which one a
// user would prefer and scores both.
//
// The images are the inline ones (<tag>-inline.png): the 800 px frame as the
// chat shows it, so small text counts as it does for the user. --image full
// judges the whole diagram at its own size instead (<tag>-full.png, the PNG
// the viewer sends to the model). --edits judges the diagrams after the
// follow-up request of run.mjs --edits.
//
// Every judgement records the median font size of both diagrams (from
// render.mjs), so report.mjs can tell a preference for a layout from a
// preference for larger text.
//
// Results: judge-<a>-vs-<b>-<runs model>[-edits][-full].json. A second call
// for other prompts adds to the file; --fresh starts it again.
//
// usage: node judge.mjs --a today --b semantic [--prompts er,er-clinic]
//          [--type architecture] [--split held-out] [--runs-model sonnet]
//          [--model opus] [--image inline|full] [--edits] [--parallel 3]
//          [--fresh] [--out DIR]

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs, outDir, loadPrompts, selectKeys, runTag, pool, readJson } from "./lib/common.mjs";

const args = parseArgs(process.argv.slice(2));
const out = outDir(args);
const prompts = loadPrompts();
const a = args.a || "today";
const b = args.b || "semantic";
const runsModel = args["runs-model"] || "sonnet";
const judgeModel = args.model || "opus";
const keys = selectKeys(prompts, args);
const parallel = Number(args.parallel || 3);
const imageKind = args.image === "full" ? "full" : "inline";
const edits = !!args.edits;
const file = path.join(out, "judge-" + a + "-vs-" + b + "-" + runsModel + (edits ? "-edits" : "") +
  (imageKind === "full" ? "-full" : "") + ".json");

const SHOWN =
{
  inline: "Two diagrams were drawn for the same request in a chat. The two images are exactly what the chat shows " +
    "the user: the frame is 800 px wide, the diagram is scaled down to fit it, and the user reads it at this size " +
    "without zooming.",
  full: "Two diagrams were drawn for the same request in a chat, where they are shown about 800 px wide and scaled " +
    "down to fit."
};

const QUESTION =
  "{shown} The request was:\n\n\"{prompt}\"\n\n" +
  "Diagram X is the first image, diagram Y the second. Which one would the user prefer? Judge, in this order: " +
  "the content (everything the request asks for, correct), the layout (related things close together, short and " +
  "straight lines, few crossings and bends, nothing overlapping, a clear reading order), readability at chat size, " +
  "and tidiness (alignment, consistent sizes and colors). Differences in naming or in the exact columns are not " +
  "a reason to prefer one unless something requested is missing or wrong.\n\n" +
  "Answer with JSON only, no other text: {\"better\": \"X\" | \"Y\" | \"tie\", \"scoreX\": 1-10, \"scoreY\": 1-10, " +
  "\"reason\": \"one sentence\"}";

function requestOf(key)
{
  const p = prompts[key];

  return edits ? p.prompt + "\" and then, about the diagram drawn for it: \"" + p.edit : p.prompt;
}

function image(f)
{
  return { type: "image", source: { type: "base64", media_type: "image/png", data: fs.readFileSync(f).toString("base64") } };
}

function ask(first, second, request)
{
  const message = { type: "user", message: { role: "user", content: [
    { type: "text", text: "Diagram X:" }, image(first),
    { type: "text", text: "Diagram Y:" }, image(second),
    { type: "text", text: QUESTION.replace("{shown}", SHOWN[imageKind]).replace("{prompt}", request) }] } };
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

function files(variant, key, repeat)
{
  const tag = runTag(variant, key, runsModel, repeat) + (edits ? "-edit" : "");
  const render = readJson(path.join(out, tag + "-render.json"));

  return { image: path.join(out, tag + "-" + imageKind + ".png"), fontSize: render ? render.fontSize : null,
    issues: render ? render.issues : null };
}

const pairs = [];

for (const key of keys)
{
  for (let r = 1; r <= 20; r++)
  {
    const fa = files(a, key, r);
    const fb = files(b, key, r);

    if (fs.existsSync(fa.image) && fs.existsSync(fb.image))
    {
      pairs.push({ key: key, repeat: r, order: "ab", first: fa, second: fb, a: fa, b: fb });
      pairs.push({ key: key, repeat: r, order: "ba", first: fb, second: fa, a: fa, b: fb });
    }
  }
}

const done = [];

await pool(pairs, parallel, async function(p)
{
  const v = await ask(p.first.image, p.second.image, requestOf(p.key));
  // back from X / Y to the variants: "a", "b" or "tie"
  const isA = function(xy) { return (p.order === "ab") === (xy === "X"); };
  const winner = v.better === "tie" ? "tie" : (v.better === "X" || v.better === "Y") ? (isA(v.better) ? "a" : "b") : null;
  const row = { key: p.key, type: prompts[p.key].type, split: prompts[p.key].split, repeat: p.repeat, order: p.order,
    winner: winner, scoreA: p.order === "ab" ? v.scoreX : v.scoreY, scoreB: p.order === "ab" ? v.scoreY : v.scoreX,
    fontA: p.a.fontSize, fontB: p.b.fontSize, issuesA: p.a.issues, issuesB: p.b.issues, reason: v.reason || v.error };
  done.push(row);
  console.log(p.key, p.repeat, p.order, "→", winner == null ? "no answer" : winner === "tie" ? "tie" : winner === "a" ? a : b,
    row.scoreA, row.scoreB, "| font", row.fontA, row.fontB, "|", row.reason);
});

// what an earlier call judged and this one didn't stays
const id = function(r) { return [r.key, r.repeat, r.order].join("|"); };
const judged = new Set(done.map(id));
const earlier = args.fresh ? null : readJson(file);
const results = ((earlier && earlier.results) || []).filter(function(r) { return !judged.has(id(r)); }).concat(done)
  .sort(function(x, y) { return id(x).localeCompare(id(y)); });

const valid = results.filter(function(r) { return r.winner != null; });
const points = valid.reduce(function(s, r) { return s + (r.winner === "b" ? 1 : r.winner === "tie" ? 0.5 : 0); }, 0);
const avg = function(k) { return valid.length ? valid.reduce(function(s, r) { return s + (r[k] || 0); }, 0) / valid.length : null; };
const summary = { a: a, b: b, judge: judgeModel, runsModel: runsModel, image: imageKind, edits: edits, judgements: valid.length,
  winsB: valid.filter(function(r) { return r.winner === "b"; }).length,
  winsA: valid.filter(function(r) { return r.winner === "a"; }).length,
  ties: valid.filter(function(r) { return r.winner === "tie"; }).length,
  shareB: valid.length ? Math.round(points / valid.length * 100) / 100 : null,
  meanScoreA: avg("scoreA"), meanScoreB: avg("scoreB"), results: results };
fs.writeFileSync(file, JSON.stringify(summary, null, 1));
console.log(done.length + " judgements (" + results.length + " in " + path.basename(file) + "):", b, "preferred in", summary.winsB,
  "of", valid.length, "(ties", summary.ties + "), share", summary.shareB,
  "mean score", a, summary.meanScoreA && summary.meanScoreA.toFixed(2), b, summary.meanScoreB && summary.meanScoreB.toFixed(2));
