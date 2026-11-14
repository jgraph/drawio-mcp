// The references get_drawio_reference returns in this server: the shared
// references with their chat-view sections (shared/chat-view-xml.md,
// shared/chat-view-mermaid.md) inserted before the first section. Only
// create_diagram shows the diagram in the chat frame, and its format rule
// has the model place XML diagrams itself; the tool server, the skill and the
// project instructions use the shared references without them.

import fs from "node:fs";
import path from "node:path";

// Sections of the shared references that a diagram shown in the chat doesn't
// use: draw.io editor features (layer and tag filters, placeholders) and
// cross-functional grids, which don't fit the chat frame. Leaving them out
// keeps the XML reference well under 50,000 characters: Claude Code (and the
// hosts built on it) saves a longer tool result to a file and shows the model
// only a 2 KB preview, so it would draw without the reference.
// test/tools.test.js checks the length and that these headings still exist.
export const OMITTED_SECTIONS = ["Layers", "Tags", "Metadata and placeholders",
  "Cross-functional flowcharts (actor × phase grid, as a table)"];

/**
 * Removes the `## ` and `### ` sections named in `headings` from a markdown
 * reference. A section ends at the next heading of either level.
 * @param {string} reference
 * @param {string[]} headings
 * @returns {string}
 */
function withoutSections(reference, headings)
{
  return reference.split(/\n(?=###? )/).filter(function(part)
  {
    var match = /^###? (.*)/.exec(part);
    var heading = (match != null) ? match[1].trim() : null;

    return heading == null || headings.indexOf(heading) < 0;
  }).join("\n");
}

// With the grid pass for XML switched on (XML_GRID in xml-grid.js), the XML
// reference gets shared/chat-view-grid.md, cells instead of positions, before
// the layout patterns, whose first sentence then no longer says that the
// model places every shape. The section on routing and layout passes goes:
// the server routes a diagram of cells, and the reference stays under the
// length above.
export const GRID_SECTION_BEFORE = "## Laying out diagrams for the chat view";
export const GRID_PLACE_SENTENCE = "You place every shape yourself; there is no layout pass (don't set `postLayout`).";
export const GRID_PLACE_INSTEAD = "Where you place the shapes yourself, there is no layout pass (don't set `postLayout`).";
export const GRID_OMITTED_SECTIONS = ["Edge routing & layout passes"];

/**
 * The chat-view sections with the grid section before the layout patterns.
 * Throws when an anchor is gone, so a change to chat-view-xml.md that would
 * drop the section fails at startup and in the tests, not in a chat.
 * @param {string} view - chat-view-xml.md
 * @param {string} grid - chat-view-grid.md
 * @returns {string}
 */
function withGridSection(view, grid)
{
  const at = view.indexOf(GRID_SECTION_BEFORE);

  if (at < 0 || view.indexOf(GRID_PLACE_SENTENCE) < 0)
  {
    throw new Error("chat-view-xml.md has no \"" + (at < 0 ? GRID_SECTION_BEFORE : GRID_PLACE_SENTENCE) + "\" for the grid section");
  }

  return view.substring(0, at) + grid + "\n\n" + view.substring(at).replace(GRID_PLACE_SENTENCE, GRID_PLACE_INSTEAD);
}

/**
 * @param {string} sharedDir - the repo's shared/ directory
 * @param {string} name - the reference file, e.g. "xml-reference.md"
 * @param {string} chatView - its chat-view file, e.g. "chat-view-xml.md"
 * @param {{grid?: boolean}} [options] - grid: the XML reference for the grid
 *   pass (chat-view-grid.md inserted, see withGridSection)
 * @returns {string}
 */
export function readReference(sharedDir, name, chatView, options)
{
  const grid = options != null && options.grid === true;
  const reference = withoutSections(fs.readFileSync(path.join(sharedDir, name), "utf-8"),
    grid ? OMITTED_SECTIONS.concat(GRID_OMITTED_SECTIONS) : OMITTED_SECTIONS);
  let view = fs.readFileSync(path.join(sharedDir, chatView), "utf-8").trim();

  if (grid)
  {
    view = withGridSection(view, fs.readFileSync(path.join(sharedDir, "chat-view-grid.md"), "utf-8").trim());
  }

  const at = reference.indexOf("\n## ");

  return (at < 0) ? view + "\n\n" + reference :
    reference.substring(0, at + 1) + view + "\n\n" + reference.substring(at + 1);
}
