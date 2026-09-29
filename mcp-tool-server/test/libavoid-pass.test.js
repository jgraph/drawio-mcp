import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { routeXml } from "../src/libavoid-pass.js";
import { ROUTING_CORE } from "../src/cdn-cache.js";

// Exercise the real vendored routing core and WASM without a CDN or user cache.
ROUTING_CORE.url = fileURLToPath(new URL("../vendor/libavoid/libavoid-routing.js", import.meta.url));

function scene(y)
{
  const vertices = [
    '<mxCell id="source" vertex="1" parent="1" value="Source">' +
      '<mxGeometry x="20" y="' + y + '" width="100" height="60" as="geometry"/></mxCell>',
    '<mxCell id="target" vertex="1" parent="1" value="Target">' +
      '<mxGeometry x="500" y="' + y + '" width="100" height="60" as="geometry"/></mxCell>',
    '<mxCell id="obstacle" vertex="1" parent="1" value="Obstacle">' +
      '<mxGeometry x="250" y="' + (y - 30) + '" width="120" height="120" as="geometry"/></mxCell>',
  ];
  const root = '<root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    vertices.join("") +
    '<mxCell id="edge" edge="1" parent="1" source="source" target="target" ' +
    'style="edgeStyle=orthogonalEdgeStyle;exitX=1;exitY=0.5;entryX=0;entryY=0.5;">' +
    '<mxGeometry relative="1" as="geometry"/></mxCell></root>';

  return { xml: '<mxGraphModel adaptiveColors="auto">' + root + '</mxGraphModel>',
    fragment: root, vertices: vertices };
}

function document(a, b)
{
  return '<mxfile host="test" modified="unchanged">\n' +
    '<diagram id="first" name="A &amp; B">' + a + '</diagram>\n' +
    '<diagram id="second" name="Second">' + b + '</diagram>\n</mxfile>';
}

test("single-page routing changes only the connector and avoids the obstacle", async function ()
{
  const input = scene(100);
  const after = await routeXml(input.xml);

  assert.notEqual(after, input.xml);
  for (const vertex of input.vertices)
  {
    assert.ok(after.includes(vertex), "vertex changed during edge-only routing");
  }

  const points = [...after.matchAll(/<mxPoint x="([^"]+)" y="([^"]+)"/g)]
    .map(function (match)
    {
      return { x: Number(match[1]), y: Number(match[2]) };
    });
  assert.ok(points.length >= 2, "routing must produce a detour, not return the input");
  const route = [{ x: 120, y: 130 }, ...points, { x: 500, y: 130 }];
  for (let i = 1; i < route.length; i++)
  {
    const a = route[i - 1], b = route[i];
    assert.ok(a.x === b.x || a.y === b.y, "non-orthogonal segment");
    const crosses = a.y === b.y ?
      a.y > 70 && a.y < 190 && Math.max(a.x, b.x) > 250 && Math.min(a.x, b.x) < 370 :
      a.x > 250 && a.x < 370 && Math.max(a.y, b.y) > 70 && Math.min(a.y, b.y) < 190;
    assert.equal(crosses, false, "segment crosses the obstacle interior");
  }
});

test("pages reusing cell IDs route exactly as their standalone models", async function ()
{
  const a = scene(100).xml;
  const b = scene(500).xml;
  const expectedA = await routeXml(a);
  const expectedB = await routeXml(b);

  assert.notEqual(expectedA, a);
  assert.notEqual(expectedB, b);
  assert.equal(await routeXml(document(a, b)), document(expectedA, expectedB));
});

test("a vertex on another page cannot become an obstacle for the first page", async function ()
{
  const a = scene(100).xml;
  const other = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="foreign-obstacle" vertex="1" parent="1">' +
    '<mxGeometry x="160" y="190" width="320" height="40" as="geometry"/>' +
    '</mxCell></root></mxGraphModel>';

  assert.equal(await routeXml(document(a, other)), document(await routeXml(a), other));
});

test("compressed and empty sibling pages remain byte-identical", async function ()
{
  const a = scene(100).xml;
  const compressed = deflateRawSync(encodeURIComponent(scene(500).xml)).toString("base64");
  const suffix = '<diagram id="empty" name="Empty"/></mxfile>';
  const before = document(a, compressed).replace('</mxfile>', suffix);
  const expected = document(await routeXml(a), compressed).replace('</mxfile>', suffix);

  assert.equal(await routeXml(before), expected);
});

test("unwrapped cell fragments retain their routing behavior", async function ()
{
  const input = scene(100);
  const expected = (await routeXml(input.xml))
    .replace('<mxGraphModel adaptiveColors="auto">', '').replace('</mxGraphModel>', '');

  assert.equal(await routeXml(input.fragment), expected);
});

test("non-diagram inputs and pages without edges remain unchanged", async function ()
{
  for (const input of [null, "", "name,type\nFoo,bar", '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>'])
  {
    assert.equal(await routeXml(input), input);
  }
});
