import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { normalizeDiagramXml, INVALID_DIAGRAM_XML_MESSAGE } from "./normalize-diagram-xml.js";
import { buildTagMap, searchShapes } from "../../shared/shape-search.js";

/**
 * Build the self-contained HTML string that renders diagrams.
 * The MCP Apps App class and pako deflate are inlined. The draw.io viewer,
 * drawio-elk, drawio-mermaid, and libavoid (glue + wasm payload + loader +
 * routing core from js/libavoid-js/) load from the viewer.diagrams.net CDN
 * by default — cached cross-session and kept in version-sync with each
 * draw.io release. Pass viewerJs/elkJs/mermaidJs (or libavoidJs +
 * libavoidWasmB64) to inline a local build instead (for dev — see
 * VIEWER_PATH/ELK_PATH/MERMAID_PATH in index.js).
 *
 * @param {string} appWithDepsJs - The processed MCP Apps SDK bundle (exports stripped, App alias added).
 * @param {string} pakoDeflateJs - The pako deflate browser bundle.
 * @param {string} [mermaidJs] - If provided, inlines this drawio-mermaid bundle instead of loading it from CDN. Exposes `mxMermaidToDrawio.parseText(text, config)`; reads `globalThis.ELK` on init (loaded before it either way).
 * @param {object} [options] - Optional configuration.
 * @param {string} [options.viewerJs] - If provided, inlines this JS instead of loading viewer-static.min.js from CDN.
 * @param {string} [options.elkJs] - If provided, inlines this drawio-elk bundle instead of loading it from CDN. Defines `var ELK` (engine) plus `ElkLayout`/`ElkAdapter`/`ElkApplier` (the mxGraph bridge + postLayout facade), consumed by drawio-mermaid and the postLayout pass. Loaded before mermaid.
 * @param {string} [options.libavoidJs] - If provided (together with libavoidWasmB64), inlines this processed libavoid-js bundle (exports stripped, `globalThis.AvoidLib` aliased, loader patched to read `globalThis.__LIBAVOID_WASM_BINARY` — see processLibavoidBundle) with libavoid-routing.js (defines `globalThis.AvoidRouting`) appended, instead of loading the libavoid block from the CDN. Powers the `routing: "libavoid"` edge-routing pass.
 * @param {string} [options.libavoidWasmB64] - The libavoid.wasm binary, base64-encoded, for the inline case. Decoded to a Uint8Array and handed to the Emscripten module as `wasmBinary` so the router instantiates with no fetch.
 * @param {string[]} [options.libavoidUrls] - The four libavoid script URLs in load order (glue, wasm payload, loader, routing core), typically ETag-versioned (libavoid-versions.js) so a draw.io release busts the browser cache immediately. Defaults to the plain CDN URLs; ignored when libavoidJs/libavoidWasmB64 inline a local build.
 * @param {string} [options.buildId] - Build identifier (git SHA + timestamp). Exposed as window.__DRAWIO_BUILD in the iframe.
 * @returns {string} Self-contained HTML string.
 */
