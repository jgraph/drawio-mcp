# draw.io XML Reference

Detailed reference for styles, edge routing, containers, layers, tags, metadata, and dark mode. Consult this when generating draw.io XML diagrams.

## Reasoning budget (read this first)

Your job is to declare the **logical structure** of the diagram — what nodes exist, what edges connect them, what labels they carry, what lane/container groups them. draw.io's edge router and (when available) a post-layout pass handle routing and placement; you do **not** need to do layout math.

**Do NOT** in your reasoning:

- Do NOT debate the topic. The user asked for a flowchart / architecture / sequence / etc. — pick one concrete scenario on your first impulse and commit. Never write "Actually, let me think of something else…" or pitch alternatives.
- Do NOT debate flat-lanes vs nested-pools, horizontal vs vertical orientation, one vs multiple variations. Pick the first reasonable option (almost always: flat swimlanes, top-down or left-right based on what fits the content). Do not flip-flop.
- Do NOT compute x/y coordinates in prose. No "column spacings of 160px totaling 1840px width — that's too wide, let me tighten to 1700…" loops. Use the rigid grid below; do the arithmetic in your head and write the XML.
- Do NOT re-derive drawio mechanics (`horizontal=0`, `startSize=110`, nested-lane coordinates). Use the templates below as-is.
- Do NOT enumerate columns ("customer lane columns 0-10, web app 1-7"). Place a node, move on.
- Do NOT add `<Array as="points">` waypoints. Edges are routed automatically.
- Do NOT set `exitX` / `exitY` / `entryX` / `entryY` connection-point overrides unless you have specific geometric intent.
- Do NOT verify, re-check, or adjust coordinates after placing a node.
- Do NOT narrate "building the diagram / finalizing the XML / now let me…". Just emit XML.
- Do NOT write out lists of node positions as planning text. Emit them as `<mxCell>` elements directly.

**Do** in your reasoning:

- Identify the diagram type + actors/stages (1-2 short sentences).
- Identify any grouping (swimlanes? containers? none?).
- Go straight to XML.

**Rigid grid — use for every XML diagram:**

- Column x = `col_index * 180 + 40`  (col 0 = 40, col 1 = 220, col 2 = 400, …)
- Row y = `row_index * 120 + 40`     (row 0 = 40, row 1 = 160, row 2 = 280, …)
- Node size: rectangles `140×60`, diamonds `140×80`, circles `60×60`, documents `120×80`, cylinders `100×70`

Pick a `(col, row)` for each node. Don't think about centers, gaps, or overlap — ELK handles routing between rough positions. Slight misalignment is invisible in the result.

## General principles

- **Use proper draw.io shapes and connectors** — choose the semantically correct shape for each element (e.g., `shape=cylinder3` for databases and tanks, `rhombus` for decisions, `shape=mxgraph.pid2valves.*` for valves in P&IDs). draw.io has extensive shape libraries; prefer domain-appropriate shapes over generic rectangles.
- **Decide whether to search for shapes** — before generating a diagram, decide if it needs domain-specific shapes from draw.io's extended libraries. **Skip `search_shapes`** for standard diagram types that use basic geometric shapes: flowcharts, UML (class, sequence, state, activity), ERD, org charts, mind maps, Venn diagrams, timelines, wireframes, and any diagram using only rectangles, diamonds, circles, cylinders, and arrows. Also skip if the user explicitly asks to use basic/simple shapes or says not to search. **Use `search_shapes`** when the diagram requires industry-specific or branded icons: cloud architecture (AWS, Azure, GCP), network topology (Cisco, rack equipment), P&ID (valves, instruments, vessels), electrical/circuit diagrams, Kubernetes, BPMN with specific task types, or any domain where the user expects realistic/standardized symbols rather than labeled boxes.
- **Match the language of labels to the user's language** — if the user writes in German, French, Japanese, etc., all diagram labels, titles, and annotations should be in that same language.
- **Group related nodes, and surface a hub when edges converge** — put nodes that belong together inside a container or swimlane, and keep external actors (users, files, third-party systems) outside implementation containers. When many edges converge on one area or cross several groups, route them through a single hub/gateway node (a registry, broker, event log, …) instead of drawing every low-level dependency across the canvas — fewer crossings, clearer contract.
- **Encode secondary detail in node text, not edges** — draw an edge only when the relationship itself carries meaning; push incidental detail into the node label so the connector layer stays readable.

