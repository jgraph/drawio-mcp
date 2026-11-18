// draw.io CSV → draw.io cells on the server, as draw.io's Arrange > Insert >
// Advanced > CSV reads it (EditorUi.doImportCsv): the `#` lines configure
// the import (label, style, identity, parent, connect, width, height,
// layout, …), the first line after them names the columns, and every row
// becomes a shape that keeps its columns as data, with its label and style
// filled in from them (`%column%`). The layout is shared/semantic's: trees
// and org charts in layers, flows as flowcharts, `none` at the rows'
// `left` and `top`. What the import can't do here (`list`, `container`, the
// circle and custom layouts) goes to draw.io's own import in the viewer.

import { syntaxError, plainLabel, listText, shorten } from "./common.js";
import { blockWidth } from "../semantic/text-width.js";

const ERR = "CSV";

const KEYS = ["label", "labelname", "labels", "style", "stylename", "styles", "vars", "identity", "parent", "parentstyle",
  "namespace", "width", "height", "collapsed", "left", "top", "ignore", "connect", "link", "padding", "edgespacing",
  "nodespacing", "levelspacing", "layout", "container", "list", "unknownStyle"];

// The layouts the server draws, and how
const TREE_LAYOUTS = ["verticaltree", "horizontaltree", "orgchart", "organic", "elkorganic", "elkstress", "elkradial"];
const FLOW_LAYOUTS = ["verticalflow", "horizontalflow"];

// The default style draw.io gives a row without `# style`
const DEFAULT_STYLE = "whiteSpace=wrap;html=1;";

/**
 * A line of CSV as its fields: `,` between them, `"` around a field that
 * holds a comma or a quote (`""` for a quote). Null for a quote that isn't
 * closed.
 *
 * @param {string} line
 * @returns {string[]|null}
 */
export function csvFields(line)
{
  const out = [];
  let field = "";
  let quoted = false;
  let i = 0;

  while (i < line.length)
  {
    const c = line[i];

    if (quoted)
    {
      if (c === "\"" && line[i + 1] === "\"")
      {
        field += "\"";
        i += 2;
        continue;
      }

      if (c === "\"")
      {
        quoted = false;
        i++;
        continue;
      }

      field += c;
      i++;
      continue;
    }

    if (c === "\"" && field.trim() === "")
    {
      quoted = true;
      field = "";
      i++;
      continue;
    }

    if (c === ",")
    {
      out.push(field);
      field = "";
      i++;
      continue;
    }

    field += c;
    i++;
  }

  if (quoted)
  {
    return null;
  }

  out.push(field);

  return out;
}

/**
 * A column's name as draw.io keeps it in the data: what isn't a letter or a
 * digit becomes `_`, leading digits and trailing `_` go.
 */
function attributeName(key)
{
  return key.trim().replace(/[^a-z0-9]+/ig, "_").replace(/^\d+/, "").replace(/_+$/, "");
}

/**
 * The `#` lines and the rows of a CSV import.
 *
 * @param {string} text
 * @param {boolean} partial - still streaming in
 */
