import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { semanticToXml } from "../../shared/semantic/index.js";

// The preview of a description (create_semantic_diagram) lays out the whole
// description every time it grows, and the viewer merges each layout into
// the graph it shows (streamMergeXmlDelta in the app's HTML). A node names
// its lane only later in the stream, or the lanes arrive after the nodes:
// the cell must then move to its new parent. Without that, the shapes of a
// swimlane diagram stayed in the lane an earlier partial had put them in,
// also once the result had arrived. Streamed XML only grows and keeps the
// merge it had. The code is taken from the source of the template and run
// on a stand-in for the model.

const source = readFileSync(new URL("../src/shared.js", import.meta.url), "utf-8");

function extract(name)
{
  const m = source.match(new RegExp("\\nfunction " + name + "\\([^)]*\\)\\n\\{\\n[\\s\\S]*?\\n\\}\\n"));

  assert.ok(m, name + " not found in src/shared.js");

  return m[0];
}

function newModel()
{
  const root = { id: "0", children: [], parent: null };
  const layer = { id: "1", children: [], parent: root };
  const model =
  {
    root: root,
    cells: { "0": root, "1": layer },
    getCell: function(id) { return this.cells[id]; },
    getParent: function(cell) { return cell.parent; },
    contains: function(cell) { return this.cells[cell.id] === cell; },
    isAncestor: function(parent, child)
    {
      while (child != null && child !== parent)
      {
        child = child.parent;
      }

      return child === parent;
    },
    add: function(parent, cell)
    {
      if (cell.parent != null)
      {
        cell.parent.children.splice(cell.parent.children.indexOf(cell), 1);
      }

      cell.parent = parent;
      cell.children = cell.children || [];
      parent.children.push(cell);
      this.cells[cell.id] = cell;
    },
    setStyle: function(cell, style) { cell.style = style; },
    setValue: function(cell, value) { cell.value = value; },
    setGeometry: function(cell, geometry) { cell.geometry = geometry; },
    setVisible: function(cell, visible) { cell.visible = visible; },
    setTerminal: function(cell, terminal, isSource) { cell[isSource ? "source" : "target"] = terminal; },
    beginUpdate: function() {},
    endUpdate: function() {}
  };

  root.children.push(layer);

  return model;
}

// One layout as the viewer gets it: the cells in document order, each
// { id, parent, x, y, edge, source, target }.
function layout(cells)
{
  return {
    nodeName: "mxGraphModel",
    ownerDocument: {},
    getElementsByTagName: function()
    {
      return [{ childNodes: cells.map(function(spec) { return { nodeType: 1, spec: spec }; }) }];
    }
  };
}

function viewer()
{
  const model = newModel();
  const graph =
  {
    getModel: function() { return model; },
    view: { getState: function() { return null; }, clear: function() {}, invalidate: function() {}, validate: function() {} }
  };

  // The codec hands back a cell with the parent and the terminals as cells
  // of its own, not the model's (see streamInsertCell).
  function mxCodec()
  {
    this.decodeCell = function(node)
    {
      const s = node.spec;
      const ref = function(id) { return (id != null) ? { id: id } : null; };

      return { id: s.id, value: s.id, style: s.style || "", vertex: !s.edge, edge: s.edge === true, visible: true,
        parent: ref(s.parent), source: ref(s.source), target: ref(s.target),
        geometry: { x: s.x || 0, y: s.y || 0, width: s.edge ? 0 : 120, height: s.edge ? 0 : 60, relative: s.edge === true } };
    };
  }

  const merge = new Function("mxCodec", "cellValueChanged", "applyMorphAnimations", "morphPrePositions", "animatedCellIds",
    "deferredAnimCellIds", "pendingAnimCellIds", extract("streamInsertCell") + extract("streamMergeXmlDelta") +
    "\nreturn streamMergeXmlDelta;")(mxCodec, function(a, b) { return a !== b; }, function() {}, {}, {}, [], []);

  return {
    model: model,
    merge: function(cells, moveCells) { return merge(graph, [], layout(cells), moveCells); },
    parentOf: function(id) { return model.getCell(id).parent.id; }
  };
}

const BEFORE =
[
  { id: "ask", parent: "1", x: 0, y: 0 },
  { id: "check", parent: "1", x: 200, y: 0 },
  { id: "ask-check", parent: "1", edge: true, source: "ask", target: "check" }
];

