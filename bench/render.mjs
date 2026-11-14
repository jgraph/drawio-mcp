// Renders every diagram of a run in the real viewer of the app server, as a
// chat host shows it: a minimal MCP Apps host in headless Chrome loads the
// app's HTML in a sandboxed 800 px iframe and sends the create_diagram input
// and result. Semantic descriptions are converted by shared/semantic first,
// then go through create_diagram as XML like any other diagram.
//
// Per diagram: <tag>-inline.png (what the chat shows), <tag>-full.png (the
// whole diagram, the PNG the viewer sends to the model), <tag>-check.txt (the
// viewer's layout check), <tag>-rendered.xml (the XML as drawn: what the
// viewer reports after converting Mermaid or running a layout, else what the
// server returned) and <tag>-render.json (issues, sizes, the number of
// vertices and the median font size of their styles, read from that XML).
// The diagrams of edit turns (<tag>-edit-diagram.json, run.mjs --edits) are
// rendered the same way, as <tag>-edit-inline.png and so on.
//
// --routing viewer leaves the edges of semantic descriptions to the viewer
// (create_diagram's routing: "libavoid") instead of the engine's own router,
// to compare the two on the same placements.
//
// usage: node render.mjs --chrome /path/to/chrome [--out DIR] [--match er]
//          [--force] [--routing viewer]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_SERVER, require, parseArgs, outDir, connectStdio, newElk } from "./lib/common.mjs";
import { fontStats } from "./lib/diagram-xml.mjs";
import { semanticToXml } from "../shared/semantic/index.js";

const args = parseArgs(process.argv.slice(2));
const out = outDir(args);
const chrome = args.chrome || process.env.CHROME_PATH;
const match = args.match ? new RegExp(args.match) : null;
const viewerRouting = args.routing === "viewer";
const puppeteer = require("puppeteer-core");

if (!chrome)
{
  console.error("Pass --chrome <path to Chrome or chrome-headless-shell> or set CHROME_PATH.");
  process.exit(1);
}

const files = fs.readdirSync(out).filter(function(f)
{
  return f.endsWith("-diagram.json") && (match == null || match.test(f)) &&
    (args.force || !fs.existsSync(path.join(out, f.replace("-diagram.json", "-render.json"))));
}).sort();

const hostHtml = `<!doctype html><html><body style="margin:0;background:#fff">
<iframe id="f" sandbox="allow-scripts" style="width:800px;height:800px;border:0"></iframe>
<script>
window.__ctx = [];
var f = document.getElementById('f');
function reply(id, result) { f.contentWindow.postMessage({ jsonrpc: '2.0', id: id, result: result }, '*'); }
function notify(method, params) { f.contentWindow.postMessage({ jsonrpc: '2.0', method: method, params: params }, '*'); }
window.addEventListener('message', function(e)
{
  var m = e.data;
  if (!m || m.jsonrpc !== '2.0') return;
  if (m.method === 'ui/initialize')
  {
    reply(m.id, { protocolVersion: m.params.protocolVersion, hostInfo: { name: 'bench-host', version: '1' },
      hostCapabilities: { updateModelContext: { text: {}, image: {} }, message: { text: {} }, openLinks: {} },
      hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline'],
        containerDimensions: { width: 800, maxHeight: 800 }, platform: 'web' } });
  }
  else if (m.method === 'ui/notifications/initialized')
  {
    notify('ui/notifications/tool-input', { arguments: window.__payload.arguments });
    setTimeout(function() { notify('ui/notifications/tool-result', window.__payload.result); }, 50);
  }
  else if (m.method === 'ui/update-model-context')
  {
    window.__ctx.push(m.params);
    reply(m.id, {});
  }
  else if (m.method === 'ui/notifications/size-changed')
  {
    if (m.params && m.params.height) f.style.height = Math.min(1000, m.params.height) + 'px';
  }
  else if (m.id != null)
  {
    reply(m.id, {});
  }
});
</script></body></html>`;

function pngSize(buf)
{
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const server = await connectStdio(process.execPath, [APP_SERVER, "--stdio"]);
const app = await server.call("resources/read", { uri: "ui://drawio/mcp-app.html" });
const appHtml = app.result.contents[0].text;
const elk = newElk();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bench-chrome-"));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1280,1000"], userDataDir: profile });

/** The XML in a text, when it holds a whole mxGraphModel. */
function modelXml(text)
{
  const m = /<mxGraphModel[\s\S]*<\/mxGraphModel>/.exec(text || "");

  return m ? m[0] : null;
}

