// Helpers shared by the converters of Mermaid, PlantUML and draw.io CSV
// (shared/convert): error messages that say where and how to fix, labels
// as plain text, and CSS-like style declarations as draw.io style keys.
// Headless: no DOM, the same in the Worker, Node and the browser.

/**
 * A syntax error as the model reads it: the format, the line, the text of
 * the line, what is wrong and how to fix it.
 *
 * @param {string} format - "Mermaid", "PlantUML" or "CSV"
 * @param {number} line - 1-based line in the text the model sent
 * @param {string} text - the line (shortened)
 * @param {string} problem - what is wrong, a sentence
 * @param {string} [fix] - how to fix it, a sentence
 * @returns {string}
 */
export function syntaxError(format, line, text, problem, fix)
{
  const shown = String(text || "").trim();

  return format + " syntax error on line " + line + (shown !== "" ? " (`" + shorten(shown, 80) + "`)" : "") + ": " +
    problem + (fix ? " Fix: " + fix : "");
}

/**
 * @param {string} s
 * @param {number} max
 * @returns {string}
 */
export function shorten(s, max)
{
  return s.length > max ? s.substring(0, max - 1) + "…" : s;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };

/**
 * A label as plain text: line breaks (`<br>`, `\n`) become new lines, other
 * markup and Markdown emphasis are dropped, HTML and Mermaid entities
 * (`&amp;`, `#quot;`, `#9829;`) decoded.
 *
 * @param {string} text
 * @returns {string}
 */
