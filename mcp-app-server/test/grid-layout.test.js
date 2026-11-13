import { test } from "node:test";
import assert from "node:assert/strict";
import { gridLayoutDiagram } from "../../shared/grid-layout.js";
import { semanticToXml, SUPPORTED_TYPES } from "../../shared/semantic/index.js";
import { compactXml } from "../../shared/semantic/boxes.js";
import { normalizeSpec } from "../../shared/semantic/spec.js";
import { describeTool, describeSchema } from "../../shared/semantic/description.js";
import { normalizeDiagram } from "../../shared/normalize-model.js";
import { repairDiagramXml } from "../../shared/repair-xml.js";

// The grid layout pass (shared/grid-layout.js) places the cells of a draw.io
// diagram that have no position: vertices on a grid, containers around their
// children, lanes as bands, right-angle edges routed. It is what the
// semantic types architecture, network, flowchart and swimlane are drawn
// with: boxes.js writes them as compact XML without positions. These tests
// cover the pass on XML (so the XML path can use it too) and the types.

function boxesOf(xml)
{
  const out = new Map();
  const re = /<mxCell id="([^"]+)"([^>]*)>\s*<mxGeometry([^>]*?)\/?>/g;
  let m;

  while ((m = re.exec(xml)) != null)
  {
    if (!/vertex="1"/.test(m[2]))
    {
      continue;
    }

    const num = function(name)
    {
      const a = new RegExp("\\b" + name + "=\"([^\"]*)\"").exec(m[3]);

      return (a != null) ? Number(a[1]) : 0;
    };
    const parent = /parent="([^"]*)"/.exec(m[2]);
    const style = /style="([^"]*)"/.exec(m[2]);

    out.set(m[1], { id: m[1], x: num("x"), y: num("y"), w: num("width"), h: num("height"),
      parent: parent != null ? parent[1] : null, style: style != null ? style[1] : "" });
  }

  return out;
}

function absolute(boxes, id)
{
  const b = boxes.get(id);
  let x = b.x;
  let y = b.y;

  for (let p = boxes.get(b.parent); p != null; p = boxes.get(p.parent))
  {
    x += p.x;
    y += p.y;
  }

  return { x: x, y: y, w: b.w, h: b.h };
}

