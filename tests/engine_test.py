"""Offline tests for Kitsune's own engine pipeline (install/kitsune-engine.py)."""
import hashlib
import importlib.util
import contextlib
import io
import json
import re
import os
import plistlib
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


class LayoutTests(unittest.TestCase):
    def test_a_build_cache_moved_to_another_disk_behind_a_symlink_is_used_by_its_real_path(self):
        # El 13-10 la caché se movió a /mnt/datos con un enlace: mach trabaja con la ruta real y,
        # si la receta le pasa la del enlace, borra (a null) su propia configuración.
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            real = root / "datos/kitsune-build"
            real.mkdir(parents=True)
            (root / "cache").mkdir()
            (root / "cache/kitsune-build").symlink_to(real)
            with mock.patch.dict(os.environ, {"XDG_CACHE_HOME": str(root / "cache"), "XDG_DATA_HOME": str(root / "data"),
                                              "XDG_STATE_HOME": str(root / "state")}):
                layout = engine.Layout.default()
            self.assertEqual(layout.cache, real.resolve())
            layout.private(layout.cache)


class LinuxPackageTests(unittest.TestCase):
    def test_the_linux_download_is_the_recipe_engine_with_its_config_ublock_release_and_installer(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            layout = engine.Layout(root / "data", root / "state", root / "cache")
            build = root / "build/kitsune"
            (build / "browser").mkdir(parents=True)
            (build / "kitsune").write_text("#!/bin/sh\n")
            with zipfile.ZipFile(build / "browser/omni.ja", "w") as omni:
                omni.writestr("localization/en-US/branding/brand.ftl", "-brand-short-name = Kitsune\n-vendor-short-name = Kitsune\n")
                omni.writestr("chrome/es-ES/locale/branding/brand.properties", "brandShortName=Kitsune\n")
                omni.writestr("chrome/browser/content/browser/browser.xhtml", "<window/>")
            (layout.cache / "packages").mkdir(parents=True)
            package = layout.cache / "packages" / f"kitsune-157.0.1-{engine.build_fingerprint('157.0.1')[:16]}.tar.xz"
            subprocess.run(["tar", "-cJf", str(package), "-C", str(root / "build"), "kitsune"], check=True)
            checked = []
            def addons(layout, target, log):
                target.mkdir(parents=True, exist_ok=True)
                (target / "uBlock0@raymondhill.net.xpi").write_bytes(b"xpi")
            archive = engine.package_linux(layout, "157.0.1", log=lambda *a: None, check=lambda binary, version, product="kitsune": checked.append((binary.parent.name, product)),
                                           addons=addons)
            release = engine.published_release()
            self.assertEqual(archive.name, f"Kitsune-{release}-Linux-x86_64.tar.xz")
            self.assertEqual(checked, [("kitsune", "kitsune"), ("kitsune-zero", "zero")])  # el de Kitsune y el de Kitsune Zero
            with tarfile.open(archive) as handle:
                names = set(handle.getnames())
                members = {member.name: member for member in handle.getmembers()}
                release_js = handle.extractfile("kitsune/defaults/pref/kitsune-release.js").read().decode()
            for name in ("kitsune/kitsune", "kitsune/kitsune.cfg", "kitsune/defaults/pref/autoconfig.js",
                         "kitsune/distribution/extensions/uBlock0@raymondhill.net.xpi", "kitsune/instalar.sh", "kitsune/desinstalar.sh"):
                self.assertIn(name, names)
            self.assertIn(f'pref("kitsune.release", "{release}");', release_js)
            self.assertEqual(members["kitsune/instalar.sh"].mode & 0o777, 0o755)
            self.assertEqual((members["kitsune/instalar.sh"].uid, members["kitsune/instalar.sh"].uname), (0, ""))
            self.assertFalse(list((layout.cache / "packages/linux").glob("*.part")))
            # Desde la 0.8 beta 3, Kitsune no lleva Zero (ni sus reglas de cristal): es Kitsune Zero, a su lado.
            self.assertFalse([name for name in names if "zero" in name], names)
            self.assertNotIn("kitsune.product", "".join(names))
            self.assertNotIn('cristal.py" poner', (engine.LINUX_PACKAGE / "instalar.sh").read_text())
            zero = layout.cache / "packages/linux" / f"Kitsune-Zero-{release}-Linux-x86_64.tar.xz"
            with tarfile.open(zero) as handle:
                zero_names = set(handle.getnames())
                zero_members = {member.name: member for member in handle.getmembers()}
                product = handle.extractfile("kitsune-zero/defaults/pref/kitsune-product.js").read().decode()
                launcher = handle.extractfile("kitsune-zero/kitsune-zero").read().decode()
                omni = zipfile.ZipFile(io.BytesIO(handle.extractfile("kitsune-zero/browser/omni.ja").read()))
                icon = handle.extractfile("kitsune-zero/browser/chrome/icons/default/default48.png").read()
            for name in ("kitsune-zero/kitsune", "kitsune-zero/kitsune.cfg", "kitsune-zero/instalar.sh", "kitsune-zero/desinstalar.sh",
                         "kitsune-zero/distribution/extensions/uBlock0@raymondhill.net.xpi", "kitsune-zero/defaults/pref/kitsune-release.js",
                         "kitsune-zero/zero-linux/install-niri.sh", "kitsune-zero/zero-linux/kitsune-zero.kdl", "kitsune-zero/zero-linux/cristal.py"):
                self.assertIn(name, zero_names)
            self.assertIn('pref("kitsune.product", "zero");', product)
            self.assertIn('pref("kitsune.zero.importProfile", true);', product)
            self.assertIn("MOZ_APP_REMOTINGNAME=kitsune-zero", launcher)
            self.assertEqual(zero_members["kitsune-zero/kitsune-zero"].mode & 0o777, 0o755)
            self.assertEqual(omni.read("localization/en-US/branding/brand.ftl").decode(), "-brand-short-name = Kitsune Zero\n-vendor-short-name = Kitsune\n")
            self.assertEqual(omni.read("chrome/es-ES/locale/branding/brand.properties").decode(), "brandShortName=Kitsune Zero\n")
            self.assertEqual(omni.read("chrome/browser/content/browser/browser.xhtml"), b"<window/>")
            self.assertEqual(icon, (ROOT / "install/branding-zero/icon-48.png").read_bytes())
            zero_installer = (engine.LINUX_PACKAGE / "zero/instalar.sh").read_text()
            for piece in ('kitsune-zero.desktop', 'StartupWMClass=kitsune-zero', 'zero-linux/install-niri.sh', 'zero-linux/cristal.py" poner'):
                self.assertIn(piece, zero_installer)
            self.assertIn('zero-linux/cristal.py" quitar', (engine.LINUX_PACKAGE / "zero/desinstalar.sh").read_text())

    def test_without_the_engine_built_there_is_no_linux_package(self):
        with tempfile.TemporaryDirectory() as folder:
            layout = engine.Layout(Path(folder) / "d", Path(folder) / "s", Path(folder) / "c")
            with self.assertRaises(engine.EngineError):
                engine.package_linux(layout, "157.0.1", log=lambda *a: None)


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

    def test_kitsune_zero_has_its_own_brand_and_windows_shortcut_name_and_kitsune_gets_its_own_back(self):
        # Kitsune Zero (Risco, 15-10): el mismo motor con su marca; MOZ_APP_DISPLAYNAME no cambia (así no se vuelve a
        # configurar), y su nombre en Windows lo pone branding.nsi (defines.nsi lo lee, ver el parche).
        root = self.source_tree()
        engine.write_branding(root, "zero")
        brand = root / "browser/branding/kitsune"
        self.assertIn("-brand-short-name = Kitsune Zero", (brand / "locales/en-US/brand.ftl").read_text())
        self.assertIn("-vendor-short-name = Kitsune\n", (brand / "locales/en-US/brand.ftl").read_text())
        self.assertIn("brandShortName=Kitsune Zero", (brand / "locales/en-US/brand.properties").read_text())
        self.assertIn("MOZ_APP_DISPLAYNAME=Kitsune\n", (brand / "configure.sh").read_text())
        nsi = (brand / "branding.nsi").read_text()
        self.assertIn('!define BrandFullName          "Kitsune Zero"', nsi)
        self.assertIn('!define KitsuneBrandShortName "Kitsune Zero"', nsi)
        self.assertEqual((brand / "firefox.ico").read_bytes(), (ROOT / "install/branding-zero/windows/firefox.ico").read_bytes())
        self.assertEqual((brand / "firefox.icns").read_bytes(), (ROOT / "install/branding-zero/macos/firefox.icns").read_bytes())
        self.assertEqual((brand / "default48.png").read_bytes(), (ROOT / "install/branding-zero/icon-48.png").read_bytes())
        engine.write_branding(root)
        self.assertIn("-brand-short-name = Kitsune\n", (brand / "locales/en-US/brand.ftl").read_text())
        self.assertNotIn("KitsuneBrandShortName", (brand / "branding.nsi").read_text())
        self.assertEqual((brand / "firefox.ico").read_bytes(), (ROOT / "install/branding/windows/firefox.ico").read_bytes())
        patch = "".join(new for _, new in engine.TEXT_PATCHES["browser/installer/windows/nsis/defines.nsi.in"])
        self.assertIn('!ifdef KitsuneBrandShortName\n!define BrandShortName "${KitsuneBrandShortName}"', patch)

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

    def test_a_source_prepared_before_chrome_style_existed_gets_its_jar_line(self):
        root = self.source_tree()
        jar = root / "browser/base/jar.mn"
        jar.write_text(jar.read_text().replace(
            "        content/browser/browser-main.js       (content/browser-main.js)\n",
            "        content/browser/browser-main.js       (content/browser-main.js)\n"
            "        content/browser/kitsune-bootstrap.js (content/kitsune-bootstrap.js)\n"
            "        content/browser/kitsune-appearance.sys.mjs (content/kitsune-appearance.sys.mjs)\n"))
        engine.integrate_native(root)
        engine.integrate_native(root)
        text = jar.read_text()
        self.assertEqual(text.count(engine.CHROME_JAR_ENTRY), 1)
        self.assertLess(text.index("kitsune-appearance.sys.mjs"), text.index(engine.CHROME_JAR_ENTRY))

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

    def test_tiled_windows_have_no_gtk_frame(self):
        # En niri (tiled-state) las ventanas de Kitsune no llevan el marco de GTK (sombra y un borde de
        # 1 px): en Kitsune Zero, transparente, enmarcaba el vacío. Solo en el proceso de Kitsune: el
        # estilo va en el proveedor de GTK que Gecko ya crea (el de las esquinas redondeadas), que pasa
        # a crearse siempre.
        css = "".join(new for _, new in engine.TEXT_PATCHES["widget/gtk/nsLookAndFeel.cpp"])
        self.assertIn("window.csd.tiled decoration", css)
        self.assertIn("box-shadow: none", css)
        self.assertNotIn("return ClearRoundedCornerProvider();", css)
        header = "".join(new for _, new in engine.TEXT_PATCHES["widget/gtk/nsLookAndFeel.h"])
        self.assertIn("mRoundedCornerProviderRadius = -1", header)

    def test_wayland_opaque_region_reaches_the_compositor_at_once(self):
        # GDK solo aplica a su wl_surface la región opaca que le pasa Gecko cuando repinta su ventana (al
        # cambiar el foco): en Kitsune Zero, transparente, una región vieja dejaba negro lo que ya era
        # transparente (Risco, 15-10). Como hace Gecko con la región de entrada: se le pide repintar.
        [(old, new)] = engine.TEXT_PATCHES["widget/gtk/nsWindow.cpp"]
        self.assertIn("mSurface->SetOpaqueRegion(mOpaqueRegion.ToUnknownRegion());", old)
        self.assertIn("gdk_window_invalidate_rect(window, nullptr, false);", new)
        self.assertLess(new.index("SetOpaqueRegion"), new.index("gdk_window_invalidate_rect"))
        root = self.rebrand_tree()
        engine.rebrand_source(root)
        engine.rebrand_source(root)
        self.assertEqual((root / "widget/gtk/nsWindow.cpp").read_text().count("gdk_window_invalidate_rect"), 1)

    def test_kitsune_zero_on_macos_26_has_apple_liquid_glass_behind(self):
        # En macOS 26 o posterior, con la ventana de Zero transparente, el cristal de Apple (NSGlassEffectView)
        # detrás de la vista de Gecko: dobla lo de detrás de la ventana. Solo si Zero lo pide (su ajuste) y solo
        # en ventanas principales; al volver a opaca, se quita.
        patches = engine.TEXT_PATCHES["widget/cocoa/nsCocoaWindow.mm"]
        code = "".join(new for _, new in patches)
        for piece in ("@available(macOS 26.0, *)", "NSGlassEffectView", "positioned:NSWindowBelow", "removeFromSuperview",
                      '"kitsune.zero.macos-glass"', "mWindowType == WindowType::TopLevel",
                      # Con las esquinas de una ventana de macOS (las de zero.css), que se pueden cambiar.
                      'Preferences::GetInt("kitsune.zero.macos-glass-radius", 16)'):
            self.assertIn(piece, code)
        # Apagado de serie: en un Mac de verdad no salió bien (Risco, 15-10); solo con el ajuste a true.
        self.assertIn('Preferences::GetBool("kitsune.zero.macos-glass", false)', code)
        root = self.rebrand_tree()
        engine.rebrand_source(root)
        engine.rebrand_source(root)
        self.assertEqual((root / "widget/cocoa/nsCocoaWindow.mm").read_text().count("SetKitsuneGlass("), 2)

    def test_a_link_from_another_app_opens_with_the_sessions_you_are_in(self):
        # Un enlace de otra app (Discord, el correo…): si Gecko no adivina el contenedor por las pestañas
        # abiertas de esa web, el de la pestaña en la que estás, como Ctrl+T. Así entra con las sesiones del
        # perfil (espacio) en el que estás.
        [(old, new)] = engine.TEXT_PATCHES["browser/modules/BrowserDOMWindow.sys.mjs"]
        self.assertIn("lazy.URILoadingHelper.guessUserContextId(aURI)", old)
        self.assertIn("this.win?.gBrowser?.selectedTab?.userContextId", new)
        self.assertLess(new.index("guessUserContextId"), new.index("selectedTab"))
        self.assertIn("guessUserContextIdEnabled &&", new)

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

    def test_the_recipe_also_fits_gecko_158(self):
        # Gecko 158 quitó la vista antigua de «Apoyar a Firefox» y la ilustración de about:logins,
        # y su enlace de ayuda llama antes a su clase base: la receta sigue sin tocar nada más.
        root = self.rebrand_tree()
        settings = root / "browser/extensions/newtab/lib/AboutPreferences.sys.mjs"
        old_view = next(old for old in engine.TEXT_PATCHES_ONLY_IF)
        settings.write_text(settings.read_text().replace(old_view, ""))
        for relative in engine.MASCOT_GONE_OK:
            (root / relative).unlink()
        link = root / "toolkit/content/widgets/moz-support-link/moz-support-link.mjs"
        link.write_text("class MozSupportLink {\n" + engine.SUPPORT_LINK_158 + "\n  }\n}\n")
        engine.rebrand_source(root)
        engine.rebrand_source(root)
        text = link.read_text()
        self.assertEqual(text.count("display"), 1)
        self.assertIn("super.connectedCallback();", text)
        # Pero si el archivo sigue teniendo la vista antigua y el texto cambió, se para.
        settings.write_text('feed: "showSponsoredCheckboxes"\n')
        with self.assertRaises(engine.EngineError):
            engine.rebrand_source(root)
        rules = root / "config/makefiles/rust.mk"
        rules.parent.mkdir(parents=True)
        rules.write_text("ifdef RUST_LIBRARY_LTO\ncargo_rustc_flags += -Clto\nendif\n")
        (root / "browser/moz.configure").write_text(engine.UA_ANCHOR + "\n")
        engine.tune_build(root)
        engine.tune_build(root)
        self.assertEqual(rules.read_text(), "ifdef RUST_LIBRARY_LTO\n" + engine.RUST_THIN_LTO + "\nendif\n")

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

    def test_zero_is_built_in_as_its_own_folder_and_counts_for_the_fingerprint(self):
        root = self.source_tree()
        engine.integrate_native(root)
        engine.integrate_native(root)
        jar = (root / "browser/base/jar.mn").read_text()
        self.assertEqual(jar.count(engine.ZERO_JAR_ENTRY), 1)
        zero = root / "browser/base/content/zero"
        for source in sorted((ROOT / "zero").rglob("*")):
            relative = source.relative_to(ROOT / "zero")
            if source.is_file() and relative.parts[0] in ("modules", "chrome", "assets"):
                self.assertEqual((zero / relative.name).read_bytes(), source.read_bytes(), relative)
        files = engine.input_files()
        self.assertIn("zero/modules/zero-config.sys.mjs", files)
        self.assertIn("zero/assets/zero-logo.svg", files)

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
    def test_cross_mozconfig_targets_the_other_system_in_its_own_objdir_with_risco_s_key(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        layout.cache.mkdir(parents=True)
        for target, triple in engine.TARGETS.items():
            text = engine.write_target_mozconfig(layout, "157.0.1", target).read_text()
            self.assertIn(f"ac_add_options --target={triple}", text)
            self.assertIn(f"obj-157.0.1-{target}", text)
            self.assertEqual("safebrowsing-api-keyfile" in text, engine.SAFEBROWSING_KEY.is_file())
            self.assertEqual("--disable-default-browser-agent" in text, target == "windows")
            self.assertEqual("--with-distribution-id=io.github.riscooo" in text, target.startswith("macos"))
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
            engine.cross_tools(layout, tools, "linux", log=lambda *_: None, run=run)
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

    def test_macos_gets_rcodesign_only_when_it_matches_the_pinned_sum(self):
        for good in (True, False):
            base = Path(tempfile.mkdtemp())
            layout = engine.Layout(base / "data", base / "state", base / "cache")
            tools = layout.private(layout.cache / "bin")

            def run(command, **kwargs):
                if command[0] == "curl":
                    Path(command[command.index("-o") + 1]).write_bytes(b"rcodesign")
                if command[0] == "tar":
                    staging = Path(command[command.index("-C") + 1])
                    (staging / "rcodesign").write_text("#!/bin/sh\n")
                return types.SimpleNamespace(returncode=0, stdout="")
            pinned = hashlib.sha256(b"rcodesign").hexdigest() if good else "0" * 64
            with mock.patch.object(engine, "RCODESIGN_SHA256", pinned), mock.patch.dict(engine.ARCH_TOOLS, {"macos": ()}):
                if good:
                    engine.cross_tools(layout, tools, "macos", log=lambda *_: None, run=run)
                    self.assertTrue((tools / "rcodesign").resolve().is_file())
                else:
                    with self.assertRaises(engine.EngineError):
                        engine.cross_tools(layout, tools, "macos", log=lambda *_: None, run=run)
                    self.assertFalse((tools / "rcodesign").exists())

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
        (dist / "bin/uninstall").mkdir(parents=True)
        (dist / "bin/uninstall/helper.exe").write_bytes(b"MZ castellano")
        (layout.cache / "obj-157.0.1-windows/browser/locales/merge-dir/es-ES/browser/installer").mkdir(parents=True)
        package = dist / "kitsune-157.0.1.en-US.win64.zip"
        with zipfile.ZipFile(package, "w") as archive:
            archive.writestr("kitsune/kitsune.exe", b"MZ")
            archive.writestr("kitsune/uninstall/helper.exe", b"MZ english")
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
            self.assertEqual(archive.read("kitsune/uninstall/helper.exe"), b"MZ castellano")
            self.assertIn(b'pref("kitsune.release", "', archive.read("kitsune/defaults/pref/kitsune-release.js"))
        makes = [command for command in calls if command[0] == "make"]
        self.assertTrue(makes and all("AB_CD=es-ES" in command for command in makes))
        repackages = [command for command in calls if "repackage" in command]
        self.assertEqual(len(repackages), 2)
        self.assertIn("--use-upx", repackages[0])


    def test_kitsune_zero_for_windows_gets_its_product_prefs_and_its_own_installer(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        dist = layout.cache / "obj-157.0.1-windows/dist"
        (dist / "bin/uninstall").mkdir(parents=True)
        (dist / "bin/uninstall/helper.exe").write_bytes(b"MZ")
        package = dist / "kitsune-157.0.1.en-US.win64.zip"
        omni = io.BytesIO()
        with zipfile.ZipFile(omni, "w") as inner:
            inner.writestr("localization/es-ES/branding/brand.ftl", "-brand-short-name = Kitsune\n")
        with zipfile.ZipFile(package, "w") as archive:
            archive.writestr("kitsune/kitsune.exe", b"MZ")
            archive.writestr("kitsune/browser/omni.ja", omni.getvalue())

        def addons(layout, target, log):
            target.mkdir(parents=True, exist_ok=True)
            (target / "uBlock0@raymondhill.net.xpi").write_bytes(b"xpi")
        calls = []
        run = lambda command, **kwargs: calls.append(command) or types.SimpleNamespace(returncode=0)
        installer = engine.finish_windows_package(layout, "157.0.1", base / "src", {}, base / "build.log", log=lambda *_: None,
                                                  run=run, addons=addons, product="zero")
        self.assertEqual(installer.name, "kitsune-zero-157.0.1.en-US.win64.installer.exe")
        with zipfile.ZipFile(package) as archive:
            self.assertIn(b'pref("kitsune.product", "zero");', archive.read("kitsune/defaults/pref/kitsune-product.js"))
            self.assertEqual(archive.namelist().count("kitsune/browser/omni.ja"), 1)
            inner = zipfile.ZipFile(io.BytesIO(archive.read("kitsune/browser/omni.ja")))
            self.assertEqual(inner.read("localization/es-ES/branding/brand.ftl"), b"-brand-short-name = Kitsune Zero\n")
        repackage = next(command for command in calls if "repackage" in command)
        self.assertEqual(repackage[repackage.index("-o") + 1], str(installer))

    def test_kitsune_zero_for_macos_is_its_own_signed_app_with_its_name_icon_and_prefs_in_its_own_dmg(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        dist = layout.cache / "obj-157.0.1-macos/dist"
        app = dist / "kitsune/Kitsune.app/Contents"
        (app / "Resources/browser").mkdir(parents=True)
        (app / "MacOS").mkdir(parents=True)
        (app / "MacOS/kitsune").write_bytes(b"\xcf\xfa\xed\xfe")
        (app / "Resources/kitsune.cfg").write_text("cfg")
        (app / "Resources/firefox.icns").write_bytes(b"kitsune")
        with (app / "Info.plist").open("wb") as handle:
            plistlib.dump({"CFBundleName": "Kitsune", "CFBundleIdentifier": "org.mozilla.kitsune", "CFBundleIconFile": "firefox"}, handle)
        with zipfile.ZipFile(app / "Resources/browser/omni.ja", "w") as omni:
            omni.writestr("localization/es-ES/branding/brand.ftl", "-brand-full-name = Kitsune\n")
        calls = []
        run = lambda command, **kwargs: calls.append(command) or types.SimpleNamespace(returncode=0)
        dmg = engine.finish_macos_zero(layout, "157.0.1", base / "src", {}, base / "build.log", log=lambda *_: None, run=run)
        zero = dist / "kitsune-zero/Kitsune Zero.app/Contents"
        with (zero / "Info.plist").open("rb") as handle:
            info = plistlib.load(handle)
        self.assertEqual((info["CFBundleName"], info["CFBundleDisplayName"], info["CFBundleIdentifier"]), ("Kitsune Zero", "Kitsune Zero", "io.github.riscooo.kitsune.zero"))
        self.assertEqual((zero / "Resources/firefox.icns").read_bytes(), (ROOT / "install/branding-zero/macos/firefox.icns").read_bytes())
        self.assertIn('pref("kitsune.product", "zero");', (zero / "Resources/defaults/pref/kitsune-product.js").read_text())
        self.assertEqual(zipfile.ZipFile(zero / "Resources/browser/omni.ja").read("localization/es-ES/branding/brand.ftl").decode(),
                         "-brand-full-name = Kitsune Zero\n")
        self.assertEqual((app / "Resources/firefox.icns").read_bytes(), b"kitsune")  # la de Kitsune, igual
        signed, made = calls
        self.assertEqual(signed[:2], ["rcodesign", "sign"])
        self.assertEqual(Path(signed[2]).name, "Kitsune Zero.app")
        self.assertIn("Kitsune Zero", made)
        self.assertEqual(dmg.name, "kitsune-zero-157.0.1.en-US.mac.dmg")

    def test_the_macos_app_gets_kitsune_cfg_and_ublock_is_signed_and_goes_in_a_new_dmg(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        dist = layout.cache / "obj-157.0.1-macos/dist"
        for folder in ("kitsune/Kitsune.app", "bin/Kitsune.app"):
            (dist / folder / "Contents/Resources").mkdir(parents=True)
            (dist / folder / "Contents/MacOS").mkdir(parents=True)
        (dist / "kitsune/Kitsune.app/Contents/MacOS/kitsune").write_bytes(b"\xcf\xfa\xed\xfe")
        (dist / "bin/Kitsune.app/Contents/MacOS/kitsune").symlink_to(base)
        calls = []

        def addons(layout, target, log):
            target.mkdir(parents=True, exist_ok=True)
            (target / "uBlock0@raymondhill.net.xpi").write_bytes(b"xpi")
        run = lambda command, **kwargs: calls.append(command) or types.SimpleNamespace(returncode=0)
        dmg = engine.finish_macos_package(layout, "157.0.1", base / "src", {}, base / "build.log", log=lambda *_: None,
                                          run=run, addons=addons)
        resources = dist / "kitsune/Kitsune.app/Contents/Resources"
        self.assertEqual((resources / "kitsune.cfg").read_bytes(), (ROOT / "install/recipe/kitsune.cfg").read_bytes())
        self.assertTrue((resources / "defaults/pref/autoconfig.js").is_file())
        self.assertTrue((resources / "distribution/extensions/uBlock0@raymondhill.net.xpi").is_file())
        self.assertIn('pref("kitsune.release", "', (resources / "defaults/pref/kitsune-release.js").read_text())
        self.assertFalse((dist / "bin/Kitsune.app/Contents/Resources/kitsune.cfg").exists())
        signed, made = calls
        self.assertEqual(signed[:2], ["rcodesign", "sign"])
        self.assertIn("mozbuild.action.make_dmg", made)
        self.assertEqual(dmg.name, "kitsune-157.0.1.en-US.mac.dmg")


    def test_cleaning_keeps_this_version_for_every_system_and_the_tools(self):
        base = Path(tempfile.mkdtemp())
        layout = engine.Layout(base / "data", base / "state", base / "cache")
        keep = ["obj-157.0.1", "obj-157.0.1-windows", "obj-157.0.1-macos", "src-157.0.1", "mozconfig-157.0.1-windows",
                "l10n-157.0.1", "downloads/rust", "downloads/msitools", "downloads/firefox-157.0.1.source.tar.xz", "toolchain"]
        drop = ["obj-156.0.2", "obj-156.0.2-windows", "src-156.0.2", "mozconfig-156.0.2-macos", "l10n-156.0.2",
                "downloads/firefox-156.0.2.source.tar.xz"]
        for name in keep + drop:
            path = layout.cache / name
            if "." in name.rsplit("/", 1)[-1][-8:] and name.endswith(".xz"):
                path.parent.mkdir(parents=True, exist_ok=True); path.write_text("x")
            else:
                path.mkdir(parents=True, exist_ok=True)
        engine.clean_build_cache(layout, "157.0.1")
        for name in keep:
            self.assertTrue((layout.cache / name).exists(), name)
        for name in drop:
            self.assertFalse((layout.cache / name).exists(), name)


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
            "channel": "release", "telemetryExtended": False, "product": "kitsune",
            "userAgent": "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0"}

    def check(self, kind="kitsune", **changes):
        from unittest import mock
        fake = types.ModuleType("engine_probe")
        self.prefs = None
        def smoke(binary, user_prefs=None):
            self.prefs = user_prefs
            return {**self.GOOD, **changes}
        fake.smoke = smoke
        with mock.patch.dict(sys.modules, {"engine_probe": fake}):
            return engine.smoke_check(Path("/x/kitsune"), "157.0.1", product=kind)

    def test_good_engine_passes(self):
        self.assertEqual(self.check()["name"], "Kitsune")

    def test_kitsune_zero_has_its_brand_and_product_and_does_not_bring_the_real_profile(self):
        self.assertEqual(self.check("zero", brand="Kitsune Zero", product="zero")["brand"], "Kitsune Zero")
        # La copia del perfil de Kitsune (la primera vez) leería el de quien compila: en la prueba, apagada.
        self.assertEqual(self.prefs, {"kitsune.zero.importProfile": False})
        for changes in ({"brand": "Kitsune", "product": "zero"}, {"brand": "Kitsune Zero", "product": "kitsune"}):
            with self.assertRaises(engine.EngineError, msg=str(changes)):
                self.check("zero", **changes)
        with self.assertRaises(engine.EngineError):
            self.check(brand="Kitsune", product="zero")  # Kitsune no es Zero

    def test_kitsune_user_agent_or_missing_protections_fail(self):
        for changes in ({"userAgent": "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Kitsune/157.0.1"},
                        {"brand": None}, {"nativeModule": False}, {"policies": True}, {"fxaccounts": True}, {"sandboxLevel": 0},
                        {"privacyMode": ""}, {"signaturesRequired": False}, {"error": "timeout"},
                        {"channel": "default"}, {"telemetryExtended": True}):
            with self.assertRaises(engine.EngineError, msg=str(changes)):
                self.check(**changes)
