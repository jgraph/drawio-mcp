# Mermaid Reference

Short hints for generating Mermaid diagrams that render correctly in draw.io. draw.io's Mermaid parser covers 28 diagram types — the header keyword on the first non-directive line selects the type.

_Canonical list & dialog/ELK docs: <https://github.com/jgraph/drawio/discussions/5643>._

## General rules

- **Pick the type keyword carefully.** `graph`/`flowchart`, `classDiagram`, `stateDiagram-v2`, `erDiagram`, `sequenceDiagram`, `gitGraph`, `journey`, `pie`, `gantt`, `mindmap`, `timeline`, `quadrantChart`, `requirementDiagram`, `sankey-beta`, `xychart-beta`, `block-beta`, `c4Context`/`C4Container`/`C4Component`, `architecture-beta`, `radar-beta`, `packet-beta`, `venn-beta`, `treemap-beta`, `treeView-beta`, `ishikawa-beta`, `kanban`, `zenuml`, `wardley-beta`, `eventmodeling`. Misspelling the header yields a blank diagram.
- **No trailing punctuation on node IDs.** IDs are identifiers (`myNode`, `node_1`, `A`) — spaces, hyphens (in some contexts), and reserved words (`end`, `class`, `subgraph`) break the parse. Put display text in brackets or quotes instead: `A["User's Account"]`.
- **One statement per line.** Separate statements with newlines; `;` works as a delimiter in flowchart but not everywhere.
- **Quote labels with special characters** (`:`, `-`, parentheses, non-ASCII). Use `"` not `'`.
- **HTML in labels:** only `<br>`, `<b>`, `<i>`, `<u>` are reliable across types. Use `#` for hex colors in styles, never `rgb()`.
- **Diagrams can take a title block** for some types:
  ```
  ---
  title: My Diagram
  ---
  flowchart TD
  ```
- **Match the language of labels to the user's language** — if the user writes in German, French, etc., the diagram labels should be in that language too.

## Flowchart (most common)

```
flowchart TD
  A[Start] --> B{Decision?}
  B -->|Yes| C[Do thing]
  B -->|No| D[Skip]
  C --> E((End))
  D --> E
```

- **Direction:** `TD`/`TB` (top-down), `BT`, `LR`, `RL`.
- **Node shapes by bracket:** `[rect]`, `(rounded)`, `([stadium])`, `[[subroutine]]`, `[(cylinder)]`, `((circle))`, `{rhombus}`, `{{hexagon}}`, `[/parallelogram/]`, `[\parallelogram alt\]`, `[/trapezoid\]`, `>asymmetric]`.
- **Edges:** `-->` arrow, `---` no arrow, `-.->` dotted, `==>` thick, `<-->` bidirectional. Inline label: `A -- text --> B` or `A -->|text| B`.
- **Subgraphs:**
  ```
  subgraph Frontend
    A --> B
  end
  ```

### Layout for complex flowcharts

draw.io's Mermaid parser lays flowcharts out itself, but the result gets cramped or unbalanced once the diagram has any structural complexity. Switch that flowchart to the **ELK layered layout** (the same engine as draw.io's *Arrange ▸ Layout ▸ Vertical/Horizontal Flow*) when ANY of these holds:

- ≥ ~20 nodes, OR
- ≥ 3 decision diamonds (`{...}`), OR
- any feedback/back-edge (an edge pointing back to an earlier node — an error path looping to a retry), OR
- ≥ 3 distinct endpoints.

Two ways to ask for it, depending on the tool:

- **A `postLayout: "elk"` field** on the call, if the tool offers one — use it.
- **Otherwise select it in the source**, as a YAML frontmatter block at the very top. draw.io honors it wherever it converts Mermaid (editor, opened link, desktop CLI):
  ```
  ---
  config:
    layout: elk
  ---
  flowchart TD
    A[Start] --> B{Retry?}
  ```
  Combines with a `title:` — both are keys of the same frontmatter block.

The flow direction always follows the flowchart code (`TD`/`TB` vs `LR`/`RL`). **Flowcharts only** — sequence, class, ER, gantt and the rest lay themselves out and ignore the setting. Simple flowcharts (linear chains, < 20 nodes, no branching or back-edges) don't need it either.

### Styling & colors