## Common styles

**Rounded rectangle:**
```xml
<mxCell id="2" value="Label" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
</mxCell>
```

**Diamond (decision):**
```xml
<mxCell id="3" value="Condition?" style="rhombus;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="100" y="200" width="120" height="80" as="geometry"/>
</mxCell>
```

**Arrow (edge):**
```xml
<mxCell id="4" value="" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" source="2" target="3" parent="1">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

**Labeled arrow:**
```xml
<mxCell id="5" value="Yes" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" source="3" target="6" parent="1">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

## Style properties

| Property | Values | Use for |
|----------|--------|---------|
| `rounded=1` | 0 or 1 | Rounded corners |
| `whiteSpace=wrap` | wrap | Text wrapping |
| `fillColor=#dae8fc` | Hex color | Background color |
| `strokeColor=#6c8ebf` | Hex color | Border color |
| `fontColor=#333333` | Hex color | Text color |
| `shape=cylinder3` | shape name | Database cylinders |
| `shape=mxgraph.flowchart.document` | shape name | Document shapes |
| `ellipse` | style keyword | Circles/ovals |
| `rhombus` | style keyword | Diamonds |
| `edgeStyle=orthogonalEdgeStyle` | style keyword | Right-angle connectors |
| `edgeStyle=elbowEdgeStyle` | style keyword | Elbow connectors |
| `dashed=1` | 0 or 1 | Dashed lines |
| `swimlane` | style keyword | Swimlane containers |
| `group` | style keyword | Invisible container (pointerEvents=0) |
| `container=1` | 0 or 1 | Enable container behavior on any shape |
| `pointerEvents=0` | 0 or 1 | Prevent container from capturing child connections |
| `html=1` | 0 or 1 | Enable HTML rendering in labels (required for `<b>`, `<br>`, `<font>`, etc.) |
| `shape=umlLifeline;perimeter=lifelinePerimeter;size=16` | shape | UML sequence diagram lifeline (size = header height) |

## HTML labels

**Always include `html=1` in the style** when the `value` attribute contains any HTML tags (`<b>`, `<br>`, `<font>`, `<i>`, `<u>`, `<hr>`, `<p>`, `<table>`, etc.). Without `html=1`, HTML tags are displayed as literal text instead of being rendered.

HTML in attribute values must be **XML-escaped**: `<` → `&lt;`, `>` → `&gt;`, `&` → `&amp;`, `"` → `&quot;`

```xml
<mxCell value="&lt;b&gt;Title&lt;/b&gt;&lt;br&gt;Description"
        style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
</mxCell>
```

**Line breaks:** Use `&#xa;` (works with both `html=1` and `html=0`) or `&lt;br&gt;` (requires `html=1`) for line breaks — never use `\n`, which renders as literal backslash-n text instead of a newline.

**Best practice:** Always include `html=1` in every cell style. This ensures labels render correctly whether they contain HTML or plain text — plain text is unaffected by the flag.

**Bold/italic/underline:** Use `fontStyle` in the style string when the entire label should be bold (`fontStyle=1`), italic (`fontStyle=2`), or underline (`fontStyle=4`). Values can be combined via bitwise OR (e.g., `fontStyle=3` = bold+italic). Use HTML tags (`<b>`, `<i>`, `<u>`) only when formatting part of the label (e.g., bold title with normal description). Never combine `fontStyle` with HTML tags for the same effect — this is redundant and causes visible raw tags if `html=1` is missing.

