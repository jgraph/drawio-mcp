// Semantic diagrams: the model describes what a diagram contains (nodes,
// groups, edges, a direction), never coordinates or styles, and this engine
// turns that into draw.io XML: deterministic, headless (no DOM), the same in
// the Cloudflare Worker, Node and the browser. Format: FORMAT.md.
//
// Most layouts are written here (grid placement and channel routing in
// grid.js). ELK is optional and passed in rather than imported, so every host
// brings its own copy (elkjs from npm in Node and the Worker, the global ELK
// in the browser); ER uses it only for schemas too large for the grid.

import { normalizeSpec, TYPES } from "./spec.js";
import { writeModel } from "./xml-writer.js";
import { layoutEr } from "./er.js";

const LAYOUTS =
{
  er: { layout: layoutEr, needsElk: false }
};

export { TYPES };

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
 * @param {{elk?: {layout: function(object): Promise<object>}}} [options] -
 *   elk: an optional ELK instance (`new ELK()` from elkjs, or the global ELK
 *   in the browser), used for large schemas
 * @returns {Promise<{xml: string|null, error: string|null, warnings: string[],
 *   stats: object|null}>}
 */
export async function semanticToXml(input, options)
{
  const t0 = now();
  const opts = options || {};
  const n = normalizeSpec(input);

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

  if (entry.needsElk && (opts.elk == null || typeof opts.elk.layout !== "function"))
  {
    return { xml: null, error: "No layout engine (ELK) is available here.", warnings: n.warnings, stats: null };
  }

  const r = await entry.layout(d, { elk: opts.elk });
  const xml = writeModel(r.cells);
  const stats = Object.assign({ type: d.type, width: Math.round(r.width), height: Math.round(r.height),
    ms: Math.round((now() - t0) * 10) / 10 }, r.stats);

  return { xml: xml, error: null, warnings: n.warnings, stats: stats };
}
