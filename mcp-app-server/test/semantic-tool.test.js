import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, buildHtml, resolveSemanticTypes, SEMANTIC_TYPES_ON } from "../src/shared.js";
import { bundleSemanticEngine } from "../src/semantic-bundle.js";
import { semanticToXml } from "../../shared/semantic/index.js";

// create_semantic_diagram: the model describes the diagram, the semantic
// engine (shared/semantic) lays it out. The tool is only listed with a type
// switched on (none by default, so tools/list doesn't change), and the
// viewer gets the engine as a classic script for its preview while a
// description streams in (src/semantic-bundle.js).

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
  assert.deepEqual(resolveSemanticTypes(" ER , flowchart,er"), ["er"]);
  assert.deepEqual(resolveSemanticTypes("off"), []);
  assert.deepEqual(resolveSemanticTypes(""), []);
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
  assert.match(result.content[1].text, /^WARNINGS \(left out of the diagram\):/);
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
  assert.deepEqual(Array.from(context.engine.SUPPORTED_TYPES), ["er"]);
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
