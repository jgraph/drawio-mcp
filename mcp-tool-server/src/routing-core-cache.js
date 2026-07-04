// Local cache for the shared libavoid routing core with CDN revalidation.
//
// The canonical libavoid-routing.js ships with draw.io releases on the
// viewer.diagrams.net CDN (the same origin the app server loads it from).
// loadCoreSource() keeps a per-user copy on disk and revalidates it with a
// conditional GET (If-None-Match against the stored ETag) once per call:
//
//   200 -> validate the download, atomically update the cache, use it
//   304 -> use the cached copy (no download)
//   fetch error / timeout / non-OK -> use the cached copy if present
//   nothing cached and the fetch failed -> throw (the caller falls back to
//   the vendored copy)
//
// npm's postinstall primes the cache (src/postinstall.js) so the first
// routing call doesn't pay the download; offline and --ignore-scripts
// installs simply prime it on first use instead. The source and its ETag
// live in ONE JSON artifact updated by a single atomic rename, so
// concurrent processes can never pair one version's body with another's
// ETag. A cached copy that fails validation is discarded and refetched in
// full.

import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";

export const ROUTING_CDN_URL =
  "https://viewer.diagrams.net/js/libavoid-js/libavoid-routing.js";
const FETCH_TIMEOUT_MS = 5000;

// One artifact holding BOTH the source and its ETag, so the pair is updated
// by a single atomic rename — separate files could be torn by two processes
// racing across a release boundary (old body paired with the new ETag 304s
// against a stale core until the NEXT release).
const FILE = "libavoid-routing.json";

// ~/Library/Caches on macOS, XDG on Linux, LOCALAPPDATA on Windows. XDG
// wins everywhere when set (also makes the cache relocatable in tests).
export function cacheDir()
{
  var base;

  if (process.env.XDG_CACHE_HOME)
  {
    base = process.env.XDG_CACHE_HOME;
  }
  else if (platform() === "darwin")
  {
    base = join(homedir(), "Library", "Caches");
  }
  else if (platform() === "win32")
  {
    base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  }
  else
  {
    base = join(homedir(), ".cache");
  }

  return join(base, "drawio-mcp");
}

function readCached()
{
  try
  {
    var entry = JSON.parse(readFileSync(join(cacheDir(), FILE), "utf8"));

    if (typeof entry.src !== "string")
    {
      return null;
    }

    return { src: entry.src,
      etag: (typeof entry.etag === "string" && entry.etag !== "") ? entry.etag : null };
  }
  catch (e)
  {
    return null;
  }
}

function writeCache(src, etag)
{
  var dir = cacheDir();
  mkdirSync(dir, { recursive: true });

  // Atomic against concurrent processes: write a temp file, then rename.
  var tmp = join(dir, FILE + "." + process.pid + ".tmp");
  writeFileSync(tmp, JSON.stringify({ etag: etag, src: src }));

  try
  {
    renameSync(tmp, join(dir, FILE));
  }
  catch (e)
  {
    // Don't orphan the temp file (e.g. Windows EPERM on a held target).
    try { rmSync(tmp); } catch (e2) {}
    throw e;
  }
}

function dropCache()
{
  try { rmSync(join(cacheDir(), FILE)); } catch (e) {}
}

/**
 * The routing core source, freshest available: CDN-revalidated cache, then
 * plain cache, else throws. `validate(src)` must throw when the source is
 * unusable - a rejected download is neither cached nor returned, and a
 * cached copy that fails validation is discarded and refetched in full.
 */
export async function loadCoreSource(validate)
{
  var cached = readCached();

  if (cached != null)
  {
    try
    {
      validate(cached.src);
    }
    catch (e)
    {
      dropCache();
      cached = null;
    }
  }

  var headers = {};

  if (cached != null && cached.etag != null)
  {
    headers["If-None-Match"] = cached.etag;
  }

  try
  {
    var res = await fetch(ROUTING_CDN_URL,
      { headers: headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

    if (res.status === 304 && cached != null)
    {
      return cached.src;
    }

    if (res.ok)
    {
      var src = await res.text();
      validate(src);

      try
      {
        writeCache(src, res.headers.get("etag"));
      }
      catch (e)
      {
        // Read-only cache dir - the download is still usable this process.
      }

      return src;
    }

    throw new Error("HTTP " + res.status);
  }
  catch (e)
  {
    if (cached != null)
    {
      return cached.src;
    }

    throw e;
  }
}
