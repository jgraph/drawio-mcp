// Two shorthands for draw.io XML that a model writes, expanded into the cells
// and styles draw.io draws. Most of what a model writes for a diagram is
// style strings and table rows that differ in one word: in the benchmark of
// November 2026, styles were about half of the XML, and 75 of the 86 cells of
// a UML class diagram were single attribute rows, each with its own style and
// geometry. The time a diagram takes is mostly the time the model spends
// writing it, so these shorthands make it write less:
//
//   rows   An attribute on a table cell (an ER entity, a UML class) that lists
//          its rows, separated by `|`: rows="PK id|FK author_id|title". Each
//          row becomes a child cell of the table, 26 px tall (more for larger
//          fonts), and `---` a separator line (between the attributes and the
//          methods of a class). The table gets the list-table style (a
//          swimlane with a stack layout) under its own style, its height from
//          the rows, and a width that fits the longest row when none is given.
//          A row's id is the table's id, a dot and the row's name: the first
//          word that isn't a key marker (PK, FK, UK) or UML visibility, so
//          `FK author_id` in table `book` is `book.author_id` and
//          `+ total(): Decimal` in `Order` is `Order.total`. A second row of
//          the same name gets `.2`, a row without a word its position (from
//          1). Edges connect to these ids; one that names a row by position
//          (`book.3`) or in another case is pointed at the row. `\|` or
//          `&#124;` is a `|` inside a row.
//
//   role   A style key for the kinds of shape a diagram uses most, drawn in
//          the calm theme: role=step, decision, start, end, error, data,
//          external, container. The role brings the shape, the colors,
//          fontSize=14, html=1 and whiteSpace=wrap; whatever else the style
//          says is kept and wins over the role's keys (role=step;
//          fillColor=#FFF0E5 is an orange step). A shape without width or
//          height gets the role's size, and a container inside another one is
//          white. On a table, a role only sets the colors. Unknown roles are
//          left as written.
//
// Both are expanded by the app server before anything else sees the diagram,
// and by its viewer on the raw tool input, so the diagram draws the same while
// it streams in. The result is plain draw.io XML: no `rows` attribute and no
// `role` key is left, so expanding again changes nothing, and a diagram
// without either comes back byte-identical.
//
// String in, string out, no XML parser and no DOM, so it runs in Node, in the
// Worker and in the browser. createDiagramShorthand is self-contained (no
// imports, no outer-scope references): the viewer inlines its source with
// toString().

/**
 * Builds the shorthand API. Self-contained, so that its source can be inlined
 * into the viewer HTML.
 *
 * @returns {{expand: function(string): {xml: string, changed: number},
 *   roleStyle: function(string, string=, boolean=): ?string,
 *   rowIds: function(string, string): Array<string>,
 *   roles: Object<string, {style: string, width: number, height: number}>}}
 */
