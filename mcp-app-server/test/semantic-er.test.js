import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { semanticToXml, SUPPORTED_TYPES } from "../../shared/semantic/index.js";
import { normalizeSpec } from "../../shared/semantic/spec.js";
import { parseField, countCrossings, countOverlaps } from "../../shared/semantic/er.js";
import { describeTool } from "../../shared/semantic/description.js";
import { textWidth } from "../../shared/semantic/text-width.js";
import { normalizeDiagram } from "../../shared/normalize-model.js";
import { snapWaypoints } from "../../shared/edge-waypoints.js";
import { repairDiagramXml } from "../../shared/repair-xml.js";
import { expandDiagramShorthand } from "../../shared/diagram-shorthand.js";

// The semantic engine (shared/semantic): the model describes a diagram's
// content and the engine lays it out. These tests cover the ER type: reading
// the description leniently, finding the rows a relation connects, and a
// layout that is deterministic, well-formed and free of crossings where none
// are needed. The ELK path for large schemas runs when elkjs can be resolved
// (bench/package.json has it; NODE_PATH works too) and is skipped otherwise.

const LIBRARY =
{
  type: "er",
  title: "Library",
  nodes:
  [
    { id: "authors", label: "Authors", fields: ["PK author_id", "name", "born"] },
    { id: "books", label: "Books", fields: ["PK book_id", "FK author_id", "FK publisher_id", "title", "year"] },
    { id: "publishers", label: "Publishers", fields: ["PK publisher_id", "name"] },
    { id: "members", label: "Members", fields: ["PK member_id", "name", "email"] },
    { id: "loans", label: "Loans", fields: ["PK loan_id", "FK book_id", "FK member_id", "loaned_on", "due_on"] }
  ],
  edges:
  [
    { from: "authors", to: "books", kind: "one-to-many" },
    { from: "publishers", to: "books", kind: "one-to-many" },
    { from: "books", to: "loans", kind: "one-to-many" },
    { from: "members", to: "loans", kind: "one-to-many" }
  ]
};

function cellsOf(xml)
{
  const cells = [];
  const re = /<mxCell ([^>]*?)\/?>/g;
  let m;

  while ((m = re.exec(xml)) != null)
  {
    const attrs = {};
    const ar = /(\w+)="([^"]*)"/g;
    let a;

    while ((a = ar.exec(m[1])) != null)
    {
      attrs[a[1]] = a[2];
    }

    cells.push(attrs);
  }

  return cells;
}

function edgesOf(xml)
{
  return cellsOf(xml).filter(function(c) { return c.edge === "1"; });
}

function styleValue(style, key)
{
  const m = new RegExp("(?:^|;)" + key + "=([^;]*)").exec(style);

  return m ? m[1] : null;
}

function tryElk()
{
  try
  {
    const require = createRequire(new URL("../../bench/package.json", import.meta.url));
    const ELK = require("elkjs/lib/elk.bundled.js");

    return new ELK();
  }
  catch (e)
  {
    return null;
  }
}

test("only the types with a layout are offered", function()
{
  assert.deepEqual(SUPPORTED_TYPES, ["er"]);
});

test("parseField reads keys in front, behind and in parentheses", function()
{
  assert.deepEqual(parseField("PK book_id"), { text: "PK book_id", name: "book_id", pk: true, fk: false, ref: "" });
  assert.equal(parseField("PK, FK book_id").pk, true);
  assert.equal(parseField("PK, FK book_id").fk, true);
  assert.equal(parseField("PK, FK book_id").name, "book_id");
  assert.equal(parseField("book_id INT PK").pk, true);
  assert.equal(parseField("book_id INT PK").name, "book_id");
  assert.equal(parseField("FK author_id -> authors").ref, "authors");
  assert.equal(parseField("FK author_id -> authors").name, "author_id");
  assert.equal(parseField("price: decimal").name, "price");
  assert.equal(parseField("price: decimal").pk, false);
});

