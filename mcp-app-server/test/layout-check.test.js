import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The viewer tells the model what the rendering shows and the XML doesn't
// (#92): a PNG of the diagram for hosts that take images, and for every host
// a layout check in text (labels that don't fit, shapes and labels on each
// other, connectors through shapes). The code runs in the app's HTML, so it
// is taken from the source of the template, with the template's doubled
// backslashes undone, and run on a minimal stand-in for the viewer's graph.

const source = readFileSync(new URL("../src/shared.js", import.meta.url), "utf-8");

function extract(name)
{
  const m = name.startsWith("var ") ?
    source.match(new RegExp("\\nvar " + name.substring(4) + " = [^;]*;")) :
    source.match(new RegExp("\\nfunction " + name + "\\([^)]*\\)\\n\\{\\n[\\s\\S]*?\\n\\}\\n"));

  assert.ok(m, name + " not found in src/shared.js");

  return m[0];
}

const names = ["var LAYOUT_CHECK_MAX_ITEMS", "var LAYOUT_CHECK_MAX_CELLS", "var GENERIC_FONT_FAMILIES",
  "var FONT_FALLBACK", "edgesCrossShapes", "plainLabel", "reportCellName", "reportShortName",
  "reportEdgeName", "layoutCheck", "withGenericFontFallback", "modelContextTextWithCheck",
  "modelContextContent", "hostAcceptsContextImages"];
const body = names.map(extract).join("\n").replace(/\\\\/g, "\\");
const mxUtils =
{
  getValue: function(style, key, def)
  {
    return (style != null && style[key] != null) ? style[key] : def;
  }
};

function libavoidRoutesEdge(style)
{
  return style.edgeStyle == "orthogonalEdgeStyle";
}

const fns = new Function("mxUtils", "libavoidRoutesEdge", body +
  "\nreturn { layoutCheck, edgesCrossShapes, withGenericFontFallback, modelContextTextWithCheck, " +
  "modelContextContent, hostAcceptsContextImages };")(mxUtils, libavoidRoutesEdge);

const BOX = { rounded: 1, fillColor: "#ffffff", strokeColor: "#000000" };

// spec: { id, v (vertex) | e (edge), parent, x, y, w, h, style, label,
// text: [x, y, w, h] (the label's bounding box), source, target,
// points: [[x, y], …] (the edge as drawn) }
function graphOf(spec)
{
  const cells = {};
  const root = { id: "0", children: [] };
  const layer = { id: "1", parent: root, children: [] };
  root.children.push(layer);
  cells["0"] = root;
  cells["1"] = layer;

  for (const c of spec)
  {
    cells[c.id] = { id: c.id, spec: c, children: [] };
  }

  for (const c of spec)
  {
    const cell = cells[c.id];
    cell.parent = cells[c.parent || "1"];
    cell.parent.children.push(cell);
  }

  const model =
  {
    cells: cells,
    getRoot: function() { return root; },
    getParent: function(c) { return c.parent || null; },
    isVertex: function(c) { return c.spec != null && c.spec.v === true; },
    isEdge: function(c) { return c.spec != null && c.spec.e === true; },
    isAncestor: function(a, b)
    {
      while (b != null)
      {
        if (b == a) return true;
        b = b.parent;
      }

      return false;
    },
    getChildCount: function(c) { return c.children.length; },
    getChildAt: function(c, i) { return c.children[i]; },
    getTerminal: function(e, src)
    {
      const id = src ? e.spec.source : e.spec.target;
      return (id != null) ? cells[id] : null;
    }
  };

  const view =
  {
    scale: 1,
    getState: function(c)
    {
      if (c == null || c.spec == null) return null;
      const s = c.spec;

      return {
        cell: c, x: s.x || 0, y: s.y || 0, width: s.w || 0, height: s.h || 0,
        style: s.style || (s.v ? BOX : {}),
        text: (s.text != null) ? { boundingBox: { x: s.text[0], y: s.text[1], width: s.text[2], height: s.text[3] } } : null,
        absolutePoints: (s.points != null) ? s.points.map(function(p) { return { x: p[0], y: p[1] }; }) : null
      };
    }
  };

  return {
    getModel: function() { return model; },
    view: view,
    isCellVisible: function() { return true; },
    getLabel: function(c) { return (c.spec != null && c.spec.label) || ""; },
    isHtmlLabel: function() { return false; }
  };
}

function box(id, x, y, w, h, label)
{
  return { id: id, v: true, x: x, y: y, w: w, h: h, label: label,
    text: (label != null && label != "") ? [x + w / 2 - 20, y + h / 2 - 8, 40, 16] : null };
}

function lines(report)
{
  return report.text.split("\n- ").slice(1);
}

test("a clean diagram is reported as such", function()
{
  const r = fns.layoutCheck(graphOf([box("a", 0, 0, 100, 40, "A"), box("b", 200, 0, 100, 40, "B"),
    { id: "e", e: true, source: "a", target: "b", points: [[100, 20], [200, 20]] }]));

  assert.equal(r.count, 0);
  assert.match(r.text, /^Layout check of the diagram as rendered: no problems found\./);
  assert.doesNotMatch(r.text, /fix/);
});

