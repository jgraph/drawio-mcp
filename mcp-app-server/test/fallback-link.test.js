import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { createServer, clientRendersUi } from "../src/shared.js";

// Which clients create_diagram hands the "open in draw.io" link: those that
// don't declare the MCP Apps UI capability, and those known to declare it
// without ever rendering the app — ChatGPT Work's hosted Codex harness, which
// runs a plugin's MCP server and sends "codex-mcp-client" without a release
// version. The Codex app and CLI send their real version.

const UI = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [RESOURCE_MIME_TYPE] } } };

const xml = '<mxGraphModel adaptiveColors="auto"><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="a" value="A" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">' +
  '<mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel>';

test("a client that declares the UI capability renders the app", function()
{
  assert.equal(clientRendersUi(UI, { name: "openai-mcp", version: "1.0.0" }), true);
  assert.equal(clientRendersUi(UI, { name: "codex-mcp-client", version: "0.166.0-alpha.5.1", title: "Codex" }), true);
  assert.equal(clientRendersUi(UI, undefined), true);
});

test("a client without the declaration doesn't", function()
{
  assert.equal(clientRendersUi({}, { name: "claude-code", version: "2.1.314" }), false);
  assert.equal(clientRendersUi(null, null), false);
});

test("ChatGPT Work's hosted Codex harness doesn't, although it declares it", function()
{
  assert.equal(clientRendersUi(UI, { name: "codex-mcp-client", version: "0.0.0", title: "Codex" }), false);
});

async function linkBlock(clientInfo)
{
  const server = createServer("", { iconServiceUrl: null });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  const client = new Client(clientInfo, { capabilities: UI });

  await client.connect(clientTransport);

  try
  {
    const result = await client.callTool({ name: "create_diagram", arguments: { xml: xml } });

    return result.content.find(function(item)
    {
      return item.type === "text" && item.text.includes("https://app.diagrams.net/");
    });
  }
  finally
  {
    await client.close();
  }
}

test("create_diagram gives the hosted Codex harness the link", async function()
{
  assert.ok(await linkBlock({ name: "codex-mcp-client", version: "0.0.0", title: "Codex" }));
});

test("create_diagram gives no link to a Codex release that declares the capability", async function()
{
  assert.equal(await linkBlock({ name: "codex-mcp-client", version: "0.166.0", title: "Codex" }), undefined);
});
