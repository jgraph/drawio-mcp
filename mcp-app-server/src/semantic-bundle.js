// The semantic engine (shared/semantic) as one classic script for the app's
// iframe, so the viewer can lay out a description while it streams in, as it
// draws streaming XML and Mermaid. The engine is a set of ES modules; the
// sandboxed iframe can't import modules (no allow-same-origin, so Blob URL
// imports fail), and the HTML is built as a string anyway (buildHtml).
//
// A bundler for this code only: every module becomes a function that returns
// its exports, run in dependency order, and the script defines one global,
// DrawioSemantic ({semanticToXml, SUPPORTED_TYPES}). It reads the subset of
// module syntax the engine is written in: single-line named imports of
// relative paths, `export` in front of a function, class, const, let or var,
// and `export { a, b };`. Anything else throws, so a new construct fails the
// build and the test instead of the viewer.
//
// Node only (fs): src/index.js and src/build-html.js read it at startup or
// build time and pass the script to buildHtml as options.semanticJs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHARED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "shared");
const ENTRY = path.join(SHARED, "semantic", "index.js");

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*"(\.{1,2}\/[^"]+)";\s*$/;
const EXPORT_DECL = /^export\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/;
const EXPORT_LIST = /^export\s*\{([^}]*)\};?\s*$/;

function names(list)
{
  return list.split(",").map(function(s) { return s.trim(); }).filter(function(s) { return s !== ""; });
}

// One module: its code with the imports turned into reads of the modules
// they name, the export keywords dropped, and a return of its exports.
function transform(file, key)
{
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const imports = [];
  const exportsOf = [];
  const out = [];

  for (const line of lines)
  {
    let m = IMPORT.exec(line);

    if (m != null)
    {
      const dep = path.resolve(path.dirname(file), m[2]);
      const bindings = names(m[1]).map(function(n)
      {
        const as = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(n);

        return as != null ? as[1] + ": " + as[2] : n;
      });
      imports.push(dep);
      out.push("const { " + bindings.join(", ") + " } = __modules[" + JSON.stringify(key(dep)) + "];");
      continue;
    }

    if (/^\s*(import|export)\b/.test(line) && !/^export\s/.test(line))
    {
      throw new Error(path.relative(SHARED, file) + ": unsupported module syntax: " + line.trim());
    }

    m = EXPORT_DECL.exec(line);

    if (m != null)
    {
      exportsOf.push(m[2]);
      out.push(line.replace(/^export\s+/, ""));
      continue;
    }

    m = EXPORT_LIST.exec(line);

    if (m != null)
    {
      for (const n of names(m[1]))
      {
        exportsOf.push(n);
      }

      continue;
    }

    if (/^\s*import\b|^\s*export\b/.test(line))
    {
      throw new Error(path.relative(SHARED, file) + ": unsupported module syntax: " + line.trim());
    }

    out.push(line);
  }

  return { imports: imports, exports: exportsOf, code: out.join("\n") };
}

/**
 * The engine as a classic script that defines the global DrawioSemantic.
 *
 * @returns {string}
 */
export function bundleSemanticEngine()
{
  const key = function(file) { return path.relative(SHARED, file).split(path.sep).join("/"); };
  const done = new Map();
  const order = [];

  const visit = function(file, stack)
  {
    if (done.has(file))
    {
      return;
    }

    if (stack.indexOf(file) >= 0)
    {
      throw new Error("import cycle: " + stack.concat([file]).map(key).join(" -> "));
    }

    const m = transform(file, key);

    for (const dep of m.imports)
    {
      visit(dep, stack.concat([file]));
    }

    done.set(file, m);
    order.push(file);
  };

  visit(ENTRY, []);

  const parts = ["var DrawioSemantic = (function()", "{", "\"use strict\";", "var __modules = {};"];

  for (const file of order)
  {
    const m = done.get(file);
    parts.push("__modules[" + JSON.stringify(key(file)) + "] = (function()", "{", m.code,
      "return { " + m.exports.map(function(n) { return n + ": " + n; }).join(", ") + " };", "})();");
  }

  parts.push("return __modules[" + JSON.stringify(key(ENTRY)) + "];", "})();");

  // The script goes into the HTML inline: no "</script" may end it early.
  return parts.join("\n").replace(/<\/script/gi, "<\\/script");
}
