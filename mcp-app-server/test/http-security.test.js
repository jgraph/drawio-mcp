import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readAuthToken, tokenMatches, parseAllowedOrigins, originAllowed, normalizeOrigin, isLoopbackAddress, securityBanner, parseList, parseAllowedHosts } from "../src/http-security.js";

// The access control of the Node HTTP entry: the optional bearer token
// (AUTH_TOKEN / AUTH_TOKEN_FILE), the Origin check against DNS rebinding
// (ALLOWED_ORIGINS), the Host check (ALLOWED_HOSTS) and the startup banner
// that states them. The functions first, then src/index.js started on a free
// loopback port, as `npm start` and the Docker image run it.

const INDEX_JS = fileURLToPath(new URL("../src/index.js", import.meta.url));
const TOKEN = "d1a5c0ffee-9f3b7e2a4c6d8e0f1a2b3c4d5e6f7a8b";

const INITIALIZE = JSON.stringify(
{
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "http-security-test", version: "0" } },
});

describe("readAuthToken", function()
{
  test("is off without AUTH_TOKEN and AUTH_TOKEN_FILE", function()
  {
    assert.equal(readAuthToken({}), null);
  });

  test("reads AUTH_TOKEN, trimmed", function()
  {
    assert.deepEqual(readAuthToken({ AUTH_TOKEN: " " + TOKEN + "\n" }), { token: TOKEN, source: "AUTH_TOKEN" });
  });

  test("reads the file AUTH_TOKEN_FILE names, as a Docker secret is mounted", function()
  {
    const read = function(file)
    {
      assert.equal(file, "/run/secrets/drawio_mcp_token");
      return TOKEN + "\n";
    };

    assert.deepEqual(readAuthToken({ AUTH_TOKEN_FILE: "/run/secrets/drawio_mcp_token" }, read),
      { token: TOKEN, source: "AUTH_TOKEN_FILE" });
  });

  test("refuses settings that would leave authentication off unnoticed, without the token in the message", function()
  {
    const cases =
    [
      [{ AUTH_TOKEN: TOKEN, AUTH_TOKEN_FILE: "/x" }, /not both/],
      [{ AUTH_TOKEN: "" }, /AUTH_TOKEN is set but the token is empty/],
      [{ AUTH_TOKEN: "   " }, /empty/],
      [{ AUTH_TOKEN_FILE: "" }, /AUTH_TOKEN_FILE is set but empty/],
      [{ AUTH_TOKEN: "two words" + TOKEN }, /visible ASCII/],
      [{ AUTH_TOKEN: "tök" + TOKEN }, /visible ASCII/],
    ];

    for (const [env, message] of cases)
    {
      assert.throws(function() { readAuthToken(env); }, function(e)
      {
        assert.match(e.message, message);
        assert.ok(!e.message.includes(TOKEN), "the error names the token");
        return true;
      });
    }

    assert.throws(function()
    {
      readAuthToken({ AUTH_TOKEN_FILE: "/nonexistent/token" }, function() { throw Object.assign(new Error("nope"), { code: "ENOENT" }); });
    }, /cannot read \/nonexistent\/token \(ENOENT\)/);

    assert.throws(function()
    {
      readAuthToken({ AUTH_TOKEN_FILE: "/run/secrets/empty" }, function() { return "\n"; });
    }, /AUTH_TOKEN_FILE is set but the token is empty/);
  });
});

test("tokenMatches compares whole tokens of any length", function()
{
  assert.equal(tokenMatches(TOKEN, TOKEN), true);
  assert.equal(tokenMatches(TOKEN + "x", TOKEN), false);
  assert.equal(tokenMatches(TOKEN.slice(0, -1), TOKEN), false);
  assert.equal(tokenMatches("", TOKEN), false);
  assert.equal(tokenMatches(TOKEN.toUpperCase(), TOKEN), false);
});

