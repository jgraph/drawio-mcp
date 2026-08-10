"""Input formats, encodings, and the byte-preserving guarantee."""

import codecs
import re
import unittest

from helpers import (
    compress,
    decompress,
    edge,
    element_of,
    fix,
    model,
    mxcell_of,
    parent_of,
    read_fixture,
    read_fixture_bytes,
    script,
    text_of,
    vertex,
)


MODEL = model(
    [
        vertex(id="c", parent="1", x=10, y=20, width=300, height=200),
        vertex(id="a", parent="c", x=0, y=0),
        vertex(id="b", parent="c", x=100, y=0),
        edge(id="e", parent="1", source="a", target="b"),
    ]
)
EXPECTED_CHANGE = ("e", "1", "c")
EDGE_ID = "e"
EXPECTED_PARENT = "c"


def model_with_edge_attribute(attribute, *, prolog=""):
    """A model whose edge carries `attribute` as its value attribute.

    `attribute` is a raw string in form ``value="..."`` or ``value='...'``.
    Special characters in it are not replaced with entity references.
    """
    xml = model(
        [
            vertex(id="c", parent="1", x=10, y=20, width=300, height=200),
            vertex(id="a", parent="c", x=0, y=0),
            vertex(id="b", parent="c", x=100, y=0),
            edge(
                id="e", parent="1", source="a", target="b", value="PLACEHOLDER"
            ),
        ],
        prolog=prolog,
    )

    return re.sub(r"""value=["']PLACEHOLDER["']""", attribute, xml, count=1)


def page_with_text(content, id="p", name="C"):
    """A page (<diagram>) with the given raw content."""
    return f'<diagram id="{id}" name="{name}">{content}</diagram>'


def file_with_pages(*pages):
    """An mxfile holding given raw pages."""
    separator = "\n  "

    return f"<mxfile>\n  {separator.join(pages)}\n</mxfile>\n"


class BytePreservationTest(unittest.TestCase):
    def test_only_the_parent_attribute_changes(self):
        original = read_fixture_bytes("aws-containers.drawio")
        expected = read_fixture_bytes("aws-containers.expected.drawio")
        fixed, changes = script.fix_xml(original)

        self.assertEqual(fixed, expected)
        self.assertEqual(changes, [("e2", "1", "vpc")])

    def test_a_second_run_is_a_no_op(self):
        expected = read_fixture_bytes("aws-containers.expected.drawio")
        fixed, changes = script.fix_xml(expected)

        self.assertEqual(fixed, expected)
        self.assertEqual(changes, [])

    def test_an_attribute_value_that_looks_like_a_parent_attribute(self):
        """A `parent="1"` inside a value must not be taken for the real one."""
        out, _changes = fix(
            model_with_edge_attribute("""value='parent="1"'""")
        )

        self.assertEqual(parent_of(out, EDGE_ID), EXPECTED_PARENT)
        self.assertEqual(mxcell_of(out, EDGE_ID).get("value"), 'parent="1"')

    def test_character_references_in_unchanged_attributes_are_keeped(self):
        out, _changes = fix(
            # value="ABC & <b>"
            model_with_edge_attribute('value="A&#66;C &#38; &lt;b&gt;"')
        )

        self.assertIn('value="A&#66;C &#38; &lt;b&gt;"', out)
        self.assertEqual(mxcell_of(out, EDGE_ID).get("value"), "ABC & <b>")

    def test_quoting_style_keeped(self):
        out, _changes = fix(model_with_edge_attribute("value='foo'"))

        self.assertIn("value='foo'", out)
        self.assertEqual(mxcell_of(out, EDGE_ID).get("value"), "foo")

    def test_xml_declaration(self):
        prolog = '<?xml version="1.0" encoding="UTF-8"?>\n'
        fixed, _changes = fix(prolog + MODEL)

        self.assertTrue(
            fixed.startswith('<?xml version="1.0" encoding="UTF-8"?>')
        )


