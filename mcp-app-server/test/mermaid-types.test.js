import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { buildHtml } from "../src/shared.js";
import { transformPages } from "../../shared/mx-xml.js";

// Mermaid in, editable draw.io out: every Mermaid diagram type draw.io
// converts, run through the converter on viewer.diagrams.net in a headless
// Chrome, Edge or Chromium, twice: by the app server's viewer
// (convertMermaidToXml in the app's HTML, what a chat shows) and by the
// plugins' scripts/mermaid-to-drawio.js (the desktop CLI's conversion, for
// the skill without draw.io Desktop). For each type the result must be
// native draw.io cells: no image of the diagram, images only as icons, every
// label in a cell's own text and none locked, connectors attached to the
// shapes they join. What the converter doesn't do yet (drawio-mermaid) is
// written down per type as the most it may leave undone, so a regression
// fails and a fix upstream passes.
//
// Needs a browser and the network: without a browser (CHROME_PATH, or the
// usual install paths) or with DRAWIO_TEST_BROWSER=off the tests are skipped,
// and so they are when the converter can't be loaded. MERMAID_TYPES_REPORT=
// <file> writes what was found per type as JSON.

const require = createRequire(import.meta.url);
const converter = require("../../plugins/claude-code/skills/drawio/scripts/mermaid-to-drawio.js");
const referenceText = fs.readFileSync(new URL("../../shared/mermaid-reference.md", import.meta.url), "utf-8");