test("normalizeSpec forgives common slips and says what it dropped", function()
{
  const n = normalizeSpec(JSON.stringify({
    type: "ERD",
    nodes: [
      { id: "a", label: "A", fields: "PK a_id|name" },
      { id: "b", label: "B", fields: "PK b_id\nFK a_id" },
      { id: "b", label: "B again" }
    ],
    edges: [
      { source: "a", target: "b", kind: "One To Many" },
      { from: "a", to: "nowhere" }
    ],
    colour: "red"
  }));

  assert.equal(n.error, null);
  assert.equal(n.diagram.type, "er");
  assert.deepEqual(n.diagram.nodes.map(function(x) { return x.id; }), ["a", "b"]);
  assert.deepEqual(n.diagram.nodes[0].fields, ["PK a_id", "name"]);
  assert.deepEqual(n.diagram.nodes[1].fields, ["PK b_id", "FK a_id"]);
  assert.equal(n.diagram.edges.length, 1);
  assert.equal(n.diagram.edges[0].from, "a");
  assert.equal(n.diagram.edges[0].kind, "one-to-many");
  assert.equal(n.warnings.length, 3, n.warnings.join("\n"));
});

test("nodes and edges as JSON text are read as JSON, and JSON cut off while it streams as nothing yet", function()
{
  const nodes = JSON.stringify(LIBRARY.nodes);
  const n = normalizeSpec({ type: "er", nodes: nodes, edges: JSON.stringify(LIBRARY.edges) });

  assert.equal(n.error, null);
  assert.deepEqual(n.diagram.nodes.map(function(x) { return x.id; }), ["authors", "books", "publishers", "members", "loans"]);
  assert.equal(n.diagram.edges.length, 4);
  assert.deepEqual(n.warnings, []);

  // the viewer's preview gets the text as it streams in
  for (const cut of [1, 2, 20, nodes.length - 1])
  {
    assert.deepEqual(normalizeSpec({ type: "er", nodes: nodes.slice(0, cut) }).diagram.nodes, [], nodes.slice(0, cut));
  }

  // one object, and rows that only start with a bracket
  assert.deepEqual(normalizeSpec({ type: "er", nodes: JSON.stringify({ id: "a" }) }).diagram.nodes.map(function(x) { return x.id; }), ["a"]);
  assert.deepEqual(normalizeSpec({ type: "er", nodes: [{ id: "a", fields: "[legacy] id|name" }] }).diagram.nodes[0].fields,
    ["[legacy] id", "name"]);
});

test("an unsupported type, no nodes or no JSON fail with a message the model can act on", async function()
{
  const flow = await semanticToXml({ type: "flowchart", nodes: [{ id: "a" }] });
  assert.equal(flow.xml, null);
  assert.match(flow.error, /XML or Mermaid/);

  const empty = await semanticToXml({ type: "er", nodes: [] });
  assert.equal(empty.xml, null);
  assert.match(empty.error, /no nodes/);

  const broken = await semanticToXml("{ type: er");
  assert.equal(broken.xml, null);
  assert.ok(broken.error);
});

test("relations connect the foreign-key row to the primary-key row, with crow's feet", async function()
{
  const r = await semanticToXml(LIBRARY);
  const edges = edgesOf(r.xml);

  assert.equal(r.error, null);
  assert.equal(edges.length, 4);

  const byId = Object.fromEntries(edges.map(function(e) { return [e.id, e]; }));

  assert.equal(byId["books-authors"].source, "authors.author_id");
  assert.equal(byId["books-authors"].target, "books.author_id");
  assert.equal(byId["books-publishers"].target, "books.publisher_id");
  assert.equal(byId["loans-books"].source, "books.book_id");
  assert.equal(byId["loans-books"].target, "loans.book_id");
  assert.equal(byId["loans-members"].target, "loans.member_id");

  for (const e of edges)
  {
    assert.equal(styleValue(e.style, "startArrow"), "ERmandOne");
    assert.equal(styleValue(e.style, "endArrow"), "ERmany");
    assert.equal(e.value, undefined, "relations carry no labels");
  }
});

test("a relation given from the child side and explicit cardinalities still find their rows", async function()
{
  const r = await semanticToXml({ type: "er", nodes: [
    { id: "person", label: "Person", fields: ["PK id", "name"] },
    { id: "passport", label: "Passport", fields: ["PK id", "FK owner (person)", "number"] }],
  edges: [{ from: "passport", to: "person", fromCard: "0..1", toCard: "1", toField: "id", fromField: "owner" }] });
  const e = edgesOf(r.xml)[0];

  assert.equal(e.source, "person.id");
  assert.equal(e.target, "passport.owner");
  assert.equal(styleValue(e.style, "startArrow"), "ERmandOne");
  assert.equal(styleValue(e.style, "endArrow"), "ERzeroToOne");
});

