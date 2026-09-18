import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Regression coverage for the Windows postinstall crash (issue #65):
// process.exit() called immediately after an awaited fetch() can race
// libuv's handle teardown on Windows (nodejs/node#56645). This can't
// reproduce the timing-dependent crash itself, but it pins the contract
// the fix relies on - the script always finishes with exit code 0 and
// no stderr, on both the cold-fetch and cached-revalidation paths -
// which a reintroduced process.exit() would not change, so a true
// regression test would need to run on the affected Windows/Node
// combination to catch the race directly.

const POSTINSTALL = fileURLToPath(new URL("../src/postinstall.js", import.meta.url));

function runPostinstall(cacheDir)
{
  return spawnSync(process.execPath, [POSTINSTALL],
    { env: { ...process.env, XDG_CACHE_HOME: cacheDir },
      timeout: 15000,
      encoding: "utf8" });
}

test("postinstall.js exits cleanly on a cold cache (fresh fetch path)", function ()
{
  const cacheDir = mkdtempSync(join(tmpdir(), "drawio-postinstall-"));

  try
  {
    const result = runPostinstall(cacheDir);

    assert.equal(result.signal, null, "should not be killed by a signal/crash");
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
  }
  finally
  {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("postinstall.js exits cleanly on a warm cache (revalidation path)", function ()
{
  const cacheDir = mkdtempSync(join(tmpdir(), "drawio-postinstall-"));

  try
  {
    // Prime the cache first, then run again so the second invocation takes
    // the conditional-GET/304 branch instead of a full download.
    const first = runPostinstall(cacheDir);
    assert.equal(first.status, 0);

    const second = runPostinstall(cacheDir);

    assert.equal(second.signal, null, "should not be killed by a signal/crash");
    assert.equal(second.status, 0);
    assert.equal(second.stderr, "");
  }
  finally
  {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
