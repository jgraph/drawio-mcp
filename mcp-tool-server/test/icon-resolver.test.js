import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import pako from "pako";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createIconResolver } from "../../shared/icon-resolver.js";
import { ICON_TABLE, ICON_DATA } from "../../shared/icon-table.js";

// `icon=aws lambda` in a vertex style stands for the official icon of that
// service (shared/icon-resolver.js, table generated from the shape index by
// shape-search/generate-icon-table.js). Both servers resolve it before their
// other passes; the app server's viewer while the XML streams in.

const resolver = createIconResolver(ICON_TABLE, ICON_DATA);

function title(name, options)
{
  const icon = resolver.resolve(name, options);

  return icon != null ? icon.provider + ": " + icon.title : null;
}

test("the names models write find the current icon of the service", function()
{
  const cases =
  {
    "aws lambda": "aws: Lambda",
    "AWS Lambda": "aws: Lambda",
    "amazon s3": "aws: Simple Storage Service",
    "aws api gateway": "aws: API Gateway",
    "aws cloudfront": "aws: CloudFront",
    "aws cloud front": "aws: CloudFront",
    "aws dynamodb": "aws: DynamoDB",
    "aws alb": "aws: Application Load Balancer",
    "aws sqs": "aws: Simple Queue Service",
    "aws sns": "aws: Simple Notification Service",
    "aws ecs fargate": "aws: Fargate",
    "aws users": "aws: Users",
    "aws cognito": "aws: Cognito",
    "azure functions": "azure: Function Apps",
    "azure cosmos db": "azure: Cosmos DB",
    "azure aks": "azure: Kubernetes Services",
    "gcp bigquery": "gcp: BigQuery",
    "gcp cloud run": "gcp: Cloud Run",
    "kubernetes pod": "k8s: Pod",
    "k8s deployment": "k8s: Deploy",
  };

  for (const name of Object.keys(cases))
  {
    assert.equal(title(name), cases[name], name);
  }
});

test("the current sets win over the old ones", function()
{
  const lambda = resolver.resolve("aws lambda");
  const functions = resolver.resolve("azure functions");

  assert.match(lambda.style, /shape=mxgraph\.aws4\.resourceIcon;resIcon=mxgraph\.aws4\.lambda;/);
  assert.match(functions.style, /image=img\/lib\/azure2\//);

  for (const name of ["aws ec2", "aws rds", "aws s3", "aws vpc", "azure sql database", "gcp compute engine"])
  {
    assert.doesNotMatch(resolver.resolve(name).style, /mxgraph\.aws3\.|img\/lib\/mscae\//, name);
  }
});

test("a container gets the group shape, an icon never does", function()
{
  assert.equal(title("aws vpc", { container: true }), "aws: VPC");
  assert.match(resolver.resolve("aws vpc", { container: true }).style, /grIcon=mxgraph\.aws4\.group_vpc2;/);
  assert.match(resolver.resolve("aws private subnet", { container: true }).style, /group_security_group|private_subnet/);
  assert.equal(resolver.resolve("aws vpc").kind === "g", false);
  assert.equal(resolver.resolve("azure virtual network", { container: true }), null);
});

test("a large cell without children prefers a group but still takes an icon", function()
{
  assert.equal(title("aws vpc", { large: true }), "aws: VPC");
  assert.equal(resolver.resolve("aws vpc", { large: true }).kind, "g");
  assert.equal(resolver.resolve("aws private subnet", { large: true }).kind, "g");

  for (const name of ["aws lambda", "aws ec2", "azure functions", "gcp bigquery", "kubernetes pod"])
  {
    assert.notEqual(resolver.resolve(name, { large: true }), null, name);
    assert.notEqual(resolver.resolve(name, { large: true }).kind, "g", name);
  }

  // Through the XML: size alone makes no container.
  const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="fn" value="Big" style="icon=aws lambda;" vertex="1" parent="1">' +
    '<mxGeometry x="40" y="40" width="120" height="120" as="geometry"/></mxCell>' +
    '<mxCell id="vpc" value="VPC" style="icon=aws vpc;" vertex="1" parent="1">' +
    '<mxGeometry x="200" y="40" width="400" height="240" as="geometry"/></mxCell></root></mxGraphModel>';
  const result = resolver.applyToXml(xml);

  assert.deepEqual(result.resolved.map(function(r) { return r.id + " " + r.title; }), ["fn Lambda", "vpc VPC"]);
  assert.match(result.xml, /<mxCell id="fn" value="Big" style="[^"]*resIcon=mxgraph\.aws4\.lambda;/);
  assert.match(result.xml, /<mxCell id="vpc" value="VPC" style="[^"]*grIcon=mxgraph\.aws4\.group_vpc2;/);
  assert.equal(result.unresolved.length, 0);
});

