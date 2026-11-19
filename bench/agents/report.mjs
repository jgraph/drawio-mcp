// The tables of the cross-agent measurement, from the sessions of run.mjs,
// the renders of render.mjs and the judgements of judge.mjs: report.md and
// results.json in the output folder (results.json is the summary kept in the
// repository, without any session's text).
//
// - formats: what each agent produced on its own (plain);
// - help: plain, the hosted MCP server and the plugin side by side;
// - formats: Mermaid, SVG, draw.io XML and the fast mode on the same
//   requests, once over all prompts and once over the flowchart and
//   swimlane prompts, the ones the fast mode draws.
//
// usage: node agents/report.mjs [--out DIR]

import fs from "node:fs";
import path from "node:path";
import { parseArgs, outDir, readJson, median, round } from "../lib/common.mjs";
import { AGENTS } from "./lib/sessions.mjs";
import { CONDITIONS, SETS } from "./lib/conditions.mjs";
import { FORMAT_NAMES } from "./lib/artifacts.mjs";

const args = parseArgs(process.argv.slice(2));
const out = outDir(args);
const runs = path.join(out, "runs");
const renders = path.join(out, "render");

const rows = fs.readdirSync(runs).filter(function(f) { return f.endsWith("-summary.json"); }).map(function(f)
{
  const s = readJson(path.join(runs, f));
  const r = readJson(path.join(renders, s.tag + "-render.json")) || {};

  return Object.assign({}, s, { render: r });
});

const judgements = {};

for (const set of Object.keys(SETS))
{
  const j = readJson(path.join(out, "judge-" + set + ".json"));
  judgements[set] = j ? j.judgements : [];
}

const agentsSeen = Object.keys(AGENTS).filter(function(a) { return rows.some(function(r) { return r.agent === a; }); });

function sessions(agent, condition, filter)
{
  return rows.filter(function(r)
  {
    return r.agent === agent && r.condition === condition && (filter == null || filter(r));
  });
}

function share(list, test)
{
  return list.length ? round(list.filter(test).length / list.length, 2) : null;
}

function sumShare(list, num, den)
{
  let a = 0;
  let b = 0;

  for (const r of list)
  {
    const e = r.render.editable;

    if (e != null && e[den] > 0)
    {
      a += e[num];
      b += e[den];
    }
  }

  return b > 0 ? round(a / b, 2) : null;
}

function mean(values)
{
  const v = values.filter(function(x) { return typeof x === "number" && !isNaN(x); });

  return v.length ? round(v.reduce(function(a, b) { return a + b; }, 0) / v.length, 2) : null;
}

const isDrawio = function(r) { return /^drawio/.test(r.render.primary ? r.render.primary.kind : ""); };
const valid = function(r) { return r.render.parse === true && r.render.renders === true; };

// The judge's numbers for a condition of a set: the mean overall score (a
// condition without an image counts as 1, the rubric's "no diagram"), the
// share of judgements that ranked it first, and the mean of the other
// rubric scores, over the judgements of the agent's sets that had it in
// their conditions.
function judged(set, agent, condition, filter)
{
  const list = judgements[set].filter(function(j)
  {
    return j.agent === agent && (filter == null || filter(j)) &&
      (condition !== "fast" || CONDITIONS.fast.types.includes(j.type));
  });
  const overall = [];
  const first = [];
  const parts = { content: [], layout: [], readability: [] };

  for (const j of list)
  {
    const s = j.scores[condition];
    overall.push(s ? s.overall : 1);
    first.push(j.rank[condition] === 1 ? 1 : 0);

    for (const k of Object.keys(parts))
    {
      parts[k].push(s ? s[k] : 1);
    }
  }

  return { judgements: list.length, overall: mean(overall), first: mean(first), content: mean(parts.content),
    layout: mean(parts.layout), readability: mean(parts.readability) };
}

function formatCounts(list)
{
  const counts = {};

  for (const r of list)
  {
    const k = r.render.primary ? r.render.primary.kind : "none";
    counts[k] = (counts[k] || 0) + 1;
  }

  return counts;
}

function line(r, condition, set, filter)
{
  const list = sessions(r, condition, filter);
  const ok = list.filter(valid);

  return {
    agent: r, condition: condition, sessions: list.length,
    diagrams: list.filter(function(x) { return x.render.primary && x.render.primary.kind !== "none"; }).length,
    formats: formatCounts(list),
    drawio: share(list, isDrawio),
    toolUsed: share(list, function(x) { return x.diagramCalls > 0; }),
    skillUsed: share(list, function(x) { return x.skillUsed; }),
    diagramSecs: round(median(list.map(function(x) { return x.render.diagramSecs; })), 1),
    wallSecs: round(median(list.map(function(x) { return x.wallSecs; })), 1),
    outputTokens: round(median(list.map(function(x) { return x.outputTokens; })), 0),
    diagramChars: round(median(list.map(function(x) { return x.render.diagramChars; })), 0),
    timeouts: list.filter(function(x) { return x.timedOut; }).length,
    parses: share(list, function(x) { return x.render.parse === true; }),
    renders: share(list, function(x) { return x.render.renders === true; }),
    valid: share(list, valid),
    labelsInShapes: sumShare(ok, "labelsInShapes", "labels"),
    attached: sumShare(ok, "attached", "connectors"),
    positions: ok.length ? share(ok, function(x) { return x.render.editable && x.render.editable.positions; }) : null,
    findings: mean(ok.map(function(x) { return x.render.geometry ? x.render.geometry.findings : null; })),
    viewerIssues: mean(ok.map(function(x) { return x.render.viewerIssues; })),
    judge: set ? judged(set, r, condition, filter == null ? null : function(j) { return filter({ type: j.type }); }) : null
  };
}

