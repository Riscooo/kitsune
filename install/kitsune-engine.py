#!/usr/bin/env python3
"""Kitsune's own Gecko engine: fetch, verify, brand, build, install and activate.

Kitsune is compiled on this computer from Mozilla's official, signed Gecko
source release, with its own identity, branding and configuration built in.
It does not use any installed browser. A new engine is activated only after it
passes a headless smoke test; until then the current engine stays in use, and
an engine that is still running is never deleted.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime
import fcntl
import hashlib
import inspect
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

# Bump BUILD_REVISION when the compile recipe changes in code (not only in its
# input files, which are hashed); bump INSTALL_REVISION for install-only changes.
BUILD_REVISION = 2
INSTALL_REVISION = 2
MOZILLA_RELEASE_KEY = "14F26682D0916CDD81E37B6D61B7B526D98F0353"  # Mozilla Software Releases
ARCHIVE = "https://archive.mozilla.org/pub/firefox/releases"
VERSIONS_URL = "https://product-details.mozilla.org/1.0/firefox_versions.json"
VERSION = re.compile(r"\d{1,4}\.\d{1,4}(?:\.\d{1,4})?")
MIN_FREE_BYTES = 50 * 2**30
# Each parallel Gecko compile job can take ~2 GiB at its peak (Rust crates,
# large C++ units), and the final gkrust link-time optimization needs its own
# headroom on top; more than memory allows froze this PC once.
GIB_PER_JOB = 2
GKRUST_RESERVE_GIB = 6
# Release builds link gkrust (all of Gecko's Rust) with fat LTO: one rustc of
# more than 13 GiB. Thin LTO, what Mozilla's own cross-language LTO builds use
# for Rust, optimizes the same crates in parallel with a fraction of the memory.
RUST_FAT_LTO = "cargo_rustc_flags += -Clto$(if $(filter full,$(MOZ_LTO_RUST_CROSS)),=fat)"
RUST_THIN_LTO = "cargo_rustc_flags += -Clto=thin"
# The user agent keeps Firefox's standard product token (websites decide by it)
# while the application identity is Kitsune. Gecko only accepts this implied.
UA_ANCHOR = 'imply_option("MOZ_DEVTOOLS", "all")'
UA_FIREFOX = 'imply_option("MOZ_APP_UA_NAME", "Firefox")'
HERE = Path(__file__).resolve().parent
RECIPE, BRANDING, NATIVE = HERE / "recipe", HERE / "branding", HERE / "native"
NATIVE_FILES = ("kitsune-bootstrap.js", "kitsune-appearance.sys.mjs")
ICON_SIZES = (16, 22, 24, 32, 48, 64, 128, 256)
BRAND_CONTENT = {
    "about-logo.png": "icon-192.png", "about-logo@2x.png": "icon-384.png",
    "about-logo-private.png": "icon-192.png", "about-logo-private@2x.png": "icon-384.png",
    "about-logo.svg": "icon.svg", "about-wordmark.svg": "wordmark.svg",
    "firefox-wordmark.svg": "wordmark.svg", "about.png": "about-300x236.png",
}
BOOTSTRAP = '<script src="chrome://browser/content/browser-main.js"></script>'
KITSUNE_BOOTSTRAP = '<script src="chrome://browser/content/kitsune-bootstrap.js"></script>'
JAR_ANCHOR = re.compile(r"(?m)^(\s+)content/browser/browser-main\.js(\s+)\(content/browser-main\.js\)\n")
ABOUT_ANCHOR = '<label id="distributionId" class="text-blurb"/>'
ABOUT_CREDIT = '<label id="kitsune-engine-credit" class="text-blurb">Tinta · motor Gecko compilado en este equipo</label>'
# Sin rastro de Mozilla en la interfaz: nombres propios donde Gecko muestra sus
# marcas, el buscador de extensiones sin la dirección de la tienda, el tema por
# defecto llamado Kitsune y ningún marcador, tema ni enlace de ayuda de Firefox.
# Cada texto se comprueba: si Gecko lo cambia, la receta avisa en vez de seguir.
TEXT_PATCHES = {
    "toolkit/locales/en-US/toolkit/branding/brandings.ftl": (
        ("-monitor-brand-name = Firefox Monitor", "-monitor-brand-name = Monitor"),
        ("-mozmonitor-brand-name = Mozilla Monitor", "-mozmonitor-brand-name = Monitor"),
        ("-send-brand-name = Firefox Send", "-send-brand-name = Send"),
        ("-screenshots-brand-name = Firefox Screenshots", "-screenshots-brand-name = Screenshots"),
        ("-mozilla-vpn-brand-name = Mozilla VPN", "-mozilla-vpn-brand-name = VPN"),
        ("-profiler-brand-name = Firefox Profiler", "-profiler-brand-name = Profiler"),
        ("-translations-brand-name = Firefox Translations", "-translations-brand-name = Kitsune Translations"),
        ("-relay-brand-name = Firefox Relay", "-relay-brand-name = Relay"),
        ("-firefox-suggest-brand-name = Firefox Suggest", "-firefox-suggest-brand-name = Kitsune Suggest"),
        ("-firefox-home-brand-name = Firefox Home", "-firefox-home-brand-name = Kitsune Home"),
        ("-firefoxview-brand-name = Firefox View", "-firefoxview-brand-name = Kitsune View"),
        ("-firefoxlabs-brand-name = Firefox Labs", "-firefoxlabs-brand-name = Kitsune Labs"),
    ),
    "toolkit/locales/en-US/toolkit/about/aboutAddons.ftl": (
        ("Search addons.mozilla.org", "Search extensions and themes"),
        ('Get extensions and themes on <a data-l10n-name="get-extensions">{ $domain }</a>',
         'Get extensions and themes in the <a data-l10n-name="get-extensions">extension store</a>'),
        ('Get dictionaries on <a data-l10n-name="get-extensions">{ $domain }</a>',
         'Get dictionaries in the <a data-l10n-name="get-extensions">extension store</a>'),
        ('Get language packs on <a data-l10n-name="get-extensions">{ $domain }</a>',
         'Get language packs in the <a data-l10n-name="get-extensions">extension store</a>'),
        ("  .title = Firefox only recommends extensions that meet standards for security and performance",
         "  .title = { -brand-product-name } only recommends extensions that meet standards for security and performance"),
    ),
    "browser/locales/en-US/browser/appExtensionFields.ftl": (
        ("extension-default-theme-name-auto=System theme — auto", "extension-default-theme-name-auto=Kitsune"),
    ),
    "browser/locales/en-US/browser/aboutLogins.ftl": (
        ("login-intro-instructions-fxa2 = Create or sign in to your account on the device where your logins are saved.",
         "login-intro-instructions-fxa2 = Save a password when you sign in to a website, or add one with the + button."),
        ("login-intro-instructions-fxa-settings = Go to Settings > Sync > Turn on syncing… Select the Logins and passwords checkbox.",
         "login-intro-instructions-fxa-settings = You can also import them from a file in the ⋯ menu."),
    ),
    # Tarjeta «Soporte de Kitsune» de Ajustes: pendiente de la web de Kitsune.
    "browser/components/preferences/config/about-firefox.mjs": (
        ("  support: {\n    inProgress: true,",
         "  support: {\n    // Kitsune: soporte y opiniones, pendientes de su propia web.\n    hidden: true,\n    inProgress: true,"),
    ),
    "browser/components/aboutlogins/content/aboutLogins.html": (
        ('href="https://support.mozilla.org/kb/import-login-data-file"', 'href=""'),
        ('href="https://support.mozilla.org/kb/firefox-password-manager-alerts-breached-websites"', 'href=""'),
    ),
}
KITSUNE_BOOKMARKS = """#filter substitution
<!-- Kitsune: un perfil nuevo empieza sin marcadores de terceros (el preprocesador
     de Gecko exige alguna directiva en este archivo). -->
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none';">
    <link rel="localization" href="branding/brand.ftl"/>
    <link rel="localization" href="browser/profile/default-bookmarks.ftl"/>
    <title data-l10n-id="default-bookmarks-title">default-bookmarks-title</title>
