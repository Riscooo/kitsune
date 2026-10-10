#!/usr/bin/env python3
"""Marca de Kitsune para macOS: iconos .icns y el fondo de la ventana del .dmg.

- firefox.icns (la app) y disk.icns (el disco): el ensō sobre un cuadrado redondeado
  de papel, con la forma y el margen de los iconos de macOS (824 de 1024).
- document.icns: una hoja de papel con el ensō.
- background.png: la ventana del .dmg (720×440 puntos, a doble resolución), con la
  flecha de pincel de Kitsune a Aplicaciones en las posiciones del .DS_Store de Gecko
  (Kitsune en 209,190 y Aplicaciones en 472,190, iconos de 128).
`python3 tools/branding/macos.py` reescribe install/branding/macos/. Necesita
rsvg-convert, Pillow y las Noto.
"""
from __future__ import annotations

import io
import math
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "install/branding/macos"
PAPER, PAPER_LIGHT, EDGE, INK, RUST, MUTED = "#f6f5f1", "#fbfaf7", "#c7cdc4", "#252d2b", "#963d32", "#59625c"
SERIF = "/usr/share/fonts/noto/NotoSerif-Regular.ttf"
ITALIC = "/usr/share/fonts/noto/NotoSerif-Italic.ttf"


def render(svg: Path, width: int) -> Image.Image:
    data = subprocess.run(["rsvg-convert", "-w", str(width), str(svg)], capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(data)).convert("RGBA")


def trimmed_logo(size: int) -> Image.Image:
    """El ensō con el zorro, sin el margen del SVG."""
    art = render(ROOT / "start/logo-ring.svg", 1024)
    art.alpha_composite(render(ROOT / "start/logo-mask.svg", 1024))
    left, top, right, bottom = art.getchannel("A").getbbox()
    side = max(right - left, bottom - top)
    cx, cy = (left + right) // 2, (top + bottom) // 2
    return art.crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)).resize((size, size), Image.LANCZOS)


def squircle(size: int, inset: int, exponent: float = 5.0) -> list[tuple[float, float]]:
    """Contorno de superelipse (la forma de los iconos de macOS)."""
    half = (size - 2 * inset) / 2
    center = size / 2
    points = []
    for step in range(720):
        angle = 2 * math.pi * step / 720
        c, s = math.cos(angle), math.sin(angle)
        x = math.copysign(abs(c) ** (2 / exponent), c) * half
        y = math.copysign(abs(s) ** (2 / exponent), s) * half
        points.append((center + x, center + y))
    return points


def app_icon() -> Image.Image:
    size, scale = 1024, 2
    big = size * scale
    shape = squircle(big, 100 * scale)
    shadow = Image.new("RGBA", (big, big))
    ImageDraw.Draw(shadow).polygon([(x, y + 14 * scale) for x, y in shape], fill=(0, 0, 0, 70))
    icon = Image.new("RGBA", (big, big))
    icon.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18 * scale)))
    plate = Image.new("RGBA", (big, big))
    mask = Image.new("L", (big, big))
    ImageDraw.Draw(mask).polygon(shape, fill=255)
    # Papel con una luz suave arriba.
    gradient = Image.linear_gradient("L").resize((big, big)).point(lambda v: 255 - v // 14)
    paper = Image.merge("RGBA", (gradient.point(lambda v: v * 251 // 255), gradient.point(lambda v: v * 250 // 255),
                                 gradient.point(lambda v: v * 247 // 255), Image.new("L", (big, big), 255)))
    plate.paste(paper, (0, 0), mask)
    ImageDraw.Draw(plate).polygon(shape, outline=EDGE, width=3 * scale)
    icon.alpha_composite(plate)
    icon = icon.resize((size, size), Image.LANCZOS)
    mark = trimmed_logo(560)
    icon.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return icon


def document_icon() -> Image.Image:
    size, scale = 1024, 2
    big = size * scale
    sheet = Image.new("RGBA", (big, big))
    draw = ImageDraw.Draw(sheet)
    left, right, top, bottom, fold = 200 * scale, 824 * scale, 80 * scale, 944 * scale, 190 * scale
    draw.polygon([(left, top), (right - fold, top), (right, top + fold), (right, bottom), (left, bottom)],
                 fill=PAPER_LIGHT, outline=EDGE, width=8 * scale)
    draw.polygon([(right - fold, top), (right - fold, top + fold), (right, top + fold)], fill=EDGE)
    sheet = sheet.resize((size, size), Image.LANCZOS)
    mark = trimmed_logo(420)
    sheet.alpha_composite(mark, ((size - mark.width) // 2, 400))
    return sheet


def icns(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="ICNS")
    return buffer.getvalue()


def dmg_background() -> Image.Image:
    scale = 2
    w, h = 720 * scale, 440 * scale
    canvas = Image.new("RGB", (w, h), PAPER)
    draw = ImageDraw.Draw(canvas)
    # Flecha de pincel de Kitsune (209) a Aplicaciones (472), a la altura de los iconos (190).
    y = 190 * scale
    start, end = 292 * scale, 392 * scale
    stroke = []
    for step in range(101):
        t = step / 100
        x = start + (end - start) * t
        wobble = math.sin(t * math.pi * 1.3) * 3 * scale
        thickness = (2.2 + 4.8 * math.sin(math.pi * min(1, t * 1.15)) ** 0.6) * scale
        stroke.append((x, y + wobble, thickness))
    top = [(x, yy - t) for x, yy, t in stroke]
    bottom = [(x, yy + t) for x, yy, t in reversed(stroke)]
    draw.polygon(top + bottom, fill=INK)
    tip_x, tip_y = end + 4 * scale, y + math.sin(1.3 * math.pi) * 3 * scale
    draw.polygon([(tip_x + 10 * scale, tip_y), (tip_x - 16 * scale, tip_y - 15 * scale), (tip_x - 9 * scale, tip_y),
                  (tip_x - 16 * scale, tip_y + 15 * scale)], fill=INK)
    # Lema abajo y el zorrito saludando en la esquina.
    font = ImageFont.truetype(SERIF, 17 * scale)
    italic = ImageFont.truetype(ITALIC, 17 * scale)
    parts = (("Arrastra ", font, MUTED), ("Kitsune", italic, RUST), (" a Aplicaciones", font, MUTED))
    total = sum(draw.textlength(text, font=f) for text, f, _ in parts)
    x = (w - total) / 2
    for text, f, color in parts:
        draw.text((x, 342 * scale), text, font=f, fill=color)
        x += draw.textlength(text, font=f)
    fox = render(ROOT / "install/mascot/hola.svg", 96 * scale)
    canvas.paste(fox, (w - fox.width - 18 * scale, h - fox.height - 10 * scale), fox)
    return canvas


def build() -> dict[str, bytes]:
    app = app_icon()
    background = io.BytesIO()
    dmg_background().save(background, format="PNG", dpi=(144, 144), optimize=True)
    return {"firefox.icns": icns(app), "disk.icns": icns(app), "document.icns": icns(document_icon()),
            "background.png": background.getvalue()}


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in build().items():
        (OUT / name).write_bytes(data)
        print("escrito", f"install/branding/macos/{name}")
