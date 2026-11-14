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
  assert.match(b.get("users").style, /mxgraph\.aws4\.users/, "people take the provider's icon");
  assert.ok(/fontStyle=0;/.test(b.get("api").style) && /fontColor=default;/.test(b.get("api").style), "one text color for every icon's name");
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

  const people = await semanticToXml({ type: "architecture", nodes: [{ id: "u", label: "Customers", kind: "user" },
    { id: "s", label: "Shop", kind: "service" }], edges: [{ from: "u", to: "s" }] });

  assert.match(boxesOf(people.xml).get("u").style, /umlActor/, "people without a provider's icons are a figure");
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

// One grid for the whole diagram ("ask"): the model gives every node its
// cell as it would place the shape itself, and the pass draws the frames.
const PAGE =
{
  type: "architecture",
  nodes: [
    { id: "users", label: "Users", kind: "user", row: 1, col: 2 },
    { id: "cdn", label: "CDN", icon: "aws cloudfront", row: 2, col: 2 },
    { id: "web1", label: "Web 1", icon: "aws ec2", group: "pub", row: 3, col: 1 },
    { id: "web2", label: "Web 2", icon: "aws ec2", group: "pub", row: 3, col: 2 },
    { id: "app", label: "App", icon: "aws lambda", group: "priv", row: 4, col: 1 },
    { id: "db", label: "Orders", icon: "aws rds", group: "priv", row: 4, col: 2 },
    { id: "mail", label: "Mail provider", kind: "external", row: 4, col: 3 }],
  groups: [{ id: "vpc", label: "VPC", icon: "aws vpc" }, { id: "pub", label: "Public subnet", icon: "aws public subnet", parent: "vpc" },
    { id: "priv", label: "Private subnet", icon: "aws private subnet", parent: "vpc" }],
  edges: [{ from: "users", to: "cdn" }, { from: "cdn", to: "web1" }, { from: "cdn", to: "web2" }, { from: "web1", to: "app" },
    { from: "app", to: "db", label: "SQL" }, { from: "app", to: "mail", label: "SMTP" }]
};

const PAGE_LANES =
{
  type: "flowchart",
  groups: [{ id: "cust", label: "Customer" }, { id: "shop", label: "Shop" }, { id: "wh", label: "Warehouse" }],
  nodes: [
    { id: "s", label: "Start", kind: "start", group: "cust", row: 1, col: 1 },
    { id: "order", label: "Place order", group: "cust", row: 1, col: 2 },
    { id: "check", label: "In stock?", kind: "decision", group: "shop", row: 2, col: 2 },
    { id: "bill", label: "Send invoice", group: "shop", row: 2, col: 3 },
    { id: "cancel", label: "Cancel order", kind: "error", group: "shop", row: 3, col: 3 },
    { id: "pick", label: "Pick and pack", group: "wh", row: 4, col: 3 },
    { id: "ship", label: "Ship", group: "wh", row: 4, col: 4 },
    { id: "e", label: "Done", kind: "end", group: "cust", row: 1, col: 4 }],
  edges: [{ from: "s", to: "order" }, { from: "order", to: "check" }, { from: "check", to: "bill", label: "Yes" },
    { from: "check", to: "cancel", label: "No" }, { from: "bill", to: "pick" }, { from: "pick", to: "ship" }, { from: "ship", to: "e" }]
};

