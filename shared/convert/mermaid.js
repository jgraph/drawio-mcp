// Mermaid → draw.io on the server: flowcharts, ER diagrams and sequence
// diagrams are read here and drawn as draw.io cells, laid out and styled by
// the semantic engine (shared/semantic) and the sequence writer
// (sequence.js). The other Mermaid types are left to draw.io's own converter
// in the viewer (`fallback`). A syntax error is reported with its line, what
// is wrong and how to fix it; what the conversion leaves out is listed in
// `warnings`. Headless and deterministic: Worker, Node and browser.

import { syntaxError, plainLabel, unquote, cssToStyle, splitStatements, listText, shorten } from "./common.js";

/** The Mermaid types this module converts (the first word of the header, lowercased). */
export const SERVER_TYPES = ["flowchart", "graph", "flowchart-elk", "erdiagram", "sequencediagram"];

/**
 * Every Mermaid header draw.io converts (drawio-mermaid's types), lowercased:
 * a header that isn't one of them is a syntax error, since the diagram would
 * render blank.
 */
export const MERMAID_TYPES =
[
  "flowchart", "graph", "flowchart-elk", "sequencediagram", "classdiagram", "classdiagram-v2",
  "statediagram", "statediagram-v2", "erdiagram", "gantt", "pie", "journey",
  "gitgraph", "mindmap", "timeline", "quadrantchart", "xychart", "xychart-beta",
  "sankey", "sankey-beta", "requirementdiagram", "c4context", "c4container",
  "c4component", "c4dynamic", "c4deployment", "block", "block-beta",
  "architecture", "architecture-beta", "packet", "packet-beta", "kanban",
  "radar", "radar-beta", "treemap", "treemap-beta", "treeview-beta",
  "venn-beta", "ishikawa", "ishikawa-beta", "zenuml", "wardley-beta", "eventmodeling",
  "swimlane-beta", "usecase", "usecase-beta", "railroad-beta", "cynefin-beta"
];

// The spelling of each header as Mermaid writes it, where it isn't all
// lowercase (drawio-mermaid's header table)
const HEADER_SPELLING =
{
  sequencediagram: "sequenceDiagram", classdiagram: "classDiagram", "classdiagram-v2": "classDiagram-v2",
  statediagram: "stateDiagram", "statediagram-v2": "stateDiagram-v2", erdiagram: "erDiagram", gitgraph: "gitGraph",
  quadrantchart: "quadrantChart", requirementdiagram: "requirementDiagram", c4context: "C4Context",
  c4container: "C4Container", c4component: "C4Component", c4dynamic: "C4Dynamic", c4deployment: "C4Deployment",
  "treeview-beta": "treeView-beta"
};

/**
 * A header type as Mermaid writes it (`classdiagram` → `classDiagram`), for
 * the messages that name it.
 *
 * @param {string} type - lowercased, one of MERMAID_TYPES
 * @returns {string}
 */
export function mermaidTypeName(type)
{
  return HEADER_SPELLING[type] || type;
}

const ERR = "Mermaid";

// ─── Lines ───────────────────────────────────────────────────────

/**
 * The source as logical lines with their line numbers: a line break inside
 * an `@{ … }` block joins the lines, and so does one inside a quoted label
 * on a line from `quoteFrom` on (the label keeps it as a new line). Quotes
 * open a label only where Mermaid reads a string: not in a `%%` comment or
 * directive, nor in an accessibility line (`accTitle:`, `accDescr`), and a
 * quote still open at the end of the text opened none, so the lines after
 * it are read as lines of their own (`27" monitor`). In text still
 * streaming in (`partial`) such a quote is a label still being written.
 *
 * @param {string} text
 * @param {number} quoteFrom - the first line whose quotes may continue onto
 *   the next line (Infinity: none, as in a sequence diagram, where `"` in a
 *   message or note is text)
 * @param {boolean} partial
 * @returns {Array<{text: string, line: number}>}
 */
function logicalLines(text, quoteFrom, partial)
{
  const stray = new Set();

  for (;;)
  {
    const r = scanLines(text, quoteFrom, stray);

    if (r.open < 0 || partial)
    {
      return r.lines;
    }

    // the quote that is still open is text, and the lines after it are
    // read again
    stray.add(r.open);
  }
}

