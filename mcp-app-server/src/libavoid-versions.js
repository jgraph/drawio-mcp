// ETag-versioned CDN URLs for the libavoid script block.
//
// The MCP-app iframe loads libavoid from the viewer.diagrams.net CDN with
// cache-control max-age=2592000 (30 days), so after a draw.io release a warm
// browser cache can keep serving a stale router for up to a month. The HTML
// is delivered to the host as an MCP resource and rendered in a sandboxed
// iframe, so the scripts cannot be served same-origin from this server -
// but the URLs can be VERSIONED: the Node server HEADs the four files at
// startup (and daily on the HTTP transport - see index.js), derives a
// version token from each ETag, and bakes it into the script URLs as
// ?v=<token>. Clients keep long-lived caching per URL, and a release
// changes the ETag -> changes the URL -> every client re-fetches exactly
// once. Best effort: a failed or 404 HEAD (the path only exists once a
// draw.io release ships js/libavoid-js/) leaves the plain URL, which is the
// previous behavior with its 30-day worst-case staleness.

const CDN_BASE = "https://viewer.diagrams.net/js/libavoid-js/";

// Fixed load order: glue -> wasm payload -> loader -> routing core.
export const LIBAVOID_FILES = [
  "libavoid.min.js",
  "libavoid-wasm.js",
  "libavoid-loader.js",
  "libavoid-routing.js"
];

const HEAD_TIMEOUT_MS = 5000;

async function versionToken(file)
{
  try
  {
    const res = await fetch(CDN_BASE + file,
      { method: "HEAD", signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
    const etag = res.ok ? res.headers.get("etag") : null;

    return etag
      ? encodeURIComponent(etag.replace(/^W\//, "").replace(/"/g, ""))
      : null;
  }
  catch (e)
  {
    return null;
  }
}

/**
 * The four libavoid script URLs in load order, ETag-versioned where the CDN
 * answered. Safe to call repeatedly (each call re-checks). `prev` (the
 * previous result) keeps a file's last-known URL when its check fails: a
 * transient HEAD failure is not a version change and must not downgrade a
 * versioned URL to a plain one (re-exposing the 30-day cache) only to flip
 * it back on the next success. Without `prev` (startup, no known-good
 * state) a failed check yields the plain URL.
 */
export async function libavoidUrls(prev)
{
  const tokens = await Promise.all(LIBAVOID_FILES.map(versionToken));

  return LIBAVOID_FILES.map(function(file, i)
  {
    return tokens[i]
      ? CDN_BASE + file + "?v=" + tokens[i]
      : ((prev && prev[i]) || CDN_BASE + file);
  });
}
