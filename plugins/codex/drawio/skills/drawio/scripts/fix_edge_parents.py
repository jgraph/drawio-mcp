#!/usr/bin/env python3
"""Reparent draw.io edges onto the nearest common ancestor of their endpoints.

draw.io (mxGraph) expects the ``parent`` of an edge to be the nearest
common ancestor of its ``source`` and ``target`` cells.  Generated diagrams
usually put every edge on the default layer (``parent="1"``) instead, which
renders fine but makes the layout passes (Arrange > Layout, ``--layout``)
lay the diagram out wrongly.  This script rewrites those ``parent``
attributes, applying the same rule as ``mxGraphModel.updateEdgeParent``, and
shifts any absolute edge geometry (waypoints, source/target points) so the
edge keeps its on-screen position.

Usage:
    fix_edge_parents.py diagram.drawio            # fix in place
    fix_edge_parents.py a.drawio b.drawio         # fix several files
    fix_edge_parents.py --dry-run diagram.drawio  # report only, write nothing
    cat diagram.drawio | fix_edge_parents.py -    # stdin to stdout

Reads ``.drawio``/``.xml`` files holding either a bare ``<mxGraphModel>`` or an
``<mxfile>`` (every page is processed, compressed pages included).  Everything
except the attributes it has to change is preserved byte for byte.

Ported from the mxGraph copy bundled with draw.io v31.1.8, specifically
``mxGraphModel.updateEdgeParent`` and the helpers it calls.  The paths below
are relative to

    https://github.com/jgraph/drawio/blob/v31.1.8/src/main/webapp/

    updateEdgeParent          mxgraph/src/model/mxGraphModel.js#L832-L885
    getOrigin                 mxgraph/src/model/mxGraphModel.js#L893-L918
    getNearestCommonAncestor  mxgraph/src/model/mxGraphModel.js#L930-L970
    mxGeometry.translate      mxgraph/src/model/mxGeometry.js#L299-L337

draw.io then overrides one of the flags they read:

    ignoreRelativeEdgeParent = false    js/grapheditor/Graph.js#L175

Those upstream files carry the following copyright notices:

    mxGraphModel.js: Copyright (c) 2006-2018, JGraph Holdings Ltd
                     Copyright (c) 2006-2018, draw.io AG
    mxGeometry.js:   Copyright (c) 2006-2015, JGraph Holdings Ltd
                     Copyright (c) 2006-2015, draw.io AG

See https://github.com/jgraph/drawio/blob/v31.1.8/LICENSE for the terms they
are published under.
"""

# Outline:
#
# 1. Parse the XML document with the Expat parser and record the byte offsets
#    of each element.
# 2. Rewrite attributes in the in-memory model. Record updated attributes.
# 3. Update attributes in the source document.

import argparse
import base64
import re
import sys
import urllib.parse
import zlib
from xml.parsers import expat

WRAPPER_ELEMENTS = ("object", "UserObject")

