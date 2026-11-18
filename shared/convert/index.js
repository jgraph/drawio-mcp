// Diagram source → draw.io cells on the server: Mermaid, PlantUML and
// draw.io CSV are read here and drawn as editable draw.io XML, laid out and
// styled (the calm theme of shared/semantic), with every syntax error
// reported by line and what the conversion leaves out listed as a warning.
// A diagram type this module doesn't read is answered with `fallback`, and
// the caller hands the source to draw.io's own converter (the app server's
// viewer). Headless and deterministic: the Worker, Node and the browser.

import { semanticToXml } from "../semantic/index.js";
import { readHeader, parseFlowchart, parseErDiagram, parseSequence, SERVER_TYPES } from "./mermaid.js";
import { sequenceToXml } from "./sequence.js";
import { convertPlantUml, plantUmlConverts } from "./plantuml.js";
import { convertCsv, csvConverts } from "./csv.js";

export const MERMAID_SERVER_TYPES = SERVER_TYPES;

/**
 * The formats this module converts.
 */
export const FORMATS = ["mermaid", "plantuml", "csv"];

/**
 * Whether this module converts the diagram (a type it reads), rather than
 * answering with `fallback`: decided by the header alone, so the viewer can
 * pick its preview from the first lines of a diagram still streaming in.
 *
 * @param {string} format
 * @param {string} text
 * @returns {boolean}
 */
export function serverConverts(format, text)
{
  if (format === "mermaid")
  {
    const head = readHeader(text);

    return head.error == null && SERVER_TYPES.indexOf(head.type) >= 0;
  }

  if (format === "plantuml")
  {
    return plantUmlConverts(text);
  }

  return format === "csv" && csvConverts(text);
}

/**
 * Converts a diagram source to draw.io XML.
 *
 * @param {"mermaid"|"plantuml"|"csv"} format
 * @param {string} text
 * @param {{elk?: object, partial?: boolean}} [options] - elk: an ELK
 *   instance for large ER schemas (shared/semantic); partial: the text is
 *   still streaming in (the viewer's preview), so what is still open at its
 *   end (a subgraph, an entity, a block) is closed there
 * @returns {Promise<{xml: string, type: string, warnings: string[], stats: object, direction?: string, elk?: boolean}|
 *   {error: string, type?: string}|{fallback: true, type: string, reason?: string}>}
 *   direction and elk: a Mermaid flowchart's flow ("vertical" or
 *   "horizontal") and whether its source asks for ELK (`flowchart-elk`,
 *   or `layout: elk` or `defaultRenderer: "elk"` in its config);
 *   reason: what in a CSV makes it draw.io's own import's
 *   fallback: a type this module doesn't convert, for draw.io's own converter
 */
export async function convertSource(format, text, options)
{
  const opts = options || {};

  if (format === "mermaid")
  {
    return convertMermaid(text, opts);
  }

  if (format === "plantuml")
  {
    const r = convertPlantUml(text, opts);

    if (r.semantic != null)
    {
      return drawSemantic(r.semantic, r.type, r.warnings, r.stats, opts);
    }

    if (r.sequence != null)
    {
      return drawSequence(r.sequence, r.type, r.warnings, r.stats);
    }

    return r;
  }

  if (format === "csv")
  {
    const r = convertCsv(text, opts);

    if (r.semantic != null)
    {
      const d = await drawSemantic(r.semantic, r.type, r.warnings, r.stats, opts);

      return (d.xml != null && r.finish != null) ? r.finish(d) : d;
    }

    if (r.xml != null)
    {
      // `layout: none`: placed by the converter itself
      return r.finish({ xml: r.xml, type: r.type, warnings: r.warnings, stats: r.stats });
    }

    return r;
  }

  return { error: "Unknown format \"" + format + "\"." };
}

