import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pako from "pako";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Runs the real server over stdio and checks the links the open_drawio_* tools
// hand back. XML opens as #R: after a #create, draw.io rewrites the hash and,
// when the rewrite differs from the link (a host that re-encodes it, like VS
// Code), asks "All changes will be lost!"; it never rewrites a #R hash.
// Mermaid and CSV stay #create, which draw.io converts in the browser.

const server = fileURLToPath(new URL("../src/index.js", import.meta.url));

// The server opens every link in a browser. With an empty PATH there is no
// xdg-open / open to find, so the spawn fails (and is logged) instead.
const emptyPath = mkdtempSync(join(tmpdir(), "drawio-links-test-"));

const xml = '<mxGraphModel adaptiveColors="auto"><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="a" value="R&amp;D: 100% (x+y)" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">' +
  '<mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell></root></mxGraphModel>';

// Starts the server with the extra environment and collects its stderr, where
// a failed browser launch is logged.
async function startServer(env)
{
  const transport = new StdioClientTransport(
  {
    command: process.execPath,
    args: [server],
    env: Object.assign({ PATH: emptyPath, HOME: process.env.HOME || tmpdir() }, env),
    stderr: "pipe",
  });
  const started = { client: new Client({ name: "links-test", version: "0.0.0" }), stderr: "" };

  transport.stderr.on("data", function(chunk)
  {
    started.stderr += chunk;
  });

  await started.client.connect(transport);

  return started;
}

function delay(ms)
{
  return new Promise(function(resolve)
  {
    setTimeout(resolve, ms);
  });
}

let started;
let client;

before(async function()
{
  started = await startServer({});
  client = started.client;
});

after(async function()
{
  await client.close();
  rmSync(emptyPath, { recursive: true, force: true });
});

async function openUrl(name, args)
{
  const result = await client.callTool({ name: name, arguments: args });

  assert.equal(result.isError, undefined, result.content[0].text);

  return new URL(result.content[0].text.match(/https:\/\/\S+/)[0]);
}

function decompress(base64)
{
  return decodeURIComponent(pako.inflateRaw(Buffer.from(base64, "base64"), { to: "string" }));
}

test("open_drawio_xml opens a #R link", { skip: process.platform === "win32" }, async function()
{
  const url = await openUrl("open_drawio_xml", { content: xml });

  assert.equal(url.origin + url.pathname, "https://app.diagrams.net/");
  assert.equal(url.searchParams.get("grid"), "0");
  assert.equal(url.searchParams.get("pv"), "0");
  assert.ok(url.hash.startsWith("#R"), url.hash.substring(0, 20));
  assert.equal(decompress(decodeURIComponent(url.hash.substring(2))), xml);
});

test("open_drawio_xml keeps lightbox and dark mode on the #R link", { skip: process.platform === "win32" }, async function()
{
  const url = await openUrl("open_drawio_xml", { content: xml, lightbox: true, dark: "true" });

  assert.equal(url.searchParams.get("lightbox"), "1");
  assert.equal(url.searchParams.get("dark"), "1");
  assert.ok(url.hash.startsWith("#R"), url.hash.substring(0, 20));
  assert.equal(decompress(decodeURIComponent(url.hash.substring(2))), xml);
});

test("open_drawio_mermaid and open_drawio_csv open #create links", { skip: process.platform === "win32" }, async function()
{
  const mermaid = "flowchart TD\n  A[Start] --> B[End]";
  const csv = "## Org chart\n# label: %name%\nname,refs\nAda,\nBob,Ada";

  for (const [name, content, type] of [["open_drawio_mermaid", mermaid, "mermaid"], ["open_drawio_csv", csv, "csv"]])
  {
    const url = await openUrl(name, { content: content });

    assert.ok(url.hash.startsWith("#create="), name + ": " + url.hash.substring(0, 20));

    const createObj = JSON.parse(decodeURIComponent(url.hash.substring("#create=".length)));

    assert.equal(createObj.type, type);
    assert.equal(createObj.compressed, true);
    assert.equal(decompress(createObj.data), content);
  }
});

test("the server opens the link in a browser", { skip: process.platform === "win32" }, async function()
{
  const result = await client.callTool({ name: "open_drawio_xml", arguments: { content: xml } });

  assert.match(result.content[0].text, /has been opened in your default browser/);

  for (let i = 0; i < 50 && started.stderr.indexOf("Failed to open browser") < 0; i++)
  {
    await delay(100);
  }

  assert.match(started.stderr, /Failed to open browser/);
});

test("DRAWIO_BROWSER=off only returns the link", { skip: process.platform === "win32" }, async function()
{
  const off = await startServer({ DRAWIO_BROWSER: "off" });

  try
  {
    const result = await off.client.callTool({ name: "open_drawio_xml", arguments: { content: xml } });
    const text = result.content[0].text;

    assert.equal(result.isError, undefined, text);
    assert.match(text, /https:\/\/app\.diagrams\.net\/\S*#R/);
    assert.match(text, /No browser was opened/);
    assert.doesNotMatch(text, /has been opened/);

    // The other test sees the failed launch within milliseconds.
    await delay(500);

    assert.doesNotMatch(off.stderr, /Failed to open browser/);
  }
  finally
  {
    await off.client.close();
  }
});
