"""The parenting rule itself — the port of mxGraphModel.updateEdgeParent."""

import unittest

from helpers import (
    cell,
    edge,
    element_of,
    fix,
    model,
    parent_of,
    read_fixture,
    vertex,
    wrapped,
)


def port(*, id, parent):
    """A port: a child positioned relative to the cell owning it."""
    return vertex(id=id, parent=parent, width=10, height=10, relative=True)


class NearestCommonAncestorTest(unittest.TestCase):
    def test_edge_between_container_children_moves_into_the_container(self):
        xml = model(
            [
                vertex(id="box", parent="1"),
                vertex(id="a", parent="box"),
                vertex(id="b", parent="box"),
                edge(id="e", parent="1", source="a", target="b"),
            ]
        )
        out, changes = fix(xml)

        self.assertEqual(changes, [("e", "1", "box")])
        self.assertEqual(parent_of(out, "e"), "box")

    def test_edge_leaving_the_container_stays_on_the_layer(self):
        xml = model(
            [
                vertex(id="box", parent="1"),
                vertex(id="a", parent="box"),
                vertex(id="out", parent="1"),
                edge(id="e", parent="1", source="a", target="out"),
            ]
        )
        out, changes = fix(xml)

        self.assertEqual(changes, [])
        self.assertEqual(out, xml)

    def test_deeply_nested_common_ancestor(self):
        """The AWS sample: `alb` and `ecs` sit in different subnets of `vpc`,
        so the edge between them belongs to `vpc`.
        """
        _out, changes = fix(read_fixture("aws-containers.drawio"))

        self.assertEqual(changes, [("e2", "1", "vpc")])

    def test_terminal_that_is_an_ancestor_of_the_other(self):
        xml = model(
            [
                vertex(id="box", parent="1"),
                vertex(id="a", parent="box"),
                edge(id="e", parent="1", source="a", target="box"),
            ]
        )
        _out, changes = fix(xml)

        self.assertEqual(changes, [("e", "1", "box")])

    def test_self_loop_takes_the_parent_of_its_terminal(self):
        xml = model(
            [
                vertex(id="box", parent="1"),
                vertex(id="a", parent="box"),
                edge(id="e", parent="1", source="a", target="a"),
            ]
        )
        _out, changes = fix(xml)

        self.assertEqual(changes, [("e", "1", "box")])

    def test_edge_inside_a_container_is_moved_back_up_to_the_layer(self):
        xml = model(
            [
                vertex(id="box", parent="1"),
                vertex(id="a", parent="1"),
                vertex(id="b", parent="1"),
                edge(id="e", parent="box", source="a", target="b"),
            ]
        )
        _out, changes = fix(xml)

        self.assertEqual(changes, [("e", "box", "1")])

    def test_edges_are_never_moved_between_layers(self):
        xml = model(
            [
                cell(id="2", parent="0", value="Other layer"),
                vertex(id="a", parent="2"),
                vertex(id="b", parent="2"),
                edge(id="e", parent="1", source="a", target="b"),
            ]
        )
        out, changes = fix(xml)

        self.assertEqual(changes, [])
        self.assertEqual(out, xml)


class TerminalResolutionTest(unittest.TestCase):
    def test_relative_source_resolves_to_its_owner(self):
        xml = model(
            [
                vertex(id="box", parent="1"),
                vertex(id="n1", parent="box"),
                port(id="p1", parent="n1"),
                edge(id="e", parent="1", source="p1", target="n1"),
            ]
        )
        _out, changes = fix(xml)

        self.assertEqual(changes, [("e", "1", "box")])

    def test_relative_target_is_not_resolved(self):
        """draw.io sets ignoreRelativeEdgeParent=false, unlike bare mxGraph.

        Resolving the target would make this a self-loop landing on "box";
        draw.io keeps the edge inside "n2", the cell owning the port.
        """
        xml = model(
            [
                vertex(id="box", parent="1"),
                vertex(id="n2", parent="box"),
                port(id="p2", parent="n2"),
                edge(id="e", parent="1", source="n2", target="p2"),
            ]
        )
        _out, changes = fix(xml)

        self.assertEqual(changes, [("e", "1", "n2")])

    def test_missing_terminal_is_left_alone(self):
        xml = model(
            [
                vertex(id="box", parent="1"),
                vertex(id="a", parent="box"),
                edge(id="e", parent="1", source="a", target="nowhere"),
            ]
        )
        out, changes = fix(xml)

        self.assertEqual(changes, [])
        self.assertEqual(out, xml)

    def test_edge_without_a_parent_is_outside_the_model_tree(self):
        xml = model(
            [
                vertex(id="box", parent="1"),
                vertex(id="a", parent="box"),
                vertex(id="b", parent="box"),
                edge(
                    id="e", parent=None, source="a", target="b", geometry=False
                ),
            ]
        )
        out, changes = fix(xml)

        self.assertEqual(changes, [])
        self.assertEqual(out, xml)


class CellIdentityTest(unittest.TestCase):
    def test_object_wrapper_carries_the_id(self):
        xml = model(
            [
                wrapped(vertex(id=None, parent="1"), id="box"),
                wrapped(vertex(id=None, parent="box"), id="a"),
                wrapped(vertex(id=None, parent="box"), id="b"),
                wrapped(
                    edge(id=None, parent="1", source="a", target="b"),
                    id="e",
                ),
            ]
        )
        out, changes = fix(xml)
        wrapper = element_of(out, "e")
        wrapped_cell = wrapper.find("mxCell")

        self.assertEqual(changes, [("e", "1", "box")])
        self.assertEqual(wrapper.tag, "object")
        self.assertIsNone(wrapped_cell.get("id"))
        self.assertEqual(wrapped_cell.get("parent"), "box")

    def test_flag_truthiness_matches_mxgraph(self):
        """mxCell.isEdge() is `edge != 0`: only 0 and "" are false."""
        xml = model(
            [
                vertex(id="box", parent="1"),
                vertex(id="a", parent="box"),
                vertex(id="b", parent="box"),
                *(
                    edge(
                        id=f"e{index}",
                        parent="1",
                        source="a",
                        target="b",
                        flag=flag,
                    )
                    for index, flag in enumerate(
                        ("1", "true", "false", "0", "")
                    )
                ),
            ]
        )
        _out, changes = fix(xml)

        self.assertEqual(
            changes,
            [("e0", "1", "box"), ("e1", "1", "box"), ("e2", "1", "box")],
        )


if __name__ == "__main__":
    unittest.main()