class DocumentShapeTest(unittest.TestCase):
    """.drawio files may contain multiple pages and compressed contents."""

    def test_bare_mxgraphmodel(self):
        _out, changes = fix(MODEL)

        self.assertEqual(changes, [EXPECTED_CHANGE])

    def test_mxfile_processes_every_page(self):
        page1 = model(
            [
                vertex(id="c1", parent="1", x=10, y=20, width=300, height=200),
                vertex(id="a1", parent="c1", x=0, y=0),
                vertex(id="b1", parent="c1", x=100, y=0),
                edge(id="e1", parent="1", source="a1", target="b1"),
            ]
        )
        page2 = model(
            [
                vertex(id="c2", parent="1", x=10, y=20, width=300, height=200),
                vertex(id="a2", parent="c2", x=0, y=0),
                vertex(id="b2", parent="c2", x=100, y=0),
                edge(id="e2", parent="1", source="a2", target="b2"),
            ]
        )
        xml = file_with_pages(
            page_with_text(page1, id="page-1", name="Uncompressed"),
            page_with_text(compress(page2), id="page-2", name="Compressed"),
        )
        out, changes = fix(xml)
        page2_fixed = decompress(text_of(out, "page-2"))

        self.assertEqual(changes, [("e1", "1", "c1"), ("e2", "1", "c2")])
        self.assertEqual(element_of(out, "page-1").get("name"), "Uncompressed")
        self.assertEqual(element_of(out, "page-2").get("name"), "Compressed")
        self.assertEqual(parent_of(out, "e1"), "c1")
        self.assertEqual(parent_of(page2_fixed, "e2"), "c2")

    def test_compressed_page_is_re_encoded_the_same_way(self):
        xml = file_with_pages(
            page_with_text(
                compress(model_with_edge_attribute('value="😀"')),
                id="p",
            )
        )
        out, _changes = fix(xml)
        payload = text_of(out, "p")
        page = decompress(payload)

        self.assertEqual(mxcell_of(page, EDGE_ID).get("value"), "😀")

    def test_page_without_content_is_skipped(self):
        for closer in ("></diagram>", "/>"):
            with self.subTest(content=closer):
                xml = '<mxfile><diagram id="p"' + closer + "</mxfile>\n"
                out, changes = fix(xml)

                self.assertEqual(changes, [])
                self.assertEqual(out, xml)

    def test_page_with_unreadable_payload_is_skipped(self):
        xml = file_with_pages(page_with_text("nope"))
        out, changes = fix(xml)

        self.assertEqual(changes, [])
        self.assertEqual(out, xml)

    def test_payload_is_read_around_comments_and_cdata(self):
        payload = compress(MODEL)
        contents = {
            "no comments": payload,
            "comment first": "<!-- note -->" + payload,
            "comment last": payload + "<!-- note -->",
            "comment inside": payload[:10] + "<!--x-->" + payload[10:],
            "cdata": f"{payload[:5]}<![CDATA[{payload[5:10]}]]>{payload[10:]}",
            "character reference": f"&#{ord(payload[0])};{payload[1:]}",
            "surrounding space": f"\n      {payload}\n    ",
        }

        for name, content in contents.items():
            with self.subTest(content=name):
                out, changes = fix(
                    file_with_pages(page_with_text(content, id="p"))
                )
                fixed_page = decompress(text_of(out, "p"))

                edge_id, _old, new_parent = EXPECTED_CHANGE

                self.assertEqual(changes, [EXPECTED_CHANGE])
                self.assertEqual(parent_of(fixed_page, edge_id), new_parent)

    def test_a_rewritten_page_holds_nothing_but_the_payload(self):
        xml = file_with_pages(
            page_with_text("<!-- note -->" + compress(MODEL))
        )
        out, _changes = fix(xml)
        fixed_model, _changes = fix(MODEL)
        # Comments around the fixed compressed content are removed.
        expected = file_with_pages(page_with_text(compress(fixed_model)))

        self.assertEqual(out, expected)

    def test_an_unchanged_page_keeps_its_markup(self):
        fixed_model, _changes = fix(MODEL)
        xml = file_with_pages(
            page_with_text(f"<!--x-->{compress(fixed_model)}<!--x-->")
        )
        out, changes = fix(xml)

        self.assertEqual(changes, [])
        self.assertEqual(out, xml)


class EncodingTest(unittest.TestCase):
    def test_utf8_labels_ids(self):
        original = read_fixture_bytes("non-ascii.drawio")
        expected = read_fixture_bytes("non-ascii.expected.drawio")
        fixed, changes = script.fix_xml(original)

        self.assertEqual(fixed, expected)
        self.assertEqual(changes, [("辺①", "1", "容器")])
        self.assertFalse(fixed.startswith(codecs.BOM_UTF8))

    def test_utf8_bom_is_preserved(self):
        raw = codecs.BOM_UTF8 + read_fixture_bytes("non-ascii.drawio")
        fixed, changes = script.fix_xml(raw)

        self.assertTrue(fixed.startswith(codecs.BOM_UTF8))
        self.assertEqual(changes, [("辺①", "1", "容器")])

    def test_single_byte_encoding(self):
        prolog = '<?xml version="1.0" encoding="ISO-8859-1"?>\n'
        raw = model_with_edge_attribute(
            'value="Ünïcödé Grüße"', prolog=prolog
        ).encode("latin-1")
        fixed, changes = script.fix_xml(raw)

        self.assertEqual(changes, [EXPECTED_CHANGE])
        self.assertIn('value="Ünïcödé Grüße"'.encode("latin-1"), fixed)

    def test_utf16_is_refused(self):
        prolog = '<?xml version="1.0" encoding="UTF-16"?>\n'
        raw = (prolog + MODEL).encode("utf-16")

        with self.assertRaises(ValueError):
            script.fix_xml(raw)

    def test_utf16_without_a_bom_is_refused(self):
        raw = MODEL.encode("utf-16-be")

        with self.assertRaises(ValueError):
            script.fix_xml(raw)


if __name__ == "__main__":
    unittest.main()