function overlap(a, b)
{
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function vertex(id, value, style, parent)
{
  return "<mxCell id=\"" + id + "\" value=\"" + value + "\" style=\"" + style + "\" vertex=\"1\" parent=\"" + (parent || "1") +
    "\"><mxGeometry as=\"geometry\"/></mxCell>";
}

function edge(id, from, to, value)
{
  return "<mxCell id=\"" + id + "\" value=\"" + (value || "") + "\" style=\"edgeStyle=orthogonalEdgeStyle;html=1;\" edge=\"1\" parent=\"1\" source=\"" +
    from + "\" target=\"" + to + "\"><mxGeometry relative=\"1\" as=\"geometry\"/></mxCell>";
}

function model(cells)
{
  return "<mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/>" + cells.join("") + "</root></mxGraphModel>";
}

const BOX = "rounded=1;whiteSpace=wrap;html=1;fontSize=14;";
const DECISION = "rhombus;whiteSpace=wrap;html=1;fontSize=14;";
const FRAME = "swimlane;startSize=30;html=1;fontSize=14;";

test("a diagram that is placed already is left alone", function()
{
  const xml = model(["<mxCell id=\"a\" value=\"A\" style=\"" + BOX + "\" vertex=\"1\" parent=\"1\">" +
    "<mxGeometry x=\"40\" y=\"40\" width=\"120\" height=\"60\" as=\"geometry\"/></mxCell>"]);
  const r = gridLayoutDiagram(xml);

  assert.equal(r.xml, xml);
  assert.equal(r.stats.pages, 0);
});

test("cells without a position get one, sized to their text, and nothing overlaps", function()
{
  const xml = model([vertex("a", "Start", BOX), vertex("b", "A much longer label that has to wrap", BOX), vertex("c", "End", BOX),
    edge("e1", "a", "b"), edge("e2", "b", "c")]);
  const r = gridLayoutDiagram(xml);
  const boxes = boxesOf(r.xml);

  assert.equal(r.stats.pages, 1);
  assert.equal(boxes.size, 3);

  for (const b of boxes.values())
  {
    assert.ok(b.w >= 120 && b.h >= 40, b.id + " has a size");
  }

  // boxes of one kind share one size: the size of the fullest one
  assert.equal(boxes.get("a").w, boxes.get("b").w);
  assert.equal(boxes.get("a").h, boxes.get("b").h);

  const list = Array.from(boxes.values());

  for (let i = 0; i < list.length; i++)
  {
    for (let j = i + 1; j < list.length; j++)
    {
      assert.ok(!overlap(list[i], list[j]), list[i].id + " and " + list[j].id + " overlap");
    }
  }

  assert.doesNotMatch(r.xml, /<!--/);
  assert.equal(gridLayoutDiagram(xml).xml, r.xml, "the same input gives the same output");
});

test("row and col put a cell where the model wants it, and are removed from the style", function()
{
  const xml = model([vertex("lb", "Load balancer", BOX + "row=1;col=2;"), vertex("s1", "Service A", BOX + "row=2;col=1;"),
    vertex("s2", "Service B", BOX + "row=2;col=3;"), vertex("db", "Database", BOX + "row=3;col=1;"),
    edge("e1", "lb", "s1"), edge("e2", "lb", "s2"), edge("e3", "s1", "db")]);
  const r = gridLayoutDiagram(xml);
  const b = boxesOf(r.xml);

  assert.ok(b.get("lb").y < b.get("s1").y && b.get("s1").y < b.get("db").y, "rows from the top");
  assert.equal(b.get("s1").y, b.get("s2").y, "one row, one height");
  assert.ok(b.get("s1").x < b.get("lb").x && b.get("lb").x < b.get("s2").x, "columns from the left");
  assert.equal(b.get("s1").x, b.get("db").x, "one column, one x");
  assert.doesNotMatch(r.xml, /\b(row|col)=\d/);
  assert.equal(r.stats.hinted, 4);

  // without the hints the pass arranges by the connections
  const free = gridLayoutDiagram(xml, { hints: false });

  assert.equal(free.stats.hinted, 0);
  assert.doesNotMatch(free.xml, /\b(row|col)=\d/);
});

test("containers grow around their children, nested ones too", function()
{
  const xml = model([vertex("vpc", "VPC", FRAME), vertex("sub", "Subnet", FRAME, "vpc"), vertex("api", "API", BOX, "sub"),
    vertex("db", "Database", BOX, "sub"), vertex("user", "User", BOX), edge("e1", "user", "api"), edge("e2", "api", "db")]);
  // as in the servers: the normalization files the edges first
  const r = gridLayoutDiagram(normalizeDiagram(xml).xml);
  const b = boxesOf(r.xml);

  for (const pair of [["api", "sub"], ["db", "sub"], ["sub", "vpc"]])
  {
    const child = absolute(b, pair[0]);
    const parent = absolute(b, pair[1]);

    assert.ok(child.x >= parent.x && child.y >= parent.y + 30 && child.x + child.w <= parent.x + parent.w &&
      child.y + child.h <= parent.y + parent.h, pair[0] + " lies inside " + pair[1] + ", below its title");
  }

  assert.ok(!overlap(absolute(b, "user"), absolute(b, "vpc")), "what is outside a container stays outside");
  assert.equal(normalizeDiagram(r.xml).xml, r.xml, "the normalization finds nothing to change");
});

test("lanes share one grid: columns of one height, every step inside its lane", function()
{
  const lane = "swimlane;lane=1;startSize=30;html=1;";
  const xml = model([vertex("l1", "Customer", lane), vertex("l2", "Shop", lane), vertex("a", "Place order", BOX, "l1"),
    vertex("b", "Check stock", BOX, "l2"), vertex("c", "In stock?", DECISION, "l2"), vertex("d", "Ship", BOX, "l2"),
    vertex("e", "Get refund", BOX, "l1"), edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "d", "Yes"),
    edge("e4", "c", "e", "No")]);
  const r = gridLayoutDiagram(xml);
  const b = boxesOf(r.xml);
  const l1 = b.get("l1");
  const l2 = b.get("l2");

  assert.ok((l1.h === l2.h && l1.y === l2.y && l1.x + l1.w === l2.x) || (l1.w === l2.w && l1.x === l2.x && l1.y + l1.h === l2.y),
    "the lanes are bands side by side");

  for (const id of ["a", "e", "b", "c", "d"])
  {
    const child = absolute(b, id);
    const parent = absolute(b, b.get(id).parent);

    assert.ok(child.x >= parent.x && child.x + child.w <= parent.x + parent.w && child.y >= parent.y &&
      child.y + child.h <= parent.y + parent.h, id + " lies inside its lane");
  }

  assert.doesNotMatch(r.xml, /lane=1/, "the lane mark is removed");
});