// type: the samples, the labels that must each be the text of a cell, the
// most edges that may lack an end (loose), the most images (icons), and
// [container, child] labels where the child must be inside the container.
// Most samples are the reference's examples (shared/mermaid-reference.md).
const TYPES =
[
  {
    type: "flowchart",
    mermaid: "flowchart TD\n  A[Start] --> B{Decision?}\n  B -->|Yes| C[Do thing]\n  B -->|No| D[Skip]\n  C --> E((End))\n  D --> E",
    labels: ["Start", "Decision?", "Do thing", "Skip", "End", "Yes", "No"]
  },
  {
    type: "flowchart with subgraphs",
    mermaid: "flowchart LR\n  subgraph Backend\n    API[API server] --> DB[(Database)]\n  end\n  Web[Web app] -->|REST| API",
    labels: ["Backend", "API server", "Database", "Web app", "REST"],
    inside: [["Backend", "API server"], ["Backend", "Database"]]
  },
  {
    type: "sequence",
    mermaid: "sequenceDiagram\n  participant U as User\n  participant S as Server\n  U->>S: Request\n  S-->>U: Response\n  Note right of S: Logged",
    labels: ["User", "Server", "Request", "Response", "Logged"]
  },
  {
    // drawio-mermaid: a message that creates a participant ends next to its head, not on it
    type: "sequence with a created participant",
    mermaid: "sequenceDiagram\n  participant A as Alice\n  create participant B as Bob\n  A->>B: Hello Bob\n  B-->>A: Hi",
    labels: ["Alice", "Bob", "Hello Bob", "Hi"],
    loose: 1
  },
  {
    type: "class",
    mermaid: "classDiagram\n  class Animal {\n    +String name\n    +int age\n    +eat() void\n  }\n  class Dog\n  Animal <|-- Dog : inherits\n  Dog \"1\" --> \"*\" Bone : has",
    labels: ["Animal", "+String name", "+eat() void", "Dog", "Bone", "inherits", "has"],
    inside: [["Animal", "+String name"]]
  },
  {
    type: "state",
    mermaid: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running : start\n  Running --> Idle : stop\n  Running --> [*]\n  state Running {\n    [*] --> Working\n    Working --> Waiting : block\n    Waiting --> Working : unblock\n  }",
    labels: ["Idle", "Running", "start", "stop", "Working", "Waiting", "block", "unblock"],
    inside: [["Running", "Working"], ["Running", "Waiting"]]
  },
  {
    type: "er",
    mermaid: "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE-ITEM : contains\n  CUSTOMER {\n    string name\n    string email PK\n  }",
    labels: ["CUSTOMER", "ORDER", "LINE-ITEM", "places", "contains", "email"],
    inside: [["CUSTOMER", "email"]]
  },
  {
    // The axis arrow and the dashed lines under the tasks are drawings, not connectors
    type: "journey",
    mermaid: "journey\n  title Morning routine\n  section Wake up\n    Coffee: 5: Me\n    Read news: 3: Me\n  section Commute\n    Drive: 2: Me, Traffic",
    labels: ["Morning routine", "Wake up", "Commute", "Coffee", "Read news", "Drive"],
    loose: 4
  },
  {
    type: "pie",
    mermaid: "pie showData title Browser share\n  \"Chrome\" : 60\n  \"Firefox\" : 20\n  \"Safari\" : 20",
    labels: ["Browser share", "Chrome", "Firefox", "Safari"]
  },
  {
    type: "gantt",
    mermaid: "gantt\n  title Project timeline\n  dateFormat YYYY-MM-DD\n  section Phase 1\n  Design : a1, 2025-01-01, 7d\n  Build  : after a1, 14d\n  section Phase 2\n  Test   : 2025-01-25, 5d",
    labels: ["Project timeline", "Phase 1", "Phase 2", "Design", "Build", "Test"]
  },
  {
    type: "gitgraph",
    mermaid: "gitGraph\n  commit\n  branch develop\n  checkout develop\n  commit\n  commit\n  checkout main\n  merge develop",
    labels: ["main", "develop"]
  },
  {
    type: "mindmap",
    mermaid: "mindmap\n  root((Project))\n    Frontend\n      React\n      CSS\n    Backend\n      Node\n      DB",
    labels: ["Project", "Frontend", "React", "CSS", "Backend", "Node", "DB"]
  },
  {
    // drawio-mermaid: the lines from a period to its events and the axis are
    // loose lines, and each period's label is a text cell laid over its box
    type: "timeline",
    mermaid: "timeline\n  title Company history\n  section 2020s\n    2021 : Founded\n    2022 : Series A\n         : Launched product\n  section 2030s\n    2030 : IPO",
    labels: ["Company history", "2020s", "2021", "Founded", "Series A", "Launched product", "IPO"],
    loose: 4
  },
  {
    type: "quadrant",
    mermaid: "quadrantChart\n  title Reach vs Engagement\n  x-axis Low --> High\n  y-axis Low --> High\n  quadrant-1 Stars\n  quadrant-2 Question Marks\n  quadrant-3 Dogs\n  quadrant-4 Cash Cows\n  Campaign A: [0.3, 0.6]\n  Campaign B: [0.75, 0.85]",
    labels: ["Reach vs Engagement", "Stars", "Question Marks", "Dogs", "Cash Cows", "Campaign A", "Campaign B"]
  },
  {
    type: "requirement",
    mermaid: "requirementDiagram\n  requirement req1 {\n    id: \"1\"\n    text: \"The system shall...\"\n    risk: high\n    verifymethod: test\n  }\n  element user_story {\n    type: \"story\"\n  }\n  user_story - satisfies -> req1",
    labels: ["req1", "user_story", "satisfies"]
  },
  {
    type: "sankey",
    mermaid: "sankey-beta\nSource,Intermediate,10\nSource,Direct,5\nIntermediate,Sink,10",
    labels: ["Source", "Intermediate", "Direct", "Sink"]
  },
  {
    // The line of a line series is a drawing between its points
    type: "xychart",
    mermaid: "xychart-beta\n  title \"Revenue\"\n  x-axis [jan, feb, mar, apr]\n  y-axis \"USD\" 0 --> 10000\n  bar [2500, 5000, 7500, 9000]\n  line [3000, 4500, 6500, 8500]",
    labels: ["Revenue", "jan", "apr", "USD"],
    loose: 1
  },
  {
    type: "block",
    mermaid: "block-beta\n  columns 3\n  A B C\n  D[\"Wide\"]:2 E\n  A --> D",
    labels: ["A", "B", "C", "Wide", "E"]
  },
  {
    type: "c4",
    mermaid: "C4Context\n  Person(user, \"User\")\n  System(app, \"App\", \"Does things\")\n  Rel(user, app, \"Uses\")",
    labels: ["User", "App", "Does things", "Uses"]
  },
  {
    // The service icons are images. drawio-mermaid: a service's name is a
    // text cell under its icon, and the group is a frame, not a container
    type: "architecture",
    mermaid: "architecture-beta\n  group cloud(cloud)[Cloud]\n  service api(server)[API] in cloud\n  service db(database)[DB] in cloud\n  api:R --> L:db",
    labels: ["Cloud", "API", "DB"],
    images: 3
  },
  {
    // drawio-mermaid: the curves are SVG images, not shapes; the axes are lines
    type: "radar",
    mermaid: "radar-beta\n  title Skills\n  axis js[\"JS\"], py[\"Python\"], go[\"Go\"]\n  curve alice[\"Alice\"]{80, 60, 70}\n  curve bob[\"Bob\"]{50, 90, 65}",
    labels: ["Skills", "JS", "Python", "Go", "Alice", "Bob"],
    loose: 3,
    images: 2
  },
  {
    type: "packet",
    mermaid: "packet-beta\n  0-15: \"Source Port\"\n  16-31: \"Dest Port\"\n  32-63: \"Seq Number\"",
    labels: ["Source Port", "Dest Port", "Seq Number"]
  },
  {
    type: "venn",
    mermaid: "venn-beta\n  set A [\"Set A\"]\n  set B [\"Set B\"]\n  union A,B\n  text A [\"only A\"]\n  text A,B [\"shared\"]",
    labels: ["Set A", "Set B", "only A", "shared"]
  },
  {
    type: "treemap",
    mermaid: "treemap-beta\n\"Category\"\n    \"Leaf 1\": 40\n    \"Leaf 2\": 60",
    labels: ["Category", "Leaf 1", "Leaf 2"]
  },
  {
    // drawio-mermaid: the branches are loose lines
    type: "treeview",
    mermaid: "treeView-beta\n  \"Root\"\n    \"Child 1\"\n      \"Grandchild\"\n    \"Child 2\"",
    labels: ["Root", "Child 1", "Grandchild", "Child 2"],
    loose: 7
  },
  {
    // drawio-mermaid: the bones are loose lines
    type: "ishikawa",
    mermaid: "ishikawa-beta\n  Main Problem\n    Category\n      Cause\n      Sub-cause\n    Another Category\n      Cause",
    labels: ["Main Problem", "Category", "Cause", "Sub-cause", "Another Category"],
    loose: 5
  },
  {
    type: "kanban",
    mermaid: "kanban\n  todo[To Do]\n    task1[Write spec]@{ assigned: \"Alice\", priority: \"High\" }\n  doing[In progress]\n    task2[Build feature]\n  done[Done]",
    labels: ["To Do", "Write spec", "In progress", "Build feature", "Done"],
    inside: [["To Do", "Write spec"], ["In progress", "Build feature"]]
  },
  {
    // The participant icons are images
    type: "zenuml",
    mermaid: "zenuml\n  @Actor User\n  @Boundary Web\n  @Control Service\n  User -> Web: request\n  Web -> Service: process()\n  Service -> Web: result",
    labels: ["User", "Web", "Service", "request", "process()", "result"],
    images: 3
  },
  {
    // The axes, the stage lines and the evolve arrow are drawings; the links
    // are attached. drawio-mermaid: a component's name is a text cell beside it
    type: "wardley",
    mermaid: "wardley-beta\n  title Tea Shop\n  anchor Business [0.95, 0.63]\n  component Cup of Tea [0.79, 0.61]\n  component Kettle [0.43, 0.35] (inertia)\n  Business -> Cup of Tea\n  Cup of Tea -> Kettle\n  evolve Kettle 0.62",
    labels: ["Tea Shop", "Business", "Cup of Tea", "Kettle"],
    loose: 6
  },
  {
    // drawio-mermaid: the arrows between the frames are loose lines
    type: "eventmodeling",
    mermaid: "eventmodeling\n  tf 01 ui CartUI\n  tf 02 cmd AddItem\n  tf 03 evt ItemAdded\n  tf 04 rmo Cart",
    labels: ["CartUI", "AddItem", "ItemAdded", "Cart"],
    loose: 3
  },
  // Types draw.io converts that the reference doesn't teach
  {
    type: "swimlane",
    mermaid: "swimlane-beta LR\n  subgraph Customer\n    Browse[Browse catalogue]\n    Pay[Pay]\n  end\n  subgraph Warehouse\n    Pick[Pick items]\n    Ship[Ship order]\n  end\n  Browse --> Pay\n  Pay --> Pick\n  Pick --> Ship",
    labels: ["Customer", "Warehouse", "Browse catalogue", "Pay", "Pick items", "Ship order"],
    inside: [["Customer", "Pay"], ["Warehouse", "Ship order"]]
  },
  {
    type: "usecase",
    mermaid: "usecase-beta\ndirection LR\nactor Customer(\"Customer\")\nsystemBoundary \"Order system\"\n  Checkout(\"Place order\")\nend\nCustomer --> Checkout",
    labels: ["Customer", "Order system", "Place order"]
  },
  {
    type: "agentflow",
    mermaid: "agentflow-beta TB\n  flow reviewer[\"Review Agent\"]\n    changes[\"Gather changes\"]@{ shape: input }\n    analyse[\"Analyse diff\"]@{ shape: task }\n    ok[\"Clean?\"]@{ shape: decision }\n    changes --> analyse --> ok\n  end",
    labels: ["Review Agent", "Gather changes", "Analyse diff", "Clean?"],
    inside: [["Review Agent", "Analyse diff"]]
  },
  {
    // drawio-mermaid: the tracks are loose lines, and the title isn't drawn
    type: "railroad",
    mermaid: "railroad-ebnf-beta\ntitle \"Sign\"\n\nsign = \"+\" | \"-\" ;",
    labels: ["sign", "+", "-"],
    loose: 6
  },
  {
    // drawio-mermaid: the items are not inside their domains
    type: "cynefin",
    mermaid: "cynefin-beta\n  title Incident Response\n\n  complex\n    \"Investigate root cause\"\n\n  clear\n    \"Restart service\"\n\n  chaotic\n    \"Page on-call immediately\"",
    labels: ["Incident Response", "Investigate root cause", "Restart service", "Page on-call immediately"],
    loose: 3
  }
];

