/**
 * Cloudflare Workers entry point for the draw.io MCP App server.
 *
 * Serves MCP statelessly: every request gets its own server and transport,
 * built in the Worker and dropped with the response, so nothing is held
 * between requests and the server scales out with the Workers runtime.
 *
 * The 2025-era protocol still has sessions, so an initialize is answered with
 * a minted Mcp-Session-Id, and the one piece of per-session state the server
 * needs, whether the client declared the MCP Apps UI capability, is written
 * into that id (see mintSessionId). The other "renders the app" signal,
 * whether the client fetched the app resource, is kept by a per-session
 * Durable Object that only clients without the declaration ever reach.
 *
 * Until 2026-09-30 every session's server lived in the memory of sharded
 * Durable Objects, which overloaded under load; see "Cloudflare Workers
 * Architecture" in AGENTS.md.
 *
 * Pre-requisite: run `node src/build-html.js` to generate src/generated-html.js.
 * Wrangler's [build] command does this automatically before bundling.
 */

import { DurableObject } from "cloudflare:workers";
import { createServer, clientRendersUi } from "./shared.js";
import { resolveIconServiceUrl } from "../../shared/icon-search.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest, LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { html, xmlReference, mermaidReference, shapeIndex, faviconBase64, buildId } from "./generated-html.js";

const CORS_HEADERS =
{
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
};

/** Add CORS headers to an existing Response. */
function withCors(response)
{
  const patched = new Response(response.body, response);

  for (const [k, v] of Object.entries(CORS_HEADERS))
  {
    patched.headers.set(k, v);
  }

  return patched;
}

