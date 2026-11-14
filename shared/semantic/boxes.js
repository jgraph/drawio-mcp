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

// The provider's own icon for people, where its set has one: beside official
// service icons a stick figure looks borrowed from another diagram.
const PEOPLE_ICONS = { aws: "aws users", azure: "azure users", kubernetes: "kubernetes user" };

// The provider most of the diagram's icons come from, or "".
function mainProvider(nodes)
{
  const count = new Map();
  let best = "";

  for (const n of nodes)
  {
    const provider = String(n.icon || "").trim().split(/\s+/)[0].toLowerCase();

    if (provider !== "" && icons().resolve(n.icon) != null)
    {
      count.set(provider, (count.get(provider) || 0) + 1);

      if (best === "" || count.get(provider) > count.get(best))
      {
        best = provider;
      }
    }
  }

  return best;
}

// A decision's label breaks where a line gets longer than this many times
// the font size (120 px at 16 px).
const DECISION_WRAP = 7.5;

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

// ─── Notes ───────────────────────────────────────────────────────

/**
 * An edge between a group and something inside it (logs from everything in
 * the organization to its logging service) has no line: it would start on a
 * frame and end in it. It becomes a note under the diagram.
 *
 * @param {object} d - the normalized description
 * @returns {{edges: object[], notes: string[]}}
 */
function splitNotes(d)
{
  const nodeById = new Map(d.nodes.map(function(n) { return [n.id, n]; }));
  const groupById = new Map(d.groups.map(function(g) { return [g.id, g]; }));
  const isGroup = function(id) { return groupById.has(id) && !nodeById.has(id); };
  const nameOf = function(id)
  {
    const item = isGroup(id) ? groupById.get(id) : nodeById.get(id);

    return (isGroup(id) ? "everything in " : "") + ((item != null && item.label) || id);
  };
  const within = function(id, group)
  {
    let at = nodeById.has(id) ? nodeById.get(id).group : (groupById.has(id) ? groupById.get(id).parent : "");

    for (let i = 0; at !== "" && at != null && i < 20; i++)
    {
      if (at === group)
      {
        return true;
      }

      at = groupById.has(at) ? groupById.get(at).parent : "";
    }

    return false;
  };
  const edges = [];
  const notes = [];

  for (const e of d.edges)
  {
    if ((isGroup(e.from) && within(e.to, e.from)) || (isGroup(e.to) && within(e.from, e.to)))
    {
      notes.push((e.label !== "" ? e.label + ": " : "") + nameOf(e.from) + " → " + nameOf(e.to));
    }
    else
    {
      edges.push(e);
    }
  }

  return { edges: edges, notes: notes };
}

// ─── Bundles ─────────────────────────────────────────────────────

// A group with more members than this keeps one line to its frame, and so
// does every connection of a group after its first two: the main flows reach
// every member, the rest (scraping, tracing, deploying) the frame.
const BUNDLE_MAX = 8;
const BUNDLES_PER_GROUP = 2;

// A connection drawn to every member may cost this many more crossings than
// one line to the frame (a bus between services and their databases crosses
// every line between them); else the frame keeps the line.
const FAN_CROSSINGS = 1;

/**
 * Whether the members stand in one row or one column of the grid, with the
 * hub in the next row or column that holds anything: a trunk between the two
 * then reaches every member with a short stub. Into a block of several rows
 * the lines would run between the members, and from further away they would
 * cross whatever stands between (in the first version a bus under the
 * databases sent six lines through their row).
 */
function isComb(hub, list, nodes)
{
  if (hub.row == null || hub.col == null || !list.every(function(n) { return n.row != null && n.col != null; }))
  {
    return false;
  }

  for (const key of ["row", "col"])
  {
    const at = list[0][key];

    if (list.every(function(n) { return n[key] === at; }) && hub[key] !== at)
    {
      const lo = Math.min(hub[key], at);
      const hi = Math.max(hub[key], at);

      return !nodes.some(function(n) { return n[key] != null && n[key] > lo && n[key] < hi; });
    }
  }

  return false;
}

// Lines without arrowheads have no direction.
const LINK_KINDS = /^(network|link|cable|wired|wireless|line|bidirectional|both)$/;

/**
 * The lines to draw for the edges of an architecture or network diagram.
 * An edge between a shape and a group means every member of the group:
 * where the members stand in one row or column and the shape in the next
 * one, it becomes a line to each of them (in the blind judgements one line
 * to the frame read as a connection to the nearest member). Those lines, and three
 * or more edges of one kind and label that share an end, are a bundle: the
 * grid pass draws them as one tree with a common trunk, and the label
 * stands once, on the line to the nearest shape.
 *
 * @param {object} d - the normalized description
 * @param {boolean} links - a network: no line has a direction
 * @param {boolean} fan - false: an edge with a group stays one line to its frame
 * @returns {{from: string, to: string, label: string, kind: string, bundle: number|null}[]}
 */