// The ```blocks of the reference, each of which must convert to cells
function referenceExamples()
{
  var blocks = [];
  var re = /```[a-z]*\n([\s\S]*?)```/g;
  var m;

  while ((m = re.exec(referenceText)) != null)
  {
    var text = m[1].trim();

    // Fragments (a frontmatter alone, lines to add to a diagram) aren't diagrams
    if (/^(---|%%|flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|pie|gantt|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|sankey|xychart|block|C4|architecture|radar|packet|venn|treemap|treeView|ishikawa|kanban|zenuml|wardley|eventmodeling)/.test(text) &&
      !/^---[\s\S]*---$/.test(text))
    {
      blocks.push(text);
    }
  }

  return blocks;
}

function decode(text)
{
  return String(text == null ? "" : text)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'").replace(/&#x([0-9a-f]+);/gi, function(_m, h)
    {
      return String.fromCharCode(parseInt(h, 16));
    }).replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function styleOf(cell)
{
  var map = {};

  String(cell.style || "").split(";").forEach(function(part)
  {
    var i = part.indexOf("=");

    if (part.length > 0)
    {
      map[i < 0 ? part : part.substring(0, i)] = (i < 0) ? "1" : part.substring(i + 1);
    }
  });

  return map;
}

// What a converted diagram is made of, as far as editing it in draw.io goes
function inspect(xml)
{
  var found = null;

  transformPages(xml, function(graph)
  {
    var cells = [];

    (function walk(cell)
    {
      cells.push(cell);
      (cell.children || []).forEach(walk);
    })(graph.getModel().root);

    found = { cells: cells };
  });

  assert.ok(found != null, "no cells in the XML");

  var cells = found.cells;
  var vertices = cells.filter(function(c) { return c.vertex; });
  var edges = cells.filter(function(c) { return c.edge; });
  var images = vertices.filter(function(c)
  {
    var s = styleOf(c);

    return s.shape === "image" || s.image != null;
  });

  return {
    cells: cells,
    vertices: vertices.length,
    edges: edges.length,
    loose: edges.filter(function(e) { return e.source == null || e.target == null; }).length,
    images: images,
    locked: cells.filter(function(c)
    {
      var s = styleOf(c);

      return s.editable === "0" || s.locked === "1" || s.movable === "0" || s.deletable === "0";
    }).length,
    brokenGeometry: cells.filter(function(c)
    {
      var g = c.geometry;

      return g != null && [g.x, g.y, g.width, g.height].some(function(v)
      {
        return v != null && !Number.isFinite(v);
      });
    }).length,
    mermaidImage: /mermaidData/.test(xml) && /shape=image/.test(xml)
  };
}