function inside(inner, outer)
{
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

function apart(a, b)
{
  return a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
}

test("asked hints are the cells of one grid for the page, with the frames drawn around their members", async function()
{
  const r = await semanticToXml(PAGE, { hints: "ask" });
  const b = boxesOf(r.xml);
  const at = function(id) { return absolute(b, id); };

  assert.ok(!r.error, r.error);
  assert.equal(r.stats.grid, "page");
  assert.equal(r.stats.through, 0);

  // rows and columns hold over the whole page, across frames
  assert.equal(at("web1").y, at("web2").y);
  assert.equal(at("app").y, at("db").y);
  assert.equal(at("web1").x, at("app").x, "one column through both subnets");
  assert.equal(at("cdn").x, at("web2").x, "and through the frame's border");
  assert.equal(at("web2").x, at("db").x);
  assert.ok(at("users").y < at("cdn").y && at("cdn").y < at("web1").y && at("web1").y < at("app").y);
  assert.ok(at("db").x < at("mail").x);

  // frames around their members, nested ones inside their parent, and
  // nothing else in them
  assert.ok(inside(at("web1"), at("pub")) && inside(at("web2"), at("pub")));
  assert.ok(inside(at("app"), at("priv")) && inside(at("db"), at("priv")));
  assert.ok(inside(at("pub"), at("vpc")) && inside(at("priv"), at("vpc")));
  assert.ok(apart(at("pub"), at("priv")));
  assert.ok(apart(at("mail"), at("vpc")) && apart(at("cdn"), at("vpc")));
  assert.equal(at("pub").w, at("priv").w, "frames over the same columns are as wide as each other");
  assert.doesNotMatch(r.xml, /\b(row|col)=\d/);

  // the same description every time
  assert.equal((await semanticToXml(PAGE, { hints: "ask" })).xml, r.xml);
});

test("a node in the block of a group it isn't in moves out, and a node without a cell falls back to a grid per group", async function()
{
  // the mail provider in the corner of the VPC's block: rows 3 to 4, columns 1 to 3
  const d = JSON.parse(JSON.stringify(PAGE));

  d.nodes.find(function(n) { return n.id === "web2"; }).col = 3;
  Object.assign(d.nodes.find(function(n) { return n.id === "mail"; }), { row: 3, col: 2 });

  const r = await semanticToXml(d, { hints: "ask" });
  const b = boxesOf(r.xml);
  const at = function(id) { return absolute(b, id); };

  assert.ok(!r.error, r.error);
  assert.equal(r.stats.grid, "page");
  assert.ok(inside(at("web1"), at("pub")) && inside(at("web2"), at("pub")));
  assert.ok(apart(at("mail"), at("vpc")), "outside the frame");
  assert.ok(at("mail").y + at("mail").h <= at("vpc").y, "by the shortest way: above it");
  assert.equal(at("mail").x + at("mail").w / 2, at("cdn").x + at("cdn").w / 2, "in its column");

  // a node without a cell
  const open = JSON.parse(JSON.stringify(PAGE));

  delete open.nodes[0].row;
  assert.equal((await semanticToXml(open, { hints: "ask" })).stats.grid, "group");

  // two nodes of different groups in one cell: one of them is the stranger
  const shared = JSON.parse(JSON.stringify(PAGE));

  Object.assign(shared.nodes.find(function(n) { return n.id === "app"; }), { row: 3, col: 2 });

  const f = await semanticToXml(shared, { hints: "ask" });
  const fb = boxesOf(f.xml);

  assert.equal(f.stats.grid, "page");
  assert.ok(inside(absolute(fb, "app"), absolute(fb, "priv")) && inside(absolute(fb, "web2"), absolute(fb, "pub")));
  assert.ok(apart(absolute(fb, "pub"), absolute(fb, "priv")));
  assert.ok(apart(absolute(fb, "app"), absolute(fb, "web2")));

  // without "ask", the cells are those of each group's own grid, as before
  assert.equal((await semanticToXml(PAGE)).stats.grid, "group");
});

test("lanes are bands of the page's grid: rows, or columns when the model turns it", async function()
{
  const r = await semanticToXml(PAGE_LANES, { hints: "ask" });
  const b = boxesOf(r.xml);
  const at = function(id) { return absolute(b, id); };

  assert.ok(!r.error, r.error);
  assert.equal(r.stats.grid, "page");

  for (const lane of ["cust", "shop", "wh"])
  {
    assert.match(b.get(lane).style, /horizontal=0/, "lanes as rows have their title on the left");
    assert.equal(at(lane).w, at("cust").w);
    assert.equal(at(lane).x, 0);
  }

  assert.equal(at("shop").y, at("cust").y + at("cust").h, "the lanes touch");
  assert.equal(at("wh").y, at("shop").y + at("shop").h);
  assert.ok(at("shop").h > at("cust").h, "a lane with two rows is higher");
  assert.equal(at("order").x + at("order").w / 2, at("check").x + at("check").w / 2, "a step handed over stays in its column");
  assert.equal(at("bill").x, at("cancel").x);
  assert.equal(at("bill").x, at("pick").x);
  assert.equal(at("ship").x, at("e").x);
  assert.ok(inside(at("check"), at("shop")) && inside(at("cancel"), at("shop")) && inside(at("pick"), at("wh")));

  // turned: the same cells with rows and columns swapped
  const turned = JSON.parse(JSON.stringify(PAGE_LANES));

  turned.nodes.forEach(function(n)
  {
    const row = n.row;

    n.row = n.col;
    n.col = row;
  });

  const t = await semanticToXml(turned, { hints: "ask" });
  const tb = boxesOf(t.xml);
  const tat = function(id) { return absolute(tb, id); };

  assert.equal(t.stats.grid, "page");

  for (const lane of ["cust", "shop", "wh"])
  {
    assert.doesNotMatch(tb.get(lane).style, /horizontal=0/);
    assert.equal(tat(lane).h, tat("cust").h);
    assert.equal(tat(lane).y, 0);
  }

  assert.equal(tat("shop").x, tat("cust").x + tat("cust").w);
  assert.equal(tat("order").y + tat("order").h / 2, tat("check").y + tat("check").h / 2);
  assert.ok(tat("s").y < tat("order").y && tat("order").y < tat("e").y);

  // seven steps in lanes as rows would be shown at half their size: the
  // pass turns them into columns, every hand-over still straight
  const steps = function(count)
  {
    const d = { type: "flowchart", groups: [{ id: "a", label: "Sales" }, { id: "b", label: "Support" }, { id: "c", label: "Billing" }], nodes: [], edges: [] };

    for (let i = 1; i <= count; i++)
    {
      d.nodes.push({ id: "n" + i, label: "Step number " + i, group: "abc".charAt(i % 3), row: (i % 3) + 1, col: i });

      if (i > 1)
      {
        d.edges.push({ from: "n" + (i - 1), to: "n" + i });
      }
    }

    return d;
  };

  const l = await semanticToXml(steps(7), { hints: "ask" });
  const lb = boxesOf(l.xml);

  assert.equal(l.stats.grid, "page");
  assert.doesNotMatch(lb.get("a").style, /horizontal=0/, "lanes as columns");
  assert.ok(absolute(lb, "a").x < absolute(lb, "b").x && absolute(lb, "b").x < absolute(lb, "c").x, "in the order of their rows");
  assert.ok(absolute(lb, "n1").y < absolute(lb, "n2").y && absolute(lb, "n2").y < absolute(lb, "n7").y, "the steps run down");
  assert.ok(l.stats.width < 800, "as wide as the chat frame: " + l.stats.width);

  // fourteen steps too: as rows they are shown at a quarter of their size,
  // as columns the page is made wider until the chat shows it whole
  const tall = await semanticToXml(steps(14), { hints: "ask" });
  const whole = Math.min(736 / tall.stats.width, 664 / tall.stats.height);

  assert.doesNotMatch(boxesOf(tall.xml).get("a").style, /horizontal=0/, "fourteen steps in columns");
  assert.ok(736 / tall.stats.width <= whole * 1.05, "shown whole: " + tall.stats.width + " × " + tall.stats.height);
  assert.ok(whole > 0.4, "at almost twice the size of the rows: " + whole);

  // lanes that share rows and columns can't be bands
  const mixed = JSON.parse(JSON.stringify(PAGE_LANES));

  Object.assign(mixed.nodes.find(function(n) { return n.id === "e"; }), { row: 3, col: 4 });
  assert.equal((await semanticToXml(mixed, { hints: "ask" })).stats.grid, "group");
});

// ─── Lines on the page's grid (shared/grid-lines.js) ─────────────

// Every routed edge as it is drawn: from its exit point over its bends to
// its entry point, in page coordinates.
function linesOf(xml)
{
  const b = boxesOf(xml);
  const out = new Map();
  const re = /<mxCell id="([^"]+)"([^>]*\bedge="1"[^>]*)>\s*<mxGeometry([^>]*?)(?:\/>|>([\s\S]*?)<\/mxGeometry>)/g;
  let m;

  while ((m = re.exec(xml)) != null)
  {
    const attrs = m[2];
    const attr = function(name)
    {
      const a = new RegExp("\\b" + name + "=\"([^\"]*)\"").exec(attrs);

      return (a != null) ? a[1] : null;
    };
    const style = attr("style") || "";
    const key = function(name)
    {
      const a = new RegExp("(?:^|;)" + name + "=([-\\d.]+)").exec(style);

      return (a != null) ? Number(a[1]) : null;
    };
    const s = absolute(b, attr("source"));
    const t = absolute(b, attr("target"));
    const origin = b.has(attr("parent")) ? absolute(b, attr("parent")) : { x: 0, y: 0 };
    const points = [];

    if (key("exitX") != null)
    {
      points.push({ x: s.x + s.w * key("exitX"), y: s.y + s.h * key("exitY") });
    }

    for (const p of (m[4] || "").matchAll(/<mxPoint x="([-\d.]+)" y="([-\d.]+)"\s*\/>/g))
    {
      points.push({ x: Number(p[1]) + origin.x, y: Number(p[2]) + origin.y });
    }

    if (key("entryX") != null)
    {
      points.push({ x: t.x + t.w * key("entryX"), y: t.y + t.h * key("entryY") });
    }

    const along = /\bx="([-\d.]+)"/.exec(m[3]);
    let length = 0;

    for (let i = 0; i + 1 < points.length; i++)
    {
      length += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
    }

    out.set(m[1], { id: m[1], source: attr("source"), target: attr("target"), points: points, length: length,
      label: (along != null) ? Number(along[1]) : 0, routed: key("exitX") != null && key("entryX") != null });
  }

  return out;
}

