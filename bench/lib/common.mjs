// Helpers shared by the bench scripts: paths, argument parsing, a minimal
// MCP client over stdio, and the npm packages the bench needs (resolved from
// bench/node_modules, or from NODE_PATH when they are installed elsewhere).

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = path.resolve(BENCH, "..");
export const APP_SERVER = path.join(REPO, "mcp-app-server", "src", "index.js");

export const require = createRequire(path.join(BENCH, "package.json"));

/**
 * --key value and --flag arguments into an object; the rest under "_".
 */
export function parseArgs(argv)
{
  const out = { _: [] };

  for (let i = 0; i < argv.length; i++)
  {
    const a = argv[i];

    if (a.startsWith("--"))
    {
      const key = a.slice(2);
      const next = argv[i + 1];

      if (next == null || next.startsWith("--"))
      {
        out[key] = true;
      }
      else
      {
        out[key] = next;
        i++;
      }
    }
    else
    {
      out._.push(a);
    }
  }

  return out;
}

export function outDir(args)
{
  return path.resolve(args.out || process.env.BENCH_OUT || path.join(BENCH, "out"));
}

export function median(values)
{
  const v = values.filter(function(x) { return typeof x === "number" && !isNaN(x); }).sort(function(a, b) { return a - b; });

  if (v.length === 0)
  {
    return null;
  }

  const m = Math.floor(v.length / 2);

  return (v.length % 2) ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Starts an MCP server over stdio and returns call(method, params) and
 * close().
 */
export async function connectStdio(command, args)
{
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
  const pending = new Map();
  let buf = "";
  let nextId = 1;

  child.stdout.on("data", function(d)
  {
    buf += d.toString();
    let i;

    while ((i = buf.indexOf("\n")) >= 0)
    {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);

      if (line.trim() === "")
      {
        continue;
      }

      const msg = JSON.parse(line);

      if (msg.id != null && pending.has(msg.id))
      {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });

  function call(method, params)
  {
    return new Promise(function(resolve)
    {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params }) + "\n");
    });
  }

  await call("initialize", { protocolVersion: "2025-06-18",
    capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
    clientInfo: { name: "drawio-bench", version: "1" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  return {
    call: call,
    close: function() { child.kill(); }
  };
}

/** A new ELK instance from elkjs. */
export function newElk()
{
  const ELK = require("elkjs/lib/elk.bundled.js");

  return new ELK();
}
