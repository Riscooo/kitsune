#!/usr/bin/env python3
"""Comprueba el catálogo de tintas (start/tintas.json) y lo copia al inicio integrado.

El catálogo se valida entero: forma, ids, colores y que cada tinta se lea al menos tan bien
como Papel en Claro y en Oscuro (install/tintas.py). Después se escribe, tal cual, en el
bloque generado de install/home-extension/api/core.sys.mjs, que es lo que usa el inicio de
Windows y macOS (sin servidor). Con --check solo comprueba que esté al día.

    python3 tools/tintas.py            # valida y regenera
    python3 tools/tintas.py --check    # falla si core.sys.mjs no coincide con el catálogo
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / 'install/home-extension/api/core.sys.mjs'
BEGIN, END = '// @@KITSUNE_TINTAS_BEGIN@@', '// @@KITSUNE_TINTAS_END@@'
spec = importlib.util.spec_from_file_location('kitsune_tintas', ROOT / 'install/tintas.py')
tintas = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tintas)


def render(catalog):
    body = json.dumps(list(catalog.values()), ensure_ascii=False, indent=2)
    return f"{BEGIN}\n// Generado por tools/tintas.py desde start/tintas.json. No editar.\nexport const TINTAS = Object.freeze({body})\n{END}"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        catalog = tintas.parse(json.loads((ROOT / 'start/tintas.json').read_text()))
    except ValueError as error:
        print(f'tintas.json: {error}', file=sys.stderr)
        return 1
    block, text = render(catalog), CORE.read_text()
    if args.check:
        if block not in text:
            print('core.sys.mjs no está al día con start/tintas.json: ejecuta tools/tintas.py', file=sys.stderr)
            return 1
        return 0
    if BEGIN in text:
        start, end = text.index(BEGIN), text.index(END) + len(END)
        text = text[:start] + block + text[end:]
    else:
        text = text.rstrip('\n') + '\n\n' + block + '\n'
    CORE.write_text(text)
    print(f'{len(catalog)} tintas')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
