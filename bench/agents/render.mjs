// Draws the diagram of every session of agents/run.mjs and measures it the
// same way for every format, in headless Chrome:
//
// - the diagram: what went to a draw.io diagram tool, else the file the
//   condition asked for, else the first diagram file or answer block in the
//   order of lib/artifacts.mjs (sources before renderings);
// - valid: it parses (draw.io XML and SVG with the browser's XML parser,
//   Mermaid with mermaid.parse(), DOT with Graphviz) and it renders (the
//   draw.io viewer, mermaid.render(), the SVG itself, Graphviz, the HTML
//   page) to something with at least one shape or label;
// - editable: shapes, labels inside a shape, connectors, and connectors with
//   both ends attached to a shape (draw.io: read from the XML; Mermaid: its
//   edges name their nodes, so they are attached by the syntax; SVG has no
//   connections, so none are attached);
// - layout: lib/geometry.mjs on the drawn SVG (the same rules for every
//   format), and for draw.io also the viewer's own layout check;
// - <out>/render/<tag>-view.png: the drawing at its own size, scaled down to
//   fit 1200 × 1400 px, on white: the image the judge sees.
//
// draw.io diagrams go through the app server's viewer as in ../render.mjs:
// files and create_diagram calls as create_diagram input, descriptions of
// the fast mode as the XML the engine drew in the session.
//
// usage: node agents/render.mjs --chrome /path/to/chrome-headless-shell
//          [--out DIR] [--match RE] [--force]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_SERVER, require, parseArgs, outDir, connectStdio, newElk } from "../lib/common.mjs";
import { hostHtml } from "../lib/viewer-host.mjs";
import { semanticToXml } from "../../shared/semantic/index.js";
import { outputsOf, primaryOf, drawioStructure, firstModel } from "./lib/artifacts.mjs";
import { geometryCheck } from "./lib/geometry.mjs";

const args = parseArgs(process.argv.slice(2));
const out = outDir(args);
const chrome = args.chrome || process.env.CHROME_PATH;
const match = args.match ? new RegExp(args.match) : null;
const puppeteer = require("puppeteer-core");
const mermaidJs = require.resolve("mermaid/dist/mermaid.min.js");
const runs = path.join(out, "runs");
const renders = path.join(out, "render");

if (!chrome)
{
  console.error("Pass --chrome <path to chrome-headless-shell> or set CHROME_PATH.");
  process.exit(1);
}

fs.mkdirSync(renders, { recursive: true });

const summaries = fs.readdirSync(runs).filter(function(f)
{
  const tag = f.replace("-summary.json", "");

  return f.endsWith("-summary.json") && (match == null || match.test(tag)) &&
    (args.force || !fs.existsSync(path.join(renders, tag + "-render.json")));
}).sort();

const server = await connectStdio(process.execPath, [APP_SERVER, "--stdio"]);
const app = await server.call("resources/read", { uri: "ui://drawio/mcp-app.html" });
const appHtml = app.result.contents[0].text;
const elk = newElk();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bench-chrome-"));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1280,1000"], userDataDir: profile });

function sleep(ms)
{
  return new Promise(function(r) { setTimeout(r, ms); });
}

// The drawing scaled down to fit 1200 × 1400 px, on white.
async function saveView(buf, file)
{
  const page = await browser.newPage();

  try
  {
    await page.setViewport({ width: 1240, height: 1440 });
    await page.setContent("<html><body style='margin:0;background:#fff'><img id='i' style='display:block;max-width:1200px;" +
      "max-height:1400px;margin:10px' src='data:image/png;base64," + buf.toString("base64") + "'></body></html>");
    await page.waitForSelector("#i");
    await page.evaluate(function() { return document.getElementById("i").decode(); });
    const img = await page.$("#i");
    await img.screenshot({ path: file });
  }
  finally
  {
    await page.close();
  }
}