function bundleEdges(d, links, fan)
{
  const nodeById = new Map(d.nodes.map(function(n) { return [n.id, n]; }));
  const groupIds = new Set(d.groups.map(function(g) { return g.id; }));
  const nested = new Set(d.groups.map(function(g) { return g.parent; }));
  const members = new Map();
  const out = [];
  let next = 1;

  for (const n of d.nodes)
  {
    if (n.group !== "")
    {
      if (!members.has(n.group))
      {
        members.set(n.group, []);
      }

      members.get(n.group).push(n);
    }
  }

  const distance = function(a, b)
  {
    return (a.row != null && b.row != null && a.col != null && b.col != null) ?
      Math.abs(a.row - b.row) + Math.abs(a.col - b.col) : 0;
  };

  // The label of a bundle stands on the line to the shape nearest its hub.
  const labelOnce = function(parts, hub, label)
  {
    let nearest = parts[0];

    for (const p of parts)
    {
      p.label = "";

      if (distance(p.other, hub) < distance(nearest.other, hub))
      {
        nearest = p;
      }
    }

    nearest.label = label;
  };

  const written = new Set(d.edges.map(function(e) { return e.from + "\n" + e.to; }));
  const isGroup = function(id) { return groupIds.has(id) && !nodeById.has(id); };

  // A shape with the same connection to several groups (logs from
  // everything) keeps its lines to the frames.
  const toGroups = new Map();
  const ambientKey = function(e)
  {
    return (isGroup(e.from) ? "from\n" + e.to : "to\n" + e.from) + "\n" + e.kind + "\n" + e.label.trim().toLowerCase();
  };

  for (const e of d.edges)
  {
    if (isGroup(e.from) !== isGroup(e.to))
    {
      toGroups.set(ambientKey(e), (toGroups.get(ambientKey(e)) || 0) + 1);
    }
  }

  const expanded = new Map();

  for (const e of d.edges)
  {
    const fromGroup = isGroup(e.from);
    const toGroup = isGroup(e.to);
    const group = fromGroup ? e.from : e.to;
    const hub = nodeById.get(fromGroup ? e.to : e.from);
    const list = (fan && fromGroup !== toGroup && hub != null && hub.group !== group && !nested.has(group) &&
      toGroups.get(ambientKey(e)) === 1 && (expanded.get(group) || 0) < BUNDLES_PER_GROUP) ? (members.get(group) || []) : [];

    if (list.length < 2 || list.length > BUNDLE_MAX || !isComb(hub, list, d.nodes))
    {
      out.push({ from: e.from, to: e.to, label: e.label, kind: e.kind, bundle: null });

      continue;
    }

    expanded.set(group, (expanded.get(group) || 0) + 1);

    const parts = [];

    for (const m of list)
    {
      const from = fromGroup ? m.id : e.from;
      const to = fromGroup ? e.to : m.id;

      // not twice where the description names the member too
      if (!written.has(from + "\n" + to))
      {
        parts.push({ from: from, to: to, label: "", kind: e.kind, bundle: next, other: m });
      }
    }

    if (parts.length > 0)
    {
      labelOnce(parts, hub, e.label);
      parts.forEach(function(p) { out.push(p); });
      next++;
    }
  }

  // Edges written one by one that share an end, a kind and a label.
  const fans = new Map();

  for (const l of out)
  {
    if (l.bundle != null || !nodeById.has(l.from) || !nodeById.has(l.to) || l.from === l.to)
    {
      continue;
    }

    const undirected = links || LINK_KINDS.test(l.kind);

    for (const end of ["from", "to"])
    {
      const key = (undirected ? "" : end) + "\n" + l[end] + "\n" + l.kind + "\n" + l.label.trim().toLowerCase();

      if (!fans.has(key))
      {
        fans.set(key, { hub: nodeById.get(l[end]), parts: [] });
      }

      fans.get(key).parts.push({ line: l, other: nodeById.get(end === "from" ? l.to : l.from) });
    }
  }

  Array.from(fans.values()).sort(function(a, b) { return b.parts.length - a.parts.length; }).forEach(function(fan)
  {
    const seen = new Set();
    const free = fan.parts.filter(function(p)
    {
      const fresh = p.line.bundle == null && !seen.has(p.other);

      seen.add(p.other);

      return fresh;
    });

    if (free.length < 3)
    {
      return;
    }

    const label = free[0].line.label;
    let nearest = free[0];

    for (const p of free)
    {
      p.line.bundle = next;
      p.line.label = "";

      if (distance(p.other, fan.hub) < distance(nearest.other, fan.hub))
      {
        nearest = p;
      }
    }

    nearest.line.label = label;
    next++;
  });

  return out;
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
 * @param {{flow: boolean, links: boolean, fan?: boolean}} kind - flow: a
 *   flowchart (kinds are steps and decisions, groups are lanes); links: a
 *   network (lines without arrows); fan: false keeps an edge with a group
 *   one line to its frame
 * @returns {{xml: string, warnings: string[], shapes: number, fanned: number}} fanned: the lines
 *   that edges with a group added
 */
export function compactXml(d, kind)
{
  const warnings = [];
  const ids = new IdPool();
  const idOf = new Map();
  const shapes = d.nodes.length + d.groups.length;
  const font = fontSizes(shapes);
  const cells = [];
  const peopleIcon = kind.flow ? null : (PEOPLE_ICONS[mainProvider(d.nodes)] || null);

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
        // One text color for every icon's name: some sets bring their own
        // (grey and bold for Google Cloud's products, not for its services).
        style = "icon=" + n.icon.replace(/[;=]/g, " ") + ";fontStyle=0;fontColor=default;";
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
        style = (peopleIcon != null && icons().resolve(peopleIcon) != null) ? "icon=" + peopleIcon + ";" : ACTOR_STYLE;
        wrapAt = 120;
      }
      else
      {
        style = roleKeys(role);

        // A question in a diamond stands on two or three short lines, so the
        // diamond stays narrow.
        if (role === "decision")
        {
          wrapAt = DECISION_WRAP * font.shape;
        }
      }
    }

    cells.push({ id: id, value: labelValue(n.label, n.sub, font.shape, wrapAt), parent: parent,
      style: style + "fontSize=" + font.shape + ";" + hintKeys(n) });
  }

  const edgeStyle = "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=" + EDGE.stroke + ";fontColor=" +
    EDGE.font + ";fontSize=" + font.edge + ";";

  const split = splitNotes(d);
  const connections = kind.flow ? split.edges :
    bundleEdges(Object.assign({}, d, { edges: split.edges }), kind.links, kind.fan !== false);
  const fanned = connections.length - split.edges.length;

  connections.forEach(function(e)
  {
    let style = edgeStyle;

    if (/^(async|event|events|message|dashed|optional|wireless|publish|subscribe)$/.test(e.kind))
    {
      style += "dashed=1;";
    }

    if (kind.links || LINK_KINDS.test(e.kind))
    {
      style += "endArrow=none;";
    }

    if (e.bundle != null)
    {
      style += "bundle=" + e.bundle + ";";
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

  // `note=1` is for the layout: a text under the diagram, never its heading.
  if (split.notes.length > 0)
  {
    lines.push(cellXml({ id: ids.take("notes"), value: split.notes.map(htmlLabel).join("<br>"), parent: "1",
      style: "text;html=1;align=left;verticalAlign=top;fontSize=" + font.edge + ";fontColor=" + EDGE.font + ";note=1;" }));
  }

  lines.push("</root>", "</mxGraphModel>");

  return { xml: lines.join("\n"), warnings: warnings, shapes: shapes, fanned: fanned };
}

/**
 * Compact XML without geometry → the placed diagram: roles and icons
 * expanded, the edges filed, every cell on the grid, the edges routed.
 *
 * @param {string} xml
 * @param {{direction?: string, mode?: string, hints?: boolean|"page"}} [options]
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
  const place = function(compact)
  {
    return placeCompactXml(compact.xml, { direction: d.direction || null, mode: kind.flow ? "flow" : "tiers",
      hints: ctx.hints === "ask" ? "page" : ctx.hints !== false, route: ctx.route !== false });
  };
  let compact = compactXml(d, kind);
  let r = place(compact);

  // Lines to every member of a group stay where their tree is clean.
  if (compact.fanned > 0)
  {
    const plain = compactXml(d, Object.assign({}, kind, { fan: false }));
    const p = place(plain);

    if ((r.stats.crossings || 0) > (p.stats.crossings || 0) + FAN_CROSSINGS)
    {
      compact = plain;
      r = p;
    }
  }

  return { xml: r.xml, width: r.stats.width || 0, height: r.stats.height || 0, warnings: compact.warnings,
    stats: { shapes: compact.shapes, edges: d.edges.length, hinted: r.stats.hinted || 0, grid: r.stats.grid || null, crossings: r.stats.crossings || 0,
      through: r.stats.through || 0, turned: r.stats.policy === "turned", dense: r.stats.dense === true, compactChars: compact.xml.length } };
}

export function layoutArchitecture(d, ctx)
{
  return layout(d, ctx, { flow: false, links: d.type === "network" });
}

export function layoutFlow(d, ctx)
{
  return layout(d, ctx, { flow: true, links: false });
}
