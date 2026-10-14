#!/usr/bin/env python3
"""Comparativa de RAM repetible: los mismos sitios reales en varios navegadores.

Cada navegador arranca con un perfil limpio y temporal, abre las mismas pestañas (las
direcciones van en la línea de órdenes: así funcionan igual Gecko y Chromium), espera a
que se asienten y se suma la PSS (memoria proporcional, la compartida repartida entre los
procesos que la usan) de todos sus procesos, leída de /proc/<pid>/smaps_rollup (Linux).

Kitsune se mide dos veces: normal y con el modo ahorro (su control de apariencia, como lo
escribe «Tu inicio»). Ejemplos:

    python3 tools/ram_benchmark.py --tabs 20
    python3 tools/ram_benchmark.py --tabs 20 --tabs 50 \\
        --browser Zen=/opt/zen/zen --browser Firefox=/usr/lib/firefox/firefox \\
        --browser Chrome=/opt/google/chrome/chrome --out web/ram.json

El resultado es una tabla en Markdown (por la salida) y, con --out, el JSON con el método.
Los números dependen del equipo y de la red: se publican con la fecha, el equipo y el método.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
# Sitios reales y estables (artículos, documentación, código, noticias, vídeo): la lista
# se publica con los resultados para que cualquiera la repita.
SITES = [
    'https://es.wikipedia.org/wiki/Kitsune', 'https://en.wikipedia.org/wiki/Fox', 'https://developer.mozilla.org/es/docs/Web/JavaScript',
    'https://github.com/mozilla-firefox/firefox', 'https://www.youtube.com/', 'https://www.reddit.com/r/firefox/',
    'https://news.ycombinator.com/', 'https://www.bbc.com/news', 'https://elpais.com/', 'https://www.rtve.es/',
    'https://stackoverflow.com/questions', 'https://docs.python.org/3/', 'https://www.openstreetmap.org/', 'https://www.twitch.tv/',
    'https://www.amazon.es/', 'https://www.imdb.com/', 'https://archive.org/', 'https://www.gutenberg.org/', 'https://www.nasa.gov/',
    'https://www.theverge.com/', 'https://es.wikipedia.org/wiki/Navegador_web', 'https://en.wikipedia.org/wiki/Gecko_(software)',
    'https://developer.mozilla.org/es/docs/Web/CSS', 'https://github.com/zen-browser/desktop', 'https://www.marca.com/',
    'https://www.elmundo.es/', 'https://www.lavanguardia.com/', 'https://www.20minutos.es/', 'https://www.xataka.com/',
    'https://www.genbeta.com/', 'https://www.meneame.net/', 'https://www.instructables.com/', 'https://www.goodreads.com/',
    'https://www.allrecipes.com/', 'https://www.duolingo.com/', 'https://www.khanacademy.org/', 'https://www.coursera.org/',
    'https://www.figma.com/', 'https://www.notion.com/', 'https://www.spotify.com/es/', 'https://www.netflix.com/es/',
    'https://www.booking.com/', 'https://www.tripadvisor.es/', 'https://www.idealista.com/', 'https://www.wallapop.com/',
    'https://www.ikea.com/es/es/', 'https://www.decathlon.es/', 'https://www.fnac.es/', 'https://www.pccomponentes.com/',
    'https://www.aemet.es/es/portada',
]


def children_of(root: int) -> list[int]:
    """El proceso y todos sus descendientes (por PPid de /proc)."""
    parents = {}
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / 'stat').read_text()
            parents[int(entry.name)] = int(stat[stat.rindex(')') + 2:].split()[1])
        except (OSError, ValueError):
            continue
    tree, frontier = {root}, [root]
    while frontier:
        current = frontier.pop()
        for pid, parent in parents.items():
            if parent == current and pid not in tree:
                tree.add(pid)
                frontier.append(pid)
    return sorted(tree)


def pss_kib(pid: int) -> int:
    try:
        for line in Path(f'/proc/{pid}/smaps_rollup').read_text().splitlines():
            if line.startswith('Pss:'):
                return int(line.split()[1])
    except OSError:
        pass
    return 0


def kitsune_control(saver: bool, limit_mb: int) -> dict:
    sys.path.insert(0, str(ROOT / 'install'))
    from appearance import PAPEL  # noqa: E402  (la paleta de Claro, de su única fuente)
    value = {'version': 6, 'palette': PAPEL, 'motion': True, 'googleRemember': False, 'theme': 'claro', 'background': None,
             'windowControls': 'izquierda', 'brand': True, 'performance': 'ahorro' if saver else 'normal', 'ramLimit': limit_mb,
             'minimize': True}
    value['fingerprint'] = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
    return value


def launch(name: str, binary: Path, urls: list[str], profile: Path, headless: bool, saver: bool, limit_mb: int):
    env = dict(os.environ)
    if 'chrom' in binary.name.lower() or 'brave' in binary.name.lower() or 'edge' in binary.name.lower():
        command = [str(binary), f'--user-data-dir={profile}', '--no-first-run', '--no-default-browser-check', '--disable-sync']
        if not headless:
            return subprocess.Popen(command + urls, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        # Sin ventana, Chromium solo admite una dirección al arrancar: las demás, por su puerto de depuración.
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        process = subprocess.Popen(command + ['--headless=new', f'--remote-debugging-port={port}', urls[0]], env=env,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        for _ in range(100):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=2).close()
                break
            except OSError:
                time.sleep(0.2)
        for url in urls[1:]:
            request = urllib.request.Request(f'http://127.0.0.1:{port}/json/new?{url}', method='PUT')
            with contextlib.suppress(OSError):
                urllib.request.urlopen(request, timeout=10).close()
        return process
    # Gecko (Kitsune, Firefox, Zen, LibreWolf…): perfil limpio, sin restaurar nada.
    profile.mkdir(parents=True, exist_ok=True)
    (profile / 'user.js').write_text('\n'.join([
        'user_pref("browser.startup.page", 0);', 'user_pref("browser.shell.checkDefaultBrowser", false);',
        'user_pref("browser.aboutwelcome.enabled", false);', 'user_pref("browser.tabs.warnOnClose", false);',
        'user_pref("kitsune.import.offered", true);', 'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    ]) + '\n')
    if name.lower().startswith('kitsune'):
        (profile / 'chrome').mkdir(exist_ok=True)
        (profile / 'chrome/kitsune-appearance.json').write_text(json.dumps(kitsune_control(saver, limit_mb)))
    command = [str(binary), '-no-remote', '-profile', str(profile)] + (['-headless'] if headless else [])
    return subprocess.Popen(command + urls, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def measure(name: str, binary: Path, tabs: int, settle: int, headless: bool, saver: bool = False, limit_mb: int = 2048) -> dict:
    urls = SITES[:tabs]
    with tempfile.TemporaryDirectory(prefix='kitsune-ram-') as folder:
        process = launch(name, binary, urls, Path(folder) / 'perfil', headless, saver, limit_mb)
        samples = []
        try:
            start = time.monotonic()
            while time.monotonic() - start < settle:
                time.sleep(15)
                pids = children_of(process.pid)
                samples.append({'t': round(time.monotonic() - start), 'pssMB': round(sum(map(pss_kib, pids)) / 1024), 'processes': len(pids)})
                print(f'  {name}{" (ahorro)" if saver else ""} {tabs} pestañas · {samples[-1]["t"]} s: {samples[-1]["pssMB"]} MB en {samples[-1]["processes"]} procesos', file=sys.stderr, flush=True)
        finally:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=20)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
    final = samples[-1] if samples else {'pssMB': 0, 'processes': 0}
    return {'browser': name, 'saver': saver, 'tabs': tabs, 'pssMB': final['pssMB'], 'processes': final['processes'], 'samples': samples}


def table(results: list[dict]) -> str:
    lines = ['| Navegador | Pestañas | RAM (PSS) | Procesos |', '|---|---:|---:|---:|']
    for result in sorted(results, key=lambda r: (r['tabs'], r['pssMB'])):
        name = result['browser'] + (' · modo ahorro' if result['saver'] else '')
        lines.append(f"| {name} | {result['tabs']} | {result['pssMB']:,} MB | {result['processes']} |".replace(',', '.'))
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--tabs', type=int, action='append', help='pestañas (se puede repetir; por defecto 20)')
    parser.add_argument('--browser', action='append', default=[], metavar='NOMBRE=RUTA', help='otro navegador a medir')
    parser.add_argument('--kitsune', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--settle', type=int, default=240, help='segundos de espera antes de la medida final (por defecto 240)')
    parser.add_argument('--limit', type=int, default=2048, choices=(1024, 2048, 4096), help='límite de RAM del modo ahorro (MB)')
    parser.add_argument('--headed', action='store_true', help='con ventana (por defecto, sin ella: más repetible)')
    parser.add_argument('--out', type=Path, help='guarda el JSON con resultados y método')
    args = parser.parse_args()
    if platform.system() != 'Linux':
        parser.error('la medida de PSS usa /proc: solo Linux')
    sizes = sorted(set(args.tabs or [20]))
    if max(sizes) > len(SITES):
        parser.error(f'como mucho {len(SITES)} pestañas')
    browsers = [('Kitsune', args.kitsune)]
    for item in args.browser:
        name, _, path = item.partition('=')
        browsers.append((name, Path(path)))
    for name, binary in browsers:
        if not (binary.is_file() and os.access(binary, os.X_OK)) and not shutil.which(str(binary)):
            parser.error(f'{name}: no se encuentra {binary}')
    results = []
    for tabs in sizes:
        for name, binary in browsers:
            results.append(measure(name, binary, tabs, args.settle, not args.headed))
            if name == 'Kitsune':
                results.append(measure(name, binary, tabs, args.settle, not args.headed, saver=True, limit_mb=args.limit))
    report = {
        'date': datetime.date.today().isoformat(), 'machine': {'cpu': platform.processor() or platform.machine(), 'kernel': platform.release(),
        'ramGB': round(os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES') / 1024 ** 3)},
        'method': {'settleSeconds': args.settle, 'headless': not args.headed, 'saverLimitMB': args.limit, 'metric': 'PSS (smaps_rollup), todos los procesos',
                   'sites': SITES[:max(sizes)]},
        'results': results,
    }
    print(table(results))
    if args.out:
        args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()
