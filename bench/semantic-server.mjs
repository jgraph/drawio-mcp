// A stdio MCP server with one tool, create_semantic_diagram, that runs the
// semantic engine (shared/semantic) and answers like create_diagram: the
// diagram's XML as JSON text, so the model has it in context for changes.
// Every call is saved as <tag>-call<n>.json (arguments, XML, warnings,
// stats) in BENCH_RUN_DIR.
//
// Env: BENCH_RUN_DIR, BENCH_TAG, SEMANTIC_TYPES (comma-separated, default:
// every supported type).

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { newElk } from "./lib/common.mjs";
import { semanticToXml, SUPPORTED_TYPES } from "../shared/semantic/index.js";
import { describeTool } from "../shared/semantic/description.js";

const runDir = process.env.BENCH_RUN_DIR || ".";
const tag = process.env.BENCH_TAG || "run";
const types = (process.env.SEMANTIC_TYPES || SUPPORTED_TYPES.join(",")).split(",");
const elk = newElk();
let count = 0;

const schema =
{
  type: "object",
  properties:
  {
    type: { type: "string", enum: types },
    title: { type: "string" },
    nodes: { type: "array", items: { type: "object" } },
    edges: { type: "array", items: { type: "object" } }
  },
  required: ["type", "nodes"]
};

function send(msg)
{
  process.stdout.write(JSON.stringify(msg) + "\n");
}

readline.createInterface({ input: process.stdin }).on("line", async function(line)
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

  if (msg.method === "initialize")
  {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params.protocolVersion,
      capabilities: { tools: {} }, serverInfo: { name: "drawio-semantic-bench", version: "0.1.0" } } });
  }
  else if (msg.method === "tools/list")
  {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "create_semantic_diagram",
      description: describeTool(types), inputSchema: schema }] } });
  }
  else if (msg.method === "tools/call")
  {
    count++;
    const args = msg.params.arguments || {};
    const r = await semanticToXml(args, { elk: elk });
    fs.writeFileSync(path.join(runDir, tag + "-call" + count + ".json"), JSON.stringify({ arguments: args,
      xml: r.xml, error: r.error, warnings: r.warnings, stats: r.stats }, null, 1));
    const content = r.error != null ? [{ type: "text", text: r.error }] :
      [{ type: "text", text: JSON.stringify({ xml: r.xml }) }];

    if (r.warnings.length > 0)
    {
      content.push({ type: "text", text: "WARNINGS:\n- " + r.warnings.join("\n- ") });
    }

    send({ jsonrpc: "2.0", id: msg.id, result: { content: content, isError: r.error != null } });
  }
  else if (msg.id != null)
  {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
  }
});
