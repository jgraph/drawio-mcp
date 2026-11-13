import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { createServer } from "../src/shared.js";

// Every create_diagram result ends with a note that the user sees the
// diagram itself, so the model's reply after it can be short: without it the
// model summarized the diagram it had just drawn, and the answer ended 5 to
// 25 s after the diagram. Only where the client renders the app does the
// note say the user sees it in the chat; elsewhere the link may be how they
// see it. The viewer reads the first text block, so the note is appended.

const UI = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [RESOURCE_MIME_TYPE] } } };
const RENDERS = { name: "openai-mcp", version: "1.0.0" };
const HIDDEN = { name: "codex-mcp-client", version: "0.0.0", title: "Codex" };

const xml = '<mxGraphModel adaptiveColors="auto"><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="a" value="A" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">' +
  '<mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel>';
const mermaid = "flowchart TD\n  A[Start] --> B[End]";

async function callCreate(clientInfo, capabilities, args)
{
  const server = createServer("", { iconServiceUrl: null });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  const client = new Client(clientInfo, { capabilities: capabilities });

  await client.connect(clientTransport);

  try
  {
    return await client.callTool({ name: "create_diagram", arguments: args });
  }
  finally
  {
    await client.close();
  }
}

function lastText(result)
{
  return result.content[result.content.length - 1].text;
}

test("a client that renders the app is told the user already sees the diagram", async function()
{
  for (const args of [{ xml: xml }, { mermaid: mermaid }, { xml: xml, routing: "libavoid" }])
  {
    const result = await callCreate(RENDERS, UI, args);
    const note = lastText(result);

    assert.equal(result.isError, undefined);
    assert.match(note, /^The user already sees this diagram in the chat, so don't describe or list what it shows\./);
    assert.match(note, /reply in at most two sentences unless the user asked for an explanation/);
    assert.doesNotMatch(note, /link/);
    // The payload and the note, no link.
    assert.equal(result.content.length, 2, JSON.stringify(args));
  }
});

test("the payload stays the first text block, where the viewer reads it", async function()
{
  const xmlResult = await callCreate(RENDERS, UI, { xml: xml });
  const mermaidResult = await callCreate(RENDERS, UI, { mermaid: mermaid, postLayout: "elk" });

  assert.equal(typeof JSON.parse(xmlResult.content[0].text).xml, "string");
  assert.equal(JSON.parse(mermaidResult.content[0].text).mermaid, mermaid);
});

test("a client that declares nothing gets the note after the link, as a condition", async function()
{
  for (const args of [{ xml: xml }, { mermaid: mermaid }])
  {
    const result = await callCreate({ name: "claude-ai", version: "0.1.0" }, {}, args);
    const texts = result.content.map(function(item) { return item.text; });
    const link = texts.findIndex(function(text) { return text.includes("https://app.diagrams.net/"); });
    const note = lastText(result);

    assert.ok(link > 0 && link < texts.length - 1, JSON.stringify(args));
    // Claude.ai may show it inline, so the note doesn't say where.
    assert.doesNotMatch(note, /in the chat/);
    assert.match(note, /^The user sees the diagram itself, inline or through the link/);
    assert.match(note, /at most two sentences besides the link, if you give it/);
  }
});

// The user of the hosted Codex harness sees nothing, and the block before
// says so. A note that the user sees the diagram, or that the link is
// optional, would contradict it: in ChatGPT Work the model took such a
// condition as leave to drop the link.
test("the hosted Codex harness keeps its note about the other tool, then the short reply", async function()
{
  for (const args of [{ xml: xml }, { mermaid: mermaid }])
  {
    const result = await callCreate(HIDDEN, UI, args);
    const texts = result.content.map(function(item) { return item.text; });
    const note = lastText(result);

    assert.match(texts[texts.length - 2], /the user can't see this one/, JSON.stringify(args));
    assert.match(texts[texts.length - 2], /another draw\.io create_diagram tool/);
    assert.doesNotMatch(note, /sees/);
    assert.doesNotMatch(note, /inline/);
    assert.doesNotMatch(note, /if you give it/);
    assert.match(note, /^Don't describe or list what the diagram shows/);
    assert.match(note, /at most two sentences besides the link unless the user asked for an explanation/);
  }
});

test("the note comes after the swap note and the warnings", async function()
{
  const swapped = await callCreate(RENDERS, UI, { xml: mermaid });
  const dangling = xml.replace("</root>", '<mxCell id="e" edge="1" source="a" target="missing" parent="1">' +
    '<mxGeometry relative="1" as="geometry"/></mxCell></root>');
  const warned = await callCreate(RENDERS, UI, { xml: dangling });

  assert.match(swapped.content[1].text, /held Mermaid/);
  assert.match(lastText(swapped), /^The user already sees this diagram/);
  assert.match(warned.content[1].text, /WARNINGS/);
  assert.match(lastText(warned), /^The user already sees this diagram/);
});

test("the note stays short and plain", async function()
{
  for (const [info, caps] of [[RENDERS, UI], [{ name: "claude-ai", version: "0.1.0" }, {}], [HIDDEN, UI]])
  {
    const note = lastText(await callCreate(info, caps, { xml: xml }));

    // Two sentences of plain text: no markup, no hidden or encoded content.
    assert.ok(note.length < 320, note.length + ": " + note);
    assert.match(note, /^[\x20-\x7E]+$/);
  }
});
