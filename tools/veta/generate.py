#!/usr/bin/env python3
"""La veta de tinta del cambio de tema, como en Hakufu e InkShadow (world-reveal).

Dos imágenes, tres veces más anchas que la pantalla: la máscara que va tapando
la foto del tema viejo y la banda de tinta que va justo detrás del borde. El
borde es diagonal, ondulado y deshilachado, con el mismo ruido de valor que el
shader. Cada una, en las dos direcciones (hacia la derecha al pasar a Oscuro,
hacia la izquierda al pasar a Claro). `python3 tools/veta/generate.py` reescribe
start/veta-*.svg; los tests comprueban que coincide con lo guardado.
"""
from __future__ import annotations

import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WIDTH, HEIGHT, ROWS = 3000, 1000, 160
CENTER = 1460  # el borde, en unidades de la imagen (1000 = una pantalla)
INK = "#070708"


def _hash(n: float) -> float:
    value = math.sin(n * 127.1) * 43758.5453
    return value - math.floor(value)


def _noise(x: float) -> float:
    i = math.floor(x)
    f = x - i
    f = f * f * (3 - 2 * f)
    return _hash(i) + (_hash(i + 1) - _hash(i)) * f


def _edge(offset: float = 0.0, cloud_scale: float = 0.0):
    """Puntos del borde de arriba abajo: la forma del shader de Hakufu en 1D."""
    points = []
    for row in range(ROWS + 1):
        v = row / ROWS
        cloud = _noise(v * 14)
        g = (0.035 * math.sin(v * 5.6) - 0.13 * v + 0.070 * (cloud - 0.5)
             + 0.014 * (_noise(v * 38 + 31) - 0.5) + 0.004 * (_noise(v * 140 + 57) - 0.5))
        x = CENTER - 1000 * (g + offset + cloud_scale * cloud)
        points.append((round(x, 1), round(v * HEIGHT, 1)))
    return points


def _band(left, right) -> str:
    path = "M" + " L".join(f"{x} {y}" for x, y in left)
    path += " L" + " L".join(f"{x} {y}" for x, y in reversed(right)) + " Z"
    return path


def _mirror(points):
    return [(round(WIDTH - x, 1), y) for x, y in points]


def _svg(body: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" '
            f'viewBox="0 0 {WIDTH} {HEIGHT}" preserveAspectRatio="none">{body}</svg>\n')


def build() -> dict[str, str]:
    edge = _edge()
    # Banda densa justo detrás del borde y la cola que se pierde hacia atrás.
    dense = _edge(0.047, 0.025)
    tail = _edge(0.074, 0.038)
    files = {}
    for direction, mirror in (("ltr", False), ("rtl", True)):
        flip = _mirror if mirror else (lambda points: points)
        e, d, t = flip(edge), flip(dense), flip(tail)
        # Máscara: opaca donde la veta aún no ha pasado (la foto vieja sigue).
        far = [(WIDTH + 1 if not mirror else -1, 0), (WIDTH + 1 if not mirror else -1, HEIGHT)]
        mask = "M" + " L".join(f"{x} {y}" for x, y in e) + f" L{far[1][0]} {far[1][1]} L{far[0][0]} {far[0][1]} Z"
        files[f"start/veta-mascara-{direction}.svg"] = _svg(f'<path d="{mask}" fill="#000"/>')
        files[f"start/veta-tinta-{direction}.svg"] = _svg(
            f'<path d="{_band(t, e)}" fill="{INK}" opacity="0.55"/><path d="{_band(d, e)}" fill="{INK}" opacity="0.97"/>')
    return files


if __name__ == "__main__":
    for relative, content in build().items():
        (ROOT / relative).write_text(content)
        print("escrito", relative)
