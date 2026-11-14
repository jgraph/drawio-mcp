// Sums up a bench run. Writes report.md and report.json into the output
// folder:
//
// - the runs, per type and per prompt (model, variant): the median time to
//   the diagram and to the end of the answer, output and total tokens, the
//   share of runs that produced a diagram and the layout-check findings in
//   the rendering (render.mjs);
// - the edit turns (run.mjs --edits): seconds to the changed diagram, output
//   tokens, and how much of the diagram moved: of the vertices in both
//   diagrams (matched by id, else by label), the share whose position
//   changed by more than 10 px once their common shift is removed;
// - the tool choice (variants both, both-rule, switch-on): the share of runs whose
//   first diagram call was the semantic tool, and the share that fetched the
//   reference;
// - the blind judgements (judge.mjs), per variant pair and type: the share
//   of B overall, on the dev and the held-out prompts, per prompt, without
//   the pairs whose font sizes differ by 2 px or more (a preference for
//   larger text rather than for a layout), the layout-check findings of both
//   sides, and the gate.
//
// Gate: B passes for a type when its share on the held-out prompts is at
// least --threshold (0.5), every prompt's share is at least --floor (0.3)
// and the layout check finds no more in B's diagrams than in A's.
//
// usage: node report.mjs [--threshold 0.5] [--floor 0.3] [--out DIR]

import fs from "node:fs";
import path from "node:path";
import { parseArgs, outDir, median, round, readJson, loadPrompts } from "./lib/common.mjs";
import { stability } from "./lib/diagram-xml.mjs";

const args = parseArgs(process.argv.slice(2));
const out = outDir(args);
const threshold = Number(args.threshold != null ? args.threshold : 0.5);
const floor = Number(args.floor != null ? args.floor : 0.3);
const fontGap = 2;
const prompts = loadPrompts();
const files = fs.readdirSync(out);

function readText(name)
{
  const f = path.join(out, name);

  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
}

function mean(values)
{
  const v = values.filter(function(x) { return typeof x === "number" && !isNaN(x); });

  return v.length ? v.reduce(function(a, b) { return a + b; }, 0) / v.length : null;
}

function share(n, of)
{
  return of > 0 ? round(n / of, 2) : null;
}

function cell(x)
{
  return (x == null || x === "") ? "–" : x;
}

function table(md, head, rows)
{
  md.push("| " + head.join(" | ") + " |", "|" + head.map(function() { return "---"; }).join("|") + "|");

  for (const r of rows)
  {
    md.push("| " + r.map(cell).join(" | ") + " |");
  }

  md.push("");
}

// ─── Runs ────────────────────────────────────────────────────────

const runs = files.filter(function(x) { return x.endsWith("-summary.json"); }).sort().map(function(f)
{
  const s = JSON.parse(fs.readFileSync(path.join(out, f), "utf8"));
  const p = prompts[s.key] || {};
  const render = readJson(path.join(out, s.tag + "-render.json"));
  const run = { tag: s.tag, key: s.key, type: s.type || p.type, split: s.split || p.split, size: s.size || p.size,
    model: s.model, variant: s.variant, ok: s.ok, diagramSecs: s.diagramSecs, wallSecs: s.wallSecs,
    outputTokens: s.outputTokens, totalTokens: s.totalTokens, format: s.format, firstDiagramTool: s.firstDiagramTool,
    usedReference: s.usedReference, usedSearch: s.usedSearch, issues: render ? render.issues : null,
    vertices: render ? render.vertices : null, fontSize: render ? render.fontSize : null,
    engineMs: render && render.engine && render.engine.stats ? render.engine.stats.ms : null, edit: null };

  if (s.edit)
  {
    const editRender = readJson(path.join(out, s.tag + "-edit-render.json"));
    const before = readText(s.tag + "-rendered.xml");
    const after = readText(s.tag + "-edit-rendered.xml");

    run.edit = { ok: s.edit.ok, diagramSecs: s.edit.diagramSecs, endSecs: s.edit.endSecs, outputTokens: s.edit.outputTokens,
      totalTokens: s.edit.totalTokens, format: s.edit.format, usedReference: s.edit.usedReference,
      issues: editRender ? editRender.issues : null, stability: (before && after) ? stability(before, after, 10) : null };
  }

  return run;
});