TAG_NAME_RE = re.compile(rb"<([^\s/>]+)")
ATTRIBUTE_RE = re.compile(rb"\s*([^\s=/>]+)\s*=\s*(\"[^\"]*\"|'[^']*')")
NUMBER_RE = re.compile(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?")

# mxGraph defaults this to true; draw.io turns it off, "Keeps edges between
# relative child cells inside parent" (js/grapheditor/Graph.js).
IGNORE_RELATIVE_EDGE_PARENT = False


def is_true(value):
    """Convert an attribute value to a boolean.

    Only a missing, empty or numerically zero value is false — every other
    spelling (``1``, ``true``, even ``false``) is true.
    """
    if value is None or value.strip() == "":
        return False

    try:
        return float(value) != 0
    except ValueError:
        return True


def to_float(value):
    """Convert an attribute value to a float.

    A missing, unparsable or non-finite value reads as 0.
    """
    # mxObjectCodec.convertAttributeFromXml runs parseFloat over the raw
    # attribute and substitutes 0 for NaN and infinities.
    match = NUMBER_RE.match(value.lstrip()) if value is not None else None

    if match is None:
        return 0.0

    number = float(match.group(0))

    return number if -float("inf") < number < float("inf") else 0.0


def format_number(value):
    """Render a float value like JavaScript."""
    if value == int(value):
        return str(int(value))

    return repr(value)


class Node:
    """One XML element, with the byte offsets of its tags."""

    __slots__ = ("attrs", "children", "end", "parent", "start", "tag", "text")

    def __init__(self, tag, attrs, parent, start):
        self.tag = tag
        self.attrs = attrs
        self.parent = parent
        self.children = []
        self.start = start
        self.end = start
        self.text = []

    def first(self, tag):
        """Return the first direct child with the given tag name."""
        for child in self.children:
            if child.tag == tag:
                return child

        return None

    def walk(self):
        """Yield this node and every descendant, in document order."""
        yield self

        for child in self.children:
            yield from child.walk()


def parse_document(data):
    """Parse XML bytes into a Node tree that remembers tag offsets.

    Raises expat.ExpatError unless the document is well formed.
    """
    # CurrentByteIndex is what makes the byte-level patching possible: it
    # locates each start tag in the original bytes.
    #
    # > During a callback reporting a parse event they indicate the location
    # > of the first of the sequence of characters that generated the event.
    #
    # https://docs.python.org/3.9/library/pyexpat.html
    document = Node("#document", {}, None, -1)
    stack = [document]
    parser = expat.ParserCreate()

    def start_element(tag, attrs):
        node = Node(tag, attrs, stack[-1], parser.CurrentByteIndex)
        stack[-1].children.append(node)
        stack.append(node)

    def end_element(tag):
        stack[-1].end = parser.CurrentByteIndex
        stack.pop()

    def character_data(data):
        # The text contents is processed later only for <diagram>.
        if stack[-1].tag == "diagram":
            stack[-1].text.append(data)

    parser.StartElementHandler = start_element
    parser.EndElementHandler = end_element
    parser.CharacterDataHandler = character_data
    parser.Parse(data, True)

    return document


class Cell:
    """An mxCell."""

    __slots__ = ("geometry", "id", "node")

    # Note that ``cell_id`` may be the ``id`` of the wrapper ``object`` or
    # ``UserObject``. So we keep it explicitly aside from the ``node``.
    def __init__(self, cell_id, node, geometry):
        self.id = cell_id
        self.node = node
        self.geometry = geometry


class GraphModel:
    """The cells of one ``<mxGraphModel>``, with the mxGraph tree helpers."""

    def __init__(self, root_node):
        # Dictionary from id to cell.
        self.cells = {}
        self.cell_list = []

        # When a cell is wrapped in ``object`` or ``UserObject``, its id is
        # the attribute of the wrapper.
        for child in root_node.children:
            if child.tag == "mxCell":
                node = child
                cell_id = child.attrs.get("id")
            elif child.tag in WRAPPER_ELEMENTS:
                node = child.first("mxCell")
                cell_id = child.attrs.get("id")
            else:
                continue

            if node is None or cell_id is None or cell_id in self.cells:
                continue

            cell = Cell(cell_id, node, node.first("mxGeometry"))
            self.cells[cell_id] = cell
            self.cell_list.append(cell)

        self.root = self._find_root()

    def _find_root(self):
        """The model root — the last parentless cell (normally id="0")."""
        # mxGraphModelCodec.decodeRoot keeps the last parentless cell it
        # decodes as the root.
        root = None

        for cell in self.cell_list:
            if self.get_parent(cell) is None:
                root = cell

        return root

    def get_parent(self, cell):
        parent_id = cell.node.attrs.get("parent")

        # mxCodec cannot build a cell that is its own parent, so upstream
        # never sees one; here it is read as parentless to keep walks finite.
        if parent_id is None or parent_id == cell.id:
            return None

        return self.cells.get(parent_id)

    def is_edge(self, cell):
        return is_true(cell.node.attrs.get("edge"))

    def ancestors(self, cell):
        """The cell itself, then every ancestor up to the root."""
        chain = []
        seen = set()
        current = cell

        while current is not None and current.id not in seen:
            seen.add(current.id)
            chain.append(current)
            current = self.get_parent(current)

        return chain

    def is_ancestor(self, parent, child):
        return any(cell is parent for cell in self.ancestors(child))

    def get_nearest_common_ancestor(self, cell1, cell2):
        """The deepest cell that is an ancestor of both.

        A candidate whose own parent is null (the model root) is not
        returned, matching getNearestCommonAncestor.
        """
        path = {cell.id for cell in self.ancestors(cell2)}

        for cell in self.ancestors(cell1):
            if cell.id in path:
                return cell if self.get_parent(cell) is not None else None

        return None

    def get_origin(self, cell):
        """Absolute offset of a cell's coordinates (mxGraph getOrigin)."""
        # mxGraphModel.getOrigin recurses up to the root; we use an iteration
        # instead.
        x = 0.0
        y = 0.0

        for current in self.ancestors(cell):
            if self.is_edge(current) or current.geometry is None:
                continue

            x += to_float(current.geometry.attrs.get("x"))
            y += to_float(current.geometry.attrs.get("y"))

        return x, y

    def get_terminal(self, edge, is_source):
        """The cell an edge points at, before any relative resolution.

        If is_source is True, return the source cell. Return the target cell
        otherwise.
        """
        attribute = "source" if is_source else "target"

        return self.cells.get(edge.node.attrs.get(attribute))


def set_attribute(node, name, value, edits):
    """Record an attribute change and apply it to the in-memory model."""
    node.attrs[name] = value
    edits.append((node, name, value))


def translate_point(node, dx, dy, edits):
    x = to_float(node.attrs.get("x")) + dx
    y = to_float(node.attrs.get("y")) + dy
    set_attribute(node, "x", format_number(x), edits)
    set_attribute(node, "y", format_number(y), edits)


def translate(geo, dx, dy, edits):
    """Shift an edge geometry, mirroring mxGeometry.translate."""
    # mxGeometry.translate has no such early return.  Skipping a zero delta
    # keeps the file byte-identical when both origins coincide.
    if dx == 0 and dy == 0:
        return

    # Translates the geometry
    if not is_true(geo.attrs.get("relative")):
        translate_point(geo, dx, dy, edits)

    for child in geo.children:
        tag = child.tag
        role = child.attrs.get("as")

        # Translates the source and target points
        if tag == "mxPoint" and role in ("sourcePoint", "targetPoint"):
            translate_point(child, dx, dy, edits)
        elif tag == "Array" and role == "points":
            # Translate the control points
            for point in child.children:
                if point.tag == "mxPoint":
                    translate_point(point, dx, dy, edits)


def update_edge_parent(model, edge, root, edits):
    """Move one edge onto the nearest common ancestor of its terminals.

    Returns an (edge id, old parent id, new parent id) tuple when the edge
    was moved, otherwise None.
    """
    # Transcribed statement by statement from mxGraphModel.updateEdgeParent.
    # The `seen` sets are the one addition: they stop the terminal walks on a
    # parent cycle, which the JavaScript loops on forever.
    source = model.get_terminal(edge, True)
    target = model.get_terminal(edge, False)
    seen = set()

    # Uses the first non-relative descendants of the source terminal
    while (
        source is not None
        and source.id not in seen
        and not model.is_edge(source)
        and source.geometry is not None
        and is_true(source.geometry.attrs.get("relative"))
    ):
        seen.add(source.id)
        source = model.get_parent(source)

    seen = set()

    # Uses the first non-relative descendants of the target terminal
    while (
        target is not None
        and target.id not in seen
        and IGNORE_RELATIVE_EDGE_PARENT
        and not model.is_edge(target)
        and target.geometry is not None
        and is_true(target.geometry.attrs.get("relative"))
    ):
        seen.add(target.id)
        target = model.get_parent(target)

    if not (
        model.is_ancestor(root, source) and model.is_ancestor(root, target)
    ):
        return None

    if source is target:
        cell = model.get_parent(source)
    else:
        cell = model.get_nearest_common_ancestor(source, target)

    if (
        cell is None
        or (
            model.get_parent(cell) is model.root
            and not model.is_ancestor(cell, edge)
        )
        or model.get_parent(edge) is cell
    ):
        return None

    old_parent = model.get_parent(edge)
    geo = edge.geometry

    if geo is not None:
        origin1 = model.get_origin(old_parent)
        origin2 = model.get_origin(cell)

        dx = origin2[0] - origin1[0]
        dy = origin2[1] - origin1[1]

        translate(geo, -dx, -dy, edits)

    set_attribute(edge.node, "parent", cell.id, edits)

    return (
        edge.id,
        old_parent.id if old_parent is not None else None,
        cell.id,
    )


def fix_model(model, edits):
    """Reparent every edge of one model.

    Returns a list of (edge id, old, new) tuples.
    """
    changes = []
    root = model.root

    if root is None:
        return changes

    for edge in model.cell_list:
        if not model.is_edge(edge) or not model.is_ancestor(root, edge):
            continue

        change = update_edge_parent(model, edge, root, edits)

        if change is not None:
            changes.append(change)

    return changes


def escape_attribute(value):
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def scan_start_tag(data, start):
    """Take apart the start tag at `start`.

    Returns the offset just past its ``>``, the value span of each attribute,
    and the offset at which a new attribute can be inserted.
    """
    # The tag comes from a completed parse, so its syntax is known good.
    position = TAG_NAME_RE.match(data, start).end()
    values = {}

    while True:
        attribute = ATTRIBUTE_RE.match(data, position)

        if attribute is None:
            break

        span = (attribute.start(2) + 1, attribute.end(2) - 1)
        values[attribute.group(1)] = span
        position = attribute.end()

    # Only whitespace and an optional '/' can precede the closing '>' here.
    return data.index(b">", position) + 1, values, position


def build_attribute_patches(data, edits):
    """Turn recorded attribute edits into (start, end, replacement) patches."""
    grouped = {}

    for node, name, value in edits:
        grouped.setdefault(id(node), (node, []))[1].append((name, value))

    patches = []

    for node, attribute_edits in grouped.values():
        values, insert_at = scan_start_tag(data, node.start)[1:]
        added = b""

        for name, value in attribute_edits:
            encoded_name = name.encode("utf-8")
            encoded_value = escape_attribute(value).encode("utf-8")
            span = values.get(encoded_name)

            if span is None:
                added += b" " + encoded_name + b'="' + encoded_value + b'"'
            else:
                patches.append((span[0], span[1], encoded_value))

        if added:
            patches.append((insert_at, insert_at, added))

    return patches


def apply_patches(data, patches):
    for start, end, replacement in sorted(patches, reverse=True):
        data = data[:start] + replacement + data[end:]

    return data


def decode_diagram(text):
    """Decode draw.io's deflateRaw + base64 page payload, or None."""
    try:
        inflated = zlib.decompress(base64.b64decode(text, validate=True), -15)

        return urllib.parse.unquote(inflated.decode("utf-8"))
    except (ValueError, zlib.error, UnicodeDecodeError):
        return None


def encode_diagram(xml):
    """Re-encode a page payload the way draw.io writes it."""
    compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
    quoted = urllib.parse.quote(xml, safe="!~*'()").encode("utf-8")
    deflated = compressor.compress(quoted) + compressor.flush()

    return base64.b64encode(deflated)


def fix_xml(data):
    """Fix every model in an XML document; returns (new bytes, changes)."""
    # Patching by byte offset assumes markup is one byte per character, which
    # holds for UTF-8 and the single-byte encodings but not for UTF-16/32.
    if data.startswith((b"\xff\xfe", b"\xfe\xff")) or b"\x00" in data[:4]:
        raise ValueError(
            "UTF-16/UTF-32 is not supported; save the file as UTF-8"
        )

    document = parse_document(data)
    # Three collections travel through the run, none of them from mxGraph:
    #   edits    (node, attribute, value) — every attribute the model layer
    #            wants rewritten, filled in by update_edge_parent
    #   changes  (edge id, old parent id, new parent id) — the same work as
    #            seen by the caller, which is what gets reported
    #   patches  (start, end, bytes) — byte spans of `data` to splice, built
    #            from `edits` plus any page re-encoded after a nested fix
    edits = []
    changes = []
    patches = []

    for node in document.walk():
        if node.tag == "mxGraphModel":
            root_node = node.first("root")

            if root_node is not None:
                changes.extend(fix_model(GraphModel(root_node), edits))
        elif node.tag == "diagram" and node.first("mxGraphModel") is None:
            payload = "".join(node.text).strip()

            if not payload:
                continue

            inner = decode_diagram(payload)

            if inner is None:
                continue

            fixed, inner_changes = fix_xml(inner.encode("utf-8"))

            if inner_changes:
                changes.extend(inner_changes)
                # Replace the whole content. This replaces any comments and
                # other non-text contents in the element.
                start = scan_start_tag(data, node.start)[0]
                payload = encode_diagram(fixed.decode("utf-8"))
                patches.append((start, node.end, payload))

    patches.extend(build_attribute_patches(data, edits))

    return apply_patches(data, patches), changes


def report(label, changes, stream):
    if not changes:
        stream.write(f"{label}: no edge parents to fix\n")

        return

    stream.write(f"{label}: {len(changes)} edge parent(s) fixed\n")

    for edge_id, old_parent, new_parent in changes:
        old = "" if old_parent is None else old_parent
        stream.write(f'  {edge_id}: parent="{old}" -> parent="{new_parent}"\n')


def process(path, options):
    """Fix one file (or stdin when path is '-'); returns the change count."""
    if path == "-":
        data = sys.stdin.buffer.read()
    else:
        with open(path, "rb") as handle:
            data = handle.read()

    fixed, changes = fix_xml(data)

    if path == "-":
        sys.stdout.buffer.write(data if options.dry_run else fixed)
    elif changes and not options.dry_run:
        with open(path, "wb") as handle:
            handle.write(fixed)

    if not options.quiet:
        report("<stdin>" if path == "-" else path, changes, sys.stderr)

    return len(changes)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Set every draw.io edge's parent to the nearest common "
        "ancestor of its source and target."
    )
    parser.add_argument(
        "files",
        metavar="FILE",
        nargs="+",
        help=".drawio/.xml file to fix in place ('-' for stdin to stdout)",
    )
    parser.add_argument(
        "-n",
        "--dry-run",
        action="store_true",
        help="report what would change without writing files",
    )
    parser.add_argument(
        "-q",
        "--quiet",
        action="store_true",
        help="suppress the per-file report",
    )
    options = parser.parse_args(argv)
    status = 0

    for path in options.files:
        try:
            process(path, options)
        except (OSError, ValueError, expat.ExpatError) as error:
            sys.stderr.write(f"{path}: {error}\n")
            status = 1

    return status


if __name__ == "__main__":
    sys.exit(main())
