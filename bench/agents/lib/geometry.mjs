// The layout check that is the same for every format: it runs in the browser
// on the drawn diagram (the SVG that Mermaid, the agent or Graphviz made, or
// the draw.io viewer's SVG) and reads only what is on screen, so it judges
// no format by its own rules. Passed to page.evaluate() as it is.
//
// It collects the labels (the boxes of the visible text) and the shapes
// (visible filled rect, circle, ellipse, polygon and path elements at least
// 12 px wide and high, so arrowheads don't count, joined
// per node where the format groups a node's parts: draw.io's cells, Mermaid's
// nodes, clusters and actors) and counts:
// - labelOverlaps: two labels that overlap by more than 2 px both ways;
// - labelOverflows: a label that sticks out of the smallest shape containing
//   its centre by more than 3 px;
// - shapeOverlaps: two shapes that overlap by more than 2 px both ways while
//   neither contains the other (a frame around its members is fine) and the
//   overlap is less than half of the smaller one (more is taken as parts of
//   one shape drawn apart: a shadow, a header, a cylinder's lid);
// - clipped: a label partly or wholly outside the drawing's visible area.
//
// For the editability of SVG it also counts the connectors (unfilled lines
// and paths at least 15 px long, or with an arrow marker) and the labels
// that sit inside a shape of their own group, which an editor moves with it.

