// Repairs the mechanical slips LLMs make in draw.io XML, before anything parses
// it. In LLM tests of open_drawio_xml these three caused all 15 broken
// diagrams out of 473, whatever the tool description said:
//
//   1. Text around the diagram — a leaked tool-call parameter tag after it
//      (`…</mxGraphModel></content>`), a duplicated closing tag, a code fence
//      or a sentence. Everything outside the first <mxfile> / <mxGraphModel>
//      element is dropped (a leading XML declaration is kept). The dropped
//      tail is returned, since it can hold arguments the model meant to pass
//      (see leakedArguments).
//   2. `<` or a stray `&` inside an attribute value — unescaped HTML labels
//      (`value="<b>API</b>"`), "R&D", `&nbsp;` (not an XML entity). Escaped to
//      `&lt;` / `&amp;`, which is what draw.io itself writes. An unescaped HTML
//      label can carry quoted attributes of its own (`value="A<br><font
//      style="font-size:11px">B</font>"`): a quote inside an HTML tag in the
//      value doesn't end the value, and it is escaped to `&quot;`.
//   3. The default layer written as its own parent (`<mxCell id="1"
//      parent="1"/>`), which hides the whole diagram. Re-parented to the root.
//
// Pure string in, string out; no XML parser needed. Every repair is a no-op on
// a well-formed diagram, which comes back byte-identical. When the markup is
// too broken to scan safely (an unbalanced quote, a stray `<` between tags),
// the attribute repairs are skipped and the text is left as it was.

// An `&` that starts neither one of XML's five entities nor a character
// reference.
var BARE_AMPERSAND = /&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/g;

// The start of an HTML tag that labels use, inside an attribute value.
var HTML_TAG = /^<\/?(?:a|b|br|div|em|font|h[1-6]|hr|i|img|li|ol|p|small|span|strike|strong|sub|sup|table|td|th|tr|u|ul)\b/i;

/**
 * The position of the quote that ends the attribute value starting at from,
 * or -1. A quote inside an HTML tag of an unescaped label belongs to that
 * tag. A well-formed value holds no `<`, so this is the next quote there.
 */
function valueEnd(xml, from, quote)
{
  var k = from;

  while (k < xml.length)
  {
    var ch = xml.charAt(k);

    if (ch === quote)
    {
      return k;
    }

    if (ch === "<" && HTML_TAG.test(xml.substring(k, k + 12)))
    {
      var gt = xml.indexOf(">", k);

      if (gt === -1)
      {
        return -1;
      }

      k = gt + 1;
    }
    else
    {
      k++;
    }
  }

  return -1;
}

/**
 * Cuts the text down to the first <mxfile> or <mxGraphModel> element. A prefix
 * of only whitespace and an XML declaration, and a suffix of only whitespace,
 * are kept, so a clean document is returned unchanged. Returns the kept text
 * and the dropped suffix.
 */
function trimToDiagram(xml)
{
  var file = xml.indexOf("<mxfile");
  var model = xml.indexOf("<mxGraphModel");
  var start = -1;
  var endTag = null;

  if (file !== -1 && (model === -1 || file < model))
  {
    start = file;
    endTag = "</mxfile>";
  }
  else if (model !== -1)
  {
    start = model;
    endTag = "</mxGraphModel>";
  }

  var end = (start === -1) ? -1 : xml.indexOf(endTag, start);

  if (end === -1)
  {
    return { xml: xml, trailing: "" };
  }

  end += endTag.length;

  var prefix = xml.substring(0, start);
  var suffix = xml.substring(end);
  var trailing = "";

  if (!/^\s*(<\?xml[^>]*\?>\s*)?$/.test(prefix))
  {
    prefix = "";
  }

  if (!/^\s*$/.test(suffix))
  {
    trailing = suffix;
    suffix = "";
  }

  return { xml: prefix + xml.substring(start, end) + suffix, trailing: trailing };
}

/**
 * Lists the start tags of the document with the position of each attribute
 * value. Returns null when the markup can't be scanned safely.
 */
