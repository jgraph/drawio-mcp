"""Command line behaviour: arguments, exit status, and the report."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from helpers import SCRIPT, read_fixture_bytes

SAMPLE = read_fixture_bytes("aws-containers.drawio")
EXPECTED = read_fixture_bytes("aws-containers.expected.drawio")


def run(*args, stdin=None, env=None):
    """Invoke the script; returns the CompletedProcess."""
    return subprocess.run(
        [sys.executable, str(SCRIPT)] + list(args),
        input=stdin,
        capture_output=True,
        env=env,
        check=False,
    )


class CommandLineTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def write_file(self, name="diagram.drawio", content=SAMPLE):
        path = Path(self.directory.name) / name
        path.write_bytes(content)

        return path

    def test_fixes_a_file_in_place(self):
        path = self.write_file()
        result = run(str(path))

        self.assertEqual(result.returncode, 0)
        self.assertEqual(path.read_bytes(), EXPECTED)

    def test_reports_every_edge_it_moved(self):
        path = self.write_file()
        report = run(str(path)).stderr.decode("utf-8")

        self.assertIn("1 edge parent(s) fixed", report)
        self.assertIn('e2: parent="1" -> parent="vpc"', report)
        self.assertIn(str(path), report)

    def test_reports_when_there_is_nothing_to_do(self):
        path = self.write_file(content=EXPECTED)
        report = run(str(path)).stderr.decode("utf-8")

        self.assertIn("no edge parents to fix", report)

    def test_dry_run_reports_without_writing(self):
        path = self.write_file()
        result = run("--dry-run", str(path))
        report = result.stderr.decode("utf-8")

        self.assertEqual(result.returncode, 0)
        self.assertEqual(path.read_bytes(), SAMPLE)
        self.assertIn("1 edge parent(s) fixed", report)
        self.assertIn('e2: parent="1" -> parent="vpc"', report)
        self.assertIn(str(path), report)

    def test_quiet_suppresses_the_report(self):
        path = self.write_file()
        result = run("--quiet", str(path))

        self.assertEqual(result.stderr, b"")
        self.assertEqual(path.read_bytes(), EXPECTED)

    def test_several_files_in_one_call(self):
        first = self.write_file(name="one.drawio")
        second = self.write_file(name="two.drawio")
        result = run(str(first), str(second))

        self.assertEqual(result.returncode, 0)
        self.assertEqual(first.read_bytes(), EXPECTED)
        self.assertEqual(second.read_bytes(), EXPECTED)

    def test_stdin_to_stdout(self):
        result = run("-", stdin=SAMPLE)

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, EXPECTED)
        self.assertIn("<stdin>", result.stderr.decode("utf-8"))

    def test_stdin_dry_run_passes_the_input_through(self):
        result = run("-", "--dry-run", stdin=SAMPLE)

        self.assertEqual(result.stdout, SAMPLE)

    def test_missing_file_fails(self):
        result = run(str(Path(self.directory.name) / "nope.drawio"))

        self.assertEqual(result.returncode, 1)
        self.assertIn("nope.drawio", result.stderr.decode("utf-8"))

    def test_malformed_xml_fails_without_writing(self):
        content = b"<mxGraphModel><root>"
        path = self.write_file(content=content)
        result = run(str(path))

        self.assertEqual(result.returncode, 1)
        self.assertEqual(path.read_bytes(), content)

    def test_utf16_file_is_refused_and_left_alone(self):
        content = SAMPLE.decode("utf-8").encode("utf-16")
        path = self.write_file(content=content)
        result = run(str(path))

        self.assertEqual(result.returncode, 1)
        self.assertIn("UTF-16", result.stderr.decode("utf-8"))
        self.assertEqual(path.read_bytes(), content)

    def test_one_bad_file_does_not_stop_the_others(self):
        good = self.write_file(name="good.drawio")
        result = run(str(Path(self.directory.name) / "nope.drawio"), str(good))

        self.assertEqual(result.returncode, 1)
        self.assertEqual(good.read_bytes(), EXPECTED)

    def test_runs_under_a_non_utf8_locale(self):
        path = self.write_file(
            name="non-ascii.drawio",
            content=read_fixture_bytes("non-ascii.drawio"),
        )
        env = dict(os.environ, LC_ALL="C", LANG="C")
        result = run(str(path), env=env)

        self.assertEqual(result.returncode, 0)
        self.assertEqual(
            path.read_bytes(), read_fixture_bytes("non-ascii.expected.drawio")
        )

    def test_help_is_available(self):
        result = run("--help")

        self.assertEqual(result.returncode, 0)
        self.assertIn("nearest common ancestor", result.stdout.decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