// What is wrong with the lines of a diagram: a piece that is not at a right
// angle, one that runs through a shape it doesn't connect, two lines on each
// other. The lines of a bundle (ids in one of the lists of `bundles`) share
// their trunk.
function lineFaults(xml, bundles)
{
  const mates = function(a, b)
  {
    return (bundles || []).some(function(list) { return list.indexOf(a) >= 0 && list.indexOf(b) >= 0; });
  };

  const b = boxesOf(xml);
  const lines = Array.from(linesOf(xml).values());
  const leaves = Array.from(b.keys()).filter(function(id)
  {
    return !Array.from(b.values()).some(function(o) { return o.parent === id; });
  });
  const faults = [];
  const pieces = [];

  for (const l of lines)
  {
    if (!l.routed)
    {
      faults.push(l.id + " is not routed");
    }

    for (let i = 0; i + 1 < l.points.length; i++)
    {
      const p = l.points[i];
      const q = l.points[i + 1];
      const vertical = Math.abs(p.x - q.x) < 0.5;

      if (!vertical && Math.abs(p.y - q.y) >= 0.5)
      {
        faults.push(l.id + " has a slanted piece");
      }

      pieces.push({ line: l, vertical: vertical, at: vertical ? p.x : p.y, lo: vertical ? Math.min(p.y, q.y) : Math.min(p.x, q.x),
        hi: vertical ? Math.max(p.y, q.y) : Math.max(p.x, q.x) });

      for (const id of leaves)
      {
        const r = absolute(b, id);

        if (id !== l.source && id !== l.target && Math.max(p.x, q.x) > r.x + 1 && Math.min(p.x, q.x) < r.x + r.w - 1 &&
          Math.max(p.y, q.y) > r.y + 1 && Math.min(p.y, q.y) < r.y + r.h - 1)
        {
          faults.push(l.id + " runs through " + id);
        }
      }
    }
  }

  pieces.forEach(function(a, i)
  {
    for (const o of pieces.slice(i + 1))
    {
      if (o.line !== a.line && !mates(o.line.id, a.line.id) && o.vertical === a.vertical && Math.abs(o.at - a.at) < 4 &&
        Math.min(a.hi, o.hi) - Math.max(a.lo, o.lo) > 1)
      {
        faults.push(a.line.id + " and " + o.line.id + " run on each other");
      }
    }
  });

  return faults;
}

