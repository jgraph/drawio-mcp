// What a session produced: the diagram files in its working folder, a
// diagram in its final answer, and the diagram it sent to a draw.io MCP
// server; which of them is the diagram (the primary); and what can be read
// out of draw.io XML without drawing it (shapes, labels, connectors and
// whether they are attached).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { transformPages } from "../../../shared/mx-xml.js";

/** The formats, as the report names them. */
export const FORMAT_NAMES =
{
  "drawio-mcp": "draw.io (MCP)",
  drawio: "draw.io file",
  mermaid: "Mermaid file",
  "mermaid-md": "Mermaid in Markdown",
  "mermaid-answer": "Mermaid in the answer",
  svg: "SVG",
  html: "HTML",
  image: "PNG or other image",
  dot: "Graphviz DOT",
  "dot-answer": "Graphviz DOT in the answer",
  plantuml: "PlantUML",
  "plantuml-answer": "PlantUML in the answer",
  d2: "D2",
  excalidraw: "Excalidraw",
  pdf: "PDF",
  "text-md": "text art in Markdown",
  "text-answer": "text art in the answer",
  none: "no diagram"
};

// The order in which a session's outputs count as its diagram: what went to
// a diagram tool, then sources over renderings, then the answer.
const PRIORITY = ["drawio-mcp", "drawio", "mermaid", "mermaid-md", "dot", "plantuml", "d2", "excalidraw", "svg", "html",
  "image", "pdf", "text-md", "mermaid-answer", "dot-answer", "plantuml-answer", "text-answer"];

// The file a format condition asked for.
const ASKED = { mermaid: "diagram.mmd", svg: "diagram.svg", drawio: "diagram.drawio" };

const BOX_CHARS = /[─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬▼▲►◄▶◀→←↓↑]/;

function fences(text)
{
  const out = [];
  const re = /```([\w+-]*)[^\n]*\n([\s\S]*?)```/g;
  let m;

  while ((m = re.exec(text || "")) != null)
  {
    out.push({ lang: m[1].toLowerCase(), body: m[2] });
  }

  return out;
}

// A block of text art: at least three lines with box-drawing characters or
// ASCII boxes and arrows.
function isTextArt(body)
{
  const rows = body.split("\n").filter(function(l)
  {
    return BOX_CHARS.test(l) || /\+-{2,}|-{2,}>|<-{2,}|\|\s.*\s\|/.test(l);
  });

  return rows.length >= 3;
}

/** The diagram kind of a file, or null when it is not a diagram. */
export function kindOfFile(file)
{
  const lower = file.toLowerCase();

  if (/\.(drawio|dio)$/.test(lower) || /\.drawio\.xml$/.test(lower))
  {
    return "drawio";
  }

  if (/\.svg$/.test(lower))
  {
    return "svg";
  }

  if (/\.(mmd|mermaid)$/.test(lower))
  {
    return "mermaid";
  }

  if (/\.html?$/.test(lower))
  {
    return "html";
  }

  if (/\.(png|jpe?g|webp|gif)$/.test(lower))
  {
    return "image";
  }

  if (/\.(dot|gv)$/.test(lower))
  {
    return "dot";
  }

  if (/\.(puml|plantuml|pu|iuml)$/.test(lower))
  {
    return "plantuml";
  }

  if (/\.d2$/.test(lower))
  {
    return "d2";
  }

  if (/\.excalidraw$/.test(lower))
  {
    return "excalidraw";
  }

  if (/\.pdf$/.test(lower))
  {
    return "pdf";
  }

  return null;
}

/**
 * Every diagram output of a session: { kind, from ("mcp" | "file" |
 * "answer"), file?, text?, secs? }.
 */
