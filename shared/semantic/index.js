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
 * the caller has another way to draw the diagram (`sizeRule` below). The
 * limits stay on the server's side: the tool's description and its error
 * don't name them, so the model describes the whole diagram and the size of
 * that description decides. Blind
 * judgements of architecture diagrams went against the description above it:
 * the two held-out prompts of 23 to 28 nodes (nested cloud boundaries) won
 * none of 24 against XML the model placed itself, the four of 11 to 14 nodes
 * 20 of 48. Over all prompts, the descriptions of the normal ones had 10 to
 * 17 nodes, those of the large ones 23 to 32 (bench/README.md).
 */
export const MAX_NODES = { architecture: 18, network: 18 };

/**
 * The size rule for flowcharts without lanes (no node in a group): above
 * this, the large flowchart of the held-out prompts lost against XML the
 * model placed itself, Opus's 1 of 8 judgements under the floor of the
 * turn-on rule. Its descriptions had 25 to 34 nodes, those of the normal
 * one 17 to 21; on the dev prompts 16 to 21 (one of 27) and, for the large
 * one, 31 to 36. The prompts call 25 to 35 elements large (bench/README.md).
 * Lane diagrams of that size win, so they have no limit.
 */
export const MAX_NODES_WITHOUT_LANES = { flowchart: 24, swimlane: 24 };

/**
 * The size rule for a description read by normalizeSpec: the most nodes it
 * is drawn with, or null for no limit.
 *
 * @param {{type: string, nodes: Array<{group: string}>}} d
 * @param {boolean} pendingLanes - a node names a group the description
 *   doesn't declare yet, in a description still streaming in: it counts as
 *   in a lane, since the schema lists the groups after the nodes and a model
 *   may write them last
 * @returns {{max: number, lanes: boolean}|null} lanes: false for the rule
 *   of flowcharts without lanes
 */
function sizeLimit(d, pendingLanes)
{
  if (MAX_NODES[d.type] != null)
  {
    return { max: MAX_NODES[d.type], lanes: true };
  }

  const inLane = pendingLanes || d.nodes.some(function(n) { return n.group !== ""; });

  return (MAX_NODES_WITHOUT_LANES[d.type] != null && !inLane) ? { max: MAX_NODES_WITHOUT_LANES[d.type], lanes: false } : null;
}

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
 * @param {{elk?: {layout: function(object): Promise<object>}, hints?: boolean|"ask", route?: boolean,
 *   sizeRule?: boolean, partial?: boolean, keepTurned?: boolean}} [options] -
 *   elk: an optional ELK instance (`new ELK()` from elkjs, or the global ELK
 *   in the browser), used for large schemas; hints: false ignores the
 *   placement hints (row, col) of the description, "ask" reads them as the
 *   cells of one grid for the whole diagram (what the description asks for
 *   with describeTool's "ask"), anything else as cells in each group's grid;
 *   sizeRule: true refuses a diagram with more nodes than MAX_NODES allows
 *   for its type, or MAX_NODES_WITHOUT_LANES for a flowchart without lanes
 *   (the error says it is too large without naming the limit, and
 *   `tooLarge` has the numbers), for a caller whose model can draw the
 *   diagram another way; partial: true for a description still streaming
 *   in (the preview), where a node that names a group not declared yet
 *   counts as in a lane for the size rule, since the groups may come last;
 *   keepTurned: how a preview showed the diagram before (stats.turned),
 *   kept unless the other way round is clearly better (shared/grid-layout.js,
 *   KEEP_MARGIN)
 * @returns {Promise<{xml: string|null, error: string|null, warnings: string[],
 *   stats: object|null, tooLarge?: {type: string, nodes: number, max: number, lanes?: false}}>}
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

  const limit = (opts.sizeRule === true) ? sizeLimit(d, opts.partial === true && n.inUnknownGroup > 0) : null;

  if (limit != null && d.nodes.length > limit.max)
  {
    // a swimlane diagram without lanes is a flowchart, as the description says
    // The error names no number: a model that knows the limit writes to it
    // and leaves steps out (Sonnet's descriptions of a large flowchart had 22
    // and 23 nodes where they had 25 to 34 before the limit was named).
    return { xml: null, warnings: n.warnings, stats: null,
      tooLarge: limit.lanes ? { type: d.type, nodes: d.nodes.length, max: limit.max } :
        { type: d.type, nodes: d.nodes.length, max: limit.max, lanes: false },
      error: (limit.lanes ? "This " + d.type + " diagram" : "This flowchart without lanes") +
        " is too large to lay out well from a description." };
  }

  if (entry.needsElk && (opts.elk == null || typeof opts.elk.layout !== "function"))
  {
    return { xml: null, error: "No layout engine (ELK) is available here.", warnings: n.warnings, stats: null };
  }

  const r = await entry.layout(d, { elk: opts.elk, hints: opts.hints === "ask" ? "ask" : opts.hints !== false,
    route: opts.route !== false, keepTurned: typeof opts.keepTurned === "boolean" ? opts.keepTurned : undefined });
  // er.js writes tables in the shorthand the app server expands; boxes.js
  // returns XML that went through that expansion already
  const xml = (r.xml != null) ? r.xml : expandDiagramShorthand(writeModel(r.cells)).xml;
  const stats = Object.assign({ type: d.type, width: Math.round(r.width), height: Math.round(r.height),
    ms: Math.round((now() - t0) * 10) / 10 }, r.stats);

  return { xml: xml, error: null, warnings: n.warnings.concat(r.warnings || []), stats: stats };
}