## Edges

**CRITICAL: Every edge `mxCell` must contain a `<mxGeometry relative="1" as="geometry" />` child element.** Self-closing edge cells (e.g. `<mxCell ... edge="1" ... />`) are invalid and will not render correctly. Always use the expanded form:
```xml
<mxCell id="e1" edge="1" parent="1" source="a" target="b" style="...">
  <mxGeometry relative="1" as="geometry" />
</mxCell>
```

**Edge routing is automatic.** After the diagram renders, the viewer runs an ELK edge-routing pass that pins vertices and recomputes bend points + connection points. You do **not** need to:
- Add `<mxPoint>` waypoints
- Set `exitX` / `exitY` / `entryX` / `entryY`
- Route around obstacles
- Worry about edge-vertex collisions or parallel edge spacing

Just declare `source` and `target` and let ELK do the routing. The ELK pass also reverts itself if it made routing worse — so your edges are at worst unchanged, never worse.

**What you still choose: the edge style.** The style determines the overall look (orthogonal angles, curves, straight lines) — ELK honors the style family when routing.

| Style | Syntax | Best for |
|-------|--------|---------|
| **Orthogonal** | `edgeStyle=orthogonalEdgeStyle` | Flowcharts, architecture, network diagrams, BPMN — any diagram with right-angle connectors |
| **Straight** | no `edgeStyle` | UML class/sequence diagrams, direct point-to-point connections. For sequence diagram messages use `endSize=6;startSize=6;` to keep arrowheads small |
| **Entity Relation** | `edgeStyle=entityRelationEdgeStyle` | ER diagrams — creates perpendicular stubs at both ends |
| **Curved** | `curved=1` | Mind maps, informal diagrams |
| **Elbow** | `edgeStyle=elbowEdgeStyle;elbow=vertical;` | Rarely needed — `orthogonalEdgeStyle` handles almost all cases; use this only for simple 1-bend linear flows |

**Use a consistent edge style within each diagram.** Pick one based on diagram type and apply it to all edges: ER → `entityRelationEdgeStyle`; UML class → straight; mind maps → curved; flowcharts/architecture/network → `orthogonalEdgeStyle`.

**Useful edge style attributes** that apply regardless of routing:
- `rounded=1` — rounded corners at bend points (recommended for orthogonal)
- `endArrow=classic` / `endArrow=none` — arrow heads
- `dashed=1` — dashed line
- `strokeColor=#...`, `strokeWidth=2` — color/width
- Edge labels: set `value` directly on the edge cell

**Keep edge labels short and meaningful** — one to three words (`Yes`, `async`, `reads`). Drop labels that merely restate an obvious action (`call`, `register`); move longer explanations into node text or a small legend node.

**Visual semantics — stay consistent, add a legend when mixing styles.** Within one diagram apply `dashed=1`, `strokeColor`, and `strokeWidth` consistently for one chosen meaning (e.g. dashed = optional / async / inferred relationship). Don't mix several dashed meanings without a small legend explaining them.

## Containers and groups

For architecture diagrams or any diagram with nested elements, use draw.io's proper parent-child containment — do **not** just place shapes on top of larger shapes.

### How containment works

Set `parent="containerId"` on child cells. Children use **relative coordinates** within the container.

### Container types

| Type | Style | When to use |
|------|-------|-------------|
| **Group** (invisible) | `group;` | No visual border needed, container has no connections. Includes `pointerEvents=0` so child connections are not captured |
| **Swimlane** (titled) | `swimlane;startSize=30;` | Container needs a visible title bar/header, or the container itself has connections |
| **Custom container** | Add `container=1;pointerEvents=0;` to any shape style | Any shape acting as a container without its own connections |

### Key rules

