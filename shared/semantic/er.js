// ER schemas: one table per entity, relations drawn from the foreign-key row
// to the primary-key row with crow's-foot markers.
//
// Up to 16 tables go on a grid, as shared/chat-view-xml.md lays out schemas:
// two to four columns, the most connected table in the middle, related
// tables next to each other (grid.js searches the placement), and every
// relation routed in its own track of the gutters between the columns, which
// are as wide as their tracks need, in the order with the fewest crossings. Larger schemas use
// ELK's layered algorithm left to right when an ELK instance is passed in
// (the referenced table left of the tables that reference it), and the grid
// otherwise.
//
// The table look is the one shared/chat-view-xml.md asks the model for
// (stackLayout swimlanes, one text row per column, all tables one width,
// no labels on relations), in the calm theme. A table whose columns are all
// keys (a junction table) takes the data color.

import { textWidth } from "./text-width.js";
import { roleStyle, fontSizes, EDGE, FONT_COLOR } from "./theme.js";
import { htmlLabel, IdPool } from "./xml-writer.js";
import { placeOnGrid, routeGrid, linkCost } from "./grid.js";

const FRAME = { width: 800, height: 800 };
const MARGIN = 20;
const TITLE_HEIGHT = 50;

// ---------------------------------------------------------------- fields

const KEY_TOKEN = /^(pk|fk|uk|pk\/fk|fk\/pk)$/i;

/**
 * Reads one column line: "PK book_id", "PK, FK book_id", "book_id INT PK",
 * "FK author_id -> authors", "id (PK)".
 *
 * @returns {{text: string, name: string, pk: boolean, fk: boolean, ref: string}}
 */
export function parseField(text)
{
  const t = String(text).trim();
  let ref = "";
  const refMatch = /(?:→|->|=>|\breferences\b|\brefs?\b)\s*([A-Za-z_][\w]*)/i.exec(t) ||
    /\(\s*([A-Za-z_]\w*)(?:\.\w+)?\s*\)\s*$/.exec(t);

  if (refMatch != null && !KEY_TOKEN.test(refMatch[1]))
  {
    ref = refMatch[1].toLowerCase();
  }

  const tokens = t.split(/[\s,:()]+/).filter(function(s) { return s !== ""; });
  let pk = false;
  let fk = false;
  let name = "";

  for (const tok of tokens)
  {
    if (KEY_TOKEN.test(tok))
    {
      pk = pk || /pk/i.test(tok);
      fk = fk || /fk/i.test(tok);
    }
    else if (name === "" && /[\w]/.test(tok) && !/^(→|->|=>)$/.test(tok))
    {
      name = tok.replace(/^[^\w]+|[^\w]+$/g, "");
    }
  }

  if (/\bprimary key\b/i.test(t))
  {
    pk = true;
  }

  if (/\bforeign key\b/i.test(t) || ref !== "")
  {
    fk = true;
  }

  return { text: t, name: name.toLowerCase(), pk: pk, fk: fk, ref: ref };
}

function singular(s)
{
  if (/ies$/.test(s))
  {
    return s.slice(0, -3) + "y";
  }

  if (/(ss|us|is)$/.test(s))
  {
    return s;
  }

  if (/(ches|shes|sses|xes)$/.test(s))
  {
    return s.slice(0, -2);
  }

  return s.replace(/s$/, "");
}

function stems(table)
{
  const out = new Set();

  for (const raw of [table.id, table.label])
  {
    const s = String(raw).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

    if (s !== "")
    {
      out.add(s);
      out.add(singular(s));
      const last = s.split("_").pop();
      out.add(last);
      out.add(singular(last));
    }
  }

  out.delete("");

  return Array.from(out);
}

// ---------------------------------------------------------------- relations

const CARD_WORDS =
{
  one: "1",
  many: "*",
  "zero-or-one": "0..1",
  "zero-to-one": "0..1",
  "one-or-many": "1..*",
  "one-or-more": "1..*",
  "zero-or-many": "0..*",
  "zero-or-more": "0..*"
};