test("a parent on another page doesn't make a cell a container", function()
{
  const xml = '<mxfile><diagram id="p1" name="One"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="3" value="Orders" style="icon=aws lambda;" vertex="1" parent="1">' +
    '<mxGeometry x="40" y="40" width="48" height="48" as="geometry"/></mxCell></root></mxGraphModel></diagram>' +
    '<diagram id="p2" name="Two"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="3" value="Box" style="rounded=0;" vertex="1" parent="1">' +
    '<mxGeometry x="40" y="40" width="300" height="200" as="geometry"/></mxCell>' +
    '<mxCell id="4" value="Inner" style="icon=aws vpc;" vertex="1" parent="3">' +
    '<mxGeometry x="20" y="20" width="200" height="120" as="geometry"/></mxCell>' +
    '<mxCell id="5" value="Fn" style="icon=aws lambda;" vertex="1" parent="4">' +
    '<mxGeometry x="20" y="20" width="48" height="48" as="geometry"/></mxCell>' +
    '</root></mxGraphModel></diagram></mxfile>';
  const result = resolver.applyToXml(xml);

  assert.deepEqual(result.resolved.map(function(r) { return r.id + " " + r.title; }),
    ["3 Lambda", "4 VPC", "5 Lambda"]);
  assert.match(result.xml, /<mxCell id="3" value="Orders" style="[^"]*resIcon=mxgraph\.aws4\.lambda;/);
  assert.match(result.xml, /<mxCell id="4" value="Inner" style="[^"]*grIcon=mxgraph\.aws4\.group_vpc2;/);
});

test("the cache stays bounded and long names are neither ranked nor kept", function()
{
  const fresh = createIconResolver(ICON_TABLE, ICON_DATA);
  const long = "aws lambda " + "x".repeat(200000);
  const start = Date.now();

  assert.equal(fresh.resolve(long), null);
  assert.ok(Date.now() - start < 100, (Date.now() - start) + " ms");
  assert.equal(fresh.cacheSize(), 0);

  for (let i = 0; i < 1200; i++)
  {
    fresh.resolve("aws lambda " + i);
  }

  assert.ok(fresh.cacheSize() <= 500, String(fresh.cacheSize()));
  // Recently used names stay, evicted ones resolve again.
  assert.equal(fresh.resolve("aws lambda").title, "Lambda");
  assert.deepEqual(fresh.resolve("aws lambda 0"), resolver.resolve("aws lambda 0"));

  // A long unresolved name goes back to the model shortened.
  const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="x" style="icon=' + "y".repeat(5000) + ';" vertex="1" parent="1">' +
    '<mxGeometry x="0" y="0" width="48" height="48" as="geometry"/></mxCell></root></mxGraphModel>';
  const result = fresh.applyToXml(xml);

  assert.equal(result.unresolved.length, 1);
  assert.ok(result.unresolved[0].name.length <= 101, String(result.unresolved[0].name.length));
});

test("names that match no icon resolve to nothing", function()
{
  for (const name of ["aws payment service", "aws quantum flux", "aws", "", "gcp frobnicator"])
  {
    assert.equal(resolver.resolve(name), null, name);
  }
});

