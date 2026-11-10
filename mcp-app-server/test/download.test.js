import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The viewer's Download button asks the host (ui/download-file) to save the
// diagram as a .drawio file, its menu as a .drawio file, PNG or SVG; the Copy
// menu offers Copy as XML (what the button does), Copy as Image and Copy as
// SVG. Their code runs in the app's HTML, so it is taken from the source of
// the template.

const source = readFileSync(new URL("../src/shared.js", import.meta.url), "utf-8");

function templateFunction(name)
{
  const fn = source.match(new RegExp("\\nfunction " + name + "\\([^)]*\\)\\n\\{\\n[\\s\\S]*?\\n\\}\\n"));

  assert.ok(fn, name + " not found in src/shared.js");

  // As the built HTML has it: the template literal resolves its escapes
  return new Function("return `" + fn[0] + "`;")();
}

const { drawioFileRequest, imageFileRequest, toolbarMenuFormats, toolbarMenuEntries, svgClipboardTexts,
  diagramPage, exportTheme, svgExportBackground } = new Function(
  templateFunction("drawioFileText") + templateFunction("drawioFileRequest") +
  templateFunction("imageFileRequest") + templateFunction("toolbarMenuFormats") +
  templateFunction("toolbarMenuEntries") + templateFunction("svgClipboardTexts") +
  templateFunction("diagramPage") + templateFunction("exportTheme") + templateFunction("svgExportBackground") +
  "\nreturn { drawioFileRequest, imageFileRequest, toolbarMenuFormats, toolbarMenuEntries, svgClipboardTexts, " +
  "diagramPage, exportTheme, svgExportBackground };")();

const model = '<mxGraphModel adaptiveColors="auto"><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="a" value="R&amp;D" style="rounded=1;html=1;" vertex="1" parent="1">' +
  '<mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell></root></mxGraphModel>';

function fileOf(request)
{
  assert.equal(request.contents.length, 1);

  const item = request.contents[0];

  assert.equal(item.type, "resource");
  assert.equal(item.resource.uri, "file:///diagram.drawio");
  assert.equal(item.resource.mimeType, "application/vnd.jgraph.mxfile");

  return item.resource.text;
}

test("a diagram downloads as a .drawio file with one page", function()
{
  assert.equal(fileOf(drawioFileRequest(model)),
    '<mxfile><diagram name="Page-1" id="page-1">' + model + "</diagram></mxfile>");
});

test("an mxfile downloads as it is", function()
{
  const mxfile = '\n<mxfile host="app.diagrams.net"><diagram name="A" id="a">' + model +
    '</diagram><diagram name="B" id="b">' + model + "</diagram></mxfile>";

  assert.equal(fileOf(drawioFileRequest(mxfile)), mxfile);
});

test("an SVG downloads as text, a PNG as the base64 of its data URI", function()
{
  assert.deepEqual(imageFileRequest("svg", "<svg/>"), { contents: [{ type: "resource", resource:
    { uri: "file:///diagram.svg", mimeType: "image/svg+xml", text: "<svg/>" } }] });
  assert.deepEqual(imageFileRequest("png", "data:image/png;base64,iVBORw0KGgo="), { contents: [{ type: "resource", resource:
    { uri: "file:///diagram.png", mimeType: "image/png", blob: "iVBORw0KGgo=" } }] });
});

// Each host as it declares itself; the menus follow what is declared, never
// the host's name.
const browser = { canvasExport: true, clipboardItems: true };
const download = { downloadFile: {} };
const clipboard = { sandbox: { permissions: { clipboardWrite: {} } } };

test("a host with downloadFile gets PNG and SVG in the Download menu", function()
{
  assert.deepEqual(toolbarMenuFormats(download, browser), { download: ["png", "svg"], copy: [] });
});

test("a host without downloadFile gets no Download menu", function()
{
  assert.deepEqual(toolbarMenuFormats({ openLinks: {} }, browser), { download: [], copy: [] });
  assert.deepEqual(toolbarMenuFormats(undefined, browser), { download: [], copy: [] });
});

test("Copy as Image and Copy as SVG need the host's clipboardWrite grant and a browser that writes ClipboardItems", function()
{
  assert.deepEqual(toolbarMenuFormats(Object.assign({}, download, clipboard), browser),
    { download: ["png", "svg"], copy: ["png", "svg"] });
  assert.deepEqual(toolbarMenuFormats(clipboard, browser), { download: [], copy: ["png", "svg"] });
  assert.deepEqual(toolbarMenuFormats({ sandbox: { permissions: { camera: {} } } }, browser),
    { download: [], copy: [] });
  assert.deepEqual(toolbarMenuFormats(clipboard, { canvasExport: true, clipboardItems: false }),
    { download: [], copy: [] });
});

test("without a usable canvas there is no PNG, only SVG", function()
{
  assert.deepEqual(toolbarMenuFormats(Object.assign({}, download, clipboard),
    { canvasExport: false, clipboardItems: true }), { download: ["svg"], copy: ["svg"] });
});

// What the menus list, in draw.io's words: first the button's own action,
// marked as the default, then the image formats.
function labelsOf(entries)
{
  return entries.map(function(entry)
  {
    return (entry.isDefault ? "* " : "") + entry.label;
  });
}

