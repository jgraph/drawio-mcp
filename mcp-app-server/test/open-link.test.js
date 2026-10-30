import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/shared.js";

// The viewer's links leave the sandbox through the host. In ChatGPT they go
// through window.openai.openExternal, whose trusted targets come from
// openai/widgetCSP redirect_domains, and the fullscreen header's own "Open in
// draw.io" button gets the diagram as its target. openUrl and setOpenInAppUrl
// run in the app's HTML, so they are taken from the source of the template.

const source = readFileSync(new URL("../src/shared.js", import.meta.url), "utf-8");

function viewerFunction(name)
{
  const fn = source.match(new RegExp("\\nfunction " + name + "\\([^)]*\\)\\n\\{\\n[\\s\\S]*?\\n\\}\\n"));

  assert.ok(fn, name + " not found in src/shared.js");

  return new Function("window", "app", "console", fn[0].replace(/\\\\/g, "\\") + "\nreturn " + name + ";");
}

// A host: calls to window.openai and app.openLink are recorded
function host(openai)
{
  const calls = [];
  const window = (openai != null) ? { openai: openai(calls) } : {};
  const app = { openLink: function(arg) { calls.push(["openLink", arg]); } };
  const quiet = { log: function() {} };

  return {
    calls: calls,
    openUrl: viewerFunction("openUrl")(window, app, quiet),
    setOpenInAppUrl: viewerFunction("setOpenInAppUrl")(window, app, quiet)
  };
}

function chatgpt(calls)
{
  return {
    openExternal: function(arg) { calls.push(["openExternal", arg]); },
    setOpenInAppUrl: function(arg) { calls.push(["setOpenInAppUrl", arg]); }
  };
}

const url = "https://app.diagrams.net/?pv=0&grid=0#create=%7B%22type%22%3A%22xml%22%7D";

test("in ChatGPT, links open with openExternal and without a redirectUrl", function()
{
  const h = host(chatgpt);
  h.openUrl(url);

  assert.deepEqual(h.calls, [["openExternal", { href: url, redirectUrl: false }]]);
});

test("other hosts open links with ui/open-link", function()
{
  const h = host(null);
  h.openUrl(url);

  assert.deepEqual(h.calls, [["openLink", { url: url }]]);
});

test("a failing openExternal falls back to ui/open-link", function()
{
  const h = host(function()
  {
    return { openExternal: function() { throw new Error("not allowed"); } };
  });
  h.openUrl(url);

  assert.deepEqual(h.calls, [["openLink", { url: url }]]);
});

test("ChatGPT's fullscreen button gets the diagram as its target, other hosts nothing", function()
{
  const h = host(chatgpt);
  h.setOpenInAppUrl(url);

  assert.deepEqual(h.calls, [["setOpenInAppUrl", { href: url }]]);

  const other = host(null);
  other.setOpenInAppUrl(url);

  assert.deepEqual(other.calls, []);
});

test("the app resource lists the link targets for ChatGPT and repeats its CSP there", async function()
{
  const server = createServer("", { iconServiceUrl: null });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "open-link-test", version: "0.0.0" });
  await client.connect(clientTransport);

  try
  {
    const result = await client.readResource({ uri: "ui://drawio/mcp-app.html" });
    const meta = result.contents[0]._meta;
    const openai = meta["openai/widgetCSP"];

    assert.ok(openai.redirect_domains.includes("https://app.diagrams.net"));
    assert.ok(openai.redirect_domains.includes("https://www.drawio.com"));
    assert.deepEqual(openai.resource_domains, meta.ui.csp.resourceDomains);
    assert.deepEqual(openai.connect_domains, meta.ui.csp.connectDomains);
  }
  finally
  {
    await client.close();
  }
});
