// A page of pairs for a person to judge blind: the same question the judge
// model gets (judge.mjs), for a sample of the rendered pairs. Every pair
// shows the prompt and the two inline images as A and B, in an order drawn
// per pair; the page keeps the choices (localStorage) and exports them as
// JSON. Which variant was A is only in key.json.
//
// Writes <to>/index.html, <to>/key.json and the images as <nn>-a.png and
// <nn>-b.png, so the file names say nothing.
//
// usage: node pairs.mjs --a today --b semantic-rows [--count 20] [--seed 1]
//          [--runs-model sonnet,opus] [--type architecture] [--split held-out]
//          [--prompts aws,swimlane] [--edits] [--out DIR] [--to DIR]
//        node pairs.mjs --score choices.json [--to DIR]

import fs from "node:fs";
import path from "node:path";
import { parseArgs, outDir, loadPrompts, selectKeys, runTag } from "./lib/common.mjs";

const args = parseArgs(process.argv.slice(2));
const out = outDir(args);
const to = args.to || path.join(out, "pairs");

if (args.score)
{
  score();
}
else
{
  build();
}

// A small seeded generator, so the same call picks the same pairs.
function random(seed)
{
  let s = (Number(seed) || 1) >>> 0;

  return function()
  {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;

    return s / 4294967296;
  };
}

