// Architecture, network, flowchart and swimlane diagrams: a thin layer in
// front of the grid layout pass (shared/grid-layout.js).
//
// The description becomes the compact XML a model could write itself: one
// cell per node, group and edge, shapes by role (`role=step`), icons by name
// (`icon=aws lambda`), placement hints as style keys (`row=2;col=1`), lanes
// marked `lane=1`, and no geometry at all. The same passes as in the XML
// path then turn it into a diagram: the shorthand expansion
// (shared/diagram-shorthand.js), the icon resolver (shared/icon-resolver.js)
// and the grid layout, which places every cell and routes the edges. So what
// a layout learns here, compact XML without positions gets too.

import { expandDiagramShorthand } from "../diagram-shorthand.js";
import { createIconResolver } from "../icon-resolver.js";
import { ICON_TABLE, ICON_DATA } from "../icon-table.js";
import { gridLayoutDiagram } from "../grid-layout.js";
import { normalizeDiagram } from "../normalize-model.js";
import { escapeXml, htmlLabel, IdPool } from "./xml-writer.js";
import { EDGE, YES_COLOR, NO_COLOR, ROLES, fontSizes } from "./theme.js";
import { textWidth } from "./text-width.js";

let iconResolver = null;

function icons()
{
  if (iconResolver == null)
  {
    iconResolver = createIconResolver(ICON_TABLE, ICON_DATA);
  }

  return iconResolver;
}

// ─── Kinds ───────────────────────────────────────────────────────

// What a node is, by the words models use for it → the role that draws it.
const FLOW_KINDS =
{
  start: "start", begin: "start", trigger: "start", event: "start",
  end: "end", stop: "end", terminal: "end", done: "end", finish: "end", success: "end",
  step: "step", task: "step", action: "step", process: "step", activity: "step", subprocess: "step",
  decision: "decision", condition: "decision", choice: "decision", gateway: "decision", question: "decision",
  error: "error", failure: "error", fail: "error", cancel: "error", cancelled: "error", reject: "error",
  rejected: "error", abort: "error",
  data: "data", database: "data", storage: "data", store: "data", document: "data",
  external: "external", system: "external",
  retry: "retry", wait: "retry", delay: "retry", timer: "retry",
  io: "step", input: "step", output: "step", note: "note"
};

const ARCHITECTURE_KINDS =
{
  service: "step", app: "step", application: "step", component: "step", api: "step", function: "step",
  server: "step", container: "step", worker: "step", gateway: "step", device: "step", host: "step",
  database: "data", db: "data", storage: "data", store: "data", cache: "data", data: "data", bucket: "data",
  disk: "data", warehouse: "data", index: "data",
  queue: "queue", topic: "queue", bus: "queue", stream: "queue", broker: "queue", events: "queue",
  user: "actor", users: "actor", actor: "actor", person: "actor", people: "actor", customer: "actor",
  external: "external", client: "external", thirdparty: "external", "third-party": "external", saas: "external",
  internet: "external", browser: "external", mobile: "external"
};

// Roles the shorthand doesn't know: the same box as a step in other colors.
function roleKeys(role)
{
  if (role === "retry" || role === "note" || role === "queue")
  {
    const colors = (role === "note") ? ROLES.note : ROLES.retry;

    return "role=step;fillColor=" + colors.fill + ";strokeColor=" + colors.stroke + ";";
  }

  if (role === "success")
  {
    return "role=end;";
  }

  return "role=" + role + ";";
}

const ACTOR_STYLE = "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;" +
  "fillColor=" + ROLES.external.fill + ";strokeColor=#5A626E;fontColor=#1B1F24;";

const PEOPLE = /\b(users?|customers?|admins?|administrators?|people|person|staff|employees?|visitors?|clients?|operators?|developers?|engineers?|teams?|shoppers?|members?|agents?|analysts?|managers?|actors?|guests?|buyers?|sellers?|drivers?|students?|patients?)\b/i;

// Lanes take light tints in turn, so that neighbours differ.
const LANE_TINTS = ["#F7F8FA", "#F4F8FF", "#F6FBF7", "#FFFBF2", "#F9F6FF", "#FFF7F5"];

// ─── Labels ──────────────────────────────────────────────────────

// Breaks a label that is wider than `max` px into lines of about equal
// length (at most three), at its spaces.
function wrapLabel(text, fontSize, max)
{
  const words = String(text).split(/\s+/).filter(function(w) { return w !== ""; });
  const total = textWidth(words.join(" "), fontSize, false);

  if (total <= max || words.length < 2)
  {
    return [words.join(" ")];
  }

  const count = Math.min(3, Math.ceil(total / max), words.length);
  const target = total / count;
  const lines = [];
  let line = "";

  for (const w of words)
  {
    const next = (line === "") ? w : line + " " + w;

    if (line !== "" && lines.length < count - 1 && textWidth(next, fontSize, false) > target + textWidth(w, fontSize, false) / 2)
    {
      lines.push(line);
      line = w;
    }
    else
    {
      line = next;
    }
  }

  lines.push(line);

  return lines;
}

