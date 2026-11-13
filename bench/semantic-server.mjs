// A stdio MCP server with the tool create_semantic_diagram, which runs the
// semantic engine (shared/semantic). Every call is saved as
// <tag>-call<n>.json (arguments, XML, warnings, stats) in BENCH_RUN_DIR.
//
// The result is a short text (how many shapes were drawn and how to change
// the diagram) plus the engine's warnings, so the model doesn't read the XML
// back; SEMANTIC_RESULT=xml answers with the XML as JSON text instead, like
// create_diagram.
//
// With BENCH_WITH_APP=1 the server also offers the app server's tools: it
// starts the app server over stdio, passes every message through and adds
// its own tool to tools/list, so a model can choose between create_diagram
// and create_semantic_diagram. BENCH_FORMAT_RULE=1 then appends a sentence to
// the create_diagram description that sends the types below to the semantic
// tool.
//
// Env: BENCH_RUN_DIR, BENCH_TAG, SEMANTIC_TYPES (comma-separated, default:
// every supported type), SEMANTIC_HINTS (off: placement hints are neither
// described nor used), SEMANTIC_RESULT (xml), SEMANTIC_REPLY_NOTE (off: no
// request for a short reply after the result), BENCH_WITH_APP,
// BENCH_FORMAT_RULE.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { APP_SERVER, newElk } from "./lib/common.mjs";
import { semanticToXml, SUPPORTED_TYPES } from "../shared/semantic/index.js";
import { describeTool, describeSchema } from "../shared/semantic/description.js";

const TOOL = "create_semantic_diagram";
const FORMAT_RULE = " For architecture, cloud, network and swimlane-flowchart diagrams, use " + TOOL + " instead.";
// The app server ends every create_diagram result with this request; the
// same words here, so the length of the reply doesn't differ by tool.
const REPLY_NOTE = "The user already sees this diagram in the chat, so don't describe or list what it shows. " +
  "Once you're done drawing, reply in at most two sentences unless the user asked for an explanation: " +
  "for example what you assumed or changed, or an offer of a next step.";

const runDir = process.env.BENCH_RUN_DIR || ".";
const tag = process.env.BENCH_TAG || "run";
const types = (process.env.SEMANTIC_TYPES || SUPPORTED_TYPES.join(",")).split(",");
const hints = process.env.SEMANTIC_HINTS === "ask" ? "ask" : process.env.SEMANTIC_HINTS !== "off";
const resultXml = process.env.SEMANTIC_RESULT === "xml";
const replyNote = process.env.SEMANTIC_REPLY_NOTE !== "off";
const withApp = process.env.BENCH_WITH_APP === "1";
const formatRule = process.env.BENCH_FORMAT_RULE === "1";
const elk = newElk();
let count = 0;

function tool()
{
  return { name: TOOL, description: describeTool(types, { hints: hints }), inputSchema: describeSchema(types, { hints: hints }) };
}

function send(msg)
{
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function callTool(args)
{
  count++;
  let r;

  try
  {
    r = await semanticToXml(args, { elk: elk, hints: hints });
  }
  catch (e)
  {
    r = { xml: null, error: "The diagram could not be drawn: " + e.message, warnings: [], stats: null };
  }

  const warnings = r.warnings || [];
  fs.writeFileSync(path.join(runDir, tag + "-call" + count + ".json"), JSON.stringify({ arguments: args,
    xml: r.xml, error: r.error, warnings: warnings, stats: r.stats, hints: hints }, null, 1));

  if (r.error != null || r.xml == null)
  {
    return { content: [{ type: "text", text: r.error || "The diagram could not be drawn." }], isError: true };
  }

  const shapes = (r.xml.match(/\bvertex="1"/g) || []).length;
  const content = [{ type: "text", text: resultXml ? JSON.stringify({ xml: r.xml }) :
    "The diagram is drawn: " + shapes + " shapes. To change it, call this tool again with the whole changed " +
    "description and the same ids." }];

  if (warnings.length > 0)
  {
    content.push({ type: "text", text: "WARNINGS:\n- " + warnings.join("\n- ") });
  }

  if (replyNote)
  {
    content.push({ type: "text", text: REPLY_NOTE });
  }

  return { content: content, isError: false };
}

// ─── With the app server's tools ─────────────────────────────────

let app = null;
// ids of the tools/list requests passed on, whose answers get the extra tool
const listRequests = new Set();

function startApp()
{
  app = spawn(process.execPath, [APP_SERVER, "--stdio"], { stdio: ["pipe", "pipe", "ignore"] });

  readline.createInterface({ input: app.stdout }).on("line", function(line)
  {
    let msg;

    try
    {
      msg = JSON.parse(line);
    }
    catch (e)
    {
      return;
    }

    if (msg.id != null && listRequests.has(msg.id) && msg.result && Array.isArray(msg.result.tools))
    {
      listRequests.delete(msg.id);

      if (formatRule)
      {
        for (const t of msg.result.tools)
        {
          if (t.name === "create_diagram")
          {
            t.description += FORMAT_RULE;
          }
        }
      }

      msg.result.tools.push(tool());
    }

    send(msg);
  });

  app.on("exit", function()
  {
    process.exit(0);
  });
}

function toApp(msg)
{
  app.stdin.write(JSON.stringify(msg) + "\n");
}

// ─── Requests ────────────────────────────────────────────────────

if (withApp)
{
  startApp();
}

const input = readline.createInterface({ input: process.stdin });

input.on("line", async function(line)
{
  let msg;

  try
  {
    msg = JSON.parse(line);
  }
  catch (e)
  {
    return;
  }

  if (msg.method === "tools/call" && msg.params && msg.params.name === TOOL)
  {
    send({ jsonrpc: "2.0", id: msg.id, result: await callTool(msg.params.arguments || {}) });
  }
  else if (withApp)
  {
    if (msg.method === "tools/list")
    {
      listRequests.add(msg.id);
    }

    toApp(msg);
  }
  else if (msg.method === "initialize")
  {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params.protocolVersion,
      capabilities: { tools: {} }, serverInfo: { name: "drawio-semantic-bench", version: "0.1.0" } } });
  }
  else if (msg.method === "tools/list")
  {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: [tool()] } });
  }
  else if (msg.method === "tools/call")
  {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "Unknown tool: " + (msg.params && msg.params.name) } });
  }
  else if (msg.id != null)
  {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
  }
});

input.on("close", function()
{
  if (app != null)
  {
    app.kill();
  }
});
