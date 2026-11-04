export const INVALID_DIAGRAM_XML_MESSAGE =
  "Expected draw.io XML. If your host wrapped the payload as JSON text, pass the raw XML string to `xml`.";

/**
 * Rewrites editor-relative image paths in style attributes (image=img/lib/...
 * or image=/img/...) to absolute app.diagrams.net URLs. Those paths only
 * resolve inside the draw.io editor's own origin — in the sandboxed viewer
 * iframe they resolve against the sandbox domain and render broken. LLMs
 * emit them by copying older styles from chat context or from training
 * knowledge of draw.io's built-in libraries, so the rewrite is applied to
 * every incoming diagram, not just search_shapes results. Absolute
 * (http/https) and data: URI values are left untouched.
 *
 * NOTE: this function is inlined into the viewer HTML via toString(), so it
 * must stay self-contained (no imports, no outer-scope references).
 *
 * @param {string} xml - Diagram XML (mxGraphModel or mxfile).
 * @returns {string} XML with image paths absolutized.
 */
export function absolutizeImageUrls(xml)
{
  if (typeof xml !== "string")
  {
    return xml;
  }

  return xml.replace(/style="([^"]*)"/g, function(match, style)
  {
    return 'style="' + style.replace(/(^|;)image=(?!https?:|data:)\/?/g,
      "$1image=https://app.diagrams.net/") + '"';
  });
}

/**
 * Extracts raw draw.io XML from raw XML or common JSON-wrapped text payloads.
 *
 * Some MCP hosts (e.g. ChatGPT) wrap the XML string in a JSON envelope like
 * {"text": "<mxGraphModel ...>"} before sending it. This function peels off
 * up to 4 wrapper layers so the server and client can handle these payloads.
 *
 * @param {unknown} input
 * @returns {string|null}
 */
export function normalizeDiagramXml(input)
{
  function findFirstTextBlock(content)
  {
    if (!Array.isArray(content) || content.length === 0)
    {
      return null;
    }

    for (var i = 0; i < content.length; i++)
    {
      var block = content[i];

      if (typeof block === "string")
      {
        return block;
      }

      if (block && typeof block.text === "string")
      {
        return block.text;
      }
    }

    return null;
  }

  // Text before the diagram (a code fence, a sentence) is kept here: the
  // repair (shared/repair-xml.js) cuts it off. A string that starts like
  // JSON is unwrapped first, since the XML inside it is still escaped.
  function getXmlCandidate(value)
  {
    if (typeof value === "string")
    {
      var trimmed = value.trim();
      var first = trimmed.charAt(0);

      if (
        trimmed.length > 0 &&
        first !== "{" && first !== "[" &&
        (trimmed.indexOf("<mxGraphModel") !== -1 || trimmed.indexOf("<mxfile") !== -1)
      )
      {
        return trimmed;
      }

      return null;
    }

    return null;
  }

  function unwrapOnce(value)
  {
    if (typeof value === "string")
    {
      var trimmed = value.trim();

      if (trimmed.length === 0)
      {
        return null;
      }

      if (trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[")
      {
        try
        {
          return JSON.parse(trimmed);
        }
        catch (error)
        {
          return null;
        }
      }

      return null;
    }

    if (Array.isArray(value))
    {
      return findFirstTextBlock(value);
    }

    if (!value || typeof value !== "object")
    {
      return null;
    }

    if (typeof value.text === "string")
    {
      return value.text;
    }

    if (Array.isArray(value.content))
    {
      return findFirstTextBlock(value.content);
    }

    return null;
  }

  var current = input;

  for (var depth = 0; depth < 4; depth++)
  {
    var xmlCandidate = getXmlCandidate(current);

    if (xmlCandidate)
    {
      return xmlCandidate;
    }

    current = unwrapOnce(current);

    if (current === null)
    {
      return null;
    }
  }

  return getXmlCandidate(current);
}

/**
 * Maps the values models write for create_diagram's options and
 * get_drawio_reference's format to the ones the schemas accept: null, "",
 * "none" and "off" mean the option is not set, case and surrounding space
 * don't matter, the flowchart directions LR/RL and TB/TD/BT stand for
 * horizontal and vertical, and "drawio" means the XML reference. Anything
 * else is returned as it is, so the schema still rejects it and the model
 * learns the real values.
 *
 * The server runs it before validating (z.preprocess, which leaves the
 * advertised schema as it is), and the viewer on the raw tool input it
 * renders before the result arrives.
 *
 * NOTE: inlined into the viewer HTML via toString(), so it must stay
 * self-contained (no imports, no outer-scope references).
 *
 * @param {string} name - "postLayout", "direction", "routing" or "format"
 * @param {unknown} value
 * @returns {unknown} the accepted value, undefined for "not set"
 */
export function normalizeOptionValue(name, value)
{
  var synonyms =
  {
    direction: { lr: "horizontal", rl: "horizontal", tb: "vertical", td: "vertical", bt: "vertical" },
    format: { drawio: "xml", "draw.io": "xml" },
  };

  if (value == null)
  {
    return undefined;
  }

  if (typeof value !== "string")
  {
    return value;
  }

  var key = value.trim().toLowerCase();

  if (name === "captureImage" && (key === "true" || key === "false"))
  {
    return key === "true";
  }

  if (key === "" || key === "none" || key === "off")
  {
    return (name === "format") ? value : undefined;
  }

  return (synonyms[name] && synonyms[name][key]) || key;
}
