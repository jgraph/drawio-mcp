#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import pako from "pako";
import { routeXml } from "./libavoid-pass.js";
import { layoutXml } from "./elk-pass.js";
import { assertPagePath, listPageMeta, readPageXml, writePageXml } from "./pages.js";
import { SHAPE_INDEX } from "./cdn-cache.js";
import { loadShapeIndex } from "./shape-index.js";
import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRAWIO_BASE_URL = process.env.DRAWIO_BASE_URL || "https://app.diagrams.net/";

// Mermaid defaults version of the diagrams created from #create=type:mermaid
// links: draw.io converts them with Mermaid 12's defaults (ELK layout,
// redux-color theme, neo look for most types) and stores the version in the
// diagram, so it keeps that look when it is edited later. Same value as the
// app server's MERMAID_DEFAULTS_VERSION. Older draw.io builds ignore it.
const MERMAID_DEFAULTS_VERSION = "12";

// Single source for the version reported by --version and the MCP handshake.
const packageInfo = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
);

// Handle CLI metadata flags before any other startup work so they
// respond without reading the reference files or touching stdio.
const cliArgs = process.argv.slice(2);

if (cliArgs.length > 0)
{
  if (cliArgs[0] === "--help" || cliArgs[0] === "-h")
  {
    console.log(`drawio-mcp ${packageInfo.version}

Official draw.io MCP server for opening diagrams in the draw.io editor.

Usage:
  drawio-mcp              Start the MCP stdio server
  drawio-mcp --help       Show this help text
  drawio-mcp --version    Show the package version

Options:
  -h, --help              Show help
  -v, --version           Show version`);
    process.exit(0);
  }
  else if (cliArgs[0] === "--version" || cliArgs[0] === "-v")
  {
    console.log(packageInfo.version);
    process.exit(0);
  }
  else
  {
    console.error(`Unknown option: ${cliArgs[0]}`);
    console.error("Run `drawio-mcp --help` for usage.");
    process.exit(1);
  }
}

// Reads a file from shared/ once at startup (single source of truth). In the
// repo: read from shared/. When installed via npm: read from the local copy
// created by the prepack script.
function readShared(name)
{
  const sharedFile = join(__dirname, "..", "..", "shared", name);

  return readFileSync(existsSync(sharedFile) ? sharedFile : join(__dirname, name), "utf-8");
}

// The full references are served by get_drawio_reference rather than appended
// to the tool descriptions: at ~35k / 14k characters (the XML one ~16k tokens)
// they made the descriptions too long for clients that index them — VS Code
// Copilot embeds descriptions in batches for its tool search, and one
// oversized description fails the whole batch, other servers' tools included
// (jgraph/drawio-mcp#76). open_drawio_xml inlines the condensed XML reference
// (xml-essentials.md) instead, which in LLM tests did as well as the full one.
const references =
{
  xml: readShared("xml-reference.md"),
  mermaid: readShared("mermaid-reference.md"),
};

// The label gap in the edge template is for the skill and the project
// instructions, whose files open without this server. Here fitEdgeLabels adds
// it to every edge, so the description leaves it out to stay under the cap.
const xmlEssentials = readShared("xml-essentials.md").trim()
  .replace("defaultLabelBackgroundColor=page;", "");

// Shape search. To keep the npm package lean, the ~4.6 MB shape index is NOT
// bundled — it is fetched from the CDN on first use through the same
// ETag-revalidated per-user disk cache as the ELK bundle (cdn-cache.js
// SHAPE_INDEX: a warm start is a 304, offline falls back to the cached copy)
// and then kept in memory for the process lifetime. In-repo checkouts read
// the local file instead, so dev and tests never touch the network. Override
// the source with DRAWIO_SHAPE_INDEX_URL (an http(s) URL, or a local path).
// The search algorithm (buildTagMap/searchShapes) is the shared
// shared/shape-search.js, copied into src/ by copy-shared and bundled.

// Local-file fast path: repo checkout first, then an optional src/ copy (present
// only if a consumer chose to bundle it). Absent in a default npm install.
const localShapeIndexCandidates =
[
  join(__dirname, "..", "..", "shape-search", "search-index.json"),
  join(__dirname, "search-index.json"),
];

