"""Kitsune Zero · pantalla completa, extensiones y permisos, en el motor real (perfil temporal, sin ventana en pantalla).

1. Un vídeo (o cualquier cosa) a pantalla completa ocupa toda la ventana: sin márgenes de tarjeta,
   sin esquinas redondas, y sin la isla, el raíl, la marca ni los botones encima.
2. Al salir, Zero vuelve como estaba.
3. Con F11 (pantalla completa del navegador), igual.
4. La isla abierta lleva el botón de las extensiones (sus ventanas se pueden abrir).
5. Un aviso de permiso (la ubicación) sale abierto y colocado bajo la isla, no en una esquina.

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


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(b'<!doctype html><meta charset=utf-8><title>Video</title><body style="margin:0">'
                         b'<div id=v style="width:400px;height:220px;background:#123"></div>'
                         b'<button id=b onclick="document.getElementById(\'v\').requestFullscreen()">Pantalla completa</button>'
                         b'<button id=g onclick="navigator.geolocation.getCurrentPosition(() => {}, () => {})">Donde estoy</button>')

    def log_message(self, *args):
        pass


LOOK = """
// A la vista de verdad: dentro de la ventana y con la opacidad de sus antepasados.
const seen = id => { const el = document.getElementById(id); if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  let opacity = 1; for (let n = el; n?.nodeType === 1; n = n.parentNode) opacity *= Number(getComputedStyle(n).opacity);
  return r.width > 2 && r.height > 2 && r.bottom > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && opacity > 0.1; };
const p = document.getElementById('tabbrowser-tabpanels').getBoundingClientRect();
const card = gBrowser.selectedBrowser.closest('.browserSidebarContainer');
return { W: innerWidth, H: innerHeight, panels: { x: p.x, y: p.y, w: p.width, h: p.height }, radius: getComputedStyle(card).borderTopLeftRadius,
         dom: document.documentElement.hasAttribute('inDOMFullscreen'), full: !!window.fullScreen,
         island: seen('nav-bar'), rail: seen('zero-rail'), mark: seen('zero-mark'), lights: seen('zero-lights') };
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-completa-'))
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

    def look():
        return chrome(LOOK)

    def until(condition, timeout=6):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {look()}') from None

    def content_click(selector):
        driver.context('content')
        element = driver.command('POST', '/element', {'using': 'css selector', 'value': selector})
        driver.command('POST', f"/element/{list(element.values())[0]}/click", {})

    def covers(l):
        return abs(l['panels']['x']) <= 1 and abs(l['panels']['y']) <= 1 and abs(l['panels']['w'] - l['W']) <= 1 and abs(l['panels']['h'] - l['H']) <= 1

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        # La tarjeta entra con su animación: el «antes» se toma cuando ya está en su sitio.
        until(lambda: (l := look())['island'] and l['rail'] and abs(l['panels']['x'] - 50) <= 0.5 and abs(l['panels']['y'] - 46) <= 0.5 and l['radius'] == '18px')
        before = look()

        content_click('#b')
        until(lambda: (l := look())['dom'] and covers(l) and l['radius'] == '0px' and not any(l[k] for k in ('island', 'rail', 'mark', 'lights')))
        check('Un vídeo a pantalla completa ocupa toda la ventana, sin nada de Zero encima')

        driver.context('content')
        driver.script("document.exitFullscreen()")
        until(lambda: (l := look())['island'] and l['rail'] and not l['dom'] and abs(l['panels']['x'] - before['panels']['x']) <= 1 and l['radius'] == before['radius'])
        check('Al salir, Zero vuelve como estaba')

        chrome("window.fullScreen = true")
        until(lambda: (l := look())['full'] and covers(l) and not any(l[k] for k in ('island', 'rail', 'mark', 'lights')))
        chrome("window.fullScreen = false")
        until(lambda: (l := look())['island'] and not l['full'])
        check('Con F11, igual: toda la ventana, y al salir vuelve')

        driver.context('chrome')
        island = driver.command('POST', '/element', {'using': 'css selector', 'value': '#nav-bar'})
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [{'type': 'pointerMove', 'origin': island, 'x': 0, 'y': 0}]}]})
        until(lambda: chrome("""const b = document.getElementById('unified-extensions-button'); if (!b) return false; const r = b.getBoundingClientRect(); const n = document.getElementById('nav-bar').getBoundingClientRect();
            return r.width > 20 && Number(getComputedStyle(b).opacity) > 0.5 && r.left >= n.left && r.right <= n.right;"""))
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [{'type': 'pointerMove', 'origin': 'viewport', 'x': 700, 'y': 600}]}]})
        check('La isla abierta lleva el botón de las extensiones')

        content_click('#g')
        until(lambda: chrome("return PopupNotifications.panel.state") == 'open', timeout=8)
        place = chrome("""const r = PopupNotifications.panel.getBoundingClientRect(); const n = document.getElementById('nav-bar').getBoundingClientRect();
            return { top: r.top, left: r.left, w: r.width, islandBottom: n.bottom, islandLeft: n.left, islandRight: n.right };""")
        assert place['w'] > 100 and place['top'] >= place['islandBottom'] - 2 and place['top'] < place['islandBottom'] + 80 and place['left'] < place['islandRight'] + 40 and place['left'] + place['w'] > place['islandLeft'] - 40, place
        check('Un aviso de permiso sale abierto y bajo la isla')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