export function plainLabel(text)
{
  let s = String(text == null ? "" : text);

  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/\\n/g, "\n");
  s = s.replace(/<\/?[a-z][^<>]*>/gi, "");
  // Markdown strings ("`**bold** text`") and emphasis
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/(^|\s)\*([^*\s][^*]*)\*/g, "$1$2");
  // Mermaid entity codes: #quot; #35; and HTML entities
  s = s.replace(/#(\d+);/g, function(m, n) { return String.fromCodePoint(Number(n)); });
  s = s.replace(/#([a-z]+);/gi, function(m, n) { return ENTITIES[n.toLowerCase()] != null ? ENTITIES[n.toLowerCase()] : m; });
  s = s.replace(/&#(\d+);/g, function(m, n) { return String.fromCodePoint(Number(n)); });
  s = s.replace(/&#x([0-9a-f]+);/gi, function(m, n) { return String.fromCodePoint(parseInt(n, 16)); });
  s = s.replace(/&([a-z]+|#39);/gi, function(m, n) { return ENTITIES[n.toLowerCase()] != null ? ENTITIES[n.toLowerCase()] : m; });

  return s.split("\n").map(function(l) { return l.replace(/[ \t]+/g, " ").trim(); }).join("\n").trim();
}

/**
 * Removes one pair of surrounding quotes (", ', or the backticks of a
 * Mermaid Markdown string inside them).
 *
 * @param {string} s
 * @returns {string}
 */
export function unquote(s)
{
  let t = String(s).trim();

  if (t.length >= 2 && ((t[0] === "\"" && t[t.length - 1] === "\"") || (t[0] === "'" && t[t.length - 1] === "'")))
  {
    t = t.substring(1, t.length - 1);
  }

  if (t.length >= 2 && t[0] === "`" && t[t.length - 1] === "`")
  {
    t = t.substring(1, t.length - 1);
  }

  return t;
}

// The CSS color names (from the color-name package), as draw.io writes
// colors: in hex, which its color pickers and dark mode read
const COLOR_NAMES = new Map(("aliceblue:F0F8FF antiquewhite:FAEBD7 aqua:00FFFF aquamarine:7FFFD4 azure:F0FFFF beige:F5F5DC " +
  "bisque:FFE4C4 black:000000 blanchedalmond:FFEBCD blue:0000FF blueviolet:8A2BE2 brown:A52A2A " +
  "burlywood:DEB887 cadetblue:5F9EA0 chartreuse:7FFF00 chocolate:D2691E coral:FF7F50 cornflowerblue:6495ED " +
  "cornsilk:FFF8DC crimson:DC143C cyan:00FFFF darkblue:00008B darkcyan:008B8B darkgoldenrod:B8860B " +
  "darkgray:A9A9A9 darkgreen:006400 darkgrey:A9A9A9 darkkhaki:BDB76B darkmagenta:8B008B " +
  "darkolivegreen:556B2F darkorange:FF8C00 darkorchid:9932CC darkred:8B0000 darksalmon:E9967A " +
  "darkseagreen:8FBC8F darkslateblue:483D8B darkslategray:2F4F4F darkslategrey:2F4F4F darkturquoise:00CED1 " +
  "darkviolet:9400D3 deeppink:FF1493 deepskyblue:00BFFF dimgray:696969 dimgrey:696969 dodgerblue:1E90FF " +
  "firebrick:B22222 floralwhite:FFFAF0 forestgreen:228B22 fuchsia:FF00FF gainsboro:DCDCDC ghostwhite:F8F8FF " +
  "gold:FFD700 goldenrod:DAA520 gray:808080 green:008000 greenyellow:ADFF2F grey:808080 honeydew:F0FFF0 " +
  "hotpink:FF69B4 indianred:CD5C5C indigo:4B0082 ivory:FFFFF0 khaki:F0E68C lavender:E6E6FA " +
  "lavenderblush:FFF0F5 lawngreen:7CFC00 lemonchiffon:FFFACD lightblue:ADD8E6 lightcoral:F08080 " +
  "lightcyan:E0FFFF lightgoldenrodyellow:FAFAD2 lightgray:D3D3D3 lightgreen:90EE90 lightgrey:D3D3D3 " +
  "lightpink:FFB6C1 lightsalmon:FFA07A lightseagreen:20B2AA lightskyblue:87CEFA lightslategray:778899 " +
  "lightslategrey:778899 lightsteelblue:B0C4DE lightyellow:FFFFE0 lime:00FF00 limegreen:32CD32 linen:FAF0E6 " +
  "magenta:FF00FF maroon:800000 mediumaquamarine:66CDAA mediumblue:0000CD mediumorchid:BA55D3 " +
  "mediumpurple:9370DB mediumseagreen:3CB371 mediumslateblue:7B68EE mediumspringgreen:00FA9A " +
  "mediumturquoise:48D1CC mediumvioletred:C71585 midnightblue:191970 mintcream:F5FFFA mistyrose:FFE4E1 " +
  "moccasin:FFE4B5 navajowhite:FFDEAD navy:000080 oldlace:FDF5E6 olive:808000 olivedrab:6B8E23 " +
  "orange:FFA500 orangered:FF4500 orchid:DA70D6 palegoldenrod:EEE8AA palegreen:98FB98 paleturquoise:AFEEEE " +
  "palevioletred:DB7093 papayawhip:FFEFD5 peachpuff:FFDAB9 peru:CD853F pink:FFC0CB plum:DDA0DD " +
  "powderblue:B0E0E6 purple:800080 rebeccapurple:663399 red:FF0000 rosybrown:BC8F8F royalblue:4169E1 " +
  "saddlebrown:8B4513 salmon:FA8072 sandybrown:F4A460 seagreen:2E8B57 seashell:FFF5EE sienna:A0522D " +
  "silver:C0C0C0 skyblue:87CEEB slateblue:6A5ACD slategray:708090 slategrey:708090 snow:FFFAFA " +
  "springgreen:00FF7F steelblue:4682B4 tan:D2B48C teal:008080 thistle:D8BFD8 tomato:FF6347 turquoise:40E0D0 " +
  "violet:EE82EE wheat:F5DEB3 white:FFFFFF whitesmoke:F5F5F5 yellow:FFFF00 yellowgreen:9ACD32 ").trim().split(" ").map(function(p)
{
  const i = p.indexOf(":");

  return [p.substring(0, i), "#" + p.substring(i + 1)];
}));

const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;

/**
 * A CSS color as draw.io writes it: #RGB → #RRGGBB, a name in hex,
 * `transparent` as `none`.
 *
 * @param {string} c
 * @returns {string|null} null for a value that is no color
 */
export function cssColor(c)
{
  const v = String(c || "").trim().replace(/\s*!important$/, "");
  const m = SHORT_HEX.exec(v);

  if (m != null)
  {
    return ("#" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  }

  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v))
  {
    return v.toUpperCase();
  }

  if (/^(rgb|rgba|hsl|hsla)\([^()]*\)$/i.test(v))
  {
    return v;
  }

  const name = v.toLowerCase();

  if (name === "transparent" || name === "none")
  {
    return "none";
  }

  return name === "default" ? "default" : (COLOR_NAMES.get(name) || null);
}

/**
 * CSS-like declarations (`fill:#f9f,stroke:#333,stroke-width:4px,color:#fff`,
 * Mermaid's classDef and style, PlantUML's skinparam-like colors) as draw.io
 * style keys. What has no draw.io key is listed in `ignored`.
 *
 * @param {string} css - declarations separated by `,` or `;`
 * @param {{edge?: boolean}} [options] - edge: the declarations of a line
 *   (stroke is the line's color, color its label's)
 * @returns {{style: string, ignored: string[]}}
 */
export function cssToStyle(css, options)
{
  const edge = options != null && options.edge === true;
  const keys = [];
  const ignored = [];

  String(css || "").split(/[,;](?![^(]*\))/).forEach(function(decl)
  {
    const i = decl.indexOf(":");

    if (i < 0)
    {
      if (decl.trim() !== "")
      {
        ignored.push(decl.trim());
      }

      return;
    }

    const name = decl.substring(0, i).trim().toLowerCase();
    const value = decl.substring(i + 1).trim();
    let color;

    switch (name)
    {
      case "fill":
      case "background":
      case "background-color":
        color = cssColor(value);
        edge ? ignored.push(name) : (color != null ? keys.push("fillColor=" + color) : ignored.push(name));
        break;
      case "stroke":
      case "border-color":
      case "line-color":
        color = cssColor(value);
        color != null ? keys.push("strokeColor=" + color) : ignored.push(name);
        break;
      case "color":
      case "font-color":
        color = cssColor(value);
        color != null ? keys.push("fontColor=" + color) : ignored.push(name);
        break;
      case "stroke-width":
      case "line-thickness":
      case "border-width":
        if (/^\d+(\.\d+)?(px)?$/.test(value))
        {
          keys.push("strokeWidth=" + parseFloat(value));
        }
        else
        {
          ignored.push(name);
        }
        break;
      case "stroke-dasharray":
        if (/^[\d.\s,px]+$/.test(value))
        {
          keys.push("dashed=1", "dashPattern=" + value.replace(/px/g, "").replace(/[,\s]+/g, " ").trim());
        }
        else
        {
          ignored.push(name);
        }
        break;
      case "font-weight":
        if (/bold|[6-9]00/.test(value))
        {
          keys.push("fontStyle=1");
        }
        break;
      case "font-style":
        if (/italic/.test(value))
        {
          keys.push("fontStyle=2");
        }
        break;
      case "opacity":
        if (/^(0?\.\d+|1(\.0+)?)$/.test(value))
        {
          keys.push("opacity=" + Math.round(parseFloat(value) * 100));
        }
        break;
      default:
        ignored.push(name);
    }
  });

  return { style: keys.length > 0 ? keys.join(";") + ";" : "", ignored: ignored };
}

/**
 * Splits a line into statements at `;` outside quotes and brackets.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function splitStatements(line)
{
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;

  for (let i = 0; i < line.length; i++)
  {
    const c = line[i];

    if (quote != null)
    {
      if (c === quote)
      {
        quote = null;
      }
    }
    else if (c === "\"")
    {
      quote = c;
    }
    else if (c === "[" || c === "(" || c === "{")
    {
      depth++;
    }
    else if ((c === "]" || c === ")" || c === "}") && depth > 0)
    {
      depth--;
    }
    else if (c === ";" && depth === 0 && !/#\w*$/.test(line.substring(start, i)))
    {
      out.push(line.substring(start, i));
      start = i + 1;
    }
  }

  out.push(line.substring(start));

  return out;
}

/**
 * The text after an XML-escape, for attribute values.
 *
 * @param {string} s
 * @returns {string}
 */
export function escapeXml(s)
{
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
}

/**
 * A label as the HTML value of a cell with html=1.
 *
 * @param {string} text - plain text, lines separated by \n
 * @returns {string}
 */
export function htmlValue(text)
{
  return String(text == null ? "" : text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .split("\n").join("<br>");
}

/**
 * "a", "a and b", "a, b and c" (at most `max` names, then "and N more").
 *
 * @param {string[]} items
 * @param {number} [max]
 * @returns {string}
 */
export function listText(items, max)
{
  const m = max || 6;
  const shown = items.slice(0, m);
  const more = items.length - shown.length;

  if (more > 0)
  {
    return shown.join(", ") + " and " + more + " more";
  }

  return shown.length <= 1 ? shown.join("") : shown.slice(0, -1).join(", ") + " and " + shown[shown.length - 1];
}