describe("the Origin check", function()
{
  test("allows loopback origins by default, on any port", function()
  {
    for (const origin of ["http://localhost:6274", "http://127.0.0.1:3001", "https://localhost", "http://[::1]:8080", "HTTP://LOCALHOST:5173"])
    {
      assert.equal(originAllowed(origin, null), true, origin);
    }
  });

  test("refuses other origins by default: a page that rebinds its name to 127.0.0.1 stays outside", function()
  {
    for (const origin of ["http://evil.example:3001", "http://localhost.evil.example", "https://127.0.0.1.nip.io", "null", "file://", "not an origin", "ftp://localhost"])
    {
      assert.equal(originAllowed(origin, null), false, origin);
    }
  });

  test("lets requests without an Origin pass: MCP clients outside a browser send none", function()
  {
    assert.equal(originAllowed(undefined, null), true);
    assert.equal(originAllowed(undefined, parseAllowedOrigins("https://chat.example.com")), true);
  });

  test("ALLOWED_ORIGINS replaces the default, compared as browsers send origins", function()
  {
    const allowed = parseAllowedOrigins(" https://Chat.Example.com:443/ , vscode-webview://abc123,null");

    assert.deepEqual(allowed.origins, ["https://chat.example.com", "vscode-webview://abc123", "null"]);
    assert.equal(originAllowed("https://chat.example.com", allowed), true);
    assert.equal(originAllowed("vscode-webview://abc123", allowed), true);
    assert.equal(originAllowed("null", allowed), true);
    assert.equal(originAllowed("http://chat.example.com", allowed), false);
    assert.equal(originAllowed("https://chat.example.com:8443", allowed), false);
    assert.equal(originAllowed("http://localhost:6274", allowed), false);
  });

  test("ALLOWED_ORIGINS=* allows any origin; unset or empty is the default; a non-origin stops the server", function()
  {
    assert.equal(originAllowed("http://evil.example", parseAllowedOrigins("*")), true);
    assert.equal(parseAllowedOrigins(undefined), null);
    assert.equal(parseAllowedOrigins(" , "), null);
    assert.throws(function() { parseAllowedOrigins("chat.example.com"); }, /ALLOWED_ORIGINS: "chat.example.com" is not an origin/);
    assert.equal(normalizeOrigin("https://a.example/path?q"), "https://a.example");
  });
});

test("parseList, parseAllowedHosts and isLoopbackAddress", function()
{
  assert.deepEqual(parseList(" localhost, drawio.internal ,,"), ["localhost", "drawio.internal"]);
  assert.equal(parseList(""), undefined);

  // ALLOWED_HOSTS: unset or empty is no Host check, a value without a hostname a slip
  assert.deepEqual(parseAllowedHosts("localhost, drawio.internal"), ["localhost", "drawio.internal"]);
  assert.equal(parseAllowedHosts(undefined), undefined);
  assert.equal(parseAllowedHosts(""), undefined);

  for (const value of [" ", ",", " , ,"])
  {
    assert.throws(function() { parseAllowedHosts(value); }, /ALLOWED_HOSTS is set but names no hostname/, JSON.stringify(value));
  }

  for (const host of ["127.0.0.1", "127.1.2.3", "::1", "[::1]", "localhost", "::ffff:127.0.0.1"])
  {
    assert.equal(isLoopbackAddress(host), true, host);
  }

  for (const host of ["0.0.0.0", "::", "192.168.1.10", "10.0.0.1", "example.com"])
  {
    assert.equal(isLoopbackAddress(host), false, host);
  }
});

