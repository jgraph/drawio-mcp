import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import express from "express";

// Opt in with CHROMIUM_PATH and a test-only installation of playwright-core.
test("the app uploads rendered diagrams for the image tool", { skip: !process.env.CHROMIUM_PATH, timeout: 120000 }, async function()
{
  const { chromium } = await import("playwright-core");
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const client = new Client({ name: "image-browser-test", version: "1" },
    { capabilities: { extensions: { "io.modelcontextprotocol/ui": {} } } });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["src/index.js", "--stdio"], cwd, stderr: "pipe" });
  transport.stderr.on("data", function() {});
  let server;
  let browser;

  try
  {
    await client.connect(transport);
    const tools = await client.listTools();
    const create = tools.tools.find(function(tool) { return tool.name === "create_diagram"; });
    const resource = await client.readResource({ uri: create._meta.ui.resourceUri });
    const html = resource.contents[0].text;
    const host = express();
    host.use(express.json({ limit: "2mb" }));
    host.post("/tool", async function(req, res)
    {
      try
      {
        res.json(await client.callTool(req.body));
      }
      catch (error)
      {
        res.status(500).json({ error: error.message });
      }
    });
    host.get("/", function(req, res)
    {
      res.type("html").send(`<!doctype html><body style="margin:0">
        <iframe id="app" sandbox="allow-scripts" style="width:1000px;height:700px;border:0"></iframe>
        <script>
        const frame = document.getElementById('app');
        let input, result;
        window.addEventListener('message', async function(event) {
          const msg = event.data;
          if (!msg || !msg.method) return;
          if (msg.method === 'ui/initialize') {
            frame.contentWindow.postMessage({jsonrpc:'2.0', id:msg.id, result:{
              protocolVersion:msg.params.protocolVersion,
              hostInfo:{name:'test-host',version:'1'},
              hostCapabilities:{serverTools:{},updateModelContext:{text:{},image:{}}},
              hostContext:{theme:'light',displayMode:'inline',containerDimensions:{width:1000,height:700},locale:'en-US'}
            }}, '*');
          } else if (msg.method === 'ui/notifications/initialized') {
            window.ready = true;
            frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-input',params:{arguments:input}}, '*');
            frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:result}, '*');
          } else if (msg.method === 'tools/call') {
            try {
              const response = await fetch('/tool', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(msg.params)});
              const body = await response.json();
              if (!response.ok) throw new Error(body.error);
              frame.contentWindow.postMessage({jsonrpc:'2.0',id:msg.id,result:body}, '*');
            } catch (error) {
              frame.contentWindow.postMessage({jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:String(error)}}, '*');
            }
          } else if (msg.id !== undefined) {
            frame.contentWindow.postMessage({jsonrpc:'2.0',id:msg.id,result:{}}, '*');
          }
        });
        window.start = function(html, args, toolResult) { input=args; result=toolResult; frame.srcdoc=html; };
        </script>`);
    });
    server = host.listen(0, "127.0.0.1");
    await new Promise(function(resolve) { server.once("listening", resolve); });
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="a" value="&lt;b&gt;Bold HTML&lt;/b&gt;&lt;br&gt;Second line" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="170" height="80" as="geometry"/></mxCell>' +
      '<mxCell id="b" value="draw.io" style="shape=image;image=https://viewer.diagrams.net/images/drawlogo128.png;verticalLabelPosition=bottom;verticalAlign=top;html=1;" vertex="1" parent="1"><mxGeometry x="300" y="40" width="80" height="80" as="geometry"/></mxCell>' +
      '<mxCell id="e" edge="1" parent="1" source="a" target="b" style="edgeStyle=orthogonalEdgeStyle;"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>';
    const cases = [
      { xml, routing: "libavoid", captureImage: true },
      { mermaid: "flowchart LR\n A[Mermaid Alpha] --> B[Mermaid Beta]", captureImage: true },
      { mermaid: "flowchart LR\n A[Layout Alpha] --> B[Layout Beta]", postLayout: "elk", captureImage: true },
    ];

    for (const args of cases)
    {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const result = await client.callTool({ name: "create_diagram", arguments: args });
      assert.notEqual(result.isError, true);
      const payload = JSON.parse(result.content.find(function(item) { return item.type === "text"; }).text);
      assert.ok(payload.imageId);
      await page.evaluate(function(data) { window.start(data.html, data.args, data.result); }, { html, args, result });
      await page.waitForFunction(function() { return window.ready === true; }, { timeout: 10000 });
      const imageResult = await client.callTool({ name: "get_diagram_image", arguments: { id: payload.imageId } });
      assert.notEqual(imageResult.isError, true, JSON.stringify(imageResult));
      const image = imageResult.content.find(function(item) { return item.type === "image"; });
      assert.equal(image.mimeType, "image/png");
      assert.deepEqual(Buffer.from(image.data, "base64").subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
      const pixels = await page.evaluate(async function(data)
      {
        const image = new Image();
        image.src = "data:image/png;base64," + data;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0;
        let orange = 0;
        for (let i = 0; i < rgba.length; i += 4)
        {
          if (rgba[i] < 100 && rgba[i + 1] < 100 && rgba[i + 2] < 100 && rgba[i + 3] > 100) dark++;
          if (rgba[i] > 200 && rgba[i + 1] > 70 && rgba[i + 1] < 190 && rgba[i + 2] < 50 && rgba[i + 3] > 100) orange++;
        }
        return { dark, orange };
      }, image.data);
      assert.ok(pixels.dark > 100, "captured diagram must not be blank");
      if (args.xml) assert.ok(pixels.orange > 100, "captured diagram must include its icon");
    }
  }
  finally
  {
    if (browser) await browser.close();
    if (server) await new Promise(function(resolve) { server.close(resolve); });
    await client.close();
  }
});
