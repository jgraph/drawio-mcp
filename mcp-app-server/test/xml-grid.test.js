import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, resolveSemanticTypes, SEMANTIC_TYPES_READY } from "../src/shared.js";
import { XML_GRID, layoutXmlOnGrid, pagePlacement, xmlGridMessages } from "../src/xml-grid.js";
import { readReference, OMITTED_SECTIONS, GRID_OMITTED_SECTIONS, GRID_SECTION_BEFORE, GRID_PLACE_SENTENCE,
  GRID_PLACE_INSTEAD, GRID_ROUTING_SENTENCES } from "../src/references.js";
import { semanticToXml } from "../../shared/semantic/index.js";

// The grid pass for create_diagram's XML, behind the switch
// (DRAWIO_SEMANTIC_TYPES with "xml-grid"): a model that writes XML gives
// every shape its cell (`row=1;col=2;`) and no position, and the server
// places the diagram with the semantic engine's grid pass
// (shared/grid-layout.js). Without the switch nothing changes, and a diagram
// with positions passes byte-identical with it.

const sharedDir = fileURLToPath(new URL("../../shared/", import.meta.url));
const MAX_DESCRIPTION_LENGTH = 2048;
const MAX_REFERENCE_LENGTH = 48000;

async function connect(options)
{
  const server = createServer("", Object.assign({ iconServiceUrl: null }, options));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "xml-grid-test", version: "0.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
}

async function draw(xml, types, options)
{
  const client = await connect({ semanticTypes: types });
  const result = await client.callTool({ name: "create_diagram", arguments: Object.assign({ xml: xml }, options) });

  await client.close();

  return { payload: JSON.parse(result.content[0].text), texts: result.content.slice(1).map(function(c) { return c.text; }) };
}

function model(cells)
{
  return "<mxGraphModel adaptiveColors=\"auto\"><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/>" +
    cells.join("") + "</root></mxGraphModel>";
}

// The geometry of every cell by id, as written.
function geometries(xml)
{
  const out = new Map();

  for (const m of xml.matchAll(/<mxCell id="([^"]+)"([^>]*?)(\/>|>([\s\S]*?)<\/mxCell>)/g))
  {
    const g = /<mxGeometry[^>]*?(\/>|>[\s\S]*?<\/mxGeometry>)/.exec(m[4] || "");

    out.set(m[1], g ? g[0] : null);
  }

  return out;
}

function box(id, label, attrs)
{
  const a = Object.assign({ x: null, y: null }, attrs);

  return "<mxCell id=\"" + id + "\" value=\"" + label + "\" style=\"rounded=1;whiteSpace=wrap;html=1;\" vertex=\"1\" parent=\"1\">" +
    "<mxGeometry x=\"" + a.x + "\" y=\"" + a.y + "\" width=\"140\" height=\"60\" as=\"geometry\"/></mxCell>";
}

function cell(id, label, style, parent)
{
  return "<mxCell id=\"" + id + "\" value=\"" + label + "\" style=\"" + style + "\" vertex=\"1\" parent=\"" + (parent || "1") + "\"/>";
}

function edge(id, source, target, label)
{
  return "<mxCell id=\"" + id + "\"" + (label ? " value=\"" + label + "\"" : "") +
    " style=\"edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;\" edge=\"1\" parent=\"1\" source=\"" + source + "\" target=\"" + target + "\"/>";
}

// A flowchart in two lanes as a model writes it with the switch on: roles,
// cells, lanes, no geometry at all.
const LANES = model([
  cell("title", "Expense claim", "text;html=1;fontSize=20;fontStyle=1;"),
  cell("emp", "Employee", "role=container;lane=1;fillColor=#F7F8FA;fontStyle=1;fontSize=16;"),
  cell("mgr", "Manager", "role=container;lane=1;fillColor=#F4F8FF;fontStyle=1;fontSize=16;"),
  cell("submit", "Submit claim", "role=start;fontSize=16;row=1;col=1;", "emp"),
  cell("check", "Within budget?", "role=decision;fontSize=16;row=2;col=2;", "mgr"),
  cell("approve", "Approve", "role=step;fontSize=16;row=2;col=3;", "mgr"),
  cell("fix", "Fix the claim", "role=error;fontSize=16;row=1;col=2;", "emp"),
  cell("paid", "Claim paid", "role=end;fontSize=16;row=1;col=4;", "emp"),
  edge("e1", "submit", "check"),
  edge("e2", "check", "approve", "Yes"),
  edge("e3", "check", "fix", "No"),
  edge("e4", "fix", "submit"),
  edge("e5", "approve", "paid")
]);

