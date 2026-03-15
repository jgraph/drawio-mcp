export const INVALID_DIAGRAM_XML_MESSAGE =
  "Expected draw.io XML. If your host wrapped the payload as JSON text, pass the raw XML string to `xml`.";

/**
 * Extracts raw draw.io XML from raw XML or common JSON-wrapped text payloads.
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

  function getXmlCandidate(value)
  {
    if (typeof value === "string")
    {
      var trimmed = value.trim();

      if (
        trimmed.length > 0 &&
        trimmed.charAt(0) === "<" &&
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
