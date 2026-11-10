import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/shared.js";

// create_diagram moves a waypoint that lies less than 3 px off the line of a
// fixed connection point onto it (shared/edge-waypoints.js, tested in detail
// in the tool server): a pixel off, draw.io's router adds a jog of that size
// at the shape, and the arrowhead on it points along the side.

let client;

before(async function()
{
  const server = createServer("", { iconServiceUrl: null, xmlReference: "XML REFERENCE", mermaidReference: "MERMAID REFERENCE" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  client = new Client({ name: "edge-waypoints-test", version: "0.0.0" });
  await client.connect(clientTransport);
});

after(async function()
{
  await client.close();
});

test("the last waypoint of an arrow 1.2 px off its entry point is snapped, leaving 35 px for the arrowhead", async function()
{
  // The entry point is on the right side of "x10": y = 402 + 0.6 * 178 = 508.8
  const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="x10" value="Backup disk" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">' +
    '<mxGeometry x="45" y="402" width="520" height="178" as="geometry"/></mxCell>' +
    '<mxCell id="sky" value="MacBook" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">' +
    '<mxGeometry x="635" y="517" width="520" height="120" as="geometry"/></mxCell>' +
    '<mxCell id="tm" value="TM" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;' +
    'exitX=0;exitY=0.36;exitDx=0;exitDy=0;entryX=1;entryY=0.6;entryDx=0;entryDy=0;" edge="1" parent="1" ' +
    'source="sky" target="x10"><mxGeometry relative="1" as="geometry"><Array as="points">' +
    '<mxPoint x="600" y="560"/><mxPoint x="600" y="510"/></Array></mxGeometry></mxCell></root></mxGraphModel>';
  const result = await client.callTool({ name: "create_diagram", arguments: { xml: xml } });
  const sent = JSON.parse(result.content[0].text).xml;
  const points = sent.match(/<Array as="points">([\s\S]*?)<\/Array>/)[1];

  // From the last waypoint at x = 600 straight into the side at x = 45 + 520
  assert.equal(points, '<mxPoint x="600" y="560.2" /><mxPoint x="600" y="508.8" />');
});