export function createDiagramShorthand()
{
  var FONT = "fontColor=#1B1F24;fontSize=14;";

  // The calm theme's role colors (shared/xml-reference.md, Color themes) with
  // the shapes and the default sizes of the rigid grid.
  var ROLES =
  {
    step: { style: "rounded=1;whiteSpace=wrap;html=1;fillColor=#EEF4FF;strokeColor=#9DB8F2;" + FONT, width: 140, height: 60 },
    decision: { style: "rhombus;whiteSpace=wrap;html=1;fillColor=#FFF6E0;strokeColor=#E8C36A;" + FONT, width: 160, height: 90 },
    start: { style: "rounded=1;arcSize=50;whiteSpace=wrap;html=1;fillColor=#E7F6EC;strokeColor=#8BCB9F;" + FONT, width: 140, height: 60 },
    end: { style: "rounded=1;arcSize=50;whiteSpace=wrap;html=1;fillColor=#E7F6EC;strokeColor=#8BCB9F;" + FONT, width: 140, height: 60 },
    error: { style: "rounded=1;whiteSpace=wrap;html=1;fillColor=#FDECEC;strokeColor=#EBA3A3;" + FONT, width: 140, height: 60 },
    data: { style: "shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=10;whiteSpace=wrap;html=1;fillColor=#F3EEFF;strokeColor=#B9A6F0;" + FONT, width: 120, height: 80 },
    external: { style: "rounded=1;whiteSpace=wrap;html=1;fillColor=#F2F4F7;strokeColor=#B8C0CC;" + FONT, width: 140, height: 60 },
    container: { style: "swimlane;startSize=30;whiteSpace=wrap;html=1;fillColor=#F7F8FA;strokeColor=#D5DAE1;" + FONT, width: 0, height: 0 }
  };

  var NESTED_CONTAINER_FILL = "#FFFFFF";

  // A list table: a swimlane whose children stack below its title. startSize
  // follows the row height unless the style sets it.
  var TABLE_STYLE = "swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;horizontalStack=0;" +
    "resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=0;marginBottom=0;whiteSpace=wrap;html=1;" +
    "fillColor=#EEF4FF;strokeColor=#9DB8F2;" + FONT;
  var ROW_STYLE = "text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=4;" +
    "spacingRight=4;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;html=1;";
  var SEPARATOR_STYLE = "line;strokeWidth=1;fillColor=none;align=left;verticalAlign=middle;spacingTop=-1;" +
    "spacingLeft=3;spacingRight=3;rotatable=0;labelPosition=right;points=[];portConstraint=eastwest;html=1;";
  var SEPARATOR_HEIGHT = 8;
  var DEFAULT_TABLE_WIDTH = 200;

  // Keys a row takes from its table, so that a font or a dark theme set on
  // the table reaches its rows.
  var ROW_INHERITED = ["fontSize", "fontColor", "fontFamily", "fontSource"];

  // Words in front of a row's name that aren't its name.
  var KEY_MARKER = /^(?:PK|FK|UK)(?![\w])[\s,:\/]*/i;
  // Letters of the Latin, Greek, Cyrillic and CJK scripts, not symbols or
  // emoji (a key icon in front of the name).
  var NAME = /[A-Za-z_$\u00C0-\u1FFF\u2C00-\uD7FF][\w$\u00C0-\u1FFF\u2C00-\uD7FF]*/;

  var ENTITIES = { lt: "<", gt: ">", quot: "\"", apos: "'", amp: "&" };

  function decode(s)
  {
    return String(s).replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, function(m, e)
    {
      if (e.charAt(0) !== "#")
      {
        return (ENTITIES[e] != null) ? ENTITIES[e] : m;
      }

      var code = (e.charAt(1) === "x") ? parseInt(e.substring(2), 16) : parseInt(e.substring(1), 10);

      return (code > 0 && code <= 0x10FFFF) ? String.fromCodePoint(code) : m;
    });
  }

  function escape(s)
  {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/\n/g, "&#xa;");
  }

  // The visible text of a label: entities decoded, HTML tags dropped.
  function plainText(raw)
  {
    return decode(decode(raw).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""));
  }

  function attr(rawAttrs, name)
  {
    var m = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*\"([^\"]*)\"").exec(rawAttrs);

    return (m != null) ? m[1] : null;
  }

  function setAttr(rawAttrs, name, value)
  {
    var re = new RegExp("(^|\\s)" + name + "\\s*=\\s*\"[^\"]*\"");

    if (re.test(rawAttrs))
    {
      return rawAttrs.replace(re, function(m, lead)
      {
        return lead + name + "=\"" + value + "\"";
      });
    }

    return rawAttrs + " " + name + "=\"" + value + "\"";
  }

  function removeAttr(rawAttrs, name)
  {
    return rawAttrs.replace(new RegExp("\\s*\\b" + name + "\\s*=\\s*\"[^\"]*\""), "");
  }

  // ─── Styles ─────────────────────────────────────────────────────

  function parseStyle(style)
  {
    var parsed = { names: [], keys: [], values: {} };
    var parts = String(style || "").split(";");

    for (var i = 0; i < parts.length; i++)
    {
      var part = parts[i].trim();

      if (part.length === 0)
      {
        continue;
      }

      var eq = part.indexOf("=");

      if (eq < 0)
      {
        parsed.names.push(part);
      }
      else
      {
        var key = part.substring(0, eq).trim();

        if (!Object.prototype.hasOwnProperty.call(parsed.values, key))
        {
          parsed.keys.push(key);
        }

        parsed.values[key] = part.substring(eq + 1).trim();
      }
    }

    return parsed;
  }

  function has(values, key)
  {
    return Object.prototype.hasOwnProperty.call(values, key);
  }

  // The base style with the own style's keys winning: the base's keys keep
  // their order with the own values in their place, the own keys the base
  // doesn't have follow in their order. An own shape (a style name or a
  // shape key) replaces the base's shape and its perimeter.
  function mergeStyles(base, own)
  {
    var b = parseStyle(base);
    var o = (typeof own === "string") ? parseStyle(own) : own;
    var ownShape = o.names.length > 0 || has(o.values, "shape");
    var out = ownShape ? o.names.slice() : b.names.slice();
    var i, key;

    for (i = 0; i < b.keys.length; i++)
    {
      key = b.keys[i];

      if (ownShape && (key === "shape" || key === "perimeter"))
      {
        continue;
      }

      out.push(key + "=" + (has(o.values, key) ? o.values[key] : b.values[key]));
    }

    for (i = 0; i < o.keys.length; i++)
    {
      key = o.keys[i];

      if (!has(b.values, key) || (ownShape && (key === "shape" || key === "perimeter")))
      {
        out.push(key + "=" + o.values[key]);
      }
    }

    return out.join(";") + ";";
  }

  function roleOf(parsed)
  {
    if (!has(parsed.values, "role"))
    {
      return null;
    }

    var name = String(parsed.values.role).toLowerCase();

    return has(ROLES, name) ? name : null;
  }

  function withoutRole(parsed)
  {
    return {
      names: parsed.names,
      keys: parsed.keys.filter(function(k) { return k !== "role"; }),
      values: parsed.values
    };
  }

  /**
   * The style a role expands to, merged with the rest of a style.
   *
   * @param {string} role - step, decision, start, end, error, data, external
   *   or container
   * @param {string=} style - the cell's own style (decoded); its keys win
   * @param {boolean=} nested - the cell is inside another container
   * @returns {?string} the style, or null for an unknown role
   */
  function roleStyle(role, style, nested)
  {
    var name = String(role || "").toLowerCase();

    if (!has(ROLES, name))
    {
      return null;
    }

    var base = ROLES[name].style;

    if (name === "container" && nested)
    {
      base = base.replace(/fillColor=[^;]*/, "fillColor=" + NESTED_CONTAINER_FILL);
    }

    return mergeStyles(base, withoutRole(parseStyle(style)));
  }

  // The table style under the table's own style; a role on the table only
  // brings its colors.
  function tableStyle(own, rowHeight)
  {
    var o = parseStyle(own);
    var role = roleOf(o);
    var base = TABLE_STYLE;

    if (role != null)
    {
      var colors = parseStyle(ROLES[role].style).values;

      base = mergeStyles(base, "fillColor=" + colors.fillColor + ";strokeColor=" + colors.strokeColor + ";");
    }

    if (!has(o.values, "startSize"))
    {
      base = base.replace("horizontal=1;", "horizontal=1;startSize=" + rowHeight + ";");
    }

    return mergeStyles(base, withoutRole(o));
  }

  // ─── Rows ───────────────────────────────────────────────────────

  // The rows of a rows attribute (raw, still XML-escaped): split at `|`, with
  // `\|` kept as a `|`.
  function splitRows(raw)
  {
    var rows = [];
    var current = "";

    for (var i = 0; i < raw.length; i++)
    {
      var ch = raw.charAt(i);

      if (ch === "\\" && raw.charAt(i + 1) === "|")
      {
        current += "|";
        i++;
      }
      else if (ch === "|")
      {
        rows.push(current);
        current = "";
      }
      else
      {
        current += ch;
      }
    }

    rows.push(current);

    return rows.map(function(r) { return r.trim(); }).filter(function(r) { return r.length > 0; });
  }

  function isSeparator(raw)
  {
    return /^-{2,}$/.test(raw) || /^[\u2014\u2013]+$/.test(raw);
  }

  // The name of a row: the first word after UML visibility and key markers.
  function rowName(raw)
  {
    var text = plainText(raw).trim().replace(/^[+\-#~]\s*/, "");
    var prev = null;

    while (prev !== text)
    {
      prev = text;
      text = text.replace(KEY_MARKER, "");
    }

    var m = NAME.exec(text);

    return (m != null) ? m[0] : null;
  }

  // The ids of a table's rows, in order (separators included).
  function rowIdsOf(tableId, rows, taken)
  {
    var ids = [];
    var used = {};

    for (var i = 0; i < rows.length; i++)
    {
      var base = isSeparator(rows[i]) ? "sep" : rowName(rows[i]);

      if (base == null)
      {
        base = String(i + 1);
      }

      var id = tableId + "." + base;
      var n = 2;

      while (used[id] || (taken != null && taken[id]))
      {
        id = tableId + "." + base + "." + n;
        n++;
      }

      used[id] = true;
      ids.push(id);
    }

    return ids;
  }

  /**
   * The ids the rows of a table get.
   *
   * @param {string} tableId - the table's id
   * @param {string} rows - the rows attribute
   * @returns {Array<string>}
   */
  function rowIds(tableId, rows)
  {
    return rowIdsOf(tableId, splitRows(String(rows || "")), null);
  }

  function rowHeightFor(fontSize)
  {
    return Math.max(26, Math.round(fontSize) + 10);
  }

  // Wide enough for the longest row and the title at about 0.6 em a
  // character, never narrower than the 200 px the grid plans for.
  function tableWidthFor(title, rows, fontSize)
  {
    var longest = plainText(title || "").length + 2;

    for (var i = 0; i < rows.length; i++)
    {
      if (!isSeparator(rows[i]))
      {
        longest = Math.max(longest, plainText(rows[i]).length);
      }
    }

    return Math.max(DEFAULT_TABLE_WIDTH, Math.ceil((longest * fontSize * 0.6 + 16) / 10) * 10);
  }

  // ─── Geometry ───────────────────────────────────────────────────

  var GEOMETRY = /<mxGeometry\b([^>]*?)(\/?)>/;

  function geometryOf(body)
  {
    var m = GEOMETRY.exec(body || "");

    if (m == null)
    {
      return null;
    }

    return {
      match: m,
      width: parseFloat(attr(m[1], "width")),
      height: parseFloat(attr(m[1], "height"))
    };
  }

  // An attribute of a geometry, set in place or added before `as`, where
  // draw.io writes the size.
  function setGeometryAttr(attrs, name, value)
  {
    if (attr(attrs, name) != null || !/\sas\s*=/.test(attrs))
    {
      return setAttr(attrs, name, value);
    }

    return attrs.replace(/\sas\s*=/, function(m)
    {
      return " " + name + "=\"" + value + "\"" + m;
    });
  }

  // The body with width and height set on its geometry (only those given).
  function withSize(body, width, height)
  {
    return body.replace(GEOMETRY, function(m, attrs, close)
    {
      if (width != null)
      {
        attrs = setGeometryAttr(attrs, "width", String(width));
      }

      if (height != null)
      {
        attrs = setGeometryAttr(attrs, "height", String(height));
      }

      return "<mxGeometry" + attrs + close + ">";
    });
  }

  // ─── The pass ───────────────────────────────────────────────────

  var CELL = /<mxCell\b([^>]*?)(\/>|>([\s\S]*?)<\/mxCell>)/g;

  function parseCells(text)
  {
    var cells = [];
    var m;

    CELL.lastIndex = 0;

    while ((m = CELL.exec(text)) !== null)
    {
      cells.push({
        start: m.index,
        end: m.index + m[0].length,
        attrs: m[1],
        selfClosing: m[2] === "/>",
        body: m[3] || "",
        id: attr(m[1], "id"),
        parent: attr(m[1], "parent"),
        vertex: attr(m[1], "vertex") === "1",
        edge: attr(m[1], "edge") === "1"
      });
    }

    return cells;
  }

  function cellXml(cell, attrs, body)
  {
    return "<mxCell" + attrs + (body == null ? "/>" : ">" + body + "</mxCell>");
  }

  function expandPage(text)
  {
    var cells = parseCells(text);
    var ids = {};
    var byId = {};
    var tables = [];
    var i;

    for (i = 0; i < cells.length; i++)
    {
      if (cells[i].id != null)
      {
        ids[cells[i].id] = true;
        byId[cells[i].id] = cells[i];
      }
    }

    // Ids on <object>/<UserObject> wrappers are taken too.
    var wrapperId = /<(?:object|UserObject)\b[^>]*?\sid="([^"]*)"/g;
    var w;

    while ((w = wrapperId.exec(text)) !== null)
    {
      ids[w[1]] = true;
    }

    var changed = 0;
    var replacements = [];

    for (i = 0; i < cells.length; i++)
    {
      var cell = cells[i];

      if (!cell.vertex)
      {
        continue;
      }

      var rawRows = attr(cell.attrs, "rows");
      var rawStyle = attr(cell.attrs, "style");
      var style = (rawStyle != null) ? decode(rawStyle) : "";

      if (rawRows != null && cell.id != null)
      {
        replacements.push({ cell: cell, xml: expandTable(cell, rawRows, style, ids, tables) });
        changed++;
        continue;
      }

      var parsed = parseStyle(style);
      var role = roleOf(parsed);

      if (role == null)
      {
        continue;
      }

      var parent = (cell.parent != null) ? byId[cell.parent] : null;
      var nested = parent != null && parent.vertex;
      var attrs = setAttr(cell.attrs, "style", escape(roleStyle(role, style, nested)));
      var body = cell.selfClosing ? null : cell.body;
      var geo = geometryOf(body);

      if (geo != null && ROLES[role].width > 0 && (!(geo.width > 0) || !(geo.height > 0)))
      {
        body = withSize(body, (geo.width > 0) ? null : ROLES[role].width,
          (geo.height > 0) ? null : ROLES[role].height);
      }

      replacements.push({ cell: cell, xml: cellXml(cell, attrs, body) });
      changed++;
    }

    // Edges that name a row by its position or in another case.
    if (tables.length > 0)
    {
      for (i = 0; i < cells.length; i++)
      {
        if (!cells[i].edge)
        {
          continue;
        }

        var edgeAttrs = resolveTerminals(cells[i].attrs, tables, ids);

        if (edgeAttrs !== cells[i].attrs)
        {
          replacements.push({ cell: cells[i], xml: cellXml(cells[i], edgeAttrs,
            cells[i].selfClosing ? null : cells[i].body) });
          changed++;
        }
      }
    }

    if (replacements.length === 0)
    {
      return null;
    }

    // Back to front, so that the offsets stay valid.
    replacements.sort(function(a, b) { return b.cell.start - a.cell.start; });

    var out = text;

    for (i = 0; i < replacements.length; i++)
    {
      var r = replacements[i];

      out = out.substring(0, r.cell.start) + r.xml + out.substring(r.cell.end);
    }

    return { text: out, changed: changed };
  }

  // The table cell without its rows attribute, in its full style and size,
  // followed by its row cells.
  function expandTable(cell, rawRows, style, ids, tables)
  {
    var rows = splitRows(rawRows);
    var styleValues = parseStyle(style).values;
    var fontSize = parseFloat(styleValues.fontSize);

    fontSize = (fontSize > 0) ? fontSize : 14;

    var rowHeight = rowHeightFor(fontSize);
    var full = tableStyle(style, rowHeight);
    var values = parseStyle(full).values;
    var startSize = parseFloat(values.startSize);

    startSize = (startSize >= 0) ? startSize : rowHeight;

    var body = cell.selfClosing ? "" : cell.body;
    var geo = geometryOf(body);
    var width = (geo != null && geo.width > 0) ? geo.width :
      tableWidthFor(attr(cell.attrs, "value"), rows, fontSize);
    var height = startSize;
    var rowIdList = rowIdsOf(cell.id, rows, ids);
    var rowStyle = ROW_STYLE;
    var separatorStyle = SEPARATOR_STYLE;
    var k;

    for (k = 0; k < ROW_INHERITED.length; k++)
    {
      if (has(values, ROW_INHERITED[k]))
      {
        rowStyle += ROW_INHERITED[k] + "=" + values[ROW_INHERITED[k]] + ";";
      }
    }

    if (has(values, "strokeColor"))
    {
      separatorStyle += "strokeColor=" + values.strokeColor + ";";
    }

    var rowCells = "";
    var parentId = cell.id;
    var entries = [];

    for (k = 0; k < rows.length; k++)
    {
      var separator = isSeparator(rows[k]);
      var h = separator ? SEPARATOR_HEIGHT : rowHeight;
      var id = rowIdList[k];

      ids[id] = true;
      entries.push({ id: id, name: separator ? null : rowName(rows[k]) });
      rowCells += "<mxCell id=\"" + id + "\" value=\"" + (separator ? "" : rows[k]) + "\" style=\"" +
        escape(separator ? separatorStyle : rowStyle) + "\" vertex=\"1\" parent=\"" + parentId + "\">" +
        "<mxGeometry y=\"" + height + "\" width=\"" + width + "\" height=\"" + h + "\" as=\"geometry\"/></mxCell>";
      height += h;
    }

    tables.push({ id: cell.id, rows: entries });

    var attrs = setAttr(removeAttr(cell.attrs, "rows"), "style", escape(full));

    if (geo == null)
    {
      body += "<mxGeometry width=\"" + width + "\" height=\"" + height + "\" as=\"geometry\"/>";
    }
    else
    {
      body = withSize(body, width, height);
    }

    return cellXml(cell, attrs, body) + rowCells;
  }

  // A source or target that isn't a cell but names a row of a table by its
  // position (book.3) or its name in another case (book.Author_ID).
  function resolveTerminals(rawAttrs, tables, ids)
  {
    var names = ["source", "target"];

    for (var n = 0; n < names.length; n++)
    {
      var ref = attr(rawAttrs, names[n]);

      if (ref == null || ids[ref])
      {
        continue;
      }

      var found = resolveRow(ref, tables);

      if (found != null)
      {
        rawAttrs = setAttr(rawAttrs, names[n], found);
      }
    }

    return rawAttrs;
  }

  function resolveRow(ref, tables)
  {
    for (var t = 0; t < tables.length; t++)
    {
      var table = tables[t];
      var prefix = table.id + ".";

      if (ref.length <= prefix.length || ref.substring(0, prefix.length).toLowerCase() !== prefix.toLowerCase())
      {
        continue;
      }

      var rest = ref.substring(prefix.length);

      if (/^\d+$/.test(rest))
      {
        var index = parseInt(rest, 10) - 1;

        if (index >= 0 && index < table.rows.length)
        {
          return table.rows[index].id;
        }

        continue;
      }

      for (var r = 0; r < table.rows.length; r++)
      {
        var name = table.rows[r].name;

        if (name != null && name.toLowerCase() === rest.toLowerCase())
        {
          return table.rows[r].id;
        }
      }
    }

    return null;
  }

  /**
   * Expands the rows and role shorthands on every page of a diagram.
   *
   * @param {string} xml - mxGraphModel or mxfile XML
   * @returns {{xml: string, changed: number}} the XML and the number of cells
   *   that were expanded or pointed at a row
   */
  function expand(xml)
  {
    if (typeof xml !== "string" || (xml.indexOf("rows=") < 0 && xml.indexOf("role=") < 0))
    {
      return { xml: xml, changed: 0 };
    }

    // Each <mxGraphModel> is one page with ids of its own; a fragment without
    // one is a page.
    var pages = [];
    var re = /<mxGraphModel\b[^>]*>([\s\S]*?)<\/mxGraphModel>/g;
    var m;

    while ((m = re.exec(xml)) !== null)
    {
      pages.push({ start: m.index + m[0].length - m[1].length - "</mxGraphModel>".length, text: m[1] });
    }

    if (pages.length === 0)
    {
      pages.push({ start: 0, text: xml });
    }

    var out = xml;
    var changed = 0;

    for (var p = pages.length - 1; p >= 0; p--)
    {
      var result = null;

      try
      {
        result = expandPage(pages[p].text);
      }
      catch (e)
      {
        // Never break the diagram: the page stays as written.
        result = null;
      }

      if (result != null)
      {
        changed += result.changed;
        out = out.substring(0, pages[p].start) + result.text + out.substring(pages[p].start + pages[p].text.length);
      }
    }

    return { xml: out, changed: changed };
  }

  return { expand: expand, roleStyle: roleStyle, rowIds: rowIds, roles: ROLES };
}

var shorthand = createDiagramShorthand();

/**
 * Expands table rows (rows="PK id|FK book_id|…") and role styles
 * (role=step|decision|start|end|error|data|external|container) into plain
 * draw.io XML. Idempotent; XML without either comes back byte-identical.
 *
 * @param {string} xml - mxGraphModel or mxfile XML
 * @returns {{xml: string, changed: number}}
 */
export var expandDiagramShorthand = shorthand.expand;

/**
 * The style of a role in the calm theme, merged with a cell's own style
 * (whose keys win). Null for an unknown role.
 */
export var roleStyle = shorthand.roleStyle;

/**
 * The ids the rows of a table get: `<table id>.<row name>`.
 */
export var rowIds = shorthand.rowIds;

/**
 * The roles with their styles and default sizes.
 */
export var ROLES = shorthand.roles;
