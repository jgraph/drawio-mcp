// Grid layout: a layout pass over the draw.io model. Cells without a position
// come in, the same cells with a geometry go out: every vertex on a grid,
// containers sized around their children, lanes as bands that share one
// grid, and the right-angle edges routed between them.
//
// It is the placement a model otherwise does by hand from the patterns in
// shared/chat-view-xml.md. The pass doesn't know diagram types; it knows
//
//   - containers (a vertex with vertex children), nested to any depth,
//   - lanes (sibling containers with `lane=1` in their style),
//   - two ways to place the children of a container without hints: `flow`
//     (the main path in one column, a branch beside the step it leaves, a
//     hand-over to another lane in the same row) and `tiers` (one row per
//     rank, each row centered),
//   - placement hints in a vertex style, `row=2;col=1`: the cell of its
//     parent's grid the vertex goes to. Hints are ordinal (only their order
//     counts), cells with the same row and col stack, and where the children
//     of a container carry hints nothing is searched.
//
// The hint keys and `lane` are removed from the styles, so the result is
// plain draw.io XML. A page whose vertices all have a position passes
// byte-identical unless `all` is set.
//
// Headless and deterministic like the other passes (mx-xml.js): no DOM, no
// randomness, the same output for the same input in Node, the Worker and the
// browser.

import { transformPages } from "./mx-xml.js";
import { MxGeometry, MxPoint } from "./mx-model.js";
import { textWidth } from "./semantic/text-width.js";
import { planLines, drawLines } from "./grid-lines.js";

// What the chat shows a diagram in: the app server's card in an 800 px frame
// on a screen 1000 px high, less the room the viewer keeps around a diagram
// (measured on the inline screenshots of bench/render.mjs: a card of
// 784 × 728 px, 24 px on every side and 16 px at the bottom).
const FRAME = { width: 736, height: 664 };

// Lanes are narrow: their lines run closer together than on an open page.
const LANE_LINES = { track: 12, margin: 12 };

// Room between cells and inside frames: the usual one, and a tighter one for
// a diagram that is larger than the frame at full size.
const SPACING =
{
  normal: { col: 40, row: 50, stack: 30, iconCol: 50, iconRow: 40, iconStack: 24, pad: 20, title: 28, titleMin: 40,
    laneCross: 30 },
  tight: { col: 28, row: 36, stack: 20, iconCol: 36, iconRow: 28, iconStack: 16, pad: 12, title: 20, titleMin: 32,
    laneCross: 20 }
};

function spacing(ctx)
{
  return (ctx != null && ctx.tight) ? SPACING.tight : SPACING.normal;
}

const LANE_TITLE = 30;

// How much more of a lane diagram the chat has to show before the pass
// turns the rows the model wrote into columns (or the other way round).
const TURN_MARGIN = 0.1;

// A page without lanes is turned (rows as columns) only for a clear gain: its
// rows are the tiers the model had in mind. A flowchart reads the same both
// ways, and one of seven or eight columns is shown a third larger when its
// steps run down the page instead.
const TURN_MARGIN_PAGE = 0.2;
const TURN_MARGIN_FLOW = 0.03;

// How much more of the frame a page has to fill before its boxes are made
// narrower (140 px instead of 160 px at 16 px text).
const DENSE_MARGIN = 0.02;
const ICON_SIZE = 60;
const HINT_KEYS = ["row", "col", "lane", "note"];

// ─── Styles and labels ───────────────────────────────────────────

function parseStyle(text)
{
  const names = [];
  const keys = [];
  const map = {};

  for (const part of String(text || "").split(";"))
  {
    const p = part.trim();

    if (p === "")
    {
      continue;
    }

    const i = p.indexOf("=");

    if (i < 0)
    {
      names.push(p);
    }
    else
    {
      const k = p.substring(0, i);

      if (!Object.prototype.hasOwnProperty.call(map, k))
      {
        keys.push(k);
      }

      map[k] = p.substring(i + 1);
    }
  }

  return { names: names, keys: keys, map: map };
}

function styleText(st)
{
  const parts = st.names.slice();

  for (const k of st.keys)
  {
    if (st.map[k] != null)
    {
      parts.push(k + "=" + st.map[k]);
    }
  }

  return parts.length > 0 ? parts.join(";") + ";" : "";
}

function setKey(st, key, value)
{
  if (!Object.prototype.hasOwnProperty.call(st.map, key) || st.map[key] == null)
  {
    if (st.keys.indexOf(key) < 0)
    {
      st.keys.push(key);
    }
  }

  st.map[key] = value;
}

function dropKey(st, key)
{
  if (Object.prototype.hasOwnProperty.call(st.map, key))
  {
    st.map[key] = null;
  }
}

function hintOf(st, key)
{
  const v = st.map[key];
  const n = (v == null || v === "") ? NaN : Number(v);

  return Number.isFinite(n) ? n : null;
}

// The lines of an HTML label with their font sizes: <br> breaks a line,
// <small> shrinks it, every other tag is dropped.
function labelLines(value, fontSize)
{
  const text = String(value == null ? "" : value);

  if (text.trim() === "")
  {
    return [];
  }

  const lines = [];

  for (const raw of text.split(/<br\s*\/?>|\n/i))
  {
    const small = /<small\b/i.test(raw);
    const plain = raw.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

    if (plain !== "")
    {
      lines.push({ text: plain, size: small ? Math.round(fontSize * 0.8) : fontSize });
    }
  }

  return lines;
}

// Greedy word wrap: how many lines a text takes in a box `inner` px wide,
// and the widest unbreakable word.
function wrap(text, size, bold, inner)
{
  const words = text.split(/\s+/);
  const space = textWidth(" ", size, bold);
  let lines = 1;
  let run = 0;
  let widest = 0;

  for (const w of words)
  {
    const ww = textWidth(w, size, bold);

    widest = Math.max(widest, ww);

    if (run > 0 && run + space + ww > inner)
    {
      lines++;
      run = ww;
    }
    else
    {
      run += (run > 0 ? space : 0) + ww;
    }
  }

  return { lines: lines, widest: widest };
}

// ─── The tree of items ───────────────────────────────────────────

function isOutsideLabel(st)
{
  return st.map.verticalLabelPosition === "bottom" || st.map.verticalLabelPosition === "top" ||
    (st.names.indexOf("image") >= 0 && st.map.verticalLabelPosition == null && st.map.labelPosition == null &&
      st.map.verticalAlign == null);
}

function isText(st)
{
  return st.names[0] === "text" || (st.map.strokeColor === "none" && st.map.fillColor === "none");
}

function buildItems(graph, useHints)
{
  const model = graph.getModel();
  const items = new Map();
  const order = [];

  function visit(cell, parentItem)
  {
    for (let i = 0; i < model.getChildCount(cell); i++)
    {
      const child = model.getChildAt(cell, i);

      if (!model.isVertex(child) || (child.geometry != null && child.geometry.relative))
      {
        continue;
      }

      const st = parseStyle(child.style);
      const item = { cell: child, st: st, parent: parentItem, children: [], x: 0, y: 0, w: 0, h: 0,
        occW: 0, occH: 0, sized: false, row: useHints ? hintOf(st, "row") : null, col: useHints ? hintOf(st, "col") : null,
        lane: st.map.lane === "1", index: order.length };

      items.set(child, item);
      order.push(item);

      if (parentItem != null)
      {
        parentItem.children.push(item);
      }

      // A table lays out its own rows (childLayout=stackLayout); they are
      // not items, the table is one box.
      if (st.map.childLayout == null)
      {
        visit(child, item);
      }
    }
  }

  const roots = [];
  const root = model.getRoot();

  for (let i = 0; i < model.getChildCount(root); i++)
  {
    const layer = model.getChildAt(root, i);
    const before = order.length;

    visit(layer, null);

    for (let j = before; j < order.length; j++)
    {
      if (order[j].parent == null)
      {
        roots.push(order[j]);
      }
    }
  }

  return { items: items, order: order, roots: roots };
}

// The item an edge end belongs to at one level: the child of `level` (null
// for the top) that is the end or contains it.
function liftTo(item, level)
{
  let it = item;

  while (it != null && it.parent !== level)
  {
    it = it.parent;
  }

  return it;
}

function itemOfCell(cell, items)
{
  let c = cell;

  while (c != null && !items.has(c))
  {
    c = c.parent;
  }

  return (c != null) ? items.get(c) : null;
}

// ─── Sizes ───────────────────────────────────────────────────────

// How much of a decision its text may take: the widest line's share of the
// width plus the text's share of the height. 1 is the outline; a little over
// it reads well and keeps the columns of a flowchart narrow, as in the
// diagrams models place themselves (160 × 90 with two lines of text).
const DECISION_FILL = 1.15;

/**
 * The size of a cell without one, from its text.
 *
 * @param {object} item
 * @param {boolean} [dense] - narrower boxes, for a page that is shown small
 * @param {number} [minWidth] - the width its kind had before a change: the
 *   text wraps at that width, so a new box of the kind is as tall as it needs
 */
function measureLeaf(item, dense, minWidth)
{
  const st = item.st;
  const geo = item.cell.geometry;
  const fontSize = Number(st.map.fontSize) || 12;
  const bold = (Number(st.map.fontStyle) & 1) === 1;
  const lines = labelLines(item.cell.value, fontSize);
  const outside = isOutsideLabel(st);
  let w = (geo != null && geo.width > 0) ? geo.width : 0;
  let h = (geo != null && geo.height > 0) ? geo.height : 0;
  let widest = 0;

  for (const l of lines)
  {
    widest = Math.max(widest, textWidth(l.text, l.size, bold));
  }

  if (w === 0 || h === 0)
  {
    item.sized = true;

    if (outside)
    {
      w = w || ICON_SIZE;
      h = h || ICON_SIZE;
    }
    else if (isText(st))
    {
      w = w || Math.ceil(widest + 16);
      h = h || Math.max(30, lines.length * Math.round(fontSize * 1.4) + 10);
    }
    else if (st.names.indexOf("rhombus") >= 0 || st.map.shape === "rhombus")
    {
      let text = 0;

      for (const l of lines)
      {
        text += Math.round(l.size * 1.3);
      }

      h = h || Math.max(90, text + 48);
      w = w || Math.min(240, Math.max(160, Math.ceil(widest / Math.max(0.4, DECISION_FILL - text / h) / 10) * 10));
    }
    else if (st.map.shape === "umlActor")
    {
      w = w || 30;
      h = h || 60;
    }
    else
    {
      const base = (st.map.shape != null && /^cylinder/.test(st.map.shape)) ? { w: 120, h: 80 } :
        { w: (fontSize >= 16 && !dense) ? 160 : 140, h: 60 };
      let width = w || Math.max(base.w, minWidth || 0);
      let count = 0;

      for (const l of lines)
      {
        const r = wrap(l.text, l.size, bold, width - 20);

        if (w === 0 && r.widest + 24 > width)
        {
          width = Math.min(240, Math.ceil(r.widest + 24));
        }
      }

      for (const l of lines)
      {
        count += wrap(l.text, l.size, bold, width - 20).lines * Math.round(l.size * 1.3);
      }

      w = width;
      h = h || Math.max(base.h, count + 22);
    }
  }

  item.w = w;
  item.h = h;
  item.occW = w;
  item.occH = h;

  if (outside && lines.length > 0)
  {
    let lh = 4;

    for (const l of lines)
    {
      lh += Math.round(l.size * 1.3);
    }

    item.labelW = Math.ceil(widest + 8);
    item.labelH = lh;
    item.occW = Math.max(w, item.labelW);
    item.occH = h + lh;
  }
}

// Boxes of one kind share one size: the size of the fullest one. On a change
// (`kept`: the sizes of the kinds before, by kindKey) a kind keeps its size
// and a box whose text no longer fits grows alone, so the boxes that didn't
// change keep theirs. Returns the size of every kind, by kindKey.
function unifySizes(order, kept)
{
  const groups = new Map();
  const sizes = new Map();

  for (const item of order)
  {
    if (item.children.length > 0 || !item.sized || isOutsideLabel(item.st) || isText(item.st))
    {
      continue;
    }

    const key = kindKey(item.st);

    if (!groups.has(key))
    {
      groups.set(key, []);
    }

    groups.get(key).push(item);
  }

  groups.forEach(function(list, key)
  {
    const before = (kept != null) ? kept.get(key) : null;
    let w = 0;
    let h = 0;

    for (const it of list)
    {
      w = Math.max(w, it.w);
      h = Math.max(h, it.h);
    }

    if (before != null)
    {
      for (const it of list)
      {
        it.w = it.occW = Math.max(it.w, before.w);
        it.h = it.occH = Math.max(it.h, before.h);
      }

      sizes.set(key, { w: before.w, h: before.h });
      return;
    }

    for (const it of list)
    {
      it.w = it.occW = w;
      it.h = it.occH = h;
    }

    sizes.set(key, { w: w, h: h });
  });

  return sizes;
}

// What makes boxes one kind for unifySizes: their shape and its corners.
function kindKey(st)
{
  return st.names.join(",") + "|" + (st.map.shape || "") + "|" + (st.map.arcSize || "");
}

function padding(item, ctx)
{
  const st = item.st;
  const fontSize = Number(st.map.fontSize) || 12;
  const sp = spacing(ctx);
  const pad = sp.pad;

  if (st.names.indexOf("swimlane") >= 0)
  {
    const start = (st.map.startSize != null) ? Number(st.map.startSize) : 23;

    return (st.map.horizontal === "0") ?
      { top: pad, left: start + pad, right: pad, bottom: pad } :
      { top: start + pad, left: pad, right: pad, bottom: pad };
  }

  // Cloud groups and other frames carry their title at the top.
  return { top: Math.max(sp.titleMin, fontSize + sp.title), left: pad, right: pad, bottom: pad };
}

// ─── Graph of one level ──────────────────────────────────────────

