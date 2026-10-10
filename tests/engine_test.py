"""Offline tests for Kitsune's own engine pipeline (install/kitsune-engine.py)."""
import importlib.util
import contextlib
import io
import json
import re
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest
from unittest import mock
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("kitsune_engine", ROOT / "install/kitsune-engine.py")
engine = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(engine)


class Completed:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


def gpg_status(primary, good=True):
    lines = []
    if good:
        lines.append("[GNUPG:] GOODSIG 678E455D76767AA3 Mozilla Software Releases <release@mozilla.com>")
        lines.append("[GNUPG:] VALIDSIG 827E658608679618CD349F93678E455D76767AA3 2026-10-05 1791 0 4 0 1 10 00 " + primary)
    return "\n".join(lines) + "\n"


class FakeGpg:
    def __init__(self, primary=engine.MOZILLA_RELEASE_KEY, good=True, code=0):
        self.primary, self.good, self.code = primary, good, code

    def __call__(self, command, **kwargs):
        if "--import" in command:
            return Completed()
        return Completed(self.code, gpg_status(self.primary, self.good))


class VersionTests(unittest.TestCase):
    def test_versions_compare_numerically(self):
        self.assertGreater(engine.version_key("157.0.1"), engine.version_key("157.0"))
        self.assertGreater(engine.version_key("157.0"), engine.version_key("154.0"))
        self.assertGreater(engine.version_key("1000.0"), engine.version_key("999.9.9"))

    def test_malformed_versions_are_rejected(self):
        for bad in ("157", "157.0.1.2", "157.0b5", "../157.0", "157.0\n", "", None, "157.0.1esr"):
            with self.assertRaises(engine.EngineError, msg=repr(bad)):
                engine.version_key(bad)
        with self.assertRaises(engine.EngineError):
            engine.release_files("157.0/../../evil")

    def test_latest_version_is_validated(self):
        def opener(payload):
            return lambda url, timeout: io.BytesIO(json.dumps(payload).encode())
        self.assertEqual(engine.latest_version(opener({"LATEST_FIREFOX_VERSION": "157.0.1"})), "157.0.1")
        with self.assertRaises(engine.EngineError):
            engine.latest_version(opener({"LATEST_FIREFOX_VERSION": "157.0.1; rm -rf ~"}))


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp())
        for name in ("KEY", "SHA512SUMS.asc"):
            (self.directory / name).write_text("x")
        self.payload = b"gecko source"
        import hashlib
        digest = hashlib.sha512(self.payload).hexdigest()
        (self.directory / "firefox-157.0.1.source.tar.xz").write_bytes(self.payload)
        (self.directory / "SHA512SUMS").write_text(
            f"{'0' * 128}  linux-x86_64/en-US/firefox-157.0.1.tar.xz\n{digest}  source/firefox-157.0.1.source.tar.xz\n")

    def test_pinned_mozilla_primary_key_is_accepted(self):
        engine.verify_signature(self.directory, FakeGpg())
        self.assertEqual(engine.verify_tarball(self.directory, "157.0.1").name, "firefox-157.0.1.source.tar.xz")

    def test_signature_by_another_key_is_rejected(self):
        with self.assertRaises(engine.EngineError):
            engine.verify_signature(self.directory, FakeGpg(primary="0" * 40))

    def test_bad_or_missing_signature_is_rejected(self):
        for fake in (FakeGpg(good=False), FakeGpg(code=1)):
            with self.assertRaises(engine.EngineError):
                engine.verify_signature(self.directory, fake)

    def test_tampered_source_is_rejected(self):
        (self.directory / "firefox-157.0.1.source.tar.xz").write_bytes(self.payload + b"!")
        with self.assertRaises(engine.EngineError):
            engine.verify_tarball(self.directory, "157.0.1")

    def test_sums_without_the_source_line_are_rejected(self):
        with self.assertRaises(engine.EngineError):
            engine.expected_sha512(f"{'a' * 128}  source/firefox-157.0.source.tar.xz\n", "157.0.1")


