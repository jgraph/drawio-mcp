// Writes the cells the layouts produce as draw.io XML: one mxGraphModel
// with the default layer, one <mxCell> per line, in the order given
// (containers before their children, edges after the vertices).

export function escapeXml(s)
{
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
}

// A plain-text label as the value of an html=1 cell: escaped for HTML first
// (the model writes plain text), with line breaks as <br>.
export function htmlLabel(text)
{
  return String(text == null ? "" : text).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").split("\n").join("<br>");
}

function num(n)
{
  return String(Math.round(n * 100) / 100);
}

/**
 * Keeps ids unique and clear of the reserved "0" and "1".
 */
export class IdPool
{
  constructor()
  {
    this.used = new Set(["0", "1"]);
  }

  take(wanted)
  {
    let base = String(wanted == null || wanted === "" ? "cell" : wanted).replace(/\s+/g, "_");

    if (base === "0" || base === "1")
    {
      base = "n" + base;
    }

    let id = base;
    let i = 2;

    while (this.used.has(id))
    {
      id = base + "_" + i++;
    }

    this.used.add(id);

    return id;
  }
}

/**
 * @param {Array<object>} cells - vertices: {id, value, style, rows?, parent?,
 *   x, y, width, height} (rows: the table shorthand of
 *   shared/diagram-shorthand.js); edges: {id, value?, style, parent?, edge: true,
 *   source, target, points?: [{x, y}]}
 * @returns {string} mxGraphModel XML
 */
export function writeModel(cells)
{
  const lines = ['<mxGraphModel adaptiveColors="auto">', "<root>", '<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];

  for (const c of cells)
  {
    const head = '<mxCell id="' + escapeXml(c.id) + '"' +
      (c.value != null && c.value !== "" ? ' value="' + escapeXml(c.value) + '"' : "") +
      ' style="' + escapeXml(c.style) + '"' + (c.rows != null ? ' rows="' + escapeXml(c.rows) + '"' : "");

    if (c.edge)
    {
      let geo = '<mxGeometry relative="1" as="geometry"';

      // an end without a cell (a sequence message from the diagram's edge)
      // is a point
      const ends = (c.source == null && c.sourcePoint != null ? '<mxPoint x="' + num(c.sourcePoint.x) + '" y="' +
        num(c.sourcePoint.y) + '" as="sourcePoint"/>' : "") + (c.target == null && c.targetPoint != null ? '<mxPoint x="' +
        num(c.targetPoint.x) + '" y="' + num(c.targetPoint.y) + '" as="targetPoint"/>' : "");

      if ((c.points != null && c.points.length > 0) || ends !== "")
      {
        geo += ">" + ends + ((c.points != null && c.points.length > 0) ? '<Array as="points">' + c.points.map(function(p)
        {
          return '<mxPoint x="' + num(p.x) + '" y="' + num(p.y) + '"/>';
        }).join("") + "</Array>" : "") + "</mxGeometry>";
      }
      else
      {
        geo += "/>";
      }

      lines.push(head + ' edge="1" parent="' + escapeXml(c.parent || "1") + '"' +
        (c.source != null ? ' source="' + escapeXml(c.source) + '"' : "") +
        (c.target != null ? ' target="' + escapeXml(c.target) + '"' : "") + '>' + geo + "</mxCell>");
    }
    else
    {
      lines.push(head + ' vertex="1" parent="' + escapeXml(c.parent || "1") + '">' +
        '<mxGeometry' + (c.x ? ' x="' + num(c.x) + '"' : "") + (c.y ? ' y="' + num(c.y) + '"' : "") +
        ' width="' + num(c.width) + '" height="' + num(c.height) + '" as="geometry"/></mxCell>');
    }
  }

  lines.push("</root>", "</mxGraphModel>");

  return lines.join("\n");
}
