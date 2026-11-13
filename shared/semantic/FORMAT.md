# Semantic diagram format

A semantic diagram says what a diagram contains and how it connects. It never says where anything goes or how it looks: the engine in this folder places every shape, routes every line and styles everything in draw.io's calm colors, the same way every time for the same description. The result is ordinary draw.io XML, so everything the format can't say can still be done in XML.

Status: `er` is implemented. The other types below are the planned format; a description of a type the engine can't lay out yet is answered with an error that points to XML or Mermaid.

## The description

```json
{
  "type": "er",
  "title": "Library",
  "direction": "horizontal",
  "groups": [],
  "nodes": [
    { "id": "authors", "label": "Authors", "fields": ["PK author_id", "name"] },
    { "id": "books", "label": "Books", "fields": ["PK book_id", "FK author_id", "title"] }
  ],
  "edges": [
    { "from": "authors", "to": "books", "kind": "one-to-many" }
  ]
}
```

| Key | Meaning |
|---|---|
| `type` | `er`, `class`, `flowchart`, `swimlane`, `architecture`, `network`, `state`, `sequence`, `orgchart`, `mindmap`. Common other names are read too (`erd`, `database`, `uml`, `cloud`, `aws`, `org chart`, `mind map`, …) |
| `title` | optional, drawn above the diagram |
| `direction` | optional, `vertical` or `horizontal`, for the types that flow (flowchart, swimlane, state, architecture) |
| `groups` | optional: `{id, label, kind, parent}`. A lane, a VPC, a subnet, a tier, a package. `parent` nests a group in another |
| `nodes` | `{id, label, kind, role, icon, group, sub, fields, methods}`, the keys a type uses |
| `edges` | `{from, to, kind, label, fromCard, toCard, fromField, toField}`, the keys a type uses |

Every id is a string, unique across nodes and groups, and stays the same when the diagram is changed, so a changed description changes the same cells. A missing label is the id.

### Leniency

The format forgives what models get wrong, as `create_diagram` does: a JSON string is parsed, `source` / `target` are read as `from` / `to`, the type and an edge's `kind` in any case (`One To Many`, `one_to_many`), and `fields` / `methods` as one string with `|` or line breaks between the rows. A field can also be an object (`{name, type, pk, fk}` or `{name, key: "PK"}`). What can't be used is dropped with a warning in the result, so the model learns it, and the rest is drawn: an edge to a node that doesn't exist, a second node with an id already taken, a node in a group that doesn't exist (drawn outside any group), an unknown key.

### Roles

`role` sets a node's color from the calm theme, by what it is: `step` (the default), `decision`, `start`, `end`, `success`, `error`, `retry`, `data`, `external`, `note`, `container`. Types set roles themselves where the type says it (a decision in a flowchart, a junction table in a schema), so `role` is only needed to override.

### Icons

`icon` names an icon instead of giving its style: `"aws lambda"`, `"azure sql database"`, `"kubernetes pod"`, `"postgresql"`, `"user"`. The engine finds it in draw.io's shape index and the draw.io icon service (the search behind `search_shapes`) and draws the node as that icon with the label below. A name it can't resolve becomes a plain box with the label and a warning.

## Types

### `er`: database schemas (implemented)