async function render(f)
{
  const tag = f.replace("-diagram.json", "");
  const d = JSON.parse(fs.readFileSync(path.join(out, f), "utf8"));
  let input = d.arguments;
  let engine = null;

  if (d.tool === "create_semantic_diagram")
  {
    // as in the run: without the placement hints when the variant had none,
    // as one grid for the page when it asked for them
    const r = await semanticToXml(d.arguments, { elk: elk, hints: d.hints === "ask" ? "ask" : d.hints !== false,
      route: !viewerRouting });

    if (r.xml == null)
    {
      console.log(tag, "engine error:", r.error);
      return;
    }

    input = viewerRouting ? { xml: r.xml, routing: "libavoid" } : { xml: r.xml };
    engine = { warnings: r.warnings, stats: r.stats };
  }

  const res = await server.call("tools/call", { name: "create_diagram", arguments: input });
  const page = await browser.newPage();

  try
  {
    await page.setViewport({ width: 800, height: 1000 });
    await page.setContent(hostHtml);
    await page.evaluate(function(p, html)
    {
      window.__payload = p;
      document.getElementById("f").srcdoc = html;
    }, { arguments: input, result: res.result }, appHtml);

    const t0 = Date.now();
    let ctx = [];

    while (Date.now() - t0 < 30000)
    {
      await new Promise(function(r) { setTimeout(r, 500); });
      ctx = await page.evaluate(function() { return window.__ctx; });

      if (ctx.length > 0)
      {
        // a layout or routing pass sends a second update
        await new Promise(function(r) { setTimeout(r, 2500); });
        ctx = await page.evaluate(function() { return window.__ctx; });
        break;
      }
    }

    const last = ctx.length ? ctx[ctx.length - 1] : { content: [] };
    const text = (last.content || []).filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("\n");
    const image = (last.content || []).find(function(b) { return b.type === "image"; });
    const m = /Layout check of the diagram as rendered \((\d+) problem/.exec(text);
    const issues = m ? +m[1] : (/no problems found/.test(text) ? 0 : null);
    const frame = await page.$("#f");
    await frame.screenshot({ path: path.join(out, tag + "-inline.png") });
    let full = null;

    if (image)
    {
      const buf = Buffer.from(image.data, "base64");
      fs.writeFileSync(path.join(out, tag + "-full.png"), buf);
      full = pngSize(buf);
    }

    // The XML as drawn: the viewer's, when it sent one (Mermaid converted, a
    // layout or routing pass), else the server's result, else the arguments.
    let returned = null;

    try
    {
      returned = JSON.parse(res.result.content[0].text).xml;
    }
    catch (e)
    {
      returned = null;
    }

    const viewerXml = ctx.map(function(c)
    {
      return modelXml((c.content || []).filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("\n"));
    }).filter(Boolean).pop();
    const xml = viewerXml || returned || input.xml || null;
    const font = xml != null ? fontStats(xml) : { vertices: null, labeled: null, fontSize: null };

    if (xml != null)
    {
      fs.writeFileSync(path.join(out, tag + "-rendered.xml"), xml);
    }

    fs.writeFileSync(path.join(out, tag + "-check.txt"),
      text.replace(/<mxGraphModel[\s\S]*<\/mxGraphModel>/, "").split("\n")
        .filter(function(l) { return !/^<mxGraphModel|^\s*</.test(l); }).join("\n").slice(0, 8000));
    const info = { tag: tag, issues: issues, contextUpdates: ctx.length, full: full, inline: pngSize(fs.readFileSync(path.join(out, tag + "-inline.png"))),
      format: input.mermaid != null ? "mermaid" : (engine ? "semantic" : "xml"),
      xmlFrom: viewerXml ? "viewer" : returned ? "server" : xml ? "arguments" : null,
      vertices: font.vertices, labeled: font.labeled, fontSize: font.fontSize, engine: engine };
    fs.writeFileSync(path.join(out, tag + "-render.json"), JSON.stringify(info, null, 1));
    console.log(tag, "issues", issues, "png", full ? full.width + "x" + full.height : "none", "vertices", font.vertices,
      "font", font.fontSize);
  }
  finally
  {
    await page.close();
  }
}

let failed = 0;

for (const f of files)
{
  try
  {
    await render(f);
  }
  catch (e)
  {
    failed++;
    console.log(f.replace("-diagram.json", ""), "render failed:", e.message);
  }
}

console.log(files.length - failed + " of " + files.length + " diagrams rendered");

await browser.close();
server.close();
fs.rmSync(profile, { recursive: true, force: true });