test("multiplicities are read from numbers, words and the kind", async function()
{
  const tables = [
    { id: "a", label: "A", fields: ["PK a_id"] },
    { id: "b", label: "B", fields: ["PK b_id", "FK a_id"] }];
  const markers = async function(edge)
  {
    const r = await semanticToXml({ type: "er", nodes: tables, edges: [Object.assign({ from: "a", to: "b" }, edge)] });
    const e = edgesOf(r.xml)[0];

    return [e.source, styleValue(e.style, "startArrow"), styleValue(e.style, "endArrow")].join(" ");
  };

  assert.equal(await markers({ kind: "one-to-many" }), "a.a_id ERmandOne ERmany");
  assert.equal(await markers({ fromCard: "one", toCard: "zero or more" }), "a.a_id ERmandOne ERzeroToMany");
  assert.equal(await markers({ fromCard: "zero or one", toCard: "1..*" }), "a.a_id ERzeroToOne ERoneToMany");
  assert.equal(await markers({}), "a.a_id ERmandOne ERmany");

  const back = await semanticToXml({ type: "er", nodes: tables, edges: [{ from: "b", to: "a", kind: "many-to-one" }] });
  assert.equal(edgesOf(back.xml)[0].source, "a.a_id");
});

test("two references to one table use two different rows", async function()
{
  const r = await semanticToXml({ type: "er", nodes: [
    { id: "users", label: "Users", fields: ["PK user_id", "name"] },
    { id: "messages", label: "Messages", fields: ["PK message_id", "FK sender_id", "FK recipient_id", "body"] }],
  edges: [
    { from: "users", to: "messages", kind: "one-to-many", toField: "sender_id" },
    { from: "users", to: "messages", kind: "one-to-many", toField: "recipient_id" }] });
  const targets = edgesOf(r.xml).map(function(e) { return e.target; }).sort();

  assert.deepEqual(targets, ["messages.recipient_id", "messages.sender_id"]);
  assert.equal(new Set(edgesOf(r.xml).map(function(e) { return e.id; })).size, 2, "edge ids are unique");
});

test("relations that end on one key row get their own points on it", async function()
{
  const r = await semanticToXml(LIBRARY);
  const edges = edgesOf(r.xml);
  const atBookKey = edges.filter(function(e) { return e.source === "books.book_id"; });
  const dys = atBookKey.map(function(e) { return styleValue(e.style, "exitDy") + "/" + styleValue(e.style, "exitX"); });

  assert.ok(atBookKey.length >= 1);
  assert.equal(new Set(dys).size, dys.length, "distinct points: " + dys.join(", "));

  const star = { type: "er", nodes: [{ id: "users", label: "Users", fields: ["PK user_id", "name"] }], edges: [] };

  for (const name of ["posts", "comments", "likes"])
  {
    star.nodes.push({ id: name, label: name, fields: ["PK " + name + "_id", "FK user_id"] });
    star.edges.push({ from: "users", to: name, kind: "one-to-many" });
  }

  const s = await semanticToXml(star);
  const points = edgesOf(s.xml).map(function(e)
  {
    return styleValue(e.style, "exitX") + "/" + styleValue(e.style, "exitDy");
  });

  assert.equal(new Set(points).size, points.length, "distinct points: " + points.join(", "));
  assert.equal(s.stats.overlaps, 0);
});

test("a reference to its own table runs from the key to the other row", async function()
{
  const r = await semanticToXml({ type: "er", nodes: [
    { id: "categories", label: "Categories", fields: ["PK category_id", "FK parent_category_id", "name"] }],
  edges: [{ from: "categories", to: "categories", kind: "one-to-many" }] });
  const e = edgesOf(r.xml)[0];

  assert.equal(e.source, "categories.category_id");
  assert.equal(e.target, "categories.parent_category_id");
});

test("a junction table is drawn in the data color", async function()
{
  const r = await semanticToXml({ type: "er", nodes: [
    { id: "students", label: "Students", fields: ["PK student_id", "name"] },
    { id: "courses", label: "Courses", fields: ["PK course_id", "title"] },
    { id: "enrollments", label: "Enrollments", fields: ["PK, FK student_id", "PK, FK course_id"] }],
  edges: [
    { from: "students", to: "enrollments", kind: "one-to-many" },
    { from: "courses", to: "enrollments", kind: "one-to-many" }] });
  const cells = cellsOf(r.xml);
  const fill = function(id) { return styleValue(cells.find(function(c) { return c.id === id; }).style, "fillColor"); };

  assert.equal(fill("enrollments"), "#F3EEFF");
  assert.equal(fill("students"), "#EEF4FF");
});

