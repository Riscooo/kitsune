"""Kitsune Zero · la isla (la barra de menú), en el motor real (perfil temporal, sin ventana en pantalla).

1. En reposo mide 176 × 32 y enseña solo el dominio de la página.
2. Con el ratón encima se abre a 400 × 32 con atrás, adelante y recargar.
3. Escribiendo (foco en la barra de direcciones) mide 560 × 32, y las sugerencias se abren y se leen.
4. Nunca baja: su borde inferior queda al menos 4 px por encima de la tarjeta en todos los estados.
5. Las pestañas de arriba y la barra de marcadores de Gecko no se ven.
6. Un aviso la ensancha a 470 × 32 un momento y vuelve a reposo.
7. Con un menú suyo abierto (el de Kitsune) sigue abierta aunque el ratón se vaya, y se cierra con él.
8. Las sugerencias salen debajo de la isla, centradas con ella y de su mismo ancho.

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
        self.wfile.write(b'<!doctype html><meta charset=utf-8><title>Kioto</title><h1>Los zorros de Kioto</h1>')

    def log_message(self, *args):
        pass


ISLAND = """
const box = el => { const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
// A la vista: con sus antepasados (la opacidad se multiplica y un padre estrecho que recorta lo tapa).
const shown = id => {
  const el = document.getElementById(id); if (!el) return false;
  const r = el.getBoundingClientRect(); let left = r.left, right = r.right, opacity = 1;
  if (getComputedStyle(el).visibility === 'hidden') return false;
  for (let node = el; node?.nodeType === 1; node = node.parentNode) {
    const cs = getComputedStyle(node); opacity *= Number(cs.opacity);
    if (node !== el && cs.overflowX !== 'visible') { const p = node.getBoundingClientRect(); left = Math.max(left, p.left); right = Math.min(right, p.right); }
  }
  return right - left > 4 && r.height > 4 && opacity > 0.3; // atrás y adelante sin historial van atenuados (0,4), y se ven
};
const toolbox = document.getElementById('navigator-toolbox');
return {
  island: box(document.getElementById('nav-bar')), card: box(document.getElementById('tabbrowser-tabpanels')),
  host: document.getElementById('zero-host')?.textContent ?? null,
  state: toolbox.getAttribute('zero-island') ?? '',
  back: shown('back-button'), forward: shown('forward-button'), reload: shown('reload-button'),
  tabs: box(document.getElementById('TabsToolbar'))?.h ?? 0, bookmarks: box(document.getElementById('PersonalToolbar'))?.h ?? 0,
  results: gURLBar.view.isOpen ? box(gURLBar.view.panel) : null, W: innerWidth,
};
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-island-'))
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

    def island():
        return chrome(ISLAND)

    def sized(w, h=32, tolerance=1.5):
        i = island()['island']
        return abs(i['w'] - w) <= tolerance and abs(i['h'] - h) <= tolerance

    def clear_of_card():
        i = island()
        return i['island']['y'] + i['island']['h'] <= i['card']['y'] - 4

    def until(condition, timeout=5):
        # Si no se cumple, el error dice cómo estaba la isla (más útil que «no se cumplió»).
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {island()}') from None

    def hover(element_id):
        driver.context('chrome')
        element = driver.command('POST', '/element', {'using': 'css selector', 'value': f'#{element_id}'})
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'},
                                                         'actions': [{'type': 'pointerMove', 'origin': element, 'x': 0, 'y': 0}]}]})

    def away():
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'},
                                                         'actions': [{'type': 'pointerMove', 'origin': 'viewport', 'x': 700, 'y': 600}]}]})
        driver.command('DELETE', '/actions')

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/kioto')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")

        until(lambda: sized(176) and island()['host'] == '127.0.0.1', timeout=5)
        # La tarjeta llega a su sitio con su transición: se espera a que acabe.
        until(clear_of_card, timeout=5)
        check('En reposo mide 176 × 32 y enseña solo el dominio')

        hover('nav-bar')
        until(lambda: sized(400) and island()['back'] and island()['forward'] and island()['reload'], timeout=5)
        assert clear_of_card(), island()
        check('Con el ratón encima se abre a 400 × 32 con atrás, adelante y recargar')
        away()
        until(lambda: sized(176), timeout=5)

        # El menú de Kitsune se abre desde la isla: mientras está abierto, la isla no se encoge.
        hover('nav-bar')
        until(lambda: sized(400), timeout=5)
        chrome("PanelUI.show()")
        until(lambda: chrome("return PanelUI.panel.state") == 'open', timeout=5)
        away()
        time.sleep(1.2)
        assert sized(400) and island()['state'] == 'open', island()
        chrome("PanelUI.hide()")
        until(lambda: sized(176) and island()['state'] == '', timeout=5)
        check('Con un menú suyo abierto sigue abierta aunque el ratón se vaya, y se cierra con él')

        chrome("gURLBar.focus(); gURLBar.search('kioto');")  # startQuery() a secas busca el texto vacío
        until(lambda: sized(560) and island()['state'] == 'typing', timeout=5)
        until(lambda: island()['results'] is not None and island()['results']['w'] >= 400, timeout=5)
        i = island()
        assert clear_of_card() and i['results']['x'] >= 0 and i['results']['x'] + i['results']['w'] <= i['W'], i
        check('Escribiendo mide 560 × 32 y las sugerencias se abren y se leen')
        r, j = i['results'], i['island']
        assert abs((r['x'] + r['w'] / 2) - (j['x'] + j['w'] / 2)) <= 2 and abs(r['w'] - j['w']) <= 2 and r['y'] >= j['y'] + j['h'], i
        check('Las sugerencias salen debajo de la isla, centradas con ella y de su mismo ancho')
        chrome("gURLBar.view.close(); gURLBar.blur(); gBrowser.selectedBrowser.focus();")
        until(lambda: sized(176), timeout=5)

        i = island()
        assert i['tabs'] == 0 and i['bookmarks'] == 0, i
        check('Las pestañas de arriba y la barra de marcadores de Gecko no se ven')

        chrome("ChromeUtils.importESModule('chrome://browser/content/zero/zero-island.sys.mjs').alert(window, 'Tres avisos esperando', 'te los enseño en el descanso', 1500)")
        until(lambda: sized(470) and clear_of_card(), timeout=5)
        until(lambda: sized(176), timeout=8)
        check('Un aviso la ensancha a 470 × 32 un momento y vuelve a reposo')
        check('Nunca baja: siempre queda por encima de la tarjeta')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
