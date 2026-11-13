import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, buildHtml } from "../src/shared.js";
import { expandDiagramShorthand, roleStyle, rowIds, ROLES } from "../../shared/diagram-shorthand.js";

// Table rows (rows="PK id|FK book_id|…") and role styles (role=step, …) are
// expanded into plain draw.io cells and styles by the server and, from the raw
// tool input, by the viewer (shared/diagram-shorthand.js).

function model(cells)
{
  return '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' + cells + "</root></mxGraphModel>";
}

function vertex(id, attrs, geometry)
{
  return '<mxCell id="' + id + '" ' + attrs + ' vertex="1" parent="1"><mxGeometry ' +
    (geometry || 'x="40" y="40"') + ' as="geometry"/></mxCell>';
}

function cell(xml, id)
{
  const m = xml.match(new RegExp('<mxCell id="' + id.replace(/\./g, "\\.") + '"[^>]*>(?:[\\s\\S]*?</mxCell>)?'));

  return (m != null) ? m[0] : null;
}

function attr(tag, name)
{
  const m = (tag || "").match(new RegExp("\\s" + name + '="([^"]*)"'));

  return (m != null) ? m[1] : null;
}

function geometry(tag)
{
  const m = (tag || "").match(/<mxGeometry\b([^>]*)\/>/);
  const g = {};

  for (const k of ["x", "y", "width", "height"])
  {
    const v = attr(m && m[0], k);

    g[k] = (v != null) ? Number(v) : undefined;
  }

  return g;
}

function styleKeys(style)
{
  const keys = {};

  for (const part of (style || "").split(";"))
  {
    const eq = part.indexOf("=");

    if (eq > 0)
    {
      keys[part.substring(0, eq)] = part.substring(eq + 1);
    }
  }

  return keys;
}

// ─── Unchanged diagrams ─────────────────────────────────────────

test("a diagram without rows or roles comes back byte-identical", function()
{
  const xml = model(vertex("a", 'value="A" style="rounded=1;whiteSpace=wrap;html=1;"', 'x="40" y="40" width="140" height="60"'));
  const result = expandDiagramShorthand(xml);

  assert.equal(result.xml, xml);
  assert.equal(result.changed, 0);
});

test("words in labels are not shorthand", function()
{
  const xml = model(vertex("a", 'value="role=step rows=&quot;x&quot;" style="html=1;"', 'x="0" y="0" width="140" height="60"'));

  assert.equal(expandDiagramShorthand(xml).xml, xml);
});

test("non-strings pass through", function()
{
  assert.equal(expandDiagramShorthand(null).xml, null);
  assert.equal(expandDiagramShorthand(undefined).changed, 0);
});

// ─── Table rows ─────────────────────────────────────────────────

test("an ER table becomes a list table with one row cell per column", function()
{
  const xml = expandDiagramShorthand(model(vertex("book", 'value="Book" rows="PK id|title|FK author_id"'))).xml;
  const table = cell(xml, "book");
  const style = styleKeys(attr(table, "style"));

  assert.ok(attr(table, "style").startsWith("swimlane;"), attr(table, "style"));
  assert.equal(style.childLayout, "stackLayout");
  assert.equal(style.horizontalStack, "0");
  assert.equal(style.startSize, "26");
  assert.equal(style.fillColor, "#EEF4FF");
  assert.equal(style.fontSize, "14");
  assert.equal(attr(table, "rows"), null);
  assert.deepEqual(geometry(table), { x: 40, y: 40, width: 200, height: 26 + 3 * 26 });

  const rows = [["book.id", "PK id"], ["book.title", "title"], ["book.author_id", "FK author_id"]];

  rows.forEach(function(row, i)
  {
    const tag = cell(xml, row[0]);

    assert.ok(tag, row[0] + " missing in " + xml);
    assert.equal(attr(tag, "value"), row[1]);
    assert.equal(attr(tag, "parent"), "book");
    assert.equal(attr(tag, "vertex"), "1");
    assert.ok(attr(tag, "style").startsWith("text;"));
    assert.equal(styleKeys(attr(tag, "style")).fontSize, "14");
    assert.deepEqual(geometry(tag), { x: undefined, y: 26 + i * 26, width: 200, height: 26 });
  });

  // The rows follow their table, in order
  assert.ok(xml.indexOf('id="book"') < xml.indexOf('id="book.id"'));
  assert.ok(xml.indexOf('id="book.id"') < xml.indexOf('id="book.title"'));
});