function normalizeCard(c)
{
  const s = String(c || "").trim().toLowerCase().replace(/\s+/g, "");
  const word = String(c || "").trim().toLowerCase().replace(/[\s_]+/g, "-");

  if (s === "")
  {
    return "";
  }

  if (CARD_WORDS[word] != null)
  {
    return CARD_WORDS[word];
  }

  if (s === "1" || s === "1..1" || s === "one" || s === "|")
  {
    return "1";
  }

  if (s === "0..1" || s === "?" || s === "0,1")
  {
    return "0..1";
  }

  if (s === "1..*" || s === "1..n" || s === "+" || s === "1..m")
  {
    return "1..*";
  }

  if (s === "0..*" || s === "0..n" || s === "0..m")
  {
    return "0..*";
  }

  return "*";
}

function isMany(card)
{
  return card.indexOf("*") >= 0;
}

const MARKERS = { "1": "ERmandOne", "0..1": "ERzeroToOne", "1..*": "ERoneToMany", "0..*": "ERzeroToMany", "*": "ERmany" };

function cardsOf(edge)
{
  let from = "";
  let to = "";
  const parts = edge.kind.split("-to-");

  if (parts.length === 2)
  {
    from = CARD_WORDS[parts[0]] || "";
    to = CARD_WORDS[parts[1]] || "";
  }

  from = normalizeCard(edge.fromCard) || from;
  to = normalizeCard(edge.toCard) || to;

  return { from: from, to: to };
}

function findField(table, name)
{
  const n = String(name).toLowerCase().replace(/^(pk|fk)[\s,]+/i, "").trim();

  return table.fields.findIndex(function(f) { return f.name === n || f.text.toLowerCase() === n; });
}

function pkRow(table)
{
  const i = table.fields.findIndex(function(f) { return f.pk; });

  if (i >= 0)
  {
    return i;
  }

  const s = stems(table);

  return table.fields.findIndex(function(f)
  {
    return f.name === "id" || s.some(function(st) { return f.name === st + "_id" || f.name === st + "id"; });
  });
}

// The row of `child` that references `parent`, or -1. Rows already used for a
// relation between the two are skipped, so two references to one table
// (origin and destination airport) take one row each.
function fkRow(child, parent, used)
{
  const st = stems(parent);
  const pkNames = parent.fields.filter(function(f) { return f.pk; }).map(function(f) { return f.name; });
  const free = function(i) { return !used.has(i); };
  const tests =
  [
    function(f) { return f.ref !== "" && (st.indexOf(singular(f.ref)) >= 0 || st.indexOf(f.ref) >= 0); },
    function(f) { return f.fk && pkNames.indexOf(f.name) >= 0 && f.name !== "id"; },
    function(f) { return f.fk && st.some(function(s) { return f.name === s + "_id" || f.name === s + "id"; }); },
    function(f) { return f.fk && st.some(function(s) { return s.length > 2 && f.name.indexOf(s) >= 0; }); },
    function(f) { return !f.pk && pkNames.indexOf(f.name) >= 0 && f.name !== "id"; },
    function(f) { return st.some(function(s) { return f.name === s + "_id" || f.name === s + "id"; }); }
  ];

  for (const test of tests)
  {
    const i = child.fields.findIndex(function(f, k) { return free(k) && test(f); });

    if (i >= 0)
    {
      return i;
    }
  }

  return -1;
}

/**
 * Resolves the edges of an ER description into relations between rows.
 *
 * @returns {Array<{parent: number, parentRow: number, child: number,
 *   childRow: number, parentCard: string, childCard: string}>} table
 *   indexes; row -1 is the table's header
 */
