import { test } from "node:test";
import assert from "node:assert/strict";
import { addLabelPerimeters, isLabelOutsideOnSide } from "../../shared/label-perimeter.js";

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
