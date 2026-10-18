// Edges that end at labels outside the shape, for generated diagrams.
//
// draw.io ends an edge that meets a vertex on the side of a label placed
// outside the shape at the label's far edge, instead of letting it cross the
// label to the shape, when the vertex has labelPerimeter=1: the convention of
// cloud architecture diagrams, where a connection from below ends under the
// icon's name. The editor sets the key on new shapes from its sidebar and when
// the Position of a label is set to top, bottom, left or right; existing
// diagrams don't have it and stay as they are. Generated XML never has it, so
// this pass adds it to every vertex with a label outside the shape, centered on
// one side, whose style doesn't define the key: a diagram from the MCP servers
// then behaves like one drawn in the editor (draw.io's viewer and libavoid
// routing honor the key; older viewers ignore it).
//
// Idempotent, and a diagram without such vertices comes back byte-identical.

import { transformPages } from "./mx-xml.js";

/**
 * Whether a resolved cell style places the label outside the shape, centered
 * on one side: verticalLabelPosition top or bottom with labelPosition center,
 * or labelPosition left or right with verticalLabelPosition middle. The same
 * test as draw.io's Graph.isLabelOutsideOnSide.
 *
 * @param {Object<string, *>} style
 * @returns {boolean}
 */
export function isLabelOutsideOnSide(style)
{
  var lp = (style != null && style.labelPosition != null) ? style.labelPosition : "center";
  var vlp = (style != null && style.verticalLabelPosition != null) ? style.verticalLabelPosition : "middle";

  return (lp === "center" && (vlp === "top" || vlp === "bottom")) ||
    (vlp === "middle" && (lp === "left" || lp === "right"));
}

/**
 * Adds labelPerimeter=1 to the vertices of every page that have a label outside
 * the shape on one side and no labelPerimeter in their style.
 *
 * @param {string} xml - mxGraphModel or mxfile XML
 * @returns {{xml: string, changed: number}} the XML and the number of cells
 *   that were rewritten
 */
export function addLabelPerimeters(xml)
{
  return transformPages(xml, function(graph)
  {
    var model = graph.getModel();

    function visit(cell)
    {
      for (var i = 0; i < model.getChildCount(cell); i++)
      {
        var child = model.getChildAt(cell, i);

        if (model.isVertex(child) && graph.getLabel(child).trim().length > 0)
        {
          var style = graph.getCellStyle(child);

          if (style.labelPerimeter == null && isLabelOutsideOnSide(style))
          {
            var s = model.getStyle(child) || "";

            model.setStyle(child, s + ((s.length > 0 && s.charAt(s.length - 1) !== ";") ? ";" : "") +
              "labelPerimeter=1;");
          }
        }

        visit(child);
      }
    }

    visit(model.getRoot());
  });
}

// Edge labels of generated diagrams.
//
// Gap: draw.io (after 32.5.5) paints a label with labelBackgroundColor=default
// and defaultLabelBackgroundColor=gap without a background and cuts its box
// out of the edge, so the line stops at the text and the page, a grid or a
// gradient shows behind it. Edge labels have the default background unless a
// color is set, so labeled edges and the label cells on edges whose
// background is default get the gap; older viewers keep painting the default
// background as before.
//
// Placement, the same for every diagram type: the text stays horizontal, so
// on a horizontal line it sits just above the line (verticalAlign=bottom) and
// the line stays whole, and on a vertical line it stays on the line, which
// breaks only for the height of the text (the gap). Straight horizontal edges
// between two shapes get the lift when the label fits above the line: between
// the shapes, where diamonds and ellipses narrow above their middle. Bent
// edges keep their labels on the line, as the route isn't known here.
//
// Idempotent; labels the diagram places itself (an offset, a position along
// the edge, a vertical alignment) and explicit backgrounds are left alone.

/**
 * Absolute bounds of a vertex: its geometry plus the origins of the vertices
 * it is nested in.
 */
function absoluteBounds(model, cell)
{
  var geo = model.getGeometry(cell);

  if (geo == null || geo.relative) return null;

  var x = geo.x, y = geo.y;
  var parent = model.getParent(cell);

  while (parent != null && model.isVertex(parent))
  {
    var pg = model.getGeometry(parent);

    if (pg == null || pg.relative) return null;

    x += pg.x;
    y += pg.y;
    parent = model.getParent(parent);
  }

  return { x: x, y: y, width: geo.width, height: geo.height };
}

/**
 * How far the outline of a shape is inside its bounds at the given distance
 * above or below its middle, on the left and right: zero for rectangles,
 * growing for diamonds and ellipses.
 */
function insetAt(style, bounds, dy)
{
  var half = bounds.height / 2;
  var t = Math.min(1, Math.abs(dy) / half);
  var shape = style.shape;

  if (shape === "rhombus" || style.perimeter === "rhombusPerimeter")
  {
    return bounds.width / 2 * t;
  }
  else if (shape === "ellipse" || shape === "doubleEllipse" || style.perimeter === "ellipsePerimeter")
  {
    return bounds.width / 2 * (1 - Math.sqrt(1 - t * t));
  }

  return 0;
}

/**
 * Estimated label size, as mx-model's getSizeForString: 0.6 em per character
 * (0.64 bold), 1.2 em per line, plus the default spacing of 2 on each side.
 */