- **Edges to children inside containers naturally cross the container boundary** — this is correct and expected. Do not add extra waypoints or complex routing to avoid a parent container when connecting to shapes inside it.
- **Always add `pointerEvents=0;`** to container styles that should not capture connections being rewired between children
- Only omit `pointerEvents=0` when the container itself needs to be connectable — in that case, use `swimlane` style which handles this correctly (the client area is transparent for mouse events while the header remains connectable)
- Children must set `parent="containerId"` and use coordinates **relative to the container**

### Example: Architecture container with swimlane

```xml
<mxCell id="svc1" value="User Service" style="swimlane;startSize=30;fillColor=#dae8fc;strokeColor=#6c8ebf;html=1;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="300" height="200" as="geometry"/>
</mxCell>
<mxCell id="api1" value="REST API" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="svc1">
  <mxGeometry x="20" y="40" width="120" height="60" as="geometry"/>
</mxCell>
<mxCell id="db1" value="Database" style="shape=cylinder3;whiteSpace=wrap;html=1;" vertex="1" parent="svc1">
  <mxGeometry x="160" y="40" width="120" height="60" as="geometry"/>
</mxCell>
```

### Example: Invisible group container

```xml
<mxCell id="grp1" value="" style="group;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="300" height="200" as="geometry"/>
</mxCell>
<mxCell id="c1" value="Component A" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="grp1">
  <mxGeometry x="10" y="10" width="120" height="60" as="geometry"/>
</mxCell>
```

### Swimlanes for grouped actors (BPMN-style flowcharts)

Use **flat swimlanes** at `parent="1"`, stacked vertically. One row of nodes per lane.

**Fixed values — do not compute or debate:**
- Lane size: `x=0, y=lane_index*150, width=CANVAS_W, height=150`
- Lane style: `swimlane;horizontal=0;startSize=110;fillColor=<pastel>;html=1;`
- Child nodes inside a lane: `parent="<lane_id>"`, `x = 120 + col*180`, `y = 45` (always 45), size 140×60 (or 140×80 for diamonds)
- Cross-lane edges: `parent="1"` (not inside a lane)

Pick `CANVAS_W = max_col * 180 + 300`. Choose lane colors from `#f5f5f5, #e8f4f8, #fff0e6, #e8f5e9, #fff9e6, #fce4ec` in that order.

```xml
<mxCell id="lane1" value="Customer" style="swimlane;horizontal=0;startSize=110;fillColor=#f5f5f5;html=1;" vertex="1" parent="1">
  <mxGeometry x="0" y="0" width="1800" height="150" as="geometry"/>
</mxCell>
<mxCell id="n1" value="Place Order" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="lane1">
  <mxGeometry x="120" y="45" width="140" height="60" as="geometry"/>
</mxCell>
<mxCell id="lane2" value="System" style="swimlane;horizontal=0;startSize=110;fillColor=#e8f4f8;html=1;" vertex="1" parent="1">
  <mxGeometry x="0" y="150" width="1800" height="150" as="geometry"/>
</mxCell>
<mxCell id="n2" value="Validate" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="lane2">
  <mxGeometry x="300" y="45" width="140" height="60" as="geometry"/>
</mxCell>
<mxCell id="e1" edge="1" parent="1" source="n1" target="n2" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

Do NOT nest lanes inside a pool. Do NOT vary lane heights. Do NOT compute title-area offset — it is always 110, children start at x=120 to clear it.

### Nested architecture containers (cloud, infra, network topologies)

For diagrams with **nested groupings** — VPC → Availability Zone → EC2 instance, Datacenter → Rack → Server, Region → Environment → Service — use nested swimlanes. This is where the AI most often flattens hierarchy that should be nested. Treat each level as a swimlane container.

**Rules:**
- Every container is a `swimlane` with `startSize=24` (title area at the top).
- Child cells set `parent="<container_id>"` and use coordinates **relative to their parent** (origin 0,0 is the parent's top-left, below the title).
- Edges between cells in **different** containers must have `parent="1"` (not a container) — otherwise they render inside the container and get clipped.
- For industry-specific icons (AWS/Azure/GCP logos, Cisco equipment, etc.), call `search_shapes` to get the exact `style` string and substitute it into a regular vertex — the container structure stays the same.

```xml
<mxCell id="vpc" value="VPC" style="swimlane;startSize=24;fillColor=#dae8fc;strokeColor=#6c8ebf;html=1;" vertex="1" parent="1">
  <mxGeometry x="0" y="0" width="720" height="360" as="geometry"/>
