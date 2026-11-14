// The lines of a page grid (shared/grid-layout.js, one grid for the page).
//
// A grid has room for lines in two kinds of places: the gaps between its
// columns and rows (and around the grid), and the cells nothing stands in.
// A line is planned on those before the grid has its final size: which gaps
// it runs through, on which side it leaves and arrives. Lines that share a
// gap each get a track of their own, in the order that crosses least, and
// the gap is then made as wide as its tracks need. So the room follows the
// lines, where a router that comes after the placement has to squeeze them
// into what is left.
//
//   planLines(grid, edges, options) → plan      routes and the room they need
//   drawLines(plan, geometry)       → lines     points, ports, label positions
//
// Lines of one bundle (edge.bundle: the lines from one shape to every member
// of a group, or to one shape from several) are one tree: they may run on
// each other, share a track where they do and one place on the side of the
// shape they have in common.
//
// Abstract coordinates: column c is the line X = 2c + 1, the gap before it
// X = 2c (so X = 0 and X = 2 * cols are the rims), rows likewise in Y. A
// route is a walk over these lines, and a run is a straight piece of it.

/** Distance between two lines that run side by side, px. */
export const TRACK = 14;

/** Distance from the outermost line of a gap to what borders the gap, px. */
export const TRACK_MARGIN = 16;

// The same inside a frame's border, where room is short.
const FRAME_MARGIN = 12;

// Between a frame's border and the shapes inside, on a side where a line
// ends at the frame.
const FRAME_END = 30;

// Two lines of different shapes that pass each other on one row or column
// keep this distance.
const APART = 10;

const COST =
{
  bend: 22,       // a corner
  px: 0.06,       // length, per pixel
  cross: 18,      // crossing another line
  beside: 5,      // running beside another line in a gap (the gap gets wider)
  inCell: 12,     // running beside another line through a row or a column
  foreign: 26,    // a step inside a frame that holds neither end
  outside: 12,    // a step outside the frame that holds both ends
  rim: 10,        // a step around the outside of the grid
  title: 90,      // through a frame's title
  full: 60        // one more line on a side that has no room for it
};

// Length along a piece that a line of the same bundle already runs on: the
// trunk is there, so following it is almost free.
const SHARED_PX = 0.15;

const DX = [1, 0, -1, 0];   // E, S, W, N
const DY = [0, 1, 0, -1];
const SIDES = ["E", "S", "W", "N"];
const OPPOSITE = { E: "W", W: "E", N: "S", S: "N" };

// ─── Small things ────────────────────────────────────────────────

function Heap()
{
  this.keys = [];
  this.values = [];
}

Heap.prototype.push = function(key, value)
{
  const keys = this.keys;
  const values = this.values;
  let i = keys.length;

  keys.push(key);
  values.push(value);

  while (i > 0)
  {
    const p = (i - 1) >> 1;

    if (keys[p] <= key)
    {
      break;
    }

    keys[i] = keys[p];
    values[i] = values[p];
    i = p;
  }

  keys[i] = key;
  values[i] = value;
};

Heap.prototype.pop = function()
{
  const keys = this.keys;
  const values = this.values;
  const top = values[0];
  const key = keys.pop();
  const value = values.pop();
  const n = keys.length;

  if (n > 0)
  {
    let i = 0;

    for (;;)
    {
      let c = 2 * i + 1;

      if (c >= n)
      {
        break;
      }

      if (c + 1 < n && keys[c + 1] < keys[c])
      {
        c++;
      }

      if (keys[c] >= key)
      {
        break;
      }

      keys[i] = keys[c];
      values[i] = values[c];
      i = c;
    }

    keys[i] = key;
    values[i] = value;
  }

  return top;
};

function isAncestor(frame, item)
{
  for (let p = item; p != null; p = p.parent)
  {
    if (p === frame)
    {
      return true;
    }
  }

  return false;
}

function terminalOf(item)
{
  const leaf = item.children.length === 0;

  return { item: item, leaf: leaf, c0: leaf ? item.gc : item.c0, c1: leaf ? item.gc : item.c1,
    r0: leaf ? item.gr : item.r0, r1: leaf ? item.gr : item.r1 };
}

/**
 * How far from its middle a side takes lines: half the side less its
 * corners; nothing where the outline leaves the bounding box (a rhombus, an
 * ellipse), little on the round ends of a pill.
 */
export function portReach(item, side)
{
  const st = item.st;
  const along = (side === "E" || side === "W") ? item.h : item.w;

  if (item.children.length > 0)
  {
    return Math.max(0, along / 2 - 8);
  }

  if (st.names.indexOf("rhombus") >= 0 || st.map.shape === "rhombus" || st.names.indexOf("ellipse") >= 0 ||
    st.map.shape === "umlActor")
  {
    return 0;
  }

  if (st.map.rounded === "1" && Number(st.map.arcSize) >= 40)
  {
    const r = Math.min(item.w, item.h) / 2;

    return Math.max(0, Math.min(along / 2 - r + 8, along / 2 - 6));
  }

  return Math.max(0, along / 2 - Math.min(12, along * 0.2));
}

// ─── Planning ────────────────────────────────────────────────────

/**
 * Plans the lines of a grid.
 *
 * @param {object} grid - { cols, rows, leaves (items with gc, gr), frames
 *   (items with c0, c1, r0, r1 and, for a title, titleFrom and titleTo in px),
 *   px, py (the position of every abstract line, for lengths), bands (true
 *   for lanes: frames are then no obstacles) }
 * @param {object[]} edges - { from, to (items), labelW, labelH, decision,
 *   index, bundle (lines with the same value are one tree, or null) }
 * @param {{track?: number, margin?: number}} [options]
 * @returns {{lines: object[], room: {col: number[], row: number[]},
 *   track: number, margin: number}}
 */
