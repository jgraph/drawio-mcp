import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { buildHtml, createServer, resolveConvertFormats } from "../src/shared.js";
import { bundleSemanticEngine, VIEWER_GLOBALS } from "../src/semantic-bundle.js";
import { convertSource, serverConverts, FORMATS } from "../../shared/convert/index.js";
import { csvFields } from "../../shared/convert/csv.js";

// Mermaid, PlantUML and draw.io CSV converted on the server (shared/convert):
// editable draw.io cells, laid out and styled, syntax errors with their line
// and fix, what isn't drawn as a warning, and the types left to draw.io's
// own converters in the viewer. test/plantuml-csv.test.js has the viewer's
// path for PlantUML and CSV.

const flowchart = [
  "---",
  "title: Order flow",
  "---",
  "flowchart TD",
  "    A([Start]) --> B[Receive order]",
  "    B --> C{In stock?}",
  "    C -->|Yes| D[Pick and pack]",
  "    C -->|No| E[Back-order]",
  "    E -.-> F[(Inventory DB)]",
  "    D --> G[Ship]",
  "    G --> H([Done])",
  "    subgraph Warehouse",
  "      D",
  "      G",
  "    end",
  "    classDef warn fill:#fdd,stroke:#c00",
  "    class E warn"
].join("\n");

const er = [
  "erDiagram",
  "    CUSTOMER ||--o{ ORDER : places",
  "    CUSTOMER {",
  "        int id PK",
  "        string name",
  "    }",
  "    ORDER {",
  "        int id PK",
  "        int customer_id FK",
  "    }"
].join("\n");

const sequence = [
  "sequenceDiagram",
  "    autonumber",
  "    actor U as User",
  "    participant W as Web App",
  "    participant A as Auth Server",
  "    U->>W: Open login page",
  "    W->>+A: Redirect",
  "    alt valid credentials",
  "        A-->>-W: Authorization code",
  "    else invalid",
  "        A-->>U: Error page",
  "    end",
  "    Note over W,A: TLS everywhere"
].join("\n");

const plantSequence = [
  "@startuml",
  "title Checkout",
  "autonumber",
  "actor User as U",
  "participant \"Web Shop\" as W #lightblue",
  "box Backend",
  "  database DB",
  "end box",
  "U -> W ++ : add to cart",
  "W -> DB : save",
  "alt paid",
  "  DB --> W : ok",
  "else failed",
  "  DB -[#red]> W : error",
  "end",
  "return done",
  "== Later ==",
  "note over U, W : a note",
  "@enduml"
].join("\n");

const activity = [
  "@startuml",
  "|Customer|",
  "start",
  ":Place order;",
  "|#AntiqueWhite|Shop|",
  "if (In stock?) then (yes)",
  "  :Reserve items;",
  "else (no)",
  "  #pink:Back-order;",
  "endif",
  "fork",
  "  :Charge card;",
  "fork again",
  "  :Print label;",
  "end fork",
  "repeat",
  "  :Pack;",
  "repeat while (Complete?) is (no)",
  "-> shipped;",
  "stop",
  "@enduml"
].join("\n");

const csv = [
  "# label: %name%<br><i>%position%</i>",
  "# style: rounded=1;whiteSpace=wrap;html=1;fillColor=%fill%;",
  "# namespace: csv-",
  "# connect: {\"from\": \"manager\", \"to\": \"name\", \"invert\": true, \"label\": \"manages\"}",
  "# ignore: fill,manager",
  "# link: url",
  "# layout: auto",
  "name,position,manager,fill,url",
  "Ada,CEO,,#dae8fc,https://example.com/ada",
  "Bob,CTO,Ada,#d5e8d4,",
  "Cy,CFO,Ada,,"
].join("\n");

function cell(xml, id)
{
  const m = xml.match(new RegExp("<mxCell id=\"" + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\"[^>]*>"));

  assert.ok(m, "no cell " + id);

  return m[0];
}

function cells(xml)
{
  return (xml.match(/<mxCell\b/g) || []).length;
}

// ── Mermaid ──

