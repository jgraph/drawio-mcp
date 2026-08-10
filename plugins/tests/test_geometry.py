"""Geometry translation and number handling (mxGeometry.translate)."""

import unittest

from helpers import (
    edge,
    fix,
    geometry_of,
    model,
    point_of,
    points_of,
    read_fixture,
    script,
    vertex,
)


class TranslationTest(unittest.TestCase):
    def test_waypoints_and_endpoints_shift_by_the_origin_delta(self):
        """Every absolute point of the edge is subtracted the new parent's
        origin, (100, 50).
        """
        xml = model(
            [
                vertex(id="c", parent="1", x=100, y=50, width=400, height=300),
                vertex(id="a", parent="c", x=20, y=20),
                vertex(id="b", parent="c", x=220, y=200),
                edge(
                    id="e",
                    parent="1",
                    source="a",
                    target="b",
                    source_point=(160, 90),
                    target_point=(360, 270),
                    offset=(5, -5),
                    points=[(200, 90), (200, 270)],
                ),
            ]
        )
        out, changes = fix(xml)

        self.assertEqual(changes, [("e", "1", "c")])
        self.assertEqual(point_of(out, "e", "sourcePoint"), ("60", "40"))
        self.assertEqual(point_of(out, "e", "targetPoint"), ("260", "220"))
        self.assertEqual(points_of(out, "e"), [("100", "40"), ("100", "220")])

    def test_offset_point_is_left_alone(self):
        """mxGeometry.translate leaves `as="offset"` where it is."""
        source = read_fixture("aws-containers.drawio")
        out, _changes = fix(source)

        self.assertEqual(
            point_of(out, "e2", "offset"), point_of(source, "e2", "offset")
        )

    def test_non_relative_geometry_position_is_translated(self):
        """A geometry without `relative` has its own x/y shifted too."""
        xml = model(
            [
                vertex(id="c", parent="1", x=100, y=50, width=400, height=300),
                vertex(id="a", parent="c", x=20, y=20),
                vertex(id="b", parent="c", x=220, y=200),
                edge(
                    id="e", parent="1", source="a", target="b", relative=False
                ),
            ]
        )
        out, _changes = fix(xml)
        geometry = geometry_of(out, "e")

        self.assertEqual(geometry.get("x"), "-100")
        self.assertEqual(geometry.get("y"), "-50")

    def test_zero_delta_leaves_the_geometry_untouched(self):
        """The container sits at the origin, so nothing has to move."""
        xml = model(
            [
                vertex(id="c", parent="1", x=0, y=0, width=400, height=300),
                vertex(id="a", parent="c", x=20, y=20),
                vertex(id="b", parent="c", x=220, y=20),
                edge(
                    id="e",
                    parent="1",
                    source="a",
                    target="b",
                    relative=False,
                    points=[(150, 40)],
                ),
            ]
        )
        out, changes = fix(xml)

        self.assertEqual(changes, [("e", "1", "c")])
        self.assertEqual(set(geometry_of(out, "e").keys()), {"as"})
        self.assertEqual(points_of(out, "e"), [("150", "40")])

    def test_fractional_coordinates_keep_their_precision(self):
        """(30, 70) less the container's (10.5, 0.25)."""
        xml = model(
            [
                vertex(
                    id="c", parent="1", x=10.5, y=0.25, width=200, height=100
                ),
                vertex(id="a", parent="c", x=0, y=0, width=10, height=10),
                vertex(id="b", parent="c", x=50, y=0, width=10, height=10),
                edge(
                    id="e",
                    parent="1",
                    source="a",
                    target="b",
                    points=[(30, 70)],
                ),
            ]
        )
        out, _changes = fix(xml)

        self.assertEqual(points_of(out, "e"), [("19.5", "69.75")])

    def test_deeply_nested_origins_add_up(self):
        xml = model(
            [
                vertex(id="c1", parent="1", x=10, y=20, width=200, height=200),
                vertex(
                    id="c2", parent="c1", x=30, y=40, width=100, height=100
                ),
                vertex(id="a", parent="c2", x=50, y=50),
                vertex(id="b", parent="c2", x=60, y=60),
                edge(
                    id="e",
                    parent="1",
                    source="a",
                    target="b",
                    relative=False,
                    points=[(70, 80)],
                ),
            ]
        )
        out, _changes = fix(xml)

        # (70 - 30 - 10, 80 - 40 - 20)
        self.assertEqual(points_of(out, "e"), [("30", "20")])


class NumberFormatTest(unittest.TestCase):
    def test_to_float_follows_javascript_parsefloat(self):
        self.assertEqual(script.to_float("12"), 12.0)
        self.assertEqual(script.to_float(" 12.5 "), 12.5)
        self.assertEqual(script.to_float("-3.5e2"), -350.0)
        self.assertEqual(script.to_float("12abc"), 12.0)

    def test_to_float_treats_unusable_values_as_zero(self):
        for value in (None, "", "abc", "0x10", "NaN"):
            self.assertEqual(script.to_float(value), 0.0, value)

    def test_format_number_matches_javascript_stringification(self):
        self.assertEqual(script.format_number(120.0), "120")
        self.assertEqual(script.format_number(-0.0), "0")
        self.assertEqual(script.format_number(12.5), "12.5")
        self.assertEqual(
            script.format_number(0.1 + 0.2), "0.30000000000000004"
        )

    def test_flag_truthiness(self):
        for value in ("1", "true", "false", "yes", "0x10", " 2 "):
            self.assertTrue(script.is_true(value), value)

        for value in (None, "", "  ", "0", "00", "0.0"):
            self.assertFalse(script.is_true(value), value)


if __name__ == "__main__":
    unittest.main()
