// What a session's events say, for both stream formats: Claude Code's
// stream-json (with partial messages) and Codex's `exec --json`. Times are
// seconds from the start of the session.

function secs(ms)
{
  return ms == null ? null : Math.round(ms / 100) / 10;
}

function textOf(content)
{
  if (typeof content === "string")
  {
    return content;
  }

  return Array.isArray(content) ? content.map(function(c) { return c && typeof c.text === "string" ? c.text : ""; }).join("") : "";
}

// The diagram tools of the draw.io servers.
export function isDiagramTool(name)
{
  return /^create_(semantic_)?diagram$/.test(name);
}

function claudeSummary(events)
{
  const calls = [];
  const texts = [];
  let result = null;
  let outputTokens = 0;
  let inputTokens = 0;
  let streamed = false;
  let init = null;

  for (const { t, e } of events)
  {
    if (e.type === "system" && e.subtype === "init")
    {
      init = e;
    }
    else if (e.type === "stream_event")
    {
      const ev = e.event;

      if (ev.type === "message_start" && ev.message && ev.message.usage)
      {
        const u = ev.message.usage;
        streamed = true;
        inputTokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      }
      else if (ev.type === "message_delta" && ev.usage)
      {
        outputTokens += ev.usage.output_tokens || 0;
      }
    }
    else if (e.type === "assistant" && e.message && !e.parent_tool_use_id)
    {
      for (const c of e.message.content || [])
      {
        if (c.type === "tool_use")
        {
          calls.push({ id: c.id, name: c.name.replace(/^mcp__\w+?__/, ""), mcp: /^mcp__/.test(c.name), input: c.input || {}, t: t });
        }
        else if (c.type === "text" && c.text)
        {
          texts.push(c.text);
        }
      }
    }
    else if (e.type === "user" && e.message && Array.isArray(e.message.content))
    {
      for (const c of e.message.content)
      {
        if (c.type === "tool_result")
        {
          const call = calls.find(function(x) { return x.id === c.tool_use_id; });

          if (call)
          {
            call.result = c.content;
            call.resultT = t;
            call.isError = !!c.is_error;
          }
        }
      }
    }
    else if (e.type === "result")
    {
      result = e;
    }
  }

  const usage = (result && result.usage) || {};

  if (!streamed)
  {
    outputTokens = usage.output_tokens || 0;
    inputTokens = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  }

  return {
    model: init ? init.model : null,
    version: init ? init.claude_code_version : null,
    mcpServers: init ? (init.mcp_servers || []).map(function(s) { return s.name + ":" + s.status; }) : [],
    skills: init ? init.skills : null,
    outputTokens: outputTokens,
    inputTokens: inputTokens,
    reasoningTokens: null,
    turns: result ? result.num_turns : null,
    error: result && result.is_error ? String(result.result || result.subtype).slice(0, 300) : null,
    calls: calls.map(function(c)
    {
      return { name: c.name, mcp: c.mcp, t: secs(c.t), resultT: secs(c.resultT), isError: c.isError, input: c.input,
        resultText: textOf(c.result) };
    }),
    finalText: result && typeof result.result === "string" ? result.result : texts.join("\n\n")
  };
}

function codexSummary(events)
{
  const calls = [];
  const texts = [];
  let usage = null;
  let error = null;

  for (const { t, e } of events)
  {
    if (e.type === "turn.completed")
    {
      usage = e.usage;
    }
    else if (e.type === "turn.failed" || e.type === "error")
    {
      error = JSON.stringify(e.error || e.message || e).slice(0, 300);
    }
    else if (e.type === "item.completed" && e.item)
    {
      const it = e.item;

      if (it.type === "agent_message")
      {
        texts.push(it.text || "");
      }
      else if (it.type === "mcp_tool_call")
      {
        const result = it.result || {};
        const content = result.content || [];
        const started = events.find(function(x) { return x.e.type === "item.started" && x.e.item && x.e.item.id === it.id; });
        calls.push({ name: it.tool, mcp: true, server: it.server, t: secs(started ? started.t : t), resultT: secs(t),
          isError: it.status === "failed" || !!it.error || !!result.is_error || !!result.isError,
          input: typeof it.arguments === "string" ? safeJson(it.arguments) : (it.arguments || {}),
          resultText: textOf(content) || (it.error ? JSON.stringify(it.error) : "") });
      }
      else if (it.type === "command_execution")
      {
        const started = events.find(function(x) { return x.e.type === "item.started" && x.e.item && x.e.item.id === it.id; });
        calls.push({ name: "shell", mcp: false, t: secs(started ? started.t : t), resultT: secs(t), isError: it.exit_code !== 0,
          input: { command: it.command }, resultText: String(it.aggregated_output || "").slice(0, 2000) });
      }
      else if (it.type === "file_change")
      {
        calls.push({ name: "edit", mcp: false, t: secs(t), resultT: secs(t), isError: it.status === "failed",
          input: { changes: it.changes }, resultText: "" });
      }
      else if (it.type === "web_search")
      {
        calls.push({ name: "web_search", mcp: false, t: secs(t), resultT: secs(t), isError: false,
          input: { query: it.query }, resultText: "" });
      }
    }
  }

  return {
    model: null,
    version: null,
    mcpServers: [],
    skills: null,
    outputTokens: usage ? usage.output_tokens : null,
    inputTokens: usage ? usage.input_tokens : null,
    reasoningTokens: usage ? usage.reasoning_output_tokens : null,
    turns: null,
    error: error,
    calls: calls,
    finalText: texts.length ? texts[texts.length - 1] : ""
  };
}

function safeJson(s)
{
  try
  {
    return JSON.parse(s);
  }
  catch (e)
  {
    return { raw: s };
  }
}

/**
 * The summary of a session: tokens, the calls with their times, the MCP
 * diagram calls, whether the drawio skill was read, and the final answer.
 */
export function summarize(family, events)
{
  const s = family === "claude" ? claudeSummary(events) : codexSummary(events);
  const diagramCalls = s.calls.filter(function(c) { return c.mcp && isDiagramTool(c.name); });
  const good = diagramCalls.filter(function(c) { return !c.isError; });
  const last = good[good.length - 1] || null;
  // the skill: Claude's Skill tool, or a read of its SKILL.md (Codex reads the file)
  const skillUsed = s.calls.some(function(c)
  {
    return (c.name === "Skill" && /drawio/.test(JSON.stringify(c.input))) ||
      /drawio\/SKILL\.md/.test(JSON.stringify(c.input));
  });

  return Object.assign(s, {
    diagramCalls: diagramCalls.length,
    lastDiagramCall: last,
    diagramCallSecs: last ? (last.resultT || last.t) : null,
    usedReference: s.calls.some(function(c) { return c.mcp && c.name === "get_drawio_reference"; }),
    usedSearch: s.calls.some(function(c) { return c.mcp && c.name === "search_shapes"; }),
    skillUsed: skillUsed,
    toolCounts: s.calls.reduce(function(m, c)
    {
      m[c.name] = (m[c.name] || 0) + 1;

      return m;
    }, {})
  });
}