// Whether a text is well-formed XML with the given root, by the browser's parser.
async function xmlCheck(page, text, mime, rootTest)
{
  return page.evaluate(function(t, m, test)
  {
    const doc = new DOMParser().parseFromString(t, m);
    const err = doc.querySelector("parsererror");

    if (err != null)
    {
      return { ok: false, error: err.textContent.slice(0, 200) };
    }

    return { ok: new RegExp(test).test(doc.documentElement.nodeName), root: doc.documentElement.nodeName };
  }, text, mime, rootTest);
}

// The largest SVG on a page or in a frame, marked for geometryCheck.
async function markRoot(frame)
{
  return frame.evaluate(function()
  {
    let best = null;
    let bestArea = 0;

    for (const s of document.querySelectorAll("svg"))
    {
      const r = s.getBoundingClientRect();

      if (r.width * r.height > bestArea && s.parentElement != null && s.parentElement.closest("svg") == null)
      {
        best = s;
        bestArea = r.width * r.height;
      }
    }

    if (best != null)
    {
      best.setAttribute("data-bench-root", "1");
    }

    return best != null;
  });
}

// --- draw.io: the app server's viewer -------------------------------------

async function drawioInput(summary, primary)
{
  if (primary.from === "file")
  {
    // the file as written for the parse check; its first page for the viewer,
    // which draws an mxGraphModel (draw.io opens the whole file)
    const raw = fs.readFileSync(path.join(out, "work", summary.tag, primary.file), "utf8");
    const model = firstModel(raw);

    return { xml: model || raw, raw: raw, wrapped: model != null && model !== raw.trim() ? "mxfile" : undefined };
  }

  const calls = JSON.parse(fs.readFileSync(path.join(runs, summary.tag + "-mcp.json"), "utf8"));
  const last = calls.filter(function(c) { return /^create_/.test(c.name) && !c.isError; }).pop();
  // what the model wrote: the arguments of its call
  const modelChars = JSON.stringify(last.input).length;

  if (last.name === "create_semantic_diagram")
  {
    // the XML the engine drew in the session: the fast mode's server saved it, a
    // hosted server returned it; else drawn again from the description
    const saved = fs.readdirSync(runs).filter(function(f) { return f.startsWith(summary.tag + "-call") && f.endsWith(".json"); })
      .map(function(f) { return JSON.parse(fs.readFileSync(path.join(runs, f), "utf8")); })
      .filter(function(c) { return c.xml != null; }).pop();

    if (saved != null)
    {
      return { xml: saved.xml, semantic: true, modelChars: modelChars };
    }

    const r = await semanticToXml(last.input, { elk: elk, hints: "ask" });

    return { xml: r.xml, semantic: true, modelChars: modelChars };
  }

  const input = { modelChars: modelChars };

  for (const k of ["xml", "mermaid", "postLayout", "direction", "routing"])
  {
    if (last.input[k] != null)
    {
      input[k] = last.input[k];
    }
  }

  return input;
}

