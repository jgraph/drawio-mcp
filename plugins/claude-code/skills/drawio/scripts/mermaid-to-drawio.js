// Converts Mermaid to an editable .drawio file without draw.io Desktop. It runs
// draw.io's own converter (the one the draw.io editor, the desktop app and the
// MCP servers run, from viewer.diagrams.net) in a headless Chrome, Edge or
// Chromium that is already installed: shapes, connectors and labels come out as
// native draw.io cells. Needs Node.js 18+ and network access. Only the
// converter's scripts and fonts are downloaded; the Mermaid text is converted
// in the local browser and sent nowhere.
//
// Usage: node mermaid-to-drawio.js diagram.mmd [more.mmd ...]
//          writes diagram.drawio next to each input
//        node mermaid-to-drawio.js diagram.mmd -o out.drawio
//        node mermaid-to-drawio.js --link diagram.mmd
//          prints an app.diagrams.net link instead, which converts the Mermaid
//          in the user's browser (no local Chrome needed)
//
// Set CHROME_PATH to the browser to use when it isn't on a usual install path.
// Exit codes: 0 done, 1 a diagram did not convert, 2 usage, 3 no browser found
// or the converter could not be loaded (use --link then).

var childProcess = require("child_process");
var fs = require("fs");
var os = require("os");
var path = require("path");
var zlib = require("zlib");

var BUNDLE_BASE = "https://viewer.diagrams.net/js/";
var BUNDLES = ["viewer-static.min.js", "elk/drawio-elk.min.js", "mermaid/drawio-mermaid.min.js"];
// libavoid as draw.io loads it, the router and then its routing core
// (globalThis.Avoid, AvoidRouting): drawio-mermaid routes the edges of
// swimlane diagrams with them. Unless both arrive within ROUTER_TIMEOUT,
// neither runs, and a diagram converts as before, its swimlane edges as the
// layout drew them.
var ROUTER_BUNDLES = ["libavoid-js/libavoid.min.js", "libavoid-js/libavoid-routing.js"];
var ROUTER_TIMEOUT = 20000;
// The diagram types drawio-mermaid routes with libavoid. A run without one
// of them loads no libavoid.
var ROUTED_TYPES = ["swimlane-beta"];
var EDITOR_URL = "https://app.diagrams.net/?pv=0&grid=0";

// The defaults of Mermaid 12 (ELK layout, redux theme), as the MCP servers use
var MERMAID_DEFAULTS_VERSION = "12";
var TIMEOUT = 90000;

function onPath(names)
{
  var dirs = (process.env.PATH || "").split(path.delimiter);

  for (var i = 0; i < names.length; i++)
  {
    for (var j = 0; j < dirs.length; j++)
    {
      if (dirs[j] !== "" && fs.existsSync(path.join(dirs[j], names[i])))
      {
        return path.join(dirs[j], names[i]);
      }
    }
  }

  return null;
}

