"""La regla de niri de Kitsune Zero (zero/linux/install-niri.sh), sin tocar la configuración de verdad."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "zero/linux/install-niri.sh"


class NiriRuleTests(unittest.TestCase):
    def run_script(self, version="niri 26.04 (8ed0da4)", config="// mi configuración\n"):
        home = Path(tempfile.mkdtemp())
        bin_dir = home / "bin"; bin_dir.mkdir()
        # Solo las herramientas del script: el niri de verdad del sistema no puede colarse.
        for tool in ("awk", "grep", "date", "cp", "install", "dirname", "cat", "sh"):
            (bin_dir / tool).symlink_to(shutil.which(tool))
        if version is not None:
            (bin_dir / "niri").write_text(f"#!/bin/sh\necho '{version}'\n"); (bin_dir / "niri").chmod(0o755)
        niri = home / "config/niri"; niri.mkdir(parents=True)
        if config is not None:
            (niri / "config.kdl").write_text(config)
        env = {**os.environ, "PATH": str(bin_dir), "XDG_CONFIG_HOME": str(home / "config"), "HOME": str(home)}
        result = subprocess.run([shutil.which("sh"), str(SCRIPT)], env=env, capture_output=True, text=True)
        return niri, result

    def test_adds_the_rule_file_and_one_include_with_a_backup(self):
        niri, result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        # Zero es transparente y nítido (decisión de Risco, 15-10): la regla no desenfoca lo de detrás.
        rule = (niri / "kitsune-zero.kdl").read_text()
        self.assertNotIn("blur true", rule)
        self.assertIn("draw-border-with-background false", rule)
        # Sin marco de GTK (sombra y borde) ni anillo de foco de niri: enmarcaban la ventana transparente.
        self.assertIn("tiled-state true", rule)
        compact = " ".join(rule.split())
        self.assertIn("focus-ring { off }", compact)
        self.assertIn("border { off }", compact)
        config = (niri / "config.kdl").read_text()
        self.assertTrue(config.startswith("// mi configuración\n"))
        self.assertEqual(config.count('include "kitsune-zero.kdl"'), 1)
        backups = list(niri.glob("config.kdl.pre-kitsune-zero-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), "// mi configuración\n")

    def test_the_rule_covers_every_kitsune_profile_and_nothing_else(self):
        # Cada perfil de Kitsune es una ventana con su app-id (install/profiles.py): «kitsune-browser»
        # el de siempre, «kitsune-p-<16 hex>» los demás, y «kitsune» el motor a secas.
        import re
        rule = (ROOT / "zero/linux/kitsune-zero.kdl").read_text()
        patterns = re.findall(r'match app-id="([^"]+)"', rule)
        self.assertTrue(patterns)
        matches = lambda app_id: any(re.search(pattern, app_id) for pattern in patterns)
        for app_id in ("kitsune-browser", "kitsune-p-0123456789abcdef", "kitsune"):
            self.assertTrue(matches(app_id), app_id)
        for app_id in ("kitty", "kitsune-browser-otro", "org.kitsune.algo", "firefox"):
            self.assertFalse(matches(app_id), app_id)

    def test_the_focus_ring_does_not_fill_the_glass(self):
        # niri pinta el anillo de foco (y el borde) como un rectángulo lleno detrás de la ventana: en una
        # ventana de cristal se veía todo el marco del color del anillo al seleccionarla.
        rule = (ROOT / "zero/linux/kitsune-zero.kdl").read_text()
        self.assertIn("draw-border-with-background false", rule)

    def test_running_it_again_changes_nothing(self):
        niri, _ = self.run_script()
        before = (niri / "config.kdl").read_text()
        env = {**os.environ, "PATH": str(niri.parent.parent / "bin"), "XDG_CONFIG_HOME": str(niri.parent), "HOME": str(niri.parent.parent)}
        subprocess.run([shutil.which("sh"), str(SCRIPT)], env=env, check=True, capture_output=True)
        self.assertEqual((niri / "config.kdl").read_text(), before)
        self.assertEqual(len(list(niri.glob("config.kdl.pre-kitsune-zero-*"))), 1)

    def test_old_niri_no_niri_or_no_config_are_left_alone(self):
        for version, config in (("niri 25.11 (abc)", "// vieja\n"), (None, "// sin niri\n"), ("niri 26.04 (x)", None)):
            niri, result = self.run_script(version, config)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((niri / "kitsune-zero.kdl").exists(), version)
            if config is not None:
                self.assertEqual((niri / "config.kdl").read_text(), config)


if __name__ == "__main__":
    unittest.main()
