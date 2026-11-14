// The grid pass for create_diagram's XML (behind the switch, see
// resolveSemanticTypes in shared.js): a model that writes XML gives every
// shape its cell (`row=1;col=2;` in the style) instead of a position, and the
// server places the diagram with the same pass the semantic engine uses
// (shared/grid-layout.js): sizes from the text, one grid for the page,
// containers around their members, lanes as bands, the lines planned with
// the room they need.
//
// Only a page whose shapes all have no position is laid out. A page the model
// placed passes byte-identical, and so does a page that has positions for
// some shapes and none for others: the shapes with a position stay where the
// model put them, and the result names the ones without, which draw.io
// doesn't draw. Text the pass puts above or below the diagram (a title, a
// legend: a text of the layer with no edge and no children) doesn't count:
// written with a position on a page of cells, it loses the position and goes
// where the pass puts it.

import { transformPages } from "../../shared/mx-xml.js";
import { gridLayoutDiagram } from "../../shared/grid-layout.js";
import { normalizeDiagram } from "../../shared/normalize-model.js";

/** The entry of DRAWIO_SEMANTIC_TYPES that switches the pass on. */
export const XML_GRID = "xml-grid";

// As the grid pass reads a position: an x or a y in the geometry as written.
function hasPosition(cell)
{
  var geo = cell.geometry;

  return geo != null && geo.origAttrs != null && (geo.origAttrs.x != null || geo.origAttrs.y != null);
}

// As the grid pass reads a text: the style `text`, or neither fill nor stroke.
function isText(style)
{
  var parts = String(style || "").split(";");
  var first = null;
  var map = {};

  for (var i = 0; i < parts.length; i++)
  {
    var p = parts[i].trim();
    var eq = p.indexOf("=");

    if (p === "")
    {
      continue;
    }

    if (eq < 0)
    {
      first = (first == null) ? p : first;
    }
    else
    {
      map[p.substring(0, eq)] = p.substring(eq + 1);
    }
  }

  return first === "text" || (map.strokeColor === "none" && map.fillColor === "none");
}

// The shapes of one page as the grid pass sees them (vertices, without edge
// labels and without the rows of a table, which lays them out itself), the
// ones without a position, and the texts with one that the pass would put
// above or below the diagram.
function pageShapes(graph)
{
  var model = graph.getModel();
  var page = { vertices: 0, unplaced: [], floats: [] };
  var texts = [];
  var connected = new Set();

  (function visit(cell, top)
  {
    for (var i = 0; i < model.getChildCount(cell); i++)
    {
      var child = model.getChildAt(cell, i);

      if (model.isEdge(child))
      {
        connected.add(model.getTerminal(child, true));
        connected.add(model.getTerminal(child, false));
      }
      else if (model.isVertex(child) && !(child.geometry != null && child.geometry.relative))
      {
        page.vertices++;

        if (!hasPosition(child))
        {
          page.unplaced.push(String(child.id));
        }
        else if (top && model.getChildCount(child) === 0 && isText(child.style))
        {
          texts.push(child);
        }

        if (!/(^|;)\s*childLayout=/.test(String(child.style || "")))
        {
          visit(child, false);
        }
      }
      else
      {
        // The root's children are the layers, whose shapes are the top level.
        visit(child, cell === model.getRoot());
      }
    }
  })(model.getRoot(), false);

  page.floats = texts.filter(function(cell)
  {
    return !connected.has(cell);
  });

  return page;
}

// A page the pass lays out: shapes without a position, and the others only
// texts it puts above or below the diagram.
function isOpen(page)
{
  return page.unplaced.length > 0 && page.unplaced.length + page.floats.length === page.vertices;
}

/**
 * The shapes of every page as the grid pass sees them (vertices, without
 * edge labels and without the rows of a table, which lays them out itself),
 * which of them have no position, and which have one but are texts the pass
 * puts above or below the diagram (a title, a legend).
 *
 * @param {string} xml - mxGraphModel or mxfile XML
 * @returns {{vertices: number, unplaced: string[], floats: string[]}[]} one entry per page
 */
