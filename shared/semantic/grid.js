// Boxes on a grid with right-angle links between their sides: the layout
// shared/chat-view-xml.md asks the model to compute by hand (columns of boxes
// with free gutters between them, related boxes in neighbouring columns, a
// box with many links in the middle), done in code.
//
// 1. Placement: every box gets a cell of a cols × rows grid. The cost of a
//    link is lowest for boxes side by side in neighbouring columns, higher
//    for boxes stacked in one column, highest for a link that has to cross a
//    column. A steepest-descent search over swaps of two cells, from a few
//    deterministic starts, finds a cheap placement.
// 2. Routing: a link between neighbouring columns runs out of one box's side,
//    along its own vertical track in the gutter between them, and into the
//    other box's side; a link within a column leaves and enters on the same
//    side (a "C"); a link across columns runs through the gap between two
//    rows. Every link gets its own track, gutters and gaps grow with the
//    number of tracks, and the tracks of a gutter are ordered for the fewest
//    crossings.
//
// Deterministic: the same boxes and links give the same result.

const STUB = 24; // straight run at each box side, room for the ER markers and arrowheads
const TRACK = 14; // between tracks in a gutter
const LANE = 12; // between tracks in a gap between rows
const SPREAD = 10; // between links that end on one row, room for the ER markers
const REFINE_ALL_MAX = 10; // up to this many boxes, every start is refined
// Work limits of one swap search, so that a large schema can't hold up the
// server or the viewer: a search stops once the swaps it tried, weighted by
// what trying one costs, reach the limit, and keeps the best placement found
// so far. Trying a swap by the link costs costs one unit per link, by the
// routed result about one per pair of links (the crossings). Up to 16 tables
// with the usual number of relations neither limit is reached; above, a
// schema takes about a second at most.
const LINK_WORK = 2e6;
const ROUTE_WORK = 1e6;

/**
 * The cost of a link between two cells.
 */
export function linkCost(ca, cb, cols)
{
  const dc = Math.abs((ca % cols) - (cb % cols));
  const dr = Math.abs(Math.floor(ca / cols) - Math.floor(cb / cols));

  if (dc === 0)
  {
    return 1.6 + 1.2 * (dr - 1);
  }

  if (dc === 1)
  {
    return 0.8 * dr;
  }

  return 3 * (dc - 1) + 1 + 0.5 * dr;
}

function totalCost(cellOf, links, cols)
{
  let c = 0;

  for (const l of links)
  {
    c += linkCost(cellOf[l.a], cellOf[l.b], cols);
  }

  return c;
}

// Steepest descent over swaps of two cells (a box with a box, or with an
// empty cell). objective(cellOf) → lower is better. After maxTries swaps
// tried, the best one found in the round so far is made and the search ends.
function improve(cellOf, objective, cells, maxTries)
{
  const n = cellOf.length;
  const boxAt = new Array(cells).fill(-1);

  cellOf.forEach(function(c, i) { boxAt[c] = i; });

  let cost = objective(cellOf);
  let tries = 0;

  for (let round = 0; round < 200 && tries < maxTries; round++)
  {
    let best = null;

    for (let p = 0; p < cells && tries < maxTries; p++)
    {
      for (let q = p + 1; q < cells && tries < maxTries; q++)
      {
        const i = boxAt[p];
        const j = boxAt[q];

        if (i < 0 && j < 0)
        {
          continue;
        }

        if (i >= 0)
        {
          cellOf[i] = q;
        }

        if (j >= 0)
        {
          cellOf[j] = p;
        }

        const c = objective(cellOf);
        tries++;

        if (i >= 0)
        {
          cellOf[i] = p;
        }

        if (j >= 0)
        {
          cellOf[j] = q;
        }

        if (c < cost - 1e-9 && (best == null || c < best.c - 1e-9))
        {
          best = { p: p, q: q, c: c };
        }
      }
    }

    if (best == null)
    {
      break;
    }

    const i = boxAt[best.p];
    const j = boxAt[best.q];

    if (i >= 0)
    {
      cellOf[i] = best.q;
    }

    if (j >= 0)
    {
      cellOf[j] = best.p;
    }

    boxAt[best.p] = j;
    boxAt[best.q] = i;
    cost = best.c;
  }

  return { cellOf: cellOf.slice(0, n), cost: cost };
}

