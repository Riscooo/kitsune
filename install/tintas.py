"""Tintas de Kitsune: los temas de color (catálogo en start/tintas.json).

Una tinta es una paleta de los diez tokens de papel (--kb-*) para Claro y otra para
Oscuro. Toda la ventana y el inicio se pintan con esos tokens, así que una tinta cambia
el aspecto entero sin tocar el CSS de Gecko y no se rompe con un Gecko nuevo. Cada tinta
del catálogo tiene que leerse al menos tan bien como Papel (la de serie): lo comprueba
`problems()` y lo exigen las pruebas y tools/tintas.py.
"""
from __future__ import annotations

import json
from pathlib import Path
import re

KEYS = ('bg', 'surface', 'surfaceHigh', 'text', 'muted', 'outline', 'primary', 'primaryContainer', 'secondary', 'tertiary')
ID = re.compile(r'[a-z][a-z0-9-]{1,23}')
COLOR = re.compile(r'#[0-9a-f]{6}')
DEFAULT = 'papel'
# Contrastes mínimos (WCAG): los que cumple Papel en Claro y en Oscuro.
MINIMUMS = {('text', 'bg'): 7, ('text', 'surfaceHigh'): 7, ('muted', 'bg'): 4.5, ('muted', 'surface'): 4.5,
            ('primary', 'bg'): 4.5, ('surface', 'primary'): 4.5, ('secondary', 'bg'): 4.5, ('outline', 'bg'): 1.3}


def _luminance(color):
    channels = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast(a, b):
    light, dark = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (light + 0.05) / (dark + 0.05)


def problems(palette):
    """Las parejas de colores que se leen peor que en Papel ([] si ninguna)."""
    return [f'{a}/{b} {contrast(palette[a], palette[b]):.2f} < {minimum}' for (a, b), minimum in MINIMUMS.items()
            if contrast(palette[a], palette[b]) < minimum]


def negro(palette):
    """Negro absoluto (OLED), como Onyx en Discord o «Lights out» en X: la paleta de Oscuro de una
    tinta con el fondo y las superficies en negro puro. Botones, líneas y selección salen de su
    texto y de su acento, muy apagados; el texto y los acentos son los suyos (sobre negro solo
    ganan contraste). Igual que negroPalette() en install/home-extension/api/core.sys.mjs."""
    def dim(color, amount):
        return '#' + ''.join(f'{int(int(color[i:i + 2], 16) * amount + 0.5):02x}' for i in (1, 3, 5))
    return {**palette, 'bg': '#000000', 'surface': '#000000', 'surfaceHigh': dim(palette['text'], 0.14),
            'outline': dim(palette['text'], 0.26), 'primaryContainer': dim(palette['primary'], 0.26)}


# La forma de una tinta (opcional): las esquinas de pestañas, botones y paneles, y la letra de los
# nombres (pestañas, espacios, títulos). Lo que no diga, como Papel (la primera de cada lista).
FORMA = {'esquinas': ('suaves', 'rectas', 'redondas'), 'letra': ('sans', 'serif')}
DEFAULT_FORMA = {name: options[0] for name, options in FORMA.items()}


def parse_forma(value, tinta_id):
    if value is None:
        return dict(DEFAULT_FORMA)
    if not isinstance(value, dict) or not set(value) <= set(FORMA) or any(value[name] not in FORMA[name] for name in value):
        raise ValueError(f"{tinta_id}: forma no válida (esquinas: {', '.join(FORMA['esquinas'])}; letra: {', '.join(FORMA['letra'])})")
    return {**DEFAULT_FORMA, **value}


def parse(value):
    """El catálogo, comprobado del todo; ValueError si algo no vale."""
    if not isinstance(value, dict) or value.get('version') != 1 or set(value) != {'version', 'tintas'} or not isinstance(value['tintas'], list):
        raise ValueError('Catálogo de tintas no válido')
    catalog = {}
    for tinta in value['tintas']:
        if not isinstance(tinta, dict) or not {'id', 'name', 'author', 'claro', 'oscuro'} <= set(tinta) <= {'id', 'name', 'author', 'claro', 'oscuro', 'forma'}:
            raise ValueError('Tinta no válida')
        if not isinstance(tinta['id'], str) or not ID.fullmatch(tinta['id']) or tinta['id'] in catalog:
            raise ValueError(f"Id de tinta no válido: {tinta.get('id')!r}")
        for field in ('name', 'author'):
            if not isinstance(tinta[field], str) or not 1 <= len(tinta[field]) <= 40 or any(ord(c) < 32 for c in tinta[field]):
                raise ValueError(f"{tinta['id']}: {field} no válido")
        for theme in ('claro', 'oscuro'):
            palette = tinta[theme]
            if not isinstance(palette, dict) or set(palette) != set(KEYS) or any(not isinstance(palette[k], str) or not COLOR.fullmatch(palette[k]) for k in KEYS):
                raise ValueError(f"{tinta['id']}: paleta {theme} no válida")
            bad = problems(palette)
            if bad:
                raise ValueError(f"{tinta['id']} ({theme}) se lee peor que Papel: {', '.join(bad)}")
        catalog[tinta['id']] = {'id': tinta['id'], 'name': tinta['name'], 'author': tinta['author'],
                                'claro': {k: tinta['claro'][k] for k in KEYS}, 'oscuro': {k: tinta['oscuro'][k] for k in KEYS},
                                'forma': parse_forma(tinta.get('forma'), tinta['id'])}
    if DEFAULT not in catalog:
        raise ValueError('Falta la tinta de serie, «papel»')
    return catalog


def catalog_path():
    """start/tintas.json: junto a este archivo una vez instalado, o en la raíz del repositorio."""
    here = Path(__file__).resolve().parent
    for candidate in (here / 'start/tintas.json', here.parent / 'start/tintas.json'):
        if candidate.is_file():
            return candidate
    return here / 'start/tintas.json'


_cache = None


def load():
    """El catálogo instalado (se lee una vez)."""
    global _cache
    if _cache is None:
        _cache = parse(json.loads(catalog_path().read_text()))
    return _cache