export function planLines(grid, edges, options)
{
  const opts = options || {};
  const track = opts.track || TRACK;
  const margin = opts.margin || TRACK_MARGIN;
  const NX = 2 * grid.cols + 1;
  const NY = 2 * grid.rows + 1;
  const N = NX * NY;
  const px = grid.px;
  const py = grid.py;
  const occupied = new Array(N).fill(null);

  for (const l of grid.leaves)
  {
    const n = (2 * l.gc + 1) + (2 * l.gr + 1) * NX;

    (occupied[n] = occupied[n] || []).push(l);
  }

  // The frames around every node, and where a line up or down would run
  // through a title.
  const framesAt = new Array(N).fill(null);
  const titleAt = new Uint8Array(N);

  if (!grid.bands)
  {
    for (const f of grid.frames)
    {
      for (let Y = 2 * f.r0 + 1; Y <= 2 * f.r1 + 1; Y++)
      {
        for (let X = 2 * f.c0 + 1; X <= 2 * f.c1 + 1; X++)
        {
          (framesAt[X + Y * NX] = framesAt[X + Y * NX] || []).push(f);
        }
      }

      if (f.titleFrom != null)
      {
        for (let X = 2 * f.c0 + 1; X <= 2 * f.c1 + 1; X++)
        {
          if (px[X] > f.titleFrom - 8 && px[X] < f.titleTo + 8)
          {
            titleAt[X + (2 * f.r0 + 1) * NX] = 1;
          }
        }
      }
    }
  }

  // What is drawn so far: how many lines use each piece between two nodes,
  // how many pass straight through a node each way, how many turn there.
  const segH = new Int16Array(N);
  const segV = new Int16Array(N);
  const thruH = new Int16Array(N);
  const thruV = new Int16Array(N);
  const turn = new Int16Array(N);
  const sides = new Map();
  const drawn = { segH: segH, segV: segV, thruH: thruH, thruV: thruV, turn: turn };

  // The same for the lines of every bundle alone: what a line shares with
  // its own bundle is neither beside it nor crossed by it.
  const bundles = new Map();

  function bundleOf(e)
  {
    if (e.bundle == null)
    {
      return null;
    }

    if (!bundles.has(e.bundle))
    {
      bundles.set(e.bundle, { segH: new Int16Array(N), segV: new Int16Array(N), thruH: new Int16Array(N),
        thruV: new Int16Array(N), turn: new Int16Array(N) });
    }

    return bundles.get(e.bundle);
  }

  function usedSide(item, side)
  {
    const m = sides.get(item);

    return (m != null && m[side] != null) ? m[side] : [];
  }

  function useSide(item, side, entry, sign)
  {
    if (!sides.has(item))
    {
      sides.set(item, {});
    }

    const m = sides.get(item);
    const list = (m[side] = m[side] || []);

    if (sign > 0)
    {
      list.push(entry);
    }
    else
    {
      const i = list.findIndex(function(u) { return u.line === entry.line; });

      if (i >= 0)
      {
        list.splice(i, 1);
      }
    }
  }

  function capacity(item, side)
  {
    return Math.floor(2 * portReach(item, side) / 10) + 1;
  }

  function mark(maps, path, sign)
  {
    for (let i = 0; i + 1 < path.length; i++)
    {
      const a = path[i];
      const b = path[i + 1];

      if (a.Y === b.Y)
      {
        maps.segH[Math.min(a.X, b.X) + a.Y * NX] += sign;
      }
      else
      {
        maps.segV[a.X + Math.min(a.Y, b.Y) * NX] += sign;
      }

      if (i > 0)
      {
        const p = path[i - 1];
        const n = a.X + a.Y * NX;

        if ((p.Y === a.Y) !== (a.Y === b.Y))
        {
          maps.turn[n] += sign;
        }
        else if (a.Y === b.Y)
        {
          maps.thruH[n] += sign;
        }
        else
        {
          maps.thruV[n] += sign;
        }
      }
    }
  }

  function book(line, sign)
  {
    const own = bundleOf(line.e);

    mark(drawn, line.path, sign);

    if (own != null)
    {
      mark(own, line.path, sign);
    }

    useSide(line.e.from, line.exit, { out: true, other: line.e.to, line: line }, sign);
    useSide(line.e.to, line.entry, { out: false, other: line.e.from, line: line }, sign);
  }

  function starts(t)
  {
    const list = [];
    const y0 = 2 * t.r0 + 1;
    const y1 = 2 * t.r1 + 1;
    const x0 = 2 * t.c0 + 1;
    const x1 = 2 * t.c1 + 1;

    for (let Y = y0; Y <= y1; Y++)
    {
      list.push({ X: x1 + 1, Y: Y, dir: 0 });
      list.push({ X: x0 - 1, Y: Y, dir: 2 });
    }

    for (let X = x0; X <= x1; X++)
    {
      list.push({ X: X, Y: y1 + 1, dir: 1 });
      list.push({ X: X, Y: y0 - 1, dir: 3 });
    }

    return list;
  }

  // Whether a step from (X, Y) in `dir` arrives at the terminal.
  function arrives(t, X, Y, dir)
  {
    const inY = Y >= 2 * t.r0 + 1 && Y <= 2 * t.r1 + 1;
    const inX = X >= 2 * t.c0 + 1 && X <= 2 * t.c1 + 1;

    return (dir === 0 && X === 2 * t.c0 && inY) || (dir === 2 && X === 2 * t.c1 + 2 && inY) ||
      (dir === 1 && Y === 2 * t.r0 && inX) || (dir === 3 && Y === 2 * t.r1 + 2 && inX);
  }

  function route(job)
  {
    const e = job.e;
    const S = job.S;
    const T = job.T;
    const dist = new Float64Array(N * 4).fill(Infinity);
    const prev = new Int32Array(N * 4).fill(-1);
    const heap = new Heap();
    let goal = -1;
    let goalCost = Infinity;
    let goalDir = 0;
    const own = bundleOf(e);

    // A line of its own bundle on a side takes no place there: both use one.
    function exitCost(side)
    {
      const used = usedSide(e.from, side);
      let c = 0;
      let others = 0;
      let shared = false;

      for (const u of used)
      {
        if (own != null && u.line.e.bundle === e.bundle)
        {
          shared = true;

          continue;
        }

        others++;
        c += u.out ? (u.other === e.to ? 2 : (e.decision ? 60 : 14)) : 30;
      }

      if (!shared && others >= capacity(e.from, side))
      {
        c += COST.full;
      }

      return c;
    }

    function entryCost(side)
    {
      const used = usedSide(e.to, side);
      let c = 0;
      let others = 0;
      let shared = false;

      for (const u of used)
      {
        if (own != null && u.line.e.bundle === e.bundle)
        {
          shared = true;

          continue;
        }

        others++;
        c += u.out ? 30 : (u.other === e.from ? 2 : 6);
      }

      if (!shared && others >= capacity(e.to, side))
      {
        c += COST.full;
      }

      return c;
    }

    function nodeCost(n, X, Y, dir)
    {
      const through = ((dir & 1) === 0) ? thruV[n] - (own != null ? own.thruV[n] : 0) : thruH[n] - (own != null ? own.thruH[n] : 0);
      let c = COST.cross * through + COST.cross * 0.5 * (turn[n] - (own != null ? own.turn[n] : 0));
      const around = framesAt[n];

      if (around != null)
      {
        for (const f of around)
        {
          if (!job.allowed.has(f))
          {
            c += COST.foreign;
          }
        }
      }

      // The gaps around the frame of both ends still count as inside: a
      // line there runs within the frame's border.
      if (job.home != null && (X < 2 * job.home.c0 || X > 2 * job.home.c1 + 2 || Y < 2 * job.home.r0 ||
        Y > 2 * job.home.r1 + 2))
      {
        c += COST.outside;
      }

      if (X === 0 || Y === 0 || X === NX - 1 || Y === NY - 1)
      {
        c += COST.rim;
      }

      return c;
    }

    for (const s of starts(S))
    {
      if (s.X < 0 || s.Y < 0 || s.X >= NX || s.Y >= NY)
      {
        continue;
      }

      const n = s.X + s.Y * NX;
      const side = SIDES[s.dir];

      // A stacked shape leaves upward only from the top of its stack.
      if (S.leaf && occupied[(2 * S.c0 + 1) + (2 * S.r0 + 1) * NX].length > 1 && (s.dir & 1) === 1)
      {
        const stack = occupied[(2 * S.c0 + 1) + (2 * S.r0 + 1) * NX];

        if ((s.dir === 3 && stack[0] !== S.item) || (s.dir === 1 && stack[stack.length - 1] !== S.item))
        {
          continue;
        }
      }

      const c = exitCost(side) + nodeCost(n, s.X, s.Y, s.dir) +
        COST.px * Math.abs((s.dir & 1) === 0 ? px[s.X] - px[s.X - DX[s.dir]] : py[s.Y] - py[s.Y - DY[s.dir]]) * 0.5;

      if (c < dist[n * 4 + s.dir])
      {
        dist[n * 4 + s.dir] = c;
        heap.push(c, n * 4 + s.dir);
      }
    }

    while (heap.keys.length > 0)
    {
      const key = heap.keys[0];
      const state = heap.pop();

      if (key > dist[state] + 1e-9)
      {
        continue;
      }

      if (key >= goalCost)
      {
        break;
      }

      const n = state >> 2;
      const from = state & 3;
      const X = n % NX;
      const Y = (n - X) / NX;

      for (let dir = 0; dir < 4; dir++)
      {
        if (((dir + 2) & 3) === from)
        {
          continue;
        }

        const bend = (dir !== from) ? COST.bend : 0;

        if (arrives(T, X, Y, dir))
        {
          const c = key + bend + entryCost(OPPOSITE[SIDES[dir]]) +
            COST.px * Math.abs((dir & 1) === 0 ? px[X + DX[dir]] - px[X] : py[Y + DY[dir]] - py[Y]) * 0.5;

          if (c < goalCost)
          {
            goalCost = c;
            goal = state;
            goalDir = dir;
          }

          continue;
        }

        const X2 = X + DX[dir];
        const Y2 = Y + DY[dir];

        if (X2 < 0 || Y2 < 0 || X2 >= NX || Y2 >= NY)
        {
          continue;
        }

        const n2 = X2 + Y2 * NX;

        if (occupied[n2] != null)
        {
          continue;
        }

        const horizontal = (dir & 1) === 0;
        const mine = (own == null) ? 0 : (horizontal ? own.segH[Math.min(n, n2)] : own.segV[Math.min(n, n2)]);
        const used = (horizontal ? segH[Math.min(n, n2)] : segV[Math.min(n, n2)]) - mine;
        const inCell = horizontal ? (Y & 1) === 1 : (X & 1) === 1;
        let c = key + bend + nodeCost(n2, X2, Y2, dir) + used * (inCell ? COST.inCell : COST.beside) +
          COST.px * (mine > 0 ? SHARED_PX : 1) * (horizontal ? Math.abs(px[X2] - px[X]) : Math.abs(py[Y2] - py[Y]));

        // up or down across the top of a frame, where its title is
        if (!horizontal && (Math.max(Y, Y2) & 1) === 1 && titleAt[X + Math.max(Y, Y2) * NX] === 1)
        {
          c += COST.title;
        }

        if (c < dist[n2 * 4 + dir] - 1e-9)
        {
          dist[n2 * 4 + dir] = c;
          prev[n2 * 4 + dir] = state;
          heap.push(c, n2 * 4 + dir);
        }
      }
    }

    if (goal < 0)
    {
      return null;
    }

    // Back from the goal to the start; both ends get the node inside their
    // shape, so that every piece of the line lies between two nodes.
    const nodes = [];
    let first = goal;

    for (let s = goal; s >= 0; s = prev[s])
    {
      const n = s >> 2;

      nodes.push({ X: n % NX, Y: Math.floor(n / NX) });
      first = s;
    }

    nodes.reverse();

    const startDir = first & 3;
    const a = nodes[0];
    const b = nodes[nodes.length - 1];

    nodes.unshift({ X: a.X - DX[startDir], Y: a.Y - DY[startDir] });
    nodes.push({ X: b.X + DX[goalDir], Y: b.Y + DY[goalDir] });

    return { e: e, S: S, T: T, home: job.home, exit: SIDES[startDir], entry: OPPOSITE[SIDES[goalDir]], path: nodes,
      cost: goalCost };
  }

  // Short lines first: they take the straight ways, the long ones go around
  // what is there. Then every line once more, now that it knows the others.
  const jobs = [];

  for (const e of edges)
  {
    const S = terminalOf(e.from);
    const T = terminalOf(e.to);

    if (e.from === e.to || isAncestor(e.from, e.to) || isAncestor(e.to, e.from) ||
      (S.leaf && T.leaf && S.c0 === T.c0 && S.r0 === T.r0))
    {
      continue;
    }

    const allowed = new Set();
    let home = null;

    for (let p = e.from; p != null; p = p.parent)
    {
      allowed.add(p);
    }

    for (let p = e.to; p != null; p = p.parent)
    {
      if (home == null && p.children.length > 0 && allowed.has(p))
      {
        home = p;
      }

      allowed.add(p);
    }

    jobs.push({ e: e, S: S, T: T, allowed: allowed, home: grid.bands ? null : home,
      d: Math.abs(S.c0 + S.c1 - T.c0 - T.c1) + Math.abs(S.r0 + S.r1 - T.r0 - T.r1) });
  }

  jobs.sort(function(a, b) { return (a.d - b.d) || (a.e.index - b.e.index); });

  for (const job of jobs)
  {
    job.line = route(job);

    if (job.line != null)
    {
      book(job.line, 1);
    }
  }

  for (let round = 0; round < 2; round++)
  {
    for (const job of jobs)
    {
      if (job.line == null)
      {
        continue;
      }

      book(job.line, -1);

      job.line = route(job) || job.line;
      book(job.line, 1);
    }
  }

  const lines = jobs.filter(function(j) { return j.line != null; }).map(function(j) { return j.line; });

  const frameIds = new Map(grid.frames.map(function(f, i) { return [f, i]; }));

  // A line between two shapes of one frame stays within the frame's border
  // where it runs along it: in the frame's own room, inside the border,
  // instead of the gap's, which lies outside every frame that ends there.
  function zoneOf(run, home)
  {
    const i = run.line / 2;

    for (let f = home; f != null; f = f.parent)
    {
      const within = run.vertical ? (run.lo >= 2 * f.r0 && run.hi <= 2 * f.r1 + 2) :
        (run.lo >= 2 * f.c0 && run.hi <= 2 * f.c1 + 2);

      if (within)
      {
        const side = run.vertical ? (i === f.c0 ? "left" : i === f.c1 + 1 ? "right" : null) :
          (i === f.r0 ? "top" : i === f.r1 + 1 ? "bottom" : null);

        return (side != null) ? { frame: f, side: side } : null;
      }
    }

    return null;
  }

  for (const line of lines)
  {
    buildRuns(line);

    for (const run of line.runs)
    {
      run.zone = ((run.line & 1) === 0 && line.home != null) ? zoneOf(run, line.home) : null;
      run.group = (run.vertical ? "v" : "h") + run.line +
        (run.zone != null ? "|" + frameIds.get(run.zone.frame) + run.zone.side : "");
    }
  }

  assignTracks(lines, track);

  // The room every gap needs: its tracks, and the label of a line that has
  // no other place for it.
  const room = { col: new Array(grid.cols + 1).fill(0), row: new Array(grid.rows + 1).fill(0), frames: new Map() };
  const count = { col: new Array(grid.cols + 1).fill(0), row: new Array(grid.rows + 1).fill(0) };

  for (const line of lines)
  {
    for (const run of line.runs)
    {
      if ((run.line & 1) === 1)
      {
        continue;
      }

      if (run.zone != null)
      {
        if (!room.frames.has(run.zone.frame))
        {
          room.frames.set(run.zone.frame, { left: 0, right: 0, top: 0, bottom: 0 });
        }

        const sidesOf = room.frames.get(run.zone.frame);

        sidesOf[run.zone.side] = Math.max(sidesOf[run.zone.side], 2 * FRAME_MARGIN + (run.tracks - 1) * track);
      }
      else
      {
        const list = run.vertical ? count.col : count.row;

        list[run.line / 2] = Math.max(list[run.line / 2], run.tracks);
      }
    }
  }

  // A line that ends at a frame ends at its border, with room to the shapes
  // inside: one that ends right beside a shape reads as a line to that shape.
  if (!grid.bands)
  {
    for (const line of lines)
    {
      for (const end of [{ item: line.e.from, side: line.exit }, { item: line.e.to, side: line.entry }])
      {
        if (end.item.children.length === 0 || end.side === "N")
        {
          continue;
        }

        if (!room.frames.has(end.item))
        {
          room.frames.set(end.item, { left: 0, right: 0, top: 0, bottom: 0 });
        }

        const sidesOf = room.frames.get(end.item);
        const name = (end.side === "E") ? "right" : (end.side === "W") ? "left" : "bottom";

        sidesOf[name] = Math.max(sidesOf[name], FRAME_END);
      }
    }
  }

  for (let g = 0; g <= grid.cols; g++)
  {
    room.col[g] = count.col[g] > 0 ? 2 * margin + (count.col[g] - 1) * track : 0;
  }

  for (let h = 0; h <= grid.rows; h++)
  {
    room.row[h] = count.row[h] > 0 ? 2 * margin + (count.row[h] - 1) * track : 0;
  }

  for (const line of lines)
  {
    if (!(line.e.labelW > 0))
    {
      continue;
    }

    // A piece along a row that passes at least a column has room for the
    // label; so has a straight line across one gap, which the placement
    // widens itself.
    const wide = line.runs.some(function(r) { return !r.vertical && r.hi - r.lo >= 2; });

    if (wide)
    {
      continue;
    }

    let best = null;

    for (const r of line.runs)
    {
      if (r.vertical && (r.line & 1) === 0 && r.zone == null && (best == null || r.hi - r.lo > best.hi - best.lo))
      {
        best = r;
      }
    }

    // Where it passes from one row to the next, the label stands between
    // the rows, where no shape is beside the line.
    if (best != null && !(2 * Math.ceil(best.hi / 2) - 2 > best.lo))
    {
      const g = best.line / 2;

      room.col[g] = Math.max(room.col[g], Math.ceil(line.e.labelW + 12 + Math.max(0, count.col[g] - 1) * track));
    }
  }

  return { lines: lines, room: room, track: track, margin: margin, grid: { cols: grid.cols, rows: grid.rows } };
}

