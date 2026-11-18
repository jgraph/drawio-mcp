// PlantUML → draw.io cells on the server: sequence diagrams (drawn by
// sequence.js, as Mermaid's) and activity diagrams in the current syntax
// (`:action;`, `if`, `while`, `repeat`, `fork`, `|lanes|`, laid out as a
// flowchart by shared/semantic). Every other family (class, use case,
// component, state, …, `@startmindmap`, `@startgantt`, …) is answered with
// `fallback`, for draw.io's own converter in the viewer. Syntax errors name
// the line and how to fix it; what has no place in the drawing (skinparam,
// the preprocessor, headers and footers) is listed as a warning.

import { syntaxError, plainLabel, unquote, cssColor, listText } from "./common.js";

const ERR = "PlantUML";

const PARTICIPANT_KINDS = ["participant", "actor", "boundary", "control", "entity", "database", "collections", "queue"];

// Lines that say the diagram is of a family this module leaves to draw.io:
// class, object, use case, component and deployment, state, timing, …
const OTHER_FAMILY =
[
  [/^\s*(abstract\s+class|abstract|class|interface|enum|annotation|struct|protocol|exception|metaclass|stereotype)\s+\S/i, "class"],
  [/(<\|--|--\|>|\*--|--\*|o--|--o\b|<\|\.\.|\.\.\|>)/, "class"],
  [/^\s*object\s+\S/i, "object"],
  [/^\s*(usecase|\(.+\)\s*(-|\.)|.*(-|\.)>?\s*\(.+\)\s*$)/i, "usecase"],
  [/^\s*(component|node|cloud|artifact|folder|frame|package|rectangle|card|storage|agent|file|stack|hexagon|port|portin|portout)\s+\S/i,
    "component"],
  [/^\s*\[[^\]\-<>?][^\]]*\]\s*(-|\.|$)/, "component"],
  [/^\s*(state\s+\S|\[\*\])/i, "state"],
  [/^\s*(robust|concise|clock|binary|analog)\s+\S/i, "timing"],
  [/^\s*(map|json)\s+\S.*\{\s*$/i, "object"],
  [/\(\*\)/, "activity (old syntax)"]
];

// Lines only an activity diagram has
const ACTIVITY_LINE = /^\s*(#\S+)?:|^\s*(start|stop|detach|kill)\s*$|^\s*(if|while|elseif)\s*\(|^\s*repeat\b|^\s*fork\b|^\s*split\b|^\s*switch\s*\(|^\s*\|[^|]*\|[^|]*$|^\s*partition\s|^\s*(endif|endwhile|end fork|end split|end merge|endswitch)\b/i;

// Lines only a sequence diagram has
const SEQUENCE_LINE = new RegExp("^\\s*(" + PARTICIPANT_KINDS.join("|") + ")\\s+\\S|^\\s*(activate|deactivate|destroy|create|autonumber|" +
  "return)\\b|^\\s*(alt|opt|loop|par|break|critical|group)\\b|^\\s*note\\s+over\\b|^\\s*ref\\s+over\\b|^\\s*==.*==\\s*$|^\\s*\\.\\.\\.|" +
  "^\\s*\\|\\|", "i");

// A message: the sender, the arrow, the receiver, then ++ -- ** !! and `: text`
// (an `o` or `x` at either end only apart from the names: `Bo->Max`)
const ARROW = /^(.*?)\s*((?:(?<=^|\s)[ox])?(?:<<|<|\\\\|\\|\/\/|\/)?-+(?:\[[^\]]*\]-*)?(?:>>|>|\\\\|\\|\/\/|\/)?(?:[ox](?=\s|$|:))?)\s*(.*)$/;

/**
 * The lines of a PlantUML diagram between its `@start…` and `@end…` lines,
 * without comments, with their line numbers.
 *
 * @param {string} text
 * @param {boolean} partial - still streaming in: the `@end…` line may be missing
 * @returns {{keyword: string, lines: Array<{text: string, line: number}>}|{error: string}}
 */
