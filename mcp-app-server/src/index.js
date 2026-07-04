#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildHtml, processAppBundle, processMermaidBundle, processElkBundle, createServer } from "./shared.js";
import { libavoidUrls } from "./libavoid-versions.js";

// Build identifier: git SHA + ISO timestamp + "-dirty" if uncommitted
// changes. Same logic as build-html.js — kept in sync for the Node
// path which doesn't go through the prebuild step.
function getBuildId()
{
  var sha = "no-git";
  var dirty = "";

  try
  {
    sha = execSync("git rev-parse --short HEAD", { cwd: path.dirname(fileURLToPath(import.meta.url)), stdio: ["pipe", "pipe", "ignore"] }).toString().trim();

    try
    {
      var status = execSync("git status --porcelain", { cwd: path.dirname(fileURLToPath(import.meta.url)), stdio: ["pipe", "pipe", "ignore"] }).toString().trim();

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

const buildId = getBuildId();

// Read the browser bundles once at startup and inline them into the HTML
const extAppsEntry = fileURLToPath(import.meta.resolve("@modelcontextprotocol/ext-apps/app-with-deps"));
const appWithDepsRaw = fs.readFileSync(extAppsEntry, "utf-8");

// The bundle is ESM: ends with export{..., oc as App, ...}.
// We can't use <script type="module"> (export aliases aren't local vars)
// and Blob URL import() fails in sandboxed iframes without allow-same-origin.
// Fix: strip the export statement and create a local `App` alias.
const appWithDepsJs = processAppBundle(appWithDepsRaw);

const pakoEntry = fileURLToPath(import.meta.resolve("pako"));
const pakoDeflateJs = fs.readFileSync(
  path.join(path.dirname(pakoEntry), "..", "dist", "pako_deflate.min.js"),
  "utf-8"
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// drawio-elk (Eclipse Layout Kernel + mxGraph bridge) and drawio-mermaid
// (native Mermaid parser + layout) load from the viewer.diagrams.net CDN by
// default — see buildHtml. For testing a local build before it's published,
// set ELK_PATH / MERMAID_PATH to a built bundle and it's inlined instead.
// processElkBundle/processMermaidBundle accept both the published IIFE form
// and an ESM build (exports stripped + aliased to globals). Example:
//   ELK_PATH=../drawio-dev/src/main/webapp/js/elk/drawio-elk.min.js npm start
var elkJs = null;

if (process.env.ELK_PATH)
{
  elkJs = processElkBundle(fs.readFileSync(path.resolve(process.env.ELK_PATH), "utf-8"));
  console.log("Inlining local drawio-elk from", process.env.ELK_PATH);
}

var mermaidJs = null;

if (process.env.MERMAID_PATH)
{
  mermaidJs = processMermaidBundle(fs.readFileSync(path.resolve(process.env.MERMAID_PATH), "utf-8"));
  console.log("Inlining local drawio-mermaid from", process.env.MERMAID_PATH);
}

// libavoid (WASM obstacle-avoiding edge router, powers the routing: "libavoid"
// pass) is NOT inlined — the HTML loads glue + base64 wasm payload + loader +
// shared routing core from the viewer.diagrams.net CDN, like drawio-elk and
// drawio-mermaid (see buildHtml's libavoidBlock). Cached cross-session,
// version-synced with each draw.io release, and drops ~700 KB from the HTML.
// The URLs are ETag-versioned at startup (and daily on the HTTP transport)
// so a release busts the CDN's 30-day browser cache immediately — see
// libavoid-versions.js; on a failed startup check the plain URLs are used.
// Deliberate startup cost: up to one HEAD timeout (~5s) when the CDN is
// blackholed — bounded and rare (plain offline fails fast); resolving in
// the background instead would leave the once-built stdio HTML permanently
// unversioned.
var libavoidScriptUrls = await libavoidUrls();

// Optionally inline a local viewer build (for testing GraphViewer changes).
// Set VIEWER_PATH env var to the path of viewer-static.min.js (or a directory
// containing it plus GraphViewer.js). Example:
//   VIEWER_PATH=../drawio-dev/src/main/webapp/js npm start
var viewerJs = null;

if (process.env.VIEWER_PATH)
{
  const viewerPath = path.resolve(process.env.VIEWER_PATH);

  if (fs.statSync(viewerPath).isDirectory())
  {
    // Load the minified viewer + unminified GraphViewer.js on top
    const minJs = path.join(viewerPath, "viewer-static.min.js");
    const gvJs = path.join(viewerPath, "diagramly", "GraphViewer.js");
    viewerJs = fs.readFileSync(minJs, "utf-8");

    if (fs.existsSync(gvJs))
    {
      viewerJs += "\n" + fs.readFileSync(gvJs, "utf-8");
    }

    console.log("Using local viewer from", viewerPath);
  }
  else
  {
    viewerJs = fs.readFileSync(viewerPath, "utf-8");
    console.log("Using local viewer from", viewerPath);
  }
}

// Read the shared XML reference once at startup (single source of truth)
const xmlReference = fs.readFileSync(
  path.join(__dirname, "..", "..", "shared", "xml-reference.md"),
  "utf-8"
);

// Same for the Mermaid syntax reference — appended to the create_diagram
// tool description so the LLM gets concrete per-type syntax hints for
// every supported Mermaid diagram plus flowchart styling guidance.
const mermaidReference = fs.readFileSync(
  path.join(__dirname, "..", "..", "shared", "mermaid-reference.md"),
  "utf-8"
);

// Read the shape search index (optional — skip if not yet generated)
const shapeIndexPath = path.join(__dirname, "..", "..", "shape-search", "search-index.json");
var shapeIndex = null;

if (fs.existsSync(shapeIndexPath))
{
  shapeIndex = JSON.parse(fs.readFileSync(shapeIndexPath, "utf-8"));
  console.log("Shape index: " + shapeIndex.length + " shapes");
}

// Pre-build the HTML once. The buildId is baked into the HTML so the
// iframe exposes it via window.__DRAWIO_BUILD (visible in DevTools).
// `let` — the daily libavoid version check rebuilds it in place (each
// /mcp request creates its McpServer from the current value).
let html = buildHtml(appWithDepsJs, pakoDeflateJs, mermaidJs,
  { viewerJs, elkJs, buildId, libavoidUrls: libavoidScriptUrls });

// --- Transport setup ---

async function startStreamableHTTPServer()
{
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.LISTEN ?? "127.0.0.1";
  const allowedHosts = process.env.ALLOWED_HOSTS
    ? process.env.ALLOWED_HOSTS.split(",").map(function(h) { return h.trim(); })
    : undefined;
  const app = createMcpExpressApp({ host: "0.0.0.0", allowedHosts });

  // Re-check the libavoid CDN ETags daily and rebuild the HTML when a
  // draw.io release changed them — each /mcp request creates its McpServer
  // from the current html, so new sessions pick the fresh URLs up
  // immediately. unref() keeps the timer from holding the process open.
  setInterval(async function()
  {
    try
    {
      const urls = await libavoidUrls(libavoidScriptUrls);

      if (urls.join("\n") !== libavoidScriptUrls.join("\n"))
      {
        libavoidScriptUrls = urls;
        html = buildHtml(appWithDepsJs, pakoDeflateJs, mermaidJs,
          { viewerJs, elkJs, buildId, libavoidUrls: urls });
        console.log("libavoid CDN versions changed; HTML rebuilt");
      }
    }
    catch (e) {}
  }, 24 * 60 * 60 * 1000).unref();

  // Serve favicon
  const faviconPath = path.join(__dirname, "..", "favicon.png");

  app.get(["/favicon.ico", "/favicon.png"], function(req, res)
  {
    res.sendFile(faviconPath);
  });

  app.all("/mcp", async function(req, res)
  {
    const method = req.body && req.body.method;
    const sessionId = (req.headers["mcp-session-id"] || "").slice(0, 8);
    const start = Date.now();
    console.log(`[req] ${req.method} method=${method || "(none)"} session=${sessionId} accept=${req.headers["accept"] || ""}`);

    res.on("finish", function()
    {
      const elapsed = Date.now() - start;
      console.log(`[res] method=${method || "(none)"} session=${sessionId} status=${res.statusCode} ${elapsed}ms`);
    });

    const server = createServer(html, { domain: process.env.DOMAIN, xmlReference, mermaidReference, shapeIndex, buildId });

    const transport = new StreamableHTTPServerTransport(
    {
      sessionIdGenerator: undefined,
    });

    res.on("close", function()
    {
      transport.close().catch(function() {});
      server.close().catch(function() {});
    });

    try
    {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    }
    catch (error)
    {
      console.error("MCP error:", error);

      if (!res.headersSent)
      {
        res.status(500).json(
        {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = app.listen(port, function()
  {
    console.log(`MCP App server listening on http://${host}:${port}/mcp`);
  });

  const shutdown = function()
  {
    console.log("\nShutting down...");
    httpServer.close(function() { process.exit(0); });
    setTimeout(function() { process.exit(0); }, 1000).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function startStdioServer()
{
  await createServer(html, { domain: process.env.DOMAIN, xmlReference, mermaidReference, shapeIndex, buildId }).connect(new StdioServerTransport());
}

async function main()
{
  if (process.argv.includes("--stdio"))
  {
    await startStdioServer();
  }
  else
  {
    await startStreamableHTTPServer();
  }
}

main().catch(function(e)
{
  console.error(e);
  process.exit(1);
});
