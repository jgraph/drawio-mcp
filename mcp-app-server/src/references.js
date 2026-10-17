// The references get_drawio_reference returns in this server: the shared
// references with their chat-view sections (shared/chat-view-xml.md,
// shared/chat-view-mermaid.md) inserted before the first section. Only
// create_diagram shows the diagram in the chat frame, and its format rule
// has the model place XML diagrams itself; the tool server, the skill and the
// project instructions use the shared references without them.

import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} sharedDir - the repo's shared/ directory
 * @param {string} name - the reference file, e.g. "xml-reference.md"
 * @param {string} chatView - its chat-view file, e.g. "chat-view-xml.md"
 * @returns {string}
 */
export function readReference(sharedDir, name, chatView)
{
  const reference = fs.readFileSync(path.join(sharedDir, name), "utf-8");
  const view = fs.readFileSync(path.join(sharedDir, chatView), "utf-8").trim();
  const at = reference.indexOf("\n## ");

  return (at < 0) ? view + "\n\n" + reference :
    reference.substring(0, at + 1) + view + "\n\n" + reference.substring(at + 1);
}
