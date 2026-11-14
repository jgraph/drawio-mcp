import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// What the viewer fits into the chat frame (computeCellsBBox in the app's
// HTML): the shapes, the labels drawn outside of them (an icon's name below
// it) and the bends of the edges. A fit by the shapes alone cut the names of
// the bottom row and the lines around the outside off. The code is taken
// from the source of the template and run on a stand-in for the model.

const source = readFileSync(new URL("../src/shared.js", import.meta.url), "utf-8");

function extract(name)
{
  const m = source.match(new RegExp("\\nfunction " + name + "\\([^)]*\\)\\n\\{\\n[\\s\\S]*?\\n\\}\\n"));

  assert.ok(m, name + " not found in src/shared.js");

  return m[0];
}

const mxUtils =
{
  getValue: function(style, key, def)
  {
    return (style != null && style[key] != null) ? style[key] : def;
  }
};

// spec: { id, parent, x, y, w, h, edge, points: [[x, y], …], style,
// text: [x, y, w, h] (the label as drawn, in screen units) }
function viewer(spec, scale)
{
  const cells = { "0": { id: "0" }, "1": { id: "1" } };

  cells["1"].parent = cells["0"];

  for (const c of spec)
  {
    cells[c.id] = { id: c.id, visible: true, edge: c.edge === true, spec: c,
      geometry: c.edge ? { relative: true, points: (c.points || []).map(function(p) { return { x: p[0], y: p[1] }; }) } :
        { x: c.x, y: c.y, width: c.w, height: c.h, relative: false } };
  }

  for (const c of spec)
  {
    cells[c.id].parent = cells[c.parent || "1"];
  }

  const model =
  {
    getCell: function(id) { return cells[id]; },
    getParent: function(cell) { return cell.parent; },
    isVertex: function(cell) { return cell.spec != null && !cell.edge; },
    isEdge: function(cell) { return cell.edge === true; }
  };
  const graph =
  {
    getModel: function() { return model; },
    view:
    {
      scale: scale || 1,
      getState: function(cell)
      {
        const c = cell.spec;
        let x = c.x;
        let y = c.y;

        for (let p = cell.parent; p != null && p.spec != null; p = p.parent)
        {
          x += p.spec.x;
          y += p.spec.y;
        }

        return { x: x * graph.view.scale, y: y * graph.view.scale, style: c.style || {},
          text: (c.text != null) ? { boundingBox: { x: c.text[0], y: c.text[1], width: c.text[2], height: c.text[3] } } : null };
      }
    }
  };
  const fns = new Function("mxUtils", "streamGraph", extract("outsideLabelBox") + extract("computeCellsBBox") +
    "\nreturn { computeCellsBBox };")(mxUtils, graph);

  return function(ids) { return fns.computeCellsBBox(model, ids); };
}

test("the fit is the box of the shapes, in page coordinates", function()
{
  const box = viewer([{ id: "g", x: 100, y: 50, w: 300, h: 200 }, { id: "a", parent: "g", x: 20, y: 40, w: 120, h: 60 },
    { id: "b", x: 500, y: 300, w: 120, h: 60 }]);

  assert.deepEqual(box(["a"]), { minX: 120, minY: 90, maxX: 240, maxY: 150 });
  assert.deepEqual(box(["g", "a", "b"]), { minX: 100, minY: 50, maxX: 620, maxY: 360 });
  assert.equal(box(["nothing"]), null);
});

test("a label below or beside its shape belongs to the fit, one inside it doesn't", function()
{
  const icon = { id: "i", x: 100, y: 100, w: 60, h: 60, style: { verticalLabelPosition: "bottom" }, text: [80, 164, 100, 34] };

  assert.deepEqual(viewer([icon])(["i"]), { minX: 80, minY: 100, maxX: 180, maxY: 198 });

  // the label's box is in screen units: at twice the size it is twice as far
  assert.deepEqual(viewer([Object.assign({}, icon, { text: [160, 328, 200, 68] })], 2)(["i"]), { minX: 80, minY: 100, maxX: 180, maxY: 198 });

  // in a container, the cell's own offset counts
  assert.deepEqual(viewer([{ id: "g", x: 1000, y: 0, w: 300, h: 300 }, Object.assign({}, icon, { parent: "g", text: [1080, 164, 100, 34] })])(["i"]),
    { minX: 1080, minY: 100, maxX: 1180, maxY: 198 });

  assert.deepEqual(viewer([Object.assign({}, icon, { style: { labelPosition: "right" }, text: [164, 120, 90, 20] })])(["i"]),
    { minX: 100, minY: 100, maxX: 254, maxY: 160 });

  // text that is wider than its box stays the box's business
  assert.deepEqual(viewer([Object.assign({}, icon, { style: {}, text: [60, 110, 140, 40] })])(["i"]),
    { minX: 100, minY: 100, maxX: 160, maxY: 160 });

  // no label drawn yet (while the diagram streams in)
  assert.deepEqual(viewer([Object.assign({}, icon, { text: null })])(["i"]), { minX: 100, minY: 100, maxX: 160, maxY: 160 });
});

test("the bends of an edge belong to the fit, and edges alone give none", function()
{
  const spec = [{ id: "a", x: 0, y: 0, w: 120, h: 60 }, { id: "b", x: 0, y: 200, w: 120, h: 60 },
    { id: "e", edge: true, points: [[-30, 30], [-30, 290], [60, 290]] }];

  assert.deepEqual(viewer(spec)(["a", "b"]), { minX: 0, minY: 0, maxX: 120, maxY: 260 });
  assert.deepEqual(viewer(spec)(["a", "b", "e"]), { minX: -30, minY: 0, maxX: 120, maxY: 290 });
  assert.equal(viewer(spec)(["e"]), null);

  // an edge in a container has its bends in the container's coordinates
  const inside = [{ id: "g", x: 400, y: 100, w: 300, h: 300 }, { id: "a", parent: "g", x: 20, y: 40, w: 120, h: 60 },
    { id: "e", parent: "g", edge: true, points: [[320, 70]] }];

  assert.deepEqual(viewer(inside)(["a", "e"]), { minX: 420, minY: 140, maxX: 720, maxY: 200 });
});
