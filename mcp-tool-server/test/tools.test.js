import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Runs the real server over stdio and checks what a client sees in tools/list
// and get_drawio_reference.

// Clients index tool descriptions: VS Code Copilot embeds them in batches for
// its tool search, and one description over the embedding limit fails the
// whole batch, other servers' tools included (jgraph/drawio-mcp#76). The
// references used to be appended to two descriptions (~35k / 14k characters);
// they are served by get_drawio_reference now, and this keeps them out.
const MAX_DESCRIPTION_LENGTH = 2048;

const server = fileURLToPath(new URL("../src/index.js", import.meta.url));

function readShared(name)
{
  return readFileSync(new URL("../../shared/" + name, import.meta.url), "utf-8");
}

let client;

before(async function()
{
  client = new Client({ name: "tools-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport(
  {
    command: process.execPath,
    args: [server],
    stderr: "ignore",
  }));
});

after(async function()
{
  await client.close();
});

test("every tool description stays short", async function()
{
  const { tools } = await client.listTools();

  assert.ok(tools.length > 0);

  for (const tool of tools)
  {
    assert.ok(tool.description.length <= MAX_DESCRIPTION_LENGTH,
      tool.name + " description is " + tool.description.length +
      " characters (max " + MAX_DESCRIPTION_LENGTH + ")");
  }
});

test("the diagram tools point at get_drawio_reference", async function()
{
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map(function(tool) { return [tool.name, tool]; }));

  assert.deepEqual(byName.get_drawio_reference.inputSchema.properties.format.enum,
    ["xml", "mermaid"]);
  assert.match(byName.open_drawio_xml.description, /get_drawio_reference with format "xml"/);
  assert.match(byName.open_drawio_mermaid.description, /get_drawio_reference with format "mermaid"/);
});

test("open_drawio_xml inlines the XML essentials", async function()
{
  const { tools } = await client.listTools();
  const xmlTool = tools.find(function(tool) { return tool.name === "open_drawio_xml"; });

  const essentials = readShared("xml-essentials.md").trim();

  // Without the label gap, which fitEdgeLabels adds to every edge
  assert.ok(essentials.includes("defaultLabelBackgroundColor=page;"));
  assert.ok(xmlTool.description.includes(essentials.replace("defaultLabelBackgroundColor=page;", "")));
  assert.ok(!xmlTool.description.includes("defaultLabelBackgroundColor"));
});

test("get_drawio_reference returns the shared references", async function()
{
  const xml = await client.callTool({ name: "get_drawio_reference", arguments: { format: "xml" } });
  const mermaid = await client.callTool({ name: "get_drawio_reference", arguments: { format: "mermaid" } });

  assert.equal(xml.isError, undefined);
  assert.deepEqual(xml.content, [{ type: "text", text: readShared("xml-reference.md") }]);
  assert.equal(mermaid.isError, undefined);
  assert.deepEqual(mermaid.content, [{ type: "text", text: readShared("mermaid-reference.md") }]);
});

test("get_drawio_reference rejects an unknown format", async function()
{
  for (const args of [{ format: "csv" }, { format: "toString" }, {}])
  {
    const result = await client.callTool({ name: "get_drawio_reference", arguments: args });

    assert.equal(result.isError, true, JSON.stringify(args));
    assert.match(result.content[0].text, /format must be "xml" or "mermaid"/);
  }
});
