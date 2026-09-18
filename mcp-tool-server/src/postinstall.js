#!/usr/bin/env node
// Primes the routing-core cache at install time - best effort, NEVER fails
// the install: fetches the current libavoid-routing.js from the CDN into the
// per-user cache dir so the first routing call doesn't pay the download.
// Offline installs and --ignore-scripts environments are fine; the cache
// primes on first use instead (see cdn-cache.js). Validation here is a
// content sniff, not an eval - installers should not execute freshly
// downloaded code; the runtime eval-validates before use and discards a bad
// cache entry. The drawio-elk bundle (postLayout) is deliberately NOT primed
// here: ~900 KB for a pass many installs never request.
import { loadCachedSource, ROUTING_CORE } from "./cdn-cache.js";

try
{
  await loadCachedSource(ROUTING_CORE, function(src)
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

// No explicit process.exit() here - on Windows, calling it immediately after
// an awaited fetch() can race libuv's async-handle teardown for the
// fetch/undici internals and crash with "Assertion failed:
// !(handle->flags & UV_HANDLE_CLOSING)" (nodejs/node#56645, fixed for
// Node itself in nodejs/node#61999, but still hit on affected versions).
// Setting exitCode and letting the event loop drain naturally is the
// workaround the Node core team documented for callers on unpatched
// versions - fetch's keep-alive sockets unref themselves once idle, so
// this script still exits promptly with nothing else pending.
process.exitCode = 0;
