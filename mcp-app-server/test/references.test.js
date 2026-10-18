import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readReference, OMITTED_SECTIONS } from "../src/references.js";

// Checks the references get_drawio_reference returns in this server: the
// shared references with the chat-view sections inserted and the sections the
// chat view doesn't use left out.

// Claude Code, and the hosts built on it, save a tool result over 50,000
// characters to a file and show the model a 2 KB preview, so a longer
// reference never reaches the model. This leaves room for multi-byte
// characters and for the next additions.
const MAX_REFERENCE_LENGTH = 48000;

const sharedDir = fileURLToPath(new URL("../../shared/", import.meta.url));

function headings(markdown)
{
  return (markdown.match(/^###? .*/gm) || []).map(function(line)
  {
    return line.replace(/^###? /, "").trim();
  });
}

test("the XML reference stays under the tool-result limit", function()
{
  const xml = readReference(sharedDir, "xml-reference.md", "chat-view-xml.md");
  const mermaid = readReference(sharedDir, "mermaid-reference.md", "chat-view-mermaid.md");

  assert.ok(xml.length < MAX_REFERENCE_LENGTH, "XML reference is " + xml.length + " characters");
  assert.ok(mermaid.length < MAX_REFERENCE_LENGTH, "Mermaid reference is " + mermaid.length + " characters");
});

test("the omitted sections exist in the shared reference and are left out", function()
{
  const shared = headings(readFileSync(sharedDir + "xml-reference.md", "utf-8"));
  const served = headings(readReference(sharedDir, "xml-reference.md", "chat-view-xml.md"));

  for (const heading of OMITTED_SECTIONS)
  {
    assert.ok(shared.includes(heading), "shared/xml-reference.md has no section \"" + heading + "\"");
    assert.ok(!served.includes(heading), "\"" + heading + "\" is still served");
  }
});

test("the chat-view sections come first, the rest of the reference follows", function()
{
  const served = headings(readReference(sharedDir, "xml-reference.md", "chat-view-xml.md"));
  const view = headings(readFileSync(sharedDir + "chat-view-xml.md", "utf-8"));
  const shared = headings(readFileSync(sharedDir + "xml-reference.md", "utf-8")).filter(function(heading)
  {
    return !OMITTED_SECTIONS.includes(heading);
  });

  assert.deepEqual(served, view.concat(shared));
});
