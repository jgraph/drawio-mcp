import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { createServer } from "../src/shared.js";
import { createImageStore } from "../src/image-store.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a+UAAAAASUVORK5CYII=";
const ui = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [RESOURCE_MIME_TYPE] } } };

test("a client can retrieve the viewer's PNG through the image tool", async function()
{
  const imageStore = createImageStore();
  const server = createServer("", { imageStore });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "image-test", version: "1" },
    { capabilities: ui });
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

test("image IDs are omitted for clients that cannot render the app", async function()
{
  const server = createServer("", { imageStore: createImageStore() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "plain-image-test", version: "1" });
  await client.connect(clientTransport);
  try
  {
    const result = await client.callTool({ name: "create_diagram", arguments: { mermaid: "flowchart LR\nA-->B", captureImage: true } });
    assert.equal(JSON.parse(result.content[0].text).imageId, undefined);
  }
  finally
  {
    await client.close();
    await server.close();
  }
});

test("image IDs are omitted for clients that declare a hidden app", async function()
{
  const server = createServer("", { imageStore: createImageStore() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "codex-mcp-client", version: "0.0.0" },
    { capabilities: ui });
  await client.connect(clientTransport);
  try
  {
    const result = await client.callTool({ name: "create_diagram", arguments: { xml: "<mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/></root></mxGraphModel>", captureImage: true } });
    assert.equal(JSON.parse(result.content[0].text).imageId, undefined);
  }
  finally
  {
    await client.close();
    await server.close();
  }
});

test("a failed reservation does not fail diagram creation or expose an image ID", async function()
{
  const server = createServer("", { imageStore: { reserve: async function() { throw new Error("cache unavailable"); } } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "reserve-failure-test", version: "1" },
    { capabilities: ui });
  await client.connect(clientTransport);
  try
  {
    const result = await client.callTool({ name: "create_diagram", arguments: { mermaid: "flowchart LR\nA-->B", captureImage: true } });
    assert.notEqual(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).imageId, undefined);
  }
  finally
  {
    await client.close();
    await server.close();
  }
});

test("an image ID works when the host routes retrieval through another session", async function()
{
  const imageStore = createImageStore();
  const creator = createServer("", { imageStore });
  const receiver = createServer("", { imageStore });
  const [creatorClientTransport, creatorServerTransport] = InMemoryTransport.createLinkedPair();
  const [receiverClientTransport, receiverServerTransport] = InMemoryTransport.createLinkedPair();
  await creator.connect(creatorServerTransport);
  await receiver.connect(receiverServerTransport);
  const creatorClient = new Client({ name: "image-creator", version: "1" },
    { capabilities: ui });
  const receiverClient = new Client({ name: "image-receiver", version: "1" });
  await creatorClient.connect(creatorClientTransport);
  await receiverClient.connect(receiverClientTransport);
  try
  {
    const diagram = await creatorClient.callTool({ name: "create_diagram", arguments: { mermaid: "flowchart LR\nA-->B", captureImage: true } });
    const id = JSON.parse(diagram.content[0].text).imageId;
    assert.match(id, /^[0-9a-f-]{36}$/);
    await receiverClient.callTool({ name: "store_diagram_image", arguments: { id, data: png } });
    const result = await creatorClient.callTool({ name: "get_diagram_image", arguments: { id } });
    assert.deepEqual(result.content, [{ type: "image", mimeType: "image/png", data: png }]);
  }
  finally
  {
    await creatorClient.close();
    await receiverClient.close();
    await creator.close();
    await receiver.close();
  }
});

test("unknown image IDs return without polling the store", async function()
{
  const originalSetTimeout = globalThis.setTimeout;
  let hasCalls = 0;
  let getCalls = 0;
  const imageStore =
  {
    reserve: async function() { return true; },
    has: async function() { hasCalls++; return false; },
    get: async function() { getCalls++; return null; },
  };
  const server = createServer("", { imageStore });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "unknown-image-test", version: "1" });
  await client.connect(clientTransport);
  try
  {
    globalThis.setTimeout = function(callback, delay)
    {
      if (delay === 250)
      {
        queueMicrotask(callback);
        return 0;
      }
      return originalSetTimeout(callback, delay);
    };
    const result = await client.callTool({ name: "get_diagram_image", arguments: { id: "00000000-0000-4000-8000-000000000000" } });
    assert.equal(result.isError, true);
    assert.equal(hasCalls, 1);
    assert.equal(getCalls, 0);
  }
  finally
  {
    globalThis.setTimeout = originalSetTimeout;
    await client.close();
    await server.close();
  }
});
