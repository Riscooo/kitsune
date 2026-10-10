#!/usr/bin/env python3
"""La mascota de Kitsune: lo guardado coincide con su generador y sigue la paleta."""
import importlib.util
from pathlib import Path
import re
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("kitsune_mascot", ROOT / "tools/mascot/generate.py")
mascot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mascot)
PALETTE = {"#252d2b", "#963d32", "#fbfaf7", "#e7a99b", "#d9a441", "#9ec3d6", "#8d9389"}


class MascotTests(unittest.TestCase):
    def test_saved_files_match_the_generator(self):
        for name, content in mascot.build().items():
            self.assertEqual((ROOT / "install/mascot" / name).read_text(), content, name)

    def test_every_pose_is_valid_svg_in_kitsune_colours_with_no_firefox_trace(self):
        for name, content in mascot.build().items():
            ET.fromstring(content)
            self.assertNotRegex(content.lower(), r"firefox|mozilla", name)
            self.assertLessEqual(set(re.findall(r"#[0-9a-f]{6}", content.lower())), PALETTE, name)

    def test_the_engine_recipe_uses_every_pose(self):
        engine_spec = importlib.util.spec_from_file_location("kitsune_engine_m", ROOT / "install/kitsune-engine.py")
        engine = importlib.util.module_from_spec(engine_spec)
        engine_spec.loader.exec_module(engine)
        self.assertEqual(set(engine.MASCOT_POSES) | {"cara"}, {Path(n).stem for n in mascot.build()} | {"cara"})


if __name__ == "__main__":
    unittest.main()
