// One agent session per call: Claude Code (`claude -p`) or Codex CLI
// (`codex exec`), started in an empty working folder with the condition's
// draw.io integration (none, the hosted MCP server, the plugin, or the fast
// mode's server) and nothing else of the user's setup. Every stream line is
// saved with its time; the working folder is watched, so the time a file
// appeared and last changed is known for any agent.
//
// What each agent gets of the user's setup:
// - Claude Code: --setting-sources project,local (no user settings, user
//   plugins or user skills), --strict-mcp-config (no user MCP servers),
//   --no-session-persistence, auto-memory off, every tool, permissions
//   skipped.
// - Codex: --ignore-user-config (no user config, MCP servers or plugins),
//   apps, plugins and remote plugins off, HOME set to an empty folder (no
//   skills from ~/.agents/skills), CODEX_HOME left as it is for the sign-in,
//   --ephemeral, the workspace-write sandbox with network access.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The agents the bench knows: the CLI family and the model it runs. */
export const AGENTS =
{
  "claude-sonnet": { family: "claude", model: "sonnet", label: "Claude Code, Sonnet" },
  "claude-opus": { family: "claude", model: "opus", label: "Claude Code, Opus" },
  "codex": { family: "codex", model: process.env.BENCH_CODEX_MODEL || "gpt-6.1-sol",
    effort: process.env.BENCH_CODEX_EFFORT || "medium", label: "Codex CLI" }
};

// Files and folders of the working folder that are tooling, not output.
const SKIP_DIRS = new Set(["node_modules", ".venv", "venv", "__pycache__", ".git", ".cache", ".npm", ".claude", ".codex",
  ".agents", ".config", ".local"]);

/**
 * Starts a watcher over a folder: every 250 ms the files in it (tooling
 * folders left out) with the time they appeared and last changed, in
 * seconds from t0. stop() takes a last look and returns the list.
 */
export function watchFolder(dir, t0)
{
  const seen = new Map();

  function scan(d, rel)
  {
    let entries;

    try
    {
      entries = fs.readdirSync(d, { withFileTypes: true });
    }
    catch (e)
    {
      return;
    }

    for (const e of entries)
    {
      const p = path.join(d, e.name);
      const r = rel ? rel + "/" + e.name : e.name;

      if (e.isDirectory())
      {
        if (!SKIP_DIRS.has(e.name) && r.split("/").length < 4)
        {
          scan(p, r);
        }
      }
      else if (e.isFile())
      {
        let st;

        try
        {
          st = fs.statSync(p);
        }
        catch (err)
        {
          continue;
        }

        const now = (Date.now() - t0) / 1000;
        const prev = seen.get(r);

        if (prev == null)
        {
          seen.set(r, { path: r, bytes: st.size, mtime: st.mtimeMs, firstSecs: now, lastSecs: now });
        }
        else if (prev.mtime !== st.mtimeMs || prev.bytes !== st.size)
        {
          prev.mtime = st.mtimeMs;
          prev.bytes = st.size;
          prev.lastSecs = now;
        }
      }
    }
  }

  const timer = setInterval(function() { scan(dir, ""); }, 250);

  return {
    stop: function()
    {
      clearInterval(timer);
      scan(dir, "");

      return Array.from(seen.values()).map(function(f)
      {
        return { path: f.path, bytes: f.bytes, firstSecs: Math.round(f.firstSecs * 10) / 10,
          lastSecs: Math.round(f.lastSecs * 10) / 10 };
      }).sort(function(a, b) { return a.path.localeCompare(b.path); });
    }
  };
}

/**
 * The environment of an agent process: the bench's stubs first on PATH (an
 * `xdg-open` that only logs, so nothing opens a window), and the caches of
 * the tools an agent may run inside the run folder.
 */
export function agentEnv(out, extra)
{
  const bin = path.join(out, "bin");
  const env = Object.assign({}, process.env);

  if (!fs.existsSync(path.join(bin, "xdg-open")))
  {
    fs.mkdirSync(bin, { recursive: true });
    const stub = "#!/bin/sh\necho \"$(date +%s) $0 $*\" >> \"" + path.join(bin, "opened.log") + "\"\nexit 0\n";

    for (const name of ["xdg-open", "open", "sensible-browser", "x-www-browser", "gio", "wslview"])
    {
      fs.writeFileSync(path.join(bin, name), stub, { mode: 0o755 });
    }
  }

  const cache = path.join(out, "agent-cache");
  env.PATH = bin + path.delimiter + env.PATH;
  env.XDG_CACHE_HOME = path.join(cache, "xdg");
  env.MPLCONFIGDIR = path.join(cache, "matplotlib");
  env.PIP_CACHE_DIR = path.join(cache, "pip");
  env.PYTHONUSERBASE = path.join(cache, "python-user");
  env.BROWSER = path.join(bin, "xdg-open");
  // the bench's own module path is not the agent's
  delete env.NODE_PATH;

  return Object.assign(env, extra || {});
}

