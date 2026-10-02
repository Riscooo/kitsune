#!/usr/bin/env python3
"""Build an immutable, user-local Kitsune UI around the installed Gecko engine.

Product resources and a narrowly scoped native Kitsune appearance module change.
Compiled executables, application identity, UA, security defaults, addon signatures,
certificate stores, license pages and upstream links remain upstream originals.
The system installation is never modified. A changed engine gets a fresh copy;
an old snapshot is never silently substituted if preparing its update fails.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import sys
import tempfile
import zipfile


# Bump when the resource transformation changes. Asset bytes are also hashed.
REVISION = 3
BRAND_RESOURCE = re.compile(r"(?:^localization/[^/]+/branding/brand\.ftl$|^chrome/[^/]+/locale/branding/brand\.(?:dtd|properties)$)")
ABOUT = "chrome/browser/content/browser/aboutDialog.xhtml"
WINDOW = "chrome/browser/content/browser/browser.xhtml"
BOOTSTRAP = '<script src="chrome://browser/content/browser-main.js"></script>'
NATIVE_FILES = {f"chrome/browser/content/browser/{name}": name for name in ('kitsune-bootstrap.js', 'kitsune-appearance.sys.mjs')}
EOCD = struct.Struct("<4s4H2LH")
BRAND_IMAGE_FILES = {
    "about-logo-private.png": "icon-192.png", "about-logo-private@2x.png": "icon-384.png",
    "about-logo.png": "icon-192.png", "about-logo@2x.png": "icon-384.png",
    "about-logo.svg": "icon.svg", "about-wordmark.svg": "wordmark.svg",
    "firefox-wordmark.svg": "wordmark.svg", "about.png": "about-300x236.png",
    **{f"icon{size}.png": f"icon-{size}.png" for size in (16, 32, 48, 64, 128)},
}
BRAND_IMAGES = {f"chrome/browser/content/branding/{name}": asset for name, asset in BRAND_IMAGE_FILES.items()}
ICON_FILES = {f"browser/chrome/icons/default/default{size}.png": f"icon-{size}.png" for size in (16, 32, 48, 64, 128)}


def load_branding_assets() -> dict[str, bytes]:
    root = Path(__file__).resolve().with_name("branding")
    result = {}
    for name in sorted(set(BRAND_IMAGE_FILES.values())):
        path = root / name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"Kitsune branding asset missing or linked: {name}")
        result[name] = path.read_bytes()
        if len(result[name]) > 1024 * 1024:
            raise ValueError(f"Kitsune branding asset is unexpectedly large: {name}")
        if name.endswith(".png") and not result[name].startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError(f"Invalid Kitsune icon: {name}")
    return result


def open_omni(path: Path) -> zipfile.ZipFile:
    """Read standard ZIP or Mozilla's optimized, central-directory-first JAR.

    Python's ZIP reader assumes the directory is at the end. Normalize only
    the container index in memory; local entry offsets and payloads stay exact.
    No extraction of archive paths takes place.
    """
    try:
        return zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        payload = path.read_bytes()
        if len(payload) < EOCD.size:
            raise ValueError("Incomplete engine archive")
        end = list(EOCD.unpack(payload[-EOCD.size:]))
        if end[0] != b"PK\x05\x06" or end[1:3] != [0, 0] or end[-1] != 0:
            raise ValueError("Unsupported engine archive layout")
        size, offset = end[5:7]
        if offset != 4 or payload[offset:offset + 4] != b"PK\x01\x02" or offset + size > len(payload) - EOCD.size:
            raise ValueError("Invalid optimized engine directory")
        end[6] = len(payload) - EOCD.size
        normalized = payload[:-EOCD.size] + payload[offset:offset + size] + EOCD.pack(*end)
        return zipfile.ZipFile(io.BytesIO(normalized))


def brand_resource(name: str, value: bytes) -> bytes:
    if BRAND_RESOURCE.fullmatch(name):
        text = value.decode("utf-8")
        # Product identity only: do not rename actual upstream sync services,
        # URLs, trademarks or license notices in these localization files.
        for key in ("brand-shorter-name", "brand-short-name", "brand-full-name",
                    "brand-shortcut-name", "brand-product-name", "vendor-short-name"):
            text = re.sub(rf"(?m)^(-{key}\s*=\s*)LibreWolf\s*$", rf"\g<1>Kitsune", text)
        for key in ("brandShorterName", "brandShortName", "brandFullName", "brandProductName", "vendorShortName"):
            text = re.sub(rf'(<\!ENTITY\s+{key}\s+")LibreWolf(">)', rf"\g<1>Kitsune\2", text)
            text = re.sub(rf"(?m)^({key}=)LibreWolf\s*$", rf"\g<1>Kitsune", text)
        return text.encode("utf-8")
    if name == ABOUT:
        text = value.decode("utf-8")
        expected = '<label id="wordmark">LibreWolf</label>'
        if text.count(expected) != 1:
            raise ValueError("Engine About markup changed; branding needs review")
        return text.replace(expected, '<label id="wordmark">Kitsune</label>\n'
            '      <label id="kitsune-engine-credit">Nightfall · basado en LibreWolf y Mozilla Gecko</label>').encode("utf-8")
    return value


def load_native_assets():
    root = Path(__file__).resolve().with_name('native')
    assets = {}
    for name in NATIVE_FILES.values():
        path = root / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 65536:
            raise ValueError('Missing or invalid Kitsune native module')
        assets[name] = path.read_bytes()
    return assets


def patch_archive(source: Path, destination: Path, assets: dict[str, bytes] | None = None, native=None) -> dict:
    changed = []
    with open_omni(source) as original, zipfile.ZipFile(destination, "w") as output:
        names = original.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate engine resource names")
        for entry in original.infolist():
            payload = original.read(entry)
            replacement = assets[BRAND_IMAGES[entry.filename]] if assets is not None and entry.filename in BRAND_IMAGES else brand_resource(entry.filename, payload)
            if native is not None and entry.filename == WINDOW:
                markup = payload.decode('utf-8')
                if markup.count(BOOTSTRAP) != 1:
                    raise ValueError('Native window entry point changed; Kitsune integration needs review')
                replacement = markup.replace(BOOTSTRAP, BOOTSTRAP + '\n  <script src="chrome://browser/content/kitsune-bootstrap.js"></script>').encode()
            if replacement != payload:
                changed.append(entry.filename)
            output.writestr(entry, replacement)
        if native is not None:
            if WINDOW not in changed or any(name in names for name in NATIVE_FILES):
                raise ValueError('Unexpected native Kitsune resource layout')
            for resource, name in NATIVE_FILES.items():
                output.writestr(resource, native[name])
                changed.append(resource)
    if not any(name.endswith("/branding/brand.ftl") for name in changed) or ABOUT not in changed:
        raise ValueError("Required product branding resources were not found")
    return {"changedResources": changed, "resourceCount": len(names), "addedResources": list(NATIVE_FILES) if native is not None else []}


def source_snapshot(source: Path, assets: dict[str, bytes] | None = None) -> tuple[str, list]:
    entries = []
    for path in sorted(source.rglob("*")):
        info = path.lstat()
        if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)):
            raise ValueError(f"Unsupported engine file: {path.name}")
        entries.append([path.relative_to(source).as_posix(), info.st_mode, info.st_size,
                        info.st_mtime_ns, info.st_ino, os.readlink(path) if path.is_symlink() else None])
    asset_hashes = [[name, hashlib.sha256(value).hexdigest()] for name, value in sorted((assets or {}).items())]
    fingerprint = hashlib.sha256(json.dumps([REVISION, str(source), entries, asset_hashes], separators=(",", ":")).encode()).hexdigest()
    return fingerprint, entries


def private_directory(path: Path):
    if path.is_symlink():
        raise ValueError("Runtime directory must not be a symbolic link")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.stat().st_uid != os.getuid():
        raise ValueError("Runtime directory must belong to the current user")
    path.chmod(0o700)


def prepare(source: Path, runtime_root: Path) -> Path:
    source = source.resolve(strict=True)
    runtime_root = runtime_root.absolute()
    if runtime_root == source or source in runtime_root.parents or runtime_root in source.parents:
        raise ValueError("Engine source and private runtime must be separate")
    for required in ("librewolf", "libxul.so", "omni.ja", "browser/omni.ja", "application.ini", "librewolf.cfg"):
        if not (source / required).is_file():
            raise ValueError(f"Installed engine is missing {required}")
    private_directory(runtime_root)
    lock_fd = os.open(runtime_root / ".prepare.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        assets = load_branding_assets()
        native = load_native_assets()
        fingerprint, entries = source_snapshot(source, {**assets, **native})
        version_match = re.search(r"(?m)^Version=([\w.-]+)$", (source / "application.ini").read_text())
        version = version_match.group(1) if version_match else "engine"
        destination = runtime_root / f"{version}-kitsune{REVISION}-{fingerprint[:16]}"
        manifest_path = destination / "kitsune-runtime.json"
        if destination.is_symlink():
            raise ValueError("Runtime snapshot must not be a symbolic link")
        if manifest_path.is_file():
            manifest = json.loads(manifest_path.read_text())
            if manifest.get("sourceFingerprint") != fingerprint or not os.access(destination / "librewolf", os.X_OK):
                raise ValueError("Runtime snapshot is incomplete")
            return destination / "librewolf"
        # Each build gets its own private staging directory. Failed staging is
        # preserved for diagnosis; no broad cleanup or live snapshot deletion.
        stage = Path(tempfile.mkdtemp(prefix=".building-", dir=runtime_root))
        shutil.copytree(source, stage, symlinks=True, dirs_exist_ok=True)
        stage.chmod(0o700)
        # The distro's relative librewolf-bin link points outside its directory
        # to /usr/bin. Keep child relaunches inside this identical private engine.
        bin_link = stage / "librewolf-bin"
        if bin_link.is_symlink():
            bin_link.unlink()
            bin_link.symlink_to("librewolf")
        archive = stage / "browser/omni.ja"
        replacement = stage / "browser/omni.kitsune.ja"
        patched = patch_archive(archive, replacement, assets, native)
        os.replace(replacement, archive)
        modified_icons = []
        for relative, asset in ICON_FILES.items():
            icon = stage / relative
            if icon.is_file() and not icon.is_symlink():
                icon.write_bytes(assets[asset])
                modified_icons.append(relative)
        if source_snapshot(source, {**load_branding_assets(), **load_native_assets()})[0] != fingerprint:
            raise ValueError("Engine was updated while preparing Kitsune; retry launch")
        manifest = {"version": 1, "brandingRevision": REVISION, "source": str(source),
                    "sourceFingerprint": fingerprint, "engineVersion": version,
                    "modifiedFiles": ["browser/omni.ja", "librewolf-bin", *modified_icons],
                    "upstream": ["https://librewolf.net/", "https://www.mozilla.org/MPL/2.0/"],
                    **patched}
        with (stage / "kitsune-runtime.json").open("x") as handle:
            json.dump(manifest, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        (stage / "kitsune-runtime.json").chmod(0o600)
        os.rename(stage, destination)
        return destination / "librewolf"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("/usr/lib/librewolf"))
    parser.add_argument("--runtime-root", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(prepare(args.source, args.runtime_root))
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"Kitsune no pudo preparar el motor actualizado: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
