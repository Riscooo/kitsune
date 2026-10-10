#!/usr/bin/env python3
"""Defensive, temporary-file tests for Kitsune's appearance protocol (papel o tinta y fondo propio)."""

import copy
import importlib.util
import json
from pathlib import Path
import re
import stat
import tempfile
import time
import unittest


MODULE = Path(__file__).resolve().parents[1] / "install/appearance.py"
spec = importlib.util.spec_from_file_location("kitsune_appearance_unit", MODULE)
appearance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appearance)


def luminance(value):
    channels = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in channels]
    return sum(a * b for a, b in zip(linear, (.2126, .7152, .0722)))


def contrast(first, second):
    values = [luminance(first), luminance(second)]
    return (max(values) + 0.05) / (min(values) + 0.05)


class AppearanceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="kitsune-appearance-test-")
        self.root = Path(self.temporary.name)
        self.browser = self.root / "browser"
        self.state = self.root / "state"
        self.browser.mkdir(mode=0o700)
        self.state.mkdir(mode=0o700)
        self.manager = appearance.AppearanceManager(self.browser, self.state, "default")
        self.settings = {"motion": True}

    def tearDown(self):
        self.temporary.cleanup()

    def refresh(self, **updates):
        return self.manager.refresh({**self.settings, **updates})

    def test_paper_palette_is_exactly_the_inkshadow_tokens(self):
        expected = {"bg": "#f6f5f1", "surface": "#fbfaf7", "surfaceHigh": "#e8ece4", "text": "#252d2b",
                    "muted": "#59625c", "outline": "#c7cdc4", "primary": "#963d32", "primaryContainer": "#eadfda",
                    "secondary": "#496b60", "tertiary": "#73786f"}
        self.assertEqual(appearance.PAPEL, expected)
        self.assertEqual(self.refresh()["palette"], expected)

    def test_control_is_version_3_with_theme_and_background(self):
        self.refresh()
        control = json.loads(self.manager.control.read_text())
        self.assertEqual(control["version"], 3)
        self.assertEqual(set(control), {"version", "palette", "motion", "googleRemember", "theme", "background", "fingerprint"})
        self.assertEqual((control["theme"], control["background"]), ("claro", None))

    def test_dark_theme_uses_the_sumi_palette(self):
        result = self.refresh(theme="oscuro")
        self.assertEqual((result["theme"], result["palette"]), ("oscuro", appearance.SUMI))
        self.assertNotEqual(result["fingerprint"], self.refresh()["fingerprint"])

    def test_home_page_dark_palette_is_the_browser_sumi_palette(self):
        css = (Path(__file__).resolve().parents[1] / "start/app.css").read_text()
        block = re.search(r":root\[data-theme=oscuro\] \{([^}]*)\}", css)[1]
        tokens = dict(re.findall(r"--kb-([a-z-]+): (#[0-9a-f]{6})", block))
        expected = {re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key): value for key, value in appearance.SUMI.items()}
        self.assertEqual(tokens, expected)

    def test_background_is_announced_only_when_its_normalized_file_exists(self):
        digest = "ab" * 32
        self.assertIsNone(self.refresh(background=digest)["background"])
        path = appearance.background_path(self.manager.profile, digest)
        path.write_bytes(b"jpeg fixture")
        self.assertEqual(self.refresh(background=digest)["background"], digest)
        for value in ("../x", "AB" * 32, 1, ""):
            with self.subTest(value=value), self.assertRaises((ValueError, TypeError)):
                self.refresh(background=value)
        with self.assertRaises(ValueError):
            self.refresh(theme="nightfall")

    def test_legacy_nightfall_settings_are_ignored_not_rejected(self):
        legacy = {"wallpaper": "veil", "accent": "pink", "themeSync": True, "art": False}
        result = self.refresh(**legacy)
        self.assertEqual(result["palette"], appearance.PAPEL)
        self.assertEqual(result["fingerprint"], self.refresh()["fingerprint"])
        for key in legacy:
            self.assertNotIn(key, result)

    def test_invalid_motion_is_rejected(self):
        for value in ("true", 1, None):
            with self.assertRaises((ValueError, TypeError)):
                self.refresh(motion=value)

    def test_text_muted_and_primary_retain_45_contrast_over_every_surface(self):
        for name, palette in appearance.PALETTES.items():
            for foreground in ("text", "muted", "primary"):
                for surface in ("bg", "surface", "surfaceHigh"):
                    with self.subTest(theme=name, foreground=foreground, surface=surface):
                        self.assertGreaterEqual(contrast(palette[foreground], palette[surface]), 4.5)

    def test_corrupt_derived_control_recovers_and_unchanged_state_does_not_rewrite(self):
        first = self.refresh()
        self.manager.control.write_text("broken derived fixture")
        recovered = self.refresh()
        self.assertEqual(recovered["fingerprint"], first["fingerprint"])
        info = self.manager.control.stat()
        self.refresh()
        after = self.manager.control.stat()
        self.assertEqual((info.st_ino, info.st_mtime_ns), (after.st_ino, after.st_mtime_ns))
        self.assertEqual(stat.S_IMODE(after.st_mode), 0o600)
        self.assertEqual(list(self.manager.control.parent.glob(".appearance-*")), [])

    def test_linked_profile_directory_or_control_is_rejected_without_writes(self):
        outside = self.root / "other-fixture"
        outside.mkdir()
        self.manager.profile.symlink_to(outside, target_is_directory=True)
        with self.assertRaises((ValueError, OSError)):
            self.refresh()
        self.assertEqual(list(outside.iterdir()), [])
        self.manager.profile.unlink()
        self.manager.control.parent.mkdir(parents=True)
        target = outside / "unchanged.json"
        target.write_text('{"fixture":true}')
        self.manager.control.symlink_to(target)
        with self.assertRaises((ValueError, OSError)):
            self.refresh()
        self.assertEqual(target.read_text(), '{"fixture":true}')

    def test_new_profile_linked_collection_ancestor_is_rejected(self):
        outside = self.root / "other-profile-fixture"
        outside.mkdir()
        (self.browser / "profiles").symlink_to(outside, target_is_directory=True)
        manager = appearance.AppearanceManager(self.browser, self.state, "p-0123456789abcdef")
        with self.assertRaises((ValueError, OSError)):
            manager.refresh(self.settings)
        self.assertEqual(list(outside.iterdir()), [])

    def test_ack_requires_fresh_matching_fingerprint_and_recovers_wrong_shape(self):
        result = self.refresh()
        self.assertEqual(result["native"]["status"], "unavailable")
        (self.browser / "native").mkdir()
        (self.browser / "native/kitsune-appearance.sys.mjs").write_text("// fixture availability marker")
        result = self.refresh()
        self.assertEqual(result["native"]["status"], "queued")
        base = {"version": 1, "fingerprint": result["fingerprint"], "at": time.time() * 1000,
                "googleRemember": True, "googlePolicyManaged": True}
        self.manager.ack.write_text(json.dumps(base))
        current = self.refresh()
        self.assertEqual(current["native"]["status"], "applied")
        self.assertTrue(current["native"]["googleRemember"])
        for change in ({"fingerprint": "0" * 64}, {"at": time.time() * 1000 - 31000}, {"at": time.time() * 1000 + 60000}, {"at": True}, {"version": 0}):
            self.manager.ack.write_text(json.dumps({**base, **change}))
            self.assertEqual(self.refresh()["native"]["status"], "queued")
        for shape in ([], None, 1, "not an ack"):
            self.manager.ack.write_text(json.dumps(shape))
            self.assertEqual(self.refresh()["native"]["status"], "queued")

    def test_profiles_have_independent_controls_and_google_flags(self):
        identifier = "p-0123456789abcdef"
        other = appearance.AppearanceManager(self.browser, self.state, identifier)
        registry = {"version": 2, "profiles": [{"id": "default", "rememberGoogle": False}, {"id": identifier, "rememberGoogle": True}]}
        (self.state / "profiles.json").write_text(json.dumps(registry))
        first = self.refresh()
        second = other.refresh({**self.settings, "motion": False})
        self.assertFalse(first["googleRemember"])
        self.assertTrue(second["googleRemember"])
        self.assertNotEqual(self.manager.control, other.control)
        self.assertNotEqual(first["fingerprint"], second["fingerprint"])
        original = self.manager.control.read_bytes()
        other.refresh({**self.settings, "motion": False})
        self.assertEqual(self.manager.control.read_bytes(), original)

    def test_google_flag_legacy_default_and_invalid_registry_do_not_silently_overwrite(self):
        (self.state / "profiles.json").write_text(json.dumps({"version": 1, "profiles": [{"id": "default"}]}))
        self.assertFalse(self.refresh()["googleRemember"])
        before = self.manager.control.read_bytes()
        for value in ("true", 1, None):
            (self.state / "profiles.json").write_text(json.dumps({"profiles": [{"id": "default", "rememberGoogle": value}]}))
            with self.assertRaises((ValueError, TypeError)):
                self.refresh()
            self.assertEqual(self.manager.control.read_bytes(), before)

    def test_fingerprint_changes_only_for_control_values_not_native_ack(self):
        first = self.refresh()
        self.assertRegex(first["fingerprint"], r"^[a-f0-9]{64}$")
        changed = self.refresh(motion=False)
        self.assertNotEqual(first["fingerprint"], changed["fingerprint"])
        restored = self.refresh()
        self.assertEqual(first["fingerprint"], restored["fingerprint"])
        self.manager.ack.write_text(json.dumps({"version": 1, "fingerprint": first["fingerprint"], "at": time.time() * 1000}))
        self.assertEqual(self.refresh()["fingerprint"], first["fingerprint"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