function readCsv(text, partial)
{
  const lines = String(text || "").split("\n").map(function(l) { return l.replace(/\r$/, ""); });
  const config = {};
  const connects = [];
  const lists = [];
  const warnings = [];
  const keyLines = {};
  let k = 0;

  // blank lines before the `#` lines, which draw.io reads in the first column only
  while (k < lines.length && lines[k].trim() === "")
  {
    k++;
  }

  while (k < lines.length && lines[k].charAt(0) === "#")
  {
    const line = k + 1;
    let t = lines[k];

    k++;

    // a value continued on the next `#` line with `\`
    while (k < lines.length && t.charAt(t.length - 1) === "\\" && lines[k].charAt(0) === "#")
    {
      t = t.substring(0, t.length - 1) + lines[k].substring(1).trim();
      k++;
    }

    if (t.charAt(1) === "#")
    {
      continue;
    }

    const idx = t.indexOf(":");

    if (idx <= 0)
    {
      continue;
    }

    const key = t.substring(1, idx).trim();
    const value = t.substring(idx + 1).trim();

    if (KEYS.indexOf(key) < 0)
    {
      if (key !== "")
      {
        warnings.push("Line " + line + ": `# " + key + ":` is not a setting of draw.io's CSV import and is left out " +
          "(the settings are " + listText(KEYS, 30) + ").");
      }

      continue;
    }

    // `-` or nothing: the setting's default
    if (key !== "connect" && key !== "label" && (value === "-" || value === ""))
    {
      continue;
    }

    if (key === "connect" || key === "labels" || key === "styles" || key === "vars")
    {
      let parsed;

      try
      {
        parsed = JSON.parse(value);
      }
      catch (e)
      {
        if (partial && k >= lines.length)
        {
          break;
        }

        return { error: syntaxError(ERR, line, t, "the value of `# " + key + ":` is not valid JSON (" + e.message + ").",
          key === "connect" ? "write it as `# connect: {\"from\": \"manager\", \"to\": \"name\", \"invert\": true}`, " +
          "with double quotes around every name and value." : "write it as a JSON object with double quotes, " +
          "e.g. `# " + key + ": {\"a\": \"…\"}`.") };
      }

      if (key === "connect")
      {
        if (parsed == null || typeof parsed !== "object" || typeof parsed.from !== "string" || typeof parsed.to !== "string")
        {
          return { error: syntaxError(ERR, line, t, "a connect needs the columns `from` and `to`.",
            "write it as `# connect: {\"from\": \"manager\", \"to\": \"name\"}`: every row's `from` value names the " +
            "`to` value of the row it connects to.") };
        }

        connects.push({ def: parsed, line: line, text: t });
      }
      else
      {
        config[key] = parsed;
      }
    }
    else if (key === "list")
    {
      lists.push(value);
    }
    else
    {
      config[key] = value;
    }

    keyLines[key] = { line: line, text: t };
  }

  while (k < lines.length && lines[k].trim() === "")
  {
    k++;
  }

  if (k >= lines.length)
  {
    if (partial)
    {
      return { config: config, connects: connects, lists: lists, keyLines: keyLines, header: null, rows: [], warnings: warnings };
    }

    return { error: "The CSV has no header line: after the `#` lines, the first line names the columns " +
      "(e.g. `name,position,manager`) and every line after it is a row." };
  }

  const headerLine = k + 1;
  const header = csvFields(lines[k]);

  if (header == null)
  {
    return { error: syntaxError(ERR, headerLine, lines[k], "a quote in the header line is not closed.",
      "close every quoted column name with `\"`.") };
  }

  const rows = [];

  for (let i = k + 1; i < lines.length; i++)
  {
    if (lines[i].trim() === "")
    {
      continue;
    }

    if (lines[i].charAt(0) === "#")
    {
      warnings.push("Line " + (i + 1) + ": a `#` line after the header is read as a row by draw.io and is left out here; " +
        "put the settings before the header.");
      continue;
    }

    const values = csvFields(lines[i]);

    if (values == null)
    {
      if (partial && i === lines.length - 1)
      {
        break;
      }

      return { error: syntaxError(ERR, i + 1, lines[i], "a quote in this row is not closed.",
        "close every quoted value with `\"`, and write a quote inside one as `\"\"`.") };
    }

    if (values.length > header.length && values.slice(header.length).some(function(v) { return v.trim() !== ""; }))
    {
      warnings.push("Line " + (i + 1) + " has " + values.length + " values for " + header.length + " columns; the last " +
        (values.length - header.length) + " are left out (quote a value that holds a comma).");
    }

    rows.push({ values: values, line: i + 1 });
  }

  return { config: config, connects: connects, lists: lists, keyLines: keyLines, header: header, headerLine: headerLine,
    rows: rows, warnings: warnings };
}

function layoutOf(config)
{
  return String(config.layout || "auto").trim();
}

/**
 * Whether the server converts this CSV (rather than draw.io's own import in
 * the viewer): every layout but `circle` and custom ones, without `list`
 * and `container`. Decided by the `#` lines, which come first.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function csvConverts(text)
{
  const r = readCsv(text, true);

  return r.error == null && unsupported(r) == null;
}

function unsupported(r)
{
  const layout = layoutOf(r.config).toLowerCase();

  if (r.lists.length > 0)
  {
    return "lists";
  }

  if (r.config.container != null && !/^(-|false|)$/.test(String(r.config.container).trim()))
  {
    return "containers";
  }

  if (layout !== "auto" && layout !== "none" && TREE_LAYOUTS.indexOf(layout) < 0 && FLOW_LAYOUTS.indexOf(layout) < 0)
  {
    return "the layout " + layout;
  }

  return null;
}

/**
 * Replaces `%name%` placeholders with the row's values (`%id%` the id).
 */
