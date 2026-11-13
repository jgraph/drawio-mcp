import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, buildHtml } from "../src/shared.js";

// `icon=aws lambda` in a vertex style stands for the official icon
// (shared/icon-resolver.js, its cases in the tool server's
// test/icon-resolver.test.js). create_diagram resolves it before the other
// passes, and the viewer resolves it while the XML streams in.

let client;

before(async function()
{
  const server = createServer("", { iconServiceUrl: null, xmlReference: "XML REFERENCE", mermaidReference: "MERMAID REFERENCE" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  client = new Client({ name: "icon-names-test", version: "0.0.0" });
  await client.connect(clientTransport);
});

after(async function()
{
  await client.close();
});

function diagram(cells)
{
  return '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' + cells + '</root></mxGraphModel>';
}

function cellStyle(xml, id)
{
  const match = new RegExp('<mxCell id="' + id + '"[^>]*?style="([^"]*)"').exec(xml);

  assert.ok(match, "no style on cell " + id);

  return match[1];
}

test("create_diagram puts in the icon, a VPC group around its children, and edges end at the icon's label", async function()
{
  const xml = diagram(
    '<mxCell id="vpc" value="VPC" style="icon=aws vpc;" vertex="1" parent="1">' +
    '<mxGeometry x="40" y="40" width="400" height="240" as="geometry"/></mxCell>' +
    '<mxCell id="fn" value="Orders" style="icon=aws lambda;fontSize=12;" vertex="1" parent="vpc">' +
    '<mxGeometry x="60" y="80" width="48" height="48" as="geometry"/></mxCell>' +
    '<mxCell id="db" value="Orders DB" style="icon=aws dynamodb;" vertex="1" parent="vpc">' +
    '<mxGeometry x="260" y="80" width="48" height="48" as="geometry"/></mxCell>' +
    '<mxCell id="e" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="fn" target="db">' +
    '<mxGeometry relative="1" as="geometry"/></mxCell>');
  const result = await client.callTool({ name: "create_diagram", arguments: { xml: xml } });
  const sent = JSON.parse(result.content[0].text).xml;

  assert.doesNotMatch(sent, /icon=aws/);
  assert.match(cellStyle(sent, "vpc"), /shape=mxgraph\.aws4\.group;grIcon=mxgraph\.aws4\.group_vpc2;/);
  assert.match(cellStyle(sent, "vpc"), /container=1/);
  assert.match(cellStyle(sent, "fn"), /shape=mxgraph\.aws4\.resourceIcon;resIcon=mxgraph\.aws4\.lambda;/);
  assert.match(cellStyle(sent, "fn"), /fontSize=12;/);
  assert.match(cellStyle(sent, "fn"), /labelPerimeter=1/);
  assert.match(cellStyle(sent, "db"), /resIcon=mxgraph\.aws4\.dynamodb;/);
  assert.doesNotMatch(result.content.map(function(c) { return c.text; }).join("\n"), /WARNINGS|matched no icon/);
});

test("a name that matches no icon stays as written and the model is told what to write", async function()
{
  const xml = diagram(
    '<mxCell id="pay" value="Payments" style="icon=aws payment flux;" vertex="1" parent="1">' +
    '<mxGeometry x="40" y="40" width="48" height="48" as="geometry"/></mxCell>');
  const result = await client.callTool({ name: "create_diagram", arguments: { xml: xml } });
  const sent = JSON.parse(result.content[0].text).xml;
  const warnings = result.content.map(function(c) { return c.text; }).join("\n");

  assert.match(cellStyle(sent, "pay"), /^icon=aws payment flux;/);
  assert.match(warnings, /icon=aws payment flux \(cell pay\) matched no icon: name the provider and the service/);
});

test("Google Cloud icons that are images get their data URI on the server", async function()
{
  const xml = diagram(
    '<mxCell id="ps" value="Events" style="icon=gcp pub/sub;" vertex="1" parent="1">' +
    '<mxGeometry x="40" y="40" width="48" height="48" as="geometry"/></mxCell>');
  const result = await client.callTool({ name: "create_diagram", arguments: { xml: xml } });
  const sent = JSON.parse(result.content[0].text).xml;

  assert.match(cellStyle(sent, "ps"), /shape=image;.*image=data:image\/svg\+xml,/);
});

test("the viewer resolves names while the XML streams in, without the image data", function()
{
  const html = buildHtml("", "", "", {});
  const start = html.indexOf("// --- Icons by name");
  const end = html.indexOf("// --- XML healing");

  assert.ok(start > 0 && end > start, "icon block not found in the app HTML");

  const block = html.substring(start, end);
  const context = vm.createContext({});

  // The data URIs stay on the server: the block is the table, not the data.
  assert.ok(block.length < 200000, "icon block is " + block.length + " characters");
  assert.doesNotMatch(block, /data:image\/[^,]*,[A-Za-z0-9+\/%]{20}/);

  vm.runInContext(block + "\nthis.expandIcons = expandIcons;", context);

  // A partial diagram: the last cell's tag isn't complete yet.
  const partial = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="fn" value="a -&gt; b" style="icon=aws lambda;" vertex="1" parent="1">' +
    '<mxGeometry x="40" y="40" width="48" height="48" as="geometry"/></mxCell>' +
    '<mxCell id="ps" value="Events" style="icon=gcp pub/sub;" vertex="1" parent="1">' +
    '<mxGeometry x="140" y="40" width="48" height="48" as="geometry"/></mxCell>' +
    '<mxCell id="q" value="Queue" style="icon=aws s';
  const expanded = context.expandIcons(partial);

  assert.match(cellStyle(expanded, "fn"), /resIcon=mxgraph\.aws4\.lambda;/);
  // Without the data, the image icon is a placeholder until the result.
  assert.match(cellStyle(expanded, "ps"), /^rounded=1;arcSize=16;fillColor=#F1F3F4;/);
  assert.ok(expanded.endsWith('<mxCell id="q" value="Queue" style="icon=aws s'));
  // Resolved XML, and XML without names, pass unchanged.
  assert.equal(context.expandIcons(expanded), expanded);
  assert.equal(context.expandIcons(diagram("")), diagram(""));
});