test("a Mermaid flowchart becomes styled, laid-out draw.io cells", async function()
{
  const r = await convertSource("mermaid", flowchart);

  assert.equal(r.type, "flowchart");
  assert.deepEqual(r.warnings, []);
  assert.deepEqual({ nodes: r.stats.nodes, edges: r.stats.edges, groups: r.stats.groups }, { nodes: 8, edges: 7, groups: 1 });
  assert.equal(r.direction, "vertical");
  assert.equal(r.elk, false);
  assert.match(cell(r.xml, "C"), /value="In stock\?" style="rhombus;/);
  // classDef colors on the calm theme's step
  assert.match(cell(r.xml, "E"), /fillColor=#FFDDDD;strokeColor=#CC0000;/);
  // subgraph members inside their frame
  assert.match(cell(r.xml, "D"), /parent="Warehouse"/);
  assert.match(cell(r.xml, "G"), /parent="Warehouse"/);
  assert.match(cell(r.xml, "E-F"), /dashed=1;/);
  assert.match(cell(r.xml, "C-D"), /value="Yes"/);
  assert.match(cell(r.xml, "title"), /value="Order flow"/);
  // every vertex is placed
  assert.doesNotMatch(r.xml, /<mxGeometry width=/);
});

test("a Mermaid ER diagram becomes tables with keyed rows and labeled relationships", async function()
{
  const r = await convertSource("mermaid", er);

  assert.equal(r.type, "er");
  assert.match(cell(r.xml, "CUSTOMER.id"), /value="&lt;b&gt;PK id: int/);
  assert.match(r.xml, /<mxCell value="places" id="ORDER-CUSTOMER"[^>]*source="CUSTOMER\.id" target="ORDER\.customer_id"/);
  assert.match(r.xml, /startArrow=ERmandOne;endArrow=ERzeroToMany;/);
});

test("a Mermaid sequence diagram becomes lifelines, messages, activations and frames", async function()
{
  const r = await convertSource("mermaid", sequence);

  assert.equal(r.type, "sequence");
  assert.match(cell(r.xml, "U"), /shape=umlLifeline;.*participant=seqActorStick;/);
  assert.match(cell(r.xml, "msg1"), /value="1\. Open login page".*edgeStyle=sequenceEdgeStyle;/);
  assert.match(cell(r.xml, "A_activation"), /perimeter=orthogonalPerimeter;.*parent="A"/);
  assert.match(cell(r.xml, "alt"), /shape=umlFrame;/);
  assert.match(r.xml, /value="\[invalid\]"/);
  assert.match(r.xml, /value="TLS everywhere" style="shape=note;/);
});

test("a Mermaid syntax error names its line and how to fix it", async function()
{
  const unclosed = await convertSource("mermaid", "flowchart TD\n A --> B\n subgraph X\n C\n");
  const garbage = await convertSource("mermaid", "flowchart TD\n A --> B\n this is wrong ][\n");
  const header = await convertSource("mermaid", "sequencediagramm\n A->>B: hi");

  assert.equal(unclosed.error, "Mermaid syntax error on line 3 (`subgraph X`): the subgraph \"X\" has no `end`. " +
    "Fix: close every subgraph with a line `end`.");
  assert.match(garbage.error, /^Mermaid syntax error on line 3 \(`this is wrong \]\[`\): .* Fix: /);
  assert.match(header.error, /is not a Mermaid diagram type, .*here probably `sequenceDiagram`/);
});

test("Mermaid still streaming in is drawn as far as it goes", async function()
{
  const partial = await convertSource("mermaid", "flowchart TD\n A --> B\n subgraph X\n C\n", { partial: true });
  const block = await convertSource("mermaid", "sequenceDiagram\n A->>B: hi\n loop every day\n B->>A: ok\n", { partial: true });

  assert.equal(partial.error, undefined);
  assert.equal(partial.stats.groups, 1);
  assert.match(block.xml, /value="loop"/);
});

test("Mermaid types the server doesn't read are left to the viewer", async function()
{
  assert.deepEqual(await convertSource("mermaid", "gantt\n title x\n"), { fallback: true, type: "gantt" });
  assert.equal(serverConverts("mermaid", "gantt\n title x\n"), false);
  assert.equal(serverConverts("mermaid", flowchart), true);
  assert.equal(serverConverts("mermaid", er), true);
  assert.equal(serverConverts("mermaid", sequence), true);
});

test("a flowchart-elk header asks for ELK", async function()
{
  const r = await convertSource("mermaid", "flowchart-elk LR\n A --> B");

  assert.equal(r.elk, true);
  assert.equal(r.direction, "horizontal");
});

// ── PlantUML ──

test("a PlantUML sequence diagram keeps its participants, boxes, numbers, groups and notes", async function()
{
  const r = await convertSource("plantuml", plantSequence);

  assert.equal(r.type, "sequence");
  assert.deepEqual(r.warnings, []);
  assert.match(cell(r.xml, "title"), /value="Checkout"/);
  assert.match(cell(r.xml, "box"), /value="Backend"/);
  assert.match(cell(r.xml, "U"), /participant=seqActorStick;/);
  assert.match(cell(r.xml, "W"), /value="Web Shop"/);
  assert.match(cell(r.xml, "W"), /fillColor=#ADD8E6;/i);
  assert.match(cell(r.xml, "DB"), /participant=seqDatabase|shape=cylinder|database/i);
  assert.match(r.xml, /value="1\. add to cart"/);
  assert.match(r.xml, /value="\[failed\]"/);
  assert.match(r.xml, /value="[0-9]+\. error"[^>]*strokeColor=#FF0000;/i);
  assert.match(r.xml, /value="[0-9]+\. done"[^>]*dashed=1;/);
  assert.match(r.xml, /value="Later"/);
  assert.match(r.xml, /value="a note" style="shape=note;/);
  assert.match(cell(r.xml, "W_activation"), /parent="W"/);
});

test("a PlantUML activity diagram becomes a flowchart with lanes, decisions and fork bars", async function()
{
  const r = await convertSource("plantuml", activity);

  assert.equal(r.type, "activity");
  assert.deepEqual(r.warnings, []);
  assert.match(r.xml, /value="Customer" style="swimlane;/);
  assert.match(r.xml, /value="Shop" style="swimlane;[^"]*swimlaneFillColor=#FAEBD7;/i);
  assert.match(r.xml, /value="In stock\?" style="rhombus;/);
  assert.match(r.xml, /value="Back-order" style="[^"]*fillColor=#FFC0CB;/i);
  assert.match(r.xml, /value="yes"/);
  assert.match(r.xml, /value="shipped"/);
  assert.match(r.xml, /value="Complete\?" style="rhombus;/);
  // start dot and fork bars have no label
  assert.match(r.xml, /<mxCell id="s1" style="ellipse;/);
  assert.match(r.xml, /<mxCell id="b\d+" style="[^"]*" vertex="1" parent="[^"]*"><mxGeometry [^>]*width="120" height="8"/);
});

test("a PlantUML syntax error names its line and how to fix it", async function()
{
  const cases =
  [
    ["@startuml\nalt ok\nA -> B: hi\n@enduml", /^PlantUML syntax error on line 2 \(`alt ok`\): .*Fix: /],
    ["@startuml\nA -> B: hi\nelse other\n@enduml", /^PlantUML syntax error on line 3 \(`else other`\)/],
    ["@startuml\nA -> B: hi\nnote left of A\nhello\n@enduml", /^PlantUML syntax error on line 3 .*end note/],
    ["@startuml\nstart\nif (ok?) then (yes)\n:Go;\nstop\n@enduml", /^PlantUML syntax error on line 3 .*endif/],
    ["@startuml\nstart\n:Go;\nendif\n@enduml", /^PlantUML syntax error on line 4 \(`endif`\)/],
    ["@startuml\nstart\n:Go\nstop\n@enduml", /^PlantUML syntax error on line 3 .*;/]
  ];

  for (const [text, expected] of cases)
  {
    const r = await convertSource("plantuml", text);

    assert.match(r.error || "", expected, text);
  }
});

test("PlantUML lines the converter doesn't draw are named in a warning", async function()
{
  const r = await convertSource("plantuml", "@startuml\nskinparam monochrome true\n!theme plain\nA -> B: hi\n@enduml");

  assert.equal(r.xml != null, true);
  assert.match(r.warnings.join("\n"), /skinparam/);
});

test("PlantUML families the server doesn't read are left to the viewer", async function()
{
  const classes = "@startuml\nclass Car\nclass Wheel\nCar *-- Wheel\n@enduml";

  assert.deepEqual(await convertSource("plantuml", classes), { fallback: true, type: "class" });
  assert.equal((await convertSource("plantuml", "@startmindmap\n* root\n** a\n@endmindmap")).fallback, true);
  assert.equal(serverConverts("plantuml", classes), false);
  assert.equal(serverConverts("plantuml", plantSequence), true);
  assert.equal(serverConverts("plantuml", activity), true);
});

// ── CSV ──

test("CSV rows become shapes that keep their columns as data", async function()
{
  const r = await convertSource("csv", csv);

  assert.equal(r.type, "csv");
  assert.deepEqual(r.warnings, []);
  assert.deepEqual({ nodes: r.stats.nodes, edges: r.stats.edges }, { nodes: 3, edges: 2 });
  // the label template with placeholders, the columns but the ignored ones
  // and the link column, the link
  assert.match(r.xml, /<UserObject id="csv-row1" label="%name%&lt;br&gt;&lt;i&gt;%position%&lt;\/i&gt;" name="Ada" position="CEO" link="https:\/\/example\.com\/ada" placeholders="1"><mxCell style="[^"]*fillColor=#dae8fc;[^"]*" vertex="1" parent="1">/);
  assert.match(r.xml, /<UserObject id="csv-row3" [^>]*name="Cy"[^>]*><mxCell style="[^"]*"/);
  // an empty %fill% leaves the calm fill
  assert.doesNotMatch(r.xml, /fillColor=;/);
  assert.match(r.xml, /value="manages"[^>]*source="csv-row1" target="csv-row2"/);
  assert.equal((r.xml.match(/<UserObject /g) || []).length, 3);
  assert.equal((r.xml.match(/<\/UserObject>/g) || []).length, 3);
});

test("CSV parents become frames, and identity names the rows", async function()
{
  const text = "# identity: id\n# parent: team\n# connect: {\"from\": \"next\", \"to\": \"id\"}\n# layout: verticalflow\n" +
    "id,name,team,next\nt1,Backend,,\nt2,Web,,\n1,API,t1,\"2,3\"\n2,Orders,t1,\n3,Users,t1,\n4,App,t2,1\n";
  const r = await convertSource("csv", text);

  assert.equal(r.stats.groups, 2);
  // the reserved ids get a prefix
  assert.match(r.xml, /<UserObject id="n1" [^>]*name="API"[^>]*><mxCell style="[^"]*" vertex="1" parent="t1">/);
  assert.match(r.xml, /<UserObject id="t1" [^>]*name="Backend"/);
  assert.match(r.xml, /source="n1" target="2"/);
  assert.match(r.xml, /source="n1" target="3"/);
  assert.match(r.xml, /source="4" target="n1"/);
});

test("CSV with layout none puts each row at its left and top", async function()
{
  const text = "# label: %step%\n# left: x\n# top: y\n# layout: none\n# connect: {\"from\": \"to\", \"to\": \"step\"}\n" +
    "step,x,y,to\nStart,40,40,Check\nCheck,40,160,\n";
  const r = await convertSource("csv", text);

  assert.match(r.xml, /<UserObject id="row1"[^>]*><mxCell style="[^"]*" vertex="1" parent="1"><mxGeometry x="40" y="40" /);
  assert.match(r.xml, /<UserObject id="row2"[^>]*><mxCell style="[^"]*" vertex="1" parent="1"><mxGeometry x="40" y="160" /);
  assert.match(r.xml, /edge="1" parent="1" source="row1" target="row2"/);
});

test("a CSV error names its line and how to fix it", async function()
{
  const cases =
  [
    ["name,role\n\"Ann, Smith\",Lead\n\"Bob,Dev\n", /^CSV syntax error on line 3 \(`"Bob,Dev`\): a quote in this row is not closed\. Fix: /],
    ["# connect: {from: \"a\", \"to\": \"b\"}\nname,a\nx,y\n", /^CSV syntax error on line 1 .*is not valid JSON .*Fix: write it as/],
    ["# connect: {\"from\": \"boss\", \"to\": \"name\"}\nname,manager\nx,y\n", /names the column "boss", which the header doesn't have\. Fix: use one of name and manager\./],
    ["# identity: key\nname,manager\nx,y\n", /^CSV syntax error on line 1 \(`# identity: key`\): .*Fix: use one of name and manager/],
    ["# label: %name%\n", /no header line/],
    ["# label: %name%\nname\n", /a header but no rows/]
  ];

  for (const [text, expected] of cases)
  {
    assert.match((await convertSource("csv", text)).error || "", expected, text);
  }
});

test("CSV settings and placeholders that do nothing are named in a warning", async function()
{
  const r = await convertSource("csv", "# label: %name% (%title%)\n# colour: red\nname,manager\nAnn,\nBob,Carl\n# style: x\n");
  const text = r.warnings.join("\n");

  assert.match(text, /`# colour:` is not a setting of draw\.io's CSV import/);
  assert.match(text, /a `#` line after the header/);
  assert.match(text, /The placeholder %title% names no column/);
});

test("CSV the server doesn't import is left to the viewer", async function()
{
  for (const [setting, reason] of [["# layout: circle", "the layout circle"], ["# list: methods", "lists"], ["# container: 1", "containers"]])
  {
    const text = setting + "\nname,methods\nA,x\n";

    assert.deepEqual(await convertSource("csv", text), { fallback: true, type: "csv", reason: reason });
    assert.equal(serverConverts("csv", text), false);
  }

  // `-` is no value
  assert.equal(serverConverts("csv", "# list: -\n# container: -\nname\nA\n"), true);
  assert.equal(serverConverts("csv", csv), true);
});

test("CSV fields are read with quotes", function()
{
  assert.deepEqual(csvFields("a,\"b, c\",\"say \"\"hi\"\"\",,d"), ["a", "b, c", "say \"hi\"", "", "d"]);
  assert.equal(csvFields("a,\"b"), null);
});

// ── Both servers and the viewer ──

test("the same source gives the same XML", async function()
{
  for (const [format, text] of [["mermaid", flowchart], ["plantuml", activity], ["csv", csv]])
  {
    assert.equal((await convertSource(format, text)).xml, (await convertSource(format, text)).xml);
  }
});

test("DRAWIO_CONVERT picks the formats converted on the server", function()
{
  assert.deepEqual(FORMATS, ["mermaid", "plantuml", "csv"]);
  assert.deepEqual(resolveConvertFormats(undefined), FORMATS);
  assert.deepEqual(resolveConvertFormats("on"), FORMATS);
  assert.deepEqual(resolveConvertFormats("off"), []);
  assert.deepEqual(resolveConvertFormats("false"), []);
  assert.deepEqual(resolveConvertFormats("mermaid, csv, dot"), ["mermaid", "csv"]);
});

test("the viewer's bundle converts as the modules do", async function()
{
  const js = bundleSemanticEngine();
  const context = {};

  context.window = context;
  vm.createContext(context);
  vm.runInContext(js + "\nthis.engine = DrawioSemantic;", context);

  assert.equal(typeof context.engine.serverConverts, "function");

  for (const [format, text] of [["mermaid", sequence], ["plantuml", plantSequence], ["csv", csv]])
  {
    const bundled = await context.engine.convertSource(format, text);

    assert.equal(bundled.xml, (await convertSource(format, text)).xml, format);
  }
});

// The viewer's code is a template literal in src/shared.js: a "\n" written
// there with one backslash is a line break inside a string of the page, and
// the whole script fails to parse.
test("every script of the viewer's page parses", function()
{
  const html = buildHtml("var App = function() {};", "", null,
    { semanticJs: bundleSemanticEngine({ externals: VIEWER_GLOBALS }) });
  const scripts = html.match(/<script>[\s\S]*?<\/script>/g);

  assert.ok(scripts.length >= 3);
  assert.ok(html.includes("var CONVERT_FORMATS = [\"mermaid\",\"plantuml\",\"csv\"];"));

  scripts.forEach(function(script, i)
  {
    assert.doesNotThrow(function() { new vm.Script(script.slice(8, -9), { filename: "script" + i }); }, "script " + i);
  });
});

// ── create_diagram ──

const UI = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [RESOURCE_MIME_TYPE] } } };
let client;
let off;

async function connect(options)
{
  const server = createServer("", Object.assign({ iconServiceUrl: null, buildId: "test" }, options));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  const c = new Client({ name: "convert-test", version: "0.0.0" }, { capabilities: UI });

  await c.connect(clientTransport);

  return c;
}

before(async function()
{
  client = await connect({});
  off = await connect({ convertFormats: [] });
});

after(async function()
{
  await client.close();
  await off.close();
});

async function call(c, args)
{
  const result = await c.callTool({ name: "create_diagram", arguments: args });

  return { result: result, payload: result.isError ? null : JSON.parse(result.content[0].text),
    text: result.content.map(function(b) { return b.text; }).join("\n") };
}

test("create_diagram returns converted Mermaid as XML with a note on what it got", async function()
{
  const { result, payload, text } = await call(client, { mermaid: flowchart });

  assert.equal(result.isError, undefined);
  assert.equal(payload.converted, "mermaid");
  assert.match(payload.xml, /^<mxGraphModel/);
  assert.equal(payload.postLayout, undefined);
  assert.match(text, /Converted from Mermaid \(flowchart\) on the server into editable draw\.io cells \(8 shapes, 7 connectors, 1 groups\), laid out and styled/);
  assert.match(text, /send the changed Mermaid again/);
});

test("a converted Mermaid flowchart keeps its ELK layout in the viewer", async function()
{
  const asked = await call(client, { mermaid: "flowchart LR\n A --> B --> C", postLayout: "elk" });
  const header = await call(client, { mermaid: "flowchart-elk TD\n A --> B" });
  const erElk = await call(client, { mermaid: er, postLayout: "elk" });

  assert.equal(asked.payload.postLayout, "elk");
  assert.equal(asked.payload.direction, "horizontal");
  assert.match(asked.text, /The viewer lays it out again with ELK/);
  assert.equal(header.payload.postLayout, "elk");
  assert.equal(header.payload.direction, "vertical");
  // ER has a layout of its own
  assert.equal(erElk.payload.postLayout, undefined);
  assert.match(erElk.text, /postLayout was not applied/);
});

test("create_diagram names what the diagram doesn't show", async function()
{
  const { text } = await call(client, { mermaid: "flowchart TD\n A --> B\n click A href \"https://example.com\"" });

  assert.match(text, /WARNINGS \(what the diagram doesn't show as written\):\n- /);
});

test("a syntax error is a tool error the model can fix", async function()
{
  const { result, text } = await call(client, { mermaid: "flowchart TD\n A --> B\n subgraph X\n C\n" });

  assert.equal(result.isError, true);
  assert.match(text, /^Mermaid syntax error on line 3/);
});

test("with the conversion off, Mermaid goes to the viewer as before", async function()
{
  const { payload } = await call(off, { mermaid: flowchart, postLayout: "elk" });

  assert.deepEqual(payload, { mermaid: flowchart, postLayout: "elk", _buildId: "test" });
});

test("the tool's parameters say what is converted on the server", async function()
{
  const { tools } = await client.listTools();
  const { tools: offTools } = await off.listTools();
  const props = tools.find(function(t) { return t.name === "create_diagram"; }).inputSchema.properties;
  const offProps = offTools.find(function(t) { return t.name === "create_diagram"; }).inputSchema.properties;
  const description = tools.find(function(t) { return t.name === "create_diagram"; }).description;

  assert.match(description, /^Send Mermaid, PlantUML or CSV and get back an editable, styled draw\.io diagram/);
  assert.match(props.mermaid.description, /Flowcharts, ER and sequence diagrams are converted on the server/);
  assert.match(props.plantuml.description, /Sequence and activity diagrams \(the new syntax\) are converted on the server/);
  assert.match(props.csv.description, /Converted on the server into editable draw\.io cells/);
  assert.doesNotMatch(offProps.mermaid.description, /on the server/);
  assert.match(offProps.csv.description, /\(not orgchart\)/);
});