function levelGraph(children, level, edges)
{
  const index = new Map();

  children.forEach(function(c, i) { index.set(c, i); });

  const links = [];
  const seen = new Set();

  for (const e of edges)
  {
    const a = liftTo(e.from, level);
    const b = liftTo(e.to, level);

    if (a == null || b == null || a === b || !index.has(a) || !index.has(b))
    {
      continue;
    }

    const key = index.get(a) + ">" + index.get(b);

    if (seen.has(key))
    {
      continue;
    }

    seen.add(key);
    links.push({ from: index.get(a), to: index.get(b), label: e.labelW });
  }

  return links;
}

// Marks the links that close a cycle (a retry, a loop back), in the order a
// reader follows the diagram: depth-first from the first nodes.
function forwardLinks(n, links)
{
  const out = [];

  for (let i = 0; i < n; i++)
  {
    out.push([]);
  }

  links.forEach(function(l) { out[l.from].push(l); });

  const state = new Array(n).fill(0);
  const indeg = new Array(n).fill(0);

  links.forEach(function(l) { indeg[l.to]++; });

  function dfs(v)
  {
    state[v] = 1;

    for (const l of out[v])
    {
      if (state[l.to] === 1)
      {
        l.back = true;
      }
      else if (state[l.to] === 0)
      {
        dfs(l.to);
      }
    }

    state[v] = 2;
  }

  for (let v = 0; v < n; v++)
  {
    if (indeg[v] === 0 && state[v] === 0)
    {
      dfs(v);
    }
  }

  for (let v = 0; v < n; v++)
  {
    if (state[v] === 0)
    {
      dfs(v);
    }
  }

  return links.filter(function(l) { return !l.back; });
}

function topoOrder(n, fwd)
{
  const indeg = new Array(n).fill(0);
  const out = [];

  for (let i = 0; i < n; i++)
  {
    out.push([]);
  }

  fwd.forEach(function(l) { indeg[l.to]++; out[l.from].push(l.to); });

  const done = new Array(n).fill(false);
  const order = [];

  while (order.length < n)
  {
    let pick = -1;

    for (let v = 0; v < n; v++)
    {
      if (!done[v] && indeg[v] === 0)
      {
        pick = v;
        break;
      }
    }

    if (pick < 0)
    {
      break;
    }

    done[pick] = true;
    order.push(pick);
    out[pick].forEach(function(t) { indeg[t]--; });
  }

  return order;
}

// Longest path to a sink: the successor with the longest way to go is the
// main path.
function remaining(n, fwd, order)
{
  const len = new Array(n).fill(0);
  const out = [];

  for (let i = 0; i < n; i++)
  {
    out.push([]);
  }

  fwd.forEach(function(l) { out[l.from].push(l.to); });

  for (let i = order.length - 1; i >= 0; i--)
  {
    const v = order[i];

    for (const t of out[v])
    {
      len[v] = Math.max(len[v], len[t] + 1);
    }
  }

  return len;
}

// ─── Placement without hints ─────────────────────────────────────

// Flow: the main path runs along one line, a branch starts beside the step
// it leaves, a hand-over to another lane stays in the same rank. Returns
// {lane, sub, rank} per node; `laneOf[v]` is the node's lane index (all 0
// without lanes).
function placeFlow(n, links, laneOf)
{
  const fwd = forwardLinks(n, links);
  const order = topoOrder(n, fwd);
  const len = remaining(n, fwd, order);
  const preds = [];
  const succs = [];

  for (let i = 0; i < n; i++)
  {
    preds.push([]);
    succs.push([]);
  }

  fwd.forEach(function(l) { preds[l.to].push(l.from); succs[l.from].push(l.to); });

  // The main successor of every node: the longest way to go, in its own
  // lane when there is one.
  const primary = new Array(n).fill(-1);

  for (let v = 0; v < n; v++)
  {
    let best = -1;

    for (const t of succs[v])
    {
      if (best < 0 || (laneOf[t] === laneOf[v]) > (laneOf[best] === laneOf[v]) ||
        ((laneOf[t] === laneOf[v]) === (laneOf[best] === laneOf[v]) && len[t] > len[best]))
      {
        best = t;
      }
    }

    primary[v] = best;
  }

  const pos = new Array(n).fill(null);
  const taken = new Set();

  function key(lane, sub, rank)
  {
    return lane + "/" + sub + "/" + rank;
  }

  function put(v, lane, sub, rank)
  {
    pos[v] = { lane: lane, sub: sub, rank: rank };
    taken.add(key(lane, sub, rank));
  }

  for (const v of order)
  {
    const lane = laneOf[v];

    if (preds[v].length === 0)
    {
      let sub = 0;

      while (taken.has(key(lane, sub, 0)))
      {
        sub++;
      }

      put(v, lane, sub, 0);
      continue;
    }

    // The predecessor this node continues: one whose main successor it is,
    // else the latest one.
    let p = -1;

    for (const q of preds[v])
    {
      if (primary[q] === v && (p < 0 || primary[p] !== v || pos[q].rank > pos[p].rank))
      {
        p = q;
      }
    }

    if (p < 0)
    {
      for (const q of preds[v])
      {
        if (p < 0 || pos[q].rank > pos[p].rank)
        {
          p = q;
        }
      }
    }

    const pp = pos[p];
    let sub;
    let rank;
    let sideways = false;

    if (laneOf[p] === lane && primary[p] === v)
    {
      sub = pp.sub;
      rank = pp.rank + 1;
    }
    else if (laneOf[p] === lane)
    {
      // A branch: beside the step it leaves, on the free side.
      sub = pp.sub + 1;
      rank = pp.rank;
      sideways = true;
    }
    else
    {
      sub = 0;
      rank = pp.rank;
    }

    for (const q of preds[v])
    {
      const pq = pos[q];

      rank = Math.max(rank, pq.rank + ((laneOf[q] === lane && pq.sub === sub) ? 1 : 0));
    }

    if (sideways)
    {
      // Try the other side before moving down.
      if (taken.has(key(lane, sub, rank)) && pp.sub - 1 >= 0 && !taken.has(key(lane, pp.sub - 1, rank)))
      {
        sub = pp.sub - 1;
      }
    }

    while (taken.has(key(lane, sub, rank)))
    {
      rank++;
    }

    put(v, lane, sub, rank);
  }

  // Nodes on a cycle without an entry (not reached by the order).
  for (let v = 0; v < n; v++)
  {
    if (pos[v] == null)
    {
      let rank = 0;

      while (taken.has(key(laneOf[v], 0, rank)))
      {
        rank++;
      }

      put(v, laneOf[v], 0, rank);
    }
  }

  return pos;
}

// Tiers: every node one rank below its deepest predecessor, the nodes of a
// rank in the order that puts them under what they connect to.
function placeTiers(n, links)
{
  const fwd = forwardLinks(n, links);
  const order = topoOrder(n, fwd);
  const rank = new Array(n).fill(0);
  const preds = [];
  const succs = [];

  for (let i = 0; i < n; i++)
  {
    preds.push([]);
    succs.push([]);
  }

  fwd.forEach(function(l) { preds[l.to].push(l.from); succs[l.from].push(l.to); });

  for (const v of order)
  {
    for (const q of preds[v])
    {
      rank[v] = Math.max(rank[v], rank[q] + 1);
    }
  }

  const tiers = [];

  for (let v = 0; v < n; v++)
  {
    while (tiers.length <= rank[v])
    {
      tiers.push([]);
    }

    tiers[rank[v]].push(v);
  }

  const at = new Array(n).fill(0);

  function index()
  {
    tiers.forEach(function(t) { t.forEach(function(v, i) { at[v] = i; }); });
  }

  function sweep(tier, neighbours)
  {
    const bary = new Map();

    tier.forEach(function(v, i)
    {
      const ns = neighbours[v];
      let sum = 0;

      ns.forEach(function(q) { sum += at[q]; });
      bary.set(v, ns.length > 0 ? sum / ns.length : i);
    });

    tier.sort(function(a, b) { return (bary.get(a) - bary.get(b)) || (a - b); });
  }

  index();

  for (let round = 0; round < 2; round++)
  {
    for (let r = 1; r < tiers.length; r++)
    {
      sweep(tiers[r], preds);
      index();
    }

    for (let r = tiers.length - 2; r >= 0; r--)
    {
      sweep(tiers[r], succs);
      index();
    }
  }

  const pos = [];

  for (let v = 0; v < n; v++)
  {
    pos.push({ rank: rank[v], order: at[v] });
  }

  return pos;
}

// ─── Grid geometry ───────────────────────────────────────────────

// Places items in the cells they were given: `cells[i] = {col, row}` (any
// numbers, only their order counts). Items in one cell stack. Rows are
// centered when `centered` is set (tiers); otherwise columns line up.
function gridGeometry(children, cells, gaps)
{
  const colValues = Array.from(new Set(cells.map(function(c) { return c.col; }))).sort(function(a, b) { return a - b; });
  const rowValues = Array.from(new Set(cells.map(function(c) { return c.row; }))).sort(function(a, b) { return a - b; });
  const grid = new Map();

  children.forEach(function(item, i)
  {
    const c = colValues.indexOf(cells[i].col);
    const r = rowValues.indexOf(cells[i].row);
    const key = c + "/" + r;

    item.gc = c;
    item.gr = r;

    if (!grid.has(key))
    {
      grid.set(key, { c: c, r: r, items: [], w: 0, h: 0 });
    }

    grid.get(key).items.push(item);
  });

  const colW = new Array(colValues.length).fill(0);
  const rowH = new Array(rowValues.length).fill(0);

  grid.forEach(function(cell)
  {
    cell.items.forEach(function(it, i)
    {
      cell.w = Math.max(cell.w, it.occW);
      cell.h += it.occH + (i > 0 ? gaps.stack : 0);
    });

    colW[cell.c] = Math.max(colW[cell.c], cell.w);
    rowH[cell.r] = Math.max(rowH[cell.r], cell.h);
  });

  const colX = [];
  const rowY = [];
  let x = 0;
  let y = 0;

  colW.forEach(function(w, i)
  {
    colX.push(x);
    x += w + (i < colW.length - 1 ? gaps.col[i] : 0);
  });

  rowH.forEach(function(h, i)
  {
    rowY.push(y);
    y += h + (i < rowH.length - 1 ? gaps.row[i] : 0);
  });

  grid.forEach(function(cell)
  {
    let top = rowY[cell.r] + (rowH[cell.r] - cell.h) / 2;

    cell.items.forEach(function(it)
    {
      it.x = Math.round(colX[cell.c] + (colW[cell.c] - it.w) / 2);
      it.y = Math.round(top);
      top += it.occH + gaps.stack;
    });
  });

  return { width: x, height: y, cols: colW.length, rows: rowH.length, colX: colX, colW: colW, rowY: rowY, rowH: rowH };
}

// Frames side by side get one height and frames above each other one width,
// as zones and tiers are drawn. For children that gridGeometry has placed
// (`gc`, `gr`); true when a frame grew, and the grid has to be placed again.
function equalFrames(children)
{
  const count = new Map();
  const frameH = new Map();
  const frameW = new Map();
  let changed = false;

  children.forEach(function(it)
  {
    count.set(it.gc + "/" + it.gr, (count.get(it.gc + "/" + it.gr) || 0) + 1);
  });

  const frames = children.filter(function(it)
  {
    return count.get(it.gc + "/" + it.gr) === 1 && it.children.length > 0 &&
      !it.children.some(function(c) { return c.lane; });
  });

  frames.forEach(function(it)
  {
    frameH.set(it.gr, Math.max(frameH.get(it.gr) || 0, it.h));
    frameW.set(it.gc, Math.max(frameW.get(it.gc) || 0, it.w));
  });

  frames.forEach(function(it)
  {
    if (frameW.get(it.gc) > it.w || frameH.get(it.gr) > it.h)
    {
      stretchFrame(it, frameW.get(it.gc), frameH.get(it.gr));
      changed = true;
    }
  });

  return changed;
}

// Grows a frame to a size. Its children stay at the top and are centered
// across; a frame that holds nothing but one frame grows that one with it.
function stretchFrame(item, w, h)
{
  const dw = Math.max(0, w - item.w);
  const dh = Math.max(0, h - item.h);

  if (dw === 0 && dh === 0)
  {
    return;
  }

  if (item.children.length === 1 && item.children[0].children.length > 0 &&
    !item.children[0].children.some(function(c) { return c.lane; }))
  {
    stretchFrame(item.children[0], item.children[0].w + dw, item.children[0].h + dh);
  }
  else
  {
    item.children.forEach(function(c) { c.x += Math.round(dw / 2); });
  }

  item.w += dw;
  item.h += dh;
  item.occW = item.w;
  item.occH = item.h;
}

// Room between two neighbouring columns or rows: more where a labeled edge
// runs straight across the gap.
function gapsFor(children, cells, links, base)
{
  const colValues = Array.from(new Set(cells.map(function(c) { return c.col; }))).sort(function(a, b) { return a - b; });
  const rowValues = Array.from(new Set(cells.map(function(c) { return c.row; }))).sort(function(a, b) { return a - b; });
  const col = new Array(Math.max(0, colValues.length - 1)).fill(base.col);
  const row = new Array(Math.max(0, rowValues.length - 1)).fill(base.row);

  for (const l of links)
  {
    if (!(l.label > 0))
    {
      continue;
    }

    const a = cells[l.from];
    const b = cells[l.to];
    const ca = colValues.indexOf(a.col);
    const cb = colValues.indexOf(b.col);

    if (a.row === b.row && Math.abs(ca - cb) === 1)
    {
      const i = Math.min(ca, cb);

      col[i] = Math.max(col[i], Math.ceil(l.label + 36));
    }
    else if (a.col === b.col)
    {
      const ra = rowValues.indexOf(a.row);
      const rb = rowValues.indexOf(b.row);

      if (Math.abs(ra - rb) === 1)
      {
        row[Math.min(ra, rb)] = Math.max(row[Math.min(ra, rb)], base.row + 10);
      }
    }
  }

  return { col: col, row: row, stack: base.stack };
}

function fit(size, frame)
{
  return Math.min(frame.width / Math.max(1, size.width), frame.height / Math.max(1, size.height), 1);
}

