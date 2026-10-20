XML rules:
- Skeleton: <mxGraphModel adaptiveColors="auto"><root><mxCell id="0"/><mxCell id="1" parent="0"/>…</root></mxGraphModel>. Unique ids. No XML comments.
- Vertex: <mxCell id="a" value="Label" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell>
- Edge: <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;defaultLabelBackgroundColor=page;" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>. Never self-closing. No waypoints or exitX/entryX.
- Labels: html=1 in every style; escape HTML in values (&lt;b&gt;Name&lt;/b&gt;&lt;br&gt;detail); line break &lt;br&gt;, never \n.
- Shapes: rhombus (decision), ellipse, shape=cylinder3 (database), text.
- Grid, no layout math: x=col*180+40, y=row*120+40, one node per cell; 140×60 boxes, 140×80 diamonds.
- Containers: swimlane;startSize=24; (titled) or group; (invisible); children set parent="<id>" with coordinates relative to it. An edge's parent is the innermost container holding both its ends, else "1".
- Lanes: swimlane;horizontal=0;startSize=110; at x=0, y=lane*150, height 150; nodes inside at x=120+col*180, y=45.
- Edges: orthogonal; entityRelationEdgeStyle for ER; labels 1-3 words; dashed=1 for one meaning, with a legend.
