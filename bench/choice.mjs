// The tool choice on request: which way the first diagram call of every
// session went (run.mjs --choice-only, or a whole session), per variant,
// model and prompt of a set, and the rule declared before the runs
// (README.md, **The tool choice on request**):
//
// - R1, no fast path without the wish: on the prompts without the wish, at
//   least 95 % of the sessions take the normal path (create_diagram's xml or
//   mermaid);
// - R2, the fast path with the wish: on the prompts with the wish whose type
//   the fast path draws (`covered`), at least 90 % take the fast path (a
//   description: create_semantic_diagram, or create_diagram's quick);
// - R3, the wish on another type: on the prompts with the wish whose type it
//   doesn't draw, at least 90 % take the normal path;
//
// each for every model. A session without a diagram call counts against the
// variant in all three. A variant passes when all three hold for every model;
// of those that pass, the one with more correct sessions wins, and a tie goes
// to the tool of its own (create_diagram stays as it is).
//
// Writes choice.md and choice.json to the output directory.
//
// usage: node choice.mjs --variants fast-tool,fast-param [--set fast-2026-11-15]
//          [--models sonnet,opus] [--out DIR]

import fs from "node:fs";
import path from "node:path";
import { parseArgs, outDir, loadPrompts, readJson } from "./lib/common.mjs";

const args = parseArgs(process.argv.slice(2));
const out = outDir(args);
const prompts = loadPrompts();
const variants = String(args.variants || "fast-tool,fast-param").split(",");
const set = args.set || "fast-2026-11-15";
const models = String(args.models || "sonnet,opus").split(",");
const RULES =
{
  R1: { label: "no fast path without the wish", wish: false, covered: null, want: "normal", min: 0.95 },
  R2: { label: "fast path with the wish", wish: true, covered: true, want: "fast", min: 0.9 },
  R3: { label: "the wish on a type the fast path doesn't draw", wish: true, covered: false, want: "normal", min: 0.9 }
};
// the order of the tie-break: the tool of its own first
const PREFERENCE = ["fast-tool", "fast-param"];

const keys = Object.keys(prompts).filter(function(k) { return prompts[k].set === set; });
const summaries = fs.readdirSync(out).filter(function(f) { return f.endsWith("-summary.json"); })
  .map(function(f) { return readJson(path.join(out, f)); })
  .filter(function(s) { return s != null && variants.includes(s.variant) && keys.includes(s.key) && models.includes(s.model); });

// "fast", "normal" or null (no diagram call)
function way(s)
{
  const p = s.firstDiagramPath;

  return p === "fast" ? "fast" : (p === "xml" || p === "mermaid") ? "normal" : null;
}

function ruleOf(key)
{
  const p = prompts[key];

  for (const name of Object.keys(RULES))
  {
    const r = RULES[name];

    if (!!p.wish === r.wish && (r.covered == null || !!p.covered === r.covered))
    {
      return name;
    }
  }

  return null;
}

const result = { set: set, variants: {}, chosen: null };
const md = ["# The tool choice on request", "", "Set `" + set + "`, " + summaries.length + " sessions. The way of the first " +
  "diagram call: fast (a description) or normal (create_diagram's xml or mermaid).", ""];

for (const v of variants)
{
  const rv = { models: {}, correct: 0, sessions: 0, passes: true };
  result.variants[v] = rv;

  for (const m of models)
  {
    const rm = {};
    rv.models[m] = rm;

    for (const name of Object.keys(RULES))
    {
      const r = RULES[name];
      const ss = summaries.filter(function(s) { return s.variant === v && s.model === m && ruleOf(s.key) === name; });
      const ok = ss.filter(function(s) { return way(s) === r.want; }).length;
      const share = ss.length > 0 ? ok / ss.length : null;
      const pass = share != null && share >= r.min;

      rm[name] = { sessions: ss.length, correct: ok, share: share, pass: pass,
        misses: ss.filter(function(s) { return way(s) !== r.want; }).map(function(s) { return s.tag + " (" + (s.firstDiagramPath || "none") + ")"; }) };
      rv.correct += ok;
      rv.sessions += ss.length;
      rv.passes = rv.passes && pass;
    }
  }
}

const passing = variants.filter(function(v) { return result.variants[v].passes; });

passing.sort(function(a, b)
{
  return (result.variants[b].correct - result.variants[a].correct) ||
    ((PREFERENCE.indexOf(a) < 0 ? 99 : PREFERENCE.indexOf(a)) - (PREFERENCE.indexOf(b) < 0 ? 99 : PREFERENCE.indexOf(b)));
});
result.chosen = passing.length > 0 ? passing[0] : null;

const pct = function(x) { return x == null ? "–" : Math.round(x * 1000) / 10 + " %"; };
const head = ["Rule (minimum)"];

for (const v of variants)
{
  for (const m of models)
  {
    head.push(v + ", " + m);
  }
}

md.push("| " + head.join(" | ") + " |", "|" + head.map(function() { return "---"; }).join("|") + "|");

for (const name of Object.keys(RULES))
{
  const row = [name + ": " + RULES[name].label + " (" + pct(RULES[name].min) + ")"];

  for (const v of variants)
  {
    for (const m of models)
    {
      const c = result.variants[v].models[m][name];
      row.push(c.correct + " of " + c.sessions + ", " + pct(c.share) + (c.pass ? "" : " **fail**"));
    }
  }

  md.push("| " + row.join(" | ") + " |");
}

md.push("", "| Variant | Correct sessions | Passes |", "|---|---|---|");

for (const v of variants)
{
  const rv = result.variants[v];
  md.push("| " + v + " | " + rv.correct + " of " + rv.sessions + " | " + (rv.passes ? "yes" : "no") + " |");
}

md.push("", "Chosen: " + (result.chosen || "none (no variant passes)"), "", "## Per prompt", "",
  "| Prompt | Rule | " + variants.map(function(v) { return models.map(function(m) { return v + ", " + m; }).join(" | "); }).join(" | ") + " |",
  "|---|---|" + variants.map(function() { return models.map(function() { return "---"; }).join("|"); }).join("|") + "|");

for (const k of keys)
{
  const row = [k, ruleOf(k)];

  for (const v of variants)
  {
    for (const m of models)
    {
      const ss = summaries.filter(function(s) { return s.variant === v && s.model === m && s.key === k; })
        .sort(function(a, b) { return a.repeat - b.repeat; });
      row.push(ss.map(function(s) { return way(s) || "none"; }).join(", ") || "–");
    }
  }

  md.push("| " + row.join(" | ") + " |");
}

md.push("", "## Misses", "");

for (const v of variants)
{
  for (const m of models)
  {
    for (const name of Object.keys(RULES))
    {
      for (const miss of result.variants[v].models[m][name].misses)
      {
        md.push("- " + name + ": " + miss);
      }
    }
  }
}

fs.writeFileSync(path.join(out, "choice.md"), md.join("\n") + "\n");
fs.writeFileSync(path.join(out, "choice.json"), JSON.stringify(result, null, 1));
console.log(md.join("\n"));