</mxCell>
<mxCell id="az1" value="AZ us-east-1a" style="swimlane;startSize=24;fillColor=#fff2cc;strokeColor=#d6b656;html=1;" vertex="1" parent="vpc">
  <mxGeometry x="20" y="36" width="320" height="300" as="geometry"/>
</mxCell>
<mxCell id="web1" value="web-1" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="az1">
  <mxGeometry x="30" y="40" width="120" height="60" as="geometry"/>
</mxCell>
<mxCell id="db1" value="db-1" style="shape=cylinder3;whiteSpace=wrap;html=1;" vertex="1" parent="az1">
  <mxGeometry x="180" y="40" width="100" height="70" as="geometry"/>
</mxCell>
<mxCell id="az2" value="AZ us-east-1b" style="swimlane;startSize=24;fillColor=#fff2cc;strokeColor=#d6b656;html=1;" vertex="1" parent="vpc">
  <mxGeometry x="360" y="36" width="340" height="300" as="geometry"/>
</mxCell>
<mxCell id="web2" value="web-2" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="az2">
  <mxGeometry x="30" y="40" width="120" height="60" as="geometry"/>
</mxCell>
<mxCell id="e1" edge="1" parent="1" source="web1" target="web2" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

### Cross-functional flowcharts (actor × phase grid, as a table)

Cross-functional flowcharts show a process across **two axes at once** — actors (rows) and phases (columns). Use drawio's `table` shape, which auto-arranges cells into a grid via `childLayout=tableLayout`. This is the canonical draw.io pattern and is distinct from plain swimlanes (which only group on one axis).

**Structure:**
- Outer container: `shape=table;childLayout=tableLayout;startSize=0;collapsible=0;fillColor=none;`
- Rows are children of the table: `shape=tableRow;horizontal=0;startSize=0;collapsible=0;`
- Cells are children of rows — regular vertices, one per (actor, phase) intersection
- Row heights and cell widths are set via `mxGeometry`; they tile automatically
- First row = phase headers; first cell of every other row = actor label
- Process nodes go INSIDE the appropriate cell (parent = cell id) at coordinates relative to the cell
- Cross-cell edges must use `parent="1"` (same rule as containers)

