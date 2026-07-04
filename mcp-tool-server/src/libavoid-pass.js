// Server-side libavoid edge-routing pass for open_drawio_xml.
//
// The app server runs libavoid in the browser against the live mxGraph model.
// The tool server has no renderer — it just compresses XML into a #create= URL
// — so here we parse the mxGraphModel XML, run the SAME shared routing core
// (AvoidRouting.computeRoutes), and write the resulting waypoints back into
// the XML before it is compressed.
//
// Parsing is a deliberately small, targeted pass over `<mxCell>` / `<mxGeometry>`
// (draw.io XML is regular and the LLM is asked to emit well-formed XML with
// escaped attribute values). Anything unexpected -> return the original XML
// unrouted, so a parse hiccup never produces a broken diagram, only an
// un-routed one.

import { AvoidLib } from "../vendor/libavoid/libavoid-node.mjs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(__dirname, "..", "vendor", "libavoid", "libavoid.wasm");

// The routing core is libavoid-routing.js (canonical source: drawio-dev
// js/libavoid-js/ — the same artifact the draw.io editor bundles and the app
// server loads from the CDN). It is a plain browser script that assigns
// globalThis.AvoidRouting. Loaded through the ETag-revalidated per-user disk
// cache (routing-core-cache.js: primed by npm postinstall, refreshed from the
// viewer.diagrams.net CDN only when the file actually changed — a 304
// otherwise), so routing fixes ship with draw.io releases without
// re-vendoring here; the vendored copy is the last fallback (CDN unreachable
// with a cold cache, path not yet in a release, or the source failing the
// sanity check below). The WASM glue + binary stay vendored either way: the
// CDN only serves the browser build of the glue, and the core is
// deliberately compatible with the bindings both builds expose. One
// revalidation per process (memoized like the wasm load).
import { loadCoreSource } from "./routing-core-cache.js";

let routingPromise = null;

// Indirect eval runs in global scope, where the script's IIFE assigns
// globalThis.AvoidRouting — the same effect as a side-effect import. Throws
// on unusable source, so loadCoreSource never caches or returns one. The
// global is cleared first: loadCoreSource validates the cached copy before
// a download, and its leftover global must not vouch for a fresh body that
// fails to define AvoidRouting itself.
function evalRoutingCore(src)
{
  delete globalThis.AvoidRouting;

  (0, eval)(src);

  if (globalThis.AvoidRouting == null ||
    typeof globalThis.AvoidRouting.computeRoutes !== "function")
  {
    throw new Error("AvoidRouting missing after eval");
  }
}

function getRouting()
{
  if (routingPromise == null)
  {
    routingPromise = loadCoreSource(evalRoutingCore).then(function(src)
    {
      // Evaluate the returned choice: a NEWER download that failed
      // validation is evaluated (clearing the global) AFTER the cached
      // copy loadCoreSource falls back to, so the last eval doesn't
      // necessarily match the returned source. Eval is idempotent and the
      // file is tiny.
      evalRoutingCore(src);

      return globalThis.AvoidRouting;
    }).catch(function(e)
    {
      // stderr — stdout carries the MCP protocol
      console.error("[libavoid] routing core CDN/cache unavailable (" +
        (e && e.message) + "); using the vendored copy");

      // A script without import/export is valid ESM; import it for its
      // side effect and read the global.
      return import("../vendor/libavoid/libavoid-routing.js")
        .then(function() { return globalThis.AvoidRouting; });
    });
  }

  return routingPromise;
}

// Lazy, memoized — the wasm only loads when routing is actually requested.
let avoidPromise = null;

function getAvoid()
{
  if (avoidPromise == null)
  {
    avoidPromise = AvoidLib.load(WASM_PATH).then(function()
    {
      return AvoidLib.getInstance();
    });
  }

  return avoidPromise;
}

// Parse double-quoted attributes from a tag's attribute string into a map.
function parseAttrs(s)
{
  var attrs = {};
  var re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  var m;

  while ((m = re.exec(s)) !== null)
  {
    attrs[m[1]] = m[2];
  }

  return attrs;
}

// Find all <mxCell> blocks (self-closing or with a body).
function parseCells(xml)
{
  var cells = [];
  var re = /<mxCell\b([^>]*?)(\/>|>([\s\S]*?)<\/mxCell>)/g;
  var m;

  while ((m = re.exec(xml)) !== null)
  {
    cells.push({
      full: m[0],
      rawAttrs: m[1],
      attrs: parseAttrs(m[1]),
      selfClosing: m[2] === "/>",
      body: m[3] || ""
    });
  }

  return cells;
}

