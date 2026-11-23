// Access control of the Node HTTP entry (src/index.js): the optional bearer
// token, the Origin check against DNS rebinding, the CORS headers for the
// browser origins that check allows and the startup banner that states them.
// The Worker entry is a public endpoint (mcp.draw.io) and has none of them.

import crypto from "node:crypto";
import fs from "node:fs";

/** Origin hostnames allowed when ALLOWED_ORIGINS is not set (any port, http or https). */
export const LOOPBACK_ORIGIN_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** The realm of the WWW-Authenticate header of a 401. */
const REALM = "drawio-mcp";

/** Tokens shorter than this get a warning at startup. */
const SHORT_TOKEN = 16;

/** What a browser client of the Streamable HTTP transport sends and reads (CORS). */
const CORS_ALLOW_METHODS = "GET, POST, DELETE, OPTIONS";
const CORS_ALLOW_HEADERS = "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID";
const CORS_EXPOSE_HEADERS = "Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate";

/**
 * A comma-separated list from the environment, entries trimmed, empty ones
 * dropped; undefined when the variable is unset or has no entries.
 */
export function parseList(value)
{
  if (value == null)
  {
    return undefined;
  }

  const list = value.split(",").map(function(entry) { return entry.trim(); }).filter(Boolean);

  return list.length > 0 ? list : undefined;
}

/**
 * ALLOWED_HOSTS as a list of hostnames; undefined when unset or empty (no
 * Host check). Throws on a value that names no hostname (only commas or
 * white space): read as unset, a slip in it would turn the check off without
 * saying so.
 */
export function parseAllowedHosts(value)
{
  if (value == null || value === "")
  {
    return undefined;
  }

  const hosts = parseList(value);

  if (hosts == null)
  {
    throw new Error(`ALLOWED_HOSTS is set but names no hostname ("${value}"). List the hostnames the server is reached by, comma-separated (e.g. drawio-mcp.internal,localhost), or unset ALLOWED_HOSTS to answer any Host.`);
  }

  return hosts;
}

/**
 * The bearer token from AUTH_TOKEN or the file named by AUTH_TOKEN_FILE (a
 * Docker or Compose secret, surrounding white space removed), as
 * { token, source }; null when neither is set. Throws on a setting that would
 * otherwise turn authentication off without saying so: both set, the file
 * unreadable, an empty token. The message never contains the token.
 */
export function readAuthToken(env, readFile)
{
  const read = readFile || fs.readFileSync;
  const file = env.AUTH_TOKEN_FILE;
  let token = null;
  let source = null;

  if (env.AUTH_TOKEN != null && file != null)
  {
    throw new Error("Set AUTH_TOKEN or AUTH_TOKEN_FILE, not both.");
  }

  if (file != null)
  {
    source = "AUTH_TOKEN_FILE";

    if (file.trim() === "")
    {
      throw new Error("AUTH_TOKEN_FILE is set but empty: give the path of the file that holds the token, or unset it.");
    }

    try
    {
      token = String(read(file, "utf-8")).trim();
    }
    catch (e)
    {
      throw new Error("AUTH_TOKEN_FILE: cannot read " + file + " (" + (e.code || e.message) + ").");
    }
  }
  else if (env.AUTH_TOKEN != null)
  {
    source = "AUTH_TOKEN";
    token = env.AUTH_TOKEN.trim();
  }
  else
  {
    return null;
  }

  if (token === "")
  {
    throw new Error(source + " is set but the token is empty. Set a long random token (e.g. from `openssl rand -hex 32`), or unset " + source + " to run without authentication.");
  }

  // It travels in an HTTP header: visible ASCII, no spaces
  if (!/^[\x21-\x7e]+$/.test(token))
  {
    throw new Error(source + ": the token may only contain visible ASCII characters, without spaces (it is sent in the Authorization header).");
  }

  return { token: token, source: source };
}

/**
 * Whether two tokens are equal, in time independent of where they differ
 * and of their lengths: both are hashed first, so timingSafeEqual always
 * compares 32 bytes.
 */
export function tokenMatches(given, expected)
{
  const a = crypto.createHash("sha256").update(String(given), "utf-8").digest();
  const b = crypto.createHash("sha256").update(String(expected), "utf-8").digest();

  return crypto.timingSafeEqual(a, b);
}

function jsonRpcError(res, status, message)
{
  res.status(status).json(
  {
    jsonrpc: "2.0",
    error: { code: -32000, message: message },
    id: null,
  });
}

