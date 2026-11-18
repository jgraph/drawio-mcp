import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// The plugins' scripts/mermaid-to-drawio.js relaunches the browser without
// its sandbox when Chrome says it can't start one. Checked with a stand-in
// for the browser that prints what Chrome prints and exits, so no browser is
// needed.

const require = createRequire(import.meta.url);
const converter = require("../../plugins/claude-code/skills/drawio/scripts/mermaid-to-drawio.js");
const posix = process.platform !== "win32";

// A browser that logs its arguments, prints the line to stderr and exits
function fakeBrowser(dir, line)
{
  var file = path.join(dir, "browser.sh");
  var log = path.join(dir, "args.log");

  fs.writeFileSync(file, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '" + log + "'\nprintf '%s\\n' '" + line + "' >&2\nexit 1\n");
  fs.chmodSync(file, 0o755);

  return { file: file, args: function()
  {
    return fs.readFileSync(log, "utf-8").trim().split("\n");
  } };
}

async function startFails(browser, extraArgs)
{
  var cdp = converter.launch(browser, extraArgs);

  try
  {
    await converter.openPage(cdp);
  }
  catch (e)
  {
    return e;
  }
  finally
  {
    await cdp.close();
  }

  assert.fail("the browser started");
}

function withDir(fn)
{
  return async function()
  {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), "drawio-sandbox-test-"));

    try
    {
      await fn(dir);
    }
    finally
    {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

// What Chrome prints for each, as [what, line]
const SANDBOX_LINES =
[
  ["no user namespaces", "[0101/000000.000000:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox! Update your kernel or see https://chromium.googlesource.com/chromium/src/+/main/docs/linux/suid_sandbox_development.md for more information on developing with the SUID sandbox."],
  ["run as root", "[0101/000000.000000:ERROR:zygote_host_impl_linux.cc(100)] Running as root without --no-sandbox is not supported. See https://crbug.com/638180."],
  ["a SUID helper that isn't set up", "[0101/000000.000000:FATAL:setuid_sandbox_host.cc(158)] The SUID sandbox helper binary was found, but is not configured correctly. Rather than run without sandboxing I am aborting now."],
  ["a container that may not make namespaces", "[0101/000000.000000:FATAL:zygote_host_impl_linux.cc(201)] Check failed: . : Failed to move to new namespace: PID namespaces supported, Network namespace supported, but failed: errno = Operation not permitted (1)"]
];

SANDBOX_LINES.forEach(function(entry)
{
  test("a browser that can't start its sandbox is relaunched without it: " + entry[0], { skip: !posix }, withDir(async function(dir)
  {
    var e = await startFails(fakeBrowser(dir, entry[1]).file);

    assert.equal(e.code, "NO_SANDBOX", e.message);
  }));
});

test("any other exit of the browser is not taken for the sandbox", { skip: !posix }, withDir(async function(dir)
{
  var e = await startFails(fakeBrowser(dir, "[0101/000000.000000:ERROR:browser_main_loop.cc(1)] Missing X server or $DISPLAY").file);

  assert.equal(e.code, "EXITED", e.message);
}));

test("convertMermaid relaunches with --no-sandbox once and then gives up", { skip: !posix }, withDir(async function(dir)
{
  var browser = fakeBrowser(dir, SANDBOX_LINES[1][1]);

  await assert.rejects(converter.convertMermaid(["flowchart TD\n  A --> B"], { browser: browser.file }),
    function(e) { return e.code === "NO_SANDBOX"; });

  var runs = browser.args();

  assert.equal(runs.length, 2);
  assert.match(runs[1], /--no-sandbox/);
}));

test("as root on Linux the browser starts without its sandbox at once", { skip: process.platform !== "linux" }, withDir(async function(dir)
{
  var getuid = process.getuid;
  var browser = fakeBrowser(dir, "exit");

  process.getuid = function() { return 0; };

  try
  {
    await startFails(browser.file);
    await startFails(browser.file, ["--no-sandbox"]);
  }
  finally
  {
    process.getuid = getuid;
  }

  var runs = browser.args();

  assert.match(runs[0], /--no-sandbox/);
  assert.equal(runs[1].split("--no-sandbox").length, 2, "--no-sandbox once: " + runs[1]);
}));