- A node is a table: `label` is its name, `fields` one string per column, the key first: `"PK book_id"`, `"FK author_id"`, `"PK, FK book_id"`, `"title"`, optionally with a type (`"price: decimal"`, `"price DECIMAL"`). Keys behind the name (`"book_id INT PK"`, `"book_id (PK)"`) are read too, and `"FK author_id -> authors"`, `"FK owner (person)"` and `"buyer (customers.id)"` name the referenced table. Any other word in parentheses is a type or a note (`"status (enum)"`), and a referenced table that isn't in the schema is ignored.
- An edge is a relation: `kind` `one-to-many` from the referenced table to the table holding the foreign key, `one-to-one` or `many-to-many`. `fromCard` / `toCard` (`1`, `0..1`, `1..*`, `0..*`, `*`, also `one`, `many`, `zero or one`, `one and only one`, `(1,n)`, …) set other multiplicities and override `kind`; one that can't be read is ignored with a warning. The direction of a relation is read from its multiplicities, or else from which table holds the foreign key: the row `fromField` / `toField` names (a foreign key or another column holds it, a primary key is referenced), then the rows' names. So `{from: "books", to: "authors", kind: "many-to-one"}` draws the same line, and so does `{from: "orders", to: "customers", fromField: "buyer"}` for an order's buyer.
- The line runs from the foreign-key row to the primary-key row of the referenced table. The engine finds the row by name (`author_id` for `authors`, also `writer_author_id`, a field naming the table) and uses another row for a second reference to the same table (`sender_id`, `recipient_id`). `fromField` / `toField` name the rows when the names don't say it. A reference of a table to itself runs from its key to the foreign-key row, also when that row doesn't name the table (`parent_id`, `manager_id`: the first foreign key that doesn't name another table).
- Relations carry crow's-foot markers and no labels. A many-to-many relation without a junction table runs key to key; a table whose columns are all keys (a junction table) is drawn in the data color.
- Layout: up to 16 tables on a grid of two to four columns, the most connected table in the middle and related tables next to each other, every relation in its own track between the columns, in the order with the fewest crossings. Larger schemas are laid out by ELK's layered algorithm when the host passes an ELK instance (the referenced table left of the tables that reference it).

### `class`: UML class diagrams (planned)

- A node is a class: `label` its name, `fields` the attributes (`"+ title: String"`), `methods` the operations (`"+ checkOut(): Loan"`), `kind` `class`, `interface`, `abstract`, `enum`. A `group` is a package.
- An edge is `inheritance`, `implementation`, `association`, `aggregation`, `composition` or `dependency`, from the subclass, implementer or owner; `fromCard` / `toCard` and `label` on associations.
- Layout: a grid by inheritance tree, parents above children, as shared/chat-view-xml.md lays out class diagrams; inheritance lines join into one trunk per parent.

### `flowchart`: processes and decisions (planned)

- A node is a step: `kind` `start`, `end`, `step`, `decision`, `io`, `data`, `subprocess`, `note`; the kind sets the shape and the role.
- An edge is a transition with an optional `label` (`yes` / `no` on decisions color the line).
- Layout: the main path in one column (or row for `horizontal`), branches beside it, loops back along the side. Today's choice for larger flowcharts, Mermaid with ELK, stays the fallback.

### `swimlane`: processes across roles (planned)

- A `group` with `kind` `lane` is a lane (a role, a team, a system); every node names its lane in `group`. Nodes and edges as in `flowchart`.
- Layout: lanes as rows (or columns for `vertical`), every step in its lane, steps in order of the flow across the lanes, so a hand-over is one short line between two lanes.

### `architecture` and `network`: systems, cloud and networks (planned)

- A node is a component with an `icon` (`"aws api gateway"`, `"cisco router"`) or a `kind` (`service`, `database`, `queue`, `user`, `external`); `sub` is a second line (an instance type, an address).
- A `group` is a boundary: `kind` `cloud`, `region`, `vpc`, `subnet`, `zone`, `tier`, `cluster`, `onprem`, nested with `parent`. Boundaries take the official group styles of the cloud's library.
- An edge is a call or a link with an optional `label` (a protocol, a port); `kind` `sync`, `async`, `data`, `network`.
- Layout: tiers left to right (users, edge, services, data), groups as frames around their nodes on a grid, lines between facing sides.

### `state`: state machines (planned)

- A node is a state, `kind` `initial`, `final`, `state`, `choice`; a `group` is a composite state.
- An edge is a transition with `label` (`event [guard] / action`).
- Layout: the main sequence in one direction, the way back on the other side, self-transitions as loops.

### `sequence`: interactions over time (planned)

- `participants` instead of nodes: `{id, label, kind}` with `kind` `actor`, `service`, `database`, `queue`, `external`.
- `messages` instead of edges: `{from, to, label, kind}` with `kind` `call`, `return`, `async`, `create`; in order.
- `fragments`: `{kind: "alt" | "opt" | "loop" | "par", label, from, to}` around a range of messages (by index).
- Layout: lifelines at equal distances, wide enough for the longest message between neighbours, messages one row each. Today's choice, Mermaid, stays the fallback.

### `orgchart`: hierarchies (planned)

- A node is a person or a unit: `label` the name, `sub` the title. An edge runs from the manager to the report; `kind` `dotted` for a dotted line.
- Layout: a tree top-down, the lowest level as a column when it would be wider than the frame.

### `mindmap`: ideas around a center (planned)

- A node is an idea, the first node the center; an edge runs from a parent to a child.
- Layout: the branches split to both sides of the center, each branch in its own color, curved lines.

## The result

The engine returns the diagram's draw.io XML, which goes back into the model's context like the XML of `create_diagram`: a change can be made by sending the whole changed description again (ids kept), or, for what the format can't say, by changing the XML and passing it to `create_diagram`. Warnings come with the result.

Cell ids follow the description: a node keeps its id, a table row is `table.field`, a relation `child-parent`, so the XML can be read and changed by the ids the model chose.