class RecipeTests(unittest.TestCase):
    def source_tree(self):
        root = Path(tempfile.mkdtemp()) / "firefox-157.0.1"
        unofficial = root / "browser/branding/unofficial"
        (unofficial / "content").mkdir(parents=True)
        (unofficial / "locales/en-US").mkdir(parents=True)
        (unofficial / "configure.sh").write_text("MOZ_APP_DISPLAYNAME=Nightly\n")
        (unofficial / "locales/en-US/brand.ftl").write_text("-brand-short-name = Nightly\n")
        (unofficial / "locales/en-US/brand.properties").write_text("brandShortName=Nightly\n")
        (unofficial / "branding.nsi").write_text("".join(f'!define {key:<22} "Mozilla {key}"\n' for key in engine.BRANDING_NSI)
                                                 + '!define Channel "unofficial"\n')
        (unofficial / "firefox.ico").write_bytes(b"mozilla")
        content = root / "browser/base/content"
        content.mkdir(parents=True)
        (root / "browser/base/jar.mn").write_text(
            "browser.jar:\n        content/browser/browser-init.js       (content/browser-init.js)\n"
            "        content/browser/browser-main.js       (content/browser-main.js)\n"
            "        content/browser/browser-menubar.js    (content/browser-menubar.js)\n")
        (content / "browser.xhtml").write_text(f"<window>\n  {engine.BOOTSTRAP}\n</window>\n")
        (content / "aboutDialog.xhtml").write_text(f"<vbox>\n        {engine.ABOUT_ANCHOR}\n</vbox>\n")
        return root

    def test_branding_and_native_module_are_built_in(self):
        root = self.source_tree()
        engine.write_branding(root)
        engine.integrate_native(root)
        brand = root / "browser/branding/kitsune"
        self.assertIn("-brand-short-name = Kitsune", (brand / "locales/en-US/brand.ftl").read_text())
        self.assertIn("MOZ_APP_DISPLAYNAME=Kitsune", (brand / "configure.sh").read_text())
        self.assertEqual((brand / "default16.png").read_bytes(), (ROOT / "install/branding/icon-16.png").read_bytes())
        self.assertEqual((brand / "content/about-logo.svg").read_bytes(), (ROOT / "install/branding/icon.svg").read_bytes())
        jar = (root / "browser/base/jar.mn").read_text()
        self.assertIn("        content/browser/kitsune-appearance.sys.mjs (content/kitsune-appearance.sys.mjs)\n", jar)
        self.assertIn("        content/browser/kitsune-chrome/ (content/kitsune-chrome/**)\n", jar)
        style = root / "browser/base/content/kitsune-chrome"
        self.assertEqual((style / "userChrome.css").read_bytes(), (ROOT / "chrome/userChrome.css").read_bytes())
        self.assertTrue((style / "assets").is_dir())
        self.assertLess(jar.index("browser-main.js"), jar.index("kitsune-bootstrap.js"))
        self.assertIn(engine.KITSUNE_BOOTSTRAP, (root / "browser/base/content/browser.xhtml").read_text())
        about = (root / "browser/base/content/aboutDialog.xhtml").read_text()
        self.assertIn("motor Gecko compilado en este equipo", about)
        self.assertNotIn("Mozilla", about)
        self.assertIn("-vendor-short-name = Kitsune", (brand / "locales/en-US/brand.ftl").read_text())
        for name in engine.NATIVE_FILES:
            self.assertEqual((root / "browser/base/content" / name).read_bytes(), (ROOT / "install/native" / name).read_bytes())
        self.assertNotIn("LibreWolf", (brand / "locales/en-US/brand.ftl").read_text())
        nsi = (brand / "branding.nsi").read_text()
        self.assertNotIn("Mozilla", nsi)
        self.assertRegex(nsi, r'(?m)^!define BrandFullName\s+"Kitsune"$')
        self.assertIn(engine.WEBSITE, nsi)
        self.assertEqual((brand / "firefox.ico").read_bytes(), (ROOT / "install/branding/windows/firefox.ico").read_bytes())
        self.assertTrue((brand / "wizWatermark.bmp").is_file())

    def test_the_integrated_home_is_packaged_as_a_builtin_extension(self):
        root = self.source_tree()
        extensions = root / "browser/extensions"
        extensions.mkdir(parents=True)
        (extensions / "moz.build").write_text('DIRS += [\n    "formautofill",\n]\n\nJAR_MANIFESTS += ["jar.mn"]\n')
        engine.integrate_home(root, "abc1234" + "0" * 57)
        engine.integrate_home(root, "abc1234" + "0" * 57)
        folder = extensions / "kitsune-home"
        self.assertEqual((extensions / "moz.build").read_text().count('"kitsune-home",'), 1)
        self.assertEqual((folder / "jar.mn").read_text(), "browser.jar:\n    builtin-addons/kitsune-home/ (extension/**)\n")
        manifest = json.loads((folder / "extension/manifest.json").read_text())
        self.assertEqual(manifest["browser_specific_settings"]["gecko"]["id"], "inicio@kitsune")
        self.assertEqual(manifest["version"], f"0.7.{int('abc1234', 16)}")
        self.assertTrue(manifest["hidden"])
        for name in engine.HOME_EXTENSION_FILES + tuple(f"start/{page}" for page in engine.HOME_PAGE_FILES):
            self.assertTrue((folder / "extension" / name).is_file(), name)
        help_page = (folder / "extension/start/ayuda.html").read_text()
        self.assertNotRegex(help_page, r'(?:src|href)="/')
        self.assertIn('href="index.html"', help_page)
        # Lo que sirve el servidor de Linux también va en el motor (salvo los módulos sin empaquetar).
        home = (ROOT / "install/home-server.py").read_text()
        for asset in re.findall(r'"/([\w.-]+)": \("', home):
            if asset not in ("index.html", "app.js", "navigation.mjs"):
                self.assertIn(asset, engine.HOME_PAGE_FILES)

    def rebrand_tree(self):
        root = self.source_tree()
        for relative, patches in engine.TEXT_PATCHES.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("\n".join(old for old, _ in patches) + "\n")
        themes = root / "browser/themes/BuiltInThemeConfig.sys.mjs"
        themes.parent.mkdir(parents=True)
        themes.write_text('export const BuiltInThemeConfig = new Map([\n  ["firefox-alpenglow@mozilla.org", {}],\n]);\n')
        link = root / "toolkit/content/widgets/moz-support-link/moz-support-link.mjs"
        link.parent.mkdir(parents=True)
        link.write_text("class MozSupportLink {\n" + engine.SUPPORT_LINK + "\n  }\n}\n")
        for relative in [r for targets in engine.MASCOT_POSES.values() for r in targets] + list(engine.KITSUNE_LOGOS):
            (root / relative).parent.mkdir(parents=True, exist_ok=True)
            (root / relative).write_text('<svg><title>firefox fox</title></svg>')
        return root

    def test_rebrand_leaves_no_firefox_names_themes_bookmarks_or_help_links(self):
        root = self.rebrand_tree()
        engine.rebrand_source(root)
        engine.rebrand_source(root)  # idempotente
        for relative, patches in engine.TEXT_PATCHES.items():
            text = (root / relative).read_text()
            for old, new in patches:
                self.assertIn(new, text)
                self.assertNotIn(old, text)
        self.assertIn("new Map([]);", (root / "browser/themes/BuiltInThemeConfig.sys.mjs").read_text())
        self.assertNotIn("mozilla", (root / "browser/base/content/default-bookmarks.html").read_text().lower())
        link = (root / "toolkit/content/widgets/moz-support-link/moz-support-link.mjs").read_text()
        self.assertEqual(link.count("display"), 1)
        for pose, targets in engine.MASCOT_POSES.items():
            for relative in targets:
                self.assertEqual((root / relative).read_bytes(), (ROOT / "install/mascot" / f"{pose}.svg").read_bytes(), relative)
        for relative in engine.KITSUNE_LOGOS:
            self.assertEqual((root / relative).read_bytes(), (ROOT / "install/branding/icon-small.svg").read_bytes())

    def test_a_missing_gecko_illustration_stops_the_recipe(self):
        root = self.rebrand_tree()
        (root / engine.MASCOT_POSES["guardia"][0]).unlink()
        with self.assertRaises(engine.EngineError):
            engine.rebrand_source(root)

    def test_rebrand_stops_when_gecko_changes_a_patched_text(self):
        root = self.rebrand_tree()
        (root / "browser/locales/en-US/browser/appExtensionFields.ftl").write_text("extension-default-theme-name-auto=Otro\n")
        with self.assertRaises(engine.EngineError):
            engine.rebrand_source(root)

    def test_rust_uses_thin_lto_and_tuning_can_be_reapplied(self):
        root = self.source_tree()
        rules = root / "config/makefiles/rust.mk"
        rules.parent.mkdir(parents=True)
        rules.write_text("ifndef MOZ_LTO_RUST_CROSS\n" + engine.RUST_FAT_LTO + "\nendif\n")
        (root / "browser/moz.configure").write_text('imply_option("MOZ_APP_VENDOR", "Mozilla")\n' + engine.UA_ANCHOR + "\n")
        engine.tune_build(root)
        engine.tune_build(root)
        self.assertEqual(rules.read_text().count(engine.RUST_THIN_LTO), 1)
        self.assertEqual((root / "browser/moz.configure").read_text().count(engine.UA_FIREFOX), 1)
        self.assertNotIn("=fat", rules.read_text())
        rules.write_text("moved upstream\n")
        with self.assertRaises(engine.EngineError):
            engine.tune_build(root)

    def test_native_integration_can_be_reapplied(self):
        root = self.source_tree()
        engine.integrate_native(root)
        engine.integrate_native(root)
        jar = (root / "browser/base/jar.mn").read_text()
        self.assertEqual(jar.count("kitsune-bootstrap.js"), 2)  # one entry: "path (source)"
        self.assertEqual((root / "browser/base/content/browser.xhtml").read_text().count(engine.KITSUNE_BOOTSTRAP), 1)
        self.assertEqual((root / "browser/base/content/aboutDialog.xhtml").read_text().count("kitsune-engine-credit"), 1)

    def test_changed_upstream_entry_points_stop_the_build(self):
        root = self.source_tree()
        (root / "browser/base/content/browser.xhtml").write_text("<window>moved</window>")
        with self.assertRaises(engine.EngineError):
            engine.integrate_native(root)
        root = self.source_tree()
        (root / "browser/base/jar.mn").write_text("browser.jar:\n")
        with self.assertRaises(engine.EngineError):
            engine.integrate_native(root)

    def test_fingerprints_follow_version_and_recipe(self):
        from unittest import mock
        before = engine.build_fingerprint("157.0.1")
        with mock.patch.object(engine, "UA_FIREFOX", 'imply_option("MOZ_APP_UA_NAME", "Otro")'):
            self.assertNotEqual(engine.build_fingerprint("157.0.1"), before)  # recipe code changes rebuild
        self.assertNotEqual(engine.build_fingerprint("157.0.1"), engine.build_fingerprint("157.0"))
        self.assertEqual(engine.build_fingerprint("157.0.1"), engine.build_fingerprint("157.0.1"))
        self.assertNotEqual(engine.install_fingerprint("157.0.1"), engine.build_fingerprint("157.0.1"))

    def test_mozconfig_has_own_identity_and_no_updater(self):
        text = (ROOT / "install/recipe/mozconfig.in").read_text()
        for option in ("--with-app-name=kitsune", "--with-branding=browser/branding/kitsune",
                       "--disable-updater", "--disable-crashreporter", "--enable-release",
                       "--enable-update-channel=release"):
            self.assertIn(option, text)
        self.assertNotIn("librewolf", text.lower())
        self.assertNotIn("MOZ_REQUIRE_SIGNING", text)


