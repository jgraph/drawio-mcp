import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDiagramXml } from "../src/normalize-diagram-xml.js";

const graphModelXml = '<mxGraphModel dx="1030"></mxGraphModel>';
const mxFileXml =
  '<?xml version="1.0" encoding="UTF-8"?><mxfile host="app.diagrams.net"><diagram id="test"><mxGraphModel></mxGraphModel></diagram></mxfile>';

test("returns raw mxGraphModel XML unchanged", function()
{
  assert.equal(normalizeDiagramXml(graphModelXml), graphModelXml);
});

test("returns raw mxfile XML unchanged", function()
{
  assert.equal(normalizeDiagramXml(mxFileXml), mxFileXml);
});

test("unwraps top-level text JSON string", function()
{
  assert.equal(
    normalizeDiagramXml(JSON.stringify({ text: graphModelXml })),
    graphModelXml
  );
});

test("unwraps text content block JSON string", function()
{
  assert.equal(
    normalizeDiagramXml(JSON.stringify({ type: "text", text: graphModelXml })),
    graphModelXml
  );
});

test("unwraps content array JSON string", function()
{
  assert.equal(
    normalizeDiagramXml(JSON.stringify({ content: [{ type: "text", text: graphModelXml }] })),
    graphModelXml
  );
});

test("rejects non-XML text payloads", function()
{
  assert.equal(normalizeDiagramXml(JSON.stringify({ text: "hello" })), null);
});

test("rejects malformed JSON", function()
{
  assert.equal(normalizeDiagramXml('{"text":"broken"'), null);
});

test("rejects empty strings and arrays", function()
{
  assert.equal(normalizeDiagramXml("   "), null);
  assert.equal(normalizeDiagramXml("[]"), null);
});