function lines(stream, onLine)
{
  let buf = "";

  stream.on("data", function(d)
  {
    buf += d.toString();
    let i;

    while ((i = buf.indexOf("\n")) >= 0)
    {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);

      if (line.trim() !== "")
      {
        onLine(line);
      }
    }
  });
}

/**
 * Runs one session and resolves with { events, files, secs, timedOut,
 * exitCode }. `spec`: { agent, prompt, workdir, logFile, timeout, mcp,
 * pluginDir, skillDir, out }:
 * - mcp: { url } for an HTTP server, or { command, args, env } for stdio;
 * - pluginDir: a Claude Code plugin to load (--plugin-dir);
 * - skillDir: a skill folder to install for Codex (copied to the empty
 *   HOME's .agents/skills).
 */
export function runSession(spec)
{
  const agent = AGENTS[spec.agent];
  const t0 = Date.now();
  const log = fs.createWriteStream(spec.logFile);
  const events = [];
  let cmd;
  let argv;
  let env;

  fs.mkdirSync(spec.workdir, { recursive: true });

  if (agent.family === "claude")
  {
    cmd = process.env.BENCH_CLAUDE || "claude";
    argv = ["-p", spec.prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--model", agent.model, "--setting-sources", "project,local", "--strict-mcp-config", "--no-session-persistence",
      "--settings", JSON.stringify({ autoMemoryEnabled: false }), "--dangerously-skip-permissions"];

    if (spec.mcp != null)
    {
      const server = spec.mcp.url != null ? { type: "http", url: spec.mcp.url } :
        { type: "stdio", command: spec.mcp.command, args: spec.mcp.args, env: spec.mcp.env || {} };
      const file = spec.logFile.replace(/\.jsonl$/, "-mcp-config.json");
      fs.writeFileSync(file, JSON.stringify({ mcpServers: { drawio: server } }));
      argv.push("--mcp-config", file);
    }

    if (spec.pluginDir != null)
    {
      argv.push("--plugin-dir", spec.pluginDir);
    }

    env = agentEnv(spec.out);
  }
  else
  {
    const home = path.join(spec.out, "home", path.basename(spec.workdir));
    fs.mkdirSync(home, { recursive: true });

    if (spec.skillDir != null)
    {
      fs.cpSync(spec.skillDir, path.join(home, ".agents", "skills", path.basename(spec.skillDir)), { recursive: true });
    }

    cmd = process.env.BENCH_CODEX || "codex";
    argv = ["exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--json",
      "--disable", "apps", "--disable", "plugins", "--disable", "remote_plugin", "--disable", "shell_snapshot",
      "-m", agent.model, "-c", "model_reasoning_effort=\"" + agent.effort + "\"",
      "-s", "workspace-write", "-c", "sandbox_workspace_write.exclude_slash_tmp=true",
      "-c", "sandbox_workspace_write.network_access=true", "-C", spec.workdir];

    if (spec.mcp != null)
    {
      if (spec.mcp.url != null)
      {
        argv.push("-c", "mcp_servers.drawio.url=" + JSON.stringify(spec.mcp.url));
      }
      else
      {
        argv.push("-c", "mcp_servers.drawio.command=" + JSON.stringify(spec.mcp.command));
        argv.push("-c", "mcp_servers.drawio.args=" + JSON.stringify(spec.mcp.args));
        const pairs = Object.keys(spec.mcp.env || {}).map(function(k) { return k + "=" + JSON.stringify(spec.mcp.env[k]); });
        argv.push("-c", "mcp_servers.drawio.env={" + pairs.join(",") + "}");
      }

      // the server's tools run without asking, as they do in Claude Code with permissions skipped
      argv.push("-c", "mcp_servers.drawio.default_tools_approval_mode=\"approve\"");
    }

    argv.push(spec.prompt);
    env = agentEnv(spec.out, { HOME: home, CODEX_HOME: process.env.CODEX_HOME || path.join(os.homedir(), ".codex") });
  }

  const watcher = watchFolder(spec.workdir, t0);

  return new Promise(function(resolve)
  {
    const child = spawn(cmd, argv, { cwd: spec.workdir, env: env, stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false;
    const timer = setTimeout(function()
    {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(function() { child.kill("SIGKILL"); }, 5000);
    }, spec.timeout);

    lines(child.stdout, function(line)
    {
      let e;

      try
      {
        e = JSON.parse(line);
      }
      catch (err)
      {
        e = { type: "raw", text: line.slice(0, 2000) };
      }

      const ev = { t: Date.now() - t0, e: e };
      events.push(ev);
      log.write(JSON.stringify(ev) + "\n");
    });

    child.stderr.on("data", function(d)
    {
      fs.appendFileSync(spec.logFile.replace(/\.jsonl$/, ".stderr"), d);
    });

    child.on("close", function(code)
    {
      clearTimeout(timer);
      log.end();
      resolve({ events: events, files: watcher.stop(), secs: Math.round((Date.now() - t0) / 100) / 10,
        timedOut: timedOut, exitCode: code, command: [path.basename(cmd)].concat(argv.filter(function(a)
        {
          return a !== spec.prompt;
        })) });
    });
  });
}
