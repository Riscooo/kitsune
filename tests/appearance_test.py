#!/usr/bin/env python3
"""Defensive, temporary-file tests for Kitsune's fixed appearance protocol."""

import copy
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import time
import unittest


MODULE = Path(__file__).resolve().parents[1] / "install/appearance.py"
spec = importlib.util.spec_from_file_location("kitsune_appearance_unit", MODULE)
appearance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appearance)


def contrast(first, second):
    values = [appearance.luminance(first), appearance.luminance(second)]
    return (max(values) + 0.05) / (min(values) + 0.05)


class AppearanceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="kitsune-appearance-test-")
        self.root = Path(self.temporary.name)
        self.browser = self.root / "browser"
        self.state = self.root / "state"
        self.browser.mkdir(mode=0o700)
        self.state.mkdir(mode=0o700)
        self.scheme = self.root / "scheme.json"
        self.manager = appearance.AppearanceManager(self.browser, self.state, "default", scheme_file=self.scheme)
        self.settings = {"accent": "blue", "wallpaper": "night", "themeSync": False, "art": True, "motion": True}

    def tearDown(self):
        self.temporary.cleanup()

    def refresh(self, **updates):
        return self.manager.refresh({**self.settings, **updates})

    def write_scheme(self, color="#151820", primary="#bed8f8"):
        values = {key: color for key in appearance.SCHEME_KEYS.values()}
        values.update({"primary": primary, "onSurface": "#f1f4fa", "onSurfaceVariant": "#c2cada"})
        self.scheme.write_text(json.dumps({"colours": values}))

    def test_wallpaper_synchronized_palettes_and_manual_palette_independence(self):
        for wallpaper, palette in appearance.PALETTES.items():
            result = self.refresh(themeSync=True, wallpaper=wallpaper)
            self.assertEqual(result["source"], "wallpaper")
            self.assertEqual(result["palette"], palette)
            self.assertEqual(result["wallpaper"], wallpaper)
        for accent, expected in (("blue", "night"), ("pink", "ember")):
            for wallpaper in appearance.PALETTES:
                result = self.refresh(accent=accent, wallpaper=wallpaper, themeSync=False)
                self.assertEqual(result["source"], "manual")
                self.assertEqual(result["palette"], appearance.PALETTES[expected])

    def test_desktop_scheme_changes_are_live_and_invalid_json_preserves_previous_palette(self):
        self.write_scheme(primary="#b1c2ef")
        first = self.refresh(accent="system")
        self.write_scheme(primary="#a1d8df")
        second = self.refresh(accent="system")
        self.assertEqual(second["source"], "desktop")
        self.assertNotEqual(first["palette"]["primary"], second["palette"]["primary"])
        self.assertNotEqual(first["fingerprint"], second["fingerprint"])
        self.scheme.write_text("{ incomplete fixture")
        result = self.refresh(accent="system")
        self.assertEqual(result["palette"], second["palette"])
        self.assertIn("warning", result)

    def test_wrong_json_shapes_in_scheme_and_previous_control_are_recovered(self):
        self.write_scheme()
        first = self.refresh(accent="system")
        for shape in ([], None, 42, "not a scheme", {"colours": []}):
            self.scheme.write_text(json.dumps(shape))
            with self.subTest(shape=type(shape).__name__):
                result = self.refresh(accent="system")
                self.assertEqual(result["palette"], first["palette"])
                self.assertIn("warning", result)
        self.manager.control.write_text("[]")
        result = self.refresh(accent="system")
        self.assertEqual(result["palette"], appearance.PALETTES["night"])
        self.assertEqual(json.loads(self.manager.control.read_text())["version"], 1)

    def test_invalid_colors_fall_back_without_publishing_unvalidated_values(self):
        for invalid in ("not-a-color", "#12345", "#1234567", "#111111;unexpected", ["#123456"], 123456):
            self.scheme.write_text(json.dumps({"colours": {"primary": invalid}}))
            result = self.refresh(accent="system")
            self.assertIn("warning", result)
            for value in result["palette"].values():
                self.assertRegex(value, r"^#[0-9a-f]{6}$")
        for key, value in (("themeSync", "true"), ("art", 1), ("motion", None), ("wallpaper", "unknown"), ("accent", "unknown")):
            with self.assertRaises((ValueError, TypeError)):
                self.refresh(**{key: value})

    def test_text_muted_and_primary_retain_45_contrast_over_every_surface(self):
        palettes = list(appearance.PALETTES.values())
        for shade in ("#ffffff", "#666666", "#707070", "#444444", "#111111"):
            values = {key: shade for key in appearance.SCHEME_KEYS.values()}
            palettes.append(appearance.desktop_palette({"colours": values}, appearance.PALETTES["night"]))
        for index, palette in enumerate(palettes):
            for foreground in ("text", "muted", "primary"):
                for surface in ("bg", "surface", "surfaceHigh"):
                    with self.subTest(palette=index, foreground=foreground, surface=surface):
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
        manager = appearance.AppearanceManager(self.browser, self.state, "p-0123456789abcdef", scheme_file=self.scheme)
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
        other = appearance.AppearanceManager(self.browser, self.state, identifier, scheme_file=self.scheme)
        registry = {"version": 2, "profiles": [{"id": "default", "rememberGoogle": False}, {"id": identifier, "rememberGoogle": True}]}
        (self.state / "profiles.json").write_text(json.dumps(registry))
        first = self.refresh()
        second = other.refresh({**self.settings, "wallpaper": "ember", "themeSync": True})
        self.assertFalse(first["googleRemember"])
        self.assertTrue(second["googleRemember"])
        self.assertNotEqual(self.manager.control, other.control)
        self.assertNotEqual(first["palette"], second["palette"])
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