</head>
<body>
<h1 data-l10n-id="default-bookmarks-heading">default-bookmarks-heading</h1>
<dl><p>
</dl>
</body>
</html>
"""
# Ni un zorro de Firefox: cada ilustración suya pasa a ser la mascota de Kitsune
# (install/mascot, de tools/mascot/generate.py) en la pose que pide su sitio, y
# cada logo de Firefox, el de Kitsune.
MASCOT_POSES = {
    "guardia": ("browser/themes/shared/identity-block/trustpanel-graphic-enabled.svg",
                "browser/components/controlcenter/content/assets/breach-alert-shield-check.svg",
                "toolkit/themes/shared/illustrations/shield-check.svg",
                "toolkit/themes/shared/illustrations/kit-holding-lock.svg"),
    "preocupado": ("browser/themes/shared/identity-block/trustpanel-graphic-warning.svg",
                   "browser/components/controlcenter/content/assets/breach-alert-shield-warning.svg",
                   "browser/components/controlcenter/content/assets/fox-concern.svg",
                   "toolkit/themes/shared/illustrations/shield-alert.svg",
                   "toolkit/themes/shared/illustrations/kit-concerned.svg",
                   "toolkit/themes/shared/illustrations/no-connection.svg",
                   "toolkit/themes/shared/illustrations/security-error.svg",
                   "browser/components/firefoxview/content/synced-tabs-error.svg",
                   "browser/themes/shared/fxa/sync-illustration-issue.svg"),
    "dormido": ("browser/themes/shared/identity-block/trustpanel-graphic-disabled.svg",
                "browser/components/controlcenter/content/assets/breach-alert-shield-cross.svg",
                "browser/components/firefoxview/content/history-empty.svg",
                "browser/components/firefoxview/content/synced-tabs-empty.svg"),
    "hola": ("toolkit/themes/shared/illustrations/kit-happy.svg",
             "toolkit/themes/shared/illustrations/kit-confetti.svg",
             "browser/components/aboutlogins/content/icons/intro-illustration.svg",
             "toolkit/components/satchel/megalist/content/icons/cpm-fox-illustration.svg",
             "browser/themes/shared/preferences/fox-ai.svg",
             "browser/themes/shared/sidebar/foxy.svg",
             "browser/themes/shared/fxa/sync-illustration.svg",
             "browser/components/aiwindow/ui/assets/kit.svg",
             *(f"browser/components/asrouter/content/assets/fox-with-{name}.svg"
               for name in ("locked-box", "devices", "checkmark", "mobile", "profiles", "box-on-cloud")),
             *(f"browser/components/aboutwelcome/assets/{name}.svg"
               for name in ("br-migration-fox-juggle", "br-backup-fox-outside-box", "br-gratitude-fox-rock",
                            "br-fxa-fox-mirror", "br-backup-fox-in-box", "br-set-default-fox-heart", "br-amo-fox-paint",
                            "br-import-fox-house", "fox-doodle-backup-restore")),
             *(f"browser/extensions/newtab/data/content/assets/{name}.svg"
               for name in ("firefox-mascot-prop-heart-light", "firefox-mascot-prop-heart-dark",
                            "firefox-mascot-prop-heart-light-narrow", "firefox-mascot-prop-heart-light-responsive",
                            "firefox-mascot-prop-heart-dark-responsive", "firefox-mascot-prop-heart-dark-narrow",
                            "firefox-mascot-prop-paintbucket-rgb", "puzzle-fox", "highlights/firefox-mascot-prop-paintbucket-rgb"))),
    "cara": ("toolkit/themes/shared/illustrations/kit-in-circle.svg",
             "browser/themes/shared/fxa/avatar-fox.svg",
             "browser/themes/shared/fxa/avatar-fox-circle.svg",
             "browser/components/asrouter/content/assets/smiling-fox-icon.svg",
             "browser/extensions/newtab/data/content/assets/firefox-motion-head-pop-up-no-bg.svg"),
    "cola": ("browser/themes/shared/privatebrowsing/fox-tail.svg",),
    "ventana": ("browser/themes/shared/icons/window-firefox.svg",),
}
KITSUNE_LOGOS = ("browser/base/content/logos/share-firefox.svg", "browser/themes/shared/sidebar/firefox.svg",
                 "browser/extensions/newtab/data/content/assets/firefox.svg", "browser/themes/shared/icons/firefox-view.svg")
MASCOT = HERE / "mascot"
# Clave de Google Safe Browsing (protección contra webs de estafa y malware). Si
# existe este archivo, se compila dentro; la clave nunca sale en registros.
SAFEBROWSING_KEY = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "kitsune-browser/safebrowsing-api-key"
# Kitsune en castellano: la traducción es-ES de Mozilla en la revisión que fija esta
# versión de Gecko (browser/locales/l10n-changesets.json; git la comprueba por su
# hash) con la misma capa de identidad que el inglés. El motor lleva en-US y es-ES.
L10N_REPO = "https://github.com/mozilla-l10n/firefox-l10n.git"
L10N_LOCALES = ("es-ES",)
L10N_PATCHES = {
    "es-ES/toolkit/toolkit/branding/brandings.ftl": (
        ("-monitor-brand-name = Firefox Monitor", "-monitor-brand-name = Monitor"),
        ("-mozmonitor-brand-name = Mozilla Monitor", "-mozmonitor-brand-name = Monitor"),
        ("-send-brand-name = Firefox Send", "-send-brand-name = Send"),
        ("-screenshots-brand-name = Firefox Screenshots", "-screenshots-brand-name = Capturas de pantalla"),
        ("-mozilla-vpn-brand-name = Mozilla VPN", "-mozilla-vpn-brand-name = VPN"),
        ("-profiler-brand-name = Firefox Profiler", "-profiler-brand-name = Profiler"),
        ("-translations-brand-name = Firefox Translations", "-translations-brand-name = Traducciones de Kitsune"),
        ("-relay-brand-name = Firefox Relay", "-relay-brand-name = Relay"),
        ("-firefox-suggest-brand-name = Firefox Suggest", "-firefox-suggest-brand-name = Sugerencias de Kitsune"),
        ("-firefox-home-brand-name = Página de inicio de Firefox", "-firefox-home-brand-name = Página de inicio de Kitsune"),
        ("-firefoxview-brand-name = Firefox View", "-firefoxview-brand-name = Vista de Kitsune"),
        ("-firefoxlabs-brand-name = Firefox Labs", "-firefoxlabs-brand-name = Laboratorio de Kitsune"),
    ),
    "es-ES/toolkit/toolkit/about/aboutAddons.ftl": (
        ("Buscar en addons.mozilla.org", "Buscar extensiones y temas"),
        ('Obtenga extensiones y temas en <a data-l10n-name="get-extensions">{ $domain }</a>',
         'Obtenga extensiones y temas en la <a data-l10n-name="get-extensions">tienda de extensiones</a>'),
        ('Obtenga diccionarios en <a data-l10n-name="get-extensions">{ $domain }</a>',
         'Obtenga diccionarios en la <a data-l10n-name="get-extensions">tienda de extensiones</a>'),
        ('Obtenga paquetes de idiomas en <a data-l10n-name="get-extensions">{ $domain }</a>',
         'Obtenga paquetes de idiomas en la <a data-l10n-name="get-extensions">tienda de extensiones</a>'),
        ("    .title = Firefox solo recomienda extensiones que cumplen estándares de seguridad y rendimiento.",
         "    .title = { -brand-product-name } solo recomienda extensiones que cumplen estándares de seguridad y rendimiento."),
    ),
    "es-ES/browser/browser/appExtensionFields.ftl": (
        ("extension-default-theme-name-auto = Tema del sistema — automático", "extension-default-theme-name-auto = Kitsune"),
    ),
    "es-ES/browser/browser/aboutLogins.ftl": (
        ("login-intro-instructions-fxa2 = Cree o inicie sesión en su cuenta en el dispositivo donde se guardan sus inicios de sesión",
         "login-intro-instructions-fxa2 = Guarde una contraseña al iniciar sesión en una web, o añádala con el botón +."),
        ("login-intro-instructions-fxa-settings = Ir a Ajustes > Sync > Activar la sincronización… Seleccionar la casilla Inicios de sesión y contraseñas.",
         "login-intro-instructions-fxa-settings = También puede importarlas desde un archivo en el menú ⋯."),
    ),
}
THEMES_MAP = re.compile(r"export const BuiltInThemeConfig = new Map\(\[.*?\n\]\);", re.S)
SUPPORT_LINK = "  connectedCallback() {\n    this.#register();"
SUPPORT_LINK_HIDDEN = ("  connectedCallback() {\n    // Kitsune: sin enlaces a la ayuda de Mozilla.\n"
                       "    this.style.setProperty(\"display\", \"none\", \"important\");\n    this.#register();")
BRAND_FTL = """# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Kitsune: marca propia, compilada en el motor.

