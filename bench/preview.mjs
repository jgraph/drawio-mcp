// Checks the semantic tool of the app server in its real viewer: the server
// with its switch on (DRAWIO_SEMANTIC_TYPES), the app's HTML in a sandboxed
// 800 px iframe of a minimal MCP Apps host in headless Chrome. Every saved
// description (<tag>-diagram.json of a semantic variant) is shown twice: the
// result alone, as a host that doesn't stream the input, and with the
// arguments streamed in as a host hands them over while the model writes
// them (the JSON text cut off and closed where it stands), then the result.
//
// Per description, one line of JSON and a row in preview.json: what the
// preview drew at every step and how long one layout took, which way the
// diagram lay at every step, with the whole input and with the result (lanes
// r: rows, c: columns, read from where two lanes are; a flowchart without
// lanes t: turned, n: as written, from the viewer's semanticShownTurned and,
// for the result, the engine's own layout) and how often it turned, whether
// the streamed diagram ends with the same cells as the result alone,
// whether the model is told that the diagram came from its description, what
// the layout check found, and script errors. <tag>-preview-streaming.png,
// <tag>-preview-input.png and <tag>-preview-result.png show the frame half
// way, with the whole input and with the result.
//
// usage: node preview.mjs --chrome /path/to/chrome [--out DIR] [--match lanes]
//          [--types on] [--cuts 24] [--wait 350]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_SERVER, REPO, require, parseArgs, outDir, connectStdio, readJson } from "./lib/common.mjs";

const args = parseArgs(process.argv.slice(2));
const out = outDir(args);
const chrome = args.chrome || process.env.CHROME_PATH;
const match = args.match ? new RegExp(args.match) : null;
const cuts = Number(args.cuts || 24);
const wait = Number(args.wait || 350);
const puppeteer = require("puppeteer-core");

if (!chrome)
{
  console.error("Pass --chrome <path to Chrome or chrome-headless-shell> or set CHROME_PATH.");
  process.exit(1);
}

// the server reads the switch when it starts
process.env.DRAWIO_SEMANTIC_TYPES = (typeof args.types === "string") ? args.types : "on";

const server = await connectStdio(process.execPath, [APP_SERVER, "--stdio"]);
const tools = (await server.call("tools/list", {})).result.tools;
const tool = tools.find(function(t) { return t.name === "create_semantic_diagram"; });

if (tool == null)
{
  console.error("The server lists no create_semantic_diagram with DRAWIO_SEMANTIC_TYPES=" + process.env.DRAWIO_SEMANTIC_TYPES + ".");
  server.close();
  process.exit(1);
}

const offered = tool.inputSchema.properties.type.enum;
const appHtml = (await server.call("resources/read", { uri: "ui://drawio/mcp-app.html" })).result.contents[0].text;

console.log("types: " + offered.join(", ") + " | description " + tool.description.length + " chars | html " +
  appHtml.length + " chars, engine " + /var DrawioSemantic =/.test(appHtml));

const files = fs.readdirSync(out).filter(function(f)
{
  if (!f.endsWith("-diagram.json") || f.endsWith("-edit-diagram.json") || (match != null && !match.test(f)))
  {
    return false;
  }

  const d = readJson(path.join(out, f));

  return d != null && d.arguments != null && d.arguments.nodes != null &&
    offered.indexOf(String(d.arguments.type).toLowerCase()) >= 0;
}).sort();

const hostHtml = `<!doctype html><html><body style="margin:0;background:#fff">
<iframe id="f" sandbox="allow-scripts" style="width:800px;height:800px;border:0"></iframe>
<script>
window.__ctx = [];
window.__ready = false;
var f = document.getElementById('f');
function reply(id, result) { f.contentWindow.postMessage({ jsonrpc: '2.0', id: id, result: result }, '*'); }
window.__notify = function(method, params) { f.contentWindow.postMessage({ jsonrpc: '2.0', method: method, params: params }, '*'); };
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
  else if (m.method === 'ui/notifications/initialized') { window.__ready = true; }
  else if (m.method === 'ui/update-model-context') { window.__ctx.push(m.params); reply(m.id, {}); }
  else if (m.method === 'ui/notifications/size-changed')
  {
    if (m.params && m.params.height) f.style.height = Math.min(1000, m.params.height) + 'px';
  }
  else if (m.id != null) { reply(m.id, {}); }
});
</script></body></html>`;