// Pull the first <mxGeometry> tag's attributes from a cell body.
function parseGeometry(body)
{
  var m = /<mxGeometry\b([^>]*?)\/?>/.exec(body);
  if (m == null) return null;
  return parseAttrs(m[1]);
}

function num(v)
{
  var n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// Parse an mxGraph style string ("key=value;key2=value2;…") into a map.
// Valueless tokens (shape names) are skipped — every key read here is k=v.
function parseStyleMap(style)
{
  var map = {};
  var parts = (style || "").split(";");

  for (var i = 0; i < parts.length; i++)
  {
    var eq = parts[i].indexOf("=");
    if (eq > 0) map[parts[i].substring(0, eq).trim()] = parts[i].substring(eq + 1);
  }

  return map;
}

// A fixed connection point on one end of an edge (exitX/exitY for the source,
// entryX/entryY for the target) as {x, y, dir} via
// AvoidRouting.constraintForPoint (clamps to the pin's [0,1] domain, derives
// the ConnDirFlags from the original values). null for a floating endpoint.
// Mirrors LibavoidRouting.fixedConstraint in the draw.io editor. The Routing
// param is the loaded AvoidRouting namespace (getRouting()).
function fixedConstraint(Routing, styleMap, source)
{
  return Routing.constraintForPoint(
    parseFloat(styleMap[source ? "exitX" : "entryX"]),
    parseFloat(styleMap[source ? "exitY" : "entryY"]));
}

// Resolved jetty size (minimum first/last segment length, px) for one end,
// mirroring mxEdgeStyle.getJettySize: sourceJettySize/targetJettySize over
// jettySize, with 'auto' derived from the end's arrow size. Two server-side
// adaptations: a missing jettySize resolves as 'auto' (what setEdgeStyle
// writes back, so the route matches a later in-editor re-route) and missing
// arrows mean the editor's stylesheet defaults (endArrow=classic, no
// startArrow) — the tool server has no stylesheet to merge.
function jettyFor(styleMap, source)
{
  var value = styleMap[source ? "sourceJettySize" : "targetJettySize"];
  if (value == null) value = styleMap.jettySize;
  if (value == null) value = "auto";

  if (value === "auto")
  {
    var type = styleMap[source ? "startArrow" : "endArrow"];
    if (type == null) type = source ? "none" : "classic";

    if (type !== "none")
    {
      var size = parseFloat(styleMap[source ? "startSize" : "endSize"]);
      if (isNaN(size)) size = 6; // mxConstants.DEFAULT_MARKERSIZE
      value = Math.max(2, Math.ceil((size + 10) / 10)) * 10; // orthBuffer 10
    }
    else
    {
      value = 20; // 2 * orthBuffer
    }
  }

  value = parseFloat(value);
  return isNaN(value) ? 0 : value;
}

// Apply the canonical libavoid edge style on an mxGraph style string, preserving
// every other key (stroke, arrows, colors, …). libavoidRouting=1 keeps the edge
// auto-routing via libavoid if the diagram is later opened and edited in the
// draw.io editor; rounded/orthogonalLoop/jettySize match what the editor's
// libavoid checkbox pairs with the flag. An explicit jettySize is preserved
// (the route was computed with it — see jettyFor); only a missing one gets the
// editor default 'auto'.
function setEdgeStyle(style)
{
  var kept = [];
  var parts = (style || "").split(";");
  var managed = {
    edgeStyle: 1, rounded: 1, curved: 1,
    libavoidRouting: 1, orthogonalLoop: 1, html: 1
  };
  // Same tokenization as jettyFor (parseStyleMap), so the written-back style
  // always matches the route just computed — a malformed token (bare
  // 'jettySize' with no value) must not suppress the default.
  var hasJetty = parseStyleMap(style).jettySize != null;

  for (var i = 0; i < parts.length; i++)
  {
    var p = parts[i].trim();
    if (p === "") continue;
    var key = p.split("=")[0];
    if (managed[key]) continue;
    kept.push(p);
  }

  kept.push("edgeStyle=orthogonalEdgeStyle");
  kept.push("rounded=0");
  kept.push("libavoidRouting=1");
  kept.push("orthogonalLoop=1");
  if (!hasJetty) kept.push("jettySize=auto");
  kept.push("html=1");
  return kept.join(";") + ";";
}

// Replace the style="..." attribute in a raw attribute string (or append it).
function withStyle(rawAttrs, newStyle)
{
  var escaped = newStyle.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  if (/\bstyle\s*=\s*"/.test(rawAttrs))
  {
    return rawAttrs.replace(/\bstyle\s*=\s*"[^"]*"/, 'style="' + escaped + '"');
  }

  return rawAttrs + ' style="' + escaped + '"';
}

// Rebuild an edge's <mxCell> block with the routed waypoints + orthogonal style.
function buildEdgeBlock(cell, wps)
{
  var rawAttrs = withStyle(cell.rawAttrs, setEdgeStyle(cell.attrs.style));

  // Preserve the existing geometry's attributes (relative, as, label x/y),
  // defaulting to a standard relative edge geometry.
  var geoAttrs = parseGeometry(cell.body) || {};
  if (geoAttrs.relative == null) geoAttrs.relative = "1";
  geoAttrs.as = "geometry";

  var geoAttrStr = Object.keys(geoAttrs).map(function(k)
  {
    return k + '="' + geoAttrs[k] + '"';
  }).join(" ");

  var pointsXml = wps.map(function(p)
  {
    return '<mxPoint x="' + p.x + '" y="' + p.y + '" />';
  }).join("");

  var geo = "<mxGeometry " + geoAttrStr + ">" +
    "<Array as=\"points\">" + pointsXml + "</Array>" +
    "</mxGeometry>";

  // Body minus any existing geometry, plus the new one.
  var body = cell.body
    .replace(/<mxGeometry\b[^>]*?\/>/g, "")
    .replace(/<mxGeometry\b[\s\S]*?<\/mxGeometry>/g, "");

  return "<mxCell" + rawAttrs + ">" + body + geo + "</mxCell>";
}

/**
 * Route the edges of a draw.io XML document with libavoid. Returns the XML with
 * orthogonal obstacle-avoiding waypoints written onto each edge, or the
 * original XML unchanged if there's nothing to route or anything goes wrong.
 *
 * @param {string} xml
 * @returns {Promise<string>}
 */
export async function routeXml(xml)
{
  try
  {
    if (typeof xml !== "string" || xml.indexOf("<mxCell") === -1) return xml;

    // The routing core module is tiny — load it up front (the expensive wasm
    // load stays deferred until edges are actually found below).
    var Routing = await getRouting();

    var cells = parseCells(xml);
    var byId = {};
    var i;

    for (i = 0; i < cells.length; i++)
    {
      var c = cells[i];
      if (c.attrs.id == null) continue;
      c.geo = parseGeometry(c.body);
      byId[c.attrs.id] = c;
    }

    // Absolute offset of a cell's parent chain (sum of ancestor vertex geos).
    function parentOffset(id)
    {
      var x = 0, y = 0;
      var cur = byId[id];
      var seen = {};

      while (cur != null && cur.attrs.parent != null && !seen[cur.attrs.parent])
      {
        seen[cur.attrs.parent] = true;
        var par = byId[cur.attrs.parent];
        if (par == null || par.attrs.vertex !== "1" || par.geo == null) break;
        x += num(par.geo.x);
        y += num(par.geo.y);
        cur = par;
      }

      return { x: x, y: y };
    }

    var vertices = [];
    var edges = [];
    var id;

    for (id in byId)
    {
      var cell = byId[id];

      if (cell.attrs.vertex === "1" && cell.geo != null)
      {
        var off = parentOffset(id);
        var w = num(cell.geo.width);
        var h = num(cell.geo.height);
        if (w > 0 && h > 0)
        {
          vertices.push({ id: id, x: num(cell.geo.x) + off.x, y: num(cell.geo.y) + off.y, w: w, h: h });
        }
      }
      else if (cell.attrs.edge === "1" && cell.attrs.source != null && cell.attrs.target != null)
      {
        // Fixed connection points (exitX/entryX…) route via directed pins and
        // the per-end jettySize gives their minimum stub — like the editor.
        var sm = parseStyleMap(cell.attrs.style);
        edges.push({ id: id, source: cell.attrs.source, target: cell.attrs.target,
          sourceConstraint: fixedConstraint(Routing, sm, true),
          targetConstraint: fixedConstraint(Routing, sm, false),
          sourceJetty: jettyFor(sm, true),
          targetJetty: jettyFor(sm, false) });
      }
    }

    if (edges.length === 0) return xml;

    var Avoid = await getAvoid();
    var routes = Routing.computeRoutes(Avoid, vertices, edges);
    var routedIds = Object.keys(routes);
    if (routedIds.length === 0) return xml;

    var out = xml;

    for (i = 0; i < routedIds.length; i++)
    {
      var eid = routedIds[i];
      var edgeCell = byId[eid];
      var eOff = parentOffset(eid);
      var wps = routes[eid].map(function(p)
      {
        return { x: p.x - eOff.x, y: p.y - eOff.y };
      });

      var block = buildEdgeBlock(edgeCell, wps);
      // split/join (not replace) so '$' in the replacement isn't special.
      out = out.split(edgeCell.full).join(block);
    }

    return out;
  }
  catch (e)
  {
    // Never break the diagram — fall back to the un-routed XML.
    return xml;
  }
}
