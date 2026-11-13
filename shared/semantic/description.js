// The description and the input schema of the semantic diagram tool, as the
// model reads them. Built from the types that are switched on, so a type is
// only offered once its layout is at least as good as the model placing the
// XML itself (judged blind on rendered images, see bench/README.md). Each
// server's tools test caps descriptions at 2048 characters; the schema
// doesn't count towards that, so the keys of nodes, groups and edges are
// described there and the description keeps what a type is and its rules.

const INTRO =
  "Creates and displays a draw.io diagram from a description of its content: you say what exists and how it connects, " +
  "the server lays it out, routes the lines and styles it. Never give coordinates, sizes or styles. " +
  "To change the diagram, call this again with the whole changed description, keeping the ids.\n\n" +
  "Arguments: type, title, nodes, edges, groups; their keys are in the schema.";

const HINTS =
  "Placement is optional: row and col (1, 2, …) put a node or group in that cell of its group's grid, rows from the " +
  "top; nodes sharing a row without col stand side by side as written. Use them when you know where things belong " +
  "(tiers, a database under its service); otherwise the server arranges by the connections.";

// The firm version: the model places every node on one coarse grid for the
// whole diagram, as it does when it writes XML, and the server sizes the
// cells, draws the frames and routes the lines. Measured against the
// optional hints in bench/.
const HINTS_ASKED =
  "Placement: give every node row and col (1, 2, …), its cell in one grid for the whole diagram, as if you placed " +
  "the shapes yourself; about 5 cols × 6 rows show well. Keep a group's nodes in a block of cells of their own: " +
  "the server draws the frame around it. A lane is a row (or a column) of that grid, col (or row) the step.";

const TYPES =
{
  er:
    "type \"er\" (database schemas): every node is a table {id, label, fields}, fields one string per column, the key first: " +
    "\"PK book_id\", \"FK author_id\", \"PK, FK book_id\", \"title\", optionally with a type (\"price: decimal\"). " +
    "Every edge is a relation {from, to, kind}: kind \"one-to-many\" from the referenced table to the table holding the " +
    "foreign key, \"one-to-one\" or \"many-to-many\". fromCard / toCard (\"1\", \"0..1\", \"1..*\", \"0..*\") set other " +
    "multiplicities; fromField / toField name the columns when a foreign key's name doesn't say which table it " +
    "references. Relations show their multiplicities, not labels; add a junction table for many-to-many with attributes.",
  architecture:
    "type \"architecture\" (systems, cloud, networks): nodes are components with an icon (\"aws lambda\", " +
    "\"azure sql database\", \"gcp bigquery\", \"kubernetes pod\") or a kind (service, database, queue, user, external); " +
    "groups are boundaries (\"aws vpc\", a subnet, a tier, a namespace), nested with parent; edges are calls or links " +
    "with a short label, kind \"async\" for events.",
  flowchart:
    "type \"flowchart\" (processes, with or without swimlanes): nodes are steps with a kind (start, end, step, decision, " +
    "error, data); for swimlanes, groups are the lanes in order and each node names its lane in group; edges are " +
    "transitions, labeled on the branches of a decision (\"Yes\", \"No\"). End every path at an end node."
};

// A type that is drawn by the layout of another one is described there.
const DESCRIBED_BY = { network: "architecture", swimlane: "flowchart" };

/**
 * @param {string[]} types - the types to offer, in this order
 * @param {{hints?: boolean|"ask"}} [options] - hints: false leaves out the
 *   placement hints, "ask" asks for a cell for every node, in one grid for
 *   the whole diagram
 * @returns {string}
 */
export function describeTool(types, options)
{
  const parts = [INTRO];
  const done = new Set();
  let placed = false;

  for (const t of types)
  {
    const key = DESCRIBED_BY[t] || t;

    if (TYPES[key] != null && !done.has(key))
    {
      done.add(key);
      parts.push(TYPES[key]);
      placed = placed || key !== "er";
    }
  }

  if (placed && !(options != null && options.hints === false))
  {
    parts.push(options != null && options.hints === "ask" ? HINTS_ASKED : HINTS);
  }

  return parts.join("\n\n");
}

/**
 * The tool's input schema (JSON Schema): the keys of the description with
 * what each one means.
 *
 * @param {string[]} types - the types to offer
 * @param {{hints?: boolean|"ask"}} [options]
 * @returns {object}
 */
