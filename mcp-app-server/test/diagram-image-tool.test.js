import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/shared.js";
import { createImageStore } from "../src/image-store.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a+UAAAAASUVORK5CYII=";

test("a client can retrieve the viewer's PNG through the image tool", async function()
{
  const server = createServer("", { imageStore: createImageStore() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "image-test", version: "1" });
  await client.connect(clientTransport);
  try
  {
    const plain = await client.callTool({ name: "create_diagram", arguments: { mermaid: "flowchart LR\nA-->B" } });
    assert.equal(JSON.parse(plain.content[0].text).imageId, undefined);
    const diagram = await client.callTool({ name: "create_diagram", arguments: { mermaid: "flowchart LR\nA-->B", captureImage: true } });
    const id = JSON.parse(diagram.content[0].text).imageId;
    assert.match(id, /^[0-9a-f-]{36}$/);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.find(function(tool) { return tool.name === "store_diagram_image"; })._meta.ui.visibility, ["app"]);
    const invalid = await client.callTool({ name: "store_diagram_image", arguments: { id, data: "not-a-png" } });
    assert.equal(invalid.isError, true);
    const unissued = await client.callTool({ name: "store_diagram_image", arguments: { id: "00000000-0000-4000-8000-000000000000", data: png } });
    assert.equal(unissued.isError, true);
    const stored = await client.callTool({ name: "store_diagram_image", arguments: { id, data: png } });
    assert.notEqual(stored.isError, true);
    const result = await client.callTool({ name: "get_diagram_image", arguments: { id } });
    assert.deepEqual(result.content, [{ type: "image", mimeType: "image/png", data: png }]);
  }
  finally
  {
    await client.close();
    await server.close();
  }
});
