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

test("an empty plantuml or csv beside XML or Mermaid is a parameter the call doesn't use", async function()
{
  const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
  const result = await call(ui, { xml: xml, plantuml: "", csv: "  \n" });
  const mermaid = await call(ui, { mermaid: "flowchart TD\n  A --> B", plantuml: "", csv: "" });

  assert.equal(result.isError, undefined);
  assert.equal(typeof payload(result).xml, "string");
  assert.equal(payload(result).plantuml, undefined);
  assert.equal(mermaid.isError, undefined);
  assert.equal(payload(mermaid).mermaid, "flowchart TD\n  A --> B");
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

// sourceArgument is the server's own function, put in the viewer as it is
function serverFunctions(names)
{
  const body = names.map(function(name)
  {
    const m = source.match(new RegExp("\\nfunction " + name + "\\([^)]*\\)\\n\\{\\n[\\s\\S]*?\\n\\}\\n"));

    assert.ok(m, name + " not found in src/shared.js");

    return m[0];
  }).join("");

  return new Function(body + "\nreturn { " + names.map(function(name) { return name + ": " + name; }).join(", ") + " };")();
}

test("the viewer counts plantuml and csv as given only with more than white space, as the server does", function()
{
  const { sourceArgument } = serverFunctions(["trimCsv", "sourceArgument"]);
  const xml = "<mxGraphModel><root></root></mxGraphModel>";

  assert.ok(source.includes("${sourceArgument.toString()}"));
  assert.deepEqual(sourceArgument({ plantuml: plantuml }), { format: "plantuml", text: plantuml });
  assert.deepEqual(sourceArgument({ csv: "\n  \n" + csv }), { format: "csv", text: csv });
  // the unused parameters of an XML or Mermaid call, sent as "" by some hosts
  assert.equal(sourceArgument({ xml: xml, plantuml: "", csv: "" }), null);
  assert.equal(sourceArgument({ mermaid: "flowchart TD", plantuml: " \n", csv: "\t" }), null);
  assert.deepEqual(sourceArgument({ plantuml: "", csv: csv }), { format: "csv", text: csv });
  assert.equal(sourceArgument({ plantuml: null, csv: 3 }), null);
  assert.equal(sourceArgument(undefined), null);
  assert.equal(sourceArgument(null), null);
});

// renderSourceDiagram from the template, with stand-ins for the conversion,
// the drawing and the error, and the conversions it started held open
function sourceRenderer()
{
  const m = source.match(/\nfunction renderSourceDiagram\([^)]*\)\n\{\n[\s\S]*?\n\}\n/);

  assert.ok(m, "renderSourceDiagram not found in src/shared.js");

  const state = { drawn: [], errors: [], conversions: [] };
  const fns = new Function("state",
    "var sourceRender = null, currentMermaidText = null, currentSourceFormat = null, currentPlantUmlText = null;\n" +
    "var mermaidPreviewEl = { style: {} };\n" +
    "function waitForGraphViewer() { return Promise.resolve(); }\n" +
    "function whenDocumentLaidOut() {}\n" +
    "function convertSourceToXml(format, text) { return new Promise(function(resolve, reject) " +
    "{ state.conversions.push({ resolve: resolve, reject: reject }); }); }\n" +
    "function finalizeStreamingView(xml) { state.drawn.push(xml); }\n" +
    "function showError(message) { state.errors.push(message); }\n" +
    m[0].replace(/\\\\/g, "\\") +
    "\nreturn { render: renderSourceDiagram, inFlight: function() { return sourceRender != null; }, " +
    // what endStreaming and the tool result do
    "drop: function() { sourceRender = null; } };")(state);

  return Object.assign(state, fns);
}

function settle()
{
  return new Promise(function(resolve) { setTimeout(resolve, 0); });
}

test("a PlantUML or CSV conversion that settles after the tool result or the stream's end is dropped", async function()
{
  const endStreaming = source.match(/\nfunction endStreaming\(\)\n\{\n[\s\S]*?\n\}\n/);
  const onResult = source.match(/\napp\.ontoolresult = function\(result\)\n\{\n[\s\S]*?\n\};\n/);

  // endStreaming (the server's error) and the result drop the render in flight
  assert.match(endStreaming[0], /\n  sourceRender = null;\n/);
  assert.match(onResult[0], /\n    sourceRender = null;\n/);

  // the server's error: endStreaming, then the conversion of the tool input settles
  let r = sourceRenderer();

  r.render("plantuml", plantuml, {});
  await settle();
  assert.equal(r.inFlight(), true);
  r.drop();
  r.conversions[0].resolve("<mxGraphModel/>");
  await settle();
  assert.deepEqual(r.drawn, []);
  assert.deepEqual(r.errors, []);

  r = sourceRenderer();
  r.render("csv", csv, {});
  await settle();
  r.drop();
  r.conversions[0].reject(new Error("no data"));
  await settle();
  assert.deepEqual(r.errors, []);

  // the result's render takes over from the tool input's
  r = sourceRenderer();
  r.render("plantuml", plantuml, {});
  r.render("plantuml", plantuml, {});
  await settle();
  r.conversions[0].reject(new Error("stale"));
  r.conversions[1].resolve("<mxGraphModel/>");
  await settle();
  assert.deepEqual(r.drawn, ["<mxGraphModel/>"]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.inFlight(), false);

  // a render of its own still shows its diagram or its error
  r = sourceRenderer();
  r.render("plantuml", "@startchen\n@endchen", {});
  await settle();
  r.conversions[0].reject(new Error("not supported"));
  await settle();
  assert.deepEqual(r.errors, ["Failed to convert PlantUML diagram: not supported"]);
  assert.equal(r.inFlight(), false);
});
