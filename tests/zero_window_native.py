"""Kitsune Zero · de 3 en 3 (Risco, 9-11), en el motor real (perfil temporal, sin ventana en pantalla).

Las pestañas («Pestañas de 3 en 3», apagado de serie):
1. Apagado, se ven todas. Encendido y con más de tres, se ven tres, con cuántas quedan arriba y abajo, y el «+» a la
   vista.
2. La rueda pasa de una en una (y no se sale); las flechas pequeñas, también.
3. Al elegir una que no se ve (Ctrl+Tab, otra ventana…), la ventana va a ella. Con tres o menos, no hay ventana.
Los accesos directos («Accesos directos de 3 en 3», encendido de serie):
4. Con más de tres se ven tres y la rueda pasa al siguiente.
5. Se reordenan arrastrándolos con el ratón y con Alt+↑/↓, y el orden se guarda.

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
        name = self.path.strip('/') or 'inicio'
        from urllib.parse import unquote
        name = unquote(name)
        body = f'<!doctype html><meta charset=utf-8><title>{name}</title><h1>{name}</h1>'.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


# Lo que se ve de la ventana del raíl: las filas cuyo centro cae dentro de la caja de las pestañas.
RAIL = """const rail = document.getElementById('zero-rail'); const box = rail.querySelector('.zero-tabs'); const b = box.getBoundingClientRect();
const rows = [...box.children].filter(n => !n.hasAttribute('leaving'));
const seen = rows.filter(n => { const r = n.getBoundingClientRect(); const c = r.top + r.height / 2; return c > b.top && c < b.bottom; });
const add = rail.querySelector('.zero-new').getBoundingClientRect(); const rr = rail.getBoundingClientRect();
const more = s => { const n = rail.querySelector(s); return n.hidden ? 0 : Number(n.dataset.n); };
return { window: rail.hasAttribute('zero-window'), rows: rows.length, seen: seen.map(n => n.getAttribute('aria-label')),
         selectedSeen: seen.some(n => n.hasAttribute('selected')), addSeen: add.height > 10 && add.bottom <= rr.bottom + 1,
         up: more('.zero-window-up'), down: more('.zero-window-down'), boxH: b.height };"""

LIST = """const list = document.querySelector('#zero-shortcuts .zero-shortcut-list'); const b = list.getBoundingClientRect();
const items = [...list.children];
const seen = items.filter(n => { const r = n.getBoundingClientRect(); const c = r.top + r.height / 2; return c > b.top && c < b.bottom; });
return { window: list.hasAttribute('zero-window'), count: items.length, seen: seen.map(n => n.title), order: items.map(n => n.title) };"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-ventana-'))
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

    def rail():
        return chrome(RAIL)

    def until(condition, show, timeout=5):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {show()}') from None

    def wheel(selector, dy):
        # Un giro de rueda de verdad (WebDriver), sobre el centro del elemento.
        driver.context('chrome')
        element = driver.command('POST', '/element', {'using': 'css selector', 'value': selector})
        driver.command('POST', '/actions', {'actions': [{'type': 'wheel', 'id': 'rueda', 'actions': [
            {'type': 'scroll', 'origin': element, 'x': 0, 'y': 0, 'deltaX': 0, 'deltaY': dy}]}]})

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/pestana-1')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !!document.getElementById('zero-rail')"), timeout=5)
        for n in range(2, 8):
            chrome("gBrowser.addTrustedTab(arguments[0])", [f'{origin}/pestana-{n}'])
        until(lambda: rail()['rows'] == 7, rail)
        chrome("gBrowser.selectedTab = gBrowser.visibleTabs[0]")
        r = rail()
        assert not r['window'] and len(r['seen']) == 7, r
        chrome("Services.prefs.setBoolPref('kitsune.zero.rail.window', true)")
        until(lambda: (r := rail())['window'] and len(r['seen']) == 3 and r['addSeen'] and r['up'] == 0 and r['down'] == 4 and r['selectedSeen'], rail)
        check('Encendido y con 7 pestañas, se ven tres, «4 más abajo» y el «+» a la vista; apagado se ven todas')

        first = rail()['seen']
        wheel('#zero-rail .zero-tabs', 120)
        until(lambda: (r := rail())['seen'] == [*first[1:], r['seen'][-1]] and r['up'] == 1 and r['down'] == 3, rail)
        for _ in range(8):
            wheel('#zero-rail .zero-tabs', 120)
            chrome("return new Promise(r => setTimeout(r, 130))")
        until(lambda: (r := rail())['down'] == 0 and r['up'] == 4 and len(r['seen']) == 3, rail)
        wheel('#zero-rail .zero-tabs', -120)
        until(lambda: (r := rail())['down'] == 1 and r['up'] == 3, rail)
        chrome("document.querySelector('#zero-rail .zero-window-up').click()")
        until(lambda: (r := rail())['up'] == 2, rail)
        check('La rueda pasa de una en una sin salirse, y las flechas pequeñas también')

        chrome("gBrowser.selectedTab = gBrowser.visibleTabs[6]")
        until(lambda: (r := rail())['selectedSeen'] and r['down'] == 0, rail)
        chrome("gBrowser.selectedTab = gBrowser.visibleTabs[0]")
        until(lambda: (r := rail())['selectedSeen'] and r['up'] == 0, rail)
        chrome("for (const tab of gBrowser.visibleTabs.slice(3)) gBrowser.removeTab(tab)")
        until(lambda: (r := rail())['rows'] == 3 and not r['window'] and len(r['seen']) == 3, rail)
        check('Al elegir una que no se ve, la ventana va a ella; con tres o menos no hay ventana')

        # Cinco accesos, guardados con el «+» de la pastilla, como lo haría una persona.
        for n in range(1, 6):
            driver.navigate(f'{origin}/Web {n}')
            eventually(lambda: chrome("return gBrowser.selectedTab.label") == f'Web {n}', timeout=5)
            chrome("document.querySelector('#zero-shortcuts .zero-shortcut-add').click()")
        until(lambda: (s := chrome(LIST))['count'] == 5 and s['window'] and s['seen'] == ['Web 1', 'Web 2', 'Web 3'], lambda: chrome(LIST))
        wheel('#zero-shortcuts .zero-shortcut-list', 120)
        until(lambda: chrome(LIST)['seen'] == ['Web 2', 'Web 3', 'Web 4'], lambda: chrome(LIST))
        check('Con cinco accesos directos se ven tres y la rueda pasa al siguiente')

        wheel('#zero-shortcuts .zero-shortcut-list', -120)
        until(lambda: chrome(LIST)['seen'] == ['Web 1', 'Web 2', 'Web 3'], lambda: chrome(LIST))
        driver.context('chrome')
        element = driver.command('POST', '/element', {'using': 'css selector', 'value': '#zero-shortcuts .zero-shortcut[title="Web 1"]'})
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [
            {'type': 'pointerMove', 'origin': element, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0},
            {'type': 'pointerMove', 'origin': element, 'x': 0, 'y': 10, 'duration': 80},
            {'type': 'pointerMove', 'origin': element, 'x': 0, 'y': 34, 'duration': 120},
            {'type': 'pointerUp', 'button': 0}]}]})
        driver.command('DELETE', '/actions')
        until(lambda: chrome(LIST)['order'][:3] == ['Web 2', 'Web 1', 'Web 3'], lambda: chrome(LIST))
        saved = next(iter(json.loads(chrome("return Services.prefs.getStringPref('kitsune.zero.shortcuts')")).values()))
        assert [item['title'] for item in saved][:2] == ['Web 2', 'Web 1'], saved
        assert chrome("return gBrowser.visibleTabs.length") == 3  # arrastrar no abre la web
        chrome("document.querySelector('#zero-shortcuts .zero-shortcut[title=\"Web 3\"]').focus()")
        chrome("""const node = document.querySelector('#zero-shortcuts .zero-shortcut[title="Web 3"]');
            node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));""")
        until(lambda: chrome(LIST)['order'][:3] == ['Web 2', 'Web 3', 'Web 1'], lambda: chrome(LIST))
        check('Los accesos se reordenan arrastrándolos y con Alt+↑/↓, y el orden se guarda (arrastrar no abre la web)')

        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !document.getElementById('zero-rail') && !document.getElementById('zero-shortcuts')"), timeout=5)
        check('Sin Zero no queda nada de esto')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