export function resolveRelations(tables, edges)
{
  const index = new Map(tables.map(function(t, i) { return [t.id, i]; }));
  const used = new Map();
  const relations = [];

  for (const e of edges)
  {
    const a = index.get(e.from);
    const b = index.get(e.to);
    const cards = cardsOf(e);
    // true: the "from" table holds the foreign key, false: the "to" table,
    // null: neither (many-to-many)
    let childIsFrom;

    if (cards.from !== "" && cards.to !== "" && isMany(cards.from) !== isMany(cards.to))
    {
      childIsFrom = isMany(cards.from);
    }
    else if (cards.from !== "" && cards.to !== "" && isMany(cards.from))
    {
      childIsFrom = null;
    }
    else
    {
      // one-to-one, or no cardinality: the table that holds the foreign key
      const key = function(c, p) { return c + ">" + p; };
      const toRefs = fkRow(tables[b], tables[a], used.get(key(b, a)) || new Set()) >= 0;
      const fromRefs = fkRow(tables[a], tables[b], used.get(key(a, b)) || new Set()) >= 0;
      childIsFrom = !toRefs && fromRefs;

      if (cards.from === "" && cards.to === "")
      {
        cards.from = childIsFrom ? "*" : "1";
        cards.to = childIsFrom ? "1" : "*";
      }
    }

    if (childIsFrom == null)
    {
      // many-to-many without a junction table: key to key
      relations.push({ parent: a, parentRow: explicitRow(tables[a], e.fromField, pkRow(tables[a])), child: b,
        childRow: explicitRow(tables[b], e.toField, pkRow(tables[b])), parentCard: cards.from, childCard: cards.to });
      continue;
    }

    const child = childIsFrom ? a : b;
    const parent = childIsFrom ? b : a;
    const usedKey = child + ">" + parent;

    if (!used.has(usedKey))
    {
      used.set(usedKey, new Set());
    }

    const childField = childIsFrom ? e.fromField : e.toField;
    const parentField = childIsFrom ? e.toField : e.fromField;
    const parentRow = explicitRow(tables[parent], parentField, pkRow(tables[parent]));

    if (child === parent && parentRow >= 0)
    {
      // a reference to its own table: not from the key to itself
      used.get(usedKey).add(parentRow);
    }

    const childRow = explicitRow(tables[child], childField, fkRow(tables[child], tables[parent], used.get(usedKey)));

    if (childRow >= 0)
    {
      used.get(usedKey).add(childRow);
    }

    relations.push({
      parent: parent,
      parentRow: parentRow,
      child: child,
      childRow: childRow,
      parentCard: (childIsFrom ? cards.to : cards.from) || "1",
      childCard: (childIsFrom ? cards.from : cards.to) || "*"
    });
  }

  return relations;
}

function explicitRow(table, name, fallback)
{
  if (name)
  {
    const i = findField(table, name);

    if (i >= 0)
    {
      return i;
    }
  }

  return fallback;
}

// ---------------------------------------------------------------- layout

function rowCenter(table, row)
{
  return (row < 0) ? table.rowHeight / 2 : table.rowHeight * (row + 1.5);
}

// Satellites: tables whose only relations are to one hub, as the side that
// references it. With three or more, every second one is placed left of the
// hub (its relation reversed for the layering), so the hub sits in the middle
// with its relations leaving from both sides (shared/chat-view-xml.md).
function satellitesToFlip(tables, relations)
{
  const degree = tables.map(function() { return 0; });

  for (const r of relations)
  {
    degree[r.parent]++;

    if (r.child !== r.parent)
    {
      degree[r.child]++;
    }
  }

  const byHub = new Map();

  relations.forEach(function(r, k)
  {
    if (r.child !== r.parent && degree[r.child] === 1)
    {
      if (!byHub.has(r.parent))
      {
        byHub.set(r.parent, []);
      }

      byHub.get(r.parent).push(k);
    }
  });

  const flip = new Set();

  for (const list of byHub.values())
  {
    if (list.length >= 3)
    {
      list.forEach(function(k, i)
      {
        if (i % 2 === 1)
        {
          flip.add(k);
        }
      });
    }
  }

  return flip;
}