describe("securityBanner", function()
{
  test("states the bind address, auth, hosts and origins, and that loopback without a token is no boundary on a shared machine", function()
  {
    const banner = securityBanner({ host: "127.0.0.1", port: 3001, auth: null, allowedHosts: undefined, allowedOrigins: null });
    const text = banner.lines.join("\n");

    assert.match(banner.lines[0], /^MCP App server listening on http:\/\/127\.0\.0\.1:3001\/mcp$/);
    assert.match(text, /Bind address: +127\.0\.0\.1 \(loopback: only this machine can connect\)/);
    assert.match(text, /Authentication: +off.*AUTH_TOKEN/);
    assert.match(text, /Allowed hosts: +any Host header/);
    assert.match(text, /Allowed origins: +http\(s\):\/\/localhost, 127\.0\.0\.1 and \[::1\]/);
    assert.match(text, /Shared machine: +NOT SAFE/);
    assert.deepEqual(banner.warnings, []);
  });

  test("warns on a non-loopback address without a token, with the Docker port rule", function()
  {
    const banner = securityBanner({ host: "0.0.0.0", port: 3001, auth: null, allowedHosts: undefined, allowedOrigins: null });
    const warnings = banner.warnings.join("\n");

    assert.match(banner.lines.join("\n"), /Bind address: +0\.0\.0\.0 \(all interfaces/);
    assert.match(warnings, /^WARNING: listening on 0\.0\.0\.0 without authentication/);
    assert.match(warnings, /-p 127\.0\.0\.1:3001:3001/);
    assert.match(warnings, /bypass ufw and firewalld/);
  });

  test("with a token: on, from where, never the token itself", function()
  {
    const auth = { token: TOKEN, source: "AUTH_TOKEN_FILE" };
    const banner = securityBanner({ host: "::", port: 8080, auth, allowedHosts: ["drawio.internal"], allowedOrigins: parseAllowedOrigins("https://chat.example.com") });
    const text = banner.lines.concat(banner.warnings).join("\n");

    assert.match(banner.lines[0], /http:\/\/\[::\]:8080\/mcp/);
    assert.match(text, /Authentication: +on, bearer token from AUTH_TOKEN_FILE/);
    assert.match(text, /Allowed hosts: +drawio\.internal/);
    assert.match(text, /Allowed origins: +https:\/\/chat\.example\.com;/);
    assert.match(text, /Shared machine: +protected/);
    assert.match(text, /TLS reverse proxy/);
    assert.deepEqual(banner.warnings, []);
    assert.ok(!text.includes(TOKEN));
  });

  test("warns about a short token and about ALLOWED_ORIGINS=* without a token, also with ALLOWED_HOSTS", function()
  {
    const short = securityBanner({ host: "127.0.0.1", port: 3001, auth: { token: "abc", source: "AUTH_TOKEN" }, allowedOrigins: null });

    assert.match(short.warnings.join("\n"), /only 3 characters/);

    // CORS lets any page read the answers: a page calling localhost:3001
    // sends the Host ALLOWED_HOSTS lists, so only the token keeps it out
    for (const allowedHosts of [undefined, ["localhost", "127.0.0.1"]])
    {
      const any = securityBanner({ host: "127.0.0.1", port: 3001, auth: null, allowedHosts, allowedOrigins: parseAllowedOrigins("*") });

      assert.match(any.warnings.join("\n"), /ALLOWED_ORIGINS=\* without authentication: any web page you open can call the server/, String(allowedHosts));
    }

    const withToken = securityBanner({ host: "127.0.0.1", port: 3001, auth: { token: TOKEN, source: "AUTH_TOKEN" }, allowedOrigins: parseAllowedOrigins("*") });

    assert.doesNotMatch(withToken.warnings.join("\n"), /ALLOWED_ORIGINS/);
  });
});

// --- src/index.js, started for real ---

/**
 * Starts src/index.js on a free loopback port with the given environment
 * and resolves once it listens, with its port, its output so far and a stop
 * function.
 */
function startServer(env)
{
  return new Promise(function(resolve, reject)
  {
    const child = spawn(process.execPath, [INDEX_JS],
    {
      env: Object.assign({}, process.env,
      {
        PORT: "0",
        LISTEN: "127.0.0.1",
        AUTH_TOKEN: undefined,
        AUTH_TOKEN_FILE: undefined,
        ALLOWED_HOSTS: undefined,
        ALLOWED_ORIGINS: undefined,
        DRAWIO_ICON_SERVICE_URL: "off",
      }, env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = { stdout: "", stderr: "" };
    const timer = setTimeout(function()
    {
      child.kill();
      reject(new Error("server did not start:\n" + output.stdout + output.stderr));
    }, 30000);

    child.stdout.on("data", function(chunk)
    {
      output.stdout += chunk;
      const match = /listening on http:\/\/127\.0\.0\.1:(\d+)\/mcp/.exec(output.stdout);

      // The banner is printed at once; wait for its last line
      if (match != null && /Shared machine:.*\n/.test(output.stdout))
      {
        clearTimeout(timer);
        resolve(
        {
          port: Number(match[1]),
          output,
          stop: function()
          {
            return new Promise(function(done)
            {
              child.once("exit", function() { done(); });
              child.kill();
            });
          },
        });
      }
    });
    child.stderr.on("data", function(chunk) { output.stderr += chunk; });
    child.once("exit", function(code)
    {
      clearTimeout(timer);
      reject(Object.assign(new Error("server exited with " + code + ":\n" + output.stderr), { code, output }));
    });
  });
}

/** A request to /mcp with exactly these headers, through node:http (fetch won't set Host or Origin). */
function send(port, method, headers, body)
{
  return new Promise(function(resolve, reject)
  {
    const req = http.request(
    {
      host: "127.0.0.1",
      port,
      path: "/mcp",
      method,
      headers,
    }, function(res)
    {
      let data = "";

      res.setEncoding("utf-8");
      res.on("data", function(chunk) { data += chunk; });
      res.on("end", function() { resolve({ status: res.statusCode, headers: res.headers, body: data }); });
    });

    req.on("error", reject);
    req.end(body);
  });
}

/** A POST of an initialize with these headers. */
function post(port, headers, body)
{
  return send(port, "POST", Object.assign(
  {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
  }, headers), body ?? INITIALIZE);
}

/** The CORS preflight a browser sends before a POST with a token. */
function preflight(port, origin)
{
  return send(port, "OPTIONS",
  {
    "Origin": origin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization, content-type, mcp-protocol-version",
  });
}

/** The names of a comma-separated header, lower case. */
function headerList(value)
{
  return String(value || "").toLowerCase().split(",").map(function(entry) { return entry.trim(); });
}

function get(port, urlPath)
{
  return new Promise(function(resolve, reject)
  {
    http.get({ host: "127.0.0.1", port, path: urlPath }, function(res)
    {
      let data = "";

      res.setEncoding("utf-8");
      res.on("data", function(chunk) { data += chunk; });
      res.on("end", function() { resolve({ status: res.statusCode, body: data }); });
    }).on("error", reject);
  });
}

describe("src/index.js without a token (the default)", function()
{
  let server;

  before(async function()
  {
    server = await startServer({ ALLOWED_HOSTS: "localhost,127.0.0.1" });
  });

  after(async function()
  {
    await server.stop();
  });

  test("prints the banner: auth off, the hosts and the loopback origins", function()
  {
    assert.match(server.output.stdout, /Bind address: +127\.0\.0\.1 \(loopback/);
    assert.match(server.output.stdout, /Authentication: +off/);
    assert.match(server.output.stdout, /Allowed hosts: +localhost, 127\.0\.0\.1/);
    assert.match(server.output.stdout, /Allowed origins: +http\(s\):\/\/localhost/);
    assert.match(server.output.stdout, /Shared machine: +NOT SAFE/);
  });

  test("answers an MCP client without a token", async function()
  {
    const res = await post(server.port, {});

    assert.equal(res.status, 200);
    assert.match(res.body, /"name":"drawio-mcp-app"/);
  });

  test("answers a loopback Origin and refuses another one with a 403", async function()
  {
    assert.equal((await post(server.port, { Origin: "http://localhost:6274" })).status, 200);

    const refused = await post(server.port, { Origin: "http://evil.example:3001" });

    assert.equal(refused.status, 403);
    assert.match(JSON.parse(refused.body).error.message, /Origin http:\/\/evil\.example:3001 is not allowed/);
    assert.match(server.output.stdout, /\[origin\] 403 POST \/mcp: Origin http:\/\/evil\.example:3001 is not allowed/);
  });

  test("refuses a Host ALLOWED_HOSTS doesn't list, as a rebound name sends", async function()
  {
    assert.equal((await post(server.port, { Host: "localhost:3001" })).status, 200);

    const refused = await post(server.port, { Host: "evil.example:3001" });

    assert.equal(refused.status, 403);
    assert.match(JSON.parse(refused.body).error.message, /Invalid Host: evil\.example/);
  });
});

describe("src/index.js with AUTH_TOKEN_FILE", function()
{
  let server;
  let dir;

  before(async function()
  {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "drawio-mcp-auth-"));
    const file = path.join(dir, "token");

    fs.writeFileSync(file, TOKEN + "\n", { mode: 0o600 });
    server = await startServer({ AUTH_TOKEN_FILE: file });
  });

  after(async function()
  {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("prints the banner: auth on, from the file", function()
  {
    assert.match(server.output.stdout, /Authentication: +on, bearer token from AUTH_TOKEN_FILE/);
    assert.match(server.output.stdout, /Shared machine: +protected/);
  });

  test("refuses a request without a token with a 401 and a WWW-Authenticate header", async function()
  {
    const res = await post(server.port, {});

    assert.equal(res.status, 401);
    assert.equal(res.headers["www-authenticate"], 'Bearer realm="drawio-mcp"');
    assert.match(JSON.parse(res.body).error.message, /Authorization: Bearer <token>/);
  });

  test("refuses a wrong token, another scheme and a token with something appended", async function()
  {
    for (const value of ["Bearer wrong", "Bearer " + TOKEN + "x", "Basic " + Buffer.from("u:" + TOKEN).toString("base64"), TOKEN])
    {
      const res = await post(server.port, { Authorization: value });

      assert.equal(res.status, 401, value);
    }

    const wrong = await post(server.port, { Authorization: "Bearer wrong" });

    assert.equal(wrong.headers["www-authenticate"], 'Bearer realm="drawio-mcp", error="invalid_token"');
    assert.match(JSON.parse(wrong.body).error.message, /wrong token/);
  });

  test("answers the right token, with the scheme in any case", async function()
  {
    assert.equal((await post(server.port, { Authorization: "Bearer " + TOKEN })).status, 200);
    assert.equal((await post(server.port, { Authorization: "bearer " + TOKEN })).status, 200);
  });

  test("works with the SDK's Streamable HTTP client, the header passed as MCP clients configure it", async function()
  {
    const url = new URL(`http://127.0.0.1:${server.port}/mcp`);
    const client = new Client({ name: "http-security-test", version: "0" });

    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: "Bearer " + TOKEN } } }));

    const tools = await client.listTools();

    assert.ok(tools.tools.some(function(tool) { return tool.name === "create_diagram"; }));
    await client.close();

    const anonymous = new Client({ name: "http-security-test", version: "0" });

    await assert.rejects(anonymous.connect(new StreamableHTTPClientTransport(url)));
  });

  test("checks the Origin before the token", async function()
  {
    assert.equal((await post(server.port, { Authorization: "Bearer " + TOKEN, Origin: "http://evil.example" })).status, 403);
  });

  test("keeps /health open for health checks", async function()
  {
    const res = await get(server.port, "/health");

    assert.equal(res.status, 200);
    assert.equal(res.body, "ok");
  });

  test("never writes the token to its output", function()
  {
    assert.match(server.output.stdout, /\[auth\] 401 POST \/mcp from .*: wrong token/);
    assert.ok(!server.output.stdout.includes(TOKEN));
    assert.ok(!server.output.stderr.includes(TOKEN));
  });
});

