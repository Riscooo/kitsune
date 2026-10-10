#!/usr/bin/env python3
"""Marca de Kitsune para Windows: iconos .ico, mosaicos del menú Inicio e imágenes
del instalador NSIS, a partir del logo actual (start/logo*.svg) y la mascota.

Sustituyen a los de browser/branding/unofficial, que son genéricos de Mozilla.
`python3 tools/branding/windows.py` reescribe install/branding/windows/; la receta
del motor los copia a la marca. Necesita rsvg-convert y Pillow.
"""
from __future__ import annotations

import io
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "install/branding/windows"
PAPER, PAPER_EDGE, SUMI = (251, 250, 247), (199, 205, 196), (22, 26, 25)
LOGO, LOGO_DARK = ROOT / "start/logo.svg", ROOT / "start/logo-dark.svg"
MASCOT = ROOT / "install/mascot/hola.svg"
# Tamaños de cada .ico, como los de Gecko.
ICO_SIZES = {
    "firefox.ico": (16, 20, 24, 32, 40, 48, 64, 256),
    "firefox64.ico": (16, 32, 48, 64),
    "pbmode.ico": (16, 32, 48, 256),
    "document.ico": (16, 32, 48, 256),
    "document_pdf.ico": (16, 32, 48, 256),
    "newtab.ico": (16, 32),
    "newwindow.ico": (16, 32),
}
TILE_BACKGROUND = "#161a19"


def render(svg: Path, width: int, height: int | None = None) -> Image.Image:
    """SVG a imagen RGBA con rsvg-convert (el mismo trazo que en el navegador)."""
    command = ["rsvg-convert", "-w", str(width)] + (["-h", str(height)] if height else []) + [str(svg)]
    return Image.open(io.BytesIO(subprocess.run(command, capture_output=True, check=True).stdout)).convert("RGBA")


def trimmed(svg: Path, size: int) -> Image.Image:
    """El dibujo sin el margen que trae el SVG, en un cuadrado de lado `size`."""
    big = render(svg, 1024, 1024)
    left, top, right, bottom = big.getchannel("A").getbbox()
    side = max(right - left, bottom - top)
    cx, cy = (left + right) // 2, (top + bottom) // 2
    square = big.crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side))
    return square.resize((size, size), Image.LANCZOS)


def fitted(svg: Path, size: int, pad: float) -> Image.Image:
    """El logo centrado en un cuadrado transparente, con un margen relativo."""
    canvas = Image.new("RGBA", (size, size))
    inner = max(1, round(size * (1 - 2 * pad)))
    canvas.alpha_composite(trimmed(svg, inner), ((size - inner) // 2, (size - inner) // 2))
    return canvas


def disc(size: int, svg: Path, fill) -> Image.Image:
    """Logo sobre un disco: el de la ventana privada va en tinta sumi."""
    canvas = Image.new("RGBA", (size, size))
    scale = 4
    big = Image.new("L", (size * scale, size * scale))
    ImageDraw.Draw(big).ellipse((0, 0, size * scale - 1, size * scale - 1), fill=255)
    canvas.paste(Image.new("RGBA", (size, size), fill), (0, 0), big.resize((size, size), Image.LANCZOS))
    canvas.alpha_composite(fitted(svg, size, 0.17))
    return canvas


def page(size: int) -> Image.Image:
    """Documento: hoja de papel con la esquina doblada y el logo en medio."""
    scale = 4
    s = size * scale
    sheet = Image.new("RGBA", (s, s))
    draw = ImageDraw.Draw(sheet)
    left, right, top, bottom, fold = s * .17, s * .83, s * .06, s * .94, s * .2
    outline = max(scale, round(s * .025))
    draw.polygon([(left, top), (right - fold, top), (right, top + fold), (right, bottom), (left, bottom)],
                 fill=PAPER + (255,), outline=PAPER_EDGE + (255,), width=outline)
    draw.polygon([(right - fold, top), (right - fold, top + fold), (right, top + fold)],
                 fill=PAPER_EDGE + (255,))
    sheet = sheet.resize((size, size), Image.LANCZOS)
    mark = round(size * .44)
    sheet.alpha_composite(trimmed(LOGO, mark), ((size - mark) // 2, round(size * .42)))
    return sheet


def bitmap(size, draw_into) -> Image.Image:
    canvas = Image.new("RGB", size, PAPER)
    draw_into(canvas)
    return canvas


def build() -> dict[str, bytes]:
    files: dict[str, bytes] = {}

    def save(name: str, image: Image.Image, **kwargs) -> None:
        buffer = io.BytesIO()
        image.save(buffer, **kwargs)
        files[name] = buffer.getvalue()

    makers = {
        "firefox.ico": lambda n: fitted(LOGO, n, 0.0 if n <= 32 else 0.04),
        "firefox64.ico": lambda n: fitted(LOGO, n, 0.0 if n <= 32 else 0.04),
        "pbmode.ico": lambda n: disc(n, LOGO_DARK, SUMI),
        "document.ico": page,
        "document_pdf.ico": page,
        "newtab.ico": lambda n: fitted(LOGO, n, 0.0),
        "newwindow.ico": lambda n: fitted(LOGO, n, 0.0),
    }
    for name, sizes in ICO_SIZES.items():
        buffer = io.BytesIO()
        images = {n: makers[name](n) for n in sizes}
        largest = images[sizes[-1]]
        largest.save(buffer, format="ICO", sizes=[(n, n) for n in sizes], append_images=[images[n] for n in sizes[:-1]])
        files[name] = buffer.getvalue()
    # Mosaicos del menú Inicio, sobre el fondo sumi del manifiesto.
    for size, suffix in ((142, "70"), (300, "150")):
        save(f"VisualElements_{suffix}.png", fitted(LOGO_DARK, size, 0.26), format="PNG")
        save(f"PrivateBrowsing_{suffix}.png", fitted(LOGO_DARK, size, 0.26), format="PNG")

    # Instalador: cabecera (logo a la derecha, o a la izquierda en RTL) y la franja
    # de bienvenida con el ensō arriba y el zorrito saludando abajo.
    def header(rtl: bool):
        def draw_into(canvas):
            mark = trimmed(LOGO, 40)
            canvas.paste(mark, (9 if rtl else 150 - 49, 8), mark)
        return draw_into

    def watermark(canvas):
        mark = trimmed(LOGO, 92)
        canvas.paste(mark, ((164 - 92) // 2, 44), mark)
        fox = render(MASCOT, 140)
        canvas.paste(fox, ((164 - fox.width) // 2, 314 - fox.height - 14), fox)
        ImageDraw.Draw(canvas).line((163, 0, 163, 313), fill=PAPER_EDGE)

    save("wizHeader.bmp", bitmap((150, 57), header(False)), format="BMP")
    save("wizHeaderRTL.bmp", bitmap((150, 57), header(True)), format="BMP")
    save("wizWatermark.bmp", bitmap((164, 314), watermark), format="BMP")
    manifest = (ROOT / "install/branding/windows-manifest.xml.in").read_text().replace("@BACKGROUND@", TILE_BACKGROUND)
    files["firefox.VisualElementsManifest.xml"] = manifest.encode()
    files["private_browsing.VisualElementsManifest.xml"] = manifest.replace("VisualElements_", "PrivateBrowsing_").encode()
    return files


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, content in build().items():
        (OUT / name).write_bytes(content)
        print("escrito", f"install/branding/windows/{name}")
