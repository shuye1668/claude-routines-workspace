"""End-to-end test of the wantgoo capture pipeline against a LOCAL fixture.

This drives the real Playwright + headless Chromium stack the same way the
live routine will, but points it at a bundled HTML file instead of the blocked
live host. It proves screenshotting, table extraction and file output all work.

Run: python3 -m unittest routines.tests.test_wantgoo_capture
"""
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROUTINES = os.path.dirname(HERE)
sys.path.insert(0, ROUTINES)

import wantgoo_capture as wc  # noqa: E402

SAMPLE = os.path.join(HERE, "fixtures", "wantgoo_sample.html")


class TestCapturePipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="wantgoo_test_")
        url = "file://" + SAMPLE
        # settle_ms small: local file, nothing async to wait for.
        cls.summary = wc.capture(url, cls.tmp, settle_ms=200, timeout_ms=20000)

    def test_screenshot_written_and_nontrivial(self):
        shot = os.path.join(self.tmp, "screenshot.png")
        self.assertTrue(os.path.exists(shot))
        self.assertGreater(os.path.getsize(shot), 2000)  # a real PNG, not empty
        self.assertGreater(self.summary["screenshot_bytes"], 2000)

    def test_title_captured(self):
        self.assertIn("玩股網", self.summary["title"])

    def test_tables_extracted(self):
        with open(os.path.join(self.tmp, "tables.json"), encoding="utf-8") as f:
            tables = json.load(f)
        self.assertGreaterEqual(len(tables), 1)
        flat = [cell for tbl in tables for row in tbl for cell in row]
        self.assertIn("道瓊工業", flat)
        self.assertIn("台股加權", flat)
        # header + 6 index rows
        self.assertGreaterEqual(len(tables[0]), 7)

    def test_text_dump_has_content(self):
        with open(os.path.join(self.tmp, "text.txt"), encoding="utf-8") as f:
            text = f.read()
        self.assertIn("全球市場", text)
        self.assertIn("費城半導體", text)

    def test_html_dump_written(self):
        html = os.path.join(self.tmp, "page.html")
        self.assertTrue(os.path.exists(html))
        with open(html, encoding="utf-8") as f:
            self.assertIn("global-indices", f.read())

    def test_meta_json_written(self):
        with open(os.path.join(self.tmp, "meta.json"), encoding="utf-8") as f:
            meta = json.load(f)
        self.assertEqual(meta["num_tables"], self.summary["num_tables"])
        self.assertGreater(meta["text_chars"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
