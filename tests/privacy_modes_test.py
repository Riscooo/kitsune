"""Offline checks of the generated privacy modes in install/recipe/kitsune.cfg."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("privacy_modes", ROOT / "tools/privacy_modes.py")
modes = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(modes)


class PrivacyModesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference = json.loads(modes.REFERENCE.read_text())
        cls.factory = json.loads(modes.FACTORY.read_text())
        cls.sets, cls.unclassified, _ = modes.generate(cls.reference, cls.factory)
        cls.cfg = modes.CFG.read_text()

    def test_every_difference_is_classified_and_cfg_is_current(self):
        self.assertEqual(self.unclassified, [])
        self.assertIn(modes.render(self.sets), self.cfg)

    def test_strict_reproduces_kitsune_05_values(self):
        for name, (strict, _) in self.sets["mode"].items():
            if name in modes.STRICT:  # las excepciones a la medida, con su motivo en privacy_modes.py
                continue
            self.assertEqual(strict, modes.effective(self.reference["prefs"][name]), name)
        for name, value in self.sets["common"].items():
            self.assertEqual(value, modes.effective(self.reference["prefs"][name]), name)

    def test_modes_never_touch_identity_sync_or_password_storage(self):
        managed = set(self.sets["mode"]) | set(self.sets["common"])
        self.assertFalse([name for name in managed if name.startswith(("signon.storage.", "librewolf."))])
        self.assertNotIn("identity.fxaccounts.enabled", managed)
        self.assertNotIn("librewolf", self.cfg.lower())

    def test_strict_keeps_the_core_protections(self):
        strict = {name: values[0] for name, values in self.sets["mode"].items()}
        self.assertIs(strict["privacy.sanitize.sanitizeOnShutdown"], True)
        self.assertIs(strict["dom.security.https_only_mode"], True)
        self.assertIs(strict["privacy.fingerprintingProtection"], True)
        self.assertEqual(self.sets["common"]["toolkit.telemetry.server"], "data:,")
        # La fábrica de Gecko (medida sin kitsune.cfg) manda telemetría; Kitsune la apaga en los
        # dos modos, y además la bloquea en su identidad (lockPref).
        for name in ("datareporting.healthreport.uploadEnabled", "datareporting.usage.uploadEnabled", "toolkit.telemetry.archive.enabled"):
            self.assertIs(self.sets["common"][name], False, name)
            self.assertIn(f'"{name}"', self.cfg)

    def test_drm_is_off_until_a_site_asks_for_it(self):
        # Risco, 21-10: en Estricto Spotify no sonaba nunca. La DRM, apagada hasta que una web la pide (barra «Activar
        # DRM», en todos los sistemas); en Cómodo, la de Gecko. Sin apagar el proveedor de complementos ni pedir la
        # aprobación de GeckoView (que en escritorio rompe la DRM).
        self.assertEqual(self.sets["mode"]["media.eme.enabled"], [False, None])
        for name in ("media.gmp-provider.enabled", "media.eme.require-app-approval"):
            self.assertNotIn(name, self.sets["mode"])
            self.assertNotIn(name, self.sets["common"])


if __name__ == "__main__":
    unittest.main()
