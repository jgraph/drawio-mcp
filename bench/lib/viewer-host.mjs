// A minimal MCP Apps host for headless Chrome: loads the app server's HTML
// in a sandboxed 800 px iframe, answers ui/initialize like a chat host, sends
// the tool input and result that window.__payload holds, and keeps every
// ui/update-model-context in window.__ctx (the viewer's layout check and the
// PNG it sends to the model). Used by render.mjs and agents/render.mjs.

export const hostHtml = `<!doctype html><html><body style="margin:0;background:#fff">
<iframe id="f" sandbox="allow-scripts" style="width:800px;height:800px;border:0"></iframe>
<script>
window.__ctx = [];
var f = document.getElementById('f');
function reply(id, result) { f.contentWindow.postMessage({ jsonrpc: '2.0', id: id, result: result }, '*'); }
function notify(method, params) { f.contentWindow.postMessage({ jsonrpc: '2.0', method: method, params: params }, '*'); }
window.addEventListener('message', function(e)
{
  var m = e.data;
  if (!m || m.jsonrpc !== '2.0') return;
  if (m.method === 'ui/initialize')
  {
    reply(m.id, { protocolVersion: m.params.protocolVersion, hostInfo: { name: 'bench-host', version: '1' },
      hostCapabilities: { updateModelContext: { text: {}, image: {} }, message: { text: {} }, openLinks: {} },
      hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline'],
        containerDimensions: { width: 800, maxHeight: 800 }, platform: 'web' } });
  }
  else if (m.method === 'ui/notifications/initialized')
  {
    notify('ui/notifications/tool-input', { arguments: window.__payload.arguments });
    setTimeout(function() { notify('ui/notifications/tool-result', window.__payload.result); }, 50);
  }
  else if (m.method === 'ui/update-model-context')
  {
    window.__ctx.push(m.params);
    reply(m.id, {});
  }
  else if (m.method === 'ui/notifications/size-changed')
  {
    if (m.params && m.params.height) f.style.height = Math.min(1000, m.params.height) + 'px';
  }
  else if (m.id != null)
  {
    reply(m.id, {});
  }
});
</script></body></html>`;
