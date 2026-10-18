import { test } from "node:test";
import assert from "node:assert/strict";
import { addLabelPerimeters, fitEdgeLabels, isLabelOutsideOnSide } from "../../shared/label-perimeter.js";

function vertex(id, value, style)
{
  return '<mxCell id="' + id + '" value="' + value + '" style="' + style +
    '" vertex="1" parent="1"><mxGeometry x="0" y="0" width="60" height="60" as="geometry"/></mxCell>';
}

function model(cells)
{
  return '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' + cells +
    "</root></mxGraphModel>";
}

function styleOf(xml, id)
{
  var m = xml.match(new RegExp('<mxCell id="' + id + '"[^>]*style="([^"]*)"'));

  return (m != null) ? m[1] : null;
}

test("labels outside the shape on one side get labelPerimeter", function()
{
  var xml = model(
    vertex("s3", "Amazon S3", "shape=mxgraph.aws4.resourceIcon;verticalLabelPosition=bottom;verticalAlign=top;html=1;") +
    vertex("top", "Top", "verticalLabelPosition=top;verticalAlign=bottom") +
    vertex("left", "Left", "labelPosition=left;align=right;html=1;") +
    vertex("right", "Right", "labelPosition=right;verticalLabelPosition=middle;align=left;"));
  var r = addLabelPerimeters(xml);

  assert.equal(r.changed, 4);
  assert.equal(styleOf(r.xml, "s3"), "shape=mxgraph.aws4.resourceIcon;verticalLabelPosition=bottom;verticalAlign=top;html=1;labelPerimeter=1;");
  assert.equal(styleOf(r.xml, "top"), "verticalLabelPosition=top;verticalAlign=bottom;labelPerimeter=1;");
  assert.equal(styleOf(r.xml, "left"), "labelPosition=left;align=right;html=1;labelPerimeter=1;");
  assert.equal(styleOf(r.xml, "right"), "labelPosition=right;verticalLabelPosition=middle;align=left;labelPerimeter=1;");
});

test("other cells are left byte-identical", function()
{
  var xml = model(
    vertex("inside", "Inside", "rounded=1;html=1;") +
    vertex("corner", "Corner", "labelPosition=right;verticalLabelPosition=bottom;") +
    vertex("kept", "Kept", "verticalLabelPosition=bottom;labelPerimeter=0;") +
    vertex("empty", "", "verticalLabelPosition=bottom;") +
    '<mxCell id="e" style="verticalLabelPosition=bottom;" edge="1" parent="1" source="inside" target="kept">' +
    '<mxGeometry relative="1" as="geometry"/></mxCell>');
  var r = addLabelPerimeters(xml);

  assert.equal(r.changed, 0);
  assert.equal(r.xml, xml);
});

test("children of containers are covered, and the pass is idempotent", function()
{
  var xml = model(
    '<mxCell id="vpc" value="VPC" style="swimlane;html=1;" vertex="1" parent="1">' +
    '<mxGeometry x="0" y="0" width="300" height="200" as="geometry"/></mxCell>' +
    '<mxCell id="ec2" value="EC2" style="verticalLabelPosition=bottom;verticalAlign=top;html=1;" vertex="1" parent="vpc">' +
    '<mxGeometry x="40" y="60" width="60" height="60" as="geometry"/></mxCell>');
  var once = addLabelPerimeters(xml);
  var twice = addLabelPerimeters(once.xml);

  assert.equal(once.changed, 1);
  assert.match(styleOf(once.xml, "ec2"), /labelPerimeter=1;$/);
  assert.equal(styleOf(once.xml, "vpc"), "swimlane;html=1;");
  assert.equal(twice.changed, 0);
  assert.equal(twice.xml, once.xml);
});