// The arguments as a host hands them over while the model still writes them:
// the JSON text cut off and closed where it stands.
function heal(text)
{
  for (let end = text.length; end > 0; end--)
  {
    const stack = [];
    let inString = false;
    let escaped = false;

    for (let i = 0; i < end; i++)
    {
      const ch = text[i];

      if (inString)
      {
        if (escaped)
        {
          escaped = false;
        }
        else if (ch === "\\")
        {
          escaped = true;
        }
        else if (ch === "\"")
        {
          inString = false;
        }
      }
      else if (ch === "\"")
      {
        inString = true;
      }
      else if (ch === "{" || ch === "[")
      {
        stack.push(ch);
      }
      else if (ch === "}" || ch === "]")
      {
        stack.pop();
      }
    }

    try
    {
      return JSON.parse(text.slice(0, end) + (inString ? "\"" : "") +
        stack.reverse().map(function(c) { return c === "{" ? "}" : "]"; }).join(""));
    }
    catch (e)
    {
      // a key without its value, a comma: one character back
    }
  }

  return {};
}

function sleep(ms)
{
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// What the viewer shows: the cells of its graph, which way its lanes lie
// (two lanes of one parent side by side are columns, one under the other
// rows) or, without lanes, which way the preview laid out the page, the time
// of the last layout and whether it knows of the description.
function viewerState()
{
  var cells = (typeof streamGraph !== "undefined" && streamGraph != null) ? streamGraph.getModel().cells : null;
  var vertices = 0;
  var edges = 0;
  var lanes = "";
  var firstLane = {};
  var anyLane = false;

  for (var id in cells)
  {
    var cell = cells[id];

    if (cell.vertex)
    {
      vertices++;
    }
    else if (cell.edge)
    {
      edges++;
    }

    if (lanes === "" && cell.vertex && /^swimlane/.test(cell.style || "") && cell.geometry != null)
    {
      var parent = cell.parent ? cell.parent.id : "";
      var first = firstLane[parent];

      anyLane = true;

      if (first == null)
      {
        firstLane[parent] = cell.geometry;
      }
      else
      {
        lanes = (Math.abs(cell.geometry.y - first.y) > Math.abs(cell.geometry.x - first.x)) ? "r" : "c";
      }
    }
  }

  if (!anyLane && vertices > 0 && typeof semanticShownTurned !== "undefined" && semanticShownTurned != null)
  {
    lanes = semanticShownTurned ? "t" : "n";
  }

  return { engine: typeof DrawioSemantic !== "undefined", viewer: typeof GraphViewer !== "undefined",
    vertices: vertices, edges: edges, lanes: lanes,
    ms: (typeof semanticRunMs !== "undefined") ? semanticRunMs : null,
    described: (typeof shownFromDescription !== "undefined") ? shownFromDescription : null };
}

// The model as drawn: parent, terminals, geometry, waypoints and style of every cell.
function viewerCells()
{
  var cells = streamGraph.getModel().cells;
  var result = {};

  for (var id in cells)
  {
    var c = cells[id];
    var g = c.geometry;

    result[id] = [c.parent ? c.parent.id : null, c.source ? c.source.id : null, c.target ? c.target.id : null,
      g ? [g.x, g.y, g.width, g.height, (g.points || []).map(function(p) { return p.x + "," + p.y; }).join(" ")].join("|") : null,
      c.style].join(" § ");
  }

  return result;
}

// How the server lays out a flowchart without lanes (t: turned, n: as
// written), which the viewer's result doesn't say: the engine as the tool
// handler runs it.
const engine = await import(pathToFileURL(path.join(REPO, "shared", "semantic", "index.js")).href);

async function resultTurned(a)
{
  const r = await engine.semanticToXml(a, { hints: "ask" });

  return (r.stats != null && r.stats.grid === "page") ? (r.stats.turned ? "t" : "n") : "";
}

// How often a sequence of orientations changes, steps without one skipped.
function changes(list)
{
  const known = list.filter(function(l) { return l !== ""; });

  return known.filter(function(l, i) { return i > 0 && l !== known[i - 1]; }).length;
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bench-chrome-"));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1280,1000"], userDataDir: profile });

