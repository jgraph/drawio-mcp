import { test } from "node:test";
import assert from "node:assert/strict";
import { snapWaypoints } from "../../shared/edge-waypoints.js";

// A waypoint a pixel or two off the line of a fixed connection point makes
// draw.io's orthogonal router add a jog of that size at the shape; at the end
// of an edge the arrowhead then points along the side. snapWaypoints moves it
// onto the line.

function vertex(id, x, y, w, h, style, parent)
{
  return '<mxCell id="' + id + '" value="' + id + '" style="' + (style || "rounded=1;whiteSpace=wrap;html=1;") +
    '" vertex="1" parent="' + (parent || "1") + '"><mxGeometry x="' + x + '" y="' + y + '" width="' + w +
    '" height="' + h + '" as="geometry"/></mxCell>';
}

function edge(id, source, target, style, points, parent)
{
  return '<mxCell id="' + id + '" style="edgeStyle=orthogonalEdgeStyle;html=1;' + style + '" edge="1" parent="' +
    (parent || "1") + '" source="' + source + '" target="' + target + '"><mxGeometry relative="1" as="geometry">' +
    '<Array as="points">' + points.map(function(p) { return '<mxPoint x="' + p[0] + '" y="' + p[1] + '"/>'; }).join("") +
    "</Array></mxGeometry></mxCell>";
}

function model(cells)
{
  return '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' + cells + "</root></mxGraphModel>";
}

function pointsOf(xml, id)
{
  var m = xml.match(new RegExp('<mxCell id="' + id + '"[\\s\\S]*?</mxCell>'));
  var pts = [];
  var re = /<mxPoint x="([^"]*)" y="([^"]*)"/g;
  var p;

  while ((p = re.exec(m[0])) !== null)
  {
    pts.push([parseFloat(p[1]), parseFloat(p[2])]);
  }

  return pts;
}

// The Time Machine arrow of a hand-written disk overview: from the left side
// of "sky" (y = 517 + 0.36 * 120 = 560.2) down a corridor at x = 600 into the
// right side of the backup disk (y = 402 + 0.6 * 178 = 508.8). Its last
// waypoint was written at y = 510, so the line ended in a 1.2 px step and the
// arrowhead pointed down the disk's side.
const TM = model(
  vertex("x10", 45, 402, 520, 178) +
  vertex("sky", 635, 517, 520, 120) +
  edge("tm", "sky", "x10", "endArrow=block;rounded=1;exitX=0;exitY=0.36;exitDx=0;exitDy=0;entryX=1;entryY=0.6;entryDx=0;entryDy=0;",
    [[600, 560], [600, 510]]));

test("a waypoint 1.2 px off a connection point is moved onto its line, and the arrow gets 35 px", function()
{
  var r = snapWaypoints(TM);
  var pts = pointsOf(r.xml, "tm");
  var entry = { x: 45 + 520, y: 402 + 0.6 * 178 };
  var last = pts[pts.length - 1];

  assert.equal(r.changed, 1);
  assert.deepEqual(pts, [[600, 560.2], [600, 508.8]]);
  // The last segment runs straight from the waypoint into the side
  assert.equal(last[1], entry.y);
  assert.equal(last[0] - entry.x, 35);
});

test("the pass is idempotent and leaves everything else byte-identical", function()
{
  var once = snapWaypoints(TM).xml;

  assert.equal(snapWaypoints(once).changed, 0);
  assert.equal(snapWaypoints(once).xml, once);
  assert.equal(once.replace(/<mxCell id="tm"[\s\S]*?<\/mxCell>/, ""), TM.replace(/<mxCell id="tm"[\s\S]*?<\/mxCell>/, ""));
});

test("waypoints 3 px or more off, on the line or at floating ends stay", function()
{
  var cells = vertex("a", 0, 0, 100, 100) + vertex("b", 300, 200, 100, 100);
  var xml = model(cells +
    edge("far", "a", "b", "exitX=1;exitY=0.5;entryX=0;entryY=0.5;", [[200, 53], [200, 247]]) +
    edge("on", "a", "b", "exitX=1;exitY=0.5;entryX=0;entryY=0.5;", [[200, 50], [200, 250]]) +
    edge("floating", "a", "b", "", [[200, 51], [200, 249]]));

  assert.equal(snapWaypoints(xml).changed, 0);
  assert.equal(snapWaypoints(xml).xml, xml);
});

test("on a top or bottom side the x is snapped, with the offset of the connection point", function()
{
  var xml = model(vertex("a", 0, 0, 100, 60) + vertex("b", 200, 200, 100, 60) +
    edge("e", "a", "b", "exitX=0.5;exitY=1;exitDx=10;entryX=0.25;entryY=0;", [[62, 120], [227, 120]]));
  var pts = pointsOf(snapWaypoints(xml).xml, "e");

  assert.deepEqual(pts, [[60, 120], [225, 120]]);
});

test("waypoints in a container are snapped in its coordinates", function()
{
  var xml = model(vertex("g", 100, 100, 600, 400, "rounded=0;html=1;") +
    vertex("a", 20, 20, 100, 60, null, "g") + vertex("b", 300, 200, 100, 60, null, "g") +
    edge("e", "a", "b", "exitX=1;exitY=0.5;entryX=0;entryY=0.5;", [[200, 52], [200, 228]], "g"));

  assert.deepEqual(pointsOf(snapWaypoints(xml).xml, "e"), [[200, 50], [200, 230]]);
});

test("points draw.io would move are left alone: round outlines off the middle, corners, turned shapes", function()
{
  function check(style, exit)
  {
    var xml = model(vertex("a", 0, 0, 100, 100, style) + vertex("b", 300, 0, 100, 100) +
      edge("e", "a", "b", exit + "entryX=0;entryY=0.5;", [[200, 31], [200, 49]]));

    return pointsOf(snapWaypoints(xml).xml, "e")[0];
  }

  assert.deepEqual(check("ellipse;html=1;", "exitX=1;exitY=0.3;"), [200, 31]);
  assert.deepEqual(check("ellipse;html=1;", "exitX=1;exitY=0.3;exitPerimeter=0;"), [200, 30]);
  assert.deepEqual(check("rhombus;html=1;", "exitX=1;exitY=0.3;"), [200, 31]);
  assert.deepEqual(check("rounded=1;html=1;", "exitX=1;exitY=0;"), [200, 31]);
  assert.deepEqual(check("rounded=1;rotation=90;html=1;", "exitX=1;exitY=0.3;"), [200, 31]);
  assert.deepEqual(check("rounded=1;flipV=1;html=1;", "exitX=1;exitY=0.3;"), [200, 31]);
  assert.deepEqual(check("rounded=1;html=1;", "exitX=1;exitY=0.3;"), [200, 30]);
});

test("in the middle of a side, round and slanted outlines are snapped too", function()
{
  var xml = model(vertex("a", 0, 0, 100, 100, "rhombus;html=1;") + vertex("b", 300, 0, 100, 100, "ellipse;html=1;") +
    edge("e", "a", "b", "exitX=1;exitY=0.5;entryX=0;entryY=0.5;", [[200, 51.5], [250, 48]]));

  assert.deepEqual(pointsOf(snapWaypoints(xml).xml, "e"), [[200, 50], [250, 50]]);
});