function fill(template, data, missing)
{
  return String(template).replace(/%([a-zA-Z0-9_]+)%/g, function(m, name)
  {
    if (Object.prototype.hasOwnProperty.call(data, name))
    {
      return data[name];
    }

    if (missing != null)
    {
      missing.add(name);
    }

    return "";
  });
}

/**
 * A style after its placeholders are filled in: keys left without a value
 * (`fillColor=` for an empty column) are dropped, so the calm theme's colors
 * show there.
 */
function cleanStyle(style)
{
  return style.split(";").filter(function(p)
  {
    const t = p.trim();

    return t !== "" && !/^[^=]+=\s*$/.test(t) && !/^(edgeStyle|curved)=/.test(t);
  }).join(";") + ";";
}

/**
 * Converts a draw.io CSV import into a flowchart or layered description for
 * shared/semantic, with a `finish` that turns the drawn rows into cells that
 * keep their columns as data (as draw.io's import does); `layout: none`
 * places the rows at their `left` and `top` directly.
 *
 * @param {string} text
 * @param {{partial?: boolean}} [options]
 */
export function convertCsv(text, options)
{
  const partial = options != null && options.partial === true;
  const r = readCsv(text, partial);

  if (r.error != null)
  {
    return r;
  }

  const why = unsupported(r);

  if (why != null)
  {
    return { fallback: true, type: "csv", reason: why };
  }

  if (r.header == null)
  {
    return { error: "The CSV has no header line yet." };
  }

  const warnings = r.warnings.slice();
  const config = r.config;
  const keys = r.header;
  const attribs = keys.map(attributeName);
  const columns = new Set(attribs);
  const missing = new Set();

  function column(key, name)
  {
    // identity and parent name the column as written in the header
    const i = keys.indexOf(name);

    if (i < 0)
    {
      const at = r.keyLines[key];

      return { error: syntaxError(ERR, at != null ? at.line : r.headerLine, at != null ? at.text : "", "`# " + key + ": " + name +
        "` names a column the header doesn't have.", "use one of " + listText(keys.map(function(c) { return c.trim(); }), 20) +
        ", or `-` for none.") };
    }

    return i;
  }

  const identity = (config.identity != null && config.identity !== "" && config.identity !== "-") ? config.identity : null;
  const parent = (config.parent != null && config.parent !== "" && config.parent !== "-") ? config.parent : null;
  const identityIndex = identity != null ? column("identity", identity) : null;
  const parentIndex = parent != null ? column("parent", parent) : null;

  if (identityIndex != null && identityIndex.error != null)
  {
    return identityIndex;
  }

  if (parentIndex != null && parentIndex.error != null)
  {
    return parentIndex;
  }

  for (const c of r.connects)
  {
    for (const end of ["from", "to"])
    {
      if (!columns.has(c.def[end]))
      {
        return { error: syntaxError(ERR, c.line, c.text, "the connect's `" + end + "` names the column \"" + c.def[end] +
          "\", which the header doesn't have.", "use one of " + listText(attribs, 20) + ".") };
      }
    }
  }

  ["stylename", "labelname", "link", "left", "top"].forEach(function(key)
  {
    const v = config[key];

    if (v != null && v !== "" && v !== "-" && !columns.has(v))
    {
      warnings.push("`# " + key + ": " + v + "` names no column (the columns are " + listText(attribs, 20) + "), so it does nothing.");
    }
  });

  const namespace = (config.namespace != null && config.namespace !== "-") ? config.namespace : "";
  const ignore = String(config.ignore || "").split(",").map(function(s) { return s.trim(); }).filter(function(s) { return s !== ""; });
  const labelTemplate = (config.label != null && config.label !== "") ? config.label : "%" + attribs[0] + "%";
  const styled = config.style != null && config.style !== "" && config.style !== "-";
  const layout = layoutOf(config).toLowerCase();
  const link = (config.link != null && config.link !== "" && config.link !== "-" && config.link !== "link") ? config.link : null;

  function sizeOf(spec, data)
  {
    const s = String(spec || "auto").trim();
    const v = s.charAt(0) === "@" ? data[s.substring(1)] : s;
    const n = parseFloat(v);

    return (v != null && v !== "auto" && isFinite(n) && n > 0) ? Math.min(n, 2000) : 0;
  }

  // ── The rows ──
  const rows = [];
  const byId = new Map();
  const ids = new Set();

  r.rows.forEach(function(row, i)
  {
    const data = {};

    attribs.forEach(function(a, j)
    {
      if (a !== "")
      {
        data[a] = row.values[j] != null ? row.values[j] : "";
      }
    });

    let id = identityIndex != null ? namespace + row.values[identityIndex] : namespace + "row" + (i + 1);

    if (identityIndex != null && String(row.values[identityIndex] || "").trim() === "")
    {
      id = namespace + "row" + (i + 1);
    }

    id = cellId(id);

    if (ids.has(id))
    {
      warnings.push("Line " + row.line + ": the id \"" + id + "\" is taken by an earlier row; this row is left out " +
        "(draw.io updates the earlier row with it).");
      return;
    }

    ids.add(id);

    if (!Object.prototype.hasOwnProperty.call(data, "id"))
    {
      data.id = id;
    }

    // the style: `# style`, or the row's entry in `# styles`, placeholders filled in
    let style = styled ? config.style : "";

    if (config.stylename != null && config.styles != null && typeof config.styles === "object")
    {
      const key = data[config.stylename];

      if (key != null && Object.prototype.hasOwnProperty.call(config.styles, key))
      {
        style = String(config.styles[key]);
      }
    }

    let template = labelTemplate;

    if (config.labelname != null && config.labels != null && typeof config.labels === "object")
    {
      const key = data[config.labelname];

      if (key != null && Object.prototype.hasOwnProperty.call(config.labels, key))
      {
        template = String(config.labels[key]);
      }
    }

    const filledStyle = style !== "" && style.indexOf("stylePlaceholders=1") < 0 ? fill(style, data, missing) : style;
    const shown = {};

    // the data the cell keeps: every column but the ignored ones
    Object.keys(data).forEach(function(a)
    {
      if (ignore.indexOf(a) < 0)
      {
        shown[a] = data[a];
      }
    });

    const item = {
      id: id, line: row.line, data: data, kept: shown, template: template,
      text: plainLabel(fill(template, shown, missing)) || " ", style: filledStyle,
      width: sizeOf(config.width, data), height: String(config.height || "").trim() === "width" ? -1 : sizeOf(config.height, data),
      parentKey: parentIndex != null ? String(row.values[parentIndex] || "").trim() : "",
      left: config.left != null ? parseFloat(data[config.left]) : NaN, top: config.top != null ? parseFloat(data[config.top]) : NaN
    };

    if (item.height === -1)
    {
      item.height = item.width;
    }

    rows.push(item);
    byId.set(identityIndex != null ? String(row.values[identityIndex]) : String(i + 1), item);
  });

  // draw.io's `label` shape puts its image left of the text (spacingLeft=52,
  // bold): rows of it without a size of their own get the room for both,
  // the widest one's for all, as the layout sizes boxes of one kind
  const pictured = rows.filter(function(item)
  {
    return item.width === 0 && item.height === 0 && /^(label|.*;shape=label)(;|$)/.test(item.style) && /(^|;)image=[^;]/.test(item.style);
  });

  if (pictured.length > 0)
  {
    const w = Math.min(400, Math.ceil(pictured.reduce(function(m, item) { return Math.max(m, blockWidth(item.text, 14, true)); }, 0) + 74));
    const h = Math.max(60, pictured.reduce(function(m, item) { return Math.max(m, item.text.split("\n").length); }, 0) * 18 + 20);

    pictured.forEach(function(item)
    {
      item.width = w;
      item.height = h;
    });
  }

  if (missing.size > 0)
  {
    const unknown = Array.from(missing).filter(function(n) { return !columns.has(n); });

    if (unknown.length > 0)
    {
      warnings.push("The placeholder" + (unknown.length > 1 ? "s " : " ") + listText(unknown.map(function(n) { return "%" + n + "%"; })) +
        " name" + (unknown.length > 1 ? "" : "s") + " no column, so " + (unknown.length > 1 ? "they stay" : "it stays") +
        " empty (placeholders in labels can't use ignored columns either).");
    }
  }

  // ── Parents: a row named in another row's parent column is its frame ──
  const groupIds = new Set();

  rows.forEach(function(item)
  {
    if (item.parentKey !== "")
    {
      const p = byId.get(item.parentKey);

      if (p == null || p === item)
      {
        warnings.push("Line " + item.line + ": the parent \"" + shorten(item.parentKey, 40) + "\" is no row's " +
          (identity != null ? identity : "row number") + "; the row is drawn at the top level.");
      }
      else
      {
        item.parent = p.id;
        groupIds.add(p.id);
      }
    }
  });

  // ── Connections ──
  const lookups = r.connects.map(function(c)
  {
    const map = new Map();

    rows.forEach(function(item)
    {
      const v = item.data[c.def.to];

      if (v != null && v !== "" && !map.has(v))
      {
        map.set(v, item);
      }
    });

    return map;
  });
  const edges = [];
  const unknownRefs = [];
  const extra = [];

  r.connects.forEach(function(c, ci)
  {
    const def = c.def;

    if (def.label != null && /%[a-zA-Z0-9_]+%/.test(String(def.label)))
    {
      warnings.push("Line " + c.line + ": a connect's `label` is written as it is, `" + shorten(String(def.label), 30) +
        "` included; for the values of a row use `sourcelabel` (the row with the `from` column) or `targetlabel`.");
    }

    if (Array.isArray(def.labels) && def.labels.length > 0)
    {
      warnings.push("Line " + c.line + ": the extra `labels` of a connect are not drawn; use `label`, `sourcelabel` or `targetlabel`.");
    }

    rows.forEach(function(item)
    {
      const v = item.data[def.from];

      if (v == null || v === "")
      {
        return;
      }

      v.split(",").forEach(function(ref)
      {
        let target = lookups[ci].get(ref);

        if (target == null && lookups[ci].has(ref.trim()))
        {
          target = lookups[ci].get(ref.trim());
        }

        if (target == null && config.unknownStyle != null && config.unknownStyle !== "-")
        {
          const id = cellId(namespace + ref.trim());

          target = rows.concat(extra).find(function(x) { return x.id === id; });

          if (target == null)
          {
            target = { id: id, text: ref.trim(), data: { id: id }, kept: {}, template: null,
              style: fill(config.unknownStyle, item.data), width: 0, height: 0, extra: true };
            extra.push(target);
          }
        }

        if (target == null)
        {
          unknownRefs.push(def.from + " \"" + shorten(ref, 30) + "\" (line " + item.line + ")");
          return;
        }

        const fromRow = def.invert ? target : item;
        const toRow = def.invert ? item : target;
        let edgeLabel = def.label != null ? String(def.label) : "";

        if (def.fromlabel != null)
        {
          edgeLabel = (item.data[def.fromlabel] || "") + edgeLabel;
        }

        if (def.sourcelabel != null)
        {
          edgeLabel = fill(def.sourcelabel, item.data) + edgeLabel;
        }

        if (def.tolabel != null)
        {
          edgeLabel = edgeLabel + (target.data[def.tolabel] || "");
        }

        if (def.targetlabel != null)
        {
          edgeLabel = edgeLabel + fill(def.targetlabel, target.data);
        }

        const styleData = ((def.placeholders === "target") === !def.invert) ? target.data : item.data;

        edges.push({ from: fromRow.id, to: toRow.id, label: plainLabel(edgeLabel),
          style: def.style != null ? cleanStyle(fill(String(def.style), styleData)) : "" });
      });
    });
  });

  if (unknownRefs.length > 0)
  {
    warnings.push("No row has the value " + listText(unknownRefs, 5) + " in the connect's `to` column, so " +
      (unknownRefs.length > 1 ? "those connections are" : "that connection is") + " left out (or set `# unknownStyle:` " +
      "to draw a shape for such values).");
  }

  const all = rows.concat(extra);

  if (all.length === 0)
  {
    return partial ? { error: "No rows yet." } : { error: "The CSV has a header but no rows. Add one line per shape after " +
      "the header line, with a value for each column." };
  }

  // ── The cells as draw.io's import keeps them: a UserObject with the
  // columns as data and the label template, placeholders="1" ──
  function finish(d)
  {
    const byCell = new Map();

    all.forEach(function(item)
    {
      if (!item.extra && item.template != null)
      {
        byCell.set(item.id, item);
      }
    });

    // an mxCell holds no other mxCell, so a cell ends at the first </mxCell>
    const xml = d.xml.replace(/<mxCell\b((?:[^>"]|"[^"]*")*?)(\/>|>([\s\S]*?)<\/mxCell>)/g, function(tag, attrs, end, body)
    {
      const m = /\sid="([^"]*)"/.exec(attrs);
      const item = (m != null) ? byCell.get(unescapeXml(m[1])) : null;

      if (item == null)
      {
        return tag;
      }

      let data = ' label="' + escapeXml(sanitizeHtml(item.template)) + '"';

      Object.keys(item.kept).forEach(function(a)
      {
        if (a !== "id" && a !== "label" && a !== "placeholders" && a !== "link" && a !== link && /^[A-Za-z_][\w.-]*$/.test(a))
        {
          data += " " + a + '="' + escapeXml(item.kept[a]) + '"';
        }
      });

      if (link != null && item.data[link] != null && item.data[link] !== "" && !/^\s*javascript:/i.test(item.data[link]))
      {
        data += ' link="' + escapeXml(item.data[link]) + '"';
      }

      const cell = "<mxCell" + attrs.replace(/\s(id|value)="[^"]*"/g, "") + (end === "/>" ? "/>" : ">" + body + "</mxCell>");

      return '<UserObject id="' + m[1] + '"' + data + ' placeholders="1">' + cell + "</UserObject>";
    });

    return Object.assign({}, d, { xml: xml });
  }

  const stats = { nodes: all.length, edges: edges.length, groups: groupIds.size };

  // ── No layout: the rows where their left and top say, else in a column ──
  if (layout === "none")
  {
    return placed(all, edges, styled, warnings, stats, finish, config);
  }

  const horizontal = /^horizontal/.test(layout);
  const tree = TREE_LAYOUTS.indexOf(layout) >= 0 || (layout === "auto" && isTree(all, edges));
  const nodes = all.filter(function(x) { return !groupIds.has(x.id); }).map(function(x)
  {
    return { id: x.id, label: x.text, kind: "", group: x.parent || "", style: x.style !== "" ? cleanStyle(x.style) : "",
      width: x.width, height: x.height };
  });
  const groups = all.filter(function(x) { return groupIds.has(x.id); }).map(function(x)
  {
    const ps = config.parentstyle != null ? cleanStyle(fill(String(config.parentstyle), x.data)) : "";

    return { id: x.id, label: x.text, kind: "subgraph", parent: x.parent || "",
      style: /(^|;)swimlane(;|$)/.test(ps) ? "" : ps };
  });

  if (layout === "auto" && edges.length === 0)
  {
    return placed(all, edges, styled, warnings, stats, finish, config);
  }

  if (/^(organic|elkorganic|elkstress|elkradial)$/.test(layout))
  {
    warnings.push("The layout " + layout + " is drawn in layers, as a tree.");
  }

  const spec =
  {
    type: (tree || layout === "auto") ? "architecture" : "flowchart",
    title: "",
    direction: horizontal ? "horizontal" : "vertical",
    groups: groups,
    nodes: nodes,
    edges: edges
  };

  return { semantic: spec, type: "csv", warnings: warnings, stats: stats, finish: finish };
}