**Color by role.** Unstyled flowcharts and state diagrams come out in Mermaid's default lavender. Give each kind of node one color with `classDef`, from draw.io's palette (fill/stroke): blue `#dae8fc`/`#6c8ebf` for main steps, green `#d5e8d4`/`#82b366` for success and outputs, yellow `#fff2cc`/`#d6b656` for decisions, orange `#ffe6cc`/`#d79b00` for external systems and waiting, red `#f8cecc`/`#b85450` for errors and cancellation, purple `#e1d5e7`/`#9673a6` for special steps. The same color for the same kind of node, and few colors: two to four roles read better than a rainbow.

Three ways — pick one, don't mix for the same node:

**1. Inline per-node (`style`):**
```
flowchart LR
  A[Start] --> B[End]
  style A fill:#d5e8d4,stroke:#82b366,stroke-width:2px
  style B fill:#f8cecc,stroke:#b85450,stroke-dasharray:5 5
```

**2. Reusable classes (`classDef` + `:::`):**
```
flowchart LR
  A:::step --> B{OK?}:::decision
  classDef step fill:#dae8fc,stroke:#6c8ebf
  classDef decision fill:#fff2cc,stroke:#d6b656
```
Or apply to many: `class A,B,C step`.

**3. Link styling (edges):**
```
linkStyle 0 stroke:#b85450,stroke-width:2px
linkStyle default stroke:#666
```
`0` = first edge in order defined; `default` targets unstyled edges.

Style properties that work: `fill`, `stroke`, `stroke-width`, `stroke-dasharray`, `color` (font color).

## Sequence diagram

```
sequenceDiagram
  participant U as User
  participant S as Server
  U->>S: Request
  S-->>U: Response
  Note right of S: Logged
```

- **Arrows:** `->` (no head), `->>` (arrow), `-->>` (dashed), `-x` (X end), `--x` (dashed X).
- **Activate/deactivate:** `activate S` / `deactivate S` or `S->>+S2: call` / `S2-->>-S: return`.
- **Blocks:** `alt/else/end`, `opt/end`, `loop/end`, `par/and/end`, `critical/option/end`.
- **Notes:** `Note left of A`, `Note over A,B: text`.
- Optional `autonumber` after header numbers the messages.

## Class diagram

```
classDiagram
  class Animal {
    +String name
    +int age
    +eat() void
  }
  class Dog
  Animal <|-- Dog : inherits
  Dog "1" --> "*" Bone : has
```

- **Relations:** `<|--` inherit, `*--` composition, `o--` aggregation, `-->` association, `..>` dependency, `..|>` realize, `<-->` bidirectional.
- **Visibility:** `+` public, `-` private, `#` protected, `~` package.
- **Annotations:** `<<interface>>`, `<<abstract>>`, `<<enumeration>>` inside the class block or via `Animal <<interface>>`.
- **Cardinality:** quoted strings flanking the arrow (`"1"`, `"0..*"`, `"*"`).

## State diagram

```
stateDiagram-v2
  [*] --> Idle
  Idle --> Running : start
  Running --> Idle : stop
  Running --> [*]
  state Running {
    [*] --> Working
    Working --> Waiting : block
    Waiting --> Working : unblock
  }
```

- Use `stateDiagram-v2`, not `stateDiagram` (v1 is legacy).
- `[*]` = start (source) or end (target) depending on direction.
- `state X { ... }` nests a compound state; `state fork1 <<fork>>`, `<<join>>`, `<<choice>>` mark junction nodes.
- Transition labels: `A --> B : event [guard] / action`.

## ER diagram

```
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : contains
  CUSTOMER {
    string name
    string email PK
  }
```

- **Cardinality symbols:** `|o` zero-or-one, `||` exactly-one, `}o` zero-or-many, `}|` one-or-many. Mirror on both sides (e.g., `||--o{`).
- Attribute blocks list `type name [PK|FK|UK]` plus optional comment in quotes.
- Entity names are typically UPPERCASE by convention.

## Journey

```
journey
  title Morning routine
  section Wake up
    Coffee: 5: Me
    Read news: 3: Me
  section Commute
    Drive: 2: Me, Traffic
```

Each task: `Name: score(1-5): Actor[, Actor...]`. Section headers group tasks.

## Pie

```
pie showData title Browser share
  "Chrome" : 60
  "Firefox" : 20
  "Safari" : 20
```