test("applyToXml keeps the label keys, drops the ones the icon defines, and is idempotent", function()
{
  const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="fn" value="a -&gt; b" style="icon=aws lambda;fillColor=#dae8fc;fontSize=13;whiteSpace=wrap;" vertex="1" parent="1">' +
    '<mxGeometry x="40" y="40" width="48" height="48" as="geometry"/></mxCell>' +
    '<object id="o" label="Functions"><mxCell style="icon=azure functions" vertex="1" parent="1">' +
    '<mxGeometry x="140" y="40" width="48" height="48" as="geometry"/></mxCell></object>' +
    '<mxCell id="e" style="icon=aws lambda;" edge="1" parent="1" source="fn" target="o">' +
    '<mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>';
  const once = resolver.applyToXml(xml);
  const fn = once.xml.match(/<mxCell id="fn"[^>]*?style="([^"]*)"/)[1];

  assert.deepEqual(once.resolved.map(function(r) { return r.id + " " + r.title; }), ["fn Lambda", "o Function Apps"]);
  assert.match(fn, /fillColor=#ED7100;/);
  assert.doesNotMatch(fn, /#dae8fc|whiteSpace|icon=/);
  assert.match(fn, /fontSize=13;/);
  // Edges are left alone.
  assert.match(once.xml, /<mxCell id="e" style="icon=aws lambda;" edge="1"/);
  assert.equal(resolver.applyToXml(once.xml).xml, once.xml);
});

// The contrast of a label color on a page as WCAG computes it.
function luminance(color)
{
  const hex = color.slice(1).length === 3 ? color.slice(1).replace(/./g, "$&$&") : color.slice(1);

  return [0, 2, 4].reduce(function(sum, i, k)
  {
    const c = parseInt(hex.substring(i, i + 2), 16) / 255;

    return sum + [0.2126, 0.7152, 0.0722][k] * ((c <= 0.04045) ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  }, 0);
}

function contrast(color, page)
{
  const a = luminance(color);
  const b = luminance(page);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function labelColor(style)
{
  const match = /(?:^|;)fontColor=([^;]*)/.exec(style);

  return match != null ? match[1] : null;
}

test("an icon's label is readable: a pale gray from its library becomes the calm theme's text color", function()
{
  // The Google Cloud products are images whose library label is #999999,
  // AWS's VPC group writes #AAB7B8 and its generic subnet #879196.
  assert.equal(labelColor(resolver.resolve("gcp pub/sub").style), "#1B1F24");
  assert.equal(labelColor(resolver.resolve("aws vpc", { container: true }).style), "#1B1F24");
  assert.equal(labelColor(resolver.resolve("aws subnet", { container: true }).style), "#1B1F24");

  // What is readable stays as the library has it: AWS's dark labels, the
  // colored labels of AWS groups that match their borders, Google Cloud's
  // current icons; Azure and Kubernetes icons name no label color.
  assert.equal(labelColor(resolver.resolve("aws lambda").style), "#232F3E");
  assert.equal(labelColor(resolver.resolve("aws auto scaling group", { container: true }).style), "#D86613");
  assert.equal(labelColor(resolver.resolve("aws security group", { container: true }).style), "#DD3522");
  assert.equal(labelColor(resolver.resolve("gcp bigquery").style), "#000000");
  assert.equal(labelColor(resolver.resolve("azure functions").style), null);
  assert.equal(labelColor(resolver.resolve("kubernetes pod").style), null);

  // Every icon of the table is readable on a white page.
  assert.deepEqual(hardToRead("#FFFFFF"), []);
});

// The icons of the table whose label is hard to read on a page of that
// color, as rank and resolve give them: a gray under 4.5:1 or any color
// under 3:1. Nothing but the label color may differ from the library.
function hardToRead(page)
{
  const library = new Set(ICON_TABLE.icons.map(function(icon)
  {
    return withoutLabelColor(styleFrom(ICON_TABLE.templates[icon[3]], icon));
  }));
  const pale = [];
  const seen = new Set();

  ICON_TABLE.icons.forEach(function(icon)
  {
    const options = { container: icon[1] === "g", background: page };

    resolver.rank(icon[0] + " " + icon[2].split("|")[0], options, 50).forEach(function(r)
    {
      const color = labelColor(r.style);

      seen.add(r.style);
      assert.ok(library.has(withoutLabelColor(r.style)), r.title + ": " + r.style);

      if (color != null && /^#[0-9a-f]{6}$/i.test(color))
      {
        const rgb = [1, 3, 5].map(function(i) { return parseInt(color.substring(i, i + 2), 16); });
        const gray = Math.max.apply(null, rgb) - Math.min.apply(null, rgb) <= 48;

        if (contrast(color, page) < 3 || (gray && contrast(color, page) < 4.5))
        {
          pale.push(r.provider + " " + r.title + " " + color);
        }
      }
    });
  });

  assert.ok(seen.size >= ICON_TABLE.icons.length * 0.9, seen.size + " styles of " + ICON_TABLE.icons.length + " icons");

  return pale;
}

test("on a dark page an icon's label is readable too: a library's gray stays, a dark one becomes light", function()
{
  // The dark theme's page (shared/xml-reference.md, Color themes): the
  // grays read well on it, AWS's dark labels and black don't.
  const dark = { background: "#0F172A" };

  assert.equal(labelColor(resolver.resolve("gcp pub/sub", dark).style), "#999999");
  assert.equal(labelColor(resolver.resolve("aws vpc", { container: true, background: "#0F172A" }).style), "#AAB7B8");
  assert.equal(labelColor(resolver.resolve("aws subnet", { container: true, background: "#0F172A" }).style), "#879196");
  assert.equal(labelColor(resolver.resolve("aws auto scaling group", { container: true, background: "#0F172A" }).style), "#D86613");
  assert.equal(labelColor(resolver.resolve("aws lambda", dark).style), "#F1F5F9");
  assert.equal(labelColor(resolver.resolve("gcp bigquery", dark).style), "#F1F5F9");
  // The blueprint theme's page is lighter: #999999 is 4.0:1 on it.
  assert.equal(labelColor(resolver.resolve("gcp pub/sub", { background: "#1E3A5F" }).style), "#F1F5F9");
  // A background that names no color is a white page.
  assert.equal(labelColor(resolver.resolve("gcp pub/sub", { background: "none" }).style), "#1B1F24");

  assert.deepEqual(hardToRead("#0F172A"), []);
  assert.deepEqual(hardToRead("#1E3A5F"), []);
});

test("applyToXml reads each page's background, and the viewer's placeholder has the icon's label color", function()
{
  function page(attrs, id, name)
  {
    return '<diagram id="' + id + '"><mxGraphModel' + attrs + '><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="2" value="Events" style="icon=' + name + ';" vertex="1" parent="1">' +
      '<mxGeometry x="40" y="40" width="48" height="48" as="geometry"/></mxCell>' +
      '<mxCell id="3" value="Own" style="icon=' + name + ';fontColor=#5A626E;" vertex="1" parent="1">' +
      '<mxGeometry x="140" y="40" width="48" height="48" as="geometry"/></mxCell></root></mxGraphModel></diagram>';
  }

  // Pages reuse ids, so the colors are read in the order the cells come.
  function colors(xml)
  {
    return xml.match(/fontColor=[^;]*/g);
  }

  const file = '<mxfile>' + page(' background="#0F172A" adaptiveColors="none"', "a", "gcp pub/sub") +
    page(' adaptiveColors="auto"', "b", "gcp pub/sub") + page(" background='#0F172A'", "c", "aws lambda") +
    page(' background="#FFFFFF"', "d", "aws lambda") + '</mxfile>';

  assert.deepEqual(colors(resolver.applyToXml(file).xml), ["fontColor=#999999", "fontColor=#5A626E",
    "fontColor=#1B1F24", "fontColor=#5A626E", "fontColor=#F1F5F9", "fontColor=#5A626E",
    "fontColor=#232F3E", "fontColor=#5A626E"]);

  // Without the image data (the viewer), a Google Cloud product is a
  // placeholder while the XML streams in, labeled as the icon will be.
  const viewer = createIconResolver(ICON_TABLE);

  assert.deepEqual(colors(viewer.applyToXml(file).xml), colors(resolver.applyToXml(file).xml));
  assert.match(viewer.applyToXml(file).xml, /style="rounded=1;arcSize=16;fillColor=#F1F3F4;[^"]*;fontColor=#999999;"/);
});

// The style of an icon as the library writes it.
function styleFrom(template, icon)
{
  const n = (typeof icon[4] === "number") ? ICON_DATA[icon[4]] : icon[4];

  return template.replace("{n}", n).replace("{c}", icon[5]);
}

function withoutLabelColor(style)
{
  return style.replace(/(^|;)fontColor=[^;]*/, "$1");
}

test("a label color the cell writes itself wins over the readable one", function()
{
  const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="ps" value="Events" style="icon=gcp pub/sub;fontColor=#5A626E;" vertex="1" parent="1">' +
    '<mxGeometry x="40" y="40" width="48" height="48" as="geometry"/></mxCell>' +
    '<mxCell id="q" value="Jobs" style="icon=gcp pub/sub;" vertex="1" parent="1">' +
    '<mxGeometry x="140" y="40" width="48" height="48" as="geometry"/></mxCell></root></mxGraphModel>';
  const result = resolver.applyToXml(xml).xml;

  assert.equal(labelColor(result.match(/<mxCell id="ps"[^>]*?style="([^"]*)"/)[1]), "#5A626E");
  assert.equal(labelColor(result.match(/<mxCell id="q"[^>]*?style="([^"]*)"/)[1]), "#1B1F24");
  // the other label keys of the library stay: bold, 11 px, below the icon
  assert.match(result.match(/<mxCell id="q"[^>]*?style="([^"]*)"/)[1], /verticalLabelPosition=bottom;.*fontSize=11;fontStyle=1;fontColor=#1B1F24;/);
});

test("XML without icon names passes byte-identical", function()
{
  const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="a" value="x" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;" vertex="1" parent="1">' +
    '<mxGeometry x="0" y="0" width="48" height="48" as="geometry"/></mxCell></root></mxGraphModel>';
  const result = resolver.applyToXml(xml);

  assert.equal(result.xml, xml);
  assert.equal(result.resolved.length + result.unresolved.length, 0);
});

test("a hundred names resolve in well under a second", function()
{
  const fresh = createIconResolver(ICON_TABLE, ICON_DATA);
  const names = ["aws lambda", "aws s3", "aws rds postgresql", "aws elasticache redis", "aws sqs queue",
    "azure app service", "azure key vault", "gcp pub/sub", "gcp cloud sql", "kubernetes service"];
  const start = Date.now();

  for (let i = 0; i < 10; i++)
  {
    names.forEach(function(name) { fresh.resolve(name + (i > 0 ? " " + i : "")); });
  }

  assert.ok(Date.now() - start < 1000, (Date.now() - start) + " ms");
});

// open_drawio_xml resolves the names before it builds the link.
const server = fileURLToPath(new URL("../src/index.js", import.meta.url));
let client = null;

after(async function()
{
  if (client != null)
  {
    await client.close();
  }
});

test("open_drawio_xml opens the icon and notes a name it can't resolve", async function()
{
  client = new Client({ name: "icon-resolver-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport(
  {
    command: process.execPath,
    args: [server],
    env: Object.assign({}, process.env, { DRAWIO_BROWSER: "off" }),
    stderr: "pipe",
  }));

  const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="fn" value="Orders" style="icon=aws lambda;" vertex="1" parent="1">' +
    '<mxGeometry x="40" y="40" width="48" height="48" as="geometry"/></mxCell>' +
    '<mxCell id="x" value="?" style="icon=aws quantum flux;" vertex="1" parent="1">' +
    '<mxGeometry x="140" y="40" width="48" height="48" as="geometry"/></mxCell></root></mxGraphModel>';
  const result = await client.callTool({ name: "open_drawio_xml", arguments: { content: xml } });
  const text = result.content[0].text;
  const hash = new URL(text.match(/https:\/\/\S+/)[0]).hash;
  const opened = decodeURIComponent(pako.inflateRaw(Buffer.from(decodeURIComponent(hash.substring(2)), "base64"),
    { to: "string" }));

  assert.match(opened, /<mxCell id="fn" value="Orders" style="[^"]*resIcon=mxgraph\.aws4\.lambda;[^"]*labelPerimeter=1/);
  assert.match(opened, /<mxCell id="x" value="\?" style="icon=aws quantum flux;"/);
  assert.match(text, /icon=aws quantum flux \(cell x\) matched no icon/);
});