export function buildHtml(appWithDepsJs, pakoDeflateJs, mermaidJs, options)
{
  var viewerJs = (options && options.viewerJs) || null;
  var elkJs = (options && options.elkJs) || null;
  var libavoidJs = (options && options.libavoidJs) || null;
  var libavoidWasmB64 = (options && options.libavoidWasmB64) || null;
  var buildId = (options && options.buildId) || "unknown";

  // libavoid-js (WASM orthogonal edge router). The glue defines
  // globalThis.AvoidLib; the loader below decodes the base64 wasm to a
  // Uint8Array, hands it to the Emscripten module as wasmBinary (no fetch —
  // see processLibavoidBundle), and kicks off async instantiation. The
  // resulting promise is parked on window.__libavoidReady (resolving to the
  // Avoid namespace) so the routing pass can await it on demand; load runs
  // eagerly at page init so the wasm is usually warm by the time a
  // routing:"libavoid" diagram finishes rendering. Failures degrade
  // gracefully — applyRouting just skips and the diagram renders unrouted.
  var libavoidLoader =
    'function __libavoidB64ToBytes(b64)\n' +
    '{\n' +
    '  var bin = atob(b64);\n' +
    '  var bytes = new Uint8Array(bin.length);\n' +
    '  for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }\n' +
    '  return bytes;\n' +
    '}\n' +
    '(function()\n' +
    '{\n' +
    '  if (typeof AvoidLib === "undefined") { console.error("[libavoid] AvoidLib global missing"); return; }\n' +
    '  try { globalThis.__LIBAVOID_WASM_BINARY = __libavoidB64ToBytes(window.__LIBAVOID_WASM_B64); }\n' +
    '  catch (e) { console.error("[libavoid] base64 decode failed:", e); return; }\n' +
    '  window.__libavoidReady = AvoidLib.load().then(function()\n' +
    '  {\n' +
    '    window.Avoid = AvoidLib.getInstance();\n' +
    '    return window.Avoid;\n' +
    '  }).catch(function(e)\n' +
    '  {\n' +
    '    console.error("[libavoid] wasm load failed; routing disabled:", (e && e.message), e);\n' +
    '    return null;\n' +
    '  });\n' +
    '})();\n';

  // ETag-versioned URLs from the Node server (options.libavoidUrls, see
  // libavoid-versions.js) bust the CDN's 30-day browser cache exactly when a
  // draw.io release changes a file. The plain-URL default below applies only
  // when the option is omitted — the Worker build (build-html.js) and tests;
  // the Node server always passes the option (a failed version check
  // surfaces as plain URLs from libavoid-versions.js, not from this array).
  // Fixed order: glue -> wasm payload -> loader -> routing core.
  var libavoidSrcs = (options && options.libavoidUrls) || [
    'https://viewer.diagrams.net/js/libavoid-js/libavoid.min.js',
    'https://viewer.diagrams.net/js/libavoid-js/libavoid-wasm.js',
    'https://viewer.diagrams.net/js/libavoid-js/libavoid-loader.js',
    'https://viewer.diagrams.net/js/libavoid-js/libavoid-routing.js'
  ];

  var libavoidBlock = (libavoidJs && libavoidWasmB64)
    ? '<!-- libavoid-js (inlined WASM edge router). Defines globalThis.AvoidLib; the loader feeds the base64 wasm in as wasmBinary (no fetch). Powers the routing:"libavoid" pass. -->\n' +
      '    <script>' + libavoidJs + '</script>\n' +
      '    <script>\n' +
      '      window.__LIBAVOID_WASM_B64 = "' + libavoidWasmB64 + '";\n' +
      '      ' + libavoidLoader +
      '    </script>'
    : '<!-- libavoid-js (WASM edge router) + shared routing core from the viewer.diagrams.net CDN,\n' +
      '         like drawio-elk/drawio-mermaid: cached cross-session, version-synced with each draw.io\n' +
      '         release, and byte-identical to what the draw.io editor bundles. The wasm rides as\n' +
      '         base64 inside libavoid-wasm.js; libavoid-loader.js decodes it and parks\n' +
      '         window.__libavoidReady — still no fetch, so the sandbox CSP is satisfied by plain\n' +
      '         script-src. Fixed order: glue -> wasm payload -> loader -> routing core. -->\n' +
      libavoidSrcs.map(function(u)
      {
        return '    <script src="' + u + '"></script>';
      }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no" />
    <title>draw.io Diagram</title>
    <link rel="icon" href="https://app.diagrams.net/favicon.png" type="image/png" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }

      html {
        color-scheme: light dark;
        overflow: hidden;
      }

      :root {
        /* Card background + border (subtle on either theme). The
           values are picked to feel like a quiet "page within the
           page", not to compete with the chat surface. */
        --viewer-card-bg: #f8f8f7;
        --viewer-card-border: rgba(0, 0, 0, 0.08);
        --viewer-card-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        --viewer-btn-fg: #1a1a1a;
        --viewer-btn-border: rgba(0, 0, 0, 0.14);
        --viewer-btn-border-hover: rgba(0, 0, 0, 0.28);
        --viewer-btn-bg-hover: rgba(0, 0, 0, 0.06);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --viewer-card-bg: #1f1f1f;
          --viewer-card-border: rgba(255, 255, 255, 0.08);
          --viewer-card-shadow: none;
          /* Toolbar text/border in dark mode — the host doesn't always
             set --color-text-primary, so the previous fallback (#1a1a1a
             on a dark page) made the buttons nearly invisible. */
          --viewer-btn-fg: #e6e6e6;
          --viewer-btn-border: rgba(255, 255, 255, 0.18);
          --viewer-btn-border-hover: rgba(255, 255, 255, 0.32);
          --viewer-btn-bg-hover: rgba(255, 255, 255, 0.08);
        }
      }
      body {
        font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
        overflow: hidden;
        /* Small page margin so the card has breathing room from the
           iframe edge. notifySize() reports document.documentElement
           scrollHeight which includes this padding, so the iframe
           grows to match. */
        padding: 8px;
      }

      #loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        font-size: 14px;
        color: var(--color-text-secondary, #666);
      }

      .spinner {
        width: 20px; height: 20px;
        border: 2px solid var(--color-border, #e0e0e0);
        border-top-color: var(--color-text-primary, #1a1a1a);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-right: 8px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      #diagram-container {
        display: none;
        min-width: 200px;
        max-width: 100%;
        overflow: hidden;
        /* Rounded card around the diagram. The visible chat-page
           background shows in body padding outside this rectangle. */
        background: var(--viewer-card-bg);
        border: 1px solid var(--viewer-card-border);
        border-radius: 12px;
        box-shadow: var(--viewer-card-shadow);
      }
      #diagram-container.streaming {
        min-height: 320px;
        /* Hard cap (inline mode only) so the iframe never grows past
           the chat viewport. The host (Claude.ai) only honors
           sendSizeChanged growth, not shrinks — conservative start.
           Fullscreen overrides this below. The toolbar Expand button
           swaps --inline-max-h via body.expanded for diagrams where
           480 px clips a tall diagram. */
        max-height: var(--inline-max-h, 480px);
        position: relative;
      }
      body.expanded {
        --inline-max-h: 1000px;
      }
      /* In fullscreen, the iframe IS the viewport (with body padding
         reserved for the prompt overlay), so let the streaming card
         fill all the available height instead of clipping at 480 px. */
      body.fullscreen #diagram-container.streaming {
        max-height: none;
      }
      /* Expand and fullscreen are mutually exclusive — fullscreen
         already gives full vertical real estate, so hide expand there. */
      body.fullscreen #expand-btn {
        display: none !important;
      }
      /* In fullscreen we want the diagram surface to go edge-to-edge:
         no card inset, no border, no rounded corners. Otherwise dragging
         past the container boundary clips against the visible card edge
         with a strip of body background showing around it. */
      body.fullscreen {
        padding: 0;
      }
      body.fullscreen #diagram-container {
        border: none;
        border-radius: 0;
        box-shadow: none;
      }
      #diagram-container.streaming > div {
        width: 100% !important;
        height: 100% !important;
        overflow: hidden !important;
      }
      /* Custom viewer mode: mouse-drag pans, wheel + ctrl-wheel zooms.
         Touch: 1-finger pan in fullscreen, 2-finger pinch+pan in either
         mode. touch-action: pan-y in inline lets a 1-finger swipe reach
         the chat scroller while telling the browser it cannot claim
         pinch for page zoom — without this, iOS WebKit intercepts the
         second touchpoint mid-gesture and fires touchcancel on us.
         user-select disabled so a pan-drag doesn't leave a text-
         selection trail behind. */
      #diagram-container.custom-viewer {
        cursor: grab;
        user-select: none;
        -webkit-user-select: none;
        touch-action: pan-y;
      }
      body.fullscreen #diagram-container.custom-viewer {
        touch-action: none;
      }
      #diagram-container.custom-viewer.dragging { cursor: grabbing; }
      /* When the user pans or zooms past the original SVG bbox, the
         CSS transform paints content outside the SVG's intrinsic box
         and outside the .mxgraph wrappers — the default overflow:hidden
         on those wrappers (set above to suppress horizontal scrollbars
         on oversized SVGs) clips the visible result and gives the
         truncated cell labels visible on mobile pan. Same trick as
         .morph-active: loosen overflow everywhere inside, but keep
         #diagram-container itself clipping so spillover doesn't bleed
         past the card edge. */
      #diagram-container.custom-viewer * {
        overflow: visible !important;
        max-width: none !important;
      }
      /* GraphViewer sets inline width on its wrappers based on the
         diagram's natural width, which can exceed the iframe width and
         create a horizontal scrollbar between the SVG and the toolbar.
         !important + descendant rules force everything to fit. */
      #diagram-container .mxgraph,
      #diagram-container .mxgraph > div,
      #diagram-container .mxgraph > div > div {
        max-width: 100% !important;
        overflow: hidden !important;
      }
      #diagram-container .mxgraph {
        width: 100% !important;
        color-scheme: light dark !important;
      }
      #diagram-container .mxgraph > svg,
      #diagram-container .mxgraph svg {
        max-width: 100% !important;
        height: auto;
      }
      /* During a layout-change mxMorphing, cells animate from old to
         new positions. The SVG element + its wrappers were sized for
         the OLD bbox, so cells passing through positions outside that
         box get clipped until the post-morph sizeDidChange/camera fit
         catches up. Blanket-override overflow + max-width on every
         descendant of #diagram-container so we don't miss a wrapper
         level — the outer #diagram-container itself keeps its
         overflow: hidden so spillover is still clipped to the card
         edge. */
      #diagram-container.morph-active * {
        overflow: visible !important;
        max-width: none !important;
      }

      #toolbar {
        display: none;
        padding: 8px;
        gap: 6px;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.28s ease-out, transform 0.28s ease-out;
      }
      #toolbar.shown {
        opacity: 1;
        transform: translateY(0);
      }
      #toolbar button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 0 12px;
        height: 30px;
        font-size: 12px;
        font-family: inherit;
        color: var(--color-text-primary, var(--viewer-btn-fg));
        border: 1px solid var(--color-border, var(--viewer-btn-border));
        border-radius: 6px;
        background: transparent;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease,
                    color 0.15s ease, transform 0.08s ease;
      }
      #toolbar button:hover {
        background: var(--color-bg-hover, var(--viewer-btn-bg-hover));
        border-color: var(--color-border-hover, var(--viewer-btn-border-hover));
      }
      #toolbar button:active { transform: translateY(1px); }
      #toolbar button.icon-only {
        width: 30px;
        padding: 0;
      }
      #toolbar svg {
        width: 16px;
        height: 16px;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
        fill: none;
        flex-shrink: 0;
      }

      #error {
        display: none;
        padding: 16px; margin: 16px;
        border: 1px solid #e74c3c;
        border-radius: 8px;
        background: #fdf0ef;
        color: #c0392b;
        font-size: 13px;
      }

      #mermaid-preview {
        display: none;
        padding: 16px;
        font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
        font-size: 13px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        overflow-y: auto;
        max-height: 500px;
        background: var(--color-bg-secondary, #f5f5f5);
        border-radius: 8px;
        margin: 8px;
        color: var(--color-text-primary, #1a1a1a);
      }
    </style>
    <script>
      window.__DRAWIO_BUILD = ${JSON.stringify(buildId)};
    </script>
  </head>
  <body>
    <div id="loading"><div class="spinner"></div>Creating diagram...</div>
    <div id="error"></div>
    <pre id="mermaid-preview"></pre>
    <div id="diagram-container"></div>
    <div id="toolbar">
      <button id="zoom-out-btn" class="icon-only" style="display:none" title="Zoom out" aria-label="Zoom out">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="12" x2="18" y2="12"/></svg>
      </button>
      <button id="zoom-in-btn" class="icon-only" style="display:none" title="Zoom in" aria-label="Zoom in">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="6" x2="12" y2="18"/><line x1="6" y1="12" x2="18" y2="12"/></svg>
      </button>
      <button id="zoom-fit-btn" class="icon-only" style="display:none" title="Zoom in" aria-label="Zoom in">
        <svg id="zoom-fit-icon-zoomin" viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="17" text-anchor="middle" font-family="-apple-system,system-ui,Segoe UI,sans-serif" font-size="13" font-weight="700" fill="currentColor" stroke="none">1:1</text></svg>
        <svg id="zoom-fit-icon-fit" viewBox="0 0 24 24" aria-hidden="true" style="display:none"><polyline points="4 8 4 4 8 4"/><polyline points="16 4 20 4 20 8"/><polyline points="4 16 4 20 8 20"/><polyline points="16 20 20 20 20 16"/><rect x="8" y="9" width="8" height="6" rx="1"/></svg>
      </button>
      <button id="open-drawio" title="Open this diagram in draw.io to edit" aria-label="Open in draw.io">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M10 14L20 4"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/></svg>
        <span>Open in draw.io</span>
      </button>
      <button id="copy-xml-btn" title="Copy diagram XML to clipboard" aria-label="Copy XML">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <span id="copy-xml-label">Copy</span>
      </button>
      <button id="fullscreen-btn" class="icon-only" title="Toggle fullscreen" aria-label="Toggle fullscreen">
        <svg id="fs-icon-enter" viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 8 4 4 8 4"/><polyline points="16 4 20 4 20 8"/><polyline points="20 16 20 20 16 20"/><polyline points="8 20 4 20 4 16"/></svg>
        <svg id="fs-icon-exit" viewBox="0 0 24 24" aria-hidden="true" style="display:none"><polyline points="8 4 8 8 4 8"/><polyline points="16 4 16 8 20 8"/><polyline points="20 16 16 16 16 20"/><polyline points="4 16 8 16 8 20"/></svg>
      </button>
      <button id="expand-btn" class="icon-only" style="display:none" title="Expand vertically" aria-label="Expand vertically">
        <svg id="expand-icon-expand" viewBox="0 0 24 24" aria-hidden="true">
          <polyline points="8 7 12 3 16 7"/>
          <line x1="12" y1="3" x2="12" y2="11"/>
          <polyline points="8 17 12 21 16 17"/>
          <line x1="12" y1="13" x2="12" y2="21"/>
        </svg>
        <svg id="expand-icon-collapse" viewBox="0 0 24 24" aria-hidden="true" style="display:none">
          <polyline points="8 3 12 7 16 3"/>
          <line x1="12" y1="7" x2="12" y2="11"/>
          <polyline points="8 21 12 17 16 21"/>
          <line x1="12" y1="13" x2="12" y2="17"/>
        </svg>
      </button>
      <button id="layout-btn" class="icon-only" style="display:none" title="Layout: as authored" aria-label="Cycle layout">
        <svg id="layout-icon-none" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="3" width="6" height="4" rx="1"/>
          <rect x="13" y="6" width="6" height="4" rx="1"/>
          <rect x="5" y="13" width="6" height="4" rx="1"/>
          <rect x="15" y="16" width="5" height="4" rx="1"/>
        </svg>
        <svg id="layout-icon-horizontal" viewBox="0 0 24 24" aria-hidden="true" style="display:none">
          <rect x="2" y="9" width="5" height="6" rx="1"/>
          <rect x="9.5" y="9" width="5" height="6" rx="1"/>
          <rect x="17" y="9" width="5" height="6" rx="1"/>
          <line x1="7" y1="12" x2="9.5" y2="12"/>
          <line x1="14.5" y1="12" x2="17" y2="12"/>
        </svg>
        <svg id="layout-icon-vertical" viewBox="0 0 24 24" aria-hidden="true" style="display:none">
          <rect x="9" y="2" width="6" height="5" rx="1"/>
          <rect x="9" y="9.5" width="6" height="5" rx="1"/>
          <rect x="9" y="17" width="6" height="5" rx="1"/>
          <line x1="12" y1="7" x2="12" y2="9.5"/>
          <line x1="12" y1="14.5" x2="12" y2="17"/>
        </svg>
      </button>
      <button id="help-btn" class="icon-only" title="Viewer help" aria-label="Viewer help">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1.1-1 1.7v.5"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>
      </button>
    </div>

    <!-- draw.io viewer -->
    <script>window.DRAWIO_BASE_URL = "https://app.diagrams.net";<\/script>
    ${viewerJs
      ? '<script>' + viewerJs + '<\/script>'
      : '<script src="https://viewer.diagrams.net/js/viewer-static.min.js"><\/script>'
    }

    <!-- pako deflate (inlined, for #create URL generation) -->
    <script>${pakoDeflateJs}</script>

    <!-- drawio-elk. Defines var ELK + ElkLayout/ElkAdapter/ElkApplier (engine + mxGraph bridge), consumed by drawio-mermaid and the postLayout pass. Must come before drawio-mermaid. -->
    ${elkJs
      ? '<script>' + elkJs + '<\/script>'
      : '<script src="https://viewer.diagrams.net/js/elk/drawio-elk.min.js"><\/script>'
    }

    ${libavoidBlock}

    <!-- drawio-mermaid (inlined). Exposes mxMermaidToDrawio.parseText(text, config).
         Loaded after the viewer so mermaidShapes.js can see mxCellRenderer/mxActor,
         and after drawio-elk so it can read globalThis.ELK on init. -->
    <script>
      // mxMermaidToDrawio.parseText() reads EditorUi.prototype.emptyDiagramXml
      // as a fallback when a diagram type isn't supported. Stub it defensively
      // — the real value comes from the viewer, but parseText can be called
      // before that's wired up in some error paths.
      if (typeof EditorUi !== 'undefined' && EditorUi.prototype.emptyDiagramXml == null)
      {
        EditorUi.prototype.emptyDiagramXml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
      }
    </script>
    ${mermaidJs
      ? '<script>' + mermaidJs + '<\/script>'
      : '<script src="https://viewer.diagrams.net/js/mermaid/drawio-mermaid.min.js"><\/script>'
    }

    <!-- MCP Apps SDK (inlined, exports stripped, App alias added) -->
    <script>
${appWithDepsJs}
${normalizeDiagramXml.toString()}

// --- XML healing for partial/streaming XML ---

/**
 * Heals a truncated XML string so it can be parsed. Removes incomplete
 * tags at the end and closes any open container tags.
 *
 * @param {string} partialXml - Potentially truncated XML string.
 * @returns {string|null} - Valid XML string, or null if too incomplete.
 */
function healPartialXml(partialXml)
{
  if (partialXml == null || typeof partialXml !== 'string')
  {
    return null;
  }

  // Must have at least <mxGraphModel and <root to be useful
  if (partialXml.indexOf('<root') === -1)
  {
    return null;
  }

  // Truncate at the last complete '>' to remove any half-written tag
  var lastClose = partialXml.lastIndexOf('>');

  if (lastClose === -1)
  {
    return null;
  }

  var xml = partialXml.substring(0, lastClose + 1);

  // Strip XML comments to avoid confusing the tag scanner.
  // Comments may span multiple lines and contain '<' or '>'.
  // Also remove any incomplete comment at the end (opened but not closed).
  var stripped = xml.replace(/<!--[\\s\\S]*?-->/g, '').replace(/<!--[\\s\\S]*$/, '');

  // Track open tags using a simple stack-based approach.
  // We scan for opening and closing tags, ignoring self-closing ones.
  var tagStack = [];
  var tagRegex = new RegExp('\\x3c(\\/?[a-zA-Z][a-zA-Z0-9]*)[^>]*?(\\/?)\x3e', 'g');
  var match;

  while ((match = tagRegex.exec(stripped)) !== null)
  {
    var nameOrClose = match[1];
    var selfClose = match[2];

    // Skip processing instructions (<?xml ...?>)
    if (match[0].charAt(1) === '?')
    {
      continue;
    }

    if (selfClose === '/')
    {
      // Self-closing tag, ignore
      continue;
    }

    if (nameOrClose.charAt(0) === '/')
    {
      // Closing tag - pop from stack if matching
      var closeName = nameOrClose.substring(1);

      if (tagStack.length > 0 && tagStack[tagStack.length - 1] === closeName)
      {
        tagStack.pop();
      }
    }
    else
    {
      // Opening tag
      tagStack.push(nameOrClose);
    }
  }

  // Close all remaining open tags in reverse order
  for (var i = tagStack.length - 1; i >= 0; i--)
  {
    xml += '</' + tagStack[i] + '>';
  }

  return xml;
}

// --- Mermaid streaming: heal partial text + content-address cell IDs ---

// De-dupe: last healed+parsed text we merged. Reset on endStreaming.
var lastMergedMermaidText = null;

/**
 * Keeps only cell IDs whose parent is the default root ('1') — i.e.,
 * top-level cells, not nested children. Used to skip per-cell pop
 * animations on nested structures (ER table rows, flowchart subgraph
 * contents) so pops happen at the container level only.
 */
function filterTopLevelCellIds(graph, ids)
{
  if (graph == null || ids == null) return [];
  var model = graph.getModel();
  var out = [];

  for (var i = 0; i < ids.length; i++)
  {
    var cell = model.getCell(ids[i]);
    if (cell == null) continue;
    var p = cell.parent;
    if (p == null) continue;
    if (p.id === '1') out.push(ids[i]);
  }

  return out;
}

/**
 * Keeps only IDs whose cell is a vertex. Used to feed the smart-camera
 * focus tracker — edges can span the full diagram and would bloat the
 * "hot region" bbox, defeating the close-up focus on new content.
 */
function filterVertexCellIds(graph, ids)
{
  if (graph == null || ids == null) return [];
  var model = graph.getModel();
  var out = [];

  for (var i = 0; i < ids.length; i++)
  {
    var cell = model.getCell(ids[i]);
    if (cell != null && cell.vertex) out.push(ids[i]);
  }

  return out;
}

/**
 * Returns true for cells that are visual frames / containers
 * (swimlane, group, container=1) rather than content. We exclude these
 * from the smart-camera focus queue: a swimlane often spans the whole
 * page, so tracking it forces fit-whole and prevents the camera from
 * focusing on the actual content cells being inserted inside it.
 */
function isContainerVertex(cell)
{
  if (cell == null || !cell.vertex) return false;
  // A vertex with children is a container right now, no matter what
  // the style says.
  if (cell.children != null && cell.children.length > 0) return true;
  var s = cell.style || '';
  if (typeof s !== 'string') return false;
  // Generic drawio container marker
  if (s.indexOf('container=1') >= 0) return true;
  // Bare shape token: "swimlane;..." or "...;group;..."
  if (/(?:^|;)\\s*(?:swimlane|group)\\s*(?:;|$)/.test(s)) return true;
  // shape=anything-with-group / anything-with-swimlane: catches AWS
  // group shapes (mxgraph.aws4.group, mxgraph.aws4.groupCenter, …)
  // that don't carry container=1 explicitly.
  if (/(?:^|;)\\s*shape\\s*=\\s*[^;]*(?:group|swimlane)/i.test(s)) return true;
  return false;
}

/**
 * Like filterVertexCellIds, but for edges substitutes their source +
 * target vertex IDs. Used by the XML streaming path so that an edge
 * arriving in its own partial (after the connected vertices have aged
 * out of recentVertexQueue) still focuses the camera on the endpoints
 * being connected, instead of falling back to fit-whole zoom-out.
 *
 * Mermaid doesn't need this: a mermaid partial delivers vertices and
 * edges together, so the vertices are already tracked when the edges
 * land.
 */
function expandEdgesToEndpointVertexIds(graph, ids)
{
  if (graph == null || ids == null) return [];
  var model = graph.getModel();
  var out = [];
  var seen = {};

  for (var i = 0; i < ids.length; i++)
  {
    var cell = model.getCell(ids[i]);
    if (cell == null) continue;

    if (cell.vertex)
    {
      if (!seen[ids[i]])
      {
        seen[ids[i]] = true;
        out.push(ids[i]);
      }
    }
    else if (cell.edge)
    {
      var src = cell.source;
      var tgt = cell.target;

      if (src != null && src.id != null && src.vertex && !seen[src.id])
      {
        seen[src.id] = true;
        out.push(src.id);
      }

      if (tgt != null && tgt.id != null && tgt.vertex && !seen[tgt.id])
      {
        seen[tgt.id] = true;
        out.push(tgt.id);
      }
    }
  }

  return out;
}

/**
 * Decide how the smart camera should focus based on what just landed
 * in this XML partial. Vertex-only partials append to recentVertexQueue
 * (preserves the soft-follow accumulation that lets the camera ease
 * across multiple incremental vertex partials). Partials that contain
 * any edge replace the queue with the new content's vertices + edge
 * endpoints, so the camera tightly tracks the edge being inserted
 * instead of holding a wide bbox dragged over from older vertices.
 */
function trackPartialFocus(graph, topNewIds)
{
  if (graph == null || topNewIds == null || topNewIds.length === 0)
  {
    return;
  }

  streamMode = 'xml';
  var model = graph.getModel();
  var vertexCount = 0;
  var edgeCount = 0;
  var otherCount = 0;
  var newVertexIds = [];
  var newEdgeIds = [];
  var filteredTopNew = [];

  for (var i = 0; i < topNewIds.length; i++)
  {
    var c = model.getCell(topNewIds[i]);
    if (c == null) { otherCount++; continue; }

    if (c.vertex)
    {
      // Containers are admitted to the queue: filterRecentAncestors
      // demotes them the moment a descendant joins, so a container's
      // bbox only contributes during the brief "new region" window
      // before its children stream in — exactly the widen we want.
      vertexCount++;
      newVertexIds.push(topNewIds[i]);
      filteredTopNew.push(topNewIds[i]);
    }
    else if (c.edge)
    {
      edgeCount++;
      newEdgeIds.push(topNewIds[i]);
      filteredTopNew.push(topNewIds[i]);
    }
    else
    {
      otherCount++;
    }
  }

  var ids = expandEdgesToEndpointVertexIds(graph, filteredTopNew);

  if (ids.length === 0)
  {
    return;
  }

  if (edgeCount > 0)
  {
    replaceRecentCells(ids);
  }
  else
  {
    trackRecentCells(ids);
  }
}

/**
 * Trims a partial mermaid string so the parser doesn't choke on a
 * half-typed last line. Returns null when there isn't enough content
 * to attempt a parse yet (no complete line, or no body after the type
 * declaration).
 *
 * @param {string} partialText
 * @returns {string|null}
 */
function healMermaidText(partialText)
{
  if (partialText == null || typeof partialText !== 'string') return null;

  var lastNewline = partialText.lastIndexOf('\\n');
  if (lastNewline < 0) return null; // single line, possibly incomplete

  var trimmed = partialText.substring(0, lastNewline);
  // Need at least a type declaration and one body line — i.e. another newline
  // somewhere in the trimmed prefix.
  if (trimmed.indexOf('\\n') < 0) return null;

  return trimmed;
}

/**
 * Returns the first significant Mermaid line — the diagram-type
 * directive (e.g. "flowchart TD") — with blank lines, %% comments, and
 * any leading "--- ... ---" frontmatter block skipped. Returns null if
 * no such line exists.
 */
function firstMermaidDirectiveLine(text)
{
  if (text == null || typeof text !== 'string') return null;
  var lines = text.split(/\\r?\\n/);
  var inFrontmatter = false;
  var sawOpener = false;
  for (var i = 0; i < lines.length; i++)
  {
    var line = lines[i].trim();
    if (line === '' || line.indexOf('%%') === 0) continue;
    if (inFrontmatter)
    {
      if (line === '---') inFrontmatter = false;
      continue;
    }
    if (!sawOpener && line === '---')
    {
      inFrontmatter = true;
      sawOpener = true;
      continue;
    }
    return line;
  }
  return null;
}

/**
 * Returns true if the Mermaid text declares a flowchart (or its legacy
 * "graph" synonym). Used to surface the layout-cycle button on
 * flowcharts even when the LLM didn't request a postLayout — they're
 * the diagram type that benefits most from re-layout.
 */
function isMermaidFlowchart(text)
{
  var line = firstMermaidDirectiveLine(text);
  if (line == null) return false;
  var first = line.split(/\\s+/)[0];
  return first === 'flowchart' || first === 'graph';
}

/**
 * Returns true if the Mermaid text is a flowchart/graph declared with a
 * horizontal orientation (LR or RL). Used to decide whether the layout
 * button's alternative state should be horizontal flow or vertical flow.
 */
function isMermaidHorizontalFlowchart(text)
{
  var line = firstMermaidDirectiveLine(text);
  if (line == null) return false;
  var parts = line.split(/\\s+/);
  var first = parts[0];
  if (first !== 'flowchart' && first !== 'graph') return false;
  var orient = (parts[1] || '').toUpperCase();
  return orient === 'LR' || orient === 'RL';
}

/**
 * Translates the public postLayout value (+ optional direction) into the
 * internal layered-flow algorithm string. The only supported value is "elk"
 * (ELK layered flow); its direction is, for Mermaid, taken from the flowchart
 * code (TD/TB vs LR/RL) so the on-screen layout always matches what the
 * round-trip ELK directive reproduces; for XML it comes from the optional
 * direction field (default vertical, since XML carries no inherent direction).
 * Returns null when postLayout is anything else (including unset).
 *
 * @param {string|null} postLayout  - "elk" (or null)
 * @param {string|null} direction   - "vertical" | "horizontal" (XML only)
 * @param {string|null} mermaidText - the Mermaid source, or null for XML
 */
function resolvePostLayout(postLayout, direction, mermaidText)
{
  if (postLayout !== 'elk') return null;

  var horizontal = (mermaidText != null)
    ? isMermaidHorizontalFlowchart(mermaidText)
    : (direction === 'horizontal');
  return horizontal ? 'horizontalFlow' : 'verticalFlow';
}

/**
 * 32-bit FNV-1a hash, hex string. Stable across runs and across browsers.
 * Used to derive content-addressed cell IDs.
 */
function hashString32(s)
{
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++)
  {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

/**
 * Rewrites every cell ID in a mermaid-emitted mxGraphModel XML string to
 * a deterministic content-addressed value, so prefix re-parses produce
 * stable IDs for shared cells. Internal ID references (parent, source,
 * target) are rewritten consistently.
 *
 * The hash key for each cell is built from properties that don't change
 * across prefix parses: parent's stable ID, value, style, and (for edges)
 * the source/target stable IDs. Collisions on identical content are
 * disambiguated with a #1, #2, ... suffix preserved by document order.
 *
 * Roots '0' and '1' are passed through verbatim — streamInsertCell
 * special-cases them.
 *
 * @param {string} xml - mxGraphModel XML returned by mxMermaidToDrawio.parseText
 * @returns {string} XML with stabilized IDs (or the original on error)
 */
function stabilizeMermaidIds(xml)
{
  if (xml == null || typeof xml !== 'string') return xml;
  if (typeof mxUtils === 'undefined' || typeof mxUtils.parseXml !== 'function') return xml;

  var doc;
  try { doc = mxUtils.parseXml(xml); }
  catch (e) { return xml; }

  var top = doc.documentElement;
  var rootEl = null;

  if (top.nodeName === 'root') rootEl = top;
  else if (top.nodeName === 'mxGraphModel')
  {
    var rs = top.getElementsByTagName('root');
    if (rs.length > 0) rootEl = rs[0];
  }

  if (rootEl == null) return xml;

  var idMap = { '0': '0', '1': '1' };
  var collisionCount = {};

  function makeStableId(prefix, contentKey)
  {
    var base = prefix + '_' + hashString32(contentKey);
    var n = collisionCount[base];

    if (n == null)
    {
      collisionCount[base] = 0;
      return base;
    }

    n += 1;
    collisionCount[base] = n;
    return base + '_' + n;
  }

  var children = rootEl.childNodes;

  // Resolve the (carrier, attrSrc) pair for a child node. UserObject /
  // object wrappers carry the id and label externally and everything
  // else on an inner <mxCell>; plain <mxCell> cells carry both on
  // themselves.
  function pair(node)
  {
    var inner = null;

    if (node.nodeName === 'UserObject' || node.nodeName === 'object')
    {
      var innerCells = node.getElementsByTagName('mxCell');
      if (innerCells.length > 0) inner = innerCells[0];
    }

    return { carrier: node, attrSrc: (inner != null) ? inner : node };
  }

  // Mirrors Graph.convertValueToString at the XML level: UserObject
  // wrappers store the label as the carrier's 'label' attribute; plain
  // mxCells store it as the 'value' attribute. Reading the wrong one
  // (the previous default to 'value' on every node) collapsed every
  // wrapped cell to the empty string and made the content hash
  // worthless for de-duping across re-parses.
  function nodeLabel(p)
  {
    if (p.carrier !== p.attrSrc)
    {
      return p.carrier.getAttribute('label') || '';
    }
    return p.carrier.getAttribute('value') || '';
  }

  // Two-pass rename. The gitgraph cell factory (and possibly others in
  // the future) re-orders cells after creation so edges can land before
  // the vertices they reference in document order. A single-pass rename
  // that processes cells in document order would hit each edge with an
  // empty idMap and silently skip the source/target rewrite, orphaning
  // the edge. Pass 1 populates idMap for every non-edge cell so pass 2
  // can always resolve source/target stable IDs — and so the edge's own
  // content key (which incorporates the stable source/target) remains
  // deterministic regardless of sibling order.
  for (var i = 0; i < children.length; i++)
  {
    var node = children[i];
    if (node.nodeType !== 1) continue;

    var p = pair(node);
    var oldId = p.carrier.getAttribute('id');

    if (oldId == null || oldId === '0' || oldId === '1') continue;
    if (p.attrSrc.getAttribute('edge') === '1') continue;

    var value = nodeLabel(p);
    var isVertex = p.attrSrc.getAttribute('vertex') === '1';
    var parentId = p.attrSrc.getAttribute('parent');

    var stableParent = (parentId != null && idMap[parentId] != null)
      ? idMap[parentId] : (parentId || '1');

    // NB: 'style' is intentionally NOT in the content key — mermaid
    // mutates a cell's style as more context arrives (classDef applied
    // later, theme adjustments) which would otherwise re-hash the cell
    // to a new ID and orphan the original in the model. Style changes
    // are still applied on each merge via the existing-cell update path.
    idMap[oldId] = makeStableId(isVertex ? 'v' : 'c', stableParent + '|' + value);
  }

  // Pass 2: rewrite IDs and references. Edges now see a complete idMap
  // and get deterministic source/target-derived content keys.
  for (var i = 0; i < children.length; i++)
  {
    var node = children[i];
    if (node.nodeType !== 1) continue;

    var p = pair(node);
    var oldId = p.carrier.getAttribute('id');

    if (oldId == null || oldId === '0' || oldId === '1') continue;

    var parentId = p.attrSrc.getAttribute('parent');
    var sourceId = p.attrSrc.getAttribute('source');
    var targetId = p.attrSrc.getAttribute('target');
    var isEdge = p.attrSrc.getAttribute('edge') === '1';

    var stableParent = (parentId != null && idMap[parentId] != null)
      ? idMap[parentId] : (parentId || '1');

    if (isEdge)
    {
      var value = nodeLabel(p);
      var stableSrc = (sourceId != null && idMap[sourceId] != null) ? idMap[sourceId] : (sourceId || '');
      var stableTgt = (targetId != null && idMap[targetId] != null) ? idMap[targetId] : (targetId || '');
      idMap[oldId] = makeStableId('e', stableSrc + '|' + stableTgt + '|' + value);
    }

    p.carrier.setAttribute('id', idMap[oldId]);

    if (parentId != null) p.attrSrc.setAttribute('parent', stableParent);
    if (sourceId != null && idMap[sourceId] != null) p.attrSrc.setAttribute('source', idMap[sourceId]);
    if (targetId != null && idMap[targetId] != null) p.attrSrc.setAttribute('target', idMap[targetId]);
  }

  return mxUtils.getXml(top);
}

// --- Client-side app logic ---

const loadingEl  = document.getElementById("loading");
const errorEl    = document.getElementById("error");
const containerEl = document.getElementById("diagram-container");
const toolbarEl  = document.getElementById("toolbar");
const mermaidPreviewEl = document.getElementById("mermaid-preview");
const openDrawioBtn  = document.getElementById("open-drawio");
const fullscreenBtn  = document.getElementById("fullscreen-btn");
const copyXmlBtn     = document.getElementById("copy-xml-btn");
const layoutBtn      = document.getElementById("layout-btn");
var drawioEditUrl = null;
var currentXml = null;
// Mermaid source backing the current diagram (null for plain-XML diagrams).
// Set whenever a Mermaid conversion runs; consumed by commitDiagramXml to
// wrap the export XML so the source round-trips when reopened in the editor.
var currentMermaidText = null;
var invalidDiagramXmlMessage = ${JSON.stringify(INVALID_DIAGRAM_XML_MESSAGE)};

// --- State ---
var streamingInitialized = false;
var customViewerInteractive = false;
// dblclick toggle: alternates between "zoomed in toward last cursor"
// and "fit-whole". Reset by the Fit toolbar button so the state stays
// in sync with what the user sees on screen.
var dblclickZoomedIn = false;
// Tracks the host's current display mode ("inline" | "fullscreen" | "pip").
// Updated from hostContext on connect and on host-context-changed events.
// Wheel/pinch behave differently per mode: in inline, plain wheel falls
// through to the chat so the page can scroll; in fullscreen we own the
// surface so wheel zooms the diagram directly.
var currentDisplayMode = 'inline';

var app = new App({ name: "draw.io Diagram Viewer", version: "1.0.0" });

/**
 * Apply layout adjustments for the current display mode. In fullscreen
 * we reserve bottom space for the host's chat input overlay (Claude.ai
 * floats its prompt box over the iframe). Uses safeAreaInsets.bottom if
 * the host provides it, otherwise an 80 px fallback that clears the
 * Claude.ai composer at typical zoom levels.
 */
function applyDisplayModeLayout()
{
  var ctx = (app.getHostContext != null) ? app.getHostContext() : null;
  var newMode = (ctx != null && ctx.displayMode) || 'inline';
  // Detect mode transitions BEFORE writing currentDisplayMode so the
  // fit/reset block below knows whether this hostcontextchanged was a
  // real inline↔fullscreen transition or just an inset/viewport tweak
  // (Claude.ai fires hostcontextchanged on scroll as safeAreaInsets
  // shift around its prompt overlay — without this guard the camera
  // would re-fit and dblclickZoomedIn would reset on every wheel tick).
  var modeChanged = (newMode !== currentDisplayMode);
  currentDisplayMode = newMode;

  var insetBottom = 0;
  if (ctx != null && ctx.safeAreaInsets && typeof ctx.safeAreaInsets.bottom === 'number')
  {
    insetBottom = ctx.safeAreaInsets.bottom;
  }

  var fsEnter = document.getElementById('fs-icon-enter');
  var fsExit = document.getElementById('fs-icon-exit');

  if (currentDisplayMode === 'fullscreen')
  {
    var pad = Math.max(insetBottom, 80);
    document.body.style.paddingBottom = pad + 'px';
    document.body.style.boxSizing = 'border-box';
    document.body.classList.add('fullscreen');
    if (fsEnter != null) fsEnter.style.display = 'none';
    if (fsExit != null) fsExit.style.display = '';
    fullscreenBtn.setAttribute('title', 'Exit fullscreen');
    fullscreenBtn.setAttribute('aria-label', 'Exit fullscreen');
  }
  else
  {
    document.body.style.paddingBottom = '';
    document.body.style.boxSizing = '';
    document.body.classList.remove('fullscreen');
    if (fsEnter != null) fsEnter.style.display = '';
    if (fsExit != null) fsExit.style.display = 'none';
    fullscreenBtn.setAttribute('title', 'Toggle fullscreen');
    fullscreenBtn.setAttribute('aria-label', 'Toggle fullscreen');
  }

  // Re-fit the camera + reset dblclick state ONLY on a real mode
  // transition. Otherwise the user's manual zoom/pan would be wiped
  // by every host-context update (scroll, inset shifts, etc.).
  // Snap-fit (immediate=true) — user-initiated mode change should
  // feel instant, not animated.
  if (modeChanged)
  {
    if (streamGraph != null) streamFollowNewCells(streamGraph, true);
    dblclickZoomedIn = false;
    updateZoomFitButtonUi();
  }
}

/**
 * Live-measure everything that sits outside the diagram container in
 * the iframe document: body padding (top + bottom — bumped in
 * fullscreen for the prompt-overlay pad), the toolbar (when shown via
 * display:flex; offsetHeight is 0 while it's display:none), and the
 * container's vertical border. Reading offsetHeight forces a reflow
 * so this is accurate even immediately after toggling display.
 */
function measureChrome()
{
  var bodyStyle = window.getComputedStyle(document.body);
  var bodyPad = parseFloat(bodyStyle.paddingTop) +
                parseFloat(bodyStyle.paddingBottom);

  var tbH = (toolbarEl != null) ? toolbarEl.offsetHeight : 0;

  var contStyle = window.getComputedStyle(containerEl);
  var contBorder = parseFloat(contStyle.borderTopWidth) +
                   parseFloat(contStyle.borderBottomWidth);

  return bodyPad + tbH + contBorder;
}

/**
 * Compute the maximum height we should request for the diagram
 * container. Subtracts the live-measured chrome (toolbar + body
 * padding + container border) from the available iframe height so
 * the toolbar and padding never push the diagram off-screen.
 *
 * Available height: prefer host-provided containerDimensions in
 * inline mode (the chat's reserved area), otherwise window.innerHeight
 * (the iframe's actual visible height — accurate fallback when the
 * host doesn't expose dimensions).
 */
function maxViewportHeight()
{
  var ctx = (app.getHostContext != null) ? app.getHostContext() : null;

  var hostMaxH = null;
  var dims = ctx && ctx.containerDimensions;
  if (dims != null)
  {
    if (typeof dims.height === 'number') hostMaxH = dims.height;
    else if (typeof dims.maxHeight === 'number') hostMaxH = dims.maxHeight;
  }

  var available;
  if (currentDisplayMode === 'fullscreen')
  {
    available = window.innerHeight;
  }
  else
  {
    // Inline mode: cap at STREAM_VIEWPORT_MAX_HEIGHT_INLINE no matter
    // what the host reports. Claude.ai sometimes hands back a huge
    // containerDimensions.maxHeight (full viewport), and we don't want
    // to consume that — the prompt box still needs to be visible. Also
    // can't trust window.innerHeight as a fallback: it reflects the
    // iframe's own height after our last sendSizeChanged, which feeds
    // back to make us grow without bound.
    available = STREAM_VIEWPORT_MAX_HEIGHT_INLINE;
    if (hostMaxH != null && hostMaxH < available) available = hostMaxH;
  }

  return Math.max(STREAM_VIEWPORT_MIN_HEIGHT, available - measureChrome());
}

app.onhostcontextchanged = function()
{
  applyDisplayModeLayout();
};

function showError(message)
{
  loadingEl.style.display = "none";
  errorEl.style.display = "block";
  errorEl.textContent = message;
}

function waitForGraphViewer()
{
  return new Promise(function(resolve, reject)
  {
    if (typeof GraphViewer !== "undefined") { resolve(); return; }

    var attempts = 0;
    var maxAttempts = 100; // 10 s
    var interval = setInterval(function()
    {
      attempts++;

      if (typeof GraphViewer !== "undefined")
      {
        clearInterval(interval);
        resolve();
      }
      else if (attempts >= maxAttempts)
      {
        clearInterval(interval);
        reject(new Error("draw.io viewer failed to load"));
      }
    }, 100);
  });
}

// ─── Layout gate ─────────────────────────────────────────────────
// The host may keep this iframe display:none while a tool result
// streams in (or when revisiting an old message). Without layout every
// DOM measurement reads 0x0, so a Mermaid parse done in that state
// sizes all nodes to their shape minimum — and the conversion cache
// would then serve that zero-sized parse as the final render. There is
// also nothing to see while hidden (streaming animation included), so
// all Mermaid parse/render work waits here until the document actually
// has layout. drawio-mermaid additionally guards measureText against
// degenerate 0x0 measurements as defense in depth.

function isDocumentLaidOut()
{
  return document.documentElement != null &&
    document.documentElement.clientWidth > 0;
}

var documentLaidOutPromise = null;

function whenDocumentLaidOut()
{
  if (documentLaidOutPromise != null) return documentLaidOutPromise;

  documentLaidOutPromise = new Promise(function(resolve)
  {
    if (isDocumentLaidOut()) { resolve(); return; }

    var observer = null;
    var timer = null;
    var finish = function()
    {
      if (observer != null) { observer.disconnect(); observer = null; }
      if (timer != null) { clearInterval(timer); timer = null; }
      resolve();
    };

    // IntersectionObserver fires on visibility changes even while rAF
    // is frozen in a hidden iframe; the interval is a fallback for
    // embedders where the observer never fires.
    try
    {
      observer = new IntersectionObserver(function()
      {
        if (isDocumentLaidOut()) finish();
      });
      observer.observe(document.documentElement);
    }
    catch (e) { /* fall back to polling below */ }

    timer = setInterval(function()
    {
      if (isDocumentLaidOut()) finish();
    }, 200);
  });

  return documentLaidOutPromise;
}

// Cache one (text, xml) pair so finalize doesn't re-parse the same
// Mermaid text the streaming path already parsed. parseText is
// expensive (50–300 ms for moderate diagrams) and the finalized text
// is almost always identical to the last streaming partial.
var lastConvertedMermaidText = null;
var lastConvertedMermaidXml = null;

function rememberMermaidConversion(text, xml)
{
  lastConvertedMermaidText = text;
  lastConvertedMermaidXml = xml;
  currentMermaidText = text;
}

function convertMermaidToXml(mermaidText)
{
  // Cache hit — skip parseText entirely.
  if (mermaidText === lastConvertedMermaidText &&
      lastConvertedMermaidXml != null)
  {
    return Promise.resolve(lastConvertedMermaidXml);
  }

  // The drawio-mermaid bundle (inlined at load time) exposes
  // mxMermaidToDrawio.parseText(text, config), which runs the full
  // parse + layout pipeline synchronously and returns draw.io XML.
  // No upstream mermaid runtime, no listener plumbing, no timeout.
  if (typeof mxMermaidToDrawio === 'undefined' ||
      typeof mxMermaidToDrawio.parseText !== 'function')
  {
    return Promise.reject(new Error("drawio-mermaid bundle not loaded"));
  }

  // Always render with the 'default' theme: its palette is expressed in
  // light-dark() adaptive colors, so a single render is correct in BOTH light
  // and dark hosts (the viewer/editor color-scheme selects the variant). The
  // named 'dark' theme is mermaid's STATIC dark palette — forcing it on a dark
  // host bakes in fixed dark colors that then render wrong if the same diagram
  // is later opened or exported in light mode. light-dark() is the dark-mode
  // support; don't override it based on the host's current color-scheme.
  var config = { theme: 'default' };

  try
  {
    var xml = mxMermaidToDrawio.parseText(mermaidText, config);

    if (xml == null)
    {
      return Promise.reject(new Error("Unsupported Mermaid diagram type"));
    }

    // Stabilize cell IDs so the streaming preview and the final render
    // share identity for the same cells. parseText auto-assigns sequential
    // IDs that shift across prefix re-parses; stabilizeMermaidIds rewrites
    // them to deterministic content-addressed values.
    var stabilized = stabilizeMermaidIds(xml);
    rememberMermaidConversion(mermaidText, stabilized);
    return Promise.resolve(stabilized);
  }
  catch (e)
  {
    return Promise.reject(e);
  }
}

function generateDrawioEditUrl(xml)
{
  var encoded = encodeURIComponent(xml);
  var compressed = pako.deflateRaw(encoded);
  var base64 = btoa(Array.from(compressed, function(b) { return String.fromCharCode(b); }).join(""));
  var createObj = { type: "xml", compressed: true, data: base64, effect: "pop" };

  return "https://app.diagrams.net/?pv=0&grid=0#create=" + encodeURIComponent(JSON.stringify(createObj));
}

// Injects the ELK layout selector into the round-tripped Mermaid source so a
// re-edit in draw.io reproduces the layered ELK layout (drawio-dev's
// isMermaidElkFlowchart() trigger fires and re-renders through its ElkLayout
// post-pass instead of the dagre default).
//
// Since Mermaid v10.5.0 the %%{init}%% directive form is deprecated in favor of
// the YAML-frontmatter config block, so we emit a "config: { layout: elk }".
// drawio-mermaid maps config.layout === 'elk' to the same path the old
// flowchart.defaultRenderer:elk directive triggered, and drawio-dev still
// recognizes BOTH on re-edit (back-compat with already-saved diagrams).
//
// Placement rules: the config key must live INSIDE the frontmatter (Mermaid
// only honors frontmatter at the very start of the document). So:
//  - no frontmatter         -> emit a minimal "--- config: layout: elk ---" block
//  - frontmatter, no config -> append a config block before the closing ---
//  - frontmatter + config   -> nest "layout: elk" as the first child of config
// An explicit renderer/layout already present (old directive, or any layout key
// in the frontmatter) is respected and left untouched.
function withElkRenderer(text)
{
  if (text == null) return text;
  // Old %%{init ... defaultRenderer: "elk"}%% directive is still honored on
  // re-edit; if present, leave the source untouched.
  if (/defaultRenderer/i.test(text)) return text;

  var fm = /^(---[ \\t]*\\r?\\n)([\\s\\S]*?)(---[ \\t]*\\r?\\n)/.exec(text);

  // No frontmatter: emit a minimal block carrying just the ELK layout config.
  if (fm == null)
  {
    return '---\\nconfig:\\n  layout: elk\\n---\\n' + text;
  }

  var open = fm[1], body = fm[2], close = fm[3];
  var rest = text.substring(fm[0].length);

  // Respect an explicit layout already declared in the frontmatter.
  if (/(?:^|\\n)[ \\t]*layout[ \\t]*:/.test(body)) return text;

  // Existing config: block -> nest "layout: elk" as its first child, matching
  // the indentation of the block's existing children (falls back to one level
  // deeper than config: when the block is empty).
  var cfg = /(?:^|\\n)([ \\t]*)config[ \\t]*:[ \\t]*\\r?\\n/.exec(body);

  if (cfg != null)
  {
    var at = cfg.index + cfg[0].length;
    var child = /^([ \\t]+)\\S/.exec(body.substring(at));
    var indent = child ? child[1] : (cfg[1] + '  ');
    body = body.substring(0, at) + indent + 'layout: elk\\n' + body.substring(at);
    return open + body + close + rest;
  }

  // Frontmatter present but no config: block -> append one before the closer.
  return open + body + 'config:\\n  layout: elk\\n' + close + rest;
}

/**
 * Sets the authoritative diagram XML behind "Open in draw.io" and the
 * "Copy XML" button. Mermaid-derived diagrams are wrapped via the bundle's
 * mxMermaidToDrawio.wrapGroup (same code path drawio-dev uses) so the source
 * round-trips on reopen; plain-XML diagrams (currentMermaidText == null) are
 * stored verbatim. The live streamGraph preview is intentionally left
 * unwrapped so the ELK post-layout pass keeps operating on the flat cells.
 *
 * When the viewer is currently showing a layered ELK layout (currentLayoutState
 * is 'vertical' / 'horizontal' — set by an explicit verticalFlow/horizontalFlow
 * postLayout or the layout-toggle button), the stored Mermaid source gets the
 * ELK layout config (frontmatter "config: { layout: elk }", via withElkRenderer)
 * so a re-edit in draw.io re-runs through ELK — drawio-dev already applies its
 * ElkLayout post-pass to elk-flowchart sources. Start/end pins are deliberately
 * NOT carried in the config: Mermaid's ELK renderer accepts no such hints, and
 * the baked geometry already round-trips on plain open/copy, so passing cell IDs
 * in metadata would only add a fragile coupling for no layout gain.
 */
function commitDiagramXml(xml)
{
  var out = xml;

  if (currentMermaidText != null &&
      typeof mxMermaidToDrawio !== 'undefined' &&
      typeof mxMermaidToDrawio.wrapGroup === 'function')
  {
    var elkLive = (currentLayoutState === 'vertical' ||
                   currentLayoutState === 'horizontal');
    var wrapText = elkLive ? withElkRenderer(currentMermaidText) : currentMermaidText;

    try
    {
      // normalize: shift the wrapper's children so the padded
      // transparentBounds group starts exactly at (0,0) — without it the
      // padded bounds begin at (-groupPadding,-groupPadding) and draw.io
      // extends the page above/left of the origin on "Open in draw.io".
      out = mxMermaidToDrawio.wrapGroup(xml, wrapText, null, {normalize: true});
    }
    catch (e)
    {
      out = xml;
    }
  }

  currentXml = out;
  drawioEditUrl = generateDrawioEditUrl(out);
}

/**
 * Serialize the current graph model to draw.io XML. Used after a post-
 * layout pass so currentXml and drawioEditUrl reflect what the user
 * sees in the viewer — not the pre-pass XML from the server.
 */
function serializeGraphXml(graph)
{
  try
  {
    var codec = new mxCodec();
    var node = codec.encode(graph.getModel());
    return mxUtils.getXml(node);
  }
  catch (e)
  {
    return null;
  }
}

/**
 * Apply a post-render layout to the given graph and animate the
 * vertices morphing from their original positions to the new ones.
 *
 * ELK runs async via the drawio-elk ElkLayout facade: prepare() snapshots
 * the model, runs ELK off the render path, and hands back a synchronous
 * apply() closure (DEFAULTS merge + mermaid policy + isolated-node
 * handling + edge style/corners + applier). We bracket apply() in a
 * beginUpdate block deferred by mxMorphing — mirroring drawio's
 * EditorUi.executeLayout so the view stays on pre-layout positions during
 * the morph. The algorithm name + canonical edge treatment come from
 * ElkLayout.MENU_PRESETS / ElkLayout.CANONICAL_EDGE in the bundle, the
 * single source shared with the editor's menu and mermaid-edit post-pass.
 *
 * @param {Graph} graph
 * @param {string} algorithm - Enum value from the postLayout schema.
 * @param {function(boolean)} [onDone] - Called with true when the
 *   layout was applied, false when it was skipped or ELK errored.
 */

function applyPostLayout(graph, algorithm, onDone, onMorphStart, awaitBeforeMorph, fadeEdges)
{
  var done = function(applied)
  {
    if (typeof onDone === 'function') onDone(applied);
  };

  if (graph == null) { done(false); return; }

  if (typeof ElkLayout === 'undefined' || typeof ELK === 'undefined')
  {
    done(false);
    return;
  }

  // Resolve the menu name (verticalFlow / horizontalFlow / …) to an ELK
  // algorithm + the direction it pins. The per-algorithm option baseline,
  // mermaid hierarchy policy, isolated-node handling, edge style and
  // corners all live in the drawio-elk ElkLayout facade now — this used to
  // be hand-rolled here via the mxElkLayout shim, which is gone.
  var preset = (ElkLayout.MENU_PRESETS || {})[algorithm];
  if (preset == null) { done(false); return; }

  var model = graph.getModel();
  var parent = graph.getDefaultParent();

  // Nothing to lay out → bail (matches the old empty-elkGraph guard).
  var hasVertex = false;
  var childCount = model.getChildCount(parent);
  for (var ci = 0; ci < childCount; ci++)
  {
    if (model.isVertex(model.getChildAt(parent, ci))) { hasVertex = true; break; }
  }
  if (!hasVertex) { done(false); return; }

  // Canonical edge treatment (orthogonal + rounded), shared with the
  // editor's mermaid-edit post-pass and Arrange > Layout dialog default.
  // resizeParent:false pins the mermaid-measured node sizes — drawio-
  // mermaid is the authority on sizing (its measureText falls back to a
  // calibrated estimate when the iframe isn't rendered yet), and the
  // bridge couples this flag to its vertex-label sizing so ELK lays out
  // with the pinned sizes instead of reserving room for grown boxes it
  // would never write back.
  var elkOptions = { mermaidPolicy: true, applierOptions: { resizeParent: false } };
  if (ElkLayout.CANONICAL_EDGE != null)
  {
    elkOptions.edgeStyleMode = ElkLayout.CANONICAL_EDGE.edgeStyleMode;
    elkOptions.corners = ElkLayout.CANONICAL_EDGE.corners;
  }

  var layout = new ElkLayout(graph, preset.algorithm,
    Object.assign({}, preset.options), elkOptions);

  // ELK gates layout application; awaitBeforeMorph gates mxMorphing
  // separately. ELK is the variable cost (100–500 ms for big diagrams).
  // The camera ease is decoupled from mxMorphing's snapshot, so it
  // fires as soon as ELK has applied — no need to wait for pop-in
  // animations to settle. mxMorphing still waits, because it snapshots
  // cell opacity and would otherwise capture a half-faded view.
  // prepare() runs ELK async and returns a synchronous apply() closure
  // (DEFAULTS merge, mermaid policy, isolated-node extract/replace, edge
  // style + corners, applier). We bracket apply() with beginUpdate so the
  // mxMorphing animation below picks up the pre/post diff — the same shape
  // the editor's ElkLayout.run + executeLayout uses.
  layout.prepare(parent, function(err, apply)
  {
    if (err != null) { done(false); return; }

    model.beginUpdate();

    var committed = false;

    try
    {
      apply();
      committed = true;
    }
    catch (e)
    {
      // ELK application failed.
    }

    if (!committed)
    {
      model.endUpdate();
      done(false);
      return;
    }

    // Commit with morph animation — morph captures the current
    // view state (pre-ELK positions) and animates to the new
    // model state, calling endUpdate on DONE.
    //
    // Don't call graph.fit() here: graph.fit mutates view.scale
    // and view.translate, which would compose with our CSS
    // viewTransform and double-scale the diagram. The caller
    // re-runs streamFollowNewCells(graph) after done(true) to
    // ease the CSS transform to the new fit. sizeDidChange is
    // still needed so the SVG dims track the new bbox.
    var refit = function()
    {
      try { graph.sizeDidChange(); } catch (_) {}
    };

    // Camera ease fires NOW — model has new positions so the caller's
    // computeFitWholeTransform sees the post-ELK bbox. The camera path
    // doesn't depend on cell opacity, so we don't have to wait for
    // pop-in to finish. The cell morph will follow whenever the
    // animations-settled gate resolves.
    if (typeof onMorphStart === 'function')
    {
      try { onMorphStart(); } catch (_) {}
    }

    (awaitBeforeMorph || Promise.resolve()).then(function()
    {
      try
      {
        // 12 steps × ~30 ms ≈ 360 ms of cell morphing. Long enough
        // to feel like a real layout transition, short enough to
        // not drag.
        var morph = new mxMorphing(graph, 12, 1.5, 30);
        morph.addListener(mxEvent.DONE, function()
        {
          model.endUpdate();
          refit();
          // After endUpdate the view re-renders edges with their new
          // waypoints/styles. Hide them synchronously so a paint
          // can't sneak in showing stale-looking edges, then animate
          // them back in. The first post-stream layout pairs with
          // vertex pop-in so we pen-draw along the BFS schedule;
          // subsequent layout-button toggles fade everything in
          // together — the topological wipe is too slow on a model
          // whose vertices are just morphing positions.
          hideAllEdgesForMorph(graph);
          requestAnimationFrame(function()
          {
            if (fadeEdges) fadeInAllEdgesAfterMorph(graph);
            else penDrawAllEdgesAfterMorph(graph);
          });
          notifySize('postLayout');
          try { containerEl.classList.remove('morph-active'); } catch (_) {}
          done(true);
        });
        // Hide edges immediately before startAnimation so vertex
        // animation isn't visually polluted by misaligned waypoints
        // during the move. Deferred until now (rather than at ELK-done)
        // so streaming pen-draws aren't cut short while we wait for
        // awaitBeforeMorph to settle.
        hideAllEdgesForMorph(graph);
        // Relax overflow on the SVG + mxgraph wrappers so cells
        // passing through positions outside the OLD bbox aren't
        // clipped before sizeDidChange/camera fit catches up.
        try { containerEl.classList.add('morph-active'); } catch (_) {}
        morph.startAnimation();
      }
      catch (e)
      {
        model.endUpdate();
        refit();
        notifySize('postLayout');
        done(true);
      }
    });
  });
}

/**
 * Absolute model-coordinate offset of a cell's parent chain. Edge waypoints
 * and vertex geometries are stored relative to their parent; for flat diagrams
 * (parent = the default layer) this is {0,0}, but a cell nested in a container
 * needs its ancestors' positions summed. Stops at the layer (non-vertex).
 */
function getAbsoluteParentOffset(graph, cell)
{
  var model = graph.getModel();
  var x = 0, y = 0;
  var p = model.getParent(cell);
  while (p != null && model.isVertex(p))
  {
    var pg = model.getGeometry(p);
    if (pg != null) { x += pg.x; y += pg.y; }
    p = model.getParent(p);
  }
  return { x: x, y: y };
}

/**
 * A vertex's bounds in absolute model coordinates (geometry + parent offset).
 */
function getAbsoluteModelBounds(graph, cell)
{
  var geo = graph.getModel().getGeometry(cell);
  if (geo == null) return null;
  var off = getAbsoluteParentOffset(graph, cell);
  return { x: geo.x + off.x, y: geo.y + off.y, w: geo.width, h: geo.height };
}

/**
 * A fixed connection point on one end of an edge (exitX/exitY for the source,
 * entryX/entryY for the target) as {x, y, dir} via
 * AvoidRouting.constraintForPoint (from the vendored libavoid-routing.js —
 * clamps to the pin's [0,1] domain, derives the ConnDirFlags from the
 * original values). null for a floating endpoint. Mirrors
 * LibavoidRouting.fixedConstraint in the draw.io editor.
 */
function libavoidFixedConstraint(style, source)
{
  return AvoidRouting.constraintForPoint(
    parseFloat(mxUtils.getValue(style, source ? 'exitX' : 'entryX', null)),
    parseFloat(mxUtils.getValue(style, source ? 'exitY' : 'entryY', null)));
}

/**
 * Resolved jetty size (minimum first/last segment length, px) for one end of
 * an edge, mirroring mxEdgeStyle.getJettySize: sourceJettySize/targetJettySize
 * over jettySize, with 'auto' derived from the end's arrow size. A missing
 * jettySize resolves as 'auto' — that's what the write-back sets, so the route
 * matches a later in-editor re-route.
 */
function libavoidJettyFor(style, source)
{
  var value = mxUtils.getValue(style, source ? 'sourceJettySize' : 'targetJettySize',
    mxUtils.getValue(style, 'jettySize', 'auto'));

  if (value == 'auto')
  {
    var type = mxUtils.getValue(style, source ? 'startArrow' : 'endArrow', 'none');

    if (type != 'none')
    {
      var size = mxUtils.getNumber(style, source ? 'startSize' : 'endSize', 6);
      value = Math.max(2, Math.ceil((size + 10) / 10)) * 10; // orthBuffer 10
    }
    else
    {
      value = 20; // 2 * orthBuffer
    }
  }

  value = parseFloat(value);
  return isNaN(value) ? 0 : value;
}

/**
 * Run libavoid over the current graph: register every vertex as an obstacle,
 * route every edge (whose endpoints are known vertices) around them with
 * orthogonal obstacle-avoiding paths, and write the resulting bend points
 * back as edge waypoints. Vertices are NOT moved — this is pure edge routing,
 * the complement to applyPostLayout (which moves vertices). Synchronous once
 * Avoid is ready; the caller awaits readiness via applyRouting().
 *
 * The libavoid-driving core is AvoidRouting.computeRoutes from the vendored
 * libavoid-routing.js (canonical source: drawio-dev js/libavoid-js/ — the same
 * artifact the draw.io editor and the mcp-tool-server run), inlined with the
 * libavoid glue. Here we only do the mxGraph-specific extract (vertices/edges
 * in absolute coords) and write-back — incl. fixed connection points (directed
 * pins) and per-end jetty stubs, like the editor's routeCells.
 */
function routeWithLibavoid(graph, Avoid)
{
  var model = graph.getModel();
  var id;

  // Extract obstacles + edges in absolute model coordinates.
  var vertices = [];
  var edges = [];
  var edgeCells = {};

  for (id in model.cells)
  {
    var c = model.cells[id];
    if (c == null) continue;

    if (c.vertex)
    {
      var b = getAbsoluteModelBounds(graph, c);
      if (b != null && b.w > 0 && b.h > 0)
      {
        vertices.push({ id: id, x: b.x, y: b.y, w: b.w, h: b.h });
      }
    }
    else if (c.edge)
    {
      var s = model.getTerminal(c, true);
      var t = model.getTerminal(c, false);
      if (s != null && t != null && s.vertex && t.vertex)
      {
        // Fixed connection points (exitX/entryX…) route via directed pins and
        // the per-end jettySize gives their minimum stub — like the editor.
        var st = graph.getCellStyle(c);
        edges.push({ id: id, source: s.id, target: t.id,
          sourceConstraint: libavoidFixedConstraint(st, true),
          targetConstraint: libavoidFixedConstraint(st, false),
          sourceJetty: libavoidJettyFor(st, true),
          targetJetty: libavoidJettyFor(st, false) });
        edgeCells[id] = c;
      }
    }
  }

  var routes = AvoidRouting.computeRoutes(Avoid, vertices, edges);
  var routedIds = Object.keys(routes);
  if (routedIds.length === 0) return false;

  // Write the routes back. We keep orthogonalEdgeStyle (libavoid is already
  // orthogonal) so the segments stay draggable in the draw.io editor, and tag
  // each edge with libavoidRouting=1 (plus the editor's paired rounded/
  // orthogonalLoop/jettySize defaults) so that if the diagram is opened in the
  // full editor and a shape is later moved, the edge re-routes live via libavoid
  // instead of reverting to the basic router. The flag is inert in this inline
  // viewer (no libavoid extension) — the baked waypoints render as-is, so there
  // is no shift on open. We leave the endpoints FLOATING — every route meets a
  // shape at a side midpoint, which is where a floating orthogonal endpoint
  // connects anyway. The helper's waypoints are absolute; convert to the edge's
  // parent frame.
  model.beginUpdate();
  try
  {
    for (var i = 0; i < routedIds.length; i++)
    {
      var edge = edgeCells[routedIds[i]];
      var wpsAbs = routes[routedIds[i]];
      var off = getAbsoluteParentOffset(graph, edge);

      var wps = [];
      for (var k = 0; k < wpsAbs.length; k++)
      {
        wps.push(new mxPoint(wpsAbs[k].x - off.x, wpsAbs[k].y - off.y));
      }

      var geo = model.getGeometry(edge);
      geo = (geo != null) ? geo.clone() : new mxGeometry();
      geo.points = wps;
      model.setGeometry(edge, geo);

      var style = model.getStyle(edge) || '';
      style = mxUtils.setStyle(style, mxConstants.STYLE_EDGE, 'orthogonalEdgeStyle');
      style = mxUtils.setStyle(style, 'rounded', '0');
      style = mxUtils.setStyle(style, 'curved', null);
      style = mxUtils.setStyle(style, 'libavoidRouting', '1');
      style = mxUtils.setStyle(style, 'orthogonalLoop', '1');
      // Preserve an explicit jettySize (the route was computed with it — see
      // libavoidJettyFor); only a missing one gets the editor default 'auto'.
      if (!(/(^|;)jettySize=/.test(style)))
      {
        style = mxUtils.setStyle(style, 'jettySize', 'auto');
      }
      style = mxUtils.setStyle(style, 'html', '1');
      model.setStyle(edge, style);
    }
  }
  finally
  {
    model.endUpdate();
  }

  graph.view.validate();
  console.log('[libavoid] routed ' + routedIds.length + ' edge(s)');
  return true;
}

/**
 * Async wrapper around routeWithLibavoid: await wasm readiness, then route.
 * Degrades gracefully — calls onDone(false) (diagram stays unrouted) when
 * libavoid isn't present, failed to load, or routing throws.
 *
 * @param {Graph} graph
 * @param {function(boolean)} [onDone] - true when routes were applied.
 */
function applyRouting(graph, onDone)
{
  var done = function(applied)
  {
    if (typeof onDone === 'function') onDone(applied);
  };

  if (graph == null || typeof window === 'undefined' || window.__libavoidReady == null)
  {
    done(false);
    return;
  }

  window.__libavoidReady.then(function(Avoid)
  {
    if (Avoid == null) { done(false); return; }
    try { done(routeWithLibavoid(graph, Avoid)); }
    catch (e) { console.error('[libavoid] routing failed:', (e && e.message), e); done(false); }
  }).catch(function() { done(false); });
}

/**
 * Run the libavoid routing pass and, when it applies, re-reveal the edges
 * with a fade (the re-route changes every edge's waypoints) and persist the
 * routed XML. routeWithLibavoid renders the new edges synchronously inside
 * the same microtask, so hiding them here happens before the next paint —
 * no flash of the un-faded routes. Vertices never move, so there is no
 * camera change. onComplete(applied) fires after the pass either way.
 */
function runRoutingPass(graph, onComplete)
{
  applyRouting(graph, function(applied)
  {
    if (applied)
    {
      hideAllEdgesForMorph(graph);
      requestAnimationFrame(function()
      {
        fadeInAllEdgesAfterMorph(graph);
      });

      try
      {
        var nx = serializeGraphXml(graph);
        if (nx != null) commitDiagramXml(nx);
      }
      catch (_) {}

      try { graph.sizeDidChange(); } catch (_) {}
      notifySize('routing');
    }

    if (typeof onComplete === 'function') onComplete(applied);
  });
}

function notifySize(tag)
{
  // GraphViewer renders asynchronously; nudge the SDK's ResizeObserver
  // by explicitly sending size after the SVG is in the DOM.
  requestAnimationFrame(function()
  {
    var el = document.documentElement;
    var w = Math.ceil(el.scrollWidth);
    var h = Math.ceil(el.scrollHeight);
    var containerH = containerEl.clientHeight;
    var containerStyle = containerEl.style.height;
    var containerDisplay = containerEl.style.display;
    var svgEl = containerEl.querySelector('svg');
    var svgH = svgEl ? svgEl.getBoundingClientRect().height : 0;

    if (app.sendSizeChanged)
    {
      app.sendSizeChanged({ width: w, height: h });
    }
  });
}

// --- Streaming: raw Graph + standalone merge (no GraphViewer) ---

var streamGraph = null;
var streamPendingEdges = null;
var streamFitRaf = null;
var pendingToolInputTimer = null;
// Set once we've fired the early finalize from ontoolinputpartial after
// detecting the mermaid string closed (sibling JSON key appeared). Avoids
// re-running convertMermaidToXml + finalizeStreamingView on subsequent
// trailing-JSON partials. Reset by endStreaming() and on stream init.
var mermaidEarlyFinalizeFired = false;
// Set once we've fired the one-time eased fit-whole triggered by the first
// classDef appearance in the streamed Mermaid text. classDef typically
// arrives near the tail of a diagram source and restyles existing nodes
// without adding new geometry, so the recent-vertex follow keeps the
// camera zoomed in even though styling now affects the whole diagram.
// Reset by endStreaming() and on stream init.
var mermaidClassDefFitFired = false;

/**
 * Standalone merge: inserts or updates cells from xmlNode into the graph
 * model without any GraphViewer viewport side effects. Returns updated
 * pendingEdges array. Ported from GraphViewer.prototype.mergeXmlDelta.
 */
function streamMergeXmlDelta(graph, pendingEdges, xmlNode)
{
  if (graph == null || xmlNode == null) return pendingEdges;

  var modelNode = xmlNode;

  if (modelNode.nodeName !== 'mxGraphModel') return pendingEdges;

  var model = graph.getModel();
  var codec = new mxCodec(modelNode.ownerDocument);

  // Resolve parent/source/target references against the live model so
  // mxCellCodec wires up edges as cells stream in. updateElements is
  // no-op'd because we manage IDs ourselves and don't want the codec
  // mutating the source XML's id attributes.
  codec.lookup = function(id) { return model.getCell(id); };
  codec.updateElements = function() {};

  if (pendingEdges == null) pendingEdges = [];

  var rootNode = modelNode.getElementsByTagName('root')[0];

  if (rootNode == null) return pendingEdges;

  var cellNodes = rootNode.childNodes;

  model.beginUpdate();
  try
  {
    for (var i = 0; i < cellNodes.length; i++)
    {
      var cellNode = cellNodes[i];

      if (cellNode.nodeType !== 1) continue;

      // codec.decodeCell handles <mxCell>, <UserObject>, and <object>
      // uniformly: it walks children to find the cell codec for wrapper
      // elements (no codec is registered under 'UserObject' in the
      // viewer build) and returns an mxCell whose .value is the wrapper
      // DOM node — which is what Graph.convertValueToString reads the
      // 'label' attribute off of, and what carries any custom attrs
      // (mermaidId, mermaidBaseStyle, …) through to the model.
      //
      // The second arg is restoreStructures=false: insertIntoGraph
      // would call parent.insert() directly, bypassing model.cellAdded
      // and leaving the cell unregistered in model.cells. We re-attach
      // via model.add / model.setTerminal below so the lookup map and
      // edge-list invariants are maintained.
      var decoded = null;
      try { decoded = codec.decodeCell(cellNode, false); }
      catch (e) { continue; }

      if (decoded == null) continue;
      var id = decoded.id;
      if (id == null) continue;

      var existing = model.getCell(id);

      if (existing != null)
      {
        // Promote a cell that was first inserted as a plain (non-vertex,
        // non-edge) cell once its real role finally streams in. This
        // happens with <object>/<UserObject> wrappers: the id lives on
        // the wrapper but vertex/edge="1" lives on the inner <mxCell>.
        // healPartialXml can close the wrapper before that inner cell
        // arrives, so decodeCell yields an id-only cell with vertex=false.
        // setStyle/setGeometry below would then update a cell the renderer
        // never builds a shape for — it renders as blank space. Flip the
        // flags and invalidate so the view rebuilds it as a real shape.
        if ((decoded.vertex && !existing.vertex) ||
            (decoded.edge && !existing.edge))
        {
          existing.vertex = decoded.vertex;
          existing.edge = decoded.edge;
          graph.view.clear(existing, false, false);
          graph.view.invalidate(existing, true, false);
        }

        if (decoded.style != null && decoded.style !== existing.style)
        {
          model.setStyle(existing, decoded.style);
        }

        if (cellValueChanged(decoded.value, existing.value))
        {
          model.setValue(existing, decoded.value);
        }

        if (decoded.geometry != null)
        {
          var hadZeroBounds = existing.geometry == null ||
            (existing.geometry.width === 0 && existing.geometry.height === 0);
          var hasNonZeroBounds = (decoded.geometry.width > 0 || decoded.geometry.height > 0);

          // Capture pre-merge rendered position for any existing cell
          // that's already been laid out (non-zero bounds) and is
          // moving. The pop-animation path handles the 0×0 → non-zero
          // promotion separately; we only morph cells that already
          // had a real position.
          if (!hadZeroBounds && existing.geometry != null &&
              (Math.abs(existing.geometry.x - decoded.geometry.x) > 0.5 ||
               Math.abs(existing.geometry.y - decoded.geometry.y) > 0.5))
          {
            var preState = graph.view.getState(existing);

            if (preState != null)
            {
              morphPrePositions[id] = { x: preState.x, y: preState.y };
            }
          }

          model.setGeometry(existing, decoded.geometry);

          // If geometry went from 0x0 to non-zero and cell hasn't been
          // animated yet, queue it for deferred pop animation
          if (hadZeroBounds && hasNonZeroBounds && !animatedCellIds[id])
          {
            // Make cell visible in model (was hidden in streamInsertCell)
            if (!existing.visible)
            {
              model.setVisible(existing, true);
            }

            var dIdx = deferredAnimCellIds.indexOf(id);

            if (dIdx >= 0)
            {
              deferredAnimCellIds.splice(dIdx, 1);
            }

            // Avoid duplicate: only queue if not already pending
            if (pendingAnimCellIds.indexOf(id) === -1)
            {
              pendingAnimCellIds.push(id);
            }
          }
        }
      }
      else
      {
        streamInsertCell(model, decoded, pendingEdges);
      }
    }

    // Resolve pending edges
    var stillPending = [];
    for (var j = 0; j < pendingEdges.length; j++)
    {
      var entry = pendingEdges[j];

      if (!model.contains(entry.cell)) continue;

      var resolved = true;

      if (entry.sourceId != null && entry.cell.source == null)
      {
        var src = model.getCell(entry.sourceId);
        if (src != null) model.setTerminal(entry.cell, src, true);
        else resolved = false;
      }

      if (entry.targetId != null && entry.cell.target == null)
      {
        var tgt = model.getCell(entry.targetId);
        if (tgt != null) model.setTerminal(entry.cell, tgt, false);
        else resolved = false;
      }

      if (resolved) model.setVisible(entry.cell, true);
      else stillPending.push(entry);
    }

    pendingEdges = stillPending;
  }
  finally
  {
    model.endUpdate();
  }

  // Run morph animations for cells whose existing geometry shifted in
  // this delta. Must run BEFORE the pre-hide pass below so that we
  // see the freshly-validated state positions (the pre-hide pass also
  // calls view.validate, but applyMorphAnimations needs to read state
  // before any other code touches inline styles on shape/text nodes).
  applyMorphAnimations(graph);

  // Pre-hide cells that just got geometry to prevent flash before pop animation.
  // endUpdate() triggers view revalidation which renders them visible — we must
  // hide synchronously before the browser paints.
  if (pendingAnimCellIds.length > 0)
  {
    graph.view.validate();

    for (var ph = 0; ph < pendingAnimCellIds.length; ph++)
    {
      var phCell = model.getCell(pendingAnimCellIds[ph]);

      if (phCell != null)
      {
        var phState = graph.view.getState(phCell);

        if (phState != null && phState.shape != null && phState.shape.node != null)
        {
          phState.shape.node.style.opacity = '0';
        }

        if (phState != null && phState.text != null && phState.text.node != null)
        {
          phState.text.node.style.opacity = '0';
        }
      }
    }
  }

  // No positionGraph()/sizeDidChange() — we control the viewport ourselves.
  return pendingEdges;
}

function streamInsertCell(model, decoded, pendingEdges)
{
  var id = decoded.id;
  if (id == null) return;

  // The default model already has roots '0' and '1' from createRoot().
  if (id === '0') return;
  if (id === '1' && model.getCell('1') != null) return;

  // Resolve parent through the live model. codec.decodeCell sets
  // decoded.parent via its internal codec.objects cache, which after
  // an earlier decode of <mxCell id="1"/> in the same merge points at
  // an orphan mxCell — using it directly would attach this cell to a
  // node that isn't reachable from model.root, and model.cellAdded
  // would skip the cells-map registration.
  var parent = null;
  if (decoded.parent != null && decoded.parent.id != null)
  {
    parent = model.getCell(decoded.parent.id);
  }
  if (parent == null && model.root != null)
  {
    if (id === '1') parent = model.root;
    else parent = model.getCell('1') || model.root;
  }
  if (parent == null) return;

  // Hide vertices without geometry to prevent label flash at (0,0).
  // They become visible when geometry arrives via the update path.
  var hasGeo = decoded.geometry != null &&
    ((decoded.geometry.width > 0 || decoded.geometry.height > 0) ||
     decoded.geometry.relative);

  if (decoded.vertex && !hasGeo)
  {
    decoded.visible = false;
  }

  // Capture the codec-set source/target ids before we null them. The
  // codec consumes (mutates) the source XML node during decode — the
  // inner <mxCell> is removed from <UserObject> wrappers — so we can't
  // re-read source/target from cellNode after this point.
  var sourceId = (decoded.source != null) ? decoded.source.id : null;
  var targetId = (decoded.target != null) ? decoded.target.id : null;

  // Detach the codec-set parent/source/target before model.add. The
  // change machinery decides whether to fire cellAdded / insertEdge by
  // comparing the previous links against the new ones — if the codec
  // already wired them up (against its own objects cache, which may
  // hold orphan decode-time mxCells from earlier in this same merge),
  // those side effects are skipped and the cell ends up unregistered.
  decoded.parent = null;
  decoded.source = null;
  decoded.target = null;

  model.add(parent, decoded);

  if (decoded.edge)
  {
    // Resolve terminals against the live model so we land on the
    // actual model cell, not a codec-cached orphan. Unresolved
    // terminals — referenced vertex hasn't streamed in yet — get
    // queued for retry once a later partial brings it in.
    if (sourceId != null)
    {
      var src = model.getCell(sourceId);
      if (src != null) model.setTerminal(decoded, src, true);
    }
    if (targetId != null)
    {
      var tgt = model.getCell(targetId);
      if (tgt != null) model.setTerminal(decoded, tgt, false);
    }

    var hasMissing = (sourceId != null && decoded.source == null) ||
                     (targetId != null && decoded.target == null);

    if (hasMissing)
    {
      model.setVisible(decoded, false);
      pendingEdges.push({ cell: decoded, sourceId: sourceId, targetId: targetId });
    }
  }
}

/**
 * Compare an incoming cell value to the existing one. Strings compare
 * by identity; UserObject DOM nodes compare by serialized form so a
 * fresh node with the same label + custom attributes is a no-op (no
 * wasted re-render of unchanged labels during streaming).
 */
function cellValueChanged(newValue, oldValue)
{
  if (newValue === oldValue) return false;
  if (newValue == null || oldValue == null) return true;

  if (typeof newValue === 'string' || typeof oldValue === 'string')
  {
    return newValue !== oldValue;
  }

  if (newValue.outerHTML != null && oldValue.outerHTML != null)
  {
    return newValue.outerHTML !== oldValue.outerHTML;
  }

  return true;
}

/**
 * Returns set of cell IDs in the model (excluding root cells 0 and 1).
 */
function getModelCellIds(model)
{
  var ids = {};

  if (model.cells != null)
  {
    for (var id in model.cells)
    {
      if (id !== '0' && id !== '1') ids[id] = true;
    }
  }

  return ids;
}

/**
 * Returns array of cell IDs that are in the model but not in prevIds.
 */
function findNewCellIds(model, prevIds)
{
  var result = [];

  if (model.cells != null)
  {
    for (var id in model.cells)
    {
      if (id !== '0' && id !== '1' && !prevIds[id]) result.push(id);
    }
  }

  return result;
}

/**
 * Collect the set of cell IDs declared in an mxGraphModel XML node.
 * Used after a Mermaid re-parse to find orphans: cells we previously
 * inserted whose stable IDs (which hash on content) changed because
 * the parser produced a different value for the same logical node —
 * e.g. a Sankey total that grows as more flows are streamed in.
 */
function collectCellIdsFromXml(xmlNode)
{
  var ids = {};
  if (xmlNode == null) return ids;

  var rootEl = null;
  if (xmlNode.nodeName === 'mxGraphModel')
  {
    var rs = xmlNode.getElementsByTagName('root');
    if (rs.length > 0) rootEl = rs[0];
  }
  else if (xmlNode.nodeName === 'root')
  {
    rootEl = xmlNode;
  }

  if (rootEl == null) return ids;

  var children = rootEl.childNodes;
  for (var i = 0; i < children.length; i++)
  {
    var n = children[i];
    if (n.nodeType !== 1) continue;
    // UserObject / object wrappers carry the id externally; the inner
    // mxCell only has the visual attributes.
    var idAttr = n.getAttribute('id');
    if (idAttr == null && (n.nodeName === 'UserObject' || n.nodeName === 'object'))
    {
      var inner = n.getElementsByTagName('mxCell');
      if (inner.length > 0) idAttr = inner[0].getAttribute('id');
    }
    if (idAttr != null) ids[idAttr] = true;
  }
  return ids;
}

/**
 * Remove cells from the model whose IDs are NOT in keepIds. Only
 * meaningful for re-parse-style streaming (Mermaid) where every
 * partial is the complete current state — so anything in the model
 * but not in the new parse is stale.
 *
 * Returns the array of removed IDs so callers can clear animation
 * tracking state for them.
 */
function removeOrphanCells(graph, keepIds)
{
  var model = graph.getModel();
  var toRemove = [];

  for (var id in model.cells)
  {
    if (id === '0' || id === '1') continue;
    if (!keepIds[id]) toRemove.push(model.cells[id]);
  }

  if (toRemove.length === 0) return [];

  var removedIds = [];
  model.beginUpdate();
  try
  {
    for (var i = 0; i < toRemove.length; i++)
    {
      removedIds.push(toRemove[i].id);
      // model.remove also detaches edges/children.
      model.remove(toRemove[i]);
    }
  }
  finally
  {
    model.endUpdate();
  }

  // Clear animation tracking for removed cells so a future cell with
  // the same ID (unlikely with content hashing, but defensive) animates
  // afresh and isn't skipped because we marked it animated earlier.
  for (var r = 0; r < removedIds.length; r++)
  {
    delete animatedCellIds[removedIds[r]];
    delete popInEndsAt[removedIds[r]];
    var pi = pendingAnimCellIds.indexOf(removedIds[r]);
    if (pi >= 0) pendingAnimCellIds.splice(pi, 1);
    var di = deferredAnimCellIds.indexOf(removedIds[r]);
    if (di >= 0) deferredAnimCellIds.splice(di, 1);
  }

  return removedIds;
}

/**
 * Animate newly added cells with wipe-in/pop-in animation.
 * Uses Graph's createPopAnimations and executeAnimations.
 */
var pendingAnimCellIds = [];
var animDebounceTimer = null;
var animBatchStartT = 0;
var deferredAnimCellIds = [];
var deferredAnimTimer = null;
var animatedCellIds = {};
// Per-cell timestamp when the in-flight pop-in animation (opacity +
// transform on the shape node) will be settled. Used by applyMorphAnimations
// to skip CSS-translate morphs on cells whose pop-in hasn't finished —
// otherwise morphNodeBy overwrites the style.transition that drives the
// pop-in, causing the cell to snap to its final pop-in state before
// starting to slide.
var popInEndsAt = {};
// Absolute timestamp when the most-recently-flushed batch's pop-in
// animations are fully settled (opacity has reached 1 on every cell).
// waitForPendingAnimationsToSettle uses this to gate mxMorphing so it
// doesn't snapshot a half-faded view.
var lastAnimEndT = 0;

// Morph animation: when a re-parsed mermaid (or XML) delta moves an
// existing cell to a new position, we GPU-animate the visual offset
// back to zero via the CSS 'translate' property — the cell appears to
// slide from its old position to its new one. CSS 'translate' (Level
// 2) is independent of the SVG 'transform' attribute that mxGraph
// writes for cell positioning, so the two compose cleanly without
// fighting each other.
//
// morphPrePositions[id] = { x, y }  captured BEFORE setGeometry runs.
// applyMorphAnimations consumes the map after endUpdate + validate.
var morphPrePositions = {};
var MORPH_DURATION_MS = 220;

// Settle-debounce: wait this long after the most recent partial
// before flushing. Short enough to feel responsive, long enough to
// batch the cells inside a tight burst (mermaid often arrives in
// a single burst of partials).
var ANIM_SETTLE_MS = 60;
// Max wait from the FIRST partial in a batch before we flush anyway.
// Without this cap, a continuous partial stream would keep extending
// the settle timer and animations would only fire once streaming
// stops. With it, a long stream still produces incremental batches.
var ANIM_MAX_WAIT_MS = 220;

/**
 * Queue cell IDs for animation. Flush is debounced so rapid partials
 * coalesce into one topologically-ordered batch, but capped at
 * ANIM_MAX_WAIT_MS so a long stream still yields incremental flushes.
 *
 * Also synchronously sets opacity:0 on the cells' shape and text
 * nodes so they don't briefly paint at their default position
 * (often the SVG origin for edge labels, before edge routing places
 * them) before flushCellAnimations runs the fade-in.
 */
function queueCellAnimation(graph, cellIds)
{
  // Pre-hide synchronously to avoid the origin-flash for new cells
  // (especially edge labels, which mxGraph initializes at (0, 0)
  // before routing computes the midpoint).
  if (cellIds.length > 0)
  {
    graph.view.validate();
    for (var p = 0; p < cellIds.length; p++)
    {
      var pCell = graph.model.getCell(cellIds[p]);
      if (pCell == null) continue;
      var pState = graph.view.getState(pCell);
      if (pState == null) continue;
      if (pState.shape != null && pState.shape.node != null)
      {
        pState.shape.node.style.opacity = '0';
      }
      if (pState.text != null && pState.text.node != null)
      {
        pState.text.node.style.opacity = '0';
      }
    }
  }

  for (var i = 0; i < cellIds.length; i++)
  {
    pendingAnimCellIds.push(cellIds[i]);
  }

  var now = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
  if (animBatchStartT === 0) animBatchStartT = now;

  // Cap the wait at ANIM_MAX_WAIT_MS from batch start. Within that
  // ceiling, settle-debounce by ANIM_SETTLE_MS so a quiet partial gap
  // still produces an early flush.
  var elapsed = now - animBatchStartT;
  var remaining = Math.max(0, ANIM_MAX_WAIT_MS - elapsed);
  var delay = Math.min(ANIM_SETTLE_MS, remaining);

  if (animDebounceTimer != null) clearTimeout(animDebounceTimer);

  animDebounceTimer = setTimeout(function()
  {
    animDebounceTimer = null;
    animBatchStartT = 0;
    flushCellAnimations(graph);
  }, delay);
}

/**
 * Run pop/fade animations on all batched cells.
 *
 * Animations are scheduled in BFS topological order across the batch:
 * vertices with no in-batch incoming edges animate first (level 0),
 * their outgoing edges pen-draw a beat later, target vertices pop on
 * the next level, and so on. The result reads like a flow diagram
 * being authored from upstream to downstream.
 */
function flushCellAnimations(graph)
{
  if (graph == null || pendingAnimCellIds.length === 0) return;

  var ids = pendingAnimCellIds;
  pendingAnimCellIds = [];

  graph.view.validate();

  var readyCells = [];
  var readyVertices = [];
  var readyEdges = [];
  var deferred = [];

  for (var i = 0; i < ids.length; i++)
  {
    var cell = graph.model.getCell(ids[i]);

    if (cell == null) continue;

    var state = graph.view.getState(cell);
    var hasBounds = state != null && (state.width > 1 || state.height > 1);

    if (!cell.edge && !hasBounds)
    {
      // Vertex without proper bounds — geometry not yet streamed
      deferred.push(ids[i]);
      continue;
    }

    readyCells.push(cell);

    if (cell.edge) readyEdges.push(cell);
    else readyVertices.push(cell);
  }

  if (deferred.length > 0)
  {
    for (var d = 0; d < deferred.length; d++)
    {
      deferredAnimCellIds.push(deferred[d]);
    }
  }

  if (readyCells.length === 0) return;

  for (var a = 0; a < readyCells.length; a++)
  {
    animatedCellIds[readyCells[a].id] = true;
  }

  var schedule = computeAnimSchedule(readyVertices, readyEdges);

  // Track when this batch's animations will be fully settled, so the
  // postLayout morph can wait for opacity to reach 1 before snapshotting.
  // Vertex pop-in is 400 ms; edge pen-draw is 500 ms; edge label fade is
  // an additional 0.4 s offset + 0.3 s duration after the edge.
  var maxEndMs = 0;
  for (var v2 = 0; v2 < readyVertices.length; v2++)
  {
    var vEnd = (schedule.vertexDelay[readyVertices[v2].id] || 0) + 400;
    if (vEnd > maxEndMs) maxEndMs = vEnd;
  }
  for (var e3 = 0; e3 < readyEdges.length; e3++)
  {
    var eEnd = (schedule.edgeDelay[readyEdges[e3].id] || 0) + 700;
    if (eEnd > maxEndMs) maxEndMs = eEnd;
  }
  var nowFlush = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
  var batchEndT = nowFlush + maxEndMs;
  if (batchEndT > lastAnimEndT) lastAnimEndT = batchEndT;

  // Vertices: pop-scale + fade keyed by topological level.
  for (var v = 0; v < readyVertices.length; v++)
  {
    var vCell = readyVertices[v];
    var vs = graph.view.getState(vCell);
    if (vs == null) continue;
    var delaySec = (schedule.vertexDelay[vCell.id] || 0) / 1000;

    // 400 ms = pop-in transition duration in popInVertexNode. Cells whose
    // geometry shifts inside this window get their morph deferred until
    // after pop-in settles (see applyMorphAnimations).
    popInEndsAt[vCell.id] = nowFlush + (delaySec * 1000) + 400;

    if (vs.shape != null && vs.shape.node != null)
    {
      popInVertexNode(vs.shape.node, vs, delaySec);
    }
    if (vs.text != null && vs.text.node != null)
    {
      fadeInWithDelay(vs.text.node, delaySec);
    }
  }

  // Edges: pen-draw a beat after their source vertex; labels follow.
  for (var ec = 0; ec < readyEdges.length; ec++)
  {
    var eCell = readyEdges[ec];
    var es = graph.view.getState(eCell);
    if (es == null) continue;
    var eDelaySec = (schedule.edgeDelay[eCell.id] || 0) / 1000;

    if (es.shape != null && es.shape.node != null)
    {
      drawInEdgeNode(es.shape.node, eDelaySec);
    }
    if (es.text != null && es.text.node != null)
    {
      fadeInWithDelay(es.text.node, eDelaySec + 0.4);
    }
  }
}

/**
 * Resolve once any queued / in-flight pop-in animations have fully
 * settled (opacity has reached 1 on every cell). Used by the postLayout
 * path to gate mxMorphing without imposing a fixed delay — short
 * animations don't have to wait, deep diagrams get exactly as long as
 * they need. Has a 2.5 s safety cap so a stuck deferred queue can't
 * deadlock the morph.
 */
function waitForPendingAnimationsToSettle()
{
  return new Promise(function(resolve)
  {
    var nowFn = function()
    {
      return (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
    };
    var deadline = nowFn() + 2500;

    var check = function()
    {
      var now = nowFn();
      if (now > deadline) { resolve(); return; }

      // Still cells queued or a debounce timer pending — come back
      // shortly. queueCellAnimation will eventually flush and update
      // lastAnimEndT, at which point the next branch handles waiting
      // for the in-flight transitions to complete.
      if (pendingAnimCellIds.length > 0 || animDebounceTimer != null)
      {
        setTimeout(check, 30);
        return;
      }

      var remaining = lastAnimEndT - now;
      if (remaining > 0)
      {
        setTimeout(resolve, remaining);
      }
      else
      {
        resolve();
      }
    };

    check();
  });
}

// --- Topological animation scheduling ---

// Time between successive levels (vertex-edge-vertex-edge-...).
var ANIM_LEVEL_STEP_MS = 120;
// Edge starts this much after its source vertex begins popping.
var ANIM_EDGE_OFFSET_MS = 60;
// Cap on level so a long linear flowchart doesn't take forever.
var ANIM_MAX_LEVEL = 6;

/**
 * Build per-cell animation delays via Kahn's topological sort across
 * the in-batch vertex/edge subgraph. Cells outside the batch are
 * ignored; cycle members default to level 0.
 */
function computeAnimSchedule(readyVertices, readyEdges)
{
  var inDeg = {};
  var outAdj = {};
  var inBatch = {};

  for (var v = 0; v < readyVertices.length; v++)
  {
    var id = readyVertices[v].id;
    inDeg[id] = 0;
    outAdj[id] = [];
    inBatch[id] = true;
  }

  for (var e = 0; e < readyEdges.length; e++)
  {
    var edge = readyEdges[e];
    var s = edge.source != null ? edge.source.id : null;
    var t = edge.target != null ? edge.target.id : null;
    if (s != null && t != null && inBatch[s] && inBatch[t])
    {
      outAdj[s].push(t);
      inDeg[t]++;
    }
  }

  var level = {};
  var queue = [];

  for (var rId in inDeg)
  {
    if (inDeg[rId] === 0)
    {
      level[rId] = 0;
      queue.push(rId);
    }
  }

  // Pure cycle in batch: seed any vertex as a root so BFS still runs.
  if (queue.length === 0)
  {
    for (var seedId in inDeg)
    {
      level[seedId] = 0;
      queue.push(seedId);
      break;
    }
  }

  while (queue.length > 0)
  {
    var u = queue.shift();
    var nbrs = outAdj[u];
    for (var n = 0; n < nbrs.length; n++)
    {
      var tId = nbrs[n];
      var newL = Math.min(level[u] + 1, ANIM_MAX_LEVEL);
      if (level[tId] == null || level[tId] < newL)
      {
        level[tId] = newL;
      }
      inDeg[tId]--;
      if (inDeg[tId] === 0)
      {
        queue.push(tId);
      }
    }
  }

  for (var leftId in outAdj)
  {
    if (level[leftId] == null) level[leftId] = 0;
  }

  var vertexDelay = {};
  for (var vid in level) vertexDelay[vid] = level[vid] * ANIM_LEVEL_STEP_MS;

  var edgeDelay = {};
  for (var e2 = 0; e2 < readyEdges.length; e2++)
  {
    var edge2 = readyEdges[e2];
    var s2 = edge2.source != null ? edge2.source.id : null;
    var sLevel = (s2 != null && level[s2] != null) ? level[s2] : 0;
    edgeDelay[edge2.id] = sLevel * ANIM_LEVEL_STEP_MS + ANIM_EDGE_OFFSET_MS;
  }

  return { vertexDelay: vertexDelay, edgeDelay: edgeDelay };
}

/**
 * Pop-in animation for a vertex: opacity 0→1 with a subtle scale
 * 0.95→1.0 around the cell's center. The CSS transform composes with
 * mxGraph's SVG transform attribute via transform-box: fill-box, so
 * the cell stays where mxGraph placed it.
 */
function popInVertexNode(node, state, delaySec)
{
  node.style.opacity = '0';
  node.style.visibility = 'visible';
  node.style.transformBox = 'fill-box';
  node.style.transformOrigin = 'center';
  node.style.transform = 'scale(0.95)';
  node.style.transition =
    'opacity 0.4s ease-out ' + delaySec + 's, ' +
    'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ' + delaySec + 's';

  requestAnimationFrame(function()
  {
    node.style.opacity = '1';
    node.style.transform = 'scale(1)';
  });

  setTimeout(function()
  {
    node.style.transition = '';
    node.style.transform = '';
    node.style.transformBox = '';
    node.style.transformOrigin = '';
  }, 450 + delaySec * 1000);
}

/**
 * Pen-draw an edge by animating SVG stroke-dashoffset from the path's
 * total length to 0. Applies to every <path> descendant of the edge's
 * shape node, so arrowheads pen-draw together with the body. delaySec
 * staggers the start so edges from a topologically-earlier vertex
 * draw before those from later ones.
 */
function drawInEdgeNode(edgeNode, delaySec)
{
  if (edgeNode == null) return;
  delaySec = delaySec || 0;

  // streamMergeXmlDelta's pre-hide pass sets opacity:0 on every shape
  // node whose ID is in pendingAnimCellIds — including edges. The
  // pen-draw path doesn't otherwise touch group opacity, so the edge
  // group would stay invisible while stroke-dashoffset transitions
  // underneath. Force opacity back to 1 here.
  edgeNode.style.opacity = '1';
  edgeNode.style.visibility = 'visible';

  var paths = edgeNode.querySelectorAll('path');
  for (var i = 0; i < paths.length; i++)
  {
    drawInPath(paths[i], delaySec);
  }
}

function drawInPath(path, delaySec)
{
  delaySec = delaySec || 0;

  var len = 0;
  try { len = path.getTotalLength(); } catch (e) {}

  if (!isFinite(len) || len <= 0)
  {
    // No measurable length (e.g. zero-length filler segment) — fade.
    fadeInWithDelay(path, delaySec);
    return;
  }

  // Clear any in-flight pen-draw state on this path before we start.
  // If a prior drawInPath is still mid-animation when we get here
  // (streaming pen-draw still running while postLayout's pen-draw
  // kicks off), capturing path.style as "previous" would lock in
  // dasharray = "len len" — i.e. the path stays invisible forever
  // after both cleanups fire. Clearing first guarantees we're working
  // from a clean slate.
  path.style.transition = '';
  path.style.strokeDasharray = '';
  path.style.strokeDashoffset = '';

  path.style.strokeDasharray  = String(len);
  path.style.strokeDashoffset = String(len);
  // Force reflow so the start state is captured before we transition.
  path.getBoundingClientRect();
  path.style.transition = 'stroke-dashoffset 0.5s ease-out ' + delaySec + 's';

  // Per-path token: when overlapping deltas pen-draw the same path,
  // only the latest scheduled cleanup is allowed to clear the inline
  // dash state. Otherwise an older setTimeout fires mid-flight and
  // wipes strokeDasharray/strokeDashoffset on the newer animation,
  // causing a visible flicker.
  var token = (path.__penDrawToken || 0) + 1;
  path.__penDrawToken = token;

  requestAnimationFrame(function()
  {
    path.style.strokeDashoffset = '0';
  });

  // Always reset to '' on cleanup. Original dashing for styles like
  // dashed=1 comes from SVG attributes, not inline CSS — clearing the
  // inline values lets the underlying attribute take over again.
  setTimeout(function()
  {
    if (path.__penDrawToken !== token) return;
    path.style.transition = '';
    path.style.strokeDasharray = '';
    path.style.strokeDashoffset = '';
  }, 600 + delaySec * 1000);
}

function fadeInWithDelay(node, delaySec)
{
  node.style.opacity = '0';
  node.style.visibility = 'visible';
  node.style.transition = 'opacity 0.3s ease-out ' + delaySec + 's';

  requestAnimationFrame(function()
  {
    node.style.opacity = '1';
  });

  setTimeout(function()
  {
    node.style.transition = '';
  }, 350 + delaySec * 1000);
}

/**
 * Drain morphPrePositions: for each cell whose pre-merge rendered
 * position differs from its post-merge rendered position, animate the
 * visual offset back to zero via the CSS 'translate' property. This
 * runs entirely on the compositor (transform/translate are GPU-promoted
 * properties) and is per-cell, so overlapping morphs from rapid deltas
 * do not collide with each other or with the camera animation.
 *
 * Edges connected to a morphing endpoint are hidden immediately and
 * pen-drawn after the morph settles — without this they'd dangle
 * between the new model endpoint and the visually-offset vertex.
 */
function applyMorphAnimations(graph)
{
  var ids = Object.keys(morphPrePositions);
  if (ids.length === 0) return;

  graph.view.validate();

  var model = graph.getModel();
  var morphedIdSet = {};
  var nowMorph = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();

  for (var i = 0; i < ids.length; i++)
  {
    var id = ids[i];
    var pre = morphPrePositions[id];
    var cell = model.getCell(id);

    if (cell == null) continue;

    var state = graph.view.getState(cell);
    if (state == null) continue;

    var dx = pre.x - state.x;
    var dy = pre.y - state.y;

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

    // Skip morph if the cell's pop-in transition hasn't settled yet —
    // morphNodeBy would overwrite style.transition and snap opacity /
    // transform to their final pop-in values, producing a visible flicker.
    // The cell stays at its new model position (slight teleport) which is
    // imperceptible during a fade-in. Edges connected to it are routed to
    // the new endpoint already, so we don't queue a pen-redraw either.
    if (popInEndsAt[id] != null && popInEndsAt[id] > nowMorph) continue;

    morphedIdSet[id] = true;

    if (state.shape != null && state.shape.node != null)
    {
      morphNodeBy(state.shape.node, dx, dy);
    }

    if (state.text != null && state.text.node != null)
    {
      morphNodeBy(state.text.node, dx, dy);
    }
  }

  morphPrePositions = {};

  hideAndRedrawEdgesForMorph(graph, morphedIdSet);
}

/**
 * Apply a CSS 'translate' of (dx, dy) to a single SVG node and animate
 * it back to (0, 0) over MORPH_DURATION_MS. If a previous morph is
 * still mid-flight, snapshot its current visual offset and use that as
 * the new starting point so the cell continues smoothly from where it
 * was instead of snapping back to identity.
 */
function morphNodeBy(node, dx, dy)
{
  // If a prior morph is still transitioning, the computed translate
  // is somewhere between (priorDx, priorDy) and (0, 0). Read it and
  // add to the new delta so the start of THIS animation is exactly
  // where the cell is currently visible.
  var current = parseTranslate(node);

  // Compose with any existing transition (e.g. an in-flight pop-in
  // animating opacity / transform) instead of overwriting — overwriting
  // would kill the other transitions and snap them to their final inline
  // values, producing a visible flicker. We drop only the prior
  // 'translate' entry so our new translate transition replaces it cleanly.
  var prior = (node.style.transition || '')
    .split(',')
    .map(function(s) { return s.trim(); })
    .filter(function(s)
    {
      return s.length > 0 && s.indexOf('translate') !== 0;
    });

  // Cancel any in-flight translate transition before we set the new
  // start value, otherwise the assignment itself would animate.
  node.style.transition = (prior.length > 0 ? prior.join(', ') + ', ' : '') + 'translate 0s';
  node.style.translate = (dx + current.x) + 'px ' + (dy + current.y) + 'px';

  // Force layout flush so the start state is captured before we
  // re-enable transitions.
  node.getBoundingClientRect();

  var newTranslate = 'translate ' + MORPH_DURATION_MS + 'ms ease-out';
  node.style.transition = (prior.length > 0 ? prior.join(', ') + ', ' : '') + newTranslate;

  // Per-node token: a stale setTimeout from a prior morph must not
  // clear transition/translate while a fresh morph is mid-flight.
  // String-comparing node.style.transition doesn't work because
  // every morph sets the same canonical transition string.
  var token = (node.__morphToken || 0) + 1;
  node.__morphToken = token;

  requestAnimationFrame(function()
  {
    node.style.translate = '0 0';
  });

  setTimeout(function()
  {
    if (node.__morphToken !== token) return;
    node.style.transition = '';
    node.style.translate = '';
  }, MORPH_DURATION_MS + 50);
}

function parseTranslate(node)
{
  var raw = '';
  try { raw = window.getComputedStyle(node).translate; }
  catch (e) { return { x: 0, y: 0 }; }

  if (raw == null || raw === '' || raw === 'none') return { x: 0, y: 0 };

  // Computed value format: "Xpx", "Xpx Ypx", or "Xpx Ypx Zpx".
  var parts = raw.split(/\\s+/);
  var x = parseFloat(parts[0]);
  var y = (parts.length > 1) ? parseFloat(parts[1]) : 0;

  return {
    x: isFinite(x) ? x : 0,
    y: isFinite(y) ? y : 0
  };
}

/**
 * For every edge whose source or target was morphed, hide the edge
 * group immediately and fade it back in after the morph settles.
 * Without hiding, the edge path is laid out from the NEW model terminal
 * positions while the vertex visually sits at its OLD position, leaving
 * a brief gap or dangling segment. A full pen-draw was the original
 * recovery, but Mermaid re-layouts shift many cells per partial and
 * the repeated stroke-dashoffset wipes read as noisy; a quick opacity
 * fade hides the disconnect just as well.
 */
function hideAndRedrawEdgesForMorph(graph, morphedIdSet)
{
  var morphedIds = Object.keys(morphedIdSet);
  if (morphedIds.length === 0) return;

  var model = graph.getModel();
  // Per-node redraw token: when overlapping morphs hide the same edge
  // shape/label, only the LATEST scheduled pen-draw owns the redraw.
  // Older setTimeouts find a mismatched token and skip — without this
  // gate, an older callback would re-trigger drawInEdgeNode and reset
  // a newer in-flight stroke from opacity 0, producing the flicker.
  var pendingShape = []; // [{ node, token }]
  var pendingText  = []; // [{ node, token }]
  var seen = [];

  for (var m = 0; m < morphedIds.length; m++)
  {
    var cell = model.getCell(morphedIds[m]);
    if (cell == null || cell.edges == null) continue;

    for (var e = 0; e < cell.edges.length; e++)
    {
      var edge = cell.edges[e];
      if (edge == null) continue;
      // Skip edges that are about to pop-animate (new this delta) —
      // queueCellAnimation owns their visibility lifecycle.
      if (pendingAnimCellIds.indexOf(edge.id) !== -1) continue;
      if (seen.indexOf(edge) !== -1) continue;
      seen.push(edge);

      var es = graph.view.getState(edge);
      if (es == null) continue;

      if (es.shape != null && es.shape.node != null)
      {
        var sn = es.shape.node;
        sn.style.opacity = '0';
        var st = (sn.__edgeRedrawToken || 0) + 1;
        sn.__edgeRedrawToken = st;
        pendingShape.push({ node: sn, token: st });
      }
      if (es.text != null && es.text.node != null)
      {
        var tn = es.text.node;
        tn.style.opacity = '0';
        var tt = (tn.__edgeRedrawToken || 0) + 1;
        tn.__edgeRedrawToken = tt;
        pendingText.push({ node: tn, token: tt });
      }
    }
  }

  if (pendingShape.length === 0 && pendingText.length === 0) return;

  // Fade back in after the vertex morph has settled — the edge geometry
  // is already correct (laid out from the new terminal positions);
  // we just need it offscreen until the vertex visuals catch up.
  setTimeout(function()
  {
    for (var i = 0; i < pendingShape.length; i++)
    {
      var es = pendingShape[i];
      if (es.node.__edgeRedrawToken !== es.token) continue;
      fadeInWithDelay(es.node, 0);
    }
    for (var j = 0; j < pendingText.length; j++)
    {
      var et = pendingText[j];
      if (et.node.__edgeRedrawToken !== et.token) continue;
      fadeInWithDelay(et.node, 0);
    }
  }, MORPH_DURATION_MS);
}

/**
 * Hide every edge (and its label) by setting opacity:0 on its SVG
 * shape and text nodes. Used right before a layout-change mxMorphing:
 * vertices animate cleanly to their new positions without dragging
 * around stale waypoints. Pen-draw later fades them back in.
 */
function hideAllEdgesForMorph(graph)
{
  if (graph == null) return;
  graph.view.validate();
  var model = graph.getModel();
  for (var id in model.cells)
  {
    var cell = model.cells[id];
    if (cell == null || !cell.edge) continue;
    var state = graph.view.getState(cell);
    if (state == null) continue;
    if (state.shape != null && state.shape.node != null)
    {
      state.shape.node.style.opacity = '0';
    }
    if (state.text != null && state.text.node != null)
    {
      state.text.node.style.opacity = '0';
    }
  }
}

/**
 * Pen-draw every edge using the streaming schedule (BFS levels via
 * computeAnimSchedule). Called after a layout-change mxMorphing
 * completes, so edges fade in along the topological order rather than
 * snapping in all at once.
 */
function penDrawAllEdgesAfterMorph(graph)
{
  if (graph == null) return;
  graph.view.validate();
  var model = graph.getModel();
  var edges = [];
  var vertices = [];
  for (var id in model.cells)
  {
    if (id === '0' || id === '1') continue;
    var cell = model.cells[id];
    if (cell == null) continue;
    if (cell.edge) edges.push(cell);
    else if (cell.vertex) vertices.push(cell);
  }
  if (edges.length === 0) return;
  var schedule = computeAnimSchedule(vertices, edges);
  for (var i = 0; i < edges.length; i++)
  {
    var eCell = edges[i];
    var es = graph.view.getState(eCell);
    if (es == null) continue;
    var eDelaySec = (schedule.edgeDelay[eCell.id] || 0) / 1000;
    if (es.shape != null && es.shape.node != null)
    {
      drawInEdgeNode(es.shape.node, eDelaySec);
    }
    if (es.text != null && es.text.node != null)
    {
      fadeInWithDelay(es.text.node, eDelaySec + 0.4);
    }
  }
}

/**
 * Simple fade-in for every edge. Used after the layout-button morph
 * where the topological pen-draw "wipe" feels too slow — we just want
 * the edges to reappear quickly once the vertices have settled.
 */
function fadeInAllEdgesAfterMorph(graph)
{
  if (graph == null) return;
  graph.view.validate();
  var model = graph.getModel();
  for (var id in model.cells)
  {
    var cell = model.cells[id];
    if (cell == null || !cell.edge) continue;
    var state = graph.view.getState(cell);
    if (state == null) continue;
    if (state.shape != null && state.shape.node != null)
    {
      fadeInWithDelay(state.shape.node, 0);
    }
    if (state.text != null && state.text.node != null)
    {
      fadeInWithDelay(state.text.node, 0);
    }
  }
}

// --- Streaming camera ---
//
// CSS-transform based soft-follow. mxGraph's view stays at scale=1,
// translate=(0,0) so cell DOM positions don't churn during animation.
// The visible camera lives in viewTransform and is applied as
// "transform: scale(s) translate(tx, ty)" on the SVG element, with
// a CSS transition handling the easing — no rAF loop, no spring math.
//
// During streaming we soft-follow the leading edge: each partial,
// recentVertexQueue holds the cells added in roughly the last
// STREAM_RECENT_TTL_MS, plus a length cap. The camera fits the bbox
// of those cells inflated by a generous context padding so the user
// sees the new content with breathing room rather than a tight zoom.
// We never zoom IN beyond fit-whole — the fit-whole scale is a hard
// upper bound, so as the diagram grows the camera only zooms out.
//
// At finalize / Fit / postLayout, we clear recentVertexQueue; the
// focus bbox falls back to the whole diagram and the same code path
// produces a fit-whole target. The CSS transition eases the camera
// from the leading-edge view to the whole view in one smooth pull-back.

// Minimum height — keeps trivial diagrams from collapsing to a sliver
// while staying compact enough that the user doesn't see a big empty
// frame for one or two cells.
var STREAM_VIEWPORT_MIN_HEIGHT = 200;
// Hard cap on the iframe height in inline mode. The host grows the
// iframe in response to sendSizeChanged but doesn't honor shrinks,
// so we have to start conservative — anything taller than this would
// push the chat prompt off-screen on typical laptop viewports.
// Must match the CSS max-height on #diagram-container.streaming
// (--inline-max-h) so the JS fit math agrees with the rendered height.
// The Expand toolbar button bumps this to STREAM_VIEWPORT_MAX_HEIGHT_EXPANDED
// for diagrams where 480 px clips a tall layout.
var STREAM_VIEWPORT_MAX_HEIGHT_INLINE = 480;
var STREAM_VIEWPORT_MAX_HEIGHT_INLINE_DEFAULT = 480;
var STREAM_VIEWPORT_MAX_HEIGHT_EXPANDED = 1000;
// Padding around the focus bbox at fit-whole, in container pixels.
var STREAM_VIEWPORT_PADDING = 24;
// Minimum scale clamp — large diagrams need to zoom out enough that
// the whole bbox fits inside the container.
var STREAM_MIN_SCALE = 0.05;
// Hard cap on queue length. Kept small so the focus bbox tracks just
// the latest few cells — if it includes most of the diagram, the
// inflated rect clips back to wholeBBox and there's no soft-follow.
// No TTL: see getRecentVertexIds for why time-based aging was removed
// (caused fit-whole yo-yos during LLM pauses between vertex partials).
// Limit of 1: focus on the single most recent cell. Two leaves at
// opposite ends of the diagram (e.g. a top-level service and a far-
// right S3 bucket) would otherwise unite into a wide bbox and force a
// big zoom-out. With limit=1 the camera simply pans between leaves
// in the slow XML streaming case.
var STREAM_RECENT_LIMIT = 1;
// Mermaid streams differently: the parser fires once with all of
// the diagram's cells in a single call. Limiting the queue to 1
// would discard 15 of 16 cells and give the camera nothing useful
// to focus on. Restore the original 4-cell cap for that path so
// the camera sits on the most recently-added cluster of nodes.
var STREAM_RECENT_LIMIT_MERMAID = 4;
// Context padding around the recent-cells bbox, expressed as a
// fraction of the larger of (bbox width, bbox height). 0.4 keeps the
// recent cells filling most of the camera with a comfortable margin —
// large enough that the next cell usually still appears inside the
// view, small enough that there's a visible pull-back at finalize.
var STREAM_FOCUS_CONTEXT_FACTOR = 0.4;
// CSS transition timing for camera moves during streaming. Drag
// disables the transition for direct response. The cubic-bezier is
// a gentle ease-in-out — small acceleration off the previous target,
// smooth landing on the new one. No overshoot.
// Duration scales with the magnitude of the camera change. Bumped
// the floor up so rapid retargeting (LLM streaming partials every
// ~100 ms) blends through CSS interpolation instead of jumping
// between targets — every new transition has enough runway to look
// continuous instead of stuttery.
var STREAM_TRANSITION_MIN_MS = 520;
var STREAM_TRANSITION_MAX_MS = 1100;
var STREAM_TRANSITION_EASING = 'cubic-bezier(0.4, 0, 0.6, 1)';
// Per-extra-cell zoom-out coefficient. lastBatchSize=1 produces
// no pull-back; larger batches multiply targetScale down so the
// camera "moves out more" — Mermaid arrives in a single big
// partial, so without this the focus rect saturates to wholeBBox
// and there's no visible pull-back.
var STREAM_BATCH_PULLBACK_K = 0.06;
var STREAM_BATCH_PULLBACK_MIN = 0.45;
// Cap on close-up zoom while soft-following recent cells. Allowing
// up to 1:1 lets the camera focus on a small recent area when the
// diagram is bigger than the viewport. We never zoom IN past 1:1 —
// that would inflate text past native size and look broken.
var STREAM_FOLLOW_MAX_SCALE = 1.0;
// Per-step zoom-out cap: when a new partial wants to widen the view,
// the new target scale can drop to at most this fraction of the
// previous target. Without this, a fresh container introduced after
// a tight leaf focus would yank the camera all the way out to fit
// the whole container; with it, the camera does a "slight pull-back
// to show structure" then zooms back in on the next leaf.
var STREAM_ZOOM_OUT_CAP = 0.7;
// Extra space reserved at the bottom of the container so the diagram
// never visually touches the toolbar / card edge.
var STREAM_BOTTOM_GUTTER = 16;

// Insertion-ordered queue of recent vertex additions: [{id, t}, ...].
// Cleared by endStreaming and by customFitView / finalize so the
// focus bbox falls back to the whole diagram.
var recentVertexQueue = [];
// Size of the most recent partial's batch. Drives the batch
// pull-back multiplier so big Mermaid partials zoom out further
// than incremental XML appends.
var lastBatchSize = 0;
// Ring buffer of last N partial-arrival timestamps. Used to derive
// the streaming cadence so transition durations adapt to how quickly
// cells are being added (slow stream → longer transitions).
var streamArrivalTimes = [];
// Target scale of the previous streamFollowNewCells retarget. Drives
// the per-step zoom-out cap (STREAM_ZOOM_OUT_CAP).
var streamLastTargetScale = null;
// The cap baseline frozen for the current partial: captured from
// streamLastTargetScale on the FIRST call after queuedIds changes,
// then held constant across subsequent calls (rAF / resize) so the
// cap doesn't decay against its own just-applied output.
var streamPartialBaseline = null;
var streamLastQueueSig = '';
// Threshold above which we treat a partial as "big batch" (Mermaid's
// one-shot full diagram). Big batches skip the per-step cap and need
// a wide focus to fit the whole new content.
var STREAM_BIG_BATCH_THRESHOLD = 3;
// 'xml' or 'mermaid' — set by trackPartialFocus / handleMermaidPartial
// before they call trackRecentCells, so trackRecentCells can pick the
// right queue limit and streamFollowNewCells can skip XML-specific
// camera tweaks for the Mermaid path.
var streamMode = null;


/**
 * Median delta between recent partial arrivals, in ms. Returns a
 * sensible default when the buffer is too small to estimate.
 */
function getStreamCadenceMs()
{
  if (streamArrivalTimes.length < 2) return 1200;
  var deltas = [];
  for (var i = 1; i < streamArrivalTimes.length; i++)
  {
    deltas.push(streamArrivalTimes[i] - streamArrivalTimes[i - 1]);
  }
  deltas.sort(function(a, b) { return a - b; });
  return deltas[Math.floor(deltas.length / 2)];
}

// Visible camera transform applied via CSS transform on the SVG. The
// math matches mxGraph's scaleAndTranslate: a model point (Mx, My)
// maps to screen (s*(Mx + tx), s*(My + ty)) when transform-origin
// is at the SVG's top-left.
var viewTransform = { scale: 1, tx: 0, ty: 0 };
var viewTransformSvg = null;

/**
 * Compute the bbox of cells (in model-space, with parent offsets) from
 * an array of cell IDs. Returns null when no usable geometry was found.
 */
function computeCellsBBox(model, ids)
{
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  var any = false;

  for (var i = 0; i < ids.length; i++)
  {
    var cell = model.getCell(ids[i]);
    if (cell == null || !cell.visible) continue;
    var geo = cell.geometry;
    if (geo == null || geo.relative) continue;

    var ox = 0, oy = 0;
    var p = model.getParent(cell);

    while (p != null && p.id !== '0' && p.id !== '1')
    {
      if (p.geometry != null && !p.geometry.relative)
      {
        ox += p.geometry.x;
        oy += p.geometry.y;
      }

      p = model.getParent(p);
    }

    var x1 = geo.x + ox;
    var y1 = geo.y + oy;
    var x2 = x1 + (geo.width || 0);
    var y2 = y1 + (geo.height || 0);

    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
    any = true;
  }

  if (!any) return null;
  return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}

/**
 * Compute the bbox of all visible cells in the graph model.
 */
function computeWholeBBox(model)
{
  var ids = [];
  for (var id in model.cells)
  {
    if (id === '0' || id === '1') continue;
    ids.push(id);
  }
  return computeCellsBBox(model, ids);
}

/**
 * Record vertex IDs as recently added so the soft-follow camera
 * focuses on them. Edges are excluded by the caller (a long edge
 * can span the whole diagram and would defeat the close-up).
 */
function trackRecentCells(ids)
{
  if (ids == null || ids.length === 0) return;
  var now = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();

  for (var i = 0; i < ids.length; i++)
  {
    recentVertexQueue.push({ id: ids[i], t: now });
  }

  // Per-mode queue cap. Mermaid's one-shot batch needs its original
  // 4-cell window so the camera can focus on the latest cluster
  // instead of the whole diagram. XML's incremental stream caps at 1
  // (latest cell only), expanded by the partial's batch size for
  // edge-endpoint pairs.
  var effectiveLimit;
  if (streamMode === 'mermaid')
  {
    effectiveLimit = STREAM_RECENT_LIMIT_MERMAID;
  }
  else
  {
    effectiveLimit = Math.max(STREAM_RECENT_LIMIT, ids.length);
  }
  if (recentVertexQueue.length > effectiveLimit)
  {
    recentVertexQueue = recentVertexQueue.slice(-effectiveLimit);
  }

  streamArrivalTimes.push(now);
  if (streamArrivalTimes.length > 5)
  {
    streamArrivalTimes = streamArrivalTimes.slice(-5);
  }

  lastBatchSize = ids.length;

}

/**
 * Replace recentVertexQueue with the given IDs. Used when an edge-only
 * (or edge+vertex) XML partial arrives: we want the camera to focus
 * tightly on the new edge being inserted, not on a wide bbox that
 * mixes the new endpoints with stale vertices left over from earlier
 * partials. Vertex-only partials keep the soft-follow append behavior.
 */
function replaceRecentCells(ids)
{
  recentVertexQueue = [];
  if (ids == null || ids.length === 0)
  {
    lastBatchSize = 0;
    return;
  }
  trackRecentCells(ids);
}

/**
 * Return the IDs currently in recentVertexQueue. The queue is bounded
 * by STREAM_RECENT_LIMIT (newest cells push out older ones) and is
 * cleared at finalizeStreamingView / endStreaming / customFitView.
 *
 * No time-based pruning: previously a 2 s TTL aged the queue out
 * during LLM pauses, which made the camera glide to fit-whole between
 * vertex partials and then snap back when the next cell arrived — a
 * visible zoom-out / zoom-in yo-yo. The queue now just holds the most
 * recent N cells until streaming finishes, so the camera stays on the
 * latest content during pauses instead of repeatedly reverting to the
 * overview.
 */
function getRecentVertexIds()
{
  if (recentVertexQueue.length === 0) return [];
  var ids = [];
  for (var i = 0; i < recentVertexQueue.length; i++)
  {
    ids.push(recentVertexQueue[i].id);
  }
  return ids;
}

/**
 * Drop any queued cell that is an ancestor of another queued cell.
 * Without this, a queued container's bbox swallows its queued children
 * (the union equals the container's own bounds) and the camera can't
 * zoom in on action happening inside the group. With it, the deepest
 * descendants win — when sibling groups are queued together neither is
 * an ancestor of the other, so the union still grows and produces the
 * brief pull-back at sibling-group boundaries.
 */
function filterRecentAncestors(model, ids)
{
  if (ids.length < 2) return ids;
  var idSet = {};
  for (var i = 0; i < ids.length; i++)
  {
    idSet[ids[i]] = true;
  }
  var drop = {};
  for (var i = 0; i < ids.length; i++)
  {
    var cell = model.getCell(ids[i]);
    if (cell == null) continue;
    var p = model.getParent(cell);
    while (p != null)
    {
      if (p.id != null && idSet[p.id]) drop[p.id] = true;
      p = model.getParent(p);
    }
  }
  var out = [];
  for (var i = 0; i < ids.length; i++)
  {
    if (!drop[ids[i]]) out.push(ids[i]);
  }
  return out;
}

/**
 * Pick a transition duration that scales with the magnitude of the
 * camera change. Tiny nudges stay snappy (~MIN_MS); big finalize-style
 * settles get a longer, graceful transition (~MAX_MS) — long enough
 * for the SVG to keep up with rendering during streaming.
 */
function computeTransitionDuration(curS, curTx, curTy, tgtS, tgtTx, tgtTy, viewportSpan)
{
  var dS = Math.abs(curS - tgtS) / Math.max(curS, tgtS, 0.001);
  var span = Math.max(viewportSpan || 1, 1);
  // Translation magnitude in screen pixels (approx).
  var s = Math.max(curS, tgtS);
  var dPx = (Math.abs(curTx - tgtTx) + Math.abs(curTy - tgtTy)) * s;
  // Normalize: scale change of 50% or translate of viewport-span both
  // count as "big" change (factor ~ 1).
  var factor = Math.min(1, Math.max(dS * 2, dPx / span));
  // Cadence-aware ceiling: aim for transitions that complete just as
  // the next partial arrives, so the camera glides continuously
  // instead of sprinting + waiting. 0.9 leaves a tiny rest at the
  // target before retargeting; clamped to a sane band so unusually
  // fast or slow streams still behave.
  var cadence = getStreamCadenceMs();
  var maxMs = Math.max(STREAM_TRANSITION_MIN_MS,
                       Math.min(2200, cadence * 0.9));
  var dur = STREAM_TRANSITION_MIN_MS +
            (maxMs - STREAM_TRANSITION_MIN_MS) * factor;
  return Math.round(dur);
}

/**
 * Clamp a pan target (tx, ty at the given scale) so the diagram bbox
 * always keeps at least PAN_KEEP_MARGIN px visible on every container
 * edge. Without this, drag-with-pointer-capture lets the user panning
 * mouse outside the window pull the SVG completely off-screen with no
 * way to recover (the pointermove keeps firing with extreme coords).
 *
 * Pure-pan (drag) calls this; the streaming/finalize/Fit camera math
 * already produces in-bounds targets, so they don't need it.
 */
var PAN_KEEP_MARGIN = 80;

function clampPan(scale, tx, ty)
{
  if (streamGraph == null) return { tx: tx, ty: ty };
  var bbox = computeWholeBBox(streamGraph.getModel());
  if (bbox == null) return { tx: tx, ty: ty };
  var cw = containerEl.clientWidth;
  var ch = containerEl.clientHeight;
  if (cw <= 0 || ch <= 0) return { tx: tx, ty: ty };

  // Constraint: visible bbox in container = [scale*(minX+tx), scale*(maxX+tx)]
  // must overlap [0, cw] by at least PAN_KEEP_MARGIN px.
  var minTx = PAN_KEEP_MARGIN / scale - bbox.maxX;
  var maxTx = (cw - PAN_KEEP_MARGIN) / scale - bbox.minX;
  var minTy = PAN_KEEP_MARGIN / scale - bbox.maxY;
  var maxTy = (ch - PAN_KEEP_MARGIN) / scale - bbox.minY;

  // Defensive when range collapses (margin > visible width/height).
  if (minTx > maxTx) { var midX = (minTx + maxTx) / 2; minTx = midX; maxTx = midX; }
  if (minTy > maxTy) { var midY = (minTy + maxTy) / 2; minTy = midY; maxTy = midY; }

  return {
    tx: Math.max(minTx, Math.min(maxTx, tx)),
    ty: Math.max(minTy, Math.min(maxTy, ty))
  };
}

/**
 * Apply { scale, tx, ty } as a CSS transform on the streaming SVG.
 * mxGraph's view stays at (1, 0, 0) — the cell DOM nodes only get
 * laid out when the model changes, not when the camera moves, which
 * is what kills the label flicker that view.scaleAndTranslate caused.
 *
 * The "immediate" arg skips the CSS transition (used by drag and
 * explicit snap-fits). Otherwise the browser eases the transform
 * change over a duration scaled by magnitude.
 */
function applyViewTransform(graph, scale, tx, ty, immediate, durationMs)
{
  // External call cancels any in-flight streaming spring so drag/fit/
  // finalize callers don't get fought over by the rAF lerp loop.
  // The spring's own per-frame writes go through writeSvgTransform
  // directly, not this entry point.
  cancelStreamCameraSpring();

  if (graph == null || graph.container == null)
  {
    return;
  }

  var svg = viewTransformSvg;
  var rebound = false;
  if (svg == null || !svg.isConnected)
  {
    svg = graph.container.querySelector('svg');
    viewTransformSvg = svg;
    rebound = true;
    if (svg != null) svg.style.transformOrigin = '0 0';
  }
  if (svg == null)
  {
    return;
  }

  var dur = (durationMs != null) ? durationMs : STREAM_TRANSITION_MIN_MS;
  svg.style.transition = immediate
    ? 'none'
    : 'transform ' + dur + 'ms ' + STREAM_TRANSITION_EASING;
  svg.style.transform =
    'scale(' + scale + ') ' +
    'translate(' + tx + 'px, ' + ty + 'px)';

  viewTransform.scale = scale;
  viewTransform.tx = tx;
  viewTransform.ty = ty;
}

// --- Streaming camera spring (two-stage rAF lerp) ---
//
// During streaming the camera follows a target that updates ~10x/sec
// as new partials arrive. The *target itself* oscillates: each partial
// recomputes a focus bbox from the recent-vertex queue, and as cells
// enter/leave the bounded queue the bbox jumps — sometimes growing
// (zoom out), sometimes shrinking (zoom in). A single lerp on the
// camera follows those jumps faithfully, which reads as visible
// in/out/in/out steps.
//
// Two-stage filter fixes that:
//   raw target  --(STREAM_TARGET_LERP)-->  smoothed target  --(STREAM_LERP)-->  camera
//
// The smoothed target acts as a low-pass filter on the per-partial
// jumps; the camera then follows the smoothed target. Combined, the
// camera responds to a step in raw target as a 2nd-order low-pass —
// short jitters die out before the camera moves much, longer-term
// trends get followed continuously. Velocity is naturally continuous
// at every stage; no transition restarts.
//
// Tuning:
//   STREAM_TARGET_LERP_FACTOR (raw → smoothed): 0.10 ≈ 6.6-frame
//     half-life. Filters out 2-3 partial worth of jitter.
//   STREAM_LERP_FACTOR (smoothed → camera): 0.07 ≈ 9.5-frame half-life.
//     Adds the steady-cam lag.
//   Combined response to a target step is ~25 frames half-life, ~420 ms.
//   Convergence: only when camera matches the raw target within tight
//   thresholds (so all stages have settled).

// Equal factors → critically-damped 2nd-order response (like a movie
// steady-cam: natural S-curve velocity profile, no overshoot, no
// oscillation). Slightly slower than before so big target jumps from
// far-spanning edges fade out across more frames.
var STREAM_TARGET_LERP_FACTOR = 0.07;
var STREAM_LERP_FACTOR = 0.06;
var streamCamTarget = null;
// Smoothed target: initialized lazily on first setStreamCameraTarget,
// reset on cancelStreamCameraSpring.
var streamCamSmoothScale = null;
var streamCamSmoothTx = 0;
var streamCamSmoothTy = 0;
var streamCamRaf = 0;
// Reentrancy guard: writeSvgTransform calls from inside the spring
// loop must not cancel the spring (cancelStreamCameraSpring is called
// from applyViewTransform on every external set).
var streamCamTickActive = false;

function writeSvgTransform(graph, scale, tx, ty)
{
  if (graph == null || graph.container == null) return;
  var svg = viewTransformSvg;
  if (svg == null || !svg.isConnected)
  {
    svg = graph.container.querySelector('svg');
    viewTransformSvg = svg;
    if (svg != null) svg.style.transformOrigin = '0 0';
  }
  if (svg == null) return;
  // No CSS transition — the rAF loop is the animation.
  svg.style.transition = 'none';
  svg.style.transform =
    'scale(' + scale + ') translate(' + tx + 'px, ' + ty + 'px)';
  viewTransform.scale = scale;
  viewTransform.tx = tx;
  viewTransform.ty = ty;
}

function setStreamCameraTarget(graph, scale, tx, ty)
{
  streamCamTarget = { graph: graph, scale: scale, tx: tx, ty: ty };

  // Initialize the smoothed target lazily on the first call after a
  // clean state (or after cancelStreamCameraSpring). Seeding it from
  // the current camera position avoids a step jolt — the smoothed
  // target then lerps from camera-position toward the raw target,
  // which the camera also follows. After the first frame the smoothed
  // target tracks raw target updates as a low-pass filter.
  if (streamCamSmoothScale == null)
  {
    streamCamSmoothScale = viewTransform.scale;
    streamCamSmoothTx = viewTransform.tx;
    streamCamSmoothTy = viewTransform.ty;
  }

  if (streamCamRaf == 0)
  {
    streamCamRaf = requestAnimationFrame(streamCamTick);
  }
}

function streamCamTick()
{
  streamCamRaf = 0;
  if (streamCamTarget == null) return;

  var t = streamCamTarget;

  streamCamTickActive = true;

  // Cadence-aware slowdown: on slow streams (XML at ~3 s / cell) the
  // default factors converge in ~1 s and the camera then sits idle for
  // ~2 s before the next partial. Stretching the lerp factor keeps the
  // camera drifting until the next target arrives, producing one
  // continuous tracking motion. Gated to XML mode so Mermaid's one-
  // shot fit isn't slowed by the cadence default.
  var camCadenceMs = getStreamCadenceMs();
  var camSlowFactor = (streamMode === 'xml' && camCadenceMs > 1500)
    ? Math.max(0.4, 1500 / camCadenceMs)
    : 1.0;

  // Stage 1: smoothed target lerps toward raw target. This filters
  // out per-partial bbox jumps (e.g. a far-spanning edge that
  // momentarily expands the focus rect) so the camera doesn't have to
  // chase them all the way before the next partial overrides.
  var kT = STREAM_TARGET_LERP_FACTOR * camSlowFactor;
  streamCamSmoothScale += (t.scale - streamCamSmoothScale) * kT;
  streamCamSmoothTx += (t.tx - streamCamSmoothTx) * kT;
  streamCamSmoothTy += (t.ty - streamCamSmoothTy) * kT;

  // Stage 2: camera lerps toward the smoothed target.
  var dsRaw = t.scale - viewTransform.scale;
  var dtxRaw = t.tx - viewTransform.tx;
  var dtyRaw = t.ty - viewTransform.ty;
  var s2 = Math.max(viewTransform.scale, t.scale, 0.001);
  var dPxXRaw = Math.abs(dtxRaw) * s2;
  var dPxYRaw = Math.abs(dtyRaw) * s2;

  // Convergence: only when camera AND smoothed have both reached the
  // raw target. Stopping early would leave a stale smoothed target
  // around for the next setStreamCameraTarget call to resume from.
  var dsSmooth = t.scale - streamCamSmoothScale;
  var dPxXSmooth = Math.abs(t.tx - streamCamSmoothTx) * s2;
  var dPxYSmooth = Math.abs(t.ty - streamCamSmoothTy) * s2;

  if (Math.abs(dsRaw) < 0.0008 && dPxXRaw < 0.4 && dPxYRaw < 0.4 &&
      Math.abs(dsSmooth) < 0.0008 && dPxXSmooth < 0.4 && dPxYSmooth < 0.4)
  {
    // Snap everything to target and stop.
    streamCamSmoothScale = t.scale;
    streamCamSmoothTx = t.tx;
    streamCamSmoothTy = t.ty;
    writeSvgTransform(t.graph, t.scale, t.tx, t.ty);
    streamCamTarget = null;
    streamCamTickActive = false;
    return;
  }

  var kC = STREAM_LERP_FACTOR * camSlowFactor;
  writeSvgTransform(
    t.graph,
    viewTransform.scale + (streamCamSmoothScale - viewTransform.scale) * kC,
    viewTransform.tx + (streamCamSmoothTx - viewTransform.tx) * kC,
    viewTransform.ty + (streamCamSmoothTy - viewTransform.ty) * kC);

  streamCamTickActive = false;
  streamCamRaf = requestAnimationFrame(streamCamTick);
}

function cancelStreamCameraSpring()
{
  if (streamCamTickActive) return;
  if (streamCamRaf != 0)
  {
    cancelAnimationFrame(streamCamRaf);
    streamCamRaf = 0;
  }
  streamCamTarget = null;
  streamCamSmoothScale = null;
  streamCamSmoothTx = 0;
  streamCamSmoothTy = 0;
}

/**
 * Recompute container size + camera target for the current model and
 * apply via CSS transform. The container height tracks the WHOLE
 * diagram's natural-fit height (so the iframe grows as the diagram
 * grows). The CAMERA tracks the bbox of recently-added vertices,
 * inflated by a context margin, so the user sees the leading edge
 * with breathing room. When recentVertexQueue is empty (cleared by
 * finalize/Fit), the focus bbox falls back to the whole diagram.
 *
 * The "immediate" arg bypasses the CSS transition — used by Fit,
 * drag, and the window-resize / displayMode handlers where a snap
 * is the correct response.
 */
function streamFollowNewCells(graph, immediate, skipResize)
{
  if (graph == null) return;

  var model = graph.getModel();
  var wholeBBox = computeWholeBBox(model);
  if (wholeBBox == null) return;

  var cw = containerEl.clientWidth;
  if (cw <= 0) return;

  var wholeW = Math.max(wholeBBox.maxX - wholeBBox.minX, 1);
  var wholeH = Math.max(wholeBBox.maxY - wholeBBox.minY, 1);

  // Container height: shrink-to-fit when the diagram naturally fits
  // in less than the available viewport, otherwise cap at viewport
  // and let the camera scale further down. Skipped when skipResize
  // is true (Fit button: scale into the existing container).
  var maxH = maxViewportHeight();
  var availW0 = Math.max(cw - STREAM_VIEWPORT_PADDING * 2, 1);
  var widthFitScale = Math.min(availW0 / wholeW, 1);
  var naturalH = Math.ceil(wholeH * widthFitScale +
                           STREAM_VIEWPORT_PADDING * 2 +
                           STREAM_BOTTOM_GUTTER);
  var desiredH;
  if (currentDisplayMode === 'fullscreen')
  {
    desiredH = maxH;
  }
  else
  {
    desiredH = Math.max(STREAM_VIEWPORT_MIN_HEIGHT,
                        Math.min(naturalH, maxH));
  }

  if (!skipResize && Math.abs(containerEl.clientHeight - desiredH) > 1)
  {
    containerEl.style.height = desiredH + 'px';
    notifySize('container-resize');
  }

  // Use the ACTUAL container height for fit math — CSS constraints
  // (max-height, viewport, etc.) can clamp our requested height,
  // and using desiredH there would compute a fit that overshoots
  // the visible area and crops the bottom.
  var ch = containerEl.clientHeight || desiredH;

  var availW = Math.max(cw - STREAM_VIEWPORT_PADDING * 2, 1);
  // Reserve extra gutter below the diagram so it doesn't visually
  // touch the toolbar / card border.
  var availH = Math.max(ch - STREAM_VIEWPORT_PADDING * 2 -
                        STREAM_BOTTOM_GUTTER, 1);
  var fitWholeS = Math.min(availW / wholeW, availH / wholeH, 1);
  fitWholeS = Math.max(fitWholeS, STREAM_MIN_SCALE);

  // Pick the focus rect: recent vertices when present (with context
  // padding), otherwise the whole diagram. Ancestors of other queued
  // cells are filtered out so a container's bbox doesn't swallow its
  // queued children — the camera tightens on the deepest descendants.
  // Fresh containers (no descendants yet) are kept in focus so groups
  // briefly widen the camera when introduced; the per-step scale-drop
  // cap below limits how far the widen actually goes.
  var queuedIds = getRecentVertexIds();
  var recentIds = filterRecentAncestors(model, queuedIds);

  // Freeze the cap baseline on the first call for each new queue
  // signature. Subsequent calls within the same partial (rAF spring
  // ticks, resize events) reuse the same baseline so the cap stays
  // stable instead of decaying against its own just-applied output.
  var qSig = queuedIds.join('|');
  if (qSig !== streamLastQueueSig)
  {
    streamPartialBaseline = streamLastTargetScale;
    streamLastQueueSig = qSig;
  }

  var focusRect;

  if (recentIds.length > 0)
  {
    var rb = computeCellsBBox(model, recentIds);
    if (rb != null)
    {
      var rw = Math.max(rb.maxX - rb.minX, 1);
      var rh = Math.max(rb.maxY - rb.minY, 1);
      var ctx = Math.max(rw, rh) * STREAM_FOCUS_CONTEXT_FACTOR;
      focusRect = {
        minX: rb.minX - ctx,
        minY: rb.minY - ctx,
        maxX: rb.maxX + ctx,
        maxY: rb.maxY + ctx
      };
      // Don't extend beyond the whole diagram — keeps the camera
      // from showing dead space outside any actual content.
      focusRect.minX = Math.max(focusRect.minX, wholeBBox.minX);
      focusRect.minY = Math.max(focusRect.minY, wholeBBox.minY);
      focusRect.maxX = Math.min(focusRect.maxX, wholeBBox.maxX);
      focusRect.maxY = Math.min(focusRect.maxY, wholeBBox.maxY);
    }
    else
    {
      // Cell IDs are in the queue but their model entries haven't
      // landed yet — there's a brief gap between trackPartialFocus
      // appending to the queue and the cell being inserted into the
      // streamGraph. Falling back to wholeBBox here would zoom the
      // camera out for ~300ms before the cell finally registers and
      // we tighten back in: the visible "strange zoom-out" between
      // siblings. Keep the previous target instead.
      return;
    }
  }
  else
  {
    focusRect = wholeBBox;
  }

  var fw = Math.max(focusRect.maxX - focusRect.minX, 1);
  var fh = Math.max(focusRect.maxY - focusRect.minY, 1);

  // When following recent cells, allow close-up zoom up to 1:1 so
  // the camera actually focuses on small new content (instead of
  // just panning at fit-whole scale). When falling back to whole
  // (recentIds empty), still cap at fit-whole — the diagram should
  // never be zoomed past what shows everything.
  var followCap = (recentIds.length > 0)
    ? STREAM_FOLLOW_MAX_SCALE
    : fitWholeS;
  var targetScale = Math.min(availW / fw, availH / fh, followCap);
  targetScale = Math.max(targetScale, STREAM_MIN_SCALE);

  // Batch pull-back: bigger partials zoom out further. Without
  // this, Mermaid (which arrives in one ~16-cell partial) ends up
  // with focusRect ≈ wholeBBox and no visible pull-back. The
  // multiplier only kicks in when there's an active recent set.
  var batchPullBack = 1;
  if (recentIds.length > 0 && lastBatchSize > 1)
  {
    batchPullBack = Math.max(
      STREAM_BATCH_PULLBACK_MIN,
      1 / (1 + STREAM_BATCH_PULLBACK_K * (lastBatchSize - 1))
    );
    targetScale = Math.max(STREAM_MIN_SCALE, targetScale * batchPullBack);
  }

  // Per-step zoom-out cap: limit how far the camera can pull back in
  // a single retarget when streaming incrementally. Skipped for big-
  // batch partials (Mermaid arrives in one ~16-cell chunk and
  // genuinely wants to fit the whole new content). The baseline is
  // frozen for the duration of this partial so the cap stays stable
  // across rAF / resize re-invocations.
  if (recentIds.length > 0 && lastBatchSize <= STREAM_BIG_BATCH_THRESHOLD &&
      streamPartialBaseline != null && targetScale < streamPartialBaseline)
  {
    var minAllowedScale = streamPartialBaseline * STREAM_ZOOM_OUT_CAP;
    if (targetScale < minAllowedScale) targetScale = minAllowedScale;
  }

  var cx = (focusRect.minX + focusRect.maxX) / 2;
  var cy = (focusRect.minY + focusRect.maxY) / 2;
  var targetTx = (cw / targetScale) / 2 - cx;
  var targetTy = (ch / targetScale) / 2 - cy;

  // When showing the whole diagram, bias the camera UP slightly so
  // the bottom gutter is honored (otherwise centered fit would put
  // half the gutter as extra top padding).
  if (recentIds.length === 0)
  {
    targetTy -= (STREAM_BOTTOM_GUTTER / 2) / targetScale;
  }

  // Skip when the target equals the current transform. CRITICAL for
  // smoothness: applies to BOTH eased and immediate calls. Skipping
  // when nothing changed leaves the in-flight spring undisturbed.
  var dS = Math.abs(viewTransform.scale - targetScale);
  var dTx = Math.abs(viewTransform.tx - targetTx) * targetScale;
  var dTy = Math.abs(viewTransform.ty - targetTy) * targetScale;
  if (dS < 0.003 && dTx < 1.5 && dTy < 1.5)
  {
    return;
  }

  // Remember the committed target so the next retarget's zoom-out
  // cap has a baseline. Only track during soft-follow; the empty-
  // queue (fit-whole) path shouldn't influence streaming caps.
  if (recentIds.length > 0)
  {
    streamLastTargetScale = targetScale;
  }

  if (immediate)
  {
    // Snap-fits, drag, fit-button, resize handlers — apply directly.
    // applyViewTransform will cancel any in-flight streaming spring.
    applyViewTransform(graph, targetScale, targetTx, targetTy, true, 0);
  }
  else
  {
    // Smooth streaming follow: hand off to the rAF spring so the
    // camera lerps continuously toward the latest target. New
    // partials updating the target mid-flight produce one connected
    // motion instead of repeatedly restarting CSS transitions.
    setStreamCameraTarget(graph, targetScale, targetTx, targetTy);
  }
}


/**
 * End streaming mode: destroy raw graph, remove fixed container,
 * reset state. Called on error paths to fully reset the viewer.
 */
function endStreaming()
{
  if (animDebounceTimer != null)
  {
    clearTimeout(animDebounceTimer);
    animDebounceTimer = null;
  }

  pendingAnimCellIds = [];
  deferredAnimCellIds = [];
  animatedCellIds = {};
  popInEndsAt = {};
  lastAnimEndT = 0;

  if (deferredAnimTimer != null)
  {
    clearTimeout(deferredAnimTimer);
    deferredAnimTimer = null;
  }

  if (streamGraph != null)
  {
    streamGraph.destroy();
    streamGraph = null;
  }

  streamPendingEdges = null;
  containerEl.classList.remove("streaming");
  containerEl.classList.remove("custom-viewer");
  containerEl.style.height = '';
  streamingInitialized = false;
  customViewerInteractive = false;
  mermaidEarlyFinalizeFired = false;
  mermaidClassDefFitFired = false;
  lastMergedMermaidText = null;
  lastConvertedMermaidText = null;
  lastConvertedMermaidXml = null;
  currentMermaidText = null;
  originalCellGeometries = null;
  originalCellStyles = null;
  currentLayoutState = 'none';
  if (layoutBtn != null) layoutBtn.style.display = 'none';
  dblclickZoomedIn = false;
  updateZoomFitButtonUi();
  recentVertexQueue = [];
  lastBatchSize = 0;
  streamArrivalTimes = [];
  streamLastTargetScale = null;
  streamPartialBaseline = null;
  streamLastQueueSig = '';
  streamMode = null;
  viewTransform = { scale: 1, tx: 0, ty: 0 };
  viewTransformSvg = null;
  lastFinalizedKey = null;
  cancelZoomAnim();
  cancelStreamCameraSpring();
}

// --- Custom viewer: finalize from stream + interactivity ---

/**
 * Promote the streaming Graph instance to be the final viewer.
 *
 *  - If no streamGraph exists yet (server returned faster than first
 *    streaming partial), build one from the XML and animate every cell
 *    in as if it had just streamed.
 *  - Otherwise merge the final XML — idempotent for shared IDs (mermaid
 *    stable IDs, AI-authored XML IDs) — so cells we already drew don't
 *    re-animate. Newly arrived cells animate.
 *  - Settle the soft-follow camera to fit-whole: clear the recent
 *    queue so the focus bbox falls back to the whole diagram, then
 *    let streamFollowNewCells ease the CSS transform there.
 *  - Show the toolbar (zoom buttons + open/copy/fullscreen) and enable
 *    wheel/drag/zoom interaction.
 *  - If postLayout is set, run it after the camera + cell animations
 *    have had time to settle, with mxMorphing animating cells into
 *    their new positions.
 */
// Both app.ontoolinput and app.ontoolresult fire for the same
// invocation (SDK contract), and both code paths call this function.
// Without dedupe we run the merge + camera-settle twice — the second
// call also wipes lastFinalizedKey so a brand-new tool call with
// different XML will still trigger a fresh finalize.
var lastFinalizedKey = null;

function finalizeStreamingView(xml, opts)
{
  opts = opts || {};

  var key = (xml || '') + '|' + (opts.postLayout || '') + '|' + (opts.routing || '') + '|' + (opts.replaceMode ? 'r' : '');
  if (key === lastFinalizedKey)
  {
    return;
  }
  lastFinalizedKey = key;

  try
  {
    if (streamGraph == null)
    {
      initStreamGraphFromXml(xml);
    }
    else
    {
      var doc = mxUtils.parseXml(xml);
      var prevIds = getModelCellIds(streamGraph.getModel());
      streamPendingEdges = streamMergeXmlDelta(streamGraph, streamPendingEdges, doc.documentElement);
      var newIds = findNewCellIds(streamGraph.getModel(), prevIds);

      // Mermaid finalize: each parse is the complete state. Streaming
      // partials emit content-hashed IDs that change when values change
      // (e.g. accumulating Sankey totals), and the final parse may use
      // a different healing prefix than any partial — so cells from
      // earlier partials must be evicted before fitting, or the fit
      // bbox includes stale geometry and Fit doesn't actually fit.
      if (opts.replaceMode)
      {
        var keepIds = collectCellIdsFromXml(doc.documentElement);
        removeOrphanCells(streamGraph, keepIds);
      }

      if (newIds.length > 0)
      {
        queueCellAnimation(streamGraph, newIds);
      }
    }
  }
  catch (e)
  {
    showError("Failed to render diagram: " + e.message);
    return;
  }

  commitDiagramXml(xml);

  // Reveal the toolbar BEFORE the final fit. The toolbar adds ~50 px
  // to the body, which the host then reflects back as a smaller
  // available area for the diagram. Doing the fit first computed
  // against a container that didn't yet account for the toolbar, so
  // the diagram extended underneath it.
  toolbarEl.style.display = "flex";
  document.getElementById('zoom-in-btn').style.display = '';
  document.getElementById('zoom-out-btn').style.display = '';
  document.getElementById('zoom-fit-btn').style.display = '';
  document.getElementById('expand-btn').style.display = '';

  // Layout button: shown for diagrams where re-layout is meaningful —
  // explicit verticalFlow/horizontalFlow postLayout, or any mermaid
  // flowchart (whose default is mermaid's own layout). The button
  // toggles between "as authored" and a single alternative — horizontal
  // flow when the request was horizontal (postLayout=horizontalFlow or
  // mermaid flowchart with LR/RL orientation), vertical flow otherwise.
  // Capture original geometries BEFORE any postLayout runs so we can
  // restore them when the user toggles back to "as authored".
  var showLayoutBtn = (opts.postLayout === 'verticalFlow' ||
                       opts.postLayout === 'horizontalFlow' ||
                       opts.isFlowchart === true);
  if (showLayoutBtn)
  {
    captureOriginalCellGeometries(streamGraph);
    var isHorizontal = (opts.postLayout === 'horizontalFlow') || opts.isHorizontal === true;
    layoutAlternativeState = isHorizontal ? 'horizontal' : 'vertical';
    if (opts.postLayout === 'verticalFlow') currentLayoutState = 'vertical';
    else if (opts.postLayout === 'horizontalFlow') currentLayoutState = 'horizontal';
    else currentLayoutState = 'none';
    layoutBtn.style.display = '';
    updateLayoutButtonUi();
  }
  else
  {
    layoutBtn.style.display = 'none';
  }

  // Double rAF so the browser computes layout at opacity:0/translateY(8)
  // before we toggle the .shown class — otherwise the transition is
  // skipped and the toolbar pops in.
  requestAnimationFrame(function()
  {
    requestAnimationFrame(function()
    {
      toolbarEl.classList.add('shown');
    });
  });

  enableViewerInteractivity(streamGraph);

  // Settle the camera to fit-whole. Clearing the recent queue makes
  // the focus bbox fall back to the whole diagram. We use the rAF
  // animateCameraTo helper (affine fixed-point + ease-in-out) so the
  // path is a clean zoom out, no CSS-decomposition curve. Wait one
  // rAF first so the toolbar layout commits and clientHeight is live.
  // If postLayout is set, SKIP this fit — the layout step below will
  // run its own combined camera + morph animation and we don't want
  // two competing camera moves.
  if (!opts.postLayout)
  {
    requestAnimationFrame(function()
    {
      if (streamGraph == null) return;
      recentVertexQueue = [];
      lastBatchSize = 0;
      // Resize container to its natural-fit height (no camera move),
      // then animate the camera from the current leading-edge view to
      // fit-whole with ease-in-out. animateCameraTo uses the affine
      // fixed point so the path is a clean zoom out, not a CSS
      // component-decomposition curve.
      resizeContainerToFit();
      var t = computeFitWholeTransform();
      if (t != null)
      {
        animateCameraTo(t.s, t.tx, t.ty, 600, easeInOutCubic);
      }
    });
  }

  // Post-layout: morph cells from current positions to ELK output.
  // Kick off ELK immediately and let it run in parallel with the tail
  // of the pop-in animations. applyPostLayout fires the camera ease
  // (onMorphStart) as soon as ELK has applied — decoupled from pop-in
  // settle, so the zoom-to-fit doesn't sit idle waiting for the last
  // edge label to fade. mxMorphing itself still waits for pop-in to
  // settle so the snapshot captures a fully-opaque view.
  if (opts.postLayout)
  {
    var awaitAnims = waitForPendingAnimationsToSettle();

    try
    {
      applyPostLayout(streamGraph, opts.postLayout, function(applied)
      {
        if (!applied) return;

        try
        {
          var newXml = serializeGraphXml(streamGraph);
          if (newXml != null)
          {
            commitDiagramXml(newXml);
          }
        }
        catch (_) {}

        // Combined ELK + libavoid: ELK has placed the vertices, now route
        // the edges around them on the final positions. Runs after the
        // morph so it sees where things actually landed.
        if (opts.routing)
        {
          runRoutingPass(streamGraph);
        }

        // Second-stage fit: cells have just morphed into place and
        // sizeDidChange has run, so the SVG/container bounds are now
        // final. The ELK-done fit was based on the pre-morph view
        // dimensions; a rAF later we re-measure and adjust. If the
        // bounds didn't move, animateCameraTo no-ops (~1 px tolerance).
        requestAnimationFrame(function()
        {
          if (streamGraph == null) return;
          resizeContainerToFit();
          var t2 = computeFitWholeTransform();
          if (t2 != null)
          {
            animateCameraTo(t2.s, t2.tx, t2.ty, 220, easeInOutCubic);
          }
        });
      }, function()
      {
        // First-stage fit: ELK has just applied, so the model has the
        // post-layout positions. Fire the camera ease now rather than
        // waiting for pop-in animations to settle — this is the visible
        // zoom-to-fit, and decoupling it from the opacity gate removes
        // the dead time between the last cell popping and the camera
        // moving. A second adjust fires from onDone once bounds are
        // pixel-final.
        recentVertexQueue = [];
        lastBatchSize = 0;
        resizeContainerToFit();
        var t = computeFitWholeTransform();
        if (t != null)
        {
          // Match mxMorphing duration (12 steps × 30 ms = 360 ms).
          animateCameraTo(t.s, t.tx, t.ty, 360, easeInOutCubic);
        }
      }, awaitAnims);
    }
    catch (e) {}
  }
  else if (opts.routing)
  {
    // Routing without ELK: the author's (LLM's) vertex positions are kept;
    // libavoid only computes obstacle-avoiding paths for the edges. The
    // normal fit above already ran (no postLayout), and routing doesn't move
    // vertices, so no extra camera move is needed. applyRouting awaits wasm
    // readiness internally, so no rAF gate here.
    runRoutingPass(streamGraph);
  }

  notifySize('finalize');
}

/**
 * Cold-start init: build a streamGraph from a complete XML when no
 * partials were received first. Mirrors the streaming-init path but
 * treats every cell as new so they all animate in.
 */
function initStreamGraphFromXml(xml)
{
  containerEl.innerHTML = "";
  containerEl.classList.add("streaming");

  var graphDiv = document.createElement("div");
  graphDiv.style.width = "100%";
  graphDiv.style.height = "100%";
  graphDiv.style.overflow = "hidden";
  containerEl.appendChild(graphDiv);

  loadingEl.style.display = "none";
  containerEl.style.display = "block";

  streamGraph = new Graph(graphDiv);
  streamGraph.setEnabled(false);
  streamGraph.panGraph = function() {};
  // Hover tooltips on UserObject cells dump every attribute
  // (mermaidBaseStyle, mermaidBaseValue, mermaidId, …) under the
  // toolbar — fine for the editor, distracting in the inline viewer.
  streamGraph.setTooltips(false);
  // No fold/unfold toggles either — this is a read-only viewer, the
  // +/- icons on container cells just add visual noise.
  streamGraph.foldingEnabled = false;
  streamPendingEdges = [];
  streamingInitialized = true;
  lastFinalizedKey = null;

  var doc = mxUtils.parseXml(xml);
  streamPendingEdges = streamMergeXmlDelta(streamGraph, streamPendingEdges, doc.documentElement);

  // Treat every non-root cell as new and animate it in.
  var newIds = [];
  var model = streamGraph.getModel();
  for (var id in model.cells)
  {
    if (id !== '0' && id !== '1') newIds.push(id);
  }

  if (newIds.length > 0)
  {
    queueCellAnimation(streamGraph, newIds);
  }
}

/**
 * Wire mouse-drag panning, modifier-wheel zoom, and double-click zoom
 * into the streaming container.
 *
 *   - Drag (left mouse): pan. Touch passes through so the chat scrolls.
 *   - Ctrl/Cmd+wheel: zoom toward cursor. Plain wheel bubbles to parent
 *     so the chat scrolls naturally over the diagram.
 *   - Double-click: toggles between fit-whole and 100% (or 200% if fit
 *     is already at 100%) zoomed under the cursor.
 *
 * All input drives viewTransform (the CSS transform on the SVG).
 * Drag uses immediate=true to bypass the streaming transition; zoom
 * uses immediate=false so it eases like the streaming camera.
 */
function enableViewerInteractivity(graph)
{
  if (customViewerInteractive) return;
  customViewerInteractive = true;
  containerEl.classList.add("custom-viewer");

  var dragging = false, sx = 0, sy = 0, stx = 0, sty = 0, sscale = 1;
  var lastClickT = 0, lastClickX = 0, lastClickY = 0;

  containerEl.addEventListener('pointerdown', function(e)
  {
    // Mouse left-button only. Touch passes through to parent (page
    // scroll); pen and other pointer types are ignored.
    if (e.pointerType !== 'mouse') return;
    if (e.button !== 0) return;

    // Manual double-click detection — the browser's dblclick event
    // fires unreliably once we call setPointerCapture, and we want
    // each dblclick to immediately re-target the camera (interrupt
    // any animation already in flight).
    var now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    var dt = now - lastClickT;
    var ddx = Math.abs(e.clientX - lastClickX);
    var ddy = Math.abs(e.clientY - lastClickY);

    if (dt < 350 && ddx < 6 && ddy < 6)
    {
      if (dblclickZoomedIn)
      {
        customFitView();
        dblclickZoomedIn = false;
      }
      else
      {
        // Target scale follows zoomInTargetScale() — fit-to-width for
        // tall/narrow diagrams, 100% (or 200% for tiny ones) otherwise.
        // Anchor at the cursor so the dblclicked spot stays put.
        var rectD = containerEl.getBoundingClientRect();
        var pxD = e.clientX - rectD.left;
        var pyD = e.clientY - rectD.top;
        customZoomToScaleAt(pxD, pyD, zoomInTargetScale());
        dblclickZoomedIn = true;
      }
      updateZoomFitButtonUi();
      lastClickT = 0;
      return; // suppress drag start for the second click
    }

    lastClickT = now;
    lastClickX = e.clientX;
    lastClickY = e.clientY;

    dragging = true;
    sx = e.clientX; sy = e.clientY;
    // Sample current camera transform at drag start; pan rewrites
    // tx/ty directly with immediate=true so there's no transition lag.
    sscale = viewTransform.scale;
    stx    = viewTransform.tx;
    sty    = viewTransform.ty;
    cancelZoomAnim();
    containerEl.classList.add('dragging');
    try { containerEl.setPointerCapture(e.pointerId); } catch(_) {}
  });

  containerEl.addEventListener('pointermove', function(e)
  {
    if (!dragging) return;
    var dx = (e.clientX - sx) / sscale;
    var dy = (e.clientY - sy) / sscale;
    // Clamp so the diagram can never be dragged entirely off-screen.
    // setPointerCapture keeps delivering pointermove events with coords
    // far outside the window, which would otherwise pan the SVG into
    // oblivion with no way to recover.
    var c = clampPan(sscale, stx + dx, sty + dy);
    applyViewTransform(graph, sscale, c.tx, c.ty, true);
  });

  var endDrag = function(e)
  {
    if (!dragging) return;
    dragging = false;
    containerEl.classList.remove('dragging');
    try { containerEl.releasePointerCapture(e.pointerId); } catch(_) {}
  };

  containerEl.addEventListener('pointerup', endDrag);
  containerEl.addEventListener('pointercancel', endDrag);

  // Wheel / pinch zoom. In inline mode, plain wheel falls through so
  // the chat keeps scrolling over the diagram — only modifier-wheel
  // zooms. In fullscreen we own the surface, so any wheel zooms.
  // Pinch on macOS/Windows trackpads emits wheel events with ctrlKey
  // already set, so it works under either branch.
  // exp() handles trackpad (many small deltas) and mouse wheel (few
  // large deltas) per-event, but the SAME multiplier feels sluggish for
  // pinch and right for wheel — pinch fires at 60 Hz with deltaY ~1-30
  // while a wheel click is one ~100 px delta. Split the constant by
  // delta magnitude so pinch feels responsive without making each
  // wheel click zoom too far.
  containerEl.addEventListener('wheel', function(e)
  {
    var fullscreen = currentDisplayMode === 'fullscreen';
    if (!fullscreen && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    cancelZoomAnim();
    var rect = containerEl.getBoundingClientRect();
    var px = e.clientX - rect.left;
    var py = e.clientY - rect.top;
    var k = Math.abs(e.deltaY) < 50 ? 0.010 : 0.0015;
    customZoomAt(px, py, Math.exp(-e.deltaY * k));
  }, { passive: false });

  // Touch gestures. Mouse stays on the pointer-event handlers above —
  // those ignore non-mouse pointers so all touch input is owned here.
  //   Inline + 1 finger:  passthrough — chat scrolls normally.
  //   Inline + 2 fingers: claim — pinch zoom + pan the diagram.
  //   Fullscreen + 1:     pan.
  //   Fullscreen + 2:     pinch zoom + pan.
  // preventDefault() is only called once a gesture is claimed, so a
  // 1-finger touch in inline mode reaches the parent scroller. Once
  // claimed, every subsequent touchmove keeps preventing default until
  // the last finger lifts — so raising one finger of a two-finger
  // pinch never falls through to a surprise page scroll.
  var touchPan = null;     // { sx, sy, sscale, stx, sty }
  var touchPinch = null;   // { startDist, startMidX, startMidY, startScale, startTx, startTy }
  var touchClaimed = false;

  function touchPointsRel(touchList)
  {
    var rect = containerEl.getBoundingClientRect();
    var arr = [];
    for (var i = 0; i < touchList.length; i++)
    {
      arr.push({
        x: touchList[i].clientX - rect.left,
        y: touchList[i].clientY - rect.top
      });
    }
    return arr;
  }

  function startPinch(touches)
  {
    var pts = touchPointsRel(touches);
    var dx = pts[1].x - pts[0].x;
    var dy = pts[1].y - pts[0].y;
    touchPinch = {
      startDist: Math.max(1, Math.hypot(dx, dy)),
      startMidX: (pts[0].x + pts[1].x) / 2,
      startMidY: (pts[0].y + pts[1].y) / 2,
      startScale: viewTransform.scale,
      startTx: viewTransform.tx,
      startTy: viewTransform.ty
    };
  }

  function startPan(touch)
  {
    touchPan = {
      sx: touch.clientX,
      sy: touch.clientY,
      sscale: viewTransform.scale,
      stx: viewTransform.tx,
      sty: viewTransform.ty
    };
  }

  containerEl.addEventListener('touchstart', function(e)
  {
    var fullscreen = currentDisplayMode === 'fullscreen';

    // Cancel any in-flight rAF camera animation on ANY touchstart,
    // even ones we won't claim. Without this, a still-running anim
    // (e.g. the post-streaming fit-settle or a recent toolbar zoom)
    // keeps painting while the browser claims the gesture for chat
    // scroll — visible as the viewer "panning a short distance" at
    // the start of an inline drag.
    cancelZoomAnim();

    if (e.touches.length >= 2)
    {
      e.preventDefault();
      touchClaimed = true;
      touchPan = null;
      startPinch(e.touches);
    }
    else if (e.touches.length === 1 && fullscreen)
    {
      e.preventDefault();
      touchClaimed = true;
      startPan(e.touches[0]);
    }
  }, { passive: false });

  containerEl.addEventListener('touchmove', function(e)
  {
    if (!touchClaimed) return;
    e.preventDefault();

    if (touchPinch != null && e.touches.length >= 2)
    {
      var pts = touchPointsRel(e.touches);
      var dx = pts[1].x - pts[0].x;
      var dy = pts[1].y - pts[0].y;
      var dist = Math.max(1, Math.hypot(dx, dy));
      var midX = (pts[0].x + pts[1].x) / 2;
      var midY = (pts[0].y + pts[1].y) / 2;

      var newScale = Math.max(0.05, Math.min(4,
        touchPinch.startScale * (dist / touchPinch.startDist)));

      // Keep the model point that was under the start midpoint
      // anchored under the current midpoint — same invariant as
      // customZoomAt, but with a moving anchor.
      var modelX = touchPinch.startMidX / touchPinch.startScale - touchPinch.startTx;
      var modelY = touchPinch.startMidY / touchPinch.startScale - touchPinch.startTy;
      var newTx = midX / newScale - modelX;
      var newTy = midY / newScale - modelY;

      var c = clampPan(newScale, newTx, newTy);
      applyViewTransform(graph, newScale, c.tx, c.ty, true);
      markUserZoomed();
    }
    else if (e.touches.length === 1
             && currentDisplayMode === 'fullscreen')
    {
      // Lazy rebase: if a pinch just ended (touchPan was nulled in
      // endTouch on the 2→1 transition), we capture the baseline
      // HERE using this touchmove's own clientX/Y. iOS reports
      // slightly different clientX/Y for the same finger between
      // a touchend and the next touchmove (event coalescing /
      // retiming), so eagerly capturing in endTouch produces a
      // small offset jump on the first pan frame. Capturing here
      // makes the first frame's ddx/ddy exactly zero by construction.
      if (touchPan == null)
      {
        startPan(e.touches[0]);
        return;
      }
      var t = e.touches[0];
      var ddx = (t.clientX - touchPan.sx) / touchPan.sscale;
      var ddy = (t.clientY - touchPan.sy) / touchPan.sscale;
      var c2 = clampPan(touchPan.sscale,
        touchPan.stx + ddx, touchPan.sty + ddy);
      applyViewTransform(graph, touchPan.sscale, c2.tx, c2.ty, true);
    }
  }, { passive: false });

  function endTouch(e)
  {
    if (e.touches.length === 0)
    {
      touchPan = null;
      touchPinch = null;
      touchClaimed = false;
    }
    else if (e.touches.length === 1 && touchPinch != null)
    {
      // Lifted one of two fingers. End the pinch and drop the pan
      // baseline — the next touchmove will lazily rebaseline using
      // its own event coordinates (see touchmove handler), avoiding
      // the iOS touchend↔touchmove clientX/Y skew.
      touchPinch = null;
      touchPan = null;
    }
  }

  containerEl.addEventListener('touchend', endTouch);
  containerEl.addEventListener('touchcancel', endTouch);

  // iOS Safari / WKWebView fires non-standard gesture events alongside
  // touch events when it detects a two-finger gesture. Once WebKit
  // decides the gesture is "page pinch zoom", it fires touchcancel on
  // our touchmoves — the user reports this as "pinch starts and then
  // immediately stops". Preventing the gesture events keeps the touch
  // stream alive so our touch handlers can do the math.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function(name)
  {
    containerEl.addEventListener(name, function(e)
    {
      if (currentDisplayMode === 'fullscreen' || touchClaimed)
      {
        e.preventDefault();
      }
    }, { passive: false });
  });
}

/**
 * Zoom toward (px, py) in container coords by factor. The point stays
 * under the cursor across the zoom — same anchor math as draw.io's
 * wheel zoom (screen = scale * (model + translate)).
 *
 * Applied IMMEDIATELY (no CSS transition). Wheel events stream at
 * frame rate, so any per-event easing creates an independent-component
 * curve and overlapping in-flight transitions. Snapping per event lets
 * the natural event cadence carry the smoothness.
 */
function customZoomAt(px, py, factor)
{
  if (streamGraph == null) return;

  var s = viewTransform.scale;
  var newScale = Math.max(0.05, Math.min(4, s * factor));
  var gx = px / s - viewTransform.tx;
  var gy = py / s - viewTransform.ty;

  applyViewTransform(streamGraph, newScale,
    px / newScale - gx,
    py / newScale - gy,
    true);
  markUserZoomed();
}

// Flip the zoom-fit toggle to "fit" state. Called by every zoom path
// EXCEPT the fit path itself, so any manual zoom (wheel, pinch,
// toolbar +/-, dblclick zoom-in) leaves the button offering "Fit to
// view" as the natural next action. Guarded so wheel-rate updates
// don't churn the DOM.
function markUserZoomed()
{
  if (dblclickZoomedIn) return;
  dblclickZoomedIn = true;
  updateZoomFitButtonUi();
}

/**
 * Toolbar +/- buttons: zoom toward the container center, animated via
 * the rAF helper so the path stays clean even at large step factors.
 */
function customZoomBy(factor)
{
  if (streamGraph == null) return;
  var rect = containerEl.getBoundingClientRect();
  var px = rect.width / 2;
  var py = rect.height / 2;
  customZoomToScaleAt(px, py, viewTransform.scale * factor);
}

/**
 * Animate the camera from the current (scale, tx, ty) to a target
 * state, pinning the AFFINE FIXED POINT throughout — the model point
 * that maps to the same screen position in both states. This is the
 * mathematically clean zoom path: a linear scale interpolation with
 * tx/ty derived per frame from the anchor invariant.
 *
 * Why not CSS transition: CSS interpolates scale and translate
 * independently, but holding any anchor fixed requires
 * tx(t) = px/s(t) - anchorM, which is non-linear in s. The endpoints
 * land correctly but the path curves. Driving in rAF lets us derive
 * tx/ty from s every frame.
 */
var zoomAnimRaf = null;

function cancelZoomAnim()
{
  if (zoomAnimRaf != null)
  {
    cancelAnimationFrame(zoomAnimRaf);
    zoomAnimRaf = null;
  }
}

// Easing curves for animateCameraTo. Default is ease-out cubic
// (snappy launch, gentle landing) for click/zoom interactions.
// Pass easeInOutCubic for fit / settle animations where both ends
// should feel calm.
function easeOutCubic(t)
{
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t)
{
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Sample the SVG's currently-visible scale/translate from the computed
 * transform matrix. Works mid-CSS-transition — that's the point: the
 * value reflects where the eye is right now, not the END of the in-
 * flight transition that viewTransform.scale/tx/ty hold.
 *
 * Returns null if the SVG is missing, the transform isn't a simple
 * uniform scale + translate, or parsing fails.
 */
function readVisibleTransform(svg)
{
  if (svg == null || typeof window === 'undefined' ||
      typeof window.getComputedStyle !== 'function') return null;
  var t;
  try { t = window.getComputedStyle(svg).transform; } catch (_) { return null; }
  if (!t || t === 'none') return null;
  var m = t.match(/matrix\\(\\s*([^,]+),\\s*([^,]+),\\s*([^,]+),\\s*([^,]+),\\s*([^,]+),\\s*([^,]+)\\s*\\)/);
  if (!m) return null;
  var a = parseFloat(m[1]);
  var b = parseFloat(m[2]);
  var c = parseFloat(m[3]);
  var d = parseFloat(m[4]);
  var e = parseFloat(m[5]);
  var f = parseFloat(m[6]);
  // We only ever set scale(s) translate(tx, ty), which yields
  // matrix(s, 0, 0, s, s*tx, s*ty). Bail on anything else.
  if (Math.abs(b) > 0.001 || Math.abs(c) > 0.001) return null;
  if (Math.abs(a - d) > 0.001) return null;
  if (a === 0) return null;
  return { scale: a, tx: e / a, ty: f / a };
}

function animateCameraTo(toS, toTx, toTy, dur, easing)
{
  if (streamGraph == null) return;
  cancelZoomAnim();

  // Bind the SVG ref (and re-assert transform-origin) before sampling.
  // applyViewTransform normally does this, but we need it now so we
  // can sample + lock the visible position BEFORE any rAF fires.
  var svg = viewTransformSvg;
  if (svg == null || !svg.isConnected)
  {
    svg = streamGraph.container ? streamGraph.container.querySelector('svg') : null;
    viewTransformSvg = svg;
    if (svg != null) svg.style.transformOrigin = '0 0';
  }

  // Lock in the visually-current transform before we set transition:
  // none in the rAF step. Without this, the next applyViewTransform
  // (immediate=true) snaps the SVG from its mid-transition interpolated
  // position to the END of the in-flight CSS transition (the value
  // viewTransform holds), then animates from there — a visible jolt
  // at the join from streaming-follow to fit. We force a sync reflow
  // after the cancel so the browser commits the transition:none to the
  // compositor before the rAF loop starts mutating transforms — without
  // this, the in-flight composited interpolation can paint for one or
  // two frames *alongside* the JS-driven transforms, which composes the
  // CSS-curved path with the rAF-straight path and shows as curving.
  var visible = readVisibleTransform(svg);
  if (svg != null && visible != null &&
      (Math.abs(visible.scale - viewTransform.scale) > 0.003 ||
       Math.abs(visible.tx - viewTransform.tx) * visible.scale > 1.5 ||
       Math.abs(visible.ty - viewTransform.ty) * visible.scale > 1.5))
  {
    svg.style.transition = 'none';
    svg.style.transform =
      'scale(' + visible.scale + ') ' +
      'translate(' + visible.tx + 'px, ' + visible.ty + 'px)';
    viewTransform.scale = visible.scale;
    viewTransform.tx = visible.tx;
    viewTransform.ty = visible.ty;
    // Force commit. Reading offsetWidth flushes pending style changes
    // synchronously, so the compositor sees transition:none + the
    // visible-locked transform on its next composite — not the
    // tail end of the cancelled CSS interpolation.
    void svg.offsetWidth;
  }

  var fromS = viewTransform.scale;
  var fromTx = viewTransform.tx;
  var fromTy = viewTransform.ty;

  // No-op when already there (≈1 px tolerance at current scale).
  var maxS = Math.max(fromS, toS);
  if (Math.abs(toS - fromS) < 0.003 &&
      Math.abs(toTx - fromTx) * maxS < 1.5 &&
      Math.abs(toTy - fromTy) * maxS < 1.5)
  {
    return;
  }

  dur = Math.max(50, dur || 320);
  var ease = easing || easeOutCubic;
  var t0 = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();

  var ds = fromS - toS;

  // Pure pan: no fixed point exists. Linearly interpolate tx/ty —
  // there's no curve concern when scale is constant.
  if (Math.abs(ds) < 0.0001)
  {
    var stepPan = function(now)
    {
      zoomAnimRaf = null;
      var t = Math.min(1, (now - t0) / dur);
      var k = ease(t);
      var tx = fromTx + (toTx - fromTx) * k;
      var ty = fromTy + (toTy - fromTy) * k;
      applyViewTransform(streamGraph, fromS, tx, ty, true);
      if (t < 1) zoomAnimRaf = requestAnimationFrame(stepPan);
    };
    zoomAnimRaf = requestAnimationFrame(stepPan);
    return;
  }

  // Affine fixed point: solve s_from*(M+tx_from) = s_to*(M+tx_to).
  var anchorMx = (toS * toTx - fromS * fromTx) / ds;
  var anchorMy = (toS * toTy - fromS * fromTy) / ds;
  // Screen position of that point — invariant in both end-states.
  var anchorPx = fromS * (anchorMx + fromTx);
  var anchorPy = fromS * (anchorMy + fromTy);

  var step = function(now)
  {
    zoomAnimRaf = null;
    var t = Math.min(1, (now - t0) / dur);
    var k = ease(t);
    var s = fromS + (toS - fromS) * k;
    var tx = anchorPx / s - anchorMx;
    var ty = anchorPy / s - anchorMy;
    applyViewTransform(streamGraph, s, tx, ty, true);
    if (t < 1) zoomAnimRaf = requestAnimationFrame(step);
  };

  zoomAnimRaf = requestAnimationFrame(step);
}

/**
 * Zoom to an absolute scale (e.g. 1.0 for 100 %), keeping (px, py)
 * pinned under the cursor. Used by the dblclick toggle and zoom-button
 * paths. Anchor at the cursor naturally becomes the affine fixed point.
 */
function customZoomToScaleAt(px, py, targetScale)
{
  if (streamGraph == null) return;
  var fromS = viewTransform.scale;
  var anchorMx = px / fromS - viewTransform.tx;
  var anchorMy = py / fromS - viewTransform.ty;
  var toS = Math.max(0.05, Math.min(4, targetScale));
  if (Math.abs(toS - fromS) < 0.001) return;
  var toTx = px / toS - anchorMx;
  var toTy = py / toS - anchorMy;
  // Same PAN_KEEP_MARGIN clamp as drag-pan so a dblclick near the edge
  // can't push the bbox so far off-screen there's no recovery.
  var c = clampPan(toS, toTx, toTy);
  animateCameraTo(toS, c.tx, c.ty, 320);
  markUserZoomed();
}

/**
 * Resize the streaming container to fit the diagram's natural-fit
 * height (without animating the camera). Mirrors the resize logic
 * inside streamFollowNewCells but doesn't touch the SVG transform.
 * Used by the finalize camera-settle so we can animate the camera
 * from the leading-edge view to fit-whole instead of snap-then-ease.
 */
function resizeContainerToFit()
{
  if (streamGraph == null) return;
  var bbox = computeWholeBBox(streamGraph.getModel());
  if (bbox == null) return;
  var cw = containerEl.clientWidth;
  if (cw <= 0) return;
  var wholeW = Math.max(bbox.maxX - bbox.minX, 1);
  var wholeH = Math.max(bbox.maxY - bbox.minY, 1);
  var maxH = maxViewportHeight();
  var availW0 = Math.max(cw - STREAM_VIEWPORT_PADDING * 2, 1);
  var widthFitScale = Math.min(availW0 / wholeW, 1);
  var naturalH = Math.ceil(wholeH * widthFitScale +
                           STREAM_VIEWPORT_PADDING * 2 +
                           STREAM_BOTTOM_GUTTER);
  var desiredH;
  if (currentDisplayMode === 'fullscreen')
  {
    desiredH = maxH;
  }
  else
  {
    desiredH = Math.max(STREAM_VIEWPORT_MIN_HEIGHT,
                        Math.min(naturalH, maxH));
  }
  if (Math.abs(containerEl.clientHeight - desiredH) > 1)
  {
    containerEl.style.height = desiredH + 'px';
    notifySize('container-resize');
  }
}

/**
 * Compute the (scale, tx, ty) that fits the whole diagram centered in
 * the current container. Mirrors the math in streamFollowNewCells for
 * the empty-recent-queue case.
 */
function computeFitWholeTransform()
{
  if (streamGraph == null) return null;
  var bbox = computeWholeBBox(streamGraph.getModel());
  if (bbox == null) return null;
  var cw = containerEl.clientWidth;
  var ch = containerEl.clientHeight;
  if (cw <= 0 || ch <= 0) return null;
  var wholeW = Math.max(bbox.maxX - bbox.minX, 1);
  var wholeH = Math.max(bbox.maxY - bbox.minY, 1);
  var availW = Math.max(cw - STREAM_VIEWPORT_PADDING * 2, 1);
  var availH = Math.max(ch - STREAM_VIEWPORT_PADDING * 2 -
                        STREAM_BOTTOM_GUTTER, 1);
  var s = Math.min(availW / wholeW, availH / wholeH, 1);
  s = Math.max(s, STREAM_MIN_SCALE);
  var cx = (bbox.minX + bbox.maxX) / 2;
  var cy = (bbox.minY + bbox.maxY) / 2;
  var tx = (cw / s) / 2 - cx;
  var ty = (ch / s) / 2 - cy - (STREAM_BOTTOM_GUTTER / 2) / s;
  return { s: s, tx: tx, ty: ty };
}

/**
 * Compute the scale that fit-whole would settle at, given the current
 * container size and model bbox. Used by the dblclick toggle to decide
 * whether 100 % or 200 % is the meaningful "zoomed-in" target.
 */
function fitWholeScale()
{
  if (streamGraph == null) return 1;
  var bbox = computeWholeBBox(streamGraph.getModel());
  if (bbox == null) return 1;
  var cw = containerEl.clientWidth;
  var ch = containerEl.clientHeight;
  if (cw <= 0 || ch <= 0) return 1;
  var uw = Math.max(bbox.maxX - bbox.minX, 1);
  var uh = Math.max(bbox.maxY - bbox.minY, 1);
  var availW = Math.max(cw - STREAM_VIEWPORT_PADDING * 2, 1);
  var availH = Math.max(ch - STREAM_VIEWPORT_PADDING * 2, 1);
  return Math.min(availW / uw, availH / uh, 1);
}

/**
 * Width-only fit scale — what scale would make the diagram exactly
 * fit the container width (capped at 1). Used by the zoom-in toggle
 * to prefer a comfortable full-width view over a cropped 100% for
 * tall/narrow diagrams.
 */
function fitToWidthScale()
{
  if (streamGraph == null) return 1;
  var bbox = computeWholeBBox(streamGraph.getModel());
  if (bbox == null) return 1;
  var cw = containerEl.clientWidth;
  if (cw <= 0) return 1;
  var uw = Math.max(bbox.maxX - bbox.minX, 1);
  var availW = Math.max(cw - STREAM_VIEWPORT_PADDING * 2, 1);
  return Math.min(availW / uw, 1);
}

/**
 * Target scale for the "zoom in from fit" toggle (toolbar button and
 * dblclick when not zoomed in). Always 120% so the toggle is a
 * meaningful close-up read; if fit-whole is already at or past 120%
 * (tiny diagrams), bump to 200% so the toggle isn't a visual no-op.
 */
function zoomInTargetScale()
{
  var fitW = fitWholeScale();
  if (fitW >= 1.2) return 2.0;
  return 1.2;
}

/**
 * Compute (s, tx, ty) that places the diagram at targetScale,
 * horizontally centered, with the top of the bbox anchored to the
 * top of the container (with STREAM_VIEWPORT_PADDING). Used by the
 * toolbar zoom-in button so tall diagrams reveal their top first
 * instead of jumping to the middle.
 */
function computeTopAnchoredTransform(targetScale)
{
  if (streamGraph == null) return null;
  var bbox = computeWholeBBox(streamGraph.getModel());
  if (bbox == null) return null;
  var cw = containerEl.clientWidth;
  if (cw <= 0) return null;
  var s = Math.max(STREAM_MIN_SCALE, Math.min(4, targetScale));
  var midX = (bbox.minX + bbox.maxX) / 2;
  var tx = (cw / s) / 2 - midX;
  var ty = STREAM_VIEWPORT_PADDING / s - bbox.minY;
  return { s: s, tx: tx, ty: ty };
}

/**
 * Toolbar Fit button: ease the camera to fit-whole. Clearing
 * recentVertexQueue makes the focus bbox fall back to the whole
 * diagram so the same code path produces a fit-whole target.
 */
// --- Layout button: toggles between as-authored and one alternative ---
//
// The toolbar layout button has two states for any given diagram:
// "none" (as-authored — cells stay at the streamed XML or mermaid
// layout positions) and one of "horizontal" / "vertical" (ELK +
// mxMorphing, with a parallel camera animation to fit the new bbox).
// Which alternative is offered is decided per-diagram in
// finalizeStreamingView — horizontal when the diagram was originally
// requested horizontal (postLayout=horizontalFlow or a mermaid
// flowchart with LR/RL orientation), vertical otherwise.
//
// Original geometries are captured ONCE at finalize so we can restore
// them when the user toggles back to "none". Without this we'd lose
// the original layout permanently after the first ELK pass.
var originalCellGeometries = null;
// Edge styles are mutated by the layered ELK pass (the ElkLayout facade
// rewrites curved=1 → rounded=1 and upgrades to orthogonalEdgeStyle).
// Restoring geometries
// alone leaves edges drawn as right-angles when toggling back to "as
// authored", so we capture styles too.
var originalCellStyles = null;
var currentLayoutState = 'none'; // 'none' | 'horizontal' | 'vertical'
var layoutAlternativeState = 'vertical'; // 'horizontal' | 'vertical' for the current diagram

var LAYOUT_LABELS = {
  'none': 'as authored',
  'horizontal': 'horizontal flow',
  'vertical': 'vertical flow'
};

function captureOriginalCellGeometries(graph)
{
  if (originalCellGeometries != null) return;
  originalCellGeometries = {};
  originalCellStyles = {};
  var model = graph.getModel();
  for (var id in model.cells)
  {
    if (id === '0' || id === '1') continue;
    var cell = model.cells[id];
    if (cell == null) continue;
    if (cell.geometry != null)
    {
      originalCellGeometries[id] = cell.geometry.clone();
    }
    // Store style as-is (string). null is a valid value too.
    originalCellStyles[id] = cell.style;
  }
}

function restoreOriginalGeometriesToModel(model)
{
  if (originalCellGeometries == null) return false;
  var any = false;
  for (var id in originalCellGeometries)
  {
    var cell = model.getCell(id);
    if (cell == null) continue;
    model.setGeometry(cell, originalCellGeometries[id].clone());
    // Restore style if it differs (the layered ELK pass may have
    // mutated edge styles).
    if (originalCellStyles != null)
    {
      var origStyle = originalCellStyles[id];
      if (cell.style !== origStyle)
      {
        model.setStyle(cell, origStyle);
      }
    }
    any = true;
  }
  return any;
}

function updateLayoutButtonUi()
{
  var iconNone = document.getElementById('layout-icon-none');
  var iconH = document.getElementById('layout-icon-horizontal');
  var iconV = document.getElementById('layout-icon-vertical');
  if (iconNone) iconNone.style.display = (currentLayoutState === 'none') ? '' : 'none';
  if (iconH)    iconH.style.display    = (currentLayoutState === 'horizontal') ? '' : 'none';
  if (iconV)    iconV.style.display    = (currentLayoutState === 'vertical') ? '' : 'none';
  var next = (currentLayoutState === 'none') ? layoutAlternativeState : 'none';
  layoutBtn.setAttribute('title',
    'Layout: ' + LAYOUT_LABELS[currentLayoutState] +
    ' (click for ' + LAYOUT_LABELS[next] + ')');
  layoutBtn.setAttribute('aria-label',
    'Layout: ' + LAYOUT_LABELS[currentLayoutState]);
}

function applyLayoutChange(targetState)
{
  if (streamGraph == null) return;
  if (targetState === currentLayoutState) return;

  if (targetState === 'none')
  {
    if (originalCellGeometries == null) return;
    var model = streamGraph.getModel();
    model.beginUpdate();
    var committed = false;
    try
    {
      committed = restoreOriginalGeometriesToModel(model);
    }
    catch (e) { committed = false; }

    if (!committed)
    {
      model.endUpdate();
      return;
    }

    currentLayoutState = 'none';
    updateLayoutButtonUi();

    try
    {
      var morph = new mxMorphing(streamGraph, 12, 1.5, 30);
      morph.addListener(mxEvent.DONE, function()
      {
        model.endUpdate();
        try { streamGraph.sizeDidChange(); } catch (_) {}
        // Re-hide and fade edges back in. The streaming-style
        // topological pen-draw feels too slow here, so we just fade
        // every edge in together once the vertex morph is done.
        hideAllEdgesForMorph(streamGraph);
        requestAnimationFrame(function()
        {
          fadeInAllEdgesAfterMorph(streamGraph);
        });
        notifySize('layout-change');
        try { containerEl.classList.remove('morph-active'); } catch (_) {}
        try
        {
          var newXml = serializeGraphXml(streamGraph);
          if (newXml != null)
          {
            commitDiagramXml(newXml);
          }
        }
        catch (_) {}
      });

      // Parallel camera anim — same pattern as the postLayout finalize.
      recentVertexQueue = [];
      lastBatchSize = 0;
      dblclickZoomedIn = false;
      updateZoomFitButtonUi();
      resizeContainerToFit();
      var t = computeFitWholeTransform();
      if (t != null)
      {
        animateCameraTo(t.s, t.tx, t.ty, 360, easeInOutCubic);
      }

      // Hide edges before morph so vertices animate cleanly.
      hideAllEdgesForMorph(streamGraph);
      // Relax overflow on the SVG + mxgraph wrappers so cells passing
      // through positions outside the OLD bbox aren't clipped before
      // sizeDidChange/camera fit catches up.
      try { containerEl.classList.add('morph-active'); } catch (_) {}
      morph.startAnimation();
    }
    catch (e)
    {
      model.endUpdate();
      try { streamGraph.sizeDidChange(); } catch (_) {}
      try { containerEl.classList.remove('morph-active'); } catch (_) {}
    }
    return;
  }

  // 'horizontal' or 'vertical' — run ELK with mxMorphing.
  var algorithm = (targetState === 'vertical') ? 'verticalFlow' : 'horizontalFlow';
  var prevState = currentLayoutState;
  currentLayoutState = targetState;
  updateLayoutButtonUi();

  try
  {
    applyPostLayout(streamGraph, algorithm,
      function(applied)
      {
        if (!applied)
        {
          // Revert UI state when ELK fails.
          currentLayoutState = prevState;
          updateLayoutButtonUi();
          return;
        }
        try
        {
          var newXml = serializeGraphXml(streamGraph);
          if (newXml != null)
          {
            commitDiagramXml(newXml);
          }
        }
        catch (_) {}
      },
      function()
      {
        // onMorphStart: parallel camera anim.
        recentVertexQueue = [];
        lastBatchSize = 0;
        dblclickZoomedIn = false;
        updateZoomFitButtonUi();
        resizeContainerToFit();
        var t = computeFitWholeTransform();
        if (t != null)
        {
          animateCameraTo(t.s, t.tx, t.ty, 360, easeInOutCubic);
        }
      },
      undefined /* awaitBeforeMorph */,
      true /* fadeEdges — button-driven re-layout uses fast fade */);
  }
  catch (e)
  {
    currentLayoutState = prevState;
    updateLayoutButtonUi();
  }
}

// Sync the zoom/fit toolbar button's icon + title with dblclickZoomedIn.
// dblclickZoomedIn=false → button offers "zoom in"; true → offers "fit".
function updateZoomFitButtonUi()
{
  var iconZoomIn = document.getElementById('zoom-fit-icon-zoomin');
  var iconFit = document.getElementById('zoom-fit-icon-fit');
  var btn = document.getElementById('zoom-fit-btn');
  if (btn == null) return;
  if (dblclickZoomedIn)
  {
    if (iconZoomIn) iconZoomIn.style.display = 'none';
    if (iconFit) iconFit.style.display = '';
    btn.setAttribute('title', 'Fit to view');
    btn.setAttribute('aria-label', 'Fit to view');
  }
  else
  {
    if (iconZoomIn) iconZoomIn.style.display = '';
    if (iconFit) iconFit.style.display = 'none';
    btn.setAttribute('title', 'Zoom in');
    btn.setAttribute('aria-label', 'Zoom in');
  }
}

function customFitView()
{
  if (streamGraph == null) return;
  recentVertexQueue = [];
  lastBatchSize = 0;
  // Any fit-to-whole resets the dblclick toggle so the next double
  // click zooms IN regardless of who just fitted (Fit button, dblclick
  // zoom-out, or display-mode change).
  dblclickZoomedIn = false;
  updateZoomFitButtonUi();
  // Animate to fit-whole via the affine-fixed-point rAF helper so the
  // path is a clean zoom (no CSS-decomposition curve). Bypasses
  // streamFollowNewCells, which uses a CSS transition.
  var t = computeFitWholeTransform();
  if (t != null)
  {
    animateCameraTo(t.s, t.tx, t.ty, 380);
    return;
  }
  // skipResize=true: scale the diagram into the existing container,
  // don't grow/shrink the iframe. Fit means "make everything visible
  // in the space we already have."
  streamFollowNewCells(streamGraph, false, true);
}

// --- Streaming: incremental rendering as the LLM generates XML ---

/**
 * Show the raw mermaid text in the <pre> preview element. Used as the
 * fallback when the parser can't yet make sense of the partial input.
 */
function showMermaidTextPreview(partialMermaid)
{
  loadingEl.style.display = 'none';
  mermaidPreviewEl.style.display = 'block';
  mermaidPreviewEl.textContent = partialMermaid;
  containerEl.style.display = 'none';
  toolbarEl.style.display = 'none';
  toolbarEl.classList.remove('shown');
  mermaidPreviewEl.scrollTop = mermaidPreviewEl.scrollHeight;

  if (app.sendSizeChanged)
  {
    var el = document.documentElement;
    app.sendSizeChanged({ width: Math.ceil(el.scrollWidth), height: Math.ceil(el.scrollHeight) });
  }
}

/**
 * Handle a mermaid partial: heal the text to a parseable prefix, run
 * parseText, stabilize IDs, and merge into the streaming Graph. On
 * any failure (viewer not loaded, parse error, unsupported type), fall
 * back to the raw-text preview as long as we haven't already started
 * rendering a graph for this stream.
 */
function handleMermaidPartial(partialMermaid)
{
  // No layout → no visible animation, and DOM measurement reads 0x0
  // (zero-sized nodes). Skip streaming previews entirely while hidden;
  // the finalize paths gate on whenDocumentLaidOut() and parse the
  // authoritative text with healthy measurement once the host shows
  // the iframe. If the iframe becomes visible mid-stream, the next
  // partial resumes the preview naturally.
  if (!isDocumentLaidOut()) return;

  // Need the viewer + parser before we can render anything
  if (typeof Graph === 'undefined' || typeof mxUtils === 'undefined' ||
      typeof mxMermaidToDrawio === 'undefined' ||
      typeof mxMermaidToDrawio.parseText !== 'function')
  {
    if (!streamingInitialized) showMermaidTextPreview(partialMermaid);
    return;
  }

  streamMode = 'mermaid';
  var healed = healMermaidText(partialMermaid);

  if (healed == null)
  {
    if (!streamingInitialized) showMermaidTextPreview(partialMermaid);
    return;
  }

  // De-dupe: if this healed text is byte-identical to what we last merged,
  // parseText would produce the same XML and the merge would be a no-op.
  if (healed === lastMergedMermaidText) return;

  var xml;
  try
  {
    // 'default' = light-dark() adaptive palette, correct in both light and
    // dark hosts (see convertMermaidToXml for the rationale).
    xml = mxMermaidToDrawio.parseText(healed, { theme: 'default' });
  }
  catch (e)
  {
    if (!streamingInitialized) showMermaidTextPreview(partialMermaid);
    return;
  }

  if (xml == null)
  {
    if (!streamingInitialized) showMermaidTextPreview(partialMermaid);
    return;
  }

  xml = stabilizeMermaidIds(xml);

  // Pre-populate the convertMermaidToXml cache so finalize doesn't
  // re-parse this text. The finalize call passes the raw partial text
  // (args.mermaid), which usually equals the last streamed partial.
  rememberMermaidConversion(partialMermaid, xml);

  // Hand off to the same merge pipeline used by XML streaming.
  try
  {
    var xmlDoc = mxUtils.parseXml(xml);
    var xmlNode = xmlDoc.documentElement;

    if (!streamingInitialized)
    {
      // First parseable chunk — switch from text preview to live graph
      streamingInitialized = true;
      lastFinalizedKey = null;
      mermaidEarlyFinalizeFired = false;
      mermaidClassDefFitFired = false;
      mermaidPreviewEl.style.display = 'none';
      containerEl.innerHTML = "";
      containerEl.classList.add("streaming");

      var graphDiv = document.createElement("div");
      graphDiv.style.width = "100%";
      graphDiv.style.height = "100%";
      graphDiv.style.overflow = "hidden";
      containerEl.appendChild(graphDiv);

      loadingEl.style.display = "none";
      containerEl.style.display = "block";

      streamGraph = new Graph(graphDiv);
      streamGraph.setEnabled(false);
      // No-op mxGraph's internal pan: our camera lives in the SVG's
      // CSS transform via applyViewTransform; if any mxGraph handler
      // (panningHandler, autoScroll, etc.) calls panGraph, it would
      // stack a second translate on top of ours and pull the diagram
      // off-screen.
      streamGraph.panGraph = function() {};
      streamGraph.setTooltips(false);
      streamGraph.foldingEnabled = false;
      streamPendingEdges = [];

      var prevIds = getModelCellIds(streamGraph.getModel());
      streamPendingEdges = streamMergeXmlDelta(streamGraph, streamPendingEdges, xmlNode);
      var newIds = findNewCellIds(streamGraph.getModel(), prevIds);

      var topNewIds = filterTopLevelCellIds(streamGraph, newIds);
      // Track only vertices for soft-follow — long edges would defeat
      // the focus by spanning the diagram.
      trackRecentCells(filterVertexCellIds(streamGraph, topNewIds));

      // Only pop-animate top-level cells (parent === '1'). Nested cells
      // (row containers, column cells) appear with their parent so the
      // pop is one unified motion instead of many overlapping scale-ups.
      if (topNewIds.length > 0) queueCellAnimation(streamGraph, topNewIds);

      // streamFollowNewCells sizes the container + soft-follows the
      // leading edge of recent vertices.
      streamFollowNewCells(streamGraph);
    }
    else if (streamGraph != null)
    {
      var prevIds2 = getModelCellIds(streamGraph.getModel());
      streamPendingEdges = streamMergeXmlDelta(streamGraph, streamPendingEdges, xmlNode);
      var newIds2 = findNewCellIds(streamGraph.getModel(), prevIds2);

      // Mermaid re-parses produce stable content-hashed IDs, so a value
      // that changes mid-stream (e.g. a Sankey total accumulating) emits
      // a new cell ID and orphans the old one. Drop those orphans so we
      // don't see a pile-up of stale labels — see issue spotted on a
      // Sankey diagram where "Stromproduktion 71.3", "78.3", "80.8"
      // and "81" were all visible at once during streaming.
      var keepIds = collectCellIdsFromXml(xmlNode);
      removeOrphanCells(streamGraph, keepIds);

      var topNewIds2 = filterTopLevelCellIds(streamGraph, newIds2);
      trackRecentCells(filterVertexCellIds(streamGraph, topNewIds2));
      if (topNewIds2.length > 0) queueCellAnimation(streamGraph, topNewIds2);

      if (pendingAnimCellIds.length > 0 && animDebounceTimer == null)
      {
        queueCellAnimation(streamGraph, []);
      }

      streamFollowNewCells(streamGraph);
    }

    // classDef typically appears near the end of a Mermaid source and
    // restyles existing cells (no new geometry) — so the recent-vertex
    // follow keeps the camera focused on the last node added before the
    // classDef block, hiding the bulk of what's now being styled. Trigger
    // a one-time eased fit-whole the first time classDef shows up so the
    // user sees the full diagram as styling is applied. If more nodes
    // arrive after classDef, recentVertexQueue refills naturally and the
    // regular soft-follow takes over again.
    // shared.js is rendered through a template literal in buildHtml,
    // so any backslash inside this file is consumed once before the
    // browser sees it (\b → U+0008, \s → s). Avoid regex escapes here
    // by using indexOf — Mermaid requires "classDef <name>" so a
    // space after the keyword is reliable.
    if (!mermaidClassDefFitFired && healed.indexOf('classDef ') >= 0)
    {
      mermaidClassDefFitFired = true;
      recentVertexQueue = [];
      lastBatchSize = 0;
      resizeContainerToFit();
      var classDefFit = computeFitWholeTransform();
      if (classDefFit != null)
      {
        animateCameraTo(classDefFit.s, classDefFit.tx, classDefFit.ty, 600, easeInOutCubic);
      }
    }

    lastMergedMermaidText = healed;
  }
  catch (e)
  {
    // Keep the last good graph on screen; next tick may succeed.
  }
}

app.ontoolinputpartial = function(params)
{
  // Mermaid streaming
  var partialMermaid = params.arguments && params.arguments.mermaid;

  if (partialMermaid != null && typeof partialMermaid === 'string')
  {
    handleMermaidPartial(partialMermaid);

    // Once any sibling key (e.g. postLayout) appears
    // in params.arguments, the JSON parser must have closed the mermaid
    // string — those keys come *after* mermaid in the schema, so they
    // can't surface until its closing quote was processed. That means
    // partialMermaid is now the final mermaid value, even though we're
    // still streaming trailing JSON. Kick off finalize + fit early
    // instead of waiting for ontoolinput / ontoolresult, which only
    // fire on the closing "}". The eventual ontoolinput call dedupes
    // via lastFinalizedKey in finalizeStreamingView.
    if (!mermaidEarlyFinalizeFired && streamingInitialized)
    {
      var args = params.arguments;
      var hasSibling = false;
      for (var k in args)
      {
        if (k !== 'mermaid' && Object.prototype.hasOwnProperty.call(args, k))
        {
          hasSibling = true;
          break;
        }
      }

      if (hasSibling)
      {
        mermaidEarlyFinalizeFired = true;
        // Mermaid path: direction comes from the flowchart code, not args.direction.
        var earlyPostLayout = resolvePostLayout(args.postLayout, args.direction, partialMermaid);
        var earlyOpts = {
          skipIntroAnim: true,
          fadeIn: true,
          postLayout: earlyPostLayout,
          replaceMode: true,
          isFlowchart: isMermaidFlowchart(partialMermaid),
          isHorizontal: isMermaidHorizontalFlowchart(partialMermaid)
        };

        waitForGraphViewer()
          .then(whenDocumentLaidOut)
          .then(function() { return convertMermaidToXml(partialMermaid); })
          .then(function(xml) { finalizeStreamingView(xml, earlyOpts); })
          .catch(function(_e)
          {
            // Swallow — ontoolinput/ontoolresult will retry with the
            // authoritative final value and surface any error there.
          });
      }
    }

    return;
  }

  // XML streaming path
  var partialXml = params.arguments && params.arguments.xml;

  if (partialXml == null || typeof partialXml !== 'string')
  {
    return;
  }

  var healedXml = healPartialXml(partialXml);

  if (healedXml == null)
  {
    return;
  }

  // Update loading text during streaming
  if (loadingEl.style.display !== 'none')
  {
    loadingEl.querySelector('.spinner') && (loadingEl.innerHTML =
      '<div class="spinner"></div>Streaming diagram...');
  }

  if (typeof Graph === 'undefined' || typeof mxUtils === 'undefined')
  {
    // Viewer not loaded yet, skip this partial update
    return;
  }

  try
  {
    var xmlDoc = mxUtils.parseXml(healedXml);
    var xmlNode = xmlDoc.documentElement;

    if (!streamingInitialized)
    {
      // First usable partial: create raw Graph in fixed-size container
      streamingInitialized = true;
      lastFinalizedKey = null;
      containerEl.innerHTML = "";
      containerEl.classList.add("streaming");

      var graphDiv = document.createElement("div");
      graphDiv.style.width = "100%";
      graphDiv.style.height = "100%";
      graphDiv.style.overflow = "hidden";
      containerEl.appendChild(graphDiv);

      loadingEl.style.display = "none";
      containerEl.style.display = "block";

      // Create raw Graph instance (not GraphViewer)
      streamGraph = new Graph(graphDiv);
      streamGraph.setEnabled(false);
      // No-op mxGraph's internal pan: our camera lives in the SVG's
      // CSS transform via applyViewTransform; if any mxGraph handler
      // (panningHandler, autoScroll, etc.) calls panGraph, it would
      // stack a second translate on top of ours and pull the diagram
      // off-screen.
      streamGraph.panGraph = function() {};
      streamGraph.setTooltips(false);
      streamGraph.foldingEnabled = false;
      streamPendingEdges = [];

      // Initial merge
      var prevIds = getModelCellIds(streamGraph.getModel());
      streamPendingEdges = streamMergeXmlDelta(streamGraph, streamPendingEdges, xmlNode);
      var newIds = findNewCellIds(streamGraph.getModel(), prevIds);

      // Focus tracker uses ALL new IDs, not just top-level. Cells nested
      // inside a swimlane / group container would be excluded by
      // filterTopLevelCellIds (their parent is the container, not '1'),
      // so the camera couldn't follow content being added inside the
      // container. The container itself is filtered out by isContainerVertex
      // inside trackPartialFocus.
      trackPartialFocus(streamGraph, newIds);

      if (newIds.length > 0)
      {
        queueCellAnimation(streamGraph, newIds);
      }

      // streamFollowNewCells sizes the container + soft-follows the
      // leading edge of recent vertices.
      streamFollowNewCells(streamGraph);
    }
    else if (streamGraph != null)
    {
      // Subsequent partials: merge delta, animate new cells, follow
      var prevIds = getModelCellIds(streamGraph.getModel());
      streamPendingEdges = streamMergeXmlDelta(streamGraph, streamPendingEdges, xmlNode);
      var newIds = findNewCellIds(streamGraph.getModel(), prevIds);

      trackPartialFocus(streamGraph, newIds);

      if (newIds.length > 0)
      {
        queueCellAnimation(streamGraph, newIds);
      }

      // Also flush any deferred cells whose geometry arrived during merge
      if (pendingAnimCellIds.length > 0 && animDebounceTimer == null)
      {
        queueCellAnimation(streamGraph, []);
      }

      // Soft-follow the new leading edge.
      streamFollowNewCells(streamGraph);
    }
  }
  catch (e)
  {
    // Ignore parse errors from partial XML — next partial may fix it.
  }
};

app.ontoolinput = function(params)
{
  var args = (params && params.arguments) || {};
  var mermaidText = args.mermaid;

  // For Mermaid, direction is derived from the flowchart code; for XML, from
  // the optional direction field. resolvePostLayout maps elk to vertical or
  // horizontalFlow accordingly and passes other algorithms through.
  var postLayout = resolvePostLayout(args.postLayout, args.direction,
    (typeof mermaidText === 'string') ? mermaidText : null);

  var layoutOpts = { skipIntroAnim: true, fadeIn: true, postLayout: postLayout };

  if (mermaidText != null && typeof mermaidText === 'string')
  {
    mermaidPreviewEl.style.display = 'none';
    var mermaidOpts = Object.assign({}, layoutOpts, {
      replaceMode: true,
      isFlowchart: isMermaidFlowchart(mermaidText),
      isHorizontal: isMermaidHorizontalFlowchart(mermaidText)
    });

    waitForGraphViewer()
      .then(whenDocumentLaidOut)
      .then(function() { return convertMermaidToXml(mermaidText); })
      .then(function(xml) { finalizeStreamingView(xml, mermaidOpts); })
      .catch(function(e)
      {
        showError("Failed to convert Mermaid diagram: " + e.message);
      });

    return;
  }

  var xml = args.xml;

  if (xml == null || typeof xml !== 'string')
  {
    return;
  }

  if (typeof GraphViewer === 'undefined')
  {
    return;
  }

  // Plain-XML diagram: ensure no stale Mermaid source wraps the export.
  currentMermaidText = null;

  try
  {
    finalizeStreamingView(xml, layoutOpts);
  }
  catch (e)
  {
    showError("Failed to render diagram: " + e.message);
  }
};

app.ontoolresult = function(result)
{
  // Cancel pending ontoolinput render — tool result is authoritative
  if (pendingToolInputTimer != null)
  {
    clearTimeout(pendingToolInputTimer);
    pendingToolInputTimer = null;
  }

  var textBlock = result.content && result.content.find(function(c) { return c.type === "text"; });

  if (result.isError)
  {
    endStreaming();
    var errorMsg = (textBlock && textBlock.text) ? textBlock.text : "Unknown error";
    showError("Tool error: " + errorMsg);
    return;
  }

  if (textBlock && textBlock.type === "text")
  {
    // Unified payload: {xml|mermaid, postLayout, direction + routing (XML only), _buildId} as JSON.
    // Fall back to treating the raw text as XML if JSON parsing fails.
    var mermaidText = null;
    var xmlText = null;
    var postLayout = null;
    var direction = null;
    var routing = null;

    try
    {
      var parsed = JSON.parse(textBlock.text);

      if (parsed && typeof parsed.mermaid === 'string')
      {
        mermaidText = parsed.mermaid;
        postLayout = parsed.postLayout || null;
      }
      else if (parsed && typeof parsed.xml === 'string')
      {
        xmlText = parsed.xml;
        postLayout = parsed.postLayout || null;
        direction = parsed.direction || null;
        routing = parsed.routing || null;
      }
    }
    catch (e)
    {
      // Not JSON — treat the raw text as XML
    }

    // Mermaid: direction from the flowchart code; XML: from the direction field.
    postLayout = resolvePostLayout(postLayout, direction, mermaidText);
    // routing is "libavoid" (obstacle-avoiding edge routing) or null — XML only.
    routing = (routing === 'libavoid') ? 'libavoid' : null;

    var layoutOpts = { skipIntroAnim: true, fadeIn: true, postLayout: postLayout, routing: routing };

    if (mermaidText != null)
    {
      mermaidPreviewEl.style.display = 'none';
      var mermaidOpts = Object.assign({}, layoutOpts, {
        replaceMode: true,
        isFlowchart: isMermaidFlowchart(mermaidText),
        isHorizontal: isMermaidHorizontalFlowchart(mermaidText)
      });

      waitForGraphViewer()
        .then(whenDocumentLaidOut)
        .then(function() { return convertMermaidToXml(mermaidText); })
        .then(function(xml) { finalizeStreamingView(xml, mermaidOpts); })
        .catch(function(e)
        {
          showError("Failed to convert Mermaid diagram: " + e.message);
        });
    }
    else
    {
      var rawXml = xmlText != null ? xmlText : textBlock.text;
      var normalizedXml = normalizeDiagramXml(rawXml);

      // Plain-XML diagram: ensure no stale Mermaid source wraps the export.
      currentMermaidText = null;

      if (normalizedXml)
      {
        // waitForGraphViewer ensures Graph/mxUtils/mxCodec are loaded
        // before the cold-start init path runs.
        waitForGraphViewer()
          .then(function() { finalizeStreamingView(normalizedXml, layoutOpts); })
          .catch(function(e)
          {
            showError("Failed to render diagram: " + e.message);
          });
      }
      else
      {
        endStreaming();
        var inputPreview = rawXml.substring(0, 200);
        showError(invalidDiagramXmlMessage + "\\n\\nReceived (first 200 chars): " + inputPreview);
      }
    }
  }
  else
  {
    // Some hosts (observed on Claude iOS) deliver tool results whose
    // content array has no type:"text" block. If streaming already
    // produced a valid render, the diagram on screen is correct —
    // suppress the error rather than clobbering it with an overlay.
    if (streamingInitialized && currentXml != null)
    {
      return;
    }

    endStreaming();
    var blockTypes = result.content
      ? result.content.map(function(c) { return c.type; }).join(", ")
      : "none";
    showError(invalidDiagramXmlMessage + "\\n\\nContent block types: " + blockTypes);
  }
};

openDrawioBtn.addEventListener("click", function()
{
  if (drawioEditUrl)
  {
    app.openLink({ url: drawioEditUrl });
  }
});

copyXmlBtn.addEventListener("click", function()
{
  if (!currentXml) return;

  var ta = document.createElement("textarea");
  ta.value = currentXml;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  var label = document.getElementById('copy-xml-label');
  if (label != null)
  {
    label.textContent = 'Copied!';
    setTimeout(function() { label.textContent = 'Copy'; }, 2000);
  }
});

fullscreenBtn.addEventListener("click", function()
{
  // Toggle: if we're already fullscreen, ask the host to put us back
  // inline. The label is kept in sync via applyDisplayModeLayout when
  // hostContext changes.
  var nextMode = (currentDisplayMode === 'fullscreen') ? 'inline' : 'fullscreen';
  app.requestDisplayMode({ mode: nextMode });
});

// Expand toggle: bump the inline max-height cap so tall diagrams that
// fit-zoom out due to height (not width) can use more vertical real
// estate. Two states — default (480 px) and expanded (1000 px). The
// host (Claude.ai) only honors sendSizeChanged growth, not shrinks, so
// going from expanded → default may not actually shrink the iframe in
// production; the CSS cap will still apply but the iframe stays tall.
document.getElementById('expand-btn').addEventListener('click', function()
{
  var btn = document.getElementById('expand-btn');
  var iconExpand = document.getElementById('expand-icon-expand');
  var iconCollapse = document.getElementById('expand-icon-collapse');
  var isExpanded = document.body.classList.toggle('expanded');
  STREAM_VIEWPORT_MAX_HEIGHT_INLINE = isExpanded
    ? STREAM_VIEWPORT_MAX_HEIGHT_EXPANDED
    : STREAM_VIEWPORT_MAX_HEIGHT_INLINE_DEFAULT;
  iconExpand.style.display = isExpanded ? 'none' : '';
  iconCollapse.style.display = isExpanded ? '' : 'none';
  var label = isExpanded ? 'Collapse to default size' : 'Expand vertically';
  btn.setAttribute('title', label);
  btn.setAttribute('aria-label', label);
  // Resize container to its new natural-fit height (notifies host of
  // the new desired iframe height), then refit the camera so the new
  // vertical real estate gets used.
  resizeContainerToFit();
  requestAnimationFrame(function()
  {
    customFitView();
  });
});

// Zoom controls (custom viewer only; buttons stay hidden otherwise).
// Step = ×1.5 / ×0.667 — small enough to feel under control, big
// enough that two clicks are a meaningful zoom change.
document.getElementById('zoom-in-btn').addEventListener('click', function()
{
  customZoomBy(1.5);
});

document.getElementById('zoom-out-btn').addEventListener('click', function()
{
  customZoomBy(1 / 1.5);
});

// 2-state toggle: when fitted, zoom in to the zoomInTargetScale()
// (fit-to-width for tall/narrow, 100% otherwise) with the top of the
// diagram anchored to the top of the container — for tall diagrams
// this reveals the start of the content rather than the middle. When
// already zoomed in, fall back to fit-whole.
document.getElementById('zoom-fit-btn').addEventListener('click', function()
{
  if (streamGraph == null) return;
  if (dblclickZoomedIn)
  {
    customFitView();
    return;
  }
  var t = computeTopAnchoredTransform(zoomInTargetScale());
  if (t != null)
  {
    animateCameraTo(t.s, t.tx, t.ty, 320);
  }
  dblclickZoomedIn = true;
  updateZoomFitButtonUi();
});

// Layout toggle: as-authored ↔ alternative (horizontal or vertical,
// chosen per-diagram in finalizeStreamingView).
layoutBtn.addEventListener('click', function()
{
  var next = (currentLayoutState === 'none') ? layoutAlternativeState : 'none';
  applyLayoutChange(next);
});

// Help → opens a Discussions topic in the drawio-mcp repo. Use
// app.openLink because the iframe sandbox lacks allow-popups, so
// window.open / target=_blank don't work.
document.getElementById('help-btn').addEventListener('click', function()
{
  app.openLink({ url: "https://github.com/jgraph/drawio-mcp/discussions/33" });
});

// When the tab becomes visible, re-notify our size so the host can
// re-measure the iframe. Don't call customFitView here — that would
// reset any zoom/pan the user has applied. Stale-layout cases get
// caught by the resize handler below.
document.addEventListener('visibilitychange', function()
{
  if (!document.hidden && currentXml && streamGraph != null)
  {
    notifySize('visibilitychange');
  }
});

// Re-fit the camera when the iframe is resized. Fullscreen layout uses
// flex 1 1 auto on the container, so its clientHeight changes with the
// window without triggering a host-context-changed. Snap-fit so the
// camera tracks the resize instantly.
//
// EXCEPT when the user has explicitly zoomed in (dblclickZoomedIn).
// Claude.ai resizes the iframe in response to scroll / sendSizeChanged
// feedback after layout; without this gate, every such resize wipes
// the user's zoom state without flipping the Fit button icon (the
// resize path doesn't touch dblclickZoomedIn). The user can hit Fit
// to refit on demand.
window.addEventListener('resize', function()
{
  if (streamGraph == null) return;
  if (dblclickZoomedIn) return;
  // During an active stream a snap-fit kills any in-flight eased
  // transition the moment Claude.ai's sendSizeChanged feedback fires
  // (which it does whenever the diagram visually grows). Use the
  // smooth path so the camera keeps gliding instead of jumping.
  streamFollowNewCells(streamGraph, false);
});

app.connect().then(function()
{
  // Pick up the initial displayMode + safeAreaInsets after handshake.
  applyDisplayModeLayout();
});
    </script>
  </body>
</html>`;
}

/**
 * Strip the trailing ESM `export{...}` statement and emit `var <name> = <local>`
 * aliases so the bundle works when inlined as a classic <script>. ESM modules
 * can't be loaded that way (export is a syntax error) and Blob-URL `import()`
 * fails inside our sandboxed iframe (no allow-same-origin).
 *
 * @param {string} raw - Bundle source ending in `export{a as X, b as Y, ...}`.
 * @param {object} aliasMap - { globalVarName: exportedName }. Each entry adds
 *   one `var <globalVarName> = <localName>;` line after the (stripped) bundle.
 * @returns {string} Processed bundle.
 */
function stripEsmExportsAndAlias(raw, aliasMap, bundleLabel)
{
  // Find the LAST export{...} statement. Bundles may have a trailing
  // license banner comment after the export, so we don't anchor to end.
  const exportRegex = /export\s*\{([^}]+)\}\s*;?/g;
  let exportMatch = null;
  let m;

  while ((m = exportRegex.exec(raw)) !== null)
  {
    exportMatch = m;
  }

  if (exportMatch == null)
  {
    throw new Error("Could not find export statement in " + bundleLabel);
  }

  const entries = {};

  exportMatch[1].split(",").forEach(function(e)
  {
    const parts = e.trim().split(/\s+as\s+/);
    const local = parts[0];
    const exported = parts[1] || parts[0];
    entries[exported] = local;
  });

  // Publish via globalThis (not `var X = ...`) because we wrap the bundle
  // in an IIFE below — `var` inside the IIFE wouldn't reach the global.
  const aliasLines = Object.keys(aliasMap).map(function(globalName)
  {
    const exportedName = aliasMap[globalName];
    const local = entries[exportedName];

    if (local == null)
    {
      throw new Error("Could not find '" + exportedName + "' export in " + bundleLabel);
    }

    return "globalThis." + globalName + " = " + local + ";";
  });

  // Splice the export statement out and wrap the result in an IIFE.
  //
  // Two bundles inlined as classic scripts in the same page would otherwise
  // share the global lexical environment. Top-level `let`/`const` use the
  // same minifier names across bundles (e.g. `let Nr = ...`) — when the
  // second bundle hits its own `let Nr`, the parser throws
  // "Identifier 'Nr' has already been declared" and aborts the whole
  // bundle script. The IIFE gives each bundle its own scope.
  const before = raw.slice(0, exportMatch.index);
  const after = raw.slice(exportMatch.index + exportMatch[0].length);

  return "(function(){\n" +
         before + "\n" +
         aliasLines.join("\n") + "\n" +
         after + "\n" +
         "})();\n";
}

/**
 * Read the app-with-deps.js bundle, strip ESM exports, and create a local App alias.
 *
 * @param {string} raw - The raw content of app-with-deps.js.
 * @returns {string} The processed bundle with exports stripped and App alias added.
 */
export function processAppBundle(raw)
{
  return stripEsmExportsAndAlias(raw, { App: "App" }, "app-with-deps.js");
}

/**
 * Process the drawio-mermaid bundle. The bundle has shipped in two
 * formats: an ESM build with `export{...}` at the end, and a self-
 * contained IIFE that already assigns `globalThis.mxMermaidToDrawio`
 * itself. Detect which one we're looking at and only run the ESM
 * strip-and-alias path when there's actually an export statement —
 * otherwise return the bundle as-is (the IIFE publishes the global it-
 * self, and stripping wouldn't find anything to strip).
 */
export function processMermaidBundle(raw)
{
  if (!/export\s*\{[^}]*\}/.test(raw))
  {
    return raw;
  }

  return stripEsmExportsAndAlias(raw, { mxMermaidToDrawio: "mxMermaidToDrawio" }, "drawio-mermaid.min.js");
}

/**
 * Process the drawio-elk bundle. Two bundle formats have shipped:
 *
 *   - ESM: ends with `export { default, ElkLayout, ElkAdapter, ElkApplier }`.
 *     Stripped + IIFE-wrapped + aliased to globalThis here.
 *   - IIFE: self-contained, ends with `var ELK=(()=>{...})(); var ElkLayout=ELK.ElkLayout,...; ELK=ELK.default;`.
 *     Already publishes the four globals; pass through as-is.
 *
 * Detect which format by looking for an `export {...}` statement.
 */
export function processElkBundle(raw)
{
  if (!/export\s*\{[^}]*\}/.test(raw))
  {
    return raw;
  }

  return stripEsmExportsAndAlias(raw,
    {
      ELK: "default",
      ElkLayout: "ElkLayout",
      ElkAdapter: "ElkAdapter",
      ElkApplier: "ElkApplier"
    },
    "drawio-elk.min.js");
}

/**
 * Process the libavoid-js browser bundle (obstacle-avoiding orthogonal edge
 * routing — the `routing: "libavoid"` pass). Ships as ESM ending in
 * `export{X as AvoidLib}` and uses `import.meta.url` (illegal in a classic
 * <script>). Three transforms before the standard strip-and-alias:
 *
 *   1. Neutralize `import.meta.url` → "". It is only used by the Emscripten
 *      module to locate the .wasm via fetch — which we bypass entirely.
 *   2. Patch the loader so the Emscripten factory receives `wasmBinary`
 *      (a Uint8Array set on globalThis). The sandboxed iframe has no
 *      allow-same-origin and the host CSP's connect-src forbids data: URIs,
 *      so we hand the wasm bytes in directly instead of fetching them.
 *   3. Strip the ESM export and alias `globalThis.AvoidLib`.
 */
export function processLibavoidBundle(raw)
{
  raw = raw.replace(/import\.meta\.url/g, '""');

  // `this.avoidLib=await le({locateFile:ce})` →
  // `... await le({locateFile:ce,wasmBinary:(globalThis.__LIBAVOID_WASM_BINARY||void 0)})`
  var patched = raw.replace(
    /(await\s+\w+\(\{\s*locateFile\s*:\s*\w+)\s*\}\)/,
    "$1,wasmBinary:(globalThis.__LIBAVOID_WASM_BINARY||void 0)})"
  );

  if (patched === raw)
  {
    throw new Error("Could not patch libavoid loader to accept wasmBinary (loader signature changed?)");
  }

  return stripEsmExportsAndAlias(patched, { AvoidLib: "AvoidLib" }, "libavoid.min.js");
}

// ── Diagram validation ───────────────────────────────────────────────────────

/**
 * Validate draw.io XML and return errors/warnings.
 * Uses regex-based extraction — no XML parser needed.
 *
 * @param {string} xml - Raw draw.io XML string.
 * @returns {{errors: string[], warnings: string[]}}
 */
function validateDiagramXml(xml)
{
  var errors = [];
  var warnings = [];

  // 1. XML comments
  if (xml.indexOf("<!--") >= 0)
  {
    errors.push("XML comments (<!-- -->) are forbidden — remove all comments");
  }

  // 2. Collect all IDs and cell metadata via regex
  //    Match both <mxCell ...> and <mxCell .../> and <object ...>/<UserObject ...>
  var allIds = new Set();
  var duplicateIds = [];
  var cells = []; // {id, edge, vertex, source, target, parent, selfClosing, hasGeometryChild, line}

  // Extract id attributes from all elements (mxCell, object, UserObject)
  var idRegex = /\bid="([^"]*)"/g;
  var idMatch;

  while ((idMatch = idRegex.exec(xml)) !== null)
  {
    var id = idMatch[1];

    if (allIds.has(id))
    {
      duplicateIds.push(id);
    }
    else
    {
      allIds.add(id);
    }
  }

  if (duplicateIds.length > 0)
  {
    errors.push("Duplicate IDs: " + duplicateIds.join(", "));
  }

  // 3. Check structural cells
  if (!allIds.has("0"))
  {
    errors.push("Missing root cell with id=\"0\" — every diagram needs <mxCell id=\"0\"/>");
  }

  if (!allIds.has("1"))
  {
    errors.push("Missing default layer cell with id=\"1\" parent=\"0\" — every diagram needs <mxCell id=\"1\" parent=\"0\"/>");
  }

  // 4. Parse mxCell elements for detailed checks
  //    We split the XML by <mxCell to process each cell block
  var cellBlocks = xml.split(/<mxCell\s/);

  for (var i = 1; i < cellBlocks.length; i++)
  {
    var block = cellBlocks[i];

    // Find the end of the opening tag
    var tagEnd = block.indexOf(">");

    if (tagEnd < 0)
    {
      continue;
    }

    var tagContent = block.substring(0, tagEnd);
    var isSelfClosing = tagContent.charAt(tagContent.length - 1) === "/";

    // Extract attributes
    var attrs = {};
    var attrRegex = /(\w+)="([^"]*)"/g;
    var m;

    while ((m = attrRegex.exec(tagContent)) !== null)
    {
      attrs[m[1]] = m[2];
    }

    var isEdge = attrs.edge === "1";
    var isVertex = attrs.vertex === "1";

    // 5. Self-closing edge cells (missing mxGeometry)
    if (isEdge && isSelfClosing)
    {
      errors.push("Edge id=\"" + (attrs.id || "?") + "\" is self-closing — every edge must contain <mxGeometry relative=\"1\" as=\"geometry\"/> as a child element");
    }

    // 6. Edge without mxGeometry child (non-self-closing but still missing it)
    if (isEdge && !isSelfClosing)
    {
      // Check if the block between > and </mxCell> contains mxGeometry
      var closingIdx = block.indexOf("</mxCell>");

      if (closingIdx > tagEnd)
      {
        var body = block.substring(tagEnd + 1, closingIdx);

        if (body.indexOf("mxGeometry") < 0)
        {
          errors.push("Edge id=\"" + (attrs.id || "?") + "\" has no <mxGeometry> child — edges must contain <mxGeometry relative=\"1\" as=\"geometry\"/>");
        }
      }
    }

    // 7. Dangling source/target references
    if (attrs.source && !allIds.has(attrs.source))
    {
      warnings.push("Edge id=\"" + (attrs.id || "?") + "\" references source=\"" + attrs.source + "\" which does not exist");
    }

    if (attrs.target && !allIds.has(attrs.target))
    {
      warnings.push("Edge id=\"" + (attrs.id || "?") + "\" references target=\"" + attrs.target + "\" which does not exist");
    }

    // 8. Dangling parent references (skip "0" and "1" which are structural)
    if (attrs.parent && attrs.parent !== "0" && !allIds.has(attrs.parent))
    {
      warnings.push("Cell id=\"" + (attrs.id || "?") + "\" references parent=\"" + attrs.parent + "\" which does not exist");
    }

    // 9. Cell with source/target but missing edge="1"
    if ((attrs.source || attrs.target) && !isEdge)
    {
      warnings.push("Cell id=\"" + (attrs.id || "?") + "\" has source/target attributes but is missing edge=\"1\"");
    }
  }

  return { errors: errors, warnings: warnings };
}

// ── Shape search ── imported from ../../shared/shape-search.js (buildTagMap, searchShapes)

// ── Server ───────────────────────────────────────────────────────────────────

/**
 * Create a new MCP server instance with the create_diagram tool + UI resource.
 *
 * @param {string} html - The pre-built, self-contained HTML string.
 * @param {object} [options] - Options.
 * @param {string} [options.domain] - Widget domain for ChatGPT sandbox rendering (e.g. "https://mcp.draw.io").
 * @param {string} [options.xmlReference] - XML generation reference text for the tool description.
 * @param {string} [options.mermaidReference] - Mermaid syntax reference text appended to the tool description.
 * @param {Array} [options.shapeIndex] - Shape search index array from search-index.json.
 * @param {string} [options.buildId] - Build identifier (git SHA + timestamp). Echoed back in every tool response as `_buildId` so you can confirm which deploy you're hitting.
 * @returns {McpServer}
 */
export function createServer(html, options = {})
{
  const { domain, xmlReference = "", mermaidReference = "", shapeIndex = null, buildId = "unknown" } = options;
  const server = new McpServer({ name: "drawio-mcp-app", version: "1.0.0" });

  const resourceUri = "ui://drawio/mcp-app.html";

  registerAppTool(
    server,
    "create_diagram",
    {
      title: "Create Diagram",
      description:
        "Creates and displays an interactive draw.io diagram. Accepts either draw.io XML or Mermaid.js syntax — provide exactly one.\n\n" +
        "**Format decision — this is the first thing to settle before you write anything:** if the diagram type appears on the Mermaid list below, use `mermaid`. Only use `xml` when the diagram type isn't on that list (UI mockups, floorplans, cloud/network/electrical architecture with stencils, hand-placed UML, etc.) or when the user has explicitly asked for draw.io XML.\n\n" +
        "**Use Mermaid** for the following diagram types (all rendered natively, no upstream mermaid runtime):\n" +
        "  - flowchart / graph (TD, LR, …)\n" +
        "  - sequenceDiagram\n" +
        "  - classDiagram\n" +
        "  - stateDiagram / stateDiagram-v2\n" +
        "  - erDiagram\n" +
        "  - gantt\n" +
        "  - pie\n" +
        "  - journey (user-journey)\n" +
        "  - gitGraph\n" +
        "  - mindmap\n" +
        "  - timeline\n" +
        "  - quadrantChart\n" +
        "  - xychart-beta\n" +
        "  - sankey-beta\n" +
        "  - requirementDiagram\n" +
        "  - C4Context / C4Container / C4Component\n" +
        "  - block-beta\n" +
        "  - architecture-beta\n" +
        "  - packet-beta\n" +
        "  - kanban\n" +
        "  - radar-beta\n" +
        "  - treemap-beta\n" +
        "  - treeview-beta (draw.io-specific)\n" +
        "  - venn (draw.io-specific) — syntax: `venn` then `set A [\"Label\"]` for each set, `union A,B` for declared overlaps (informational), and `text A` / `text A,B` followed by `[\"Region label\"]` for text inside a region. Do NOT use `A AND B[...]` or `A[\"...\"]` shorthand — those lines are ignored.\n" +
        "  - ishikawa (draw.io-specific)\n" +
        "  - zenuml\n" +
        "**Strong default: use Mermaid for every diagram type on that list above.** Mermaid is simpler, more reliable, and the native Mermaid layout handles positioning and routing for you. For a flowchart, state diagram, sequence, ER, class, gantt, gitGraph, mindmap, etc. — reach for the `mermaid` parameter, not `xml`. Do not default to XML for flowcharts.\n\n" +
        "**Use XML** when the diagram type isn't on the Mermaid list above OR when the user explicitly asks for XML / draw.io format. Typical cases where XML is the right choice:\n" +
        "- **UI mockups / wireframes / screen designs** — buttons, form fields, sidebars, modal dialogs (`shape=mxgraph.bootstrap.*`, `shape=mxgraph.ios.*`, `shape=mxgraph.android.*`)\n" +
        "- **Floor plans / seating charts / room layouts** — rooms, doors, furniture (`shape=mxgraph.floorplan.*`)\n" +
        "- **Cloud architecture** with AWS / Azure / GCP / Kubernetes icons (`shape=mxgraph.aws4.*`, `shape=mxgraph.azure.*`, `shape=mxgraph.gcp2.*`, `shape=mxgraph.kubernetes.*`)\n" +
        "- **Network topology** with Cisco / Rack / networking shapes (`shape=mxgraph.cisco*.*`, `shape=mxgraph.rack.*`, `shape=mxgraph.networking.*`)\n" +
        "- **P&ID / electrical / engineering schematics** (`shape=mxgraph.pid2.*`, `shape=mxgraph.electrical.*`, `shape=mxgraph.mscae.*`)\n" +
        "- **Swimlanes / pools** with custom colors and hand-placed contents\n" +
        "- **UML class / component / deployment diagrams** where positioning carries meaning\n" +
        "- **Venn diagrams, quadrant charts, concept maps** with custom regions — anything where hand-placed geometry is the point\n" +
        "- **Any diagram requiring specific colors, fonts, stencils, or layouts** that Mermaid can't control precisely\n" +
        "Call `search_shapes` first when you need industry icons (AWS / Azure / Cisco / P&ID / Kubernetes / floorplan / mockup / electrical) to find the correct `style` string for each shape.\n\n" +
        "---\n\n" +
        "**XML reasoning discipline (applies ONLY when you chose XML — skip this whole section if you're using Mermaid):** Your job in XML is declaring logical structure — nodes, edges, labels, groupings. Follow these steps in order: (1) **Decide `postLayout` and `routing` FIRST, before writing any XML.** If the XML diagram is a flowchart, state diagram, decision tree, or any directional/hierarchical process diagram (which you should rarely be writing as XML — prefer Mermaid), you MUST pass `postLayout: \"elk\"` (add `direction: \"horizontal\"` when the flow is drawn left-to-right; it defaults to vertical). Omit `postLayout` only when the layout carries hand-crafted meaning (swimlanes, containers, architecture, UML) — the typical reason you chose XML in the first place. When `postLayout` is set, your x/y coordinates only need to express rough direction; ELK re-lays out the vertices. For those hand-placed diagrams where you omit `postLayout`, consider `routing: \"libavoid\"` — it leaves your positions untouched and only routes the edges around the boxes in clean right angles (set it whenever connectors would otherwise overlap or cut through shapes). Treat `postLayout` and `routing` as alternatives: ELK already routes its own edges, so if you set `postLayout: \"elk\"` do NOT also set `routing` (redundant); use `routing` only on a hand-placed layout where you are NOT re-laying-out with ELK. (2) Pick ONE concrete scenario on your first impulse and commit — do not pitch alternatives, do not flip-flop between approaches. (3) Use the rigid grid in the XML reference (`x = col*180 + 40`, `y = row*120 + 40`) without computing spacings, canvas dimensions, or overlap checks. (4) Never add `<Array as=\"points\">` waypoints or `exitX/exitY/entryX/entryY` — when postLayout or routing runs it sets them; otherwise drawio's edge router handles it. (5) Do NOT narrate in your reasoning: no \"building the diagram\", no column enumeration, no coordinate math in prose, no coordinate re-verification after placement. Go straight to XML.\n\n" +
        "**User preference override — XML only.** If the user expresses a preference for draw.io XML over Mermaid in any phrasing (examples: \"no mermaid\", \"skip mermaid\", \"use xml\", \"I want drawio format\", \"stop using mermaid\", \"give me the xml\", \"native drawio only\", etc.), from that point onward in the conversation you MUST use the `xml` parameter exclusively and MUST NOT use the `mermaid` parameter, even for diagram types where Mermaid would normally be preferable. This preference persists for the remainder of the conversation unless the user clearly reverses it (e.g. \"mermaid is fine again\"). When the preference is active, translate any diagram request — including flowcharts, sequence diagrams, ER diagrams, etc. — directly to well-formed mxGraphModel XML.\n\n" +
        "When using XML: IMPORTANT — the XML must be well-formed. Do NOT include ANY XML comments (<!-- -->) in the output.\n\n" +
        xmlReference +
        (mermaidReference ? "\n\n---\n\n" + mermaidReference : ""),
      inputSchema:
      {
        xml: z
          .string()
          .optional()
          .describe(
            "draw.io XML content in mxGraphModel format. Must be well-formed XML: no XML comments (<!-- -->), no unescaped special characters in attribute values. Mutually exclusive with 'mermaid'."
          ),
        mermaid: z
          .string()
          .optional()
          .describe(
            "Mermaid.js diagram definition (e.g. 'graph TD\\n  A-->B'). Supports 26 diagram types — see the tool description for the full list. The diagram is parsed and laid out natively (no upstream mermaid runtime) and converted to draw.io format. Mutually exclusive with 'xml'."
          ),
        postLayout: z
          .enum(["elk"])
          .optional()
          .describe(
            "Optional client-side ELK (Eclipse Layout Kernel) layered-flow pass applied after the diagram renders. The only value is `\"elk\"`. Vertices animate (morph) from the positions you supplied to the layered layout — they are **replaced**, so only your edge topology survives. Set it for directional/hierarchical diagrams: flowcharts, process diagrams, state diagrams, decision flows, pipelines, ER/class diagrams with clear parent→child direction. Flow direction (top-down vs left-to-right): for **Mermaid** it is taken from the flowchart code (`flowchart TD/TB` → top-down, `LR/RL` → left-to-right) — do not try to set it here; for **XML** set the optional `direction` field (defaults to top-down).\n" +
            "**Omit** for diagrams whose layout carries meaning you hand-crafted: swimlanes/pools, containers, architecture / deployment / network topology with grouped regions, P&ID or circuit schematics, floor plans, UML diagrams with deliberate placement.\n\n" +
            "**For Mermaid flowcharts**, the native parser does its own layout, but it produces cramped or unbalanced output once the diagram has any structural complexity. Request `postLayout: \"elk\"` whenever ANY of the following holds: ≥ ~20 nodes, OR ≥ 3 decision diamonds (`{...}` shapes), OR any feedback/back-edges (an edge that points to an earlier node, e.g. an error path looping back to a retry), OR ≥ 3 distinct endpoints — the flow direction follows the flowchart code, so you never pass `direction` for Mermaid. Skip for simple flowcharts (linear chains, < 20 nodes, no branching/back-edges) and for non-flowchart Mermaid types (sequence, class, ER, sankey, etc. — postLayout doesn't apply)."
          ),
        direction: z
          .enum(["vertical", "horizontal"])
          .optional()
          .describe(
            "**XML only** — the flow direction for `postLayout: \"elk\"` on XML diagrams: `vertical` (top-down) or `horizontal` (left-to-right). Defaults to `vertical`. **Ignored for Mermaid**, where direction is read from the flowchart code (`flowchart TD/TB` vs `LR/RL`). Only meaningful together with `postLayout: \"elk\"`."
          ),
        routing: z
          .enum(["libavoid"])
          .optional()
          .describe(
            "**XML only** — optional obstacle-avoiding orthogonal **edge-routing** pass (libavoid). The only value is `\"libavoid\"`. Unlike `postLayout`, this does **not** move any vertices — it keeps your hand-placed coordinates and only recomputes each edge's path so wires run in clean right-angle segments that route *around* the boxes instead of cutting through them. Set it for XML diagrams where you have placed nodes deliberately (architecture, network topology, deployment, swimlanes, UML, floor plans) and want tidy connectors without overlaps — exactly the diagrams where you'd OMIT `postLayout`.\n" +
            "draw.io's default router is basic (straight or simple right-angle lines with **no obstacle avoidance** — wires cut straight through any box between the endpoints), so reach for `\"libavoid\"` whenever edges would otherwise cross shapes or you want uniformly clean orthogonal wiring on a layout you placed yourself. Think of `routing` and `postLayout` as **alternatives**: use `routing: \"libavoid\"` to keep your positions and only fix the wires, or `postLayout: \"elk\"` to re-lay-out the vertices — and note ELK already routes its edges decently, so when you use `postLayout` you normally should **not** also set `routing` (the combination is redundant in almost all cases). Do not add `<Array as=\"points\">` waypoints yourself when routing is set; libavoid computes them. **Ignored for Mermaid** (its native/ELK layout already routes)."
          ),
      },
      annotations:
      {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta:
      {
        ui: { resourceUri },
        "openai/toolInvocation/invoking": "Creating diagram...",
        "openai/toolInvocation/invoked": "Diagram ready.",
      },
    },
    async function({ xml, mermaid, postLayout, direction, routing })
    {
      var hasXml = (xml != null && typeof xml === "string" && xml.trim().length > 0);
      var hasMermaid = (mermaid != null && typeof mermaid === "string" && mermaid.trim().length > 0);

      if (hasXml === hasMermaid)
      {
        return {
          content: [{ type: "text", text: "Provide exactly one of 'xml' or 'mermaid'. " + (hasXml ? "Both were provided." : "Neither was provided.") }],
          isError: true,
        };
      }

      // Mermaid path: return JSON for client-side conversion
      if (hasMermaid)
      {
        var mermaidPayload = { mermaid: mermaid };
        if (postLayout) mermaidPayload.postLayout = postLayout;
        mermaidPayload._buildId = buildId;
        return {
          content: [{ type: "text", text: JSON.stringify(mermaidPayload) }],
        };
      }

      // XML path: normalize, validate
      var normalizedXml = normalizeDiagramXml(xml);

      if (!normalizedXml)
      {
        var preview = xml.length > 200 ? xml.substring(0, 200) + "..." : xml;
        return {
          content: [{ type: "text", text: "Could not extract draw.io XML from input. Expected <mxGraphModel> or <mxfile> root element. Received (first 200 chars): " + preview }],
          isError: true,
        };
      }

      var xmlPayload = { xml: normalizedXml };
      if (postLayout) xmlPayload.postLayout = postLayout;
      // direction + routing are XML-only; Mermaid derives direction from the
      // flowchart code and its layout already routes, so routing is omitted there.
      if (direction) xmlPayload.direction = direction;
      if (routing) xmlPayload.routing = routing;
      xmlPayload._buildId = buildId;

      var content = [
        { type: "text", text: JSON.stringify(xmlPayload) }
      ];

      // Validate and append warnings/errors so the LLM can self-correct
      var validation = validateDiagramXml(normalizedXml);

      if (validation.errors.length > 0 || validation.warnings.length > 0)
      {
        var messages = [];

        if (validation.errors.length > 0)
        {
          messages.push("ERRORS (will cause rendering issues):\n- " + validation.errors.join("\n- "));
        }

        if (validation.warnings.length > 0)
        {
          messages.push("WARNINGS (may cause issues):\n- " + validation.warnings.join("\n- "));
        }

        content.push({ type: "text", text: messages.join("\n\n") });
      }

      return { content: content };
    }
  );

  // ── search_shapes tool (only registered when shapeIndex is provided) ───────

  if (shapeIndex && shapeIndex.length > 0)
  {
    var tagMap = buildTagMap(shapeIndex);

    registerAppTool(
      server,
      "search_shapes",
      {
        title: "Search Shapes",
        description:
          "Search the draw.io shape library by keywords. Returns matching shapes with " +
          "their exact style strings, dimensions, and titles. Use ONLY for diagrams that " +
          "need industry-specific or branded icons (cloud architecture, network topology, " +
          "P&ID, electrical, Cisco, Kubernetes, BPMN). Do NOT use for standard diagram " +
          "types like flowcharts, UML, ERD, org charts, or mind maps — these use basic " +
          "geometric shapes (rectangles, diamonds, circles, cylinders) that are already " +
          "covered in the XML reference. Also skip if the user asks to use basic/simple " +
          "shapes or says not to search. The style string from the results can be " +
          "used directly in mxCell style attributes.",
        inputSchema:
        {
          query: z
            .string()
            .describe(
              "Space-separated search keywords (e.g. 'pid globe valve', 'aws lambda', 'cisco router', 'kubernetes pod')"
            ),
          limit: z
            .number()
            .optional()
            .describe(
              "Maximum number of results to return (default: 10, max: 50)"
            ),
        },
        annotations:
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta:
        {
          "openai/toolInvocation/invoking": "Searching shapes...",
          "openai/toolInvocation/invoked": "Shape search complete.",
        },
      },
      async function({ query, limit })
      {
        var maxLimit = Math.min(limit || 10, 50);
        var results = searchShapes(shapeIndex, tagMap, query, maxLimit);

        if (results.length === 0)
        {
          return {
            content: [{ type: "text", text: "No shapes found for query: " + query }],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }
    );
  }

  registerAppResource(
    server,
    "Draw.io Diagram Viewer",
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async function()
    {
      return {
        contents:
        [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta:
            {
              ui:
              {
                ...(domain ? { domain } : {}),
                csp:
                {
                  resourceDomains: ["https://viewer.diagrams.net", "https://app.diagrams.net"],
                  connectDomains: ["https://viewer.diagrams.net"],
                },
              },
            },
          },
        ],
      };
    }
  );

  return server;
}
