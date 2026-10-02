"""Offline tests for product-only branding and immutable engine snapshots."""
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location("kitsune_runtime", Path(__file__).resolve().parents[1] / "install/prepare-runtime.py")
runtime = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runtime)


class BrandingTests(unittest.TestCase):
    def test_only_product_terms_change(self):
        original = b"# License Mozilla MPL\n-brand-short-name = LibreWolf\n-vendor-short-name = LibreWolf\nsite = https://librewolf.net\n"
        result = runtime.brand_resource("localization/es-ES/branding/brand.ftl", original)
        self.assertIn(b"-brand-short-name = Kitsune", result)
        self.assertIn(b"# License Mozilla MPL", result)
        self.assertIn(b"https://librewolf.net", result)

    def test_sync_service_names_and_unknown_resources_are_untouched(self):
        original = b"brandShortName=LibreWolf\nsyncBrandShortName=LibreWolf Sync\n"
        result = runtime.brand_resource("chrome/en-US/locale/branding/brand.properties", original)
        self.assertIn(b"brandShortName=Kitsune", result)
        self.assertIn(b"syncBrandShortName=LibreWolf Sync", result)
        self.assertEqual(runtime.brand_resource("content/security-warning.html", original), original)

    def test_about_preserves_credits_and_links(self):
        original = b'<label id="wordmark">LibreWolf</label><a href="https://librewolf.net/">LibreWolf</a>'
        result = runtime.brand_resource(runtime.ABOUT, original)
        self.assertIn(b'<label id="wordmark">Kitsune</label>', result)
        self.assertIn(b"LibreWolf y Mozilla Gecko", result)
        self.assertIn(b'<a href="https://librewolf.net/">LibreWolf</a>', result)

    def test_about_changes_require_review(self):
        with self.assertRaises(ValueError):
            runtime.brand_resource(runtime.ABOUT, b"unexpected new upstream markup")

    def fixture(self, root):
        source = root / "engine"
        (source / "browser").mkdir(parents=True)
        for name in ("librewolf", "libxul.so", "omni.ja", "librewolf.cfg"):
            (source / name).write_bytes(b"upstream unchanged")
        (source / "librewolf").chmod(0o755)
        (source / "application.ini").write_text("[App]\nName=LibreWolf\nVersion=154.0-2\n")
        (source / "librewolf-bin").symlink_to("../../bin/librewolf")
        with zipfile.ZipFile(source / "browser/omni.ja", "w") as archive:
            archive.writestr("localization/en-US/branding/brand.ftl", "-brand-short-name = LibreWolf\n")
            archive.writestr(runtime.ABOUT, '<label id="wordmark">LibreWolf</label>')
            archive.writestr(runtime.WINDOW, '<html><head>' + runtime.BOOTSTRAP + '</head></html>')
            archive.writestr("security/defaults.js", "pref('xpinstall.signatures.required', true);")
            archive.writestr("license.html", "Mozilla MPL and LibreWolf credits")
        return source

    def test_snapshot_cache_and_engine_update(self):
        with tempfile.TemporaryDirectory(prefix="kitsune-runtime-test-") as directory:
            root = Path(directory)
            source = self.fixture(root)
            original = (source / "browser/omni.ja").read_bytes()
            first = runtime.prepare(source, root / "runtime")
            again = runtime.prepare(source, root / "runtime")
            self.assertEqual(first, again)
            self.assertEqual((source / "browser/omni.ja").read_bytes(), original)
            self.assertEqual((first.parent / "application.ini").read_bytes(), (source / "application.ini").read_bytes())
            self.assertEqual((first.parent / "librewolf.cfg").read_bytes(), (source / "librewolf.cfg").read_bytes())
            self.assertEqual((first.parent / "librewolf-bin").resolve(), first)
            with zipfile.ZipFile(first.parent / "browser/omni.ja") as archive:
                self.assertEqual(archive.read("security/defaults.js"), b"pref('xpinstall.signatures.required', true);")
                self.assertEqual(archive.read("license.html"), b"Mozilla MPL and LibreWolf credits")
                self.assertIn(b'kitsune-bootstrap.js', archive.read(runtime.WINDOW))
                for resource, name in runtime.NATIVE_FILES.items():
                    self.assertEqual(archive.read(resource), runtime.load_native_assets()[name])
            (source / "libxul.so").write_bytes(b"new security update")
            updated = runtime.prepare(source, root / "runtime")
            self.assertNotEqual(updated, first)
            self.assertTrue(first.is_file(), "Running snapshots must not be deleted")
            self.assertEqual((updated.parent / "libxul.so").read_bytes(), b"new security update")
            self.assertEqual((root / "runtime").stat().st_mode & 0o777, 0o700)

    def test_source_and_output_must_be_separate(self):
        with tempfile.TemporaryDirectory(prefix="kitsune-runtime-test-") as directory:
            source = self.fixture(Path(directory))
            with self.assertRaises(ValueError):
                runtime.prepare(source, source / "nested-runtime")

    def test_output_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix="kitsune-runtime-test-") as directory:
            root = Path(directory)
            source = self.fixture(root)
            (root / "elsewhere").mkdir()
            (root / "runtime").symlink_to(root / "elsewhere", target_is_directory=True)
            with self.assertRaises(ValueError):
                runtime.prepare(source, root / "runtime")

    def test_asset_revision_refreshes_snapshot_identity(self):
        with tempfile.TemporaryDirectory(prefix="kitsune-runtime-test-") as directory:
            source = self.fixture(Path(directory))
            self.assertNotEqual(runtime.source_snapshot(source, {"icon.png": b"before"})[0],
                                runtime.source_snapshot(source, {"icon.png": b"after"})[0])

    def test_native_icon_sizes_and_original_svg_are_preserved(self):
        assets = runtime.load_branding_assets()
        for size in (16, 32, 48, 64, 128, 192, 384):
            self.assertEqual(struct.unpack(">II", assets[f"icon-{size}.png"][16:24]), (size, size))
        self.assertEqual(struct.unpack(">II", assets["about-300x236.png"][16:24]), (300, 236))
        original = Path(__file__).resolve().parents[1] / "chrome/assets/kitsune.svg"
        self.assertEqual(assets["icon.svg"], original.read_bytes())


if __name__ == "__main__":
    unittest.main()
