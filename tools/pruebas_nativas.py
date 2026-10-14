#!/usr/bin/env python3
"""Todas las pruebas con el motor real (tests/*_native.py), una detrás de otra.

Cada una deja su registro en la carpeta de --registros y, si pasa, se borran los perfiles
temporales que creó en /tmp: /tmp es memoria (tmpfs) y cientos de perfiles de prueba acaban
llenándola. Las que fallan conservan los suyos para mirarlos. Al final, un resumen.

    python3 tools/pruebas_nativas.py                     # todas
    python3 tools/pruebas_nativas.py spaces glance       # solo esas (sin _native)
"""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def temporary_profiles():
    return {path for path in Path(tempfile.gettempdir()).glob('kitsune-*') if path.is_dir() and path.owner() == Path.home().owner()}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('names', nargs='*', help='pruebas (p. ej. spaces); por defecto, todas')
    parser.add_argument('--registros', type=Path, default=Path.home() / '.cache/kitsune-pruebas', help='carpeta de los registros')
    parser.add_argument('--tiempo', type=int, default=900, help='segundos como mucho por prueba')
    args = parser.parse_args()
    tests = sorted((ROOT / 'tests').glob('*_native.py'))
    if args.names:
        wanted = {name.removesuffix('_native') for name in args.names}
        tests = [test for test in tests if test.stem.removesuffix('_native') in wanted]
    args.registros.mkdir(parents=True, exist_ok=True)
    failed = []
    for test in tests:
        before = temporary_profiles()
        log = args.registros / f'{test.stem}.log'
        start = time.monotonic()
        with log.open('w') as out:
            try:
                code = subprocess.run([sys.executable, str(test)], cwd=ROOT / 'tests', stdout=out, stderr=subprocess.STDOUT, timeout=args.tiempo).returncode
            except subprocess.TimeoutExpired:
                code = 'tiempo'
        passed = sum(line.startswith('PASS') for line in log.read_text(errors='replace').splitlines())
        print(f'{"bien " if code == 0 else "FALLA"} {test.stem:28} {passed:2} comprobaciones · {time.monotonic() - start:4.0f} s', flush=True)
        if code == 0:
            for path in temporary_profiles() - before:
                shutil.rmtree(path, ignore_errors=True)
        else:
            failed.append(f'{test.stem} ({log})')
    print(f'\n{len(tests) - len(failed)} de {len(tests)} bien' + (':\nFallan ' + ', '.join(failed) if failed else '.'))
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