const PLACED = model([
  box("a", "Order", { x: 40, y: 40 }),
  box("b", "Pay", { x: 220, y: 40 }),
  edge("ab", "a", "b")
]);

test("the switch: \"xml-grid\" in the list, never in \"on\", and no semantic tool of its own", async function()
{
  assert.equal(XML_GRID, "xml-grid");
  assert.deepEqual(resolveSemanticTypes("on"), SEMANTIC_TYPES_READY);
  assert.ok(resolveSemanticTypes("on").indexOf(XML_GRID) < 0);
  assert.deepEqual(resolveSemanticTypes("on,xml-grid"), SEMANTIC_TYPES_READY.concat([XML_GRID]));
  assert.deepEqual(resolveSemanticTypes(" XML-Grid "), [XML_GRID]);

  const client = await connect({ semanticTypes: [XML_GRID] });
  const { tools } = await client.listTools();

  assert.deepEqual(tools.map(function(t) { return t.name; }), ["create_diagram", "get_drawio_reference"]);
  await client.close();
});

test("without the switch create_diagram is listed as before and a diagram of cells is not placed", async function()
{
  const plain = await connect({});
  const off = await connect({ semanticTypes: SEMANTIC_TYPES_READY });
  const a = (await plain.listTools()).tools.find(function(t) { return t.name === "create_diagram"; });
  const b = (await off.listTools()).tools.find(function(t) { return t.name === "create_diagram"; });

  assert.deepEqual(b, a);
  assert.match(a.description, /You place every shape yourself/);
  assert.doesNotMatch(a.description, /row=1;col=2/);
  await plain.close();
  await off.close();

  const r = await draw(LANES, []);

  assert.doesNotMatch(r.payload.xml, /<mxGeometry x=/);
  assert.match(r.payload.xml, /row=1;col=1;/);
  assert.ok(!r.texts.some(function(t) { return /placed the/.test(t); }));
});

test("with the switch the description asks for cells instead of positions, within the cap", async function()
{
  const client = await connect({ semanticTypes: [XML_GRID] });
  const tool = (await client.listTools()).tools.find(function(t) { return t.name === "create_diagram"; });

  assert.ok(tool.description.length <= MAX_DESCRIPTION_LENGTH, "description is " + tool.description.length + " characters");
  assert.match(tool.description, /give each shape a cell instead of a position/);
  assert.match(tool.description, /row=1;col=2; in one grid for the whole diagram\) and no mxGeometry/);
  assert.doesNotMatch(tool.description, /You place every shape yourself/);
  // the parameters are the same: only the description says it
  const plain = await connect({});
  const before = (await plain.listTools()).tools.find(function(t) { return t.name === "create_diagram"; });

  assert.deepEqual(tool.inputSchema, before.inputSchema);
  await client.close();
  await plain.close();
});

test("a diagram of cells is placed as the semantic engine places the same description", async function()
{
  const description =
  {
    type: "swimlane",
    title: "Expense claim",
    groups: [{ id: "emp", label: "Employee" }, { id: "mgr", label: "Manager" }],
    nodes:
    [
      { id: "submit", label: "Submit claim", kind: "start", group: "emp", row: 1, col: 1 },
      { id: "check", label: "Within budget?", kind: "decision", group: "mgr", row: 2, col: 2 },
      { id: "approve", label: "Approve", kind: "step", group: "mgr", row: 2, col: 3 },
      { id: "fix", label: "Fix the claim", kind: "error", group: "emp", row: 1, col: 2 },
      { id: "paid", label: "Claim paid", kind: "end", group: "emp", row: 1, col: 4 }
    ],
    edges:
    [
      { from: "submit", to: "check" },
      { from: "check", to: "approve", label: "Yes" },
      { from: "check", to: "fix", label: "No" },
      { from: "fix", to: "submit" },
      { from: "approve", to: "paid" }
    ]
  };
  const engine = await semanticToXml(description, { hints: "ask" });
  // the XML the engine writes before it places it (shared/semantic/boxes.js)
  const { compactXml } = await import("../../shared/semantic/boxes.js");
  const { normalizeSpec } = await import("../../shared/semantic/spec.js");
  const compact = compactXml(normalizeSpec(description, { hints: true }).diagram, { flow: true, links: false }).xml;

  assert.doesNotMatch(compact, /<mxGeometry/);

  const r = await draw(compact, [XML_GRID]);
  const a = geometries(engine.xml);
  const b = geometries(r.payload.xml);

  assert.ok(a.size > 10);
  assert.deepEqual(Array.from(b.keys()).sort(), Array.from(a.keys()).sort());

  for (const [id, g] of a)
  {
    assert.equal(b.get(id), g, "the geometry of " + id);
  }
});