// How much of a diagram of this size the chat shows, and how large. The
// viewer fits a diagram whole unless that shrinks it below 0.75; then one
// that is taller than wide shows its top at the scale of its width and the
// rest is cut off (computeDefaultViewTransform in the app server). A part
// that isn't shown costs more than small text: the score is the scale times
// the square of the visible share.
const READABLE_SCALE = 0.75;

function shown(size, frame)
{
  const whole = fit(size, frame);
  const byWidth = Math.min(frame.width / Math.max(1, size.width), READABLE_SCALE);

  if (whole >= READABLE_SCALE || byWidth <= whole * 1.05)
  {
    return whole;
  }

  const visible = Math.min(1, frame.height / byWidth / Math.max(1, size.height));

  return byWidth * visible * visible;
}

// Whether the chat cuts the diagram off at the bottom instead of showing it
// whole.
function isCut(size, frame)
{
  const whole = fit(size, frame);

  return whole < READABLE_SCALE && Math.min(frame.width / Math.max(1, size.width), READABLE_SCALE) > whole * 1.05;
}

// A grid for the whole page that would be cut off is made wider instead,
// until the viewer shows it whole (widening costs nothing: the frame has the
// room beside a tall diagram). So it counts with the scale of the whole,
// down to this scale. It was 0.5 until three large diagrams between 0.42 and
// 0.46 were judged both ways: shown whole they scored 7 to 8, cut off 3 to
// 4, since what is cut off counts as missing.
const WHOLE_FROM = 0.3;

function canWiden(size, frame)
{
  return isCut(size, frame) && fit(size, frame) >= WHOLE_FROM;
}

// ─── One container ───────────────────────────────────────────────

function hasHints(children)
{
  return children.some(function(c) { return c.row != null || c.col != null; });
}

// Cells from the hints. A missing row is 1. Children of one row without a
// col stand side by side in the order written, after the columns that are
// named there; a child without any hint goes below the hinted ones, in the
// order written.
function hintedCells(children)
{
  let maxRow = 0;

  children.forEach(function(c)
  {
    if (c.row != null)
    {
      maxRow = Math.max(maxRow, c.row);
    }
  });

  const nextCol = new Map();

  children.forEach(function(c)
  {
    if (c.col != null)
    {
      const row = (c.row != null) ? c.row : 1;

      nextCol.set(row, Math.max(nextCol.get(row) || 0, c.col));
    }
  });

  return children.map(function(c)
  {
    const row = (c.row == null && c.col == null) ? maxRow + 1 : (c.row != null) ? c.row : 1;
    let col = c.col;

    if (col == null)
    {
      col = (nextCol.get(row) || 0) + 1;
      nextCol.set(row, col);
    }

    return { row: row, col: col };
  });
}

function depthOf(level)
{
  let depth = 0;

  for (let p = level; p != null; p = p.parent)
  {
    depth++;
  }

  return depth;
}

// Where the flow runs at one level: the direction asked for at the top, else
// what the policy that is being tried says ("vh": down at the top, to the
// right one level in, down again below that), else null: whichever is shown
// larger in the frame.
function orientationAt(level, ctx)
{
  const depth = depthOf(level);

  if (depth === 0 && ctx.direction != null)
  {
    return ctx.direction;
  }

  const policy = ctx.policy || "";

  if (policy === "")
  {
    return null;
  }

  return policy.charAt(depth % policy.length) === "h" ? "horizontal" : "vertical";
}

// The bands of a tiered level: one per rank, in the order of the ranks, each
// with its items in their order. With `fold`, a run of ranks without
// containers beside a rank with one becomes one band, its items in the order
// of the flow (the clients and the CDN before a VPC, the queue and its
// consumers after it), as long as the band stays within `limit` across the
// flow; and a leaf that nothing follows moves out of a container's rank into
// the band before it.
function tierBands(children, pos, links, fold, acrossOf, gap, limit)
{
  const ranks = [];

  pos.forEach(function(p, v)
  {
    while (ranks.length <= p.rank)
    {
      ranks.push([]);
    }

    ranks[p.rank].push(v);
  });

  ranks.forEach(function(r) { r.sort(function(x, y) { return (pos[x].order - pos[y].order) || (x - y); }); });

  const isLeaf = function(v) { return children[v].children.length === 0; };
  const leafOnly = function(r) { return r.every(isLeaf); };

  if (!fold || ranks.every(leafOnly))
  {
    return ranks.filter(function(r) { return r.length > 0; });
  }

  const hasNext = new Array(children.length).fill(false);

  links.forEach(function(l)
  {
    if (!l.back)
    {
      hasNext[l.from] = true;
    }
  });

  for (let r = 1; r < ranks.length; r++)
  {
    if (!leafOnly(ranks[r]) && leafOnly(ranks[r - 1]) && ranks[r - 1].length > 0)
    {
      const moved = ranks[r].filter(function(v) { return isLeaf(v) && !hasNext[v]; });

      ranks[r] = ranks[r].filter(function(v) { return moved.indexOf(v) < 0; });
      ranks[r - 1] = ranks[r - 1].concat(moved);
    }
  }

  const size = function(list)
  {
    let sum = 0;

    list.forEach(function(v, i) { sum += acrossOf(children[v]) + (i > 0 ? gap : 0); });

    return sum;
  };
  const bands = [];
  let run = null;

  for (const r of ranks)
  {
    if (r.length === 0)
    {
      continue;
    }

    if (!leafOnly(r))
    {
      bands.push(r);
      run = null;
    }
    else if (run != null && size(run.concat(r)) <= limit)
    {
      r.forEach(function(v) { run.push(v); });
    }
    else
    {
      run = r.slice();
      bands.push(run);
    }
  }

  return bands;
}

// Places the bands one after the other along the flow, every band centered
// across it, then moves each item towards the items it connects to in the
// neighbouring bands as far as its neighbours leave room, so that a
// connection between two bands is a straight line where it can be.
function bandGeometry(children, bands, links, vertical, base, shift)
{
  const along = function(it) { return vertical ? it.occH : it.occW; };
  const across = function(it) { return vertical ? it.occW : it.occH; };
  const bandOf = new Array(children.length).fill(-1);
  const placeIn = new Array(children.length).fill(0);

  bands.forEach(function(band, b) { band.forEach(function(v, i) { bandOf[v] = b; placeIn[v] = i; }); });

  // Room between neighbours in a band and between bands: more where a
  // labeled edge runs straight through it.
  const inner = bands.map(function(band) { return new Array(Math.max(0, band.length - 1)).fill(vertical ? base.col : base.stack); });
  const outer = new Array(Math.max(0, bands.length - 1)).fill(vertical ? base.row : base.col);

  for (const l of links)
  {
    const ba = bandOf[l.from];
    const bb = bandOf[l.to];

    if (ba < 0 || bb < 0)
    {
      continue;
    }

    if (ba === bb && Math.abs(placeIn[l.from] - placeIn[l.to]) === 1)
    {
      const i = Math.min(placeIn[l.from], placeIn[l.to]);
      const room = vertical ? (l.label > 0 ? Math.ceil(l.label + 36) : base.col) : (l.label > 0 ? base.row + 10 : Math.max(base.stack, 40));

      inner[ba][i] = Math.max(inner[ba][i], room);
    }
    else if (Math.abs(ba - bb) === 1 && l.label > 0)
    {
      const i = Math.min(ba, bb);

      outer[i] = Math.max(outer[i], vertical ? base.row + 10 : Math.ceil(l.label + 36));
    }
  }

  const bandAlong = bands.map(function(band) { return Math.max.apply(null, band.map(function(v) { return along(children[v]); })); });
  const bandAcross = bands.map(function(band, b)
  {
    let sum = 0;

    band.forEach(function(v, i) { sum += across(children[v]) + (i > 0 ? inner[b][i - 1] : 0); });

    return sum;
  });
  const total = Math.max.apply(null, bandAcross);
  const at = new Array(children.length).fill(0);

  bands.forEach(function(band, b)
  {
    let a = (total - bandAcross[b]) / 2;

    band.forEach(function(v, i)
    {
      at[v] = a;
      a += across(children[v]) + (i < band.length - 1 ? inner[b][i] : 0);
    });
  });

  const near = [];

  for (let v = 0; v < children.length; v++)
  {
    near.push([]);
  }

  links.forEach(function(l)
  {
    if (bandOf[l.from] >= 0 && bandOf[l.to] >= 0 && bandOf[l.from] !== bandOf[l.to])
    {
      near[l.from].push(l.to);
      near[l.to].push(l.from);
    }
  });

  const center = function(v) { return at[v] + across(children[v]) / 2; };

  function align(b, side)
  {
    const band = bands[b];

    band.forEach(function(v, i)
    {
      const others = near[v].filter(function(q) { return side === 0 || (side < 0 ? bandOf[q] < b : bandOf[q] > b); });

      if (others.length === 0)
      {
        return;
      }

      let sum = 0;

      others.forEach(function(q) { sum += center(q); });

      const size = across(children[v]);
      const lo = (i > 0) ? at[band[i - 1]] + across(children[band[i - 1]]) + inner[b][i - 1] : 0;
      const hi = (i < band.length - 1) ? at[band[i + 1]] - inner[b][i] - size : total - size;

      at[v] = Math.max(lo, Math.min(hi, sum / others.length - size / 2));
    });
  }

  for (let round = 0; round < 2; round++)
  {
    for (let b = 1; b < bands.length; b++)
    {
      align(b, round === 0 ? -1 : 0);
    }

    for (let b = bands.length - 2; b >= 0; b--)
    {
      align(b, round === 0 ? 1 : 0);
    }
  }

  let offset = 0;

  bands.forEach(function(band, b)
  {
    band.forEach(function(v)
    {
      const it = children[v];

      if (vertical)
      {
        it.x = Math.round(shift + at[v] + (it.occW - it.w) / 2);
        it.y = Math.round(offset + (bandAlong[b] - it.occH) / 2);
      }
      else
      {
        it.x = Math.round(offset + (bandAlong[b] - it.w) / 2);
        it.y = Math.round(shift + at[v]);
      }
    });

    offset += bandAlong[b] + (b < bands.length - 1 ? outer[b] : 0);
  });

  return vertical ? { width: total, height: offset } : { width: offset, height: total };
}

// Tiers that are longer than the frame continue beside the first ones: the
// bands in `pieces` runs, side by side.
function piecedGeometry(children, bands, links, vertical, base, pieces)
{
  if (pieces <= 1 || bands.length < 2 * pieces)
  {
    return bandGeometry(children, bands, links, vertical, base, 0);
  }

  const per = Math.ceil(bands.length / pieces);
  const gap = (vertical ? base.col : base.row) * 2;
  let across = 0;
  let along = 0;

  for (let i = 0; i < bands.length; i += per)
  {
    const size = bandGeometry(children, bands.slice(i, i + per), links, vertical, base, across);

    across += (vertical ? size.width : size.height) + (i + per < bands.length ? gap : 0);
    along = Math.max(along, vertical ? size.height : size.width);
  }

  return vertical ? { width: across, height: along } : { width: along, height: across };
}

// A flow that is longer than the frame continues at the start of the next
// free column (or row): the cells of `bands` pieces of the main direction
// side by side. `pos[i] = {sub, rank}`.
function snakeCells(pos, bands, vertical)
{
  let ranks = 0;

  pos.forEach(function(p) { ranks = Math.max(ranks, p.rank + 1); });

  const per = Math.ceil(ranks / bands);
  const width = new Array(bands).fill(0);

  pos.forEach(function(p)
  {
    const b = Math.floor(p.rank / per);

    width[b] = Math.max(width[b], p.sub + 1);
  });

  const start = [];
  let sum = 0;

  width.forEach(function(w)
  {
    start.push(sum);
    sum += w;
  });

  return pos.map(function(p)
  {
    const b = Math.floor(p.rank / per);
    const sub = start[b] + p.sub;
    const rank = p.rank - b * per;

    return vertical ? { col: sub, row: rank } : { col: rank, row: sub };
  });
}

function arrange(level, children, ctx)
{
  const links = levelGraph(children, level, ctx.edges);
  const sp = spacing(ctx);
  const base = { col: ctx.iconic ? sp.iconCol : sp.col, row: ctx.iconic ? sp.iconRow : sp.row,
    stack: ctx.iconic ? sp.iconStack : sp.stack };
  const frame = ctx.frame;
  const want = orientationAt(level, ctx);

  if (children.length === 0)
  {
    return { width: 0, height: 0 };
  }

  if (hasHints(children))
  {
    const cells = hintedCells(children);
    const gaps = gapsFor(children, cells, links, base);
    const size = gridGeometry(children, cells, gaps);

    return equalFrames(children) ? gridGeometry(children, cells, gaps) : size;
  }

  const candidates = [];

  function keep(name, size)
  {
    candidates.push({ name: name, size: size, snapshot: children.map(function(c) { return { x: c.x, y: c.y }; }) });
  }

  if (ctx.mode === "flow")
  {
    const pos = placeFlow(children.length, links, new Array(children.length).fill(0));

    for (const vertical of [true, false])
    {
      if (want != null && (want === "vertical") !== vertical)
      {
        continue;
      }

      // One piece, or as many as the frame needs: the first count that fits
      // is the last one tried.
      for (let pieces = 1; pieces <= 4; pieces++)
      {
        const cells = snakeCells(pos, pieces, vertical);
        const size = gridGeometry(children, cells, gapsFor(children, cells, links, base));

        keep((vertical ? "vertical" : "horizontal") + pieces, size);

        if ((vertical ? size.height : size.width) <= (vertical ? frame.height : frame.width))
        {
          break;
        }
      }
    }
  }
  else
  {
    const pos = placeTiers(children.length, links);

    forwardLinks(children.length, links);

    for (const vertical of [true, false])
    {
      if (want != null && (want === "vertical") !== vertical)
      {
        continue;
      }

      const acrossOf = function(it) { return vertical ? it.occW : it.occH; };
      const gap = vertical ? base.col : base.stack;
      let largest = 0;

      children.forEach(function(c)
      {
        if (c.children.length > 0)
        {
          largest = Math.max(largest, acrossOf(c));
        }
      });

      const limit = Math.max(largest, (vertical ? frame.width : frame.height) * 0.6);

      for (const fold of [false, true])
      {
        const bands = tierBands(children, pos, links, fold, acrossOf, gap, limit);

        keep((vertical ? "vertical" : "horizontal") + (fold ? "-folded" : ""), bandGeometry(children, bands, links, vertical, base, 0));
      }

      // Without containers, tiers that don't fit continue beside the first.
      if (children.every(function(c) { return c.children.length === 0; }))
      {
        const bands = tierBands(children, pos, links, false, acrossOf, gap, limit);

        for (let pieces = 2; pieces <= 3; pieces++)
        {
          const last = candidates[candidates.length - 1].size;

          if ((vertical ? last.height : last.width) <= (vertical ? frame.height : frame.width))
          {
            break;
          }

          keep((vertical ? "vertical" : "horizontal") + pieces, piecedGeometry(children, bands, links, vertical, base, pieces));
        }
      }
    }
  }

  // The arrangement that is shown larger in the frame; on a tie the smaller
  // one, else the first.
  let best = candidates[0];

  for (const c of candidates)
  {
    if (shown(c.size, frame) > shown(best.size, frame) + 0.02 ||
      (Math.abs(shown(c.size, frame) - shown(best.size, frame)) <= 0.02 &&
        c.size.width * c.size.height < best.size.width * best.size.height * 0.9))
    {
      best = c;
    }
  }

  children.forEach(function(c, i)
  {
    c.x = best.snapshot[i].x;
    c.y = best.snapshot[i].y;
  });

  return best.size;
}