def make_package(path: Path):
    with tarfile.open(path, "w:xz") as archive:
        for name, mode in (("kitsune/kitsune", 0o755), ("kitsune/libxul.so", 0o644)):
            data = b"#!/bin/sh\n" if name.endswith("kitsune") else b"lib"
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(data), mode
            archive.addfile(info, io.BytesIO(data))


class InstallTests(unittest.TestCase):
    def setUp(self):
        base = Path(tempfile.mkdtemp())
        self.layout = engine.Layout(base / "data/kitsune-browser", base / "state/kitsune-browser", base / "cache")
        self.package = base / "kitsune.tar.xz"
        make_package(self.package)

    def install(self, version="157.0.1", fp="a" * 64, check=lambda binary, version: {"ok": True}):
        return engine.install_package(self.layout, version, self.package, "b" * 64, fp, log=lambda *_: None, check=check,
                                      addons=lambda layout, target, log: (target.mkdir(parents=True), (target / "fixture@kitsune.xpi").write_bytes(b"xpi")))

    def test_install_adds_own_configuration_and_switches_atomically(self):
        target = self.install()
        self.assertTrue(self.layout.current.is_symlink())
        self.assertEqual(os.readlink(self.layout.current), target.name)
        for relative in ("distribution/extensions/fixture@kitsune.xpi", "defaults/pref/autoconfig.js", "kitsune.cfg", "kitsune-engine.json"):
            self.assertTrue((target / relative).is_file(), relative)
        # Sin políticas de empresa: no sale «gestionado por tu organización».
        self.assertFalse((target / "distribution/policies.json").exists())
        current, manifest = self.layout.current_engine()
        self.assertEqual(current, target.resolve())
        self.assertEqual(manifest["engineVersion"], "157.0.1")
        self.assertEqual(manifest["signedBy"], engine.MOZILLA_RELEASE_KEY)

    def test_failed_smoke_test_keeps_the_current_engine(self):
        first = self.install()
        def failing(binary, version):
            raise engine.EngineError("smoke failed")
        with self.assertRaises(engine.EngineError):
            self.install("158.0", "c" * 64, check=failing)
        self.assertEqual(self.layout.current.resolve(), first.resolve())
        self.assertEqual([p.name for p in self.layout.engines.iterdir() if not p.name.startswith(".")
                          and not p.is_symlink()], [first.name])
        self.assertFalse(list(self.layout.engines.glob(".installing-*")))

    def test_no_engine_means_no_current(self):
        self.assertEqual(self.layout.current_engine(), (None, None))
        self.layout.engines.mkdir(parents=True)
        os.symlink("missing", self.layout.current)
        self.assertEqual(self.layout.current_engine(), (None, None))

    def test_prune_keeps_current_previous_and_engines_in_use(self):
        engines = []
        for index, version in enumerate(("154.0", "155.0", "156.0", "157.0")):
            engines.append(self.install(version, f"{index}" * 64))
            manifest = engines[-1] / "kitsune-engine.json"
            data = json.loads(manifest.read_text())
            data["installedAt"] = f"2026-10-0{index + 1}T00:00:00+00:00"
            manifest.write_text(json.dumps(data))
        busy = engines[0]
        removed = engine.prune(self.layout, log=lambda *_: None, using=lambda path: path == busy)
        remaining = sorted(p.name for p in self.layout.engines.iterdir() if not p.is_symlink())
        self.assertEqual(removed, [engines[1].name])
        self.assertEqual(remaining, sorted([engines[0].name, engines[2].name, engines[3].name]))
        self.assertEqual(self.layout.current.resolve(), engines[3].resolve())

    def test_in_use_reads_process_executables(self):
        proc = Path(tempfile.mkdtemp())
        target = self.install()
        (proc / "4242").mkdir()
        os.symlink(target / "kitsune", proc / "4242/exe")
        (proc / "self").mkdir()
        self.assertTrue(engine.in_use(target, proc))
        self.assertFalse(engine.in_use(target.parent / "other", proc))