function grid(columns, rows, edges)
{
  const d = { type: "architecture", nodes: [], edges: edges };

  for (let r = 1; r <= rows; r++)
  {
    for (let c = 1; c <= columns; c++)
    {
      d.nodes.push({ id: "abcdef".charAt(c - 1) + r, label: "abcdef".charAt(c - 1).toUpperCase() + r, row: r, col: c });
    }
  }

  return d;
}

test("lines on the page's grid run at right angles, through no shape and never on each other", async function()
{
  const crossed = grid(2, 4, [{ from: "a1", to: "b4" }, { from: "a2", to: "b3" }, { from: "a3", to: "b2" }, { from: "a4", to: "b1" }]);
  const hub = grid(3, 3, [{ from: "b2", to: "a1" }, { from: "b2", to: "c1" }, { from: "b2", to: "a3" }, { from: "b2", to: "c3" },
    { from: "a1", to: "c3" }, { from: "a2", to: "c2" }, { from: "b1", to: "b3" }]);

  // the four lines of the hub are one tree (see the bundles below)
  const tree = ["b2-a1", "b2-c1", "b2-a3", "b2-c3"];

  for (const d of [PAGE, PAGE_LANES, crossed, hub])
  {
    const r = await semanticToXml(d, { hints: "ask" });

    assert.equal(r.stats.grid, "page");
    assert.equal(r.stats.through, 0);
    assert.deepEqual(lineFaults(r.xml, d === hub ? [tree] : null), []);
    assert.equal(linesOf(r.xml).size, d.edges.length);
  }
});

test("the lines that run through a gap get a track each, and the gap the room for them", async function()
{
  const edges = [{ from: "a1", to: "b4" }, { from: "a4", to: "b1" }];
  const one = await semanticToXml(grid(2, 4, edges.slice(0, 1)), { hints: "ask" });
  const two = await semanticToXml(grid(2, 4, edges), { hints: "ask" });
  const gap = function(r)
  {
    const b = boxesOf(r.xml);

    return absolute(b, "b1").x - absolute(b, "a1").x - absolute(b, "a1").w;
  };
  const tracks = Array.from(linesOf(two.xml).values()).map(function(l) { return l.points[1].x; }).sort(function(a, b) { return a - b; });
  const from = absolute(boxesOf(two.xml), "a1");

  assert.ok(gap(two) > gap(one), "two lines need more room than one: " + gap(two) + " and " + gap(one));
  assert.ok(tracks[1] - tracks[0] >= 12, "the lines are apart: " + tracks.join(", "));
  assert.ok(tracks[0] - from.x - from.w >= 12 && from.x + from.w + gap(two) - tracks[1] >= 12, "and clear of the shapes");
  assert.deepEqual(lineFaults(two.xml), []);

  // without the engine's lines the room stays, for the viewer's router
  const open = await semanticToXml(grid(2, 4, edges), { hints: "ask", route: false });

  assert.equal(gap(open), gap(two));
  assert.doesNotMatch(open.xml, /exitX=/);
});

