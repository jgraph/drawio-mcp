#!/usr/bin/env node
// Primes the routing-core cache at install time - best effort, NEVER fails
// the install: fetches the current libavoid-routing.js from the CDN into the
// per-user cache dir so the first routing call doesn't pay the download.
// Offline installs and --ignore-scripts environments are fine; the cache
// primes on first use instead (see routing-core-cache.js). Validation here
// is a content sniff, not an eval - installers should not execute freshly
// downloaded code; the runtime eval-validates before use and discards a bad
// cache entry.
import { loadCoreSource } from "./routing-core-cache.js";

try
{
  await loadCoreSource(function(src)
  {
    if (src.indexOf("AvoidRouting") === -1)
    {
      throw new Error("unexpected content");
    }
  });
}
catch (e)
{
  // CDN unreachable or the path isn't in a release yet - fine either way.
}

process.exit(0);
