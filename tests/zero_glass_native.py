"""Kitsune Zero · el cristal en vivo sobre la web, en el motor real (perfil temporal, sin ventana en pantalla).

El desenfoque de CSS no ve la web (la pinta otro proceso): cada pieza de cristal que queda encima de
la web lleva detrás un <canvas> con una foto desenfocada de lo que tiene debajo, y su texto pasa a
tinta sobre lo claro y a blanco sobre lo oscuro.

1. Con la web ampliada y una página negra arriba, el cristal de la isla está en su sitio y es oscuro.
2. Tras bajar con la rueda hasta lo blanco, el cristal es claro y la isla pasa a tinta (zero-ink).
3. Sin moverse nada durante 1 s, no se repinta.
4. Con la web en tarjeta, la isla está sobre el marco y no lleva cristal en vivo.
5. Al cerrar una ventana en Zero, su cristal se suelta (no se queda nada de ella).

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

PAGE = ('<!doctype html><meta charset=utf-8><title>Noche y día</title>'
        '<body style="margin:0"><div style="height:1600px;background:#000"></div><div style="height:4000px;background:#fff"></div>')


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(PAGE.encode())

    def log_message(self, *args):
        pass


GLASS = """
const box = el => { const r = el?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null; };
const canvas = document.getElementById('zero-glass-nav-bar');
let light = null;
if (canvas && !canvas.hidden && canvas.width && canvas.height) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { sum += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
  light = n ? sum / n / 255 : null;
}
const { GlassPane } = ChromeUtils.importESModule('chrome://browser/content/zero/zero-glass.sys.mjs');
return { canvas: canvas ? { shown: !canvas.hidden, box: box(canvas) } : null, island: box(document.getElementById('nav-bar')),
         light, ink: document.getElementById('nav-bar').hasAttribute('zero-ink'), repaints: GlassPane.repaints(window),
         full: document.documentElement.hasAttribute('zero-full') };
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-glass-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def glass():
        return chrome(GLASS)

    def until(condition, timeout=5):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {glass()}') from None

    def browser():
        driver.context('chrome')
        return driver.command('POST', '/element', {'using': 'css selector', 'value': '#tabbrowser-tabpanels browser[type="content"][primary="true"]'})

    def wheel(dy):
        # Como una rueda de verdad: pasa por la ventana de Gecko antes de llegar a la web.
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'wheel', 'id': 'rueda', 'actions': [
            {'type': 'scroll', 'origin': browser(), 'x': 0, 'y': 0, 'deltaX': 0, 'deltaY': dy}]}]})

    def placed(g):
        c, i = g['canvas'], g['island']
        return c and c['shown'] and all(abs(c['box'][k] - i[k]) <= 1 for k in 'xywh')

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/noche')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: glass()['canvas'] is not None)
        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        until(lambda: glass()['full'] and placed(glass()) and glass()['light'] is not None and glass()['light'] < 0.25 and not glass()['ink'])
        check('Con la web ampliada y la página negra arriba, el cristal de la isla está en su sitio y es oscuro')

        wheel(2400)
        until(lambda: glass()['light'] is not None and glass()['light'] > 0.75 and glass()['ink'], timeout=8)
        check('Tras bajar con la rueda hasta lo blanco, el cristal es claro y la isla pasa a tinta')

        # El paso a tinta lanza transiciones (420 ms) que también cuentan como movimiento; luego, la
        # cola de 1,5 s. Pasado eso, en un segundo quieto no se repinta nada.
        time.sleep(3)
        before = glass()['repaints']
        time.sleep(1)
        after = glass()['repaints']
        assert after == before, (before, after)
        check('Sin moverse nada durante 1 s, no se repinta')

        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        until(lambda: not glass()['full'] and (glass()['canvas'] is None or not glass()['canvas']['shown']) and not glass()['ink'])
        check('Con la web en tarjeta, la isla está sobre el marco y no lleva cristal en vivo')

        panes = "return ChromeUtils.importESModule('chrome://browser/content/zero/zero-glass.sys.mjs').GlassPane.count()"
        alone = chrome(panes)
        chrome("window.__otra = OpenBrowserWindow();")
        eventually(lambda: chrome("return !!window.__otra.document.getElementById('kitsune-zero-key') && window.__otra.gBrowserInit?.delayedStartupFinished"), timeout=15)
        chrome("window.__otra.document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome(panes) > alone, timeout=5)
        chrome("window.__otra.close(); delete window.__otra;")
        try:
            eventually(lambda: chrome(panes) == alone, timeout=5)
        except AssertionError:
            raise AssertionError(f'quedan {chrome(panes)} piezas; antes {alone}') from None
        check('Al cerrar una ventana en Zero, su cristal se suelta')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