test("a line between two shapes of a frame stays inside it, and the title makes way for a line", async function()
{
  const d =
  {
    type: "architecture",
    groups: [{ id: "g", label: "Group" }],
    nodes: [
      { id: "top", label: "Gateway", row: 1, col: 2 },
      { id: "a", label: "Alpha", group: "g", row: 2, col: 1 }, { id: "b", label: "Beta", group: "g", row: 2, col: 2 },
      { id: "c", label: "Gamma", group: "g", row: 2, col: 3 }],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "c", label: "sync" }]
  };
  const r = await semanticToXml(d, { hints: "ask" });
  const b = boxesOf(r.xml);
  const frame = absolute(b, "g");

  assert.deepEqual(lineFaults(r.xml), []);
  assert.equal(linesOf(r.xml).get("a-c").points.length, 4, "around Beta");

  for (const p of linesOf(r.xml).get("a-c").points)
  {
    assert.ok(p.x > frame.x && p.x < frame.x + frame.w && p.y > frame.y && p.y < frame.y + frame.h, "inside the frame: " + JSON.stringify(p));
  }

  assert.doesNotMatch(b.get("g").style, /align=left/, "the title stays in the middle");

  // a line into the frame where its title stands
  d.edges.push({ from: "top", to: "b" });

  const t = await semanticToXml(d, { hints: "ask" });
  const line = linesOf(t.xml).get("top-b");

  assert.equal(line.points.length, 2, "straight down");
  assert.match(boxesOf(t.xml).get("g").style, /align=left;spacingLeft=\d+/);
});

test("the outcome of a decision is labeled at the decision, however long its line is", async function()
{
  const d =
  {
    type: "flowchart",
    nodes: [
      { id: "s", label: "Start", kind: "start", row: 1, col: 1 }, { id: "d", label: "Valid?", kind: "decision", row: 2, col: 1 },
      { id: "p", label: "Process", row: 2, col: 2 }, { id: "q", label: "Queue", row: 2, col: 3 },
      { id: "r", label: "Reject", kind: "error", row: 2, col: 4 }, { id: "e", label: "End", kind: "end", row: 3, col: 1 }],
    edges: [{ from: "s", to: "d" }, { from: "d", to: "p", label: "Yes" }, { from: "p", to: "q" }, { from: "d", to: "r", label: "No" },
      { from: "q", to: "e" }, { from: "r", to: "e" }]
  };
  const r = await semanticToXml(d, { hints: "ask" });
  const no = linesOf(r.xml).get("d-r");

  assert.deepEqual(lineFaults(r.xml), []);
  assert.ok(no.length > 400, "the line runs around Process and Queue: " + no.length);
  assert.ok((no.label + 1) / 2 * no.length < 150, "its label is beside the decision: " + (no.label + 1) / 2 * no.length);
});

test("a page the chat would cut off at the bottom gets wider until it is shown whole", async function()
{
  const d = { type: "flowchart", nodes: [], edges: [] };

  for (let i = 1; i <= 36; i++)
  {
    d.nodes.push({ id: "n" + i, label: "Step number " + i, row: Math.ceil(i / 3), col: ((i - 1) % 3) + 1 });

    if (i > 1)
    {
      d.edges.push({ from: "n" + (i - 1), to: "n" + i });
    }
  }

  const r = await semanticToXml(d, { hints: "ask" });
  const b = boxesOf(r.xml);

  // the viewer shows a tall diagram whole when the scale of its width is
  // about that of the whole (computeDefaultViewTransform); the frame is
  // 736 × 664
  const whole = Math.min(736 / r.stats.width, 664 / r.stats.height);

  assert.equal(r.stats.grid, "page");
  assert.ok(736 / r.stats.width <= whole * 1.05, "shown whole: " + r.stats.width + " × " + r.stats.height);
  assert.ok(whole >= 0.5, "and not too small");
  assert.ok(absolute(b, "n1").y === absolute(b, "n3").y && absolute(b, "n1").x < absolute(b, "n2").x, "in the model's cells");
  assert.deepEqual(lineFaults(r.xml), []);
});

test("a tall page is shown whole below half its size too, with the notes under it", async function()
{
  const d = { type: "architecture", groups: [{ id: "g", label: "Group" }], nodes: [], edges: [] };

  for (let i = 1; i <= 48; i++)
  {
    d.nodes.push({ id: "n" + i, label: "Service " + i, row: Math.ceil(i / 3), col: ((i - 1) % 3) + 1, group: i > 45 ? "g" : undefined });

    if (i > 1)
    {
      d.edges.push({ from: "n" + (i - 1), to: "n" + i });
    }
  }

  d.edges.push({ from: "g", to: "n47", label: "logs" });

  const r = await semanticToXml(d, { hints: "ask" });
  const b = boxesOf(r.xml);
  let right = 0;
  let bottom = 0;

  for (const id of b.keys())
  {
    const box = absolute(b, id);

    right = Math.max(right, box.x + box.w);
    bottom = Math.max(bottom, box.y + box.h);
  }

  const whole = Math.min(736 / right, 664 / bottom);

  assert.equal(r.stats.grid, "page");
  assert.ok(b.has("notes"), "the connection of the group with its member is a note");
  assert.ok(whole < 0.5 && whole >= 0.3, "smaller than half: " + whole);
  assert.ok(736 / right <= whole * 1.05, "shown whole: " + right + " × " + bottom);
  assert.ok(absolute(b, "n1").y === absolute(b, "n3").y && absolute(b, "n1").x < absolute(b, "n2").x, "in the model's cells");
});

