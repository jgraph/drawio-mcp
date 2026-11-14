import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, buildHtml, resolveSemanticTypes, SEMANTIC_TYPES_ON, SEMANTIC_TYPES_READY } from "../src/shared.js";
import { bundleSemanticEngine, VIEWER_GLOBALS } from "../src/semantic-bundle.js";
import { semanticToXml, MAX_NODES } from "../../shared/semantic/index.js";
import { describeSchema } from "../../shared/semantic/description.js";
import { createDiagramShorthand, expandDiagramShorthand } from "../../shared/diagram-shorthand.js";
import { createIconResolver } from "../../shared/icon-resolver.js";
import { ICON_TABLE } from "../../shared/icon-table.js";

// create_semantic_diagram: the model describes the diagram, the semantic
// engine (shared/semantic) lays it out. The tool is only listed with a type
// switched on (none by default, so tools/list doesn't change;
// DRAWIO_SEMANTIC_TYPES=on offers flowcharts and swimlanes), and the viewer
// gets the engine as a classic script for its preview while a description
// streams in (src/semantic-bundle.js).

const SCHEMA =
{
  type: "er",
  title: "Library",
  nodes:
  [
    { id: "authors", label: "Authors", fields: ["PK author_id", "name"] },
    { id: "books", label: "Books", fields: ["PK book_id", "FK author_id", "title"] },
    { id: "loans", label: "Loans", fields: ["PK loan_id", "FK book_id", "due_on"] }
  ],
  edges:
  [
    { from: "authors", to: "books", kind: "one-to-many" },
    { from: "books", to: "loans", kind: "one-to-many" }
  ]
};

async function connect(options)
{
  const server = createServer("", Object.assign({ iconServiceUrl: null }, options));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "semantic-test", version: "0.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
}

test("without a type switched on, the tool isn't listed", async function()
{
  assert.deepEqual(SEMANTIC_TYPES_ON, []);

  const client = await connect({});
  const { tools } = await client.listTools();

  assert.deepEqual(tools.map(function(t) { return t.name; }), ["create_diagram", "get_drawio_reference"]);
  await client.close();
});

test("the types come from a comma-separated list, unknown ones dropped", function()
{
  assert.deepEqual(resolveSemanticTypes(undefined), SEMANTIC_TYPES_ON);
  assert.deepEqual(resolveSemanticTypes("er"), ["er"]);
  assert.deepEqual(resolveSemanticTypes(" ER , gantt,er"), ["er"]);
  assert.deepEqual(resolveSemanticTypes("flowchart, swimlane"), ["flowchart", "swimlane"]);
  // the switch for staging: the types that passed the blind judgement
  assert.deepEqual(SEMANTIC_TYPES_READY, ["flowchart", "swimlane"]);
  assert.deepEqual(resolveSemanticTypes("on"), SEMANTIC_TYPES_READY);
  assert.deepEqual(resolveSemanticTypes(" ON "), SEMANTIC_TYPES_READY);
  assert.deepEqual(resolveSemanticTypes("true"), SEMANTIC_TYPES_READY);
  assert.deepEqual(resolveSemanticTypes("1"), SEMANTIC_TYPES_READY);
  // also in a list, with a type to try out
  assert.deepEqual(resolveSemanticTypes("on,er"), ["flowchart", "swimlane", "er"]);
  assert.deepEqual(resolveSemanticTypes("off"), []);
  assert.deepEqual(resolveSemanticTypes(""), []);
});

test("a type that is described as another one brings that one along", async function()
{
  // the description of a swimlane is the flowchart's ("type \"flowchart\"
  // (processes, with or without swimlanes)"), a network's the architecture's:
  // alone, the description named a type the enum didn't have
  assert.deepEqual(resolveSemanticTypes("swimlane"), ["flowchart", "swimlane"]);
  assert.deepEqual(resolveSemanticTypes("network,er"), ["architecture", "network", "er"]);
  assert.deepEqual(resolveSemanticTypes("swimlane,flowchart"), ["flowchart", "swimlane"]);

  for (const value of ["swimlane", "network", "on", "er,network"])
  {
    const client = await connect({ semanticTypes: resolveSemanticTypes(value) });
    const tool = (await client.listTools()).tools.find(function(t) { return t.name === "create_semantic_diagram"; });
    const named = tool.description.match(/type "([a-z]+)"/g).map(function(m) { return m.slice(6, -1); });

    assert.ok(named.length > 0, value);

    for (const name of named)
    {
      assert.ok(tool.inputSchema.properties.type.enum.includes(name), value + ": the description names " + name);
    }

    await client.close();
  }
});

