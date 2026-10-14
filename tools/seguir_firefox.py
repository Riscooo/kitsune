#!/usr/bin/env python3
"""Seguir a Firefox: de un Gecko nuevo a un borrador de versión de Kitsune, sin tocar nada a mano.

Pasos, cada uno en su unidad de systemd con límites (MemoryMax=65 %, sin swap, Nice 19),
uno detrás de otro para no congelar el ordenador:

  1. motor de Linux nuevo (kitsune-engine.py build --version X), que queda activo;
  2. pruebas con ese motor real (las de cada función de Kitsune);
  3. los ajustes de fábrica del Gecko nuevo, comparados con kitsune.cfg (privacy_modes.py):
     si Gecko trae ajustes nuevos sin clasificar, se para para que una persona los revise;
  4. paquete de Linux (.tar.xz), y Windows y macOS compilados desde Linux y revisados por dentro;
  5. con --borrador, un borrador de versión en GitHub con los tres paquetes y sus SHA-256.

Nunca publica: el borrador lo publica una persona (el «visto bueno»). Si se corta (un apagón,
un reinicio), al volver a lanzarlo sigue donde iba: el estado vive en
~/.local/state/kitsune-browser/seguir-firefox.json. La versión que se publica es la de
install/version.json («release»); el borrador se niega si esa versión ya existe en GitHub.

    python3 tools/seguir_firefox.py --plan                # qué haría, sin hacer nada
    python3 tools/seguir_firefox.py                       # el Gecko estable más nuevo
    python3 tools/seguir_firefox.py --version 158.0 --solo linux
    python3 tools/seguir_firefox.py --borrador            # y deja el borrador en GitHub
    python3 tools/seguir_firefox.py --borrador --notas docs/notas/0.8.0-beta.1.md
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / 'install/kitsune-engine.py'
STATE = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state')) / 'kitsune-browser/seguir-firefox.json'
CURRENT = Path.home() / '.local/share/kitsune-browser/engine/current/kitsune'
CACHE = Path.home() / '.cache/kitsune-build'
REPO = 'Riscooo/kitsune'
# Las pruebas con el motor real que deciden si un Gecko nuevo vale (sin ventana; unos 15 min).
TESTS = ('contrast_native', 'theme_native', 'newtab_native', 'vertical_tabs_native', 'spaces_native', 'layout_native',
         'glance_native', 'palette_native', 'saver_native', 'privacy_line_native', 'tintas_native', 'home_integrated_native',
         'privacy_modes_native')
# Si aun así falta memoria, el núcleo mata antes la compilación que las aplicaciones de quien usa el PC.
LIMITS = ['-p', 'MemoryMax=65%', '-p', 'MemorySwapMax=0', '-p', 'Nice=19', '-p', 'IOSchedulingClass=idle', '-p', 'CPUWeight=idle',
          '-p', 'OOMScoreAdjust=900']
ASSETS = {'linux': 'Linux-x86_64.tar.xz', 'windows': 'Windows-x64.exe', 'macos': 'macOS-AppleSilicon.dmg'}


def log(message):
    print(f'[{datetime.datetime.now():%H:%M}] {message}', flush=True)


def load_state(version):
    try:
        state = json.loads(STATE.read_text())
    except (OSError, ValueError):
        state = {}
    return state if state.get('version') == version else {'version': version, 'done': {}}


def save_state(state):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False) + '\n')


def unit(name, command, logfile):
    """Una orden en su unidad de systemd con límites, esperando a que acabe; True si sale bien."""
    with logfile.open('a') as out:
        out.write(f'\n=== {datetime.datetime.now().isoformat(timespec="seconds")} {" ".join(command)}\n')
        out.flush()
        result = subprocess.run(['systemd-run', '--user', '--wait', '--pipe', '--collect', '--quiet', f'--unit=kitsune-seguir-{name}',
                                 f'--working-directory={ROOT}', *LIMITS, *command], stdout=out, stderr=subprocess.STDOUT)
    return result.returncode == 0


def latest():
    return subprocess.run([sys.executable, str(ENGINE), 'check'], capture_output=True, text=True, check=True).stdout.strip()


def release():
    return json.loads((ROOT / 'install/version.json').read_text())['release']


def newest(folder, pattern):
    files = sorted(folder.glob(pattern), key=lambda path: path.stat().st_mtime, reverse=True)
    return files[0] if files else None


def release_notes(template, name, version, sums, day):
    """Las notas del borrador: las de --notas ({release} y {gecko} cambiados) o una línea, y los SHA-256."""
    if template:
        body = template.replace('{release}', name).replace('{gecko}', version).rstrip() + '\n'
    else:
        body = f'Kitsune **{name}** con **Gecko {version}**, el motor de Firefox {version} con sus arreglos de seguridad.\n'
    sha = ''.join(f'- `{file}`: `{digest}`\n' for digest, file in (line.split(maxsplit=1) for line in sums.splitlines() if line.strip()))
    return (f'{body}\n**SHA-256**\n{sha}\nWeb: https://kitsune-navegador.vercel.app\n\n'
            'Kitsune usa Gecko, el motor de código abierto de Mozilla (licencia MPL 2.0), compilado con nuestra receta. '
            f'Todo el código está en este repositorio. Compilado y probado con `tools/seguir_firefox.py` el {day:%d/%m/%Y}.\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--version', help='versión de Gecko (por defecto, la estable más nueva)')
    parser.add_argument('--solo', choices=('linux', 'windows', 'macos'), action='append', help='solo esos sistemas')
    parser.add_argument('--borrador', action='store_true', help='deja un borrador de versión en GitHub (nunca publica)')
    parser.add_argument('--notas', type=Path, help='notas de la versión ({release} y {gecko} se cambian); los SHA-256 se añaden solos')
    parser.add_argument('--plan', action='store_true', help='dice qué haría, sin hacer nada')
    parser.add_argument('--desde-cero', action='store_true', help='olvida lo hecho para esta versión')
    args = parser.parse_args()
    version = args.version or latest()
    systems = args.solo or ['linux', 'windows', 'macos']
    name = release()
    if args.notas and not args.notas.is_file():
        parser.error(f'no existe {args.notas}')
    state = load_state(version)
    if args.desde_cero:
        state = {'version': version, 'done': {}}
    steps = ['motor'] + (['pruebas', 'ajustes'] if 'linux' in systems else []) + [f'paquete-{system}' for system in systems] + (['borrador'] if args.borrador else [])
    log(f'Gecko {version} → Kitsune {name} · sistemas: {", ".join(systems)}')
    for step in steps:
        log(f"  {'hecho ' if step in state['done'] else 'falta '} {step}")
    if args.plan:
        return 0
    logfile = Path(tempfile.gettempdir()) / f'kitsune-seguir-{version}.log'
    log(f'Registro: {logfile}')

    def finish(step, **extra):
        state['done'][step] = {'at': datetime.datetime.now().isoformat(timespec='seconds'), **extra}
        save_state(state)

    def stop(message):
        log(f'PARADO: {message} (registro: {logfile})')
        subprocess.run(['notify-send', '-a', 'Kitsune', 'Kitsune: seguir a Firefox se ha parado', message], check=False)
        return 1

    if 'motor' not in state['done']:
        log('Compilando el motor de Linux (puede tardar horas la primera vez)…')
        if not unit('motor', [sys.executable, str(ENGINE), 'build', '--version', version], logfile):
            return stop(f'no se ha podido compilar Gecko {version} para Linux')
        finish('motor', engine=os.path.realpath(CURRENT))
    if 'linux' in systems and 'pruebas' not in state['done']:
        failed = []
        for test in TESTS:
            log(f'Prueba {test}…')
            if not unit(f'prueba-{test.replace("_", "-")}', [sys.executable, f'tests/{test}.py'], logfile):
                failed.append(test)
        if failed:
            return stop(f'fallan con Gecko {version}: {", ".join(failed)}')
        finish('pruebas', tests=list(TESTS))
    if 'linux' in systems and 'ajustes' not in state['done']:
        factory = Path(tempfile.gettempdir()) / f'kitsune-fabrica-{version}.json'
        log('Ajustes de fábrica del Gecko nuevo…')
        if not unit('ajustes', [sys.executable, 'tools/pref_audit.py', '--factory', '--browser', str(CURRENT), '--output', str(factory)], logfile):
            return stop('no se han podido medir los ajustes de fábrica')
        check = subprocess.run([sys.executable, 'tools/privacy_modes.py', '--factory', str(factory), '--check'], cwd=ROOT, capture_output=True, text=True)
        if check.returncode != 0:
            return stop('Gecko trae ajustes nuevos que hay que clasificar en tools/privacy_modes.py: ' + check.stderr.strip()[:300])
        finish('ajustes')
    out = CACHE / 'packages'
    for system in systems:
        step = f'paquete-{system}'
        if step in state['done']:
            continue
        log(f'Paquete para {system}…')
        if system == 'linux':
            ok = unit('paquete-linux', [sys.executable, str(ENGINE), 'package-linux', '--version', version], logfile)
            file = newest(out / 'linux', f'Kitsune-{name}-Linux-x86_64.tar.xz')
        else:
            ok = unit(f'paquete-{system}', [sys.executable, str(ENGINE), 'build', '--version', version, '--target', system], logfile)
            file = newest(out / system, '*.installer.exe' if system == 'windows' else '*.dmg')
            if ok and file:
                tool = 'tools/inspect_windows_installer.py' if system == 'windows' else 'tools/inspect_macos_dmg.py'
                ok = subprocess.run([sys.executable, tool, str(file)], cwd=ROOT, stdout=logfile.open('a'), stderr=subprocess.STDOUT).returncode == 0
        if not ok or not file:
            return stop(f'no se ha podido hacer el paquete de {system}')
        finish(step, file=str(file))
    if args.borrador and 'borrador' not in state['done']:
        tag = f'v{name}'
        if subprocess.run(['gh', 'release', 'view', tag, '-R', REPO], capture_output=True).returncode == 0:
            return stop(f'la versión {tag} ya existe: sube «release» en install/version.json antes')
        folder = Path(tempfile.mkdtemp(prefix='kitsune-version-'))
        files = []
        for system in systems:
            target = folder / f'Kitsune-{name}-{ASSETS[system]}'
            shutil.copyfile(state['done'][f'paquete-{system}']['file'], target)
            files.append(target)
        sums = folder / 'SHA256SUMS.txt'
        sums.write_text(''.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n' for path in files))
        notes = folder / 'notas.md'
        notes.write_text(release_notes(args.notas.read_text() if args.notas else None, name, version, sums.read_text(), datetime.date.today()))
        created = subprocess.run(['gh', 'release', 'create', tag, '-R', REPO, '--draft', '--prerelease', '--title',
                                  f'Kitsune {name} · Gecko {version}', '--notes-file', str(notes), *map(str, files), str(sums)],
                                 capture_output=True, text=True)
        if created.returncode != 0:
            return stop('no se ha podido crear el borrador: ' + created.stderr.strip()[:300])
        finish('borrador', url=created.stdout.strip())
        log(f'Borrador listo: {created.stdout.strip()}')
    log('Hecho.')
    subprocess.run(['notify-send', '-a', 'Kitsune', 'Kitsune: seguir a Firefox', f'Gecko {version} listo para Kitsune {name}.'], check=False)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