/**
 * Express middleware that requires `Authorization: Bearer <token>`. A request
 * without it, or with another token, gets a 401 with a WWW-Authenticate
 * header (RFC 6750) and a JSON-RPC error. Logs the refusal, never a token.
 */
export function bearerAuth(token, log)
{
  const logLine = log || console.log;

  return function(req, res, next)
  {
    const header = req.headers.authorization;
    const match = typeof header === "string" ? /^Bearer +(\S+) *$/i.exec(header) : null;

    if (match != null && tokenMatches(match[1], token))
    {
      next();
      return;
    }

    const reason = header == null ? "no Authorization header" :
      match == null ? "Authorization header is not a bearer token" : "wrong token";

    logLine(`[auth] 401 ${req.method} ${req.originalUrl.split("?")[0]} from ${req.socket.remoteAddress}: ${reason}`);
    res.set("WWW-Authenticate", match == null ? `Bearer realm="${REALM}"` :
      `Bearer realm="${REALM}", error="invalid_token"`);
    jsonRpcError(res, 401, match == null ?
      "Unauthorized: this server requires a token, sent as the header Authorization: Bearer <token>" :
      "Unauthorized: wrong token");
  };
}

/**
 * The origin of a URL as browsers send it in the Origin header: lower-case
 * scheme and host, default port left out. For a scheme the URL standard
 * gives no origin (vscode-webview:, app:) it is scheme://host. "null" is
 * kept as it is (sandboxed frames, file: pages). undefined for anything
 * else.
 */
export function normalizeOrigin(value)
{
  if (value === "null")
  {
    return "null";
  }

  let url;

  try
  {
    url = new URL(value);
  }
  catch (e)
  {
    return undefined;
  }

  if (url.origin !== "null")
  {
    return url.origin;
  }

  return url.host ? url.protocol + "//" + url.host : undefined;
}

/**
 * ALLOWED_ORIGINS as { any, origins }: null when unset (the loopback
 * default), any: true for `*`. Throws on an entry that isn't an origin.
 */
export function parseAllowedOrigins(value)
{
  const entries = parseList(value);

  if (entries == null)
  {
    return null;
  }

  if (entries.includes("*"))
  {
    return { any: true, origins: [] };
  }

  return {
    any: false,
    origins: entries.map(function(entry)
    {
      const origin = normalizeOrigin(entry);

      if (origin == null)
      {
        throw new Error(`ALLOWED_ORIGINS: "${entry}" is not an origin such as https://chat.example.com or http://localhost:5173.`);
      }

      return origin;
    }),
  };
}

/**
 * Whether a request with this Origin header may pass: always without one
 * (MCP clients outside a browser send none), otherwise the loopback origins
 * by default, or the ones ALLOWED_ORIGINS lists.
 */
export function originAllowed(origin, allowed)
{
  if (origin == null)
  {
    return true;
  }

  if (allowed != null && allowed.any)
  {
    return true;
  }

  const normalized = normalizeOrigin(origin);

  if (normalized == null)
  {
    return false;
  }

  if (allowed != null)
  {
    return allowed.origins.includes(normalized);
  }

  if (normalized === "null")
  {
    return false;
  }

  const url = new URL(normalized);

  return (url.protocol === "http:" || url.protocol === "https:") &&
    LOOPBACK_ORIGIN_HOSTS.includes(url.hostname);
}

/**
 * Express middleware for the Origin check the MCP Streamable HTTP transport
 * asks for against DNS rebinding: a request whose Origin isn't allowed gets
 * a 403. Requests without an Origin pass.
 */
export function originValidation(allowed, log)
{
  const logLine = log || console.log;

  return function(req, res, next)
  {
    const origin = req.headers.origin;

    if (originAllowed(origin, allowed))
    {
      next();
      return;
    }

    logLine(`[origin] 403 ${req.method} ${req.originalUrl.split("?")[0]}: Origin ${origin} is not allowed`);
    jsonRpcError(res, 403, `Forbidden: Origin ${origin} is not allowed (set ALLOWED_ORIGINS to allow it)`);
  };
}

/**
 * Express middleware for the browser clients the Origin check lets through:
 * a request with such an Origin gets CORS headers that name it, so the page
 * can read the answer (a 401 and its WWW-Authenticate too), and its preflight
 * (OPTIONS with Access-Control-Request-Method, which browsers send without
 * the token) is answered here with 204. Goes after the Origin check and
 * before the token. Requests without an Origin get nothing.
 */
