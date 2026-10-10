#!/usr/bin/env python3
"""Revisa el instalador de Windows antes de publicarlo.

Abre el .exe (un 7z autoextraíble) con el 7zz que trae Gecko y comprueba que lleva
lo de Kitsune: kitsune.cfg con su cargador, uBlock Origin firmado, el inicio
integrado y el estilo dentro del motor, la marca propia, y si lleva la clave de
Safe Browsing. Sale con error si falta algo.

    python3 tools/inspect_windows_installer.py <instalador.exe>
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SEVENZIP = Path.home() / ".mozbuild/7zz/7zz"
KEY = Path.home() / ".config/kitsune-browser/safebrowsing-api-key"


def largest_icon(path: Path) -> bytes:
    """Los bytes de la imagen más grande de un .ico (así van dentro del .exe)."""
    data = path.read_bytes()
    count = int.from_bytes(data[4:6], "little")
    entries = [data[6 + 16 * index: 22 + 16 * index] for index in range(count)]
    size, offset = max((int.from_bytes(entry[8:12], "little"), int.from_bytes(entry[12:16], "little")) for entry in entries)
    return data[offset:offset + size]


def main(installer: Path) -> int:
    problems, notes = [], []
    with tempfile.TemporaryDirectory() as folder:
        out = Path(folder)
        subprocess.run([str(SEVENZIP), "x", "-y", f"-o{out}", str(installer)], check=True, stdout=subprocess.DEVNULL)
        core = out / "core"
        for name in ("kitsune.exe", "kitsune.cfg", "defaults/pref/autoconfig.js", "uninstall/helper.exe",
                     "distribution/extensions/uBlock0@raymondhill.net.xpi", "browser/omni.ja", "omni.ja"):
            if not (core / name).is_file():
                problems.append(f"falta core/{name}")
        if (core / "kitsune.cfg").is_file() and (core / "kitsune.cfg").read_bytes() != (ROOT / "install/recipe/kitsune.cfg").read_bytes():
            problems.append("kitsune.cfg no es el de la receta")
        xpi = core / "distribution/extensions/uBlock0@raymondhill.net.xpi"
        if xpi.is_file():
            with zipfile.ZipFile(xpi) as addon:
                if not any(name.startswith("META-INF/") for name in addon.namelist()):
                    problems.append("uBlock Origin no está firmado")
        omni = core / "browser/omni.ja"
        if omni.is_file():
            with zipfile.ZipFile(omni) as archive:
                names = set(archive.namelist())
                builtins = json.loads(archive.read("chrome/browser/content/browser/built_in_addons.json"))
                if not any(item.get("addon_id") == "inicio@kitsune" for item in builtins.get("builtins", [])):
                    problems.append("el inicio integrado no está en built_in_addons.json")
                for name in ("chrome/browser/builtin-addons/kitsune-home/manifest.json",
                             "chrome/browser/builtin-addons/kitsune-home/api/parent.js",
                             "chrome/browser/builtin-addons/kitsune-home/start/index.html",
                             "chrome/browser/content/browser/kitsune-chrome/userChrome.css",
                             "chrome/browser/content/browser/kitsune-appearance.sys.mjs"):
                    if name not in names:
                        problems.append(f"falta {name} en el motor")
                identity = archive.read("chrome/browser/content/browser/browser-siteIdentity.js").decode()
                if "inicio@kitsune" not in identity:
                    problems.append("la barra no reconoce el inicio integrado")
                logo = "chrome/browser/content/branding/about-logo.png"
                if logo not in names or archive.read(logo) != (ROOT / "install/branding/icon-192.png").read_bytes():
                    problems.append("el logo del motor no es el de Kitsune")
        exe = core / "kitsune.exe"
        if exe.is_file() and largest_icon(ROOT / "install/branding/windows/firefox.ico") not in exe.read_bytes():
            problems.append("kitsune.exe no lleva el icono de Kitsune")
        if KEY.is_file():
            key = KEY.read_text().strip().encode()
            leaked = [path.relative_to(out) for path in out.rglob("*") if path.is_file() and key in path.read_bytes()]
            for path in out.rglob("*.ja"):
                with zipfile.ZipFile(path) as archive:
                    leaked += [f"{path.name}!{name}" for name in archive.namelist() if key in archive.read(name)]
            # Desde el 2026-10-10 las versiones públicas llevan la clave de Risco (lo decidió él).
            notes.append("lleva la clave de Safe Browsing" if leaked else "sin clave de Safe Browsing: no habrá avisos de webs peligrosas")
        total = sum(path.stat().st_size for path in out.rglob("*") if path.is_file())
        notes.append(f"{installer.stat().st_size / 2**20:.0f} MB el instalador, {total / 2**20:.0f} MB instalado")
    notes.append("SHA-256 " + hashlib.sha256(installer.read_bytes()).hexdigest())
    for note in notes:
        print("·", note)
    for problem in problems:
        print("✗", problem)
    print("✓ listo para publicar" if not problems else f"✗ {len(problems)} problemas")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1])))
