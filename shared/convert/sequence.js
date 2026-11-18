// Sequence diagrams as draw.io cells, from the model the Mermaid and
// PlantUML readers make: a UML lifeline per participant, every message an
// edge attached to its lifelines (or to the activation bar it starts or
// ends at) at its own height, the way draw.io's sequenceEdgeStyle keeps it
// there when a lifeline moves; notes, fragments (alt, loop, opt, par, …)
// with their conditions, activation bars, boxes around participants. In
// the calm colors of shared/semantic/theme.js. Deterministic and headless.

import { writeModel, IdPool } from "../semantic/xml-writer.js";
import { textWidth } from "../semantic/text-width.js";
import { ROLES, FONT_COLOR, EDGE } from "../semantic/theme.js";
import { htmlValue } from "./common.js";

const FONT = 14;
const MESSAGE_FONT = 13;
const LINE_H = 17;
const HEAD_H = 44;
const MIN_W = 100;
const MAX_W = 220;
const MARGIN = 20;
const MSG_GAP = 18;
const BAR_W = 10;
const SELF_W = 30;
const SELF_H = 26;
const TAB_H = 22;

const LIFELINE = "shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;dropTarget=0;" +
  "collapsible=0;recursiveResize=0;outlineConnect=0;portConstraint=eastwest;" +
  "newEdgeStyle={\"edgeStyle\":\"sequenceEdgeStyle\",\"libavoidRouting\":0,\"curved\":0,\"rounded\":0};";

// The header of each kind of participant: draw.io's participant shapes and
// the height of the head
const HEADS =
{
  participant: { style: "rounded=1;arcSize=10;", size: HEAD_H },
  actor: { style: "participant=seqActorStick;verticalAlign=bottom;align=center;spacingBottom=4;", size: 90, icon: true },
  boundary: { style: "participant=seqBoundary;verticalAlign=bottom;align=center;spacingBottom=4;", size: 80, icon: true },
  control: { style: "participant=seqControl;verticalAlign=bottom;align=center;spacingBottom=4;", size: 80, icon: true },
  entity: { style: "participant=seqEntity;verticalAlign=bottom;align=center;spacingBottom=4;", size: 80, icon: true },
  database: { style: "participant=seqDatabase;verticalAlign=bottom;align=center;spacingBottom=4;", size: 80, icon: true },
  queue: { style: "participant=seqQueue;verticalAlign=middle;align=center;", size: 65, icon: true },
  collections: { style: "participant=seqCollections;verticalAlign=middle;align=center;", size: 65, icon: true }
};

const STEP = ROLES.step;
const NOTE = ROLES.note;
const FRAME_STROKE = "#B8C0CC";
const MESSAGE_STROKE = "#5A626E";

function lines(text)
{
  return String(text || "").split("\n");
}

function width(text, size, bold)
{
  return lines(text).reduce(function(w, l) { return Math.max(w, textWidth(l, size, bold === true)); }, 0);
}

function height(text)
{
  return text === "" ? 0 : lines(text).length * LINE_H;
}

/**
 * The block structure: each start event's end, the events inside, and how
 * many blocks it holds inside itself (for the frames' padding).
 */
function blockTree(events)
{
  const stack = [];
  const blocks = [];

  events.forEach(function(e, i)
  {
    if (e.type === "start")
    {
      const b = { start: i, end: -1, kind: e.kind, label: e.label, color: e.color, depth: stack.length, inner: 0,
        elses: [], ids: new Set() };

      stack.push(b);
      blocks.push(b);
    }
    else if (e.type === "else" && stack.length > 0)
    {
      stack[stack.length - 1].elses.push(i);
    }
    else if (e.type === "end" && stack.length > 0)
    {
      const b = stack.pop();

      b.end = i;

      if (stack.length > 0)
      {
        stack[stack.length - 1].inner = Math.max(stack[stack.length - 1].inner, b.inner + 1);
      }
    }
    else if (e.type === "message" || e.type === "note")
    {
      const ids = e.type === "message" ? [e.from, e.to] : e.ids;

      stack.forEach(function(b) { ids.forEach(function(id) { b.ids.add(id); }); });
    }
  });

  return blocks;
}