async function renderDrawio(summary, primary, page)
{
  const input = await drawioInput(summary, primary);
  const r = { source: input.raw || input.xml || input.mermaid || "", modelChars: input.modelChars, inputKind: input.mermaid != null ? "mermaid" : input.semantic ? "semantic" : "xml" };

  if (input.xml != null)
  {
    const raw = input.raw || input.xml;
    const x = await xmlCheck(page, raw, "application/xml", "^(mxfile|mxGraphModel)$");
    r.parse = x.ok && input.xml != null && /<mxCell\b/.test(input.xml);
    r.wrapped = input.wrapped;
    r.parseError = x.error || (x.ok ? (r.parse ? undefined : "no mxCell") : undefined);
  }

  const toolInput = Object.assign({}, input);
  delete toolInput.semantic;
  delete toolInput.raw;
  delete toolInput.wrapped;
  delete toolInput.modelChars;
  const res = await server.call("tools/call", { name: "create_diagram", arguments: toolInput });

  if (res.result == null || res.result.isError)
  {
    r.renders = false;
    r.renderError = JSON.stringify(res.result || res.error).slice(0, 300);

    return r;
  }

  await page.setViewport({ width: 800, height: 1000 });
  await page.setContent(hostHtml);
  await page.evaluate(function(p, html)
  {
    window.__payload = p;
    document.getElementById("f").srcdoc = html;
  }, { arguments: toolInput, result: res.result }, appHtml);

  const t0 = Date.now();
  let ctx = [];

  while (Date.now() - t0 < 30000)
  {
    await sleep(500);
    ctx = await page.evaluate(function() { return window.__ctx; });

    if (ctx.length > 0)
    {
      await sleep(2500);
      ctx = await page.evaluate(function() { return window.__ctx; });
      break;
    }
  }

  const last = ctx.length ? ctx[ctx.length - 1] : { content: [] };
  const text = (last.content || []).filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("\n");
  const image = (last.content || []).find(function(b) { return b.type === "image"; });
  const m = /Layout check of the diagram as rendered \((\d+) problem/.exec(text);
  r.viewerIssues = m ? +m[1] : (/no problems found/.test(text) ? 0 : null);
  const xml = (/<mxGraphModel[\s\S]*<\/mxGraphModel>/.exec(text) || [null])[0] || input.xml;
  r.structure = xml != null ? drawioStructure(xml) : null;
  r.renders = image != null && r.structure != null && (r.structure.shapes + r.structure.labels) > 0;

  if (r.parse == null)
  {
    // Mermaid sent to create_diagram: valid when the viewer converted it
    r.parse = r.renders;
  }

  const frame = page.frames().find(function(f) { return f !== page.mainFrame(); });

  if (frame != null && await markRoot(frame))
  {
    r.geometry = await frame.evaluate(geometryCheck, "[data-bench-root]");
  }

  if (image != null)
  {
    r.png = Buffer.from(image.data, "base64");
  }

  r.editable = r.structure ? { shapes: r.structure.shapes, labels: r.structure.labels, labelsInShapes: r.structure.labelsInShapes,
    connectors: r.structure.connectors, attached: r.structure.attached, positions: true } : null;

  return r;
}

// --- Mermaid ---------------------------------------------------------------

function mermaidText(raw)
{
  const fenced = /```mermaid[^\n]*\n([\s\S]*?)```/.exec(raw);

  return { text: fenced ? fenced[1] : raw, fenced: !!fenced };
}

async function renderMermaid(source, page)
{
  const { text, fenced } = mermaidText(source);
  const r = { source: text, fenced: fenced || undefined };
  await page.setViewport({ width: 1600, height: 1200 });
  await page.setContent("<html><body style='margin:0;background:#fff'><div id='d' style='display:inline-block'></div></body></html>");
  await page.addScriptTag({ path: mermaidJs });
  const res = await page.evaluate(async function(t)
  {
    const big = { useMaxWidth: false };
    window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", flowchart: big, sequence: big, er: big, class: big,
      state: big });
    const out = {};

    try
    {
      await window.mermaid.parse(t);
      out.parse = true;
    }
    catch (e)
    {
      out.parse = false;
      out.parseError = String(e && e.message || e).slice(0, 300);
    }

    try
    {
      const { svg } = await window.mermaid.render("bench", t);
      document.getElementById("d").innerHTML = svg;
      out.renders = true;
    }
    catch (e)
    {
      out.renders = false;
      out.renderError = String(e && e.message || e).slice(0, 300);
    }

    const root = document.querySelector("#d svg");

    if (root != null)
    {
      root.setAttribute("data-bench-root", "1");
      const count = function(sel) { return root.querySelectorAll(sel).length; };
      out.nodes = count("g.node") + count("g.actor-top, rect.actor-top") + count("g.entity");
      out.edges = count("path.flowchart-link, .relationshipLine, line.messageLine0, line.messageLine1, path.messageLine0, " +
        "path.messageLine1, path.relation, path.transition");
    }

    return out;
  }, text);
  Object.assign(r, res);

  if (r.renders)
  {
    r.geometry = await page.evaluate(geometryCheck, "[data-bench-root]");
    r.renders = r.geometry.shapes + r.geometry.labels > 0;
    const el = await page.$("[data-bench-root]");
    r.png = Buffer.from(await el.screenshot({ type: "png" }));
    // the edges of Mermaid name their nodes: attached by the syntax
    r.editable = { shapes: r.nodes || r.geometry.shapes, labels: r.geometry.labels, labelsInShapes: r.geometry.labels,
      connectors: r.edges, attached: r.edges, positions: false };
  }

  return r;
}