export function pagePlacement(xml)
{
  var pages = [];

  transformPages(xml, function(graph)
  {
    var page = pageShapes(graph);

    pages.push({ vertices: page.vertices, unplaced: page.unplaced, floats: page.floats.map(function(cell)
    {
      return String(cell.id);
    }) });
  });

  return pages;
}

// The positions of the titles and legends on the pages the pass lays out,
// taken away so the pass places them; their sizes stay.
function freeFloats(xml)
{
  return transformPages(xml, function(graph)
  {
    var model = graph.getModel();
    var page = pageShapes(graph);

    if (!isOpen(page))
    {
      return;
    }

    page.floats.forEach(function(cell)
    {
      var geo = cell.geometry.clone();
      var attrs = {};

      for (var k in geo.origAttrs)
      {
        if (k !== "x" && k !== "y")
        {
          attrs[k] = geo.origAttrs[k];
        }
      }

      geo.origAttrs = attrs;
      geo.x = 0;
      geo.y = 0;
      model.setGeometry(cell, geo);
      // A text written at 0, 0 is the same geometry by value, and its x and y
      // still have to go.
      model.changedGeometry.add(cell);
    });
  }).xml;
}

/**
 * Lays out the pages of a diagram whose shapes have no position, as one grid
 * for the page with the cells the model named (`row`, `col`); pages with
 * positions stay as they are. Run after the shorthand expansion and the icon
 * resolver, before the passes every XML diagram goes through.
 *
 * @param {string} xml - draw.io XML
 * @returns {{xml: string, laidOut: number, shapes: number, mixed: string[], stats: object|null}}
 *   laidOut: the pages placed; shapes: the shapes on them; mixed: the shapes
 *   without a position on pages that have positions for others (not drawn)
 */
export function layoutXmlOnGrid(xml)
{
  var pages = pagePlacement(xml);
  var mixed = [];
  var open = 0;
  var shapes = 0;

  pages.forEach(function(p)
  {
    if (p.unplaced.length === 0)
    {
      return;
    }

    if (!isOpen(p))
    {
      mixed = mixed.concat(p.unplaced);
    }
    else
    {
      open++;
      shapes += p.vertices;
    }
  });

  // The pass lays out every page with a shape without a position, so a page
  // the model placed in part keeps the whole diagram from it: placing it
  // would move the shapes the model placed.
  if (open === 0 || mixed.length > 0)
  {
    return { xml: xml, laidOut: 0, shapes: 0, mixed: mixed, stats: null };
  }

  // As the engine does (placeCompactXml in shared/semantic/boxes.js): the
  // edges filed at the nearest common ancestor of their ends first, then one
  // grid for the page, as the semantic tool reads its cells.
  var r = gridLayoutDiagram(normalizeDiagram(freeFloats(xml)).xml, { hints: "page" });

  return { xml: r.xml, laidOut: r.stats.pages, shapes: shapes, mixed: [], stats: r.stats };
}

/**
 * What the model is told about the pass, or null when it didn't run and
 * found nothing to say: a page placed on the grid is changed by sending it
 * again the same way, and shapes without a position on a page with
 * positions aren't drawn.
 *
 * @param {{laidOut: number, shapes: number, mixed: string[]}} r - layoutXmlOnGrid's result
 * @returns {{note: string|null, warning: string|null}}
 */
export function xmlGridMessages(r)
{
  var note = null;
  var warning = null;

  if (r.laidOut > 0)
  {
    note = "The server placed the " + r.shapes + " shapes on their cells and routed the connectors. " +
      "To change the diagram, send the whole XML again the same way: cells (row, col), no positions, the same ids.";
  }

  if (r.mixed.length > 0)
  {
    var ids = r.mixed.slice(0, 8).join(", ") + (r.mixed.length > 8 ? ", …" : "");

    warning = r.mixed.length + " shape" + (r.mixed.length > 1 ? "s have" : " has") + " no position (" + ids +
      ") while the others have one, so " + (r.mixed.length > 1 ? "they are" : "it is") + " not drawn and nothing was placed " +
      "for you. Give every shape a position, or none and a cell (row, col) each to have the server place them all.";
  }

  return { note: note, warning: warning };
}
