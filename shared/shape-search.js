/**
 * Soundex phonetic encoding — matches the implementation in draw.io's Editor.js.
 * Returns a 4-character code (letter + 3 digits).
 */
function soundex(name)
{
  if (name == null || name.length === 0)
  {
    return "";
  }

  var s = [];
  var si = 1;
  var mappings = "01230120022455012603010202";

  s[0] = name[0].toUpperCase();

  for (var i = 1, l = name.length; i < l; i++)
  {
    var c = name[i].toUpperCase().charCodeAt(0) - 65;

    if (c >= 0 && c <= 25)
    {
      if (mappings[c] !== "0")
      {
        if (mappings[c] !== s[si - 1])
        {
          s[si] = mappings[c];
          si++;
        }

        if (si > 3)
        {
          break;
        }
      }
    }
  }

  while (si <= 3)
  {
    s[si] = "0";
    si++;
  }

  return s.join("");
}

/**
 * Split a token on camelCase and letter-digit boundaries.
 * e.g. "pid2misc" → ["pid", "misc"], "pid2inst" → ["pid", "inst"],
 *      "discInst" → ["disc", "inst"], "hello" → ["hello"]
 *
 * @param {string} token - A single query token.
 * @returns {Array<string>} Sub-tokens (lowercased, length >= 2 only).
 */
function splitCompoundToken(token)
{
  // Split on: digit-to-letter, letter-to-digit, lowercase-to-uppercase
  var parts = token.replace(/([a-z])([A-Z])/g, "$1 $2")
                   .replace(/([a-zA-Z])(\d)/g, "$1 $2")
                   .replace(/(\d)([a-zA-Z])/g, "$1 $2")
                   .toLowerCase()
                   .split(/\s+/);

  return parts.filter(function(p) { return p.length >= 2; });
}

/**
 * Collect all shape indices that match a single term (exact + Soundex).
 * Returns an object with separate exact and phonetic sets.
 *
 * @param {Object} tagMap - Pre-built tag→indices map.
 * @param {string} term - A single search term (lowercase).
 * @returns {{ exact: Set<number>, phonetic: Set<number> }}
 */
function matchTerm(tagMap, term)
{
  var exact = new Set();
  var phonetic = new Set();

  var exactHits = tagMap[term];

  if (exactHits)
  {
    exactHits.forEach(function(idx) { exact.add(idx); });
  }

  var sx = soundex(term.replace(/\.*\d*$/, ""));

  if (sx && sx !== term)
  {
    var phoneticHits = tagMap[sx];

    if (phoneticHits)
    {
      phoneticHits.forEach(function(idx)
      {
        if (!exact.has(idx))
        {
          phonetic.add(idx);
        }
      });
    }
  }

  return { exact: exact, phonetic: phonetic };
}

/**
 * Build a tag-to-entries lookup from the flat shape index array.
 * Each tag (and its Soundex equivalent) maps to a Set of indices.
 *
 * @param {Array} shapeIndex - Array of {style, w, h, title, tags, type}.
 * @returns {Object} tagMap - { tag: Set<number> }
 */
export function buildTagMap(shapeIndex)
{
  var tagMap = {};

  for (var i = 0; i < shapeIndex.length; i++)
  {
    var rawTags = shapeIndex[i].tags;

    if (!rawTags)
    {
      continue;
    }

    var tokens = rawTags.toLowerCase().replace(/[\/,()]/g, " ").split(" ");
    var seen = {};

    for (var j = 0; j < tokens.length; j++)
    {
      var token = tokens[j];

      if (token.length < 2 || seen[token])
      {
        continue;
      }

      seen[token] = true;

      if (!tagMap[token])
      {
        tagMap[token] = new Set();
      }

      tagMap[token].add(i);

      // Also index by Soundex
      var sx = soundex(token.replace(/\.*\d*$/, ""));

      if (sx && sx !== token && !seen[sx])
      {
        seen[sx] = true;

        if (!tagMap[sx])
        {
          tagMap[sx] = new Set();
        }

        tagMap[sx].add(i);
      }
    }
  }

  return tagMap;
}