// Lanes: bands that share one grid. Every lane's children are placed by the
// flow of the whole process; the lanes become columns (the flow runs down)
// or rows (the flow runs right), whichever is shown larger in the frame.
function arrangeLanes(level, lanes, ctx)
{
  const nodes = [];
  const laneOf = [];
  const sp = spacing(ctx);
  const pad = sp.pad;

  lanes.forEach(function(lane, li)
  {
    lane.children.forEach(function(c)
    {
      nodes.push(c);
      laneOf.push(li);
    });
  });

  // Children with hints keep them: col is the step along the flow, shared by
  // all lanes, and row the line within the lane (only its order within the
  // lane counts, so rows counted over the whole page work too).
  const links = [];
  const seen = new Set();
  const index = new Map();

  nodes.forEach(function(c, i) { index.set(c, i); });

  for (const e of ctx.edges)
  {
    let a = e.from;
    let b = e.to;

    while (a != null && !index.has(a))
    {
      a = a.parent;
    }

    while (b != null && !index.has(b))
    {
      b = b.parent;
    }

    if (a == null || b == null || a === b)
    {
      continue;
    }

    const key = index.get(a) + ">" + index.get(b);

    if (!seen.has(key))
    {
      seen.add(key);
      links.push({ from: index.get(a), to: index.get(b), label: e.labelW });
    }
  }

  let pos = placeFlow(nodes.length, links, laneOf);

  if (hasHints(nodes))
  {
    const taken = new Set();

    pos = nodes.map(function(c, i)
    {
      const p = { lane: laneOf[i], sub: (c.row != null) ? c.row : 0, rank: (c.col != null) ? c.col : pos[i].rank };

      // Two steps in one cell: the later one takes a line of its own below.
      while (taken.has(p.lane + "/" + p.rank + "/" + p.sub))
      {
        p.sub += 0.5;
      }

      taken.add(p.lane + "/" + p.rank + "/" + p.sub);

      return p;
    });
  }

  function build(columns)
  {
    // Lanes as columns: sub-columns across, ranks down. As rows: swapped.
    const rankValues = Array.from(new Set(pos.map(function(p) { return p.rank; }))).sort(function(a, b) { return a - b; });
    const rankSize = new Array(rankValues.length).fill(0);
    const laneSubs = lanes.map(function() { return []; });

    pos.forEach(function(p, i)
    {
      const r = rankValues.indexOf(p.rank);
      const it = nodes[i];

      rankSize[r] = Math.max(rankSize[r], columns ? it.occH : it.occW);

      if (laneSubs[p.lane].indexOf(p.sub) < 0)
      {
        laneSubs[p.lane].push(p.sub);
      }
    });

    laneSubs.forEach(function(s) { s.sort(function(a, b) { return a - b; }); });

    // Gaps along the flow: wider where a labeled edge runs along it.
    const rankGap = new Array(Math.max(0, rankValues.length - 1)).fill(columns ? sp.row : sp.col + 10);

    for (const l of links)
    {
      const a = pos[l.from];
      const b = pos[l.to];
      const ra = rankValues.indexOf(a.rank);
      const rb = rankValues.indexOf(b.rank);

      if (l.label > 0 && Math.abs(ra - rb) === 1 && a.lane === b.lane && a.sub === b.sub)
      {
        const i = Math.min(ra, rb);

        rankGap[i] = Math.max(rankGap[i], columns ? sp.row + 10 : Math.ceil(l.label + 36));
      }
    }

    const rankAt = [];
    let along = 0;

    rankSize.forEach(function(s, i)
    {
      rankAt.push(along);
      along += s + (i < rankSize.length - 1 ? rankGap[i] : 0);
    });

    const out = [];
    let across = 0;
    const crossGap = columns ? sp.col : sp.laneCross;

    lanes.forEach(function(lane, li)
    {
      const subs = laneSubs[li];
      const subSize = subs.map(function() { return 0; });

      pos.forEach(function(p, i)
      {
        if (p.lane === li)
        {
          const s = subs.indexOf(p.sub);

          subSize[s] = Math.max(subSize[s], columns ? nodes[i].occW : nodes[i].occH);
        }
      });

      const fontSize = Number(lane.st.map.fontSize) || 12;
      const titleRoom = textWidth(String(lane.cell.value || "").replace(/<[^>]*>/g, ""), fontSize, true) + 24;
      const subAt = [];
      let inner = 0;

      subSize.forEach(function(s, i)
      {
        subAt.push(inner);
        inner += s + (i < subSize.length - 1 ? crossGap : 0);
      });

      // A lane is at least as wide as one step, and (as a column) as its
      // title.
      const min = columns ? Math.max(titleRoom, 140) : 60;
      const extra = Math.max(0, min - inner);
      const size = Math.max(inner, min) + 2 * pad;

      out.push({ lane: lane, at: across, size: size, subs: subs, subAt: subAt, subSize: subSize, shift: extra / 2 });
      across += size;
    });

    return { columns: columns, lanes: out, along: along, across: across, rankValues: rankValues, rankAt: rankAt,
      rankSize: rankSize, width: columns ? across : along + LANE_TITLE + 2 * pad,
      height: columns ? along + LANE_TITLE + 2 * pad : across };
  }

  const asColumns = build(true);
  const asRows = build(false);
  let chosen;

  const want = orientationAt(level, ctx);

  if (want === "vertical")
  {
    chosen = asColumns;
  }
  else if (want === "horizontal")
  {
    chosen = asRows;
  }
  else
  {
    chosen = (shown(asRows, ctx.frame) > shown(asColumns, ctx.frame) + 0.02) ? asRows : asColumns;
  }

  chosen.lanes.forEach(function(l, li)
  {
    const lane = l.lane;

    setKey(lane.st, "startSize", String(LANE_TITLE));

    if (chosen.columns)
    {
      dropKey(lane.st, "horizontal");
      lane.x = l.at;
      lane.y = 0;
      lane.w = l.size;
      lane.h = chosen.height;
    }
    else
    {
      setKey(lane.st, "horizontal", "0");
      lane.x = 0;
      lane.y = l.at;
      lane.w = chosen.width;
      lane.h = l.size;
    }

    lane.occW = lane.w;
    lane.occH = lane.h;
    lane.placed = true;

    pos.forEach(function(p, i)
    {
      if (p.lane !== li)
      {
        return;
      }

      const it = nodes[i];
      const s = l.subs.indexOf(p.sub);
      const r = chosen.rankValues.indexOf(p.rank);

      if (chosen.columns)
      {
        it.x = Math.round(pad + l.shift + l.subAt[s] + (l.subSize[s] - it.w) / 2);
        it.y = Math.round(LANE_TITLE + pad + chosen.rankAt[r] + (chosen.rankSize[r] - it.occH) / 2);
      }
      else
      {
        it.x = Math.round(LANE_TITLE + pad + chosen.rankAt[r] + (chosen.rankSize[r] - it.w) / 2);
        it.y = Math.round(pad + l.shift + l.subAt[s] + (l.subSize[s] - it.occH) / 2);
      }
    });
  });

  return { width: chosen.width, height: chosen.height };
}

// ─── One grid for the page ───────────────────────────────────────

function isInside(item, frame)
{
  for (let p = item.parent; p != null; p = p.parent)
  {
    if (p === frame)
    {
      return true;
    }
  }

  return false;
}

