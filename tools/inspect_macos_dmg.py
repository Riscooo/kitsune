#!/usr/bin/env python3
"""Revisa el .dmg de macOS antes de publicarlo.

Lo abre con las herramientas que trae Gecko (dmg y hfsplus) y comprueba que la app
lleva lo de Kitsune: kitsune.cfg con su cargador, uBlock Origin firmado, el inicio
integrado y el estilo en el motor, el identificador io.github.riscooo.kitsune, el
icono de Kitsune (sin el catálogo genérico), la firma ad hoc, y el fondo de la
ventana y el icono del disco. Sale con error si falta algo.

    python3 tools/inspect_macos_dmg.py <kitsune.dmg> [--arch arm64|x86_64]

Con --arch comprueba además que el ejecutable sea de esa arquitectura (Apple Silicon o Intel).
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOOLS = Path.home() / ".mozbuild"
KEY = Path.home() / ".config/kitsune-browser/safebrowsing-api-key"
BRANDING = ROOT / "install/branding/macos"
# CPU_TYPE de las cabeceras Mach-O de 64 bits.
CPU_TYPES = {"arm64": 0x0100000C, "x86_64": 0x01000007}


def macho_arch(path: Path) -> str | None:
    """La arquitectura de un ejecutable Mach-O de 64 bits (o None si no lo es)."""
    header = path.read_bytes()[:8]
    if header[:4] != bytes.fromhex("cffaedfe"):
        return None
    cpu = int.from_bytes(header[4:8], "little")
    return next((name for name, value in CPU_TYPES.items() if value == cpu), None)


def main(dmg: Path, arch: str | None = None) -> int:
    problems, notes = [], []
    with tempfile.TemporaryDirectory() as folder:
        out = Path(folder)
        subprocess.run([str(TOOLS / "dmg/dmg"), "extract", str(dmg), str(out / "disco.hfs")], check=True, stdout=subprocess.DEVNULL)
        files = out / "disco"
        files.mkdir()
        subprocess.run([str(TOOLS / "dmg/hfsplus"), str(out / "disco.hfs"), "extractall", "/", str(files)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        apps = sorted(files.glob("*.app"))
        if len(apps) != 1:
            problems.append(f"el disco no tiene una sola app: {[app.name for app in apps]}")
            return report(problems, notes, dmg)
        app = apps[0]
        contents = app / "Contents"
        resources = contents / "Resources"
        info = plistlib.loads((contents / "Info.plist").read_bytes())
        if info.get("CFBundleIdentifier") != "io.github.riscooo.kitsune":
            problems.append(f"identificador inesperado: {info.get('CFBundleIdentifier')}")
        if "CFBundleIconName" in info:
            problems.append("la app sigue usando el catálogo de iconos genérico (CFBundleIconName)")
        icon = resources / info.get("CFBundleIconFile", "firefox.icns")
        if not icon.is_file() or icon.read_bytes() != (BRANDING / "firefox.icns").read_bytes():
            problems.append("el icono de la app no es el de Kitsune")
        for name in ("kitsune.cfg", "defaults/pref/autoconfig.js", "distribution/extensions/uBlock0@raymondhill.net.xpi",
                     "browser/omni.ja", "omni.ja"):
            if not (resources / name).is_file():
                problems.append(f"falta Contents/Resources/{name}")
        if (resources / "kitsune.cfg").is_file() and (resources / "kitsune.cfg").read_bytes() != (ROOT / "install/recipe/kitsune.cfg").read_bytes():
            problems.append("kitsune.cfg no es el de la receta")
        if not (contents / "_CodeSignature/CodeResources").is_file():
            problems.append("la app no está firmada (falta _CodeSignature)")
        executable = contents / "MacOS/kitsune"
        found_arch = macho_arch(executable) if executable.is_file() else None
        notes.append(f"ejecutable {found_arch or 'desconocido'}")
        if arch and found_arch != arch:
            problems.append(f"el ejecutable es {found_arch}, no {arch}")
        omni = resources / "browser/omni.ja"
        if omni.is_file():
            with zipfile.ZipFile(omni) as archive:
                names = set(archive.namelist())
                builtins = json.loads(archive.read("chrome/browser/content/browser/built_in_addons.json"))
                if not any(item.get("addon_id") == "inicio@kitsune" for item in builtins.get("builtins", [])):
                    problems.append("el inicio integrado no está en built_in_addons.json")
                for name in ("chrome/browser/builtin-addons/kitsune-home/start/index.html",
                             "chrome/browser/content/browser/kitsune-chrome/userChrome.css"):
                    if name not in names:
                        problems.append(f"falta {name} en el motor")
        background = files / ".background/background.png"
        if not background.is_file() or background.read_bytes() != (BRANDING / "background.png").read_bytes():
            problems.append("la ventana del .dmg no tiene el fondo de Kitsune")
        volume = files / ".VolumeIcon.icns"
        if not volume.is_file() or volume.read_bytes() != (BRANDING / "disk.icns").read_bytes():
            problems.append("el disco no tiene el icono de Kitsune")
        if KEY.is_file():
            key = KEY.read_text().strip().encode()
            found = any(key in path.read_bytes() for path in app.rglob("*") if path.is_file() and not path.is_symlink())
            notes.append("lleva la clave de Safe Browsing" if found else "sin clave de Safe Browsing")
        total = sum(path.stat().st_size for path in app.rglob("*") if path.is_file() and not path.is_symlink())
        notes.append(f"{dmg.stat().st_size / 2**20:.0f} MB el .dmg, {total / 2**20:.0f} MB la app")
    return report(problems, notes, dmg)


def report(problems, notes, dmg: Path) -> int:
    notes.append("SHA-256 " + hashlib.sha256(dmg.read_bytes()).hexdigest())
    for note in notes:
        print("·", note)
    for problem in problems:
        print("✗", problem)
    print("✓ listo para publicar" if not problems else f"✗ {len(problems)} problema{'' if len(problems) == 1 else 's'}")
    return 1 if problems else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dmg", type=Path)
    parser.add_argument("--arch", choices=sorted(CPU_TYPES))
    args = parser.parse_args()
    sys.exit(main(args.dmg, args.arch))
