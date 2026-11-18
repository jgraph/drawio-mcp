import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { buildHtml, processMermaidBundle } from "../src/shared.js";
import { LIBAVOID_FILES } from "../src/libavoid-versions.js";

// Swimlane edges routed around the shapes: drawio-mermaid routes the edges of
// a swimlane-beta diagram with libavoid when the page has it and not the
// editor's own router (globalThis.Avoid and AvoidRouting, draw.io's
// js/libavoid-js/libavoid.min.js and libavoid-routing.js). The plugins'
// scripts/mermaid-to-drawio.js loads both from the CDN, as the app server's
// viewer does. Converted through a local mirror of viewer.diagrams.net/js/,
// which logs what the script loads and can leave libavoid out: then the
// diagram converts as before, its edges as the layout drew them.
//
// The routing needs a drawio-mermaid that has it (jgraph/drawio-mermaid#20).
// MERMAID_PATH=<built bundle> serves that one in place of the CDN's, as the
// Node server's MERMAID_PATH inlines it. With a build without the routing the
// routing checks are skipped and loading libavoid must change nothing.
//
// Needs a browser and the network, like test/mermaid-types.test.js: skipped
// without them or with DRAWIO_TEST_BROWSER=off. Run it through browser-slot
// where that is the rule.

const require = createRequire(import.meta.url);
const converter = require("../../plugins/claude-code/skills/drawio/scripts/mermaid-to-drawio.js");

const CDN = "https://viewer.diagrams.net/js/";
const VIEWER_FILE = "viewer-static.min.js";
const MERMAID_FILE = "mermaid/drawio-mermaid.min.js";

// The files the app server's viewer loads, in its order
const ROUTER_FILES = LIBAVOID_FILES.map(function(file)
{
  return "libavoid-js/" + file;
});

// The swimlane example of Mermaid's documentation. As the layout draws it,
// the line from Pay to Raise invoice runs through Pick items.
const SWIMLANE = "swimlane-beta LR\n" +
  "  subgraph Customer\n" +
  "    Browse[Browse catalogue]\n" +
  "    Pay[Pay]\n" +
  "  end\n" +
  "  subgraph Warehouse\n" +
  "    Pick[Pick items]\n" +
  "    Ship[Ship order]\n" +
  "  end\n" +
  "  subgraph Finance\n" +
  "    Invoice[Raise invoice]\n" +
  "  end\n" +
  "  Browse --> Pay\n" +
  "  Pay --> Pick\n" +
  "  Pick --> Ship\n" +
  "  Pay --> Invoice";

// The MCP Apps host isn't there: the viewer's App gets nothing from it
const APP_STUB = "var App = function() {};" +
  "App.prototype.connect = function() { return new Promise(function() {}); };" +
  "App.prototype.getHostContext = function() { return null; };" +
  "App.prototype.getHostCapabilities = function() { return {}; };" +
  "App.prototype.getHostVersion = function() { return null; };" +
  "App.prototype.sendSizeChanged = function() { return Promise.resolve(); };" +
  "App.prototype.updateModelContext = function() { return Promise.resolve(); };";

// A mirror of the CDN's js/ folder on 127.0.0.1. It logs every file asked
// for, keeps the CDN's answers for the next run, serves mermaidJs as the
// drawio-mermaid bundle when given, and answers 404 for libavoid while
// withoutRouter is set.
function startMirror(mermaidJs)
{
  var cache = Object.create(null);
  var mirror = { log: [], status: Object.create(null), withoutRouter: false, mermaidJs: null };

  function upstream(file)
  {
    if (cache[file] == null)
    {
      cache[file] = fetch(CDN + file).then(async function(res)
      {
        return { status: res.status, type: res.headers.get("content-type"),
          body: Buffer.from(await res.arrayBuffer()) };
      });
    }

    return cache[file];
  }

  var server = http.createServer(function(req, res)
  {
    var file = new URL(req.url, "http://mirror/").pathname.replace(/^\/+/, "");
    var answer;

    mirror.log.push(file);

    if (mirror.withoutRouter && file.indexOf("libavoid-js/") === 0)
    {
      answer = Promise.resolve({ status: 404, body: Buffer.alloc(0) });
    }
    else if (file === MERMAID_FILE && mermaidJs != null)
    {
      answer = Promise.resolve({ status: 200, body: Buffer.from(mermaidJs) });
    }
    else
    {
      answer = upstream(file);
    }

    answer.then(function(a)
    {
      mirror.status[file] = a.status;

      if (file === MERMAID_FILE && a.status === 200)
      {
        mirror.mermaidJs = a.body.toString("utf8");
      }

      res.writeHead(a.status, { "Content-Type": a.type || "text/javascript; charset=utf-8",
        "Access-Control-Allow-Origin": "*" });
      res.end(a.body);
    }, function(e)
    {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(e.message);
    });
  });

  return new Promise(function(resolve)
  {
    server.listen(0, "127.0.0.1", function()
    {
      mirror.base = "http://127.0.0.1:" + server.address().port + "/";
      mirror.close = function()
      {
        server.closeAllConnections();

        return new Promise(function(done) { server.close(done); });
      };
      resolve(mirror);
    });
  });
}