// The straight pieces of a line.
function buildRuns(line)
{
  const path = line.path;
  const runs = [];
  let from = 0;

  for (let i = 1; i < path.length; i++)
  {
    const last = i === path.length - 1;
    const turns = !last && ((path[i].Y === path[i - 1].Y) !== (path[i + 1].Y === path[i].Y));

    if (last || turns)
    {
      const a = path[from];
      const b = path[i];
      const vertical = a.X === b.X;
      let start = vertical ? a.Y : a.X;
      let end = vertical ? b.Y : b.X;

      // The border of a frame lies half a step outside its first cell.
      if (from === 0 && !line.S.leaf)
      {
        start += Math.sign(end - start) * 0.5;
      }

      if (last && !line.T.leaf)
      {
        end -= Math.sign(end - start) * 0.5;
      }

      runs.push({ line: vertical ? a.X : a.Y, vertical: vertical, start: start, end: end,
        lo: Math.min(start, end), hi: Math.max(start, end), owner: line, index: runs.length,
        termStart: from === 0, termEnd: last, off: null, track: 0, tracks: 1 });
      from = i;
    }
  }

  runs.forEach(function(r, i)
  {
    const before = (i > 0) ? runs[i - 1] : null;
    const after = (i + 1 < runs.length) ? runs[i + 1] : null;
    const turnStart = (before != null) ? Math.sign(before.start - before.end) : 0;
    const turnEnd = (after != null) ? Math.sign(after.end - after.start) : 0;
    const forward = r.start <= r.end;

    r.turnLo = forward ? turnStart : turnEnd;
    r.turnHi = forward ? turnEnd : turnStart;
    r.perpLo = forward ? before : after;
    r.perpHi = forward ? after : before;
  });

  line.runs = runs;
}

