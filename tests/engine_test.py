"""Offline tests for Kitsune's own engine pipeline (install/kitsune-engine.py)."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest

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
        self.assertLess(jar.index("browser-main.js"), jar.index("kitsune-bootstrap.js"))
        self.assertIn(engine.KITSUNE_BOOTSTRAP, (root / "browser/base/content/browser.xhtml").read_text())
        self.assertIn("basado en Mozilla Gecko", (root / "browser/base/content/aboutDialog.xhtml").read_text())
        for name in engine.NATIVE_FILES:
            self.assertEqual((root / "browser/base/content" / name).read_bytes(), (ROOT / "install/native" / name).read_bytes())
        self.assertNotIn("LibreWolf", (brand / "locales/en-US/brand.ftl").read_text())

    def test_rust_uses_thin_lto_and_tuning_can_be_reapplied(self):
        root = self.source_tree()
        rules = root / "config/makefiles/rust.mk"
        rules.parent.mkdir(parents=True)
        rules.write_text("ifndef MOZ_LTO_RUST_CROSS\n" + engine.RUST_FAT_LTO + "\nendif\n")
        engine.tune_build(root)
        engine.tune_build(root)
        self.assertEqual(rules.read_text().count(engine.RUST_THIN_LTO), 1)
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
        self.assertNotEqual(engine.build_fingerprint("157.0.1"), engine.build_fingerprint("157.0"))
        self.assertEqual(engine.build_fingerprint("157.0.1"), engine.build_fingerprint("157.0.1"))
        self.assertNotEqual(engine.install_fingerprint("157.0.1"), engine.build_fingerprint("157.0.1"))

    def test_mozconfig_has_own_identity_and_no_updater(self):
        text = (ROOT / "install/recipe/mozconfig.in").read_text()
        for option in ("--with-app-name=kitsune", "--with-branding=browser/branding/kitsune", "MOZ_APP_UA_NAME=Firefox",
                       "--disable-updater", "--disable-crashreporter", "--enable-release"):
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
        return engine.install_package(self.layout, version, self.package, "b" * 64, fp, log=lambda *_: None, check=check)

    def test_install_adds_own_configuration_and_switches_atomically(self):
        target = self.install()
        self.assertTrue(self.layout.current.is_symlink())
        self.assertEqual(os.readlink(self.layout.current), target.name)
        for relative in ("distribution/policies.json", "defaults/pref/autoconfig.js", "kitsune.cfg", "kitsune-engine.json"):
            self.assertTrue((target / relative).is_file(), relative)
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
                               check=lambda binary, version: {})
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


class SmokeCheckTests(unittest.TestCase):
    GOOD = {"name": "Kitsune", "version": "157.0.1", "brand": "Kitsune", "nativeEntry": True, "nativeModule": True,
            "policies": True, "privacyMode": "estricto", "signaturesRequired": True, "sandboxLevel": 6,
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
                        {"brand": None}, {"nativeModule": False}, {"policies": False}, {"sandboxLevel": 0},
                        {"privacyMode": ""}, {"signaturesRequired": False}, {"error": "timeout"}):
            with self.assertRaises(engine.EngineError, msg=str(changes)):
                self.check(**changes)