const lanesOrFlow = function(r) { return CONDITIONS.fast.types.includes(r.type); };
const result =
{
  generated: new Date().toISOString(),
  sessions: rows.length,
  dates: Array.from(new Set(rows.map(function(r) { return (r.started || "").slice(0, 10); }))).sort(),
  agents: agentsSeen.map(function(a)
  {
    const any = rows.find(function(r) { return r.agent === a && r.model; });
    const v = rows.find(function(r) { return r.agent === a && r.version; });

    return { agent: a, label: AGENTS[a].label, model: any ? any.model : AGENTS[a].model, effort: AGENTS[a].effort,
      version: v ? v.version : null };
  }),
  plain: agentsSeen.map(function(a) { return line(a, "plain", null); }),
  plainByType: agentsSeen.map(function(a)
  {
    const by = {};

    for (const r of sessions(a, "plain"))
    {
      by[r.type] = by[r.type] || {};
      const k = r.render.primary ? r.render.primary.kind : "none";
      by[r.type][k] = (by[r.type][k] || 0) + 1;
    }

    return { agent: a, byType: by };
  }),
  help: [],
  formats: [],
  formatsFlow: []
};

for (const a of agentsSeen)
{
  for (const c of SETS.help)
  {
    result.help.push(line(a, c, "help"));
  }

  for (const c of SETS.formats.concat(["mcp"]))
  {
    if (c !== "fast")
    {
      result.formats.push(line(a, c, c === "mcp" ? null : "formats"));
    }

    result.formatsFlow.push(line(a, c, c === "mcp" ? null : "formats", lanesOrFlow));
  }
}

// --- report.md -------------------------------------------------------------

function fmt(x, suffix)
{
  return x == null ? "–" : String(x) + (suffix || "");
}

function pct(x)
{
  return x == null ? "–" : Math.round(x * 100) + " %";
}

function counts(c)
{
  return Object.keys(c).sort(function(a, b) { return c[b] - c[a]; }).map(function(k)
  {
    return (FORMAT_NAMES[k] || k) + " " + c[k];
  }).join(", ");
}

function label(a)
{
  const x = result.agents.find(function(y) { return y.agent === a; });

  return x.label + (x.agent === "codex" ? " (" + x.model + ")" : "");
}

const md = [];
md.push("# Cross-agent measurement: tables", "");
md.push(result.sessions + " sessions, " + result.dates.join(", ") + ". " + result.agents.map(function(a)
{
  return a.label + ": " + a.model + (a.effort ? " (effort " + a.effort + ")" : "") + (a.version ? ", CLI " + a.version : "");
}).join("; ") + ".", "");

md.push("## On their own", "");
md.push("| Agent | Sessions | The diagram was | draw.io | Valid | Seconds (median) | Output tokens (median) |", "|---|---|---|---|---|---|---|");

for (const l of result.plain)
{
  md.push("| " + [label(l.agent), l.sessions, counts(l.formats), pct(l.drawio), pct(l.valid), fmt(l.diagramSecs), fmt(l.outputTokens)].join(" | ") + " |");
}

md.push("", "| Agent | " + Object.keys(loadTypes()).join(" | ") + " |", "|---|" + Object.keys(loadTypes()).map(function() { return "---"; }).join("|") + "|");

for (const p of result.plainByType)
{
  md.push("| " + label(p.agent) + " | " + Object.keys(loadTypes()).map(function(t) { return counts(p.byType[t] || {}); }).join(" | ") + " |");
}

function loadTypes()
{
  const t = {};

  for (const r of rows)
  {
    t[r.type] = true;
  }

  return t;
}

const helpHead = "| Agent | Condition | Sessions | Diagram in draw.io | Seconds to the diagram | Seconds to the end | Output tokens | Valid | Connectors attached | Layout findings | Judge: overall (1–5) | Judge: ranked first |";
md.push("", "## With draw.io", "", helpHead, "|---|---|---|---|---|---|---|---|---|---|---|---|");

for (const l of result.help)
{
  md.push("| " + [label(l.agent), CONDITIONS[l.condition].label, l.sessions, pct(l.drawio), fmt(l.diagramSecs), fmt(l.wallSecs),
    fmt(l.outputTokens), pct(l.valid), pct(l.attached), fmt(l.findings), fmt(l.judge.overall), pct(l.judge.first)].join(" | ") + " |");
}

function formatTable(title, list)
{
  md.push("", "## " + title, "", "| Agent | Format | Sessions | Output tokens | Diagram characters | Seconds to the diagram | Parses | Renders | " +
    "Labels in their shape | Connectors attached | Moves keep lines | Layout findings | Viewer check | Judge: overall | Judge: ranked first |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");

  for (const l of list)
  {
    md.push("| " + [label(l.agent), CONDITIONS[l.condition].label, l.sessions, fmt(l.outputTokens), fmt(l.diagramChars), fmt(l.diagramSecs),
      pct(l.parses), pct(l.renders), pct(l.labelsInShapes), pct(l.attached), l.positions == null ? "–" : (l.positions >= 0.5 && l.attached > 0.5 ? "yes" : "no"),
      fmt(l.findings), fmt(l.viewerIssues), l.judge ? fmt(l.judge.overall) : "–", l.judge ? pct(l.judge.first) : "–"].join(" | ") + " |");
  }
}

formatTable("Formats, all prompts", result.formats);
formatTable("Formats, flowcharts and swimlanes", result.formatsFlow);

fs.writeFileSync(path.join(out, "report.md"), md.join("\n") + "\n");
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(result, null, 1));
console.log(md.join("\n"));
