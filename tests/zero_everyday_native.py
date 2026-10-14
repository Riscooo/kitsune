"""Kitsune Zero · cosas de cada día que la isla esconde, en el motor real (perfil temporal, sin ventana en pantalla).

1. Guardar en marcadores (Ctrl+D) abre su panel bajo la isla, no en una esquina.
2. Cambiar el tamaño de la web (Ctrl + / −) lo dice la isla un momento («Tamaño · 110 %»).
3. Buscar en la página (Ctrl+F) saca su barra dentro de la tarjeta.
4. Con muchas pestañas el raíl cabe en la ventana, se desplaza, y la pestaña elegida siempre se ve
   (también al entrar en Zero con ella abajo del todo).

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import http.server
import json
from pathlib import Path
import tempfile
import threading

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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-diario-'))
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

    def alert():
        return chrome("const t = document.getElementById('navigator-toolbox'); return t.hasAttribute('zero-island-alert') ? document.getElementById('zero-island-msg').textContent.trim() : ''")

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !!document.getElementById('zero-host')"), timeout=5)

        chrome("PlacesCommandHook.bookmarkPage()")
        eventually(lambda: chrome("return document.getElementById('editBookmarkPanel')?.state") == 'open', timeout=8)
        place = chrome("""const r = document.getElementById('editBookmarkPanel').getBoundingClientRect(); const n = document.getElementById('nav-bar').getBoundingClientRect();
            return { top: r.top, left: r.left, w: r.width, islandBottom: n.bottom, islandLeft: n.left, islandRight: n.right };""")
        assert place['w'] > 100 and place['islandBottom'] - 2 <= place['top'] < place['islandBottom'] + 80 and place['left'] < place['islandRight'] + 60 and place['left'] + place['w'] > place['islandLeft'] - 60, place
        chrome("document.getElementById('editBookmarkPanel').hidePopup()")
        check('Guardar en marcadores abre su panel bajo la isla')

        chrome("FullZoom.enlarge()")
        eventually(lambda: 'Tamaño' in alert() and '%' in alert(), timeout=5)
        percent = chrome("return Math.round(ZoomManager.getZoomForBrowser(gBrowser.selectedBrowser) * 100)")
        assert f'{percent} %' in alert(), (percent, alert())
        chrome("FullZoom.reset()")
        eventually(lambda: '100 %' in alert(), timeout=5)
        check('Cambiar el tamaño de la web lo dice la isla un momento')

        driver.context('chrome')
        bar = driver.script("""const done = arguments[arguments.length - 1];
            gBrowser.getFindBar().then(fb => { fb.open(); setTimeout(() => { const r = fb.getBoundingClientRect(); const p = document.getElementById('tabbrowser-tabpanels').getBoundingClientRect();
              done({ ok: !fb.hidden && r.width > 100 && r.height > 20 && r.left >= p.left - 1 && r.right <= p.right + 1 && r.bottom <= p.bottom + 1 }); fb.close(); }, 600); });""", [], asynchronous=True)
        assert bar['ok'], bar
        check('Buscar en la página saca su barra dentro de la tarjeta')

        for i in range(40):
            chrome("gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(), skipAnimation: true })", [f'{origin}/{i}'])
        look = """const rail = document.getElementById('zero-rail'); const r = rail.getBoundingClientRect(); const sel = rail.querySelector('.zero-tab[selected]')?.getBoundingClientRect();
            return { fits: r.top >= 0 && r.bottom <= innerHeight, scrolls: rail.scrollHeight > rail.clientHeight, seen: !!sel && sel.top >= r.top - 1 && sel.bottom <= r.bottom + 1,
                     rail: [r.top, r.bottom], scrollTop: rail.scrollTop, selected: sel && [sel.top, sel.bottom] };"""

        def selected_in_view(what):
            try:
                eventually(lambda: (l := chrome(look))['fits'] and l['scrolls'] and l['seen'], timeout=5)
            except AssertionError:
                raise AssertionError(f'{what}: {chrome(look)}') from None

        for pick in ('gBrowser.visibleTabs.at(-1)', 'gBrowser.visibleTabs[0]', 'gBrowser.visibleTabs[25]'):
            chrome(f"gBrowser.selectedTab = {pick}")
            selected_in_view(pick)
        chrome("gBrowser.selectedTab = gBrowser.visibleTabs.at(-2)")
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !document.getElementById('zero-rail')"), timeout=5)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        selected_in_view('al entrar en Zero')
        check('Con muchas pestañas el raíl cabe, se desplaza y la elegida siempre se ve (también al entrar en Zero)')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
