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

const FRAME = { width: 752, height: 752 };
const COL_GAP = 40;
const ROW_GAP = 50;
const PAD = 20;
const LANE_TITLE = 30;
const ICON_SIZE = 60;
const HINT_KEYS = ["row", "col", "lane"];

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

function measureLeaf(item)
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
      w = w || Math.min(240, Math.max(160, Math.ceil(widest * 1.35 + 50)));
      h = h || Math.max(90, lines.length * Math.round(fontSize * 1.3) + 56);
    }
    else if (st.map.shape === "umlActor")
    {
      w = w || 30;
      h = h || 60;
    }
    else
    {
      const base = (st.map.shape != null && /^cylinder/.test(st.map.shape)) ? { w: 120, h: 80 } :
        { w: fontSize >= 16 ? 160 : 140, h: 60 };
      let width = w || base.w;
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

// Boxes of one kind share one size: the size of the fullest one.
function unifySizes(order)
{
  const groups = new Map();

  for (const item of order)
  {
    if (item.children.length > 0 || !item.sized || isOutsideLabel(item.st) || isText(item.st))
    {
      continue;
    }

    const key = item.st.names.join(",") + "|" + (item.st.map.shape || "") + "|" + (item.st.map.arcSize || "");

    if (!groups.has(key))
    {
      groups.set(key, []);
    }

    groups.get(key).push(item);
  }

  groups.forEach(function(list)
  {
    let w = 0;
    let h = 0;

    for (const it of list)
    {
      w = Math.max(w, it.w);
      h = Math.max(h, it.h);
    }

    for (const it of list)
    {
      it.w = it.occW = w;
      it.h = it.occH = h;
    }
  });
}

function padding(item, rowsLanes)
{
  const st = item.st;
  const fontSize = Number(st.map.fontSize) || 12;

  if (st.names.indexOf("swimlane") >= 0)
  {
    const start = (st.map.startSize != null) ? Number(st.map.startSize) : 23;

    return (st.map.horizontal === "0" || rowsLanes === true) ?
      { top: PAD, left: start + PAD, right: PAD, bottom: PAD } :
      { top: start + PAD, left: PAD, right: PAD, bottom: PAD };
  }

  // Cloud groups and other frames carry their title at the top.
  return { top: Math.max(40, fontSize + 28), left: PAD, right: PAD, bottom: PAD };
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
  const base = { col: ctx.iconic ? 50 : COL_GAP, row: ctx.iconic ? 40 : ROW_GAP, stack: ctx.iconic ? 24 : 30 };
  const frame = ctx.frame;
  const want = orientationAt(level, ctx);

  if (children.length === 0)
  {
    return { width: 0, height: 0 };
  }

  if (hasHints(children))
  {
    const cells = hintedCells(children);

    return gridGeometry(children, cells, gapsFor(children, cells, links, base));
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
    if (fit(c.size, frame) > fit(best.size, frame) + 0.02 ||
      (Math.abs(fit(c.size, frame) - fit(best.size, frame)) <= 0.02 &&
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

  lanes.forEach(function(lane, li)
  {
    lane.children.forEach(function(c)
    {
      nodes.push(c);
      laneOf.push(li);
    });
  });

  // Children with hints keep them: col is the place across the lane, row
  // the place along the flow.
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
    let next = 0;

    pos = nodes.map(function(c, i)
    {
      return { lane: laneOf[i], sub: (c.col != null) ? c.col : 0,
        rank: (c.row != null) ? c.row : pos[i].rank + (next++) * 0 };
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
    const rankGap = new Array(Math.max(0, rankValues.length - 1)).fill(columns ? ROW_GAP : COL_GAP + 10);

    for (const l of links)
    {
      const a = pos[l.from];
      const b = pos[l.to];
      const ra = rankValues.indexOf(a.rank);
      const rb = rankValues.indexOf(b.rank);

      if (l.label > 0 && Math.abs(ra - rb) === 1 && a.lane === b.lane && a.sub === b.sub)
      {
        const i = Math.min(ra, rb);

        rankGap[i] = Math.max(rankGap[i], columns ? ROW_GAP + 10 : Math.ceil(l.label + 36));
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
    const crossGap = columns ? COL_GAP : 30;

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
      const size = Math.max(inner, min) + 2 * PAD;

      out.push({ lane: lane, at: across, size: size, subs: subs, subAt: subAt, subSize: subSize, shift: extra / 2 });
      across += size;
    });

    return { columns: columns, lanes: out, along: along, across: across, rankValues: rankValues, rankAt: rankAt,
      rankSize: rankSize, width: columns ? across : along + LANE_TITLE + 2 * PAD,
      height: columns ? along + LANE_TITLE + 2 * PAD : across };
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
    chosen = (fit(asRows, ctx.frame) > fit(asColumns, ctx.frame) + 0.02) ? asRows : asColumns;
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
        it.x = Math.round(PAD + l.shift + l.subAt[s] + (l.subSize[s] - it.w) / 2);
        it.y = Math.round(LANE_TITLE + PAD + chosen.rankAt[r] + (chosen.rankSize[r] - it.occH) / 2);
      }
      else
      {
        it.x = Math.round(LANE_TITLE + PAD + chosen.rankAt[r] + (chosen.rankSize[r] - it.w) / 2);
        it.y = Math.round(PAD + l.shift + l.subAt[s] + (l.subSize[s] - it.occH) / 2);
      }
    });
  });

  return { width: chosen.width, height: chosen.height };
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
    const pad = padding(item);

    item.children.forEach(function(c) { c.x += pad.left; c.y += pad.top; });
    item.w = Math.ceil(size.width + pad.left + pad.right);
    item.h = Math.ceil(size.height + pad.top + pad.bottom);
  }
  else
  {
    const size = arrange(item, item.children, ctx);
    const pad = padding(item);
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
    let labelW = 0;

    for (const l of lines)
    {
      labelW = Math.max(labelW, textWidth(l.text, l.size, false));
    }

    edges.push({ cell: cell, from: from, to: to, labelW: labelW, index: edges.length,
      decision: from.st.names.indexOf("rhombus") >= 0 });
  }

  let icons = 0;
  let leaves = 0;

  for (const item of tree.order)
  {
    if (item.children.length === 0)
    {
      measureLeaf(item);
      leaves++;

      if (isOutsideLabel(item.st))
      {
        icons++;
      }
    }
  }

  unifySizes(tree.order);

  const hasDecision = tree.order.some(function(it) { return it.st.names.indexOf("rhombus") >= 0; });
  const hasLanes = tree.order.some(function(it) { return it.lane; });
  const ctx = { edges: edges, frame: options.frame || FRAME, direction: options.direction || null,
    mode: options.mode || ((hasDecision || hasLanes) ? "flow" : "tiers"), iconic: icons * 2 > leaves };

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
  const heading = floats.length > 0 ? floats[0] : null;

  function place(policy)
  {
    ctx.policy = policy;

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
  // a level can't know what the frame leaves it. The one that is shown
  // largest wins, with shorter connections as the second criterion.
  const nested = content.some(function(c) { return c.children.length > 0; });
  const policies = nested ? ["", "vh", "hv", "v", "h"] : [""];
  let bestPolicy = policies[0];
  let bestScore = -Infinity;
  let size = null;

  if (policies.length > 1)
  {
    for (const policy of policies)
    {
      const s = place(policy);
      const shown = fit({ width: s.width, height: s.height + (heading != null ? heading.h + 10 : 0) }, ctx.frame);
      let length = 0;

      edges.forEach(function(e)
      {
        const a = absolute(e.from);
        const b = absolute(e.to);

        length += Math.abs(a.x + a.w / 2 - b.x - b.w / 2) + Math.abs(a.y + a.h / 2 - b.y - b.h / 2);
      });

      const score = shown - 0.05 * (edges.length > 0 ? length / edges.length / 200 : 0);

      if (score > bestScore + 1e-9)
      {
        bestScore = score;
        bestPolicy = policy;
      }
    }
  }

  size = place(bestPolicy);

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

  floats.slice(1).forEach(function(f)
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

  const routed = (options.route === false) ? { routed: 0, crossings: 0, through: 0 } : routeEdges(graph, tree, ctx);

  stats.pages++;
  stats.vertices += tree.order.length;
  stats.width = Math.round(size.width);
  stats.height = Math.round(y);
  stats.mode = ctx.mode;
  stats.policy = ctx.policy;
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
 *   frame?: {width: number, height: number}}} [options] - all: also lay out
 *   pages that are placed already; direction: where the flow runs (default:
 *   whichever is shown larger in the frame); mode: how children without hints
 *   are placed (default: flow when the page has decisions or lanes, else
 *   tiers); frame: the size the diagram is shown in
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
