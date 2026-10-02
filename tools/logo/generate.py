#!/usr/bin/env python3
"""Logo de Kitsune 0.5 «Tinta»: ensō de tinta con una máscara kitsune dentro.

Determinista y sin dependencias. La textura de pincel se hornea en la geometría
(ruido de valor fijo), así los SVG no llevan filtros y se ven igual en todas
partes. `python3 tools/logo/generate.py` reescribe los archivos; los tests
comprueban que lo guardado coincide con lo que genera este script.
"""
from __future__ import annotations

import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INK, RUST, PAPER = "#252d2b", "#963d32", "#fbfaf7"
HEAD = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">'

# Ensō «D» (aprobado en el boceto): anillo de pincel y la punta de la cola.
RING = [(150, 64), [(130, 30), (72, 26), (46, 62)], [(20, 98), (34, 152), (82, 168)],
        [(122, 180), (160, 156), (164, 118)], [(166, 98), (152, 86), (136, 92)],
        [(150, 96), (154, 112), (146, 128)], [(134, 152), (98, 160), (72, 144)],
        [(46, 126), (44, 90), (66, 68)], [(88, 46), (126, 48), (142, 72)]]
TIP = [(134, 88), [(126, 70), (140, 58), (156, 50)], [(150, 66), (150, 78), (134, 88)]]


def _hash(ix: int, iy: int, seed: int) -> float:
    value = (ix * 374761393 + iy * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    value = ((value ^ (value >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((value ^ (value >> 16)) & 0xFFFF) / 0xFFFF


def _noise(x: float, y: float, seed: int) -> float:
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    top = _hash(ix, iy, seed) + (_hash(ix + 1, iy, seed) - _hash(ix, iy, seed)) * fx
    bottom = _hash(ix, iy + 1, seed) + (_hash(ix + 1, iy + 1, seed) - _hash(ix, iy + 1, seed)) * fx
    return top + (bottom - top) * fy


def _fractal(x: float, y: float, seed: int) -> float:
    total, amplitude, frequency = 0.0, 1.0, 0.045
    for octave in range(3):
        total += amplitude * (_noise(x * frequency, y * frequency, seed + octave) - 0.5)
        amplitude, frequency = amplitude / 2, frequency * 2
    return total


def _brush(shape, scale: float, steps: int = 28) -> str:
    """Curvas de Bézier → polígono con el borde «mordido» del pincel."""
    start, *curves = shape
    points, current = [start], start
    for c1, c2, end in curves:
        for i in range(1, steps + 1):
            t = i / steps
            u = 1 - t
            points.append((u ** 3 * current[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * end[0],
                           u ** 3 * current[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * end[1]))
        current = end
    moved = [(x + _fractal(x, y, 7) * scale, y + _fractal(x, y, 23) * scale) for x, y in points[:-1]]
    return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in moved) + " Z"


RING_SVG = f'<path fill="{INK}" d="{_brush(RING, 5)}"/><path fill="{RUST}" d="{_brush(TIP, 3)}"/>'

# Máscara kitsune «E3»: papel, contorno de tinta y marcas óxido, centrada en el ensō.
MASK_SVG = (f'<g transform="translate(101 104) scale(0.4) translate(-100 -100)" fill="none" stroke-linecap="round" stroke-linejoin="round">'
            f'<path d="M100 178 L62 132 C50 112 48 84 56 52 L66 24 L92 58 L108 58 L134 24 L144 52 C152 84 150 112 138 132 Z" fill="{PAPER}" stroke="{INK}" stroke-width="12"/>'
            f'<path d="M70 46 L82 64 M130 46 L118 64 M100 72 L100 88" stroke="{RUST}" stroke-width="11"/>'
            f'<path d="M70 102 Q82 92 94 104 M130 102 Q118 92 106 104" stroke="{INK}" stroke-width="10"/>'
            f'<circle cx="100" cy="160" r="10" fill="{INK}"/></g>')

# A 16 y 32 px el contorno fino desaparece: máscara llena de tinta con las orejas óxido.
# Anillo y máscara van por separado para el indicador de carga de las pestañas.
SMALL_RING_SVG = f'<path fill="{INK}" d="{_brush(RING, 3)}"/><path fill="{RUST}" d="{_brush(TIP, 2)}"/>'
SMALL_MASK_SVG = (f'<g transform="translate(101 104) scale(0.46) translate(-100 -100)">'
                  f'<path d="M100 178 L62 132 C50 112 48 84 56 52 L66 24 L92 58 L108 58 L134 24 L144 52 C152 84 150 112 138 132 Z" fill="{INK}"/>'
                  f'<path d="M70 46 L82 64 M130 46 L118 64" stroke="{RUST}" stroke-width="14" stroke-linecap="round"/></g>')
SMALL_SVG = SMALL_RING_SVG + SMALL_MASK_SVG


def _stroke() -> bytes:
    """Trazo óxido de pincel (200×8) para la pestaña activa: se afila en los extremos."""
    top, bottom = [], []
    for i in range(41):
        x = i * 5
        taper = min(1.0, x / 18, (200 - x) / 18)
        half = 2.6 * taper + 0.4
        wobble = _fractal(x * 3, 11, 31) * 1.6
        top.append((x, 4 - half + wobble))
        bottom.append((x, 4 + half + wobble + _fractal(x * 3, 29, 47) * 0.8))
    points = top + bottom[::-1]
    d = "M" + " L".join(f"{x:.1f} {min(8.0, max(0.0, y)):.2f}" for x, y in points) + " Z"
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="8" viewBox="0 0 200 8" preserveAspectRatio="none">'
            f'<path fill="{RUST}" d="{d}"/></svg>\n').encode()


WORDMARK = ('<svg xmlns="http://www.w3.org/2000/svg" width="336" height="72" viewBox="0 0 336 72">'
            f'<text x="2" y="54" fill="{INK}" font-family="Noto Serif, serif" font-size="56" letter-spacing="3">kitsune</text>'
            f'<rect x="226" y="42" width="11" height="11" rx="1" fill="{RUST}"/></svg>\n')


def _svg(body: str) -> bytes:
    return f"{HEAD}{body}</svg>\n".encode()


def build() -> dict[str, bytes]:
    full = _svg(RING_SVG + MASK_SVG)
    small = _svg(SMALL_SVG)
    return {
        "chrome/assets/kitsune.svg": full,
        "chrome/assets/kitsune-ring.svg": _svg(RING_SVG),
        "chrome/assets/kitsune-mask.svg": _svg(MASK_SVG),
        "start/logo.svg": full,
        "install/branding/icon-small.svg": small,
        "start/favicon.svg": small,
        "install/branding/wordmark.svg": WORDMARK.encode(),
        "chrome/assets/kitsune-throbber-ring.svg": _svg(SMALL_RING_SVG),
        "chrome/assets/kitsune-throbber-mask.svg": _svg(SMALL_MASK_SVG),
        "chrome/assets/kitsune-stroke.svg": _stroke(),
    }


if __name__ == "__main__":
    for relative, content in build().items():
        (ROOT / relative).write_bytes(content)
        print("escrito", relative)