function elkGraph(tables, relations, flip, placement)
{
  const ports = new Map();
  const children = tables.map(function(t, i)
  {
    return { id: "t" + i, width: t.width, height: t.height, ports: [],
      layoutOptions: { "elk.portConstraints": "FIXED_POS" } };
  });

  function port(table, row, side)
  {
    const key = table + ":" + row + ":" + side;

    if (!ports.has(key))
    {
      const id = "p" + ports.size;
      const t = tables[table];
      ports.set(key, id);
      children[table].ports.push({ id: id, width: 0, height: 0, x: (side === "EAST") ? t.width : 0,
        y: rowCenter(t, row), layoutOptions: { "elk.port.side": side } });
    }

    return ports.get(key);
  }

  const edges = relations.map(function(r, k)
  {
    const self = r.parent === r.child;
    const reversed = flip.has(k);
    const src = reversed ? { t: r.child, row: r.childRow } : { t: r.parent, row: r.parentRow };
    const dst = reversed ? { t: r.parent, row: r.parentRow } : { t: r.child, row: r.childRow };

    return { id: "e" + k, sources: [port(src.t, src.row, "EAST")], targets: [port(dst.t, dst.row, self ? "EAST" : "WEST")] };
  });

  return {
    id: "root",
    layoutOptions:
    {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.spacing.edgeNode": "20",
      "elk.spacing.edgeEdge": "12",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
      "elk.spacing.componentComponent": "60",
      "elk.aspectRatio": "1.4",
      "elk.separateConnectedComponents": "true",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.nodePlacement.strategy": placement,
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.randomSeed": "1"
    },
    children: children,
    edges: edges
  };
}

function routeOf(edge)
{
  const s = edge.sections && edge.sections[0];

  if (s == null)
  {
    return [];
  }

  return [s.startPoint].concat(s.bendPoints || [], [s.endPoint]);
}

// Proper crossings between the segments of different relations.
export function countCrossings(routes)
{
  const segs = [];

  routes.forEach(function(pts, k)
  {
    for (let i = 0; i + 1 < pts.length; i++)
    {
      segs.push({ k: k, a: pts[i], b: pts[i + 1] });
    }
  });

  let n = 0;

  for (let i = 0; i < segs.length; i++)
  {
    for (let j = i + 1; j < segs.length; j++)
    {
      if (segs[i].k !== segs[j].k && crosses(segs[i], segs[j]))
      {
        n++;
      }
    }
  }

  return n;
}

function crosses(s, t)
{
  const sh = Math.abs(s.a.y - s.b.y) < 0.5;
  const th = Math.abs(t.a.y - t.b.y) < 0.5;

  if (sh === th)
  {
    return false;
  }

  const h = sh ? s : t;
  const v = sh ? t : s;
  const x = v.a.x;
  const y = h.a.y;
  const eps = 0.5;

  return x > Math.min(h.a.x, h.b.x) + eps && x < Math.max(h.a.x, h.b.x) - eps &&
    y > Math.min(v.a.y, v.b.y) + eps && y < Math.max(v.a.y, v.b.y) - eps;
}

// Pieces of two relations on one line (the same height or the same x),
// except the first pieces of relations that leave the same row: those fan
// out from one point.
export function countOverlaps(routes)
{
  const segs = [];

  routes.forEach(function(pts, k)
  {
    for (let i = 0; i + 1 < pts.length; i++)
    {
      segs.push({ k: k, a: pts[i], b: pts[i + 1], ends: [pts[0], pts[pts.length - 1]] });
    }
  });

  const same = function(p, q) { return Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5; };
  let n = 0;

  for (let i = 0; i < segs.length; i++)
  {
    for (let j = i + 1; j < segs.length; j++)
    {
      const s = segs[i];
      const t = segs[j];

      // pieces that both leave one row fan out from it
      const fan = s.ends.some(function(p)
      {
        return t.ends.some(function(q) { return same(p, q); }) && (same(s.a, p) || same(s.b, p)) &&
          (same(t.a, p) || same(t.b, p));
      });

      if (s.k === t.k || fan)
      {
        continue;
      }

      const sh = Math.abs(s.a.y - s.b.y) < 0.5;
      const th = Math.abs(t.a.y - t.b.y) < 0.5;

      if (sh && th && Math.abs(s.a.y - t.a.y) < 1)
      {
        const lo = Math.max(Math.min(s.a.x, s.b.x), Math.min(t.a.x, t.b.x));
        const hi = Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x));
        n += (hi - lo > 1) ? 1 : 0;
      }
      else if (!sh && !th && Math.abs(s.a.x - t.a.x) < 1)
      {
        const lo = Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y));
        const hi = Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y));
        n += (hi - lo > 1) ? 1 : 0;
      }
    }
  }

  return n;
}