/**
 * Search the shape index with scored ranking and graceful fallback.
 *
 * @param {Array} shapeIndex - The flat shape array.
 * @param {Object} tagMap - Pre-built tag→indices map from buildTagMap().
 * @param {string} query - Space-separated search terms.
 * @param {number} limit - Maximum results to return.
 * @returns {Array} Matching shapes: [{style, w, h, title}].
 */
export function searchShapes(shapeIndex, tagMap, query, limit)
{
  if (!query || !shapeIndex || shapeIndex.length === 0)
  {
    return [];
  }

  // Normalize: split compound tokens like "pid2misc" → ["pid", "misc"]
  var rawTerms = query.toLowerCase().split(/\s+/).filter(function(t) { return t.length > 0; });
  var terms = [];
  var seen = {};

  for (var i = 0; i < rawTerms.length; i++)
  {
    var subTokens = splitCompoundToken(rawTerms[i]);

    // If splitting produced nothing useful, keep the original if long enough
    if (subTokens.length === 0 && rawTerms[i].length >= 2)
    {
      subTokens = [rawTerms[i]];
    }

    for (var j = 0; j < subTokens.length; j++)
    {
      if (!seen[subTokens[j]])
      {
        seen[subTokens[j]] = true;
        terms.push(subTokens[j]);
      }
    }
  }

  if (terms.length === 0)
  {
    return [];
  }

  // Collect per-term match sets
  var termMatches = [];

  for (var i = 0; i < terms.length; i++)
  {
    termMatches.push(matchTerm(tagMap, terms[i]));
  }

  // Try strict AND first
  var andSet = null;

  for (var i = 0; i < termMatches.length; i++)
  {
    var combined = new Set();

    termMatches[i].exact.forEach(function(idx) { combined.add(idx); });
    termMatches[i].phonetic.forEach(function(idx) { combined.add(idx); });

    if (andSet === null)
    {
      andSet = combined;
    }
    else
    {
      var intersection = new Set();

      andSet.forEach(function(idx)
      {
        if (combined.has(idx))
        {
          intersection.add(idx);
        }
      });

      andSet = intersection;
    }

    if (andSet.size === 0)
    {
      break;
    }
  }

  // Score all candidates — either AND results or OR fallback
  var scores = {};

  if (andSet && andSet.size > 0)
  {
    // AND succeeded: score only the AND results
    andSet.forEach(function(idx)
    {
      scores[idx] = 0;
    });

    for (var i = 0; i < termMatches.length; i++)
    {
      var exactForTerm = new Set();

      termMatches[i].exact.forEach(function(idx)
      {
        if (scores[idx] !== undefined)
        {
          scores[idx] += 1.0;
          exactForTerm.add(idx);
        }
      });

      termMatches[i].phonetic.forEach(function(idx)
      {
        if (scores[idx] !== undefined && !exactForTerm.has(idx))
        {
          scores[idx] += 0.5;
        }
      });
    }
  }
  else
  {
    // AND failed: fall back to OR
    for (var i = 0; i < termMatches.length; i++)
    {
      var exactForTerm = new Set();

      termMatches[i].exact.forEach(function(idx)
      {
        if (scores[idx] === undefined)
        {
          scores[idx] = 0;
        }

        scores[idx] += 1.0;
        exactForTerm.add(idx);
      });

      termMatches[i].phonetic.forEach(function(idx)
      {
        if (!exactForTerm.has(idx))
        {
          if (scores[idx] === undefined)
          {
            scores[idx] = 0;
          }

          scores[idx] += 0.5;
        }
      });
    }
  }

  // Sort by score descending, then by title alphabetically
  var candidates = Object.keys(scores).map(function(idx)
  {
    return { idx: parseInt(idx, 10), score: scores[idx] };
  });

  candidates.sort(function(a, b)
  {
    if (b.score !== a.score)
    {
      return b.score - a.score;
    }

    var titleA = shapeIndex[a.idx].title || "";
    var titleB = shapeIndex[b.idx].title || "";

    return titleA.localeCompare(titleB);
  });

  // Convert to result objects
  var results = [];

  for (var i = 0; i < candidates.length && results.length < limit; i++)
  {
    var shape = shapeIndex[candidates[i].idx];

    results.push({
      style: shape.style,
      w: shape.w,
      h: shape.h,
      title: shape.title
    });
  }

  return results;
}