test("problems come with the request to fix them at the next change, or to offer once", function()
{
  const r = fns.layoutCheck(graphOf([box("c", 0, 0, 120, 60, "Orders"), box("d", 80, 30, 120, 60, "Billing")]));

  assert.equal(r.text.split("\n")[0], "Layout check of the diagram as rendered (1 problem, sizes in diagram units). " +
    "When you next change this diagram, fix these as well; if the user asks for something else, offer once to fix them.");
});

test("a label wider or taller than its shape is reported in diagram units", function()
{
  const wide = box("wide", 0, 0, 100, 40, "Authentication Service Gateway");
  wide.text = [-35, 12, 170, 16];
  const tall = box("tall", 200, 0, 100, 40, "Far too many words");
  tall.text = [205, -9, 90, 58];

  assert.deepEqual(lines(fns.layoutCheck(graphOf([wide, tall]))), [
    "The label of \"Authentication Service Gateway\" (id wide) is 70 wider than its shape (100 x 40).",
    "The label of \"Far too many words\" (id tall) is 18 taller than its shape (100 x 40)."]);
});

test("labels outside the shape and thin shapes aren't checked for fit", function()
{
  const icon = box("icon", 0, 0, 40, 40, "A long icon name");
  icon.style = Object.assign({ verticalLabelPosition: "bottom" }, BOX);
  icon.text = [-40, 44, 120, 16];
  const line = box("line", 100, 0, 1, 200, "Evaporation");
  line.text = [60, 92, 80, 16];

  assert.equal(fns.layoutCheck(graphOf([icon, line])).count, 0);
});

test("a connector through a shape is reported", function()
{
  const r = fns.layoutCheck(graphOf([box("a", 0, 200, 80, 40, "Web"), box("g", 200, 200, 80, 40, "Cache"),
    box("f", 400, 200, 80, 40, "DB"),
    { id: "e1", e: true, source: "a", target: "f", style: {}, points: [[80, 220], [400, 220]] }]));

  assert.deepEqual(lines(r), ["The edge (id e1) from \"Web\" to \"DB\" runs through \"Cache\" (id g)."]);
});

test("lines that cross by design aren't reported", function()
{
  function check(edge, aLabel, fLabel)
  {
    return fns.layoutCheck(graphOf([box("a", 0, 200, 80, 40, aLabel), box("g", 200, 200, 80, 40, "Cache"),
      box("f", 400, 200, 80, 40, fLabel), Object.assign({ id: "e1", e: true, points: [[80, 220], [400, 220]] }, edge)])).count;
  }

  assert.equal(check({ source: "a", target: "f", style: { edgeStyle: "sequenceEdgeStyle" } }, "A", "F"), 0, "sequence message");
  assert.equal(check({ style: {} }, "A", "F"), 0, "not connected");
  assert.equal(check({ source: "a", target: "f", style: { curved: 1 } }, "A", "F"), 0, "curved");
  assert.equal(check({ source: "a", target: "f", style: {} }, "", ""), 0, "between unlabelled anchors");
});

test("a line past the corner of a round shape doesn't touch it", function()
{
  // The line x - y = 110 cuts the top right corner of the bounds (x - y = 120
  // there) and passes the ellipse, whose points reach x - y = 97
  function check(shape)
  {
    const uc = box("uc", 100, 100, 120, 60, "Deposit Cash");
    uc.style = Object.assign({ shape: shape }, BOX);

    return fns.layoutCheck(graphOf([box("a", 150, 40, 40, 40, "Customer"), uc, box("b", 240, 130, 40, 40, "Withdraw"),
      { id: "e", e: true, source: "a", target: "b", style: {}, points: [[190, 80], [240, 130]] }])).count;
  }

  assert.equal(check("ellipse"), 0);
  assert.equal(check("rect"), 1);
});

test("the routing check is unchanged: it follows right-angle edges only, and stops at the first crossing", function()
{
  function graph(style)
  {
    return graphOf([box("a", 0, 200, 80, 40, "Web"), box("g", 200, 200, 80, 40, "Cache"), box("f", 400, 200, 80, 40, "DB"),
      { id: "e1", e: true, source: "a", target: "f", style: style, points: [[80, 220], [400, 220]] }]);
  }

  assert.equal(fns.edgesCrossShapes(graph({})), false);
  assert.equal(fns.edgesCrossShapes(graph({ edgeStyle: "orthogonalEdgeStyle" })), true);
});