class ProfileSafekeepingTests(unittest.TestCase):
    def profile(self, platform_dir):
        root = Path(tempfile.mkdtemp())
        profile = root / "data/kitsune-browser/profile"
        profile.mkdir(parents=True)
        (profile / "places.sqlite").write_bytes(b"history")
        if platform_dir is not None:
            (profile / "compatibility.ini").write_text(f"[Compatibility]\nLastVersion=154.0\nLastPlatformDir={platform_dir}\n")
        return root, profile

    def test_profile_from_another_engine_is_copied_once_closed(self):
        root, profile = self.profile("/home/risco/.local/share/kitsune-browser/runtime/154.0-2-kitsune4-x")
        copy = engine.backup_profile(profile, root / "data")
        self.assertEqual((copy / "profile/places.sqlite").read_bytes(), b"history")
        self.assertTrue(copy.name.startswith("kitsune-0.6-profile-backup."))

    def test_new_or_own_engine_profiles_are_not_copied(self):
        root, profile = self.profile(None)
        self.assertIsNone(engine.backup_profile(profile, root / "data"))
        root, profile = self.profile("/home/risco/.local/share/kitsune-browser/engine/157.0.1-abc")
        self.assertIsNone(engine.backup_profile(profile, root / "data"))

    def test_profile_in_use_is_never_copied(self):
        root, profile = self.profile("/usr/lib/librewolf")
        (profile / ".parentlock").write_text("")
        script = ("import fcntl,os,sys,time; fd=os.open(sys.argv[1],os.O_RDWR); "
                  "fcntl.lockf(fd,fcntl.LOCK_EX); print('locked',flush=True); time.sleep(30)")
        holder = subprocess.Popen([sys.executable, "-c", script, str(profile / ".parentlock")], stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), "locked")
            self.assertTrue(engine.profile_in_use(profile))
            self.assertIsNone(engine.backup_profile(profile, root / "data"))
        finally:
            holder.kill()
            holder.wait()
        self.assertFalse(engine.profile_in_use(profile))
        self.assertIsNotNone(engine.backup_profile(profile, root / "data"))


