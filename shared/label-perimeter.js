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