// Whether a line that turns at `x` (its piece across is `perp`) passes
// through the run R on its way.
function passes(x, perp, R)
{
  if (x > R.lo && x < R.hi)
  {
    return 1;
  }

  if (x !== R.lo && x !== R.hi)
  {
    return 0;
  }

  // Both turn at the same place: it depends on which turns first.
  const q = (x === R.lo) ? R.perpLo : R.perpHi;

  if (q == null)
  {
    return 0;
  }

  if (perp == null || q.off == null || perp.off == null || perp.off === q.off)
  {
    return 0.5;
  }

  return ((x === R.lo) === (perp.off > q.off)) ? 1 : 0;
}

// Crossings between two runs on one line when A lies before B (above it, or
// left of it).
function crossingsIfBefore(A, B)
{
  let c = 0;

  if (A.turnLo > 0)
  {
    c += passes(A.lo, A.perpLo, B);
  }

  if (A.turnHi > 0)
  {
    c += passes(A.hi, A.perpHi, B);
  }

  if (B.turnLo < 0)
  {
    c += passes(B.lo, B.perpLo, A);
  }

  if (B.turnHi < 0)
  {
    c += passes(B.hi, B.perpHi, A);
  }

  // Among orders that cross equally: a run whose ends turn up lies above
  // one whose ends turn down, which keeps both short.
  return c + 0.01 * Math.max(0, (A.turnLo + A.turnHi) - (B.turnLo + B.turnHi));
}

