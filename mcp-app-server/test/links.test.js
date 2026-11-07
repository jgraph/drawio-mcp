import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pako from "pako";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildHtml, createServer, editorLinkBase } from "../src/shared.js";

// The links to the draw.io editor. The link create_diagram hands a client that
// doesn't render the app opens XML as a raw #R link and Mermaid as #create,
// which draw.io converts. The viewer's "Open in draw.io" button opens its XML
// as #create with the "pop" effect, which animates the diagram in. Both go to
// app.diagrams.net, or to the self-hosted draw.io DRAWIO_BASE_URL names.

const xml = '<mxGraphModel adaptiveColors="auto"><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="a" value="R&amp;D: 100% (x+y)" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">' +
  '<mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell></root></mxGraphModel>';

const selfHosted = "https://drawio.example.com/drawio/";

let client;

// A client of a server with these options. No io.modelcontextprotocol/ui
// capability: the server adds the link.
async function connect(options)
{
  const server = createServer("", Object.assign({ iconServiceUrl: null }, options));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  const c = new Client({ name: "links-test", version: "0.0.0" });
  await c.connect(clientTransport);

  return c;
}

before(async function()
{
  client = await connect({});
});

after(async function()
{
  await client.close();
});

async function linkFor(args, c, base)
{
  base = base || "https://app.diagrams.net/";
  const result = await (c || client).callTool({ name: "create_diagram", arguments: args });
  const block = result.content.find(function(item)
  {
    return item.type === "text" && item.text.includes(base);
  });

  assert.ok(block, JSON.stringify(result.content));

  return new URL(block.text.match(/https:\/\/\S+/)[0]);
}

function decompress(base64)
{
  return decodeURIComponent(pako.inflateRaw(Buffer.from(base64, "base64"), { to: "string" }));
}

// The button's code runs in the app's HTML, so it is taken from the source of
// the template and run with the same pako, in a window whose editor URL is
// read from the HTML buildHtml makes.
function viewerEditUrl(drawioBaseUrl)
{
  const source = readFileSync(new URL("../src/shared.js", import.meta.url), "utf-8");
  const fn = source.match(/\nfunction generateDrawioEditUrl\(xml\)\n\{\n[\s\S]*?\n\}\n/);

  assert.ok(fn, "generateDrawioEditUrl not found in src/shared.js");

  const html = buildHtml("", "", null, { drawioBaseUrl: drawioBaseUrl });
  const line = html.match(/\n\s*(window\.__DRAWIO_EDITOR_URL = .*;)\n/);

  assert.ok(line, "window.__DRAWIO_EDITOR_URL not set in the HTML");

  const window = {};
  new Function("window", line[1])(window);

  return new Function("pako", "window", fn[0] + "\nreturn generateDrawioEditUrl;")(pako, window);
}

test("an XML diagram gets a #R link", async function()
{
  const url = await linkFor({ xml: xml });

  assert.equal(url.searchParams.get("pv"), "0");
  assert.equal(url.searchParams.get("grid"), "0");
  assert.ok(url.hash.startsWith("#R"), url.hash.substring(0, 20));
  assert.equal(decompress(decodeURIComponent(url.hash.substring(2))), xml);
});

test("a Mermaid diagram gets a #create link", async function()
{
  const mermaid = "flowchart TD\n  A[Start] --> B[End]";
  const url = await linkFor({ mermaid: mermaid });

  assert.ok(url.hash.startsWith("#create="), url.hash.substring(0, 20));

  const createObj = JSON.parse(decodeURIComponent(url.hash.substring("#create=".length)));

  assert.equal(createObj.type, "mermaid");
  assert.equal(decompress(createObj.data), mermaid);
});

test("the viewer's Open in draw.io button gets a #create link with the pop effect", function()
{
  const link = viewerEditUrl()(xml);
  const url = new URL(link);

  assert.ok(link.startsWith("https://app.diagrams.net/?pv=0&grid=0#create="), link.substring(0, 50));
  assert.ok(url.hash.startsWith("#create="), url.hash.substring(0, 20));

  const createObj = JSON.parse(decodeURIComponent(url.hash.substring("#create=".length)));

  assert.equal(createObj.type, "xml");
  assert.equal(createObj.compressed, true);
  assert.equal(createObj.effect, "pop");
  assert.equal(decompress(createObj.data), xml);
});