// improve() by the link costs alone, with the same swaps in the same order and
// the same limit: a swap changes only the costs of the two boxes' links, so
// only those are summed for each one tried, which keeps large schemas fast.
function improveByLinks(cellOf, links, cols, cells, maxTries)
{
  const n = cellOf.length;
  const boxAt = new Array(cells).fill(-1);
  const linksOf = Array.from({ length: n }, function() { return []; });

  for (const l of links)
  {
    linksOf[l.a].push(l);

    if (l.b !== l.a)
    {
      linksOf[l.b].push(l);
    }
  }

  cellOf.forEach(function(c, i) { boxAt[c] = i; });

  // the cost of the links of boxes i and j (-1: an empty cell), each once
  const local = function(i, j)
  {
    let c = 0;

    if (i >= 0)
    {
      for (const l of linksOf[i])
      {
        c += linkCost(cellOf[l.a], cellOf[l.b], cols);
      }
    }

    if (j >= 0)
    {
      for (const l of linksOf[j])
      {
        if (l.a !== i && l.b !== i)
        {
          c += linkCost(cellOf[l.a], cellOf[l.b], cols);
        }
      }
    }

    return c;
  };

  let cost = totalCost(cellOf, links, cols);
  let tries = 0;

  for (let round = 0; round < 200 && tries < maxTries; round++)
  {
    let best = null;

    for (let p = 0; p < cells && tries < maxTries; p++)
    {
      for (let q = p + 1; q < cells && tries < maxTries; q++)
      {
        const i = boxAt[p];
        const j = boxAt[q];

        if (i < 0 && j < 0)
        {
          continue;
        }

        const before = local(i, j);

        if (i >= 0)
        {
          cellOf[i] = q;
        }

        if (j >= 0)
        {
          cellOf[j] = p;
        }

        const c = cost - before + local(i, j);
        tries++;

        if (i >= 0)
        {
          cellOf[i] = p;
        }

        if (j >= 0)
        {
          cellOf[j] = q;
        }

        if (c < cost - 1e-9 && (best == null || c < best.c - 1e-9))
        {
          best = { p: p, q: q, c: c };
        }
      }
    }

    if (best == null)
    {
      break;
    }

    const i = boxAt[best.p];
    const j = boxAt[best.q];

    if (i >= 0)
    {
      cellOf[i] = best.q;
    }

    if (j >= 0)
    {
      cellOf[j] = best.p;
    }

    boxAt[best.p] = j;
    boxAt[best.q] = i;
    // summed in full, as improve() does
    cost = totalCost(cellOf, links, cols);
  }

  return { cellOf: cellOf.slice(0, n), cost: cost };
}

function degrees(n, links)
{
  const d = new Array(n).fill(0);

  for (const l of links)
  {
    d[l.a]++;
    d[l.b]++;
  }

  return d;
}

// Boxes in breadth-first order from the box with the most links.
function bfsOrder(n, links)
{
  const deg = degrees(n, links);
  const adj = Array.from({ length: n }, function() { return []; });

  for (const l of links)
  {
    adj[l.a].push(l.b);
    adj[l.b].push(l.a);
  }

  const seen = new Array(n).fill(false);
  const order = [];
  const byDegree = Array.from({ length: n }, function(_, i) { return i; })
    .sort(function(a, b) { return deg[b] - deg[a] || a - b; });

  for (const root of byDegree)
  {
    if (seen[root])
    {
      continue;
    }

    const queue = [root];
    seen[root] = true;

    while (queue.length)
    {
      const v = queue.shift();
      order.push(v);

      for (const w of adj[v].slice().sort(function(a, b) { return deg[b] - deg[a] || a - b; }))
      {
        if (!seen[w])
        {
          seen[w] = true;
          queue.push(w);
        }
      }
    }
  }

  return order;
}

/**
 * Places n boxes on a cols-wide grid: first by the cost of the links, then,
 * if given, by refine(cellOf, rows) (the routed result: crossings, lines on
 * one another), starting from the best placement of the first search.
 *
 * @returns {{cellOf: number[], cost: number, score: number, rows: number}}
 */