function scanTags(xml)
{
  var tags = [];
  var i = 0;

  function skipTo(marker, from)
  {
    var at = xml.indexOf(marker, from);

    return (at === -1) ? -1 : at + marker.length;
  }

  while (true)
  {
    var lt = xml.indexOf("<", i);

    if (lt === -1)
    {
      return tags;
    }

    if (xml.startsWith("<!--", lt))
    {
      i = skipTo("-->", lt + 4);
    }
    else if (xml.startsWith("<![CDATA[", lt))
    {
      i = skipTo("]]>", lt + 9);
    }
    else if (xml.startsWith("<?", lt) || xml.startsWith("</", lt) || xml.startsWith("<!", lt))
    {
      i = skipTo(">", lt + 2);
    }
    else
    {
      var name = /^[A-Za-z_][\w.:-]*/.exec(xml.substring(lt + 1, lt + 200));

      if (name == null)
      {
        return null;
      }

      var tag = { name: name[0], attrs: [] };
      var j = lt + 1 + name[0].length;

      while (true)
      {
        while (j < xml.length && /\s/.test(xml.charAt(j)))
        {
          j++;
        }

        if (xml.charAt(j) === ">" || xml.startsWith("/>", j))
        {
          break;
        }

        var attr = /^[^\s=\/>"']+/.exec(xml.substring(j, j + 200));

        if (attr == null)
        {
          return null;
        }

        j += attr[0].length;

        while (/\s/.test(xml.charAt(j)))
        {
          j++;
        }

        if (xml.charAt(j) !== "=")
        {
          return null;
        }

        j++;

        while (/\s/.test(xml.charAt(j)))
        {
          j++;
        }

        var quote = xml.charAt(j);

        if (quote !== "\"" && quote !== "'")
        {
          return null;
        }

        var close = valueEnd(xml, j + 1, quote);

        if (close === -1)
        {
          return null;
        }

        tag.attrs.push({ name: attr[0], start: j + 1, end: close, quote: quote });
        j = close + 1;
      }

      tags.push(tag);
      i = j + 1;
    }

    if (i <= 0)
    {
      return null;
    }
  }
}

/**
 * Escapes `<` and stray `&` in attribute values and re-parents a layer that
 * is its own parent. Returns the text unchanged when there is nothing to do or
 * the markup can't be scanned.
 */
function repairAttributes(xml, repairs)
{
  var tags = scanTags(xml);

  if (tags == null)
  {
    return xml;
  }

  function value(tag, name)
  {
    for (var k = 0; k < tag.attrs.length; k++)
    {
      if (tag.attrs[k].name === name)
      {
        return tag.attrs[k];
      }
    }

    return null;
  }

  var edits = [];
  var escaped = false;
  var rootId = null;

  for (var t = 0; t < tags.length; t++)
  {
    var tag = tags[t];

    for (var a = 0; a < tag.attrs.length; a++)
    {
      var span = tag.attrs[a];
      var text = xml.substring(span.start, span.end);
      var fixed = text.replace(/</g, "&lt;").replace(BARE_AMPERSAND, "&amp;")
        .replace((span.quote === "'") ? /'/g : /"/g, (span.quote === "'") ? "&apos;" : "&quot;");

      if (fixed !== text)
      {
        edits.push({ start: span.start, end: span.end, text: fixed });
        escaped = true;
      }
    }

    if (tag.name === "mxCell")
    {
      var id = value(tag, "id");
      var parent = value(tag, "parent");

      if (rootId == null && id != null && parent == null)
      {
        rootId = xml.substring(id.start, id.end);
      }
      else if (rootId != null && id != null && parent != null && value(tag, "vertex") == null &&
        value(tag, "edge") == null && xml.substring(id.start, id.end) === xml.substring(parent.start, parent.end))
      {
        edits.push({ start: parent.start, end: parent.end, text: rootId });
        repairs.push("layer re-parented to the root");
      }
    }
  }

  if (escaped)
  {
    repairs.push("attribute values escaped");
  }

  for (var e = edits.length - 1; e >= 0; e--)
  {
    xml = xml.substring(0, edits[e].start) + edits[e].text + xml.substring(edits[e].end);
  }

  return xml;
}

/**
 * Repairs the common mechanical slips in LLM-written draw.io XML.
 *
 * @param {string} xml - mxGraphModel or mxfile XML.
 * @returns {{xml: string, repairs: string[], trailing: string}} The repaired
 *   XML, the names of the repairs applied (empty when the input was left
 *   unchanged), and the text that followed the diagram, if any was dropped.
 */
export function repairDiagramXml(xml)
{
  var repairs = [];

  if (typeof xml !== "string")
  {
    return { xml: xml, repairs: repairs, trailing: "" };
  }

  var trimmed = trimToDiagram(xml);

  if (trimmed.xml !== xml)
  {
    repairs.push("text around the diagram removed");
  }

  return { xml: repairAttributes(trimmed.xml, repairs), repairs: repairs, trailing: trimmed.trailing };
}

/**
 * Tool arguments the model wrote into the XML string instead of passing them.
 * A model that loses track of its tool-call format closes the XML argument
 * inside the string and carries on with the next one, so the text after the
 * diagram reads `</content>\n<parameter name="postLayout">elk`. Only names
 * and values listed in `allowed` are returned.
 *
 * @param {string} trailing - The text dropped after the diagram (see
 *   repairDiagramXml).
 * @param {Object<string, string[]>} allowed - Argument name → accepted values.
 * @returns {Object<string, string>} The leaked arguments, by name.
 */
export function leakedArguments(trailing, allowed)
{
  var found = {};
  var re = /<parameter name="([A-Za-z_]+)">\s*([A-Za-z_-]+)/g;
  var m;

  while ((m = re.exec(trailing || "")) != null)
  {
    if (Object.prototype.hasOwnProperty.call(allowed, m[1]) && allowed[m[1]].indexOf(m[2]) !== -1 &&
      !Object.prototype.hasOwnProperty.call(found, m[1]))
    {
      found[m[1]] = m[2];
    }
  }

  return found;
}