test("a flow that is longer than the frame continues in the next column", function()
{
  const cells = [];

  for (let i = 1; i <= 14; i++)
  {
    cells.push(vertex("s" + i, "Step " + i, i === 5 ? DECISION : BOX));

    if (i > 1)
    {
      cells.push(edge("e" + i, "s" + (i - 1), "s" + i));
    }
  }

  const r = gridLayoutDiagram(model(cells), { direction: "vertical" });
  const list = Array.from(boxesOf(r.xml).values());
  const height = Math.max.apply(null, list.map(function(b) { return b.y + b.h; }));
  const columns = new Set(list.map(function(b) { return Math.round(b.x + b.w / 2); }));

  assert.ok(height <= 800, "the flow fits the height of the chat frame (" + height + ")");
  assert.ok(columns.size >= 2, "in more than one column");
});

test("edges are routed at right angles around the shapes between their ends", function()
{
  const xml = model([vertex("a", "A", BOX + "row=1;col=1;"), vertex("b", "B", BOX + "row=2;col=1;"), vertex("c", "C", BOX + "row=3;col=1;"),
    edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "a", "c")]);
  const r = gridLayoutDiagram(xml);
  const b = boxesOf(r.xml);
  const m = /<mxCell id="e3"[^>]*>\s*<mxGeometry[^>]*>([\s\S]*?)<\/mxGeometry>/.exec(r.xml);

  assert.ok(m != null && /<mxPoint/.test(m[1]), "the edge past B has waypoints");

  const points = Array.from(m[1].matchAll(/<mxPoint x="([-\d.]+)" y="([-\d.]+)"/g)).map(function(p) { return { x: +p[1], y: +p[2] }; });
  const mid = b.get("b");

  for (const p of points)
  {
    assert.ok(p.x < mid.x || p.x > mid.x + mid.w || p.y < mid.y || p.y > mid.y + mid.h, "no waypoint inside B");
  }

  assert.equal(r.stats.through, 0);
});

// ─── The semantic types that use the pass ────────────────────────

const SHOP =
{
  type: "architecture",
  title: "Web shop",
  nodes:
  [
    { id: "users", label: "Users", kind: "user" },
    { id: "cdn", label: "CloudFront", icon: "aws cloudfront" },
    { id: "api", label: "API", icon: "aws lambda", group: "private" },
    { id: "db", label: "Orders", icon: "aws dynamodb", group: "private" },
    { id: "queue", label: "Events", kind: "queue" }
  ],
  groups: [{ id: "vpc", label: "VPC", icon: "aws vpc" }, { id: "private", label: "Private subnet", parent: "vpc" }],
  edges:
  [
    { from: "users", to: "cdn", label: "HTTPS" }, { from: "cdn", to: "api" }, { from: "api", to: "db", label: "reads" },
    { from: "api", to: "queue", kind: "async" }
  ]
};

const ORDER =
{
  type: "flowchart",
  title: "Order",
  groups: [{ id: "customer", label: "Customer" }, { id: "shop", label: "Shop" }],
  nodes:
  [
    { id: "start", label: "Start", kind: "start", group: "customer" },
    { id: "order", label: "Place order", kind: "step", group: "customer" },
    { id: "stock", label: "In stock?", kind: "decision", group: "shop" },
    { id: "ship", label: "Ship", kind: "step", group: "shop" },
    { id: "cancel", label: "Cancel order", kind: "error", group: "shop" },
    { id: "end", label: "End", kind: "end", group: "customer" }
  ],
  edges:
  [
    { from: "start", to: "order" }, { from: "order", to: "stock" }, { from: "stock", to: "ship", label: "Yes" },
    { from: "stock", to: "cancel", label: "No" }, { from: "ship", to: "end" }, { from: "cancel", to: "end" }
  ]
};

test("architecture, network, flowchart and swimlane have a layout", function()
{
  for (const t of ["er", "architecture", "network", "flowchart", "swimlane"])
  {
    assert.ok(SUPPORTED_TYPES.includes(t), t);
  }
});