// the same nodes once the description has its lanes
const AFTER =
[
  { id: "customer", parent: "1", x: 0, y: 0 },
  { id: "agent", parent: "1", x: 0, y: 120 },
  { id: "ask", parent: "customer", x: 20, y: 40 },
  { id: "check", parent: "agent", x: 20, y: 40 },
  { id: "check-done", parent: "agent", edge: true, source: "check", target: "done" },
  { id: "done", parent: "agent", x: 220, y: 40 },
  { id: "ask-check", parent: "1", edge: true, source: "ask", target: "check" }
];

test("a node that names its lane later moves into it when a description is laid out again", function()
{
  const v = viewer();

  v.merge(BEFORE, true);
  assert.equal(v.parentOf("ask"), "1");

  v.merge(AFTER, true);
  assert.equal(v.parentOf("ask"), "customer");
  assert.equal(v.parentOf("check"), "agent");
  assert.equal(v.parentOf("done"), "agent");
  // into the cell of the model, not the codec's copy of it
  assert.equal(v.model.getCell("ask").parent, v.model.getCell("customer"));
  assert.deepEqual(v.model.getCell("customer").children.map(function(c) { return c.id; }), ["ask"]);
  assert.equal(v.model.getCell("ask").geometry.x, 20);
  // an edge follows its terminals into their lane, and back out
  assert.equal(v.parentOf("check-done"), "agent");
  v.merge(AFTER.map(function(c) { return c.id === "check-done" ? Object.assign({}, c, { parent: "1" }) : c; }), true);
  assert.equal(v.parentOf("check-done"), "1");
  assert.equal(v.parentOf("ask-check"), "1");
});

test("streamed XML keeps its merge: a cell stays where it was first drawn", function()
{
  const v = viewer();

  v.merge(BEFORE);
  v.merge(AFTER);
  assert.equal(v.parentOf("ask"), "1");
  assert.equal(v.parentOf("check"), "1");
  // new cells go where the XML puts them, as before
  assert.equal(v.parentOf("done"), "agent");
});

test("a cell is never moved into itself or one of its own children", function()
{
  const v = viewer();

  v.merge([{ id: "group", parent: "1" }, { id: "inner", parent: "group" }], true);
  v.merge([{ id: "group", parent: "inner" }, { id: "inner", parent: "group" }, { id: "self", parent: "1" }], true);
  v.merge([{ id: "self", parent: "self" }], true);
  assert.equal(v.parentOf("group"), "1");
  assert.equal(v.parentOf("inner"), "group");
  assert.equal(v.parentOf("self"), "1");
});

test("the result after a preview moves the cells too and drops what the last partial left over", function()
{
  // the merge of the result asks for the move when the diagram came from a description
  assert.match(source, /streamMergeXmlDelta\(streamGraph, streamPendingEdges, doc\.documentElement, opts\.described\)/);
  assert.match(source, /if \(opts\.replaceMode \|\| opts\.described\)/);
  assert.match(source, /autoRoute: mermaidText == null, described: shownFromDescription && mermaidText == null \}/);
  // and every preview of a description does
  assert.match(source, /streamMergeXmlDelta\(streamGraph, streamPendingEdges, xmlNode, true\)/);
});