test("every shape gets a position, the hint keys go, and the model is told how to change it", async function()
{
  const r = await draw(LANES, [XML_GRID]);
  const g = geometries(r.payload.xml);

  for (const id of ["title", "emp", "mgr", "submit", "check", "approve", "fix", "paid"])
  {
    assert.match(g.get(id) || "", /<mxGeometry x="[\d.-]+" y="[\d.-]+" width="[\d.]+" height="[\d.]+"/, id);
  }

  // the steps stay in their lanes, which are drawn around them
  assert.match(r.payload.xml, /id="check"[^>]*parent="mgr"/);
  assert.doesNotMatch(r.payload.xml, /(^|[";])(row|col|lane)=/);
  // the connectors are routed on the grid: right angles with their points
  assert.match(r.payload.xml, /id="e3"[^>]*>[\s\S]*?<Array as="points">/);
  assert.ok(r.texts.some(function(t)
  {
    return /^The server placed the 8 shapes on their cells and routed the connectors\. To change the diagram, send the whole XML again the same way/.test(t);
  }));
  // the note for a short reply stays last
  assert.match(r.texts[r.texts.length - 1], /^The user sees the diagram itself/);
});

test("a diagram with positions passes byte-identical with the switch on", async function()
{
  const off = await draw(PLACED, []);
  const on = await draw(PLACED, [XML_GRID]);

  assert.equal(on.payload.xml, off.payload.xml);
  assert.deepEqual(on.texts, off.texts);
  assert.deepEqual(layoutXmlOnGrid(PLACED), { xml: PLACED, laidOut: 0, shapes: 0, mixed: [], sized: [], failed: [], stats: null });
});

test("a placed diagram with a shape at 0, 0, written without x and y as draw.io does, passes as it is", async function()
{
  const origin = "<mxCell id=\"o\" value=\"Start\" style=\"rounded=1;whiteSpace=wrap;html=1;\" vertex=\"1\" parent=\"1\">" +
    "<mxGeometry width=\"140\" height=\"60\" as=\"geometry\"/></mxCell>";
  const xml = model([origin, box("a", "Order", { x: 200, y: 0 }), edge("oa", "o", "a")]);
  const r = layoutXmlOnGrid(xml);

  assert.deepEqual(r, { xml: xml, laidOut: 0, shapes: 0, mixed: [], sized: [], failed: [], stats: null });

  const off = await draw(xml, []);
  const on = await draw(xml, [XML_GRID]);

  assert.equal(on.payload.xml, off.payload.xml);
  assert.deepEqual(on.texts, off.texts);
  assert.ok(!on.texts.some(function(t) { return /no position|not drawn/.test(t); }));

  // beside a page of cells it doesn't keep that page from being placed, and
  // isn't placed itself
  const page = function(id, inner)
  {
    return "<diagram id=\"" + id + "\" name=\"" + id + "\">" + inner + "</diagram>";
  };
  const cells = model([
    cell("x", "Start", "role=start;row=1;col=1;"),
    cell("y", "Done", "role=end;row=1;col=2;"),
    edge("xy", "x", "y")
  ]);
  const two = layoutXmlOnGrid("<mxfile>" + page("placed", xml) + page("cells", cells) + "</mxfile>");
  const placed = geometries(two.xml.substring(two.xml.indexOf("<diagram id=\"placed\""), two.xml.indexOf("<diagram id=\"cells\"")));

  assert.equal(two.laidOut, 1);
  assert.equal(two.shapes, 2);
  assert.deepEqual(two.mixed, []);
  assert.equal(placed.get("o"), geometries(xml).get("o"));
  assert.equal(placed.get("a"), geometries(xml).get("a"));
  assert.match(two.xml.substring(two.xml.indexOf("<diagram id=\"cells\"")), /id="x"[^>]*>\s*<mxGeometry x=/);
});

test("routing and postLayout are left out for a diagram the pass placed, and kept for a placed one", async function()
{
  const cells = await draw(LANES, [XML_GRID], { routing: "libavoid", postLayout: "elk", direction: "horizontal" });

  assert.equal(cells.payload.routing, undefined);
  assert.equal(cells.payload.postLayout, undefined);
  assert.equal(cells.payload.direction, undefined);
  assert.ok(cells.texts.some(function(t)
  {
    return /^The server placed the \d+ shapes on their cells and routed the connectors, without the `postLayout` and `routing` you passed, which would undo that\. To change/.test(t);
  }));

  const one = await draw(LANES, [XML_GRID], { routing: "libavoid" });

  assert.equal(one.payload.routing, undefined);
  assert.ok(one.texts.some(function(t) { return /, without the `routing` you passed, which would undo that\./.test(t); }));

  // the same geometry as without the options
  assert.equal(cells.payload.xml, (await draw(LANES, [XML_GRID])).payload.xml);

  // the model's own placement keeps its options, with the switch on too
  const placed = await draw(PLACED, [XML_GRID], { routing: "libavoid" });

  assert.equal(placed.payload.routing, "libavoid");
  assert.ok(!placed.texts.some(function(t) { return /without the/.test(t); }));
});

test("shapes without a position beside shapes with one: nothing moves, and the model is told", async function()
{
  const xml = model([
    box("a", "Order", { x: 40, y: 40 }),
    box("b", "Pay", { x: 220, y: 40 }),
    cell("c", "Ship", "rounded=1;whiteSpace=wrap;html=1;row=1;col=3;"),
    edge("ab", "a", "b"),
    edge("bc", "b", "c")
  ]);
  const r = layoutXmlOnGrid(xml);

  assert.equal(r.xml, xml);
  assert.equal(r.laidOut, 0);
  assert.deepEqual(r.mixed, ["c"]);

  const drawn = await draw(xml, [XML_GRID]);
  const g = geometries(drawn.payload.xml);

  assert.match(g.get("a"), /x="40" y="40" width="140" height="60"/);
  assert.match(g.get("b"), /x="220" y="40" width="140" height="60"/);
  assert.ok(drawn.texts.some(function(t)
  {
    return /WARNINGS[\s\S]*1 shape has no position \(c\) while the others have one, so it is not drawn and nothing was placed for you\./.test(t);
  }));
  assert.ok(!drawn.texts.some(function(t) { return /The server placed/.test(t); }));
});

test("a shape with a size and a cell beside shapes with a position is named as drawn at the top left", async function()
{
  const sized = "<mxCell id=\"d\" value=\"Bill\" style=\"rounded=1;whiteSpace=wrap;html=1;row=1;col=4;\" vertex=\"1\" parent=\"1\">" +
    "<mxGeometry width=\"200\" height=\"60\" as=\"geometry\"/></mxCell>";
  const alone = model([box("a", "Order", { x: 40, y: 40 }), sized]);
  const both = model([box("a", "Order", { x: 40, y: 40 }), cell("c", "Ship", "rounded=1;whiteSpace=wrap;html=1;row=1;col=3;"), sized]);
  const one = layoutXmlOnGrid(alone);
  const two = layoutXmlOnGrid(both);

  assert.equal(one.xml, alone);
  assert.deepEqual([one.mixed, one.sized], [["d"], ["d"]]);
  assert.deepEqual([two.mixed, two.sized], [["c", "d"], ["d"]]);
  assert.match(xmlGridMessages(one).warning, /^1 shape has no position \(d\) while the others have one, so it is drawn at the top left and nothing was placed for you\./);
  assert.match(xmlGridMessages(two).warning,
    /^2 shapes have no position \(c, d\) while the others have one, so the ones without a geometry are not drawn and the others are drawn at the top left and nothing was placed for you\./);

  const drawn = await draw(alone, [XML_GRID]);

  assert.ok(drawn.texts.some(function(t) { return /WARNINGS[\s\S]*\(d\)[^\n]*drawn at the top left/.test(t); }));
});

test("a page of cells the pass leaves as it was is named, and the note counts only the shapes it placed", async function()
{
  // The pass never breaks a diagram: a page it fails on stays as it was. A
  // shape on the root instead of a layer is such a page: the pass reads the
  // shapes of the layers and has nothing to place.
  const stray = "<mxGraphModel adaptiveColors=\"auto\"><root><mxCell id=\"0\"/>" +
    "<mxCell id=\"v\" value=\"Lost\" style=\"rounded=1;html=1;row=1;col=1;\" vertex=\"1\" parent=\"0\"/></root></mxGraphModel>";
  const r = layoutXmlOnGrid(stray);

  assert.equal(r.xml, stray);
  assert.equal(r.laidOut, 0);
  assert.equal(r.shapes, 0);
  assert.deepEqual(r.failed, ["v"]);
  assert.deepEqual(xmlGridMessages(r), { note: null, warning: "The server could not place 1 shape (v), so it is not drawn. " +
    "Send the diagram again with a position for it (an mxGeometry with x, y, width and height)." });

  const drawn = await draw(stray, [XML_GRID]);

  assert.ok(drawn.texts.some(function(t) { return /WARNINGS[\s\S]*The server could not place 1 shape \(v\)/.test(t); }));
  assert.ok(!drawn.texts.some(function(t) { return /The server placed/.test(t); }));

  // beside a page it placed: that page is placed, its shapes are counted,
  // and the other one is named
  const page = function(id, inner)
  {
    return "<diagram id=\"" + id + "\" name=\"" + id + "\">" + inner + "</diagram>";
  };
  const cells = model([
    cell("x", "Start", "role=start;row=1;col=1;"),
    cell("y", "Done", "role=end;row=1;col=2;"),
    edge("xy", "x", "y")
  ]);
  const two = layoutXmlOnGrid("<mxfile>" + page("stray", stray) + page("cells", cells) + "</mxfile>");
  const messages = xmlGridMessages(two);

  assert.equal(two.laidOut, 1);
  assert.equal(two.shapes, 2);
  assert.deepEqual(two.failed, ["v"]);
  assert.match(messages.note, /^The server placed the 2 shapes on their cells/);
  assert.match(messages.warning, /^The server could not place 1 shape \(v\)/);
});

test("a title and a legend written with a position don't keep a page of cells from being placed", async function()
{
  // Sonnet in the pilot run: every shape with its cell, the title and the
  // legend with coordinates of their own
  const xml = model([
    "<mxCell id=\"title\" value=\"Shop on AKS\" style=\"text;html=1;fontSize=20;fontStyle=1;align=left;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"0\" y=\"0\" width=\"560\" height=\"30\" as=\"geometry\"/></mxCell>",
    cell("a", "Order", "rounded=1;whiteSpace=wrap;html=1;row=1;col=1;"),
    cell("b", "Pay", "rounded=1;whiteSpace=wrap;html=1;row=1;col=2;"),
    edge("ab", "a", "b"),
    "<mxCell id=\"legend\" value=\"Dashed = async\" style=\"text;html=1;fontSize=12;align=left;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"40\" y=\"640\" width=\"260\" height=\"20\" as=\"geometry\"/></mxCell>"
  ]);

  assert.deepEqual(pagePlacement(xml), [{ vertices: 4, unplaced: ["a", "b"], lost: ["a", "b"], sized: [],
    floats: ["title", "legend"], open: true }]);

  const r = layoutXmlOnGrid(xml);

  assert.equal(r.laidOut, 1);
  assert.deepEqual(r.mixed, []);

  const g = geometries(r.xml);
  // a y of 0 isn't written
  const y = function(id)
  {
    const m = / y="([\d.]+)"/.exec(g.get(id));

    return m ? Number(m[1]) : 0;
  };

  // the title above everything, the legend below, both with their height
  assert.equal(y("title"), 0);
  assert.match(g.get("title"), /height="30"/);
  assert.ok(y("a") >= 30 && y("b") >= 30);
  assert.ok(y("legend") > y("a") + 60);
  assert.match(g.get("legend"), /height="20"/);

  const drawn = await draw(xml, [XML_GRID]);

  assert.ok(drawn.texts.some(function(t) { return /The server placed the 4 shapes/.test(t); }));
  assert.ok(!drawn.texts.some(function(t) { return /(has|have) no position/.test(t); }));
});

test("a text with a position that is connected or inside a container still makes the page mixed", function()
{
  const linked = model([
    "<mxCell id=\"t\" value=\"Note\" style=\"text;html=1;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"0\" y=\"0\" width=\"100\" height=\"20\" as=\"geometry\"/></mxCell>",
    cell("a", "Order", "rounded=1;whiteSpace=wrap;html=1;row=1;col=1;"),
    edge("ta", "t", "a")
  ]);
  const inside = model([
    cell("zone", "Zone", "rounded=0;container=1;html=1;"),
    "<mxCell id=\"t\" value=\"Note\" style=\"text;html=1;\" vertex=\"1\" parent=\"zone\"><mxGeometry x=\"10\" y=\"10\" width=\"100\" height=\"20\" as=\"geometry\"/></mxCell>",
    cell("a", "Order", "rounded=1;whiteSpace=wrap;html=1;row=1;col=1;", "zone")
  ]);

  [linked, inside].forEach(function(xml)
  {
    const r = layoutXmlOnGrid(xml);

    assert.equal(r.xml, xml);
    assert.equal(r.laidOut, 0);
    assert.ok(r.mixed.indexOf("a") >= 0);
    assert.equal(r.mixed.indexOf("t"), -1);
  });

  // and a page placed by the model, texts and all, passes as it is
  const placed = model([
    "<mxCell id=\"t\" value=\"Title\" style=\"text;html=1;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"0\" y=\"0\" width=\"100\" height=\"20\" as=\"geometry\"/></mxCell>",
    box("a", "Order", { x: 40, y: 40 })
  ]);

  assert.equal(layoutXmlOnGrid(placed).xml, placed);
  assert.equal(layoutXmlOnGrid(placed).laidOut, 0);
});

test("a size without x and y is kept, and a table of rows is placed whole", async function()
{
  const xml = model([
    "<mxCell id=\"bus\" value=\"Event bus\" style=\"role=external;row=1;col=1;\" vertex=\"1\" parent=\"1\"><mxGeometry width=\"420\" height=\"50\" as=\"geometry\"/></mxCell>",
    "<mxCell id=\"loan\" value=\"Loan\" rows=\"PK id|FK book_id|due_date\" style=\"role=data;row=2;col=1;\" vertex=\"1\" parent=\"1\"/>",
    "<mxCell id=\"book\" value=\"Book\" rows=\"PK id|title\" style=\"role=data;row=2;col=2;\" vertex=\"1\" parent=\"1\"/>",
    "<mxCell id=\"r\" style=\"edgeStyle=entityRelationEdgeStyle;html=1;endArrow=ERmany;startArrow=ERmandOne;\" edge=\"1\" parent=\"1\" source=\"book.id\" target=\"loan.book_id\"/>"
  ]);

  // the table's rows have positions of their own, inside the table: they
  // aren't shapes of the page
  assert.deepEqual(pagePlacement(xml), [{ vertices: 3, unplaced: ["bus", "loan", "book"], lost: ["bus", "loan", "book"],
    sized: ["bus"], floats: [], open: true }]);

  const r = await draw(xml, [XML_GRID]);
  const g = geometries(r.payload.xml);

  assert.match(g.get("bus"), /width="420" height="50"/);
  assert.match(g.get("loan"), /<mxGeometry x="[\d.]+" y="[\d.]+" width="200"/);
  assert.match(g.get("loan.book_id"), /<mxGeometry y="52" width="200" height="26"/);
  assert.match(r.payload.xml, /id="loan.book_id"[^>]*parent="loan"/);
});

test("of two pages only the one of cells is placed", function()
{
  const page = function(id, inner)
  {
    return "<diagram id=\"" + id + "\" name=\"" + id + "\">" + inner + "</diagram>";
  };
  const cells = model([
    cell("x", "Start", "role=start;row=1;col=1;"),
    cell("y", "Done", "role=end;row=1;col=2;"),
    edge("xy", "x", "y")
  ]);
  const xml = "<mxfile>" + page("placed", PLACED) + page("cells", cells) + "</mxfile>";
  const r = layoutXmlOnGrid(xml);

  assert.equal(r.laidOut, 1);
  assert.equal(r.shapes, 2);
  // the placed page's shapes keep their geometry (its edge gets one, from
  // the normalization every diagram goes through)
  assert.equal(geometries(r.xml.substring(r.xml.indexOf("<diagram id=\"placed\""), r.xml.indexOf("<diagram id=\"cells\""))).get("a"),
    geometries(PLACED).get("a"));
  assert.match(r.xml.substring(r.xml.indexOf("<diagram id=\"cells\"")), /id="x"[^>]*>\s*<mxGeometry x=/);
});

test("the pass is deterministic and placing its result again changes nothing", function()
{
  const a = layoutXmlOnGrid(LANES);
  const b = layoutXmlOnGrid(LANES);

  assert.equal(a.xml, b.xml);
  assert.equal(a.laidOut, 1);

  const again = layoutXmlOnGrid(a.xml);

  assert.equal(again.xml, a.xml);
  assert.equal(again.laidOut, 0);
});

test("the messages: the note after a layout, the warning names at most eight shapes", function()
{
  assert.deepEqual(xmlGridMessages({ laidOut: 0, shapes: 0, mixed: [] }), { note: null, warning: null });

  const many = xmlGridMessages({ laidOut: 0, shapes: 0, mixed: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] });

  assert.match(many.warning, /^9 shapes have no position \(a, b, c, d, e, f, g, h, …\) while the others have one, so they are not drawn/);
  assert.equal(xmlGridMessages({ laidOut: 1, shapes: 3, mixed: [], ignored: [] }).note,
    "The server placed the 3 shapes on their cells and routed the connectors. " +
    "To change the diagram, send the whole XML again the same way: cells (row, col), no positions, the same ids.");
  assert.match(xmlGridMessages({ laidOut: 0, shapes: 0, mixed: [], failed: ["a", "b"] }).warning,
    /^The server could not place 2 shapes \(a, b\), so they are not drawn\. Send the diagram again with a position for each of them/);
});

test("the XML reference for the grid: the section before the patterns, under the tool-result limit", function()
{
  const plain = readReference(sharedDir, "xml-reference.md", "chat-view-xml.md");
  const grid = readReference(sharedDir, "xml-reference.md", "chat-view-xml.md", { grid: true });
  const section = fs.readFileSync(sharedDir + "chat-view-grid.md", "utf-8").trim();

  assert.ok(grid.length < MAX_REFERENCE_LENGTH, "the grid reference is " + grid.length + " characters");
  assert.ok(grid.indexOf(section) > 0);
  assert.ok(grid.indexOf(section) < grid.indexOf(GRID_SECTION_BEFORE));
  assert.ok(plain.indexOf(GRID_PLACE_SENTENCE) > 0);
  assert.ok(grid.indexOf(GRID_PLACE_SENTENCE) < 0);
  assert.ok(grid.indexOf(GRID_PLACE_INSTEAD) > 0);
  assert.equal(plain.indexOf("## Cells instead of positions"), -1);

  // the routing section goes with the grid, the others stay out as before
  for (const heading of GRID_OMITTED_SECTIONS.concat(OMITTED_SECTIONS))
  {
    assert.equal(grid.indexOf("\n## " + heading + "\n"), -1, heading);
    assert.equal(grid.indexOf("\n### " + heading + "\n"), -1, heading);
  }

  assert.ok(plain.indexOf("\n## Edge routing & layout passes\n") > 0);

  // the sentences that send the model to routing and postLayout are replaced
  for (const pair of GRID_ROUTING_SENTENCES)
  {
    assert.ok(plain.indexOf(pair[0]) > 0);
    assert.equal(plain.indexOf(pair[1]), -1);
    assert.equal(grid.indexOf(pair[0]), -1);
    assert.ok(grid.indexOf(pair[1]) > 0);
  }

  assert.equal(grid.indexOf("Edge routing & layout passes"), -1);
  assert.equal(grid.indexOf("routing: \"libavoid\"`**"), -1);
});

test("the entries read the switch for the reference as they do for the types, and bundle no engine for it", function()
{
  const read = function(name)
  {
    return fs.readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
  };

  // the Node server at startup, the Worker's build before the deploy
  assert.match(read("index.js"), /readReference\(sharedDir, "xml-reference\.md", "chat-view-xml\.md",\s*\{ grid: semanticTypes\.indexOf\(XML_GRID\) >= 0 \}\)/);
  assert.match(read("build-html.js"), /readReference\(sharedDir, "xml-reference\.md", "chat-view-xml\.md",\s*\{ grid: resolveSemanticTypes\(process\.env\.DRAWIO_SEMANTIC_TYPES\)\.indexOf\(XML_GRID\) >= 0 \}\)/);

  // the engine goes into the HTML for the semantic tool's preview, not for
  // the grid pass, which runs on the server
  ["index.js", "build-html.js"].forEach(function(name)
  {
    assert.match(read(name), /const semanticJs = semanticTypes\.some\(function\(t\) \{ return t !== XML_GRID; \}\) \?\s*bundleSemanticEngine\(/);
  });
});