function labelValue(label, sub, fontSize, wrapAt)
{
  const lines = (wrapAt != null) ? wrapLabel(label, fontSize, wrapAt) : [label];
  let value = lines.map(htmlLabel).join("<br>");

  if (sub !== "")
  {
    value += "<br><small>" + htmlLabel(sub) + "</small>";
  }

  return value;
}

function isYes(label)
{
  return /^(yes|y|true|ok|approved|success|valid|pass(ed)?)$/i.test(label.trim());
}

function isNo(label)
{
  return /^(no|n|false|rejected|fail(ed|ure)?|invalid|declined|denied)$/i.test(label.trim());
}

// ─── Cells ───────────────────────────────────────────────────────

function hintKeys(item)
{
  return (item.row != null ? "row=" + item.row + ";" : "") + (item.col != null ? "col=" + item.col + ";" : "");
}

function cellXml(c)
{
  const head = '<mxCell id="' + escapeXml(c.id) + '"' +
    (c.value != null && c.value !== "" ? ' value="' + escapeXml(c.value) + '"' : "") +
    ' style="' + escapeXml(c.style) + '"';

  if (c.edge)
  {
    return head + ' edge="1" parent="' + escapeXml(c.parent || "1") + '" source="' + escapeXml(c.source) +
      '" target="' + escapeXml(c.target) + '"/>';
  }

  return head + ' vertex="1" parent="' + escapeXml(c.parent || "1") + '"/>';
}

/**
 * The description as compact XML without geometry.
 *
 * @param {object} d - the normalized description (spec.js)
 * @param {{flow: boolean, links: boolean}} kind - flow: a flowchart
 *   (kinds are steps and decisions, groups are lanes); links: a network
 *   (lines without arrows)
 * @returns {{xml: string, warnings: string[], shapes: number}}
 */
