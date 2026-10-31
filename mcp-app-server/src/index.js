#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readReference } from "./references.js";
import { buildHtml, processAppBundle, processMermaidBundle, processElkBundle, createServer, clientUiState } from "./shared.js";
import { resolveIconServiceUrl } from "../../shared/icon-search.js";
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
  // Startup messages go to stderr: with --stdio, stdout is the JSON-RPC
  // stream, and a line that isn't a message breaks strict clients.
  console.error("Inlining local drawio-elk from", process.env.ELK_PATH);
}

var mermaidJs = null;

if (process.env.MERMAID_PATH)
{
  mermaidJs = processMermaidBundle(fs.readFileSync(path.resolve(process.env.MERMAID_PATH), "utf-8"));
  console.error("Inlining local drawio-mermaid from", process.env.MERMAID_PATH);
}

// libavoid (obstacle-avoiding edge router, powers the routing: "libavoid"
// pass) is NOT inlined — the HTML loads the pure-JS router bundle + shared
// routing core from the viewer.diagrams.net CDN, like drawio-elk and
// drawio-mermaid (see buildHtml's libavoidBlock). Cached cross-session,
// version-synced with each draw.io release, and drops ~850 KB from the HTML.
// The URLs are ETag-versioned at startup (and daily on the HTTP transport)
// so a release busts the CDN's 30-day browser cache immediately — see
// libavoid-versions.js; on a failed startup check the plain URLs are used.
// Deliberate startup cost: up to one HEAD timeout (~5s) when the CDN is
// blackholed — bounded and rare (plain offline fails fast); resolving in
// the background instead would leave the once-built stdio HTML permanently
// unversioned.
var libavoidScriptUrls = await libavoidUrls();

// Optionally inline a local libavoid build (for testing a routing core or
// bundle before the draw.io release that ships it). Set LIBAVOID_PATH to a
// directory with libavoid.min.js and libavoid-routing.js, e.g. drawio-dev's
// src/main/webapp/js/libavoid-js. The CDN URLs are then not used.
var libavoidJs = null;

if (process.env.LIBAVOID_PATH)
{
  const libavoidDir = path.resolve(process.env.LIBAVOID_PATH);
  libavoidJs = fs.readFileSync(path.join(libavoidDir, "libavoid.min.js"), "utf-8") + "\n" +
    fs.readFileSync(path.join(libavoidDir, "libavoid-routing.js"), "utf-8");
  console.error("Inlining local libavoid from", libavoidDir);
}

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

    console.error("Using local viewer from", viewerPath);
  }
  else
  {
    viewerJs = fs.readFileSync(viewerPath, "utf-8");
    console.error("Using local viewer from", viewerPath);
  }
}

// Read the shared XML reference once at startup (single source of truth),
// with this server's chat-view sections (see references.js)
const sharedDir = path.join(__dirname, "..", "..", "shared");
const xmlReference = readReference(sharedDir, "xml-reference.md", "chat-view-xml.md");

// Same for the Mermaid syntax reference — returned by get_drawio_reference
// so the LLM gets concrete per-type syntax hints for every supported
// Mermaid diagram plus flowchart styling guidance.
const mermaidReference = readReference(sharedDir, "mermaid-reference.md", "chat-view-mermaid.md");

// Read the shape search index (optional — skip if not yet generated)
const shapeIndexPath = path.join(__dirname, "..", "..", "shape-search", "search-index.json");
var shapeIndex = null;

if (fs.existsSync(shapeIndexPath))
{
  shapeIndex = JSON.parse(fs.readFileSync(shapeIndexPath, "utf-8"));
  console.error("Shape index: " + shapeIndex.length + " shapes");
}

// Icon service supplementing sparse search_shapes results. Override with
// DRAWIO_ICON_SERVICE_URL (a self-hosted service base URL, or "off" to
// disable icon supplementation entirely).
const iconServiceUrl = resolveIconServiceUrl(process.env.DRAWIO_ICON_SERVICE_URL);

// Pre-build the HTML once. The buildId is baked into the HTML so the
// iframe exposes it via window.__DRAWIO_BUILD (visible in DevTools).
// `let` — the daily libavoid version check rebuilds it in place (each
// /mcp request creates its McpServer from the current value).
let html = buildHtml(appWithDepsJs, pakoDeflateJs, mermaidJs,
  { viewerJs, elkJs, buildId, libavoidUrls: libavoidScriptUrls, libavoidJs });

// --- Sessions ---

// The HTTP transport is stateless (a server per request), so the server that
// answers a tools/call never saw the client's initialize. The one thing it
// needs from it, what the client said about the MCP Apps UI (clientUiState),
// is written into the session id minted at initialize: the same scheme as the
// Worker (see mintSessionId in worker.js). Not a credential: a forged id only
// changes the "open in draw.io" note that client's create_diagram results
// get. An id without any of the prefixes reads as "not declared".
const UI_SESSION_PREFIX = "ui-";
const HIDDEN_SESSION_PREFIX = "hidden-";
const PLAIN_SESSION_PREFIX = "noui-";