-brand-shorter-name = Kitsune
-brand-short-name = Kitsune
-brand-shortcut-name = Kitsune
-brand-full-name = Kitsune
-brand-product-name = Kitsune
-vendor-short-name = Kitsune
trademarkInfo = { " " }
"""
BRAND_PROPERTIES = """# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

brandShorterName=Kitsune
brandShortName=Kitsune
brandFullName=Kitsune
"""
BRAND_CONFIGURE = "MOZ_APP_DISPLAYNAME=Kitsune\nMOZ_MACBUNDLE_ID=kitsune\n"
# Gecko's configure insists on an unzip program it barely uses (tests and
# language repacks). Without root, a minimal stand-in built on Python's zipfile
# covers its "unzip [-q] [-o] archive [-d dir]" and "-l" forms.
UNZIP_SHIM = """#!/usr/bin/env python3
# Kitsune: sustituto mínimo de unzip para compilar sin sudo (zipfile de Python).
import sys, zipfile
args, flags, target = sys.argv[1:], set(), "."
if args == ["-v"]:
    print("UnZip 6.00 (Kitsune zipfile shim)"); sys.exit(0)
rest = []
while args:
    item = args.pop(0)
    if item == "-d":
        target = args.pop(0)
    elif item.startswith("-") and len(item) > 1:
        flags.update(item[1:])
    else:
        rest.append(item)
if not rest:
    sys.exit("unzip: falta el archivo")
with zipfile.ZipFile(rest[0]) as archive:
    if "l" in flags:
        for info in archive.infolist():
            print(f"{info.file_size:>9}  {info.filename}")
    else:
        members = rest[1:] or None
        archive.extractall(target, members)