/**
 * An id the layout keeps as it is: no spaces, not the reserved "0" and "1"
 * (draw.io's import would update the page's root or layer with such a row).
 */
function cellId(id)
{
  const s = String(id).trim().replace(/\s+/g, "_");

  return (s === "0" || s === "1") ? "n" + s : s;
}

/**
 * A tree: one row without an incoming connection, every other row with one.
 */
function isTree(rows, edges)
{
  const incoming = new Map();

  edges.forEach(function(e)
  {
    incoming.set(e.to, (incoming.get(e.to) || 0) + 1);
  });

  const roots = rows.filter(function(r) { return !incoming.has(r.id); });

  return roots.length === 1 && edges.length === rows.length - 1;
}

/**
 * The rows at their `left` and `top` (draw.io's `layout: none`), or in one
 * column 40 px apart, as draw.io stacks them; edges straight.
 */
function placed(rows, edges, styled, warnings, stats, finish, config)
{
  const ROW_W = 160;
  const ROW_H = 60;
  const spacing = isFinite(parseFloat(config.nodespacing)) ? parseFloat(config.nodespacing) : 40;
  const cells = ['<mxGraphModel adaptiveColors="auto">', "<root>", '<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  let y = 20;
  let maxX = 0;
  let maxY = 0;

  rows.forEach(function(item)
  {
    const w = item.width > 0 ? item.width : Math.max(ROW_W, Math.min(300, longest(item.text) * 7.5 + 24));
    const h = item.height > 0 ? item.height : Math.max(ROW_H, item.text.split("\n").length * 18 + 24);
    const x = isFinite(item.left) ? item.left : 20;
    const top = isFinite(item.top) ? item.top : y;
    const style = mergeStyle(CALM_STYLE, item.style !== "" ? cleanStyle(item.style) : "");

    if (!isFinite(item.top))
    {
      y += h + spacing;
    }

    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, top + h);
    cells.push('<mxCell id="' + escapeXml(item.id) + '" value="' + escapeXml(item.text.split("\n").map(escapeHtml).join("<br>")) +
      '" style="' + escapeXml(/html=1/.test(style) ? style : style + "html=1;") + '" vertex="1" parent="1"><mxGeometry x="' +
      Math.round(x) + '" y="' + Math.round(top) + '" width="' + Math.round(w) + '" height="' + Math.round(h) +
      '" as="geometry"/></mxCell>');
  });

  edges.forEach(function(e, i)
  {
    cells.push('<mxCell id="edge' + (i + 1) + '" value="' + escapeXml(escapeHtml(e.label)) + '" style="' +
      escapeXml("edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=#5A626E;fontColor=#3B4252;fontSize=12;" + e.style) +
      '" edge="1" parent="1" source="' + escapeXml(e.from) + '" target="' + escapeXml(e.to) +
      '"><mxGeometry relative="1" as="geometry"/></mxCell>');
  });

  cells.push("</root>", "</mxGraphModel>");

  return { finish: finish, xml: cells.join("\n"), type: "csv", warnings: warnings, stats: Object.assign({}, stats,
    { width: Math.round(maxX + 20), height: Math.round(maxY + 20) }) };
}

