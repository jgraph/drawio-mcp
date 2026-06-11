#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import pako from "pako";
import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRAWIO_BASE_URL = process.env.DRAWIO_BASE_URL || "https://app.diagrams.net/";

// Read the shared XML reference once at startup (single source of truth).
// In the repo: read from shared/. When installed via npm: read from the
// local copy created by the prepack script.
const sharedPath = join(__dirname, "..", "..", "shared", "xml-reference.md");
const localPath = join(__dirname, "xml-reference.md");
const xmlReference = readFileSync(
  existsSync(sharedPath) ? sharedPath : localPath,
  "utf-8"
);

// Same dual-path lookup for the Mermaid reference. Appended to the
// open_drawio_mermaid tool description so LLMs get concrete syntax hints
// for every supported diagram type (26) plus flowchart styling.
const sharedMermaidPath = join(__dirname, "..", "..", "shared", "mermaid-reference.md");
const localMermaidPath = join(__dirname, "mermaid-reference.md");
const mermaidReference = readFileSync(
  existsSync(sharedMermaidPath) ? sharedMermaidPath : localMermaidPath,
  "utf-8"
);
const packageJsonPath = join(__dirname, "..", "package.json");
const packageInfo = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

function printHelp()
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
}

function handleCliArgs(args)
{
  if (args.length === 0) return false;

  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))
  {
    printHelp();
    return true;
  }

  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v"))
  {
    console.log(packageInfo.version);
    return true;
  }

  console.error(`Unknown option: ${args[0]}`);
  console.error("Run `drawio-mcp --help` for usage.");
  process.exit(1);
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
    // drops everything after # in URLs, so the #create=... fragment
    // (which carries the entire diagram payload) is silently lost.
    // Writing a temporary .url file preserves the full URL intact.
    const tmpFile = join(tmpdir(), "drawio-mcp-" + Date.now() + ".url");
    writeFileSync(tmpFile, "[InternetShortcut]\r\nURL=" + url + "\r\n");
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
 * Generates a draw.io URL with the #create hash parameter
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

  const createObj = {
    type: type,
    compressed: true,
    data: compressedData,
  };

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

  const createHash = "#create=" + encodeURIComponent(JSON.stringify(createObj));
  const paramsStr = params.toString();

  return DRAWIO_BASE_URL + (paramsStr ? "?" + paramsStr : "") + createHash;
}

// Define the tools
const tools =
[
  {
    name: "open_drawio_xml",
    description:
      "Opens the draw.io editor with a diagram from XML content. " +
      "Use this to view, edit, or create diagrams in draw.io format. " +
      "The XML should be valid draw.io/mxGraph XML format.\n\n" +
      xmlReference,
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
      "Opens the draw.io editor with a diagram generated from Mermaid.js syntax. " +
      "Supports flowcharts, sequence diagrams, class diagrams, state diagrams, " +
      "entity relationship diagrams, and more using Mermaid.js syntax.\n\n" +
      mermaidReference,
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
];

// Create the MCP server
const server = new Server(
  {
    name: "drawio-mcp",
    version: "1.0.0",
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

    const url = generateDrawioUrl(content, type, { lightbox, dark });

    // Open the URL in the default browser
    openBrowser(url);

    return {
      content:
      [
        {
          type: "text",
          text: `Draw.io Editor URL:\n${url}\n\nThe diagram has been opened in your default browser.`,
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
  if (handleCliArgs(process.argv.slice(2))) return;

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Draw.io MCP server running on stdio");
}

main().catch((error) =>
{
  console.error("Fatal error:", error);
  process.exit(1);
});