// Places a page whose shapes all name a cell of one grid (`row`, `col`), the
// way a model places them itself: columns as wide and rows as high as their
// fullest cell, a frame around the cells of its members, and between the
// tracks the room that borders, titles and labeled lines need. Lanes are
// bands of that grid: rows (or columns) that each lane has to itself.
// Returns the size, or null when the cells can't be drawn like that: a shape
// without a cell, a frame around a stranger's cell, lanes that share rows
// and columns. `turned` swaps rows and columns: lanes written as rows
// become columns, with every hand-over still straight. `room` is the room
// the lines need in every gap and around the grid (planLines), or null; the
// result's `grid` is what the lines are planned and drawn on.
function placeOnPage(content, lanes, ctx, turned, room)
{
  const sp = spacing(ctx);
  const rowOf = function(l) { return turned ? l.col : l.row; };
  const colOf = function(l) { return turned ? l.row : l.col; };
  const leaves = [];
  const frames = [];

  (function walk(list)
  {
    for (const it of list)
    {
      if (it.children.length > 0)
      {
        frames.push(it);
        walk(it.children);
      }
      else
      {
        leaves.push(it);
      }
    }
  })(content);

  if (leaves.length === 0 || leaves.some(function(l) { return l.row == null || l.col == null; }))
  {
    return null;
  }

  const byNumber = function(a, b) { return a - b; };
  const rowValues = Array.from(new Set(leaves.map(rowOf))).sort(byNumber);
  const colValues = Array.from(new Set(leaves.map(colOf))).sort(byNumber);
  const rows = rowValues.length;
  const cols = colValues.length;
  const cells = new Map();

  for (const l of leaves)
  {
    l.gr = rowValues.indexOf(rowOf(l));
    l.gc = colValues.indexOf(colOf(l));

    const key = l.gc + "/" + l.gr;

    if (!cells.has(key))
    {
      cells.set(key, { c: l.gc, r: l.gr, items: [], w: 0, h: 0 });
    }

    // Two shapes in one cell stack, unless they are in different frames.
    if (cells.get(key).items.length > 0 && cells.get(key).items[0].parent !== l.parent)
    {
      return null;
    }

    cells.get(key).items.push(l);
  }

  // The cells a frame spans, inner frames first.
  for (let i = frames.length - 1; i >= 0; i--)
  {
    const f = frames[i];

    f.r0 = f.c0 = Infinity;
    f.r1 = f.c1 = -Infinity;

    for (const c of f.children)
    {
      const leaf = c.children.length === 0;

      f.r0 = Math.min(f.r0, leaf ? c.gr : c.r0);
      f.r1 = Math.max(f.r1, leaf ? c.gr : c.r1);
      f.c0 = Math.min(f.c0, leaf ? c.gc : c.c0);
      f.c1 = Math.max(f.c1, leaf ? c.gc : c.c1);
    }
  }

  let bands = null;

  if (lanes != null)
  {
    if (lanes.some(function(l) { return l.children.some(function(c) { return c.children.length > 0; }); }))
    {
      return null;
    }

    const apart = function(from, to)
    {
      const sorted = lanes.slice().sort(function(a, b) { return a[from] - b[from]; });

      return sorted.every(function(l, i) { return i === 0 || l[from] > sorted[i - 1][to]; }) ? sorted : null;
    };

    const asRows = apart("r0", "r1");
    const asCols = apart("c0", "c1");

    if (asRows == null && asCols == null)
    {
      return null;
    }

    bands = (asRows != null) ? { rows: true, lanes: asRows } : { rows: false, lanes: asCols };
  }
  else
  {
    for (const f of frames)
    {
      for (const l of leaves)
      {
        if (l.gr >= f.r0 && l.gr <= f.r1 && l.gc >= f.c0 && l.gc <= f.c1 && !isInside(l, f))
        {
          return null;
        }
      }
    }
  }

  const stack = ctx.iconic ? sp.iconStack : sp.stack;
  const colW = new Array(cols).fill(0);
  const rowH = new Array(rows).fill(0);
  const iconH = new Array(rows).fill(0);

  cells.forEach(function(cell)
  {
    cell.items.forEach(function(it, i)
    {
      cell.w = Math.max(cell.w, it.occW);
      cell.h += it.occH + (i > 0 ? stack : 0);
    });

    colW[cell.c] = Math.max(colW[cell.c], cell.w);
    rowH[cell.r] = Math.max(rowH[cell.r], cell.h);

    if (cell.items.length === 1 && isOutsideLabel(cell.items[0].st))
    {
      iconH[cell.r] = Math.max(iconH[cell.r], cell.h);
    }
  });

  // The room a frame's borders and title take outside its first and last
  // cells: its own padding plus that of the frames that start or end there.
  const left = new Array(cols).fill(0);
  const right = new Array(cols).fill(0);
  const top = new Array(rows).fill(0);
  const bottom = new Array(rows).fill(0);
  const colGap = new Array(Math.max(0, cols - 1)).fill(0);
  const rowGap = new Array(Math.max(0, rows - 1)).fill(0);
  const lineRoom = room || { col: new Array(cols + 1).fill(0), row: new Array(rows + 1).fill(0) };

  // Around the grid: nothing without lines there. Lanes reach to the edge
  // of the page, so their lines run inside them.
  const rim = { left: lineRoom.col[0], right: lineRoom.col[cols], top: lineRoom.row[0], bottom: lineRoom.row[rows] };

  // Before the first row or column of every lane but the first: the border
  // and, on the lane's side of it, the room for lines.
  const lead = new Map();

  if (bands == null)
  {
    for (let i = frames.length - 1; i >= 0; i--)
    {
      const f = frames[i];
      const pad = padding(f, ctx);
      const lines = (lineRoom.frames != null && lineRoom.frames.get(f)) || { left: 0, right: 0, top: 0, bottom: 0 };

      // What its inner frames take on each side, and outside of that its
      // own padding, or the room of the lines that run along its border.
      f.inner = { left: 0, right: 0, top: 0, bottom: 0 };

      for (const c of f.children)
      {
        if (c.children.length > 0)
        {
          f.inner.left = Math.max(f.inner.left, c.c0 === f.c0 ? c.dl : 0);
          f.inner.right = Math.max(f.inner.right, c.c1 === f.c1 ? c.dr : 0);
          f.inner.top = Math.max(f.inner.top, c.r0 === f.r0 ? c.dt : 0);
          f.inner.bottom = Math.max(f.inner.bottom, c.r1 === f.r1 ? c.db : 0);
        }
      }

      f.lines = { left: Math.max(pad.left, lines.left), right: Math.max(pad.right, lines.right),
        top: Math.max(sp.pad, lines.top), bottom: Math.max(pad.bottom, lines.bottom) };
      f.dl = f.inner.left + f.lines.left;
      f.dr = f.inner.right + f.lines.right;
      f.dt = f.inner.top + f.lines.top + (pad.top - sp.pad);
      f.db = f.inner.bottom + f.lines.bottom;

      left[f.c0] = Math.max(left[f.c0], f.dl);
      right[f.c1] = Math.max(right[f.c1], f.dr);
      top[f.r0] = Math.max(top[f.r0], f.dt);
      bottom[f.r1] = Math.max(bottom[f.r1], f.db);
    }

    const baseCol = ctx.iconic ? sp.iconCol : sp.col;
    const baseRow = ctx.iconic ? sp.iconRow : sp.row;

    // Two borders that face each other need less room between them than
    // two shapes do.
    for (let c = 0; c < cols - 1; c++)
    {
      colGap[c] = Math.max((right[c] > 0 && left[c + 1] > 0) ? Math.min(baseCol, 30) : baseCol, lineRoom.col[c + 1]) +
        right[c] + left[c + 1];
    }

    for (let r = 0; r < rows - 1; r++)
    {
      rowGap[r] = Math.max((bottom[r] > 0 && top[r + 1] > 0) ? Math.min(baseRow, 30) : baseRow, lineRoom.row[r + 1]) +
        bottom[r] + top[r + 1];
    }
  }
  else if (bands.rows)
  {
    for (let c = 0; c < cols - 1; c++)
    {
      colGap[c] = Math.max(sp.col + 10, lineRoom.col[c + 1]);
    }

    for (let r = 0; r < rows - 1; r++)
    {
      rowGap[r] = Math.max(sp.laneCross, lineRoom.row[r + 1]);
    }

    bands.lanes.forEach(function(l, i)
    {
      if (i > 0)
      {
        lead.set(l, Math.max(sp.pad, lineRoom.row[l.r0]));
        rowGap[l.r0 - 1] = sp.pad + lead.get(l);
      }
    });
    left[0] = LANE_TITLE + Math.max(sp.pad, rim.left);
    right[cols - 1] = Math.max(sp.pad, rim.right);
    top[0] = Math.max(sp.pad, rim.top);
    bottom[rows - 1] = Math.max(sp.pad, rim.bottom);
    rim.left = rim.right = rim.top = rim.bottom = 0;
  }
  else
  {
    for (let c = 0; c < cols - 1; c++)
    {
      colGap[c] = Math.max(sp.col, lineRoom.col[c + 1]);
    }

    for (let r = 0; r < rows - 1; r++)
    {
      rowGap[r] = Math.max(sp.row, lineRoom.row[r + 1]);
    }

    bands.lanes.forEach(function(l, i)
    {
      if (i > 0)
      {
        lead.set(l, Math.max(sp.pad, lineRoom.col[l.c0]));
        colGap[l.c0 - 1] = sp.pad + lead.get(l);
      }
    });
    left[0] = Math.max(sp.pad, rim.left);
    right[cols - 1] = Math.max(sp.pad, rim.right);
    top[0] = LANE_TITLE + Math.max(sp.pad, rim.top);
    bottom[rows - 1] = Math.max(sp.pad, rim.bottom);
    rim.left = rim.right = rim.top = rim.bottom = 0;
  }

  // A labeled line straight across a gap needs room for its label, clear of
  // the borders in that gap: between the frames that end and begin there,
  // or on the far side of the border between two lanes.
  for (const e of ctx.edges)
  {
    const a = e.from;
    const b = e.to;

    if (!(e.labelW > 0))
    {
      continue;
    }

    // So does one from a shape to the frame beside it: its label stands
    // between the shape and the border, not on the border.
    if ((a.children.length > 0) !== (b.children.length > 0))
    {
      const f = (a.children.length > 0) ? a : b;
      const l = (f === a) ? b : a;

      if (bands != null || l.gr == null || f.r0 == null)
      {
        continue;
      }

      if (l.gr >= f.r0 && l.gr <= f.r1 && (l.gc === f.c0 - 1 || l.gc === f.c1 + 1))
      {
        const c = Math.min(l.gc, f.c1);

        colGap[c] = Math.max(colGap[c], Math.ceil(e.labelW + 20 + right[c] + left[c + 1]));
      }
      else if (l.gc >= f.c0 && l.gc <= f.c1 && (l.gr === f.r0 - 1 || l.gr === f.r1 + 1))
      {
        const r = Math.min(l.gr, f.r1);

        rowGap[r] = Math.max(rowGap[r], (e.labelH || 18) + 30 + bottom[r] + top[r + 1]);
      }

      continue;
    }

    if (a.children.length > 0 || b.children.length > 0 || a.gr == null || b.gr == null)
    {
      continue;
    }

    if (a.gr === b.gr && Math.abs(a.gc - b.gc) === 1)
    {
      const c = Math.min(a.gc, b.gc);
      const lane = (bands != null && !bands.rows) ? bands.lanes.filter(function(l) { return lead.has(l) && l.c0 === c + 1; })[0] : null;

      if (lane != null)
      {
        lead.set(lane, Math.max(lead.get(lane), Math.ceil(e.labelW + 18)));
        colGap[c] = Math.max(colGap[c], sp.pad + lead.get(lane));
      }
      else
      {
        colGap[c] = Math.max(colGap[c], Math.ceil(e.labelW + (bands == null ? 20 + right[c] + left[c + 1] : 36)));
      }
    }
    else if (a.gc === b.gc && Math.abs(a.gr - b.gr) === 1)
    {
      const r = Math.min(a.gr, b.gr);
      const lane = (bands != null && bands.rows) ? bands.lanes.filter(function(l) { return lead.has(l) && l.r0 === r + 1; })[0] : null;

      if (lane != null)
      {
        lead.set(lane, Math.max(lead.get(lane), (e.labelH || 18) + 24));
        rowGap[r] = Math.max(rowGap[r], sp.pad + lead.get(lane));
      }
      else
      {
        rowGap[r] = Math.max(rowGap[r], (bands == null) ? (e.labelH || 18) + 30 + bottom[r] + top[r + 1] :
          (ctx.iconic ? sp.iconRow : sp.row) + 10);
      }
    }
  }

  const span = function(sizes, gaps, from, to)
  {
    let total = 0;

    for (let i = from; i <= to; i++)
    {
      total += sizes[i] + (i < to ? gaps[i] : 0);
    }

    return total;
  };

  const widen = function(sizes, from, to, by)
  {
    for (let i = from; i <= to; i++)
    {
      sizes[i] += by / (to - from + 1);
    }
  };

  const titleOf = function(item)
  {
    return textWidth(String(item.cell.value || "").replace(/<[^>]*>/g, ""), Number(item.st.map.fontSize) || 12, true);
  };

  // Room for titles: a frame is as wide as its title, a lane as long as its
  // (turned) title and at least as wide as one step.
  if (bands == null)
  {
    for (let i = frames.length - 1; i >= 0; i--)
    {
      const f = frames[i];
      const need = titleOf(f) + 60 - (span(colW, colGap, f.c0, f.c1) + f.dl + f.dr);

      if (need > 0)
      {
        widen(colW, f.c0, f.c1, need);
      }
    }
  }
  else
  {
    for (const l of bands.lanes)
    {
      const need = bands.rows ?
        titleOf(l) + 24 - (span(rowH, rowGap, l.r0, l.r1) + 2 * sp.pad) :
        Math.max(titleOf(l) + 24, 140) - (span(colW, colGap, l.c0, l.c1) + 2 * sp.pad);

      if (need > 0)
      {
        widen(bands.rows ? rowH : colW, bands.rows ? l.r0 : l.c0, bands.rows ? l.r1 : l.c1, need);
      }
    }
  }

  // As wide as asked for (a tall diagram that the chat should show whole).
  if (ctx.minWidth > 0)
  {
    const now = rim.left + left[0] + span(colW, colGap, 0, cols - 1) + right[cols - 1] + rim.right;

    if (ctx.minWidth > now)
    {
      widen(colW, 0, cols - 1, ctx.minWidth - now);
    }
  }

  // A change of a diagram laid out before (ctx.keep): every column and row
  // the model numbered as before keeps at least its size and stays centered
  // where it was, unless what comes before it now needs more room, so only
  // what has to make room moves (keptAxis).
  const keepX = (ctx.keep != null) ? keptAxis(ctx.keep.x, colValues, colW) : null;
  const keepY = (ctx.keep != null) ? keptAxis(ctx.keep.y, rowValues, rowH) : null;
  const colX = [];
  const rowY = [];
  let x = rim.left + left[0];
  let y = rim.top + top[0];

  for (let c = 0; c < cols; c++)
  {
    if (keepX != null && keepX[c] != null)
    {
      x = Math.max(x, keepX[c] - colW[c] / 2);
    }

    colX.push(x);
    x += colW[c] + (c < cols - 1 ? colGap[c] : right[c]);
  }

  for (let r = 0; r < rows; r++)
  {
    if (keepY != null && keepY[r] != null)
    {
      y = Math.max(y, keepY[r] - rowH[r] / 2);
    }

    rowY.push(y);
    y += rowH[r] + (r < rows - 1 ? rowGap[r] : bottom[r]);
  }

  // A change that made the page tall enough to be cut off: the page is made
  // as wide as asked for (ctx.keepWidth) without moving a shape against
  // another, so the chat shows it whole. A lane diagram is made wider at its
  // end, where the lanes reach; on any other page the columns move together,
  // to the middle of the wider page, with the gaps beside them, so the lines
  // run where they did. The chat fits the diagram again, which hides a shift
  // that every shape shares, and the layout of the result is written
  // without it (`shift`).
  let shift = 0;
  let padRight = 0;

  if (ctx.keep != null && ctx.keepWidth > 0 && x + rim.right < ctx.keepWidth)
  {
    const more = ctx.keepWidth - (x + rim.right);

    if (bands != null)
    {
      rim.right += more;
    }
    else
    {
      shift = Math.floor(more / 2);
      padRight = more - shift;

      for (let c = 0; c < cols; c++)
      {
        colX[c] += shift;
      }

      x += shift;
      rim.right += padRight;
    }
  }

  const width = Math.ceil(x + rim.right);
  const height = Math.ceil(y + rim.bottom);

  // Shapes in the middle of their cell; icons of one row at one height, so
  // that the lines between them are straight.
  cells.forEach(function(cell)
  {
    const icon = cell.items.length === 1 && isOutsideLabel(cell.items[0].st);
    let at = rowY[cell.r] + (rowH[cell.r] - (icon ? iconH[cell.r] : cell.h)) / 2;

    cell.items.forEach(function(it)
    {
      it.ax = Math.round(colX[cell.c] + (colW[cell.c] - it.w) / 2);
      it.ay = Math.round(at);
      at += it.occH + stack;
    });
  });

  if (bands == null)
  {
    for (const f of frames)
    {
      f.ax = Math.round(colX[f.c0] - f.dl);
      f.ay = Math.round(rowY[f.r0] - f.dt);
      f.w = Math.round(colX[f.c1] + colW[f.c1] + f.dr) - f.ax;
      f.h = Math.round(rowY[f.r1] + rowH[f.r1] + f.db) - f.ay;

      // Where its title is, for the lines: in the middle, or with a group
      // icon in the left corner.
      const title = titleOf(f);

      f.titleFrom = (f.st.map.align === "left") ? f.ax : f.ax + (f.w - title) / 2;
      f.titleTo = (f.st.map.align === "left") ? f.ax + (Number(f.st.map.spacingLeft) || 0) + title + 8 :
        f.titleFrom + title;
    }
  }
  else
  {
    bands.lanes.forEach(function(l, i)
    {
      const next = bands.lanes[i + 1];

      setKey(l.st, "startSize", String(LANE_TITLE));
      l.placed = true;

      if (bands.rows)
      {
        setKey(l.st, "horizontal", "0");
        l.ax = 0;
        l.ay = (i === 0) ? 0 : Math.round(rowY[l.r0] - lead.get(l));
        l.w = width;
        l.h = ((next != null) ? Math.round(rowY[next.r0] - lead.get(next)) : height) - l.ay;
      }
      else
      {
        dropKey(l.st, "horizontal");
        l.ax = (i === 0) ? 0 : Math.round(colX[l.c0] - lead.get(l));
        l.ay = 0;
        l.w = ((next != null) ? Math.round(colX[next.c0] - lead.get(next)) : width) - l.ax;
        l.h = height;
      }
    });
  }

  for (const it of frames.concat(leaves))
  {
    it.x = it.ax - (it.parent != null ? it.parent.ax : 0);
    it.y = it.ay - (it.parent != null ? it.parent.ay : 0);

    if (it.children.length > 0)
    {
      it.occW = it.w;
      it.occH = it.h;
    }
  }

  // The room for lines in every gap: between what borders it on both sides
  // (shapes, or the frames that end and begin there).
  const vz = [];
  const hz = [];

  for (let g = 0; g <= cols; g++)
  {
    const from = (g === 0) ? ((bands != null && bands.rows) ? LANE_TITLE : shift) : colX[g - 1] + colW[g - 1] + (bands == null ? right[g - 1] : 0);
    const to = (g === cols) ? width - padRight : colX[g] - (bands == null ? left[g] : 0);

    vz.push({ from: from, to: to });
  }

  for (let h = 0; h <= rows; h++)
  {
    const from = (h === 0) ? ((bands != null && !bands.rows) ? LANE_TITLE : 0) : rowY[h - 1] + rowH[h - 1] + (bands == null ? bottom[h - 1] : 0);
    const to = (h === rows) ? height : rowY[h] - (bands == null ? top[h] : 0);

    hz.push({ from: from, to: to });
  }

  if (bands != null)
  {
    bands.lanes.forEach(function(l)
    {
      if (lead.has(l))
      {
        const zone = bands.rows ? hz[l.r0] : vz[l.c0];

        zone.from = zone.to - lead.get(l);
      }
    });
  }

  const px = [];
  const py = [];

  for (let X = 0; X <= 2 * cols; X++)
  {
    px.push((X & 1) === 1 ? colX[X >> 1] + colW[X >> 1] / 2 : (vz[X >> 1].from + vz[X >> 1].to) / 2);
  }

  for (let Y = 0; Y <= 2 * rows; Y++)
  {
    py.push((Y & 1) === 1 ? rowY[Y >> 1] + rowH[Y >> 1] / 2 : (hz[Y >> 1].from + hz[Y >> 1].to) / 2);
  }

  // The room inside a frame's border, between it and what the frame holds.
  const zone = function(f, side)
  {
    const at = (side === "left") ? colX[f.c0] - f.inner.left : (side === "right") ? colX[f.c1] + colW[f.c1] + f.inner.right :
      (side === "top") ? rowY[f.r0] - f.inner.top : rowY[f.r1] + rowH[f.r1] + f.inner.bottom;

    return (side === "left" || side === "top") ? { from: at - f.lines[side], to: at } : { from: at, to: at + f.lines[side] };
  };

  return { width: width, height: height, grid: { cols: cols, rows: rows, leaves: leaves, frames: frames,
    bands: bands != null, colX: colX, colW: colW, rowY: rowY, rowH: rowH, vz: vz, hz: hz, px: px, py: py, zone: zone,
    colValues: colValues, rowValues: rowValues, shift: shift } };
}

