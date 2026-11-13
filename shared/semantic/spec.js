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
  lanes: "swimlane",
  "cross-functional": "swimlane",
  cloud: "architecture",
  aws: "architecture",
  azure: "architecture",
  gcp: "architecture",
  "state machine": "state",
  "org chart": "orgchart",
  org: "orgchart",
  "mind map": "mindmap"
};

const KNOWN_KEYS = new Set(["type", "title", "direction", "nodes", "groups", "edges", "participants", "messages",
  "fragments", "legend"]);

function str(v)
{
  return (v == null) ? "" : String(v).trim();
}

function list(v)
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
    return v.split(/\s*[|\n]\s*/).filter(function(s) { return s !== ""; });
  }

  return [v];
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
 * @returns {{diagram: object|null, warnings: string[], error: string|null}}
 */
export function normalizeSpec(input)
{
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

  let type = str(spec.type).toLowerCase();
  type = TYPE_ALIASES[type] || type;

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

  for (const g of list(spec.groups))
  {
    const id = str(g && (g.id != null ? g.id : g.label));

    if (id === "" || groupIds.has(id))
    {
      warnings.push(id === "" ? "Dropped a group without an id." : "Dropped the second group with the id \"" + id + "\".");
      continue;
    }

    groupIds.add(id);
    groups.push({ id: id, label: str(g.label) || id, kind: str(g.kind).toLowerCase(), parent: str(g.parent) });
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

  for (const n of list(spec.nodes))
  {
    const node = (n != null && typeof n === "object") ? n : { id: n };
    const id = str(node.id != null ? node.id : node.label);

    if (id === "" || nodeIds.has(id) || groupIds.has(id))
    {
      warnings.push(id === "" ? "Dropped a node without an id." : "Dropped the second node or group with the id \"" + id + "\".");
      continue;
    }

    nodeIds.add(id);
    const group = str(node.group);

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
      fields: list(node.fields).map(fieldText).filter(function(s) { return s !== ""; }),
      methods: list(node.methods).map(fieldText).filter(function(s) { return s !== ""; })
    });
  }

  const edges = [];

  for (const e of list(spec.edges))
  {
    if (e == null || typeof e !== "object")
    {
      continue;
    }

    const from = str(e.from != null ? e.from : e.source);
    const to = str(e.to != null ? e.to : e.target);

    if (!nodeIds.has(from) || !nodeIds.has(to))
    {
      warnings.push("Dropped the edge " + (from || "?") + " → " + (to || "?") + ": " +
        (!nodeIds.has(from) ? "\"" + from + "\"" : "\"" + to + "\"") + " is not a node.");
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
    diagram: { type: type, title: str(spec.title), direction: str(spec.direction).toLowerCase(), groups: groups,
      nodes: nodes, edges: edges },
    warnings: warnings,
    error: null
  };
}