// A line that holds text to its end, whatever its quotes: a comment, a
// directive, an accessibility line
const PLAIN_LINE = /^[ \t]*(%%|acc(Title|Descr)[ \t]*:)/;
const ACC_BLOCK = /^[ \t]*accDescr[ \t]*\{/;

/**
 * logicalLines' scan, with the quotes at the indices in `stray` read as
 * text: the lines, and the index of the quote still open at the end (-1
 * for none).
 *
 * @param {string} text
 * @param {number} quoteFrom
 * @param {Set<number>} stray
 * @returns {{lines: Array<{text: string, line: number}>, open: number}}
 */
function scanLines(text, quoteFrom, stray)
{
  const out = [];
  let cur = "";
  let start = 1;
  let line = 1;
  let quote = false;
  let opened = -1;
  let braces = 0;
  // "line": a comment or accessibility line, to its end; "block": an
  // `accDescr { … }` block, to its `}`
  let plain = null;

  for (let i = 0; i < text.length; i++)
  {
    const c = text[i];

    if (c === "\r")
    {
      continue;
    }

    if (plain == null && !quote && braces === 0 && (i === 0 || text[i - 1] === "\n"))
    {
      const eol = text.indexOf("\n", i);
      const physical = text.substring(i, eol < 0 ? text.length : eol);

      plain = ACC_BLOCK.test(physical) ? (physical.indexOf("}") < 0 ? "block" : "line") :
        PLAIN_LINE.test(physical) ? "line" : null;
    }

    if (c === "\n")
    {
      const ended = line;

      line++;

      if (plain === "line")
      {
        plain = null;
      }

      if (quote && ended >= quoteFrom)
      {
        cur += "<br>";
        continue;
      }

      quote = false;

      if (braces > 0)
      {
        cur += ", ";
        continue;
      }

      out.push({ text: cur, line: start });
      cur = "";
      start = line;
      continue;
    }

    if (plain === "block" && c === "}")
    {
      plain = null;
    }
    else if (plain != null || stray.has(i))
    {
      // text
    }
    else if (c === "\"")
    {
      quote = !quote;
      opened = quote ? i : -1;
    }
    else if (!quote && c === "{" && text[i - 1] === "@")
    {
      braces = 1;
    }
    else if (!quote && braces > 0 && c === "{")
    {
      braces++;
    }
    else if (!quote && braces > 0 && c === "}")
    {
      braces--;
    }

    cur += c;
  }

  out.push({ text: cur, line: start });

  return { lines: out, open: quote ? opened : -1 };
}

// The selectors of draw.io's ELK layout in a Mermaid config, as
// EditorUi.isMermaidElkFlowchart (drawio-dev) and drawio-mermaid read them:
// `layout: elk` and the older `flowchart: { defaultRenderer: "elk" }`
const ELK_SELECTOR = /["']?\b(layout|defaultRenderer)["']?\s*:\s*["']?elk(?![\w.-])["']?/;

/**
 * What a Mermaid config (a `%%{init}%%` directive, a frontmatter `config`
 * block) asks for: the ELK layout, and anything else (a theme, a look,
 * flowchart options), which the conversion doesn't use.
 *
 * @param {string} text
 * @returns {{elk: boolean, other: boolean}}
 */
function readConfig(text)
{
  const rest = text.replace(new RegExp(ELK_SELECTOR.source, "g"), "")
    .replace(/%%|\b(init|initialize|config|flowchart)\b/g, "");

  return { elk: ELK_SELECTOR.test(text), other: /[A-Za-z0-9]/.test(rest) };
}

/**
 * The header of a Mermaid source: its type, title (frontmatter or a `title`
 * line), whether its config selects the ELK layout (`elk`) or carries a
 * theme or other config (`themed`), and the lines after it.
 *
 * @param {string} text
 * @param {{partial?: boolean}} [options] - partial: the text is still
 *   streaming in, so a quote open at its end is a label still being written
 * @returns {{type: string, keyword: string, rest: string, line: number, title: string, elk: boolean, themed: boolean,
 *   body: Array<{text: string, line: number}>}|{error: string}}
 */
export function readHeader(text, options)
{
  const source = String(text || "");
  // no label runs over several lines before the header
  const lines = logicalLines(source, Infinity, false);
  let k = 0;
  let title = "";
  let elk = false;
  let themed = false;

  const config = function(t)
  {
    const c = readConfig(t);

    elk = elk || c.elk;
    themed = themed || c.other;
  };

  const skip = function()
  {
    while (k < lines.length && (lines[k].text.trim() === "" || /^\s*%%/.test(lines[k].text)))
    {
      if (/^\s*%%\{/.test(lines[k].text))
      {
        config(lines[k].text);
      }

      k++;
    }
  };

  skip();

  if (k < lines.length && lines[k].text.trim() === "---")
  {
    const open = lines[k].line;
    let block = null;

    k++;

    while (k < lines.length && lines[k].text.trim() !== "---")
    {
      const t = lines[k].text;
      const m = /^title\s*:\s*(.*)$/.exec(t.trim());

      if (block != null && (t.trim() === "" || /^\s/.test(t)))
      {
        // a line of the config block
        block += "\n" + t;
      }
      else
      {
        if (block != null)
        {
          config(block);
          block = null;
        }

        if (m != null && /^\S/.test(t))
        {
          title = plainLabel(unquote(m[1]));
        }
        else if (/^config\s*:/.test(t))
        {
          block = t.replace(/^config\s*:/, "");
        }
      }

      k++;
    }

    if (block != null)
    {
      config(block);
    }

    if (k >= lines.length)
    {
      return { error: syntaxError(ERR, open, "---", "the frontmatter that starts here has no closing `---` line.",
        "end it with a line `---` before the diagram's header.") };
    }

    k++;
    skip();
  }

  if (k >= lines.length)
  {
    return { error: "The Mermaid diagram is empty: it has no header such as `flowchart TD` or `sequenceDiagram`." };
  }

  const first = lines[k].text.trim();
  const m = /^([A-Za-z0-9-]+)\s*(.*)$/.exec(first);
  const keyword = m != null ? m[1] : first;
  const type = keyword.toLowerCase();

  if (MERMAID_TYPES.indexOf(type) < 0)
  {
    return { error: syntaxError(ERR, lines[k].line, first, "\"" + shorten(keyword, 30) + "\" is not a Mermaid diagram type, " +
      "so the diagram would render blank.", "start with one of the headers in get_drawio_reference's Mermaid reference" +
      (closestType(type) != null ? ", here probably `" + closestType(type) + "`." : ", such as `flowchart TD`, `sequenceDiagram`, " +
      "`classDiagram`, `stateDiagram-v2`, `erDiagram` or `gantt`.")) };
  }

  // in a sequence diagram a `"` in a message or note is text; elsewhere a
  // quoted label may run over several lines
  const at = lines[k].line;
  const body = type === "sequencediagram" ? lines.slice(k + 1) :
    logicalLines(source, at + 1, options != null && options.partial === true).filter(function(l)
    {
      return l.line > at;
    });

  return { type: type, keyword: keyword, rest: m != null ? m[2] : "", line: at, title: title, elk: elk, themed: themed,
    body: body };
}

/**
 * The header a misspelled one probably meant, or null.
 *
 * @param {string} type - lowercased
 * @returns {string|null}
 */
function closestType(type)
{
  let best = null;
  let bestD = 3;

  for (const t of MERMAID_TYPES)
  {
    const d = editDistance(type.replace(/-v2$|-beta$/, ""), t.replace(/-v2$|-beta$/, ""));

    if (d < bestD)
    {
      bestD = d;
      best = t;
    }
  }

  if (best == null && /^(sequence|seq)/.test(type))
  {
    best = "sequencediagram";
  }

  // stateDiagram-v2, the one the Mermaid reference teaches
  return best == null ? null : (best === "statediagram" ? "stateDiagram-v2" : mermaidTypeName(best));
}

function editDistance(a, b)
{
  const d = [];

  for (let i = 0; i <= a.length; i++)
  {
    d.push([i]);
  }

  for (let j = 1; j <= b.length; j++)
  {
    d[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++)
  {
    for (let j = 1; j <= b.length; j++)
    {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }

  return d[a.length][b.length];
}

/**
 * The statements of the body, one per `;`-separated part of a line, without
 * comments and accessibility lines.
 *
 * @param {Array<{text: string, line: number}>} body
 * @returns {Array<{text: string, line: number, raw: string}>}
 */
function statements(body)
{
  const out = [];
  let accBlock = false;

  for (const l of body)
  {
    const t = l.text.trim();

    if (accBlock)
    {
      accBlock = t.indexOf("}") < 0;
      continue;
    }

    if (t === "" || t.startsWith("%%"))
    {
      continue;
    }

    if (/^acc(Title|Descr)\s*:/.test(t))
    {
      continue;
    }

    if (/^accDescr\s*\{/.test(t))
    {
      accBlock = t.indexOf("}") < 0;
      continue;
    }

    for (const part of splitStatements(t))
    {
      const s = part.trim();

      if (s !== "")
      {
        out.push({ text: s, line: l.line, raw: l.text });
      }
    }
  }

  return out;
}

// ─── Flowchart ───────────────────────────────────────────────────

// Node shapes: opener, closer, shape name. Longest openers first.
const SHAPES =
[
  ["(((", ")))", "dbl-circ"],
  ["((", "))", "circle"],
  ["([", "])", "stadium"],
  ["[[", "]]", "subroutine"],
  ["[(", ")]", "cylinder"],
  ["[/", null, "lean"],
  ["[\\", null, "lean-alt"],
  ["{{", "}}", "hexagon"],
  ["(", ")", "round"],
  ["[", "]", "rect"],
  ["{", "}", "diamond"],
  [">", "]", "odd"]
];

// Shape names of the `@{ shape: … }` syntax → the shapes above
const NEW_SHAPES =
{
  rect: "rect", rectangle: "rect", proc: "rect", process: "rect", "notch-rect": "card", card: "card", "notched-rectangle": "card",
  rounded: "round", event: "round", stadium: "stadium", pill: "stadium", terminal: "stadium",
  "fr-rect": "subroutine", subprocess: "subroutine", subproc: "subroutine", "framed-rectangle": "subroutine", subroutine: "subroutine",
  cyl: "cylinder", cylinder: "cylinder", db: "cylinder", database: "cylinder", das: "cylinder", "h-cyl": "cylinder",
  "lin-cyl": "cylinder", disk: "cylinder", "horizontal-cylinder": "cylinder",
  circle: "circle", circ: "circle", "sm-circ": "circle", start: "circle", "small-circle": "circle",
  "dbl-circ": "dbl-circ", "double-circle": "dbl-circ", "fr-circ": "dbl-circ", stop: "dbl-circ", "framed-circle": "dbl-circ",
  diam: "diamond", diamond: "diamond", decision: "diamond", question: "diamond",
  hex: "hexagon", hexagon: "hexagon", prepare: "hexagon",
  "lean-r": "lean", "lean-right": "lean", "in-out": "lean", "lean-l": "lean-alt", "lean-left": "lean-alt", "out-in": "lean-alt",
  "trap-b": "trap", trapezoid: "trap", priority: "trap", "trapezoid-bottom": "trap",
  "trap-t": "trap-alt", manual: "trap-alt", "inv-trapezoid": "trap-alt", "trapezoid-top": "trap-alt",
  doc: "doc", document: "doc", docs: "docs", documents: "docs", "st-doc": "docs", "stacked-document": "docs",
  delay: "delay", "half-rounded-rectangle": "delay", text: "text", odd: "odd",
  tri: "triangle", triangle: "triangle", extract: "triangle", "flip-tri": "triangle-down", "manual-file": "triangle-down",
  "flipped-triangle": "triangle-down", "lin-doc": "doc", "lined-document": "doc", "tag-doc": "doc", "tagged-document": "doc",
  "tag-rect": "rect", "tagged-rectangle": "rect", "tag-proc": "rect", "div-rect": "rect", "div-proc": "rect",
  "divided-rectangle": "rect", "lin-rect": "subroutine", "lin-proc": "subroutine", "lined-rectangle": "subroutine",
  "win-pane": "rect", "internal-storage": "rect", "window-pane": "rect", "sl-rect": "lean", "manual-input": "lean",
  "sloped-rectangle": "lean", "st-rect": "docs", procs: "docs", processes: "docs", "stacked-rectangle": "docs",
  flag: "odd", "paper-tape": "odd", "bow-rect": "cylinder", "stored-data": "cylinder", "bow-tie-rectangle": "cylinder",
  "cross-circ": "circle", summary: "circle", "crossed-circle": "circle", "f-circ": "circle", junction: "circle",
  "filled-circle": "circle", "fork": "rect", join: "rect", hourglass: "diamond", collate: "diamond",
  "brace": "text", "brace-r": "text", braces: "text", comment: "text", bolt: "rect", "com-link": "rect",
  "lightning-bolt": "rect", "notched-pentagon": "hexagon", "loop-limit": "hexagon", "curv-trap": "delay", display: "delay",
  "curved-trapezoid": "delay"
};

// A shape → the role and extra style keys the engine draws it with. Start
// and end come from the connections (a stadium or circle without incoming
// lines is a start).
const SHAPE_STYLE =
{
  rect: { kind: "step", style: "" },
  round: { kind: "step", style: "" },
  stadium: { kind: "terminal", style: "" },
  subroutine: { kind: "step", style: "shape=process;backgroundOutline=1;rounded=0;" },
  cylinder: { kind: "data", style: "" },
  circle: { kind: "terminal", style: "ellipse;" },
  "dbl-circ": { kind: "terminal", style: "ellipse;shape=doubleEllipse;" },
  diamond: { kind: "decision", style: "" },
  hexagon: { kind: "step", style: "shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;rounded=0;" },
  lean: { kind: "step", style: "shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1;rounded=0;" },
  "lean-alt": { kind: "step", style: "shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1;flipH=1;rounded=0;" },
  trap: { kind: "step", style: "shape=trapezoid;perimeter=trapezoidPerimeter;fixedSize=1;rounded=0;" },
  "trap-alt": { kind: "step", style: "shape=trapezoid;perimeter=trapezoidPerimeter;fixedSize=1;flipV=1;rounded=0;" },
  odd: { kind: "step", style: "shape=mxgraph.flowchart.paper_tape;rounded=0;" },
  card: { kind: "step", style: "shape=card;size=14;rounded=0;" },
  doc: { kind: "step", style: "shape=document;boundedLbl=1;size=0.2;rounded=0;" },
  docs: { kind: "step", style: "shape=mxgraph.flowchart.multi-document;rounded=0;" },
  delay: { kind: "step", style: "shape=delay;rounded=0;" },
  triangle: { kind: "step", style: "triangle;direction=north;rounded=0;" },
  "triangle-down": { kind: "step", style: "triangle;direction=south;rounded=0;" },
  text: { kind: "step", style: "text;fillColor=none;strokeColor=none;" }
};

/**
 * A node id at i: letters, digits, `_` and `$`, and `-` between them.
 *
 * @returns {{id: string, end: number}|null}
 */
function readId(s, i)
{
  let j = i;

  while (j < s.length)
  {
    const c = s[j];

    if (/[\p{L}\p{N}_$]/u.test(c))
    {
      j++;
    }
    else if (c === "-" && j > i && j + 1 < s.length && /[\p{L}\p{N}_]/u.test(s[j + 1]))
    {
      j++;
    }
    else if (c === "." && j > i && j + 1 < s.length && /[\p{L}\p{N}_]/u.test(s[j + 1]) && s[j - 1] !== "-")
    {
      j++;
    }
    else
    {
      break;
    }
  }

  return j > i ? { id: s.substring(i, j), end: j } : null;
}

/**
 * The label and closing position of a shape that opens at i.
 *
 * @returns {{label: string, end: number, shape: string}|{error: string}}
 */
function readShape(s, i)
{
  for (const sh of SHAPES)
  {
    if (!s.startsWith(sh[0], i))
    {
      continue;
    }

    let j = i + sh[0].length;
    let label;

    while (s[j] === " ")
    {
      j++;
    }

    let closers = sh[1] != null ? [sh[1]] : ["/]", "\\]"];

    if (s[j] === "\"")
    {
      const q = s.indexOf("\"", j + 1);

      if (q < 0)
      {
        return { error: "the quoted label that starts here has no closing `\"`.", fix: "close the label with `\"` and the shape with `" + closers[0] + "`." };
      }

      label = s.substring(j + 1, q);
      j = q + 1;

      while (s[j] === " ")
      {
        j++;
      }

      const closer = closers.find(function(c) { return s.startsWith(c, j); });

      if (closer == null)
      {
        return { error: "the shape `" + sh[0] + "…` has no `" + closers[0] + "` after its label.", fix: "write it as `id" + sh[0] + "\"label\"" + closers[0] + "`." };
      }

      return { label: label, end: j + closer.length, shape: shapeOf(sh[2], closer) };
    }

    let best = -1;
    let used = null;

    for (const c of closers)
    {
      const at = s.indexOf(c, j);

      if (at >= 0 && (best < 0 || at < best))
      {
        best = at;
        used = c;
      }
    }

    if (best < 0)
    {
      return { error: "the shape `" + sh[0] + "…` is not closed with `" + closers[0] + "`.",
        fix: "close it, and put a label with brackets or parentheses in quotes: `id" + sh[0] + "\"label (note)\"" + closers[0] + "`." };
    }

    label = s.substring(j, best);

    return { label: label, end: best + used.length, shape: shapeOf(sh[2], used) };
  }

  return null;
}

function shapeOf(name, closer)
{
  if (name === "lean")
  {
    return closer === "\\]" ? "trap" : "lean";
  }

  if (name === "lean-alt")
  {
    return closer === "/]" ? "trap-alt" : "lean-alt";
  }

  return name;
}

/**
 * The `@{ key: value, … }` of the newer node syntax.
 *
 * @returns {{props: object, end: number}|{error: string}}
 */
function readProps(s, i)
{
  let depth = 0;
  let quote = false;
  let j = i;

  for (; j < s.length; j++)
  {
    const c = s[j];

    if (c === "\"")
    {
      quote = !quote;
    }
    else if (!quote && c === "{")
    {
      depth++;
    }
    else if (!quote && c === "}")
    {
      depth--;

      if (depth === 0)
      {
        break;
      }
    }
  }

  if (j >= s.length)
  {
    return { error: "the `@{` block is not closed with `}`.", fix: "write it as `id@{ shape: rect, label: \"Text\" }`." };
  }

  const props = {};
  const inner = s.substring(i + 1, j);
  const re = /([A-Za-z]+)\s*:\s*("(?:[^"]*)"|'(?:[^']*)'|[^,]*)/g;
  let m;

  while ((m = re.exec(inner)) != null)
  {
    props[m[1].toLowerCase()] = unquote(m[2].trim());
  }

  return { props: props, end: j + 1 };
}

/**
 * A link (edge) at i: its line, ends, label and length.
 *
 * @returns {{end: number, line: string, start: string, head: string, label: string|null, invisible: boolean}|null}
 */
function readLink(s, i)
{
  let j = i;
  const idm = /^[A-Za-z_][\w-]*@(?=[<ox]?[-=.~])/.exec(s.substring(j));

  if (idm != null)
  {
    j += idm[0].length;
  }

  let start = "";

  if (s[j] === "<")
  {
    start = "arrow";
    j++;
  }
  else if ((s[j] === "o" || s[j] === "x") && /[-=]/.test(s[j + 1] || "") && /[-=.]/.test(s[j + 2] || ""))
  {
    start = s[j] === "o" ? "circle" : "cross";
    j++;
  }

  const rest = s.substring(j);
  const heads = { ">": "arrow", o: "circle", x: "cross" };
  let m;
  let r = null;

  if ((m = /^~{3,}/.exec(rest)) != null)
  {
    r = { len: m[0].length, line: "invisible", head: "", label: null };
  }
  else if ((m = /^-(\.+)-([>ox])?/.exec(rest)) != null)
  {
    r = { len: m[0].length, line: "dotted", head: m[2] ? heads[m[2]] : "", label: null };
  }
  else if ((m = /^-\.\s*(.+?)\s*\.+-([>ox])?/.exec(rest)) != null)
  {
    r = { len: m[0].length, line: "dotted", head: m[2] ? heads[m[2]] : "", label: m[1] };
  }
  else if ((m = /^(={2,})([>ox])/.exec(rest)) != null)
  {
    r = { len: m[0].length, line: "thick", head: heads[m[2]], label: null };
  }
  else if ((m = /^={3,}/.exec(rest)) != null)
  {
    r = { len: m[0].length, line: "thick", head: "", label: null };
  }
  else if ((m = /^==\s*(.+?)\s*(={2,}([>ox])|={3,})/.exec(rest)) != null)
  {
    r = { len: m[0].length, line: "thick", head: m[3] ? heads[m[3]] : "", label: m[1] };
  }
  else if ((m = /^(-{2,})([>ox])(?![\p{L}\p{N}_-])/u.exec(rest)) != null || (m = /^(-{2,})(>)/.exec(rest)) != null)
  {
    r = { len: m[0].length, line: "solid", head: heads[m[2]], label: null };
  }
  else if ((m = /^-{3,}/.exec(rest)) != null)
  {
    r = { len: m[0].length, line: "solid", head: "", label: null };
  }
  else if ((m = /^--\s*(.+?)\s*(-{2,}([>ox])|-{3,})/.exec(rest)) != null)
  {
    r = { len: m[0].length, line: "solid", head: m[3] ? heads[m[3]] : "", label: m[1] };
  }

  if (r == null)
  {
    return null;
  }

  j += r.len;

  const pipe = /^\s*\|([^|]*)\|/.exec(s.substring(j));

  if (pipe != null)
  {
    r.label = pipe[1];
    j += pipe[0].length;
  }

  return { end: j, line: r.line, start: start, head: r.head, label: r.label != null ? plainLabel(unquote(r.label)) : null,
    invisible: r.line === "invisible" };
}

/**
 * The draw.io style keys of a link.
 */
function linkStyle(l)
{
  const ends = { arrow: "classic", circle: "oval", cross: "cross", "": "none" };
  let style = "endArrow=" + ends[l.head] + ";";

  if (l.head === "circle")
  {
    style += "endFill=1;endSize=6;";
  }

  if (l.start !== "")
  {
    style += "startArrow=" + ends[l.start] + ";" + (l.start === "circle" ? "startFill=1;startSize=6;" : "");
  }

  if (l.line === "dotted")
  {
    style += "dashed=1;";
  }
  else if (l.line === "thick")
  {
    style += "strokeWidth=3;";
  }

  return style;
}

/**
 * Parses a Mermaid flowchart into a semantic description (shared/semantic
 * FORMAT.md) with the styles the shapes and classes add.
 *
 * @param {object} head - readHeader's result
 * @returns {{spec: object, warnings: string[], stats: object}|{error: string}}
 */
export function parseFlowchart(head)
{
  const warnings = [];
  const notes = new Set();
  const nodes = new Map();
  const groups = [];
  const groupById = new Map();
  const edges = [];
  const classDefs = new Map();
  const nodeClasses = new Map();
  const nodeStyles = new Map();
  const linkStyles = new Map();
  const clicks = [];
  const stack = [];
  let invisible = 0;
  let linkCount = 0;
  let direction = "TB";
  const headDir = /^(TB|TD|BT|LR|RL)\b\s*;?\s*(.*)$/i.exec(head.rest.trim());
  const extra = [];

  if (headDir != null)
  {
    direction = headDir[1].toUpperCase();

    if (headDir[2].trim() !== "")
    {
      extra.push({ text: headDir[2], line: head.line, raw: head.rest });
    }
  }
  else if (head.rest.trim() !== "" && !head.rest.trim().startsWith(";"))
  {
    return { error: syntaxError(ERR, head.line, head.keyword + " " + head.rest, "\"" + shorten(head.rest.trim(), 20) +
      "\" is not a flowchart direction.", "write `flowchart TD` (top-down) or `flowchart LR` (left to right).") };
  }
  else if (head.rest.trim().startsWith(";"))
  {
    extra.push({ text: head.rest.trim().substring(1), line: head.line, raw: head.rest });
  }

  const list = statements(extra.concat(head.body));

  function node(id, line)
  {
    let n = nodes.get(id);

    if (n == null)
    {
      n = { id: id, label: null, shape: null, group: null, line: line, props: null };
      nodes.set(id, n);
    }

    if (n.group == null && stack.length > 0)
    {
      n.group = stack[stack.length - 1].id;
    }

    return n;
  }

  // A node with its shape, label and classes at i; null when there is none.
  function readNode(st, i)
  {
    const s = st.text;
    const r = readId(s, i);

    if (r == null)
    {
      return null;
    }

    if (r.id === "end" || r.id === "subgraph")
    {
      return { error: syntaxError(ERR, st.line, st.raw, "`" + r.id + "` can't be a node id, it is a Mermaid keyword.",
        "give the node another id, e.g. `" + r.id.charAt(0).toUpperCase() + r.id.substring(1) + "Node[" + r.id + "]`.") };
    }

    const n = node(r.id, st.line);
    let j = r.end;

    if (s[j] === "@" && s[j + 1] === "{")
    {
      const p = readProps(s, j + 1);

      if (p.error != null)
      {
        return { error: syntaxError(ERR, st.line, st.raw, p.error, p.fix) };
      }

      n.props = p.props;

      if (p.props.label != null)
      {
        n.label = p.props.label;
      }

      if (p.props.shape != null)
      {
        const shape = NEW_SHAPES[p.props.shape.toLowerCase()];

        if (shape == null)
        {
          notes.add("The shape \"" + p.props.shape + "\" of " + r.id + " is drawn as a box.");
        }

        n.shape = shape || "rect";
      }

      if (p.props.icon != null || p.props.img != null)
      {
        notes.add("Icons and images of the `@{ icon }` / `@{ img }` syntax are not converted (" + r.id + " is drawn as a box).");
      }

      j = p.end;
    }
    else
    {
      const sh = readShape(s, j);

      if (sh != null && sh.error != null)
      {
        return { error: syntaxError(ERR, st.line, st.raw, sh.error, sh.fix) };
      }

      if (sh != null)
      {
        n.label = sh.label;
        n.shape = sh.shape;
        j = sh.end;
      }
    }

    const cls = /^:::([\w-]+)/.exec(s.substring(j));

    if (cls != null)
    {
      addClass(r.id, cls[1]);
      j += cls[0].length;
    }

    return { id: r.id, end: j };
  }

  function addClass(id, name)
  {
    const list = nodeClasses.get(id) || [];

    list.push(name);
    nodeClasses.set(id, list);
  }

  // Nodes joined with `&`
  function readGroupOfNodes(st, i)
  {
    const s = st.text;
    const ids = [];
    let j = i;

    for (;;)
    {
      while (s[j] === " " || s[j] === "\t")
      {
        j++;
      }

      const n = readNode(st, j);

      if (n == null)
      {
        return ids.length === 0 ? null : { error: syntaxError(ERR, st.line, st.raw, "`&` is not followed by a node.",
          "join nodes as `A & B --> C`.") };
      }

      if (n.error != null)
      {
        return n;
      }

      ids.push(n.id);
      j = n.end;

      const amp = /^\s*&\s*/.exec(s.substring(j));

      if (amp == null)
      {
        return { ids: ids, end: j };
      }

      j += amp[0].length;
    }
  }

  for (const st of list)
  {
    const s = st.text;
    let m;

    if ((m = /^subgraph\b\s*(.*)$/.exec(s)) != null)
    {
      const rest = m[1].trim();
      let id;
      let label;
      let b;

      if (rest === "")
      {
        return { error: syntaxError(ERR, st.line, st.raw, "the subgraph has no id or title.",
          "write `subgraph id [Title]` and close it with `end`.") };
      }

      if ((b = /^([^\s\[]+)\s*\[(.*)\]$/.exec(rest)) != null)
      {
        id = b[1];
        label = b[2];
      }
      else if (/^".*"$/.test(rest))
      {
        label = rest;
        id = "subgraph" + (groups.length + 1);
      }
      else
      {
        id = rest.replace(/\s+/g, "_");
        label = rest;
      }

      const g = { id: id, label: plainLabel(unquote(label)) || id, parent: stack.length > 0 ? stack[stack.length - 1].id : "",
        line: st.line };

      if (groupById.has(id))
      {
        g.id = id + "_" + (groups.length + 1);
      }

      groups.push(g);
      groupById.set(g.id, g);
      stack.push(g);
      continue;
    }

    if (s === "end")
    {
      if (stack.length === 0)
      {
        return { error: syntaxError(ERR, st.line, st.raw, "`end` closes no subgraph.",
          "remove it, or open the subgraph with `subgraph id [Title]` before it.") };
      }

      stack.pop();
      continue;
    }

    if ((m = /^direction\s+(TB|TD|BT|LR|RL)\s*$/i.exec(s)) != null)
    {
      if (stack.length > 0)
      {
        notes.add("The direction of a subgraph (`direction " + m[1] + "`) is not converted; the whole diagram flows one way.");
      }
      else
      {
        direction = m[1].toUpperCase();
      }

      continue;
    }

    if ((m = /^classDef\s+([\w,-]+)\s+(.*)$/.exec(s)) != null)
    {
      const css = cssToStyle(m[2]);

      if (css.ignored.length > 0)
      {
        notes.add("Ignored style properties without a draw.io equivalent: " + listText(css.ignored) + ".");
      }

      m[1].split(",").forEach(function(name) { classDefs.set(name.trim(), css.style); });
      continue;
    }

    if ((m = /^class\s+([^\s]+(?:\s*,\s*[^\s,]+)*)\s+([\w-]+)\s*$/.exec(s)) != null)
    {
      const name = m[2];

      m[1].split(",").forEach(function(id) { addClass(id.trim(), name); });
      continue;
    }

    if ((m = /^style\s+([^\s]+)\s+(.*)$/.exec(s)) != null)
    {
      const css = cssToStyle(m[2]);

      if (css.ignored.length > 0)
      {
        notes.add("Ignored style properties without a draw.io equivalent: " + listText(css.ignored) + ".");
      }

      nodeStyles.set(m[1], (nodeStyles.get(m[1]) || "") + css.style);
      continue;
    }

    if ((m = /^linkStyle\s+([\d,\s]+|default)\s+(.*)$/.exec(s)) != null)
    {
      const css = cssToStyle(m[2], { edge: true });

      m[1].split(",").forEach(function(k) { linkStyles.set(k.trim(), (linkStyles.get(k.trim()) || "") + css.style); });
      continue;
    }

    if ((m = /^(click|href|callback)\s+(\S+)\s*(.*)$/.exec(s)) != null)
    {
      clicks.push(m[2]);
      continue;
    }

    if (/^[\w-]+@\{.*\}$/.test(s) && nodes.size > 0 && edges.some(function(e) { return e.edgeId === s.substring(0, s.indexOf("@")); }))
    {
      // an edge's properties (animation): nothing to draw
      continue;
    }

    // A chain of nodes and links
    let g = readGroupOfNodes(st, 0);

    if (g == null)
    {
      return { error: syntaxError(ERR, st.line, st.raw, "this is not a node, a link or a statement Mermaid knows.",
        "start each line with a node id (`A[Label] --> B`), `subgraph`, `end`, `classDef`, `class`, `style` or `linkStyle`.") };
    }

    if (g.error != null)
    {
      return { error: g.error };
    }

    let j = g.end;

    for (;;)
    {
      while (s[j] === " " || s[j] === "\t")
      {
        j++;
      }

      if (j >= s.length)
      {
        break;
      }

      const before = j;
      const link = readLink(s, j);

      if (link == null)
      {
        return { error: syntaxError(ERR, st.line, st.raw, "unexpected `" + shorten(s.substring(j), 24) + "` after `" +
          shorten(s.substring(0, j).trim(), 24) + "`.", (/["()[\]{}]/.test(s.substring(j)) ?
          "put a label with brackets, parentheses or quotes in double quotes (`A[\"Label (x)\"]`), and" : "") +
          " join nodes with a link such as `-->`, `---`, `-.->` or `==>`, one statement per line.") };
      }

      j = link.end;

      while (s[j] === " " || s[j] === "\t")
      {
        j++;
      }

      const next = readGroupOfNodes(st, j);

      if (next == null)
      {
        return { error: syntaxError(ERR, st.line, st.raw, "the link `" + s.substring(before, link.end).trim() +
          "` has no node after it.", "write the node it points to after the link, e.g. `A --> B`.") };
      }

      if (next.error != null)
      {
        return { error: next.error };
      }

      for (const a of g.ids)
      {
        for (const b of next.ids)
        {
          const index = linkCount++;

          if (link.invisible)
          {
            invisible++;
            continue;
          }

          edges.push({ from: a, to: b, label: link.label || "", link: link, index: index, line: st.line });
        }
      }

      g = next;
      j = next.end;
    }
  }

  // A preview of text still streaming in: the open subgraphs close here.
  if (stack.length > 0 && !head.partial)
  {
    const open = stack[stack.length - 1];

    return { error: syntaxError(ERR, open.line, "subgraph " + open.label, "the subgraph \"" + open.label + "\" has no `end`.",
      "close every subgraph with a line `end`.") };
  }

  // Edges to a subgraph: its id was read as a node.
  for (const g of groups)
  {
    const n = nodes.get(g.id);

    if (n != null && n.shape == null && n.label == null)
    {
      nodes.delete(g.id);
    }
    else if (n != null)
    {
      const old = g.id;

      g.id = "group_" + old;
      groupById.set(g.id, g);
      groups.forEach(function(o) { if (o.parent === old) { o.parent = g.id; } });
      nodes.forEach(function(x) { if (x.group === old) { x.group = g.id; } });
    }
  }

  // A node's group: the innermost subgraph it was first named in. Nodes in
  // a subgraph that holds only other subgraphs keep the nesting.
  const incoming = new Map();
  const outgoing = new Map();

  edges.forEach(function(e)
  {
    incoming.set(e.to, (incoming.get(e.to) || 0) + 1);
    outgoing.set(e.from, (outgoing.get(e.from) || 0) + 1);
  });

  const defaultClass = classDefs.get("default") || "";
  const specNodes = [];
  const unknownClasses = new Set();

  nodes.forEach(function(n)
  {
    const shape = SHAPE_STYLE[n.shape || "rect"] || SHAPE_STYLE.rect;
    let kind = shape.kind;

    if (kind === "terminal")
    {
      kind = !incoming.has(n.id) ? "start" : (!outgoing.has(n.id) ? "end" : "step");
    }

    let style = shape.style + (kind === "step" && n.shape === "stadium" ? "arcSize=50;" : "") + defaultClass;

    (nodeClasses.get(n.id) || []).forEach(function(c)
    {
      if (classDefs.has(c))
      {
        style += classDefs.get(c);
      }
      else
      {
        unknownClasses.add(c);
      }
    });

    style += nodeStyles.get(n.id) || "";

    specNodes.push({ id: n.id, label: plainLabel(unquote(n.label != null ? n.label : n.id)) || " ", kind: kind,
      group: n.group || "", style: style });
  });

  nodeStyles.forEach(function(v, id)
  {
    if (!nodes.has(id) && !groupById.has(id))
    {
      warnings.push("`style " + id + "` names no node.");
    }
  });

  if (unknownClasses.size > 0)
  {
    warnings.push("No classDef for the class" + (unknownClasses.size > 1 ? "es " : " ") + listText(Array.from(unknownClasses)) +
      "; those nodes keep the default colors.");
  }

  const specEdges = edges.map(function(e)
  {
    const extraStyle = (linkStyles.get("default") || "") + (linkStyles.get(String(e.index)) || "");

    return { from: e.from, to: e.to, label: e.label, style: linkStyle(e.link) + extraStyle };
  });

  if (invisible > 0)
  {
    warnings.push("Left out " + invisible + " invisible link" + (invisible > 1 ? "s" : "") + " (`~~~`): they only " +
      "position nodes in Mermaid, and the server lays the diagram out itself.");
  }

  if (clicks.length > 0)
  {
    warnings.push("Not converted: the click actions on " + listText(clicks) + ".");
  }

  if (direction === "BT" || direction === "RL")
  {
    warnings.push("The direction " + direction + " is drawn " + (direction === "BT" ? "top-down (TB)" : "left to right (LR)") + ".");
  }

  notes.forEach(function(n) { warnings.push(n); });

  if (specNodes.length === 0)
  {
    return { error: "The Mermaid flowchart has no nodes. Add nodes and links after the header, e.g. `A[Start] --> B[Next]`." };
  }

  const spec =
  {
    type: "flowchart",
    title: head.title,
    direction: (direction === "LR" || direction === "RL") ? "horizontal" : "vertical",
    groups: groups.map(function(g) { return { id: g.id, label: g.label, kind: "subgraph", parent: g.parent }; }),
    nodes: specNodes,
    edges: specEdges
  };

  return { spec: spec, warnings: warnings, stats: { nodes: specNodes.length, edges: specEdges.length, groups: groups.length } };
}

// ─── ER diagram ─────────────────────────────────────────────────

// Crow's foot ends → multiplicities (left end, right end)
const ER_LEFT = { "|o": "0..1", "||": "1", "}o": "0..*", "}|": "1..*" };
const ER_RIGHT = { "o|": "0..1", "||": "1", "o{": "0..*", "|{": "1..*" };
const ER_WORDS =
{
  "zero or one": "0..1", "one or zero": "0..1", "exactly one": "1", "only one": "1", "one or more": "1..*",
  "one or many": "1..*", "many(1)": "1..*", "1+": "1..*", "zero or more": "0..*", "zero or many": "0..*",
  "many(0)": "0..*", "0+": "0..*", "one": "1", "1": "1", "many": "0..*"
};

/**
 * Parses a Mermaid ER diagram into a semantic ER description.
 *
 * @param {object} head - readHeader's result
 * @returns {{spec: object, warnings: string[], stats: object}|{error: string}}
 */
export function parseErDiagram(head)
{
  const warnings = [];
  const entities = new Map();
  const edges = [];
  const list = statements(head.body);
  let open = null;
  let openAt = null;
  let direction = "";
  let styled = false;

  function entity(name, line)
  {
    const m = /^([\p{L}\p{N}_-]+)(?:\s*\[\s*"?([^"\]]*)"?\s*\])?$/u.exec(name.trim());
    const id = m != null ? m[1] : unquote(name.trim());
    let e = entities.get(id);

    if (e == null)
    {
      e = { id: id, label: id, fields: [], line: line };
      entities.set(id, e);
    }

    if (m != null && m[2] != null && m[2].trim() !== "")
    {
      e.label = m[2].trim();
    }

    return e;
  }

  for (const st of list)
  {
    const s = st.text;
    let m;

    if (open != null)
    {
      if (s === "}")
      {
        open = null;
        continue;
      }

      // type name [PK, FK, UK] ["comment"]
      const a = /^([\w\-\[\]()<>,.~*]+)\s+([\w\-*]+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?\s*$/i.exec(s);

      if (a == null)
      {
        return { error: syntaxError(ERR, st.line, st.raw, "this is not an attribute of " + open.id + ".",
          "write one attribute per line as `type name`, optionally followed by keys and a comment: `int id PK \"comment\"`, " +
          "and close the entity with `}`.") };
      }

      const keys = (a[3] || "").toUpperCase().replace(/\s+/g, "");

      open.fields.push((keys !== "" ? keys.replace(/,/g, ", ") + " " : "") + a[2] + ": " + a[1]);
      continue;
    }

    if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(s)) != null)
    {
      direction = /LR|RL/i.test(m[1]) ? "horizontal" : "vertical";
      continue;
    }

    if (/^(classDef|class|style)\b/.test(s) || /:::/.test(s))
    {
      styled = true;

      if (!/:::/.test(s))
      {
        continue;
      }
    }

    // ENTITY {   or   ENTITY { attr }   (one line)
    if ((m = /^([^{}]+?)\s*\{\s*(.*)$/.exec(s)) != null && !/--|\.\./.test(m[1]))
    {
      const e = entity(m[1].replace(/:::[\w-]+/, ""), st.line);
      const rest = m[2].trim();

      if (rest === "}" )
      {
        continue;
      }

      if (rest.endsWith("}"))
      {
        rest.slice(0, -1).split(/\s*,\s*|\s{2,}/).forEach(function(f)
        {
          const p = f.trim().split(/\s+/);

          if (p.length >= 2)
          {
            e.fields.push(p[1] + ": " + p[0]);
          }
        });
        continue;
      }

      open = e;
      openAt = st;
      continue;
    }

    // A ||--o{ B : label
    const rel = /^(.+?)\s*([|}][|o])(--|\.\.)([|o][|{])\s*(.+?)\s*:\s*(.*)$/.exec(s) ||
      /^(.+?)\s*([|}][|o])(--|\.\.)([|o][|{])\s*([^\s:]+)\s*$/.exec(s);

    if (rel == null && /[|}][|o](--|\.\.)[|o][|{]\s*\S+\s+\S/.test(s))
    {
      return { error: syntaxError(ERR, st.line, st.raw, "the relationship has no `:` before its label.",
        "write it as `CUSTOMER ||--o{ ORDER : places`.") };
    }

    if (rel != null)
    {
      const a = entity(rel[1].replace(/:::[\w-]+/, ""), st.line);
      const b = entity(rel[5].replace(/:::[\w-]+/, ""), st.line);
      const left = ER_LEFT[rel[2]];
      const right = ER_RIGHT[rel[4]];

      if (left == null || right == null)
      {
        return { error: syntaxError(ERR, st.line, st.raw, "`" + rel[2] + rel[3] + rel[4] + "` is not a relationship.",
          "use crow's foot ends such as `||--o{` (one to zero or more), `|o--||` or `}|..|{`.") };
      }

      edges.push({ from: a.id, to: b.id, fromCard: left, toCard: right, label: plainLabel(unquote(rel[6] || "")),
        dashed: rel[3] === ".." });
      continue;
    }

    // A one or more to zero or many B : label
    const words = /^(\S+)\s+(.+?)\s+(to|optionally to)\s+(.+?)\s+(\S+)\s*:\s*(.*)$/.exec(s);

    if (words != null && ER_WORDS[words[2].toLowerCase()] != null && ER_WORDS[words[4].toLowerCase()] != null)
    {
      const a = entity(words[1], st.line);
      const b = entity(words[5], st.line);

      edges.push({ from: a.id, to: b.id, fromCard: ER_WORDS[words[2].toLowerCase()], toCard: ER_WORDS[words[4].toLowerCase()],
        label: plainLabel(unquote(words[6])), dashed: words[3] !== "to" });
      continue;
    }

    // A lone entity name
    if (/^[\p{L}\p{N}_-]+(\s*\[.*\])?$/u.test(s))
    {
      entity(s, st.line);
      continue;
    }

    if (/^title\b/.test(s))
    {
      continue;
    }

    return { error: syntaxError(ERR, st.line, st.raw, "this is not an entity or a relationship.",
      "write relationships as `CUSTOMER ||--o{ ORDER : places` and entities as `CUSTOMER { string name }`.") };
  }

  if (open != null && !head.partial)
  {
    return { error: syntaxError(ERR, openAt.line, openAt.raw, "the entity " + open.id + " has no closing `}`.",
      "close its attribute list with a line `}`.") };
  }

  if (entities.size === 0)
  {
    return { error: "The Mermaid ER diagram has no entities. Add relationships such as `CUSTOMER ||--o{ ORDER : places`." };
  }

  if (styled)
  {
    warnings.push("The classes and styles of the ER diagram are not converted; tables take draw.io's calm colors.");
  }

  const labeled = edges.filter(function(e) { return e.label !== ""; });
  const spec =
  {
    type: "er",
    title: head.title,
    direction: direction,
    nodes: Array.from(entities.values()).map(function(e) { return { id: e.id, label: e.label, fields: e.fields }; }),
    edges: edges.map(function(e) { return { from: e.from, to: e.to, fromCard: e.fromCard, toCard: e.toCard }; })
  };

  return { spec: spec, warnings: warnings, labels: labeled,
    stats: { nodes: entities.size, edges: edges.length, groups: 0 } };
}

// ─── Sequence diagram ───────────────────────────────────────────

// CSS color names a `box` may start with
const CSS_COLORS = /^(aqua|aquamarine|azure|beige|bisque|black|blue|brown|coral|cornsilk|cyan|gold|gray|grey|green|honeydew|ivory|khaki|lavender|lavenderblush|lemonchiffon|light[a-z]+|lime|linen|magenta|maroon|mintcream|mistyrose|moccasin|navy|oldlace|olive|orange|orchid|pale[a-z]+|peachpuff|pink|plum|purple|red|salmon|seashell|silver|snow|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow)$/i;

const PARTICIPANT_KINDS = /^(participant|actor|boundary|control|entity|database|collections|queue)$/;

/**
 * Parses a Mermaid sequence diagram into the sequence model of sequence.js.
 *
 * @param {object} head - readHeader's result
 * @returns {{model: object, warnings: string[], stats: object}|{error: string}}
 */
export function parseSequence(head)
{
  const warnings = [];
  const participants = [];
  const byId = new Map();
  const events = [];
  const blocks = [];
  const boxes = [];
  let box = null;
  let title = head.title;
  let autonumber = false;
  let pendingCreate = null;
  const list = statements(head.body.map(function(l)
  {
    // a message's text may hold `;`, which statements() would split
    return { text: l.text.replace(/;/g, "\u0000"), line: l.line };
  })).map(function(st)
  {
    return { text: st.text.replace(/\u0000/g, ";"), line: st.line, raw: st.raw.replace(/\u0000/g, ";") };
  });

  function participant(id, label, kind, line)
  {
    let p = byId.get(id);

    if (p == null)
    {
      p = { id: id, label: label || id, kind: kind || "participant", line: line, created: false };
      participants.push(p);
      byId.set(id, p);

      if (box != null)
      {
        box.members.push(id);
      }
    }
    else if (label != null)
    {
      p.label = label;
    }

    if (kind != null)
    {
      p.kind = kind;
    }

    return p;
  }

  for (const st of list)
  {
    const s = st.text;
    let m;

    if ((m = /^title\s*:?\s*(.*)$/.exec(s)) != null)
    {
      title = plainLabel(m[1]);
      continue;
    }

    if (/^autonumber\b/.test(s))
    {
      autonumber = !/\boff\b/.test(s);
      continue;
    }

    if ((m = /^(create\s+)?(participant|actor)\s+(.+)$/.exec(s)) != null)
    {
      let rest = m[3].trim();
      let kind = m[2];
      let label = null;
      const props = /@\{(.*)\}\s*$/.exec(rest);

      if (props != null)
      {
        const t = /"?type"?\s*:\s*"?(\w+)"?/.exec(props[1]);

        if (t != null && PARTICIPANT_KINDS.test(t[1].toLowerCase()))
        {
          kind = t[1].toLowerCase();
        }

        rest = rest.substring(0, props.index).trim();
      }

      const as = /^(.+?)\s+as\s+(.+)$/.exec(rest);
      const id = as != null ? as[1].trim() : rest;

      if (as != null)
      {
        label = plainLabel(unquote(as[2]));
      }

      const p = participant(unquote(id), label != null ? label : plainLabel(unquote(id)), kind, st.line);

      if (m[1] != null)
      {
        pendingCreate = p.id;
      }

      continue;
    }

    if ((m = /^destroy\s+(.+)$/.exec(s)) != null)
    {
      events.push({ type: "destroy", id: m[1].trim(), line: st.line });
      continue;
    }

    if ((m = /^box\b\s*(.*)$/.exec(s)) != null)
    {
      // box [color] [label]: the color first, when the first word is one
      const rest = m[1].trim();
      const c = /^(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}\b|transparent\b|[a-z]+(?=\s|$))\s*(.*)$/i.exec(rest);
      const isColor = c != null && (/^(rgb|hsl|#|transparent)/i.test(c[1]) || CSS_COLORS.test(c[1]));

      box = { color: isColor ? (c[1].toLowerCase() === "transparent" ? "" : c[1]) : "", label: plainLabel(isColor ? c[2] : rest),
        members: [], line: st.line };
      boxes.push(box);
      continue;
    }

    if ((m = /^(activate|deactivate)\s+(.+)$/.exec(s)) != null)
    {
      const id = m[2].trim();

      if (!byId.has(id))
      {
        participant(id, id, null, st.line);
      }

      events.push({ type: m[1], id: id, line: st.line });
      continue;
    }

    if ((m = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i.exec(s)) != null)
    {
      const ids = m[2].split(",").map(function(x) { return x.trim(); });

      ids.forEach(function(id)
      {
        if (!byId.has(id))
        {
          participant(id, id, null, st.line);
        }
      });

      events.push({ type: "note", side: m[1].toLowerCase().split(" ")[0], ids: ids, text: plainLabel(m[3]), line: st.line });
      continue;
    }

    if ((m = /^(loop|alt|opt|par|critical|break|rect)\b\s*(.*)$/.exec(s)) != null)
    {
      const b = { kind: m[1], line: st.line, raw: st.raw };

      blocks.push(b);
      events.push({ type: "start", kind: m[1], label: m[1] === "rect" ? "" : plainLabel(m[2]),
        color: m[1] === "rect" ? m[2].trim() : "", line: st.line });
      continue;
    }

    if ((m = /^(else|and|option)\b\s*(.*)$/.exec(s)) != null)
    {
      if (blocks.length === 0)
      {
        return { error: syntaxError(ERR, st.line, st.raw, "`" + m[1] + "` is outside any `alt`, `par` or `critical` block.",
          "put it between `alt …` and its `end`.") };
      }

      events.push({ type: "else", label: plainLabel(m[2]), line: st.line });
      continue;
    }

    if (s === "end")
    {
      if (box != null && blocks.length === 0)
      {
        box = null;
        continue;
      }

      if (blocks.length === 0)
      {
        return { error: syntaxError(ERR, st.line, st.raw, "`end` closes no block.",
          "remove it, or open a block with `loop`, `alt`, `opt`, `par`, `critical`, `break` or `rect` before it.") };
      }

      blocks.pop();
      events.push({ type: "end", line: st.line });
      continue;
    }

    if ((m = /^links?\s+|^properties\s+|^details\s+/.exec(s)) != null)
    {
      continue;
    }

    // A message: A->>B: text, with + / - for activation
    m = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\))\s*([+-]?)\s*(.+?)\s*:(.*)$/.exec(s) ||
      /^(.+?)\s*(<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\))\s*([+-]?)\s*([^:\s]+)\s*$/.exec(s);

    if (m == null && /(-->>|->>|-->|->|--x|-x|--\)|-\))\s*[+-]?\s*\S+\s+\S/.test(s))
    {
      return { error: syntaxError(ERR, st.line, st.raw, "the message has no `:` before its text.",
        "write it as `Alice->>Bob: text`.") };
    }

    if (m != null)
    {
      let from = m[1].trim();
      let to = m[4].trim();
      const arrow = m[2];

      if (from.endsWith("+") || from.endsWith("-"))
      {
        from = from.slice(0, -1).trim();
      }

      [from, to].forEach(function(id)
      {
        if (!byId.has(id))
        {
          participant(id, id, null, st.line);
        }
      });

      if (pendingCreate != null && (to === pendingCreate || from === pendingCreate))
      {
        byId.get(pendingCreate).created = true;
        events.push({ type: "create", id: pendingCreate, line: st.line });
        pendingCreate = null;
      }

      events.push({
        type: "message", from: from, to: to, label: plainLabel(m[5] != null ? m[5] : ""),
        dotted: arrow.indexOf("--") >= 0,
        head: /x$/.test(arrow) ? "cross" : (/\)$/.test(arrow) ? "async" : (/>>$/.test(arrow) ? "block" : "none")),
        both: arrow.startsWith("<<"),
        activate: m[3] === "+", deactivate: m[3] === "-", line: st.line
      });
      continue;
    }

    if (/^(sequenceDiagram|participant|actor)$/.test(s))
    {
      continue;
    }

    return { error: syntaxError(ERR, st.line, st.raw, "this is not a message, a participant, a note or a block.",
      "write messages as `Alice->>Bob: Hello` (the text after `:`), notes as `Note right of Alice: text`, and close " +
      "every `loop`, `alt`, `opt`, `par` or `rect` with `end`.") };
  }

  // A preview of text still streaming in: the open blocks end here.
  while (blocks.length > 0 && head.partial)
  {
    blocks.pop();
    events.push({ type: "end", line: 0 });
  }

  if (blocks.length > 0)
  {
    const b = blocks[blocks.length - 1];

    return { error: syntaxError(ERR, b.line, b.raw, "the `" + b.kind + "` block has no `end`.", "close it with a line `end`.") };
  }

  if (participants.length === 0)
  {
    return { error: "The Mermaid sequence diagram has no participants or messages. Add messages such as `Alice->>Bob: Hello`." };
  }

  const messages = events.filter(function(e) { return e.type === "message"; }).length;

  return {
    model: { title: title, participants: participants, events: events, boxes: boxes, autonumber: autonumber },
    warnings: warnings,
    stats: { nodes: participants.length, edges: messages, groups: boxes.length }
  };
}