function groupBy(items, keyOf)
{
  const groups = new Map();

  for (const item of items)
  {
    const k = keyOf(item);

    if (!groups.has(k))
    {
      groups.set(k, []);
    }

    groups.get(k).push(item);
  }

  return Array.from(groups.entries()).sort(function(x, y) { return x[0].localeCompare(y[0]); });
}

function runRow(list)
{
  const pick = function(k) { return list.map(function(r) { return r[k]; }); };
  const ok = list.filter(function(r) { return r.ok; });

  return { runs: list.length, diagrams: ok.length, diagramSecs: round(median(pick("diagramSecs")), 1),
    wallSecs: round(median(pick("wallSecs")), 1), outputTokens: round(median(pick("outputTokens")), 0),
    totalTokens: round(median(pick("totalTokens")), 0), issues: median(pick("issues")), issuesMean: round(mean(pick("issues")), 1),
    vertices: median(pick("vertices")), fontSize: median(pick("fontSize")), engineMs: round(median(pick("engineMs")), 0),
    reference: share(list.filter(function(r) { return r.usedReference; }).length, list.length),
    search: share(list.filter(function(r) { return r.usedSearch; }).length, list.length),
    formats: Array.from(new Set(ok.map(function(r) { return r.format; }))).sort().join(",") };
}

function editRow(list)
{
  const asked = list.filter(function(r) { return r.edit != null; });
  const e = asked.map(function(r) { return r.edit; });
  const pick = function(k) { return e.map(function(x) { return x[k]; }); };
  const st = e.map(function(x) { return x.stability; }).filter(Boolean);

  return { asked: asked.length, diagrams: e.filter(function(x) { return x.ok; }).length,
    diagramSecs: round(median(pick("diagramSecs")), 1), endSecs: round(median(pick("endSecs")), 1),
    outputTokens: round(median(pick("outputTokens")), 0), issues: median(pick("issues")),
    compared: st.length, common: median(st.map(function(s) { return s.common; })),
    moved: round(median(st.map(function(s) { return s.movedShare; })), 2),
    movedMean: round(mean(st.map(function(s) { return s.movedShare; })), 2) };
}

const byType = groupBy(runs, function(r) { return [r.type, r.model, r.variant].join("|"); }).map(function(g)
{
  const r = g[1][0];

  return Object.assign({ type: r.type, model: r.model, variant: r.variant }, runRow(g[1]));
});

const byPrompt = groupBy(runs, function(r) { return [r.type, r.key, r.model, r.variant].join("|"); }).map(function(g)
{
  const r = g[1][0];

  return Object.assign({ prompt: r.key, type: r.type, split: r.split, size: r.size, model: r.model, variant: r.variant }, runRow(g[1]));
});

const withEdits = runs.filter(function(r) { return r.edit != null; });

const editsByType = groupBy(withEdits, function(r) { return [r.type, r.model, r.variant].join("|"); }).map(function(g)
{
  const r = g[1][0];

  return Object.assign({ type: r.type, model: r.model, variant: r.variant }, editRow(g[1]));
});

const editsByPrompt = groupBy(withEdits, function(r) { return [r.type, r.key, r.model, r.variant].join("|"); }).map(function(g)
{
  const r = g[1][0];

  return Object.assign({ prompt: r.key, type: r.type, split: r.split, model: r.model, variant: r.variant }, editRow(g[1]));
});

// ─── Tool choice ─────────────────────────────────────────────────

const toolChoice = groupBy(runs.filter(function(r) { return /^both/.test(r.variant) || r.variant === "switch-on"; }),
  function(r) { return [r.variant, r.model, r.type].join("|"); }).map(function(g)
{
  const list = g[1];
  const r = list[0];
  const semantic = list.filter(function(x) { return x.firstDiagramTool === "create_semantic_diagram"; }).length;

  return { variant: r.variant, model: r.model, type: r.type, runs: list.length, semanticFirst: semantic,
    semanticShare: share(semantic, list.length),
    noDiagram: list.filter(function(x) { return x.firstDiagramTool == null; }).length,
    reference: share(list.filter(function(x) { return x.usedReference; }).length, list.length),
    search: share(list.filter(function(x) { return x.usedSearch; }).length, list.length) };
});

// ─── Judgements ──────────────────────────────────────────────────