// Opens a page, retried without the sandbox where Chrome can't start it
async function openPage(browser, url)
{
  var cdp = converter.launch(browser);

  try
  {
    return { cdp: cdp, evaluate: await converter.openPage(cdp, url) };
  }
  catch (e)
  {
    await cdp.close();

    if (e.code !== "NO_SANDBOX")
    {
      throw e;
    }

    cdp = converter.launch(browser, ["--no-sandbox"]);

    return { cdp: cdp, evaluate: await converter.openPage(cdp, url) };
  }
}

// Runs in the page: loads a script, true once it ran
function loadScript(src)
{
  return new Promise(function(resolve)
  {
    var script = document.createElement("script");
    script.src = src;
    script.onload = function() { resolve(true); };
    script.onerror = function() { resolve(false); };
    document.head.appendChild(script);
  });
}

// Runs in the app's page: the viewer's conversion, as a chat shows it
function viewerConvert(text)
{
  var start = Date.now();

  return new Promise(function waitForViewer(resolve)
  {
    if ((typeof convertMermaidToXml === "function" && typeof mxMermaidToDrawio !== "undefined" &&
      typeof Graph !== "undefined") || Date.now() - start > 60000)
    {
      resolve();
    }
    else
    {
      setTimeout(function() { waitForViewer(resolve); }, 50);
    }
  }).then(function()
  {
    if (typeof convertMermaidToXml !== "function" || typeof mxMermaidToDrawio === "undefined")
    {
      return { error: "the viewer's converter did not load" };
    }

    return convertMermaidToXml(text).then(function(xml)
    {
      return { xml: xml, router: typeof Avoid !== "undefined" && typeof AvoidRouting !== "undefined" };
    }, function(e)
    {
      return { error: e.message };
    });
  });
}

// Runs in a page with the viewer: draws the diagram and returns where draw.io
// draws its shapes and connectors, in diagram units
function measureInPage(xml)
{
  var container = document.createElement("div");
  container.style.cssText = "position:absolute;left:0;top:0;width:2000px;height:2000px;";
  document.body.appendChild(container);

  var graph = new Graph(container);
  var model = graph.getModel();
  var doc = mxUtils.parseXml(xml);
  new mxCodec(doc).decode(doc.documentElement, model);

  var view = graph.view;
  var s = view.scale;
  var t = view.translate;
  var out = { vertices: [], edges: [] };

  function ancestors(cell)
  {
    var ids = [];

    for (var p = model.getParent(cell); p != null; p = model.getParent(p))
    {
      ids.push(p.id);
    }

    return ids;
  }

  function label(cell)
  {
    var v = cell.value;

    return String((v != null && typeof v === "object") ? v.getAttribute("label") : (v || ""));
  }

  Object.keys(model.cells).forEach(function(id)
  {
    var cell = model.cells[id];
    var state = view.getState(cell);
    var style = cell.style || "";

    if (state == null)
    {
      return;
    }

    if (model.isVertex(cell))
    {
      out.vertices.push({ id: id, label: label(cell), ancestors: ancestors(cell),
        lane: /(^|;)(shape=)?swimlane(;|$)/.test(style), text: /^text;/.test(style),
        x: state.x / s - t.x, y: state.y / s - t.y, w: state.width / s, h: state.height / s });
    }
    else if (model.isEdge(cell))
    {
      var src = model.getTerminal(cell, true);
      var trg = model.getTerminal(cell, false);
      var geo = model.getGeometry(cell);

      out.edges.push({ id: id, source: src && src.id, target: trg && trg.id,
        waypoints: (geo != null && geo.points != null) ? geo.points.length : 0,
        points: (state.absolutePoints || []).map(function(p)
        {
          return { x: p.x / s - t.x, y: p.y / s - t.y };
        }) });
    }
  });

  graph.destroy();
  container.parentNode.removeChild(container);

  return out;
}