// The calm theme's step, for rows placed without the layout
const CALM_STYLE = "rounded=1;arcSize=12;" + DEFAULT_STYLE + "fillColor=#EEF4FF;strokeColor=#9DB8F2;fontColor=#1B1F24;fontSize=14;";

/**
 * A row's own style over the calm one: its names (`label`, `ellipse`)
 * first, then the calm keys it doesn't set, then its own keys.
 */
function mergeStyle(base, own)
{
  const names = [];
  const keys = new Map();

  own.split(";").forEach(function(p)
  {
    const i = p.indexOf("=");

    if (i < 0)
    {
      if (p.trim() !== "")
      {
        names.push(p.trim());
      }
    }
    else
    {
      keys.set(p.substring(0, i).trim(), p.substring(i + 1));
    }
  });

  const kept = base.split(";").filter(function(p)
  {
    const i = p.indexOf("=");

    return i > 0 && !keys.has(p.substring(0, i).trim());
  });

  return names.concat(kept).concat(Array.from(keys.entries()).map(function(e) { return e[0] + "=" + e[1]; }))
    .join(";") + ";";
}

function longest(text)
{
  return text.split("\n").reduce(function(m, l) { return Math.max(m, l.length); }, 0);
}

/**
 * A label template as draw.io keeps it: no scripts, event handlers or
 * `javascript:` links (Graph.sanitizeHtml does more in the editor).
 */
function sanitizeHtml(html)
{
  return String(html).replace(/<\s*(script|style|iframe|object|embed)\b[\s\S]*?(<\/\s*\1\s*>|$)/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, "$1=\"#\"");
}

function escapeXml(s)
{
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;");
}

function escapeHtml(s)
{
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeXml(s)
{
  return s.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");
}
