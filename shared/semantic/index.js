// Semantic diagrams: the model describes what a diagram contains (nodes,
// groups, edges, a direction), never coordinates or styles, and this engine
// turns that into draw.io XML: deterministic, headless (no DOM), the same in
// the Cloudflare Worker, Node and the browser. Format: FORMAT.md.
//
// ER schemas have a layout of their own (er.js, with the grid placement and
// channel routing of grid.js). Architecture, network, flowchart and swimlane
// diagrams become compact XML without geometry (boxes.js) and are placed by
// the grid layout pass over the draw.io model (shared/grid-layout.js), which
// the XML path can use as well. ELK is optional and passed in rather than
// imported, so every host brings its own copy (elkjs from npm in Node and the
// Worker, the global ELK in the browser); ER uses it only for schemas too
// large for the grid.

import { normalizeSpec, TYPES } from "./spec.js";
import { writeModel } from "./xml-writer.js";
import { layoutEr } from "./er.js";
import { layoutArchitecture, layoutFlow } from "./boxes.js";
import { expandDiagramShorthand } from "../diagram-shorthand.js";
import { encodeKeep, decodeKeep } from "./keep.js";

const LAYOUTS =
{
  er: { layout: layoutEr, needsElk: false },
  architecture: { layout: layoutArchitecture, needsElk: false },
  network: { layout: layoutArchitecture, needsElk: false },
  flowchart: { layout: layoutFlow, needsElk: false },
  swimlane: { layout: layoutFlow, needsElk: false }
};

export { TYPES };

/**
 * The size rule: the most nodes a type is drawn with from a description when
 * the caller has another way to draw the diagram (`sizeRule` below). Blind
 * judgements of architecture diagrams went against the description above it:
 * the two held-out prompts of 23 to 28 nodes (nested cloud boundaries) won
 * none of 24 against XML the model placed itself, the four of 11 to 14 nodes
 * 20 of 48. Over all prompts, the descriptions of the normal ones had 10 to
 * 17 nodes, those of the large ones 23 to 32 (bench/README.md).
 */
export const MAX_NODES = { architecture: 18, network: 18 };

/** The types this engine lays out (the rest of TYPES is planned). */
export const SUPPORTED_TYPES = Object.keys(LAYOUTS);

function now()
{
  return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
}

/**
 * Turns a semantic description into draw.io XML.
 *
 * @param {object|string} input - the description (FORMAT.md) or its JSON text
 * @param {{elk?: {layout: function(object): Promise<object>}, hints?: boolean|"ask"}} [options] -
 *   elk: an optional ELK instance (`new ELK()` from elkjs, or the global ELK
 *   in the browser), used for large schemas; hints: false ignores the
 *   placement hints (row, col) of the description, "ask" reads them as the
 *   cells of one grid for the whole diagram (what the description asks for
 *   with describeTool's "ask"), anything else as cells in each group's grid;
 *   sizeRule: true refuses a diagram with more nodes than MAX_NODES allows
 *   for its type (the error says so, and `tooLarge` has the numbers), for a
 *   caller whose model can draw the diagram another way
 * @returns {Promise<{xml: string|null, error: string|null, warnings: string[],
 *   stats: object|null, tooLarge?: {type: string, nodes: number, max: number}}>}
 */
export async function semanticToXml(input, options)
{
  const t0 = now();
  const opts = options || {};
  const n = normalizeSpec(input, { hints: opts.hints !== false });

  if (n.error != null)
  {
    return { xml: null, error: n.error, warnings: n.warnings, stats: null };
  }

  const d = n.diagram;
  const entry = LAYOUTS[d.type];

  if (entry == null)
  {
    return { xml: null, warnings: n.warnings, stats: null,
      error: "The type \"" + d.type + "\" can't be drawn from a description yet (only " + SUPPORTED_TYPES.join(", ") +
        "). Draw it as draw.io XML or Mermaid instead." };
  }

  if (d.nodes.length === 0)
  {
    return { xml: null, error: "The diagram has no nodes.", warnings: n.warnings, stats: null };
  }

  if (opts.sizeRule === true && MAX_NODES[d.type] != null && d.nodes.length > MAX_NODES[d.type])
  {
    return { xml: null, warnings: n.warnings, stats: null,
      tooLarge: { type: d.type, nodes: d.nodes.length, max: MAX_NODES[d.type] },
      error: "This " + d.type + " diagram has " + d.nodes.length + " nodes; from a description, " + d.type +
        " diagrams are drawn with up to " + MAX_NODES[d.type] + "." };
  }

  if (entry.needsElk && (opts.elk == null || typeof opts.elk.layout !== "function"))
  {
    return { xml: null, error: "No layout engine (ELK) is available here.", warnings: n.warnings, stats: null };
  }

  // A change: the layout of the diagram before it (keep.js), from the result
  // of the earlier call. One that can't be read is left out with a warning,
  // and the diagram is laid out anew.
  const hints = opts.hints === "ask" ? "ask" : opts.hints !== false;
  const kept = (hints === "ask") ? decodeKeep(d.layout, d) : { keep: null, error: null };
  const warnings = n.warnings.slice();

  if (kept.error != null)
  {
    warnings.push("The layout \"" + d.layout.slice(0, 40) + (d.layout.length > 40 ? "…" : "") + "\" was not used (" +
      kept.error + "); the diagram was laid out anew. On a change, pass the layout of the last result as it is.");
  }

  const r = await entry.layout(d, { elk: opts.elk, hints: hints, route: opts.route !== false, keep: kept.keep });
  // er.js writes tables in the shorthand the app server expands; boxes.js
  // returns XML that went through that expansion already
  const xml = (r.xml != null) ? r.xml : expandDiagramShorthand(writeModel(r.cells)).xml;
  const stats = Object.assign({ type: d.type, width: Math.round(r.width), height: Math.round(r.height),
    ms: Math.round((now() - t0) * 10) / 10 }, r.stats);
  // What a change of this diagram keeps, for the next call
  const layout = (r.keep != null) ? encodeKeep(r.keep, { type: d.type, title: d.title, font: r.font }) : null;

  return { xml: xml, error: null, warnings: warnings.concat(r.warnings || []), stats: stats, layout: layout };
}