async function show(file, streamed)
{
  const d = readJson(path.join(out, file));
  const tag = file.replace("-diagram.json", "");
  const res = await server.call("tools/call", { name: "create_semantic_diagram", arguments: d.arguments });
  const page = await browser.newPage();
  const errors = [];

  page.on("pageerror", function(e) { errors.push(String(e.message || e).slice(0, 200)); });
  page.on("console", function(m)
  {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
    {
      errors.push("console: " + m.text().slice(0, 200));
    }
  });

  try
  {
    await page.setViewport({ width: 800, height: 1000 });
    await page.setContent(hostHtml);
    await page.evaluate(function(html) { document.getElementById("f").srcdoc = html; }, appHtml);

    const t0 = Date.now();

    while (!(await page.evaluate(function() { return window.__ready; })) && Date.now() - t0 < 30000)
    {
      await sleep(100);
    }

    const frame = page.frames().find(function(fr) { return fr !== page.mainFrame(); });
    const element = await page.$("#f");

    // a host starts streaming once the frame is up and the viewer library is there
    while (!(await frame.evaluate(viewerState)).viewer && Date.now() - t0 < 30000)
    {
      await sleep(100);
    }

    const text = JSON.stringify(d.arguments);
    const steps = [];
    const lanes = [];

    for (let k = 1; k <= cuts && streamed; k++)
    {
      const partial = heal(text.slice(0, Math.round(text.length * k / (cuts + 1))));

      await page.evaluate(function(a) { window.__notify("ui/notifications/tool-input-partial", { arguments: a }); }, partial);
      await sleep(wait);

      const s = await frame.evaluate(viewerState);

      steps.push(s.vertices + "v/" + s.edges + "e");
      lanes.push(s.lanes);

      if (k === Math.round(cuts / 2))
      {
        await element.screenshot({ path: path.join(out, tag + "-preview-streaming.png") });
      }
    }

    const preview = await frame.evaluate(viewerState);

    if (streamed)
    {
      await page.evaluate(function(a) { window.__notify("ui/notifications/tool-input", { arguments: a }); }, d.arguments);
      await sleep(600);
      await element.screenshot({ path: path.join(out, tag + "-preview-input.png") });
    }

    const input = await frame.evaluate(viewerState);

    await page.evaluate(function(r) { window.__notify("ui/notifications/tool-result", r); }, res.result);

    // the viewer's update for the model follows the rendering; a second one may follow the first
    let context = [];
    const t1 = Date.now();

    while (Date.now() - t1 < 30000)
    {
      await sleep(500);
      context = await page.evaluate(function() { return window.__ctx; });

      if (context.length > 0)
      {
        await sleep(2500);
        context = await page.evaluate(function() { return window.__ctx; });
        break;
      }
    }

    const last = context.length > 0 ? context[context.length - 1] : { content: [] };
    const blocks = last.content || [];
    const told = blocks.filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("\n");
    const found = /Layout check of the diagram as rendered \((\d+) problem/.exec(told);
    const final = await frame.evaluate(viewerState);
    const cells = await frame.evaluate(viewerCells);
    // the result of a flowchart without lanes doesn't go through the preview
    const atResult = (final.lanes === "t" || final.lanes === "n") ? await resultTurned(d.arguments) : final.lanes;
    const shown = streamed ? lanes.concat([input.lanes, atResult]) : [];
    const beforeResult = shown.slice(0, -1).filter(function(l) { return l !== ""; });

    if (streamed)
    {
      await element.screenshot({ path: path.join(out, tag + "-preview-result.png") });
    }

    return { cells: cells, row: { tag: tag, error: res.result.isError === true,
      steps: steps.join(" "), lanes: lanes.join("") + (streamed ? " " + (input.lanes || "-") + " " + (atResult || "-") : ""),
      withLanes: /[rc]/.test(lanes.join("") + atResult), turns: changes(shown),
      turnedAtResult: beforeResult.length > 0 && atResult !== "" && beforeResult[beforeResult.length - 1] !== atResult,
      lanesResult: atResult, previewMs: preview.ms, engine: preview.engine,
      input: input.vertices + "v/" + input.edges + "e", result: final.vertices + "v/" + final.edges + "e",
      described: /laid out from your description|your description laid out/.test(told),
      contextUpdates: context.length, issues: found ? Number(found[1]) : (/no problems found/.test(told) ? 0 : null),
      image: blocks.some(function(b) { return b.type === "image"; }), xmlSent: /<mxGraphModel/.test(told),
      routed: /connectors routed around/.test(told), errors: errors } };
  }
  catch (e)
  {
    return { cells: null, row: { tag: tag, failed: e.message, errors: errors } };
  }
  finally
  {
    await page.close();
  }
}

const rows = [];

try
{
  for (const file of files)
  {
    const direct = await show(file, false);
    const streamed = await show(file, true);
    const a = direct.cells || {};
    const b = streamed.cells || {};
    const differ = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).filter(function(id) { return a[id] !== b[id]; });
    const row = Object.assign({}, streamed.row, { cells: Object.keys(b).length,
      sameAsResultAlone: direct.cells != null && streamed.cells != null && differ.length === 0, differ: differ.slice(0, 8),
      resultAlone: { described: direct.row.described === true, issues: direct.row.issues, routed: direct.row.routed,
        errors: direct.row.errors } });

    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
finally
{
  await browser.close();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

fs.writeFileSync(path.join(out, "preview.json"), JSON.stringify(rows, null, 1));

function count(test)
{
  return rows.filter(test).length;
}

const times = rows.map(function(r) { return r.previewMs; }).filter(function(ms) { return ms != null; }).sort(function(x, y) { return x - y; });

console.log("\n" + rows.length + " descriptions" +
  " | drawn by the preview " + count(function(r) { return r.engine === true && r.previewMs != null; }) +
  " | same cells as the result alone " + count(function(r) { return r.sameAsResultAlone; }) +
  " | told that it came from a description " + count(function(r) { return r.described === true; }) +
  ", result alone " + count(function(r) { return r.resultAlone.described; }) +
  " | layout-check findings " + rows.reduce(function(sum, r) { return sum + (r.issues || 0); }, 0) +
  ", result alone " + rows.reduce(function(sum, r) { return sum + (r.resultAlone.issues || 0); }, 0) +
  " | with lanes, turned more than once " + count(function(r) { return r.withLanes && r.turns > 1; }) + " of " +
  count(function(r) { return r.withLanes; }) + ", at the result " + count(function(r) { return r.withLanes && r.turnedAtResult; }) +
  " | without lanes, turned more than once " + count(function(r) { return r.withLanes === false && r.turns > 1; }) + " of " +
  count(function(r) { return r.withLanes === false; }) + ", at the result " +
  count(function(r) { return r.withLanes === false && r.turnedAtResult; }) +
  " | script errors " + rows.reduce(function(sum, r) { return sum + (r.errors || []).length + (r.resultAlone.errors || []).length; }, 0) +
  " | layout ms, median " + (times.length > 0 ? times[Math.floor(times.length / 2)] : "-") +
  ", max " + (times.length > 0 ? times[times.length - 1] : "-") +
  " | failed " + count(function(r) { return r.failed != null; }));