export function corsHeaders(allowed)
{
  return function(req, res, next)
  {
    const origin = req.headers.origin;

    if (origin == null || !originAllowed(origin, allowed))
    {
      next();
      return;
    }

    res.vary("Origin");
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Expose-Headers", CORS_EXPOSE_HEADERS);

    if (req.method === "OPTIONS" && req.headers["access-control-request-method"] != null)
    {
      res.set("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
      res.set("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
      res.set("Access-Control-Max-Age", "600");
      res.status(204).end();
      return;
    }

    next();
  };
}

/**
 * Whether a bind address only accepts connections from this machine.
 */
export function isLoopbackAddress(host)
{
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "");

  return h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h) ||
    /^::ffff:127(\.\d{1,3}){3}$/.test(h);
}

function isAnyAddress(host)
{
  const h = String(host).replace(/^\[|\]$/g, "");

  return h === "" || h === "0.0.0.0" || h === "::";
}

function urlHost(host)
{
  const h = String(host);

  return h.includes(":") && !h.startsWith("[") ? "[" + h + "]" : h;
}

/**
 * The startup banner of the HTTP server: the endpoint, the bind address,
 * whether authentication is on, the allowed hosts and origins, and whether
 * it is fit for a machine shared with other users and processes. Returns
 * { lines, warnings }; index.js prints the lines to stdout and the warnings
 * to stderr. Never contains the token.
 */
export function securityBanner(options)
{
  const host = options.host;
  const port = options.port;
  const auth = options.auth;
  const allowedHosts = options.allowedHosts;
  const allowedOrigins = options.allowedOrigins;
  const loopback = isLoopbackAddress(host);
  const lines = [];
  const warnings = [];

  lines.push(`MCP App server listening on http://${urlHost(host)}:${port}/mcp`);

  lines.push("  Bind address:     " + host + (loopback ? " (loopback: only this machine can connect)" :
    isAnyAddress(host) ? " (all interfaces: reachable from the network)" : " (reachable from the network on this interface)"));

  lines.push("  Authentication:   " + (auth != null ?
    `on, bearer token from ${auth.source} (GET /health stays open)` :
    "off: anyone who can connect can call the tools (set AUTH_TOKEN or AUTH_TOKEN_FILE)"));

  lines.push("  Allowed hosts:    " + (allowedHosts != null ? allowedHosts.join(", ") :
    "any Host header (set ALLOWED_HOSTS to restrict)"));

  lines.push("  Allowed origins:  " + (allowedOrigins == null ?
    "http(s)://localhost, 127.0.0.1 and [::1], any port (set ALLOWED_ORIGINS to change)" :
    allowedOrigins.any ? "any (ALLOWED_ORIGINS=*)" :
    allowedOrigins.origins.join(", ")) + "; requests without an Origin header (MCP clients outside a browser) pass");

  lines.push("  Shared machine:   " + (auth != null ?
    "protected: only callers that send the token get in" :
    "NOT SAFE: the bind address is no auth boundary, any user or process on this machine can call it; set AUTH_TOKEN"));

  if (!loopback && auth == null)
  {
    warnings.push(`WARNING: listening on ${host} without authentication: anyone who can reach port ${port} can use the server.`);
    warnings.push("  Set AUTH_TOKEN or AUTH_TOKEN_FILE, or listen on loopback only (LISTEN=127.0.0.1).");
    warnings.push(`  In a container (the image sets LISTEN=0.0.0.0) publish the port on loopback only, -p 127.0.0.1:${port}:${port}:`);
    warnings.push(`  a plain -p ${port}:${port} publishes it on every interface of the host, and Docker's port rules bypass ufw and firewalld.`);
  }
  else if (!loopback)
  {
    lines.push("  Note: plain HTTP. If clients connect over the network, put a TLS reverse proxy in front, so the token isn't sent in clear text.");
  }

  if (auth != null && auth.token.length < SHORT_TOKEN)
  {
    warnings.push(`WARNING: the token from ${auth.source} has only ${auth.token.length} characters; use a long random one, e.g. from \`openssl rand -hex 32\`.`);
  }

  // Every origin gets CORS headers: a page that calls localhost sends the
  // Host ALLOWED_HOSTS lists, so only the token keeps it out
  if (allowedOrigins != null && allowedOrigins.any && auth == null)
  {
    warnings.push("WARNING: ALLOWED_ORIGINS=* without authentication: any web page you open can call the server and read its answers. Set AUTH_TOKEN, or list the origins you use.");
  }

  return { lines: lines, warnings: warnings };
}