export function geometryCheck(rootSelector)
{
  const root = document.querySelector(rootSelector || "svg");

  if (root == null)
  {
    return { error: "no drawing" };
  }

  const SKIP = "defs, marker, clipPath, pattern, mask, symbol, title, desc, style, script";
  const view = root.getBoundingClientRect();

  function visible(el)
  {
    for (let e = el; e != null && e !== document.documentElement; e = e.parentElement)
    {
      const cs = getComputedStyle(e);

      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0)
      {
        return false;
      }
    }

    return true;
  }

  function box(r)
  {
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  function union(a, b)
  {
    if (a == null)
    {
      return b;
    }

    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);

    return { x: x, y: y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }

  function overlap(a, b)
  {
    return { w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) };
  }

  function contains(a, b, tol)
  {
    return b.x >= a.x - tol && b.y >= a.y - tol && b.x + b.w <= a.x + a.w + tol && b.y + b.h <= a.y + a.h + tol;
  }

  // the group of a node's parts, where the format has one
  function unitOf(el)
  {
    const g = el.closest("[data-cell-id], g.node, g.cluster, g.actor, g.edgeLabel, g.note, g.entityBox");

    return (g != null && root.contains(g)) ? g : el;
  }

  // labels: the text nodes, joined per element that holds them
  const labels = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;

  while ((node = walker.nextNode()) != null)
  {
    if (!/\S/.test(node.nodeValue) || node.parentElement == null || node.parentElement.closest(SKIP) != null ||
      !visible(node.parentElement))
    {
      continue;
    }

    const range = document.createRange();
    range.selectNodeContents(node);
    let b = null;

    for (const r of range.getClientRects())
    {
      if (r.width > 0 && r.height > 0)
      {
        b = union(b, box(r));
      }
    }

    if (b == null)
    {
      continue;
    }

    const holder = node.parentElement.closest("text") || node.parentElement.closest("foreignObject") || node.parentElement;
    const prev = labels.get(holder);
    labels.set(holder, { el: holder, box: union(prev ? prev.box : null, b), text: ((prev ? prev.text + " " : "") + node.nodeValue.trim()).slice(0, 60) });
  }

  // shapes: visible filled elements, joined per unit
  const units = new Map();
  const connectors = [];
  const area = view.width * view.height;

  for (const el of root.querySelectorAll("rect, circle, ellipse, polygon, path, line, polyline"))
  {
    if (el.closest(SKIP) != null || !visible(el))
    {
      continue;
    }

    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const filled = cs.fill !== "none" && parseFloat(cs.fillOpacity) > 0 && !/^(line|polyline)$/i.test(el.tagName);
    const stroked = cs.stroke !== "none" && parseFloat(cs.strokeWidth) > 0;

    // at least 12 px both ways: arrowheads drawn as filled paths are not shapes
    if (filled && r.width >= 12 && r.height >= 12 && r.width * r.height < 0.9 * area)
    {
      const u = unitOf(el);
      const prev = units.get(u);
      units.set(u, { el: u, box: union(prev ? prev.box : null, box(r)) });
    }
    else if (!filled && stroked && (Math.max(r.width, r.height) >= 15 || cs.markerEnd !== "none" || cs.markerStart !== "none"))
    {
      connectors.push(el);
    }
  }

  // a shape for the examples: its element, id or class, and box
  function describe(u)
  {
    const el = u.el;
    const name = el.getAttribute("data-cell-id") || el.id || (el.getAttribute("class") || "").split(" ")[0] || "";

    return el.tagName.toLowerCase() + (name ? "#" + name : "") + "@" + Math.round(u.box.x) + "," + Math.round(u.box.y) + "," +
      Math.round(u.box.w) + "x" + Math.round(u.box.h);
  }

  const L = Array.from(labels.values());
  const S = Array.from(units.values());
  const found = { labelOverlaps: [], labelOverflows: [], shapeOverlaps: [], clipped: [] };

  for (let i = 0; i < L.length; i++)
  {
    for (let j = i + 1; j < L.length; j++)
    {
      const o = overlap(L[i].box, L[j].box);

      if (o.w > 2 && o.h > 2 && !L[i].el.contains(L[j].el) && !L[j].el.contains(L[i].el))
      {
        found.labelOverlaps.push(L[i].text + " / " + L[j].text);
      }
    }
  }

  let grouped = 0;

  for (const l of L)
  {
    const cx = l.box.x + l.box.w / 2;
    const cy = l.box.y + l.box.h / 2;
    let best = null;

    for (const s of S)
    {
      if (cx >= s.box.x && cx <= s.box.x + s.box.w && cy >= s.box.y && cy <= s.box.y + s.box.h &&
        (best == null || s.box.w * s.box.h < best.box.w * best.box.h))
      {
        best = s;
      }
    }

    if (best != null && !contains(best.box, l.box, 3))
    {
      found.labelOverflows.push(l.text);
    }

    // inside a shape of its own group: moved with it in an editor
    if (best != null)
    {
      const g = l.el.parentElement != null ? l.el.parentElement.closest("g") : null;

      if (g != null && g !== root && g.contains(best.el) && (best.el !== g || g.contains(l.el)))
      {
        grouped++;
      }
    }

    if (!contains(box(view), l.box, 2))
    {
      found.clipped.push(l.text);
    }
  }

  for (let i = 0; i < S.length; i++)
  {
    for (let j = i + 1; j < S.length; j++)
    {
      const a = S[i].box;
      const b = S[j].box;
      const o = overlap(a, b);

      if (o.w > 2 && o.h > 2 && !contains(a, b, 2) && !contains(b, a, 2) &&
        o.w * o.h < 0.5 * Math.min(a.w * a.h, b.w * b.h))
      {
        found.shapeOverlaps.push(describe(S[i]) + " / " + describe(S[j]));
      }
    }
  }

  return {
    width: Math.round(view.width), height: Math.round(view.height),
    labels: L.length, shapes: S.length, connectors: connectors.length, labelsInOwnShape: grouped,
    labelOverlaps: found.labelOverlaps.length, labelOverflows: found.labelOverflows.length,
    shapeOverlaps: found.shapeOverlaps.length, clipped: found.clipped.length,
    findings: found.labelOverlaps.length + found.labelOverflows.length + found.shapeOverlaps.length + found.clipped.length,
    examples: { labelOverlaps: found.labelOverlaps.slice(0, 5), labelOverflows: found.labelOverflows.slice(0, 5),
      shapeOverlaps: found.shapeOverlaps.slice(0, 5), clipped: found.clipped.slice(0, 5) }
  };
}
