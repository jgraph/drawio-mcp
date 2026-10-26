// Looks up draw.io shape styles for icons, so the skill never guesses mxgraph.*
// names. Searches the stencil index behind the draw.io MCP servers' search_shapes
// tool (every built-in shape library), then the draw.io icon service for logos
// and icons the libraries lack. Needs Node.js 18+ (fetch) and network access.
//
// Usage: node find-shapes.js "aws4 lambda" "github" "slack"
//
// Prints a "# query" block per argument with one "title widthxheight style" line
// per match. A shape matches when every word of the query is one of its tags; the
// first tag is its library (aws4, azure2, gcp2, cisco19, kubernetes, ...).

var INDEX_URL = "https://cdn.jsdelivr.net/gh/jgraph/drawio-mcp@main/shape-search/search-index.json";
var ICON_SEARCH_URL = "https://icons.diagrams.net/api/icons/search?p=0&c=3&q=";

// ICON_STYLE_PREFIX in shared/icon-search.js
var ICON_STYLE_PREFIX = "shape=image;html=1;verticalAlign=top;" +
  "verticalLabelPosition=bottom;labelBackgroundColor=default;imageAspect=0;" +
  "aspect=fixed;image=";

var LIMIT = 6;

// Library images such as image=img/lib/azure2/... resolve only inside the draw.io
// editor (an SVG export points them at the local app), so make them absolute, as
// toAbsoluteImageUrl in shared/shape-search.js does for the MCP servers.
function toAbsoluteImageUrl(style)
{
  return style.replace(/(^|;)image=(?!https?:|data:)\/?/g, "$1image=https://app.diagrams.net/");
}

function words(text)
{
  return text.toLowerCase().split(/\W+/).filter(function(word)
  {
    return word.length > 0;
  });
}

async function searchIcons(query)
{
  try
  {
    var res = await fetch(ICON_SEARCH_URL + encodeURIComponent(query),
      { signal: AbortSignal.timeout(10000) });
    var data = await res.json();

    return data.images.filter(function(img)
    {
      return /^https:\/\/[^;&"'<>\s]+$/.test(img.url);
    }).map(function(img)
    {
      return img.title + " 48x48 " + ICON_STYLE_PREFIX + img.url;
    });
  }
  catch (e)
  {
    return [];
  }
}

async function main()
{
  var queries = process.argv.slice(2);

  if (queries.length === 0)
  {
    console.error("Usage: node find-shapes.js \"aws4 lambda\" \"github\" ...");
    process.exit(2);
  }

  if (typeof fetch !== "function")
  {
    console.error("find-shapes.js needs Node.js 18 or later.");
    process.exit(1);
  }

  var index;

  try
  {
    var res = await fetch(INDEX_URL, { signal: AbortSignal.timeout(30000) });
    index = await res.json();
  }
  catch (e)
  {
    console.error("Could not load the shape index from " + INDEX_URL + ": " + e.message);
    process.exit(1);
  }

  for (var i = 0; i < queries.length; i++)
  {
    var terms = words(queries[i]);
    var lines = index.filter(function(shape)
    {
      var tags = words(shape.tags || "");

      return terms.length > 0 && terms.every(function(term)
      {
        return tags.indexOf(term) >= 0;
      });
    }).slice(0, LIMIT).map(function(shape)
    {
      return shape.title + " " + shape.w + "x" + shape.h + " " + toAbsoluteImageUrl(shape.style);
    });

    if (lines.length < LIMIT)
    {
      lines = lines.concat(await searchIcons(queries[i]));
    }

    console.log("# " + queries[i] + "\n" + (lines.length > 0 ? lines.join("\n") : "(no match)"));
  }
}

main();
