// ── Icons by name ───────────────────────────────────────────────────────────
//
// `icon=aws lambda` in a vertex style stands for the official icon of that
// service: the resolver finds it in the icon table (shared/icon-table.js,
// generated from the shape index by shape-search/generate-icon-table.js) and
// writes its style in place of the key. The table holds the current icon sets
// of AWS, Azure, Google Cloud and Kubernetes only, so a name never lands on
// an AWS 3 or other outdated icon the way a keyword search can.
//
// A model writes `icon=<provider> <service>` and the label keys it wants
// (`fontSize`, …); everything else comes from the icon. That keeps the
// diagram short (an AWS icon's style is 300 to 500 characters) and saves the
// search round trip before the diagram.
//
// Headless and self-contained: everything lives inside createIconResolver,
// so the viewer inlines it with Function.prototype.toString(), as it does
// normalizeDiagramXml, and resolves names while the XML streams in. Both
// servers and the viewer therefore pick the same icon for a name.

/**
 * @param {{templates: string[], icons: Array}} table - ICON_TABLE
 * @param {string[]} [data] - ICON_DATA, the data URIs of the icons that are
 *   images. Without it (the viewer) those icons resolve to a placeholder
 *   that the server's result replaces.
 * @returns {{resolve: Function, rank: Function, applyToStyle: Function,
 *   applyToXml: Function, size: number, cacheSize: Function}}
 */