let shapeSearchPromise = null;

// Resolve once to { searchShapes, shapeIndex, tagMap }, cached for the process.
// Reads a local index if present, otherwise loads SHAPE_INDEX through the CDN
// cache. On failure the promise is cleared so a later call can retry (e.g.
// transient network error).
function loadShapeSearch()
{
  if (!shapeSearchPromise)
  {
    shapeSearchPromise = (async function()
    {
      const mod = await import("./shape-search.js")
        .catch(function() { return import("../../shared/shape-search.js"); });

      const localPath = localShapeIndexCandidates.find(function(p) { return existsSync(p); });
      const shapeIndex = (localPath != null)
        ? JSON.parse(readFileSync(localPath, "utf-8"))
        : await loadShapeIndex(SHAPE_INDEX);
      const tagMap = mod.buildTagMap(shapeIndex);

      return { searchShapes: mod.searchShapes, shapeIndex, tagMap };
    })().catch(function(e)
    {
      shapeSearchPromise = null;
      throw e;
    });
  }

  return shapeSearchPromise;
}

// Icon service supplementing weak or sparse search_shapes results with brand
// logos and general-purpose concept icons (the editor sidebar's grouped icon
// search, shared/icon-search.js). Override the endpoint with
// DRAWIO_ICON_SERVICE_URL (a self-hosted service base URL, or "off" to
// disable icon supplementation entirely).
let iconSearchPromise = null;

// Resolve once to { searchShapesAndIcons, serviceUrl }, cached for the
// process; null only if the module itself cannot be imported. Same dual-path
// import as the shape-search module (serviceUrl null means icons disabled —
// searchShapesAndIcons then runs the local search only).
function loadIconSearch()
{
  if (!iconSearchPromise)
  {
    iconSearchPromise = (async function()
    {
      const mod = await import("./icon-search.js")
        .catch(function() { return import("../../shared/icon-search.js"); });

      return {
        searchShapesAndIcons: mod.searchShapesAndIcons,
        serviceUrl: mod.resolveIconServiceUrl(process.env.DRAWIO_ICON_SERVICE_URL),
      };
    })().catch(function()
    {
      // Icon results are strictly a supplement — degrade to local-only
      return null;
    });
  }

  return iconSearchPromise;
}

// shared/normalize-model.js (the model repairs the desktop CLI's --normalize
// also applies), copied into src/ by copy-shared — same local-copy-then-repo
// import as the other shared helpers. Memoized; pure string in, string out.
let normalizePromise = null;

function loadNormalize()
{
  if (!normalizePromise)
  {
    normalizePromise = import("./normalize-model.js")
      .catch(function() { return import("../../shared/normalize-model.js"); });
  }

  return normalizePromise;
}

// shared/label-perimeter.js (labelPerimeter=1 on vertices with a label
// outside the shape, so edges end at the label as in the editor, and the
// edge label gap and lift of fitEdgeLabels), copied
// into src/ by copy-shared - same import. Memoized.
let labelPerimeterPromise = null;

function loadLabelPerimeter()
{
  if (!labelPerimeterPromise)
  {
    labelPerimeterPromise = import("./label-perimeter.js")
      .catch(function() { return import("../../shared/label-perimeter.js"); });
  }

  return labelPerimeterPromise;
}

// shared/repair-xml.js (the mechanical slips LLMs make in XML: text around the
// diagram, `<` or a stray `&` in attribute values, a layer that is its own
// parent), copied into src/ by copy-shared — same import. Memoized; pure
// string helpers, no I/O.
let repairPromise = null;

function loadRepair()
{
  if (!repairPromise)
  {
    repairPromise = import("./repair-xml.js")
      .catch(function() { return import("../../shared/repair-xml.js"); });
  }

  return repairPromise;
}

// shared/mermaid-elk.js (the Mermaid ELK layout selector), copied into src/ by
// copy-shared like the search helpers — same local-copy-then-repo import so an
// in-repo run works without the copy. Memoized; pure string helpers, no I/O.
let mermaidElkPromise = null;

