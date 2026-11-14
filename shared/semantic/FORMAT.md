# Semantic diagram format

A semantic diagram says what a diagram contains and how it connects. It never gives coordinates, sizes or styles: the engine in this folder sizes and places every shape, routes every line and styles everything in draw.io's calm colors, the same way every time for the same description. At most it says roughly where things go, as a row and a column (see **Placement hints**). The result is ordinary draw.io XML, so everything the format can't say can still be done in XML.

Status: `er`, `architecture`, `network`, `flowchart` and `swimlane` are implemented; none is offered to models yet. The other types below are the planned format; a description of a type the engine can't lay out yet is answered with an error that points to XML or Mermaid.

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
| `direction` | optional, `vertical` or `horizontal`, for the types that flow (flowchart, swimlane, state, architecture): where the top level runs. Read when given, but not offered in the tool's schema: without it the layout takes whichever is shown larger in the chat frame, and models that are offered the key set it without need |
| `groups` | optional: `{id, label, kind, icon, parent, row, col}`. A lane, a VPC, a subnet, a tier, a package. `parent` nests a group in another. `lanes` is read as groups of kind `lane` |
| `nodes` | `{id, label, kind, role, icon, group, sub, fields, methods, row, col}`, the keys a type uses |
| `edges` | `{from, to, kind, label, fromCard, toCard, fromField, toField}`, the keys a type uses |

Every id is a string, unique across nodes and groups, and stays the same when the diagram is changed, so a changed description changes the same cells. A missing label is the id.

### Leniency

The format forgives what models get wrong, as `create_diagram` does: a JSON string is parsed, `source` / `target` are read as `from` / `to`, the type and an edge's `kind` in any case (`One To Many`, `one_to_many`), and `fields` / `methods` as one string with `|` or line breaks between the rows. A field can also be an object (`{name, type, pk, fk}` or `{name, key: "PK"}`). What can't be used is dropped with a warning in the result, so the model learns it, and the rest is drawn: an edge to a node that doesn't exist, a second node with an id already taken, a node in a group that doesn't exist (drawn outside any group), an unknown key.

### Placement hints

`row` and `col` (1, 2, …) say roughly where a shape goes, rows from the top, columns from the left. Only the order of the values counts, so a free row or column takes no room. The engine still does everything that needs numbers: the size of every box from its text, column widths and row heights, the frames around groups, the gaps a labeled line needs, and the lines. The tool description either asks for the hints or offers them as optional, and the cells mean something different in each case:

- **Asked for** (`hints: "ask"`): every node names its cell in **one grid for the whole diagram**, the way a model places shapes when it writes XML; groups get none. A group's frame is drawn around the cells of its members, a nested one inside its parent's, and rows and columns hold across the frames, so a service in one subnet lines up with its database in the next. A node left in the block of a group it isn't in (a queue in the corner of an L-shaped VPC) moves out by the shortest way, into a row or column of its own. In a flowchart with lanes, every lane is a band of rows (or of columns) it has to itself and the other axis is the step of the flow, shared by all lanes, so a hand-over stays straight; the engine turns the rows into columns, or back, when the chat shows clearly more of the diagram that way. Cells that can't be drawn as one grid (a node without a cell, lanes that share rows and columns) are read as below.
- **Optional** (`hints: true`): `row` and `col` on a node or a group place it in the grid of the group it is in (the diagram's own grid at the top level). Nodes of one row without `col` stand side by side in the order written; a node without either goes below the hinted ones; a level without any hint is arranged by its connections. In a flowchart with lanes, `col` is the step along the flow, counted over all lanes, and `row` the line within the lane.

A model knows where things belong (clients above services above data, a database under its service, the main path down the first column) far faster than it can write coordinates, and a layout algorithm doesn't know it at all. Whether hints are offered as optional, asked for or left out is a choice of the tool description (`describeTool(types, {hints})`, with the same value for `semanticToXml`); `bench/` measures the three against each other.

### Roles

`role` sets a node's color from the calm theme, by what it is: `step` (the default), `decision`, `start`, `end`, `success`, `error`, `retry`, `data`, `external`, `note`, `container`. Types set roles themselves where the type says it (a decision in a flowchart, a junction table in a schema), so `role` is only needed to override.

### Icons

`icon` names an icon instead of giving its style: `"aws lambda"`, `"azure sql database"`, `"kubernetes pod"`, `"postgresql"`, `"user"`. The engine finds it in draw.io's shape index and the draw.io icon service (the search behind `search_shapes`) and draws the node as that icon with the label below. A name it can't resolve becomes a plain box with the label and a warning.

## Types

### `er`: database schemas (implemented)

- A node is a table: `label` is its name, `fields` one string per column, the key first: `"PK book_id"`, `"FK author_id"`, `"PK, FK book_id"`, `"title"`, optionally with a type (`"price: decimal"`, `"price DECIMAL"`). Keys behind the name (`"book_id INT PK"`, `"book_id (PK)"`) are read too, and `"FK author_id -> authors"` names the referenced table.
- An edge is a relation: `kind` `one-to-many` from the referenced table to the table holding the foreign key, `one-to-one` or `many-to-many`. `fromCard` / `toCard` (`1`, `0..1`, `1..*`, `0..*`, `*`, also `one`, `many`, `zero or one`, …) set other multiplicities and override `kind`. The direction of a relation is read from its multiplicities, or from which table holds the foreign key, so `{from: "books", to: "authors", kind: "many-to-one"}` draws the same line.
- The line runs from the foreign-key row to the primary-key row of the referenced table. The engine finds the row by name (`author_id` for `authors`, also `writer_author_id`, a field naming the table) and uses another row for a second reference to the same table (`sender_id`, `recipient_id`). `fromField` / `toField` name the rows when the names don't say it. A reference of a table to itself runs from its key to the foreign-key row.
- Relations carry crow's-foot markers and no labels. A many-to-many relation without a junction table runs key to key; a table whose columns are all keys (a junction table) is drawn in the data color.
- Layout: up to 16 tables on a grid of two to four columns, the most connected table in the middle and related tables next to each other, every relation in its own track between the columns, in the order with the fewest crossings. Larger schemas are laid out by ELK's layered algorithm when the host passes an ELK instance (the referenced table left of the tables that reference it).

### `class`: UML class diagrams (planned)

- A node is a class: `label` its name, `fields` the attributes (`"+ title: String"`), `methods` the operations (`"+ checkOut(): Loan"`), `kind` `class`, `interface`, `abstract`, `enum`. A `group` is a package.
- An edge is `inheritance`, `implementation`, `association`, `aggregation`, `composition` or `dependency`, from the subclass, implementer or owner; `fromCard` / `toCard` and `label` on associations.
- Layout: a grid by inheritance tree, parents above children, as shared/chat-view-xml.md lays out class diagrams; inheritance lines join into one trunk per parent.

### `flowchart` and `swimlane`: processes and decisions (implemented, measured in `bench/`, not offered yet)

- A node is a step: `kind` `start`, `end`, `step`, `decision`, `error`, `data`, `external`, `retry`, `note` (and what models write for them: `task`, `gateway`, `failure`, …); the kind sets the shape and the role.
- An edge is a transition with an optional `label`; `Yes` / `No` on the branches of a decision color the label.
- A `group` is a lane (a role, a team, a system) and every node names its lane in `group`; `swimlane` is the same type under another name. Lanes take light tints in turn.
- Layout without hints: the main path (at every step the successor with the longest way to go) runs along one line, a branch starts beside the step it leaves, a link that closes a loop is kept out of the ranking. A flow that is longer than the chat frame continues at the start of the next column. Lanes share one grid: a hand-over to another lane stays in the same row, and the lanes are columns or rows, whichever is shown larger.

### `architecture` and `network`: systems, cloud and networks (implemented, measured in `bench/`, not offered yet)

- A node is a component with an `icon` (`"aws lambda"`, `"azure sql database"`, `"gcp bigquery"`, `"kubernetes pod"`: the names of `shared/icon-resolver.js`) or a `kind` (`service`, `database`, `queue`, `user`, `external`); `sub` is a second line (an instance type, an address). A name the resolver doesn't know becomes a box by kind, with a warning. A `user` is drawn as a person only when its label names people.
- A `group` is a boundary, nested with `parent`; with an `icon` (`"aws vpc"`, `"aws private subnet"`, `"aws region"`) it takes the official group style, otherwise a pale titled frame.
- An edge may name a group as an end, and then means every member of it (a gateway that routes to every service, a bus all of them publish to). Where the members stand in one row or column of the grid and the other end in the next one, it is drawn to each of them as one tree with the label once; otherwise, and for the third connection of a group and for the same connection with several groups (logs from everything), as one line to the frame. Between a group and something inside it there is no line to draw: it becomes a line of text under the diagram (`logs: everything in VPC → CloudWatch`).
- An edge is a call or a link with an optional `label` (a protocol, a port); `kind` `async` (events, messages) is dashed. In a `network`, links are cables without arrowheads.
- Layout without hints: tiers by the connections (every node one rank after its deepest predecessor, the order in a rank by what it connects to), every rank centered, a chain of single components beside a frame folded into one rank. Which way each nesting level runs is tried as a whole (all down, all to the right, alternating) and the one that is shown largest in the chat frame wins.

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
