#!/usr/bin/env python3
"""Kitsune 0.5 logo: ensō of ink with a kitsune mask inside, generated deterministically."""

import importlib.util
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("kitsune_logo", ROOT / "tools/logo/generate.py")
logo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(logo)

SVG = "{http://www.w3.org/2000/svg}"
ICONS = ("chrome/assets/kitsune.svg", "chrome/assets/kitsune-ring.svg", "chrome/assets/kitsune-mask.svg",
         "install/branding/icon-small.svg", "start/favicon.svg", "start/logo.svg")


class LogoTests(unittest.TestCase):
    def test_generator_is_deterministic_and_matches_committed_assets(self):
        first, second = logo.build(), logo.build()
        self.assertEqual(first, second)
        for relative, content in first.items():
            with self.subTest(asset=relative):
                self.assertEqual((ROOT / relative).read_bytes(), content)

    def test_icons_are_filter_free_paper_ink_and_rust(self):
        for relative in ICONS:
            with self.subTest(icon=relative):
                text = (ROOT / relative).read_text(encoding="utf-8")
                root = ET.fromstring(text)
                self.assertEqual(root.get("viewBox"), "0 0 200 200")
                self.assertEqual(list(root.iter(f"{SVG}filter")), [])
                self.assertNotIn("<script", text)
                self.assertTrue("#252d2b" in text or "#963d32" in text)
        full = (ROOT / "chrome/assets/kitsune.svg").read_text(encoding="utf-8")
        for color in ("#252d2b", "#963d32", "#fbfaf7"):
            self.assertIn(color, full)

    def test_full_logo_is_exactly_the_ring_plus_the_mask(self):
        def drawing(relative):
            root = ET.fromstring((ROOT / relative).read_text(encoding="utf-8"))
            return [ET.tostring(child) for child in root]
        self.assertEqual(drawing("chrome/assets/kitsune.svg"),
                         drawing("chrome/assets/kitsune-ring.svg") + drawing("chrome/assets/kitsune-mask.svg"))
        self.assertEqual((ROOT / "start/logo.svg").read_bytes(), (ROOT / "chrome/assets/kitsune.svg").read_bytes())

    def test_tab_favicon_is_the_small_icon(self):
        self.assertEqual((ROOT / "start/favicon.svg").read_bytes(), (ROOT / "install/branding/icon-small.svg").read_bytes())

    def test_wordmark_is_noto_serif_ink_with_rust_seal(self):
        text = (ROOT / "install/branding/wordmark.svg").read_text(encoding="utf-8")
        root = ET.fromstring(text)
        label = next(root.iter(f"{SVG}text"))
        self.assertEqual(label.text, "kitsune")
        self.assertIn("Noto Serif", label.get("font-family"))
        self.assertEqual(label.get("fill"), "#252d2b")
        self.assertIn("#963d32", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
