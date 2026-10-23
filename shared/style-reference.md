# draw.io Style Reference for AI File Generation

This document is a companion to [`mxfile.xsd`](https://github.com/jgraph/drawio-mcp/blob/main/shared/mxfile.xsd) and provides all information
needed to programmatically generate valid draw.io (.drawio) files. All data was extracted from the draw.io source code.

See also: [Generate and validate draw.io diagrams with AI](https://www.drawio.com/docs/reference/diagram-generation/)

---

## 1. File Structure Overview

A minimal valid draw.io file:

```xml
<mxfile>
  <diagram id="page-1" name="Page-1">
    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1"
                  tooltips="1" connect="1" arrows="1" fold="1"
                  page="1" pageScale="1" pageWidth="850" pageHeight="1100"
                  math="0" shadow="0">
      <root>
        <!-- Root container (always required, always id="0") -->
        <mxCell id="0" />
        <!-- Default layer (always required, always id="1", parent="0") -->
        <mxCell id="1" parent="0" />
        <!-- Diagram elements go here with parent="1" -->
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

### Critical Rules

1. **The first two mxCell elements are mandatory structural cells:**
   - `id="0"` — root container, no parent attribute
   - `id="1"` with `parent="0"` — default layer
2. **All diagram elements must have `parent="1"`** (or the id of a group/layer).
3. **IDs must be unique** within the diagram. Use any string (e.g. "2", "node-1", "abc123").
4. **Vertices need `vertex="1"`**, edges need `edge="1"`** — these are mutually exclusive.
5. **Edges should reference source and target** via cell IDs. Edges without connections need explicit mxPoint sourcePoint/targetPoint.
6. **Always use uncompressed XML** (no `compressed="true"`). AI should not generate compressed content.
7. **Style strings end with semicolon.** Example: `"rounded=1;whiteSpace=wrap;html=1;"`
8. **Coordinates: origin (0,0) is top-left**, x increases rightward, y increases downward.

---

## 2. Style String Format

The `style` attribute on mxCell is a **semicolon-separated list of key=value pairs**:

```
key1=value1;key2=value2;key3=value3;
```

A **style class name** or **shape name** can appear as a bare token (without `=`):

```
ellipse;whiteSpace=wrap;html=1;fillColor=#DAE8FC;
```

Here `ellipse` sets the shape. Multiple bare tokens are possible for style class inheritance:

```
text;html=1;align=left;
```

### Rules
- Keys and values are **case-sensitive**
- **No spaces** around `=` or `;`
- Boolean values use `0` and `1` (not true/false)
- Colors use `#RRGGBB` hex format (with `#`), `none`, or `default`
- The trailing `;` is conventional but not strictly required
- Unknown keys are silently ignored

---

## 3. Shape Types

### 3.1 Core mxGraph Shapes

These shapes are defined in the mxGraph core library:

| shape= value | Description | Notes |
|---|---|---|
| `rectangle` | Rectangle (default) | Also the default if no shape specified |
| `ellipse` | Oval / ellipse | Use `aspect=fixed` for circle |
| `rhombus` | Diamond | Use `perimeter=rhombusPerimeter` |
| `triangle` | Triangle | Use `perimeter=trianglePerimeter` |
| `hexagon` | Hexagon | Use `perimeter=hexagonPerimeter2` |
| `cloud` | Cloud | |
| `cylinder` | 3D Cylinder | |
| `line` | Horizontal line | |
| `arrow` | Block arrow | |
| `arrowConnector` | Arrow-shaped connector | |
| `doubleEllipse` | Double-bordered ellipse | |
| `image` | Image container | Requires `image=<url>` |
| `label` | Rectangle with icon area | Default vertex shape |
| `swimlane` | Container with header bar | Use `startSize` for header height |
| `actor` | Actor (stick figure outline) | |
| `connector` | Edge connector | Default edge shape |

### 3.2 Extended Shapes (draw.io Shapes.js)

These are registered via `mxCellRenderer.registerShape()`:

| shape= value | Description |
|---|---|
| `cube` | 3D cube |
| `isoCube` | Isometric cube |
| `isoCube2` | Isometric cube (variant 2) |
| `isoRectangle` | Isometric rectangle |
| `cylinder2` | Cylinder (variant 2, configurable) |
| `cylinder3` | Cylinder (variant 3) |
| `datastore` | Cylindrical data store |
| `note` | Sticky note |
| `note2` | Note (variant 2) |
| `document` | Document page with curled bottom |
| `folder` | Folder icon |
| `card` | Card with cut corner |
| `tape` | Punched tape |
| `tapeData` | Tape data storage |
| `process` | Process box (double-sided borders) |
| `process2` | Same as process |
| `step` | Step/chevron arrow |
| `plus` | Plus sign |
| `ext` | Extended rectangle (supports `double=1`) |
| `callout` | Speech bubble |
| `parallelogram` | Parallelogram (use `perimeter=parallelogramPerimeter`) |
| `trapezoid` | Trapezoid (use `perimeter=trapezoidPerimeter`) |
| `curlyBracket` | Curly bracket |
| `switch` | Networking switch shape |
| `transparent` | Invisible shape |
| `message` | Envelope/message |
| `corner` | L-shaped corner |
| `crossbar` | Cross bar |
| `tee` | T-shaped connector |
| `singleArrow` | Single arrow |
| `doubleArrow` | Double-headed arrow |
| `flexArrow` | Flexible arrow |
| `wire` | Wire connector |
| `waypoint` | Waypoint marker |
| `manualInput` | Manual input (flowchart) |
| `internalStorage` | Internal storage (flowchart) |
| `dataStorage` | Data storage (flowchart) |
| `loopLimit` | Loop limit (flowchart) |
| `offPageConnector` | Off-page connector |
| `delay` | Delay shape |
| `display` | Display device |
| `or` | OR gate |
| `orEllipse` | OR ellipse |
| `xor` | XOR gate |
| `sumEllipse` | Sum/sigma ellipse |
| `sortShape` | Sort shape |
| `collate` | Collate shape |
| `cross` | Cross / X shape |
| `dimension` | Dimension line |
| `partialRectangle` | Rectangle with configurable borders |
| `lineEllipse` | Line with ellipse |
| `link` | Link / chain shape |
| `pipe` | Pipe connector |
| `zigzag` | Zigzag connector |
| `filledEdge` | Filled edge connector |
| `taperedArrow` | Connector that tapers from `startWidth` (default `12`) to `endWidth` (default `2`). Supports `rounded` and `curved`, and `fillColor` / `gradientColor` like `flexArrow` (no fill by default). `startSize` / `endSize` is how much wider the arrow head is than the band at that end. |
| `table` | Table container. `evenRowColor` / `oddRowColor` and `evenColumnColor` / `oddColumnColor` add alternating stripes to rows and columns |
| `tableRow` | Table row |
| `tableLine` | Table line |
| `rect2` | Alternative rectangle |

### 3.3 UML Shapes

| shape= value | Description |
|---|---|
| `umlActor` | UML stick figure |
| `umlBoundary` | UML boundary |
| `umlEntity` | UML entity |
| `umlDestroy` | UML destruction mark |
| `umlControl` | UML control |
| `umlLifeline` | UML lifeline |
| `umlFrame` | UML frame |
| `umlState` | UML state (use `perimeter=mxPerimeter.StatePerimeter`) |
| `lollipop` | UML provided interface |
| `requires` | UML required interface |
| `requiredInterface` | UML required interface (arc) |
| `providedRequiredInterface` | UML assembly connector |
| `module` | UML module |
| `component` | UML component |
| `associativeEntity` | ER associative entity |
| `endState` | State diagram end state |
| `startState` | State diagram start state |

### 3.4 Stencil Libraries

Additional shapes are available via stencil libraries in the `stencils/` directory.
Use with: `shape=stencil(<library>.<shape>)` or `shape=mxgraph.<library>.<shape>`.

Major libraries:
- `mxgraph.flowchart.*` — Flowchart shapes
- `mxgraph.bpmn.*` — BPMN shapes
- `mxgraph.aws4.*` — AWS architecture icons
- `mxgraph.azure.*` — Azure architecture icons
- `mxgraph.gcp.*` / `mxgraph.gcp2.*` — Google Cloud icons
- `mxgraph.cisco.*` / `mxgraph.cisco19.*` — Cisco networking
- `mxgraph.kubernetes.*` — Kubernetes icons
- `mxgraph.uml.*` — UML shapes
- `mxgraph.er.*` — Entity-relationship shapes
- `mxgraph.electrical.*` — Electrical engineering symbols
- `mxgraph.pid.*` — Piping and instrumentation
- `mxgraph.mockup.*` — UI wireframe components
- `mxgraph.lean_mapping.*` — Lean mapping
- `mxgraph.eip.*` — Enterprise integration patterns

---

## 4. Style Properties Reference

### 4.1 Fill and Stroke

| Property | Values | Default | Description |
|---|---|---|---|
| `fillColor` | `#RRGGBB`, `none`, `default`, [keyword](#special-color-values) | `default` | Shape fill color |
| `gradientColor` | `#RRGGBB`, `none`, [keyword](#special-color-values) | none | Gradient end color (gradient from fillColor to gradientColor) |
| `gradientDirection` | `north`, `south`, `east`, `west` | `south` | Gradient direction |
| `strokeColor` | `#RRGGBB`, `none`, `default`, [keyword](#special-color-values) | `default` | Border/stroke color |
| `strokeWidth` | number | `1` | Border width in pixels |
| `dashed` | `0`, `1` | `0` | Dashed stroke |
| `dashPattern` | string | — | Dash pattern, e.g. `"1 3"` (1px dash, 3px gap), `"8 8"` |
| `opacity` | `0`–`100` | `100` | Overall opacity (0=transparent, 100=opaque) |
| `fillOpacity` | `0`–`100` | `100` | Fill opacity only |
| `strokeOpacity` | `0`–`100` | `100` | Stroke opacity only |
| `glass` | `0`, `1` | `0` | Glass/shine overlay effect |
| `shadow` | `0`, `1` | `0` | Drop shadow (also controlled globally on mxGraphModel) |

### 4.2 Shape Geometry

| Property | Values | Default | Description |
|---|---|---|---|
| `shape` | see Shape Types above | `label` | Shape type |
| `perimeter` | see Perimeters below | `rectanglePerimeter` | Connection point calculation |
| `rounded` | `0`, `1` | `0` | Round rectangle corners |
| `arcSize` | number | — | Corner radius for rounded shapes (0–50, as percentage) |
| `aspect` | `variable`, `fixed` | `variable` | `fixed` preserves width/height ratio |
| `direction` | `north`, `south`, `east`, `west` | — | Rotate shape by 90° increments |
| `flipH` | `0`, `1` | `0` | Flip horizontally |
| `flipV` | `0`, `1` | `0` | Flip vertically |
| `rotation` | number (degrees) | `0` | Free rotation angle (0–360) |
| `fixedSize` | `0`, `1` | `0` | Shape keeps size independent of label |

From version 31.7.1 onwards:

| Property | Values | Default | Description |
|---|---|---|---|
| `roundedPerimeter` | `0`, `1` | `0` | With `rounded=1` on rectangles and labels, perimeter connection points and floating edges end on the rounded outline instead of the bounding box. Corner connection points sit at 45° on the arc. Ignored by other shapes |

### 4.3 Text and Labels

| Property | Values | Default | Description |
|---|---|---|---|
| `html` | `0`, `1` | `1` | Enable HTML label rendering |
| `whiteSpace` | `wrap`, `nowrap` | — | Text wrapping mode. Use `wrap` for most shapes |
| `fontSize` | number | `12` | Font size in pixels |
| `fontFamily` | string | `Helvetica` | Font family name |
| `fontColor` | `#RRGGBB`, `default`, [keyword](#special-color-values) | `default` | Text color |
| `fontStyle` | bitmask | `0` | Font style: 0=normal, 1=bold, 2=italic, 4=underline (combine by adding: 3=bold+italic) |
| `align` | `left`, `center`, `right` | `center` | Horizontal text alignment |
| `verticalAlign` | `top`, `middle`, `bottom` | `middle` | Vertical text alignment |
| `labelPosition` | `left`, `center`, `right` | `center` | Horizontal label position relative to shape |
| `verticalLabelPosition` | `top`, `middle`, `bottom` | `middle` | Vertical label position relative to shape |
| `labelPerimeter` | `0`, `1` | `0` | On a vertex whose label is outside the shape, centered on one side (`verticalLabelPosition=top` or `bottom` with `labelPosition=center`, or `labelPosition=left` or `right` with `verticalLabelPosition=middle`): edges that would cross the label end at its outline instead (plus the perimeter spacing), and a fixed connection point on that side moves to the far edge of the label. Ignored on rotated and flipped shapes. Library shapes with an outside label have it, and the _Position_ control in the _Text_ tab sets it; set it on generated vertices with outside labels, for example icons with `verticalLabelPosition=bottom` |
| `overflow` | `visible`, `hidden`, `fill`, `width` | — | Text overflow handling |
| `spacing` | number | `2` | General padding in pixels |
| `spacingTop` | number | `0` | Top padding |
| `spacingBottom` | number | `0` | Bottom padding |
| `spacingLeft` | number | `0` | Left padding |
| `spacingRight` | number | `0` | Right padding |
| `textOpacity` | `0`–`100` | `100` | Text opacity |
| `labelBackgroundColor` | `#RRGGBB`, `none`, `default` | — | Background behind text (useful for edge labels) |
| `defaultLabelBackgroundColor` | `page` | — | With `labelBackgroundColor=default`: no background, the label box is cut out of the shape and of the parent edge, so the page shows behind the label (_Transparent_ in the _Background_ list of draw.io's Text tab). `gap` has the same effect. draw.io sets it on new edges and edge labels |
| `labelPlacement` | `auto` | — | On an edge or an edge label: the label stays horizontal and sits just above horizontal segments, below the line when something is in the way above, and on the line (with the gap) on vertical and diagonal segments. It keeps clear of bends and arrowheads; a label in the middle of the edge that doesn't fit its segment moves to the nearest segment that does. Placed again when the route changes. draw.io releases after 32.5.5; older viewers ignore it |
| `labelBorderColor` | `#RRGGBB`, `none` | — | Border around label |
| `labelWidth` | number | — | Fixed label width |
| `textDirection` | `default`, `ltr`, `rtl` | `default` | Text direction |
| `horizontal` | `0`, `1` | `1` | `0` for vertical text |

### 4.4 Edge / Connector Properties

| Property | Values | Default | Description |
|---|---|---|---|
| `edgeStyle` | see Edge Styles below | — | Routing algorithm |
| `libavoidRouting` | `0`, `1` | `0` | Auto-route the edge around shapes (obstacle-avoiding orthogonal routing, paired with `edgeStyle=orthogonalEdgeStyle`). Re-routed when a terminal or a shape on the route changes; a manual waypoint edit removes it |
| `curved` | `0`, `1` | `0` | Curved edge path |
| `curveGeometry` | `0`, `1` | `0` | With `curved=1` or `bezier=1`: labels and line jumps follow the painted curve instead of the control points. Added to new curved edges |
| `labelOnCurve` | `0`, `1` | `0` | With `curved=1` or `bezier=1`, edge labels are placed along the painted curve instead of the line through the waypoints (`x` and `y` of the label geometry are measured along the curve). The editor sets and removes it together with `curved` and adds it to new curved edges. Ignored before version 32.2.1 |
| `rounded` | `0`, `1` | `1` | Round edge corners (for orthogonal) |
| `jettySize` | `auto`, number | `auto` | Spacing from port for orthogonal edges |
| `sourceJettySize` | number | — | Source-side jetty override |
| `targetJettySize` | number | — | Target-side jetty override |
| `orthogonalLoop` | `0`, `1` | `1` | Self-loop routing style |
| `elbow` | `horizontal`, `vertical` | — | Elbow edge direction |
| `jumpStyle` | `arc`, `gap`, `sharp`, `line` | — | Line crossing visualization (curved edges need `curveGeometry=1`) |
| `jumpSize` | number | `6` | Jump width at crossings |
| `jumpLayers` | `0`, `1` | `1` | `0` only adds jumps for crossings with edges in the same layer as this edge |
| `followTerminals` | `0`, `1` | `0` | Waypoints move with the terminals when these are moved, resized or arranged: orthogonal edges keep axis-parallel segments, other edges keep each waypoint's relative position along and distance from the line between the terminal centres. No effect with `libavoidRouting=1` |

### 4.5 Arrow Markers

| Property | Values | Default | Description |
|---|---|---|---|
| `startArrow` | arrow type | `none` | Marker at edge start |
| `endArrow` | arrow type | `classic` | Marker at edge end |
| `startSize` | number | — | Start marker size |
| `endSize` | number | — | End marker size |
| `startFill` | `0`, `1` | `1` | Fill start marker |
| `endFill` | `0`, `1` | `1` | Fill end marker |
| `startFillColor` | `#RRGGBB` | — | Fill colour of the start marker (default: line colour) |
| `endFillColor` | `#RRGGBB` | — | Fill colour of the end marker (default: line colour) |
| `startStrokeColor` | `#RRGGBB` | — | Outline colour of the start marker (default: line colour) |
| `endStrokeColor` | `#RRGGBB` | — | Outline colour of the end marker (default: line colour) |

**Arrow type values:**

| Value | Description |
|---|---|
| `none` | No arrow |
| `classic` | Standard filled triangle |
| `classicThin` | Thin triangle |
| `block` | Filled block |
| `blockThin` | Thin block |
| `open` | Open (unfilled) triangle |
| `openThin` | Thin open triangle |
| `oval` | Circle/oval |
| `diamond` | Diamond |
| `diamondThin` | Thin diamond |
| `box` | Square box |
| `halfCircle` | Half circle |
| `circle` | Circle |
| `circlePlus` | Circle with plus |
| `cross` | Cross mark |
| `baseDash` | Perpendicular dash |
| `doubleBlock` | Double filled block |
| `dash` | Short dash |
| `async` | Asynchronous (half-arrow) |
| `openAsync` | Open asynchronous arrow |
| `manyOptional` | ER many-optional (crow's foot) |

**Fill behavior:** `startFill=0`/`endFill=0` renders the marker as an outline only. This is important for UML and ER diagram conventions (e.g., open diamond = aggregation, filled diamond = composition).

### 4.6 Connection Points

| Property | Values | Default | Description |
|---|---|---|---|
| `exitX` | `0.0`–`1.0` | — | Relative x of exit point (0=left, 0.5=center, 1=right) |
| `exitY` | `0.0`–`1.0` | — | Relative y of exit point (0=top, 0.5=middle, 1=bottom) |
| `exitDx` | number | — | Absolute x offset from exit point |
| `exitDy` | number | — | Absolute y offset from exit point |
| `exitPerimeter` | `0`, `1` | `1` | Use perimeter for exit point |
| `entryX` | `0.0`–`1.0` | — | Relative x of entry point |
| `entryY` | `0.0`–`1.0` | — | Relative y of entry point |
| `entryDx` | number | — | Absolute x offset from entry point |
| `entryDy` | number | — | Absolute y offset from entry point |
| `entryPerimeter` | `0`, `1` | `1` | Use perimeter for entry point |
| `portConstraint` | `eastwest`, `northsouth`, `perimeter`, `fixed` | — | Port constraint |
| `sourcePerimeterSpacing` | number | `0` | Gap between the edge start and the source shape (Line start offset) |
| `targetPerimeterSpacing` | number | `0` | Gap between the edge end and the target shape (Line end offset) |
| `fixedPointSpacing` | `0`, `1` | `0` | Also apply `sourcePerimeterSpacing` / `targetPerimeterSpacing` to ends attached to a fixed connection point. Negative values extend the end outward. Set automatically when Line start/end offset is edited in the Format panel |

### 4.7 Container / Swimlane Properties

| Property | Values | Default | Description |
|---|---|---|---|
| `container` | `0`, `1` | `0` | Cell is a container (children can be placed inside) |
| `collapsible` | `0`, `1` | `1` | Container can be collapsed |
| `recursiveResize` | `0`, `1` | `1` | Resize children when container resizes |
| `swimlaneFillColor` | `#RRGGBB` | — | Swimlane header fill color |
| `startSize` | number | `23` | Swimlane header height in pixels |
| `horizontal` | `0`, `1` | `1` | Swimlane orientation (1=header on top, 0=header on left) |
| `childLayout` | `stackLayout`, `tableLayout`, `rack`, `circleLayout`, `flowLayout`, `treeLayout`, `organicLayout`, URL-encoded JSON | — | Layout that arranges the children (see below) |

**`childLayout` values:** The layout runs when the container or its children change, not when the diagram is opened.

| Value | Layout |
|---|---|
| `stackLayout` | Stacks the children in a row or column and stretches them across the container, e.g. lists and UML class members |
| `tableLayout` | Rows and cells of a `shape=table` table |
| `rack` | Rack cabinet: stacks the devices from top to bottom |
| `circleLayout` | Places the children on a circle |
| `flowLayout` | Layered flow, runs as the ELK layout `elkLayered` |
| `treeLayout` | Tree, runs as the ELK layout `elkTree`; connectors retain their style |
| `organicLayout` | Force-directed, runs as the ELK layout `elkOrganic` |
| URL-encoded JSON | A layout list as in the [JSON layout specification](https://www.drawio.com/docs/reference/json-layout-specification), URL-encoded so that no `;` or `=` breaks the style string, e.g. `childLayout=%5B%7B%22layout%22%3A%22elkTree%22%7D%5D` for `[{"layout":"elkTree"}]` |

From version 32.3.1 onwards, `flowLayout`, `treeLayout` and `organicLayout` run as ELK layouts, and their style keys below are translated to ELK options (§3.3 of the [JSON layout specification](https://www.drawio.com/docs/reference/json-layout-specification)).

**Layout style keys:**

| Property | Values | Default | Description |
|---|---|---|---|
| `resizeParent` | `0`, `1` | `1` | The container resizes to fit its children (`stackLayout`, `circleLayout`, `flowLayout`, `treeLayout`, `organicLayout`) |
| `resizeParentMax` | `0`, `1` | `1` | `stackLayout`: the container only grows, it never shrinks |
| `resizeLast` | `0`, `1` | `0` | `stackLayout`: the last child fills the remaining space |
| `horizontalStack` | `0`, `1` | `1` | `stackLayout`: `1` places the children side by side, `0` stacks them top to bottom |
| `stackSpacing` | number | `0` | `stackLayout`: gap between the children |
| `stackBorder` | number | `0` | `stackLayout`: gap between the container and its children |
| `marginTop`, `marginRight`, `marginBottom`, `marginLeft` | number | `0` | `stackLayout`, `rack`: additional space inside the container |
| `allowGaps` | `1` | — | `stackLayout`, `rack`: retain the gaps between the children, in steps of `stackUnitSize` or `rackUnitSize`. Omit for no gaps (any value, including `0`, will enable gaps) |
| `stackUnitSize` | number | `20` | `stackLayout` with `allowGaps`: step size of the gaps |
| `rackUnitSize` | number | `20` | `rack`: height of one rack unit |
| `horizontalRack` | `0`, `1` | `0` | `rack`: `1` places the devices side by side |
| `flowOrientation` | `north`, `west`, `east`, `south` | `east` | `flowLayout`: side of the roots — `north` top to bottom, `west` left to right, `east` right to left, `south` bottom to top |
| `intraCellSpacing` | number | `30` | `flowLayout`: gap between shapes in the same rank |
| `interRankCellSpacing` | number | `100` | `flowLayout`: gap between ranks |
| `interHierarchySpacing` | number | `60` | `flowLayout`: gap between unconnected parts |
| `parallelEdgeSpacing` | number | `10` | `flowLayout`: gap between parallel connectors |
| `horizontalTree` | `0`, `1` | `1` | `treeLayout`: `1` left to right, `0` top to bottom |
| `treeLevelDistance` | number | `30` | `treeLayout`: gap between levels and between siblings (minimum `20`) |
| `parentPadding` | number | `20` | `flowLayout`, `treeLayout`, `organicLayout`: gap between the container border (below its title) and its children |

### 4.8 Image Properties

| Property | Values | Default | Description |
|---|---|---|---|
| `image` | URL string | — | Image URL (data: URIs also supported) |
| `imageWidth` | number | `42` | Image width |
| `imageHeight` | number | `42` | Image height |
| `imageAlign` | `left`, `center`, `right` | — | Image horizontal alignment |
| `imageVerticalAlign` | `top`, `middle`, `bottom` | — | Image vertical alignment |
| `imageAspect` | `0`, `1` | `1` | Preserve image aspect ratio |

### 4.9 Sketch / Hand-Drawn Style

| Property | Values | Default | Description |
|---|---|---|---|
| `sketch` | `0`, `1` | `0` | Enable hand-drawn/sketch style (uses rough.js) |
| `comic` | `0`, `1` | `0` | Comic book style |
| `fillStyle` | `solid`, `hachure`, `cross-hatch`, `dots` | — | Fill pattern for sketch mode |
| `fillWeight` | number | — | Hatch line weight (negative = thinner) |
| `hachureGap` | number | — | Gap between hatch lines in pixels |
| `hachureAngle` | number (degrees) | — | Angle of hatch lines |
| `jiggle` | number | — | Hand-drawn jiggle amount |
| `curveFitting` | `0`–`1` | — | Curve fitting quality |
| `simplification` | `0`–`1` | — | Path simplification |
| `disableMultiStroke` | `0`, `1` | — | Disable double-stroke effect |
| `disableMultiStrokeFill` | `0`, `1` | — | Disable double-stroke fill |

### 4.10 Behavior Properties

| Property | Values | Default | Description |
|---|---|---|---|
| `movable` | `0`, `1` | `1` | Allow moving |
| `resizable` | `0`, `1` | `1` | Allow resizing |
| `rotatable` | `0`, `1` | `1` | Allow rotation |
| `bendable` | `0`, `1` | `1` | Allow bending edges |
| `collapsedPoints` | `0`, `1` | `1` | `0` ignores the edge's waypoints while one of its ends is hidden in a collapsed container (the stored waypoints are kept and used again when expanded; the edge can't be bent in that state) |
| `editable` | `0`, `1` | `1` | Allow label editing |
| `deletable` | `0`, `1` | `1` | Allow deletion |
| `cloneable` | `0`, `1` | `1` | Allow cloning |
| `foldable` | `0`, `1` | — | Allow fold/collapse |
| `connectable` | `0`, `1` | `1` | Allow connections |
| `newEdgeStyle` | URL-encoded JSON style | — | Style of new connectors drawn from this shape. Set it with _Set as Default for New Connections_ on a connector from this shape, and remove it with _Clear Default for New Connections_ on the shape |
| `pointerEvents` | `0`, `1` | `1` | Enable mouse events |
| `autosize` | `0`, `1` | `0` | Auto-size to fit content |

### 4.11 Data Properties

Values in the style of a cell can come from its data, and from the [style rules](https://www.drawio.com/docs/manual/pages/style-rules/) of the page.

| Property | Values | Default | Description |
|---|---|---|---|
| `stylePlaceholders` | `0`, `1` | `0` | `1` replaces placeholders such as `%color%` in the values of the keys in the table below with the data of the cell, its ancestors and the page, like placeholders in labels. Each value is checked for its key: keys whose value is not valid after the placeholders are replaced are removed, numbers are limited to the range of the key. Placeholders in other keys are not replaced. The CSV import keeps these placeholders in styles with `stylePlaceholders=1`, so the styles follow later changes of the data. Example: `fillColor=%color%;stylePlaceholders=1;` |
| `styleRules` | `0`, `1` | `1` | `0`: the style rules of the page don't change the cell, for example the shapes of a legend that _Insert Legend_ adds |

Keys that placeholders and style rules can set:

| Keys | Values |
|---|---|
| `fillColor`, `gradientColor`, `strokeColor`, `fontColor`, `labelBackgroundColor`, `labelBorderColor`, `swimlaneFillColor` | `#hex`, `rgb()`, `rgba()`, `hsl()` or `hsla()` with numbers, a colour name, `light-dark()` of two colours, `none` or `default` |
| `opacity`, `fillOpacity`, `strokeOpacity`, `textOpacity` | `0` to `100` |
| `strokeWidth` | `0` to `100` |
| `fontSize` | `1` to `500` |
| `fontStyle` | `0` to `15`, rounded |
| `rotation` | `-360` to `360` |
| `dashed`, `rounded`, `shadow` | `0`, `1` |

---

## 5. Edge Styles (Routing Algorithms)

| edgeStyle= value | Description |
|---|---|
| `orthogonalEdgeStyle` | Routes with right-angle turns (most common) |
| `segmentEdgeStyle` | Manual segments with horizontal/vertical segments |
| `elbowEdgeStyle` | Single elbow (one bend). Combine with `elbow=horizontal` or `elbow=vertical` |
| `entityRelationEdgeStyle` | Entity-relationship style (perpendicular exits) |
| `isometricEdgeStyle` | Isometric diagram routing |
| `loopEdgeStyle` | Self-referencing loop |
| `sideToSideEdgeStyle` | Side-to-side connection |
| `topToBottomEdgeStyle` | Top-to-bottom connection |
| (empty/none) | Straight line, no routing |

**Common edge style combinations:**

```
edgeStyle=orthogonalEdgeStyle;rounded=1;         # Rounded orthogonal (default-like)
edgeStyle=orthogonalEdgeStyle;curved=1;           # Curved orthogonal
edgeStyle=elbowEdgeStyle;elbow=horizontal;        # Horizontal elbow
edgeStyle=entityRelationEdgeStyle;                # ER-style connections
edgeStyle=none;                                    # Straight line
```

---

## 6. Perimeter Types

The perimeter determines how connection points are calculated on a shape's border:

| perimeter= value | Use with |
|---|---|
| `rectanglePerimeter` | Rectangles (default) |
| `ellipsePerimeter` | Ellipses, circles |
| `rhombusPerimeter` | Diamond shapes |
| `trianglePerimeter` | Triangles |
| `hexagonPerimeter2` | Hexagons |
| `parallelogramPerimeter` | Parallelograms |
| `trapezoidPerimeter` | Trapezoids |
| `calloutPerimeter` | Callout/speech bubbles |
| `backbonePerimeter` | Backbone/bus shapes |
| `centerPerimeter` | Single center point |
| `stepPerimeter` | Step/chevron shapes |

**Important:** When using non-rectangular shapes, always set the matching perimeter. Otherwise edges will connect to the rectangular bounding box instead of the visible shape border.

---

## 7. Predefined Style Classes

These class names can be used as bare tokens in the style string. They set multiple style properties at once:

| Class | Sets |
|---|---|
| `text` | No fill, no stroke, left-aligned, top-aligned |
| `edgeLabel` | Extends text, adds label background, font size 11 |
| `label` | Bold, left-aligned, with image area (42x42), rounded |
| `icon` | Extends label, centered image above text |
| `swimlane` | Swimlane shape, bold, header size 23 |
| `group` | No fill, no stroke, transparent container |
| `ellipse` | Ellipse shape with ellipsePerimeter |
| `rhombus` | Diamond shape with rhombusPerimeter |
| `triangle` | Triangle shape with trianglePerimeter |
| `line` | Line shape, strokeWidth=4 |
| `image` | Image shape with label below |
| `arrow` | Arrow shape, no edge routing |

### Color Theme Classes

Each sets `fillColor`, `gradientColor`, `strokeColor`, plus `shadow=1` and `glass=1`:

| Class | fillColor | gradientColor | strokeColor |
|---|---|---|---|
| `blue` | #DAE8FC | #7EA6E0 | #6C8EBF |
| `green` | #D5E8D4 | #97D077 | #82B366 |
| `yellow` | #FFF2CC | #FFD966 | #D6B656 |
| `orange` | #FFCD28 | #FFA500 | #D79B00 |
| `red` | #F8CECC | #EA6B66 | #B85450 |
| `pink` | #E6D0DE | #B5739D | #996185 |
| `purple` | #E1D5E7 | #8C6C9C | #9673A6 |
| `gray` | #F5F5F5 | #B3B3B3 | #666666 |
| `turquoise` | #D5E8D4 | #67AB9F | #6A9153 |

`plain-*` variants (e.g. `plain-blue`) set the same colors without shadow and glass.

---

## 8. Common Color Palettes

### Standard draw.io Colors

These are commonly used in the draw.io UI:

**Fill colors (light):**
- `#DAE8FC` (light blue)
- `#D5E8D4` (light green)
- `#FFF2CC` (light yellow)
- `#F8CECC` (light red)
- `#E1D5E7` (light purple)
- `#E6D0DE` (light pink)
- `#F5F5F5` (light gray)
- `#FFCD28` (orange)
- `#FFE6CC` (light orange)

**Stroke colors (matching):**
- `#6C8EBF` (blue)
- `#82B366` (green)
- `#D6B656` (yellow/gold)
- `#B85450` (red)
- `#9673A6` (purple)
- `#996185` (pink)
- `#666666` (gray)
- `#D79B00` (orange)

**Font/accent colors:**
- `#000000` (black)
- `#FFFFFF` (white)
- `#333333` (dark gray)
- `#0000EE` (link blue)

### Special Color Values

- `none` — transparent / no color (removes fill or stroke)
- `default` — uses the current theme's default (resolves at render time)

The following keywords refer to another colour. They can be used as the value
of `fillColor`, `strokeColor`, `gradientColor` and `fontColor`:

- `inherit` — the same colour of the parent cell, e.g. `fillColor=inherit` uses
  the fill colour of the container
- `fillColor`, `strokeColor` — the fill or stroke colour of the cell itself,
  e.g. `fillColor=strokeColor` fills the shape with its stroke colour

From version 31.6.2 onwards:

- `parentFillColor`, `parentStrokeColor` — the fill or stroke colour of the
  parent cell, e.g. `strokeColor=parentFillColor` draws the border in the fill
  colour of the container

Cells on a layer have no parent shape, so `inherit`, `parentFillColor` and
`parentStrokeColor` use the default colour there.

---

## 9. HTML Labels

When `html=1` is set in the style, the cell's `value` attribute can contain HTML:

### Supported HTML Elements
- `<b>`, `<i>`, `<u>`, `<s>` — text formatting
- `<br>` / `<br/>` — line break
- `<p>`, `<div>`, `<span>` — block/inline containers
- `<font>` — font attributes (face, size, color)
- `<table>`, `<tr>`, `<td>`, `<th>` — tables
- `<ul>`, `<ol>`, `<li>` — lists
- `<hr>` — horizontal rule
- `<img>` — inline images (with src attribute)
- `<a>` — links (href attribute)
- `<sub>`, `<sup>` — subscript/superscript

### HTML in Attributes

HTML in the `value` attribute must be **XML-escaped**:
- `<` → `&lt;`
- `>` → `&gt;`
- `&` → `&amp;`
- `"` → `&quot;`

Example:
```xml
<mxCell value="&lt;b&gt;Title&lt;/b&gt;&lt;br&gt;Description"
        style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
```

### Common HTML Patterns

**Bold title with description:**
```
&lt;b&gt;Title&lt;/b&gt;&lt;br&gt;Description text
```

**UML class box (within table container):**
```
&lt;p style=&quot;margin:0px;margin-top:4px;text-align:center;&quot;&gt;&lt;b&gt;ClassName&lt;/b&gt;&lt;/p&gt;
&lt;hr size=&quot;1&quot;/&gt;
&lt;p style=&quot;margin:0px;margin-left:4px;&quot;&gt;+ field: Type&lt;/p&gt;
&lt;hr size=&quot;1&quot;/&gt;
&lt;p style=&quot;margin:0px;margin-left:4px;&quot;&gt;+ method(): ReturnType&lt;/p&gt;
```

**Colored text:**
```
&lt;font color=&quot;#FF0000&quot;&gt;Red text&lt;/font&gt;
```

---

## 10. Layers

Layers are additional mxCell elements with `parent="0"`:

```xml
<root>
  <mxCell id="0" />
  <mxCell id="1" parent="0" />               <!-- Default layer -->
  <mxCell id="layer2" value="Background" parent="0" />  <!-- Additional layer -->

  <!-- Elements on default layer -->
  <mxCell id="2" ... parent="1" />

  <!-- Elements on "Background" layer -->
  <mxCell id="3" ... parent="layer2" />
</root>
```

To hide a layer: add `visible="0"` to the layer cell.

---

## 11. Groups and Containers

A group/container is a vertex that other cells reference as their parent:

```xml
<!-- Group container -->
<mxCell id="group1" value="Group" style="group;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="300" height="200" as="geometry" />
</mxCell>

<!-- Children reference the group as parent -->
<mxCell id="child1" value="Inside" style="rounded=1;html=1;" vertex="1" parent="group1">
  <mxGeometry x="10" y="10" width="100" height="40" as="geometry" />
</mxCell>
```

**Key points:**
- Child coordinates are **relative to the parent container**
- Use `style="group;"` for invisible containers
- Use `style="swimlane;startSize=30;"` for containers with a visible header
- Add `container=1;` to any style to make it act as a container
- `collapsible=0;` prevents the collapse/expand button

### Collapsible Containers and Alternate Bounds

When a container (e.g. swimlane) is collapsible, draw.io stores alternate bounds
in an `mxRectangle` child element inside `mxGeometry`. When the container is
collapsed/expanded, the geometry swaps between the normal and alternate bounds:

```xml
<mxCell id="class1" value="ClassName" style="swimlane;fontStyle=1;childLayout=stackLayout;startSize=26;collapsible=1;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="200" height="150" as="geometry">
    <mxRectangle x="100" y="100" width="200" height="26" as="alternateBounds" />
  </mxGeometry>
</mxCell>
```

The `alternateBounds` typically has the same x/y but a smaller height (just the header).
AI generators generally do not need to produce `mxRectangle` elements — draw.io adds
them automatically when the user collapses a container.

---

## 12. Edge Geometry and Labels

### Basic Connected Edge

```xml
<mxCell id="e1" value="" style="endArrow=classic;html=1;"
        edge="1" parent="1" source="v1" target="v2">
  <mxGeometry relative="1" as="geometry" />
</mxCell>
```

### Edge with Waypoints

```xml
<mxCell id="e2" value="" style="edgeStyle=orthogonalEdgeStyle;html=1;"
        edge="1" parent="1" source="v1" target="v2">
  <mxGeometry relative="1" as="geometry">
    <Array as="points">
      <mxPoint x="300" y="150" />
      <mxPoint x="300" y="250" />
    </Array>
  </mxGeometry>
</mxCell>
```

### Edge with Label

Edge labels are usually encoded in the edge cell's `value`. The label position is controlled by the geometry:

```xml
<mxCell id="e3" value="label text" style="endArrow=classic;html=1;"
        edge="1" parent="1" source="v1" target="v2">
  <mxGeometry x="-0.5" y="0" relative="1" as="geometry">
    <mxPoint as="offset" />
  </mxGeometry>
</mxCell>
```

- `x` on geometry: position along edge (-1 to 1, where 0 = center, -1 = near source, 1 = near target)
- `y` on geometry: perpendicular offset in pixels
- With `labelOnCurve=1` on a curved edge, `x` and `y` are measured along and perpendicular to the painted curve instead of the line through the waypoints

### Unconnected Edge (Floating)

```xml
<mxCell id="e4" value="" style="endArrow=classic;html=1;"
        edge="1" parent="1">
  <mxGeometry relative="1" as="geometry">
    <mxPoint x="100" y="200" as="sourcePoint" />
    <mxPoint x="300" y="100" as="targetPoint" />
  </mxGeometry>
</mxCell>
```

---

## 13. Complete Examples

### Example 1: Simple Flowchart

```xml
<mxfile>
  <diagram id="flowchart" name="Flowchart">
    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1"
                  tooltips="1" connect="1" arrows="1" fold="1"
                  page="1" pageScale="1" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />

        <!-- Start -->
        <mxCell id="start" value="Start" style="ellipse;whiteSpace=wrap;html=1;fillColor=#D5E8D4;strokeColor=#82B366;" vertex="1" parent="1">
          <mxGeometry x="340" y="40" width="120" height="60" as="geometry" />
        </mxCell>

        <!-- Decision -->
        <mxCell id="decision" value="Condition?" style="rhombus;whiteSpace=wrap;html=1;fillColor=#FFF2CC;strokeColor=#D6B656;" vertex="1" parent="1">
          <mxGeometry x="320" y="150" width="160" height="80" as="geometry" />
        </mxCell>

        <!-- Process A -->
        <mxCell id="procA" value="Process A" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#DAE8FC;strokeColor=#6C8EBF;" vertex="1" parent="1">
          <mxGeometry x="160" y="290" width="120" height="60" as="geometry" />
        </mxCell>

        <!-- Process B -->
        <mxCell id="procB" value="Process B" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#DAE8FC;strokeColor=#6C8EBF;" vertex="1" parent="1">
          <mxGeometry x="520" y="290" width="120" height="60" as="geometry" />
        </mxCell>

        <!-- End -->
        <mxCell id="end" value="End" style="ellipse;whiteSpace=wrap;html=1;fillColor=#F8CECC;strokeColor=#B85450;" vertex="1" parent="1">
          <mxGeometry x="340" y="420" width="120" height="60" as="geometry" />
        </mxCell>

        <!-- Edges -->
        <mxCell id="e1" style="endArrow=classic;html=1;" edge="1" parent="1" source="start" target="decision">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e2" value="Yes" style="endArrow=classic;html=1;" edge="1" parent="1" source="decision" target="procA">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e3" value="No" style="endArrow=classic;html=1;" edge="1" parent="1" source="decision" target="procB">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e4" style="endArrow=classic;html=1;" edge="1" parent="1" source="procA" target="end">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e5" style="endArrow=classic;html=1;" edge="1" parent="1" source="procB" target="end">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

### Example 2: UML Class Diagram

```xml
<mxfile>
  <diagram id="uml" name="Classes">
    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1"
                  tooltips="1" connect="1" arrows="1" fold="1"
                  page="1" pageScale="1" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />

        <!-- Class: Animal -->
        <mxCell id="animal" value="&lt;p style=&quot;margin:0px;margin-top:4px;text-align:center;&quot;&gt;&lt;i&gt;&amp;lt;&amp;lt;abstract&amp;gt;&amp;gt;&lt;/i&gt;&lt;br&gt;&lt;b&gt;Animal&lt;/b&gt;&lt;/p&gt;&lt;hr size=&quot;1&quot;/&gt;&lt;p style=&quot;margin:0px;margin-left:4px;&quot;&gt;+ name: String&lt;br&gt;+ age: int&lt;/p&gt;&lt;hr size=&quot;1&quot;/&gt;&lt;p style=&quot;margin:0px;margin-left:4px;&quot;&gt;+ speak(): void&lt;br&gt;+ move(): void&lt;/p&gt;" style="verticalAlign=top;align=left;overflow=fill;fontSize=12;fontFamily=Helvetica;html=1;whiteSpace=wrap;" vertex="1" parent="1">
          <mxGeometry x="300" y="40" width="200" height="140" as="geometry" />
        </mxCell>

        <!-- Class: Dog -->
        <mxCell id="dog" value="&lt;p style=&quot;margin:0px;margin-top:4px;text-align:center;&quot;&gt;&lt;b&gt;Dog&lt;/b&gt;&lt;/p&gt;&lt;hr size=&quot;1&quot;/&gt;&lt;p style=&quot;margin:0px;margin-left:4px;&quot;&gt;+ breed: String&lt;/p&gt;&lt;hr size=&quot;1&quot;/&gt;&lt;p style=&quot;margin:0px;margin-left:4px;&quot;&gt;+ fetch(): void&lt;/p&gt;" style="verticalAlign=top;align=left;overflow=fill;fontSize=12;fontFamily=Helvetica;html=1;whiteSpace=wrap;" vertex="1" parent="1">
          <mxGeometry x="180" y="260" width="160" height="120" as="geometry" />
        </mxCell>

        <!-- Class: Cat -->
        <mxCell id="cat" value="&lt;p style=&quot;margin:0px;margin-top:4px;text-align:center;&quot;&gt;&lt;b&gt;Cat&lt;/b&gt;&lt;/p&gt;&lt;hr size=&quot;1&quot;/&gt;&lt;p style=&quot;margin:0px;margin-left:4px;&quot;&gt;+ indoor: boolean&lt;/p&gt;&lt;hr size=&quot;1&quot;/&gt;&lt;p style=&quot;margin:0px;margin-left:4px;&quot;&gt;+ purr(): void&lt;/p&gt;" style="verticalAlign=top;align=left;overflow=fill;fontSize=12;fontFamily=Helvetica;html=1;whiteSpace=wrap;" vertex="1" parent="1">
          <mxGeometry x="460" y="260" width="160" height="120" as="geometry" />
        </mxCell>

        <!-- Inheritance: Dog extends Animal -->
        <mxCell id="e1" style="endArrow=block;endFill=0;html=1;" edge="1" parent="1" source="dog" target="animal">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <!-- Inheritance: Cat extends Animal -->
        <mxCell id="e2" style="endArrow=block;endFill=0;html=1;" edge="1" parent="1" source="cat" target="animal">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

### Example 3: Network Diagram with Groups

```xml
<mxfile>
  <diagram id="network" name="Network">
    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1"
                  tooltips="1" connect="1" arrows="1" fold="1"
                  page="1" pageScale="1" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />

        <!-- DMZ Group -->
        <mxCell id="dmz" value="DMZ" style="swimlane;startSize=25;fillColor=#F5F5F5;strokeColor=#666666;fontStyle=1;html=1;" vertex="1" parent="1">
          <mxGeometry x="50" y="50" width="300" height="200" as="geometry" />
        </mxCell>

        <!-- Firewall inside DMZ -->
        <mxCell id="fw" value="Firewall" style="shape=mxgraph.cisco.firewalls.firewall;sketch=0;html=1;whiteSpace=wrap;" vertex="1" parent="dmz">
          <mxGeometry x="100" y="60" width="80" height="60" as="geometry" />
        </mxCell>

        <!-- Internal Group -->
        <mxCell id="internal" value="Internal Network" style="swimlane;startSize=25;fillColor=#DAE8FC;strokeColor=#6C8EBF;fontStyle=1;html=1;" vertex="1" parent="1">
          <mxGeometry x="450" y="50" width="300" height="200" as="geometry" />
        </mxCell>

        <!-- Server -->
        <mxCell id="srv" value="App Server" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D5E8D4;strokeColor=#82B366;" vertex="1" parent="internal">
          <mxGeometry x="90" y="60" width="120" height="60" as="geometry" />
        </mxCell>

        <!-- Connection -->
        <mxCell id="conn" style="endArrow=classic;startArrow=classic;html=1;strokeWidth=2;" edge="1" parent="1" source="fw" target="srv">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

### Example 4: Custom Metadata with UserObject

```xml
<mxfile>
  <diagram id="metadata" name="Servers">
    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1"
                  tooltips="1" connect="1" arrows="1" fold="1"
                  page="1" pageScale="1" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />

        <!-- Server with custom attributes -->
        <UserObject id="srv1" label="Web Server" tooltip="Production web server"
                    ip="10.0.1.10" environment="production" owner="ops-team">
          <mxCell style="rounded=1;whiteSpace=wrap;html=1;fillColor=#D5E8D4;strokeColor=#82B366;" vertex="1" parent="1">
            <mxGeometry x="100" y="100" width="140" height="70" as="geometry" />
          </mxCell>
        </UserObject>

        <!-- Database with custom attributes -->
        <object id="db1" label="PostgreSQL" ip="10.0.2.20"
                environment="production" port="5432">
          <mxCell style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;fillColor=#DAE8FC;strokeColor=#6C8EBF;" vertex="1" parent="1">
            <mxGeometry x="350" y="90" width="100" height="90" as="geometry" />
          </mxCell>
        </object>

        <mxCell id="conn1" style="endArrow=classic;html=1;" edge="1" parent="1" source="srv1" target="db1">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

---

## 14. Additional mxGraphModel Attributes

These optional attributes on `<mxGraphModel>` are less commonly used but appear
in real-world files:

| Attribute | Values | Description |
|---|---|---|
| `adaptiveColors` | `auto`, `simple`, `none`, `default` | Controls color adaptation for light/dark mode viewing |

**adaptiveColors** example:
```xml
<mxGraphModel dx="0" dy="0" grid="1" ... adaptiveColors="auto">
```

AI generators typically do not need to set this attribute.

---

## 15. Validation Checklist for AI-Generated Files

Use this checklist to verify generated draw.io files:

1. **Valid XML**: File is well-formed XML with proper escaping
2. **Root element**: `<mxfile>` as root, contains at least one `<diagram>`
3. **Diagram IDs**: Each diagram has a unique `id` attribute
4. **Structural cells**: Root contains `<mxCell id="0"/>` and `<mxCell id="1" parent="0"/>`
5. **Unique IDs**: All cell IDs are unique within the diagram
6. **Parent references**: Every cell (except id="0") has a valid `parent` referencing an existing cell
7. **Type flags**: Each content cell has either `vertex="1"` or `edge="1"` (not both)
8. **Edge references**: Edge `source` and `target` reference existing vertex IDs
9. **Geometry**: Vertices have mxGeometry with x, y, width, height; edges have `relative="1"`
10. **Style format**: Style strings use `key=value;` format, valid keys and values
11. **Perimeter match**: Non-rectangular shapes have matching perimeter in style
12. **HTML escaping**: HTML in `value` attributes is properly XML-escaped
13. **Coordinate system**: x increases right, y increases down, no negative dimensions
14. **Group hierarchy**: Children of groups have coordinates relative to the group