function cellWithText(cells, text)
{
  return cells.find(function(c) { return decode(c.value) === text; }) ||
    cells.find(function(c) { return decode(c.value).indexOf(text) >= 0; });
}

function isInside(container, cell)
{
  for (var p = cell.parent; p != null; p = p.parent)
  {
    if (p === container)
    {
      return true;
    }
  }

  return false;
}

// Runs in the app's page: the viewer's conversion, as a chat shows the diagram
function viewerConvert(texts)
{
  var start = Date.now();

  return new Promise(function waitForViewer(resolve)
  {
    if (typeof convertMermaidToXml === "function" && typeof mxMermaidToDrawio !== "undefined" &&
      typeof Graph !== "undefined")
    {
      resolve();
    }
    else if (Date.now() - start > 60000)
    {
      resolve();
    }
    else
    {
      setTimeout(function() { waitForViewer(resolve); }, 50);
    }
  }).then(function()
  {
    if (typeof mxMermaidToDrawio === "undefined")
    {
      return null;
    }

    var results = [];
    var chain = Promise.resolve();

    texts.forEach(function(text)
    {
      chain = chain.then(function()
      {
        return convertMermaidToXml(text).then(function(xml)
        {
          results.push({ xml: xml });
        }, function(e)
        {
          results.push({ error: e.message });
        });
      });
    });

    return chain.then(function() { return results; });
  });
}