/**
 * The centers a change keeps on one axis of the page's grid: for every
 * column (or row) of the new grid whose number the model gave before, the
 * center it had, and its size grown to at least the size it had. `kept` is
 * the axis of the earlier layout ({m, c, s}: the model's number, the center
 * and the size), `values` the model's numbers of the new grid in order.
 * Sizes never shrink on a change, so a step that went away leaves its room
 * and the ones beside it stay; a number that is new gets the room it needs
 * and moves what comes after it.
 */
function keptAxis(kept, values, sizes)
{
  if (!Array.isArray(kept) || kept.length === 0)
  {
    return null;
  }

  const byValue = new Map(kept.map(function(k) { return [k.m, k]; }));
  const centers = [];
  let any = false;

  values.forEach(function(m, i)
  {
    const k = byValue.get(m);

    if (k != null)
    {
      sizes[i] = Math.max(sizes[i], k.s);
      centers.push(k.c);
      any = true;
    }
    else
    {
      centers.push(null);
    }
  });

  return any ? centers : null;
}

// A model that counts cells sometimes leaves a shape inside the block of a
// group it doesn't belong to (a queue in the corner of an L-shaped VPC).
// Such a shape moves out by the shortest way, into a row or column of its
// own next to the frame, so the frame can be drawn. Returns false when that
// doesn't settle.
function moveStrangers(content)
{
  const leaves = [];
  const frames = [];

  (function walk(list)
  {
    for (const it of list)
    {
      if (it.children.length > 0)
      {
        frames.push(it);
        walk(it.children);
      }
      else
      {
        leaves.push(it);
      }
    }
  })(content);

  if (leaves.some(function(l) { return l.row == null || l.col == null; }))
  {
    return false;
  }

  for (let round = 0; round < 12; round++)
  {
    for (let i = frames.length - 1; i >= 0; i--)
    {
      const f = frames[i];

      f.vr0 = f.vc0 = Infinity;
      f.vr1 = f.vc1 = -Infinity;

      for (const c of f.children)
      {
        const leaf = c.children.length === 0;

        f.vr0 = Math.min(f.vr0, leaf ? c.row : c.vr0);
        f.vr1 = Math.max(f.vr1, leaf ? c.row : c.vr1);
        f.vc0 = Math.min(f.vc0, leaf ? c.col : c.vc0);
        f.vc1 = Math.max(f.vc1, leaf ? c.col : c.vc1);
      }
    }

    let moved = false;

    for (const f of frames)
    {
      for (const l of leaves)
      {
        if (l.row < f.vr0 || l.row > f.vr1 || l.col < f.vc0 || l.col > f.vc1 || isInside(l, f))
        {
          continue;
        }

        const down = f.vr1 - l.row;
        const up = l.row - f.vr0;
        const right = f.vc1 - l.col;
        const left = l.col - f.vc0;
        const least = Math.min(down, up, right, left);

        if (least === down)
        {
          l.row = f.vr1 + 0.5;
        }
        else if (least === up)
        {
          l.row = f.vr0 - 0.5;
        }
        else if (least === right)
        {
          l.col = f.vc1 + 0.5;
        }
        else
        {
          l.col = f.vc0 - 0.5;
        }

        moved = true;
      }

      if (moved)
      {
        break;
      }
    }

    if (!moved)
    {
      return true;
    }
  }

  return false;
}

// When the page's cells can't be drawn as one grid, every frame lays out its
// own members by their cells, and takes the first cell of its members among
// its siblings.
function inheritCells(content)
{
  (function walk(list)
  {
    for (const it of list)
    {
      if (it.children.length > 0)
      {
        walk(it.children);

        const rowsOf = it.children.map(function(c) { return c.row; }).filter(function(v) { return v != null; });
        const colsOf = it.children.map(function(c) { return c.col; }).filter(function(v) { return v != null; });

        it.row = rowsOf.length > 0 ? Math.min.apply(null, rowsOf) : it.row;
        it.col = colsOf.length > 0 ? Math.min.apply(null, colsOf) : it.col;
      }
    }
  })(content);
}

function layoutContainer(item, ctx)
{
  // Children first, so that a container knows their sizes.
  for (const c of item.children)
  {
    if (c.children.length > 0)
    {
      layoutContainer(c, ctx);
    }
  }

  const lanes = item.children.filter(function(c) { return c.lane && c.children.length > 0; });

  if (lanes.length >= 2 && lanes.length === item.children.length)
  {
    const size = arrangeLanes(item, lanes, ctx);
    const pad = padding(item, ctx);

    item.children.forEach(function(c) { c.x += pad.left; c.y += pad.top; });
    item.w = Math.ceil(size.width + pad.left + pad.right);
    item.h = Math.ceil(size.height + pad.top + pad.bottom);
  }
  else
  {
    const size = arrange(item, item.children, ctx);
    const pad = padding(item, ctx);
    const fontSize = Number(item.st.map.fontSize) || 12;
    const title = textWidth(String(item.cell.value || "").replace(/<[^>]*>/g, ""), fontSize, true) + 60;
    const width = Math.max(size.width, title - pad.left - pad.right);
    const shift = (width - size.width) / 2;

    item.children.forEach(function(c) { c.x = Math.round(c.x + pad.left + shift); c.y += pad.top; });
    item.w = Math.ceil(width + pad.left + pad.right);
    item.h = Math.ceil(size.height + pad.top + pad.bottom);
  }

  item.occW = item.w;
  item.occH = item.h;
}

// ─── Edges ───────────────────────────────────────────────────────

function absolute(item)
{
  let x = item.x;
  let y = item.y;
  let p = item.parent;

  while (p != null)
  {
    x += p.x;
    y += p.y;
    p = p.parent;
  }

  return { x: x, y: y, w: item.w, h: item.h };
}

function segmentHitsRect(a, b, r, margin)
{
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);

  return x2 > r.x - margin && x1 < r.x + r.w + margin && y2 > r.y - margin && y1 < r.y + r.h + margin;
}

// How much two segments run on each other (same line, overlapping), and
// whether they cross.
function overlap(a1, a2, b1, b2)
{
  const aH = a1.y === a2.y;
  const bH = b1.y === b2.y;

  if (aH && bH && Math.abs(a1.y - b1.y) < 4)
  {
    return Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) - Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x));
  }

  if (!aH && !bH && Math.abs(a1.x - b1.x) < 4)
  {
    return Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) - Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y));
  }

  return 0;
}

function crosses(a1, a2, b1, b2)
{
  const aH = a1.y === a2.y;
  const bH = b1.y === b2.y;

  if (aH === bH)
  {
    return false;
  }

  const h1 = aH ? a1 : b1;
  const h2 = aH ? a2 : b2;
  const v1 = aH ? b1 : a1;
  const v2 = aH ? b2 : a2;

  return v1.x > Math.min(h1.x, h2.x) + 1 && v1.x < Math.max(h1.x, h2.x) - 1 &&
    h1.y > Math.min(v1.y, v2.y) + 1 && h1.y < Math.max(v1.y, v2.y) - 1;
}

// The ways from S to T worth trying: straight, one bend, two bends through
// the gap, around on one side. Each is {points, exit, entry} with exit and
// entry as [x, y] fractions of the shapes.
function candidates(S, T)
{
  const list = [];
  const scx = S.x + S.w / 2;
  const scy = S.y + S.h / 2;
  const tcx = T.x + T.w / 2;
  const tcy = T.y + T.h / 2;
  const right = T.x >= S.x + S.w;
  const left = T.x + T.w <= S.x;
  const below = T.y >= S.y + S.h;
  const above = T.y + T.h <= S.y;

  function add(points, exit, entry, bends)
  {
    list.push({ points: points, exit: exit, entry: entry, bends: bends });
  }

  // Straight, where the shapes face each other.
  const ox1 = Math.max(S.x, T.x);
  const ox2 = Math.min(S.x + S.w, T.x + T.w);

  if (ox2 - ox1 >= Math.min(20, Math.min(S.w, T.w) * 0.5) && (below || above))
  {
    const x = (Math.abs(scx - tcx) < 1) ? scx : (tcx > ox1 + 4 && tcx < ox2 - 4) ? tcx :
      (scx > ox1 + 4 && scx < ox2 - 4) ? scx : (ox1 + ox2) / 2;

    add([{ x: x, y: below ? S.y + S.h : S.y }, { x: x, y: below ? T.y : T.y + T.h }],
      [(x - S.x) / S.w, below ? 1 : 0], [(x - T.x) / T.w, below ? 0 : 1], 0);
  }

  const oy1 = Math.max(S.y, T.y);
  const oy2 = Math.min(S.y + S.h, T.y + T.h);

  if (oy2 - oy1 >= Math.min(20, Math.min(S.h, T.h) * 0.5) && (right || left))
  {
    const y = (Math.abs(scy - tcy) < 1) ? scy : (tcy > oy1 + 4 && tcy < oy2 - 4) ? tcy :
      (scy > oy1 + 4 && scy < oy2 - 4) ? scy : (oy1 + oy2) / 2;

    add([{ x: right ? S.x + S.w : S.x, y: y }, { x: right ? T.x : T.x + T.w, y: y }],
      [right ? 1 : 0, (y - S.y) / S.h], [right ? 0 : 1, (y - T.y) / T.h], 0);
  }

  // One bend.
  if ((tcx > S.x + S.w + 8 || tcx < S.x - 8) && (scy < T.y - 8 || scy > T.y + T.h + 8))
  {
    const toRight = tcx > scx;
    const down = scy < T.y;

    add([{ x: toRight ? S.x + S.w : S.x, y: scy }, { x: tcx, y: scy }, { x: tcx, y: down ? T.y : T.y + T.h }],
      [toRight ? 1 : 0, 0.5], [0.5, down ? 0 : 1], 1);
  }

  if ((tcy > S.y + S.h + 8 || tcy < S.y - 8) && (scx < T.x - 8 || scx > T.x + T.w + 8))
  {
    const down = tcy > scy;
    const toRight = scx < T.x;

    add([{ x: scx, y: down ? S.y + S.h : S.y }, { x: scx, y: tcy }, { x: toRight ? T.x : T.x + T.w, y: tcy }],
      [0.5, down ? 1 : 0], [toRight ? 0 : 1, 0.5], 1);
  }

  // Two bends through the gap between the shapes.
  if (right || left)
  {
    const from = right ? S.x + S.w : S.x;
    const to = right ? T.x : T.x + T.w;

    for (const f of [0.5, 0.3, 0.7])
    {
      const mx = Math.round(from + (to - from) * f);

      add([{ x: from, y: scy }, { x: mx, y: scy }, { x: mx, y: tcy }, { x: to, y: tcy }],
        [right ? 1 : 0, 0.5], [right ? 0 : 1, 0.5], 2);
    }
  }

  if (below || above)
  {
    const from = below ? S.y + S.h : S.y;
    const to = below ? T.y : T.y + T.h;

    for (const f of [0.5, 0.3, 0.7])
    {
      const my = Math.round(from + (to - from) * f);

      add([{ x: scx, y: from }, { x: scx, y: my }, { x: tcx, y: my }, { x: tcx, y: to }],
        [0.5, below ? 1 : 0], [0.5, below ? 0 : 1], 2);
    }
  }

  // Around, leaving and arriving on the same side.
  for (const d of [24, 40])
  {
    const xr = Math.max(S.x + S.w, T.x + T.w) + d;
    const xl = Math.min(S.x, T.x) - d;
    const yb = Math.max(S.y + S.h, T.y + T.h) + d;
    const yt = Math.min(S.y, T.y) - d;

    add([{ x: S.x + S.w, y: scy }, { x: xr, y: scy }, { x: xr, y: tcy }, { x: T.x + T.w, y: tcy }], [1, 0.5], [1, 0.5], 2.5);
    add([{ x: S.x, y: scy }, { x: xl, y: scy }, { x: xl, y: tcy }, { x: T.x, y: tcy }], [0, 0.5], [0, 0.5], 2.5);
    add([{ x: scx, y: S.y + S.h }, { x: scx, y: yb }, { x: tcx, y: yb }, { x: tcx, y: T.y + T.h }], [0.5, 1], [0.5, 1], 2.5);
    add([{ x: scx, y: S.y }, { x: scx, y: yt }, { x: tcx, y: yt }, { x: tcx, y: T.y }], [0.5, 0], [0.5, 0], 2.5);
  }

  return list;
}

