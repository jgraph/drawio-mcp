// Reads a semantic diagram description (FORMAT.md) into one normalized shape
// the layouts can rely on. Lenient like create_diagram's arguments: a JSON
// string is parsed, ids become strings, a missing label is the id, `source` /
// `target` are read as `from` / `to`, and field lists may be one string with
// `|` or line breaks between the rows. What can't be used (an edge to a node
// that doesn't exist, a second node with the same id) is dropped with a
// warning, so the model learns it, but the diagram is still drawn.

export const TYPES = ["er", "class", "flowchart", "swimlane", "architecture", "network", "state", "sequence",
  "orgchart", "mindmap"];

const TYPE_ALIASES =
{
  erd: "er",
  "entity-relationship": "er",
  "entity relationship": "er",
  "entity-relationship diagram": "er",
  database: "er",
  schema: "er",
  uml: "class",
  "uml class": "class",
  "class diagram": "class",
  flow: "flowchart",
  process: "flowchart",
  "flow chart": "flowchart",
  lanes: "swimlane",
  "cross-functional": "swimlane",
  "swimlane flowchart": "swimlane",
  "swim lane": "swimlane",
  cloud: "architecture",
  aws: "architecture",
  azure: "architecture",
  gcp: "architecture",
  kubernetes: "architecture",
  system: "architecture",
  infrastructure: "architecture",
  "network diagram": "network",
  "state machine": "state",
  "org chart": "orgchart",
  org: "orgchart",
  "mind map": "mindmap"
};

const KNOWN_KEYS = new Set(["type", "title", "direction", "nodes", "groups", "lanes", "edges", "participants", "messages",
  "fragments", "legend"]);

// The types whose edges may end at a group (a call into a cluster, a
// monitor that reads from every service of a namespace).
const GROUP_ENDS = new Set(["architecture", "network", "flowchart", "swimlane"]);

const DIRECTIONS =
{
  vertical: "vertical", tb: "vertical", td: "vertical", "top-down": "vertical", "top to bottom": "vertical", down: "vertical",
  horizontal: "horizontal", lr: "horizontal", "left-right": "horizontal", "left to right": "horizontal", right: "horizontal"
};

function str(v)
{
  return (v == null) ? "" : String(v).trim();
}