test("an architecture is drawn with official icons, nested frames and dashed events", async function()
{
  const r = await semanticToXml(SHOP);
  const b = boxesOf(r.xml);

  assert.ok(!r.error, r.error);
  assert.match(b.get("api").style, /mxgraph\.aws4/);
  assert.match(b.get("vpc").style, /mxgraph\.aws4\.group/);
  assert.equal(b.get("api").parent, "private");
  assert.equal(b.get("private").parent, "vpc");
  assert.match(b.get("users").style, /umlActor/);
  assert.match(/<mxCell id="api-queue"[^>]*style="([^"]*)"/.exec(r.xml)[1], /dashed=1/);
  assert.doesNotMatch(r.xml, /\b(icon|role|row|col)=/, "no shorthand is left");
  assert.doesNotMatch(r.xml, /<!--/);
  assert.equal(repairDiagramXml(r.xml).xml, r.xml);
  assert.equal(normalizeDiagram(r.xml).xml, r.xml);
  assert.equal((await semanticToXml(SHOP)).xml, r.xml, "deterministic");

  const inner = absolute(b, "api");
  const outer = absolute(b, "vpc");

  assert.ok(inner.x > outer.x && inner.y > outer.y && inner.x + inner.w < outer.x + outer.w && inner.y + inner.h < outer.y + outer.h);
});

test("an icon that doesn't exist becomes a box with a warning, and a device is not a person", async function()
{
  const r = await semanticToXml({ type: "network", nodes: [{ id: "pc", label: "Desktop PC 1", kind: "user" },
    { id: "sw", label: "Switch", icon: "acme hyperswitch 9000" }], edges: [{ from: "sw", to: "pc" }] });
  const b = boxesOf(r.xml);

  assert.doesNotMatch(b.get("pc").style, /umlActor/);
  assert.ok(r.warnings.some(function(w) { return /hyperswitch/.test(w); }));
  assert.match(/<mxCell id="sw-pc"[^>]*style="([^"]*)"/.exec(r.xml)[1], /endArrow=none/, "network links have no arrowheads");
});

test("a flowchart with lanes puts every step in its lane and colors the branches", async function()
{
  const r = await semanticToXml(ORDER);
  const b = boxesOf(r.xml);

  assert.ok(!r.error, r.error);
  assert.equal(b.get("order").parent, "customer");
  assert.equal(b.get("stock").parent, "shop");
  assert.match(b.get("stock").style, /rhombus/);
  assert.match(b.get("customer").style, /swimlane/);
  assert.match(/<mxCell id="stock-ship"[^>]*style="([^"]*)"/.exec(r.xml)[1], /fontColor=#1E7F3E/);
  assert.match(/<mxCell id="stock-cancel"[^>]*style="([^"]*)"/.exec(r.xml)[1], /fontColor=#C9302C/);
  assert.equal(r.stats.through, 0, "no line runs through a step");
});

test("placement hints are read from row and col, and ignored when they are switched off", async function()
{
  const d = { type: "architecture", nodes: [{ id: "a", label: "Gateway", row: 1, col: 2 }, { id: "b", label: "Service", row: 2, col: 1 },
    { id: "c", label: "Worker", row: 2, col: 3 }], edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }] };
  const hinted = await semanticToXml(d);
  const b = boxesOf(hinted.xml);

  assert.equal(hinted.stats.hinted, 3);
  assert.ok(b.get("a").y < b.get("b").y && b.get("b").x < b.get("a").x && b.get("a").x < b.get("c").x);
  assert.equal((await semanticToXml(d, { hints: false })).stats.hinted, 0);
  assert.equal(normalizeSpec(d, { hints: false }).diagram.nodes[0].row, null);
});

test("the compact XML of a description has no positions and uses the shorthands of the XML path", function()
{
  const xml = compactXml(normalizeSpec(SHOP).diagram, { flow: false, links: false }).xml;

  assert.match(xml, /icon=aws lambda/);
  assert.match(xml, /role=/);
  assert.doesNotMatch(xml, /<mxGeometry[^>]*\bx=/);
});

test("the description stays within the limit for every way of offering hints, and the keys are in the schema", function()
{
  for (const hints of [true, false, "ask"])
  {
    const text = describeTool(SUPPORTED_TYPES, { hints: hints });

    assert.ok(text.length <= 2048, "hints " + hints + ": " + text.length + " characters");
    assert.match(text, /type "architecture"/);
    assert.match(text, /type "flowchart"/);
    assert.equal(/row and col/.test(text), hints !== false);
  }

  const schema = describeSchema(SUPPORTED_TYPES, { hints: true });
  const node = schema.properties.nodes.items.properties;

  assert.ok(node.row != null && node.col != null && node.icon != null && node.fields != null);
  assert.equal(schema.properties.direction, undefined, "models set a direction without need when it is offered");
  assert.deepEqual(schema.properties.type.enum, SUPPORTED_TYPES);
  assert.equal(describeSchema(SUPPORTED_TYPES, { hints: false }).properties.nodes.items.properties.row, undefined);
  assert.equal(describeSchema(["er"]).properties.groups, undefined);
});