function sideOf(port)
{
  return port[0] === 0 ? "W" : port[0] === 1 ? "E" : port[1] === 0 ? "N" : "S";
}

function routeEdges(graph, tree, ctx)
{
  const model = graph.getModel();
  const rects = new Map();
  const obstacles = [];

  for (const item of tree.order)
  {
    const r = absolute(item);

    rects.set(item, r);

    if (item.children.length === 0)
    {
      obstacles.push({ item: item, r: r });

      if (item.labelH > 0)
      {
        obstacles.push({ item: item, label: true,
          r: { x: r.x + r.w / 2 - item.labelW / 2, y: r.y + r.h, w: item.labelW, h: item.labelH } });
      }
    }
  }

  function isRelated(a, b)
  {
    for (let p = a; p != null; p = p.parent)
    {
      if (p === b)
      {
        return true;
      }
    }

    return false;
  }

  const jobs = [];

  for (const e of ctx.edges)
  {
    const st = parseStyle(e.cell.style);

    if (st.map.edgeStyle !== "orthogonalEdgeStyle")
    {
      continue;
    }

    const S = rects.get(e.from);
    const T = rects.get(e.to);

    if (S == null || T == null || e.from === e.to || isRelated(e.from, e.to) || isRelated(e.to, e.from))
    {
      continue;
    }

    jobs.push({ e: e, st: st, S: S, T: T,
      d: Math.abs(S.x + S.w / 2 - T.x - T.w / 2) + Math.abs(S.y + S.h / 2 - T.y - T.h / 2) });
  }

  // Short edges first: they take the straight lines, the long ones go
  // around what is there.
  jobs.sort(function(a, b) { return (a.d - b.d) || (a.e.index - b.e.index); });

  const drawn = [];
  const sides = new Map();
  let crossings = 0;
  let through = 0;

  function usedSide(item, side)
  {
    const m = sides.get(item);

    return (m != null && m[side] != null) ? m[side] : [];
  }

  function useSide(item, side, entry)
  {
    if (!sides.has(item))
    {
      sides.set(item, {});
    }

    const m = sides.get(item);

    (m[side] = m[side] || []).push(entry);
  }

  for (const job of jobs)
  {
    let best = null;

    for (const c of candidates(job.S, job.T))
    {
      let cost = c.bends * 22;
      let hits = 0;
      let cross = 0;

      for (let i = 0; i + 1 < c.points.length; i++)
      {
        const a = c.points[i];
        const b = c.points[i + 1];

        cost += (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) * 0.06;

        for (const o of obstacles)
        {
          // The ends' own shapes and labels are only in the way of the
          // segments that don't touch them (draw.io ends a line that meets
          // a label outside its shape at the label's far edge).
          if ((o.item === job.e.from && i === 0) || (o.item === job.e.to && i === c.points.length - 2))
          {
            continue;
          }

          if (segmentHitsRect(a, b, o.r, o.label ? 1 : 5))
          {
            hits++;
          }
        }

        for (const d of drawn)
        {
          const shared = d.from === job.e.from || d.to === job.e.to;

          for (let j = 0; j + 1 < d.points.length; j++)
          {
            const ov = overlap(a, b, d.points[j], d.points[j + 1]);

            if (ov > 6)
            {
              cost += shared ? 4 : 70;
            }

            if (crosses(a, b, d.points[j], d.points[j + 1]))
            {
              cross++;
            }
          }
        }
      }

      const exitSide = sideOf(c.exit);
      const entrySide = sideOf(c.entry);

      // Lines that leave one shape for different places leave from
      // different sides (the branches of a decision), and a line doesn't
      // arrive where another one leaves.
      for (const u of usedSide(job.e.from, exitSide))
      {
        cost += u.out ? (u.other === job.e.to ? 0 : (job.e.decision ? 60 : 14)) : 30;
      }

      for (const u of usedSide(job.e.to, entrySide))
      {
        cost += u.out ? 30 : 0;
      }

      cost += hits * 1000 + cross * 18;

      if (best == null || cost < best.cost - 0.001)
      {
        best = { c: c, cost: cost, hits: hits, cross: cross };
      }
    }

    if (best == null)
    {
      continue;
    }

    const c = best.c;

    crossings += best.cross;
    through += best.hits;
    drawn.push({ points: c.points, from: job.e.from, to: job.e.to });
    useSide(job.e.from, sideOf(c.exit), { out: true, other: job.e.to });
    useSide(job.e.to, sideOf(c.entry), { out: false, other: job.e.from });

    const st = job.st;
    const round = function(v) { return String(Math.round(v * 1000) / 1000); };

    setKey(st, "exitX", round(c.exit[0]));
    setKey(st, "exitY", round(c.exit[1]));
    setKey(st, "exitDx", "0");
    setKey(st, "exitDy", "0");
    setKey(st, "entryX", round(c.entry[0]));
    setKey(st, "entryY", round(c.entry[1]));
    setKey(st, "entryDx", "0");
    setKey(st, "entryDy", "0");
    model.setStyle(job.e.cell, styleText(st));

    // The bends, in the frame of the edge's parent.
    const origin = { x: 0, y: 0 };
    const parentItem = itemOfCell(job.e.cell.parent, tree.items);

    if (parentItem != null)
    {
      const pr = rects.get(parentItem);

      origin.x = pr.x;
      origin.y = pr.y;
    }

    const geo = (job.e.cell.geometry != null) ? job.e.cell.geometry.clone() : new MxGeometry(0, 0, 0, 0);

    geo.relative = true;
    geo.points = [];

    for (let i = 1; i + 1 < c.points.length; i++)
    {
      geo.points.push(new MxPoint(Math.round(c.points[i].x - origin.x), Math.round(c.points[i].y - origin.y)));
    }

    if (geo.points.length === 0)
    {
      geo.points = null;
    }

    model.setGeometry(job.e.cell, geo);
  }

  return { routed: jobs.length, crossings: crossings, through: through };
}

// Writes the lines planned on the page grid (shared/grid-lines.js): their
// ports, their bends and where their labels go. `dy` is what the grid moved
// down by since it was placed (a heading above it).
function writeLines(graph, tree, ctx, dy)
{
  const model = graph.getModel();
  const grid = ctx.page.grid;
  const rects = new Map();
  const obstacles = [];
  const shapes = [];

  for (const item of tree.order)
  {
    const r = absolute(item);

    rects.set(item, r);

    if (item.children.length === 0)
    {
      obstacles.push({ x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 });
      shapes.push({ item: item, r: r });

      if (item.labelH > 0)
      {
        obstacles.push({ x: r.x + r.w / 2 - item.labelW / 2, y: r.y + r.h, w: item.labelW, h: item.labelH });
      }
    }
    else if (item.lane)
    {
      // the title strip of a lane
      obstacles.push(item.st.map.horizontal === "0" ? { x: r.x, y: r.y, w: LANE_TITLE, h: r.h } :
        { x: r.x, y: r.y, w: r.w, h: LANE_TITLE });
      obstacles.push({ x: r.x, y: r.y - 3, w: r.w, h: 6, soft: true }, { x: r.x - 3, y: r.y, w: 6, h: r.h, soft: true });
    }
    else
    {
      // the title of a frame, and its border
      if (item.titleFrom != null)
      {
        obstacles.push({ x: item.titleFrom - 4, y: r.y, w: item.titleTo - item.titleFrom + 8, h: 30 });
      }

      obstacles.push({ x: r.x, y: r.y - 3, w: r.w, h: 6, soft: true }, { x: r.x, y: r.y + r.h - 3, w: r.w, h: 6, soft: true },
        { x: r.x - 3, y: r.y, w: 6, h: r.h, soft: true }, { x: r.x + r.w - 3, y: r.y, w: 6, h: r.h, soft: true });
    }
  }

  const down = function(list) { return list.map(function(v) { return v + dy; }); };
  const zones = function(list) { return list.map(function(z) { return { from: z.from + dy, to: z.to + dy }; }); };
  const drawn = drawLines(ctx.plan, { colX: grid.colX, colW: grid.colW, rowY: down(grid.rowY), rowH: grid.rowH,
    vz: grid.vz, hz: zones(grid.hz), rect: function(item) { return rects.get(item); }, obstacles: obstacles,
    zone: function(frame, side)
    {
      const z = grid.zone(frame, side);
      const by = (side === "top" || side === "bottom") ? dy : 0;

      return { from: z.from + by, to: z.to + by };
    } });
  const round = function(v) { return String(Math.round(v * 1000) / 1000); };
  let through = 0;

  for (const line of drawn.lines)
  {
    const cell = line.e.cell;
    const st = parseStyle(cell.style);

    for (let i = 0; i + 1 < line.points.length; i++)
    {
      for (const s of shapes)
      {
        if (s.item !== line.e.from && s.item !== line.e.to && segmentHitsRect(line.points[i], line.points[i + 1], s.r, 0))
        {
          through++;
        }
      }
    }

    setKey(st, "exitX", round(line.exit[0]));
    setKey(st, "exitY", round(line.exit[1]));
    setKey(st, "exitDx", "0");
    setKey(st, "exitDy", "0");
    setKey(st, "entryX", round(line.entry[0]));
    setKey(st, "entryY", round(line.entry[1]));
    setKey(st, "entryDx", "0");
    setKey(st, "entryDy", "0");
    model.setStyle(cell, styleText(st));

    // The bends, in the frame of the edge's parent.
    const origin = { x: 0, y: 0 };
    const parentItem = itemOfCell(cell.parent, tree.items);

    if (parentItem != null)
    {
      origin.x = rects.get(parentItem).x;
      origin.y = rects.get(parentItem).y;
    }

    const geo = (cell.geometry != null) ? cell.geometry.clone() : new MxGeometry(0, 0, 0, 0);

    geo.relative = true;
    geo.points = [];

    for (let i = 1; i + 1 < line.points.length; i++)
    {
      geo.points.push(new MxPoint(Math.round(line.points[i].x - origin.x), Math.round(line.points[i].y - origin.y)));
    }

    if (geo.points.length === 0)
    {
      geo.points = null;
    }

    if (line.label != null && line.label !== 0)
    {
      geo.x = line.label;
      geo.y = 0;
    }

    model.setGeometry(cell, geo);
  }

  // The title of a frame moves into a corner when a line comes in where it
  // stands.
  for (const item of tree.order)
  {
    if (item.children.length === 0 || item.lane || item.titleFrom == null || item.st.names.indexOf("swimlane") < 0 ||
      item.st.map.align != null)
    {
      continue;
    }

    const r = rects.get(item);
    const band = Number(item.st.map.startSize) || 23;
    const width = item.titleTo - item.titleFrom;
    const at = [];

    for (const line of drawn.lines)
    {
      for (let i = 0; i + 1 < line.points.length; i++)
      {
        const p = line.points[i];
        const q = line.points[i + 1];

        if (Math.abs(p.x - q.x) < 0.5 && Math.min(p.y, q.y) < r.y + band && Math.max(p.y, q.y) > r.y && p.x > r.x &&
          p.x < r.x + r.w)
        {
          at.push(p.x);
        }
      }
    }

    const free = function(from)
    {
      return at.every(function(x) { return x < from - 6 || x > from + width + 6; });
    };

    if (free(item.titleFrom))
    {
      continue;
    }

    // Left, right, or wherever between two of the lines it fits.
    const places = [r.x + 10, r.x + r.w - 10 - width];

    at.sort(function(x, y) { return x - y; });
    at.forEach(function(x, i)
    {
      if (i + 1 < at.length && at[i + 1] - x >= width + 16)
      {
        places.push(x + 8);
      }
    });

    const place = places.filter(function(x) { return x >= r.x + 4 && x + width <= r.x + r.w - 4 && free(x); })[0];

    if (place == null)
    {
      continue;
    }

    setKey(item.st, "align", "left");
    setKey(item.st, "spacingLeft", String(Math.round(place - r.x)));
    model.setStyle(item.cell, styleText(item.st));
  }

  return { routed: drawn.lines.length, crossings: drawn.crossings, through: through };
}

// ─── The pass ────────────────────────────────────────────────────

function isUnplaced(cell)
{
  const geo = cell.geometry;

  return geo == null || geo.origAttrs == null || (geo.origAttrs.x == null && geo.origAttrs.y == null);
}

