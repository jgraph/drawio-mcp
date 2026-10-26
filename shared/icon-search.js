// ── Icon search ──────────────────────────────────────────────────────────────
//
// Supplements the local stencil index (shape-search.js) with the draw.io icon
// service — the same grouped icon search the editor sidebar uses (drawio-dev
// ICON_SERVICE_PATH, hosted at icons.diagrams.net). The service covers brand
// logos and general-purpose concept icons that are not part of the built-in
// shape libraries and therefore never appear in search-index.json.
//
// Single source of truth for the icon half of the `search_shapes` tool in both
// the MCP App server (mcp-app-server) and the MCP Tool server (mcp-tool-server).
// The tool server copies this file into src/ via its `copy-shared` build step
// (side by side with shape-search.js, so the relative import below resolves in
// both locations); the app server imports it directly.

import { searchShapesWithMeta } from "./shape-search.js";

export var DEFAULT_ICON_SERVICE_URL = "https://icons.diagrams.net/api/icons";

// Style template the draw.io editor uses when inserting icon search results
// (Sidebar.extractIconsFromResponse), except labelBackgroundColor uses the
// adaptive 'default' color instead of #ffffff so labels stay readable in
// dark mode. The skill's plugins/*/skills/drawio/scripts/find-shapes.js
// carries a copy: change both.
var ICON_STYLE_PREFIX = "shape=image;html=1;verticalAlign=top;" +
  "verticalLabelPosition=bottom;labelBackgroundColor=default;imageAspect=0;" +
  "aspect=fixed;image=";

/**
 * Prettify a raw icon title: underscores/hyphens to spaces, collapsed
 * whitespace. Icon titles arrive as slugs like
 * "social_media_social_media_logo_slack".
 */
function cleanTitle(title)
{
  if (typeof title !== "string" || title.length === 0)
  {
    return "";
  }

  return title.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Returns true if the icon URL is safe to embed in an mxCell style attribute:
 * https, and free of characters that would terminate the style entry (;),
 * need XML attribute escaping (& " ' < >) or introduce whitespace. The
 * service serves plain https paths, so this only filters malformed entries.
 */
function isSafeIconUrl(url)
{
  return typeof url === "string" &&
    /^https:\/\//.test(url) &&
    !/[;&"'<>\s]/.test(url.substring(8));
}

/**
 * Search the draw.io icon service and map the results to the same
 * {style, w, h, title} contract that searchShapes() returns, so both result
 * sets can be concatenated into a single tool response.
 *
 * Icon results are strictly a supplement — this function resolves to [] on
 * ANY failure (timeout, HTTP error, malformed JSON), never rejects.
 *
 * @param {string} query - Space-separated search keywords.
 * @param {number} limit - Maximum results to return.
 * @param {Object} [options]
 * @param {string} [options.serviceUrl] - Icon service base URL
 *   (default: DEFAULT_ICON_SERVICE_URL).
 * @param {number} [options.timeoutMs] - Request timeout (default: 4000).
 * @param {Function} [options.fetchFn] - fetch implementation (for tests).
 * @returns {Promise<Array>} Matching icons: [{style, w, h, title}].
 */
export async function searchIcons(query, limit, options)
{
  options = options || {};

  var serviceUrl = options.serviceUrl || DEFAULT_ICON_SERVICE_URL;
  var timeoutMs = options.timeoutMs || 4000;
  var fetchFn = options.fetchFn || fetch;

  if (!query || !(limit > 0))
  {
    return [];
  }

  var url = serviceUrl + "/search?q=" + encodeURIComponent(query) +
    "&p=0&c=" + Math.floor(limit);

  try
  {
    var res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });

    if (!res.ok)
    {
      return [];
    }

    var data = await res.json();

    if (data == null || !Array.isArray(data.images))
    {
      return [];
    }

    var results = [];

    for (var i = 0; i < data.images.length && results.length < limit; i++)
    {
      var img = data.images[i];

      if (img == null || !isSafeIconUrl(img.url))
      {
        continue;
      }

      var title = cleanTitle(img.title);

      if (img.set != null && typeof img.set.name === "string" &&
        img.set.name.length > 0)
      {
        title += (title.length > 0 ? " " : "") + "(" + img.set.name + ")";
      }

      results.push({
        style: ICON_STYLE_PREFIX + img.url,
        w: (typeof img.width === "number" && img.width > 0) ? img.width : 48,
        h: (typeof img.height === "number" && img.height > 0) ? img.height : 48,
        title: title,
      });
    }

    return results;
  }
  catch (e)
  {
    return [];
  }
}

/**
 * The `search_shapes` pipeline: local stencil search plus icon-service
 * supplementation. Local stencils are preferred (styleable, scalable,
 * official vendor sets), but their budget depends on match quality:
 *
 * - Strong local match (best result exact-matched every term): local
 *   results lead, icons only fill any remaining slots — a full page of
 *   strong local results makes no network request at all.
 * - Weak match (Soundex/OR fallback, e.g. patch panels for "solar panel")
 *   or no match: local results keep at most half the budget and the icon
 *   service fills the rest, reclaiming unused icon slots back for local
 *   results, so fallback noise cannot crowd the icons out.
 *
 * @param {Array} shapeIndex - The flat shape array (see shape-search.js).
 * @param {Object} tagMap - Pre-built tag→indices map from buildTagMap().
 * @param {string} query - Space-separated search keywords.
 * @param {number} limit - Maximum results to return.
 * @param {Object} [options] - searchIcons options; pass serviceUrl: null
 *   (e.g. from resolveIconServiceUrl) to disable icon supplementation.
 * @returns {Promise<Array>} Matching shapes and icons: [{style, w, h, title}].
 */
export async function searchShapesAndIcons(shapeIndex, tagMap, query, limit, options)
{
  var search = searchShapesWithMeta(shapeIndex, tagMap, query, limit);
  var results = search.results;

  if (options != null && options.serviceUrl === null)
  {
    return results;
  }

  var icons;

  if (!search.strong)
  {
    var keep = Math.min(results.length, Math.floor(limit / 2));
    icons = await searchIcons(query, limit - keep, options);
    results = results.slice(0, limit - icons.length).concat(icons);
  }
  else if (results.length < limit)
  {
    icons = await searchIcons(query, limit - results.length, options);
    results = results.concat(icons);
  }

  return results;
}

/**
 * Resolve the icon service URL from an environment-style value:
 * unset/empty → the default service, "off"/"none"/"0"/"false" → null
 * (disabled), anything else → the value itself (self-hosted service).
 *
 * @param {string|undefined} value - e.g. process.env.DRAWIO_ICON_SERVICE_URL.
 * @returns {string|null} Base URL, or null when icon search is disabled.
 */
export function resolveIconServiceUrl(value)
{
  if (value == null || value === "")
  {
    return DEFAULT_ICON_SERVICE_URL;
  }

  if (/^(off|none|0|false)$/i.test(value))
  {
    return null;
  }

  return value;
}