test("a class gets a separator line between attributes and methods", function()
{
  const xml = expandDiagramShorthand(model(vertex("ord", 'value="Order" rows="- id: int|- total: Decimal|---|+ total(): Decimal" style="fontStyle=3;"', 'x="0" y="0" width="240"'))).xml;
  const table = cell(xml, "ord");
  const separator = cell(xml, "ord.sep");

  assert.equal(styleKeys(attr(table, "style")).fontStyle, "3");
  assert.ok(attr(separator, "style").startsWith("line;"));
  assert.equal(attr(separator, "value"), "");
  assert.equal(styleKeys(attr(separator, "style")).strokeColor, "#9DB8F2");
  assert.deepEqual(geometry(separator), { x: undefined, y: 78, width: 240, height: 8 });
  assert.deepEqual(geometry(cell(xml, "ord.total.2")), { x: undefined, y: 86, width: 240, height: 26 });
  assert.equal(geometry(table).height, 26 + 26 + 26 + 8 + 26);
  assert.equal(attr(cell(xml, "ord.total.2"), "value"), "+ total(): Decimal");
});

test("row ids skip key markers and visibility, and number repeats and nameless rows", function()
{
  assert.deepEqual(rowIds("t", "PK id|PK, FK book_id|PK/FK member_id|fk_x INT|# count: int|~ pkg|UK email|id|…|🔑 isbn"),
    ["t.id", "t.book_id", "t.member_id", "t.fk_x", "t.count", "t.pkg", "t.email", "t.id.2", "t.9", "t.isbn"]);
  assert.deepEqual(rowIds("t", "&lt;b&gt;PK id&lt;/b&gt;|Größe|名前"), ["t.id", "t.Größe", "t.名前"]);
});

test("a row id that is taken by another cell gets a number", function()
{
  const xml = expandDiagramShorthand(model(vertex("t", 'value="T" rows="id|name"') +
    vertex("t.id", 'value="note" style="text;html=1;"', 'x="400" y="0" width="80" height="20"'))).xml;

  assert.equal(attr(cell(xml, "t.id.2"), "value"), "id");
  assert.equal(attr(cell(xml, "t.id"), "value"), "note");
});

test("an escaped | stays in its row, and empty rows are dropped", function()
{
  const xml = expandDiagramShorthand(model(vertex("t", 'value="T" rows="kind: a \\| b|code: c &#124; d||"'))).xml;

  assert.equal(attr(cell(xml, "t.kind"), "value"), "kind: a | b");
  assert.equal(attr(cell(xml, "t.code"), "value"), "code: c &#124; d");
  assert.equal(geometry(cell(xml, "t")).height, 26 * 3);
});

test("the table is wide enough for its longest row unless the width is given", function()
{
  const longRow = "+ calculateShippingCost(address: Address): Decimal";
  const wide = expandDiagramShorthand(model(vertex("t", 'value="T" rows="id|' + longRow + '"'))).xml;
  const given = expandDiagramShorthand(model(vertex("t", 'value="T" rows="id|' + longRow + '"', 'x="0" y="0" width="200" height="40"'))).xml;

  assert.ok(geometry(cell(wide, "t")).width >= Math.ceil(longRow.length * 14 * 0.6), String(geometry(cell(wide, "t")).width));
  assert.equal(geometry(cell(wide, "t." + "calculateShippingCost")).width, geometry(cell(wide, "t")).width);
  assert.equal(geometry(cell(given, "t")).width, 200);
  assert.equal(geometry(cell(given, "t")).height, 26 * 3);
});