test("with ER on, the tool lays out a schema and answers with its XML", async function()
{
  const client = await connect({ semanticTypes: ["er"], buildId: "test-build" });
  const { tools } = await client.listTools();
  const tool = tools.find(function(t) { return t.name === "create_semantic_diagram"; });

  assert.ok(tool != null);
  assert.ok(tool.description.length <= 2048, "description is " + tool.description.length + " characters");
  assert.match(tool.description, /type "er"/);
  assert.deepEqual(tool.inputSchema.properties.type.enum, ["er"]);
  assert.equal(tool._meta.ui.resourceUri, "ui://drawio/mcp-app.html");

  const result = await client.callTool({ name: "create_semantic_diagram", arguments: SCHEMA });
  const payload = JSON.parse(result.content[0].text);
  const plain = await semanticToXml(SCHEMA);

  assert.equal(result.isError, undefined);
  assert.equal(payload._buildId, "test-build");
  assert.match(payload.xml, /source="authors\.author_id" target="books\.author_id"/);
  // the server's passes: the label gap on every edge
  assert.notEqual(payload.xml, plain.xml);
  assert.match(payload.xml, /defaultLabelBackgroundColor=page/);
  await client.close();
});

test("slips in the arguments are forgiven, and what can't be drawn is reported", async function()
{
  const client = await connect({ semanticTypes: ["er"] });
  const args = { type: "ER", nodes: JSON.stringify(SCHEMA.nodes),
    edges: SCHEMA.edges.concat([{ from: "books", to: "publishers" }]) };
  const result = await client.callTool({ name: "create_semantic_diagram", arguments: args });

  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  assert.match(JSON.parse(result.content[0].text).xml, /id="books\.author_id"/);
  assert.match(result.content[1].text, /^WARNINGS \(what the diagram doesn't show as described\):/);
  assert.match(result.content[1].text, /publishers/);

  const empty = await client.callTool({ name: "create_semantic_diagram", arguments: { type: "er", nodes: [] } });

  assert.equal(empty.isError, true);
  assert.match(empty.content[0].text, /no nodes/);
  await client.close();
});

test("null for an empty option, a type alias and nodes by id alone are read as the engine reads them", async function()
{
  const client = await connect({ semanticTypes: ["er"] });
  const call = function(args)
  {
    return client.callTool({ name: "create_semantic_diagram", arguments: args });
  };

  const nulls = await call({ type: "ERD", title: null, nodes: SCHEMA.nodes, edges: null });

  assert.equal(nulls.isError, undefined, JSON.stringify(nulls.content));
  assert.match(JSON.parse(nulls.content[0].text).xml, /id="books\.author_id"/);

  for (const nodes of [["users", "orders"], "users|orders", JSON.stringify(["users", "orders"])])
  {
    const ids = await call({ type: "schema", nodes: nodes });

    assert.equal(ids.isError, undefined, JSON.stringify(nodes) + ": " + JSON.stringify(ids.content));
    assert.match(JSON.parse(ids.content[0].text).xml, /id="users".*id="orders"/s);
  }

  const one = await call({ type: "er", nodes: SCHEMA.nodes[0] });

  assert.equal(one.isError, undefined, JSON.stringify(one.content));

  // what isn't offered, or JSON that doesn't parse, still fails
  for (const args of [{ type: "flowchart", nodes: SCHEMA.nodes }, { type: "er", nodes: "[{\"id\": \"a\"" }])
  {
    const failed = await call(args);

    assert.equal(failed.isError, true, JSON.stringify(args));
  }

  await client.close();
});

test("the bundled engine gives the same XML as the modules", async function()
{
  const js = bundleSemanticEngine();
  const context = {};

  assert.doesNotMatch(js, /<\/script/i);
  vm.runInNewContext(js + "\nthis.engine = DrawioSemantic;", context);

  const a = await context.engine.semanticToXml(SCHEMA, {});
  const b = await semanticToXml(SCHEMA, {});

  assert.equal(a.xml, b.xml);
  assert.deepEqual(Array.from(context.engine.SUPPORTED_TYPES), ["er", "architecture", "network", "flowchart", "swimlane"]);
});

test("the viewer gets the engine only when the tool is offered", function()
{
  const without = buildHtml("var App = function() {};", "", null, {});
  const js = bundleSemanticEngine();
  const withEngine = buildHtml("var App = function() {};", "", null, { semanticJs: js });

  assert.doesNotMatch(without, /var DrawioSemantic =/);
  assert.ok(withEngine.indexOf(js) >= 0);
  // the preview code is always there and waits for DrawioSemantic
  assert.match(without, /function handleSemanticPartial\(args, now\)/);
});

// ── Flowcharts and swimlanes (DRAWIO_SEMANTIC_TYPES=on) ──────────────────────

const LANES =
{
  type: "swimlane",
  title: "Refund",
  groups: [{ id: "customer", label: "Customer" }, { id: "agent", label: "Agent" }],
  nodes:
  [
    { id: "ask", label: "Ask for refund", kind: "start", group: "customer", row: 1, col: 1 },
    { id: "check", label: "Check the order", kind: "step", group: "agent", row: 2, col: 1 },
    { id: "ok", label: "Within 30 days?", kind: "decision", group: "agent", row: 2, col: 2 },
    { id: "pay", label: "Pay back", kind: "step", group: "agent", row: 2, col: 3 },
    { id: "done", label: "Refund received", kind: "end", group: "customer", row: 1, col: 3 },
    { id: "no", label: "Decline", kind: "end", group: "agent", row: 3, col: 2 }
  ],
  edges:
  [
    { from: "ask", to: "check" },
    { from: "check", to: "ok" },
    { from: "ok", to: "pay", label: "Yes" },
    { from: "ok", to: "no", label: "No" },
    { from: "pay", to: "done" }
  ]
};

// The cell with this id: its parent and geometry.
function cellOf(xml, id)
{
  const m = new RegExp("<mxCell id=\"" + id + "\"[^>]*?parent=\"([^\"]*)\"[^>]*><mxGeometry x=\"([-\\d.]+)\" y=\"([-\\d.]+)\" " +
    "width=\"([-\\d.]+)\" height=\"([-\\d.]+)\"").exec(xml);

  assert.ok(m != null, "no cell " + id);

  return { parent: m[1], x: Number(m[2]), y: Number(m[3]), width: Number(m[4]), height: Number(m[5]) };
}

// A JSON Schema without what zod adds and the bench's schema leaves out.
function plainSchema(schema)
{
  if (Array.isArray(schema))
  {
    return schema.map(plainSchema);
  }

  if (schema != null && typeof schema === "object")
  {
    const out = {};

    for (const key of Object.keys(schema).sort())
    {
      // an empty description isn't listed
      if (key !== "additionalProperties" && key !== "$schema" && !(key === "description" && schema[key] === ""))
      {
        out[key] = plainSchema(schema[key]);
      }
    }

    return out;
  }

  return schema;
}

test("the switch offers flowcharts and swimlanes, with the schema the benchmark ran with", async function()
{
  const types = resolveSemanticTypes("on");
  const client = await connect({ semanticTypes: types });
  const { tools } = await client.listTools();
  const tool = tools.find(function(t) { return t.name === "create_semantic_diagram"; });
  const plain = await connect({});
  const before = (await plain.listTools()).tools;

  // everything else as today: the other tools are listed exactly as without the switch
  assert.deepEqual(tools.filter(function(t) { return t.name !== "create_semantic_diagram"; }), before);
  assert.ok(tool.description.length <= 2048, "description is " + tool.description.length + " characters");
  assert.match(tool.description, /type "flowchart"/);
  assert.doesNotMatch(tool.description, /type "er"|type "architecture"/);
  // placement is asked for: a cell for every node, in one grid for the page
  assert.match(tool.description, /Placement: give every node row and col/);
  assert.deepEqual(tool.inputSchema.properties.type.enum, ["flowchart", "swimlane"]);
  assert.deepEqual(tool.inputSchema.required, ["type", "nodes"]);

  const listed = plainSchema(tool.inputSchema);
  const measured = plainSchema(describeSchema(types, { hints: "ask" }));

  // the server's own words on the two keys the bench's schema doesn't describe
  assert.equal(listed.properties.type.description, "The diagram type.");
  delete listed.properties.type.description;
  delete listed.properties.title.description;
  assert.deepEqual(listed, measured);
  // the layout of the last result for a change, before the nodes, so the
  // preview of a change draws them where they were
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ["type", "title", "layout", "nodes", "edges", "groups"]);
  assert.match(tool.inputSchema.properties.layout.description, /On every change of a diagram: the layout of its last result, copied exactly/);
  assert.match(tool.description, /keeping the ids, the cells of what stays and the layout\./);
  assert.deepEqual(tool.inputSchema.properties.nodes.items.required, ["id"]);
  assert.deepEqual(tool.inputSchema.properties.edges.items.required, ["from", "to"]);
  assert.equal(tool.inputSchema.properties.nodes.items.properties.row.type, "integer");
  await client.close();
  await plain.close();
});

test("a swimlane description is laid out on the cells its nodes name", async function()
{
  const client = await connect({ semanticTypes: resolveSemanticTypes("on"), buildId: "test-build" });
  const result = await client.callTool({ name: "create_semantic_diagram", arguments: LANES });

  assert.equal(result.isError, undefined, JSON.stringify(result.content));

  const payload = JSON.parse(result.content[0].text);
  const xml = payload.xml;

  assert.equal(payload._buildId, "test-build");
  // the viewer learns from the result that it was a description, also where
  // the host hands over no input before it
  assert.equal(payload.described, true);
  // lanes are containers, the steps are their children
  assert.match(xml, /<mxCell id="customer" value="Customer" style="swimlane;/);
  assert.equal(cellOf(xml, "ask").parent, "customer");
  assert.equal(cellOf(xml, "check").parent, "agent");
  // one grid for the whole page: col 3 of both lanes is one column, col 1 too
  assert.equal(cellOf(xml, "done").x, cellOf(xml, "pay").x);
  assert.equal(cellOf(xml, "ask").x, cellOf(xml, "check").x);
  assert.ok(cellOf(xml, "pay").x > cellOf(xml, "ok").x && cellOf(xml, "ok").x > cellOf(xml, "check").x);
  // row 3 is below row 2 in its lane
  assert.ok(cellOf(xml, "no").y > cellOf(xml, "ok").y);
  // the server's passes ran: the label gap on every edge
  assert.match(xml, /defaultLabelBackgroundColor=page/);
  // no shorthand is left for the viewer
  assert.doesNotMatch(xml, /\brole=|\brows=/);

  // the same layout as the engine's with the hints asked for, not with optional ones
  const asked = await semanticToXml(LANES, { hints: "ask" });

  assert.equal(cellOf(asked.xml, "pay").x, cellOf(xml, "pay").x);
  assert.equal(cellOf(asked.xml, "no").y, cellOf(xml, "no").y);
  await client.close();
});

test("the result ends with the link for clients without the app and the note for a short reply", async function()
{
  const client = await connect({ semanticTypes: ["flowchart"] });
  const result = await client.callTool({ name: "create_semantic_diagram",
    arguments: Object.assign({}, LANES, { type: "flowchart" }) });
  const texts = result.content.map(function(c) { return c.text; });

  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  assert.equal(texts.length, 4);
  // how to change it and keep the shapes in place, with the result's layout
  assert.match(texts[1], /call create_semantic_diagram again with layout "[0-9a-z.]+" and the whole changed description: the same ids/);
  assert.ok(texts[1].indexOf("layout \"" + JSON.parse(texts[0]).layout + "\"") > 0);
  assert.match(texts[2], /open it in the\s+draw\.io editor[\s\S]*https:\/\/app\.diagrams\.net\//);
  assert.match(texts[3], /reply in at most two sentences/);
  await client.close();
});

test("lanes, groups as JSON text, source and target, and a row as text are read as the engine reads them", async function()
{
  const client = await connect({ semanticTypes: resolveSemanticTypes("on") });
  const call = function(args)
  {
    return client.callTool({ name: "create_semantic_diagram", arguments: args });
  };
  const loose =
  {
    type: "Swimlane",
    // a key the schema doesn't name: passed on to the engine
    lanes: ["Customer", "Agent"],
    nodes:
    [
      { id: "ask", kind: "start", lane: "Customer", row: "1", col: "1" },
      // the label stands for a missing id, a number for its text
      { label: "check", kind: "step", lane: "Agent", row: 2, col: 1, sub: 42 },
      { id: "done", kind: "end", lane: "Agent", row: 2, col: 2, icon: null }
    ],
    edges: [{ source: "ask", target: "check" }, { from: "check", to: "done", label: null }]
  };
  const lanes = await call(loose);

  assert.equal(lanes.isError, undefined, JSON.stringify(lanes.content));

  const xml = JSON.parse(lanes.content[0].text).xml;

  assert.equal(lanes.content.length, 4, "no warnings: " + JSON.stringify(lanes.content[2]));
  assert.equal(cellOf(xml, "ask").parent, "Customer");
  assert.equal(cellOf(xml, "check").parent, "Agent");
  assert.match(xml, /source="ask" target="check"/);
  assert.ok(cellOf(xml, "done").x > cellOf(xml, "check").x);

  const text = await call(Object.assign({}, LANES, { groups: JSON.stringify(LANES.groups),
    nodes: JSON.stringify(LANES.nodes), edges: JSON.stringify(LANES.edges) }));

  assert.equal(text.isError, undefined, JSON.stringify(text.content));
  assert.equal(cellOf(JSON.parse(text.content[0].text).xml, "pay").parent, "agent");

  // a title as a number, a whole number written with decimals, and an entry
  // that is null (a trailing comma's) are no reason to fail the call either
  const odd = await call(Object.assign({}, LANES, { title: 2026,
    nodes: LANES.nodes.map(function(n, i) { return (i === 0) ? Object.assign({}, n, { row: "1.0", col: " 1 " }) : n; }).concat([null]),
    edges: LANES.edges.concat([null]) }));

  assert.equal(odd.isError, undefined, JSON.stringify(odd.content));
  assert.equal(odd.content.length, 4, "no warnings: " + JSON.stringify(odd.content[2]));
  assert.deepEqual(cellOf(JSON.parse(odd.content[0].text).xml, "ask"), cellOf(JSON.parse(text.content[0].text).xml, "ask"));
  assert.match(JSON.parse(odd.content[0].text).xml, /value="2026"/);

  // what the engine can't read still fails, and says where
  const failed = await call(Object.assign({}, LANES, { nodes: [{ id: "a", row: "top" }] }));

  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /row/);

  const noEnd = await call(Object.assign({}, LANES, { edges: [{ from: "ask" }] }));

  assert.equal(noEnd.isError, true);
  assert.match(noEnd.content[0].text, /to/);

  // a cell between two rows, and an edge as text, which the engine would
  // drop without a word: the model is told instead
  const half = await call(Object.assign({}, LANES, { nodes: [{ id: "a", row: 1.5, col: 1 }] }));

  assert.equal(half.isError, true);
  assert.match(half.content[0].text, /integer[\s\S]*row/);

  const arrow = await call(Object.assign({}, LANES, { edges: ["ask->check"] }));

  assert.equal(arrow.isError, true);
  assert.match(arrow.content[0].text, /edges/);
  await client.close();
});

test("a client that shows nothing is sent to the app's tool of the same name", async function()
{
  // ChatGPT Work's hosted Codex harness: the note names the tool whose
  // arguments these are, since create_diagram takes XML or Mermaid
  const client = await connect({ semanticTypes: resolveSemanticTypes("on"), uiSession: { declared: false, hidden: true,
    markResourceRead: async function() {}, resourceRead: async function() { return false; } } });
  const result = await client.callTool({ name: "create_semantic_diagram", arguments: LANES });
  const note = result.content.find(function(c) { return /https:\/\/app\.diagrams\.net\//.test(c.text); });

  assert.ok(note, JSON.stringify(result.content.map(function(c) { return c.text.slice(0, 80); })));
  assert.match(note.text, /the user can't see this\s+one/);
  assert.match(note.text, /another draw\.io create_semantic_diagram tool/);
  assert.doesNotMatch(note.text, /create_diagram tool/);
  assert.match(note.text, /same arguments/);

  // create_diagram's own note is as before
  const xml = await client.callTool({ name: "create_diagram", arguments: { xml: JSON.parse(result.content[0].text).xml } });
  const xmlNote = xml.content.find(function(c) { return /https:\/\/app\.diagrams\.net\//.test(c.text); });

  assert.match(xmlNote.text, /another draw\.io create_diagram tool/);
  await client.close();
});

// ── The size rule for architecture and network diagrams ─────────────────────

function components(count)
{
  const nodes = [];

  for (let i = 1; i <= count; i++)
  {
    nodes.push({ id: "s" + i, label: "Service " + i, kind: "service", row: Math.ceil(i / 6), col: ((i - 1) % 6) + 1 });
  }

  return nodes;
}

test("the engine draws any size unless the caller asks for the size rule", async function()
{
  const max = MAX_NODES.architecture;

  assert.equal(max, 18);
  assert.equal(MAX_NODES.network, max);
  assert.equal(MAX_NODES.flowchart, undefined);

  const large = { type: "architecture", nodes: components(max + 1) };
  const drawn = await semanticToXml(large, { hints: "ask" });
  const refused = await semanticToXml(large, { hints: "ask", sizeRule: true });
  const fits = await semanticToXml({ type: "architecture", nodes: components(max) }, { hints: "ask", sizeRule: true });

  assert.equal(drawn.error, null);
  assert.equal(refused.xml, null);
  assert.deepEqual(refused.tooLarge, { type: "architecture", nodes: max + 1, max: max });
  assert.match(refused.error, /has 19 nodes.*up to 18/);
  assert.equal(fits.error, null);
});

test("an architecture diagram above the size rule is sent to create_diagram", async function()
{
  const client = await connect({ semanticTypes: ["architecture", "network", "flowchart"] });
  const { tools } = await client.listTools();
  const tool = tools.find(function(t) { return t.name === "create_semantic_diagram"; });

  // the model reads the rule before it writes the description
  assert.equal(tool.inputSchema.properties.type.description,
    "The diagram type. architecture and network: at most 18 nodes; draw larger ones with create_diagram.");

  const call = function(type, count)
  {
    return client.callTool({ name: "create_semantic_diagram", arguments: { type: type, nodes: components(count) } });
  };

  for (const type of ["architecture", "network"])
  {
    const refused = await call(type, 19);

    assert.equal(refused.isError, true, type);
    assert.match(refused.content[0].text, /has 19 nodes.*up to 18\. Draw this one with create_diagram instead/);

    const drawn = await call(type, 18);

    assert.equal(drawn.isError, undefined, type + ": " + JSON.stringify(drawn.content).slice(0, 300));
  }

  // no rule for the types that are judged at least equal at every size
  const flow = await call("flowchart", 30);

  assert.equal(flow.isError, undefined, JSON.stringify(flow.content).slice(0, 300));
  await client.close();
});

// ── The engine in the viewer ─────────────────────────────────────────────────

test("the viewer's engine reads the icon table and the shorthand from the page", async function()
{
  const alone = bundleSemanticEngine();
  const js = bundleSemanticEngine({ externals: VIEWER_GLOBALS });

  // without a second copy of what the viewer has: under half the size
  assert.ok(js.length < alone.length / 2, js.length + " of " + alone.length);
  assert.doesNotMatch(js, /__modules\["icon-table\.js"\] = \(function/);
  assert.doesNotMatch(js, /<\/script/i);

  // the page's globals, as buildHtml defines them: the table without the
  // icons that are data URIs
  const context = { createDiagramShorthand: createDiagramShorthand, expandDiagramShorthand: expandDiagramShorthand,
    createIconResolver: createIconResolver, ICON_TABLE: ICON_TABLE };

  vm.runInNewContext(js + "\nthis.engine = DrawioSemantic;", context);

  for (const d of [LANES, SCHEMA, { type: "architecture", nodes: [{ id: "fn", label: "Resize", icon: "aws lambda" },
    { id: "db", label: "Orders", kind: "database" }], edges: [{ from: "fn", to: "db" }] }])
  {
    const a = await context.engine.semanticToXml(d, { hints: "ask" });
    const b = await semanticToXml(d, { hints: "ask" });

    assert.equal(a.error, null, d.type);
    assert.equal(a.xml, b.xml, d.type);
  }
});

test("the engine comes after the script whose globals it reads, and the preview lays out as the server does", function()
{
  const js = bundleSemanticEngine({ externals: VIEWER_GLOBALS });
  const html = buildHtml("var App = function() {};", "", null, { semanticJs: js });
  const engine = html.indexOf("var DrawioSemantic =");

  assert.ok(engine >= 0);

  for (const name of ["var ICON_TABLE =", "function createIconResolver(", "function createDiagramShorthand(",
    "var expandDiagramShorthand ="])
  {
    const at = html.indexOf(name);

    assert.ok(at >= 0 && at < engine, name);
  }

  assert.match(html, /DrawioSemantic\.semanticToXml\(args, \{ hints: "ask" \}\)/);
});

test("the Worker offers the types its HTML was built for", async function()
{
  const fs = await import("node:fs");
  const read = function(name)
  {
    return fs.readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
  };

  // read at build time, since the HTML is built before the deploy, and
  // exported for the worker's createServer
  assert.match(read("build-html.js"), /const semanticTypes = resolveSemanticTypes\(process\.env\.DRAWIO_SEMANTIC_TYPES\);/);
  assert.match(read("build-html.js"), /export const semanticTypes = \$\{JSON\.stringify\(semanticTypes\)\};/);
  assert.match(read("worker.js"), /import \{[^}]*\bsemanticTypes\b[^}]*\} from "\.\/generated-html\.js";/);
  assert.match(read("worker.js"), /\n\s+semanticTypes,\n/);
});
