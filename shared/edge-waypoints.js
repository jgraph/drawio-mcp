// Waypoints a hair off a fixed connection point, for generated diagrams.
//
// An edge with a fixed connection point (exitX/exitY, entryX/entryY) leaves or
// enters the shape at a right angle to its side, and draw.io's orthogonal
// router runs the line from there to the first (or last) waypoint. A waypoint
// written a pixel or two off that point's line (y=510 for a connection point
// at y=508.8) makes the router add a jog of that size next to the shape: at
// the end of an edge, its last segment is then 1.2 px long, and the arrowhead
// takes its direction from it, pointing along the side instead of into the
// shape. This pass moves such a waypoint onto the connection point's line
// when it is less than SNAP_DISTANCE away: on a left or right side its y, on
// a top or bottom side its x. The line then runs straight out of the side.
//
// Only where the connection point is where the style says: on shapes with a
// rectangular outline, or in the middle of a side of any shape (draw.io
// projects other points of a round or slanted outline onto it), not on
// rotated, flipped or turned shapes, nor in corners. Idempotent, and a
// diagram without such waypoints comes back byte-identical.

import { transformPages } from "./mx-xml.js";

/** Waypoints closer than this to a connection point's line are moved onto it. */
export var SNAP_DISTANCE = 3;

// The absolute origin of the coordinate frame a cell's geometry is in: the
// sum of the origins of the vertices it is nested in.
function frameOrigin(model, cell)
{
  var x = 0, y = 0;
  var parent = model.getParent(cell);

  while (parent != null && model.isVertex(parent))
  {
    var geo = model.getGeometry(parent);

    if (geo == null || geo.relative) return null;

    x += geo.x;
    y += geo.y;
    parent = model.getParent(parent);
  }

  return { x: x, y: y };
}

function absoluteBounds(model, cell)
{
  var geo = model.getGeometry(cell);
  var origin = frameOrigin(model, cell);

  if (geo == null || geo.relative || origin == null) return null;

  return { x: origin.x + geo.x, y: origin.y + geo.y, width: geo.width, height: geo.height };
}

function num(v, fallback)
{
  return (typeof v === "number" && isFinite(v)) ? v : fallback;
}

/**
 * The fixed connection point of one end of an edge, in absolute
 * coordinates, with the axis a waypoint is snapped on: "y" on a left or
 * right side, "x" on a top or bottom side. Null for a floating end, a
 * corner, a point inside the shape or a point draw.io would move.
 */
function connectionPoint(graph, edge, edgeStyle, source)
{
  var model = graph.getModel();
  var terminal = model.getTerminal(edge, source);
  var prefix = source ? "exit" : "entry";
  var fx = edgeStyle[prefix + "X"], fy = edgeStyle[prefix + "Y"];

  if (terminal == null || !model.isVertex(terminal) || typeof fx !== "number" || typeof fy !== "number")
  {
    return null;
  }

  var onSide = (fx === 0 || fx === 1);
  var onEnd = (fy === 0 || fy === 1);

  // A corner has no single direction, and a point inside the shape none
  if (onSide === onEnd)
  {
    return null;
  }

  var style = graph.getCellStyle(terminal);
  var along = onSide ? fy : fx;
  var perimeter = style.perimeter;
  var projected = edgeStyle[prefix + "Perimeter"] !== 0 && perimeter != null && perimeter !== "rectanglePerimeter";

  if (num(style.rotation, 0) !== 0 || (style.direction != null && style.direction !== "east") ||
    style.flipH == 1 || style.flipV == 1 || (projected && along !== 0.5))
  {
    return null;
  }

  var b = absoluteBounds(model, terminal);

  if (b == null)
  {
    return null;
  }

  return { x: b.x + fx * b.width + num(edgeStyle[prefix + "Dx"], 0),
    y: b.y + fy * b.height + num(edgeStyle[prefix + "Dy"], 0), axis: onSide ? "y" : "x" };
}

/**
 * Moves the first and last waypoints of every edge onto the line of its fixed
 * connection point when they are less than SNAP_DISTANCE off it.
 *
 * @param {string} xml - mxGraphModel or mxfile XML
 * @returns {{xml: string, changed: number}} the XML and the number of cells
 *   that were rewritten
 */
export function snapWaypoints(xml)
{
  return transformPages(xml, function(graph)
  {
    var model = graph.getModel();

    function snap(edge)
    {
      var geo = model.getGeometry(edge);

      if (geo == null || geo.points == null || geo.points.length == 0)
      {
        return;
      }

      var style = graph.getCellStyle(edge);
      var origin = frameOrigin(model, edge);

      if (origin == null)
      {
        return;
      }

      var copy = null;
      var ends = [{ source: true, index: 0 }, { source: false, index: geo.points.length - 1 }];

      for (var i = 0; i < ends.length; i++)
      {
        var p = connectionPoint(graph, edge, style, ends[i].source);
        var wp = (copy || geo).points[ends[i].index];

        if (p == null || wp == null)
        {
          continue;
        }

        var target = p[p.axis] - origin[p.axis];
        var d = Math.abs(wp[p.axis] - target);

        if (d > 0 && d < SNAP_DISTANCE)
        {
          copy = copy || geo.clone();
          copy.points[ends[i].index][p.axis] = target;
        }
      }

      if (copy != null)
      {
        model.setGeometry(edge, copy);
      }
    }

    function visit(cell)
    {
      for (var i = 0; i < model.getChildCount(cell); i++)
      {
        var child = model.getChildAt(cell, i);

        if (model.isEdge(child))
        {
          snap(child);
        }

        visit(child);
      }
    }

    visit(model.getRoot());
  });
}