function labelSize(text, style)
{
  var size = (typeof style.fontSize === "number") ? style.fontSize : 11;
  var bold = (typeof style.fontStyle === "number" && (style.fontStyle & 1) === 1);
  var lines = String(text).split(/<br\s*\/?>|\n/);
  var longest = 0;

  for (var i = 0; i < lines.length; i++)
  {
    longest = Math.max(longest, lines[i].replace(/<[^>]*>/g, "").replace(/&[a-z#0-9]+;/gi, "x").length);
  }

  return { width: longest * size * (bold ? 0.64 : 0.6) + 4, height: lines.length * size * 1.2 + 4 };
}

function hasKey(style, key)
{
  return new RegExp("(^|;)" + key + "=").test(style || "");
}

function appendStyle(model, cell, entries)
{
  var s = model.getStyle(cell) || "";

  model.setStyle(cell, s + ((s.length > 0 && s.charAt(s.length - 1) !== ";") ? ";" : "") + entries);
}

/**
 * The point where an edge leaves or enters a vertex with a fixed connection
 * point (exitX/exitY, entryX/entryY), or null for a floating end.
 */
function fixedPoint(style, bounds, prefix)
{
  var x = style[prefix + "X"], y = style[prefix + "Y"];

  if (typeof x !== "number" || typeof y !== "number")
  {
    return null;
  }

  return { x: bounds.x + x * bounds.width, y: bounds.y + y * bounds.height, side: (x === 0 || x === 1) ? "h" : "v" };
}

/**
 * Whether the label of the given edge should sit above the line: a straight
 * horizontal edge between two vertices, side by side, with room for the
 * label above the line between them.
 */
function isLabelAboveLine(graph, edge, style)
{
  var model = graph.getModel();
  var source = model.getTerminal(edge, true);
  var target = model.getTerminal(edge, false);
  var geo = model.getGeometry(edge);
  var raw = model.getStyle(edge) || "";

  if (source == null || target == null || geo == null || !model.isVertex(source) || !model.isVertex(target) ||
    (geo.points != null && geo.points.length > 0) || (geo.offset != null && (geo.offset.x !== 0 || geo.offset.y !== 0)) ||
    hasKey(raw, "verticalAlign") || hasKey(raw, "labelPosition") || hasKey(raw, "verticalLabelPosition") ||
    style.curved == 1 || /Elbow|elbowEdgeStyle|entityRelation|segmentEdgeStyle/.test(style.edgeStyle || ""))
  {
    return false;
  }

  var a = absoluteBounds(model, source);
  var b = absoluteBounds(model, target);

  if (a == null || b == null)
  {
    return false;
  }

  // The line runs where the fixed connection points are, or between the
  // middles of the shapes, and both ends must leave from facing sides.
  var exit = fixedPoint(style, a, "exit");
  var entry = fixedPoint(style, b, "entry");

  if ((exit != null && exit.side !== "h") || (entry != null && entry.side !== "h"))
  {
    return false;
  }

  var y1 = (exit != null) ? exit.y : a.y + a.height / 2;
  var y2 = (entry != null) ? entry.y : b.y + b.height / 2;

  if (Math.abs(y1 - y2) > 2 || (exit == null && entry == null && Math.abs((a.y + a.height / 2) - (b.y + b.height / 2)) > 2))
  {
    return false;
  }

  var left = (a.x <= b.x) ? a : b;
  var right = (left === a) ? b : a;
  var gap = right.x - (left.x + left.width);

  // A label moved along the edge (geometry x) is where the diagram wants it.
  if (gap <= 0 || (geo.x != null && geo.x !== 0))
  {
    return false;
  }

  var leftStyle = graph.getCellStyle(left === a ? source : target);
  var rightStyle = graph.getCellStyle(left === a ? target : source);
  var size = labelSize(graph.getLabel(edge), style);
  var dy = Math.abs(y1 - (left.y + left.height / 2)) + size.height / 2;
  // Centered between the shapes, so the side with less room decides.
  var room = gap + 2 * Math.min(insetAt(leftStyle, left, dy), insetAt(rightStyle, right, dy));

  return size.width <= room;
}

/**
 * Adds the label gap to labeled edges and their label cells, and moves the
 * labels of straight horizontal edges above the line where they fit.
 *
 * @param {string} xml - mxGraphModel or mxfile XML
 * @returns {{xml: string, changed: number}} the XML and the number of cells
 *   that were rewritten
 */
export function fitEdgeLabels(xml)
{
  return transformPages(xml, function(graph)
  {
    var model = graph.getModel();

    // The entries that give a label the gap: none for an explicit background
    // (a color or none, which the resolved style drops) or an existing key.
    function gapEntries(cell)
    {
      var raw = model.getStyle(cell) || "";
      var bg = /(^|;)labelBackgroundColor=([^;]*)/.exec(raw);

      if (hasKey(raw, "defaultLabelBackgroundColor") || (bg != null && bg[2] !== "default"))
      {
        return "";
      }

      return ((bg == null) ? "labelBackgroundColor=default;" : "") + "defaultLabelBackgroundColor=gap;";
    }

    function visit(cell)
    {
      for (var i = 0; i < model.getChildCount(cell); i++)
      {
        var child = model.getChildAt(cell, i);
        var labeled = graph.getLabel(child).trim().length > 0;
        var onEdge = model.isVertex(child) && model.isEdge(cell);

        if (labeled && (model.isEdge(child) || onEdge))
        {
          var style = graph.getCellStyle(child);
          var entries = gapEntries(child);

          if (model.isEdge(child) && isLabelAboveLine(graph, child, style))
          {
            entries += "verticalAlign=bottom;";
          }

          if (entries.length > 0)
          {
            appendStyle(model, child, entries);
          }
        }

        visit(child);
      }
    }

    visit(model.getRoot());
  });
}