```xml
<mxCell id="tbl" style="shape=table;childLayout=tableLayout;startSize=0;collapsible=0;fillColor=none;" vertex="1" parent="1">
  <mxGeometry x="0" y="0" width="900" height="320" as="geometry"/>
</mxCell>
<mxCell id="r0" style="shape=tableRow;horizontal=0;startSize=0;collapsible=0;" vertex="1" parent="tbl">
  <mxGeometry width="900" height="40" as="geometry"/>
</mxCell>
<mxCell id="h0" style="text;html=1;" vertex="1" parent="r0">
  <mxGeometry width="140" height="40" as="geometry"/>
</mxCell>
<mxCell id="h1" value="Order" style="text;align=center;fontStyle=1;fillColor=#e8e8e8;" vertex="1" parent="r0">
  <mxGeometry x="140" width="380" height="40" as="geometry"/>
</mxCell>
<mxCell id="h2" value="Fulfill" style="text;align=center;fontStyle=1;fillColor=#e8e8e8;" vertex="1" parent="r0">
  <mxGeometry x="520" width="380" height="40" as="geometry"/>
</mxCell>
<mxCell id="r1" style="shape=tableRow;horizontal=0;startSize=0;collapsible=0;" vertex="1" parent="tbl">
  <mxGeometry y="40" width="900" height="140" as="geometry"/>
</mxCell>
<mxCell id="a1" value="Customer" style="fillColor=#dae8fc;fontStyle=1;" vertex="1" parent="r1">
  <mxGeometry width="140" height="140" as="geometry"/>
</mxCell>
<mxCell id="c_cust_order" style="fillColor=none;" vertex="1" parent="r1">
  <mxGeometry x="140" width="380" height="140" as="geometry"/>
</mxCell>
<mxCell id="t_place" value="Place Order" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="c_cust_order">
  <mxGeometry x="120" y="40" width="140" height="60" as="geometry"/>
</mxCell>
<mxCell id="c_cust_fulfill" style="fillColor=none;" vertex="1" parent="r1">
  <mxGeometry x="520" width="380" height="140" as="geometry"/>
</mxCell>
<mxCell id="r2" style="shape=tableRow;horizontal=0;startSize=0;collapsible=0;" vertex="1" parent="tbl">
  <mxGeometry y="180" width="900" height="140" as="geometry"/>
</mxCell>
<mxCell id="a2" value="System" style="fillColor=#d5e8d4;fontStyle=1;" vertex="1" parent="r2">
  <mxGeometry width="140" height="140" as="geometry"/>
</mxCell>
<mxCell id="c_sys_order" style="fillColor=none;" vertex="1" parent="r2">
  <mxGeometry x="140" width="380" height="140" as="geometry"/>
</mxCell>
<mxCell id="t_validate" value="Validate" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="c_sys_order">
  <mxGeometry x="120" y="40" width="140" height="60" as="geometry"/>
</mxCell>
<mxCell id="c_sys_fulfill" style="fillColor=none;" vertex="1" parent="r2">
  <mxGeometry x="520" width="380" height="140" as="geometry"/>
</mxCell>
<mxCell id="t_ship" value="Ship" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="c_sys_fulfill">
  <mxGeometry x="120" y="40" width="140" height="60" as="geometry"/>
</mxCell>
<mxCell id="e1" edge="1" parent="1" source="t_place" target="t_validate" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
<mxCell id="e2" edge="1" parent="1" source="t_validate" target="t_ship" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

**When to use cross-functional tables vs flat swimlanes:**
- Flat swimlanes — one-dimensional (actors only, or phases only). Simpler. Use this when you just need to show who does what in sequence.
- Cross-functional table — two-dimensional (actors AND phases). Use this when **both** the actor and the process stage matter, and every step belongs to a specific (actor, phase) cell.

**Do NOT** nest swimlanes inside a table row, do NOT set `startSize` on rows or cells (columns tile from `x=0`), and do NOT rely on the AI to produce exact widths that sum to the table width — close-enough totals are fine, the `tableLayout` normalizes them.

## Layers

Layers control visibility and z-order. Every cell belongs to exactly one layer. Use layers to manage diagram complexity — viewers can toggle layer visibility to show or hide groups of elements (e.g., "Physical Infrastructure" vs "Logical Network" vs "Security Zones").

Cell `id="0"` is the root and cell `id="1"` is the default layer — both always exist. Additional layers are `mxCell` elements with `parent="0"`:

```xml
<mxGraphModel>
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="2" value="Annotations" parent="0"/>
    <mxCell id="10" value="Server" style="rounded=1;html=1;" vertex="1" parent="1">
      <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
    </mxCell>
    <mxCell id="20" value="Note: deprecated" style="text;" vertex="1" parent="2">
      <mxGeometry x="100" y="170" width="120" height="30" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>
