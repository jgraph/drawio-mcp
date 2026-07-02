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
import { buildHtml, processAppBundle, processLibavoidBundle } from "./shared.js";

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

// Read + process the libavoid-js bundle (WASM obstacle-avoiding edge router —
// see vendor/libavoid/README.md). The glue ships as ESM + import.meta.url;
// processLibavoidBundle neutralizes that, patches the loader to read
// globalThis.__LIBAVOID_WASM_BINARY, and aliases globalThis.AvoidLib. The wasm
// is a separate artifact (no SINGLE_FILE build) base64-inlined and handed in as
// wasmBinary so the router instantiates with no fetch. The shared routing core
// (libavoid-routing.js, defines globalThis.AvoidRouting; canonical source:
// drawio-dev js/libavoid-js/) is appended to the glue.
const libavoidBundlePath = path.join(__dirname, "..", "vendor", "libavoid", "libavoid.min.js");
const libavoidRaw = fs.readFileSync(libavoidBundlePath, "utf-8");
const libavoidRoutingJs = fs.readFileSync(
  path.join(__dirname, "..", "vendor", "libavoid", "libavoid-routing.js"), "utf-8");
const libavoidJs = processLibavoidBundle(libavoidRaw) + "\n" + libavoidRoutingJs;
const libavoidWasmPath = path.join(__dirname, "..", "vendor", "libavoid", "libavoid.wasm");
const libavoidWasmB64 = fs.readFileSync(libavoidWasmPath).toString("base64");
console.log(`libavoid bundle: ${libavoidBundlePath} (${(libavoidRaw.length / 1024).toFixed(1)} KB glue + ${(libavoidRoutingJs.length / 1024).toFixed(1)} KB routing core, ${(libavoidWasmB64.length / 1024).toFixed(1)} KB wasm base64)`);

// Read the shared XML reference (single source of truth for all prompts)
const xmlReference = fs.readFileSync(
  path.join(__dirname, "..", "..", "shared", "xml-reference.md"),
  "utf-8"
);

// Read the shared Mermaid reference (appended to the create_diagram
// tool description so LLMs get concrete per-type syntax hints).
const mermaidReference = fs.readFileSync(
  path.join(__dirname, "..", "..", "shared", "mermaid-reference.md"),
  "utf-8"
);

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

// Build the HTML and write it as an ES module export. The buildId is
// captured at build time and baked into the HTML + exported so the
// worker can echo it in every tool response.
const buildId = getBuildId();
console.log(`Build ID: ${buildId}`);
const html = buildHtml(appWithDepsJs, pakoDeflateJs, null, { libavoidJs, libavoidWasmB64, buildId });
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