function findBrowser()
{
  if (process.env.CHROME_PATH)
  {
    return process.env.CHROME_PATH;
  }

  var candidates = [];

  if (process.platform === "darwin")
  {
    ["Google Chrome", "Microsoft Edge", "Chromium", "Brave Browser"].forEach(function(app)
    {
      var rel = app + ".app/Contents/MacOS/" + app;
      candidates.push("/Applications/" + rel, path.join(os.homedir(), "Applications", rel));
    });
  }
  else if (process.platform === "win32")
  {
    var roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA];

    roots.filter(Boolean).forEach(function(root)
    {
      candidates.push(path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(root, "Chromium", "Application", "chrome.exe"),
        path.join(root, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"));
    });
  }
  else
  {
    var found = onPath(["google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
      "microsoft-edge", "microsoft-edge-stable", "brave-browser", "chrome"]);

    if (found != null)
    {
      return found;
    }

    candidates.push("/snap/bin/chromium", "/opt/google/chrome/chrome", "/usr/bin/chromium");
  }

  for (var i = 0; i < candidates.length; i++)
  {
    if (fs.existsSync(candidates[i]))
    {
      return candidates[i];
    }
  }

  return null;
}

// What Chrome prints on Linux when it can't start its sandbox: no user
// namespaces (Chrome for Testing, Chromium without an AppArmor profile), run
// as root (Docker, dev containers, CI jobs), a SUID helper that isn't set up,
// or a container that may not make namespaces
var SANDBOX_FAILED = /No usable sandbox|without --no-sandbox|SUID sandbox helper|Failed to move to new namespace/;

// Chrome on Linux never starts its sandbox as root, so it gets none from the start
function runsAsRoot()
{
  return process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0;
}

// The Chrome DevTools protocol over --remote-debugging-pipe: Chrome reads
// commands from fd 3 and writes replies to fd 4, each message ending in \0.
function launch(browser, extraArgs)
{
  var profile = fs.mkdtempSync(path.join(os.tmpdir(), "drawio-mermaid-"));
  var extra = (extraArgs || []).slice();

  if (runsAsRoot() && extra.indexOf("--no-sandbox") < 0)
  {
    extra.push("--no-sandbox");
  }

  var args = ["--headless=new", "--remote-debugging-pipe", "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync",
    "--mute-audio", "--hide-scrollbars", "--window-size=1280,1000"].concat(extra, ["about:blank"]);

  var child = childProcess.spawn(browser, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  var pending = {};
  var nextId = 1;
  var buffer = Buffer.alloc(0);
  var stderr = "";
  var noSandbox = false;
  var exited = null;

  function failAll(err)
  {
    Object.keys(pending).forEach(function(id)
    {
      pending[id].reject(err);
      delete pending[id];
    });
  }

  child.stderr.on("data", function(chunk)
  {
    stderr = (stderr + chunk.toString()).slice(-2000);
    noSandbox = noSandbox || SANDBOX_FAILED.test(stderr);
  });

  child.on("error", function(err)
  {
    exited = err;
    failAll(err);
  });

  child.on("exit", function(code)
  {
    // Node can fire exit before the last of stderr is read, and the line
    // that says the sandbox is missing decides on a relaunch without it. A
    // process Chrome started may hold stderr open, so not for more than 1 s.
    var settle = function()
    {
      if (exited == null)
      {
        exited = new Error("The browser exited (" + code + "): " + stderr.trim().split("\n").pop());
        exited.code = noSandbox ? "NO_SANDBOX" : "EXITED";
        failAll(exited);
      }
    };

    if (child.stderr.readableEnded)
    {
      settle();
    }
    else
    {
      child.stderr.once("end", settle);
      setTimeout(settle, 1000).unref();
    }
  });

  child.stdio[4].on("data", function(chunk)
  {
    buffer = Buffer.concat([buffer, chunk]);
    var end;

    while ((end = buffer.indexOf(0)) >= 0)
    {
      var msg = JSON.parse(buffer.subarray(0, end).toString("utf8"));
      buffer = buffer.subarray(end + 1);

      if (msg.id != null && pending[msg.id] != null)
      {
        var p = pending[msg.id];
        delete pending[msg.id];

        if (msg.error != null)
        {
          p.reject(new Error(msg.error.message));
        }
        else
        {
          p.resolve(msg.result);
        }
      }
    }
  });

  // Errors on the pipes follow from the exit, which rejects what is pending
  child.stdio[3].on("error", function() {});
  child.stdio[4].on("error", function() {});

  function send(method, params, sessionId)
  {
    if (exited != null)
    {
      return Promise.reject(exited);
    }

    var id = nextId++;
    var msg = { id: id, method: method, params: params || {} };

    if (sessionId != null)
    {
      msg.sessionId = sessionId;
    }

    return new Promise(function(resolve, reject)
    {
      var timer = setTimeout(function()
      {
        delete pending[id];
        reject(new Error(method + " timed out"));
      }, TIMEOUT);

      pending[id] = {
        resolve: function(v) { clearTimeout(timer); resolve(v); },
        reject: function(e) { clearTimeout(timer); reject(e); }
      };
      child.stdio[3].write(JSON.stringify(msg) + "\0");
    });
  }

  function close()
  {
    return new Promise(function(resolve)
    {
      var done = function()
      {
        try
        {
          fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
        }
        catch (e)
        {
          // A profile Windows still holds is left in the temp folder
        }

        resolve();
      };

      // Also once exit has fired and its error waits for stderr
      if (exited != null || child.exitCode != null || child.signalCode != null)
      {
        done();
        return;
      }

      child.once("exit", done);
      send("Browser.close").catch(function() {});
      setTimeout(function()
      {
        child.kill();
      }, 3000).unref();
    });
  }

  return { send: send, close: close };
}

// Opens a page and returns evaluate(fn, args...): fn runs in the page, its
// (awaited) result comes back as JSON.
async function openPage(cdp, url)
{
  var target = await cdp.send("Target.createTarget", { url: url || "about:blank" });
  var attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  var session = attached.sessionId;

  return async function evaluate(fn)
  {
    var args = Array.prototype.slice.call(arguments, 1);
    var res = await cdp.send("Runtime.evaluate", {
      expression: "(" + fn.toString() + ").apply(null, " + JSON.stringify(args) + ")",
      awaitPromise: true,
      returnByValue: true
    }, session);

    if (res.exceptionDetails != null)
    {
      var ex = res.exceptionDetails.exception;
      throw new Error((ex != null && ex.description) || res.exceptionDetails.text);
    }

    return res.result.value;
  };
}

// Runs in the page: loads the draw.io viewer, drawio-elk and drawio-mermaid
function loadConverter(base, bundles)
{
  window.DRAWIO_BASE_URL = "https://app.diagrams.net";

  function load(i)
  {
    if (i >= bundles.length)
    {
      return Promise.resolve(typeof HeadlessEditorUi !== "undefined" &&
        typeof mxMermaidToDrawio !== "undefined");
    }

    // parseText falls back to emptyDiagramXml for types it doesn't know
    if (i > 0 && typeof EditorUi !== "undefined" && EditorUi.prototype.emptyDiagramXml == null)
    {
      EditorUi.prototype.emptyDiagramXml = '<mxGraphModel><root><mxCell id="0"/>' +
        '<mxCell id="1" parent="0"/></root></mxGraphModel>';
    }

    return new Promise(function(resolve, reject)
    {
      var script = document.createElement("script");
      script.src = base + bundles[i];
      script.onload = resolve;
      script.onerror = function()
      {
        reject(new Error("Could not load " + script.src));
      };
      document.head.appendChild(script);
    }).then(function()
    {
      return load(i + 1);
    });
  }

  return load(0);
}

// Runs in the page: loads optional scripts, all of them or none. They are
// fetched together and run in their order only when every one has arrived
// within timeout, so a late one never runs between two conversions. Resolves
// to whether they ran.
function loadOptional(base, files, timeout)
{
  var controller = new AbortController();
  var timer = setTimeout(function()
  {
    controller.abort();
  }, timeout);

  return Promise.all(files.map(function(file)
  {
    return fetch(base + file, { signal: controller.signal }).then(function(res)
    {
      if (!res.ok)
      {
        throw new Error(res.status + " " + res.url);
      }

      return res.text();
    });
  })).then(function(texts)
  {
    clearTimeout(timer);

    texts.forEach(function(text)
    {
      var script = document.createElement("script");
      script.text = text;
      document.head.appendChild(script);
    });

    return true;
  }, function()
  {
    clearTimeout(timer);
    controller.abort();

    return false;
  });
}

// Runs in the page: whether one of the texts is of one of the types, by
// draw.io's own detection. Where the converter has none, any text may be.
function hasDiagramType(texts, types)
{
  var ui = new HeadlessEditorUi();

  if (typeof ui.getMermaidDiagramType !== "function")
  {
    return true;
  }

  return texts.some(function(text)
  {
    return types.indexOf(ui.getMermaidDiagramType(text)) >= 0;
  });
}

// Runs in the page: the conversion the desktop app's CLI runs (export.js),
// which loads the diagram's web fonts first, so labels are measured in the
// font they are drawn in, and then makes the converted cells a page
function convertInPage(text, version)
{
  return new Promise(function(resolve)
  {
    var ui = new HeadlessEditorUi();
    var type = (typeof ui.getMermaidDiagramType === "function") ? ui.getMermaidDiagramType(text) : null;

    ui.parseMermaidDiagram(text, null, function(xml)
    {
      resolve({ type: type, xml: (typeof ui.createMermaidPageXml === "function") ?
        ui.createMermaidPageXml(xml) : xml });
    }, function(e)
    {
      resolve({ type: type, error: (e != null && e.message) ? e.message : String(e) });
    }, null, version);
  });
}

// Converts each Mermaid text to draw.io XML (an <mxGraphModel>). Returns
// [{ type, xml } or { type, error }] in the order of the texts. Throws when no
// browser is found or the converter can't be loaded. Options: browser,
// version, and for tests bundleBase and routerTimeout.
async function convertMermaid(texts, options)
{
  options = options || {};
  var browser = options.browser || findBrowser();

  if (browser == null)
  {
    var err = new Error("No Chrome, Edge or Chromium found. Set CHROME_PATH to one, or use --link.");
    err.code = "NO_BROWSER";
    throw err;
  }

  var cdp = launch(browser);

  try
  {
    var evaluate;

    try
    {
      evaluate = await openPage(cdp);
    }
    catch (e)
    {
      if (e.code !== "NO_SANDBOX")
      {
        throw e;
      }

      // Chrome for Testing and Chromium builds without the AppArmor profile of
      // an installed Chrome (Ubuntu 23.10+) can't start their sandbox, nor can
      // a browser in a container that may not make namespaces. The page runs
      // only draw.io's scripts on the Mermaid text, so it runs without it.
      await cdp.close();
      cdp = launch(browser, ["--no-sandbox"]);
      evaluate = await openPage(cdp);
    }

    if (!(await evaluate(loadConverter, options.bundleBase || BUNDLE_BASE, BUNDLES)))
    {
      throw new Error("The draw.io converter did not load from " + (options.bundleBase || BUNDLE_BASE));
    }

    // libavoid within ROUTER_TIMEOUT, else none, and only for a run with a
    // diagram that uses it: the converter is loaded, so a slow or missing
    // router never keeps a diagram from converting
    try
    {
      if (await evaluate(hasDiagramType, texts, ROUTED_TYPES))
      {
        await evaluate(loadOptional, options.bundleBase || BUNDLE_BASE, ROUTER_BUNDLES,
          options.routerTimeout || ROUTER_TIMEOUT);
      }
    }
    catch (e)
    {
      // Converted without libavoid, as the layout drew the edges
    }

    var results = [];

    for (var i = 0; i < texts.length; i++)
    {
      try
      {
        results.push(await evaluate(convertInPage, texts[i], options.version || MERMAID_DEFAULTS_VERSION));
      }
      catch (e)
      {
        results.push({ type: null, error: e.message });
      }
    }

    return results;
  }
  finally
  {
    await cdp.close();
  }
}

// The link the MCP tool server opens for Mermaid: draw.io converts the source
// when it opens the link
function mermaidLink(text)
{
  var data = zlib.deflateRawSync(Buffer.from(encodeURIComponent(text))).toString("base64");
  var create = { type: "mermaid", compressed: true, data: data, version: MERMAID_DEFAULTS_VERSION };

  return EDITOR_URL + "#create=" + encodeURIComponent(JSON.stringify(create));
}

function count(xml, attr)
{
  return (xml.match(new RegExp("\\s" + attr + "=\"1\"", "g")) || []).length;
}

async function main()
{
  var argv = process.argv.slice(2);
  var link = false;
  var output = null;
  var inputs = [];

  for (var i = 0; i < argv.length; i++)
  {
    if (argv[i] === "--link")
    {
      link = true;
    }
    else if (argv[i] === "-o" || argv[i] === "--output")
    {
      output = argv[++i];
    }
    else
    {
      inputs.push(argv[i]);
    }
  }

  if (inputs.length === 0 || (output != null && inputs.length !== 1))
  {
    console.error("Usage: node mermaid-to-drawio.js diagram.mmd [more.mmd ...] [-o out.drawio]\n" +
      "       node mermaid-to-drawio.js --link diagram.mmd");
    process.exit(2);
  }

  var texts = inputs.map(function(file)
  {
    return fs.readFileSync(file, "utf8");
  });

  if (link)
  {
    texts.forEach(function(text)
    {
      console.log(mermaidLink(text));
    });

    return;
  }

  var results;

  try
  {
    results = await convertMermaid(texts);
  }
  catch (e)
  {
    console.error(e.message);
    process.exit(3);
  }

  var failed = false;

  results.forEach(function(result, i)
  {
    var file = output || inputs[i].replace(/\.(mmd|mermaid|txt)$/i, "") + ".drawio";

    if (result.error != null)
    {
      failed = true;
      console.error(inputs[i] + ": " + result.error);
    }
    else
    {
      fs.writeFileSync(file, result.xml);
      console.log(file + ": " + (result.type || "mermaid") + ", " + count(result.xml, "vertex") +
        " shapes, " + count(result.xml, "edge") + " connectors");
    }
  });

  process.exit(failed ? 1 : 0);
}

if (require.main === module)
{
  main();
}
else
{
  module.exports = { convertMermaid: convertMermaid, findBrowser: findBrowser, launch: launch,
    openPage: openPage, loadOptional: loadOptional, mermaidLink: mermaidLink,
    MERMAID_DEFAULTS_VERSION: MERMAID_DEFAULTS_VERSION, ROUTER_BUNDLES: ROUTER_BUNDLES,
    ROUTED_TYPES: ROUTED_TYPES };
}