"""


class EngineError(Exception):
    pass


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def version_key(version: str):
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise EngineError(f"Versión de Gecko no válida: {version!r}")
    parts = [int(part) for part in version.split(".")]
    return tuple(parts + [0] * (3 - len(parts)))


def sha256_file(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


class Layout:
    def __init__(self, browser_root: Path, state_root: Path, cache_root: Path):
        self.browser_root = browser_root
        self.engines = browser_root / "engine"
        self.current = self.engines / "current"
        self.state = state_root / "engine"
        self.cache = cache_root

    @classmethod
    def default(cls):
        home = Path.home()
        data = Path(os.environ.get("XDG_DATA_HOME") or home / ".local/share")
        state = Path(os.environ.get("XDG_STATE_HOME") or home / ".local/state")
        cache = Path(os.environ.get("XDG_CACHE_HOME") or home / ".cache")
        return cls(data / "kitsune-browser", state / "kitsune-browser", cache / "kitsune-build")

    def private(self, path: Path):
        if path.is_symlink():
            raise EngineError(f"La carpeta no puede ser un enlace: {path}")
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        if path.stat().st_uid != os.getuid():
            raise EngineError(f"La carpeta no es del usuario: {path}")
        return path

    def current_engine(self):
        """Return (directory, manifest) of the active engine, or (None, None)."""
        if not self.current.is_symlink():
            return None, None
        target = self.current.resolve()
        manifest = target / "kitsune-engine.json"
        if target.parent != self.engines.resolve() or not manifest.is_file() or not os.access(target / "kitsune", os.X_OK):
            return None, None
        return target, json.loads(manifest.read_text())


# ---------------------------------------------------------------- fingerprints

def input_files():
    files = {"recipe/mozconfig.in": RECIPE / "mozconfig.in", "recipe/aboutDialog.css": RECIPE / "aboutDialog.css"}
    for name in sorted({f"icon-{size}.png" for size in ICON_SIZES} | set(BRAND_CONTENT.values())):
        files[f"branding/{name}"] = BRANDING / name
    for name in NATIVE_FILES:
        files[f"native/{name}"] = NATIVE / name
    for pose in MASCOT_POSES:
        files[f"mascot/{pose}.svg"] = MASCOT / f"{pose}.svg"
    if SAFEBROWSING_KEY.is_file():
        files["safebrowsing-api-key"] = SAFEBROWSING_KEY
    files["branding/icon-small.svg"] = BRANDING / "icon-small.svg"
    return files


def install_files():
    return {name: RECIPE / name for name in ("autoconfig.js", "kitsune.cfg")}


def fingerprint(version: str, files: dict, revision: int, parent: str = "") -> str:
    digest = hashlib.sha256(json.dumps([revision, version, parent], separators=(",", ":")).encode())
    for name, path in sorted(files.items()):
        if path.is_symlink() or not path.is_file():
            raise EngineError(f"Falta un archivo de la receta de Kitsune: {name}")
        digest.update(f"\0{name}\0{sha256_file(path)}".encode())
    return digest.hexdigest()


def recipe_code() -> str:
    """Hash of the code that shapes the compiled engine, so changing it always rebuilds."""
    parts = [inspect.getsource(function) for function in (write_branding, integrate_native, rebrand_source, prepare_l10n,
                                                          tune_build, write_mozconfig)]
    parts += [BRAND_FTL, BRAND_PROPERTIES, BRAND_CONFIGURE, KITSUNE_BOOTSTRAP, ABOUT_CREDIT, RUST_THIN_LTO,
              json.dumps(TEXT_PATCHES, sort_keys=True), KITSUNE_BOOKMARKS, SUPPORT_LINK_HIDDEN,
              json.dumps(MASCOT_POSES, sort_keys=True), repr(KITSUNE_LOGOS), json.dumps(L10N_PATCHES, sort_keys=True),
              repr(L10N_LOCALES), L10N_REPO,
              UA_FIREFOX, json.dumps(BRAND_CONTENT, sort_keys=True), repr(ICON_SIZES), repr(NATIVE_FILES)]
    return hashlib.sha256("\0".join(parts).encode()).hexdigest()


def build_fingerprint(version):
    return fingerprint(version, input_files(), BUILD_REVISION, recipe_code())


def install_fingerprint(version):
    return fingerprint(version, install_files(), INSTALL_REVISION, build_fingerprint(version))


# ------------------------------------------------------------- fetch & verify

def latest_version(opener=urllib.request.urlopen):
    with opener(VERSIONS_URL, timeout=30) as response:
        data = json.loads(response.read(1 << 20))
    version = data.get("LATEST_FIREFOX_VERSION")
    version_key(version)
    return version


def download(url: str, destination: Path, opener=urllib.request.urlopen):
    if destination.is_file():
        return destination
    partial = destination.with_name(destination.name + ".part")
    with opener(url, timeout=60) as response, partial.open("wb") as handle:
        shutil.copyfileobj(response, handle, 1 << 20)
    os.replace(partial, destination)
    return destination


def release_files(version):
    version_key(version)
    base = f"{ARCHIVE}/{version}"
    return {"KEY": f"{base}/KEY", "SHA512SUMS": f"{base}/SHA512SUMS", "SHA512SUMS.asc": f"{base}/SHA512SUMS.asc",
            f"firefox-{version}.source.tar.xz": f"{base}/source/firefox-{version}.source.tar.xz"}


def verify_signature(directory: Path, run=subprocess.run):
    """Require a good signature on SHA512SUMS whose primary key is Mozilla's pinned key.

    The KEY file comes from the same server, so it is only key material: trust
    comes from the pinned primary fingerprint, and gpg itself only accepts a
    signing subkey bound by that primary key.
    """
    with tempfile.TemporaryDirectory(prefix="kitsune-gpg-") as home:
        base = ["gpg", "--batch", "--no-tty", "--no-autostart", "--homedir", home]
        imported = run(base + ["--import", str(directory / "KEY")], capture_output=True, text=True)
        if imported.returncode != 0:
            raise EngineError("No se pudo leer la clave de firma de Mozilla")
        result = run(base + ["--status-fd", "1", "--verify", str(directory / "SHA512SUMS.asc"), str(directory / "SHA512SUMS")],
                     capture_output=True, text=True)
    valid = [line.split() for line in result.stdout.splitlines() if line.startswith("[GNUPG:] VALIDSIG ")]
    good = any(line.startswith("[GNUPG:] GOODSIG ") for line in result.stdout.splitlines())
    if result.returncode != 0 or not good or not any(fields[-1] == MOZILLA_RELEASE_KEY for fields in valid):
        raise EngineError("La firma de Mozilla del código fuente no es válida; no se compila nada")


def expected_sha512(sums: str, version: str) -> str:
    target = f"source/firefox-{version}.source.tar.xz"
    matches = [line.partition("  ")[0] for line in sums.splitlines() if line.partition("  ")[2] == target]
    if len(matches) != 1 or not re.fullmatch(r"[0-9a-f]{128}", matches[0]):
        raise EngineError("Las sumas firmadas no incluyen el código fuente de esta versión")
    return matches[0]


def verify_tarball(directory: Path, version: str):
    tarball = directory / f"firefox-{version}.source.tar.xz"
    expected = expected_sha512((directory / "SHA512SUMS").read_text(), version)
    with tarball.open("rb") as handle:
        actual = hashlib.file_digest(handle, "sha512").hexdigest()
    if actual != expected:
        raise EngineError("El código fuente descargado no coincide con la suma firmada por Mozilla")
    return tarball


def fetch(layout: Layout, version: str, log=print, opener=urllib.request.urlopen, run=subprocess.run):
    directory = layout.private(layout.cache / "downloads" / version)
    for name, url in release_files(version).items():
        if name != "KEY":  # key material is always refreshed
            if not (directory / name).is_file():
                log(f"Descargando {name}")
            download(url, directory / name, opener)
    key = directory / "KEY"
    key.unlink(missing_ok=True)
    download(release_files(version)["KEY"], key, opener)
    verify_signature(directory, run)
    tarball = verify_tarball(directory, version)
    log(f"Firma de Mozilla verificada ({MOZILLA_RELEASE_KEY[-16:]}) y SHA-512 correcto")
    return tarball


# ------------------------------------------------------------- source recipe

def replace_once(text: str, anchor: str, replacement: str, what: str) -> str:
    if text.count(anchor) != 1:
        raise EngineError(f"{what} cambió en esta versión de Gecko; la integración de Kitsune necesita revisión")
    return text.replace(anchor, replacement)


def write_branding(source: Path):
    unofficial = source / "browser/branding/unofficial"
    target = source / "browser/branding/kitsune"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(unofficial, target, symlinks=True)
    for size in ICON_SIZES:
        shutil.copyfile(BRANDING / f"icon-{size}.png", target / f"default{size}.png")
    for name, asset in BRAND_CONTENT.items():
        shutil.copyfile(BRANDING / asset, target / "content" / name)
    shutil.copyfile(RECIPE / "aboutDialog.css", target / "content/aboutDialog.css")
    (target / "configure.sh").write_text(BRAND_CONFIGURE)
    (target / "locales/en-US/brand.ftl").write_text(BRAND_FTL)
    (target / "locales/en-US/brand.properties").write_text(BRAND_PROPERTIES)


def integrate_native(source: Path):
    """Build the native module in. Idempotent, so a recipe change reuses extracted source."""
    content = source / "browser/base/content"
    for name in NATIVE_FILES:
        shutil.copyfile(NATIVE / name, content / name)
    jar = source / "browser/base/jar.mn"
    text = jar.read_text()
    if f"content/browser/{NATIVE_FILES[0]} " not in text:
        matches = JAR_ANCHOR.findall(text)
        if len(matches) != 1:
            raise EngineError("El manifiesto de la ventana cambió; la integración de Kitsune necesita revisión")
        indent = matches[0][0]
        entries = "".join(f"{indent}content/browser/{name} (content/{name})\n" for name in NATIVE_FILES)
        jar.write_text(JAR_ANCHOR.sub(lambda match: match.group(0) + entries, text, count=1))
    window = source / "browser/base/content/browser.xhtml"
    text = window.read_text()
    if KITSUNE_BOOTSTRAP not in text:
        window.write_text(replace_once(text, BOOTSTRAP, BOOTSTRAP + "\n  " + KITSUNE_BOOTSTRAP,
                                       "El punto de entrada de la ventana"))
    about = source / "browser/base/content/aboutDialog.xhtml"
    text = re.sub(r"\n\s*<label id=\"kitsune-engine-credit\"[^\n]*", "", about.read_text())
    about.write_text(replace_once(text, ABOUT_ANCHOR, ABOUT_ANCHOR + "\n        " + ABOUT_CREDIT,
                                  "El diálogo Acerca de"))


def rebrand_source(source: Path):
    """Nombres propios y nada de Firefox en la interfaz. Idempotente."""
    for relative, patches in TEXT_PATCHES.items():
        path = source / relative
        text = path.read_text()
        for old, new in patches:
            if old in text:
                text = text.replace(old, new)
            elif new not in text:
                raise EngineError(f"El texto «{old[:40]}» cambió en esta versión de Gecko; la receta necesita revisión")
        path.write_text(text)
    (source / "browser/base/content/default-bookmarks.html").write_text(KITSUNE_BOOKMARKS)
    themes = source / "browser/themes/BuiltInThemeConfig.sys.mjs"
    text = themes.read_text()
    if "export const BuiltInThemeConfig = new Map([]);" not in text:
        if len(THEMES_MAP.findall(text)) != 1:
            raise EngineError("La lista de temas de Gecko cambió; la receta necesita revisión")
        themes.write_text(THEMES_MAP.sub("export const BuiltInThemeConfig = new Map([]);", text))
    for pose, targets in MASCOT_POSES.items():
        for relative in targets:
            if not (source / relative).is_file():
                raise EngineError(f"La ilustración {relative} ya no existe en esta versión de Gecko; la receta necesita revisión")
            shutil.copyfile(MASCOT / f"{pose}.svg", source / relative)
    for relative in KITSUNE_LOGOS:
        if not (source / relative).is_file():
            raise EngineError(f"El logo {relative} ya no existe en esta versión de Gecko; la receta necesita revisión")
        shutil.copyfile(BRANDING / "icon-small.svg", source / relative)
    link = source / "toolkit/content/widgets/moz-support-link/moz-support-link.mjs"
    text = link.read_text()
    if SUPPORT_LINK_HIDDEN not in text:
        link.write_text(replace_once(text, SUPPORT_LINK, SUPPORT_LINK_HIDDEN, "El enlace de ayuda de Gecko"))


def prepare_l10n(layout: Layout, source: Path, log=print, run=subprocess.run) -> Path:
    """Traducciones fijadas por la versión, copiadas aparte y con la capa de Kitsune."""
    changesets = json.loads((source / "browser/locales/l10n-changesets.json").read_text())
    revisions = {changesets[locale]["revision"] for locale in L10N_LOCALES}
    if len(revisions) != 1 or not re.fullmatch(r"[0-9a-f]{40}", next(iter(revisions))):
        raise EngineError("Las traducciones de esta versión de Gecko no tienen una revisión válida")
    revision = revisions.pop()
    repo = layout.cache / "l10n"
    git = ["git", "-C", str(repo)]
    steps = [] if (repo / ".git").is_dir() else [["git", "clone", "--quiet", "--filter=blob:none", "--no-checkout", "--sparse", L10N_REPO, str(repo)]]
    steps += [git + ["sparse-checkout", "set", *L10N_LOCALES],
              git + ["fetch", "--quiet", "--depth", "1", "--filter=blob:none", "origin", revision],
              git + ["checkout", "--quiet", "--force", revision]]
    log(f"Traducciones {', '.join(L10N_LOCALES)} en la revisión {revision[:12]}")
    for step in steps:
        result = run(step, capture_output=True, text=True)
        if result.returncode != 0:
            raise EngineError(f"No se pudieron descargar las traducciones: {result.stderr.strip()[-300:]}")
    head = run(git + ["rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    if head != revision:
        raise EngineError("La revisión de las traducciones no es la que pide esta versión de Gecko")
    base = layout.cache / f"l10n-{source.name.removeprefix('src-')}"
    if base.exists():
        shutil.rmtree(base)
    base.mkdir(parents=True)
    for locale in L10N_LOCALES:
        shutil.copytree(repo / locale, base / locale)
    for relative, patches in L10N_PATCHES.items():
        path = base / relative
        text = path.read_text()
        for old, new in patches:
            if old not in text:
                raise EngineError(f"La traducción «{old[:40]}» cambió; la receta necesita revisión")
            text = text.replace(old, new)
        path.write_text(text)
    return base


def tune_build(source: Path):
    """Build-system settings for this PC's memory. Idempotent."""
    rules = source / "config/makefiles/rust.mk"
    text = rules.read_text()
    if RUST_THIN_LTO not in text:
        rules.write_text(replace_once(text, RUST_FAT_LTO, RUST_THIN_LTO, "La optimización LTO de Rust"))
    configure = source / "browser/moz.configure"
    text = configure.read_text()
    if UA_FIREFOX not in text:
        configure.write_text(replace_once(text, UA_ANCHOR, UA_ANCHOR + "\n" + UA_FIREFOX, "La configuración del navegador"))