test("rows take the table's font and color, and a larger font makes taller rows", function()
{
  const xml = expandDiagramShorthand(model(vertex("t", 'value="T" rows="id|name" style="fontSize=20;fontColor=#F1F5F9;fontFamily=Inter;"'))).xml;
  const row = styleKeys(attr(cell(xml, "t.name"), "style"));

  assert.equal(row.fontSize, "20");
  assert.equal(row.fontColor, "#F1F5F9");
  assert.equal(row.fontFamily, "Inter");
  assert.equal(geometry(cell(xml, "t.name")).height, 30);
  assert.equal(styleKeys(attr(cell(xml, "t"), "style")).startSize, "30");
});

test("the table's own style wins, its startSize included", function()
{
  const own = "swimlane;fontStyle=0;startSize=40;fillColor=#FFFFFF;collapsible=1;html=1;";
  const xml = expandDiagramShorthand(model(vertex("t", 'value="T" rows="id" style="' + own + '"'))).xml;
  const style = styleKeys(attr(cell(xml, "t"), "style"));

  assert.equal(style.fontStyle, "0");
  assert.equal(style.startSize, "40");
  assert.equal(style.fillColor, "#FFFFFF");
  assert.equal(style.collapsible, "1");
  assert.equal(attr(cell(xml, "t"), "style").split(";").filter(function(p) { return p === "swimlane"; }).length, 1);
  assert.equal(geometry(cell(xml, "t.id")).y, 40);
  assert.equal(geometry(cell(xml, "t")).height, 66);
});

test("a role on a table brings its colors, not its shape", function()
{
  const xml = expandDiagramShorthand(model(vertex("t", 'value="T" rows="id" style="role=data;"'))).xml;
  const style = attr(cell(xml, "t"), "style");

  assert.ok(style.startsWith("swimlane;"), style);
  assert.equal(styleKeys(style).fillColor, "#F3EEFF");
  assert.equal(styleKeys(style).strokeColor, "#B9A6F0");
  assert.equal(styleKeys(style).shape, undefined);
  assert.equal(styleKeys(style).role, undefined);
});

test("edges that name a row by position or in another case are pointed at the row", function()
{
  const xml = expandDiagramShorthand(model(vertex("loan", 'value="Loan" rows="PK id|FK book_id"') +
    vertex("book", 'value="Book" rows="PK id|title"', 'x="400" y="40"') +
    '<mxCell id="e1" style="edgeStyle=entityRelationEdgeStyle;html=1;" edge="1" parent="1" source="loan.2" target="Book.ID"><mxGeometry relative="1" as="geometry"/></mxCell>' +
    '<mxCell id="e2" edge="1" parent="1" source="loan.book_id" target="nowhere.3"><mxGeometry relative="1" as="geometry"/></mxCell>')).xml;

  assert.equal(attr(cell(xml, "e1"), "source"), "loan.book_id");
  assert.equal(attr(cell(xml, "e1"), "target"), "book.id");
  assert.equal(attr(cell(xml, "e2"), "source"), "loan.book_id");
  assert.equal(attr(cell(xml, "e2"), "target"), "nowhere.3");
});

test("a table without a geometry gets one", function()
{
  const xml = expandDiagramShorthand(model('<mxCell id="t" value="T" rows="id|name" vertex="1" parent="1"/>')).xml;

  assert.deepEqual(geometry(cell(xml, "t")), { x: undefined, y: undefined, width: 200, height: 78 });
  assert.ok(cell(xml, "t.name"));
});

test("while a diagram streams in, a table waits for its geometry", function()
{
  // healPartialXml closes a cell cut off before its <mxGeometry>; a made-up
  // geometry would show the table at the top left until its position arrives.
  const cut = model('<mxCell id="t" value="T" rows="id|name" style="role=data;" vertex="1" parent="1"></mxCell>');
  const complete = model(vertex("t", 'value="T" rows="id|name"', 'x="400" y="40"'));
  const closed = model('<mxCell id="t" value="T" rows="id|name" vertex="1" parent="1"/>');

  assert.equal(expandDiagramShorthand(cut, { partial: true }).xml, cut);
  assert.deepEqual(geometry(cell(expandDiagramShorthand(complete, { partial: true }).xml, "t")),
    { x: 400, y: 40, width: 200, height: 78 });
  assert.equal(expandDiagramShorthand(closed, { partial: true }).xml, expandDiagramShorthand(closed).xml);
  assert.ok(cell(expandDiagramShorthand(cut).xml, "t.name"));
});

