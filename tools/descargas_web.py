#!/usr/bin/env python3
"""Pone en web/downloads.json una versión ya publicada en GitHub (el último paso de sacar una versión).

Lee los paquetes de esa versión (gh release view) y escribe sus direcciones, su tamaño y su nota
para Windows, macOS y Linux. Se niega con un borrador: sus archivos no son públicos todavía.
Después hay que publicar la web (vercel, desde web/).

    python3 tools/descargas_web.py v0.8.0-beta.1
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
REPO = 'Riscooo/kitsune'
TAG = re.compile(r'v(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?')
SYSTEMS = {
    'windows': ('Windows-x64.exe', 'aún sin firmar'),
    'macos': ('macOS-AppleSilicon.dmg', 'Apple Silicon · aún sin firmar'),
    'linux': ('Linux-x86_64.tar.xz', 'se instala sin sudo'),
}
# Los que una versión puede no traer (las anteriores a la 0.8 no tienen Mac con Intel).
OPTIONAL = {'macos-intel': ('macOS-Intel.dmg', 'Intel · aún sin firmar')}


def label(release):
    """«0.8.0-beta.1» → «0.8 beta 1»; «0.8.1» → «0.8.1» (como releaseLabel del aviso de versión)."""
    major, minor, patch, beta = TAG.fullmatch('v' + release).groups()
    version = f'{major}.{minor}' if patch == '0' else f'{major}.{minor}.{patch}'
    return f'{version} beta {beta}' if beta else version


def downloads(tag, assets):
    """La lista de descargas de una versión a partir de sus archivos ({name, size, url})."""
    if not TAG.fullmatch(tag):
        raise ValueError(f'etiqueta no válida: {tag}')
    release = tag[1:]
    beta = '-beta.' in release
    result = {'version': label(release)}
    for system, (suffix, note) in {**SYSTEMS, **OPTIONAL}.items():
        name = f'Kitsune-{release}-{suffix}'
        asset = next((item for item in assets if item.get('name') == name), None)
        if asset is None and system in OPTIONAL:
            continue
        if asset is None:
            raise ValueError(f'a la versión {tag} le falta {name}')
        url = f'https://github.com/{REPO}/releases/download/{tag}/{name}'
        if asset.get('url') != url:
            raise ValueError(f'{name} no está donde debería: {asset.get("url")}')
        result[system] = {'url': url, 'size': f'{round(asset["size"] / 2 ** 20)} MB',
                          'note': ('Beta · ' if beta else '') + note, 'release': release}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('tag')
    args = parser.parse_args()
    view = subprocess.run(['gh', 'release', 'view', args.tag, '-R', REPO, '--json', 'isDraft,assets'], capture_output=True, text=True)
    if view.returncode != 0:
        print(f'No encuentro la versión {args.tag} en GitHub.', file=sys.stderr)
        return 1
    data = json.loads(view.stdout)
    if data.get('isDraft'):
        print(f'{args.tag} es todavía un borrador: publícala antes en GitHub.', file=sys.stderr)
        return 1
    try:
        listing = downloads(args.tag, data.get('assets', []))
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    (ROOT / 'web/downloads.json').write_text(json.dumps(listing, indent=2, ensure_ascii=False) + '\n')
    print(f'web/downloads.json → Kitsune {listing["version"]}. Falta publicar la web (vercel --prod desde web/).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