test("labelled shapes on each other are reported, unlabelled or nested ones aren't", function()
{
  assert.deepEqual(lines(fns.layoutCheck(graphOf([box("c", 0, 0, 120, 60, "Orders"), box("d", 80, 30, 120, 60, "Billing")]))),
    ["The shapes \"Orders\" (id c) and \"Billing\" (id d) overlap by 40 x 30."]);
  assert.equal(fns.layoutCheck(graphOf([box("c", 0, 0, 120, 60, "Room"), box("d", 80, 30, 120, 60, "")])).count, 0);
  assert.equal(fns.layoutCheck(graphOf([box("c", 0, 0, 300, 200, "Zone"), box("d", 80, 30, 120, 60, "Server")])).count, 0);
});

test("an edge label on a shape is reported, a label inside a large frame isn't", function()
{
  const edge = { id: "e2", e: true, source: "h", target: "i", label: "network link", text: [190, 12, 100, 16],
    style: {}, points: [[80, 20], [400, 20]] };

  assert.deepEqual(lines(fns.layoutCheck(graphOf([box("h", 0, 0, 80, 40, "Sensor"), box("i", 400, 0, 80, 40, "Hub"),
    box("j", 200, 24, 80, 30, "Power"), edge]))), ["The label of \"network link\" (id e2) lies on the shape \"Power\" (id j)."]);
  assert.equal(fns.layoutCheck(graphOf([box("h", 0, 0, 80, 40, "Sensor"), box("i", 400, 0, 80, 40, "Hub"),
    box("j", -50, -100, 600, 300, "Subnet"), edge])).count, 0);
});

test("labels on each other are reported from 4 px on", function()
{
  function check(x2)
  {
    return fns.layoutCheck(graphOf([
      { id: "t1", v: true, x: 100, y: 100, w: 60, h: 16, label: "Left note", style: { shape: "text" }, text: [100, 100, 60, 16] },
      { id: "t2", v: true, x: x2, y: 100, w: 60, h: 16, label: "Right note", style: { shape: "text" }, text: [x2, 100, 60, 16] }]));
  }

  assert.equal(check(157).count, 0);
  assert.deepEqual(lines(check(150)), ["The labels of \"Left note\" (id t1) and \"Right note\" (id t2) overlap."]);
});

test("the list stops after 20 problems", function()
{
  const spec = [];

  for (let k = 0; k < 25; k++)
  {
    spec.push(box("a" + k, k * 300, 0, 100, 40, "A" + k), box("b" + k, k * 300 + 50, 10, 100, 40, "B" + k));
  }

  const r = fns.layoutCheck(graphOf(spec));

  assert.equal(r.count, 25);
  assert.match(r.text, /\(25 problems, sizes in diagram units\)/);
  assert.equal(lines(r).length, 21);
  assert.equal(lines(r)[20], "and 5 more.");
});

test("web fonts get a generic fallback in the image, other families stay", function()
{
  assert.equal(fns.withGenericFontFallback("Recursive"), "Recursive, Helvetica, Arial, sans-serif");
  assert.equal(fns.withGenericFontFallback("Helvetica, sans-serif"), "Helvetica, sans-serif");
  assert.equal(fns.withGenericFontFallback("\"Comic Sans MS\", cursive"), "\"Comic Sans MS\", cursive");
});

test("a text-only host gets the check before the XML, and alone only when it found something", function()
{
  const clean = { count: 0, text: "clean" };
  const found = { count: 2, text: "found" };

  assert.equal(fns.modelContextTextWithCheck(null, null), null);
  assert.equal(fns.modelContextTextWithCheck(clean, null), null);
  assert.equal(fns.modelContextTextWithCheck(found, null), "found");
  assert.equal(fns.modelContextTextWithCheck(clean, "XML"), "clean\n\nXML");
  assert.equal(fns.modelContextTextWithCheck(null, "XML"), "XML");
});

test("a host that takes images gets the picture, the check and the XML when it differs", function()
{
  const img = { data: "iVBOR", width: 796, height: 196 };
  const report = { count: 0, text: "clean" };
  const asSent = fns.modelContextContent(img, report, null);

  assert.deepEqual(asSent.map(function(c) { return c.type; }), ["text", "image", "text"]);
  assert.equal(asSent[0].text, "The draw.io diagram as the user sees it now, as a PNG image (796 x 196 px), from the XML as you sent it.");
  assert.deepEqual(asSent[1], { type: "image", data: "iVBOR", mimeType: "image/png" });

  const changed = fns.modelContextContent(img, report, "XML");
  assert.match(changed[0].text, /\(796 x 196 px\)\.$/);
  assert.equal(changed[3].text, "XML");

  assert.deepEqual(fns.modelContextContent(null, report, null), [{ type: "text", text: "clean" }]);
});

test("images go only to hosts that declare them, and not to ChatGPT yet", function()
{
  assert.equal(fns.hostAcceptsContextImages({ updateModelContext: { text: {}, image: {} } }, false), true);
  assert.equal(fns.hostAcceptsContextImages({ updateModelContext: { text: {}, image: {} } }, true), false);
  assert.equal(fns.hostAcceptsContextImages({ updateModelContext: { text: {} } }, false), false);
  assert.equal(fns.hostAcceptsContextImages(null, false), false);
});