// The other "renders the app" signal: sessions whose client fetched the app
// resource without declaring the capability, mapped to when that expires. A
// host that renders fetches the resource again whenever it renders, so the
// flag only has to bridge the gap between two of its calls. In memory, since
// the process outlives its sessions; a lost entry only appends the link.
const UI_RESOURCE_FLAG_TTL = 24 * 60 * 60 * 1000;
const uiResourceReads = new Map();

function mintSessionId(uiState)
{
  const prefix = uiState === "renders" ? UI_SESSION_PREFIX :
    uiState === "hidden" ? HIDDEN_SESSION_PREFIX : PLAIN_SESSION_PREFIX;

  return prefix + randomUUID();
}

/**
 * The `uiSession` option of createServer for a session: the declaration from
 * the id, the resource flag from uiResourceReads.
 */
function uiSessionFor(sessionId)
{
  return {
    declared: sessionId.startsWith(UI_SESSION_PREFIX),
    hidden: sessionId.startsWith(HIDDEN_SESSION_PREFIX),
    markResourceRead: async function()
    {
      const now = Date.now();

      // Drop expired flags on the way, so the map only holds live sessions
      for (const [id, expires] of uiResourceReads)
      {
        if (expires <= now)
        {
          uiResourceReads.delete(id);
        }
      }

      uiResourceReads.set(sessionId, now + UI_RESOURCE_FLAG_TTL);
    },
    resourceRead: async function()
    {
      const expires = uiResourceReads.get(sessionId);

      return expires != null && expires > Date.now();
    },
  };
}

// --- Transport setup ---

async function startStreamableHTTPServer()
{
  const port = parseInt(process.env.PORT ?? "3001", 10);
  // Bind address: loopback by default, so a plain `npm start` is not
  // reachable from the network. The Docker image sets LISTEN=0.0.0.0 (a
  // container must listen on all its interfaces for -p to work); the host
  // side of the -p mapping then decides who can reach it.
  const host = process.env.LISTEN ?? "127.0.0.1";
  const allowedHosts = process.env.ALLOWED_HOSTS
    ? process.env.ALLOWED_HOSTS.split(",").map(function(h) { return h.trim(); })
    : undefined;

  // Host header validation only when ALLOWED_HOSTS is set. Not implied by a
  // loopback bind (as createMcpExpressApp would) — tunnels such as
  // cloudflared and Tailscale Funnel connect to localhost but forward their
  // public hostname in the Host header.
  const app = express();
  app.use(express.json());

  if (allowedHosts)
  {
    app.use(hostHeaderValidation(allowedHosts));
  }

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
          { viewerJs, elkJs, buildId, libavoidUrls: urls, libavoidJs });
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

  // Uptime probe for monitors and container health checks
  app.get("/health", function(req, res)
  {
    res.set("Cache-Control", "no-store").type("text/plain").send("ok");
  });

  app.all("/mcp", async function(req, res)
  {
    const method = req.body && req.body.method;
    const messages = Array.isArray(req.body) ? req.body : [req.body];
    const init = req.method === "POST" ? messages.find(isInitializeRequest) : undefined;

    // The session this request belongs to: minted for an initialize and sent
    // back in Mcp-Session-Id (the stateless transport sends none of its own,
    // and checks none), taken from the header otherwise.
    let session = null;

    if (init != null)
    {
      session = mintSessionId(clientUiState(init.params.capabilities, init.params.clientInfo));
      res.setHeader("Mcp-Session-Id", session);
    }
    else if (req.headers["mcp-session-id"])
    {
      session = req.headers["mcp-session-id"];
    }

    const sessionLabel = (session || "").slice(0, 13);
    const start = Date.now();
    console.log(`[req] ${req.method} method=${method || "(none)"} session=${sessionLabel} accept=${req.headers["accept"] || ""}`);

    res.on("finish", function()
    {
      const elapsed = Date.now() - start;
      console.log(`[res] method=${method || "(none)"} session=${sessionLabel} status=${res.statusCode} ${elapsed}ms`);
    });

    const server = createServer(html,
    {
      domain: process.env.DOMAIN,
      xmlReference,
      mermaidReference,
      shapeIndex,
      iconServiceUrl,
      buildId,
      uiSession: session != null ? uiSessionFor(session) : null,
    });

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

  const httpServer = app.listen(port, host, function()
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
  await createServer(html, { domain: process.env.DOMAIN, xmlReference, mermaidReference, shapeIndex, iconServiceUrl, buildId }).connect(new StdioServerTransport());
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