export function compactXml(d, kind)
{
  const warnings = [];
  const ids = new IdPool();
  const idOf = new Map();
  const shapes = d.nodes.length + d.groups.length;
  const font = fontSizes(shapes);
  const cells = [];

  // Groups, parents first; a group that names itself as an ancestor goes to
  // the top level.
  const groupById = new Map(d.groups.map(function(g) { return [g.id, g]; }));
  const used = new Set(d.nodes.map(function(n) { return n.group; }).concat(d.groups.map(function(g) { return g.parent; })));
  const ordered = [];
  const placed = new Set();

  function place(g, trail)
  {
    if (placed.has(g.id))
    {
      return;
    }

    if (g.parent !== "" && trail.indexOf(g.parent) >= 0)
    {
      warnings.push("The group \"" + g.id + "\" is inside itself; drawn at the top level.");
      g.parent = "";
    }

    if (g.parent !== "")
    {
      place(groupById.get(g.parent), trail.concat(g.id));
    }

    placed.add(g.id);
    ordered.push(g);
  }

  d.groups.forEach(function(g) { place(g, []); });

  const lanes = ordered.filter(function(g)
  {
    return kind.flow && g.parent === "" && used.has(g.id) && (g.kind === "lane" || g.kind === "" || g.kind === "swimlane");
  });
  let laneIndex = 0;

  for (const g of ordered)
  {
    if (!used.has(g.id))
    {
      warnings.push("The group \"" + g.id + "\" has no members and is not drawn.");
      continue;
    }

    const id = ids.take(g.id);
    let style;

    idOf.set(g.id, id);

    if (lanes.indexOf(g) >= 0)
    {
      style = "role=container;lane=1;fillColor=" + LANE_TINTS[laneIndex++ % LANE_TINTS.length] + ";fontStyle=1;";
    }
    else if (g.icon !== "" && icons().resolve(g.icon, { container: true }) != null)
    {
      style = "icon=" + g.icon.replace(/[;=]/g, " ") + ";";
    }
    else
    {
      if (g.icon !== "")
      {
        warnings.push("No group icon \"" + g.icon + "\"; \"" + g.id + "\" is drawn as a plain frame.");
      }

      style = "role=container;fontStyle=1;";
    }

    cells.push({ id: id, value: htmlLabel(g.label), parent: g.parent !== "" ? idOf.get(g.parent) : "1",
      style: style + "fontSize=" + font.shape + ";" + hintKeys(g) });
  }

  for (const n of d.nodes)
  {
    const id = ids.take(n.id);
    const parent = (n.group !== "" && idOf.has(n.group)) ? idOf.get(n.group) : "1";
    let style = null;
    let wrapAt = null;

    idOf.set(n.id, id);

    if (n.icon !== "")
    {
      if (icons().resolve(n.icon) != null)
      {
        style = "icon=" + n.icon.replace(/[;=]/g, " ") + ";";
        wrapAt = 120;
      }
      else
      {
        warnings.push("No icon \"" + n.icon + "\"; \"" + n.id + "\" is drawn as a box. Icon names are " +
          "\"<aws|azure|gcp|kubernetes> <service>\".");
      }
    }

    if (style == null)
    {
      const kinds = kind.flow ? FLOW_KINDS : ARCHITECTURE_KINDS;
      const role = ROLES[n.role] != null ? n.role : (kinds[n.kind] || kinds[n.kind.replace(/s$/, "")] || "step");

      if (role === "actor" && !PEOPLE.test(n.label))
      {
        // "user" for a desktop PC or a phone: a device, not a person
        style = roleKeys("external");
      }
      else if (role === "actor")
      {
        style = ACTOR_STYLE;
        wrapAt = 120;
      }
      else
      {
        style = roleKeys(role);
      }
    }

    cells.push({ id: id, value: labelValue(n.label, n.sub, font.shape, wrapAt), parent: parent,
      style: style + "fontSize=" + font.shape + ";" + hintKeys(n) });
  }

  const edgeStyle = "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=" + EDGE.stroke + ";fontColor=" +
    EDGE.font + ";fontSize=" + font.edge + ";";

  d.edges.forEach(function(e)
  {
    let style = edgeStyle;

    if (/^(async|event|events|message|dashed|optional|wireless|publish|subscribe)$/.test(e.kind))
    {
      style += "dashed=1;";
    }

    if (kind.links || /^(network|link|cable|wired|wireless|line|bidirectional|both)$/.test(e.kind))
    {
      style += "endArrow=none;";
    }

    if (kind.flow && e.label !== "" && (isYes(e.label) || isNo(e.label)))
    {
      style += "fontColor=" + (isYes(e.label) ? YES_COLOR : NO_COLOR) + ";";
    }

    cells.push({ id: ids.take(e.from + "-" + e.to), value: htmlLabel(e.label), style: style, edge: true, parent: "1",
      source: idOf.get(e.from), target: idOf.get(e.to) });
  });

  // An edge to a group that isn't drawn has no end.
  const drawn = cells.filter(function(c) { return !c.edge || (c.source != null && c.target != null); });
  const lines = ['<mxGraphModel adaptiveColors="auto">', "<root>", '<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];

  if (d.title !== "")
  {
    lines.push(cellXml({ id: ids.take("title"), value: htmlLabel(d.title), parent: "1",
      style: "text;html=1;align=left;verticalAlign=middle;fontSize=" + font.title + ";fontStyle=1;fontColor=#1B1F24;" }));
  }

  for (const c of drawn)
  {
    lines.push(cellXml(c));
  }

  lines.push("</root>", "</mxGraphModel>");

  return { xml: lines.join("\n"), warnings: warnings, shapes: shapes };
}

/**
 * Compact XML without geometry → the placed diagram: roles and icons
 * expanded, the edges filed, every cell on the grid, the edges routed.
 *
 * @param {string} xml
 * @param {{direction?: string, mode?: string, hints?: boolean}} [options]
 * @returns {{xml: string, stats: object}}
 */
export function placeCompactXml(xml, options)
{
  const expanded = icons().applyToXml(expandDiagramShorthand(xml).xml).xml;

  // As in the servers: the normalization files every edge at the nearest
  // common ancestor of its ends before anything is placed.
  return gridLayoutDiagram(normalizeDiagram(expanded).xml, options);
}

function layout(d, ctx, kind)
{
  const compact = compactXml(d, kind);
  const r = placeCompactXml(compact.xml, { direction: d.direction || null, mode: kind.flow ? "flow" : "tiers",
    hints: ctx.hints !== false, route: ctx.route !== false });

  return { xml: r.xml, width: r.stats.width || 0, height: r.stats.height || 0, warnings: compact.warnings,
    stats: { shapes: compact.shapes, edges: d.edges.length, hinted: r.stats.hinted || 0, crossings: r.stats.crossings || 0,
      through: r.stats.through || 0, compactChars: compact.xml.length } };
}

export function layoutArchitecture(d, ctx)
{
  return layout(d, ctx, { flow: false, links: d.type === "network" });
}

export function layoutFlow(d, ctx)
{
  return layout(d, ctx, { flow: true, links: false });
}