test("every role of the theme colors a table, also those the XML shorthand doesn't know", async function()
{
  const roles = { note: "#FFF9DB", retry: "#FFF0E5", success: "#E7F6EC", error: "#FDECEC", unknown: "#EEF4FF" };
  const r = await semanticToXml({ type: "er", nodes: Object.keys(roles).map(function(role)
  {
    return { id: role, fields: ["PK " + role + "_id"], role: role };
  }) });
  const cells = cellsOf(r.xml);

  for (const role of Object.keys(roles))
  {
    const style = cells.find(function(c) { return c.id === role; }).style;

    assert.equal(styleValue(style, "fillColor"), roles[role], role);
    assert.doesNotMatch(style, /(^|;)role=/);
  }
});

test("the layout is deterministic and the server's repairs find nothing to change", async function()
{
  const a = await semanticToXml(LIBRARY);
  const b = await semanticToXml(JSON.parse(JSON.stringify(LIBRARY)));

  assert.equal(a.xml, b.xml);

  const ids = cellsOf(a.xml).map(function(c) { return c.id; });

  assert.equal(new Set(ids).size, ids.length, "cell ids are unique");
  assert.doesNotMatch(a.xml, /<!--/);
  assert.equal(repairDiagramXml(a.xml).xml, a.xml);
  assert.doesNotMatch(a.xml, /\srows="/, "the table shorthand is expanded");
  assert.equal(expandDiagramShorthand(a.xml).xml, a.xml);
  assert.equal(normalizeDiagram(a.xml).xml, a.xml);
  assert.equal(snapWaypoints(a.xml).xml, a.xml);
});

test("all tables share one width, rows are one height, and nothing overlaps", async function()
{
  const r = await semanticToXml(LIBRARY);
  const boxes = [];
  const re = /<mxCell id="([^"]+)"[^>]*style="swimlane;[^>]*><mxGeometry x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g;
  let m;

  while ((m = re.exec(r.xml)) != null)
  {
    boxes.push({ id: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] });
  }

  assert.equal(boxes.length, 5);
  assert.equal(new Set(boxes.map(function(b) { return b.w; })).size, 1);

  for (let i = 0; i < boxes.length; i++)
  {
    for (let j = i + 1; j < boxes.length; j++)
    {
      const p = boxes[i];
      const q = boxes[j];
      const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
      assert.ok(apart, p.id + " overlaps " + q.id);
    }
  }

  assert.ok(r.stats.width <= 800 && r.stats.height <= 800, "fits the chat frame: " + r.stats.width + "x" + r.stats.height);
});

test("tables are drawn as the table shorthand expands them, primary keys bold", async function()
{
  const r = await semanticToXml(LIBRARY);
  const cells = cellsOf(r.xml);
  const byId = new Map(cells.map(function(c) { return [c.id, c]; }));
  const books = byId.get("books");
  const pk = byId.get("books.book_id");
  const fk = byId.get("books.author_id");

  assert.match(books.style, /^swimlane;fontStyle=1;childLayout=stackLayout;/);
  assert.equal(styleValue(books.style, "startSize"), "26");
  assert.equal(pk.value, "&lt;b&gt;PK book_id&lt;/b&gt;");
  assert.equal(fk.value, "FK author_id");
  assert.equal(pk.parent, "books");
});

test("a relation between tables side by side in one row is a straight line", async function()
{
  // the key is the first row of authors, the reference the third of books:
  // books moves up against authors so that the two rows meet
  const pair = { type: "er", nodes: [
    { id: "authors", label: "Authors", fields: ["PK author_id", "name"] },
    { id: "books", label: "Books", fields: ["PK book_id", "title", "FK author_id"] }],
  edges: [{ from: "authors", to: "books", kind: "one-to-many" }] };
  const r = await semanticToXml(pair);
  const edge = edgesOf(r.xml)[0];

  assert.equal(r.stats.bends, 0);
  assert.doesNotMatch(r.xml, /<Array as="points">/);
  assert.equal(edge.source, "authors.author_id");
  assert.equal(edge.target, "books.author_id");

  const top = {};
  const re = /<mxCell id="(authors|books)"[^>]*><mxGeometry x="[\d.]+" y="([\d.]+)"/g;
  let m;

  while ((m = re.exec(r.xml)) != null)
  {
    top[m[1]] = +m[2];
  }

  assert.equal(top.authors - top.books, 2 * 26, "the key row and the reference row are at one height");
});

