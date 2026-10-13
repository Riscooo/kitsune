"""Vista rápida en el motor real (perfil temporal, sin ventana en pantalla, servidor local).

1. Alt+clic en un enlace abre la web enlazada flotando sobre la página; la página de
   debajo no navega y se apaga un poco.
2. Un clic normal en el mismo enlace navega como siempre (la vista rápida no estorba).
3. Esc la cierra.
4. «Abrir en pestaña» la convierte en una pestaña nueva con esa web.
"""
import argparse
import http.server
import json
from pathlib import Path
import tempfile
import threading
import time

from browser_smoke import WebDriver, prepare_profile, eventually

PAGES = {
    '/': '<!doctype html><meta charset=utf-8><title>Origen</title><p><a id="enlace" href="/destino">Ver el destino</a></p>',
    '/destino': '<!doctype html><meta charset=utf-8><title>Destino</title><h1>Destino</h1>',
}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = PAGES.get(self.path)
        self.send_response(200 if body else 404)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write((body or 'no').encode())

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-glance-'))
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

    def content(script):
        driver.context('content'); return driver.script(script)

    def alt_click(selector):
        driver.context('content')
        found = driver.element(selector)
        element = found if isinstance(found, dict) else {'element-6066-11e4-a52e-4f735466cecf': found}
        driver.command('POST', '/actions', {'actions': [
            {'type': 'key', 'id': 'teclado', 'actions': [{'type': 'keyDown', 'value': ''}, {'type': 'pause', 'duration': 0},
                                                         {'type': 'pause', 'duration': 0}, {'type': 'keyUp', 'value': ''}]},
            {'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [
                {'type': 'pointerMove', 'origin': element, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0},
                {'type': 'pointerUp', 'button': 0}, {'type': 'pause', 'duration': 0}]},
        ]})
        driver.command('DELETE', '/actions')

    GLANCE = """const p = document.getElementById('kitsune-glance'); const b = p?.querySelector('browser');
      return {state: p?.state ?? 'none', url: b?.currentURI?.spec ?? null, dim: document.documentElement.hasAttribute('kitsune-glance'),
              title: p?.querySelector('.kitsune-glance-title')?.textContent ?? '', tabs: gBrowser.tabs.length,
              selected: gBrowser.selectedBrowser.currentURI.spec}"""
    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        driver.navigate(origin + '/')
        eventually(lambda: content("return document.readyState") == 'complete', timeout=10)
        alt_click('#enlace')
        eventually(lambda: chrome(GLANCE)['state'] == 'open' and chrome(GLANCE)['url'] == origin + '/destino', timeout=15)
        glance = chrome(GLANCE)
        assert glance['selected'] == origin + '/' and glance['dim'], glance
        eventually(lambda: chrome(GLANCE)['title'] == 'Destino', timeout=10)
        check('Alt+clic abre el enlace flotando sobre la página, y la de debajo no navega')

        chrome("document.getElementById('kitsune-glance').hidePopup()")
        eventually(lambda: chrome(GLANCE)['state'] == 'closed' and not chrome(GLANCE)['dim'], timeout=5)
        driver.context('content')
        driver.click('#enlace')
        eventually(lambda: chrome(GLANCE)['selected'] == origin + '/destino', timeout=10)
        assert chrome(GLANCE)['state'] == 'closed'
        check('Un clic normal navega como siempre')

        driver.navigate(origin + '/')
        eventually(lambda: content("return document.readyState") == 'complete', timeout=10)
        alt_click('#enlace')
        eventually(lambda: chrome(GLANCE)['state'] == 'open', timeout=15)
        driver.context('chrome')
        driver.shortcut('')  # Esc
        eventually(lambda: chrome(GLANCE)['state'] == 'closed', timeout=5)
        check('Esc cierra la vista rápida')

        alt_click('#enlace')
        eventually(lambda: chrome(GLANCE)['state'] == 'open' and chrome(GLANCE)['url'] == origin + '/destino', timeout=15)
        tabs = chrome(GLANCE)['tabs']
        chrome("document.querySelector('#kitsune-glance .kitsune-glance-tab').click()")
        eventually(lambda: chrome(GLANCE)['tabs'] == tabs + 1 and chrome(GLANCE)['selected'] == origin + '/destino', timeout=10)
        assert chrome(GLANCE)['state'] == 'closed'
        check('«Abrir en pestaña» la convierte en una pestaña nueva con esa web')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