// ─── Large pages ─────────────────────────────────────────────────

test("a decision is as narrow as its question allows, on two or three lines", async function()
{
  const d =
  {
    type: "flowchart",
    nodes: [
      { id: "s", label: "Start", kind: "start", row: 1, col: 1 },
      { id: "d", label: "Is the customer account older than 30 days?", kind: "decision", row: 2, col: 1 },
      { id: "p", label: "Process", row: 3, col: 1 }, { id: "e", label: "End", kind: "end", row: 4, col: 1 }],
    edges: [{ from: "s", to: "d" }, { from: "d", to: "p", label: "Yes" }, { from: "p", to: "e" }]
  };
  const r = await semanticToXml(d, { hints: "ask" });
  const b = boxesOf(r.xml);

  assert.match(r.xml, /Is the customer&lt;br&gt;account older&lt;br&gt;than 30 days\?/);
  assert.ok(b.get("d").w <= 180, "about as wide as a step: " + b.get("d").w);
  assert.ok(b.get("d").h > 90 && b.get("d").h <= 120, "and a line higher: " + b.get("d").h);
});

test("a page that is shown small gets narrower boxes, and a flowchart is turned when its steps then show larger", async function()
{
  const page = function(columns, rows, type)
  {
    const d = grid(columns, rows, []);

    d.type = type;
    d.nodes.forEach(function(n, i)
    {
      if (i > 0)
      {
        d.edges.push({ from: d.nodes[i - 1].id, to: n.id });
      }
    });

    return d;
  };
  const small = await semanticToXml(page(3, 3, "architecture"), { hints: "ask" });
  const large = await semanticToXml(page(6, 6, "architecture"), { hints: "ask" });

  assert.equal(small.stats.dense, false);
  assert.equal(large.stats.dense, true);
  assert.equal(boxesOf(large.xml).get("a1").w, 140);
  assert.ok(large.stats.width <= 1000, "six columns in 1000 px: " + large.stats.width);

  // seven columns of six rows: the tiers of an architecture stay rows, the
  // steps of a flowchart run down instead
  const tiers = await semanticToXml(page(7, 6, "architecture"), { hints: "ask" });
  const flow = await semanticToXml(page(7, 6, "flowchart"), { hints: "ask" });
  const fb = boxesOf(flow.xml);

  assert.equal(tiers.stats.turned, false);
  assert.equal(flow.stats.turned, true);
  assert.ok(absolute(fb, "a1").y < absolute(fb, "b1").y && absolute(fb, "a1").x < absolute(fb, "a2").x, "rows as columns");
  assert.ok(flow.stats.width < tiers.stats.width - 100, flow.stats.width + " and " + tiers.stats.width);
  assert.deepEqual(lineFaults(flow.xml), []);
});

test("the label of a line that runs down past a row stands between the rows, without widening the gap", async function()
{
  const edges = [{ from: "a1", to: "b3", label: "replicates to standby" }, { from: "a2", to: "b2" }];
  const labeled = await semanticToXml(grid(2, 3, edges), { hints: "ask" });
  const plain = await semanticToXml(grid(2, 3, [{ from: "a1", to: "b3" }, { from: "a2", to: "b2" }]), { hints: "ask" });
  const b = boxesOf(labeled.xml);
  const line = linesOf(labeled.xml).get("a1-b3");

  assert.equal(absolute(b, "b1").x, absolute(boxesOf(plain.xml), "b1").x, "the gap is as wide as without the label");

  // where the label is: so far along the line
  let left = (line.label + 1) / 2 * line.length;
  let at = null;

  for (let i = 0; i + 1 < line.points.length && at == null; i++)
  {
    const p = line.points[i];
    const q = line.points[i + 1];
    const len = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);

    if (left <= len)
    {
      at = { x: p.x + (q.x - p.x) * left / len, y: p.y + (q.y - p.y) * left / len };
    }

    left -= len;
  }

  const rows = ["a1", "a2", "a3"].map(function(id) { return absolute(b, id); });

  assert.ok(rows.every(function(r) { return at.y + 9 <= r.y || at.y - 9 >= r.y + r.h; }), "between two rows: " + JSON.stringify(at));
});

// ─── Bundles ─────────────────────────────────────────────────────

const HUBS =
{
  type: "architecture",
  groups: [{ id: "svc", label: "Services" }, { id: "data", label: "Data" }],
  nodes: [
    { id: "gw", label: "Gateway", row: 1, col: 2 }, { id: "mon", label: "Monitoring", row: 1, col: 5 },
    { id: "a", label: "Alpha", group: "svc", row: 2, col: 1 }, { id: "b", label: "Beta", group: "svc", row: 2, col: 2 },
    { id: "c", label: "Gamma", group: "svc", row: 2, col: 3 }, { id: "e", label: "Delta", group: "svc", row: 2, col: 4 },
    { id: "bus", label: "Bus", kind: "queue", row: 3, col: 5 },
    { id: "db1", label: "Orders", kind: "database", group: "data", row: 4, col: 1 },
    { id: "db2", label: "Users", kind: "database", group: "data", row: 4, col: 2 },
    { id: "db3", label: "Events", kind: "database", group: "data", row: 5, col: 1 },
    { id: "bak", label: "Backup", row: 5, col: 4 }],
  edges: [
    { from: "gw", to: "svc", label: "routes" }, { from: "svc", to: "bus", label: "events", kind: "async" },
    { from: "mon", to: "svc", label: "scrapes" }, { from: "data", to: "bak", label: "nightly" }]
};