// --- SVG (and Graphviz, via its SVG) ---------------------------------------

async function renderSvg(text, page)
{
  const r = { source: text };
  const x = await xmlCheck(page, text, "image/svg+xml", "^svg$");
  r.parse = x.ok;
  r.parseError = x.error;
  await page.setViewport({ width: 1600, height: 1200 });
  await page.setJavaScriptEnabled(false);
  await page.setContent("<html><body style='margin:0;background:#fff'>" + text.replace(/^<\?xml[^>]*>/, "").replace(/<!DOCTYPE[^>]*>/i, "") +
    "</body></html>");

  if (!await markRoot(page))
  {
    r.renders = false;

    return r;
  }

  r.geometry = await page.evaluate(geometryCheck, "[data-bench-root]");
  r.renders = r.geometry.width > 0 && r.geometry.height > 0 && r.geometry.shapes + r.geometry.labels > 0;

  if (r.renders)
  {
    const el = await page.$("[data-bench-root]");
    r.png = Buffer.from(await el.screenshot({ type: "png" }));
  }

  // SVG has no connections: a line ends where it was drawn
  r.editable = { shapes: r.geometry.shapes, labels: r.geometry.labels, labelsInShapes: r.geometry.labelsInOwnShape,
    connectors: r.geometry.connectors, attached: 0, positions: true };

  return r;
}

async function renderDot(text, page)
{
  let svg;

  try
  {
    svg = execFileSync("dot", ["-Tsvg"], { input: text, timeout: 30000 }).toString();
  }
  catch (e)
  {
    return { source: text, parse: false, renders: false, parseError: String(e.stderr || e.message).slice(0, 300) };
  }

  const r = await renderSvg(svg, page);
  r.source = text;
  // Graphviz edges name their nodes, but the SVG it draws holds no connection
  r.editable = Object.assign({}, r.editable, { attached: r.editable.connectors, positions: false });

  return r;
}

// --- HTML, images, text ----------------------------------------------------

async function renderHtml(file, page)
{
  const r = { source: fs.readFileSync(file, "utf8"), parse: true };
  await page.setViewport({ width: 1280, height: 1000 });

  try
  {
    await page.goto("file://" + file, { waitUntil: "networkidle0", timeout: 30000 });
  }
  catch (e)
  {
    r.renderError = e.message;
  }

  await sleep(1500);
  const height = await page.evaluate(function() { return Math.min(3000, document.documentElement.scrollHeight); });
  r.png = Buffer.from(await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1280, height: Math.max(100, height) } }));

  if (await markRoot(page))
  {
    r.geometry = await page.evaluate(geometryCheck, "[data-bench-root]");
  }

  r.renders = await page.evaluate(function()
  {
    return document.querySelectorAll("svg, canvas, img").length > 0 || document.body.innerText.trim().length > 0;
  });

  return r;
}

async function renderText(text, page)
{
  await page.setViewport({ width: 1400, height: 1000 });
  await page.setJavaScriptEnabled(false);
  await page.setContent("<html><body style='margin:0;background:#fff'><pre id='p' style='display:inline-block;margin:0;padding:12px;" +
    "font:14px/1.25 DejaVu Sans Mono, monospace'></pre></body></html>");
  await page.evaluate(function(t) { document.getElementById("p").textContent = t; }, text);
  const el = await page.$("#p");

  return { source: text, parse: true, renders: true, png: Buffer.from(await el.screenshot({ type: "png" })),
    editable: { shapes: 0, labels: 0, labelsInShapes: 0, connectors: 0, attached: 0, positions: false } };
}

// --- one session -----------------------------------------------------------