class ResourceTests(unittest.TestCase):
    def meminfo(self, kib):
        path = Path(tempfile.mkdtemp()) / "meminfo"
        path.write_text(f"MemTotal:       32000000 kB\nMemAvailable:   {kib} kB\n")
        return path

    def test_jobs_follow_available_memory_with_gkrust_headroom(self):
        gib = 1024 * 1024
        self.assertEqual(engine.build_jobs(self.meminfo(18 * gib), cpus=16), 6)
        self.assertEqual(engine.build_jobs(self.meminfo(64 * gib), cpus=16), 16)
        self.assertEqual(engine.build_jobs(self.meminfo(1 * gib), cpus=16), 2)
        self.assertEqual(engine.build_jobs(Path("/nonexistent/meminfo"), cpus=16), 2)
        # Inside the update service its cgroup memory.max is the real limit.
        self.assertEqual(engine.build_jobs(self.meminfo(30 * gib), cpus=16, limit=20 * 2**30), 7)

    def test_cgroup_memory_limit_is_read_from_own_cgroup(self):
        root = Path(tempfile.mkdtemp())
        (root / "proc").mkdir()
        (root / "proc/cgroup").write_text("0::/user.slice/kitsune-engine-update.service\n")
        unit = root / "sys/user.slice/kitsune-engine-update.service"
        unit.mkdir(parents=True)
        (unit / "memory.max").write_text("21474836480\n")
        self.assertEqual(engine.cgroup_memory_limit(root / "proc/cgroup", root / "sys"), 20 * 2**30)
        (unit / "memory.max").write_text("max\n")
        self.assertIsNone(engine.cgroup_memory_limit(root / "proc/cgroup", root / "sys"))

    def test_status_reports_a_build_killed_from_outside(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        dead = subprocess.Popen([sys.executable, "-c", "pass"])
        dead.wait()
        engine.write_status(layout, building={"version": "157.0.1", "since": "2026-10-09T19:58:15+00:00", "pid": dead.pid})
        report = engine.status(layout)
        self.assertIsNone(report["building"])
        self.assertEqual(report["lastBuild"]["result"], "interrumpida")
        engine.write_status(layout, building={"version": "157.0.1", "since": "x", "pid": os.getpid()})
        self.assertEqual(engine.status(layout)["building"]["pid"], os.getpid())


class BuildFlowTests(unittest.TestCase):
    def test_up_to_date_engine_is_not_rebuilt(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data/kitsune-browser", base / "state/kitsune-browser", base / "cache")
        package = base / "kitsune.tar.xz"
        make_package(package)
        fp = engine.install_fingerprint("157.0.1")
        engine.install_package(layout, "157.0.1", package, "b" * 64, fp, log=lambda *_: None,
                               check=lambda binary, version: {}, addons=lambda *args: None)
        messages = []
        result = engine.build(layout, "157.0.1", if_new=True, log=messages.append)
        self.assertEqual(result, layout.current.resolve())
        self.assertIn("al día", messages[-1])

    def test_only_one_build_at_a_time(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        with engine.build_lock(layout):
            with self.assertRaises(engine.EngineError):
                with engine.build_lock(layout):
                    pass


if __name__ == "__main__":
    unittest.main()


class DistributionAddonTests(unittest.TestCase):
    def xpi(self, addon):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr("manifest.json", json.dumps({"browser_specific_settings": {"gecko": {"id": addon}}}))
            archive.writestr("META-INF/cose.sig", b"signed")
        return output.getvalue()

    def test_signed_xpi_with_the_expected_id_is_bundled_and_reused_offline(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        good = self.xpi("uBlock0@raymondhill.net")
        opener = lambda url, timeout: contextlib.closing(io.BytesIO(good))
        engine.distribution_addons(layout, base / "one", log=lambda *_: None, opener=opener)
        self.assertEqual((base / "one/uBlock0@raymondhill.net.xpi").read_bytes(), good)
        def offline(url, timeout):
            raise OSError("sin red")
        engine.distribution_addons(layout, base / "two", log=lambda *_: None, opener=offline)
        self.assertEqual((base / "two/uBlock0@raymondhill.net.xpi").read_bytes(), good)

    def test_a_download_with_another_id_is_rejected(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        bad = self.xpi("other@example.com")
        engine.distribution_addons(layout, base / "out", log=lambda *_: None, opener=lambda url, timeout: contextlib.closing(io.BytesIO(bad)))
        self.assertFalse((base / "out/uBlock0@raymondhill.net.xpi").exists())


class TargetTests(unittest.TestCase):
    def test_cross_mozconfig_targets_the_other_system_in_its_own_objdir_without_the_key(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        layout.cache.mkdir(parents=True)
        for target, triple in engine.TARGETS.items():
            text = engine.write_target_mozconfig(layout, "157.0.1", target).read_text()
            self.assertIn(f"ac_add_options --target={triple}", text)
            self.assertIn(f"obj-157.0.1-{target}", text)
            self.assertNotIn("safebrowsing-api-keyfile", text)
            self.assertEqual("--disable-default-browser-agent" in text, target == "windows")
        with self.assertRaises(engine.EngineError):
            engine.build_target(layout, "157.0.1", "beos")


    def test_windows_gets_msiextract_from_signed_packages_in_the_cache(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        tools = layout.private(layout.cache / "bin")
        calls = []

        def run(command, **kwargs):
            calls.append(command)
            if command[:2] == ["pacman", "-Sp"]:
                return types.SimpleNamespace(returncode=0, stdout=f"https://m/extra/os/x86_64/{command[2]}-1-x86_64.pkg.tar.zst\n")
            if command[0] == "tar":
                staging = Path(command[command.index("-C") + 1])
                (staging / "usr/bin").mkdir(parents=True, exist_ok=True)
                for program in ("msiextract",):
                    (staging / "usr/bin" / program).write_text("")
            return types.SimpleNamespace(returncode=0, stdout="")
        with mock.patch.object(engine.shutil, "which", return_value=None):
            engine.cross_tools(layout, tools, "macos", log=lambda *_: None, run=run)
            self.assertEqual(calls, [])
            engine.cross_tools(layout, tools, "windows", log=lambda *_: None, run=run)
        self.assertEqual(sum(command[0] == "pacman-key" for command in calls), 1)
        self.assertTrue((layout.cache / "toolchain/msitools/usr/bin/msiextract").is_file())
        self.assertIn("toolchain/msitools", (tools / "msiextract").read_text())
        # Con el sistema ya equipado no se baja nada.
        calls.clear()
        with mock.patch.object(engine.shutil, "which", return_value="/usr/bin/x"):
            engine.cross_tools(layout, layout.private(base / "otro-bin"), "windows", log=lambda *_: None, run=run)
        self.assertEqual(calls, [])

    def test_a_package_gone_from_the_mirror_comes_from_the_arch_archive(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        tools = layout.private(layout.cache / "bin")
        fetched = []

        def run(command, **kwargs):
            if command[:2] == ["pacman", "-Sp"]:
                return types.SimpleNamespace(returncode=0, stdout=f"https://m/extra/os/x86_64/{command[2]}-26.02-1-x86_64.pkg.tar.zst\n")
            if command[0] == "curl":
                fetched.append(command[-1])
                return types.SimpleNamespace(returncode=22 if command[-1].startswith("https://m/") else 0, stdout="")
            if command[0] == "tar":
                staging = Path(command[command.index("-C") + 1])
                (staging / "usr/bin").mkdir(parents=True, exist_ok=True)
                for program in ("msiextract",):
                    (staging / "usr/bin" / program).write_text("")
            return types.SimpleNamespace(returncode=0, stdout="")
        with mock.patch.object(engine.shutil, "which", return_value=None):
            engine.cross_tools(layout, tools, "windows", log=lambda *_: None, run=run)
        self.assertIn(f"{engine.ARCH_ARCHIVE}/m/msitools/msitools-26.02-1-x86_64.pkg.tar.zst", fetched)
        self.assertIn(f"{engine.ARCH_ARCHIVE}/m/msitools/msitools-26.02-1-x86_64.pkg.tar.zst.sig", fetched)

    def test_a_bad_signature_stops_the_windows_tools(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        tools = layout.private(layout.cache / "bin")

        def run(command, **kwargs):
            if command[:2] == ["pacman", "-Sp"]:
                return types.SimpleNamespace(returncode=0, stdout="https://m/extra/os/x86_64/gcab-1-x86_64.pkg.tar.zst\n")
            return types.SimpleNamespace(returncode=1 if command[0] == "pacman-key" else 0, stdout="")
        with mock.patch.object(engine.shutil, "which", return_value=None), self.assertRaises(engine.EngineError):
            engine.cross_tools(layout, tools, "windows", log=lambda *_: None, run=run)
        self.assertFalse((tools / "msiextract").exists())


    def rust_run(self, calls, fingerprint=None, valid=True):
        good = fingerprint or engine.RUST_KEY_FINGERPRINT

        def run(command, **kwargs):
            calls.append(command)
            if command[0] == "rustc":
                return types.SimpleNamespace(returncode=0, stdout="rustc 1.98.0 (88d9e12ae 2026-08-18)\n")
            if command[0] == "gpg" and "--fingerprint" in command:
                return types.SimpleNamespace(returncode=0, stdout=f"fpr:::::::::{good}:\n")
            if command[0] == "gpg" and "--verify" in command:
                return types.SimpleNamespace(returncode=0 if valid else 1, stdout=f"[GNUPG:] VALIDSIG {good} x\n" if valid else "")
            if command[0] == "tar":
                unpacked = Path(command[command.index("-C") + 1])
                name = unpacked.name.split("-1.98.0-")[0]
                platform = unpacked.name.split("-1.98.0-")[1]
                component = name if name != "rust-std" else f"rust-std-{platform}"
                (unpacked / "components").write_text(component + "\n")
                inner = {"rustc": "bin/rustc", "cargo": "bin/cargo"}.get(name, f"lib/rustlib/{platform}/lib/libstd.rlib")
                (unpacked / component / inner).parent.mkdir(parents=True)
                (unpacked / component / inner).write_text("")
                (unpacked / component / "manifest.in").write_text("")
            return types.SimpleNamespace(returncode=0, stdout="")
        return run

    def test_cross_builds_get_signed_official_rust_with_the_target_std(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        layout.private(layout.cache)
        calls = []
        env = engine.cross_rust(layout, "windows", log=lambda *_: None, run=self.rust_run(calls))
        root = layout.cache / "toolchain/rust-1.98.0"
        self.assertEqual(env, {"RUSTC": str(root / "bin/rustc"), "CARGO": str(root / "bin/cargo")})
        self.assertTrue((root / "lib/rustlib/x86_64-pc-windows-msvc/lib/libstd.rlib").is_file())
        self.assertTrue((root / "lib/rustlib/x86_64-unknown-linux-gnu/lib/libstd.rlib").is_file())
        self.assertFalse((root / "manifest.in").exists())
        self.assertEqual(sum("--verify" in command for command in calls), 4)
        # macOS después: solo baja su biblioteca estándar.
        calls.clear()
        engine.cross_rust(layout, "macos", log=lambda *_: None, run=self.rust_run(calls))
        downloads = [command[-1] for command in calls if command[0] == "curl" and not command[-1].endswith((".asc", "ascii"))]
        self.assertEqual(downloads, [f"{engine.RUST_DIST}/rust-std-1.98.0-aarch64-apple-darwin.tar.xz"])
        self.assertTrue((root / "lib/rustlib/aarch64-apple-darwin/lib/libstd.rlib").is_file())

    def test_rust_with_another_key_or_a_bad_signature_is_rejected(self):
        for kwargs in ({"fingerprint": "0" * 40}, {"valid": False}):
            base = Path(tempfile.mkdtemp())
            layout = engine.Layout(base / "data", base / "state", base / "cache")
            layout.private(layout.cache)
            with self.assertRaises(engine.EngineError):
                engine.cross_rust(layout, "windows", log=lambda *_: None, run=self.rust_run([], **kwargs))
            self.assertFalse((layout.cache / "toolchain/rust-1.98.0").exists())


    def test_the_windows_package_gets_kitsune_cfg_and_ublock_and_a_new_installer(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        dist = layout.cache / "obj-157.0.1-windows/dist"
        dist.mkdir(parents=True)
        package = dist / "kitsune-157.0.1.en-US.win64.zip"
        with zipfile.ZipFile(package, "w") as archive:
            archive.writestr("kitsune/kitsune.exe", b"MZ")
        calls = []

        def addons(layout, target, log):
            target.mkdir(parents=True, exist_ok=True)
            (target / "uBlock0@raymondhill.net.xpi").write_bytes(b"xpi")
        run = lambda command, **kwargs: calls.append(command) or types.SimpleNamespace(returncode=0)
        logfile = base / "build.log"
        for _ in range(2):
            engine.finish_windows_package(layout, "157.0.1", base / "src", {}, logfile, log=lambda *_: None, run=run, addons=addons)
        with zipfile.ZipFile(package) as archive:
            names = archive.namelist()
            self.assertEqual(archive.read("kitsune/kitsune.cfg"), (ROOT / "install/recipe/kitsune.cfg").read_bytes())
            self.assertIn("kitsune/defaults/pref/autoconfig.js", names)
            self.assertIn("kitsune/distribution/extensions/uBlock0@raymondhill.net.xpi", names)
            self.assertEqual(len(names), len(set(names)))
        self.assertTrue(all("repackage" in command and "installer" in command for command in calls))
        self.assertIn("--use-upx", calls[0])


class L10nTests(unittest.TestCase):
    def setup(self, head=None):
        base = Path(tempfile.mkdtemp())
        self.layout = engine.Layout(base / "data", base / "state", base / "cache")
        self.layout.cache.mkdir(parents=True)
        self.source = self.layout.cache / "src-157.0.1"
        (self.source / "browser/locales").mkdir(parents=True)
        self.rev = "a" * 40
        (self.source / "browser/locales/l10n-changesets.json").write_text(json.dumps({"es-ES": {"revision": self.rev}}))
        self.calls = []
        repo = self.layout.cache / "l10n"

        def run(command, **kwargs):
            self.calls.append(command)
            if command[:2] == ["git", "clone"]:
                (repo / ".git").mkdir(parents=True)
            if "checkout" in command:
                for relative, patches in engine.L10N_PATCHES.items():
                    path = repo / relative
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("\n".join(old for old, _ in patches) + "\n")
            out = (head or self.rev) + "\n" if "rev-parse" in command else ""
            return types.SimpleNamespace(returncode=0, stdout=out, stderr="")
        return run

    def test_spanish_is_fetched_at_the_pinned_revision_and_gets_kitsune_names(self):
        run = self.setup()
        result = engine.prepare_l10n(self.layout, self.source, log=lambda *_: None, run=run)
        self.assertEqual(result, self.layout.cache / "l10n-157.0.1")
        self.assertTrue(any(self.rev in command for command in self.calls))
        for relative, patches in engine.L10N_PATCHES.items():
            text = (result / relative).read_text()
            for old, new in patches:
                self.assertIn(new, text)
                self.assertNotIn(old, text)
        self.assertNotIn("Firefox", (result / "es-ES/toolkit/toolkit/branding/brandings.ftl").read_text())

    def test_a_checkout_at_another_revision_is_rejected(self):
        run = self.setup(head="b" * 40)
        with self.assertRaises(engine.EngineError):
            engine.prepare_l10n(self.layout, self.source, log=lambda *_: None, run=run)


class SmokeCheckTests(unittest.TestCase):
    GOOD = {"name": "Kitsune", "version": "157.0.1", "brand": "Kitsune", "nativeEntry": True, "nativeModule": True,
            "policies": False, "fxaccounts": False, "privacyMode": "estricto", "signaturesRequired": True, "sandboxLevel": 6,
            "channel": "release", "telemetryExtended": False,
            "userAgent": "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0"}

    def check(self, **changes):
        from unittest import mock
        fake = types.ModuleType("engine_probe")
        fake.smoke = lambda binary: {**self.GOOD, **changes}
        with mock.patch.dict(sys.modules, {"engine_probe": fake}):
            return engine.smoke_check(Path("/x/kitsune"), "157.0.1")

    def test_good_engine_passes(self):
        self.assertEqual(self.check()["name"], "Kitsune")

    def test_kitsune_user_agent_or_missing_protections_fail(self):
        for changes in ({"userAgent": "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Kitsune/157.0.1"},
                        {"brand": None}, {"nativeModule": False}, {"policies": True}, {"fxaccounts": True}, {"sandboxLevel": 0},
                        {"privacyMode": ""}, {"signaturesRequired": False}, {"error": "timeout"},
                        {"channel": "default"}, {"telemetryExtended": True}):
            with self.assertRaises(engine.EngineError, msg=str(changes)):
                self.check(**changes)