// Streamed Mermaid whose last partial is the final text: the preview's parse
// of it, then the final conversion, as a host that streams the input does
const STREAM_CASES = [
  // The last line comes with the final text: the preview drops it
  { name: "last line", text: "flowchart TD\n  A[Alpha] --> B[Beta]\n  B --> C[Gamma]" },
  // Only a newline after the last line: the preview's parse is reused
  { name: "newline", text: "flowchart TD\n  D[Delta] --> E[Epsilon]\n" },
  // A statement the parser doesn't know: nothing to draw
  { name: "empty", text: "classDiagram\n  ???\n" }
];

// Runs in the app's page, after viewerConvert has loaded the fonts
function viewerStream(cases)
{
  var results = [];
  var chain = Promise.resolve();

  cases.forEach(function(c)
  {
    chain = chain.then(function()
    {
      handleMermaidPartial(c.text);
      var reused = lastConvertedMermaidText === c.text;

      return convertMermaidToXml(c.text).then(function(xml)
      {
        results.push({ xml: xml, reused: reused });
      }, function(e)
      {
        results.push({ error: e.message, reused: reused });
      });
    });
  });

  return chain.then(function() { return results; });
}

// Until the app's page (not the blank one before it) has loaded
async function pageLoaded(evaluate)
{
  var start = Date.now();

  while (Date.now() - start < 60000)
  {
    try
    {
      if (await evaluate(function()
      {
        return location.protocol === "file:" && document.readyState === "complete";
      }))
      {
        return;
      }
    }
    catch (e)
    {
      // The page navigated while it was asked
    }

    await new Promise(function(resolve) { setTimeout(resolve, 100); });
  }

  throw new Error("The app's page did not load");
}