// The order of the runs of one line that overlap each other, with the
// fewest crossings.
function orderRuns(list)
{
  const n = list.length;

  if (n < 2)
  {
    return list.slice();
  }

  const m = [];

  for (let i = 0; i < n; i++)
  {
    m.push([]);

    for (let j = 0; j < n; j++)
    {
      m[i].push(i === j ? 0 : crossingsIfBefore(list[i], list[j]));
    }
  }

  let order = [];

  if (n <= 8)
  {
    // every order, cutting off what is worse than the best so far
    const used = new Array(n).fill(false);
    const current = [];
    let best = Infinity;

    (function extend(cost)
    {
      if (cost >= best - 1e-9)
      {
        return;
      }

      if (current.length === n)
      {
        best = cost;
        order = current.slice();

        return;
      }

      for (let i = 0; i < n; i++)
      {
        if (used[i])
        {
          continue;
        }

        let add = 0;

        for (const j of current)
        {
          add += m[j][i];
        }

        used[i] = true;
        current.push(i);
        extend(cost + add);
        current.pop();
        used[i] = false;
      }
    })(0);
  }
  else
  {
    // one by one where it crosses least, then neighbours swapped while
    // that helps
    for (let i = 0; i < n; i++)
    {
      let bestAt = 0;
      let bestCost = Infinity;

      for (let at = 0; at <= order.length; at++)
      {
        let cost = 0;

        for (let k = 0; k < order.length; k++)
        {
          cost += (k < at) ? m[order[k]][i] : m[i][order[k]];
        }

        if (cost < bestCost - 1e-9)
        {
          bestCost = cost;
          bestAt = at;
        }
      }

      order.splice(bestAt, 0, i);
    }

    for (let pass = 0, changed = true; changed && pass < 20; pass++)
    {
      changed = false;

      for (let k = 0; k + 1 < n; k++)
      {
        if (m[order[k + 1]][order[k]] < m[order[k]][order[k + 1]] - 1e-9)
        {
          const t = order[k];

          order[k] = order[k + 1];
          order[k + 1] = t;
          changed = true;
        }
      }
    }
  }

  return order.map(function(i) { return list[i]; });
}

function sideKey(run, atStart)
{
  const line = run.owner;
  const item = atStart ? line.e.from : line.e.to;
  const side = atStart ? line.exit : line.entry;

  // A frame takes lines all along its border: a side per row or column.
  return { item: item, side: side, key: (item.children.length > 0) ? side + run.line : side };
}

// The ports of every side: the runs that end there, in their order across.
function collectSides(lines)
{
  const sides = new Map();

  for (const line of lines)
  {
    for (const run of line.runs)
    {
      run.sides = [];

      if ((run.line & 1) === 0)
      {
        continue;
      }

      for (const atStart of [true, false])
      {
        if (atStart ? run.termStart : run.termEnd)
        {
          const k = sideKey(run, atStart);

          if (!sides.has(k.item))
          {
            sides.set(k.item, new Map());
          }

          if (!sides.get(k.item).has(k.key))
          {
            sides.get(k.item).set(k.key, { item: k.item, side: k.side, runs: [], shift: null });
          }

          const rec = sides.get(k.item).get(k.key);

          rec.runs.push(run);
          run.sides.push(rec);
        }
      }
    }
  }

  return sides;
}