test("a connection with a group whose members stand in a row is drawn to every member, as one tree", async function()
{
  const r = await semanticToXml(HUBS, { hints: "ask" });
  const lines = linesOf(r.xml);
  const routes = ["gw-a", "gw-b", "gw-c", "gw-e"];
  const events = ["a-bus", "b-bus", "c-bus", "e-bus"];

  assert.ok(!r.error, r.error);
  assert.equal(r.stats.through, 0);

  for (const id of routes.concat(events))
  {
    assert.ok(lines.has(id), id);
  }

  assert.ok(!lines.has("gw-svc") && !lines.has("svc-bus"));
  assert.equal(r.xml.match(/value="routes"/g).length, 1, "the label stands once");
  assert.equal(r.xml.match(/value="events"/g).length, 1);
  assert.doesNotMatch(r.xml, /bundle=/, "the key is for the layout alone");
  assert.equal(r.xml.match(/dashed=1/g).length, 4, "every line of the bundle has its look");

  // the lines of a tree share their trunk, and nothing else runs on anything
  assert.deepEqual(lineFaults(r.xml, [routes, events]), []);
  assert.ok(lineFaults(r.xml).length > 0, "the trunk is shared");

  // one place on the hub for the lines that leave it on one side
  const exits = new Map();

  for (const id of events)
  {
    const end = lines.get(id).points[lines.get(id).points.length - 1];
    const key = Math.round(end.x) + "/" + Math.round(end.y);

    exits.set(key, (exits.get(key) || 0) + 1);
  }

  assert.ok(exits.size < events.length, "the bus is entered at " + Array.from(exits.keys()).join(", "));
});

test("further connections of a group, and a group in several rows, keep one line to the frame, clear of the shapes", async function()
{
  const r = await semanticToXml(HUBS, { hints: "ask" });
  const b = boxesOf(r.xml);
  const lines = linesOf(r.xml);

  // the third connection of the services
  assert.ok(lines.has("mon-svc") && !lines.has("mon-a"));

  // the databases stand in two rows
  assert.ok(lines.has("data-bak") && !lines.has("db1-bak"));

  // where the line leaves the frame, the border is 30 px from the shapes
  const frame = absolute(b, "data");
  const from = lines.get("data-bak").points[0];
  const members = ["db1", "db2", "db3"].map(function(id) { return absolute(b, id); });

  assert.ok(Math.abs(from.x - frame.x - frame.w) < 1 || Math.abs(from.y - frame.y - frame.h) < 1, "it starts on the border: " + JSON.stringify(from));

  for (const m of members)
  {
    const dx = Math.max(m.x - from.x, from.x - m.x - m.w, 0);
    const dy = Math.max(m.y - from.y, from.y - m.y - m.h, 0);

    assert.ok(dx + dy >= 28, "clear of the members: " + JSON.stringify(from) + " and " + JSON.stringify(m));
  }

  // the same connection with several groups is about the groups
  const logs = JSON.parse(JSON.stringify(HUBS));

  logs.edges = [{ from: "svc", to: "mon", label: "logs" }, { from: "data", to: "mon", label: "logs" }];

  const l = linesOf((await semanticToXml(logs, { hints: "ask" })).xml);

  assert.deepEqual(Array.from(l.keys()).sort(), ["data-mon", "svc-mon"]);

  // and a connection the description writes per member is not drawn twice
  const both = JSON.parse(JSON.stringify(HUBS));

  both.edges = [{ from: "gw", to: "svc", label: "routes" }, { from: "gw", to: "b", label: "admin" }];

  const t = linesOf((await semanticToXml(both, { hints: "ask" })).xml);

  assert.deepEqual(Array.from(t.keys()).sort(), ["gw-a", "gw-b", "gw-c", "gw-e"]);
});