`showData` is optional (renders the numbers). Quotes on labels, colon, numeric value.

## Gantt

```
gantt
  title Project timeline
  dateFormat YYYY-MM-DD
  section Phase 1
  Design : a1, 2025-01-01, 7d
  Build  : after a1, 14d
  section Phase 2
  Test   : 2025-01-25, 5d
```

- `dateFormat` is mandatory.
- Task line: `Name : [id,] [after id | YYYY-MM-DD], duration[d/w]`.
- Status tags: `done`, `active`, `crit` before the id (`crit a1`).

## Gitgraph

```
gitGraph
  commit
  branch develop
  checkout develop
  commit
  commit
  checkout main
  merge develop
```

Commands: `commit [id: "x"] [tag: "v1"]`, `branch name`, `checkout name`, `merge name`, `cherry-pick id: "x"`.

## Mindmap

```
mindmap
  root((Project))
    Frontend
      React
      CSS
    Backend
      Node
      DB
```

- Indentation (2-space increments) defines hierarchy.
- Root shape: `((circle))`, `[rect]`, `(rounded)`, `))cloud((`, `)hexagon(`, `{{hexagon}}`.
- No edges — they are implied by nesting.

## Timeline

```
timeline
  title Company history
  section 2020s
    2021 : Founded
    2022 : Series A
         : Launched product
  section 2030s
    2030 : IPO
```

Colon separates year/label; multiple `:` lines under one year add sub-events.

## Quadrant chart

```
quadrantChart
  title Reach vs Engagement
  x-axis Low --> High
  y-axis Low --> High
  quadrant-1 Stars
  quadrant-2 Question Marks
  quadrant-3 Dogs
  quadrant-4 Cash Cows
  Campaign A: [0.3, 0.6]
  Campaign B: [0.75, 0.85]
```

Point coords are `[0..1, 0..1]`.

## Requirement diagram

```
requirementDiagram
  requirement req1 {
    id: "1"
    text: "The system shall..."
    risk: high
    verifymethod: test
  }
  element user_story {
    type: "story"
  }
  user_story - satisfies -> req1
```

Requirement types: `requirement`, `functionalRequirement`, `performanceRequirement`, `interfaceRequirement`, `physicalRequirement`, `designConstraint`. Relations: `contains`, `copies`, `derives`, `satisfies`, `verifies`, `refines`, `traces`.

## Sankey

```
sankey-beta
Source,Intermediate,10
Source,Direct,5
Intermediate,Sink,10
```

CSV-style: `source,target,value`. No header. No `title` (use frontmatter).

## XY chart

```
xychart-beta
  title "Revenue"
  x-axis [jan, feb, mar, apr]
  y-axis "USD" 0 --> 10000
  bar [2500, 5000, 7500, 9000]
  line [3000, 4500, 6500, 8500]
```

`bar [...]` and `line [...]` can stack; order matters (later overlays earlier).

## Block

```
block-beta
  columns 3
  A B C
  D["Wide"]:2 E
  A --> D
```

`columns N` sets grid width. `Name:N` spans N columns. Edges use flowchart arrow syntax.

## C4

```
C4Context
  Person(user, "User")
  System(app, "App", "Does things")
  Rel(user, app, "Uses")
```

- Variants: `C4Context`, `C4Container`, `C4Component`, `C4Dynamic`, `C4Deployment`.
- Element helpers: `Person`, `System`, `System_Ext`, `Container`, `ComponentDb`, `Boundary(id, "label", "type")`, etc. Arguments are positional: `(id, label, [type/tech], [description])`.
- `UpdateElementStyle(tag, $bgColor="#…")` and `AddElementTag` tweak appearance.

## Architecture

```
architecture-beta
  group cloud(cloud)[Cloud]
  service api(server)[API] in cloud
  service db(database)[DB] in cloud
  api:R --> L:db
```

- Built-in icons: `cloud`, `server`, `database`, `disk`, `internet`. Suffix edge ends with `:T`, `:B`, `:L`, `:R` to pick the side.
- `group id(icon)[Label]` then `in groupId` on services places nodes.

## Radar

```
radar-beta
  title Skills
  axis js["JS"], py["Python"], go["Go"]
  curve alice["Alice"]{80, 60, 70}
  curve bob["Bob"]{50, 90, 65}
```