test("src/index.js stops with an error on an empty AUTH_TOKEN instead of running without authentication", async function()
{
  await assert.rejects(startServer({ AUTH_TOKEN: "" }), function(e)
  {
    assert.notEqual(e.code, 0);
    assert.match(e.output.stderr, /AUTH_TOKEN is set but the token is empty/);
    return true;
  });
});

test("src/index.js stops with an error on an ALLOWED_HOSTS without hostnames instead of answering any Host", async function()
{
  let server = null;

  try
  {
    server = await startServer({ ALLOWED_HOSTS: " , " });
  }
  catch (e)
  {
    assert.notEqual(e.code, 0);
    assert.match(e.output.stderr, /ALLOWED_HOSTS is set but names no hostname/);
    return;
  }

  const res = await post(server.port, { Host: "evil.example:3001" });

  await server.stop();
  assert.fail("the server started and answered Host evil.example with " + res.status);
});

describe("src/index.js with a token, for a browser client ALLOWED_ORIGINS lists", function()
{
  const ORIGIN = "https://chat.example.com";
  let server;

  before(async function()
  {
    server = await startServer({ AUTH_TOKEN: TOKEN, ALLOWED_ORIGINS: ORIGIN });
  });

  after(async function()
  {
    await server.stop();
  });

  test("answers its CORS preflight, which carries no token, before the token check", async function()
  {
    const res = await preflight(server.port, ORIGIN);

    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], ORIGIN);
    assert.ok(headerList(res.headers["access-control-allow-methods"]).includes("post"));

    for (const name of ["authorization", "content-type", "mcp-protocol-version", "mcp-session-id"])
    {
      assert.ok(headerList(res.headers["access-control-allow-headers"]).includes(name), name);
    }

    assert.ok(headerList(res.headers["vary"]).includes("origin"));
  });

  test("lets the page read the answer, the session id and a 401", async function()
  {
    const ok = await post(server.port, { Origin: ORIGIN, Authorization: "Bearer " + TOKEN });

    assert.equal(ok.status, 200);
    assert.equal(ok.headers["access-control-allow-origin"], ORIGIN);
    assert.ok(headerList(ok.headers["access-control-expose-headers"]).includes("mcp-session-id"));

    const refused = await post(server.port, { Origin: ORIGIN });

    assert.equal(refused.status, 401);
    assert.equal(refused.headers["access-control-allow-origin"], ORIGIN);
    assert.ok(headerList(refused.headers["access-control-expose-headers"]).includes("www-authenticate"));
  });

  test("gives an origin it doesn't list neither a preflight nor CORS headers", async function()
  {
    const res = await preflight(server.port, "https://evil.example");

    assert.equal(res.status, 403);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });
});