export function placeOnGrid(n, links, cols, refine)
{
  const rows = Math.ceil(n / cols);
  const cells = rows * cols;
  const starts = [];

  // model order, row by row
  starts.push(Array.from({ length: n }, function(_, i) { return i; }));

  // breadth-first from the busiest box, filled from the middle of the grid
  const centre = { r: (rows - 1) / 2, c: (cols - 1) / 2 };
  const byCentre = Array.from({ length: cells }, function(_, i) { return i; }).sort(function(a, b)
  {
    const da = Math.abs(Math.floor(a / cols) - centre.r) + Math.abs((a % cols) - centre.c);
    const db = Math.abs(Math.floor(b / cols) - centre.r) + Math.abs((b % cols) - centre.c);

    return da - db || a - b;
  });
  const order = bfsOrder(n, links);
  const fromCentre = new Array(n);

  order.forEach(function(box, k) { fromCentre[box] = byCentre[k]; });
  starts.push(fromCentre);

  // breadth-first, row by row
  const rowMajor = new Array(n);

  order.forEach(function(box, k) { rowMajor[box] = k; });
  starts.push(rowMajor);

  const byLinks = function(cellOf) { return totalCost(cellOf, links, cols); };
  const pairs = Math.max(1, links.length);
  const linkTries = Math.floor(LINK_WORK / pairs);
  const routeTries = Math.floor(ROUTE_WORK / (pairs * pairs));
  const found = starts.map(function(s) { return improveByLinks(s.slice(), links, cols, cells, linkTries); });
  let best = null;

  for (const r of found)
  {
    if (best == null || r.cost < best.cost - 1e-9)
    {
      best = r;
    }
  }

  let score = best.cost;

  if (refine != null)
  {
    // the routed result from every start: the cheapest placement by the link
    // costs is often not the one with the fewest crossings. Each refinement
    // routes every swap, so larger grids refine the cheapest start only.
    const refineFrom = (n <= REFINE_ALL_MAX) ? found : [best];
    let refined = null;

    for (const f of refineFrom)
    {
      const r = improve(f.cellOf.slice(), function(cellOf) { return refine(cellOf, rows); }, cells, routeTries);

      if (refined == null || r.cost < refined.cost - 1e-9)
      {
        refined = r;
      }
    }

    best = { cellOf: refined.cellOf, cost: byLinks(refined.cellOf) };
    score = refined.cost;
  }

  return { cellOf: best.cellOf, cost: best.cost, score: score, rows: rows };
}

// ---------------------------------------------------------------- routing

function permutations(list)
{
  if (list.length <= 1)
  {
    return [list];
  }

  const out = [];

  list.forEach(function(x, i)
  {
    for (const rest of permutations(list.slice(0, i).concat(list.slice(i + 1))))
    {
      out.push([x].concat(rest));
    }
  });

  return out;
}

// Crossings inside one gutter for an order of its segments, left to right.
// A segment is {lo, hi, stubs: [{y, dir: -1 (to the left) | 1}]}. A stub that
// passes another segment's track crosses it; at the height of one of that
// segment's own stubs the two run on one line, which counts as three.
function gutterCrossings(order)
{
  let n = 0;

  for (let i = 0; i < order.length; i++)
  {
    for (let j = 0; j < order.length; j++)
    {
      if (i === j)
      {
        continue;
      }

      const s = order[i];
      const t = order[j];

      for (const st of t.stubs)
      {
        // t's stub passes s's track: t is right of s and leaves to the
        // left, or left of s and leaves to the right
        if ((j > i && st.dir < 0) || (j < i && st.dir > 0))
        {
          const own = s.stubs.find(function(ss) { return Math.abs(ss.y - st.y) < 1; });

          if (own != null && own.dir !== st.dir)
          {
            n += 3;
          }
          else if (own == null && st.y > s.lo + 0.5 && st.y < s.hi - 0.5)
          {
            n++;
          }
        }
      }
    }
  }

  return n;
}

function orderGutter(segs, maxBrute)
{
  if (segs.length <= 1)
  {
    return segs;
  }

  if (segs.length <= maxBrute)
  {
    let best = null;

    for (const p of permutations(segs))
    {
      const c = gutterCrossings(p);

      if (best == null || c < best.c)
      {
        best = { p: p, c: c };
      }
    }

    return best.p;
  }

  // more: segments that turn back left first, those that turn back right
  // last, the rest by where they start
  const key = function(s)
  {
    const dirs = s.stubs.map(function(t) { return t.dir; });

    return dirs.every(function(d) { return d < 0; }) ? 0 : dirs.every(function(d) { return d > 0; }) ? 2 : 1;
  };

  return segs.slice().sort(function(a, b) { return key(a) - key(b) || a.lo - b.lo || a.hi - b.hi; });
}