function shareB(results)
{
  const valid = results.filter(function(r) { return r.winner != null; });
  const points = valid.reduce(function(s, r) { return s + (r.winner === "b" ? 1 : r.winner === "tie" ? 0.5 : 0); }, 0);

  return share(points, valid.length);
}

function judgedType(j, type, results)
{
  const pairId = function(r) { return r.key + "|" + r.repeat; };
  const pairs = groupBy(results, pairId).map(function(g) { return g[1][0]; });
  const confounded = new Set(pairs.filter(function(r)
  {
    return r.fontA != null && r.fontB != null && Math.abs(r.fontA - r.fontB) >= fontGap;
  }).map(pairId));
  const perPrompt = groupBy(results, function(r) { return r.key; }).map(function(g)
  {
    return { prompt: g[0], split: g[1][0].split, judgements: g[1].filter(function(r) { return r.winner != null; }).length,
      shareB: shareB(g[1]) };
  });
  const held = results.filter(function(r) { return r.split === "held-out"; });
  const below = perPrompt.filter(function(p) { return p.shareB != null && p.shareB < floor; });
  const issuesA = round(mean(pairs.map(function(r) { return r.issuesA; })), 2);
  const issuesB = round(mean(pairs.map(function(r) { return r.issuesB; })), 2);
  const heldShare = shareB(held);
  const reasons = [];

  if (heldShare == null)
  {
    reasons.push("no held-out judgements");
  }
  else if (heldShare < threshold)
  {
    reasons.push("held-out share " + heldShare + " < " + threshold);
  }

  if (below.length > 0)
  {
    reasons.push(below.map(function(p) { return p.prompt + " " + p.shareB; }).join(", ") + " below the floor of " + floor);
  }

  if (issuesA == null || issuesB == null)
  {
    reasons.push("no layout check for both sides");
  }
  else if (issuesB > issuesA)
  {
    reasons.push("layout findings " + issuesB + " > " + issuesA);
  }

  return { file: j.file, a: j.a, b: j.b, runsModel: j.runsModel, judge: j.judge, image: j.image || "full", edits: !!j.edits,
    type: type, judgements: results.filter(function(r) { return r.winner != null; }).length, pairs: pairs.length,
    shareB: shareB(results), shareDev: shareB(results.filter(function(r) { return r.split === "dev"; })),
    shareHeldOut: heldShare, minPrompt: perPrompt.length ? Math.min.apply(null, perPrompt.map(function(p) { return p.shareB == null ? 1 : p.shareB; })) : null,
    confoundedPairs: confounded.size,
    shareWithoutConfounded: shareB(results.filter(function(r) { return !confounded.has(pairId(r)); })),
    issuesA: issuesA, issuesB: issuesB, perPrompt: perPrompt,
    gate: reasons.length === 0 ? "pass" : "fail", gateReasons: reasons };
}

const judgements = [];

for (const f of files.filter(function(x) { return /^judge-.*\.json$/.test(x); }).sort())
{
  const j = JSON.parse(fs.readFileSync(path.join(out, f), "utf8"));
  j.file = f;

  for (const r of j.results)
  {
    const p = prompts[r.key] || {};
    r.type = r.type || p.type || "?";
    r.split = r.split || p.split || "dev";
    // files written before the winner was "a" / "b" name the variant
    r.winner = (r.winner === "a" || r.winner === "b" || r.winner === "tie" || r.winner == null) ? r.winner :
      (r.winner === j.b ? "b" : "a");
  }

  for (const g of groupBy(j.results, function(r) { return r.type; }))
  {
    judgements.push(judgedType(j, g[0], g[1]));
  }
}

// ─── Output ──────────────────────────────────────────────────────

const md = ["# Bench report", ""];

md.push("## Runs by type", "",
  "Medians over the runs of every prompt of a type. Diagram: seconds until the diagram tool returned; end: seconds until " +
  "the answer was complete; findings: what the viewer's layout check found in the rendering (median, mean); reference, " +
  "search: the share of runs that fetched the reference or searched shapes.", "");
table(md, ["type", "model", "variant", "runs", "diagrams", "diagram s", "end s", "output tokens", "total tokens",
  "findings", "findings (mean)", "reference", "search", "format"], byType.map(function(r)
{
  return [r.type, r.model, r.variant, r.runs, r.diagrams, r.diagramSecs, r.wallSecs, r.outputTokens, r.totalTokens, r.issues,
    r.issuesMean, r.reference, r.search, r.formats];
}));