test("a labeled line to the frame beside its shape has room for the label before the border", async function()
{
  const block = function(label)
  {
    return { type: "architecture", groups: [{ id: "svc", label: "Services" }],
      nodes: [{ id: "bus", label: "Bus", kind: "queue", row: 1, col: 1 },
        { id: "a", label: "Alpha", group: "svc", row: 1, col: 2 }, { id: "b", label: "Beta", group: "svc", row: 1, col: 3 },
        { id: "c", label: "Gamma", group: "svc", row: 2, col: 2 }, { id: "e", label: "Delta", group: "svc", row: 2, col: 3 }],
      edges: [{ from: "svc", to: "bus", label: label }] };
  };
  const gap = async function(label)
  {
    const r = await semanticToXml(block(label), { hints: "ask" });
    const b = boxesOf(r.xml);
    const lines = linesOf(r.xml);

    assert.ok(lines.has("svc-bus"), "one line to the frame of a group in two rows");
    assert.deepEqual(lineFaults(r.xml), []);

    return absolute(b, "svc").x - absolute(b, "bus").x - absolute(b, "bus").w;
  };
  const plain = await gap("");
  const labeled = await gap("publish and consume");

  // 12 px text of 19 characters is about 110 px wide
  assert.ok(labeled >= 120 && labeled > plain + 40, "between the bus and the border: " + labeled + " after " + plain);
});

test("three or more lines of one kind and label from one shape are a tree with the label once", async function()
{
  const d = grid(3, 2, [{ from: "b1", to: "a2", label: "reads" }, { from: "b1", to: "b2", label: "reads" }, { from: "b1", to: "c2", label: "reads" }]);
  const r = await semanticToXml(d, { hints: "ask" });

  assert.equal(r.xml.match(/value="reads"/g).length, 1);
  assert.deepEqual(lineFaults(r.xml, [["b1-a2", "b1-b2", "b1-c2"]]), []);

  // two are two lines, each with its label; so are three with labels of their own
  d.edges.pop();
  assert.equal((await semanticToXml(d, { hints: "ask" })).xml.match(/value="reads"/g).length, 2);

  d.edges = [{ from: "b1", to: "a2", label: "reads" }, { from: "b1", to: "b2", label: "writes" }, { from: "b1", to: "c2", label: "locks" }];

  const own = await semanticToXml(d, { hints: "ask" });

  assert.deepEqual(lineFaults(own.xml), []);

  // a flowchart has no bundles: every transition is a line of its own
  const flow = grid(3, 2, [{ from: "b1", to: "a2" }, { from: "b1", to: "b2" }, { from: "b1", to: "c2" }]);

  flow.type = "flowchart";
  assert.deepEqual(lineFaults((await semanticToXml(flow, { hints: "ask" })).xml), []);
});

test("a connection between a group and something inside it is a note under the diagram", async function()
{
  for (const title of ["", "Shop"])
  {
    const d = JSON.parse(JSON.stringify(PAGE));

    d.title = title;
    d.edges.push({ from: "vpc", to: "db", label: "logs" }, { from: "app", to: "priv" });

    const r = await semanticToXml(d, { hints: "ask" });
    const b = boxesOf(r.xml);
    const lines = linesOf(r.xml);

    assert.ok(!r.error, r.error);
    assert.equal(r.stats.grid, "page");
    assert.ok(!lines.has("vpc-db") && !lines.has("app-priv"), "no line from a frame into itself");
    assert.equal(lines.size, PAGE.edges.length);
    assert.match(r.xml, /value="logs: everything in VPC → Orders&lt;br&gt;App → everything in Private subnet"/);
    assert.doesNotMatch(r.xml, /note=1/, "the key is for the layout alone");

    for (const id of b.keys())
    {
      if (id !== "notes")
      {
        assert.ok(absolute(b, id).y + absolute(b, id).h <= b.get("notes").y, "the note is below " + id);
      }
    }
  }
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

  // asked for: a cell per node in one grid, none for groups
  const asked = describeSchema(SUPPORTED_TYPES, { hints: "ask" });

  assert.match(asked.properties.nodes.items.properties.row.description, /one grid for the whole diagram/);
  assert.ok(asked.properties.nodes.items.properties.col != null);
  assert.equal(asked.properties.groups.items.properties.row, undefined);
  assert.ok(schema.properties.groups.items.properties.row != null);
  assert.match(describeTool(SUPPORTED_TYPES, { hints: "ask" }), /one grid for the whole diagram/);
  assert.equal(describeSchema(["er"]).properties.groups, undefined);

  // large diagrams: six columns and more rows, nothing left out, a group for all its members
  assert.match(describeTool(SUPPORTED_TYPES, { hints: "ask" }), /at most 6 cols, a large diagram grows down, to 8 rows/);
  assert.match(describeTool(SUPPORTED_TYPES, { hints: "ask" }), /leave nothing out/);
  assert.match(describeTool(SUPPORTED_TYPES, { hints: "ask" }), /An edge to a group means all its members/);
  assert.match(asked.properties.nodes.items.properties.row.description, /Up to 8 rows are shown whole/);
  assert.match(asked.properties.nodes.items.properties.col.description, /At most 6/);
  assert.match(asked.properties.nodes.description, /none merged and none left out/);
  assert.match(asked.properties.edges.description, /Every connection the request names/);
  assert.match(asked.properties.edges.items.properties.to.description, /a group stands for all its members/);
  assert.equal(describeSchema(["er"]).properties.nodes.description, undefined);
  assert.doesNotMatch(describeSchema(["er"]).properties.edges.items.properties.to.description, /group/);
});