test("a result alone says that it came from a description", function()
{
  // a host that hands over the result without the input before it: the
  // model is still told to change the description, not "the XML as you sent it"
  assert.match(source, /if \(parsed\.described === true\)\n\s+\{\n\s+shownFromDescription = true;/);
  assert.match(source, /var payload = \{ xml: absolutizeImageUrls\(finishDiagramXml\(r\.xml\)\), described: true, _buildId: buildId \};/);
  // create_diagram's payloads don't have the key
  assert.equal(source.match(/described: true/g).length, 1);
});

// ── A node that is still being written ──────────────────────────────────────

const previewArgs = new Function(extract("semanticPreviewArgs") + "\nreturn semanticPreviewArgs;")();

const STEPS =
[
  { id: "ask", label: "Ask for refund", kind: "start", group: "customer", row: 1, col: 1 },
  { id: "check", label: "Check the order", kind: "step", group: "agent", row: 2, col: 1 },
  { id: "ok", label: "Within 30 days?", kind: "decision", group: "agent", row: 2, col: 2 }
];

function lanes(nodes)
{
  return { type: "swimlane", groups: [{ id: "customer", label: "Customer" }, { id: "agent", label: "Agent" }], nodes: nodes };
}

// A lane as the engine draws it, and the grid it used: one for the page
// ("page") or one per group ("group").
async function drawn(args)
{
  const r = await semanticToXml(args, { hints: "ask" });
  const m = r.xml.match(/<mxCell id="agent"[^>]*>\s*<mxGeometry x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);

  assert.ok(m, r.xml.slice(0, 400));

  return { grid: r.stats.grid, x: Number(m[1]), y: Number(m[2]), wide: Number(m[3]) > Number(m[4]) };
}

test("a node that has no cell yet waits for it, so the preview doesn't flip between two layouts", async function()
{
  // as a host hands over the arguments while the model writes the fourth node
  const partial = lanes(STEPS.concat([{ id: "pay", label: "Pay b", kind: "step", group: "agent" }]));
  const shown = previewArgs(partial);

  assert.deepEqual(shown.nodes, STEPS);
  assert.deepEqual(shown.groups, partial.groups);
  assert.equal(shown.type, "swimlane");
  // the arguments themselves are left as they came
  assert.equal(partial.nodes.length, 4);

  // what it is for: with the node, the engine has no grid for the page and
  // draws the lanes the other way round; without it, the lanes stay
  const before = await drawn(lanes(STEPS));
  const flipped = await drawn(partial);
  const kept = await drawn(shown);

  // the lanes are rows of the page's grid, one under the other
  assert.deepEqual(before, { grid: "page", x: 0, y: before.y, wide: true });
  assert.ok(before.y > 0);
  // with the unfinished node: a grid per lane, the lanes side by side
  assert.equal(flipped.grid, "group");
  assert.ok(flipped.x > 0 && flipped.y === 0 && !flipped.wide, JSON.stringify(flipped));
  assert.deepEqual(kept, before);

  // a row without its column is no cell yet either
  assert.deepEqual(previewArgs(lanes(STEPS.concat([{ id: "pay", label: "Pay back", row: 2 }]))).nodes, STEPS);
  assert.deepEqual(previewArgs(lanes(STEPS.concat([{ id: "pay" }, { id: "done" }]))).nodes, STEPS);
});

test("a change is previewed with the layout of the result before it, so its shapes stay where they were", async function()
{
  const first = await semanticToXml(lanes(STEPS), { hints: "ask" });
  // the layout comes before the nodes in the schema, so it is there from the start
  const partial = Object.assign({ layout: first.layout }, lanes(STEPS.concat([{ id: "pay", label: "Pay back", kind: "step",
    group: "agent", row: 2, col: 3 }, { id: "done", label: "Refu" }])));
  const shown = previewArgs(partial);

  assert.equal(shown.layout, first.layout);
  assert.equal(shown.nodes.length, 4);

  const preview = await semanticToXml(shown, { hints: "ask" });
  const at = function(xml, id)
  {
    return new RegExp("<mxCell id=\"" + id + "\"[^>]*>\\s*<mxGeometry x=\"([\\d.]+)\" y=\"([\\d.]+)\"").exec(xml).slice(1, 3);
  };

  assert.deepEqual(preview.warnings, []);

  for (const n of STEPS)
  {
    assert.deepEqual(at(preview.xml, n.id), at(first.xml, n.id), n.id);
  }
});

test("a description is previewed as written when its last node has a cell, or none has", function()
{
  const whole = lanes(STEPS);

  assert.equal(previewArgs(whole), whole);

  // no cells at all (a model that leaves the placement to the server): nothing to wait for
  const bare = lanes(STEPS.map(function(n) { return { id: n.id, label: n.label, group: n.group }; }));

  assert.equal(previewArgs(bare), bare);

  // a node in the middle without a cell is the model's choice, not the stream's
  const middle = lanes([STEPS[0], { id: "x", label: "X" }, STEPS[2]]);

  assert.equal(previewArgs(middle), middle);

  // the list as JSON text, still streaming, or missing: left to the engine
  const text = { type: "flowchart", nodes: "[{\"id\":\"a\"" };

  assert.equal(previewArgs(text), text);
  assert.equal(previewArgs({ type: "flowchart" }).nodes, undefined);
});

test("the preview lays out what waits for no cell, with the icon paths of the result", function()
{
  assert.match(source, /args = semanticPreviewArgs\(args\);\n\n  var key = null;/);
  assert.match(source, /mergeSemanticXml\(expandDiagramShorthand\(absolutizeImageUrls\(r\.xml\)\)\.xml\);/);
});