function readBlock(text, partial)
{
  const raw = String(text || "").split(/\r\n|\r|\n/);
  let start = -1;
  let keyword = "";

  for (let i = 0; i < raw.length; i++)
  {
    const m = /^\s*@start([a-z]+)\b/i.exec(raw[i]);

    if (m != null)
    {
      start = i;
      keyword = m[1].toLowerCase();
      break;
    }
  }

  if (start < 0)
  {
    return { error: "The PlantUML diagram has no `@startuml` line. Start it with `@startuml` and end it with `@enduml`." };
  }

  const lines = [];
  let ended = false;
  let comment = false;

  for (let i = start + 1; i < raw.length; i++)
  {
    let t = raw[i];

    if (/^\s*@end[a-z]+\b/i.test(t))
    {
      ended = true;
      break;
    }

    if (comment)
    {
      const close = t.indexOf("'/");

      if (close < 0)
      {
        continue;
      }

      comment = false;
      t = t.substring(close + 2);
    }

    // /' block comments '/
    let open;

    while ((open = t.indexOf("/'")) >= 0)
    {
      const close = t.indexOf("'/", open + 2);

      if (close < 0)
      {
        comment = true;
        t = t.substring(0, open);
        break;
      }

      t = t.substring(0, open) + t.substring(close + 2);
    }

    if (/^\s*'/.test(t))
    {
      continue;
    }

    lines.push({ text: t.trim(), line: i + 1 });
  }

  if (!ended && !partial)
  {
    return { error: syntaxError(ERR, start + 1, raw[start], "the diagram has no `@end" + keyword + "` line.",
      "end it with a line `@end" + keyword + "`.") };
  }

  return { keyword: keyword, lines: lines.filter(function(l) { return l.text !== ""; }) };
}

/**
 * The family of a PlantUML diagram: "sequence", "activity", or the name of
 * one this module leaves to draw.io.
 *
 * @param {{keyword: string, lines: Array<{text: string}>}} block
 * @returns {string}
 */
function familyOf(block)
{
  if (block.keyword !== "uml")
  {
    return block.keyword;
  }

  let activity = 0;
  let sequence = 0;

  for (const l of block.lines)
  {
    for (const f of OTHER_FAMILY)
    {
      if (f[0].test(l.text))
      {
        return f[1];
      }
    }

    if (ACTIVITY_LINE.test(l.text))
    {
      activity++;
    }
    else if (SEQUENCE_LINE.test(l.text) || /^[^:]*?(-+|\.+)(>|\\|\/)/.test(l.text) || /^[^:]*?(<|\\|\/)-/.test(l.text))
    {
      sequence++;
    }
  }

  if (activity > 0 && activity >= sequence)
  {
    return "activity";
  }

  return sequence > 0 ? "sequence" : "uml";
}

/**
 * Whether the server converts this PlantUML diagram (a sequence or an
 * activity diagram), decided by what has arrived of it.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function plantUmlConverts(text)
{
  const block = readBlock(text, true);

  if (block.error != null)
  {
    return false;
  }

  const family = familyOf(block);

  return family === "sequence" || family === "activity";
}

/**
 * Converts a PlantUML diagram: a sequence model for sequence.js or a
 * flowchart description for shared/semantic, or `fallback` for a family
 * draw.io's converter handles.
 *
 * @param {string} text
 * @param {{partial?: boolean}} [options]
 * @returns {{sequence: object, type: string, warnings: string[], stats: object}|
 *   {semantic: object, type: string, warnings: string[], stats: object}|{error: string}|{fallback: true, type: string}}
 */
export function convertPlantUml(text, options)
{
  const partial = options != null && options.partial === true;
  const block = readBlock(text, partial);

  if (block.error != null)
  {
    return block;
  }

  const family = familyOf(block);

  if (family === "sequence")
  {
    const r = parseSequence(block.lines, partial);

    return r.error != null ? r : { sequence: r.model, type: "sequence", warnings: r.warnings, stats: r.stats };
  }

  if (family === "activity")
  {
    const r = parseActivity(block.lines, partial);

    return r.error != null ? r : { semantic: r.spec, type: "activity", warnings: r.warnings, stats: r.stats };
  }

  return { fallback: true, type: family };
}

// ─── Lines both families share ──────────────────────────────────────────────

/**
 * Settings and blocks that have no place in the drawing: skipped, with a
 * warning. Returns the index of the last line used, or -1.
 */
function skipSetting(lines, i, ignored)
{
  const s = lines[i].text;
  let m;

  // skinparam X { … }, <style> … </style>, legend … endlegend, multi-line
  // header/footer
  if (/^skinparam\b.*\{\s*$/i.test(s) || /^<style>/i.test(s))
  {
    ignored.add(/^<style>/i.test(s) ? "`<style>`" : "skinparam");

    let j = i;

    while (j < lines.length && !(/^\}\s*$/.test(lines[j].text) || /^<\/style>/i.test(lines[j].text)))
    {
      j++;
    }

    return Math.min(j, lines.length - 1);
  }

  if ((m = /^(legend|header|footer|center\s+header|center\s+footer|right\s+header|right\s+footer|left\s+header|left\s+footer)\b(.*)$/i
    .exec(s)) != null)
  {
    const word = m[1].toLowerCase().replace(/^(center|right|left)\s+/, "");

    ignored.add(word);

    // multi-line: legend … endlegend / end legend
    if (/^legend/i.test(word) || m[2].trim() === "" || /^(left|right|center|top|bottom)(\s+(left|right|center))?\s*$/i.test(m[2].trim()))
    {
      let j = i + 1;
      const close = new RegExp("^end\\s*" + word + "\\b", "i");

      while (j < lines.length && !close.test(lines[j].text))
      {
        j++;
      }

      return j < lines.length ? j : i;
    }

    return i;
  }

  if ((m = /^(skinparam|scale|caption|hide|show|mainframe|newpage|left to right direction|top to bottom direction|allowmixing|!theme|!pragma|!option|!include\w*|!import|!define\w*|!undef|!procedure|!function|!unquoted|!if|!ifdef|!ifndef|!else|!elseif|!endif|!end\w*|!while|!foreach|!log|!dump\w*|!assert|!\$\w+|\$\w+\s*=)/i
    .exec(s)) != null)
  {
    ignored.add(m[1].charAt(0) === "!" || m[1].charAt(0) === "$" ? "the preprocessor (" + m[1].split(/\s/)[0] + ")" : m[1].toLowerCase());

    return i;
  }

  return -1;
}

function ignoredWarning(ignored)
{
  return ignored.size > 0 ? ["Not drawn: " + listText(Array.from(ignored), 8) + ". The diagram takes draw.io's calm colors " +
    "with the colors written on its elements."] : [];
}

/**
 * A color as PlantUML writes it (`#red`, `#FFAA00`, `#lightblue/white`): the
 * first color, as draw.io writes it, or null.
 */
function colorOf(s)
{
  const m = /^#?([A-Za-z]+|[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})(?:[/\\|-].*)?$/.exec(String(s || "").trim());

  if (m == null)
  {
    return null;
  }

  return cssColor(/^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$/.test(m[1]) ? "#" + m[1] : m[1].toLowerCase());
}

/**
 * A title: `title Text`, or `title` … `end title` over several lines.
 */
function readTitle(lines, i)
{
  const m = /^title\b\s*(.*)$/i.exec(lines[i].text);

  if (m[1].trim() !== "")
  {
    return { title: plainLabel(m[1]), end: i };
  }

  const parts = [];
  let j = i + 1;

  while (j < lines.length && !/^end\s*title\b/i.test(lines[j].text))
  {
    parts.push(lines[j].text);
    j++;
  }

  return { title: plainLabel(parts.join("\n")), end: Math.min(j, lines.length - 1) };
}

/**
 * A label as PlantUML writes it: `\n` and `<br>` line breaks, Creole
 * emphasis (`**bold**`, `//italic//`, `""mono""`, `__under__`), HTML-like tags.
 */
function label(s)
{
  return plainLabel(String(s || "").replace(/\/\/([^/]+)\/\//g, "$1").replace(/""([^"]+)""/g, "$1").replace(/~~([^~]+)~~/g, "$1")
    .replace(/<<([^<>]+)>>/g, "«$1»"));
}

// ─── Sequence diagrams ──────────────────────────────────────────────────────

/**
 * Parses the lines of a PlantUML sequence diagram into the model of
 * sequence.js.
 */
function parseSequence(lines, partial)
{
  const warnings = [];
  const ignored = new Set();
  const participants = [];
  const byId = new Map();
  const events = [];
  const blocks = [];
  const boxes = [];
  const calls = [];
  let box = null;
  let title = "";
  let autonumber = false;
  let autonumberStart = null;
  let autonumberStep = null;
  let pendingCreate = null;
  let lastMessage = null;

  function participant(id, text, kind, color)
  {
    let p = byId.get(id);

    if (p == null)
    {
      p = { id: id, label: text || id, kind: kind || "participant", created: false, color: color || "" };
      participants.push(p);
      byId.set(id, p);

      if (box != null)
      {
        box.members.push(id);
      }
    }

    return p;
  }

  // a name as written: "Long name" or an id
  function nameOf(s)
  {
    const t = s.trim();

    return /^".*"$/.test(t) ? t.substring(1, t.length - 1) : t;
  }

  for (let i = 0; i < lines.length; i++)
  {
    const st = lines[i];
    const s = st.text;
    let m;

    const skipped = skipSetting(lines, i, ignored);

    if (skipped >= 0)
    {
      i = skipped;
      continue;
    }

    if (/^title\b/i.test(s))
    {
      const t = readTitle(lines, i);

      title = t.title;
      i = t.end;
      continue;
    }

    // participant "Long name" as L <<stereotype>> #color order 10
    if ((m = new RegExp("^(" + PARTICIPANT_KINDS.join("|") + ")\\s+(.+)$", "i").exec(s)) != null)
    {
      let rest = m[2].replace(/\s+order\s+-?\d+\s*/i, " ").trim();
      let color = "";
      let stereo = "";
      const c = /\s+(#\S+)\s*$/.exec(rest) || /^(#\S+)$/.exec(rest);

      if (c != null)
      {
        color = colorOf(c[1]) || "";
        rest = rest.substring(0, rest.length - c[0].length).trim();
      }

      const st2 = /\s*<<(.+?)>>\s*/.exec(rest);

      if (st2 != null)
      {
        stereo = "«" + st2[1].replace(/^\([^)]*\)\s*/, "").trim() + "»";
        rest = (rest.substring(0, st2.index) + " " + rest.substring(st2.index + st2[0].length)).trim();
      }

      const as = /^(".*?"|[^\s"]+)\s+as\s+(".*?"|[^\s"]+)$/i.exec(rest);
      let id = nameOf(rest);
      let text = id;

      if (as != null)
      {
        // `"Long name" as L`, `Alice as A`: the alias is the id; `L as "Long name"` the other way round
        const firstQuoted = /^"/.test(as[1]);
        const secondQuoted = /^"/.test(as[2]);

        if (secondQuoted && !firstQuoted)
        {
          id = as[1];
          text = nameOf(as[2]);
        }
        else
        {
          id = as[2];
          text = nameOf(as[1]);
        }
      }

      const p = participant(id, label(text), m[1].toLowerCase(), color);

      p.kind = m[1].toLowerCase();
      p.label = label(text) + (stereo !== "" ? "\n" + stereo : "");

      if (color !== "")
      {
        p.color = color;
      }

      continue;
    }

    // box "Name" #color … end box
    if ((m = /^box\b\s*(.*)$/i.exec(s)) != null)
    {
      let rest = m[1].trim();
      let color = "";
      const c = /(?:^|\s)(#\S+)\s*$/.exec(rest);

      if (c != null)
      {
        color = colorOf(c[1]) || "";
        rest = rest.substring(0, rest.length - c[0].length).trim();
      }

      box = { label: label(unquote(rest)), color: color, members: [] };
      boxes.push(box);
      continue;
    }

    if (/^end\s*box$/i.test(s))
    {
      box = null;
      continue;
    }

    if ((m = /^autonumber\b\s*(.*)$/i.exec(s)) != null)
    {
      const words = m[1].trim().split(/\s+/);

      if (/^stop$/i.test(words[0]))
      {
        autonumber = false;
        continue;
      }

      if (/^resume$/i.test(words[0]))
      {
        autonumber = true;
        continue;
      }

      autonumber = true;

      if (/^\d+$/.test(words[0] || ""))
      {
        autonumberStart = Number(words[0]);

        if (/^\d+$/.test(words[1] || ""))
        {
          autonumberStep = Number(words[1]);
        }
      }

      if (/"/.test(m[1]))
      {
        ignored.add("the autonumber format");
      }

      continue;
    }

    if ((m = /^activate\s+(\S+)(?:\s+#\S+)?\s*$/i.exec(s)) != null)
    {
      const id = nameOf(m[1]);

      participant(id, id);
      events.push({ type: "activate", id: id, line: st.line });
      calls.push({ id: id, caller: lastMessage != null && lastMessage.to === id ? lastMessage.from : null });
      continue;
    }

    if ((m = /^deactivate\s+(\S+)\s*$/i.exec(s)) != null)
    {
      const id = nameOf(m[1]);

      participant(id, id);
      events.push({ type: "deactivate", id: id, line: st.line });

      for (let k = calls.length - 1; k >= 0; k--)
      {
        if (calls[k].id === id)
        {
          calls.splice(k, 1);
          break;
        }
      }

      continue;
    }

    if ((m = /^destroy\s+(\S+)\s*$/i.exec(s)) != null)
    {
      const id = nameOf(m[1]);

      participant(id, id);
      events.push({ type: "destroy", id: id, line: st.line });
      continue;
    }

    // create [kind] X: its head stands at the message that creates it
    if ((m = new RegExp("^create\\s+(?:(" + PARTICIPANT_KINDS.join("|") + ")\\s+)?(.+)$", "i").exec(s)) != null)
    {
      const rest = m[2].trim();
      const as = /^(".*?"|\S+)\s+as\s+(\S+)$/i.exec(rest);
      const id = as != null ? as[2] : nameOf(rest);

      if (byId.has(id))
      {
        byId.get(id).kind = (m[1] || byId.get(id).kind).toLowerCase();
      }
      else
      {
        participant(id, label(as != null ? nameOf(as[1]) : id), (m[1] || "participant").toLowerCase());
      }

      pendingCreate = id;
      continue;
    }

    // return text: back to the caller of the last activation
    if ((m = /^return\b\s*(.*)$/i.exec(s)) != null)
    {
      const call = calls.pop();

      if (call == null || call.caller == null)
      {
        return { error: syntaxError(ERR, st.line, s, "`return` has no call to return from.",
          "activate the callee first (`Alice -> Bob ++ : call` or `activate Bob` after the message), or write the reply " +
          "as a message: `Bob --> Alice : text`.") };
      }

      events.push({ type: "message", from: call.id, to: call.caller, label: label(m[1]), dotted: true, head: "open",
        both: false, activate: false, deactivate: true, line: st.line });
      lastMessage = { from: call.id, to: call.caller };
      continue;
    }

    // notes: note left of A : text, note over A, B : text, note across: text,
    // or over several lines up to `end note`; hnote and rnote alike
    if ((m = /^(?:\/\s*)?([hr]?note)\s+(left|right|over|across)\b\s*(?:of\s+)?([^:#]*?)\s*(#\S+)?\s*(?::(.*))?$/i.exec(s)) != null)
    {
      let text = m[5];
      const side = m[2].toLowerCase();
      let ids = m[3].trim() === "" ? [] : m[3].split(",").map(function(x) { return nameOf(x); }).filter(function(x) { return x !== ""; });

      if (text == null)
      {
        const parts = [];
        let j = i + 1;

        while (j < lines.length && !/^end\s*[hr]?note$/i.test(lines[j].text))
        {
          parts.push(lines[j].text);
          j++;
        }

        if (j >= lines.length && !partial)
        {
          return { error: syntaxError(ERR, st.line, s, "the note has no `end note`.",
            "close it with a line `end note`, or write it on one line: `note left of Alice : text`.") };
        }

        text = parts.join("\n");
        i = j;
      }

      if (side === "across")
      {
        ids = participants.length > 0 ? [participants[0].id, participants[participants.length - 1].id] : [];
      }
      else if (ids.length === 0)
      {
        // a note on the message before it
        if (lastMessage != null)
        {
          ids = [side === "right" ? lastMessage.to : lastMessage.from];
        }
        else if (participants.length > 0)
        {
          ids = [participants[0].id];
        }
      }

      if (ids.length === 0)
      {
        continue;
      }

      ids.forEach(function(id) { participant(id, id); });
      events.push({ type: "note", side: side === "across" ? "over" : side, ids: ids, text: label(text), line: st.line });
      continue;
    }

    // ref over A, B : text, or over several lines up to `end ref`
    if ((m = /^ref\s+over\s+([^:]+?)\s*(?::(.*))?$/i.exec(s)) != null)
    {
      let text = m[2];
      const ids = m[1].split(",").map(function(x) { return nameOf(x); }).filter(function(x) { return x !== ""; });

      if (text == null)
      {
        const parts = [];
        let j = i + 1;

        while (j < lines.length && !/^end\s*ref$/i.test(lines[j].text))
        {
          parts.push(lines[j].text);
          j++;
        }

        if (j >= lines.length && !partial)
        {
          return { error: syntaxError(ERR, st.line, s, "the `ref` has no `end ref`.",
            "close it with a line `end ref`, or write it on one line: `ref over Alice, Bob : text`.") };
        }

        text = parts.join("\n");
        i = j;
      }

      ids.forEach(function(id) { participant(id, id); });
      events.push({ type: "ref", ids: ids, label: label(text), line: st.line });
      continue;
    }

    // == divider ==, ... delay ..., ||| space, ||45||
    if ((m = /^==+\s*(.*?)\s*==+$/.exec(s)) != null)
    {
      events.push({ type: "divider", label: label(m[1]), line: st.line });
      continue;
    }

    if ((m = /^\.\.\.+\s*(.*?)\s*(?:\.\.\.+)?$/.exec(s)) != null)
    {
      events.push({ type: "delay", label: label(m[1]), line: st.line });
      continue;
    }

    if ((m = /^\|\|(\d*)\|\|?$/.exec(s)) != null)
    {
      events.push({ type: "space", size: m[1] !== "" ? Number(m[1]) : 20, line: st.line });
      continue;
    }

    // groups: alt … else … end, loop, opt, par, break, critical, group
    if ((m = /^(alt|opt|loop|par|par2|break|critical|group)\b\s*(?:#\S+\s*)?(.*)$/i.exec(s)) != null)
    {
      const kind = m[1].toLowerCase() === "par2" ? "par" : m[1].toLowerCase();
      let text = label(m[2]);
      let shownKind = kind;

      // group Title [secondary]: the title in the tab
      if (kind === "group")
      {
        const sec = /^(.*?)\s*\[(.*)\]\s*$/.exec(m[2]);

        shownKind = label(sec != null ? sec[1] : m[2]) || "group";
        text = sec != null ? label(sec[2]) : "";
      }

      blocks.push({ kind: kind, line: st.line, raw: s });
      events.push({ type: "start", kind: shownKind, label: text, color: "", line: st.line });
      continue;
    }

    if ((m = /^else\b\s*(?:#\S+\s*)?(.*)$/i.exec(s)) != null)
    {
      if (blocks.length === 0)
      {
        return { error: syntaxError(ERR, st.line, s, "`else` is outside any `alt` or `par` group.",
          "put it between `alt …` and its `end`.") };
      }

      events.push({ type: "else", label: label(m[1]), line: st.line });
      continue;
    }

    if (/^end$/i.test(s) || /^end\s+(alt|opt|loop|par|break|critical|group)$/i.test(s))
    {
      if (blocks.length === 0)
      {
        return { error: syntaxError(ERR, st.line, s, "`end` closes no group.",
          "remove it, or open a group with `alt`, `opt`, `loop`, `par`, `break`, `critical` or `group` before it.") };
      }

      blocks.pop();
      events.push({ type: "end", line: st.line });
      continue;
    }

    if (/^(hide|show)\s+(footbox|unlinked)/i.test(s) || /^(newpage|\|\|\|)/i.test(s))
    {
      continue;
    }

    // A message
    m = ARROW.exec(s);

    if (m != null && /-|\./.test(m[2]) && /[<>\\/xo]/.test(m[2].replace(/\[[^\]]*\]/, "")) && !/^\s*$/.test(m[1] + m[3]))
    {
      const msg = readMessage(m, st, nameOf);

      if (msg.error != null)
      {
        return msg;
      }

      [msg.from, msg.to].forEach(function(id)
      {
        if (id !== "[" && id !== "]")
        {
          participant(id, id);
        }
      });

      if (pendingCreate != null && msg.to === pendingCreate)
      {
        byId.get(pendingCreate).created = true;
        events.push({ type: "create", id: pendingCreate, line: st.line });
        pendingCreate = null;
      }

      if (msg.create && byId.has(msg.to) && !byId.get(msg.to).created)
      {
        byId.get(msg.to).created = true;
        events.push({ type: "create", id: msg.to, line: st.line });
      }

      events.push({ type: "message", from: msg.from, to: msg.to, label: msg.label, dotted: msg.dotted, head: msg.head,
        both: msg.both, color: msg.color, bold: msg.bold, activate: msg.activate, deactivate: msg.deactivate, line: st.line });

      if (msg.activate)
      {
        calls.push({ id: msg.to, caller: msg.from });
      }

      if (msg.deactivate)
      {
        for (let k = calls.length - 1; k >= 0; k--)
        {
          if (calls[k].id === msg.from)
          {
            calls.splice(k, 1);
            break;
          }
        }
      }

      if (msg.destroy)
      {
        events.push({ type: "destroy", id: msg.to, line: st.line });
      }

      lastMessage = { from: msg.from, to: msg.to };
      continue;
    }

    warnings.push("Line " + st.line + " (`" + s.substring(0, 60) + "`) is not a statement this conversion reads and is left out.");
  }

  // a preview of text still streaming in: the open groups end here
  while (blocks.length > 0 && partial)
  {
    blocks.pop();
    events.push({ type: "end", line: 0 });
  }

  if (blocks.length > 0)
  {
    const b = blocks[blocks.length - 1];

    return { error: syntaxError(ERR, b.line, b.raw, "the `" + b.kind + "` group has no `end`.", "close it with a line `end`.") };
  }

  if (participants.length === 0)
  {
    return { error: "The PlantUML sequence diagram has no participants or messages. Add messages such as `Alice -> Bob : Hello`." };
  }

  const messages = events.filter(function(e) { return e.type === "message"; }).length;

  return {
    model: { title: title, participants: participants, events: events, boxes: boxes, autonumber: autonumber,
      autonumberStart: autonumberStart, autonumberStep: autonumberStep },
    warnings: ignoredWarning(ignored).concat(warnings),
    stats: { nodes: participants.length, edges: messages, groups: boxes.length }
  };
}

/**
 * One message: the arrow's ends, line and color, the receiver's ++ -- ** !!
 * and the text after `:`.
 */
function readMessage(m, st, nameOf)
{
  const arrow = m[2];
  let from = m[1].trim();
  let rest = m[3];
  let text = "";
  const colon = /^(.*?)\s*:(.*)$/.exec(rest);

  if (colon != null)
  {
    rest = colon[1];
    text = colon[2];
  }

  // the receiver, then ++ (activate it), -- (deactivate the sender),
  // ** (create it), !! (destroy it), each with an optional color
  const tail = /^(".*?"|[^\s+\-*!]*)\s*((?:(?:\+\+|--|\*\*|!!)\s*(?:#\S+)?\s*)*)$/.exec(rest.trim());

  if (tail == null || (tail[1] === "" && !/[\])]$/.test(arrow) && !/^[\[?]/.test(rest.trim())))
  {
    if (tail != null && tail[1] === "" && from !== "")
    {
      return { error: syntaxError(ERR, st.line, st.text, "the message has no receiver after `" + arrow + "`.",
        "write it as `Alice -> Bob : text`, or `Alice ->] : text` for a message out of the diagram.") };
    }

    return { error: syntaxError(ERR, st.line, st.text, "this is not a message PlantUML reads.",
      "write messages as `Alice -> Bob : text` (the text after `:`).") };
  }

  let to = nameOf(tail[1]);
  const marks = tail[2] || "";
  const bracket = /\[([^\]]*)\]/.exec(arrow);
  const plain = arrow.replace(/\[[^\]]*\]/, "");
  const startHead = /^[ox]?(<<|<|\\\\|\\|\/\/|\/)/.test(plain) || /^[ox]/.test(plain) && /-/.test(plain.charAt(1));
  const endHead = /(>>|>|\\\\|\\|\/\/|\/)[ox]?$/.test(plain) || /-[ox]$/.test(plain);
  let color = "";
  let bold = false;
  let dotted = /--|\.\./.test(plain);

  if (bracket != null)
  {
    bracket[1].split(/[,;]/).forEach(function(part)
    {
      const p = part.trim();

      if (/^#/.test(p))
      {
        color = colorOf(p) || color;
      }
      else if (/^(dashed|dotted)$/i.test(p))
      {
        dotted = true;
      }
      else if (/^bold$/i.test(p))
      {
        bold = true;
      }
    });
  }

  // `[->` and `->]`: from and to the edge of the diagram; `?` alike
  if (from === "[" || from === "?" || from === "")
  {
    from = "[";
  }

  if (to === "]" || to === "?" || to === "")
  {
    to = "]";
  }

  // the end the arrowhead is at
  function headOf(s)
  {
    if (/x/.test(s))
    {
      return "cross";
    }

    if (/o/.test(s))
    {
      return "circle";
    }

    if (/>>|<<|\\\\|\/\/|\\|\//.test(s))
    {
      return "open";
    }

    return "block";
  }

  const endPart = (/(>>|>|\\\\|\\|\/\/|\/)?[ox]?$/.exec(plain) || [""])[0];
  const startPart = (/^[ox]?(<<|<|\\\\|\\|\/\/|\/)?/.exec(plain) || [""])[0];
  let head = endHead ? headOf(endPart) : headOf(startPart);
  let both = false;

  if (startHead && !endHead)
  {
    // A <- B: B sends to A
    const t = from;

    from = to === "]" ? "]" : to;
    to = t === "[" ? "[" : t;
  }
  else if (startHead && endHead)
  {
    both = true;
    head = headOf(endPart);
  }

  return {
    from: from, to: to, label: label(text), dotted: dotted, head: head, both: both, color: color, bold: bold,
    activate: /\+\+/.test(marks), deactivate: /--/.test(marks), create: /\*\*/.test(marks), destroy: /!!/.test(marks)
  };
}

// ─── Activity diagrams ──────────────────────────────────────────────────────

const START_STYLE = "ellipse;fillColor=#1B1F24;strokeColor=none;";
const STOP_STYLE = "ellipse;shape=endState;fillColor=#1B1F24;strokeColor=#1B1F24;";
const END_STYLE = "ellipse;shape=sumEllipse;perimeter=ellipsePerimeter;fillColor=#FFFFFF;strokeColor=#1B1F24;";
const BAR_STYLE = "rounded=0;fillColor=#1B1F24;strokeColor=none;";
const NOTE_STYLE = "shape=note;size=12;rounded=0;align=left;spacingLeft=6;";

/**
 * Parses a PlantUML activity diagram (the current syntax) into a flowchart
 * description: actions as steps, `if`, `while`, `repeat` and `switch` as
 * decisions, forks as bars, lanes (`|Lane|`) as lanes, partitions as frames.
 */
function parseActivity(lines, partial)
{
  const warnings = [];
  const ignored = new Set();
  const nodes = [];
  const edges = [];
  const groups = [];
  const groupIds = new Map();
  const stack = [];
  let title = "";
  let tails = [];
  let lane = "";
  let partitions = [];
  let pendingLabel = null;
  let pendingStyle = "";
  let count = 0;
  let lastNode = null;

  function groupOf()
  {
    return partitions.length > 0 ? partitions[partitions.length - 1] : lane;
  }

  function node(kind, text, style, size)
  {
    const id = kind === "step" ? "a" + (++count) : kind.charAt(0) + (++count);
    const n = { id: id, label: text, kind: kind === "bar" || kind === "note" ? "step" : kind, group: groupOf(), style: style || "" };

    if (size != null)
    {
      n.width = size.w;
      n.height = size.h;
    }

    nodes.push(n);

    // the edges into it: from every open end of the flow
    tails.forEach(function(t)
    {
      edges.push({ from: t.id, to: id, label: t.label || pendingLabel || "", style: t.style || pendingStyle });
    });

    pendingLabel = null;
    pendingStyle = "";
    tails = [{ id: id, label: "" }];
    lastNode = id;

    stack.forEach(function(f)
    {
      if (f.kind === "repeat" && f.first == null)
      {
        f.first = id;
      }
    });

    return id;
  }

  function open(kind, st)
  {
    for (let k = stack.length - 1; k >= 0; k--)
    {
      if (stack[k].kind === kind || (Array.isArray(kind) && kind.indexOf(stack[k].kind) >= 0))
      {
        return k === stack.length - 1 ? stack[k] : { inner: stack[stack.length - 1] };
      }
    }

    return null;
  }

  function unexpected(st, word, opener)
  {
    const f = open(opener, st);

    if (f != null && f.inner != null)
    {
      return { error: syntaxError(ERR, st.line, st.text, "`" + word + "` comes before the `" + closer(f.inner.kind) +
        "` of the `" + f.inner.kind + "` opened on line " + f.inner.line + ".", "close the inner `" + f.inner.kind +
        "` first.") };
    }

    return { error: syntaxError(ERR, st.line, st.text, "`" + word + "` has no `" + (Array.isArray(opener) ? opener[0] : opener) +
      "` before it.", "open it with `" + OPENERS[Array.isArray(opener) ? opener[0] : opener] + "`, or remove this line.") };
  }

  const size = { bar: null, dot: { w: 30, h: 30 } };

  for (let i = 0; i < lines.length; i++)
  {
    const st = lines[i];
    let s = st.text;
    let m;

    const skipped = skipSetting(lines, i, ignored);

    if (skipped >= 0)
    {
      i = skipped;
      continue;
    }

    if (/^title\b/i.test(s))
    {
      const t = readTitle(lines, i);

      title = t.title;
      i = t.end;
      continue;
    }

    // an action: [#color]:text; over one or more lines, ending in ; | < > / ] }
    if ((m = /^(#[^:]+)?:(.*)$/.exec(s)) != null)
    {
      const parts = [m[2]];
      let j = i;

      while (!/[;|<>/\]}]\s*$/.test(parts[parts.length - 1]) && j + 1 < lines.length)
      {
        j++;
        parts.push(lines[j].text);
      }

      if (!/[;|<>/\]}]\s*$/.test(parts[parts.length - 1]))
      {
        if (!partial)
        {
          return { error: syntaxError(ERR, st.line, s, "the action is not closed with `;`.", "end it with `;`, e.g. `:Check the order;`.") };
        }

        break;
      }

      i = j;

      const text = parts.join("\n").replace(/\s*[;|<>/\]}]\s*$/, "");
      const color = m[1] != null ? colorOf(m[1]) : null;

      node("step", label(text) || " ", color != null ? "fillColor=" + color + ";" : "");
      continue;
    }

    if (/^start$/i.test(s))
    {
      node("start", " ", START_STYLE, size.dot);
      continue;
    }

    if (/^(stop|end)$/i.test(s))
    {
      node("end", " ", /^stop$/i.test(s) ? STOP_STYLE : END_STYLE, size.dot);
      tails = [];
      continue;
    }

    if (/^(detach|kill)$/i.test(s))
    {
      if (/^kill$/i.test(s))
      {
        node("end", " ", END_STYLE, size.dot);
      }

      tails = [];
      continue;
    }

    // -> label; and -[#red,dashed]-> label;
    if ((m = /^-+(?:\[([^\]]*)\]-*)?>\s*(.*?);?\s*$/.exec(s)) != null)
    {
      let style = "";

      if (m[1] != null)
      {
        m[1].split(/[,;]/).forEach(function(part)
        {
          const p = part.trim();

          if (/^#/.test(p) && colorOf(p) != null)
          {
            style += "strokeColor=" + colorOf(p) + ";";
          }
          else if (/^(dashed|dotted)$/i.test(p))
          {
            style += "dashed=1;";
          }
          else if (/^bold$/i.test(p))
          {
            style += "strokeWidth=2;";
          }
          else if (/^hidden$/i.test(p))
          {
            style += "strokeColor=none;";
          }
        });
      }

      pendingLabel = label(m[2]) || null;
      pendingStyle = style;
      tails.forEach(function(t)
      {
        if (!t.label && pendingLabel != null)
        {
          t.label = pendingLabel;
        }

        t.style = style;
      });
      continue;
    }

    // if (cond) then (yes) / if (a) is (b) then / if (a) equals (b) then
    if ((m = /^if\s*\((.*?)\)\s*(?:(?:is|equals)\s*\((.*?)\)\s*)?(?:then\s*(?:\((.*?)\))?)?\s*$/i.exec(s)) != null)
    {
      const cond = label(m[1] + (m[2] != null ? " " + m[2] : ""));
      const d = node("decision", cond || "?", "");

      stack.push({ kind: "if", line: st.line, raw: s, decision: d, ends: [], hasElse: false });
      tails = [{ id: d, label: label(m[3] || "") }];
      continue;
    }

    if ((m = /^else\s*if\s*\((.*?)\)\s*(?:(?:is|equals)\s*\((.*?)\)\s*)?(?:then\s*(?:\((.*?)\))?)?\s*$/i.exec(s)) != null)
    {
      const f = open("if", st);

      if (f == null || f.inner != null)
      {
        return unexpected(st, "elseif", "if");
      }

      f.ends = f.ends.concat(tails);
      tails = [{ id: f.decision, label: "" }];

      const d = node("decision", label(m[1] + (m[2] != null ? " " + m[2] : "")) || "?", "");

      f.decision = d;
      tails = [{ id: d, label: label(m[3] || "") }];
      continue;
    }

    if ((m = /^else\b\s*(?:\((.*?)\))?\s*$/i.exec(s)) != null)
    {
      const f = open("if", st);

      if (f == null || f.inner != null)
      {
        return unexpected(st, "else", "if");
      }

      f.ends = f.ends.concat(tails);
      f.hasElse = true;
      tails = [{ id: f.decision, label: label(m[1] || "") }];
      continue;
    }

    if (/^end\s*if$/i.test(s))
    {
      const f = open("if", st);

      if (f == null || f.inner != null)
      {
        return unexpected(st, "endif", "if");
      }

      stack.pop();
      tails = f.ends.concat(tails);

      if (!f.hasElse)
      {
        tails.push({ id: f.decision, label: "" });
      }

      continue;
    }

    // switch (x) / case (a) / endswitch
    if ((m = /^switch\s*\((.*)\)\s*$/i.exec(s)) != null)
    {
      const d = node("decision", label(m[1]) || "?", "");

      stack.push({ kind: "switch", line: st.line, raw: s, decision: d, ends: [], started: false });
      tails = [];
      continue;
    }

    if ((m = /^case\s*\((.*)\)\s*$/i.exec(s)) != null)
    {
      const f = open("switch", st);

      if (f == null || f.inner != null)
      {
        return unexpected(st, "case", "switch");
      }

      if (f.started)
      {
        f.ends = f.ends.concat(tails);
      }

      f.started = true;
      tails = [{ id: f.decision, label: label(m[1]) }];
      continue;
    }

    if (/^end\s*switch$/i.test(s))
    {
      const f = open("switch", st);

      if (f == null || f.inner != null)
      {
        return unexpected(st, "endswitch", "switch");
      }

      stack.pop();
      tails = f.ends.concat(tails);
      continue;
    }

    // while (cond) is (yes) … endwhile (no)
    if ((m = /^while\s*\((.*?)\)\s*(?:(?:is|equals)\s*\((.*?)\))?\s*$/i.exec(s)) != null)
    {
      const d = node("decision", label(m[1]) || "?", "");

      stack.push({ kind: "while", line: st.line, raw: s, decision: d });
      tails = [{ id: d, label: label(m[2] || "") }];
      continue;
    }

    if ((m = /^end\s*while\b\s*(?:\((.*?)\))?\s*$/i.exec(s)) != null)
    {
      const f = open("while", st);

      if (f == null || f.inner != null)
      {
        return unexpected(st, "endwhile", "while");
      }

      stack.pop();
      tails.forEach(function(t)
      {
        edges.push({ from: t.id, to: f.decision, label: t.label || "", style: t.style || "" });
      });
      tails = [{ id: f.decision, label: label(m[1] || "") }];
      continue;
    }

    // repeat [:action;] … [backward :text;] repeat while (cond) is (yes) not (no)
    if ((m = /^repeat\s*(:.*)?$/i.exec(s)) != null && !/^repeat\s*while\b/i.test(s))
    {
      stack.push({ kind: "repeat", line: st.line, raw: s, first: null, backward: null });

      if (m[1] != null)
      {
        lines.splice(i + 1, 0, { text: m[1], line: st.line });
      }

      continue;
    }

    if ((m = /^backward\s*(:.*)$/i.exec(s)) != null)
    {
      const f = open("repeat", st);

      if (f == null || f.inner != null)
      {
        warnings.push("Line " + st.line + ": `backward` outside a `repeat` is left out.");
        continue;
      }

      f.backward = label(m[1].replace(/^:/, "").replace(/\s*;\s*$/, ""));
      continue;
    }

    if ((m = /^repeat\s*while\s*(?:\((.*?)\))?\s*(?:(?:is|equals)\s*\((.*?)\))?\s*(?:not\s*\((.*?)\))?\s*$/i.exec(s)) != null)
    {
      const f = open("repeat", st);

      if (f == null || f.inner != null)
      {
        return unexpected(st, "repeat while", "repeat");
      }

      stack.pop();

      const d = node("decision", label(m[1] || "") || "?", "");
      let back = d;

      if (f.backward != null)
      {
        const b = "a" + (++count);

        nodes.push({ id: b, label: f.backward || " ", kind: "step", group: groupOf(), style: "" });
        edges.push({ from: d, to: b, label: label(m[2] || ""), style: "" });
        back = b;
      }

      if (f.first != null)
      {
        edges.push({ from: back, to: f.first, label: back === d ? label(m[2] || "") : "", style: "" });
      }

      tails = [{ id: d, label: label(m[3] || "") }];
      continue;
    }

    // fork / fork again / end fork / end merge, split / split again / end split
    if (/^(fork|split)$/i.test(s))
    {
      const kind = s.toLowerCase();
      const f = { kind: kind, line: st.line, raw: s, ends: [], start: tails, bar: null };

      if (kind === "fork")
      {
        f.bar = node("bar", " ", BAR_STYLE, size.bar);
        f.start = tails;
      }

      stack.push(f);
      continue;
    }

    if ((m = /^(fork|split)\s+again$/i.exec(s)) != null)
    {
      const f = open(m[1].toLowerCase(), st);

      if (f == null || f.inner != null)
      {
        return unexpected(st, s, m[1].toLowerCase());
      }

      f.ends = f.ends.concat(tails);
      tails = f.start.slice();
      continue;
    }

    if ((m = /^end\s*(fork|split|merge)\b.*$/i.exec(s)) != null)
    {
      const f = open(["fork", "split"], st);

      if (f == null || f.inner != null)
      {
        return unexpected(st, s, m[1].toLowerCase() === "split" ? "split" : "fork");
      }

      stack.pop();
      tails = f.ends.concat(tails);

      if (f.kind === "fork" && tails.length > 0)
      {
        node("bar", " ", BAR_STYLE, size.bar);
      }

      if (/\{.*\}/.test(s))
      {
        ignored.add("join specifications");
      }

      continue;
    }

    // |Lane| or |#color|Lane|
    if ((m = /^\|(?:(#[^|]+)\|)?([^|]+)\|\s*$/.exec(s)) != null)
    {
      const name = m[2].trim();
      const id = "lane_" + name.replace(/\W+/g, "_");

      if (!groupIds.has(id))
      {
        groupIds.set(id, true);
        groups.push({ id: id, label: label(name), kind: "lane", parent: "",
          style: (m[1] != null && colorOf(m[1]) != null) ? "swimlaneFillColor=" + colorOf(m[1]) + ";" : "" });
      }

      lane = id;
      continue;
    }

    // partition Name { … }, also package, rectangle, card, group
    if ((m = /^(partition|package|rectangle|card|group)\s+(?:(#\S+)\s+)?(".*?"|[^{]+?)\s*(#\S+)?\s*\{?\s*$/i.exec(s)) != null)
    {
      const id = "group_" + (groups.length + 1);
      const color = colorOf(m[2] || m[4] || "");

      groups.push({ id: id, label: label(unquote(m[3])), kind: "subgraph", parent: groupOf(),
        style: color != null ? "fillColor=" + color + ";" : "" });
      partitions.push(id);

      if (!/\{\s*$/.test(s))
      {
        // `partition Name` alone ends at `end partition` or `}`
      }

      continue;
    }

    if (/^\}$/.test(s) || /^end\s*(partition|package|rectangle|card|group)$/i.test(s))
    {
      if (partitions.length === 0)
      {
        return { error: syntaxError(ERR, st.line, s, "`" + s + "` closes no partition.",
          "remove it, or open a partition with `partition Name {` before it.") };
      }

      partitions.pop();
      continue;
    }

    // note left: text / note right … end note / floating note
    if ((m = /^(floating\s+)?note\s+(left|right|top|bottom)?\s*(#\S+)?\s*(?::(.*))?$/i.exec(s)) != null)
    {
      let text = m[4];

      if (text == null)
      {
        const parts = [];
        let j = i + 1;

        while (j < lines.length && !/^end\s*note$/i.test(lines[j].text))
        {
          parts.push(lines[j].text);
          j++;
        }

        if (j >= lines.length && !partial)
        {
          return { error: syntaxError(ERR, st.line, s, "the note has no `end note`.",
            "close it with a line `end note`, or write it on one line: `note right: text`.") };
        }

        text = parts.join("\n");
        i = j;
      }

      if (lastNode != null)
      {
        const id = "n" + (++count);
        const color = colorOf(m[3] || "");

        nodes.push({ id: id, label: label(text) || " ", kind: "step", group: groupOf(),
          style: NOTE_STYLE + "fillColor=" + (color || "#FFF9DB") + ";strokeColor=#E9D58A;" });
        edges.push({ from: lastNode, to: id, label: "", style: "dashed=1;endArrow=none;" });
      }

      continue;
    }

    if (/^(break|goto\b|label\b)/i.test(s))
    {
      ignored.add("`" + s.split(/\s/)[0].toLowerCase() + "`");
      continue;
    }

    warnings.push("Line " + st.line + " (`" + s.substring(0, 60) + "`) is not a statement this conversion reads and is left out.");
  }

  if (stack.length > 0 && !partial)
  {
    const f = stack[stack.length - 1];

    return { error: syntaxError(ERR, f.line, f.raw, "the `" + f.kind + "` has no `" + closer(f.kind) + "`.",
      "close it with a line `" + closer(f.kind) + "`.") };
  }

  if (nodes.length === 0)
  {
    return { error: "The PlantUML activity diagram has no actions. Add actions such as `:Check the order;` between `start` and `stop`." };
  }

  // the bars across the flow, as wide as a step
  nodes.forEach(function(n)
  {
    if (n.style === BAR_STYLE)
    {
      n.width = 120;
      n.height = 8;
    }
  });

  const spec =
  {
    type: "flowchart",
    title: title,
    direction: "vertical",
    groups: groups,
    nodes: nodes,
    edges: edges
  };

  return {
    spec: spec,
    warnings: ignoredWarning(ignored).concat(warnings),
    stats: { nodes: nodes.length, edges: edges.length, groups: groups.length }
  };
}

const OPENERS = { if: "if (condition) then (yes)", switch: "switch (value)", while: "while (condition)", repeat: "repeat",
  fork: "fork", split: "split" };

function closer(kind)
{
  return { if: "endif", switch: "endswitch", while: "endwhile", repeat: "repeat while (condition)", fork: "end fork",
    split: "end split" }[kind] || "end";
}
