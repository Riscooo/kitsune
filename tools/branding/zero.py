#!/usr/bin/env python3
"""Marca de Kitsune Zero (el navegador aparte, desde la 0.8 beta 3): sus iconos para Linux, Windows y macOS, a
partir de install/branding-zero/icon.svg (la máscara en el cero de zero/assets, en blanco sobre un cristal ahumado
con el filo de una pompa).

`python3 tools/branding/zero.py` reescribe install/branding-zero/: icon-<n>.png (Linux y la marca), windows/
(firefox.ico, firefox64.ico y los mosaicos del menú Inicio) y macos/ (firefox.icns y disk.icns). Lo demás de la marca
(el instalador, los documentos) es el de Kitsune. Necesita rsvg-convert y Pillow.
"""
from __future__ import annotations

import io
from pathlib import Path
import subprocess

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "install/branding-zero"
ICON = OUT / "icon.svg"
LOGO = ROOT / "zero/assets/zero-logo.svg"
PNG_SIZES = (16, 22, 24, 32, 48, 64, 128, 192, 256, 384)
ICO_SIZES = {"firefox.ico": (16, 20, 24, 32, 40, 48, 64, 256), "firefox64.ico": (16, 32, 48, 64)}


def render(svg: Path, width: int, color: str | None = None) -> Image.Image:
    data = svg.read_text()
    if color:
        data = data.replace("currentColor", color)
    out = subprocess.run(["rsvg-convert", "-w", str(width)], input=data.encode(), capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(out)).convert("RGBA")


def mac_icon() -> Image.Image:
    """La rejilla de los iconos de macOS: 824 de 1024, con una sombra suave debajo."""
    size, art = 1024, 824
    icon = render(ICON, art)
    canvas = Image.new("RGBA", (size, size))
    shadow = Image.new("RGBA", (size, size))
    alpha = icon.getchannel("A").point(lambda v: v * 70 // 255)
    shadow.paste(Image.new("RGBA", icon.size, (0, 0, 0, 255)), ((size - art) // 2, (size - art) // 2 + 14), alpha)
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18)))
    canvas.alpha_composite(icon, ((size - art) // 2, (size - art) // 2))
    return canvas


def tile(size: int) -> Image.Image:
    """El mosaico del menú Inicio: la máscara en el cero en blanco, sobre el fondo del manifiesto."""
    canvas = Image.new("RGBA", (size, size))
    mark = render(LOGO, int(size * 0.5), "#ffffff")
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return canvas


def build() -> dict[str, bytes]:
    files: dict[str, bytes] = {}

    def save(name: str, image: Image.Image, **kwargs) -> None:
        buffer = io.BytesIO()
        image.save(buffer, **kwargs)
        files[name] = buffer.getvalue()

    for size in PNG_SIZES:
        save(f"icon-{size}.png", render(ICON, size), format="PNG", optimize=True)
    for name, sizes in ICO_SIZES.items():
        images = {n: render(ICON, n) for n in sizes}
        buffer = io.BytesIO()
        images[sizes[-1]].save(buffer, format="ICO", sizes=[(n, n) for n in sizes], append_images=[images[n] for n in sizes[:-1]])
        files[f"windows/{name}"] = buffer.getvalue()
    for size, suffix in ((142, "70"), (300, "150")):
        save(f"windows/VisualElements_{suffix}.png", tile(size), format="PNG")
    app = mac_icon()
    save("macos/firefox.icns", app, format="ICNS")
    save("macos/disk.icns", app, format="ICNS")
    return files


def main() -> int:
    for name, data in build().items():
        path = OUT / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    print(f"Marca de Kitsune Zero en {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