def prepare_source(layout: Layout, version: str, tarball: Path, build_fp: str, log=print, run=subprocess.run):
    source = layout.cache / f"src-{version}"
    marker = source / ".kitsune-source.json"
    with contextlib.suppress(OSError, ValueError):
        prepared = json.loads(marker.read_text())
        if prepared.get("buildFingerprint") == build_fp:
            return source
        if prepared.get("version") == version:
            # Same Gecko release: re-apply the (idempotent) recipe and let mach rebuild incrementally.
            log("La receta de Kitsune cambió: se aplica sobre el código ya extraído")
            write_branding(source)
            integrate_native(source)
            rebrand_source(source)
            tune_build(source)
            marker.write_text(json.dumps({**prepared, "buildFingerprint": build_fp, "preparedAt": now()}))
            return source
    if source.exists():
        log("Se vuelve a extraer el código fuente")
        shutil.rmtree(source)
    stage = Path(tempfile.mkdtemp(prefix=".extracting-", dir=layout.cache))
    log(f"Extrayendo el código fuente de Gecko {version}")
    result = run(["tar", "--no-same-owner", "--no-same-permissions", "-I", "xz -T0 -d", "-xf", str(tarball), "-C", str(stage)],
                 capture_output=True, text=True)
    if result.returncode != 0:
        raise EngineError(f"No se pudo extraer el código fuente: {result.stderr.strip()[-300:]}")
    top = stage / f"firefox-{version}"
    if not top.is_dir():
        raise EngineError("El código fuente no tiene la estructura esperada")
    write_branding(top)
    integrate_native(top)
    rebrand_source(top)
    tune_build(top)
    (top / ".kitsune-source.json").write_text(json.dumps({"version": version, "buildFingerprint": build_fp, "preparedAt": now()}))
    os.rename(top, source)
    shutil.rmtree(stage, ignore_errors=True)
    return source


def write_mozconfig(layout: Layout, version: str) -> Path:
    objdir = layout.cache / f"obj-{version}"
    text = ((RECIPE / "mozconfig.in").read_text().replace("@OBJDIR@", str(objdir))
            .replace("@L10NBASE@", str(layout.cache / f"l10n-{version}")))
    if SAFEBROWSING_KEY.is_file():
        text += f"\n# Protección contra webs de estafa y malware (clave propia de Google Safe Browsing).\n" \
                f"ac_add_options --with-google-safebrowsing-api-keyfile={SAFEBROWSING_KEY}\n"
    path = layout.cache / f"mozconfig-{version}"
    path.write_text(text)
    return path


# -------------------------------------------------------------------- build

def build_tools(layout: Layout) -> Path:
    """Private bin directory with stand-ins for missing, barely used build programs."""
    tools = layout.private(layout.cache / "bin")
    shim = tools / "unzip"
    if shutil.which("unzip") is None or shim.exists():
        if not shim.is_file() or shim.read_text() != UNZIP_SHIM:
            shim.write_text(UNZIP_SHIM)
            shim.chmod(0o700)
    return tools


def mach_environment(mozconfig: Path, tools: Path):
    env = {key: value for key, value in os.environ.items() if not key.startswith(("MOZ_", "KITSUNE_"))}
    env.update(MOZCONFIG=str(mozconfig), MOZ_NOSPAM="1", MACH_NO_TERMINAL_FOOTER="1",
               PATH=f"{tools}{os.pathsep}{os.environ.get('PATH', '/usr/bin')}",
               MOZBUILD_STATE_PATH=os.environ.get("MOZBUILD_STATE_PATH", str(Path.home() / ".mozbuild")))
    return env


def cgroup_memory_limit(proc_cgroup=Path("/proc/self/cgroup"), root=Path("/sys/fs/cgroup")):
    """memory.max of this process's cgroup (e.g. the update service), or None."""
    with contextlib.suppress(OSError, ValueError):
        relative = next(line.split("::", 1)[1] for line in proc_cgroup.read_text().splitlines() if line.startswith("0::"))
        value = (root / relative.lstrip("/") / "memory.max").read_text().strip()
        return None if value == "max" else int(value)
    return None


