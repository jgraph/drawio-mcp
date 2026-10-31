import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { createServer, clientRendersUi, clientUiState } from "../src/shared.js";

// Which clients create_diagram hands the "open in draw.io" link: those that
// don't declare the MCP Apps UI capability, and those known to declare it
// without ever rendering the app — ChatGPT Work's hosted Codex harness, which
// runs a plugin's MCP server and sends "codex-mcp-client" without a release
// version. The Codex app and CLI send their real version. Only the harness
// gets a note that says the user can't see the diagram: clients that declare
// nothing may still show it (Claude.ai), so theirs stays a condition.

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

test("clientUiState tells declared, hidden and undeclared apart", function()
{
  assert.equal(clientUiState(UI, { name: "openai-mcp", version: "1.0.0" }), "renders");
  assert.equal(clientUiState(UI, { name: "codex-mcp-client", version: "0.0.0" }), "hidden");
  assert.equal(clientUiState({}, { name: "codex-mcp-client", version: "0.0.0" }), "none");
  assert.equal(clientUiState({}, { name: "claude-ai", version: "0.1.0" }), "none");
});

async function linkBlock(clientInfo, capabilities = UI)
{
  const server = createServer("", { iconServiceUrl: null });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  const client = new Client(clientInfo, { capabilities: capabilities });

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

test("the note sends the model to the draw.io app first, the link second", async function()
{
  const block = await linkBlock({ name: "codex-mcp-client", version: "0.0.0", title: "Codex" });

  // Worded as a condition, the note was ignored in ChatGPT Work: the model
  // assumed the diagram showed. For this client the server knows it doesn't.
  assert.doesNotMatch(block.text, /^If this client/);
  assert.match(block.text, /the user can't see this one/);
  assert.match(block.text, /another draw\.io create_diagram tool/);
  assert.match(block.text, /same arguments/);
  assert.ok(block.text.indexOf("create_diagram") < block.text.indexOf("https://app.diagrams.net/"));
});

test("a client that declares nothing gets the note as a condition", async function()
{
  // Claude.ai often declares nothing and still shows the diagram. Told the
  // user couldn't see it (1.4.5), Claude said the diagram didn't display.
  const block = await linkBlock({ name: "claude-ai", version: "0.1.0" }, {});

  assert.match(block.text, /^If this client doesn't show the diagram inline/);
  assert.doesNotMatch(block.text, /can't see/);
  assert.doesNotMatch(block.text, /another draw\.io create_diagram tool/);
});

test("create_diagram gives no link to a Codex release that declares the capability", async function()
{
  assert.equal(await linkBlock({ name: "codex-mcp-client", version: "0.166.0", title: "Codex" }), undefined);
});