async function render(f)
{
  const summary = JSON.parse(fs.readFileSync(path.join(runs, f), "utf8"));
  const workdir = path.join(out, "work", summary.tag);
  const outputs = outputsOf(summary, workdir);
  const primary = primaryOf(summary.condition, outputs);
  const page = await browser.newPage();
  let r = {};

  try
  {
    const file = primary.file != null ? path.join(workdir, primary.file) : null;
    const text = primary.text != null ? primary.text : (file != null && !/^(image|pdf)$/.test(primary.kind) ? fs.readFileSync(file, "utf8") : null);

    if (primary.kind === "drawio" || primary.kind === "drawio-mcp")
    {
      r = await renderDrawio(summary, primary, page);
    }
    else if (/^mermaid/.test(primary.kind))
    {
      r = await renderMermaid(text, page);
    }
    else if (primary.kind === "svg")
    {
      r = await renderSvg(text, page);
    }
    else if (/^dot/.test(primary.kind))
    {
      r = await renderDot(text, page);
    }
    else if (primary.kind === "html")
    {
      r = await renderHtml(file, page);
    }
    else if (primary.kind === "image")
    {
      r = { parse: true, renders: true, png: fs.readFileSync(file),
        editable: { shapes: 0, labels: 0, labelsInShapes: 0, connectors: 0, attached: 0, positions: false } };
    }
    else if (/^text/.test(primary.kind))
    {
      r = await renderText(text, page);
    }
    else
    {
      // PlantUML, D2, Excalidraw, PDF: not drawn here
      r = { parse: null, renders: null };
    }
  }
  catch (e)
  {
    r = Object.assign(r, { renders: false, renderError: String(e.message).slice(0, 300) });
  }
  finally
  {
    await page.close();
  }

  if (r.png != null && r.renders)
  {
    if (/^image$/.test(primary.kind) && !/\.png$/i.test(primary.file))
    {
      // other image types: drawn on a page first
      const p = await browser.newPage();
      await p.setContent("<img id='i' src='data:image;base64," + r.png.toString("base64") + "'>");
      const el = await p.$("#i");
      r.png = Buffer.from(await el.screenshot({ type: "png" }));
      await p.close();
    }

    await saveView(r.png, path.join(renders, summary.tag + "-view.png"));
  }

  const info =
  {
    tag: summary.tag, condition: summary.condition, agent: summary.agent, key: summary.key, type: summary.type,
    formats: Array.from(new Set(outputs.map(function(o) { return o.kind; }))),
    primary: { kind: primary.kind, from: primary.from, file: primary.file, inputKind: r.inputKind, wrapped: r.wrapped },
    // when the diagram was there: the tool's result, or the last write of the file
    diagramSecs: primary.from === "mcp" ? summary.diagramCallSecs : primary.from === "file" ? primary.secs : summary.wallSecs,
    // the characters the model wrote: its tool call's arguments, the file, the block in the answer
    diagramChars: r.modelChars != null ? r.modelChars : r.source != null ? r.source.length : (primary.bytes || null),
    parse: r.parse == null ? null : !!r.parse, parseError: r.parseError, fenced: r.fenced,
    renders: r.renders == null ? null : !!r.renders, renderError: r.renderError,
    viewerIssues: r.viewerIssues, geometry: r.geometry || null, editable: r.editable || null,
    view: fs.existsSync(path.join(renders, summary.tag + "-view.png")) ? summary.tag + "-view.png" : null
  };
  fs.writeFileSync(path.join(renders, summary.tag + "-render.json"), JSON.stringify(info, null, 1));
  console.log(summary.tag, primary.kind, primary.file || "", "parse", info.parse, "renders", info.renders,
    "findings", info.geometry ? info.geometry.findings : "-", "viewer", info.viewerIssues == null ? "-" : info.viewerIssues,
    "edit", info.editable ? info.editable.attached + "/" + info.editable.connectors : "-", info.renderError || "");
}

let failed = 0;

for (const f of summaries)
{
  try
  {
    await render(f);
  }
  catch (e)
  {
    failed++;
    console.log(f.replace("-summary.json", ""), "render failed:", e.message);
  }
}

console.log(summaries.length - failed + " of " + summaries.length + " sessions rendered");
await browser.close();
server.close();
fs.rmSync(profile, { recursive: true, force: true });