```

- A layer is an `mxCell` with `parent="0"` and no `vertex` or `edge` attribute
- Assign shapes to a layer by setting `parent` to the layer's id
- Later layers render on top of earlier layers (higher z-order)
- Add `visible="0"` as an attribute on the layer cell to hide it by default
- Use layers when the diagram has distinct conceptual groupings that viewers may want to toggle independently

## Tags

Tags are visual filters that let viewers show or hide elements by category. Unlike layers, a single element can have multiple tags, making tags ideal for cross-cutting concerns (e.g., tagging shapes as "critical", "v2", or "backend").

Tags require wrapping `mxCell` in an `<object>` element. Tags are assigned via the `tags` attribute as a space-separated string:

```xml
<mxGraphModel>
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <object id="2" label="Auth Service" tags="critical v2">
      <mxCell style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
        <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
      </mxCell>
    </object>
    <object id="3" label="Legacy API" tags="critical deprecated">
      <mxCell style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
        <mxGeometry x="300" y="100" width="120" height="60" as="geometry"/>
      </mxCell>
    </object>
  </root>
</mxGraphModel>
```

- Tags require the `<object>` wrapper — a plain `mxCell` cannot have tags
- The `label` attribute on `<object>` replaces `value` on `mxCell`
- Tags are space-separated in the `tags` attribute
- Viewers filter the diagram by selecting tags in the draw.io UI (Edit > Tags)
- Tags do not affect z-order or structural grouping — they are purely a visibility filter

## Metadata and placeholders

Metadata stores custom key-value properties on shapes as additional attributes on the `<object>` wrapper element. Combined with placeholders, metadata values can be displayed in labels — useful for data-driven diagrams showing status, owner, IP addresses, or versions on each shape.

Set `placeholders="1"` on the `<object>` to enable `%propertyName%` substitution in the `label`:

```xml
<mxGraphModel>
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <object id="2" label="&lt;b&gt;%component%&lt;/b&gt;&lt;br&gt;Owner: %owner%&lt;br&gt;Status: %status%"
            placeholders="1" component="Auth Service" owner="Team Backend" status="Active">
      <mxCell style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
        <mxGeometry x="100" y="100" width="160" height="80" as="geometry"/>
      </mxCell>
    </object>
  </root>
</mxGraphModel>
```

- Custom properties are plain XML attributes on `<object>` (e.g., `component="Auth Service"`)
- Set `placeholders="1"` to enable `%key%` substitution in the label and tooltip
- The label must use `html=1` style when using HTML formatting with placeholders
- Placeholders resolve by walking up the containment hierarchy: shape attributes first, then parent container, then layer, then root — first match wins
- Predefined placeholders work without custom properties: `%id%`, `%width%`, `%height%`, `%date%`, `%time%`, `%timestamp%`, `%page%`, `%pagenumber%`, `%pagecount%`, `%filename%`
- Use `%%` for a literal percent sign in labels
- Tags, metadata, and placeholders can all be combined on the same `<object>` element
- Use metadata when shapes represent data records (servers, services, components) and you want to attach structured information beyond the visible label

## Dark mode colors

draw.io supports automatic dark mode rendering. How colors behave depends on the property:

- **`strokeColor`, `fillColor`, `fontColor`** default to `"default"`, which renders as black in light theme and white in dark theme. When no explicit color is set, colors adapt automatically.
- **Explicit colors** (e.g. `fillColor=#DAE8FC`) specify the light-mode color. The dark-mode color is computed automatically by inverting the RGB values (blending toward the inverse at 93%) and rotating the hue by 180° (via `mxUtils.getInverseColor`).
- **`light-dark()` function** — To specify both colors explicitly, use `light-dark(lightColor,darkColor)` in the style string, e.g. `fontColor=light-dark(#7EA6E0,#FF0000)`. The first argument is used in light mode, the second in dark mode.

To enable dark mode color adaptation, the `mxGraphModel` element must include `adaptiveColors="auto"`.

When generating diagrams, you generally do not need to specify dark-mode colors — the automatic inversion handles most cases. Use `light-dark()` only when the automatic inverse color is unsatisfactory.

## Automatic edge routing

Every XML diagram rendered in the viewer automatically runs an ELK (Eclipse Layout Kernel) edge-routing pass **after** the initial render:

1. Vertex positions are pinned (the AI's placement is respected — no vertex moves).
2. ELK recomputes bend points + connection points for every edge (orthogonal routing).
3. A metric (edge-vertex intersections) compares before vs. after. If ELK made collisions worse, the edge routing is reverted to your original.
4. The exported XML (copy/clipboard, "Open in draw.io") reflects whatever is finally shown — so downstream consumers also get the cleaned-up edges.

You do not need to request this. Place vertices where they belong and write edges naively — the viewer handles connector cleanup.

This also means: there is no server-side post-processing pass. What you generate is what the viewer starts with; the ELK pass is the only correction.

**This automatic cleanup runs only in the viewer.** A static `.drawio` file — opened in the draw.io desktop app, or exported to PNG/SVG with the desktop CLI (what the skill does) — gets no ELK pass. What you wrote is what renders: nodes stay where you placed them, and each edge gets only its edge style's own routing. Orthogonal edges still bend into right angles, but that router will run a line straight through any node in its way and won't space out parallel edges — and nothing cleans up those tangles afterward.

For static-file output, then: place nodes deliberately (good placement is what keeps edges from crossing), export a preview, and look at it. Add manual routing only for the specific edges that still cut through a node or bundle together — `exitX`/`exitY` plus `entryX`/`entryY` to choose where an edge attaches, or waypoints to force its path. Leave edges that already look clean alone.

## Post-layout (optional, overrides vertex positions)

For cases where you want a **full** re-layout — moving vertices to canonical positions — set the optional `postLayout` parameter on `create_diagram` to `"elk"` (ELK's `layered` flow algorithm). Vertices animate (morph) from their original positions to the algorithm's layout. Best for flowcharts, process diagrams, state diagrams, decision flows, pipelines, and hierarchical/directional diagrams.

For `postLayout: "elk"`, the flow **direction** is separate: on **XML** set the optional `direction` field (`"vertical"` (default) or `"horizontal"`); on **Mermaid** it is read from the flowchart code (`flowchart TD/TB` → vertical, `LR/RL` → horizontal) and `direction` is ignored.

**For XML diagrams: usually omit `postLayout`.** You authored the coordinates yourself, so the layout is already deliberate — the automatic edge-routing pass handles the rest. Set `postLayout` only when the user explicitly wants a canonical layout, or when you know vertex placement is significantly off. When you do use `postLayout: "elk"`, add `direction: "horizontal"` if the flow reads left-to-right.

**For Mermaid diagrams: see the `postLayout` parameter description for when to set it.** Complex Mermaid flowcharts (≥ ~20 nodes, ≥ 3 decision diamonds, feedback edges, or ≥ 3 endpoints) need `postLayout: "elk"` because the native parser's layout goes cramped or unbalanced past that threshold — the direction follows the flowchart code, so no `direction` is needed. Simple flowcharts and all non-flowchart Mermaid types (sequence, class, ER, sankey, …) need no `postLayout`.

**When NOT to use (XML):**
- The user has asked for specific positions (swim lanes with exact lanes, architecture diagrams with meaningful spatial arrangement).
- The diagram relies on containers/grouping where spatial layout encodes information.

## Style reference

Complete style reference (all shape types, style properties, color palettes, HTML labels, and more): https://github.com/jgraph/drawio-mcp/blob/main/shared/style-reference.md

XML Schema (XSD): https://github.com/jgraph/drawio-mcp/blob/main/shared/mxfile.xsd

## CRITICAL: XML well-formedness

When generating draw.io XML, the output **must** be well-formed XML:
- **NEVER include ANY XML comments (`<!-- -->`) in the output.** XML comments are strictly forbidden — they waste tokens, can cause parse errors, and serve no purpose in diagram XML.
- Escape special characters in attribute values: `&amp;`, `&lt;`, `&gt;`, `&quot;`
- Always use unique `id` values for each `mxCell`