def build_jobs(meminfo=Path("/proc/meminfo"), cpus=None, limit=None):
    """Parallel jobs that fit in the memory available now and in our cgroup (at least 2)."""
    cpus = cpus or os.cpu_count() or 2
    available = 0
    with contextlib.suppress(OSError, ValueError):
        match = re.search(r"(?m)^MemAvailable:\s+(\d+) kB$", meminfo.read_text())
        available = int(match.group(1)) * 1024 if match else 0
    if limit:
        available = min(available, limit)
    usable = available - GKRUST_RESERVE_GIB * 2**30
    return max(2, min(cpus, usable // (GIB_PER_JOB * 2**30)))


def mach(source: Path, arguments, env, logfile, run=subprocess.run):
    python = os.environ.get("KITSUNE_MACH_PYTHON", sys.executable)
    with logfile.open("a") as handle:
        handle.write(f"\n=== {now()} mach {' '.join(arguments)}\n")
        handle.flush()
        result = run([python, str(source / "mach"), "--no-interactive", *arguments], cwd=source, env=env,
                     stdin=subprocess.DEVNULL, stdout=handle, stderr=subprocess.STDOUT)
    if result.returncode != 0:
        raise EngineError(f"mach {arguments[0]} falló (código {result.returncode}); detalles en {logfile}")


def compile_package(layout: Layout, version: str, source: Path, build_fp: str, logfile: Path, log=print, run=subprocess.run):
    packages = layout.private(layout.cache / "packages")
    package = packages / f"kitsune-{version}-{build_fp[:16]}.tar.xz"
    if package.is_file():
        log("Paquete ya compilado con esta receta; no hace falta recompilar")
        return package
    if shutil.disk_usage(layout.cache).free < MIN_FREE_BYTES:
        raise EngineError("Hacen falta al menos 50 GB libres para compilar Kitsune")
    env = mach_environment(write_mozconfig(layout, version), build_tools(layout))
    log(f"Compilando Kitsune sobre Gecko {version} (registro: {logfile})")
    # A compile server left from an earlier build would run compilers outside
    # this build's priority and memory limits; the next one starts inside them.
    sccache = Path(env["MOZBUILD_STATE_PATH"]) / "sccache/sccache"
    if sccache.is_file():
        run([str(sccache), "--stop-server"], env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    prepare_l10n(layout, source, log, run)
    jobs = build_jobs(limit=cgroup_memory_limit())
    log(f"Compilando con {jobs} tareas en paralelo (según la memoria libre)")
    mach(source, ["build", f"-j{jobs}"], env, logfile, run)
    # Un solo paquete con inglés y castellano.
    mach(source, ["package-multi-locale", "--locales", "en-US", *L10N_LOCALES], env, logfile, run)
    candidates = sorted((layout.cache / f"obj-{version}" / "dist").glob(f"kitsune-{version}.*.linux-*.tar.*"))
    if len(candidates) != 1:
        raise EngineError("No se encontró el paquete de Kitsune tras compilar")
    partial = package.with_name(package.name + ".part")
    shutil.copyfile(candidates[0], partial)
    os.replace(partial, package)
    return package


# ------------------------------------------------------------------ install

def smoke_check(binary: Path, version: str):
    sys.path.insert(0, str(HERE))
    from engine_probe import smoke
    result = smoke(binary)
    problems = []
    if not isinstance(result, dict) or result.get("error"):
        raise EngineError(f"La prueba de humo no pudo ejecutarse: {result}")
    expect = {"name": "Kitsune", "version": version, "brand": "Kitsune", "nativeEntry": True, "nativeModule": True,
              "policies": False, "fxaccounts": False, "privacyMode": "estricto", "signaturesRequired": True, "channel": "release",
              "telemetryExtended": False}
    problems = [f"{key}={result.get(key)!r}" for key, value in expect.items() if result.get(key) != value]
    agent = result.get("userAgent") or ""
    if "Kitsune" in agent or f"Firefox/{version_key(version)[0]}.0" not in agent or result.get("sandboxLevel", 0) <= 0:
        problems.append(f"userAgent/sandbox={result.get('userAgent')!r}/{result.get('sandboxLevel')!r}")
    if problems:
        raise EngineError("El motor nuevo no pasó la prueba de humo: " + ", ".join(problems))
    return result


def switch_current(layout: Layout, target: Path):
    temporary = layout.engines / ".current.tmp"
    if temporary.is_symlink() or temporary.exists():
        temporary.unlink()
    os.symlink(target.name, temporary)
    os.replace(temporary, layout.current)


# Extensiones que Kitsune trae de serie, sin políticas de empresa: Gecko las instala
# en cada perfil nuevo desde distribution/extensions (firmadas; la firma se exige).
DISTRIBUTION_ADDONS = {"uBlock0@raymondhill.net": "https://addons.mozilla.org/firefox/downloads/latest/uBlock0@raymondhill.net/latest.xpi"}


def distribution_addons(layout: Layout, target: Path, log=print, opener=urllib.request.urlopen):
    """Descarga las extensiones de serie (o reutiliza la última buena si no hay red)."""
    cache = layout.private(layout.cache / "addons")
    target.mkdir(parents=True, exist_ok=True)
    for addon, url in DISTRIBUTION_ADDONS.items():
        cached = cache / f"{addon}.xpi"
        try:
            partial = cached.with_suffix(".part")
            partial.unlink(missing_ok=True)
            download(url, partial, opener)
            with zipfile.ZipFile(partial) as xpi:
                manifest = json.loads(xpi.read("manifest.json"))
                gecko = manifest.get("browser_specific_settings", manifest.get("applications", {})).get("gecko", {})
                if gecko.get("id") != addon or not any(name.startswith("META-INF/") for name in xpi.namelist()):
                    raise EngineError(f"{addon}: la descarga no es la extensión firmada esperada")
            os.replace(partial, cached)
        except (OSError, ValueError, KeyError, zipfile.BadZipFile, EngineError) as error:
            log(f"No se pudo descargar {addon} ({type(error).__name__}); se usa la copia anterior si la hay")
        if cached.is_file():
            shutil.copyfile(cached, target / f"{addon}.xpi")


def install_package(layout: Layout, version: str, package: Path, build_fp: str, install_fp: str, log=print,
                    run=subprocess.run, check=smoke_check, addons=distribution_addons):
    layout.private(layout.engines)
    final = layout.engines / f"{version}-{install_fp[:12]}"
    stage = Path(tempfile.mkdtemp(prefix=".installing-", dir=layout.engines))
    try:
        result = run(["tar", "--no-same-owner", "-xf", str(package), "-C", str(stage)], capture_output=True, text=True)
        root = stage / "kitsune"
        if result.returncode != 0 or not (root / "kitsune").is_file():
            raise EngineError("El paquete de Kitsune no tiene la estructura esperada")
        (root / "distribution").mkdir(exist_ok=True)
        addons(layout, root / "distribution/extensions", log)
        (root / "defaults/pref").mkdir(parents=True, exist_ok=True)
        shutil.copyfile(RECIPE / "autoconfig.js", root / "defaults/pref/autoconfig.js")
        shutil.copyfile(RECIPE / "kitsune.cfg", root / "kitsune.cfg")
        log("Prueba de humo del motor nuevo")
        smoke = check(root / "kitsune", version)
        manifest = {"version": 1, "engineVersion": version, "buildFingerprint": build_fp,
                    "installFingerprint": install_fp, "buildRevision": BUILD_REVISION,
                    "installRevision": INSTALL_REVISION, "installedAt": now(),
                    "source": f"{ARCHIVE}/{version}/source/firefox-{version}.source.tar.xz",
                    "signedBy": MOZILLA_RELEASE_KEY, "smoke": smoke}
        (root / "kitsune-engine.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        if final.exists():
            raise EngineError(f"Ya existe un motor con esta huella: {final.name}")
        os.rename(root, final)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    switch_current(layout, final)
    return final


def in_use(directory: Path, proc=Path("/proc")) -> bool:
    prefix = str(directory.resolve()) + os.sep
    for entry in proc.iterdir():
        if entry.name.isdigit():
            with contextlib.suppress(OSError):
                if os.readlink(entry / "exe").startswith(prefix):
                    return True
    return False


def prune(layout: Layout, log=print, using=in_use):
    """Keep the active engine and the most recent previous one; never delete one in use."""
    if not layout.engines.is_dir():
        return []
    current, _ = layout.current_engine()
    installed = []
    for path in layout.engines.iterdir():
        if path.is_symlink() or not path.is_dir() or path.name.startswith("."):
            continue
        with contextlib.suppress(OSError, ValueError):
            installed.append((json.loads((path / "kitsune-engine.json").read_text())["installedAt"], path))
    installed.sort(reverse=True)
    others = [path for _, path in installed if current is None or path.resolve() != current]
    removed = []
    for path in others[1:]:
        if using(path):
            log(f"Se conserva {path.name}: está en uso")
            continue
        shutil.rmtree(path)
        removed.append(path.name)
    for stale in layout.engines.glob(".installing-*"):
        if not using(stale):
            shutil.rmtree(stale, ignore_errors=True)
    return removed


def clean_build_cache(layout: Layout, version: str):
    for pattern in ("src-*", "obj-*", "mozconfig-*", "downloads/*"):
        for path in layout.cache.glob(pattern):
            if not path.name.endswith(version):
                shutil.rmtree(path) if path.is_dir() and not path.is_symlink() else path.unlink()
    packages = sorted((layout.cache / "packages").glob("kitsune-*.tar.xz"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in packages[2:]:
        old.unlink()


# ------------------------------------------------------- profile safekeeping

def last_used_by_other_engine(profile: Path) -> bool:
    """True if Gecko last opened this profile from outside Kitsune's own engines."""
    ini = profile / "compatibility.ini"
    if not ini.is_file():
        return False  # never opened: nothing to protect
    match = re.search(r"(?m)^LastPlatformDir=(.*)$", ini.read_text(errors="replace"))
    return not (match and "/kitsune-browser/engine/" in match.group(1))


def profile_in_use(profile: Path) -> bool:
    """Probe the same fcntl lock Gecko holds on .parentlock while a profile is open."""
    try:
        descriptor = os.open(profile / ".parentlock", os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW)
    except FileNotFoundError:
        return False
    try:
        fcntl.lockf(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return True
    else:
        fcntl.lockf(descriptor, fcntl.LOCK_UN)
        return False
    finally:
        os.close(descriptor)


def backup_profile(profile: Path, backups_root: Path):
    """Copy a profile once, closed, before Kitsune's own engine first upgrades it.

    A newer Gecko upgrades the profile and an older engine cannot reopen it
    afterwards. Copies are never made of a profile in use (inconsistent
    databases); the launch then simply reaches the running instance.
    """
    if not last_used_by_other_engine(profile) or profile_in_use(profile):
        return None
    target = Path(tempfile.mkdtemp(prefix="kitsune-0.6-profile-backup.", dir=backups_root))
    shutil.copytree(profile, target / "profile", symlinks=True)
    (target / "LEEME.txt").write_text(
        f"Copia de {profile}\nhecha el {now()} antes de abrirlo por primera vez con el motor propio de Kitsune.\n"
        "Para volver atrás: cierra Kitsune y sustituye la carpeta del perfil por esta copia.\n")
    return target


# -------------------------------------------------------------------- state

def read_status(layout: Layout):
    with contextlib.suppress(OSError, ValueError):
        return json.loads((layout.state / "status.json").read_text())
    return {}


def write_status(layout: Layout, **changes):
    layout.private(layout.state)
    status = {**read_status(layout), **changes}
    temporary = layout.state / ".status.tmp"
    temporary.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n")
    os.replace(temporary, layout.state / "status.json")
    return status


def notify(message, enabled):
    if enabled and shutil.which("notify-send"):
        subprocess.run(["notify-send", "--app-name=Kitsune", "--icon=kitsune-browser", "Kitsune", message], check=False)


@contextlib.contextmanager
def build_lock(layout: Layout):
    layout.private(layout.state)
    descriptor = os.open(layout.state / "build.lock", os.O_RDWR | os.O_CREAT | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise EngineError("Ya hay una compilación de Kitsune en marcha") from None
        yield
    finally:
        os.close(descriptor)


def build(layout: Layout, version=None, if_new=False, notify_user=False, log=print):
    with build_lock(layout):
        layout.private(layout.cache)
        if version is None:
            version = latest_version()
            write_status(layout, lastCheck=now(), latest=version)
        version_key(version)
        current, manifest = layout.current_engine()
        install_fp = install_fingerprint(version)
        if if_new and manifest and (version_key(manifest["engineVersion"]) > version_key(version) or
                                    manifest.get("installFingerprint") == install_fp):
            log(f"Kitsune está al día (Gecko {manifest['engineVersion']})")
            return current
        build_fp = build_fingerprint(version)
        logfile = layout.private(layout.state) / f"build-{version}.log"
        write_status(layout, building={"version": version, "since": now(), "pid": os.getpid()})
        try:
            package = layout.cache / "packages" / f"kitsune-{version}-{build_fp[:16]}.tar.xz"
            if not package.is_file():
                tarball = fetch(layout, version, log)
                source = prepare_source(layout, version, tarball, build_fp, log)
                package = compile_package(layout, version, source, build_fp, logfile, log)
            engine = install_package(layout, version, package, build_fp, install_fp, log)
        except Exception as error:
            message = str(error) if isinstance(error, EngineError) else f"{type(error).__name__}: {error}"
            write_status(layout, building=None, lastBuild={"version": version, "result": "error", "message": message,
                                                         "at": now(), "log": str(logfile)})
            keep = f"sigues con Gecko {manifest['engineVersion']}" if manifest else "aún no hay motor activo"
            notify(f"No se pudo preparar el motor {version}: {message[:180]} ({keep})", notify_user)
            raise
        write_status(layout, building=None, lastBuild={"version": version, "result": "ok", "engine": engine.name,
                                                     "at": now(), "log": str(logfile)})
        with contextlib.suppress(OSError):
            clean_build_cache(layout, version)
        prune(layout, log)
        log(f"Motor activo: {engine.name}")
        notify(f"Motor Gecko {version} listo: se usará al volver a abrir Kitsune", notify_user)
        return engine


# ------------------------------------------------------------ otros sistemas
# Motores de Kitsune para Windows y macOS, compilados aquí en cruzado: Gecko trae
# sus herramientas (el kit de Visual Studio y el SDK de macOS de Apple) con
# --enable-bootstrap. Se empaquetan para la web de descarga; no se instalan ni se
# prueban en este PC. Sin la clave propia de Safe Browsing (es solo de Risco).
TARGETS = {"windows": "x86_64-pc-windows-msvc", "macos": "aarch64-apple-darwin"}
CROSS_MIN_FREE_BYTES = 30 * 2**30
TARGET_ARTIFACTS = {"windows": ("*.win64.zip", "install/sea/*.exe"), "macos": ("*.mac.dmg",)}


# El SDK de Windows viene en .msi: Gecko los abre con msiextract (msitools). Si no
# está instalado, se bajan msitools y gcab de los repos de Arch, se comprueba su
# firma con el llavero del sistema y se usan desde la caché, sin sudo.
MSITOOLS_PACKAGES = ("msitools", "gcab")
MSIEXTRACT_SHIM = """#!/bin/sh
# Kitsune: msiextract de la caché (msitools sin instalar en el sistema).
here=@ROOT@
LD_LIBRARY_PATH="$here/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" exec "$here/usr/bin/msiextract" "$@"
"""


def cross_tools(layout: Layout, tools: Path, target: str, log=print, run=subprocess.run) -> None:
    """Programas que solo hacen falta al compilar para otro sistema."""
    if target != "windows" or shutil.which("msiextract"):
        return
    root = layout.cache / "toolchain/msitools"
    shim = tools / "msiextract"
    text = MSIEXTRACT_SHIM.replace("@ROOT@", shlex.quote(str(root)))
    if not (root / "usr/bin/msiextract").is_file():
        log("Preparando msitools (para abrir el SDK de Windows) sin instalar nada en el sistema")
        urls = run(["pacman", "-Sp", *MSITOOLS_PACKAGES], capture_output=True, text=True, check=True).stdout.split()
        downloads = layout.private(layout.cache / "downloads/msitools")
        staging = layout.cache / "toolchain/msitools.part"
        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir(parents=True)
        for url in urls:
            if not url.startswith("https://") or not url.endswith(".pkg.tar.zst"):
                raise EngineError(f"Dirección de paquete inesperada: {url}")
            package = downloads / url.rsplit("/", 1)[1]
            for suffix in ("", ".sig"):
                run(["curl", "-fsSL", "-o", f"{package}{suffix}", url + suffix], check=True)
            if run(["pacman-key", "--verify", f"{package}.sig", str(package)], stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL).returncode != 0:
                raise EngineError(f"La firma de {package.name} no es válida")
            run(["tar", "--zstd", "-xf", str(package), "-C", str(staging), "usr"], check=True)
        shutil.rmtree(root, ignore_errors=True)
        staging.rename(root)
    if not shim.is_file() or shim.read_text() != text:
        shim.write_text(text)
        shim.chmod(0o700)


# Rust para otro sistema: el rustc del sistema solo trae la biblioteca estándar de
# Linux. Se baja el Rust oficial de la misma versión (rustc, cargo y las bibliotecas
# de Linux y del sistema destino), se comprueba con la clave de firma de Rust y se
# usa desde la caché solo en las compilaciones cruzadas.
RUST_DIST = "https://static.rust-lang.org/dist"
RUST_KEY_URL = "https://static.rust-lang.org/rust-key.gpg.ascii"
RUST_KEY_FINGERPRINT = "108F66205EAEB0AAA8DD5E1C85AB96E6FA1BE5FE"
RUST_HOST = "x86_64-unknown-linux-gnu"


def cross_rust(layout: Layout, target: str, log=print, run=subprocess.run) -> dict:
    """RUSTC y CARGO de un Rust oficial con la biblioteca estándar del sistema destino."""
    found = re.match(r"rustc (\d+\.\d+\.\d+)\b", run(["rustc", "--version"], capture_output=True, text=True, check=True).stdout)
    if not found:
        raise EngineError("No se pudo leer la versión de rustc")
    version = found.group(1)
    root = layout.cache / f"toolchain/rust-{version}"
    wanted = [("rustc", RUST_HOST), ("cargo", RUST_HOST), ("rust-std", RUST_HOST), ("rust-std", TARGETS[target])]
    present = {"rustc": "bin/rustc", "cargo": "bin/cargo", "rust-std": "lib/rustlib/{}/lib"}
    missing = [(name, platform) for name, platform in wanted if not (root / present[name].format(platform)).exists()]
    if missing:
        log(f"Preparando Rust {version} para {target} (firmado por el equipo de Rust)")
        downloads = layout.private(layout.cache / "downloads/rust")
        work = Path(tempfile.mkdtemp(prefix="rust-", dir=layout.private(layout.cache / "toolchain")))
        try:
            gnupg = work / "gnupg"
            gnupg.mkdir(mode=0o700)
            env = {**os.environ, "GNUPGHOME": str(gnupg)}
            key = work / "rust-key.asc"
            run(["curl", "-fsSL", "-o", str(key), RUST_KEY_URL], check=True)
            run(["gpg", "--batch", "--quiet", "--import", str(key)], env=env, check=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            listing = run(["gpg", "--batch", "--with-colons", "--fingerprint"], env=env, capture_output=True, text=True, check=True).stdout
            if f"fpr:::::::::{RUST_KEY_FINGERPRINT}:" not in listing:
                raise EngineError("La clave de firma de Rust no es la esperada")
            staging = root if root.is_dir() else work / "prefix"
            for name, platform in missing:
                archive = downloads / f"{name}-{version}-{platform}.tar.xz"
                for suffix in ("", ".asc"):
                    run(["curl", "-fsSL", "-o", f"{archive}{suffix}", f"{RUST_DIST}/{archive.name}{suffix}"], check=True)
                verified = run(["gpg", "--batch", "--status-fd", "1", "--verify", f"{archive}.asc", str(archive)],
                               env=env, capture_output=True, text=True)
                if verified.returncode != 0 or f"VALIDSIG {RUST_KEY_FINGERPRINT}" not in verified.stdout:
                    raise EngineError(f"La firma de {archive.name} no es válida")
                unpacked = work / archive.name.removesuffix(".tar.xz")
                unpacked.mkdir()
                run(["tar", "-xJf", str(archive), "-C", str(unpacked), "--strip-components=1"], check=True)
                for component in (unpacked / "components").read_text().split():
                    if "/" in component or component.startswith("."):
                        raise EngineError(f"Componente de Rust inesperado: {component}")
                    shutil.copytree(unpacked / component, staging, dirs_exist_ok=True,
                                    ignore=shutil.ignore_patterns("manifest.in"))
            if staging != root:
                staging.rename(root)
        finally:
            shutil.rmtree(work, ignore_errors=True)
    return {"RUSTC": str(root / "bin/rustc"), "CARGO": str(root / "bin/cargo")}


def write_target_mozconfig(layout: Layout, version: str, target: str) -> Path:
    objdir = layout.cache / f"obj-{version}-{target}"
    text = ((RECIPE / "mozconfig.in").read_text().replace("@OBJDIR@", str(objdir))
            .replace("@L10NBASE@", str(layout.cache / f"l10n-{version}")))
    text += f"\n# Kitsune para {target}: compilación cruzada desde Linux.\nac_add_options --target={TARGETS[target]}\n"
    path = layout.cache / f"mozconfig-{version}-{target}"
    path.write_text(text)
    return path


def build_target(layout: Layout, version: str, target: str, log=print, run=subprocess.run) -> list:
    """Compila y empaqueta el motor para otro sistema; devuelve los archivos listos."""
    if target not in TARGETS:
        raise EngineError(f"Sistema desconocido: {target}")
    version_key(version)
    with build_lock(layout):
        layout.private(layout.cache)
        if shutil.disk_usage(layout.cache).free < CROSS_MIN_FREE_BYTES:
            raise EngineError("Hacen falta al menos 30 GB libres para compilar Kitsune para otro sistema")
        build_fp = build_fingerprint(version)
        logfile = layout.private(layout.state) / f"build-{version}-{target}.log"
        write_status(layout, building={"version": version, "target": target, "since": now(), "pid": os.getpid()})
        try:
            tarball = fetch(layout, version, log)
            source = prepare_source(layout, version, tarball, build_fp, log)
            prepare_l10n(layout, source, log, run)
            tools = build_tools(layout)
            cross_tools(layout, tools, target, log, run)
            env = mach_environment(write_target_mozconfig(layout, version, target), tools)
            env.update(cross_rust(layout, target, log, run))
            sccache = Path(env["MOZBUILD_STATE_PATH"]) / "sccache/sccache"
            if sccache.is_file():
                run([str(sccache), "--stop-server"], env=env, stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            jobs = build_jobs(limit=cgroup_memory_limit())
            log(f"Compilando Kitsune para {target} sobre Gecko {version} con {jobs} tareas (registro: {logfile})")
            mach(source, ["build", f"-j{jobs}"], env, logfile, run)
            mach(source, ["package-multi-locale", "--locales", "en-US", *L10N_LOCALES], env, logfile, run)
            dist = layout.cache / f"obj-{version}-{target}" / "dist"
            out = layout.private(layout.cache / "packages" / target)
            ready = []
            for pattern in TARGET_ARTIFACTS[target]:
                for artifact in sorted(dist.glob(pattern)):
                    destination = out / artifact.name.replace("kitsune-", f"kitsune-{build_fp[:8]}-", 1)
                    shutil.copyfile(artifact, destination)
                    ready.append(destination)
            if not ready:
                raise EngineError(f"No se encontró el paquete de Kitsune para {target} tras compilar")
        except Exception as error:
            message = str(error) if isinstance(error, EngineError) else f"{type(error).__name__}: {error}"
            write_status(layout, building=None, lastTarget={"target": target, "version": version, "result": "error",
                                                           "message": message, "at": now(), "log": str(logfile)})
            raise
        write_status(layout, building=None, lastTarget={"target": target, "version": version, "result": "ok",
                                                       "files": [str(path) for path in ready], "at": now()})
        for path in ready:
            log(f"Listo: {path}")
        return ready


def process_alive(pid) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def status(layout: Layout):
    current, manifest = layout.current_engine()
    data = read_status(layout)
    building = data.get("building")
    if building and not process_alive(building.get("pid")):
        # Killed from outside (e.g. out of memory) before it could record a result.
        data["building"] = None
        data["lastBuild"] = {"version": building.get("version"), "result": "interrumpida",
                             "message": "La compilación se interrumpió desde fuera (por ejemplo, por falta de memoria)",
                             "at": building.get("since")}
    return {"engine": current.name if current else None,
            "engineVersion": manifest["engineVersion"] if manifest else None,
            "installedAt": manifest["installedAt"] if manifest else None,
            "lastCheck": data.get("lastCheck"), "latest": data.get("latest"),
            "building": data.get("building"), "lastBuild": data.get("lastBuild")}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check", help="muestra la última versión estable de Gecko")
    builder = commands.add_parser("build", help="compila, prueba y activa un motor")
    builder.add_argument("--version")
    builder.add_argument("--if-new", action="store_true", help="solo si hay una versión o receta nueva")
    builder.add_argument("--notify", action="store_true", help="avisa con una notificación del escritorio")
    builder.add_argument("--target", choices=sorted(TARGETS), help="compila para otro sistema (no se instala aquí)")
    commands.add_parser("current", help="ruta del ejecutable del motor activo")
    commands.add_parser("status", help="estado del motor y de la última compilación")
    commands.add_parser("prune", help="borra motores antiguos que no estén en uso")
    safekeeping = commands.add_parser("backup-profile", help="copia un perfil cerrado antes de que el motor propio lo actualice")
    safekeeping.add_argument("--profile", type=Path, required=True)
    args = parser.parse_args(argv)
    layout = Layout.default()
    try:
        if args.command == "check":
            version = latest_version()
            write_status(layout, lastCheck=now(), latest=version)
            print(version)
        elif args.command == "build" and args.target:
            build_target(layout, args.version or latest_version(), args.target)
        elif args.command == "build":
            build(layout, args.version, args.if_new, args.notify)
        elif args.command == "current":
            current, _ = layout.current_engine()
            if current is None:
                print("El motor de Kitsune aún no está compilado. Ejecuta: kitsune-browser --actualizar-motor", file=sys.stderr)
                return 3
            print(current / "kitsune")
        elif args.command == "status":
            print(json.dumps(status(layout), ensure_ascii=False, indent=2))
        elif args.command == "prune":
            for name in prune(layout):
                print(f"Borrado {name}")
        elif args.command == "backup-profile":
            copy = backup_profile(args.profile, layout.browser_root.parent)
            if copy:
                print(f"Copia de seguridad del perfil: {copy}", file=sys.stderr)
    except (EngineError, OSError, ValueError) as error:
        print(f"Kitsune: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
