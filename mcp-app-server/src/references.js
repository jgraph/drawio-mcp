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

/**
 * @param {string} sharedDir - the repo's shared/ directory
 * @param {string} name - the reference file, e.g. "xml-reference.md"
 * @param {string} chatView - its chat-view file, e.g. "chat-view-xml.md"
 * @returns {string}
 */
export function readReference(sharedDir, name, chatView)
{
  const reference = withoutSections(fs.readFileSync(path.join(sharedDir, name), "utf-8"), OMITTED_SECTIONS);
  const view = fs.readFileSync(path.join(sharedDir, chatView), "utf-8").trim();
  const at = reference.indexOf("\n## ");

  return (at < 0) ? view + "\n\n" + reference :
    reference.substring(0, at + 1) + view + "\n\n" + reference.substring(at + 1);
}