async function convertMermaid(text, opts)
{
  const head = readHeader(text, { partial: opts.partial === true });

  if (head.error != null)
  {
    return { error: head.error };
  }

  head.partial = opts.partial === true;

  const type = head.type === "graph" || head.type === "flowchart-elk" ? "flowchart" : head.type;
  // ELK, as draw.io reads it: the flowchart-elk header, or `layout: elk` or
  // `defaultRenderer: "elk"` in the config (frontmatter, %%{init}%%)
  const elk = type === "flowchart" && (head.type === "flowchart-elk" || head.elk);
  const themed = head.themed || (head.elk && !elk) ? [(elk ? "Apart from the ELK layout, the" : "The") +
    " Mermaid theme and config (`%%{init}%%`, frontmatter `config`) are not used: the diagram " +
    "takes draw.io's calm colors, with the colors of its classDef and style lines."] : [];

  if (SERVER_TYPES.indexOf(head.type) < 0)
  {
    return { fallback: true, type: type };
  }

  if (type === "flowchart")
  {
    const r = parseFlowchart(head);

    if (r.error != null)
    {
      return r;
    }

    // the flow's direction, and whether the source asks for ELK, for a
    // caller that lays the cells out again with ELK (postLayout)
    const d = await drawSemantic(r.spec, type, themed.concat(r.warnings), r.stats, opts);

    return d.xml != null ? Object.assign(d, { direction: r.spec.direction, elk: elk }) : d;
  }

  if (type === "erdiagram")
  {
    const r = parseErDiagram(head);

    if (r.error != null)
    {
      return r;
    }

    const d = await drawSemantic(r.spec, "er", themed.concat(r.warnings), r.stats, opts);

    return d.xml != null ? labelRelations(d, r.labels) : d;
  }

  const r = parseSequence(head);

  return r.error != null ? r : drawSequence(r.model, "sequence", themed.concat(r.warnings), r.stats);
}

async function drawSemantic(spec, type, warnings, stats, opts)
{
  const r = await semanticToXml(spec, { hints: false, styles: true, elk: opts.elk });

  if (r.xml == null)
  {
    return { error: r.error, type: type };
  }

  return { xml: r.xml, type: type, warnings: warnings.concat(r.warnings || []),
    stats: Object.assign({}, stats, { width: r.stats.width, height: r.stats.height }) };
}

function drawSequence(model, type, warnings, stats)
{
  const r = sequenceToXml(model);

  return { xml: r.xml, type: type, warnings: warnings.concat(r.warnings),
    stats: Object.assign({}, stats, { width: r.stats.width, height: r.stats.height }) };
}

/**
 * The labels of an ER diagram's relationships on its lines (the engine
 * draws crow's feet only): each relation's line between the two tables
 * gets its label, in the order written.
 *
 * @param {{xml: string}} d
 * @param {Array<{from: string, to: string, label: string}>} labels
 */
function labelRelations(d, labels)
{
  if (labels == null || labels.length === 0)
  {
    return d;
  }

  const parentOf = new Map();
  const cellRe = /<mxCell\b[^>]*>/g;
  let m;

  while ((m = cellRe.exec(d.xml)) != null)
  {
    const id = /\bid="([^"]*)"/.exec(m[0]);
    const parent = /\bparent="([^"]*)"/.exec(m[0]);

    if (id != null && parent != null)
    {
      parentOf.set(unescape(id[1]), unescape(parent[1]));
    }
  }

  function table(id)
  {
    // a row's table, or the table itself
    const p = parentOf.get(id);

    return (p != null && p !== "1") ? p : id;
  }

  const pending = labels.slice();
  const xml = d.xml.replace(/<mxCell\b([^>]*\bedge="1"[^>]*)>/g, function(tag, attrs)
  {
    const s = /\bsource="([^"]*)"/.exec(attrs);
    const t = /\btarget="([^"]*)"/.exec(attrs);

    if (s == null || t == null || /\bvalue="[^"]/.test(attrs))
    {
      return tag;
    }

    const a = table(unescape(s[1]));
    const b = table(unescape(t[1]));
    const at = pending.findIndex(function(l) { return (l.from === a && l.to === b) || (l.from === b && l.to === a); });

    if (at < 0)
    {
      return tag;
    }

    const label = pending.splice(at, 1)[0].label;

    return "<mxCell value=\"" + escapeAttr(label) + "\"" + attrs + ">";
  });

  return Object.assign({}, d, { xml: xml });
}

function unescape(s)
{
  return s.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function escapeAttr(s)
{
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