// The connectors that run through a shape that is not one of their ends nor
// around one (lanes and text don't count), as "edge through label"
function crossings(drawn)
{
  var byId = Object.create(null);
  var out = [];

  drawn.vertices.forEach(function(v) { byId[v.id] = v; });

  var nodes = drawn.vertices.filter(function(v) { return !v.lane && !v.text; });

  drawn.edges.forEach(function(e)
  {
    var src = byId[e.source];
    var trg = byId[e.target];

    if (src == null || trg == null)
    {
      return;
    }

    nodes.forEach(function(v)
    {
      if (v.id === src.id || v.id === trg.id || src.ancestors.indexOf(v.id) >= 0 ||
        trg.ancestors.indexOf(v.id) >= 0)
      {
        return;
      }

      for (var i = 1; i < e.points.length; i++)
      {
        var p = e.points[i - 1];
        var q = e.points[i];

        // The segment's box against the shape's, shrunk by 2
        if (Math.max(p.x, q.x) > v.x + 2 && Math.min(p.x, q.x) < v.x + v.w - 2 &&
          Math.max(p.y, q.y) > v.y + 2 && Math.min(p.y, q.y) < v.y + v.h - 2)
        {
          out.push(e.id + " through \"" + v.label + "\"");
          break;
        }
      }
    });
  });

  return out;
}

// The shapes by label with their boxes, and the connectors by their ends
function outline(drawn)
{
  var byId = Object.create(null);

  drawn.vertices.forEach(function(v) { byId[v.id] = v; });

  return {
    vertices: drawn.vertices.map(function(v)
    {
      return [v.label, Math.round(v.x), Math.round(v.y), Math.round(v.w), Math.round(v.h)].join(" ");
    }).sort(),
    edges: drawn.edges.map(function(e)
    {
      return (byId[e.source] || {}).label + " -> " + (byId[e.target] || {}).label;
    }).sort()
  };
}