// The start of JSON text: a list of objects, strings or lists, or an object.
const JSON_START = /^\s*(?:\[\s*(?:[{"\[\]]|$)|\{\s*(?:["}]|$))/;

// A list: an array, one item, or a string with `|` or line breaks between
// the items. A string that is JSON (models send `nodes` and `edges` as JSON
// text, which the app server parses too) is read as JSON; one that starts
// like JSON but doesn't parse is still being streamed into the viewer, and
// counts as empty rather than as one item named after its text.
export function readList(v)
{
  if (v == null || v === "")
  {
    return [];
  }

  if (Array.isArray(v))
  {
    return v;
  }

  if (typeof v === "string")
  {
    if (/^\s*[\[{]/.test(v))
    {
      try
      {
        const parsed = JSON.parse(v);

        return Array.isArray(parsed) ? parsed : readList(parsed);
      }
      catch (e)
      {
        if (JSON_START.test(v))
        {
          return [];
        }
      }
    }

    return v.split(/\s*[|\n]\s*/).filter(function(s) { return s !== ""; });
  }

  return [v];
}

// A placement hint: a number from 1 (also as text); anything else is none.
function ordinal(v)
{
  const n = (v == null || v === "" || typeof v === "boolean") ? NaN : Number(v);

  return (Number.isFinite(n) && n >= 0 && n <= 1000) ? n : null;
}

/**
 * A type as the engine reads it: any case, aliases (`erd`, `schema`) mapped
 * to their type. Not checked against TYPES.
 *
 * @param {*} value - the `type` of a description
 * @returns {string}
 */
export function typeName(value)
{
  const type = str(value).toLowerCase();

  return TYPE_ALIASES[type] || type;
}

function fieldText(f)
{
  if (f != null && typeof f === "object")
  {
    const keys = [];

    if (f.pk || f.primaryKey || /\bPK\b/i.test(str(f.key)))
    {
      keys.push("PK");
    }

    if (f.fk || f.foreignKey || /\bFK\b/i.test(str(f.key)))
    {
      keys.push("FK");
    }

    const name = str(f.name || f.label || f.id);
    const type = str(f.type);

    return (keys.length ? keys.join(", ") + " " : "") + name + (type ? ": " + type : "");
  }

  return str(f);
}

/**
 * @param {object|string} input - the description, or its JSON text
 * @param {{hints?: boolean}} [options] - hints: false drops the placement
 *   hints (row, col) of nodes and groups
 * @returns {{diagram: object|null, warnings: string[], error: string|null}}
 */
export function normalizeSpec(input, options)
{
  const hints = !(options != null && options.hints === false);
  const warnings = [];
  let spec = input;

  if (typeof spec === "string")
  {
    try
    {
      spec = JSON.parse(spec);
    }
    catch (e)
    {
      return { diagram: null, warnings: warnings, error: "The diagram is not valid JSON: " + e.message };
    }
  }

  if (spec == null || typeof spec !== "object" || Array.isArray(spec))
  {
    return { diagram: null, warnings: warnings, error: "The diagram must be an object with a type." };
  }

  const type = typeName(spec.type);

  if (TYPES.indexOf(type) < 0)
  {
    return { diagram: null, warnings: warnings,
      error: "Unknown type \"" + str(spec.type) + "\". Use one of: " + TYPES.join(", ") + "." };
  }

  for (const key of Object.keys(spec))
  {
    if (!KNOWN_KEYS.has(key))
    {
      warnings.push("Ignored the unknown key \"" + key + "\".");
    }
  }

  const groups = [];
  const groupIds = new Set();

  // `lanes` is read as groups of the kind lane; a lane or a group may be
  // just its name.
  const groupList = readList(spec.groups).map(function(g) { return { g: g, lane: false }; })
    .concat(readList(spec.lanes).map(function(g) { return { g: g, lane: true }; }));

  for (const entry of groupList)
  {
    const g = (entry.g != null && typeof entry.g === "object") ? entry.g : { id: entry.g };
    const id = str(g.id != null ? g.id : g.label);

    if (id === "" || groupIds.has(id))
    {
      warnings.push(id === "" ? "Dropped a group without an id." : "Dropped the second group with the id \"" + id + "\".");
      continue;
    }

    groupIds.add(id);
    groups.push({ id: id, label: str(g.label) || id, kind: str(g.kind).toLowerCase() || (entry.lane ? "lane" : ""),
      parent: str(g.parent != null ? g.parent : g.group), icon: str(g.icon),
      row: hints ? ordinal(g.row) : null, col: hints ? ordinal(g.col != null ? g.col : g.column) : null });
  }

  for (const g of groups)
  {
    if (g.parent !== "" && !groupIds.has(g.parent))
    {
      warnings.push("The group \"" + g.id + "\" names the unknown parent \"" + g.parent + "\".");
      g.parent = "";
    }
  }

  const nodes = [];
  const nodeIds = new Set();

  for (const n of readList(spec.nodes))
  {
    const node = (n != null && typeof n === "object") ? n : { id: n };
    const id = str(node.id != null ? node.id : node.label);

    if (id === "" || nodeIds.has(id) || groupIds.has(id))
    {
      warnings.push(id === "" ? "Dropped a node without an id." : "Dropped the second node or group with the id \"" + id + "\".");
      continue;
    }

    nodeIds.add(id);
    const group = str(node.group != null ? node.group : (node.lane != null ? node.lane : node.parent));

    if (group !== "" && !groupIds.has(group))
    {
      warnings.push("The node \"" + id + "\" names the unknown group \"" + group + "\".");
    }

    nodes.push({
      id: id,
      label: str(node.label) || id,
      kind: str(node.kind).toLowerCase(),
      sub: str(node.sub),
      icon: str(node.icon),
      role: str(node.role).toLowerCase(),
      group: groupIds.has(group) ? group : "",
      row: hints ? ordinal(node.row) : null,
      col: hints ? ordinal(node.col != null ? node.col : node.column) : null,
      fields: readList(node.fields).map(fieldText).filter(function(s) { return s !== ""; }),
      methods: readList(node.methods).map(fieldText).filter(function(s) { return s !== ""; })
    });
  }

  const edges = [];

  for (const e of readList(spec.edges))
  {
    if (e == null || typeof e !== "object")
    {
      continue;
    }

    const from = str(e.from != null ? e.from : e.source);
    const to = str(e.to != null ? e.to : e.target);
    const isEnd = function(id) { return nodeIds.has(id) || (GROUP_ENDS.has(type) && groupIds.has(id)); };

    if (!isEnd(from) || !isEnd(to))
    {
      warnings.push("Dropped the edge " + (from || "?") + " → " + (to || "?") + ": " +
        (!isEnd(from) ? "\"" + from + "\"" : "\"" + to + "\"") + " is not a node.");
      continue;
    }

    edges.push({
      from: from,
      to: to,
      label: str(e.label),
      kind: str(e.kind).toLowerCase().replace(/[\s_]+/g, "-"),
      fromCard: str(e.fromCard),
      toCard: str(e.toCard),
      fromField: str(e.fromField),
      toField: str(e.toField)
    });
  }

  return {
    diagram: { type: type, title: str(spec.title), direction: DIRECTIONS[str(spec.direction).toLowerCase()] || "", groups: groups,
      nodes: nodes, edges: edges },
    warnings: warnings,
    error: null
  };
}