export function outputsOf(summary, workdir)
{
  const list = [];

  if (summary.diagramTool != null)
  {
    list.push({ kind: "drawio-mcp", from: "mcp", secs: summary.diagramCallSecs });
  }

  for (const f of summary.files || [])
  {
    const abs = path.join(workdir, f.path);
    let kind = kindOfFile(f.path);

    if (kind == null && /\.(md|markdown|txt)$/i.test(f.path) && fs.existsSync(abs))
    {
      const text = fs.readFileSync(abs, "utf8");
      const blocks = fences(text);

      if (blocks.some(function(b) { return b.lang === "mermaid"; }))
      {
        kind = "mermaid-md";
      }
      else if (blocks.some(function(b) { return isTextArt(b.body); }) || (/\.txt$/i.test(f.path) && isTextArt(text)))
      {
        kind = "text-md";
      }
    }
    else if (kind == null && /\.xml$/i.test(f.path) && fs.existsSync(abs) &&
      /<mxGraphModel|<mxfile/.test(fs.readFileSync(abs, "utf8")))
    {
      kind = "drawio";
    }

    if (kind != null && fs.existsSync(abs))
    {
      list.push({ kind: kind, from: "file", file: f.path, bytes: f.bytes, secs: f.lastSecs });
    }
  }

  for (const b of fences(summary.finalText))
  {
    if (b.lang === "mermaid")
    {
      list.push({ kind: "mermaid-answer", from: "answer", text: b.body });
    }
    else if (b.lang === "dot" || b.lang === "graphviz")
    {
      list.push({ kind: "dot-answer", from: "answer", text: b.body });
    }
    else if (b.lang === "plantuml" || b.lang === "puml")
    {
      list.push({ kind: "plantuml-answer", from: "answer", text: b.body });
    }
    else if (isTextArt(b.body))
    {
      list.push({ kind: "text-answer", from: "answer", text: b.body });
    }
  }

  return list;
}

/** The diagram of a session: the output asked for, else the first by PRIORITY. */
export function primaryOf(condition, outputs)
{
  const asked = ASKED[condition];

  if (asked != null)
  {
    const hit = outputs.find(function(o) { return o.file === asked; });

    if (hit != null)
    {
      return hit;
    }
  }

  for (const kind of PRIORITY)
  {
    const of = outputs.filter(function(o) { return o.kind === kind; });

    if (of.length > 0)
    {
      // the largest file, or the longest block in the answer
      return of.sort(function(a, b) { return (b.bytes || (b.text || "").length) - (a.bytes || (a.text || "").length); })[0];
    }
  }

  return { kind: "none", from: null };
}

function plain(value)
{
  return String(value == null ? "" : value).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * What draw.io XML holds, read without drawing it (first page): the shapes
 * (vertices that are not groups or plain text), the labels and how many of
 * them belong to a shape (a shape's own label, or a text cell inside a
 * shape, such as a table's row; not a text cell on the page), the connectors
 * (edges) and how many have both ends attached to a shape.
 */
export function drawioStructure(xml)
{
  let r = null;

  try
  {
    transformPages(String(xml || ""), function(graph)
    {
      if (r != null)
      {
        return;
      }

      const cells = [];

      (function walk(c)
      {
        cells.push(c);

        for (const ch of c.children)
        {
          walk(ch);
        }
      })(graph.getModel().root);

      const vertices = cells.filter(function(c) { return c.vertex; });
      const edges = cells.filter(function(c) { return c.edge; });
      const isText = function(c) { return /(^|;)text;|(^|;)edgeLabel;/.test(c.style || "") || /^text(;|$)/.test(c.style || ""); };
      const edgeChild = function(c) { return c.parent != null && c.parent.edge; };
      const labeled = vertices.filter(function(c) { return plain(c.value) !== "" && !edgeChild(c); });
      // a text cell inside a shape (a table's row, a container's title) moves with it
      const loose = labeled.filter(function(c) { return isText(c) && !(c.parent != null && c.parent.vertex); });
      const shapes = vertices.filter(function(c) { return !isText(c) && !edgeChild(c) && !/(^|;)group(;|$)/.test(c.style || ""); });
      const attached = edges.filter(function(e) { return e.source != null && e.target != null && e.source.vertex && e.target.vertex; });

      r = { shapes: shapes.length, labels: labeled.length, labelsInShapes: labeled.length - loose.length,
        connectors: edges.length, attached: attached.length };
    });
  }
  catch (e)
  {
    return null;
  }

  return r;
}

/**
 * The first page of a draw.io file as an mxGraphModel, as draw.io opens it:
 * an mxGraphModel as it is, the first page of an mxfile, a compressed page
 * inflated. Null when there is none.
 */
export function firstModel(xml)
{
  const text = String(xml || "");
  const m = /<mxGraphModel\b[\s\S]*?<\/mxGraphModel>/.exec(text);

  if (m != null)
  {
    return m[0];
  }

  const d = /<diagram\b[^>]*>([^<]+)<\/diagram>/.exec(text);

  if (d == null)
  {
    return null;
  }

  try
  {
    return decodeURIComponent(zlib.inflateRawSync(Buffer.from(d[1].trim(), "base64")).toString("latin1"));
  }
  catch (e)
  {
    return null;
  }
}