test("a chain and a star of tables are drawn without crossings or lines on each other", async function()
{
  const chain = await semanticToXml(LIBRARY);
  assert.equal(chain.stats.crossings, 0);
  assert.equal(chain.stats.overlaps, 0);

  const star = { type: "er", nodes: [{ id: "orders", label: "Orders",
    fields: ["PK order_id", "FK customer_id", "FK shop_id", "FK courier_id", "FK coupon_id"] }], edges: [] };

  for (const name of ["customer", "shop", "courier", "coupon"])
  {
    star.nodes.push({ id: name + "s", label: name, fields: ["PK " + name + "_id", "name"] });
    star.edges.push({ from: name + "s", to: "orders", kind: "one-to-many" });
  }

  const r = await semanticToXml(star);
  assert.equal(r.stats.crossings, 0);
  assert.equal(r.stats.overlaps, 0);
});

test("crossings and collinear overlaps are counted between routes", function()
{
  const h = [{ x: 0, y: 50 }, { x: 100, y: 50 }];
  const v = [{ x: 50, y: 0 }, { x: 50, y: 100 }];
  const h2 = [{ x: 40, y: 50 }, { x: 140, y: 50 }];
  // two relations leaving one row fan out from it: not an overlap
  const fanA = [{ x: 0, y: 50 }, { x: 30, y: 50 }, { x: 30, y: 0 }];
  const fanB = [{ x: 0, y: 50 }, { x: 30, y: 50 }, { x: 30, y: 100 }];

  assert.equal(countCrossings([h, v]), 1);
  assert.equal(countOverlaps([h, h2]), 1);
  assert.equal(countOverlaps([h, v]), 0);
  assert.equal(countOverlaps([fanA, fanB]), 0);
});

test("text widths follow Helvetica", function()
{
  assert.equal(Math.round(textWidth("Hello", 14, false)), 32);
  assert.ok(textWidth("WWW", 14, false) > textWidth("iii", 14, false));
  assert.ok(textWidth("Title", 14, true) > textWidth("Title", 14, false));
});

test("the tool description stays within the limit", function()
{
  assert.ok(describeTool(SUPPORTED_TYPES).length <= 2048);
  assert.match(describeTool(["er"]), /type "er"/);
});

test("a schema over 16 tables is laid out by ELK when it is available", { skip: tryElk() == null && "elkjs not installed" }, async function()
{
  const nodes = [{ id: "hub", label: "Hub", fields: ["PK hub_id", "name"] }];
  const edges = [];

  for (let i = 1; i <= 18; i++)
  {
    nodes.push({ id: "t" + i, label: "Table " + i, fields: ["PK t" + i + "_id", "FK hub_id", "value"] });
    edges.push({ from: "hub", to: "t" + i, kind: "one-to-many" });
  }

  const r = await semanticToXml({ type: "er", nodes: nodes, edges: edges }, { elk: tryElk() });

  assert.equal(r.error, null);
  assert.equal(r.stats.layout, "elk");
  assert.equal(edgesOf(r.xml).length, 18);

  const grid = await semanticToXml({ type: "er", nodes: nodes, edges: edges });
  assert.equal(grid.stats.layout, "grid");
});

test("a large schema without ELK stays on the grid and takes bounded time", async function()
{
  // a tree of 60 tables with a second reference in most: without a limit,
  // the routed search tried every swap of every round (24 tables took 6 s)
  const nodes = [];
  const edges = [];

  for (let i = 0; i < 60; i++)
  {
    const parent = Math.floor((i - 1) / 2);
    const other = (i * 7) % Math.max(1, i);
    const fields = ["PK t" + i + "_id", "name"];

    if (i > 0)
    {
      fields.push("FK t" + parent + "_id");
      edges.push({ from: "t" + parent, to: "t" + i, kind: "one-to-many" });
    }

    if (i > 3 && other !== parent)
    {
      fields.push("FK t" + other + "_id");
      edges.push({ from: "t" + other, to: "t" + i, kind: "one-to-many" });
    }

    nodes.push({ id: "t" + i, label: "Table " + i, fields: fields });
  }

  const t0 = Date.now();
  const r = await semanticToXml({ type: "er", nodes: nodes, edges: edges });

  assert.equal(r.error, null);
  assert.equal(r.stats.layout, "grid");
  assert.equal(edgesOf(r.xml).length, edges.length);
  assert.ok(Date.now() - t0 < 10000, "took " + (Date.now() - t0) + " ms");
});