/**
 * The sequence model as draw.io XML.
 *
 * @param {{title: string, participants: Array<{id: string, label: string, kind: string}>,
 *   events: Array<object>, boxes: Array<{label: string, color: string, members: string[]}>,
 *   autonumber: boolean}} model
 * @returns {{xml: string, warnings: string[], stats: object}}
 */
export function sequenceToXml(model)
{
  const warnings = [];
  const ps = model.participants;
  const index = new Map(ps.map(function(p, i) { return [p.id, i]; }));
  const ids = new IdPool();
  const pid = new Map(ps.map(function(p) { return [p.id, ids.take(p.id)]; }));
  // autonumber: from 1 by 1, or as PlantUML's `autonumber 10 5` says
  const step = (model.autonumberStep > 0) ? model.autonumberStep : 1;
  let number = ((model.autonumberStart != null) ? model.autonumberStart : 1) - step;
  // the edges of the diagram, for PlantUML's messages from and to outside
  // (`[->`, `->]`): one column left of the first lifeline and right of the last
  const LEFT_EDGE = -1;
  const RIGHT_EDGE = ps.length;

  function at(id)
  {
    return (id === "[") ? LEFT_EDGE : (id === "]" ? RIGHT_EDGE : index.get(id));
  }

  // Message labels with their numbers
  model.events.forEach(function(e)
  {
    if (e.type === "message")
    {
      e.text = model.autonumber ? (number += step) + ". " + e.label : e.label;
    }
  });

  // ── Widths and the distances between the lifelines ──
  const w = ps.map(function(p)
  {
    const head = HEADS[p.kind] || HEADS.participant;
    const tw = width(p.label, FONT, head.icon !== true) + (head.icon ? 10 : 28);

    return Math.max(head.icon ? 80 : MIN_W, Math.min(MAX_W, tw));
  });
  const gap = [];

  for (let i = 0; i < ps.length - 1; i++)
  {
    gap.push((w[i] + w[i + 1]) / 2 + 40);
  }

  let leftRoom = 0;
  let rightRoom = 0;
  const needs = [];

  model.events.forEach(function(e)
  {
    if (e.type === "message")
    {
      const a = at(e.from);
      const b = at(e.to);
      const lw = width(e.text, MESSAGE_FONT) + 30;

      if (a === LEFT_EDGE || b === LEFT_EDGE)
      {
        needs.push({ a: -1, b: 0, need: lw + 20 });
      }
      else if (a === RIGHT_EDGE || b === RIGHT_EDGE)
      {
        needs.push({ a: ps.length - 1, b: ps.length, need: lw + 20 });
      }
      else if (a === b)
      {
        needs.push({ a: a, b: a + 1, need: lw + SELF_W + 10 });
      }
      else
      {
        needs.push({ a: Math.min(a, b), b: Math.max(a, b), need: lw });
      }
    }
    else if (e.type === "note")
    {
      const nw = Math.min(260, width(e.text, MESSAGE_FONT) + 24);
      const a = index.get(e.ids[0]);

      e.width = nw;

      if (e.side === "right")
      {
        needs.push({ a: a, b: a + 1, need: nw + 20 });
      }
      else if (e.side === "left")
      {
        needs.push({ a: a - 1, b: a, need: nw + 20 });
      }
      else if (e.ids.length > 1)
      {
        const b = index.get(e.ids[e.ids.length - 1]);

        needs.push({ a: Math.min(a, b), b: Math.max(a, b), need: nw - 40 });
      }
    }
    else if (e.type === "ref" && e.ids.length > 1)
    {
      const a = index.get(e.ids[0]);
      const b = index.get(e.ids[e.ids.length - 1]);

      needs.push({ a: Math.min(a, b), b: Math.max(a, b), need: Math.min(400, width(e.label, MESSAGE_FONT) + 40) - 60 });
    }
  });

  needs.sort(function(x, y) { return (x.b - x.a) - (y.b - y.a); });

  for (const n of needs)
  {
    if (n.a < 0)
    {
      leftRoom = Math.max(leftRoom, n.need - w[0] / 2);
      continue;
    }

    if (n.b >= ps.length)
    {
      rightRoom = Math.max(rightRoom, n.need - w[ps.length - 1] / 2);
      continue;
    }

    let have = 0;

    for (let i = n.a; i < n.b; i++)
    {
      have += gap[i];
    }

    if (have < n.need)
    {
      const add = (n.need - have) / (n.b - n.a);

      for (let i = n.a; i < n.b; i++)
      {
        gap[i] += add;
      }
    }
  }

  const blocks = blockTree(model.events);
  const maxInner = blocks.reduce(function(m, b) { return Math.max(m, b.depth === 0 ? b.inner + 1 : 0); }, 0);
  const left = MARGIN + Math.max(leftRoom, maxInner * 10 + 20);
  const cx = [];

  ps.forEach(function(p, i)
  {
    cx.push(i === 0 ? left + w[0] / 2 : cx[i - 1] + gap[i - 1]);
  });

  // ── Rows ──
  const top = MARGIN + (model.title !== "" ? 40 : 0) + (model.boxes.length > 0 ? 28 : 0);
  const headSize = ps.map(function(p) { return (HEADS[p.kind] || HEADS.participant).size; });
  const lifeTop = ps.map(function() { return top; });
  const lifeEnd = ps.map(function() { return null; });
  let y = top + Math.max.apply(null, headSize) + 24;
  let lastY = y;
  const placed = [];
  const bars = ps.map(function() { return []; });
  const open = ps.map(function() { return []; });
  const blockTop = new Map();
  const elseY = new Map();
  let creating = null;

  function activate(i, at)
  {
    const bar = { y1: at, y2: null, depth: open[i].length };

    open[i].push(bar);
    bars[i].push(bar);
  }

  function deactivate(i, at)
  {
    if (open[i].length > 0)
    {
      open[i].pop().y2 = at;
    }
  }

  model.events.forEach(function(e, k)
  {
    if (e.type === "message")
    {
      const a = at(e.from);
      const b = at(e.to);

      y += height(e.text) + 4;

      if (a === b)
      {
        placed.push({ e: e, y: y, y2: y + SELF_H });
        lastY = y;
        y += SELF_H + MSG_GAP;
      }
      else
      {
        placed.push({ e: e, y: y });
        lastY = y;
        y += MSG_GAP;
      }

      if (creating != null && (a === creating || b === creating))
      {
        lifeTop[creating] = lastY - headSize[creating] / 2;
        y = Math.max(y, lifeTop[creating] + headSize[creating] + MSG_GAP);
        creating = null;
      }

      if (e.activate && b >= 0 && b < ps.length)
      {
        activate(b, lastY);
      }

      if (e.deactivate && a >= 0 && a < ps.length)
      {
        deactivate(a, lastY);
      }
    }
    else if (e.type === "divider")
    {
      y += 10;
      placed.push({ e: e, y: y, h: 24 });
      y += 24 + 14;
    }
    else if (e.type === "delay")
    {
      y += 4;
      placed.push({ e: e, y: y, h: 24 });
      y += 24 + 10;
    }
    else if (e.type === "space")
    {
      y += e.size > 0 ? Math.min(e.size, 400) : 20;
    }
    else if (e.type === "ref")
    {
      const h = Math.max(44, height(e.label) + 30);

      y += 6;
      placed.push({ e: e, y: y, h: h });
      y += h + 14;
    }
    else if (e.type === "create")
    {
      // the head stands at the message that creates it
      creating = index.get(e.id);
    }
    else if (e.type === "destroy")
    {
      lifeEnd[index.get(e.id)] = lastY + 12;
    }
    else if (e.type === "activate")
    {
      activate(index.get(e.id), lastY);
    }
    else if (e.type === "deactivate")
    {
      deactivate(index.get(e.id), lastY);
    }
    else if (e.type === "note")
    {
      const h = Math.max(30, height(e.text) + 14);

      y += 4;
      placed.push({ e: e, y: y, h: h });
      y += h + 12;
    }
    else if (e.type === "start")
    {
      y += 10;
      blockTop.set(k, y);
      y += TAB_H + 12 + (e.label !== "" ? 4 : 0);
    }
    else if (e.type === "else")
    {
      y += 8;
      elseY.set(k, y);
      y += 24;
    }
    else if (e.type === "end")
    {
      y += 6;
      blockTop.set("end" + k, y);
      y += 14;
    }
  });

  const bottom = y + 16;

  bars.forEach(function(list)
  {
    list.forEach(function(bar)
    {
      if (bar.y2 == null || bar.y2 <= bar.y1)
      {
        bar.y2 = bar.y2 == null ? bottom - 12 : bar.y1 + 20;
      }
    });
  });

  // ── Cells ──
  const cells = [];
  const background = [];

  if (model.title !== "")
  {
    cells.push({ id: ids.take("title"), value: htmlValue(model.title), style: "text;html=1;align=left;verticalAlign=middle;" +
      "fontSize=20;fontStyle=1;fontColor=" + FONT_COLOR + ";", x: MARGIN, y: MARGIN, width: Math.max(200, width(model.title, 20, true) + 20),
      height: 30 });
  }

  // Boxes around participants
  model.boxes.forEach(function(box)
  {
    const members = box.members.map(function(id) { return index.get(id); }).filter(function(i) { return i != null; });

    if (members.length === 0)
    {
      return;
    }

    const a = Math.min.apply(null, members);
    const b = Math.max.apply(null, members);
    const x1 = cx[a] - w[a] / 2 - 12;
    const x2 = cx[b] + w[b] / 2 + 12;
    const fill = box.color !== "" ? box.color : "#F7F8FA";

    background.push({ id: ids.take("box"), value: htmlValue(box.label), style: "rounded=1;arcSize=6;absoluteArcSize=1;html=1;" +
      "whiteSpace=wrap;verticalAlign=top;fontStyle=1;fontSize=13;fillColor=" + fill + ";strokeColor=#D5DAE1;fontColor=" +
      FONT_COLOR + ";", x: x1, y: top - 28, width: x2 - x1, height: bottom - top + 36 });
  });

  // rect blocks: a background behind their messages
  blocks.filter(function(b) { return b.kind === "rect"; }).forEach(function(b)
  {
    const span = blockSpan(b);
    const y1 = blockTop.get(b.start);
    const y2 = blockTop.get("end" + b.end);

    background.push({ id: ids.take("rect"), style: "rounded=0;html=1;strokeColor=none;fillColor=" +
      (cssFill(b.color) || "#F2F4F7") + ";", x: span.x1, y: y1, width: span.x2 - span.x1, height: y2 - y1 });
  });

  ps.forEach(function(p, i)
  {
    const head = HEADS[p.kind] || HEADS.participant;
    const end = lifeEnd[i] != null ? lifeEnd[i] : bottom;

    cells.push({ id: pid.get(p.id), value: htmlValue(p.label), style: LIFELINE + head.style + "size=" + head.size + ";" +
      "fillColor=" + (p.color || STEP.fill) + ";strokeColor=" + STEP.stroke + ";fontColor=" + FONT_COLOR + ";fontSize=" + FONT + ";" +
      (head.icon ? "" : "fontStyle=1;"), x: cx[i] - w[i] / 2, y: lifeTop[i], width: w[i], height: end - lifeTop[i] });

    bars[i].forEach(function(bar, k)
    {
      bar.id = ids.take(p.id + "_activation" + (k > 0 ? k + 1 : ""));
      cells.push({ id: bar.id, parent: pid.get(p.id), style: "html=1;points=[];perimeter=orthogonalPerimeter;outlineConnect=0;" +
        "targetShapes=umlLifeline;portConstraint=eastwest;newEdgeStyle={\"edgeStyle\":\"sequenceEdgeStyle\",\"libavoidRouting\":0," +
        "\"curved\":0,\"rounded\":0};fillColor=#FFFFFF;strokeColor=" + STEP.stroke + ";",
        x: w[i] / 2 - BAR_W / 2 + bar.depth * 5, y: bar.y1 - lifeTop[i] - 4, width: BAR_W, height: bar.y2 - bar.y1 + 8 });
    });

    if (lifeEnd[i] != null)
    {
      cells.push({ id: ids.take(p.id + "_destroy"), parent: pid.get(p.id), style: "shape=umlDestroy;html=1;strokeWidth=2;" +
        "strokeColor=" + MESSAGE_STROKE + ";", x: w[i] / 2 - 9, y: end - lifeTop[i] - 18, width: 18, height: 18 });
    }
  });

  // Frames of the blocks, outermost first
  function blockSpan(b)
  {
    let a = Infinity;
    let z = -Infinity;

    b.ids.forEach(function(id)
    {
      const i = index.get(id);

      a = Math.min(a, i);
      z = Math.max(z, i);
    });

    if (a === Infinity)
    {
      a = 0;
      z = ps.length - 1;
    }

    const pad = 18 + b.inner * 10;
    let x2 = cx[z] + Math.max(w[z] / 2, 40) + pad - 10;

    // a call to itself loops out to the right
    model.events.slice(b.start, b.end).forEach(function(e)
    {
      if (e.type === "message" && e.from === e.to && index.get(e.from) === z)
      {
        x2 = Math.max(x2, cx[z] + SELF_W + width(e.text, MESSAGE_FONT) + 16 + pad);
      }
    });

    return { x1: cx[a] - Math.max(w[a] / 2, 40) - pad + 10, x2: x2 };
  }

  blocks.filter(function(b) { return b.kind !== "rect"; }).forEach(function(b)
  {
    const span = blockSpan(b);
    const y1 = blockTop.get(b.start);
    const y2 = blockTop.get("end" + b.end);
    const tab = Math.max(50, textWidth(b.kind, 13, true) + 22);
    const frame = ids.take(b.kind);

    cells.push({ id: frame, value: b.kind, style: "shape=umlFrame;whiteSpace=wrap;html=1;pointerEvents=0;recursiveResize=0;" +
      "container=1;collapsible=0;fontStyle=1;fontSize=13;width=" + Math.round(tab) + ";height=" + TAB_H + ";fillColor=#F2F4F7;" +
      "strokeColor=" + FRAME_STROKE + ";fontColor=" + FONT_COLOR + ";", x: span.x1, y: y1, width: span.x2 - span.x1, height: y2 - y1 });

    if (b.label !== "")
    {
      cells.push({ id: ids.take(b.kind + "_condition"), parent: frame, value: htmlValue("[" + b.label + "]"),
        style: "text;html=1;align=left;verticalAlign=middle;fontSize=13;fontColor=" + FONT_COLOR + ";",
        x: tab + 8, y: 0, width: Math.max(60, width("[" + b.label + "]", 13) + 10), height: TAB_H });
    }

    b.elses.forEach(function(k)
    {
      const ey = elseY.get(k);
      const label = model.events[k].label;

      cells.push({ id: ids.take(b.kind + "_else"), parent: frame, style: "line;strokeWidth=1;dashed=1;fillColor=none;html=1;" +
        "strokeColor=" + FRAME_STROKE + ";", x: 0, y: ey - y1 - 4, width: span.x2 - span.x1, height: 8 });

      if (label !== "")
      {
        cells.push({ id: ids.take(b.kind + "_else_condition"), parent: frame, value: htmlValue("[" + label + "]"),
          style: "text;html=1;align=left;verticalAlign=middle;fontSize=13;fontColor=" + FONT_COLOR + ";",
          x: 8, y: ey - y1 + 2, width: Math.max(60, width("[" + label + "]", 13) + 10), height: 20 });
      }
    });
  });

  // The cell a message starts or ends at: the innermost activation bar of
  // the lifeline at its height, or the lifeline
  function endAt(i, at)
  {
    let best = null;

    bars[i].forEach(function(bar)
    {
      if (at >= bar.y1 - 0.5 && at <= bar.y2 + 0.5 && (best == null || bar.depth > best.depth))
      {
        best = bar;
      }
    });

    return best != null ? best.id : pid.get(ps[i].id);
  }

  // the diagram's left and right edge, for dividers and messages from outside
  const edgeLeft = MARGIN;
  const edgeRight = cx[ps.length - 1] + w[ps.length - 1] / 2 + Math.max(rightRoom, 20);

  placed.forEach(function(item)
  {
    const e = item.e;

    if (e.type === "divider")
    {
      cells.push({ id: ids.take("divider_line"), style: "line;strokeWidth=1;fillColor=none;html=1;strokeColor=" + FRAME_STROKE + ";",
        x: edgeLeft, y: item.y + item.h / 2 - 4, width: edgeRight - edgeLeft, height: 8 });

      if (e.label !== "")
      {
        const dw = width(e.label, MESSAGE_FONT, true) + 24;

        cells.push({ id: ids.take("divider"), value: htmlValue(e.label), style: "rounded=1;arcSize=20;html=1;whiteSpace=wrap;" +
          "fontStyle=1;fontSize=" + MESSAGE_FONT + ";fillColor=#F2F4F7;strokeColor=" + FRAME_STROKE + ";fontColor=" + FONT_COLOR + ";",
          x: (edgeLeft + edgeRight) / 2 - dw / 2, y: item.y, width: dw, height: item.h });
      }

      return;
    }

    if (e.type === "delay")
    {
      const text = e.label !== "" ? "… " + e.label + " …" : "…";
      const dw = width(text, MESSAGE_FONT) + 20;

      cells.push({ id: ids.take("delay"), value: htmlValue(text), style: "text;html=1;align=center;verticalAlign=middle;" +
        "fontStyle=2;fontSize=" + MESSAGE_FONT + ";fontColor=" + MESSAGE_STROKE + ";",
        x: (edgeLeft + edgeRight) / 2 - dw / 2, y: item.y, width: dw, height: item.h });

      return;
    }

    if (e.type === "ref")
    {
      const list = e.ids.map(function(id) { return index.get(id); }).filter(function(i) { return i != null; });
      const a = list.length > 0 ? Math.min.apply(null, list) : 0;
      const b = list.length > 0 ? Math.max.apply(null, list) : ps.length - 1;
      const x1 = cx[a] - Math.max(w[a] / 2, 50);
      const x2 = Math.max(cx[b] + Math.max(w[b] / 2, 50), x1 + width(e.label, MESSAGE_FONT) + 40);
      const frame = ids.take("ref");

      cells.push({ id: frame, value: "ref", style: "shape=umlFrame;whiteSpace=wrap;html=1;pointerEvents=0;recursiveResize=0;" +
        "container=1;collapsible=0;fontStyle=1;fontSize=13;width=44;height=" + TAB_H + ";fillColor=#FFFFFF;" +
        "strokeColor=" + FRAME_STROKE + ";fontColor=" + FONT_COLOR + ";", x: x1, y: item.y, width: x2 - x1, height: item.h });
      cells.push({ id: ids.take("ref_text"), parent: frame, value: htmlValue(e.label), style: "text;html=1;align=center;" +
        "verticalAlign=middle;whiteSpace=wrap;fontSize=" + MESSAGE_FONT + ";fontColor=" + FONT_COLOR + ";",
        x: 8, y: TAB_H - 4, width: x2 - x1 - 16, height: item.h - TAB_H });

      return;
    }

    if (e.type === "note")
    {
      const a = index.get(e.ids[0]);
      const b = index.get(e.ids[e.ids.length - 1]);
      let x;
      let nw = e.width;

      if (e.side === "right")
      {
        x = cx[a] + 12;
      }
      else if (e.side === "left")
      {
        x = cx[a] - 12 - nw;
      }
      else if (a !== b)
      {
        const x1 = Math.min(cx[a], cx[b]) - 30;
        const x2 = Math.max(cx[a], cx[b]) + 30;

        nw = Math.max(nw, x2 - x1);
        x = (x1 + x2) / 2 - nw / 2;
      }
      else
      {
        x = cx[a] - nw / 2;
      }

      cells.push({ id: ids.take("note"), value: htmlValue(e.text), style: "shape=note;size=10;whiteSpace=wrap;html=1;" +
        "align=left;spacingLeft=6;fontSize=" + MESSAGE_FONT + ";fillColor=" + NOTE.fill + ";strokeColor=" + NOTE.stroke +
        ";fontColor=" + FONT_COLOR + ";", x: x, y: item.y, width: nw, height: item.h });
      return;
    }

    const a = at(e.from);
    const b = at(e.to);
    const heads = { block: "endArrow=block;endFill=1;endSize=8;", open: "endArrow=open;endFill=0;endSize=10;",
      async: "endArrow=open;endFill=0;endSize=10;", cross: "endArrow=cross;endSize=8;", none: "endArrow=none;",
      circle: "endArrow=oval;endFill=0;endSize=8;" };
    let style = "html=1;verticalAlign=bottom;spacingBottom=2;edgeStyle=sequenceEdgeStyle;libavoidRouting=0;curved=0;rounded=0;" +
      (heads[e.head] || heads.block) + "strokeColor=" + (e.color || MESSAGE_STROKE) + ";fontColor=" + FONT_COLOR + ";fontSize=" +
      MESSAGE_FONT + ";labelBackgroundColor=none;" + (e.bold ? "strokeWidth=2;" : "");

    if (e.dotted)
    {
      style += "dashed=1;";
    }

    if (e.both)
    {
      style += "startArrow=block;startFill=1;startSize=8;";
    }

    const id = ids.take("msg" + (cells.filter(function(c) { return c.edge; }).length + 1));

    // from or to the diagram's edge (PlantUML's `[->`, `->]`): that end is a point
    if (a === LEFT_EDGE || a === RIGHT_EDGE || b === LEFT_EDGE || b === RIGHT_EDGE)
    {
      const xOf = function(i) { return i === LEFT_EDGE ? edgeLeft : (i === RIGHT_EDGE ? edgeRight : cx[i]); };
      const inside = function(i) { return i !== LEFT_EDGE && i !== RIGHT_EDGE; };

      cells.push({ id: id, value: htmlValue(e.text), style: style.replace("edgeStyle=sequenceEdgeStyle;", ""), edge: true,
        source: inside(a) ? endAt(a, item.y) : null, target: inside(b) ? endAt(b, item.y) : null,
        sourcePoint: { x: xOf(a), y: item.y }, targetPoint: { x: xOf(b), y: item.y } });

      return;
    }

    if (a === b)
    {
      style += "align=left;spacingLeft=4;";
      cells.push({ id: id, value: htmlValue(e.text), style: style, edge: true, source: endAt(a, item.y), target: endAt(a, item.y2),
        points: [{ x: cx[a] + SELF_W, y: item.y }, { x: cx[a] + SELF_W, y: item.y2 }] });
    }
    else
    {
      cells.push({ id: id, value: htmlValue(e.text), style: style, edge: true, source: endAt(a, item.y), target: endAt(b, item.y),
        points: [{ x: (cx[a] + cx[b]) / 2, y: item.y }] });
    }
  });

  return {
    xml: writeModel(background.concat(cells)),
    warnings: warnings,
    stats: { participants: ps.length, messages: placed.filter(function(p) { return p.e.type === "message"; }).length,
      width: Math.round(cx[ps.length - 1] + w[ps.length - 1] / 2 + rightRoom + MARGIN), height: Math.round(bottom + MARGIN) }
  };
}

function cssFill(c)
{
  const v = String(c || "").trim();

  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/i.test(v))
  {
    const n = v.replace(/[^\d.,]/g, "").split(",").map(Number);
    const hex = "#" + n.slice(0, 3).map(function(x) { return ("0" + Math.max(0, Math.min(255, x)).toString(16)).slice(-2); }).join("");

    return hex.toUpperCase();
  }

  return /^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(v) ? v : null;
}
