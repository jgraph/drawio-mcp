"""Shared helpers for the fix_edge_parents.py tests."""

import base64
import sys
import urllib.parse
import zlib
from pathlib import Path
from xml.etree import ElementTree

sys.path.append(
    str(
        Path(__file__).resolve().parent.parent
        / "claude-code/skills/drawio/scripts"
    )
)

import fix_edge_parents as script

TESTS_DIR = Path(__file__).resolve().parent
PLUGINS_DIR = TESTS_DIR.parent
FIXTURES = TESTS_DIR / "fixtures"

SCRIPT = PLUGINS_DIR / "claude-code/skills/drawio/scripts/fix_edge_parents.py"

WRAPPER_TAGS = ("object", "UserObject")


def fix(xml):
    """Run the fixer over an XML string; returns (output string, changes)."""
    fixed, changes = script.fix_xml(xml.encode("utf-8"))

    return fixed.decode("utf-8"), changes


def cell(*, id=None, parent=None, geometry=None, **attributes):
    """An mxCell element; a layer when it carries no vertex or edge flag."""
    element = ElementTree.Element("mxCell")

    if id is not None:
        element.set("id", id)

    for name, value in attributes.items():
        element.set(name, str(value))

    if parent is not None:
        element.set("parent", parent)

    if geometry is not None:
        element.append(geometry)

    return element


def vertex(
    *, id, parent, x=0, y=0, width=80, height=40, relative=False, **attributes
):
    """A vertex mxCell with its geometry."""
    geometry = ElementTree.Element(
        "mxGeometry",
        {"x": str(x), "y": str(y), "width": str(width), "height": str(height)},
    )

    if relative:
        geometry.set("relative", "1")

    geometry.set("as", "geometry")

    return cell(
        id=id, parent=parent, geometry=geometry, **attributes, vertex="1"
    )


def edge(
    *,
    id,
    parent,
    source,
    target,
    flag="1",
    relative=True,
    points=None,
    source_point=None,
    target_point=None,
    offset=None,
    geometry=True,
    **attributes,
):
    """An edge mxCell, with the geometry its waypoints and end points need."""
    element = cell(id=id, parent=parent, **attributes, edge=flag)
    element.set("source", source)
    element.set("target", target)

    if not geometry:
        return element

    geo = ElementTree.SubElement(element, "mxGeometry")

    if relative:
        geo.set("relative", "1")

    geo.set("as", "geometry")

    for name, point in (
        ("sourcePoint", source_point),
        ("targetPoint", target_point),
        ("offset", offset),
    ):
        if point is not None:
            ElementTree.SubElement(
                geo,
                "mxPoint",
                {"x": str(point[0]), "y": str(point[1]), "as": name},
            )

    if points:
        array = ElementTree.SubElement(geo, "Array", {"as": "points"})

        for point in points:
            ElementTree.SubElement(
                array, "mxPoint", {"x": str(point[0]), "y": str(point[1])}
            )

    return element


def wrapped(inner, *, element="object", **attributes):
    """An <object>/<UserObject> holding a cell, as draw.io writes a cell
    that carries metadata."""
    wrapper = ElementTree.Element(element, {})

    for name, value in attributes.items():
        wrapper.set(name, str(value))

    wrapper.append(inner)

    return wrapper


def model(cells, *, prolog=""):
    """Serialize cells into a minimal mxGraphModel document."""
    root = ElementTree.Element("mxGraphModel")
    cell_parent = ElementTree.SubElement(root, "root")
    cell_parent.append(cell(id="0"))
    cell_parent.append(cell(id="1", parent="0"))

    for element in cells:
        cell_parent.append(element)

    ElementTree.indent(root, space="  ")
    markup = ElementTree.tostring(root, encoding="unicode")

    return prolog + markup.replace(" />", "/>") + "\n"


def compress(xml):
    """Encode a page payload the way draw.io writes a compressed diagram."""
    compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
    quoted = urllib.parse.quote(xml, safe="!~*'()").encode("utf-8")
    deflated = compressor.compress(quoted) + compressor.flush()

    return base64.b64encode(deflated).decode("ascii")


def decompress(payload):
    """Decode a compressed page payload back to XML."""
    inflated = zlib.decompress(base64.b64decode(payload), -15)

    return urllib.parse.unquote(inflated.decode("utf-8"))


def read_fixture(name):
    """Fixture contents as text."""
    return (FIXTURES / name).read_text(encoding="utf-8")


def read_fixture_bytes(name):
    """Fixture contents as bytes."""
    return (FIXTURES / name).read_bytes()


def element_of(xml, element_id):
    """The element carrying that id, whatever its tag."""
    return ElementTree.fromstring(xml).find(f'.//*[@id="{element_id}"]')


def text_of(xml, element_id):
    """The text content of the element with the given id and its descendants."""
    return "".join(element_of(xml, element_id).itertext())


def mxcell_of(xml, cell_id):
    """The mxCell holding that cell's attributes, unwrapped if needed."""
    element = element_of(xml, cell_id)

    if element is not None and element.tag in WRAPPER_TAGS:
        return element.find("mxCell")

    return element


def parent_of(xml, cell_id):
    """The parent attribute of a cell."""
    cell = mxcell_of(xml, cell_id)

    return None if cell is None else cell.get("parent")


def geometry_of(xml, cell_id):
    """The mxGeometry of a cell."""
    return mxcell_of(xml, cell_id).find("mxGeometry")


def points_of(xml, cell_id):
    """The waypoints of an edge, as (x, y) attribute strings."""
    array = geometry_of(xml, cell_id).find('Array[@as="points"]')

    if array is None:
        return []

    return [
        (point.get("x"), point.get("y")) for point in array.findall("mxPoint")
    ]


def point_of(xml, cell_id, name):
    """A named mxPoint of a geometry, as (x, y) attribute strings."""
    point = geometry_of(xml, cell_id).find(f'mxPoint[@as="{name}"]')

    return None if point is None else (point.get("x"), point.get("y"))