function linksCost(cellOf, links, cols)
{
  return links.reduce(function(c, l) { return c + linkCost(cellOf[l.a], cellOf[l.b], cols); }, 0);
}

function fitOf(w, h, titleWidth)
{
  const outerW = Math.max(w, titleWidth) + 2 * MARGIN;
  const outerH = h + 2 * MARGIN + (titleWidth > 0 ? TITLE_HEIGHT : 0);

  return { outerWidth: outerW, outerHeight: outerH, fit: Math.min(1, FRAME.width / outerW, FRAME.height / outerH) };
}

function lengthOf(routes)
{
  return routes.reduce(function(n, r)
  {
    let len = 0;

    for (let i = 0; i + 1 < r.points.length; i++)
    {
      len += Math.abs(r.points[i + 1].x - r.points[i].x) + Math.abs(r.points[i + 1].y - r.points[i].y);
    }

    return n + len;
  }, 0);
}

function bendsOf(routes)
{
  return routes.reduce(function(n, r) { return n + Math.max(0, r.points.length - 2); }, 0);
}

// Large schemas: ELK's layered layout, left to right.
async function elkGeometry(tables, relations, elk, titleWidth)
{
  const flip = satellitesToFlip(tables, relations);
  const variants = [];

  for (const placement of ["BRANDES_KOEPF", "NETWORK_SIMPLEX"])
  {
    variants.push({ placement: placement, flip: new Set() });

    if (flip.size > 0)
    {
      variants.push({ placement: placement, flip: flip });
    }
  }

  let best = null;

  for (const v of variants)
  {
    const result = await elk.layout(elkGraph(tables, relations, v.flip, v.placement));
    let w = 0;
    let h = 0;

    for (const c of result.children)
    {
      w = Math.max(w, c.x + c.width);
      h = Math.max(h, c.y + c.height);
    }

    const routes = relations.map(function(r, k)
    {
      const reversed = v.flip.has(k);
      const self = r.parent === r.child;
      const points = routeOf(result.edges[k]);

      for (const p of points)
      {
        w = Math.max(w, p.x);
        h = Math.max(h, p.y);
      }

      return { points: points, reversed: reversed, sideA: "EAST", sideB: self ? "EAST" : "WEST", dyB: 0 };
    });
    const f = fitOf(w, h, titleWidth);
    const crossings = countCrossings(routes.map(function(r) { return r.points; }));
    const bends = bendsOf(routes);
    const score = f.fit * 100 - crossings * 4 - bends * 0.5;

    if (best == null || score > best.score + 1e-6)
    {
      best = { score: score, width: w, height: h, crossings: crossings, bends: bends, fit: f,
        pos: result.children.map(function(c) { return { x: c.x, y: c.y }; }), routes: routes,
        stats: { layout: "elk", placement: v.placement, split: v.flip.size > 0 } };
    }
  }

  return best;
}

// Up to GRID_MAX tables: the grid of shared/chat-view-xml.md, two to four
// columns, whichever fits the chat frame best with the fewest crossings.
const GRID_MAX = 16;
// weights of a crossing and of the lines' length (per 250 px) against the
// link costs of grid.js
const W = { crossing: 3, length: 250 };