test("each menu starts with what its button does, marked as the default", function()
{
  const entries = toolbarMenuEntries(toolbarMenuFormats(Object.assign({}, download, clipboard), browser));

  assert.deepEqual(labelsOf(entries.download), ["* Download .drawio", "Download PNG", "Download SVG"]);
  assert.deepEqual(labelsOf(entries.copy), ["* Copy as XML", "Copy as Image", "Copy as SVG"]);
  assert.deepEqual(entries.download.map(function(entry) { return entry.action; }), ["drawio", "png", "svg"]);
  assert.deepEqual(entries.copy.map(function(entry) { return entry.action; }), ["xml", "png", "svg"]);
});

test("a menu without an image format stays empty, so its arrow is hidden", function()
{
  assert.deepEqual(toolbarMenuEntries(toolbarMenuFormats(download, browser)).copy, []);
  assert.deepEqual(toolbarMenuEntries(toolbarMenuFormats(clipboard, browser)).download, []);
  assert.deepEqual(toolbarMenuEntries(toolbarMenuFormats({ openLinks: {} }, browser)),
    { download: [], copy: [] });
});

test("without a usable canvas both menus keep their default and SVG", function()
{
  const entries = toolbarMenuEntries(toolbarMenuFormats(Object.assign({}, download, clipboard),
    { canvasExport: false, clipboardItems: true }));

  assert.deepEqual(labelsOf(entries.download), ["* Download .drawio", "Download SVG"]);
  assert.deepEqual(labelsOf(entries.copy), ["* Copy as XML", "Copy as SVG"]);
});

// Copy as SVG writes what draw.io's Copy as SVG writes, plus the markup as text
const svg = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ' +
  '"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg" ' +
  'style="background: transparent;" width="161px" height="81.5px" viewBox="-0.5 -0.5 161 81.5" ' +
  'content="&lt;mxfile&gt;&lt;mxGeometry width=&quot;140&quot;/&gt;&lt;/mxfile&gt;"><g/></svg>';

test("Copy as SVG writes an image where the browser takes image/svg+xml", function()
{
  assert.deepEqual(svgClipboardTexts(svg, "data:image/svg+xml;base64,PHN2Zy8+", true), {
    "text/html": '<img src="data:image/svg+xml;base64,PHN2Zy8+" width="161" height="82">',
    "text/plain": svg,
    "image/svg+xml": svg
  });
});

test("elsewhere Copy as SVG writes only types every ClipboardItem takes", function()
{
  const texts = svgClipboardTexts(svg, "data:image/svg+xml;base64,PHN2Zy8+", false);

  assert.deepEqual(Object.keys(texts).sort(), ["text/html", "text/plain"]);
  assert.equal(texts["text/plain"], svg);
});

test("an SVG without a size is pasted at its own size", function()
{
  assert.equal(svgClipboardTexts("<svg><g/></svg>", "data:x", false)["text/html"], '<img src="data:x">');
});

// Each entry has something to run in the viewer
test("every menu entry has an action in the viewer", function()
{
  const actions = source.match(/\nvar MENU_ACTIONS = \{[\s\S]*?\n\};\n/);

  assert.ok(actions, "MENU_ACTIONS not found in src/shared.js");

  const entries = toolbarMenuEntries(toolbarMenuFormats(Object.assign({}, download, clipboard), browser));

  for (const menu of ["download", "copy"])
  {
    const block = actions[0].match(new RegExp("\\n  " + menu + ": \\{([\\s\\S]*?)\\n  \\}"));

    assert.ok(block, menu + " actions not found");

    for (const entry of entries[menu])
    {
      assert.match(block[1], new RegExp("\\n    " + entry.action + ": "), menu + " has no " + entry.action);
    }
  }
});

// The mxGraphModel node of a diagram, as the DOM gives it to diagramPage
function modelNode(attrs)
{
  return { getAttribute: function(name)
  {
    return (name in attrs) ? attrs[name] : null;
  } };
}

test("the exports take the page color, shadow and adaptiveColors of the diagram", function()
{
  assert.deepEqual(diagramPage(modelNode({ background: "#0F172A", shadow: "1", adaptiveColors: "none" })),
    { background: "#0F172A", shadow: true, adaptiveColors: "none" });
  assert.deepEqual(diagramPage(modelNode({ adaptiveColors: "auto" })),
    { background: null, shadow: false, adaptiveColors: "auto" });
  assert.deepEqual(diagramPage(null), { background: null, shadow: false, adaptiveColors: null });

  for (const none of ["", "none", "default"])
  {
    assert.equal(diagramPage(modelNode({ background: none })).background, null);
  }

  assert.equal(diagramPage(modelNode({ shadow: "0" })).shadow, false);
});

test("a dark page keeps its color and its light text in both images", function()
{
  const dark = diagramPage(modelNode({ background: "#1E3A5F", adaptiveColors: "none" }));

  assert.equal(exportTheme(dark, "dark"), "light");
  assert.equal(exportTheme(dark, "auto"), "light");
  assert.equal(svgExportBackground(dark), "#1E3A5F");
});

test("adaptive colors follow the theme, and only a diagram without them gets a white page", function()
{
  const adaptive = diagramPage(modelNode({ adaptiveColors: "auto" }));

  assert.equal(exportTheme(adaptive, "dark"), "dark");
  assert.equal(exportTheme(diagramPage(null), "auto"), "auto");
  assert.equal(svgExportBackground(adaptive), null);
  assert.equal(svgExportBackground(diagramPage(modelNode({ adaptiveColors: "none" }))), "#ffffff");
});