if (editsByType.length > 0)
{
  md.push("## Edit turns", "",
    "The follow-up request in the same session, measured from the moment it was sent. Moved: of the vertices in both " +
    "diagrams, the share whose position changed by more than 10 px once the shift they all share is removed (median " +
    "and mean over the runs); common: the median number of such vertices.", "");
  table(md, ["type", "model", "variant", "edits asked", "changed diagrams", "diagram s", "end s", "output tokens", "findings",
    "compared", "common", "moved", "moved (mean)"], editsByType.map(function(r)
  {
    return [r.type, r.model, r.variant, r.asked, r.diagrams, r.diagramSecs, r.endSecs, r.outputTokens, r.issues, r.compared,
      r.common, r.moved, r.movedMean];
  }));
  table(md, ["prompt", "split", "model", "variant", "changed diagrams", "diagram s", "end s", "output tokens", "findings",
    "common", "moved"], editsByPrompt.map(function(r)
  {
    return [r.prompt, r.split, r.model, r.variant, r.diagrams + "/" + r.asked, r.diagramSecs, r.endSecs, r.outputTokens,
      r.issues, r.common, r.moved];
  }));
}

if (toolChoice.length > 0)
{
  md.push("## Tool choice", "",
    "With both tools on offer: the runs whose first diagram call was create_semantic_diagram, and the share that " +
    "fetched the reference or searched shapes.", "");
  table(md, ["variant", "model", "type", "runs", "semantic first", "share", "no diagram call", "reference", "search"],
    toolChoice.map(function(r)
  {
    return [r.variant, r.model, r.type, r.runs, r.semanticFirst, r.semanticShare, r.noDiagram, r.reference, r.search];
  }));
}

if (judgements.length > 0)
{
  md.push("## Blind judgements", "",
    "Each pair of images from one prompt and repeat, shown in both orders; share: the points of B (a tie counts half). " +
    "Style: the pairs whose median font sizes differ by " + fontGap + " px or more, and the share without them. Findings: " +
    "the mean number of layout-check findings per diagram. Gate: held-out share ≥ " + threshold + ", every prompt ≥ " +
    floor + ", findings of B not above A's.", "");
  table(md, ["A", "B", "diagrams by", "judge", "image", "turn", "type", "judgements", "share B", "dev", "held-out",
    "lowest prompt", "style pairs", "share without", "findings A", "findings B", "gate"], judgements.map(function(j)
  {
    return [j.a, j.b, j.runsModel, j.judge, j.image, j.edits ? "edit" : "first", j.type, j.judgements, j.shareB, j.shareDev,
      j.shareHeldOut, j.minPrompt, j.confoundedPairs + "/" + j.pairs, j.shareWithoutConfounded, j.issuesA, j.issuesB, j.gate];
  }));

  for (const j of judgements)
  {
    md.push("- " + j.b + " against " + j.a + ", " + j.type + (j.edits ? " (edit turn)" : "") + ", diagrams by " + j.runsModel +
      " — gate: " + j.gate + (j.gateReasons.length ? " (" + j.gateReasons.join("; ") + ")" : "") + ". Per prompt: " +
      j.perPrompt.map(function(p) { return p.prompt + (p.split === "held-out" ? "*" : "") + " " + cell(p.shareB); }).join(", ") +
      " (* held out).");
  }

  md.push("");
}

md.push("## Runs by prompt", "");
table(md, ["prompt", "type", "split", "size", "model", "variant", "runs", "diagrams", "diagram s", "end s", "output tokens",
  "total tokens", "findings", "vertices", "font px", "engine ms", "format"], byPrompt.map(function(r)
{
  return [r.prompt, r.type, r.split, r.size, r.model, r.variant, r.runs, r.diagrams, r.diagramSecs, r.wallSecs, r.outputTokens,
    r.totalTokens, r.issues, r.vertices, r.fontSize, r.engineMs, r.formats];
}));

fs.writeFileSync(path.join(out, "report.md"), md.join("\n"));
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ threshold: threshold, floor: floor, byType: byType,
  byPrompt: byPrompt, editsByType: editsByType, editsByPrompt: editsByPrompt, toolChoice: toolChoice,
  judgements: judgements }, null, 1));
console.log(md.join("\n"));