function gridGeometry(tables, relations, titleWidth)
{
  const n = tables.length;
  const links = relations.map(function(r)
  {
    return { a: r.parent, b: r.child, ya: rowCenter(tables[r.parent], r.parentRow),
      yb: rowCenter(tables[r.child], r.childRow) };
  });
  const boxes = tables.map(function(t) { return { w: t.width, h: t.height }; });
  const maxJog = tables[0].rowHeight / 2 - 4;
  const options = [];

  for (let cols = Math.min(n, 2); cols <= Math.min(n, 4); cols++)
  {
    options.push(cols);
  }

  if (n === 1)
  {
    options.push(1);
  }

  let best = null;

  for (const cols of options)
  {
    const grid = { cols: cols, gutter: 100, gap: 40, maxJog: maxJog, rowHeight: tables[0].rowHeight };
    const quality = function(g)
    {
      const lines = g.routes.map(function(r) { return r.points; });

      return { crossings: countCrossings(lines), overlaps: countOverlaps(lines), bends: bendsOf(g.routes),
        length: lengthOf(g.routes), fit: fitOf(g.width, g.height, titleWidth) };
    };
    const placed = placeOnGrid(n, links, cols, function(cellOf, rows)
    {
      const q = quality(routeGrid(boxes, links, Object.assign({ cellOf: cellOf, rows: rows, fast: true }, grid)));

      return linksCost(cellOf, links, cols) + q.crossings * W.crossing + q.overlaps * 4 + q.length / W.length +
        (1 - q.fit.fit) * 40;
    });
    const g = routeGrid(boxes, links, Object.assign({ cellOf: placed.cellOf, rows: placed.rows }, grid));
    const q = quality(g);
    // more than three tables in a row only when the schema needs it
    const crowd = (cols > 3) ? 2 : 0;
    const badness = placed.cost + q.crossings * W.crossing + q.overlaps * 4 + q.bends * 0.1 + q.length / W.length +
      (1 - q.fit.fit) * 40 + crowd;

    if (best == null || badness < best.badness - 1e-6)
    {
      best = { badness: badness, width: g.width, height: g.height, crossings: q.crossings, bends: q.bends, fit: q.fit,
        pos: g.pos, routes: g.routes.map(function(r) { return Object.assign({ reversed: false }, r); }),
        stats: { layout: "grid", cols: cols, cost: Math.round(placed.cost * 10) / 10, overlaps: q.overlaps,
          length: Math.round(q.length) } };
    }
  }

  return best;
}

// ---------------------------------------------------------------- build

function buildTables(nodes)
{
  const sizes = fontSizes(nodes.length);
  const fs = sizes.shape;
  const rowHeight = (fs > 14) ? 30 : 26;
  const tables = nodes.map(function(n)
  {
    const fields = n.fields.map(parseField);
    const keysOnly = fields.length > 0 && fields.every(function(f) { return f.pk || f.fk; });
    const junction = keysOnly && fields.filter(function(f) { return f.fk; }).length >= 2;

    return { id: n.id, label: n.label, fields: fields, role: n.role || (junction ? "data" : "step"),
      rowHeight: rowHeight, fontSize: fs, height: rowHeight * (fields.length + 1) };
  });

  let width = 160;

  for (const t of tables)
  {
    width = Math.max(width, textWidth(t.label, fs, true) + 30);

    for (const f of t.fields)
    {
      width = Math.max(width, textWidth(f.text, fs) + 24);
    }
  }

  width = Math.min(360, Math.ceil(width / 10) * 10);

  for (const t of tables)
  {
    t.width = width;
  }

  return { tables: tables, sizes: sizes };
}

/**
 * Lays out an ER description and returns its cells.
 *
 * @param {object} diagram - from normalizeSpec
 * @param {{elk?: {layout: function(object): Promise<object>}}} ctx - ELK is
 *   needed for schemas of more than 16 tables
 * @returns {Promise<{cells: object[], width: number, height: number, stats: object}>}
 */