function escapeHtml(text)
{
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function build()
{
  const prompts = loadPrompts();
  const a = args.a || "today";
  const b = args.b || "semantic";
  const models = String(args["runs-model"] || "sonnet").split(",");
  const count = Number(args.count || 20);
  const edits = !!args.edits;
  const rnd = random(args.seed);
  const all = [];

  for (const key of selectKeys(prompts, args))
  {
    for (const model of models)
    {
      for (let r = 1; r <= 20; r++)
      {
        const fa = path.join(out, runTag(a, key, model, r) + (edits ? "-edit" : "") + "-inline.png");
        const fb = path.join(out, runTag(b, key, model, r) + (edits ? "-edit" : "") + "-inline.png");

        if (fs.existsSync(fa) && fs.existsSync(fb))
        {
          all.push({ key: key, model: model, repeat: r, a: fa, b: fb });
        }
      }
    }
  }

  // A sample spread over the prompts: shuffle, then take one pair per prompt
  // in turn until the count is reached.
  for (let i = all.length - 1; i > 0; i--)
  {
    const j = Math.floor(rnd() * (i + 1));
    const t = all[i];

    all[i] = all[j];
    all[j] = t;
  }

  const picked = [];
  const taken = new Map();

  for (let round = 0; picked.length < Math.min(count, all.length); round++)
  {
    for (const p of all)
    {
      if (picked.length < count && (taken.get(p.key) || 0) === round && picked.indexOf(p) < 0)
      {
        picked.push(p);
        taken.set(p.key, round + 1);
      }
    }
  }

  fs.mkdirSync(to, { recursive: true });

  const key = { a: a, b: b, edits: edits, pairs: [] };
  const items = [];

  picked.forEach(function(p, i)
  {
    const n = String(i + 1).padStart(2, "0");
    const aFirst = rnd() < 0.5;

    fs.copyFileSync(aFirst ? p.a : p.b, path.join(to, n + "-a.png"));
    fs.copyFileSync(aFirst ? p.b : p.a, path.join(to, n + "-b.png"));
    key.pairs.push({ pair: n, prompt: p.key, type: prompts[p.key].type, split: prompts[p.key].split, model: p.model,
      repeat: p.repeat, A: aFirst ? a : b, B: aFirst ? b : a });
    items.push({ n: n, request: edits ? prompts[p.key].prompt + "\n\nThen: " + prompts[p.key].edit : prompts[p.key].prompt });
  });

  fs.writeFileSync(path.join(to, "key.json"), JSON.stringify(key, null, 1));
  fs.writeFileSync(path.join(to, "index.html"), page(items));
  console.log(picked.length + " pairs in " + to + " (index.html; the key is key.json)");
}

function page(items)
{
  const blocks = items.map(function(it)
  {
    return "<section id=\"p" + it.n + "\">\n<h2>Pair " + it.n + "</h2>\n<p class=\"request\">" + escapeHtml(it.request).replace(/\n/g, "<br>") +
      "</p>\n<div class=\"pair\">\n" +
      "<figure><figcaption>A</figcaption><img src=\"" + it.n + "-a.png\" alt=\"Diagram A\"></figure>\n" +
      "<figure><figcaption>B</figcaption><img src=\"" + it.n + "-b.png\" alt=\"Diagram B\"></figure>\n</div>\n" +
      "<p class=\"choice\">Better: " +
      ["A", "B", "tie"].map(function(v)
      {
        return "<label><input type=\"radio\" name=\"p" + it.n + "\" value=\"" + v + "\"> " + (v === "tie" ? "no difference" : v) + "</label>";
      }).join(" ") + " <input type=\"text\" name=\"note" + it.n + "\" placeholder=\"why (optional)\" size=\"50\"></p>\n</section>";
  });

  return "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Diagram pairs</title>\n<style>\n" +
    "body { font: 15px/1.4 system-ui, sans-serif; margin: 24px; color: #1b1f24; background: #f4f5f7; }\n" +
    "section { background: #fff; border: 1px solid #d6dae1; border-radius: 8px; padding: 16px; margin: 0 0 24px; }\n" +
    "h2 { margin: 0 0 8px; font-size: 17px; }\n.request { max-width: 1100px; }\n" +
    ".pair { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }\n" +
    "figure { margin: 0; }\nfigcaption { font-weight: 600; margin: 0 0 4px; }\n" +
    "img { width: 800px; max-width: 100%; border: 1px solid #d6dae1; }\n" +
    ".choice label { margin-right: 14px; }\n#bar { position: sticky; top: 0; background: #f4f5f7; padding: 8px 0; z-index: 1; }\n" +
    "textarea { width: 100%; height: 160px; }\n</style>\n</head>\n<body>\n" +
    "<h1>Which diagram would you prefer?</h1>\n" +
    "<p>Both diagrams were drawn for the request above them and are shown as the chat shows them, 800 px wide. " +
    "Pick the one you would rather get: content first, then layout, readability at this size and tidiness. " +
    "Your choices are kept in this browser; <em>Export</em> gives them as JSON for <code>node pairs.mjs --score</code>.</p>\n" +
    "<div id=\"bar\"><span id=\"count\"></span> <button id=\"export\">Export</button></div>\n" +
    blocks.join("\n") + "\n<textarea id=\"result\" readonly hidden></textarea>\n<script>\n" +
    "var KEY = 'diagram-pairs-' + " + JSON.stringify(items.map(function(it) { return it.n; }).join("")) + ".length + '-' + location.pathname;\n" +
    "var state = {};\ntry { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { state = {}; }\n" +
    "function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} update(); }\n" +
    "function update() { var n = 0; for (var k in state) { if (/^p/.test(k) && state[k]) n++; } " +
    "document.getElementById('count').textContent = n + ' of " + items.length + " judged'; }\n" +
    "document.querySelectorAll('input').forEach(function(el) {\n" +
    "  if (el.type === 'radio') { if (state[el.name] === el.value) el.checked = true; el.addEventListener('change', function() { state[el.name] = el.value; save(); }); }\n" +
    "  else { el.value = state[el.name] || ''; el.addEventListener('input', function() { state[el.name] = el.value; save(); }); }\n});\n" +
    "document.getElementById('export').addEventListener('click', function() {\n" +
    "  var out = document.getElementById('result'); out.hidden = false; out.value = JSON.stringify(state, null, 1); out.select();\n});\nupdate();\n" +
    "</script>\n</body>\n</html>\n";
}

// The share of B from a person's choices: a tie counts half, as in judge.mjs.
function score()
{
  const key = JSON.parse(fs.readFileSync(path.join(to, "key.json"), "utf8"));
  const choices = JSON.parse(fs.readFileSync(args.score, "utf8"));
  let judged = 0;
  let points = 0;
  const byType = new Map();

  for (const p of key.pairs)
  {
    const c = choices["p" + p.pair];

    if (c !== "A" && c !== "B" && c !== "tie")
    {
      continue;
    }

    const got = c === "tie" ? 0.5 : (p[c] === key.b ? 1 : 0);

    judged++;
    points += got;

    const t = byType.get(p.type) || { judged: 0, points: 0 };

    t.judged++;
    t.points += got;
    byType.set(p.type, t);
    console.log(p.pair, p.prompt.padEnd(24), p.model.padEnd(7), c === "tie" ? "tie" : p[c], choices["note" + p.pair] || "");
  }

  byType.forEach(function(t, type)
  {
    console.log(type + ": " + key.b + " " + t.points + " of " + t.judged + " (" + (t.points / t.judged).toFixed(2) + ")");
  });
  console.log(judged + " of " + key.pairs.length + " judged: " + key.b + " " + points + " points, share " +
    (judged > 0 ? (points / judged).toFixed(2) : "–") + " against " + key.a);
}