// ─── Roles ──────────────────────────────────────────────────────

test("every role expands to a calm-theme style with fontSize, html and whiteSpace", function()
{
  const expected =
  {
    step: ["#EEF4FF", "#9DB8F2"], decision: ["#FFF6E0", "#E8C36A"], start: ["#E7F6EC", "#8BCB9F"],
    end: ["#E7F6EC", "#8BCB9F"], error: ["#FDECEC", "#EBA3A3"], data: ["#F3EEFF", "#B9A6F0"],
    external: ["#F2F4F7", "#B8C0CC"], container: ["#F7F8FA", "#D5DAE1"]
  };

  assert.deepEqual(Object.keys(ROLES).sort(), Object.keys(expected).sort());

  for (const role of Object.keys(expected))
  {
    const style = roleStyle(role);
    const keys = styleKeys(style);

    assert.equal(keys.fillColor, expected[role][0], role);
    assert.equal(keys.strokeColor, expected[role][1], role);
    assert.equal(keys.fontSize, "14", role);
    assert.equal(keys.html, "1", role);
    assert.equal(keys.whiteSpace, "wrap", role);
    assert.equal(keys.fontColor, "#1B1F24", role);
  }

  assert.ok(roleStyle("decision").startsWith("rhombus;"));
  assert.ok(roleStyle("container").startsWith("swimlane;"));
  assert.equal(styleKeys(roleStyle("data")).shape, "cylinder3");
  assert.equal(styleKeys(roleStyle("start")).arcSize, "50");
  assert.equal(roleStyle("nope"), null);
});

test("keys written with a role win, in place, without duplicates", function()
{
  const style = roleStyle("step", "role=step;fillColor=#FFF0E5;strokeColor=#F0B48A;fontSize=16;shadow=1;");

  assert.equal(style, "rounded=1;whiteSpace=wrap;html=1;fillColor=#FFF0E5;strokeColor=#F0B48A;fontColor=#1B1F24;fontSize=16;shadow=1;");
});

test("a shape written with a role replaces the role's shape", function()
{
  assert.ok(roleStyle("decision", "ellipse;").startsWith("ellipse;"));
  assert.ok(!/rhombus/.test(roleStyle("decision", "ellipse;")));

  const data = styleKeys(roleStyle("data", "shape=document;"));

  assert.equal(data.shape, "document");
  assert.equal(data.fillColor, "#F3EEFF");
});

test("a role cell gets its style, and its size when none is given", function()
{
  const xml = expandDiagramShorthand(model(
    vertex("s", 'value="Check" style="role=step"') +
    vertex("d", 'value="OK?" style="role=Decision;"', 'x="40" y="160" width="180"') +
    vertex("db", 'value="Orders" style="role=data;"', 'x="40" y="300" width="100" height="70"'))).xml;

  assert.equal(attr(cell(xml, "s"), "style"), ROLES.step.style);
  assert.deepEqual(geometry(cell(xml, "s")), { x: 40, y: 40, width: 140, height: 60 });
  assert.ok(attr(cell(xml, "d"), "style").startsWith("rhombus;"));
  assert.deepEqual(geometry(cell(xml, "d")), { x: 40, y: 160, width: 180, height: 90 });
  assert.deepEqual(geometry(cell(xml, "db")), { x: 40, y: 300, width: 100, height: 70 });
  assert.match(cell(xml, "s"), /<mxGeometry x="40" y="40" width="140" height="60" as="geometry"\/>/);
});

