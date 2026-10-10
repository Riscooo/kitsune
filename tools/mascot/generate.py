#!/usr/bin/env python3
"""Mascota de Kitsune: un zorrito kitsune en papel, tinta y óxido.

Mismo trazo que el logo (contornos de tinta redondeados, cara de papel, marcas
de máscara en óxido) en clave chibi. Poses: «guardia» (con escudo), «preocupado»,
«dormido», «hola», solo la «cara» y la «cola». La receta del motor las pone en
lugar de cada ilustración de zorro de Gecko. `python3 tools/mascot/generate.py`
reescribe install/mascot/; los tests comprueban que coincide con lo guardado.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "install/mascot"
INK, RUST, PAPER, BLUSH = "#252d2b", "#963d32", "#fbfaf7", "#e7a99b"
W = 5  # grosor del trazo de tinta, como el del logo


def svg(body: str, view: str = "0 0 240 200") -> str:
    width, height = view.split()[2:]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="{view}" '
            f'fill="none" stroke-linecap="round" stroke-linejoin="round">{body}</svg>\n')


def outline(d: str, fill: str = PAPER, width: float = W) -> str:
    return f'<path d="{d}" fill="{fill}" stroke="{INK}" stroke-width="{width}"/>'


def stroke(d: str, color: str = INK, width: float = W) -> str:
    return f'<path d="{d}" stroke="{color}" stroke-width="{width}"/>'


SHADOW = f'<ellipse cx="116" cy="190" rx="76" ry="6" fill="{INK}" opacity="0.08"/>'
# Cola grande y esponjosa con la punta en óxido, detrás del cuerpo.
TAIL = (outline("M148 184 C198 192 230 156 216 110 C208 82 184 66 166 80 C160 86 162 94 168 96 "
                "C184 100 196 116 192 138 C188 160 170 168 150 162 Z")
        + f'<path d="M216 110 C208 82 184 66 166 80 C160 86 162 94 168 96 C178 98 187 104 192 112 '
          f'C199 108 208 107 216 110 Z" fill="{RUST}"/>'
        + stroke("M216 110 C208 82 184 66 166 80 C160 86 162 94 168 96 C184 100 196 116 192 138"))
BODY = outline("M80 124 C63 142 61 168 69 187 L153 187 C161 168 159 142 142 124 Z")
LEGS = stroke("M98 152 L97 182 M124 152 L125 182", INK, 3.5)
COLLAR = (stroke("M86 138 Q111 152 136 138", RUST, 6) + f'<circle cx="111" cy="150" r="6" fill="#d9a441" stroke="{INK}" stroke-width="2.5"/>'
          + stroke("M108 151 L114 151", INK, 2))
PAWS = outline("M83 186 a13 7.5 0 1 0 26 0 a13 7.5 0 1 0 -26 0 Z") + outline("M113 186 a13 7.5 0 1 0 26 0 a13 7.5 0 1 0 -26 0 Z")
# Orejas grandes de zorro, con la punta un poco redonda y el interior en óxido.
EARS = (outline("M64 72 C60 46 63 24 72 9 C87 19 99 31 107 46 Z") + f'<path d="M73 60 C71 45 72 33 77 23 C86 31 92 38 97 46 Z" fill="{RUST}"/>'
        + outline("M158 72 C162 46 159 24 150 9 C135 19 123 31 115 46 Z") + f'<path d="M149 60 C151 45 150 33 145 23 C136 31 130 38 125 46 Z" fill="{RUST}"/>')
# Cabeza redonda con mofletes de pelo y la barbilla un poco en punta, como la máscara.
HEAD = outline("M111 38 C142 38 163 57 165 81 C166 90 170 95 175 99 C170 103 166 105 163 108 "
               "C158 118 146 128 132 132 C125 134 118 136 111 138 C104 136 97 134 90 132 "
               "C76 128 64 118 59 108 C56 105 52 103 47 99 C52 95 56 90 57 81 C59 57 80 38 111 38 Z")
# Marcas de máscara kitsune: llamas de óxido sobre los ojos y una gota en la frente.
MARKS = (f'<path d="M86 72 C80 68 79 61 84 56 C85 62 89 65 93 67 C92 70 89 72 86 72 Z" fill="{RUST}"/>'
         f'<path d="M136 72 C142 68 143 61 138 56 C137 62 133 65 129 67 C130 70 133 72 136 72 Z" fill="{RUST}"/>'
         f'<path d="M111 66 C107 62 107 57 111 51 C115 57 115 62 111 66 Z" fill="{RUST}"/>')
CHEEKS = (f'<ellipse cx="80" cy="104" rx="9" ry="5.5" fill="{BLUSH}" opacity="0.85"/>'
          f'<ellipse cx="142" cy="104" rx="9" ry="5.5" fill="{BLUSH}" opacity="0.85"/>')
NOSE = f'<ellipse cx="111" cy="107" rx="5.5" ry="4" fill="{INK}"/>'
SMILE = stroke("M102 114 Q106.5 119 111 114 Q115.5 119 120 114", INK, 3.5)
HAPPY_EYES = stroke("M84 92 Q92 82 100 92 M122 92 Q130 82 138 92", INK, 5.5)
SLEEPY_EYES = stroke("M84 90 Q92 97 100 90 M122 90 Q130 97 138 90", INK, 5)
OPEN_EYES = (f'<ellipse cx="92" cy="91" rx="6.5" ry="7.5" fill="{INK}"/><ellipse cx="130" cy="91" rx="6.5" ry="7.5" fill="{INK}"/>'
             f'<circle cx="94.5" cy="88" r="2.4" fill="{PAPER}"/><circle cx="132.5" cy="88" r="2.4" fill="{PAPER}"/>')
WORRIED = stroke("M104 117 Q111 112 118 117", INK, 3.5)
SWEAT = f'<path d="M160 70 C156 76 156 81 160 83 C164 81 164 76 160 70 Z" fill="#9ec3d6" stroke="{INK}" stroke-width="2.5"/>'


def face(eyes: str, mouth: str = SMILE) -> str:
    return EARS + HEAD + MARKS + CHEEKS + eyes + NOSE + mouth


# Escudo pequeño delante, sujeto por las dos patitas, con un visto bueno en óxido.
SHIELD = (outline("M111 138 C121 143 129 143 136 141 C137 160 129 175 111 183 C93 175 85 160 86 141 C93 143 101 143 111 138 Z")
          + stroke("M99 160 L107 168 L123 151", RUST, 6)
          + outline("M83 145 a9 7 0 1 0 18 0 a9 7 0 1 0 -18 0 Z") + outline("M121 145 a9 7 0 1 0 18 0 a9 7 0 1 0 -18 0 Z"))
BANG = (f'<rect x="192" y="16" width="11" height="36" rx="5.5" fill="{RUST}"/>'
        f'<circle cx="197.5" cy="63" r="6" fill="{RUST}"/>')
ZZZ = stroke("M168 36 L182 36 L168 50 L182 50 M190 16 L202 16 L190 28 L202 28", "#8d9389", 3.5)
# Patita levantada saludando.
WAVE = (outline("M136 150 C142 138 146 126 148 116 C149 102 171 98 174 112 C176 124 166 138 156 154 Z")
        + f'<circle cx="157" cy="110" r="2.6" fill="{RUST}"/><circle cx="163" cy="107" r="2.6" fill="{RUST}"/><circle cx="168" cy="112" r="2.6" fill="{RUST}"/>'
        + stroke("M182 96 Q190 104 184 116 M192 88 Q204 104 194 122", RUST, 3.5))
SPARK = f'<path d="M204 36 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4 Z" fill="{RUST}"/>'
HEART = f'<path d="M196 48 C192 40 180 42 182 52 C184 60 196 66 196 66 C196 66 208 60 210 52 C212 42 200 40 196 48 Z" fill="{RUST}"/>'

BASE = SHADOW + TAIL + BODY + LEGS + COLLAR + PAWS
POSES = {
    "guardia": SHADOW + TAIL + BODY + COLLAR + PAWS + face(HAPPY_EYES) + SHIELD + SPARK,
    "preocupado": BASE + face(OPEN_EYES, WORRIED) + SWEAT + BANG,
    "dormido": BASE + face(SLEEPY_EYES, stroke("M106 115 Q111 118 116 115", INK, 3.5)) + ZZZ,
    "hola": BASE + face(HAPPY_EYES) + WAVE + HEART,
}
FACE_VIEW = "40 4 142 140"
TAIL_ONLY = (outline("M16 150 C34 122 84 114 136 110 C176 106 202 82 204 42 C222 74 218 122 174 148 C132 170 58 170 16 150 Z")
             + f'<path d="M204 42 C222 74 218 122 192 138 C192 118 196 98 196 84 C201 72 204 58 204 42 Z" fill="{RUST}"/>'
             + stroke("M204 42 C222 74 218 122 174 148 C132 170 58 170 16 150 C34 122 84 114 136 110 C176 106 202 82 204 42")
             + stroke("M62 142 C98 138 132 132 160 120 M82 154 C116 152 146 144 170 132", INK, 3))


# Icono monocromo de «ventana» (lo usa Gecko en sus menús): marco de ventana y el ensō.
WINDOW_ICON = ('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="14" viewBox="0 0 16 14" '
               'fill="context-fill" fill-opacity="context-fill-opacity">'
               '<path d="M2.5 0h11A2.5 2.5 0 0 1 16 2.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 0 11.5v-9A2.5 2.5 0 0 1 2.5 0z'
               'M2.5 1.25c-.69 0-1.25.56-1.25 1.25V4h13.5V2.5c0-.69-.56-1.25-1.25-1.25zM1.25 5.25v6.25c0 .69.56 1.25 1.25 1.25h11'
               'c.69 0 1.25-.56 1.25-1.25V5.25z"/>'
               '<path d="M8 6.1a3 3 0 1 0 2.8 2l-1.05.42A1.88 1.88 0 1 1 8 7.22z"/></svg>\n')


def build() -> dict[str, str]:
    files = {f"{name}.svg": svg(body) for name, body in POSES.items()}
    files["cara.svg"] = svg(face(HAPPY_EYES), FACE_VIEW)
    files["cola.svg"] = svg(TAIL_ONLY, "0 0 220 170")
    files["ventana.svg"] = WINDOW_ICON
    return files


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, content in build().items():
        (OUT / name).write_text(content)
        print("escrito", f"install/mascot/{name}")