export async function layoutEr(diagram, ctx)
{
  const built = buildTables(diagram.nodes);
  const tables = built.tables;
  const sizes = built.sizes;
  const relations = resolveRelations(tables, diagram.edges);
  const titleWidth = diagram.title ? textWidth(diagram.title, sizes.title, true) + 20 : 0;
  const geo = (tables.length <= GRID_MAX || ctx.elk == null) ? gridGeometry(tables, relations, titleWidth) :
    await elkGeometry(tables, relations, ctx.elk, titleWidth);
  const contentWidth = Math.max(geo.width, titleWidth);
  const ox = MARGIN + (contentWidth - geo.width) / 2;
  const oy = MARGIN + (diagram.title ? TITLE_HEIGHT : 0);
  const ids = new IdPool();
  const cells = [];

  if (diagram.title)
  {
    cells.push({ id: ids.take("title"), value: htmlLabel(diagram.title),
      style: "text;html=1;align=center;verticalAlign=middle;fontSize=" + sizes.title + ";fontStyle=1;fontColor=" + FONT_COLOR + ";",
      x: MARGIN, y: MARGIN, width: contentWidth, height: 30 });
  }

  const rowIds = [];

  tables.forEach(function(t, i)
  {
    const p = geo.pos[i];
    const id = ids.take(t.id);
    t.cellId = id;
    cells.push({ id: id, value: htmlLabel(t.label),
      style: "swimlane;fontStyle=1;childLayout=stackLayout;horizontalStack=0;resizeParent=1;resizeParentMax=0;" +
        "horizontal=1;startSize=" + t.rowHeight + ";collapsible=0;html=1;whiteSpace=wrap;fontSize=" + t.fontSize + ";" +
        roleStyle(t.role) + "swimlaneFillColor=default;",
      x: ox + p.x, y: oy + p.y, width: t.width, height: t.height });
    rowIds[i] = t.fields.map(function(f, r)
    {
      const rid = ids.take(t.id + "." + (f.name || r));
      cells.push({ id: rid, value: htmlLabel(f.text), parent: id,
        style: "text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=6;spacingRight=4;" +
          "overflow=hidden;html=1;fontSize=" + t.fontSize + ";fontColor=" + FONT_COLOR + ";" +
          "points=[[0,0.5],[1,0.5]];portConstraint=eastwest;",
        x: 0, y: t.rowHeight * (r + 1), width: t.width, height: t.rowHeight });

      return rid;
    });
  });

  relations.forEach(function(r, k)
  {
    const route = geo.routes[k];
    const src = route.reversed ? { t: r.child, row: r.childRow, card: r.childCard } :
      { t: r.parent, row: r.parentRow, card: r.parentCard };
    const dst = route.reversed ? { t: r.parent, row: r.parentRow, card: r.parentCard } :
      { t: r.child, row: r.childRow, card: r.childCard };
    const end = function(e, side, prefix, dy)
    {
      const t = tables[e.t];
      const x = (side === "EAST") ? 1 : 0;
      const y = (e.row < 0) ? rowCenter(t, -1) / t.height : 0.5;

      return prefix + "X=" + x + ";" + prefix + "Y=" + (Math.round(y * 1000) / 1000) + ";" + prefix + "Dx=0;" +
        prefix + "Dy=" + (Math.round(dy * 100) / 100) + ";" + prefix + "Perimeter=0;";
    };

    cells.push({
      id: ids.take(tables[r.child].id + "-" + tables[r.parent].id),
      edge: true,
      source: src.row < 0 ? tables[src.t].cellId : rowIds[src.t][src.row],
      target: dst.row < 0 ? tables[dst.t].cellId : rowIds[dst.t][dst.row],
      style: "html=1;rounded=0;strokeColor=" + EDGE.stroke + ";fontColor=" + EDGE.font + ";" +
        "startArrow=" + MARKERS[src.card || "1"] + ";endArrow=" + MARKERS[dst.card || "1"] + ";startFill=0;endFill=0;" +
        "startSize=10;endSize=10;" + end(src, route.sideA, "exit", route.dyA || 0) + end(dst, route.sideB, "entry", route.dyB || 0),
      points: route.points.slice(1, -1).map(function(p) { return { x: ox + p.x, y: oy + p.y }; })
    });
  });

  return {
    cells: cells,
    width: geo.fit.outerWidth,
    height: geo.fit.outerHeight,
    stats: Object.assign({ tables: tables.length, relations: relations.length, crossings: geo.crossings,
      bends: geo.bends, fit: Math.round(geo.fit.fit * 100) / 100 }, geo.stats)
  };
}
