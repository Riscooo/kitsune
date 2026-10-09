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
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

# Bump BUILD_REVISION when the compile recipe changes in code (not only in its
# input files, which are hashed); bump INSTALL_REVISION for install-only changes.
BUILD_REVISION = 1
INSTALL_REVISION = 1
MOZILLA_RELEASE_KEY = "14F26682D0916CDD81E37B6D61B7B526D98F0353"  # Mozilla Software Releases
ARCHIVE = "https://archive.mozilla.org/pub/firefox/releases"
VERSIONS_URL = "https://product-details.mozilla.org/1.0/firefox_versions.json"
VERSION = re.compile(r"\d{1,4}\.\d{1,4}(?:\.\d{1,4})?")
MIN_FREE_BYTES = 50 * 2**30
# Each parallel Gecko compile job can take ~2 GiB at its peak (Rust crates,
# large C++ units); more jobs than memory allows gets the build OOM-killed.
GIB_PER_JOB = 2
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
ABOUT_CREDIT = '<label id="kitsune-engine-credit" class="text-blurb">Tinta · basado en Mozilla Gecko</label>'
BRAND_FTL = """# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Kitsune: marca propia, compilada en el motor.

-brand-shorter-name = Kitsune
-brand-short-name = Kitsune
-brand-shortcut-name = Kitsune
-brand-full-name = Kitsune
-brand-product-name = Kitsune
-vendor-short-name = Mozilla
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
    return files


def install_files():
    return {name: RECIPE / name for name in ("policies.json", "autoconfig.js", "kitsune.cfg")}


def fingerprint(version: str, files: dict, revision: int, parent: str = "") -> str:
    digest = hashlib.sha256(json.dumps([revision, version, parent], separators=(",", ":")).encode())
    for name, path in sorted(files.items()):
        if path.is_symlink() or not path.is_file():
            raise EngineError(f"Falta un archivo de la receta de Kitsune: {name}")
        digest.update(f"\0{name}\0{sha256_file(path)}".encode())
    return digest.hexdigest()


def build_fingerprint(version):
    return fingerprint(version, input_files(), BUILD_REVISION)


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
    (top / ".kitsune-source.json").write_text(json.dumps({"version": version, "buildFingerprint": build_fp, "preparedAt": now()}))
    os.rename(top, source)
    shutil.rmtree(stage, ignore_errors=True)
    return source


def write_mozconfig(layout: Layout, version: str) -> Path:
    objdir = layout.cache / f"obj-{version}"
    text = (RECIPE / "mozconfig.in").read_text().replace("@OBJDIR@", str(objdir))
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


def build_jobs(meminfo=Path("/proc/meminfo"), cpus=None):
    """Parallel jobs that fit in the memory available now (at least 2)."""
    cpus = cpus or os.cpu_count() or 2
    available = 0
    with contextlib.suppress(OSError, ValueError):
        match = re.search(r"(?m)^MemAvailable:\s+(\d+) kB$", meminfo.read_text())
        available = int(match.group(1)) * 1024 if match else 0
    return max(2, min(cpus, available // (GIB_PER_JOB * 2**30)))


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
    jobs = build_jobs()
    log(f"Compilando con {jobs} tareas en paralelo (según la memoria libre)")
    mach(source, ["build", f"-j{jobs}"], env, logfile, run)
    mach(source, ["package"], env, logfile, run)
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
              "policies": True, "privacyMode": "estricto", "signaturesRequired": True}
    problems = [f"{key}={result.get(key)!r}" for key, value in expect.items() if result.get(key) != value]
    if "Kitsune" in result.get("userAgent", "Kitsune") or result.get("sandboxLevel", 0) <= 0:
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


def install_package(layout: Layout, version: str, package: Path, build_fp: str, install_fp: str, log=print,
                    run=subprocess.run, check=smoke_check):
    layout.private(layout.engines)
    final = layout.engines / f"{version}-{install_fp[:12]}"
    stage = Path(tempfile.mkdtemp(prefix=".installing-", dir=layout.engines))
    try:
        result = run(["tar", "--no-same-owner", "-xf", str(package), "-C", str(stage)], capture_output=True, text=True)
        root = stage / "kitsune"
        if result.returncode != 0 or not (root / "kitsune").is_file():
            raise EngineError("El paquete de Kitsune no tiene la estructura esperada")
        (root / "distribution").mkdir(exist_ok=True)
        shutil.copyfile(RECIPE / "policies.json", root / "distribution/policies.json")
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
