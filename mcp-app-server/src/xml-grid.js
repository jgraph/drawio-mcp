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
// model put them, and the result names the ones draw.io doesn't draw where
// they belong: one without a geometry isn't drawn, and one with a size and a
// cell is drawn at the top left. A size without a cell is a shape at 0, 0,
// which draw.io writes without x and y, and isn't named. Text the pass puts
// above or below the diagram (a title, a legend: a text of the layer with no
// edge and no children) doesn't count: written with a position on a page of
// cells, it loses the position and goes where the pass puts it.

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

// A cell named in the style, `row=` or `col=`.
function hasCell(style)
{
  return /(^|;)\s*(row|col)=/.test(String(style || ""));
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
// ones without a position, of those the ones draw.io doesn't draw where they
// belong (no geometry, or a size and a cell: sized) and the texts with a
// position that the pass would put above or below the diagram.
function pageShapes(graph)
{
  var model = graph.getModel();
  var page = { vertices: 0, unplaced: [], lost: [], sized: [], floats: [] };
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

          if (child.geometry == null)
          {
            page.lost.push(String(child.id));
          }
          else if (hasCell(child.style))
          {
            page.lost.push(String(child.id));
            page.sized.push(String(child.id));
          }
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
 * which of them have no position, which of those draw.io doesn't draw where
 * they belong on a page with positions (lost: no geometry, or a size and a
 * cell; sized: the ones with a size, drawn at the top left), and which have
 * a position but are texts the pass puts above or below the diagram (a
 * title, a legend). The pages come last first, as transformPages visits
 * them.
 *
 * @param {string} xml - mxGraphModel or mxfile XML
 * @returns {{vertices: number, unplaced: string[], lost: string[], sized: string[], floats: string[],
 *   open: boolean}[]} one entry per page; open: the pass lays it out
 */
export function pagePlacement(xml)
{
  var pages = [];

  transformPages(xml, function(graph)
  {
    var page = pageShapes(graph);

    pages.push({ vertices: page.vertices, unplaced: page.unplaced, lost: page.lost, sized: page.sized,
      floats: page.floats.map(function(cell)
      {
        return String(cell.id);
      }), open: isOpen(page) });
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
 * @returns {{xml: string, laidOut: number, shapes: number, mixed: string[], sized: string[],
 *   failed: string[], stats: object|null}}
 *   laidOut: the pages placed; shapes: the shapes on them; mixed: the shapes
 *   without a position on pages that have positions for others, which
 *   draw.io doesn't draw where they belong (sized: the ones of them with a
 *   size, drawn at the top left); failed: the shapes of the pages of cells
 *   the pass left as they were (not drawn)
 */
export function layoutXmlOnGrid(xml)
{
  var pages = pagePlacement(xml);
  var mixed = [];
  var sized = [];
  var floats = new Set();
  var open = 0;
  var shapes = 0;

  pages.forEach(function(p)
  {
    if (p.open)
    {
      open++;
      shapes += p.vertices;
      p.floats.forEach(function(id)
      {
        floats.add(id);
      });
    }
    else
    {
      mixed = mixed.concat(p.lost);
      sized = sized.concat(p.sized);
    }
  });

  // A page the model placed in part keeps the whole diagram from the pass,
  // so the model sends it again one way or the other. Shapes it would draw
  // as written (a size and no cell: one at 0, 0) don't count.
  if (open === 0 || mixed.length > 0)
  {
    return { xml: xml, laidOut: 0, shapes: 0, mixed: mixed, sized: sized, failed: [], stats: null };
  }

  // As the engine does (placeCompactXml in shared/semantic/boxes.js): the
  // edges filed at the nearest common ancestor of their ends first, then one
  // grid for the page, as the semantic tool reads its cells. Only the pages
  // of cells: the pass would also lay out a placed page with a shape at
  // 0, 0, written without x and y.
  var r = gridLayoutDiagram(normalizeDiagram(freeFloats(xml)).xml, { hints: "page", page: function(graph)
  {
    return isOpen(pageShapes(graph));
  } });

  // A page the pass couldn't place (it never breaks a diagram, so an error
  // leaves the page as it was) is still a page of cells, whose shapes
  // draw.io doesn't draw. Its titles and legends lost their position for
  // the pass and aren't named.
  var failed = [];

  if (r.stats.pages < open)
  {
    pagePlacement(r.xml).forEach(function(p)
    {
      if (p.open)
      {
        shapes -= p.vertices;
        failed = failed.concat(p.unplaced.filter(function(id)
        {
          return !floats.has(id);
        }));
      }
    });
  }

  return { xml: (r.stats.pages > 0) ? r.xml : xml, laidOut: r.stats.pages, shapes: shapes, mixed: [], sized: [],
    failed: failed, stats: r.stats };
}

// The ids of a list of shapes for a message, at most eight.
function idList(ids)
{
  return ids.slice(0, 8).join(", ") + (ids.length > 8 ? ", …" : "");
}

/**
 * What the model is told about the pass, or null when it didn't run and
 * found nothing to say: a page placed on the grid is changed by sending it
 * again the same way, shapes without a position on a page with positions
 * aren't drawn where they belong, and the shapes of a page the pass couldn't
 * place aren't drawn.
 *
 * @param {{laidOut: number, shapes: number, mixed: string[], sized?: string[], failed?: string[],
 *   ignored?: string[]}} r - layoutXmlOnGrid's result; ignored: the options of the call the server
 *   left out for a diagram it placed (postLayout, routing)
 * @returns {{note: string|null, warning: string|null}}
 */
export function xmlGridMessages(r)
{
  var note = null;
  var warning = null;
  var sized = r.sized || [];
  var failed = r.failed || [];
  var ignored = (r.ignored || []).map(function(o)
  {
    return "`" + o + "`";
  });

  if (r.laidOut > 0)
  {
    note = "The server placed the " + r.shapes + " shapes on their cells and routed the connectors" +
      (ignored.length > 0 ? ", without the " + ignored.join(" and ") + " you passed, which would undo that" : "") + ". " +
      "To change the diagram, send the whole XML again the same way: cells (row, col), no positions, the same ids.";
  }

  if (r.mixed.length > 0)
  {
    var many = r.mixed.length > 1;
    var fate = (sized.length === 0) ? (many ? "they are" : "it is") + " not drawn" :
      (sized.length === r.mixed.length) ? (many ? "they are" : "it is") + " drawn at the top left" :
        "the ones without a geometry are not drawn and the others are drawn at the top left";

    warning = r.mixed.length + " shape" + (many ? "s have" : " has") + " no position (" + idList(r.mixed) +
      ") while the others have one, so " + fate + " and nothing was placed for you. " +
      "Give every shape a position, or none and a cell (row, col) each to have the server place them all.";
  }
  else if (failed.length > 0)
  {
    warning = "The server could not place " + failed.length + " shape" + (failed.length > 1 ? "s" : "") +
      " (" + idList(failed) + "), so " + (failed.length > 1 ? "they are" : "it is") + " not drawn. " +
      "Send the diagram again with a position for " + (failed.length > 1 ? "each of them" : "it") +
      " (an mxGeometry with x, y, width and height).";
  }

  return { note: note, warning: warning };
}