/** A JSON-RPC error response, in the shape the SDK transport answers with. */
function jsonRpcError(status, code, message, headers)
{
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
  {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// ── Sessions ─────────────────────────────────────────────────────────────────

/**
 * Session id prefixes carrying whether the client declared the MCP Apps UI
 * capability at initialize (and isn't known to declare it without rendering,
 * see clientRendersUi), so a later request can tell without any stored
 * state. They are not a credential: a client that forges one only changes
 * whether its own create_diagram results get the "open in draw.io" link.
 * An id with neither prefix (issued before this scheme) reads as "not
 * declared", which at worst appends that link.
 */
const UI_SESSION_PREFIX = "ui-";
const PLAIN_SESSION_PREFIX = "noui-";

function mintSessionId(declaresUi)
{
  return (declaresUi ? UI_SESSION_PREFIX : PLAIN_SESSION_PREFIX) + crypto.randomUUID();
}

/**
 * How long the "fetched the app resource" flag outlives the last fetch. A
 * host that renders fetches the resource again whenever it renders, so this
 * only has to cover the gap between two of its calls.
 */
const UI_RESOURCE_FLAG_TTL = 24 * 60 * 60 * 1000;

/**
 * Remembers, for one session, that its client fetched the app resource: the
 * second "renders the app" signal next to the declared capability, which
 * covers a host that renders through its own negotiation without declaring
 * it. One object per session id (idFromName), written when a client without
 * the declaration reads the resource and read on that client's create_diagram
 * calls, so hardly any traffic reaches it. An alarm drops the flag again.
 *
 * The name predates this role: until 2026-09-30 the class held every
 * session's server in memory, sharded by session id. Renaming it would need
 * a wrangler migration.
 */
export class MCPSessionManager extends DurableObject
{
  async markUiResourceRead()
  {
    await this.ctx.storage.put("uiResourceRead", true);
    await this.ctx.storage.setAlarm(Date.now() + UI_RESOURCE_FLAG_TTL);
  }

  async uiResourceRead()
  {
    return (await this.ctx.storage.get("uiResourceRead")) === true;
  }

  async alarm()
  {
    await this.ctx.storage.deleteAll();
  }
}

/**
 * The `uiSession` option of createServer for a session: the declaration from
 * the id, the resource flag from that session's Durable Object. The flag is
 * best effort — if the object can't be reached, the client is treated as not
 * rendering, which only appends the "open in draw.io" link.
 */
function uiSessionFor(env, sessionId, log)
{
  function stub()
  {
    return env.MCP_SESSION_MANAGER.get(env.MCP_SESSION_MANAGER.idFromName(sessionId));
  }

  return {
    declared: sessionId.startsWith(UI_SESSION_PREFIX),
    markResourceRead: async function()
    {
      try
      {
        await stub().markUiResourceRead();
      }
      catch (e)
      {
        log(`[ui-flag] write failed session=${sessionId.slice(0, 13)} error=${e.message}`);
      }
    },
    resourceRead: async function()
    {
      try
      {
        return await stub().uiResourceRead();
      }
      catch (e)
      {
        log(`[ui-flag] read failed session=${sessionId.slice(0, 13)} error=${e.message}`);

        return false;
      }
    },
  };
}

// ── MCP ──────────────────────────────────────────────────────────────────────

/**
 * Handle one /mcp request with a server and transport of its own.
 *
 * @param {boolean} debug - log the request and response (env.DEBUG)
 */
async function handleMcp(request, env, debug)
{
  const log = debug ? function(msg) { console.log(msg); } : function() {};
  const sessionId = request.headers.get("mcp-session-id");

  // No standalone SSE stream: the server never sends anything outside a
  // response (no list-changed notifications, no server-initiated requests),
  // and 405 is how the spec lets a server say it offers none.
  if (request.method === "GET")
  {
    return jsonRpcError(405, -32000, "Method not allowed.", { Allow: "POST, DELETE" });
  }

  // Terminating a session releases nothing — there's nothing held.
  if (request.method === "DELETE")
  {
    return sessionId
      ? new Response(null, { status: 200 })
      : jsonRpcError(400, -32000, "Bad Request: Mcp-Session-Id header is required");
  }

  // Parsed here because the session id has to be minted from an initialize's
  // capabilities before the transport sees it. Anything unparsable goes to the
  // transport unparsed, which answers it exactly as it always has.
  let body;

  if (request.method === "POST")
  {
    try
    {
      body = await request.clone().json();
    }
    catch (e)
    {
      body = undefined;
    }
  }

  const messages = Array.isArray(body) ? body : [body];
  const init = body !== undefined ? messages.find(isInitializeRequest) : undefined;

  // The session this request belongs to: minted for an initialize, taken from
  // the header otherwise. A request with neither is left to the transport,
  // which rejects it as not initialized — that's the answer a 2026-07-28
  // client's server/discover probe gets before it falls back to initialize.
  let session = null;

  if (init != null)
  {
    session = mintSessionId(clientRendersUi(init.params.capabilities, init.params.clientInfo));
  }
  else if (sessionId)
  {
    session = sessionId;
  }

  const rpcMethod = body === undefined ? "" : messages.map(function(m)
  {
    return (m && m.method) || "response";
  }).join(",");

  log(`[rpc] ${request.method} ${rpcMethod} session=${(session || "none").slice(0, 13)}${init != null ? " NEW" : ""}`);

  // Clients that accept text/event-stream only (e.g. Claude Desktop) get SSE.
  // Clients that accept application/json (e.g. Claude.ai) get a plain JSON
  // response via the SDK's JSON response mode. When a client accepts both,
  // prefer JSON.
  const acceptHeader = request.headers.get("accept") || "";
  const wantsSSE = acceptHeader.includes("text/event-stream") && !acceptHeader.includes("application/json");
  let mcpRequest = request;

  if (!wantsSSE)
  {
    // The transport insists on both in Accept, even in JSON response mode.
    const headers = new Headers(request.headers);
    headers.set("accept", "application/json, text/event-stream");
    mcpRequest = new Request(request, { headers });
  }

  const server = createServer(html,
  {
    domain: env.DOMAIN,
    xmlReference,
    mermaidReference,
    shapeIndex,
    iconServiceUrl: resolveIconServiceUrl(env.DRAWIO_ICON_SERVICE_URL),
    buildId,
    uiSession: session != null ? uiSessionFor(env, session, log) : null,
  });
  const transport = new WebStandardStreamableHTTPServerTransport(
  {
    sessionIdGenerator: function() { return session; },
    enableJsonResponse: !wantsSSE,
  });

  transport.onerror = function(err)
  {
    log(`[transport-error] session=${(session || "none").slice(0, 13)} error=${err.message}`);
  };

  await server.connect(transport);

  // A request within a session: this transport never saw the initialize and
  // would reject it as not initialized. Open that gate — the MCP server itself
  // serves requests without a handshake.
  if (init == null && sessionId)
  {
    transport._initialized = true;
    transport.sessionId = sessionId;
  }

  const startTime = Date.now();
  const response = await transport.handleRequest(mcpRequest, body !== undefined ? { parsedBody: body } : undefined);

  log(`[response] ${request.method} ${rpcMethod} session=${(session || "none").slice(0, 13)} mode=${wantsSSE ? "SSE" : "JSON"} status=${response.status} elapsed=${Date.now() - startTime}ms`);

  if (debug && !wantsSSE)
  {
    await logResponseBody(rpcMethod, (session || "none").slice(0, 13), response);
  }

  return response;
}

/**
 * Debug logging of what a client got back for the methods worth seeing in
 * full (JSON mode only; an SSE body is still streaming at this point).
 */
async function logResponseBody(rpcMethod, session, response)
{
  const debugMethods = ["resources/list", "resources/read", "tools/call", "tools/list"];

  if (!debugMethods.includes(rpcMethod))
  {
    return;
  }

  try
  {
    const respBody = await response.clone().text();

    if (rpcMethod === "resources/read")
    {
      // Log metadata but not the HTML text
      const parsed = JSON.parse(respBody);
      const summary = ((parsed.result && parsed.result.contents) || []).map(function(c)
      {
        return {
          uri: c.uri,
          mimeType: c.mimeType,
          textLength: c.text ? c.text.length : 0,
          _meta: c._meta,
        };
      });
      console.log(`[response-body] ${rpcMethod} session=${session} contents=${JSON.stringify(summary)}`);
    }
    else
    {
      console.log(`[response-body] ${rpcMethod} session=${session} body=${respBody.slice(0, rpcMethod === "resources/list" ? 2000 : 500)}`);
    }
  }
  catch (e)
  {
    console.log(`[response-body] ${rpcMethod} parse-failed session=${session} error=${e.message}`);
  }
}

/**
 * Uptime probe for monitors (Pingdom counts the 400 of a session-less GET
 * /mcp as down): answers an initialize through the same per-request server
 * as /mcp, so it checks the serving path rather than just that the Worker is
 * up. Nothing is stored, so probing creates no session.
 */
async function health(request, env)
{
  const probe = new Request(new URL("/mcp", request.url),
  {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
    body: JSON.stringify(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "health", version: "1" } },
    }),
  });
  const response = await handleMcp(probe, env, false);
  const ok = response.status === 200;

  return new Response(ok ? "ok" : "unhealthy",
  {
    status: ok ? 200 : 503,
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}

/**
 * Main Worker: serves /mcp (and /health) itself, one server per request.
 */
export default
{
  async fetch(request, env)
  {
    // CORS preflight
    if (request.method === "OPTIONS")
    {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Serve favicon so Google's favicon service picks up the draw.io logo
    if (url.pathname === "/favicon.ico" || url.pathname === "/favicon.png")
    {
      const bytes = Uint8Array.from(atob(faviconBase64), function(c) { return c.charCodeAt(0); });

      return new Response(bytes,
      {
        headers:
        {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=604800",
          ...CORS_HEADERS,
        },
      });
    }

    // Domain verification for the OpenAI plugin directory: the submission
    // portal fetches this path on the MCP host and expects the bare token and
    // nothing else — no JSON, no list, no second token. The token itself is
    // public, so it lives in OPENAI_APPS_CHALLENGE (wrangler var or secret);
    // without it we keep 404ing, which is what the portal sees pre-verification.
    if (url.pathname === "/.well-known/openai-apps-challenge")
    {
      const token = env.OPENAI_APPS_CHALLENGE;

      if (!token)
      {
        return new Response("Not Found", { status: 404 });
      }

      return new Response(token,
      {
        headers:
        {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    if (url.pathname === "/health")
    {
      return health(request, env);
    }

    if (url.pathname !== "/mcp")
    {
      return new Response("Not Found", { status: 404 });
    }

    let response;

    try
    {
      response = await handleMcp(request, env, env.DEBUG === "true");
    }
    catch (err)
    {
      console.error(`[error] ${request.method} ${err.stack || err.message}`);
      response = jsonRpcError(500, -32603, "Internal server error");
    }

    return withCors(response);
  },
};