function spreadSide(rec, track)
{
  rec.runs.sort(function(a, b) { return a.rank - b.rank; });

  // The lines of a bundle share one place.
  const places = [];
  const placeOf = new Map();
  let n = 0;

  for (const r of rec.runs)
  {
    const b = r.owner.e.bundle;

    if (b != null && placeOf.has(b))
    {
      places.push(placeOf.get(b));
    }
    else
    {
      if (b != null)
      {
        placeOf.set(b, n);
      }

      places.push(n++);
    }
  }

  const reach = portReach(rec.item, rec.side);
  const step = (n > 1) ? Math.min(track, 2 * reach / (n - 1)) : 0;

  rec.count = n;
  rec.reach = reach;
  rec.step = step;
  rec.slack = reach - (n - 1) * step / 2;
  rec.offs = places.map(function(i) { return (i - (n - 1) / 2) * step; });
}

// Orders the runs of every line and gives each its track: in a gap a
// distance from the middle of the gap, on a row or column a place on the
// side of its shape.
function assignTracks(lines, track)
{
  const byLine = [new Map(), new Map()];

  for (const line of lines)
  {
    for (const run of line.runs)
    {
      const m = byLine[run.vertical ? 1 : 0];

      if (!m.has(run.group))
      {
        m.set(run.group, []);
      }

      m.get(run.group).push(run);
    }
  }

  const sides = collectSides(lines);

  function settle(axis)
  {
    byLine[axis].forEach(function(runs)
    {
      const sorted = runs.slice().sort(function(a, b)
      {
        return (a.lo - b.lo) || (a.hi - b.hi) || (a.owner.e.index - b.owner.e.index);
      });
      let group = [];
      let reach = -Infinity;
      let rank = 0;

      const close = function()
      {
        // The runs of one bundle that meet here are one piece of its tree:
        // one track for them, ordered as their longest run.
        const pieces = [];
        const open = new Map();

        for (const r of group)
        {
          const b = r.owner.e.bundle;
          let piece = (b != null && open.has(b)) ? open.get(b) : null;

          if (piece == null || r.lo > piece.hi)
          {
            piece = { lo: r.lo, hi: r.hi, runs: [], lead: r, track: 0 };
            pieces.push(piece);

            if (b != null)
            {
              open.set(b, piece);
            }
          }

          piece.runs.push(r);
          piece.hi = Math.max(piece.hi, r.hi);

          if (r.hi - r.lo > piece.lead.hi - piece.lead.lo)
          {
            piece.lead = r;
          }
        }

        const pieceOf = new Map(pieces.map(function(p) { return [p.lead, p]; }));
        const ordered = orderRuns(pieces.map(function(p) { return p.lead; })).map(function(r) { return pieceOf.get(r); });
        let tracks = 0;

        ordered.forEach(function(p, i)
        {
          for (let k = 0; k < i; k++)
          {
            const o = ordered[k];

            if (o.lo <= p.hi && p.lo <= o.hi)
            {
              p.track = Math.max(p.track, o.track + 1);
            }
          }

          for (const r of p.runs)
          {
            r.rank = rank++;
            r.track = p.track;
          }

          tracks = Math.max(tracks, p.track + 1);
        });

        for (const r of group)
        {
          r.tracks = tracks;
          r.off = (r.track - (tracks - 1) / 2) * track;
        }
      };

      for (const r of sorted)
      {
        if (group.length > 0 && r.lo > reach)
        {
          close();
          group = [];
        }

        group.push(r);
        reach = Math.max(reach, r.hi);
      }

      if (group.length > 0)
      {
        close();
      }

      // On a row or a column, the place on the shape's side instead.
      for (const r of runs)
      {
        for (const rec of r.sides)
        {
          spreadSide(rec, track);
        }
      }

      for (const r of runs)
      {
        if (r.sides.length > 0)
        {
          r.off = r.sides[0].offs[r.sides[0].runs.indexOf(r)];
        }
      }
    });
  }

  // Which of two lines that turn in the same place turns first is known
  // only once the other direction is ordered, so: down, across, and again.
  settle(1);
  settle(0);
  settle(1);
  settle(0);

  return sides;
}

// ─── Drawing ─────────────────────────────────────────────────────

function clamp(v, lo, hi)
{
  return Math.max(lo, Math.min(hi, v));
}