async function convertAll()
{
  if (/^(off|0|false|none)$/i.test(process.env.DRAWIO_TEST_BROWSER || ""))
  {
    return { skip: "DRAWIO_TEST_BROWSER is off" };
  }

  var browser = converter.findBrowser();

  if (browser == null)
  {
    return { skip: "no Chrome, Edge or Chromium found (set CHROME_PATH)" };
  }

  var mermaidJs = process.env.MERMAID_PATH ?
    processMermaidBundle(fs.readFileSync(path.resolve(process.env.MERMAID_PATH), "utf-8")) : null;
  var mirror = await startMirror(mermaidJs);
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "mermaid-swimlane-"));

  try
  {
    // The plugins' converter, with libavoid and without it
    var routed;
    var unrouted;
    var routedLog;
    var routedStatus;

    try
    {
      routed = (await converter.convertMermaid([SWIMLANE], { browser: browser, bundleBase: mirror.base }))[0];
      routedLog = mirror.log.slice();
      routedStatus = Object.assign({}, mirror.status);
      mirror.withoutRouter = true;
      unrouted = (await converter.convertMermaid([SWIMLANE], { browser: browser, bundleBase: mirror.base }))[0];
      mirror.withoutRouter = false;
    }
    catch (e)
    {
      return { skip: "the converter could not be loaded: " + e.message };
    }

    // The app server's viewer, from the HTML the server serves, with the
    // same drawio-mermaid; then where draw.io draws the three results
    fs.writeFileSync(path.join(dir, "viewer.html"),
      buildHtml(APP_STUB, "", mermaidJs, {}));

    var page = await openPage(browser, pathToFileURL(path.join(dir, "viewer.html")).href);

    try
    {
      var start = Date.now();

      while (!(await page.evaluate(function()
      {
        return location.protocol === "file:" && document.readyState === "complete";
      }).catch(function() { return false; })))
      {
        if (Date.now() - start > 60000)
        {
          throw new Error("The app's page did not load");
        }

        await new Promise(function(resolve) { setTimeout(resolve, 100); });
      }

      var viewer = await page.evaluate(viewerConvert, SWIMLANE);
      var drawn = {};
      var converted = { routed: routed, unrouted: unrouted, viewer: viewer };

      for (var key in converted)
      {
        drawn[key] = (converted[key].xml != null) ? await page.evaluate(measureInPage, converted[key].xml) : null;
      }

      return { routed: routed, unrouted: unrouted, viewer: viewer, drawn: drawn,
        routedLog: routedLog, routedStatus: routedStatus,
        routingBuild: /AvoidRouting/.test(mirror.mermaidJs || "") };
    }
    finally
    {
      await page.cdp.close();
    }
  }
  finally
  {
    await mirror.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const results = await convertAll();
const skip = results.skip || false;
const noRouting = skip || (!results.routingBuild &&
  "the drawio-mermaid in use doesn't route swimlanes (set MERMAID_PATH to a build that does)");

test("the plugins' converter loads libavoid after its bundles, from the CDN as draw.io does", { skip: skip }, function()
{
  var log = results.routedLog;
  var mermaidAt = log.indexOf(MERMAID_FILE);

  assert.ok(log.indexOf(VIEWER_FILE) >= 0 && mermaidAt > log.indexOf(VIEWER_FILE), log.join(", "));
  assert.deepEqual(log.filter(function(f) { return f.indexOf("libavoid-js/") === 0; }), ROUTER_FILES,
    "the router, then its routing core: " + log.join(", "));
  assert.ok(log.indexOf(ROUTER_FILES[0]) > mermaidAt, log.join(", "));

  ROUTER_FILES.forEach(function(file)
  {
    assert.equal(results.routedStatus[file], 200, CDN + file);
  });
});

test("without libavoid the plugins' converter converts a swimlane diagram as before", { skip: skip }, function()
{
  assert.equal(results.unrouted.error, undefined, results.unrouted.error);
  assert.ok(results.drawn.unrouted.edges.length >= 4, "connectors");
  assert.ok(results.drawn.unrouted.edges.every(function(e) { return e.waypoints === 0; }),
    "the edges as the layout drew them");

  // The same shapes in the same places, and the same connectors
  assert.deepEqual(outline(results.drawn.unrouted), outline(results.drawn.routed));

  if (!results.routingBuild)
  {
    // A drawio-mermaid without the routing doesn't use libavoid
    assert.equal(results.routed.xml, results.unrouted.xml);
  }
});

test("the plugins' converter routes swimlane edges around the shapes with libavoid", { skip: noRouting }, function()
{
  var before = crossings(results.drawn.unrouted);
  var after = crossings(results.drawn.routed);

  assert.equal(results.routed.error, undefined, results.routed.error);
  assert.ok(before.length > 0, "the layout's lines run through a shape, so the routing has something to do");
  assert.deepEqual(after, [], "connectors through shapes after routing");
  assert.ok(results.drawn.routed.edges.some(function(e) { return e.waypoints > 0; }),
    "the rerouted edge has waypoints");
  assert.ok(results.drawn.routed.edges.every(function(e) { return e.source != null && e.target != null; }),
    "every edge connected");
});

test("the app server's viewer routes swimlane edges around the shapes with libavoid", { skip: noRouting }, function()
{
  assert.equal(results.viewer.error, undefined, results.viewer.error);
  assert.equal(results.viewer.router, true, "libavoid in the viewer's page");
  assert.deepEqual(crossings(results.drawn.viewer), [], "connectors through shapes after routing");
  assert.ok(results.drawn.viewer.edges.some(function(e) { return e.waypoints > 0; }),
    "the rerouted edge has waypoints");
});