function loadMermaidElk()
{
  if (!mermaidElkPromise)
  {
    mermaidElkPromise = import("./mermaid-elk.js")
      .catch(function() { return import("../../shared/mermaid-elk.js"); });
  }

  return mermaidElkPromise;
}

// Longest URL the Windows shell opens reliably from a .url file:
// the InternetShortcut handler fails with Win32 error 122 ("The data
// area passed to a system call is too small") beyond
// INTERNET_MAX_URL_LENGTH (2083), so stay under it with some headroom.
const WIN_URL_FILE_MAX_LENGTH = 2000;

/**
 * Builds an HTML page that forwards the browser to the given URL from
 * JavaScript. Browsers accept URLs far beyond OS shell limits, and the
 * fragment carrying the diagram never leaves the client, so this has no
 * practical length cap.
 */
function buildRedirectHtml(url)
{
  // The diagram fragment is percent-encoded, but DRAWIO_BASE_URL comes
  // from the environment, so escape anything that could break out of
  // the string literal or close the script element.
  const escaped = url
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/</g, "\\u003C");

  return "<!DOCTYPE html>\n" +
    "<html>\n" +
    "<head>\n" +
    "<meta charset=\"utf-8\">\n" +
    "<title>draw.io</title>\n" +
    "</head>\n" +
    "<body>\n" +
    "Opening draw.io...\n" +
    "<script>\n" +
    "window.location.replace(\"" + escaped + "\");\n" +
    "</script>\n" +
    "</body>\n" +
    "</html>\n";
}

/**
 * Opens a URL in the default browser (cross-platform)
 */
function openBrowser(url)
{
  let child;

  if (process.platform === "win32")
  {
    // cmd.exe's "start" command treats & as a command separator and
    // drops everything after # in URLs, so the #R/#create= fragment
    // (which carries the entire diagram payload) is silently lost.
    // Writing a temporary .url file preserves the full URL intact, but
    // only up to the shell's InternetShortcut length limit — beyond it
    // the diagram is opened through a temporary HTML page instead,
    // which redirects from JavaScript (issue #54).
    let tmpFile;

    if (url.length <= WIN_URL_FILE_MAX_LENGTH)
    {
      tmpFile = join(tmpdir(), "drawio-mcp-" + Date.now() + ".url");
      writeFileSync(tmpFile, "[InternetShortcut]\r\nURL=" + url + "\r\n");
    }
    else
    {
      tmpFile = join(tmpdir(), "drawio-mcp-" + Date.now() + ".html");
      writeFileSync(tmpFile, buildRedirectHtml(url));
    }

    child = spawn("cmd", ["/c", "start", "", tmpFile], { shell: false, stdio: "ignore" });

    setTimeout(function()
    {
      try { unlinkSync(tmpFile); } catch (e) { /* ignore */ }
    }, 10000);
  }
  else if (process.platform === "darwin")
  {
    child = spawn("open", [url], { shell: false, stdio: "ignore" });
  }
  else
  {
    child = spawn("xdg-open", [url], { shell: false, stdio: "ignore" });
  }

  child.on("error", function(error)
  {
    console.error(`Failed to open browser: ${error.message}`);
  });

  child.unref();
}

/**
 * Compresses data using pako deflateRaw and encodes as base64
 * This matches the compression used by draw.io tools
 */
function compressData(data)
{
  if (!data || data.length === 0)
  {
    return data;
  }
  const encoded = encodeURIComponent(data);
  const compressed = pako.deflateRaw(encoded);
  return Buffer.from(compressed).toString("base64");
}

/**
 * Generates a draw.io URL carrying the diagram in its hash: XML as #R (the
 * compressed XML, which draw.io loads as it is), Mermaid and CSV as
 * #create={...}, which draw.io converts in the browser.
 *
 * Why not #create for XML too: after a #create, draw.io rewrites the hash
 * with the diagram it created, and when that differs from the link it loads
 * the link again and asks "All changes will be lost!". A host that re-encodes
 * the link on the way to the browser makes them differ: VS Code opens links
 * as encodeURI(uri.toString(true)). draw.io never rewrites a #R hash.
 */
