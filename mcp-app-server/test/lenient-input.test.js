import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/shared.js";

// Slips models make in their arguments that the server forgives instead of
// answering with an error: text before the XML, a diagram passed under the
// other parameter, null / "none" / another case / LR for an option, "XML" for
// the reference format. Values that are still unknown keep failing, and the
// schemas in tools/list stay as they are.

const xml = '<mxGraphModel adaptiveColors="auto"><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="a" value="A" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">' +
  '<mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel>';

const mermaid = "flowchart LR\n  A[Start] --> B[End]";

let client;

before(async function()
{
  const server = createServer("", { iconServiceUrl: null, xmlReference: "XML REFERENCE", mermaidReference: "MERMAID REFERENCE" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  client = new Client({ name: "lenient-input-test", version: "0.0.0" });
  await client.connect(clientTransport);
});

after(async function()
{
  await client.close();
});

function call(name, args)
{
  return client.callTool({ name: name, arguments: args });
}

function payload(result)
{
  assert.ok(!result.isError, JSON.stringify(result.content));

  return JSON.parse(result.content[0].text);
}

function texts(result)
{
  return result.content.map(function(item) { return item.text; }).join("\n");
}

test("text before the XML is dropped", async function()
{
  for (const args of [{ xml: "```xml\n" + xml + "\n```" }, { xml: "Here is the diagram:\n" + xml }])
  {
    assert.equal(payload(await call("create_diagram", args)).xml, xml);
  }
});

test("XML wrapped in JSON is still unwrapped", async function()
{
  assert.equal(payload(await call("create_diagram", { xml: JSON.stringify({ text: xml }) })).xml, xml);
});

test("Mermaid passed as xml is drawn as Mermaid, and the model is told", async function()
{
  const result = await call("create_diagram", { xml: mermaid });

  assert.equal(payload(result).mermaid, mermaid);
  assert.match(texts(result), /Pass Mermaid as `mermaid`/);
});

test("draw.io XML passed as mermaid is drawn as XML, and the model is told", async function()
{
  const result = await call("create_diagram", { mermaid: xml });

  assert.equal(payload(result).xml, xml);
  assert.match(texts(result), /Pass draw.io XML as `xml`/);
});

test("text that is neither XML nor Mermaid is still an error", async function()
{
  const result = await call("create_diagram", { xml: "a diagram of my house" });

  assert.equal(result.isError, true);
  assert.match(texts(result), /Could not extract draw.io XML/);
});

test("null, none and off leave an option unset", async function()
{
  const result = payload(await call("create_diagram", { xml: xml, postLayout: null, direction: "None", routing: "off" }));

  assert.equal(result.postLayout, undefined);
  assert.equal(result.direction, undefined);
  assert.equal(result.routing, undefined);
});

test("captureImage accepts string booleans and null", async function()
{
  for (const captureImage of ["true", "false", null])
  {
    const result = await call("create_diagram", { xml: xml, captureImage: captureImage });

    assert.ok(!result.isError, String(captureImage));
  }

  const invalid = await call("create_diagram", { xml: xml, captureImage: "yes" });
  assert.equal(invalid.isError, true);
});

test("options take any case, and LR/RL and TB/TD/BT name the direction", async function()
{
  const cases = [["LR", "horizontal"], ["rl", "horizontal"], ["TB", "vertical"], ["td", "vertical"], ["BT", "vertical"], ["Horizontal", "horizontal"]];

  for (const [direction, expected] of cases)
  {
    const result = payload(await call("create_diagram", { xml: xml, postLayout: "ELK", direction: direction }));

    assert.equal(result.postLayout, "elk");
    assert.equal(result.direction, expected, direction);
  }

  assert.equal(payload(await call("create_diagram", { xml: xml, routing: " LibAvoid " })).routing, "libavoid");
});

test("an unknown option value is still rejected, quoted as the model wrote it", async function()
{
  const result = await call("create_diagram", { xml: xml, routing: "Orthogonal" });

  assert.equal(result.isError, true);
  assert.match(texts(result), /'Orthogonal'/);
});

test("the reference format takes any case, and drawio means xml", async function()
{
  for (const [format, expected] of [["XML", "XML REFERENCE"], ["Mermaid", "MERMAID REFERENCE"], ["drawio", "XML REFERENCE"]])
  {
    const result = await call("get_drawio_reference", { format: format });

    assert.ok(!result.isError, format);
    assert.equal(result.content[0].text, expected);
  }

  assert.equal((await call("get_drawio_reference", { format: "svg" })).isError, true);
});

test("tools/list advertises the strict schemas", async function()
{
  const tools = (await client.listTools()).tools;
  const create = tools.find(function(tool) { return tool.name === "create_diagram"; }).inputSchema;
  const reference = tools.find(function(tool) { return tool.name === "get_drawio_reference"; }).inputSchema;

  assert.deepEqual(create.properties.postLayout.enum, ["elk"]);
  assert.deepEqual(create.properties.direction.enum, ["vertical", "horizontal"]);
  assert.deepEqual(create.properties.routing.enum, ["libavoid"]);
  assert.equal(create.properties.postLayout.type, "string");
  assert.equal(create.required, undefined);
  assert.deepEqual(reference.properties.format.enum, ["xml", "mermaid"]);
  assert.deepEqual(reference.required, ["format"]);
});
