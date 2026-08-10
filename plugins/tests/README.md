# Tests

Tests for the scripts the plugins bundle. Currently covers
[`fix_edge_parents.py`](../claude-code/skills/drawio/scripts/fix_edge_parents.py),
the helper the `drawio` skill runs on every generated `.drawio` file to set each
edge's `parent` to the nearest common ancestor of its `source` and `target`.

The Claude Code copy is the one under test. The Codex and Copilot plugins ship
byte-identical copies of it.
[`check-skill-sync.yml`](../../.github/workflows/check-skill-sync.yml) checks
them identical.

Python 3 standard library only (`unittest`) — nothing to install.

## Running

From the repository root:

```bash
python3 -m unittest discover -s plugins/tests
```

A single module, or a single test:

```bash
python3 -m unittest discover -s plugins/tests -p test_cli.py
python3 plugins/tests/test_geometry.py NumberFormatTest
```

Add `-v` for per-test output. CI runs the same command from
[`test-scripts.yml`](../../.github/workflows/test-scripts.yml).

## Test files

| File | Description |
|------|-------------|
| `helpers.py` | Helper functions. Also imports `fix_edge_parents.py` with adjusted `sys.path`. |
| `test_edge_parents.py` | The parenting rule: nearest common ancestor, self-loops, relative terminals, layer boundaries, `<object>` wrappers, flag truthiness |
| `test_geometry.py` | Waypoint/endpoint translation, `as="offset"` left alone, `parseFloat`/number formatting semantics |
| `test_file_formats.py` | `mxGraphModel` vs `mxfile`, compressed pages (comments, CDATA, character references), encodings (UTF-8, BOM, single-byte, UTF-16 refusal), byte preservation, idempotence |
| `test_cli.py` | CLI arguments, in-place vs `--dry-run`, `--quiet`, stdin/stdout, exit status, report text, non-UTF-8 locale |

Inputs are built as ElementTree elements using helper functions
(for example, `vertex(id="a", parent="box", x=20, y=40)`) and serialized by
`model`. For tests checking byte-for-byte property, inputs and outputs are
handled as strings or byte sequences.

## Fixtures

Small input data are embedded in test modules.  Larger realistic inputs are
placed under `fixtures/` directory.

| Fixture | Purpose |
|---------|---------|
| `aws-containers.drawio` / `.expected.drawio` | Nested containers (AWS → VPC → subnets); the edge between subnets moves to the VPC and its waypoint shifts by the origin delta |
| `non-ascii.drawio` / `.expected.drawio` | Japanese labels, emoji, astral characters, non-ASCII cell ids, escaped markup, numeric character references, a single-quoted attribute, an XML declaration |


To regenerate `.expected.drawio` files:

```bash
cd plugins
cp tests/fixtures/NAME.drawio tests/fixtures/NAME.expected.drawio
python3 claude-code/skills/drawio/scripts/fix_edge_parents.py tests/fixtures/NAME.expected.drawio
```

and review the diff before committing.