function boxesOverlap(a, b)
{
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function segmentInBox(p, q, b)
{
  return Math.max(p.x, q.x) > b.x && Math.min(p.x, q.x) < b.x + b.w && Math.max(p.y, q.y) > b.y &&
    Math.min(p.y, q.y) < b.y + b.h;
}

function segmentsCross(a1, a2, b1, b2)
{
  const aH = Math.abs(a1.y - a2.y) < 0.01;
  const bH = Math.abs(b1.y - b2.y) < 0.01;

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

/**
 * The points of the planned lines in a placed grid.
 *
 * @param {object} plan - from planLines
 * @param {object} geo - { colX, colW, rowY, rowH, vz, hz (the room for
 *   tracks in every gap, {from, to}), zone(frame, side) → {from, to} (the
 *   room inside a frame's border), rect(item) → {x, y, w, h}, obstacles
 *   ({x, y, w, h} that labels keep off: shapes, their labels, titles) }
 * @returns {{lines: object[], crossings: number}} lines: { e, points, exit,
 *   entry ([x, y] as fractions of the shape), label (-1..1 along the line,
 *   or null) }
 */
export function drawLines(plan, geo)
{
  const track = plan.track;
  const sides = collectSides(plan.lines);

  for (const line of plan.lines)
  {
    for (const run of line.runs)
    {
      run.fixed = null;
      run.jog = null;
    }
  }

  function middle(rec, run)
  {
    const r = geo.rect(rec.item);

    if (rec.item.children.length > 0)
    {
      const i = (run.line - 1) / 2;

      return run.vertical ? geo.colX[i] + geo.colW[i] / 2 : geo.rowY[i] + geo.rowH[i] / 2;
    }

    return run.vertical ? r.x + r.w / 2 : r.y + r.h / 2;
  }

  sides.forEach(function(m)
  {
    m.forEach(function(rec)
    {
      spreadSide(rec, track);
      rec.middle = middle(rec, rec.runs[0]);
      rec.shift = null;
    });
  });

  function place(rec, run)
  {
    return rec.middle + rec.offs[rec.runs.indexOf(run)] + (rec.shift || 0);
  }

  // A straight line between two shapes has one place for both ends: the
  // side with fewer lines keeps its middle, the other one moves along.
  for (const line of plan.lines)
  {
    const run = line.runs[0];

    if (line.runs.length !== 1 || run.sides.length !== 2)
    {
      continue;
    }

    const A = run.sides[0];
    const B = run.sides[1];
    const a = A.middle + A.offs[A.runs.indexOf(run)];
    const b = B.middle + B.offs[B.runs.indexOf(run)];

    if (A.shift == null && B.shift == null)
    {
      const target = (A.count < B.count) ? a : (B.count < A.count) ? b : (a + b) / 2;

      A.shift = clamp(target - a, -A.slack, A.slack);
      B.shift = clamp(target - b, -B.slack, B.slack);
    }
    else if (B.shift == null)
    {
      B.shift = clamp(a + A.shift - b, -B.slack, B.slack);
    }
    else if (A.shift == null)
    {
      A.shift = clamp(b + B.shift - a, -A.slack, A.slack);
    }

    // Where the two sides still differ, the end with room gives way.
    const pa = a + A.shift;
    const pb = b + B.shift;

    if (Math.abs(pa - pb) > 0.5)
    {
      if (Math.abs(pa - B.middle) <= B.reach + 0.5)
      {
        run.fixed = pa;
      }
      else if (Math.abs(pb - A.middle) <= A.reach + 0.5)
      {
        run.fixed = pb;
      }
      else
      {
        run.jog = [pa, pb];
      }
    }
  }

  // The lines of a bundle keep one place on the side they share, also when
  // one of them is straight and was moved.
  sides.forEach(function(m)
  {
    m.forEach(function(rec)
    {
      for (const r of rec.runs)
      {
        if (r.fixed == null || r.owner.e.bundle == null)
        {
          continue;
        }

        for (const o of rec.runs)
        {
          if (o !== r && o.owner.e.bundle === r.owner.e.bundle && o.fixed == null && o.jog == null)
          {
            o.fixed = r.fixed;
          }
        }
      }
    });
  });

  function across(run)
  {
    if (run.fixed != null)
    {
      return run.fixed;
    }

    if (run.sides.length > 0)
    {
      return place(run.sides[0], run);
    }

    const i = run.line >> 1;

    if ((run.line & 1) === 0)
    {
      const zone = (run.zone != null) ? geo.zone(run.zone.frame, run.zone.side) : (run.vertical ? geo.vz[i] : geo.hz[i]);

      return (zone.from + zone.to) / 2 + run.off;
    }

    return (run.vertical ? geo.colX[i] + geo.colW[i] / 2 : geo.rowY[i] + geo.rowH[i] / 2) + run.off;
  }

  // Lines of different shapes that pass each other on one row or column
  // move apart, each as far as the side of its shape lets it.
  const onLine = new Map();

  for (const line of plan.lines)
  {
    for (const run of line.runs)
    {
      run.at = across(run);

      if ((run.line & 1) === 0 || run.jog != null)
      {
        continue;
      }

      const i = run.line >> 1;

      if (run.sides.length > 0)
      {
        run.min = Math.max.apply(null, run.sides.map(function(rec) { return rec.middle - rec.reach; }));
        run.max = Math.min.apply(null, run.sides.map(function(rec) { return rec.middle + rec.reach; }));
      }
      else
      {
        run.min = (run.vertical ? geo.colX[i] : geo.rowY[i]) + 6;
        run.max = (run.vertical ? geo.colX[i] + geo.colW[i] : geo.rowY[i] + geo.rowH[i]) - 6;
      }

      run.min = Math.min(run.min, run.at);
      run.max = Math.max(run.max, run.at);

      if (!onLine.has(run.group))
      {
        onLine.set(run.group, []);
      }

      onLine.get(run.group).push(run);
    }
  }

  const endsAtShape = function(run, v)
  {
    return (v === run.start && run.termStart) || (v === run.end && run.termEnd);
  };

  onLine.forEach(function(runs)
  {
    const pairs = [];

    runs.sort(function(a, b) { return a.rank - b.rank; });

    for (let i = 0; i < runs.length; i++)
    {
      for (let j = i + 1; j < runs.length; j++)
      {
        const a = runs[i];
        const b = runs[j];

        if (a.lo > b.hi || b.lo > a.hi)
        {
          continue;
        }

        // one tree
        if (a.owner.e.bundle != null && a.owner.e.bundle === b.owner.e.bundle)
        {
          continue;
        }

        // on two sides of one shape
        if ((a.hi === b.lo && endsAtShape(a, a.hi) && endsAtShape(b, b.lo)) ||
          (b.hi === a.lo && endsAtShape(b, b.hi) && endsAtShape(a, a.lo)))
        {
          continue;
        }

        const shared = a.sides.filter(function(rec) { return b.sides.indexOf(rec) >= 0; })[0];

        pairs.push({ a: a, b: b, apart: (shared != null) ? Math.min(shared.step, APART) : APART });
      }
    }

    for (let round = 0, moved = true; moved && round < 16; round++)
    {
      moved = false;

      for (const p of pairs)
      {
        const need = p.apart - (p.b.at - p.a.at);

        if (need <= 0.01)
        {
          continue;
        }

        const above = p.a.at - p.a.min;
        const below = p.b.max - p.b.at;
        let up = Math.min(need / 2, above);
        let down = Math.min(need - up, below);

        up = Math.min(need - down, above);

        if (up + down > 0.01)
        {
          p.a.at -= up;
          p.b.at += down;
          moved = true;
        }
      }
    }
  });

  for (const line of plan.lines)
  {
    for (const run of line.runs)
    {
      run.at = Math.round(run.at);
    }
  }

  const out = [];

  for (const line of plan.lines)
  {
    const runs = line.runs;
    const S = geo.rect(line.e.from);
    const T = geo.rect(line.e.to);
    const points = [];
    const at = runs.map(function(r) { return r.at; });
    const edgeOf = function(r, side)
    {
      return side === "E" ? r.x + r.w : side === "W" ? r.x : side === "S" ? r.y + r.h : r.y;
    };
    const first = runs[0];
    const last = runs[runs.length - 1];
    const startAt = (first.jog != null) ? Math.round(first.jog[0]) : at[0];
    const endAt = (last.jog != null) ? Math.round(last.jog[1]) : at[runs.length - 1];
    const s = edgeOf(S, line.exit);
    const t = edgeOf(T, line.entry);

    points.push(first.vertical ? { x: startAt, y: s } : { x: s, y: startAt });

    if (first.jog != null)
    {
      const mid = (s + t) / 2;

      points.push(first.vertical ? { x: startAt, y: mid } : { x: mid, y: startAt });
      points.push(first.vertical ? { x: endAt, y: mid } : { x: mid, y: endAt });
    }

    for (let i = 0; i + 1 < runs.length; i++)
    {
      points.push(runs[i].vertical ? { x: at[i], y: at[i + 1] } : { x: at[i + 1], y: at[i] });
    }

    points.push(last.vertical ? { x: endAt, y: t } : { x: t, y: endAt });

    const fraction = function(p, r)
    {
      return [clamp((p.x - r.x) / (r.w || 1), 0, 1), clamp((p.y - r.y) / (r.h || 1), 0, 1)];
    };

    out.push({ e: line.e, points: points, exit: fraction(points[0], S), entry: fraction(points[points.length - 1], T),
      label: null });
  }

  // Crossings, for the statistics. Where the lines of a bundle part is a
  // branch of their tree, not a crossing.
  let crossings = 0;

  for (let i = 0; i < out.length; i++)
  {
    for (let j = i + 1; j < out.length; j++)
    {
      if (out[i].e.bundle != null && out[i].e.bundle === out[j].e.bundle)
      {
        continue;
      }

      const a = out[i].points;
      const b = out[j].points;

      for (let k = 0; k + 1 < a.length; k++)
      {
        for (let l = 0; l + 1 < b.length; l++)
        {
          if (segmentsCross(a[k], a[k + 1], b[l], b[l + 1]))
          {
            crossings++;
          }
        }
      }
    }
  }

  placeLabels(out, geo.obstacles || []);

  return { lines: out, crossings: crossings };
}

// Where every label goes: on the piece of its line where it touches least.
// A label lies just above a piece that runs across and on a piece that runs
// up or down; the outcome of a decision stays near the decision.
function placeLabels(lines, obstacles)
{
  const placed = [];
  const labeled = lines.filter(function(l) { return l.e.labelW > 0; });

  // short labels last: they fit anywhere
  labeled.sort(function(a, b) { return (b.e.labelW - a.e.labelW) || (a.e.index - b.e.index); });

  for (const line of labeled)
  {
    const w = line.e.labelW + 6;
    const h = line.e.labelH || 18;
    const pts = line.points;
    let total = 0;
    const lengths = [];

    for (let i = 0; i + 1 < pts.length; i++)
    {
      lengths.push(Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y));
      total += lengths[i];
    }

    if (total <= 0)
    {
      continue;
    }

    let best = null;
    let before = 0;

    for (let i = 0; i + 1 < pts.length; i++)
    {
      const p = pts[i];
      const q = pts[i + 1];
      const len = lengths[i];
      const horizontal = Math.abs(p.y - q.y) < 0.01;
      const need = horizontal ? w + 8 : h + 20;
      const spots = [];

      // Every place along the piece, a few pixels apart: from the decision
      // outward for an outcome, else from the middle outward.
      if (len > need + 12)
      {
        const from = (need / 2 + 6) / len;
        const count = Math.min(40, Math.floor((len - need - 12) / 8));

        for (let k = 0; k <= count; k++)
        {
          spots.push(from + (1 - 2 * from) * (count > 0 ? k / count : 0.5));
        }

        if (!line.e.decision)
        {
          spots.sort(function(x, y) { return Math.abs(x - 0.5) - Math.abs(y - 0.5); });
        }
      }
      else
      {
        spots.push(0.5);
      }

      spots.forEach(function(f, k)
      {
        const cx = p.x + (q.x - p.x) * f;
        const cy = p.y + (q.y - p.y) * f;
        const box = horizontal ? { x: cx - w / 2, y: cy - h - 2, w: w, h: h } : { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
        let cost = k * 0.1 + (horizontal ? 0 : 3) - Math.min(len, 240) * 0.01;

        if (len < need)
        {
          cost += 25 + (need - len) * 0.5;
        }

        if (line.e.decision)
        {
          // an outcome is read at its decision: every 100 px further along
          // the line cost as much as a piece further
          cost += i * 4 + (before + len * f) * 0.04;
        }

        for (const o of obstacles)
        {
          if (boxesOverlap(box, o))
          {
            cost += o.soft ? 30 : 90;
          }
        }

        for (const o of placed)
        {
          if (boxesOverlap(box, { x: o.x - 4, y: o.y - 2, w: o.w + 8, h: o.h + 4 }))
          {
            cost += 80;
          }
        }

        for (const other of lines)
        {
          for (let j = 0; j + 1 < other.points.length; j++)
          {
            if (other === line && j === i)
            {
              continue;
            }

            if (segmentInBox(other.points[j], other.points[j + 1], box))
            {
              cost += 35;
            }
          }
        }

        if (best == null || cost < best.cost - 1e-9)
        {
          best = { cost: cost, box: box, at: before + len * f };
        }
      });

      before += len;
    }

    if (best != null)
    {
      placed.push(best.box);
      line.label = Math.round((2 * best.at / total - 1) * 1000) / 1000;
      line.labelBox = best.box;
    }
  }
}