test("a container inside another one is white", function()
{
  const xml = expandDiagramShorthand(model(
    vertex("vpc", 'value="VPC" style="role=container;"', 'x="0" y="0" width="600" height="400"') +
    '<mxCell id="sub" value="Subnet" style="role=container;dashed=1;" vertex="1" parent="vpc"><mxGeometry x="20" y="40" width="300" height="200" as="geometry"/></mxCell>')).xml;

  assert.equal(styleKeys(attr(cell(xml, "vpc"), "style")).fillColor, "#F7F8FA");
  assert.equal(styleKeys(attr(cell(xml, "sub"), "style")).fillColor, "#FFFFFF");
  assert.equal(styleKeys(attr(cell(xml, "sub"), "style")).dashed, "1");
});

test("unknown roles and roles on edges are left as written", function()
{
  const cells = vertex("a", 'value="A" style="role=retry;rounded=1;"', 'x="0" y="0" width="140" height="60"') +
    vertex("b", 'value="B" style="html=1;"', 'x="200" y="0" width="140" height="60"') +
    '<mxCell id="e" style="role=error;html=1;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>';
  const xml = model(cells);

  assert.equal(expandDiagramShorthand(xml).xml, xml);
});

test("a raw > in an attribute value doesn't end the tag", function()
{
  // XML allows a raw > in attribute values, and the repair escapes only <.
  const xml = expandDiagramShorthand(model(
    '<mxCell id="ord" value="Order<br>x > 0" rows="- items: List&lt;Item>|+ add(i: Item): void" vertex="1" parent="1">' +
      '<mxGeometry x="40" y="40" as="geometry"/></mxCell>' +
    '<mxCell id="d" value="Retries > 3?" style="role=decision;" vertex="1" parent="1"><mxGeometry x="400" y="40" as="geometry"/></mxCell>' +
    '<object label="a > b" id="t.o"><mxCell style="role=step;" vertex="1" parent="1"><mxGeometry x="400" y="200" as="geometry"/></mxCell></object>' +
    vertex("t", 'value="T" rows="o|id"', 'x="40" y="300"') +
    '<mxCell id="e" value="x > y" edge="1" parent="1" source="d" target="ord.2"><mxGeometry relative="1" as="geometry"/></mxCell>')).xml;
  const order = xml.match(/<mxCell id="ord" [^]*?<\/mxCell>/)[0];

  assert.doesNotMatch(xml, /\srows="/);
  assert.doesNotMatch(xml, /role=/);
  assert.match(order, /value="Order<br>x > 0"/);
  assert.match(order, /style="swimlane;/);
  assert.match(xml, /<mxCell id="ord\.items" value="- items: List&lt;Item>"/);
  assert.match(xml, /<mxCell id="d" value="Retries > 3\?" style="rhombus;[^"]*" vertex="1" parent="1"><mxGeometry x="400" y="40" width="160" height="90" as="geometry"\/>/);
  assert.match(xml, /<mxCell style="rounded=1;[^"]*" vertex="1" parent="1"><mxGeometry x="400" y="200" width="140" height="60" as="geometry"\/>/);
  assert.match(xml, /<mxCell id="t\.o\.2" value="o"/, "the id of the <object> is taken");
  assert.match(xml, /<mxCell id="e" value="x > y" edge="1" parent="1" source="d" target="ord\.add"/);
});

test("entities in a style survive the rewrite", function()
{
  const xml = expandDiagramShorthand(model(vertex("a", 'value="A" style="role=step;image=https://x.test/a?b=1&amp;c=2;"'))).xml;

  assert.match(attr(cell(xml, "a"), "style"), /image=https:\/\/x\.test\/a\?b=1&amp;c=2;/);
});

// ─── Both, pages, idempotence ───────────────────────────────────

test("expanding again changes nothing", function()
{
  const xml = model(vertex("t", 'value="T" rows="PK id|---|+ f()" style="role=external;"') +
    vertex("s", 'value="S" style="role=step;"'));
  const once = expandDiagramShorthand(xml);
  const twice = expandDiagramShorthand(once.xml);

  assert.ok(once.changed > 0);
  assert.equal(twice.xml, once.xml);
  assert.equal(twice.changed, 0);
});

test("each page of a file is expanded with its own ids", function()
{
  const page = function(name)
  {
    return '<diagram id="' + name + '" name="' + name + '">' + model(vertex("t", 'value="T" rows="id"') +
      vertex("t.id", 'value="x" style="text;"', 'x="300" y="0" width="40" height="20"')) + "</diagram>";
  };
  const xml = expandDiagramShorthand('<mxfile>' + page("p1") + page("p2") + "</mxfile>").xml;

  assert.equal((xml.match(/id="t\.id\.2"/g) || []).length, 2);
});

// ─── The server and the viewer ──────────────────────────────────

let client;

before(async function()
{
  const server = createServer("", { iconServiceUrl: null, xmlReference: "XML REFERENCE", mermaidReference: "MERMAID REFERENCE" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  client = new Client({ name: "diagram-shorthand-test", version: "0.0.0" });
  await client.connect(clientTransport);
});

after(async function()
{
  await client.close();
});

const erDiagram = model(vertex("loan", 'value="Loan" rows="PK id|FK book_id|due_date"') +
  vertex("book", 'value="Book" rows="PK id|title" style="role=data;"', 'x="400" y="40"') +
  vertex("s", 'value="Lend" style="role=step;"', 'x="40" y="300"') +
  '<mxCell id="r1" style="edgeStyle=entityRelationEdgeStyle;html=1;startArrow=ERmany;endArrow=ERmandOne;" edge="1" parent="1" source="loan.book_id" target="book.id"><mxGeometry relative="1" as="geometry"/></mxCell>');

test("create_diagram sends the expanded diagram, without warnings", async function()
{
  const result = await client.callTool({ name: "create_diagram", arguments: { xml: erDiagram } });
  const sent = JSON.parse(result.content[0].text).xml;

  assert.equal(result.isError, undefined);
  assert.equal(attr(cell(sent, "loan.book_id"), "parent"), "loan");
  assert.equal(attr(cell(sent, "r1"), "source"), "loan.book_id");
  assert.doesNotMatch(sent, /\srows="/);
  assert.doesNotMatch(sent, /role=/);
  assert.equal(geometry(cell(sent, "s")).width, 140);
  assert.ok(!result.content.some(function(c) { return /ERRORS|WARNINGS/.test(c.text); }),
    JSON.stringify(result.content.slice(1)));
});

test("create_diagram expands a class whose rows hold generics", async function()
{
  const classes = model(vertex("Order", 'value="Order" rows="- items: List<Item>|---|+ total(): Decimal"') +
    vertex("q", 'value="Retries > 3?" style="role=decision;"', 'x="400" y="40"'));
  const result = await client.callTool({ name: "create_diagram", arguments: { xml: classes } });
  const sent = JSON.parse(result.content[0].text).xml;

  assert.equal(result.isError, undefined);
  assert.doesNotMatch(sent, /\srows="/);
  assert.doesNotMatch(sent, /role=/);
  assert.match(sent, /<mxCell id="Order\.items" value="- items: List&lt;Item>"[^>]*parent="Order"/);
  assert.match(sent, /<mxCell id="q" value="Retries > 3\?" style="rhombus;/);
});

test("the viewer's copy expands the raw tool input as the server does", function()
{
  const html = buildHtml("var App = function() {};", "", null, {});
  const script = html.match(/<script>([\s\S]*?var expandDiagramShorthand = createDiagramShorthand\(\)\.expand;)/)[1];
  const start = script.indexOf("function createDiagramShorthand");
  const context = {};
  const cut = model('<mxCell id="t" value="T > U" rows="id|name" vertex="1" parent="1"></mxCell>');

  assert.ok(start >= 0, "createDiagramShorthand is not inlined in the viewer");
  vm.runInNewContext(script.substring(start) + "\nthis.expand = expandDiagramShorthand;", context);
  assert.equal(context.expand(erDiagram).xml, expandDiagramShorthand(erDiagram).xml);
  assert.equal(context.expand(cut).xml, expandDiagramShorthand(cut).xml);
  assert.equal(context.expand(cut, { partial: true }).xml, cut);
  assert.match(html, /expandDiagramShorthand\(absolutizeImageUrls\(healedXml\), \{ partial: true \}\)/,
    "the streaming path expands partial XML as partial");
});