test("isLabelOutsideOnSide matches draw.io's Graph.isLabelOutsideOnSide", function()
{
  assert.equal(isLabelOutsideOnSide({verticalLabelPosition: "bottom"}), true);
  assert.equal(isLabelOutsideOnSide({verticalLabelPosition: "top", labelPosition: "center"}), true);
  assert.equal(isLabelOutsideOnSide({labelPosition: "left"}), true);
  assert.equal(isLabelOutsideOnSide({labelPosition: "right", verticalLabelPosition: "middle"}), true);
  assert.equal(isLabelOutsideOnSide({}), false);
  assert.equal(isLabelOutsideOnSide({labelPosition: "left", verticalLabelPosition: "top"}), false);
  assert.equal(isLabelOutsideOnSide({labelPosition: "right", verticalLabelPosition: "bottom"}), false);
});

function box(id, x, style, w, h)
{
  return '<mxCell id="' + id + '" value="' + id + '" style="' + style + '" vertex="1" parent="1"><mxGeometry x="' +
    x + '" y="40" width="' + w + '" height="' + h + '" as="geometry"/></mxCell>';
}

function edge(id, value, style, source, target, geometry)
{
  return '<mxCell id="' + id + '" value="' + value + '" style="' + style + '" edge="1" parent="1" source="' + source +
    '" target="' + target + '">' + (geometry || '<mxGeometry relative="1" as="geometry"/>') + "</mxCell>";
}

test("edges and the labels of edges get the label gap", function()
{
  var xml = model(box("a", 40, "rounded=1;", 140, 60) + box("b", 400, "rounded=1;", 140, 60) +
    edge("plain", "reads", "html=1;", "a", "b") +
    edge("dflt", "writes", "html=1;labelBackgroundColor=default;", "a", "b") +
    edge("unlabeled", "", "html=1;", "a", "b") +
    '<mxCell id="m" value="1..*" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="unlabeled">' +
    '<mxGeometry x="-0.8" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry></mxCell>');
  var r = fitEdgeLabels(xml);

  assert.equal(r.changed, 4);
  // Side by side: the labels also move above the line.
  assert.equal(styleOf(r.xml, "plain"), "html=1;labelBackgroundColor=default;defaultLabelBackgroundColor=gap;verticalAlign=bottom;labelPlacement=auto;");
  assert.equal(styleOf(r.xml, "dflt"), "html=1;labelBackgroundColor=default;defaultLabelBackgroundColor=gap;verticalAlign=bottom;labelPlacement=auto;");
  // Unlabeled edges get the gap for labels added later in draw.io, but no placement.
  assert.equal(styleOf(r.xml, "unlabeled"), "html=1;labelBackgroundColor=default;defaultLabelBackgroundColor=gap;");
  assert.equal(styleOf(r.xml, "m"), "edgeLabel;html=1;labelBackgroundColor=default;defaultLabelBackgroundColor=gap;");
});

test("unlabeled edges get the gap once, other children of edges are left alone", function()
{
  var xml = model(box("a", 40, "rounded=1;", 140, 60) + box("b", 400, "rounded=1;", 140, 60) +
    edge("u", "", "endArrow=none;", "a", "b") +
    edge("white", "", "labelBackgroundColor=#ffffff;", "a", "b") +
    '<mxCell id="sym" value="" style="ellipse;html=1;" vertex="1" parent="white">' +
    '<mxGeometry x="0" y="0" width="10" height="10" relative="1" as="geometry"><mxPoint x="-5" y="-5" as="offset"/></mxGeometry></mxCell>');
  var r = fitEdgeLabels(xml);

  assert.equal(r.changed, 1);
  assert.equal(styleOf(r.xml, "u"), "endArrow=none;labelBackgroundColor=default;defaultLabelBackgroundColor=gap;");
  assert.equal(styleOf(r.xml, "white"), "labelBackgroundColor=#ffffff;");
  assert.equal(styleOf(r.xml, "sym"), "ellipse;html=1;");
  assert.equal(fitEdgeLabels(r.xml).xml, r.xml);
});