// Boxes side by side in one row of the grid are moved down against each
// other so that the rows a link joins are at one height and the link is a
// straight line. Links are taken in order; one that would contradict the
// shifts already set (a second link between the same two boxes) or move a
// box more than grid.maxShift down is left as it is. Returns the shift of
// every box from the top of its grid row.
function alignRows(boxes, links, colOf, rowOf, grid)
{
  const n = boxes.length;
  const maxShift = (grid.maxShift != null) ? grid.maxShift : 3 * (grid.rowHeight || 26);
  // components of boxes whose relative heights are fixed: root and offset
  const root = Array.from({ length: n }, function(_, i) { return i; });
  const off = new Array(n).fill(0);
  const find = function(i)
  {
    let d = 0;

    while (root[i] !== i)
    {
      d += off[i];
      i = root[i];
    }

    return { r: i, d: d };
  };

  for (const l of links)
  {
    if (rowOf(l.a) !== rowOf(l.b) || Math.abs(colOf(l.a) - colOf(l.b)) !== 1)
    {
      continue;
    }

    const fa = find(l.a);
    const fb = find(l.b);
    // wanted: y(b) - y(a) = ya - yb, y(i) = y(root) + d(i)
    const want = l.ya - l.yb;

    if (fa.r === fb.r)
    {
      continue;
    }

    // attach b's component to a's: y(rb) = y(ra) + fa.d + want - fb.d
    const delta = fa.d + want - fb.d;
    let lo = Infinity;
    let hi = -Infinity;

    for (let i = 0; i < n; i++)
    {
      const f = find(i);

      if (f.r === fa.r || f.r === fb.r)
      {
        const y = (f.r === fa.r) ? f.d : delta + f.d;
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }

    if (hi - lo > maxShift)
    {
      continue;
    }

    root[fb.r] = fa.r;
    off[fb.r] = delta;
  }

  const shift = new Array(n).fill(0);
  const low = new Map();

  for (let i = 0; i < n; i++)
  {
    const f = find(i);
    shift[i] = f.d;
    low.set(f.r, Math.min(low.has(f.r) ? low.get(f.r) : Infinity, f.d));
  }

  for (let i = 0; i < n; i++)
  {
    shift[i] -= low.get(find(i).r);
  }

  return shift;
}

/**
 * Lays out boxes on the grid and routes the links.
 *
 * @param {Array<{w: number, h: number}>} boxes - sizes
 * @param {Array<{a: number, b: number, ya: number, yb: number}>} links -
 *   box indexes and the y of each end, from the box's top
 * @param {{cols: number, cellOf: number[], rows: number, gutter?: number,
 *   gap?: number, top?: number, left?: number, maxJog?: number, fast?: boolean,
 *   outer?: boolean, align?: boolean, rowHeight?: number, maxShift?: number}}
 *   grid - fast: try fewer track orders (while searching placements); outer:
 *   links within the first or last column run outside the grid; align: false
 *   keeps every box at the top of its grid row
 * @returns {{pos: Array<{x: number, y: number}>, routes: Array<{points:
 *   Array<{x: number, y: number}>, sideA: string, sideB: string, dyB: number}>,
 *   width: number, height: number}}
 */
export function routeGrid(boxes, links, grid)
{
  const cols = grid.cols;
  const rows = grid.rows;
  const minGutter = grid.gutter || 100;
  const minGap = grid.gap || 40;
  const colOf = function(i) { return grid.cellOf[i] % cols; };
  const rowOf = function(i) { return Math.floor(grid.cellOf[i] / cols); };
  const gutterSegs = Array.from({ length: cols + 1 }, function() { return []; });
  const gapLanes = Array.from({ length: rows + 1 }, function() { return []; });
  const plans = [];

  // 1. which gutters and gaps each link uses
  links.forEach(function(l, k)
  {
    const ca = colOf(l.a);
    const cb = colOf(l.b);
    const dc = cb - ca;
    const plan = { k: k, l: l };

    if (dc === 0)
    {
      const left = ca;
      const right = ca + 1;
      const inner = function(g) { return g > 0 && g < cols; };
      let g;

      // a box in the first or last column: the inner gutter, or with
      // grid.outer the free side outside the grid, where the line crosses
      // nothing
      if (inner(right) && !inner(left))
      {
        g = grid.outer ? left : right;
      }
      else if (inner(left) && !inner(right))
      {
        g = grid.outer ? right : left;
      }
      else
      {
        g = (gutterSegs[left].length < gutterSegs[right].length) ? left : right;
      }

      const side = (g === right) ? "EAST" : "WEST";
      plan.kind = "same";
      plan.gutter = g;
      plan.sideA = side;
      plan.sideB = side;
      plan.seg = { k: k, stubs: null };
      gutterSegs[g].push(plan.seg);
    }
    else if (Math.abs(dc) === 1)
    {
      plan.kind = "next";
      plan.gutter = Math.max(ca, cb);
      plan.sideA = (dc > 0) ? "EAST" : "WEST";
      plan.sideB = (dc > 0) ? "WEST" : "EAST";
      plan.seg = { k: k, stubs: null };
      gutterSegs[plan.gutter].push(plan.seg);
    }
    else
    {
      const ra = rowOf(l.a);
      const rb = rowOf(l.b);
      plan.kind = "across";
      plan.sideA = (dc > 0) ? "EAST" : "WEST";
      plan.sideB = (dc > 0) ? "WEST" : "EAST";
      plan.gutterA = (dc > 0) ? ca + 1 : ca;
      plan.gutterB = (dc > 0) ? cb : cb + 1;
      plan.gap = Math.min(ra, rb) + 1;
      plan.segA = { k: k, stubs: null };
      plan.segB = { k: k, stubs: null };
      plan.lane = { k: k };
      gutterSegs[plan.gutterA].push(plan.segA);
      gutterSegs[plan.gutterB].push(plan.segB);
      gapLanes[plan.gap].push(plan.lane);
    }

    plans.push(plan);
  });

  // 2. sizes of gutters and gaps, then the boxes' positions
  const gutterWidth = gutterSegs.map(function(segs, g)
  {
    const need = segs.length > 0 ? 2 * STUB + (segs.length - 1) * TRACK : 0;

    return (g > 0 && g < cols) ? Math.max(minGutter, need) : need;
  });
  const gapHeight = gapLanes.map(function(lanes, h)
  {
    const need = lanes.length > 0 ? 32 + (lanes.length - 1) * LANE : 0;

    return (h > 0 && h < rows) ? Math.max(minGap, need) : need;
  });
  const colWidth = new Array(cols).fill(0);
  const rowHeight = new Array(rows).fill(0);
  const shift = (grid.align === false) ? new Array(boxes.length).fill(0) : alignRows(boxes, links, colOf, rowOf, grid);

  boxes.forEach(function(b, i)
  {
    colWidth[colOf(i)] = Math.max(colWidth[colOf(i)], b.w);
    rowHeight[rowOf(i)] = Math.max(rowHeight[rowOf(i)], shift[i] + b.h);
  });

  const colX = [];
  let x = (grid.left || 0) + gutterWidth[0];

  for (let c = 0; c < cols; c++)
  {
    colX.push(x);
    x += colWidth[c] + gutterWidth[c + 1];
  }

  const width = x - (grid.left || 0);
  const rowY = [];
  let y = (grid.top || 0) + gapHeight[0];

  for (let r = 0; r < rows; r++)
  {
    rowY.push(y);
    y += rowHeight[r] + gapHeight[r + 1];
  }

  const height = y - (grid.top || 0);
  const pos = boxes.map(function(b, i)
  {
    return { x: colX[colOf(i)] + (colWidth[colOf(i)] - b.w) / 2, y: rowY[rowOf(i)] + shift[i] };
  });
  const port = function(i, side, dy)
  {
    return { x: pos[i].x + (side === "EAST" ? boxes[i].w : 0), y: pos[i].y + dy };
  };
  // the left and right edge of each gutter
  const gutterSpan = function(g)
  {
    const lo = (g === 0) ? (grid.left || 0) : colX[g - 1] + colWidth[g - 1];
    const hi = (g === cols) ? lo + gutterWidth[g] : colX[g];

    return { lo: lo, hi: hi };
  };
  const gapSpan = function(h)
  {
    const lo = (h === 0) ? (grid.top || 0) : rowY[h - 1] + rowHeight[h - 1];

    return { lo: lo, hi: lo + gapHeight[h] };
  };

  // 3. lanes in the gaps (by where they start), then the ends of every
  // gutter segment
  gapLanes.forEach(function(lanes, h)
  {
    const span = gapSpan(h);
    const sorted = lanes.slice().sort(function(a, b)
    {
      const pa = plans[a.k];
      const pb = plans[b.k];

      return Math.min(pa.gutterA, pa.gutterB) - Math.min(pb.gutterA, pb.gutterB) || a.k - b.k;
    });
    const first = (span.lo + span.hi) / 2 - (sorted.length - 1) * LANE / 2;

    sorted.forEach(function(lane, i) { lane.y = first + i * LANE; });
  });

  // links that end at the same point (several relations to one key row)
  // get their own points on it, ordered by where they come from, so no two
  // share a stub or a track
  const ends = new Map();

  for (const p of plans)
  {
    p.offA = 0;
    p.offB = 0;
    const baseA = port(p.l.a, p.sideA, p.l.ya);
    const baseB = port(p.l.b, p.sideB, p.l.yb);
    const add = function(box, side, y, end, far)
    {
      const key = box + "|" + side + "|" + Math.round(y);

      if (!ends.has(key))
      {
        ends.set(key, []);
      }

      ends.get(key).push({ p: p, end: end, far: far });
    };

    add(p.l.a, p.sideA, p.l.ya, "A", baseB.y);
    add(p.l.b, p.sideB, p.l.yb, "B", baseA.y);
  }

  const room = (grid.rowHeight || 26) - 6;

  ends.forEach(function(list)
  {
    if (list.length < 2)
    {
      return;
    }

    const step = Math.min(SPREAD, room / (list.length - 1));
    list.sort(function(u, v) { return u.far - v.far || u.p.k - v.p.k; });
    list.forEach(function(e, j)
    {
      e.p["off" + e.end] = (j - (list.length - 1) / 2) * step;
    });
  });

  for (const p of plans)
  {
    const pa = port(p.l.a, p.sideA, p.l.ya + p.offA);
    const pb = port(p.l.b, p.sideB, p.l.yb + p.offB);
    p.pa = pa;
    p.pb = pb;

    if (p.kind === "same")
    {
      const d = (p.sideA === "EAST") ? -1 : 1;
      p.seg.lo = Math.min(pa.y, pb.y);
      p.seg.hi = Math.max(pa.y, pb.y);
      p.seg.stubs = [{ y: pa.y, dir: d }, { y: pb.y, dir: d }];
    }
    else if (p.kind === "next")
    {
      // the stub toward a, and toward b
      p.seg.lo = Math.min(pa.y, pb.y);
      p.seg.hi = Math.max(pa.y, pb.y);
      p.seg.stubs = [{ y: pa.y, dir: pa.x < pb.x ? -1 : 1 }, { y: pb.y, dir: pa.x < pb.x ? 1 : -1 }];
    }
    else
    {
      const toB = (pb.x > pa.x) ? 1 : -1;
      p.segA.lo = Math.min(pa.y, p.lane.y);
      p.segA.hi = Math.max(pa.y, p.lane.y);
      p.segA.stubs = [{ y: pa.y, dir: -toB }, { y: p.lane.y, dir: toB }];
      p.segB.lo = Math.min(pb.y, p.lane.y);
      p.segB.hi = Math.max(pb.y, p.lane.y);
      p.segB.stubs = [{ y: p.lane.y, dir: -toB }, { y: pb.y, dir: toB }];
    }
  }

  // 4. tracks: a straight link between neighbours needs none
  const maxJog = grid.maxJog || 0;

  for (const p of plans)
  {
    if (p.kind === "next" && Math.abs(p.pa.y - p.pb.y) <= maxJog)
    {
      p.straight = true;
      gutterSegs[p.gutter] = gutterSegs[p.gutter].filter(function(s) { return s !== p.seg; });
    }
  }

  gutterSegs.forEach(function(segs, g)
  {
    const span = gutterSpan(g);
    const ordered = orderGutter(segs, grid.fast ? 3 : 6);
    const first = (span.lo + span.hi) / 2 - (ordered.length - 1) * TRACK / 2;

    ordered.forEach(function(s, i) { s.x = first + i * TRACK; });
  });

  // 5. the routes
  const routes = plans.map(function(p)
  {
    const pa = p.pa;
    const pb = p.pb;
    let points;
    let dyB = p.offB;

    if (p.straight)
    {
      dyB = p.offB + pa.y - pb.y;
      points = [pa, { x: pb.x, y: pa.y }];
    }
    else if (p.kind === "same" || p.kind === "next")
    {
      points = [pa, { x: p.seg.x, y: pa.y }, { x: p.seg.x, y: pb.y }, pb];
    }
    else
    {
      points = [pa, { x: p.segA.x, y: pa.y }, { x: p.segA.x, y: p.lane.y }, { x: p.segB.x, y: p.lane.y },
        { x: p.segB.x, y: pb.y }, pb];
    }

    return { points: points, sideA: p.sideA, sideB: p.sideB, dyA: p.offA, dyB: dyB };
  });

  return { pos: pos, routes: routes, width: width, height: height };
}
