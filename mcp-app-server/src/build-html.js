#!/usr/bin/env node

/**
 * Build script that pre-generates the HTML string for the Cloudflare Worker.
 *
 * It reads the MCP Apps SDK browser bundle and pako deflate from node_modules,
 * processes them (strip ESM exports, create App alias), and writes the final
 * HTML as an exported string to src/generated-html.js.
 *
 * Usage: node src/build-html.js
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildHtml, processAppBundle } from "./shared.js";
import { readReference } from "./references.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Build identifier: git SHA + ISO timestamp + "-dirty" if working tree
// has uncommitted changes. Surfaced via window.__DRAWIO_BUILD in the
// iframe and as the _buildId field on every tool response, so you can
// confirm which deploy you're hitting.
function getBuildId()
{
  var sha = "no-git";
  var dirty = "";

  try
  {
    sha = execSync("git rev-parse --short HEAD", { cwd: __dirname, stdio: ["pipe", "pipe", "ignore"] }).toString().trim();

    try
    {
      var status = execSync("git status --porcelain", { cwd: __dirname, stdio: ["pipe", "pipe", "ignore"] }).toString().trim();

      if (status)
      {
        dirty = "-dirty";
      }
    }
    catch (e) {}
  }
  catch (e) {}

  return sha + dirty + "@" + new Date().toISOString();
}

// Read and process app-with-deps.js
const extAppsEntry = fileURLToPath(import.meta.resolve("@modelcontextprotocol/ext-apps/app-with-deps"));
const appWithDepsRaw = fs.readFileSync(extAppsEntry, "utf-8");
const appWithDepsJs = processAppBundle(appWithDepsRaw);

// Read pako deflate
const pakoEntry = fileURLToPath(import.meta.resolve("pako"));
const pakoDeflateJs = fs.readFileSync(
  path.join(path.dirname(pakoEntry), "..", "dist", "pako_deflate.min.js"),
  "utf-8"
);

// drawio-elk and drawio-mermaid are NOT inlined — the Worker serves HTML that
// loads them from the viewer.diagrams.net CDN (see buildHtml). This keeps them
// out of generated-html.js (~1.5 MB), lets browsers cache them cross-session,
// and keeps their versions in sync with the viewer per draw.io release.

// libavoid (edge router) is NOT inlined — the HTML loads the pure-JS router
// bundle + shared routing core from the viewer.diagrams.net CDN, like
// drawio-elk and drawio-mermaid (see buildHtml's libavoidBlock).
// Keeps ~850 KB out of generated-html.js.

// Read the shared XML reference (single source of truth for all prompts),
// with this server's chat-view sections (see references.js)
const sharedDir = path.join(__dirname, "..", "..", "shared");
const xmlReference = readReference(sharedDir, "xml-reference.md", "chat-view-xml.md");

// Read the shared Mermaid reference (returned by get_drawio_reference so
// LLMs get concrete per-type syntax hints).
const mermaidReference = readReference(sharedDir, "mermaid-reference.md", "chat-view-mermaid.md");

// Read the shape search index (optional — skip if not yet generated)
const shapeIndexPath = path.join(__dirname, "..", "..", "shape-search", "search-index.json");
let shapeIndex = null;

if (fs.existsSync(shapeIndexPath))
{
  shapeIndex = JSON.parse(fs.readFileSync(shapeIndexPath, "utf-8"));
  console.log(`Shape index: ${shapeIndex.length} shapes from ${shapeIndexPath}`);
}
else
{
  console.log("Shape index not found at " + shapeIndexPath + " — search_shapes tool will be disabled");
}

// Read the favicon
const faviconPath = path.join(__dirname, "..", "favicon.png");
const faviconBase64 = fs.readFileSync(faviconPath).toString("base64");
console.log(`Favicon: ${faviconPath} (${(faviconBase64.length / 1024).toFixed(1)} KB base64)`);

// Optionally inline a local viewer and libavoid build, as the Node server does
// (see VIEWER_PATH and LIBAVOID_PATH in index.js), to try changes in a draw.io
// release that is not out yet on staging. For staging only: the HTML grows by
// the size of the viewer, and the build ID says what was inlined.
//   VIEWER_PATH=../../drawio-dev/src/main/webapp/js \
//   LIBAVOID_PATH=../../drawio-dev/src/main/webapp/js/libavoid-js \
//   npx wrangler deploy --env staging
var viewerJs = null;
var libavoidJs = null;
var inlined = [];

if (process.env.VIEWER_PATH)
{
  const viewerPath = path.resolve(process.env.VIEWER_PATH);
  const minJs = fs.statSync(viewerPath).isDirectory() ? path.join(viewerPath, "viewer-static.min.js") : viewerPath;
  viewerJs = fs.readFileSync(minJs, "utf-8");
  inlined.push("viewer");
  console.log(`Inlining local viewer from ${minJs}`);
}

if (process.env.LIBAVOID_PATH)
{
  const libavoidDir = path.resolve(process.env.LIBAVOID_PATH);
  libavoidJs = fs.readFileSync(path.join(libavoidDir, "libavoid.min.js"), "utf-8") + "\n" +
    fs.readFileSync(path.join(libavoidDir, "libavoid-routing.js"), "utf-8");
  inlined.push("libavoid");
  console.log(`Inlining local libavoid from ${libavoidDir}`);
}

// Build the HTML and write it as an ES module export. The buildId is
// captured at build time and baked into the HTML + exported so the
// worker can echo it in every tool response.
const buildId = getBuildId() + ((inlined.length > 0) ? "+local-" + inlined.join("+") : "");
console.log(`Build ID: ${buildId}`);
const html = buildHtml(appWithDepsJs, pakoDeflateJs, null, { buildId, viewerJs, libavoidJs });
const outPath = path.join(__dirname, "generated-html.js");

fs.writeFileSync(outPath,
  `// Auto-generated by build-html.js — do not edit\n` +
  `export const buildId = ${JSON.stringify(buildId)};\n` +
  `export const html = ${JSON.stringify(html)};\n` +
  `export const xmlReference = ${JSON.stringify(xmlReference)};\n` +
  `export const mermaidReference = ${JSON.stringify(mermaidReference)};\n` +
  `export const shapeIndex = ${shapeIndex ? JSON.stringify(shapeIndex) : "null"};\n` +
  `export const faviconBase64 = ${JSON.stringify(faviconBase64)};\n`
);

console.log(`Generated ${outPath} (${(html.length / 1024).toFixed(1)} KB HTML` +
  (shapeIndex ? `, ${shapeIndex.length} shapes` : "") + ")");