export function createIconResolver(table, data)
{
  // Provider words. They select the icon set and are not part of the name;
  // "kubernetes" stays a name word for the Azure and Google Cloud services.
  var PROVIDER_WORDS = { aws: "aws", amazon: "aws", azure: "azure", microsoft: "azure",
    gcp: "gcp", google: "gcp", k8s: "k8s", kubernetes: "k8s" };
  var PROVIDER_ORDER = ["aws", "azure", "gcp", "k8s"];
  var STOP_WORDS = ["the", "a", "an", "of", "for", "and", "on", "to", "with", "in", "icon", "logo", "symbol"];
  // Words of many names. A partial match on these alone ("aws payment
  // service" → Simple Email Service) is no match.
  var GENERIC_WORDS = ["service", "server", "instance", "cloud", "api", "app", "application", "data",
    "database", "db", "storage", "network", "networking", "gateway", "manager", "management", "engine",
    "function", "platform", "system", "web", "compute", "container", "cluster", "node", "group",
    "center", "hub", "studio", "analytic", "monitor", "monitoring", "security", "identity", "user",
    "client", "store", "file", "private", "public", "managed", "elastic", "simple", "virtual",
    "endpoint", "policy", "role", "resource", "account", "machine", "learning", "ai", "ml",
    "workflow", "event", "message", "queue", "stream", "streaming"];
  var GROUP_WORDS = ["group", "container", "boundary"];
  var KIND_RANK = { s: 0, r: -0.3, c: -1, g: 0 };
  // Keys that make the icon what it is. The icon's values win over the
  // cell's: a fill color from a theme would repaint an AWS service tile.
  var ICON_KEYS = ["shape", "resIcon", "prIcon", "grIcon", "image", "fillColor", "strokeColor",
    "gradientColor", "gradientDirection", "grStroke", "aspect", "imageAspect", "editableCssRules"];
  // The label color of an icon whose library writes one that is hard to read
  // on what the label sits on (isHardToRead): the page, or the fill of the
  // group around the icon. On a light surface the text color of the calm
  // theme, the default of the shared references (shared/xml-reference.md,
  // Color themes) and of the role styles (shared/diagram-shorthand.js); on a
  // dark one (the dark theme's page, background="#0F172A" on mxGraphModel)
  // the dark theme's text color.
  var LABEL_COLOR = "#1B1F24";
  var DARK_PAGE_LABEL_COLOR = "#F1F5F9";
  // Below this luminance a surface is dark: white text has more contrast on
  // it than black.
  var DARK_SURFACE = Math.sqrt(1.05 * 0.05) - 0.05;
  // What draw.io paints for fillColor=default, and for a shape without a
  // fillColor, with adaptiveColors="none" (the dark theme's): white, also on
  // a dark page.
  var DEFAULT_FILL = "#FFFFFF";
  // An icon whose image the viewer doesn't have, while the XML streams in.
  // Its label gets the icon's label color (styleOf).
  var PLACEHOLDER_STYLE = "rounded=1;arcSize=16;fillColor=#F1F3F4;strokeColor=#DADCE0;" +
    "verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=11;aspect=fixed;";
  // No icon name is longer (the longest in the table has 59 characters), so
  // a longer one matches nothing and isn't ranked or kept.
  var MAX_NAME_LENGTH = 100;
  // The names resolved last. The servers keep one resolver for every caller,
  // so the cache must not grow with what callers send.
  var CACHE_SIZE = 500;
  // A cell larger than 100 × 100 without children (a VPC drawn before its
  // subnets, or whose subnets haven't streamed in yet) takes a group that
  // fits as well as an icon; a smaller one takes a group only as a last
  // resort.
  var LARGE_GROUP_BONUS = 2;
  var SMALL_GROUP_PENALTY = 6;

  function stem(token)
  {
    if (token.length > 4 && /ies$/.test(token))
    {
      return token.substring(0, token.length - 3) + "y";
    }

    if (token.length > 3 && /s$/.test(token) && !/(ss|us|is|os)$/.test(token))
    {
      return token.substring(0, token.length - 1);
    }

    return token;
  }

  /** The words of a name, lowercase, without stop words, not stemmed. */
  function words(text)
  {
    return String(text).toLowerCase().replace(/&/g, " ").split(/[^a-z0-9]+/).filter(function(w)
    {
      return w.length > 0 && STOP_WORDS.indexOf(w) < 0;
    });
  }

  /** Words other than the provider words of the other sets (see parseQuery). */
  function nameWords(text)
  {
    return words(text).filter(function(w)
    {
      return PROVIDER_WORDS[w] == null || PROVIDER_WORDS[w] === "k8s";
    });
  }

  /**
   * The relative luminance (WCAG) of a #RGB or #RRGGBB color and whether it
   * is a gray, or null for any other value (`none`, `default`, …).
   * @param {string} color
   */
  function parseColor(color)
  {
    var match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());

    if (match == null)
    {
      return null;
    }

    var hex = match[1];

    if (hex.length === 3)
    {
      hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    }

    var channels = [0, 2, 4].map(function(i)
    {
      return parseInt(hex.substring(i, i + 2), 16);
    });
    var weights = [0.2126, 0.7152, 0.0722];
    var luminance = 0;

    channels.forEach(function(value, i)
    {
      var c = value / 255;

      luminance += weights[i] * ((c <= 0.04045) ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    });

    return { luminance: luminance, gray: Math.max.apply(null, channels) - Math.min.apply(null, channels) <= 48 };
  }

  /**
   * The luminance of what a label sits on: white's unless a color is given
   * (the page's `background="#0F172A"`, the fill of the group around it).
   * @param {string} [background] - a color, or none
   */
  function surfaceLuminance(background)
  {
    var color = (background != null) ? parseColor(background) : null;

    return (color != null) ? color.luminance : 1;
  }

  /**
   * Whether a label color from a library is hard to read on what the label
   * sits on: a gray with less than 4.5:1 contrast against it (WCAG AA for
   * text), or any color with less than 3:1. On a white page that is the
   * Google Cloud products' (gcp2) #999999 (2.8:1), AWS's VPC group #AAB7B8
   * (2.1:1) and its generic subnet #879196 (3.2:1), while the colored labels
   * of the other AWS groups, which match their borders (#D86613, 3.6:1), and
   * the dark ones stay. On the dark theme's page (#0F172A) those grays are
   * readable (6.3:1) and AWS's dark labels (#232F3E, 1.3:1) are not, but in
   * a private subnet there (fill #E6F6F7) the dark labels read well.
   * @param {string} color - a value of fontColor
   * @param {number} surface - its luminance (surfaceLuminance)
   */
  function isHardToRead(color, surface)
  {
    var label = parseColor(color);

    if (label == null)
    {
      return false;
    }

    var contrast = (Math.max(label.luminance, surface) + 0.05) / (Math.min(label.luminance, surface) + 0.05);

    return contrast < 3 || (label.gray && contrast < 4.5);
  }

  /**
   * A style whose label color from the library is readable on what the label
   * sits on: one that is hard to read (isHardToRead) becomes the calm theme's
   * text color on a light surface and the dark theme's on a dark one. A label
   * color the cell writes itself still wins (applyToStyle).
   * @param {string} style - an icon template
   * @param {number} surface - the luminance of what the label sits on
   */
  function withReadableLabel(style, surface)
  {
    return style.replace(/(^|;)fontColor=([^;]*)/, function(all, start, color)
    {
      return isHardToRead(color, surface) ?
        start + "fontColor=" + ((surface < DARK_SURFACE) ? DARK_PAGE_LABEL_COLOR : LABEL_COLOR) : all;
    });
  }

  /**
   * Whether the label of a style sits outside its shape: below or beside it,
   * or under an image (draw.io's `image` style puts it there).
   * @param {{names: string[], values: Object}} style - parseStyle's result
   */
  function isLabelOutside(style)
  {
    return /^(top|bottom)$/.test(style.values.verticalLabelPosition || "") ||
      /^(left|right)$/.test(style.values.labelPosition || "") ||
      (style.names.indexOf("image") >= 0 && style.values.verticalLabelPosition == null);
  }

  /**
   * The color the children of a shape sit on, or null where it is
   * transparent: `fillColor=none`, a `group` or `text`, the body of a
   * swimlane without a `swimlaneFillColor`, or a value that names no color.
   * A shape without a fill is painted white (DEFAULT_FILL).
   * @param {string} style - as written, or an icon's style
   */
  function fillOf(style)
  {
    var parsed = parseStyle(style);
    var swimlane = parsed.names.indexOf("swimlane") >= 0 || parsed.values.shape === "swimlane";
    var fill = swimlane ? parsed.values.swimlaneFillColor : parsed.values.fillColor;

    if (fill == null)
    {
      return (swimlane || parsed.names.indexOf("group") >= 0 || parsed.names.indexOf("text") >= 0) ?
        null : DEFAULT_FILL;
    }

    fill = fill.trim();

    if (fill === "default")
    {
      return DEFAULT_FILL;
    }

    return (parseColor(fill) != null) ? fill : null;
  }

  var GENERIC = GENERIC_WORDS.map(stem);
  var entries = table.icons.map(function(icon)
  {
    var names = icon[2].split("|");

    return {
      provider: icon[0],
      kind: icon[1],
      title: names[0],
      variants: names.map(function(name)
      {
        return nameWords(name).map(stem);
      }).filter(function(v) { return v.length > 0; }),
      // The names as written, to prefer "Users" over "User" for "users".
      squashed: names.map(function(name)
      {
        return nameWords(name).join("");
      }),
      template: table.templates[icon[3]],
      n: icon[4],
      c: icon[5],
      w: icon[6],
      h: icon[7]
    };
  });

  /**
   * Which query words a name covers, and how many of its own words are
   * left over. A run of words on one side may equal one word on the other:
   * "cloud front" and "CloudFront", "postgresql" and "Postgre SQL".
   */
  function matchWords(query, name)
  {
    var coveredQuery = query.map(function() { return false; });
    var coveredName = name.map(function() { return false; });
    var i, j, len, joined;

    for (i = 0; i < query.length; i++)
    {
      for (len = 1; len <= 3 && i + len <= query.length; len++)
      {
        joined = query.slice(i, i + len).join("");

        for (j = 0; j < name.length; j++)
        {
          if (!coveredName[j] && name[j] === joined)
          {
            coveredName[j] = true;

            for (var k = i; k < i + len; k++)
            {
              coveredQuery[k] = true;
            }

            break;
          }
        }
      }
    }

    for (j = 0; j < name.length; j++)
    {
      for (len = 2; len <= 3 && j + len <= name.length; len++)
      {
        joined = name.slice(j, j + len).join("");

        for (i = 0; i < query.length; i++)
        {
          if (!coveredQuery[i] && query[i] === joined)
          {
            coveredQuery[i] = true;

            for (var m = j; m < j + len; m++)
            {
              coveredName[m] = true;
            }
          }
        }
      }
    }

    return {
      query: coveredQuery,
      extra: coveredName.filter(function(c) { return !c; }).length
    };
  }

  /**
   * Scores an entry for the query words: covered words count, words left
   * over on either side cost, an exact name gets a bonus, and the kind of
   * icon breaks ties (a service tile before a resource glyph).
   */
  function scoreEntry(entry, query, squashed, container, large)
  {
    // A container takes only a group shape (VPC, subnet, …); any other cell
    // takes a group if it is large, otherwise only as a last resort (below).
    if (container && entry.kind !== "g")
    {
      return null;
    }

    var q = query;
    var groupWords = 0;

    if (entry.kind === "g")
    {
      q = query.filter(function(w) { return GROUP_WORDS.indexOf(w) < 0; });
      groupWords = query.length - q.length;
    }

    if (q.length === 0)
    {
      return null;
    }

    var covered = q.map(function() { return false; });
    var leastExtra = Infinity;
    var exact = false;

    entry.variants.forEach(function(variant)
    {
      var m = matchWords(q, variant);
      var count = 0;

      m.query.forEach(function(c, i)
      {
        if (c)
        {
          covered[i] = true;
          count++;
        }
      });

      if (count > 0)
      {
        leastExtra = Math.min(leastExtra, m.extra);
        exact = exact || (count === q.length && m.extra === 0);
      }
    });

    var coveredWords = q.filter(function(_w, i) { return covered[i]; });

    if (coveredWords.length === 0)
    {
      return null;
    }

    var missing = q.length - coveredWords.length;
    var specific = coveredWords.some(function(w) { return GENERIC.indexOf(w) < 0; });

    // A partial match covers at least half of the words, not only generic
    // ones, and one of the icon's names exactly ("aws ecs fargate" →
    // Fargate, not "aws payment service" → Payment Cryptography).
    if (missing > 0 && (coveredWords.length < q.length / 2 || !specific || leastExtra > 0))
    {
      return null;
    }

    var chars = coveredWords.join("").length;
    var score = 10 * (coveredWords.length + groupWords) - 6 * missing - 1.5 * leastExtra +
      (exact ? 4 : 0) + (KIND_RANK[entry.kind] || 0) + 0.01 * chars +
      (entry.squashed.indexOf(squashed) >= 0 ? 0.5 : 0);

    if (entry.kind === "g" && !container)
    {
      score += large ? LARGE_GROUP_BONUS : -SMALL_GROUP_PENALTY;
    }

    return score;
  }

  /** The query words and the provider they name, if any. */
  function parseQuery(name)
  {
    var all = words(name);
    var provider = null;

    for (var i = 0; i < all.length && provider == null; i++)
    {
      if (PROVIDER_WORDS[all[i]] != null && PROVIDER_WORDS[all[i]] !== "k8s")
      {
        provider = PROVIDER_WORDS[all[i]];
      }
    }

    if (provider == null && (all.indexOf("kubernetes") >= 0 || all.indexOf("k8s") >= 0))
    {
      provider = "k8s";
    }

    var query = all.filter(function(w)
    {
      var p = PROVIDER_WORDS[w];

      return p == null || (p === "k8s" && provider !== "k8s");
    });

    // A bare provider word ("aws") names no icon of that provider.
    if (query.length === 0)
    {
      provider = null;
      query = all;
    }

    return { provider: provider, words: query.map(stem), squashed: query.join("") };
  }

  /**
   * The fill an icon's own label sits on, or null for a label outside the
   * icon or a group without a fill: AWS's private and public subnets
   * (#E6F6F7, #F2F6E8) have theirs inside, at the top left.
   */
  function ownLabelFill(entry)
  {
    if (entry.labelFill === undefined)
    {
      var style = parseStyle(entry.template.replace("{c}", entry.c));

      entry.labelFill = (!isLabelOutside(style) && style.values.fillColor != null &&
        parseColor(style.values.fillColor) != null) ? style.values.fillColor : null;
    }

    return entry.labelFill;
  }

  // The icon's style on a surface of that luminance (surfaceLuminance); a
  // label inside the icon sits on the icon's own fill, where it has one.
  function styleOf(entry, surface)
  {
    var fill = ownLabelFill(entry);
    var template = withReadableLabel(entry.template, (fill != null) ? surfaceLuminance(fill) : surface);
    var n = entry.n;

    if (typeof n === "number")
    {
      if (data == null || data[n] == null)
      {
        // The label as the icon will have it.
        var label = /(?:^|;)fontColor=([^;]*)/.exec(template);

        return { style: PLACEHOLDER_STYLE + ((label != null) ? "fontColor=" + label[1] + ";" : ""),
          placeholder: true };
      }

      n = data[n];
    }

    return { style: template.replace("{n}", n).replace("{c}", entry.c), placeholder: false };
  }

  /**
   * The best icons for a name, best first, with their scores.
   * @param {string} name - e.g. "aws lambda", "Azure Functions", "gcp pub/sub"
   * @param {{container?: boolean, large?: boolean, background?: string}}
   *   [options] - container: the cell holds other cells, so only group
   *   shapes (AWS VPC, subnet, …) qualify; large: the cell is larger than
   *   100 × 100, so a group shape wins over an icon that fits as well;
   *   background: the color the icon sits on, which the label color must be
   *   readable on: the page's background, or the fill of the group around
   *   the icon (white without one)
   * @param {number} [limit]
   */
  function rank(name, options, limit)
  {
    var container = options != null && options.container === true;
    var large = options != null && options.large === true;
    var surface = surfaceLuminance(options != null ? options.background : null);
    var results = [];

    if (String(name).length > MAX_NAME_LENGTH)
    {
      return results;
    }

    var parsed = parseQuery(name);

    if (parsed.words.length === 0)
    {
      return results;
    }

    entries.forEach(function(entry)
    {
      if (parsed.provider != null && entry.provider !== parsed.provider)
      {
        return;
      }

      var score = scoreEntry(entry, parsed.words, parsed.squashed, container, large);

      if (score != null)
      {
        if (parsed.provider == null)
        {
          score -= 0.05 * PROVIDER_ORDER.indexOf(entry.provider);
        }

        results.push({ entry: entry, score: score });
      }
    });

    results.sort(function(a, b)
    {
      return (b.score - a.score) || (a.entry.title.length - b.entry.title.length);
    });

    return results.slice(0, limit || 5).map(function(r)
    {
      var s = styleOf(r.entry, surface);

      return { title: r.entry.title, provider: r.entry.provider, kind: r.entry.kind, style: s.style,
        placeholder: s.placeholder, w: r.entry.w, h: r.entry.h, score: Math.round(r.score * 100) / 100 };
    });
  }

  // Least recently used first (a Map iterates in insertion order).
  var cache = new Map();

  /**
   * The icon for a name, or null when none fits.
   * @param {string} name
   * @param {{container?: boolean, large?: boolean, background?: string}}
   *   [options] - see rank
   * @returns {{title: string, provider: string, kind: string, style: string,
   *   placeholder: boolean, w: number, h: number}|null}
   */
  function resolve(name, options)
  {
    var text = String(name);

    if (text.length > MAX_NAME_LENGTH)
    {
      return null;
    }

    var key = text.toLowerCase().trim() + "|" + (options != null && options.container === true) +
      "|" + (options != null && options.large === true) +
      "|" + surfaceLuminance(options != null ? options.background : null);
    var icon = cache.get(key);

    if (icon !== undefined)
    {
      cache.delete(key);
    }
    else
    {
      icon = rank(name, options, 1)[0] || null;

      if (cache.size >= CACHE_SIZE)
      {
        cache.delete(cache.keys().next().value);
      }
    }

    cache.set(key, icon);

    return icon;
  }

  function parseStyle(style)
  {
    var names = [];
    var keys = [];
    var values = {};

    String(style).split(";").forEach(function(part)
    {
      var eq = part.indexOf("=");

      if (eq < 0)
      {
        if (part.trim() !== "")
        {
          names.push(part.trim());
        }
      }
      else
      {
        var k = part.substring(0, eq).trim();

        if (values[k] == null)
        {
          keys.push(k);
        }

        values[k] = part.substring(eq + 1);
      }
    });

    return { names: names, keys: keys, values: values };
  }

  function decodeXml(text)
  {
    return text.replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-fA-F]+));/g, function(m, name, dec, hex)
    {
      return dec != null ? String.fromCharCode(parseInt(dec, 10)) :
        hex != null ? String.fromCharCode(parseInt(hex, 16)) :
        { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" }[name];
    });
  }

  /**
   * Replaces `icon=<name>` in a style with the icon's style, whose label
   * color is readable on what the icon sits on (isHardToRead,
   * options.background). The cell's other keys stay and win, except the
   * keys that make the icon (ICON_KEYS) and `whiteSpace` on an icon whose
   * label sits outside it (the name below an icon doesn't wrap at the icon's
   * width). Style names without a value (`rounded`, `ellipse`) are dropped.
   * @param {string} style - as written, XML-escaped if it comes from XML
   * @returns {{style: string, name: string, icon: Object|null}|null} null
   *   when the style has no icon key; `icon` null when no icon fits.
   */
  function applyToStyle(style, options)
  {
    var cell = parseStyle(style);
    var key = null;

    for (var i = 0; i < cell.keys.length && key == null; i++)
    {
      if (cell.keys[i].toLowerCase() === "icon")
      {
        key = cell.keys[i];
      }
    }

    if (key == null)
    {
      return null;
    }

    var name = decodeXml(cell.values[key]).trim();
    var icon = resolve(name, options);

    if (icon == null)
    {
      return { style: style, name: name, icon: null };
    }

    var base = parseStyle(icon.style);
    var outside = isLabelOutside(base);

    cell.keys.forEach(function(k)
    {
      if (k === key || ICON_KEYS.indexOf(k) >= 0 || (k === "whiteSpace" && outside))
      {
        return;
      }

      if (base.values[k] == null)
      {
        base.keys.push(k);
      }

      base.values[k] = cell.values[k];
    });

    var parts = base.names.slice();

    base.keys.forEach(function(k)
    {
      parts.push(k + "=" + base.values[k]);
    });

    return { style: parts.join(";") + ";", name: name, icon: icon };
  }

  /**
   * Resolves every `icon=` in the vertex styles of a draw.io XML string,
   * also a partial one while it streams in. A cell counts as a container
   * (only group shapes fit) when its style has container=1 or other cells
   * on its page name it as their parent; a cell larger than 100 × 100
   * prefers a group shape but still takes an icon (rank's `large`). The
   * label colors are readable on what the cell sits on (rank's
   * `background`): the fill of the nearest shape around it that has one
   * (fillOf; an AWS subnet's comes from its icon), or else the background of
   * its page. A dark page (the dark theme's `background="#0F172A"`) keeps a
   * library's gray and gets a light label for a dark one, while a pale
   * subnet on it keeps the dark labels of the icons in it.
   * @returns {{xml: string, resolved: Array, unresolved: Array}}
   */
  function applyToXml(xml)
  {
    var resolved = [];
    var unresolved = [];

    if (typeof xml !== "string" || !/(^|[;"'\s])icon\s*=/i.test(xml))
    {
      return { xml: xml, resolved: resolved, unresolved: unresolved };
    }

    // Pages reuse ids ("2", "3", …): a parent counts on its own page only.
    // A page's background decides the label colors on it (pageBackgrounds,
    // by the number pageAt gives).
    var pageStarts = [];
    var pageBackgrounds = [null];
    var pagePattern = /<mxGraphModel\b((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)/g;
    var pageMatch;

    while ((pageMatch = pagePattern.exec(xml)) != null)
    {
      var background = /\sbackground\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(pageMatch[1]);

      pageStarts.push(pageMatch.index);
      pageBackgrounds.push(background != null ? (background[1] != null ? background[1] : background[2]) : null);
    }

    function pageAt(offset)
    {
      var page = 0;

      while (page < pageStarts.length && pageStarts[page] <= offset)
      {
        page++;
      }

      return page;
    }

    var parents = {};

    xml.replace(/\sparent\s*=\s*(?:"([^"]*)"|'([^']*)')/g, function(_m, a, b, offset)
    {
      parents[pageAt(offset) + " " + (a != null ? a : b)] = true;
      return "";
    });

    var ATTRIBUTES = {
      id: /\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/,
      parent: /\sparent\s*=\s*(?:"([^"]*)"|'([^']*)')/,
      style: /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/
    };

    function attribute(attrs, name)
    {
      var match = ATTRIBUTES[name].exec(attrs);

      return (match != null) ? (match[1] != null ? match[1] : match[2]) : null;
    }

    // The cell's id; in <object id="…"><mxCell …> the wrapper, the tag just
    // before the cell, carries it (a value has no raw `<`).
    function idOf(attrs, offset)
    {
      var id = attribute(attrs, "id");

      if (id == null && offset > 0)
      {
        var start = xml.lastIndexOf("<", offset - 1);
        var wrapper = (start >= 0) ? /^<(?:object|UserObject)\b((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*>\s*$/.exec(
          xml.substring(start, offset)) : null;

        id = (wrapper != null) ? attribute(wrapper[1], "id") : null;
      }

      return id;
    }

    // Attribute by attribute, so a `>` in a value (value="a -> b") doesn't
    // end the tag.
    var CELL = /<mxCell\b((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)(\s*)(\/?)>/g;
    // The cells by page and id: their parent, and the style of a vertex,
    // whose fill its children sit on (surfaceAt).
    var cells = {};

    xml.replace(CELL, function(tag, attrs, _space, _selfClosing, offset)
    {
      var id = idOf(attrs, offset);

      if (id != null)
      {
        cells[pageAt(offset) + " " + id] = { parent: attribute(attrs, "parent"),
          style: /vertex\s*=\s*["']1["']/.test(attrs) ? attribute(attrs, "style") : null };
      }

      return tag;
    });

    // What a cell of that page in the parent `id` sits on: the fill of the
    // nearest shape around it that has one, the icon's where the shape names
    // an icon (an AWS private subnet's #E6F6F7), or the page's background.
    function surfaceAt(page, id)
    {
      var seen = {};

      while (id != null && seen[id] !== true)
      {
        var cell = cells[page + " " + id];

        if (cell == null)
        {
          break;
        }

        if (cell.fill === undefined)
        {
          var icon = (cell.style != null && /(^|;)\s*icon\s*=/i.test(cell.style)) ?
            applyToStyle(cell.style, { container: true }) : null;

          cell.fill = (cell.style == null) ? null :
            fillOf((icon != null && icon.icon != null) ? icon.style : cell.style);
        }

        if (cell.fill != null)
        {
          return cell.fill;
        }

        seen[id] = true;
        id = cell.parent;
      }

      return pageBackgrounds[page];
    }

    var out = xml.replace(CELL, function(tag, attrs, space, selfClosing, offset)
    {
      var styleMatch = /(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/.exec(attrs);

      if (styleMatch == null || !/vertex\s*=\s*["']1["']/.test(attrs))
      {
        return tag;
      }

      var quote = styleMatch[2] != null ? "\"" : "'";
      var style = styleMatch[2] != null ? styleMatch[2] : styleMatch[3];

      if (!/(^|;)\s*icon\s*=/i.test(style))
      {
        return tag;
      }

      var id = idOf(attrs, offset);
      var container = /(^|;)\s*container\s*=\s*1/.test(style) ||
        (id != null && parents[pageAt(offset) + " " + id] === true);
      var large = false;

      if (!container && selfClosing !== "/")
      {
        var rest = xml.substring(offset + tag.length);
        var end = rest.search(/<\/mxCell>|<mxCell\b/);
        var geometry = /<mxGeometry\b[^>]*>/.exec(end >= 0 ? rest.substring(0, end) : rest);

        if (geometry != null)
        {
          var w = /\swidth\s*=\s*["']([\d.]+)["']/.exec(geometry[0]);
          var h = /\sheight\s*=\s*["']([\d.]+)["']/.exec(geometry[0]);

          large = w != null && h != null && parseFloat(w[1]) > 100 && parseFloat(h[1]) > 100;
        }
      }

      var result = applyToStyle(style, { container: container, large: large,
        background: surfaceAt(pageAt(offset), attribute(attrs, "parent")) });

      if (result == null)
      {
        return tag;
      }

      if (result.icon == null)
      {
        // The name goes back to the model in a warning: not a long one whole.
        var shown = result.name.length > MAX_NAME_LENGTH ?
          result.name.substring(0, MAX_NAME_LENGTH) + "…" : result.name;

        unresolved.push({ id: id, name: shown, container: container });

        return tag;
      }

      resolved.push({ id: id, name: result.name, title: result.icon.title, provider: result.icon.provider });

      return "<mxCell" + attrs.substring(0, styleMatch.index) + styleMatch[1] + quote + result.style + quote +
        attrs.substring(styleMatch.index + styleMatch[0].length) + space + selfClosing + ">";
    });

    return { xml: out, resolved: resolved, unresolved: unresolved };
  }

  return { resolve: resolve, rank: rank, applyToStyle: applyToStyle, applyToXml: applyToXml,
    size: entries.length, cacheSize: function() { return cache.size; } };
}
