#!/usr/bin/env python3
"""Banner e imagen de Kitsune para Nori (y donde haga falta): papel y tinta.

Banner de 1600×400: a la izquierda, papel con el ensō, «kitsune» y el lema; a la
derecha, tinta sumi que entra con el borde deshilachado de la veta del cambio de
tema (tools/veta/generate.py) y el zorrito saludando. Imagen de 256×256: el ensō
sobre papel. `python3 tools/branding/banner.py` escribe install/branding/banner.webp
e install/branding/proyecto.webp. Necesita rsvg-convert, Pillow y las Noto.
"""
from __future__ import annotations

import importlib.util
import io
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
PAPER, INK, SUMI, RUST, MUTED = "#f6f5f1", "#252d2b", "#161a19", "#963d32", "#59625c"
SERIF = "/usr/share/fonts/noto/NotoSerif-Regular.ttf"
ITALIC = "/usr/share/fonts/noto/NotoSerif-Italic.ttf"
SCALE = 2  # se dibuja al doble y se reduce: bordes suaves

_veta = importlib.util.spec_from_file_location("veta", ROOT / "tools/veta/generate.py")
veta = importlib.util.module_from_spec(_veta)
_veta.loader.exec_module(veta)


def render(svg: Path, width: int) -> Image.Image:
    data = subprocess.run(["rsvg-convert", "-w", str(width), str(svg)], capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(data)).convert("RGBA")


def logo(size: int) -> Image.Image:
    art = render(ROOT / "start/logo-ring.svg", size)
    art.alpha_composite(render(ROOT / "start/logo-mask.svg", size))
    return art


def grain(image: Image.Image, amount: int = 6) -> Image.Image:
    """Grano de papel muy suave, determinista."""
    noise = Image.effect_noise(image.size, 40).convert("L").point(lambda v: 128 + (v - 128) * amount // 40)
    return Image.composite(image, Image.blend(image, Image.merge("RGB", (noise,) * 3), 0.04), Image.new("L", image.size, 200))


def banner() -> Image.Image:
    w, h = 1600 * SCALE, 400 * SCALE
    canvas = Image.new("RGB", (w, h), PAPER)
    draw = ImageDraw.Draw(canvas)
    # El borde de la veta (en la imagen de la veta, 1000 de alto y el borde hacia x≈1460).
    def edge(offset=0.0, cloud=0.0):
        return [(1060 * SCALE + (x - veta.CENTER) * 0.55 * SCALE, y * h / veta.HEIGHT) for x, y in veta._edge(offset, cloud)]
    ink = edge()
    draw.polygon(ink + [(w, h), (w, 0)], fill=SUMI)
    # La banda de tinta justo detrás del borde, más densa y una cola que se pierde.
    band = Image.new("RGBA", (w, h))
    band_draw = ImageDraw.Draw(band)
    for offset, cloud, alpha in ((-0.074, -0.038, 70), (-0.047, -0.025, 150)):
        band_draw.polygon(edge(offset, cloud) + list(reversed(ink)), fill=(7, 7, 8, alpha))
    canvas.paste(band, (0, 0), band.filter(ImageFilter.GaussianBlur(1.2 * SCALE)))
    # Papel: el ensō, la palabra y el lema.
    mark = logo(232 * SCALE)
    canvas.paste(mark, (84 * SCALE, 84 * SCALE), mark)
    word = ImageFont.truetype(SERIF, 112 * SCALE)
    draw.text((342 * SCALE, 92 * SCALE), "kitsune", font=word, fill=INK)
    end = 342 * SCALE + draw.textlength("kitsune", font=word)
    draw.rectangle((end + 10 * SCALE, 196 * SCALE, end + 24 * SCALE, 210 * SCALE), fill=RUST)
    motto = ImageFont.truetype(SERIF, 38 * SCALE)
    motto_italic = ImageFont.truetype(ITALIC, 38 * SCALE)
    x, y = 348 * SCALE, 262 * SCALE
    for text, font, color in (("Navega en papel y ", motto, MUTED), ("tinta", motto_italic, RUST), (".", motto, MUTED)):
        draw.text((x, y), text, font=font, fill=color)
        x += draw.textlength(text, font=font)
    # Tinta: el zorrito saludando y unas chispas de óxido.
    fox = render(ROOT / "install/mascot/hola.svg", 330 * SCALE)
    canvas.paste(fox, (1210 * SCALE, (h - fox.height) // 2 + 12 * SCALE), fox)
    for cx, cy, r in ((1180, 92, 7), (1540, 300, 5), (1505, 70, 4)):
        draw.ellipse(((cx - r) * SCALE, (cy - r) * SCALE, (cx + r) * SCALE, (cy + r) * SCALE), fill="#e0806b")
    return grain(canvas.resize((1600, 400), Image.LANCZOS))


def project_image() -> Image.Image:
    canvas = Image.new("RGB", (256 * SCALE, 256 * SCALE), PAPER)
    mark = logo(216 * SCALE)
    canvas.paste(mark, ((canvas.width - mark.width) // 2, (canvas.height - mark.height) // 2), mark)
    return canvas.resize((256, 256), Image.LANCZOS)


if __name__ == "__main__":
    out = ROOT / "install/branding"
    banner().save(out / "banner.webp", "WEBP", quality=90, method=6)
    project_image().save(out / "proyecto.webp", "WEBP", quality=92, method=6)
    print("escrito install/branding/banner.webp y install/branding/proyecto.webp")
