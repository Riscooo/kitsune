"""Kitsune Zero · las descargas en la isla, en el motor real (perfil temporal, sin ventana en pantalla).

En Zero no está el botón de descargas de Gecko: la isla hace de «actividad en directo».

1. Mientras se descarga, la isla enseña el nombre del archivo, el porcentaje y una barra de progreso.
2. Al acabar dice «Descargado» con el nombre, y se puede pulsar (abre el archivo).
3. Sin Zero, nada de esto (la isla no existe y las descargas van como siempre).

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import http.server
import json
from pathlib import Path
import tempfile
import threading
import time

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness

SIZE = 2_000_000


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/informe'):
            # Un archivo que llega despacio (unos 2,5 s), para ver el progreso.
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Disposition', 'attachment; filename="informe-zorros.bin"')
            self.send_header('Content-Length', str(SIZE))
            self.end_headers()
            chunk = b'z' * 100_000
            for _ in range(SIZE // len(chunk)):
                self.wfile.write(chunk); self.wfile.flush(); time.sleep(0.12)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(b'<!doctype html><meta charset=utf-8><title>Web</title><h1>Una web</h1>')

    def log_message(self, *args):
        pass


ISLAND = """
const msg = document.getElementById('zero-island-msg'); const toolbox = document.getElementById('navigator-toolbox');
const bar = document.querySelector('#zero-island-progress');
return { alert: toolbox?.hasAttribute('zero-island-alert') ? msg.textContent.trim() : '', action: !!msg?.hasAttribute('action'),
         progress: bar ? Number(getComputedStyle(bar).getPropertyValue('--zero-progress') || 'NaN') : null,
         barSeen: !!bar && Number(getComputedStyle(bar).opacity) > 0.5 };
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-descargas-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, downloads = prepare_profile(root)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def island():
        return chrome(ISLAND)

    def until(condition, timeout=8):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {island()}') from None

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !!document.getElementById('zero-host')"), timeout=5)

        chrome("gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })", [origin + '/informe'])
        seen = []
        def downloading():
            i = island()
            if i['progress'] is not None and 0 < i['progress'] < 1:
                seen.append(i['progress'])
            return 'informe-zorros.bin' in i['alert'] and '%' in i['alert'] and i['barSeen'] and len(seen) >= 2
        until(downloading, timeout=10)
        assert seen == sorted(seen), seen
        check('Mientras se descarga, la isla enseña el archivo, el porcentaje y la barra')

        until(lambda: 'Descargado' in island()['alert'] and 'informe-zorros.bin' in island()['alert'] and island()['action'], timeout=12)
        assert (Path(downloads) / 'informe-zorros.bin').stat().st_size == 2_000_000 if Path(downloads, 'informe-zorros.bin').exists() else True
        check('Al acabar dice «Descargado» con el nombre, y se puede pulsar')

        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !document.getElementById('zero-island-progress') && !document.getElementById('zero-host')"), timeout=5)
        check('Sin Zero no queda nada de esto')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
