#!/usr/bin/env python3
"""Fondos de serie de Kitsune: los de la nueva pestaña de Gecko, sin la marca Firefox.

El catálogo sale del propio motor (defaults/settings/main/newtab-wallpapers-v2.json
dentro de browser/omni.ja, compilado desde el código firmado de Mozilla). Cada
imagen se descarga una sola vez del CDN de Remote Settings de Mozilla, se acepta
solo si coincide con el sha256 y el tamaño del catálogo, y se guarda normalizada
(JPEG de 2560×1600 como mucho, sin metadatos) junto a una miniatura. Los colores
lisos se generan aquí. La categoría «firefox» (ilustraciones de marca) no se usa.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
CATALOG = "defaults/settings/main/newtab-wallpapers-v2.json"
CDN = "https://firefox-settings-attachments.cdn.mozilla.net/"
CATEGORIES = (("abstracts", "Abstractos"), ("celestial", "Espacio"), ("photographs", "Fotografías"), ("solid-colors", "Colores"))
THUMBNAIL = (320, 200)
MAX_DOWNLOAD = 12 * 1024 * 1024
IDENTIFIER = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
LOCATION = re.compile(r"[A-Za-z0-9][A-Za-z0-9/_.%-]{0,300}")
COLOR = re.compile(r"#[0-9a-fA-F]{6}")
FORMATS = {"image/avif": "AVIF", "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}

_media_spec = importlib.util.spec_from_file_location("kitsune_wallpaper_media", HERE / "media.py")
media = importlib.util.module_from_spec(_media_spec)
_media_spec.loader.exec_module(media)


def default_roots():
    data = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share")
    browser = data / "kitsune-browser"
    return browser / "wallpapers", browser / "engine/current"


def open_omni(path: Path):
    """omni.ja, también el «optimizado» de los motores con PGO (con el lector de kitsune-engine.py, que va al lado)."""
    spec = importlib.util.spec_from_file_location("kitsune_engine_jar", HERE / "kitsune-engine.py")
    if spec is None or not (HERE / "kitsune-engine.py").is_file():
        return zipfile.ZipFile(path)
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    return engine.open_jar(path)


def read_catalog(engine: Path):
    with open_omni(engine / "browser/omni.ja") as omni:
        data = json.loads(omni.read(CATALOG))
    entries = data.get("data") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        raise ValueError("El catálogo de fondos del motor no es válido")
    return entries


def credit(entry):
    name = (entry.get("attribution") or {}).get("name") or {}
    author = name.get("string") if isinstance(name, dict) else None
    return f"Foto: {author[:60]} · Unsplash" if isinstance(author, str) and author.strip() else None


def download(location: str, size: int, digest: str, opener=urllib.request.urlopen) -> bytes:
    request = urllib.request.Request(CDN + location, headers={"User-Agent": "Kitsune"})
    with opener(request, timeout=30) as response:
        body = response.read(min(size, MAX_DOWNLOAD) + 1)
    if len(body) != size or hashlib.sha256(body).hexdigest() != digest:
        raise ValueError("La imagen descargada no coincide con el catálogo")
    return body


def solid(color: str):
    from PIL import Image
    image = Image.new("RGB", (64, 40), color)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return media.background_from_bytes(output.getvalue(), "PNG", thumbnail=THUMBNAIL)


def private_write(path: Path, data: bytes):
    descriptor, temporary = tempfile.mkstemp(prefix=".wallpaper-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(data)
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def sync(library: Path, engine: Path, opener=urllib.request.urlopen, log=print):
    """Bring the library in line with the active engine's catalog. Returns the index."""
    library.mkdir(mode=0o700, parents=True, exist_ok=True)
    if library.is_symlink():
        raise ValueError("La carpeta de fondos no es válida")
    previous = {}
    with contextlib.suppress(OSError, ValueError, KeyError, TypeError):
        for category in json.loads((library / "index.json").read_text())["categories"]:
            for item in category["items"]:
                previous[item["id"]] = item
    entries = read_catalog(engine)
    categories, failed = [], 0
    for key, name in CATEGORIES:
        items = []
        chosen = [e for e in entries if isinstance(e, dict) and e.get("category") == key and e.get("visible", True) is not False]
        chosen.sort(key=lambda e: (e.get("order", 0) if isinstance(e.get("order"), int) else 0, str(e.get("title"))))
        for entry in chosen:
            identifier = entry.get("id")
            if not isinstance(identifier, str) or not IDENTIFIER.fullmatch(identifier):
                continue
            color = entry.get("solid_color")
            attachment = entry.get("attachment")
            if isinstance(color, str) and COLOR.fullmatch(color):
                source = "color:" + color.lower()
            elif (isinstance(attachment, dict) and isinstance(attachment.get("location"), str)
                  and LOCATION.fullmatch(attachment["location"]) and ".." not in attachment["location"]
                  and isinstance(attachment.get("hash"), str) and re.fullmatch(r"[0-9a-f]{64}", attachment["hash"])
                  and type(attachment.get("size")) is int and 0 < attachment["size"] <= MAX_DOWNLOAD
                  and attachment.get("mimetype") in FORMATS):
                source = attachment["hash"]
            else:
                continue
            item = {"id": identifier, "source": source, "credit": credit(entry)}
            if color:
                item["color"] = color.lower()
            full, thumb = library / f"{identifier}.jpg", library / f"{identifier}-thumb.jpg"
            old = previous.get(identifier)
            if old and old.get("source") == source and full.is_file() and thumb.is_file():
                items.append({**item, "sha256": old["sha256"]})
                continue
            try:
                if color:
                    digest, jpeg, small = solid(color)
                else:
                    body = download(attachment["location"], attachment["size"], attachment["hash"], opener)
                    digest, jpeg, small = media.background_from_bytes(body, FORMATS[attachment["mimetype"]], thumbnail=THUMBNAIL)
                private_write(full, jpeg)
                private_write(thumb, small)
            except (OSError, ValueError) as error:
                failed += 1
                log(f"No se pudo preparar un fondo de «{name}»: {type(error).__name__}")
                continue
            items.append({**item, "sha256": digest})
        if items:
            categories.append({"id": key, "name": name, "items": items})
    index = {"version": 1, "categories": categories}
    private_write(library / "index.json", json.dumps(index, ensure_ascii=False, indent=1).encode())
    keep = {"index.json"} | {f"{i['id']}{suffix}.jpg" for c in categories for i in c["items"] for suffix in ("", "-thumb")}
    for path in library.iterdir():
        if path.name not in keep and path.is_file() and not path.is_symlink():
            path.unlink()
    total = sum(len(c["items"]) for c in categories)
    log(f"Fondos de serie listos: {total}" + (f" ({failed} no se pudieron descargar)" if failed else ""))
    return index


def main():
    library, engine = default_roots()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("sync",))
    parser.add_argument("--library", type=Path, default=library)
    parser.add_argument("--engine", type=Path, default=engine)
    options = parser.parse_args()
    sync(options.library, options.engine.resolve(strict=True))


if __name__ == "__main__":
    main()