test("explicit label backgrounds and existing gaps are kept", function()
{
  // Stacked, so no label moves above a line either; placement is the only addition.
  var xml = model(box("a", 40, "rounded=1;", 140, 60) + box("b", 40, "rounded=1;", 140, 60).replace('y="40"', 'y="240"') +
    edge("none", "No", "labelBackgroundColor=none;", "a", "b") +
    edge("color", "No", "labelBackgroundColor=#0F172A;", "a", "b") +
    edge("gap", "No", "labelBackgroundColor=default;defaultLabelBackgroundColor=gap;labelPlacement=auto;", "a", "b"));
  var r = fitEdgeLabels(xml);

  assert.equal(r.changed, 2);
  assert.equal(styleOf(r.xml, "none"), "labelBackgroundColor=none;labelPlacement=auto;");
  assert.equal(styleOf(r.xml, "color"), "labelBackgroundColor=#0F172A;labelPlacement=auto;");
  assert.equal(styleOf(r.xml, "gap"), "labelBackgroundColor=default;defaultLabelBackgroundColor=gap;labelPlacement=auto;");
});

test("a label wider than a short edge between diamonds moves above the line", function()
{
  // Diamonds 160 wide in columns 180 apart: a 20 px edge, "Yes" is about 24 px.
  var xml = model(box("a", 40, "rhombus;", 160, 90) + box("b", 220, "rhombus;", 160, 90) +
    box("c", 40, "rounded=1;", 140, 60).replace('y="40"', 'y="240"') +
    box("d", 220, "rounded=1;", 140, 60).replace('y="40"', 'y="240"') +
    edge("yes", "Yes", "edgeStyle=orthogonalEdgeStyle;", "a", "b") +
    edge("rect", "Retry payment", "edgeStyle=orthogonalEdgeStyle;", "c", "d") +
    edge("placed", "Yes", "edgeStyle=orthogonalEdgeStyle;verticalAlign=top;", "a", "b"));
  var r = fitEdgeLabels(xml);

  assert.equal(styleOf(r.xml, "yes"),
    "edgeStyle=orthogonalEdgeStyle;labelBackgroundColor=default;defaultLabelBackgroundColor=gap;verticalAlign=bottom;labelPlacement=auto;");
  // Rectangles leave no room above the line, and a placed label stays where the diagram put it.
  assert.equal(styleOf(r.xml, "rect"), "edgeStyle=orthogonalEdgeStyle;labelBackgroundColor=default;defaultLabelBackgroundColor=gap;labelPlacement=auto;");
  assert.equal(styleOf(r.xml, "placed"),
    "edgeStyle=orthogonalEdgeStyle;verticalAlign=top;labelBackgroundColor=default;defaultLabelBackgroundColor=gap;");
  assert.equal(fitEdgeLabels(r.xml).xml, r.xml);
});

test("labels on vertical and bent edges stay on the line", function()
{
  var xml = model(box("a", 40, "rhombus;", 160, 90) + box("b", 400, "rhombus;", 160, 90) +
    box("c", 40, "rhombus;", 160, 90).replace('y="40"', 'y="240"') +
    box("d", 400, "rounded=1;", 140, 60).replace('y="40"', 'y="400"') +
    edge("long", "Yes", "edgeStyle=orthogonalEdgeStyle;", "a", "b") +
    edge("down", "No", "edgeStyle=orthogonalEdgeStyle;", "a", "c") +
    edge("bent", "Later", "edgeStyle=orthogonalEdgeStyle;", "c", "d") +
    edge("ports", "Up", "edgeStyle=orthogonalEdgeStyle;exitX=0.5;exitY=0;entryX=0.5;entryY=1;", "c", "a"));
  var r = fitEdgeLabels(xml);

  assert.match(styleOf(r.xml, "long"), /verticalAlign=bottom;labelPlacement=auto;$/);
  // draw.io finds the segment of bent edges when it paints them
  assert.match(styleOf(r.xml, "bent"), /labelPlacement=auto;$/);
  assert.doesNotMatch(styleOf(r.xml, "down"), /verticalAlign/);
  assert.doesNotMatch(styleOf(r.xml, "bent"), /verticalAlign/);
  assert.equal(fitEdgeLabels(r.xml).xml, r.xml);
  assert.doesNotMatch(styleOf(r.xml, "ports"), /verticalAlign/);
});