// --- the commands the docs give ---

describe("the security docs", function()
{
  const DOCS = ["README.md", "DOCKER_HUB.md"].map(function(name)
  {
    return { name, text: fs.readFileSync(fileURLToPath(new URL("../" + name, import.meta.url)), "utf-8") };
  });

  /** The fenced code blocks of a Markdown text. */
  function codeBlocks(text)
  {
    return Array.from(text.matchAll(/```[a-z]*\n([\s\S]*?)```/g), function(match) { return match[1]; });
  }

  test("a docker run with a token pulls the image, since a cached one from before tokens would ignore it", function()
  {
    for (const doc of DOCS)
    {
      const runs = doc.text.split("\n").filter(function(line) { return /docker run\b.*AUTH_TOKEN/.test(line); });

      assert.ok(runs.length > 0, doc.name);

      for (const line of runs)
      {
        assert.match(line, /--pull[ =]always/, doc.name + ": " + line);
      }

      for (const block of codeBlocks(doc.text).filter(function(b) { return /AUTH_TOKEN_FILE/.test(b) && /services:/.test(b); }))
      {
        assert.match(block, /pull_policy: always/, doc.name + ": Compose example");
      }
    }
  });

  test("they say how to check that the server refuses a request without the token", function()
  {
    for (const doc of DOCS)
    {
      assert.match(doc.text, /curl [^\n`]*localhost:3001\/mcp[^\n`]*/, doc.name);
      assert.match(doc.text, /\b401\b/, doc.name);
    }
  });

  test("no client command gets the token's value as an argument, where other users can read it", function()
  {
    for (const doc of DOCS)
    {
      const lines = doc.text.split("\n").filter(function(line)
      {
        return /\b(claude|copilot) mcp\b|--add-mcp\b/.test(line);
      });

      for (const line of lines)
      {
        // Unquoted or in double quotes the shell puts the value in the command line
        assert.doesNotMatch(line.replace(/'[^']*'/g, ""), /\$\{?DRAWIO_MCP_TOKEN/, doc.name + ": " + line);
      }
    }
  });
});