test("DRAWIO_BASE_URL points both links at a self-hosted draw.io", async function()
{
  const c = await connect({ drawioBaseUrl: selfHosted });

  try
  {
    const xmlLink = (await linkFor({ xml: xml }, c, selfHosted)).href;
    const mermaidLink = (await linkFor({ mermaid: "flowchart TD\n  A --> B" }, c, selfHosted)).href;

    assert.ok(xmlLink.startsWith(selfHosted + "?pv=0&grid=0#R"), xmlLink.substring(0, 60));
    assert.ok(mermaidLink.startsWith(selfHosted + "?pv=0&grid=0#create="), mermaidLink.substring(0, 60));
  }
  finally
  {
    await c.close();
  }

  const button = viewerEditUrl(selfHosted)(xml);

  assert.ok(button.startsWith(selfHosted + "?pv=0&grid=0#create="), button.substring(0, 60));
  assert.equal(decompress(JSON.parse(decodeURIComponent(new URL(button).hash.substring("#create=".length))).data), xml);
});

test("the self-hosted editor is a connect and redirect domain, next to app.diagrams.net", async function()
{
  async function csp(options)
  {
    const c = await connect(options);

    try
    {
      const result = await c.readResource({ uri: "ui://drawio/mcp-app.html" });

      return result.contents[0]._meta;
    }
    finally
    {
      await c.close();
    }
  }

  const standard = await csp({});
  const custom = await csp({ drawioBaseUrl: selfHosted });

  assert.deepEqual(standard.ui.csp.connectDomains, ["https://viewer.diagrams.net", "https://app.diagrams.net",
    "https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
  assert.deepEqual(standard["openai/widgetCSP"].redirect_domains, ["https://app.diagrams.net", "https://www.drawio.com"]);

  assert.deepEqual(custom.ui.csp.connectDomains,
    ["https://viewer.diagrams.net", "https://app.diagrams.net", "https://fonts.googleapis.com",
      "https://fonts.gstatic.com", "https://drawio.example.com"]);
  assert.deepEqual(custom["openai/widgetCSP"].connect_domains, custom.ui.csp.connectDomains);
  assert.deepEqual(custom["openai/widgetCSP"].redirect_domains,
    ["https://app.diagrams.net", "https://www.drawio.com", "https://drawio.example.com"]);
  assert.deepEqual(custom.ui.csp.resourceDomains, standard.ui.csp.resourceDomains);
});

test("the base URL keeps its path and query, and loses its hash", function()
{
  assert.equal(editorLinkBase(), "https://app.diagrams.net/?pv=0&grid=0");
  assert.equal(editorLinkBase("https://drawio.example.com"), "https://drawio.example.com/?pv=0&grid=0");
  assert.equal(editorLinkBase("http://localhost:8080/drawio/"), "http://localhost:8080/drawio/?pv=0&grid=0");
  assert.equal(editorLinkBase("https://drawio.example.com/?offline=1#x"),
    "https://drawio.example.com/?offline=1&pv=0&grid=0");
});

test("a base URL that isn't http(s) fails at startup", function()
{
  for (const bad of ["drawio.example.com", "javascript:alert(1)", "file:///drawio/"])
  {
    assert.throws(function() { editorLinkBase(bad); }, /DRAWIO_BASE_URL/, bad);
    assert.throws(function() { buildHtml("", "", null, { drawioBaseUrl: bad }); }, /DRAWIO_BASE_URL/, bad);
    assert.throws(function() { createServer("", { drawioBaseUrl: bad }); }, /DRAWIO_BASE_URL/, bad);
  }
});

test("the base URL can't close the HTML's script element", function()
{
  const html = buildHtml("", "", null, { drawioBaseUrl: "https://drawio.example.com/?a=</script><script>alert(1)//" });
  const line = html.match(/window\.__DRAWIO_EDITOR_URL = .*;/)[0];

  assert.ok(!line.includes("<"), line);
});