export function describeSchema(types, options)
{
  const hints = !(options != null && options.hints === false);
  const offered = new Set(types.map(function(t) { return DESCRIBED_BY[t] || t; }));
  const has = function(t) { return offered.has(t); };
  const placed = has("architecture") || has("flowchart");
  const node =
  {
    id: { type: "string", description: "Unique, kept when the diagram is changed" },
    label: { type: "string", description: "The name shown, 1 to 5 words" }
  };
  const group =
  {
    id: { type: "string" },
    label: { type: "string" }
  };
  const edge =
  {
    from: { type: "string", description: "id of a node" + (placed ? " or group" : "") },
    to: { type: "string", description: "id of a node" + (placed ? " or group" : "") }
  };

  if (has("er"))
  {
    node.fields = { type: "array", items: { type: "string" }, description: "er: one string per column, the key first (\"PK id\", \"FK author_id\", \"title\")" };
    edge.fromCard = { type: "string", description: "er: multiplicity at from (\"1\", \"0..1\", \"1..*\", \"0..*\")" };
    edge.toCard = { type: "string", description: "er: multiplicity at to" };
    edge.fromField = { type: "string", description: "er: the column at from, when its name doesn't say it" };
    edge.toField = { type: "string", description: "er: the column at to" };
  }

  if (placed)
  {
    node.kind = { type: "string", description: [has("flowchart") ? "flowchart: start, end, step, decision, error, data" : null,
      has("architecture") ? "architecture: service, database, queue, user, external" : null].filter(Boolean).join("; ") };
    node.group = { type: "string", description: "id of the group or lane the node is in" };
    node.sub = { type: "string", description: "Optional second line in small text (a technology, an address)" };
    group.parent = { type: "string", description: "id of the group this one is nested in" };
    edge.label = { type: "string", description: "1 to 3 words" };
  }

  if (has("architecture"))
  {
    node.icon = { type: "string", description: "architecture: \"<aws|azure|gcp|kubernetes> <service>\", e.g. \"aws lambda\"" };
    group.icon = { type: "string", description: "architecture: an official boundary, e.g. \"aws vpc\", \"aws private subnet\", \"aws region\"" };
  }

  edge.kind = { type: "string", description: [has("er") ? "er: one-to-many, one-to-one, many-to-many" : null,
    has("architecture") ? "architecture: async for events and messages" : null].filter(Boolean).join("; ") };

  if (placed && hints && options != null && options.hints === "ask")
  {
    const lanes = has("flowchart");

    node.row = { type: "integer", description: "The row of the node's cell (1 is the top) in one grid for the whole diagram, " +
      "not per group. More than 6 rows are cut off in the chat: put things side by side instead" +
      (lanes ? ". With lanes as rows, every lane has a row to itself (two when its steps branch)" : "") };
    node.col = { type: "integer", description: "The column of the node's cell (1 is the left) in that grid; more than 5 or 6 " +
      "columns get small. The nodes of a group form a block of cells with no other node in it, nested groups a block in " +
      "their parent's" + (lanes ? ". With lanes as rows, col is the step of the flow over all lanes: a step that hands " +
        "over to another lane can keep the col of the step before it, straight below or above" : "") };
  }
  else if (placed && hints)
  {
    const lanes = has("flowchart");
    const row = { type: "integer", description: "Optional placement: the row in the grid of its group (1 is the top)" +
      (lanes ? ". In a lane: the line within the lane, 1 unless two of its steps share a col" : "") };
    const col = { type: "integer", description: "Optional placement: the column in that grid (1 is the left)" +
      (lanes ? ". In a lane: the step along the flow, counted over all lanes, so the next step takes the next col " +
        "whatever its lane, and both branches of a decision the col after it" : "") };

    node.row = row;
    node.col = col;
    group.row = row;
    group.col = col;
  }

  const properties =
  {
    type: { type: "string", enum: types.slice() },
    title: { type: "string" },
    nodes: { type: "array", items: { type: "object", properties: node, required: ["id"] } },
    edges: { type: "array", items: { type: "object", properties: edge, required: ["from", "to"] } }
  };

  // No direction: the layout picks the one that is shown largest in the
  // chat frame, and models that are offered the key set it without need.
  if (placed)
  {
    properties.groups = { type: "array", items: { type: "object", properties: group, required: ["id"] } };
  }

  return { type: "object", properties: properties, required: ["type", "nodes"] };
}
