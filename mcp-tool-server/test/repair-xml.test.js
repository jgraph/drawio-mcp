import { test } from "node:test";
import assert from "node:assert/strict";
import { repairDiagramXml, leakedArguments } from "../../shared/repair-xml.js";

const CELLS = '<mxCell id="a" value="A" style="rounded=1;html=1;" vertex="1" parent="1">' +
  '<mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell>';
const MODEL = '<mxGraphModel adaptiveColors="auto"><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  CELLS + '</root></mxGraphModel>';

test("a well-formed diagram comes back byte-identical", function()
{
  const inputs =
  [
    MODEL,
    '<?xml version="1.0" encoding="UTF-8"?>\n' + MODEL + "\n",
    '<mxfile><diagram id="p1" name="A">' + MODEL + '</diagram><diagram id="p2" name="B">' + MODEL + "</diagram></mxfile>",
    MODEL.replace('value="A"', 'value="&lt;b&gt;A&lt;/b&gt;&amp;B&#xa;&quot;C&quot;"'),
  ];

  for (const xml of inputs)
  {
    const result = repairDiagramXml(xml);

    assert.equal(result.xml, xml);
    assert.deepEqual(result.repairs, []);
    assert.equal(result.trailing, "");
  }
});

test("a leaked tool-call tag after the diagram is dropped and returned", function()
{
  const tail = '</content>\n<parameter name="postLayout">elk';
  const result = repairDiagramXml(MODEL + tail);

  assert.equal(result.xml, MODEL);
  assert.deepEqual(result.repairs, ["text around the diagram removed"]);
  assert.equal(result.trailing, tail);
});

test("a duplicated closing tag, a code fence and prose around the diagram are dropped", function()
{
  assert.equal(repairDiagramXml(MODEL + "</mxGraphModel>").xml, MODEL);
  assert.equal(repairDiagramXml("```xml\n" + MODEL + "\n```").xml, MODEL);
  assert.equal(repairDiagramXml("Here is the diagram: " + MODEL + " Hope it helps.").xml, MODEL);
});

test("an mxfile is kept whole, up to its own closing tag", function()
{
  const file = "<mxfile><diagram>" + MODEL + "</diagram><diagram>" + MODEL + "</diagram></mxfile>";

  assert.equal(repairDiagramXml(file + "</content>").xml, file);
});

test("< and stray & in attribute values are escaped, entities are kept", function()
{
  const broken = MODEL.replace('value="A"', 'value="<b>R&D</b><br>A&nbsp;B &amp; &#xa; &#169;"');
  const result = repairDiagramXml(broken);

  assert.ok(result.xml.includes('value="&lt;b>R&amp;D&lt;/b>&lt;br>A&amp;nbsp;B &amp; &#xa; &#169;"'));
  assert.deepEqual(result.repairs, ["attribute values escaped"]);
});

test("quoted attributes of an unescaped HTML label stay in the value", function()
{
  const broken = MODEL.replace('value="A"', 'value="Rollback<br><font style="font-size:11px">restore</font>"');
  const result = repairDiagramXml(broken);

  assert.ok(result.xml.includes('value="Rollback&lt;br>&lt;font style=&quot;font-size:11px&quot;>restore&lt;/font>" style="rounded=1;html=1;"'));
  assert.deepEqual(result.repairs, ["attribute values escaped"]);
});

test("a layer that is its own parent is re-parented to the root", function()
{
  const broken = MODEL.replace('<mxCell id="1" parent="0"/>', '<mxCell id="1" parent="1"/>');
  const result = repairDiagramXml(broken);

  assert.equal(result.xml, MODEL);
  assert.deepEqual(result.repairs, ["layer re-parented to the root"]);

  // Only a layer: a vertex or edge parented to itself is left alone.
  const vertex = MODEL.replace('vertex="1" parent="1"', 'vertex="1" parent="a"');

  assert.equal(repairDiagramXml(vertex).xml, vertex);
});

test("markup too broken to scan is left as it was", function()
{
  const inputs =
  [
    MODEL.replace('value="A"', 'value="say "hi""'),
    MODEL.replace('value="A"', 'value="A'),
    MODEL.replace("</root>", "a < b</root>"),
    "not a diagram",
    "",
  ];

  for (const xml of inputs)
  {
    assert.equal(repairDiagramXml(xml).xml, xml);
  }

  assert.equal(repairDiagramXml(null).xml, null);
});

test("leaked arguments are recovered only for known names and values", function()
{
  const allowed = { postLayout: ["elk"], direction: ["vertical", "horizontal"], routing: ["libavoid"] };

  assert.deepEqual(leakedArguments('</content>\n<parameter name="postLayout">elk', allowed), { postLayout: "elk" });
  assert.deepEqual(leakedArguments('</content>\n<parameter name="routing">libavoid\n<parameter name="direction">horizontal', allowed),
    { routing: "libavoid", direction: "horizontal" });
  assert.deepEqual(leakedArguments('</content>\n<parameter name="postLayout">none', allowed), {});
  assert.deepEqual(leakedArguments('</content>\n<parameter name="lightbox">true', allowed), {});
  assert.deepEqual(leakedArguments("", allowed), {});
});