// The MCP Apps host isn't there: the viewer's App gets nothing from it
const APP_STUB = "var App = function() {};" +
  "App.prototype.connect = function() { return new Promise(function() {}); };" +
  "App.prototype.getHostContext = function() { return null; };" +
  "App.prototype.getHostCapabilities = function() { return {}; };" +
  "App.prototype.getHostVersion = function() { return null; };" +
  "App.prototype.sendSizeChanged = function() { return Promise.resolve(); };" +
  "App.prototype.updateModelContext = function() { return Promise.resolve(); };";

async function convertAll()
{
  if (/^(off|0|false|none)$/i.test(process.env.DRAWIO_TEST_BROWSER || ""))
  {
    return { skip: "DRAWIO_TEST_BROWSER is off" };
  }

  var browser = converter.findBrowser();

  if (browser == null)
  {
    return { skip: "no Chrome, Edge or Chromium found (set CHROME_PATH)" };
  }

  var texts = TYPES.map(function(t) { return t.mermaid; });
  var examples = referenceExamples();
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "mermaid-types-"));
  var htmlFile = path.join(dir, "viewer.html");

  try
  {
    // The plugins' converter: the desktop CLI's conversion
    var plugin;

    try
    {
      plugin = await converter.convertMermaid(texts.concat(examples), { browser: browser });
    }
    catch (e)
    {
      return { skip: "the converter could not be loaded: " + e.message };
    }

    // The app server's viewer, from the HTML the server serves
    fs.writeFileSync(htmlFile, buildHtml(APP_STUB, "", null, {}));

    var cdp = converter.launch(browser);
    var viewer;
    var stream;

    try
    {
      var evaluate;

      try
      {
        evaluate = await converter.openPage(cdp, pathToFileURL(htmlFile).href);
      }
      catch (e)
      {
        if (e.code !== "NO_SANDBOX")
        {
          throw e;
        }

        await cdp.close();
        cdp = converter.launch(browser, ["--no-sandbox"]);
        evaluate = await converter.openPage(cdp, pathToFileURL(htmlFile).href);
      }

      await pageLoaded(evaluate);

      // The class diagram first: the first conversion in a page is the one
      // that has to wait for the diagram's font
      var classText = TYPES.find(function(t) { return t.type === "class"; }).mermaid;
      viewer = await evaluate(viewerConvert, [classText].concat(texts));
      stream = viewer != null ? await evaluate(viewerStream, STREAM_CASES) : null;
    }
    finally
    {
      await cdp.close();
    }

    if (viewer == null)
    {
      return { skip: "the viewer's converter could not be loaded" };
    }

    return { plugin: plugin.slice(0, texts.length), examples: plugin.slice(texts.length),
      firstViewer: viewer[0], viewer: viewer.slice(1), exampleTexts: examples, stream: stream };
  }
  finally
  {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const results = await convertAll();
const skip = results.skip || false;
const report = [];

function checkEditable(spec, result, where)
{
  assert.ok(result != null, where + ": no result");
  assert.equal(result.error, undefined, where + ": " + result.error);

  var found = inspect(result.xml);
  var row = { type: spec.type, path: where, vertices: found.vertices, edges: found.edges,
    loose: found.loose, images: found.images.length, missing: [], outside: [] };

  report.push(row);

  assert.ok(found.vertices > 0, where + ": no shapes");
  assert.equal(found.mermaidImage, false, where + ": the diagram is an image");
  assert.equal(found.brokenGeometry, 0, where + ": shapes without a usable geometry");
  assert.equal(found.locked, 0, where + ": cells that can't be edited, moved or deleted");

  // Images are icons, never a picture of the diagram or of a part of it
  // larger than an icon (radar curves are, see TYPES)
  found.images.forEach(function(img)
  {
    var g = img.geometry || {};

    assert.ok((spec.images || 0) > 0, where + ": an image cell " + g.width + "x" + g.height);
  });
  assert.ok(found.images.length <= (spec.images || 0),
    where + ": " + found.images.length + " images, at most " + (spec.images || 0));

  // Every label is the text of a cell, so it is edited in place
  spec.labels.forEach(function(label)
  {
    if (cellWithText(found.cells, label) == null)
    {
      row.missing.push(label);
    }
  });
  assert.deepEqual(row.missing, [], where + ": labels that are not the text of a cell");

  // Connectors end on the shapes they join
  assert.ok(found.loose <= (spec.loose || 0),
    where + ": " + found.loose + " edges without both ends attached, at most " + (spec.loose || 0));

  (spec.inside || []).forEach(function(pair)
  {
    var container = cellWithText(found.cells, pair[0]);
    var child = cellWithText(found.cells, pair[1]);

    if (container == null || child == null || !isInside(container, child))
    {
      row.outside.push(pair.join(" > "));
    }
  });
  assert.deepEqual(row.outside, [], where + ": shapes not inside their container");
}

for (let i = 0; i < TYPES.length; i++)
{
  const spec = TYPES[i];

  test("Mermaid " + spec.type + " converts to editable draw.io cells", { skip: skip }, function()
  {
    checkEditable(spec, results.viewer[i], "viewer");
    checkEditable(spec, results.plugin[i], "mermaid-to-drawio.js");
  });
}

test("every example in the Mermaid reference converts to draw.io cells", { skip: skip }, function()
{
  assert.ok(results.examples.length >= 28, results.examples.length + " examples");

  results.examples.forEach(function(result, i)
  {
    var head = results.exampleTexts[i].split("\n")[0];

    assert.equal(result.error, undefined, head + ": " + result.error);
    assert.ok(inspect(result.xml).vertices > 0, head + ": no shapes");
  });
});

test("the viewer measures Mermaid labels in the diagram's font, as the plugins' converter does", { skip: skip }, function()
{
  // The first conversion in a page: drawio-mermaid adds the font's
  // stylesheet itself and measures in a fallback font unless the viewer
  // waits for the font first (Recursive is about 20 % wider)
  var i = TYPES.findIndex(function(t) { return t.type === "class"; });
  var width = function(xml)
  {
    return Number(/<mxGeometry [^>]*width="(\d+)"/.exec(xml)[1]);
  };

  assert.equal(results.firstViewer.error, undefined, results.firstViewer.error);
  assert.equal(width(results.firstViewer.xml), width(results.plugin[i].xml));
  assert.equal(width(results.viewer[i].xml), width(results.plugin[i].xml));
});

test("a Mermaid diagram without cells is an error in the viewer", { skip: skip }, function()
{
  // Checked on the template: the viewer rejects a conversion without cells
  var source = fs.readFileSync(new URL("../src/shared.js", import.meta.url), "utf-8");

  assert.match(source, /if \(!mermaidXmlHasCells\(xml\)\)\s*\{\s*return Promise\.reject\(new Error\(MERMAID_NOTHING_TO_DRAW\)\);/);
});

test("a streamed Mermaid diagram ends as the final text, not as the preview's parse", { skip: skip }, function()
{
  var byName = {};

  STREAM_CASES.forEach(function(c, i)
  {
    byName[c.name] = results.stream[i];
  });

  // The preview parsed the text without its last line
  assert.equal(byName["last line"].reused, false);
  assert.equal(byName["last line"].error, undefined, byName["last line"].error);
  assert.match(byName["last line"].xml, /Gamma/);

  assert.equal(byName.newline.reused, true);
  assert.match(byName.newline.xml, /Epsilon/);

  // A preview without cells isn't kept, so the final conversion says so
  assert.equal(byName.empty.reused, false);
  assert.match(byName.empty.error || "", /^Nothing to draw/);
});

test("write the report", { skip: !process.env.MERMAID_TYPES_REPORT || skip }, function()
{
  fs.writeFileSync(process.env.MERMAID_TYPES_REPORT, JSON.stringify(report, null, 1));
});