function layoutPage(graph, options, stats)
{
  const model = graph.getModel();
  const tree = buildItems(graph, options.hints !== false);

  if (tree.order.length === 0)
  {
    return;
  }

  if (!options.all && !tree.order.some(function(it) { return isUnplaced(it.cell); }))
  {
    return;
  }

  // Edges between items. An end inside a table (a row) counts as its table.
  const edges = [];
  const cells = [];

  (function collect(cell)
  {
    for (let i = 0; i < model.getChildCount(cell); i++)
    {
      const child = model.getChildAt(cell, i);

      cells.push(child);
      collect(child);
    }
  })(model.getRoot());

  for (const cell of cells)
  {
    if (!model.isEdge(cell))
    {
      continue;
    }

    const from = itemOfCell(model.getTerminal(cell, true), tree.items);
    const to = itemOfCell(model.getTerminal(cell, false), tree.items);

    if (from == null || to == null)
    {
      continue;
    }

    const st = parseStyle(cell.style);
    const lines = labelLines(cell.value, Number(st.map.fontSize) || 12);
    const bundle = (st.map.bundle != null && st.map.bundle !== "") ? String(st.map.bundle) : null;
    let labelW = 0;

    // `bundle=` is for this pass alone, like `row=` and `col=`.
    if (st.map.bundle != null)
    {
      dropKey(st, "bundle");
      model.setStyle(cell, styleText(st));
    }

    for (const l of lines)
    {
      labelW = Math.max(labelW, textWidth(l.text, l.size, false));
    }

    let labelH = 4;

    for (const l of lines)
    {
      labelH += Math.round(l.size * 1.3);
    }

    edges.push({ cell: cell, from: from, to: to, labelW: labelW, labelH: labelH, index: edges.length, bundle: bundle,
      decision: from.st.names.indexOf("rhombus") >= 0, routed: st.map.edgeStyle === "orthogonalEdgeStyle" });
  }

  let icons = 0;
  let leaves = 0;
  let dense = false;
  // A change of a diagram laid out before: the earlier layout (`keep`, read
  // from its text by shared/semantic/keep.js), used while the page can still
  // be drawn as one grid.
  const keep = (options.keep != null && typeof options.keep === "object") ? options.keep : null;
  let keepKinds = (keep != null && keep.kinds != null && typeof keep.kinds.get === "function") ? keep.kinds : null;
  let kindSizes = null;

  function measure()
  {
    for (const item of tree.order)
    {
      if (item.children.length === 0)
      {
        const before = (keepKinds != null) ? keepKinds.get(kindKey(item.st)) : null;

        measureLeaf(item, dense, before != null ? before.w : 0);
      }
    }

    kindSizes = unifySizes(tree.order, keepKinds);
  }

  for (const item of tree.order)
  {
    if (item.children.length === 0)
    {
      leaves++;

      if (isOutsideLabel(item.st))
      {
        icons++;
      }
    }
  }

  measure();

  const hasDecision = tree.order.some(function(it) { return it.st.names.indexOf("rhombus") >= 0; });
  const hasLanes = tree.order.some(function(it) { return it.lane; });
  const ctx = { edges: edges, frame: options.frame || FRAME, direction: options.direction || null,
    mode: options.mode || ((hasDecision || hasLanes) ? "flow" : "tiers"), iconic: icons * 2 > leaves,
    grid: options.hints === "page" ? "page" : "group" };

  // The top level: headings (text without edges) above, notes below, the
  // rest laid out like a container without a frame.
  const connected = new Set();

  edges.forEach(function(e)
  {
    connected.add(e.from);
    connected.add(e.to);
  });

  const floats = tree.roots.filter(function(it)
  {
    return it.children.length === 0 && isText(it.st) && !connected.has(it);
  });
  const content = tree.roots.filter(function(it) { return floats.indexOf(it) < 0; });

  const lanes = content.filter(function(c) { return c.lane && c.children.length > 0; });
  // The first text is the heading, unless it says it is a note (`note=1`).
  const heading = floats.filter(function(f) { return f.st.map.note == null; })[0] || null;
  // What the heading and the notes add to the height the chat has to show.
  const around = (heading != null ? heading.h + 10 : 0) + floats.reduce(function(sum, f)
  {
    return sum + (f !== heading ? f.h + 6 : 0);
  }, floats.some(function(f) { return f !== heading; }) ? 10 : 0);

  const isPool = lanes.length >= 2 && lanes.length === content.length;

  function place(policy)
  {
    ctx.policy = policy;

    if (ctx.grid === "page")
    {
      const turned = policy === "turned";
      const first = placeOnPage(content, isPool ? lanes : null, ctx, turned, null);

      if (first != null)
      {
        // The lines are planned on the grid, and the grid is placed again
        // with the room they need.
        const routable = edges.filter(function(e) { return e.routed; });

        ctx.plan = (routable.length > 0) ? planLines(first.grid, routable, isPool ? LANE_LINES : null) : null;
        ctx.page = (ctx.plan != null) ? placeOnPage(content, isPool ? lanes : null, ctx, turned, ctx.plan.room) : first;

        return ctx.page;
      }

      ctx.plan = null;

      ctx.grid = "group";
      ctx.policy = "";
      inheritCells(content);
    }

    for (const c of content)
    {
      if (c.children.length > 0)
      {
        layoutContainer(c, ctx);
      }
    }

    return (lanes.length >= 2 && lanes.length === content.length) ? arrangeLanes(null, lanes, ctx) :
      arrange(null, content, ctx);
  }

  // Containers in containers: which way each level runs is tried as a whole
  // (all down, all to the right, alternating, each level for itself), since
  // a level can't know what the frame leaves it. The one the chat shows
  // largest and whole wins, with shorter connections as the second
  // criterion. A diagram that is larger than the frame is placed again with
  // less room between its cells.
  const nested = content.some(function(c) { return c.children.length > 0; });

  // One grid for the page: first settle whether the cells can be drawn so.
  // Lanes are then also tried the other way round, since the model can't
  // know how wide its steps get: lanes as rows with a dozen steps are shown
  // at half their size, as columns almost in full.
  if (ctx.grid === "page")
  {
    if (!isPool && !moveStrangers(content))
    {
      ctx.grid = "group";
      inheritCells(content);
    }
    else
    {
      place("");
    }
  }

  const policies = (ctx.grid === "page") ? ["", "turned"] : (nested ? ["", "vh", "hv", "v", "h"] : [""]);
  let best = null;
  let size = null;

  // A change: the orientation, the spacing and the box widths stay as they
  // were, every column and row the model numbered as before keeps its
  // place, and only what needs more room moves (placeOnPage, keptAxis).
  // Without one grid for the page there is nothing to keep it by, and the
  // page is laid out anew.
  if (keep != null && ctx.grid === "page" && (keep.policy === "" || keep.policy === "turned"))
  {
    ctx.tight = keep.tight === true;
    dense = keep.dense === true;
    measure();
    ctx.keep = keep;
    place(keep.policy);

    if (ctx.grid === "page")
    {
      best = { policy: keep.policy, tight: ctx.tight, dense: dense, kept: true };
    }
    else
    {
      ctx.keep = null;
    }
  }

  if (best == null && keepKinds != null)
  {
    keepKinds = null;
    ctx.tight = false;
    dense = false;
    measure();
  }

  // Less room first, then narrower boxes too: the text wraps more often, but
  // is larger on the screen when the page is shown at a larger scale.
  for (const level of (best != null ? [] : [{ tight: false, dense: false }, { tight: true, dense: false }, { tight: true, dense: true }]))
  {
    const tight = level.tight;

    ctx.tight = tight;

    if (dense !== level.dense)
    {
      dense = level.dense;
      measure();
    }

    for (const policy of policies)
    {
      const s = place(policy);
      const whole = { width: s.width, height: s.height + around };
      let length = 0;

      edges.forEach(function(e)
      {
        const a = absolute(e.from);
        const b = absolute(e.to);

        length += Math.abs(a.x + a.w / 2 - b.x - b.w / 2) + Math.abs(a.y + a.h / 2 - b.y - b.h / 2);
      });

      // The model's own orientation wins unless the other one shows clearly
      // more, and shows it whole: in the blind judgements a lane diagram cut
      // off at the bottom lost against a small one that was complete.
      // A turned page is never shown cut off, so it is widened at any scale.
      const widened = ctx.grid === "page" && isCut(whole, ctx.frame) &&
        (policy === "turned" || canWiden(whole, ctx.frame));
      const score = (widened ? fit(whole, ctx.frame) : shown(whole, ctx.frame)) -
        0.05 * (edges.length > 0 ? length / edges.length / 200 : 0) -
        (policy === "turned" ? (isPool ? TURN_MARGIN : (ctx.mode === "flow" ? TURN_MARGIN_FLOW : TURN_MARGIN_PAGE)) : 0);

      if (policy === "turned" && isCut(whole, ctx.frame) && !widened)
      {
        continue;
      }

      // Narrower boxes have to show the page clearly larger.
      if (best == null || score > best.score + (level.dense && !best.dense ? DENSE_MARGIN : 1e-9))
      {
        best = { score: score, policy: policy, tight: tight, dense: level.dense, fits: fit(whole, ctx.frame) >= 1 };
      }
    }

    if (best.fits)
    {
      break;
    }
  }

  ctx.tight = best.tight;

  if (dense !== best.dense)
  {
    dense = best.dense;
    measure();
  }

  size = place(best.policy);

  // Cut off at the bottom: wider, until it is shown whole. On a change the
  // columns keep their width and the page is made wider around them
  // (ctx.keepWidth in placeOnPage): made wider across, every step would move.
  if (ctx.grid === "page")
  {
    const whole = { width: size.width, height: size.height + around };

    if (isCut(whole, ctx.frame) && (best.policy === "turned" || canWiden(whole, ctx.frame)))
    {
      const width = Math.ceil(ctx.frame.width / (1.02 * fit(whole, ctx.frame)));

      if (best.kept)
      {
        ctx.keepWidth = width;
        size = place(best.policy);
        ctx.keepWidth = 0;
      }
      else
      {
        ctx.minWidth = width;
        size = place(best.policy);
        ctx.minWidth = 0;
      }
    }
  }

  // What a change keeps (options.keep, written as text by
  // shared/semantic/keep.js): the orientation, the spacing, the sizes of the
  // kinds of boxes, and the center and size of every column and row by the
  // model's number for it. Not rounded here: the text rounds down, so what
  // is read back never pushes a row or column further than it was. Without
  // the shift of a page made wider on a change: the next change makes it as
  // wide as it then needs.
  if (ctx.grid === "page" && ctx.page != null)
  {
    const grid = ctx.page.grid;
    const axis = function(values, at, sizes, shift)
    {
      return values.map(function(m, i) { return { m: m, c: at[i] - shift + sizes[i] / 2, s: sizes[i] }; });
    };

    stats.keep = { policy: best.policy, tight: ctx.tight === true, dense: dense, kept: best.kept === true,
      x: axis(grid.colValues, grid.colX, grid.colW, grid.shift || 0), y: axis(grid.rowValues, grid.rowY, grid.rowH, 0),
      kinds: Array.from(kindSizes || []).map(function(e) { return { key: e[0], w: e[1].w, h: e[1].h }; }) };
  }
  else
  {
    stats.keep = null;
  }

  let y = 0;

  if (heading != null)
  {
    heading.x = 0;
    heading.y = 0;
    heading.w = Math.max(heading.w, Math.min(size.width, 600));
    y = heading.h + 10;
  }

  content.forEach(function(c) { c.y += y; });
  y += size.height + 16;

  floats.filter(function(f) { return f !== heading; }).forEach(function(f)
  {
    f.x = 0;
    f.y = y;
    f.w = Math.max(f.w, size.width);
    y += f.h + 6;
  });

  for (const item of tree.order)
  {
    const old = item.cell.geometry;
    const geo = (old != null) ? old.clone() : new MxGeometry(0, 0, 0, 0);

    geo.x = item.x;
    geo.y = item.y;
    geo.width = item.w;
    geo.height = item.h;
    geo.origAttrs = Object.assign({}, old != null ? old.origAttrs : null, { x: "0", y: "0" });
    model.setGeometry(item.cell, geo);

    let changed = false;

    for (const k of HINT_KEYS)
    {
      if (item.st.map[k] != null)
      {
        dropKey(item.st, k);
        changed = true;
      }
    }

    if (changed || item.placed)
    {
      model.setStyle(item.cell, styleText(item.st));
    }
  }

  const routed = (options.route === false) ? { routed: 0, crossings: 0, through: 0 } :
    (ctx.grid === "page" && ctx.plan != null) ? writeLines(graph, tree, ctx, heading != null ? heading.h + 10 : 0) :
      routeEdges(graph, tree, ctx);

  stats.pages++;
  stats.vertices += tree.order.length;
  stats.width = Math.round(size.width);
  stats.height = Math.round(y);
  stats.mode = ctx.mode;
  stats.policy = ctx.policy;
  stats.tight = ctx.tight === true;
  stats.dense = dense;
  stats.grid = ctx.grid;
  stats.hinted = tree.order.filter(function(it) { return it.row != null || it.col != null; }).length;
  stats.edges = routed.routed;
  stats.crossings = routed.crossings;
  stats.through = routed.through;
}

/**
 * Lays out every page whose vertices have no position (or every page with
 * `all`): vertices on a grid, containers around their children, lanes as
 * bands, right-angle edges routed.
 *
 * @param {string} xml - mxGraphModel or mxfile XML
 * @param {{all?: boolean, direction?: "vertical"|"horizontal", mode?: "flow"|"tiers",
 *   frame?: {width: number, height: number}, hints?: boolean|"page", route?: boolean}} [options] -
 *   all: also lay out pages that are placed already; direction: where the
 *   flow runs (default: whichever is shown larger in the frame); mode: how
 *   children without hints are placed (default: flow when the page has
 *   decisions or lanes, else tiers); frame: the size the diagram is shown in;
 *   hints: false ignores `row=` and `col=`, "page" reads them as the cells of
 *   one grid for the whole page (default: of the grid of each container);
 *   route: false leaves the edges as they are
 * @returns {{xml: string, changed: number, stats: object}}
 */
export function gridLayoutDiagram(xml, options)
{
  const opts = options || {};
  const stats = { pages: 0, vertices: 0 };
  const result = transformPages(xml, function(graph)
  {
    layoutPage(graph, opts, stats);
  });

  return { xml: result.xml, changed: result.changed, stats: stats };
}
