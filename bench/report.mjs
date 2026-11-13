// Sums up a bench run: per prompt, model and variant the median time to the
// diagram and to the end of the answer, output and total tokens, the share
// of runs that produced a diagram and the layout-check issues found when it
// was rendered (render.mjs), followed by the blind judgements (judge.mjs).
// Writes report.md and report.json into the output folder.
//
// usage: node report.mjs [--out DIR]

import fs from "node:fs";
import path from "node:path";
import { parseArgs, outDir, median } from "./lib/common.mjs";

const args = parseArgs(process.argv.slice(2));
const out = outDir(args);
const files = fs.readdirSync(out);
const groups = new Map();

for (const f of files.filter(function(x) { return x.endsWith("-summary.json"); }).sort())
{
  const s = JSON.parse(fs.readFileSync(path.join(out, f), "utf8"));
  const key = [s.key, s.model, s.variant].join("|");
  const renderFile = path.join(out, s.tag + "-render.json");
  const render = fs.existsSync(renderFile) ? JSON.parse(fs.readFileSync(renderFile, "utf8")) : null;

  if (!groups.has(key))
  {
    groups.set(key, { key: s.key, model: s.model, variant: s.variant, runs: [] });
  }

  groups.get(key).runs.push({ ok: s.ok, diagramSecs: s.diagramSecs, wallSecs: s.wallSecs, outputTokens: s.outputTokens,
    totalTokens: s.totalTokens, format: s.format, issues: render ? render.issues : null,
    engineMs: render && render.engine && render.engine.stats ? render.engine.stats.ms : null });
}

function round(x, d)
{
  return x == null ? null : Math.round(x * Math.pow(10, d)) / Math.pow(10, d);
}

const rows = [];

for (const g of groups.values())
{
  const pick = function(k) { return g.runs.map(function(r) { return r[k]; }); };
  const ok = g.runs.filter(function(r) { return r.ok; });

  rows.push({ prompt: g.key, model: g.model, variant: g.variant, runs: g.runs.length, diagrams: ok.length,
    diagramSecs: round(median(pick("diagramSecs")), 1), wallSecs: round(median(pick("wallSecs")), 1),
    outputTokens: median(pick("outputTokens")), totalTokens: median(pick("totalTokens")),
    issues: median(pick("issues")), engineMs: round(median(pick("engineMs")), 0),
    formats: Array.from(new Set(ok.map(function(r) { return r.format; }))).join(",") });
}

rows.sort(function(a, b)
{
  return (a.prompt + a.model + a.variant).localeCompare(b.prompt + b.model + b.variant);
});

const judgements = files.filter(function(x) { return /^judge-.*\.json$/.test(x); }).sort().map(function(f)
{
  const j = JSON.parse(fs.readFileSync(path.join(out, f), "utf8"));
  const byPrompt = {};

  for (const r of j.results)
  {
    const p = byPrompt[r.key] || (byPrompt[r.key] = { a: 0, b: 0, tie: 0 });
    p[r.winner === j.a ? "a" : r.winner === j.b ? "b" : "tie"]++;
  }

  return { file: f, a: j.a, b: j.b, judge: j.judge, runsModel: j.runsModel, judgements: j.judgements, winsA: j.winsA, winsB: j.winsB, ties: j.ties,
    shareB: j.shareB, meanScoreA: round(j.meanScoreA, 2), meanScoreB: round(j.meanScoreB, 2), byPrompt: byPrompt };
});

const md = ["# Bench report", "",
  "Medians per prompt, model and variant. Diagram: seconds until the diagram tool returned; end: seconds until the " +
  "answer was complete; issues: what the viewer's layout check found in the rendering.", "",
  "| prompt | model | variant | runs | diagrams | diagram s | end s | output tokens | total tokens | issues | engine ms | format |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|"];

for (const r of rows)
{
  md.push("| " + [r.prompt, r.model, r.variant, r.runs, r.diagrams, r.diagramSecs, r.wallSecs, r.outputTokens, r.totalTokens,
    r.issues, r.engineMs, r.formats].map(function(x) { return x == null ? "–" : x; }).join(" | ") + " |");
}

if (judgements.length > 0)
{
  md.push("", "## Blind judgements", "",
    "Each pair of images from one prompt and repeat, shown in both orders; share: the points of B (a tie counts half).", "",
    "| A | B | diagrams by | judge | judgements | A wins | B wins | ties | share B | score A | score B | by prompt (A/B/tie) |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|");

  for (const j of judgements)
  {
    const per = Object.keys(j.byPrompt).sort().map(function(k)
    {
      const p = j.byPrompt[k];
      return k + " " + p.a + "/" + p.b + "/" + p.tie;
    }).join(", ");
    md.push("| " + [j.a, j.b, j.runsModel, j.judge, j.judgements, j.winsA, j.winsB, j.ties, j.shareB, j.meanScoreA, j.meanScoreB, per]
      .join(" | ") + " |");
  }
}

fs.writeFileSync(path.join(out, "report.md"), md.join("\n") + "\n");
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ rows: rows, judgements: judgements }, null, 1));
console.log(md.join("\n"));
