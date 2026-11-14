// What the bench reads out of a diagram's XML: the vertices with their
// absolute positions, the median font size of their styles, and how far the
// vertices of one diagram moved in a second one (the stability of an edit).
// Parsing is the headless model of shared/mx-xml.js, read only.

import { transformPages } from "../../shared/mx-xml.js";
import { median } from "./common.mjs";

/** draw.io's default font size, used by every style without fontSize. */
export const DEFAULT_FONT_SIZE = 12;

function styleValue(style, key)
{
  const m = new RegExp("(?:^|;)\\s*" + key + "=([^;]*)").exec(style || "");

  return m ? m[1] : null;
}

function plainLabel(value)
{
  return String(value == null ? "" : value).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The vertices of the first page: { id, label, style, x, y, width, height },
 * x and y absolute (the parents' offsets added). Labels of edges and other
 * cells with a relative geometry are left out.
 */
export function vertices(xml)
{
  const list = [];
  let done = false;

  function visit(cell, dx, dy)
  {
    const geo = cell.geometry;
    let x = dx;
    let y = dy;

    if (cell.vertex && geo != null && !geo.relative)
    {
      x += geo.x || 0;
      y += geo.y || 0;
      list.push({ id: cell.id, label: plainLabel(cell.value), style: cell.style || "", x: x, y: y,
        width: geo.width || 0, height: geo.height || 0 });
    }

    if (!cell.edge)
    {
      for (const child of cell.children)
      {
        visit(child, x, y);
      }
    }
  }

  transformPages(String(xml || ""), function(graph)
  {
    if (!done)
    {
      done = true;
      visit(graph.getModel().root, 0, 0);
    }
  });

  return list;
}

/**
 * The number of vertices and the median font size of those with a label
 * (of all of them when none has one).
 */
export function fontStats(xml)
{
  const all = vertices(xml);
  const labeled = all.filter(function(v) { return v.label !== ""; });
  const sizes = (labeled.length > 0 ? labeled : all).map(function(v)
  {
    const size = parseFloat(styleValue(v.style, "fontSize"));

    return isNaN(size) ? DEFAULT_FONT_SIZE : size;
  });

  return { vertices: all.length, labeled: labeled.length, fontSize: sizes.length > 0 ? median(sizes) : null };
}

/**
 * How much of a diagram stayed where it was after a change: the vertices
 * present in both (matched by id and label, then by a label that is unique
 * in both, then by id alone, which is a renamed shape), and how many of them
 * moved by more than `tolerance` px once the shift they all share (the
 * median shift) is removed.
 *
 * @returns {{before: number, after: number, common: number, moved: number,
 *   movedShare: number|null, added: number, removed: number}}
 */
export function stability(beforeXml, afterXml, tolerance)
{
  const limit = (tolerance != null) ? tolerance : 10;
  const before = vertices(beforeXml);
  const after = vertices(afterXml);
  const pairs = [];
  const used = new Set();
  const afterById = new Map(after.map(function(v) { return [v.id, v]; }));

  function pair(v, w)
  {
    pairs.push([v, w]);
    used.add(v);
    used.add(w);
  }

  function uniqueByLabel(items)
  {
    const count = new Map();
    const open = items.filter(function(v) { return !used.has(v) && v.label !== ""; });

    for (const v of open)
    {
      const k = v.label.toLowerCase();
      count.set(k, (count.get(k) || 0) + 1);
    }

    return new Map(open.filter(function(v) { return count.get(v.label.toLowerCase()) === 1; })
      .map(function(v) { return [v.label.toLowerCase(), v]; }));
  }

  for (const v of before)
  {
    const w = afterById.get(v.id);

    if (w != null && v.label.toLowerCase() === w.label.toLowerCase())
    {
      pair(v, w);
    }
  }

  const byLabel = uniqueByLabel(after);

  for (const [label, v] of uniqueByLabel(before))
  {
    if (byLabel.has(label))
    {
      pair(v, byLabel.get(label));
    }
  }

  for (const v of before)
  {
    const w = afterById.get(v.id);

    if (!used.has(v) && w != null && !used.has(w))
    {
      pair(v, w);
    }
  }

  const dx = median(pairs.map(function(p) { return p[1].x - p[0].x; })) || 0;
  const dy = median(pairs.map(function(p) { return p[1].y - p[0].y; })) || 0;
  const moved = pairs.filter(function(p)
  {
    return Math.hypot(p[1].x - p[0].x - dx, p[1].y - p[0].y - dy) > limit;
  }).length;

  return { before: before.length, after: after.length, common: pairs.length, moved: moved,
    movedShare: pairs.length > 0 ? moved / pairs.length : null,
    added: after.length - pairs.length, removed: before.length - pairs.length };
}
