## Cells instead of positions (read this before you place anything)

For the diagrams of boxes and lines in the patterns below (flowcharts, swimlanes, pipelines, architecture, cloud, network, org charts, ER, UML, decision trees), don't write coordinates: give every shape its cell in one grid for the whole diagram and leave out its `mxGeometry`. The server sizes the shapes to their text, places them, draws each container around its members and routes the connectors with room for their labels. Place UI mockups, floor plans, racks and scenes yourself, as below.

- **Cells:** `row=1;col=2;` in the style (1 is the top row and the left column; only the order counts), the cell the pattern for the diagram type gives the shape. At most 6 cols, a large diagram grows down, to 8 rows. Every shape has a cell of its own.
- **Containers:** members name the container as `parent` and fill a block of cells with nothing else in it, a nested container a block in its parent's. The container itself has no cell and no geometry.
- **Lanes:** a top-level container per lane with `lane=1` in its style, its steps as children. A lane is a row (or a column) of the grid: its steps share its row, and `col` is the step of the flow over all lanes.
- **Connectors:** `edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;` with `source` and `target`, `endArrow=none` for links without a direction; no geometry, no waypoints, no `postLayout` or `routing`.
- **Sizes:** shapes of one kind get the size of the fullest one. Only a shape that needs a size of its own gets `<mxGeometry width="300" height="50" as="geometry"/>`, without x and y. Titles and legends: text cells without a cell, the first above the diagram, the rest below.
- **All or nothing:** shapes without a position in a diagram that has positions are not drawn.
- **Changing it:** send the whole XML again the same way, with the same ids and cells.
