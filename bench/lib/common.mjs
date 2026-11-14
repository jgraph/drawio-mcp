// Helpers shared by the bench scripts: paths, argument parsing, a minimal
// MCP client over stdio, and the npm packages the bench needs (resolved from
// bench/node_modules, or from NODE_PATH when they are installed elsewhere).

import { spawn } from "node:child_process";
import fs from "node:fs";
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

/**
 * The prompts of prompts.json by key: { type, split ("dev" | "held-out"),
 * size ("normal" | "large"), prompt, edit }.
 */
export function loadPrompts()
{
  return JSON.parse(fs.readFileSync(path.join(BENCH, "prompts.json"), "utf8"));
}

/**
 * The prompt keys a script works on: --prompts (keys, comma-separated;
 * default all), narrowed by --type, --split and --size (each one value or
 * several, comma-separated).
 */
export function selectKeys(prompts, args)
{
  const list = function(v) { return (v == null || v === true) ? null : String(v).split(","); };
  const keys = list(args.prompts) || Object.keys(prompts);
  const unknown = keys.filter(function(k) { return prompts[k] == null; });

  if (unknown.length > 0)
  {
    console.error("Unknown prompt" + (unknown.length > 1 ? "s" : "") + ": " + unknown.join(", "));
    process.exit(1);
  }

  const types = list(args.type);
  const splits = list(args.split);
  const sizes = list(args.size);

  return keys.filter(function(k)
  {
    const p = prompts[k];

    return (types == null || types.includes(p.type)) && (splits == null || splits.includes(p.split)) &&
      (sizes == null || sizes.includes(p.size));
  });
}

/** The tag of one run's files: <variant>-<key>-<model>-<repeat>. */
export function runTag(variant, key, model, repeat)
{
  return [variant, key, model, repeat].join("-");
}

/** Runs fn over the items, at most `parallel` at a time. */
export async function pool(items, parallel, fn)
{
  let next = 0;

  async function worker()
  {
    while (next < items.length)
    {
      const i = next++;
      await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, items.length)) }, worker));
}

export function round(x, digits)
{
  const f = Math.pow(10, digits || 0);

  return (x == null || isNaN(x)) ? null : Math.round(x * f) / f;
}

export function readJson(file)
{
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
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
export async function connectStdio(command, args, env)
{
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"],
    env: env != null ? Object.assign({}, process.env, env) : process.env });
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
