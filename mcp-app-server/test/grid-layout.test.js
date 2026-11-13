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

  // but not when the chat would cut the columns off at the bottom
  const tall = await semanticToXml(steps(14), { hints: "ask" });

  assert.match(boxesOf(tall.xml).get("a").style, /horizontal=0/, "fourteen steps stay in rows");

  // lanes that share rows and columns can't be bands
  const mixed = JSON.parse(JSON.stringify(PAGE_LANES));

  Object.assign(mixed.nodes.find(function(n) { return n.id === "e"; }), { row: 3, col: 4 });
  assert.equal((await semanticToXml(mixed, { hints: "ask" })).stats.grid, "group");
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
});