Axes and curves are positionally aligned — list values in axis order, 0–100.

## Packet

```
packet-beta
  0-15: "Source Port"
  16-31: "Dest Port"
  32-63: "Seq Number"
```

`start-end` (bit ranges) or single-bit `N`. Use a title frontmatter.

## Venn

```
venn-beta
  set A ["Set A"]
  set B ["Set B"]
  union A,B
  text A ["only A"]
  text A,B ["shared"]
```

Define every `union` combination whose region you plan to label. `text A,B [...]` places text in intersections.

## Treemap

```
treemap-beta
"Category"
    "Leaf 1": 40
    "Leaf 2": 60
```

Numbers are values (area-weighted). Indent (2+ spaces) for hierarchy.

## Tree view

```
treeView-beta
  "Root"
    "Child 1"
      "Grandchild"
    "Child 2"
```

Pure indentation hierarchy, no numbers.

## Ishikawa (fishbone)

```
ishikawa-beta
  Main Problem
    Category
      Cause
      Sub-cause
    Another Category
      Cause
```

First line after header is the problem; top-level indents are categories (Materials, Methods, Machinery, etc. — use whatever makes sense).

## Kanban

```
kanban
  todo[To Do]
    task1[Write spec]@{ assigned: "Alice", priority: "High" }
  doing[In progress]
    task2[Build feature]
  done[Done]
```

Columns are `id[Label]` at indent 0; cards are `id[Label]@{ metadata }` inside. Metadata keys: `assigned`, `priority` (`Very Low`/`Low`/`Medium`/`High`/`Very High`), `ticket`.

## ZenUML

```
zenuml
  @Actor User
  @Boundary Web
  @Control Service
  User -> Web: request
  Web -> Service: process()
  Service -> Web: result
```

Participant roles: `@Actor`, `@Boundary`, `@Control`, `@Entity`, `@Database`. Messages use `->` with a colon-separated label. Supports `if/else`, `while`, `par` blocks like sequence diagrams.

## Wardley map

```
wardley-beta
  title Tea Shop
  anchor Business [0.95, 0.63]
  component Cup of Tea [0.79, 0.61]
  component Kettle [0.43, 0.35] (inertia)
  Business -> Cup of Tea
  Cup of Tea -> Kettle
  evolve Kettle 0.62
```

- Header `wardley` or `wardley-beta`; `title` optional.
- `anchor`/`component Name [visibility, evolution]` — coords are `[0..1, 0..1]` (y = value-chain visibility, x = evolution from Genesis to Commodity).
- Component evolution markers in parens: `(inertia)`, `(build)`, `(buy)`, `(outsource)`, `(market)`.
- Links: `A -> B` dependency, `A +> B` flow. `evolve Name <x>` adds an evolution target; `evolution Genesis -> Custom -> Product -> Commodity` relabels the x-axis stages.
- Extras: `note "text" [x,y]`, `annotation N,[x,y] "text"`, `accelerator`/`deaccelerator "text" [x,y]`.

## Event Modeling

```
eventmodeling
  tf 01 ui CartUI
  tf 02 cmd AddItem
  tf 03 evt ItemAdded
  tf 04 rmo Cart
```

- Each `tf <id> <type> <Name>` is a time-frame (column). Types: `ui` / `pcr` (processor), `cmd` / `command`, `rmo` / `readmodel`, `evt` / `event` — placed on the UI/Automation, Command/Read-Model, and Events swimlanes.
- Wire frames with `->>`: `tf 04 evt ItemChanged ->> 02 ->> 03` links frame 04 back to 02 and 03.
- `Namespace.Name` groups frames into slices (e.g. `Order.ChangeOrder`).
- `data <id> { ... }` blocks attach payloads, referenced inline with `[[id]]`: `tf 02 cmd AddItem [[AddItem01]]`.

## When to prefer XML over Mermaid

- Precise positions / custom coordinates.
- draw.io-native shapes (AWS, Azure, GCP, P&ID, Cisco, electrical).
- Mixed shape libraries or complex multi-layer diagrams.
- Anything that needs exact colors per element with many variations — Mermaid's styling works but at scale XML is easier to reason about.

Default to Mermaid for the standard types above; reach for XML only when Mermaid's syntax clearly can't express what's needed.