function generateDrawioUrl(data, type, options = {})
{
  const {
    lightbox = false,
    border = 10,
    dark = false,
    edit = "_blank",
  } = options;

  const compressedData = compressData(data);
  const params = new URLSearchParams();

  if (lightbox)
  {
    params.set("lightbox", "1");
    params.set("edit", "_blank");
    params.set("border", "10");
  }
  else
  {
    params.set("grid", "0");
    params.set("pv", "0");
  }

  if (dark === true)
  {
    params.set("dark", "1");
  }

  params.set("border", border.toString());
  params.set("edit", edit);

  let hash;

  if (type === "xml")
  {
    hash = "#R" + encodeURIComponent(compressedData);
  }
  else
  {
    const createObj = {
      type: type,
      compressed: true,
      data: compressedData,
    };

    if (type === "mermaid")
    {
      createObj.version = MERMAID_DEFAULTS_VERSION;
    }

    hash = "#create=" + encodeURIComponent(JSON.stringify(createObj));
  }

  const paramsStr = params.toString();

  return DRAWIO_BASE_URL + (paramsStr ? "?" + paramsStr : "") + hash;
}

// Define the tools
const tools =
[
  {
    name: "open_drawio_xml",
    description:
      "Opens the draw.io editor with a diagram from draw.io XML. " +
      "Use it for custom styling, precise positioning and stencil-based diagrams " +
      "(cloud, network, P&ID, UI mockups, floor plans); prefer open_drawio_mermaid " +
      "for flowcharts, sequence, class, ER and the other types Mermaid covers.\n\n" +
      xmlEssentials + "\n" +
      "- Cloud/network/P&ID icons or logos: call search_shapes, use its style.\n" +
      "- Set postLayout \"elk\" for flowcharts, process and tree diagrams (ELK places nodes and " +
      "routes edges), or routing \"libavoid\" for hand-placed layouts whose edges would cross " +
      "shapes. Never both.\n\n" +
      "Only when the diagram needs layers, tags, metadata and placeholders, tables, " +
      "cross-functional grids or dark-mode colors, call get_drawio_reference with format " +
      "\"xml\" for the full reference.",
    inputSchema:
    {
      type: "object",
      properties:
      {
        content:
        {
          type: "string",
          description:
            "The draw.io XML content in mxGraphModel format.",
        },
        lightbox:
        {
          type: "boolean",
          description: "Open in lightbox mode (read-only view). Default: false",
        },
        dark:
        {
          type: "string",
          enum: ["auto", "true", "false"],
          description: "Dark mode setting. Default: auto",
        },
        postLayout:
        {
          type: "string",
          enum: ["elk"],
          description:
            "Optional full re-layout (ELK layered flow), applied server-side before the diagram opens. The only value is \"elk\". It PLACES the vertices — your x/y coordinates then only need to express rough direction — and routes the edges as part of the layout. Set it for every directional/hierarchical diagram: flowcharts, process and state diagrams, decision trees, pipelines. Omit it when the layout carries hand-crafted meaning (swimlanes, containers, architecture, UML), which is the usual reason to place cells by hand. Node sizes are kept exactly as you declare them; only positions change (and containers resize around their laid-out children).",
        },
        direction:
        {
          type: "string",
          enum: ["vertical", "horizontal"],
          description:
            "Flow direction for `postLayout: \"elk\"`: \"vertical\" (top-down, the default) or \"horizontal\" (left-to-right). Only meaningful together with `postLayout`.",
        },
        routing:
        {
          type: "string",
          enum: ["libavoid"],
          description:
            "Optional obstacle-avoiding orthogonal edge-routing pass (libavoid), applied server-side before the diagram opens. The only value is \"libavoid\". It keeps your vertex positions and only recomputes the connectors so they run in clean right-angle segments that route AROUND the boxes instead of cutting through them (draw.io's default router draws a straight/simple line with no obstacle avoidance). Set it for hand-placed diagrams where edges would otherwise cross shapes — architecture, network, deployment, UML, floor plans. Omit it for sparse layouts where connectors won't overlap anything. Treat `postLayout` and `routing` as alternatives: ELK already routes its own edges, so don't set both.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "open_drawio_csv",
    description:
      "Opens the draw.io editor with a diagram generated from CSV data. " +
      "The CSV format should follow draw.io's CSV import specification which allows " +
      "creating org charts, flowcharts, and other diagrams from tabular data.",
    inputSchema:
    {
      type: "object",
      properties:
      {
        content:
        {
          type: "string",
          description:
            "The CSV content following draw.io's CSV import format.",
        },
        lightbox:
        {
          type: "boolean",
          description: "Open in lightbox mode (read-only view). Default: false",
        },
        dark:
        {
          type: "string",
          enum: ["auto", "true", "false"],
          description: "Dark mode setting. Default: auto",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "open_drawio_mermaid",
    description:
      "Opens the draw.io editor with a diagram generated from Mermaid.js syntax, " +
      "converted into an editable draw.io diagram. The recommended default for " +
      "flowcharts, sequence, class, state and ER diagrams, gantt charts, mind maps, " +
      "timelines, C4, architecture and the other types draw.io's Mermaid parser " +
      "supports (28 in all).\n\n" +
      "Call get_drawio_reference with format \"mermaid\" once before your first " +
      "Mermaid diagram in a conversation: it lists the header keyword and syntax " +
      "hints for every supported type (a misspelled header yields a blank " +
      "diagram) and flowchart styling.",
    inputSchema:
    {
      type: "object",
      properties:
      {
        content:
        {
          type: "string",
          description:
            "The Mermaid.js diagram definition. " +
            "Example: 'graph TD; A-->B; B-->C;'",
        },
        postLayout:
        {
          type: "string",
          enum: ["elk"],
          description:
            "Optional ELK layered layout for Mermaid FLOWCHARTS. The only value is \"elk\". draw.io's native Mermaid parser does its own layout, but it produces cramped or unbalanced output once the diagram has any structural complexity — request \"elk\" whenever ANY of these holds: >= ~20 nodes, OR >= 3 decision diamonds (`{...}` shapes), OR any feedback/back-edges (an edge pointing back to an earlier node, e.g. an error path looping to a retry), OR >= 3 distinct endpoints. The flow direction follows the flowchart code (`flowchart TD/TB` vs `LR/RL`), so there is no direction field here. Ignored for non-flowchart diagram types (sequence, class, ER, gantt, …), which lay themselves out.",
        },
        lightbox:
        {
          type: "boolean",
          description: "Open in lightbox mode (read-only view). Default: false",
        },
        dark:
        {
          type: "string",
          enum: ["auto", "true", "false"],
          description: "Dark mode setting. Default: auto",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "get_drawio_reference",
    description:
      "Returns a full draw.io diagram generation reference as Markdown. Format \"mermaid\": " +
      "the header keyword and syntax hints for every Mermaid type draw.io supports, " +
      "flowchart styling and the ELK layout; call it once before the first Mermaid " +
      "diagram in a conversation. Format \"xml\": everything beyond the rules in the " +
      "open_drawio_xml description (layers, tags, metadata and placeholders, tables, " +
      "cross-functional grids, dark-mode colors, more styles and examples); only needed when a diagram uses " +
      "those. A reference stays valid for the rest of the conversation.",
    inputSchema:
    {
      type: "object",
      properties:
      {
        format:
        {
          type: "string",
          enum: ["xml", "mermaid"],
          description: "Which reference to return: \"xml\" for open_drawio_xml, \"mermaid\" for open_drawio_mermaid.",
        },
      },
      required: ["format"],
    },
  },
  {
    name: "list_pages",
    description:
      "Lists the pages (diagrams) in a local .drawio file without loading full page content. " +
      "Returns each page's index, id, name, and approximate stored size in bytes. " +
      "Call this first on large multi-page files before get_page/set_page, so only the " +
      "page you actually need gets loaded into context.",
    inputSchema:
    {
      type: "object",
      properties:
      {
        path:
        {
          type: "string",
          description: "Absolute or relative path to the local file. Must end in .drawio or .xml.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "get_page",
    description:
      "Reads one page (diagram) from a local .drawio file and returns its raw mxGraphModel " +
      "XML, decompressing it first if the file stores that page compressed. " +
      "Use list_pages first to find the index, name, or id of the page you need.",
    inputSchema:
    {
      type: "object",
      properties:
      {
        path:
        {
          type: "string",
          description: "Absolute or relative path to the local file. Must end in .drawio or .xml.",
        },
        page:
        {
          type: "string",
          description:
            "Which page to read: a zero-based page index (e.g. \"0\"), the page's exact name, or the page's id as shown by list_pages.",
        },
      },
      required: ["path", "page"],
    },
  },
  {
    name: "set_page",
    description:
      "Replaces the content of one page (diagram) in a local .drawio file with new " +
      "mxGraphModel XML, leaving every other page in the file untouched. Compression of the " +
      "replaced page matches whatever that page's original compression state was. " +
      "Use list_pages/get_page first to find the target page.",
    inputSchema:
    {
      type: "object",
      properties:
      {
        path:
        {
          type: "string",
          description: "Absolute or relative path to the local file. Must end in .drawio or .xml.",
        },
        page:
        {
          type: "string",
          description:
            "Which page to replace: a zero-based page index (e.g. \"0\"), the page's exact name, or the page's id as shown by list_pages.",
        },
        content:
        {
          type: "string",
          description:
            "The new page content as plain mxGraphModel XML (uncompressed). Must be a single <mxGraphModel> element without any <diagram> tags.",
        },
      },
      required: ["path", "page", "content"],
    },
  },
];

// The values open_drawio_xml accepts for its pass options, from its schema —
// the only arguments recovered when a model writes them into the XML string.
const xmlToolProperties = tools.find(function(tool) { return tool.name === "open_drawio_xml"; }).inputSchema.properties;
const XML_OPTION_VALUES =
{
  postLayout: xmlToolProperties.postLayout.enum,
  direction: xmlToolProperties.direction.enum,
  routing: xmlToolProperties.routing.enum,
};

// search_shapes is always advertised; the index is loaded lazily on first call
// (local file in-repo, otherwise fetched from the CDN).
tools.push({
  name: "search_shapes",
  description:
    "Search the draw.io shape library by keywords. Returns matching shapes with " +
    "their exact style strings, dimensions, and titles. Covers ~10,000 built-in " +
    "stencils (cloud architecture, network topology, P&ID, electrical, Cisco, " +
    "Kubernetes, BPMN) and, when those are sparse, supplements results with the " +
    "draw.io icon service (brand/product logos and general-purpose concept icons, " +
    "e.g. 'react', 'slack', 'shopping cart', 'solar panel'). Use ONLY for diagrams " +
    "that need industry-specific, branded, or pictorial icons. Do NOT use for " +
    "standard diagram types like flowcharts, UML, ERD, org charts, or mind maps — " +
    "these use basic geometric shapes (rectangles, diamonds, circles, cylinders) " +
    "that are already covered in the XML reference. Also skip if the user asks to " +
    "use basic/simple shapes or says not to search. The style string from the " +
    "results can be used directly in mxCell style attributes.",
  inputSchema:
  {
    type: "object",
    properties:
    {
      query:
      {
        type: "string",
        description:
          "Space-separated search keywords (e.g. 'pid globe valve', 'aws lambda', 'cisco router', 'kubernetes pod')",
      },
      limit:
      {
        type: "number",
        description: "Maximum number of results to return (default: 10, max: 50)",
      },
    },
    required: ["query"],
  },
});

// Create the MCP server
const server = new Server(
  {
    name: "drawio-mcp",
    version: packageInfo.version,
  },
  {
    capabilities:
    {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () =>
{
  return { tools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) =>
{
  const { name, arguments: args } = request.params;

  try
  {
    if (name === "get_drawio_reference")
    {
      const format = args?.format;

      if (!Object.hasOwn(references, format))
      {
        return {
          content: [{ type: "text", text: "Error: format must be \"xml\" or \"mermaid\"" }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: references[format] }],
      };
    }

    if (name === "search_shapes")
    {
      const query = args?.query;

      if (!query)
      {
        return {
          content: [{ type: "text", text: "Error: query parameter is required" }],
          isError: true,
        };
      }

      let shapeSearch;

      try
      {
        shapeSearch = await loadShapeSearch();
      }
      catch (e)
      {
        return {
          content: [{ type: "text", text: "Error: could not load the shape search index (" + e.message + "). Set DRAWIO_SHAPE_INDEX_URL to override the source." }],
          isError: true,
        };
      }

      const limit = Math.min(args?.limit || 10, 50);
      const iconSearch = await loadIconSearch();
      const results = iconSearch
        ? await iconSearch.searchShapesAndIcons(shapeSearch.shapeIndex,
            shapeSearch.tagMap, query, limit, { serviceUrl: iconSearch.serviceUrl })
        : shapeSearch.searchShapes(shapeSearch.shapeIndex, shapeSearch.tagMap, query, limit);

      if (results.length === 0)
      {
        return {
          content: [{ type: "text", text: `No shapes found for query: ${query}` }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }

    if (name === "list_pages" || name === "get_page" || name === "set_page")
    {
      const filePath = args?.path;

      if (!filePath)
      {
        return {
          content: [{ type: "text", text: "Error: path parameter is required" }],
          isError: true,
        };
      }

      // Restrict which local files the tools may touch before checking
      // existence, so arbitrary paths aren't probed at all.
      assertPagePath(filePath);

      if (!existsSync(filePath))
      {
        return {
          content: [{ type: "text", text: `Error: file not found: ${filePath}` }],
          isError: true,
        };
      }

      if (name === "list_pages")
      {
        const fileText = readFileSync(filePath, "utf8");
        const meta = listPageMeta(fileText);

        return {
          content: [{ type: "text", text: JSON.stringify(meta, null, 2) }],
        };
      }

      const page = args?.page;

      if (page == null)
      {
        return {
          content: [{ type: "text", text: "Error: page parameter is required" }],
          isError: true,
        };
      }

      if (name === "get_page")
      {
        const result = readPageXml(filePath, page);

        return {
          content: [{ type: "text", text: result.xml }],
        };
      }

      const newContent = args?.content;

      if (!newContent)
      {
        return {
          content: [{ type: "text", text: "Error: content parameter is required" }],
          isError: true,
        };
      }

      const result = writePageXml(filePath, page, newContent);

      return {
        content: [{ type: "text", text: `Updated page ${result.index} ("${result.name}") in ${filePath}.` }],
      };
    }

    let content;
    let type;
    const lightbox = args?.lightbox === true;
    const darkArg = args?.dark;
    const dark = darkArg === "true" ? true : darkArg === "false" ? false : "auto";

    const inputContent = args?.content;

    if (!inputContent)
    {
      return {
        content:
        [
          {
            type: "text",
            text: "Error: content parameter is required",
          },
        ],
        isError: true,
      };
    }

    if (typeof inputContent !== "string")
    {
      const actualType = typeof inputContent;
      const preview = JSON.stringify(inputContent).substring(0, 200);

      return {
        content:
        [
          {
            type: "text",
            text: `Error: content parameter must be a string, but received ${actualType}: ${preview}\n\n` +
              "Common mistake: passing a JSON object or nested structure instead of a plain string. " +
              "Make sure the diagram content (XML, CSV, or Mermaid) is passed directly as a string value.",
          },
        ],
        isError: true,
      };
    }

    content = inputContent;

    switch (name)
    {
      case "open_drawio_xml":
        type = "xml";
        break;
      case "open_drawio_csv":
        type = "csv";
        break;
      case "open_drawio_mermaid":
        type = "mermaid";
        break;
      default:
        return {
          content:
          [
            {
              type: "text",
              text: `Error: Unknown tool "${name}"`,
            },
          ],
          isError: true,
        };
    }

    const notes = [];

    // The XML passes to run: the arguments, plus any the model wrote into the
    // XML string instead of passing them (see leakedArguments).
    const xmlOptions =
    {
      postLayout: args?.postLayout,
      direction: args?.direction,
      routing: args?.routing,
    };

    // XML: fix the mechanical slips first, so that the normalizer and the
    // passes get XML they can parse — text around the diagram, `<` or a stray
    // `&` in attribute values, a layer that is its own parent. Byte-identical
    // on a well-formed diagram.
    if (type === "xml")
    {
      try
      {
        const repair = await loadRepair();
        const repaired = repair.repairDiagramXml(content);
        const leaked = repair.leakedArguments(repaired.trailing, XML_OPTION_VALUES);

        content = repaired.xml;

        for (const key of Object.keys(leaked))
        {
          if (xmlOptions[key] == null)
          {
            xmlOptions[key] = leaked[key];
          }
        }
      }
      catch (error)
      {
        console.error("[repair] skipped: " +
          (error instanceof Error ? error.message : String(error)));
      }
    }

    // XML: repair the model before any pass sees it — edges to the nearest
    // common ancestor of their terminals (LLM XML parks them on the layer,
    // which renders fine but lays out wrong, jgraph/drawio-mcp#64), a
    // geometry for edges written without one (they don't render at all), and
    // containers grown around children they would clip. Same repairs as the
    // desktop CLI's --normalize, and doing them here keeps the layout itself
    // free of hierarchy side effects. Never throws: the normalizer leaves a
    // page it can't parse exactly as it was.
    if (type === "xml")
    {
      try
      {
        const mod = await loadNormalize();

        content = mod.normalizeDiagram(content).xml;
        const labels = await loadLabelPerimeter();

        content = labels.fitEdgeLabels(labels.addLabelPerimeters(content).xml).xml;
      }
      catch (error)
      {
        // Structurally the diagram is still what the LLM sent - open it.
        console.error("[normalize] skipped: " +
          (error instanceof Error ? error.message : String(error)));
      }
    }

    // XML only: optional server-side passes before the diagram is compressed
    // into the URL. ELK places the vertices, libavoid only re-routes the
    // edges — the two are alternatives, but running both is harmless (ELK
    // first, then the router over its positions).

    if (type === "xml" && xmlOptions.postLayout === "elk")
    {
      try
      {
        content = await layoutXml(content, { direction: xmlOptions.direction });
      }
      catch (error)
      {
        // The layout is the whole point of the request, so say it didn't run
        // instead of quietly opening an unlaid-out diagram.
        notes.push("NOTE: the ELK layout pass could not run (" +
          (error instanceof Error ? error.message : String(error)) +
          "); the diagram opened with the coordinates you supplied. " +
          "Retry, or place the cells yourself.");
      }
    }

    if (type === "xml" && xmlOptions.routing === "libavoid")
    {
      // routeXml never throws - it returns the original XML if routing isn't
      // applicable or anything fails.
      content = await routeXml(content);
    }

    // Mermaid: selecting ELK is a text transform on the source — draw.io runs
    // the layout itself when it converts the Mermaid behind the #create= URL
    // (EditorUi.isMermaidElkFlowchart -> applyMermaidElkPostPass), so there is
    // nothing to compute here.
    if (type === "mermaid" && args?.postLayout === "elk")
    {
      try
      {
        const mermaidElk = await loadMermaidElk();

        if (mermaidElk.isFlowchartSource(content))
        {
          content = mermaidElk.withElkLayout(content);
        }
        else
        {
          notes.push("NOTE: postLayout only applies to Mermaid flowcharts — " +
            "ignored for this diagram type (" +
            (mermaidElk.mermaidDiagramType(content) || "unknown") +
            "), which lays itself out.");
        }
      }
      catch (error)
      {
        notes.push("NOTE: the ELK layout selector could not be applied (" +
          (error instanceof Error ? error.message : String(error)) +
          "); the diagram opened with draw.io's default Mermaid layout.");
      }
    }

    const url = generateDrawioUrl(content, type, { lightbox, dark });

    // Open the URL in the default browser
    openBrowser(url);

    return {
      content:
      [
        {
          type: "text",
          text: `Draw.io Editor URL:\n${url}\n\nThe diagram has been opened in your default browser.` +
            (notes.length > 0 ? "\n\n" + notes.join("\n") : ""),
        },
      ],
    };
  }
  catch (error)
  {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content:
      [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main()
{
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Draw.io MCP server running on stdio");
}

main().catch((error) =>
{
  console.error("Fatal error:", error);
  process.exit(1);
});
