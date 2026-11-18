import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pako from "pako";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { buildHtml, createServer, PLANTUML_URL } from "../src/shared.js";

// create_diagram's plantuml and csv inputs. The viewer converts them with
// draw.io's own converters (drawio-plantuml, loaded from the CDN for a
// PlantUML diagram, and the CSV import of the viewer bundle); the server
// checks what would fail there and hands the source on. The conversion itself
// needs a browser: it was checked in headless Chrome with the app resource in
// a sandboxed frame (sequence and class diagrams, an org chart with %fill% in
// its style, stylePlaceholders=1, an ELK layout).

const UI = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [RESOURCE_MIME_TYPE] } } };

const plantuml = "@startuml\nAlice -> Bob: hello\nBob --> Alice: hi\n@enduml";

// %fill% in the style: draw.io's import puts each row's value there
const csv = "# label: %name%\n" +
  "# style: rounded=1;whiteSpace=wrap;html=1;fillColor=%fill%;\n" +
  "# connect: {\"from\": \"manager\", \"to\": \"name\", \"invert\": true}\n" +
  "# layout: verticaltree\n" +
  "name,manager,fill\n" +
  "Ada,,#dae8fc\n" +
  "Bob,Ada,#d5e8d4\n";

let ui;
let plain;

async function connect(capabilities)
{
  const server = createServer("", { iconServiceUrl: null, buildId: "test" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  const client = new Client({ name: "plantuml-csv-test", version: "0.0.0" }, { capabilities: capabilities });

  await client.connect(clientTransport);

  return client;
}

before(async function()
{
  ui = await connect(UI);
  plain = await connect({});
});

after(async function()
{
  await ui.close();
  await plain.close();
});

function call(client, args)
{
  return client.callTool({ name: "create_diagram", arguments: args });
}

function payload(result)
{
  return JSON.parse(result.content[0].text);
}

function texts(result)
{
  return result.content.map(function(block) { return block.text; }).join("\n");
}

test("create_diagram takes plantuml and csv", async function()
{
  const { tools } = await ui.listTools();
  const tool = tools.find(function(t) { return t.name === "create_diagram"; });

  assert.ok(tool.inputSchema.properties.plantuml != null);
  assert.ok(tool.inputSchema.properties.csv != null);
  assert.match(tool.description, /PlantUML or CSV/);
});

test("PlantUML is handed to the viewer as it is", async function()
{
  const result = await call(ui, { plantuml: plantuml, postLayout: "elk", routing: "libavoid" });

  assert.equal(result.isError, undefined);
  // the pass options are for XML and Mermaid
  assert.deepEqual(payload(result), { plantuml: plantuml, _buildId: "test" });
});

test("CSV is handed to the viewer without the blank lines before it", async function()
{
  const result = await call(ui, { csv: "\n  \n" + csv });

  assert.equal(result.isError, undefined);
  assert.deepEqual(payload(result), { csv: csv, _buildId: "test" });
});

test("exactly one format", async function()
{
  const none = await call(ui, {});
  const two = await call(ui, { plantuml: plantuml, csv: csv });

  assert.equal(none.isError, true);
  assert.match(texts(none), /Provide exactly one of 'xml', 'mermaid', 'plantuml' or 'csv'. None was provided/);
  assert.equal(two.isError, true);
  assert.match(texts(two), /More than one was provided/);
});

test("PlantUML without its @start and @end lines is an error the model can fix", async function()
{
  const noWrapper = await call(ui, { plantuml: "Alice -> Bob: hello" });
  const noEnd = await call(ui, { plantuml: "@startuml\nAlice -> Bob: hello" });

  assert.equal(noWrapper.isError, true);
  assert.match(texts(noWrapper), /@startuml and @enduml/);
  assert.equal(noEnd.isError, true);
});

test("PlantUML passed as xml or mermaid is drawn as PlantUML", async function()
{
  for (const key of ["xml", "mermaid"])
  {
    const args = {};

    args[key] = plantuml;

    const result = await call(ui, args);

    assert.equal(result.isError, undefined);
    assert.equal(payload(result).plantuml, plantuml);
    assert.match(texts(result), new RegExp("the `" + key + "` argument held PlantUML"));
  }
});

test("CSV without data lines or with the orgchart layout is an error the model can fix", async function()
{
  const noData = await call(ui, { csv: "# label: %name%\nname\n" });
  const orgChart = await call(ui, { csv: csv.replace("verticaltree", "orgchart") });

  assert.equal(noData.isError, true);
  assert.match(texts(noData), /header line and at least one data line/);
  assert.equal(orgChart.isError, true);
  assert.match(texts(orgChart), /# layout: verticaltree/);
  // a comment that names the layout is no layout
  assert.equal((await call(ui, { csv: "## layout: orgchart\n" + csv })).isError, undefined);
});

// draw.io's Graph.decompress runs decodeURIComponent on the inflated data, so
// CSV compressed as it is fails there with "URI malformed" on the %fi of a
// %fill% placeholder. The link encodes it first, as the tool server does.
test("the link for a client without the app carries CSV placeholders intact", async function()
{
  assert.throws(function() { decodeURIComponent(csv); }, URIError);

  const result = await call(plain, { csv: csv });
  const url = new URL(texts(result).match(/https:\/\/app\.diagrams\.net\/\S+/)[0]);
  const create = JSON.parse(decodeURIComponent(url.hash.substring("#create=".length)));
  const data = decodeURIComponent(pako.inflateRaw(Buffer.from(create.data, "base64"), { to: "string" }));

  assert.equal(create.type, "csv");
  assert.equal(data, csv);
});

test("a client without the app is told to redraw PlantUML for a link", async function()
{
  const result = await call(plain, { plantuml: plantuml });
  const text = texts(result);

  assert.equal(result.isError, undefined);
  assert.doesNotMatch(text, /https:\/\/app\.diagrams\.net/);
  assert.match(text, /a draw.io link can't carry PlantUML/);
  assert.match(text, /as `mermaid` or `xml`/);
});

test("the viewer loads drawio-plantuml from the CDN unless it is inlined", function()
{
  const loaded = buildHtml("var App = function() {};", "", null, {});
  const inlined = buildHtml("var App = function() {};", "", null, { plantumlJs: "var mxPlantUmlToDrawio = {};" });

  assert.equal(PLANTUML_URL, "https://viewer.diagrams.net/js/plantuml/drawio-plantuml.min.js");
  assert.ok(loaded.includes("var PLANTUML_URL = " + JSON.stringify(PLANTUML_URL) + ";"));
  // no script element for it: it is loaded when a PlantUML diagram comes in
  assert.ok(!loaded.includes('src="' + PLANTUML_URL + '"'));
  assert.ok(!loaded.includes("var mxPlantUmlToDrawio = {};"));
  assert.ok(inlined.includes("<script>var mxPlantUmlToDrawio = {};</script>"));
});

// The viewer's helpers, taken from the template and run here
const source = readFileSync(new URL("../src/shared.js", import.meta.url), "utf-8");

function viewerFunction(name)
{
  const m = source.match(new RegExp("\\nfunction " + name + "\\([^)]*\\)\\n\\{\\n[\\s\\S]*?\\n\\}\\n"));

  assert.ok(m, name + " not found in src/shared.js");

  return new Function(m[0].replace(/\\\\/g, "\\") + "\nreturn " + name + ";")();
}

test("the viewer leaves PlantUML in mermaid to the server", function()
{
  const isPlantUmlText = viewerFunction("isPlantUmlText");

  assert.equal(isPlantUmlText(plantuml), true);
  assert.equal(isPlantUmlText("  @startmindmap\n* a\n@endmindmap"), true);
  assert.equal(isPlantUmlText("sequenceDiagram\n  A->>B: hi"), false);
  assert.equal(isPlantUmlText("flowchart TD\n  A[\"@start\"] --> B"), false);
});

test("the model gets a converted PlantUML or CSV diagram as XML", function()
{
  const modelContextText = viewerFunction("modelContextText");
  const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
  const text = modelContextText(xml, null, "none", false, false, 60000, false, null, "PlantUML");

  assert.match(text, /\(your PlantUML diagram converted to draw\.io XML\)/);
  assert.match(text, /can still be made in the PlantUML source/);
  assert.ok(text.endsWith("\n\n" + xml));
  assert.match(modelContextText(xml, null, "none", false, false, 60000, false, null, "CSV"),
    /your CSV diagram converted/);
  // plain XML shown as sent still isn't repeated
  assert.equal(modelContextText(xml, null, "none", false, false, 60000, false, null, null), null);
});
