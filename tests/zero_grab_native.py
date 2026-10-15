"""Kitsune Zero · agarrar la página para la multitarea, en el motor real (perfil temporal, sin ventana en pantalla).

Risco (15-10): «que las páginas sean grabbeables para poder ponerlo en el espacio multitarea y así aprovecharlo
al máximo posible» (y, al probarlo: «no puedo agarrar páginas»). Debajo de la web hay un asa, como la de un iPad.

1. El asa está debajo de la web, centrada; no sale en una pestaña vacía ni con la web ampliada.
2. Llevada a la mitad izquierda de la ventana, la web se queda a la izquierda en una vista dividida y a la
   derecha sale la lista de pestañas para elegir la de al lado; mientras se lleva, se ve ese lado. Igual a la
   derecha.
3. Llevada al filo de la ventana, la web se va a una ventana propia (en Zero), que el sistema puede colocar.

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

TITLES = {'/a': 'Kioto', '/b': 'Nara', '/c': 'Osaka'}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(f'<!doctype html><meta charset=utf-8><title>{TITLES.get(self.path, "?")}</title><h1>{TITLES.get(self.path, "?")}</h1>'.encode())

    def log_message(self, *args):
        pass


GRAB = """
const g = document.getElementById('zero-grab'), card = document.querySelector('#tabbrowser-tabpanels > .deck-selected');
const r = g?.getBoundingClientRect(), c = card?.getBoundingClientRect(), cs = g && getComputedStyle(g);
const d = document.getElementById('zero-split-drop');
return { shown: !!g && cs.display !== 'none' && r.width > 20, x: r && (r.left + r.right) / 2, y: r && (r.top + r.bottom) / 2,
         card: c && { left: c.left, right: c.right, top: c.top, bottom: c.bottom }, W: innerWidth, H: innerHeight,
         drop: d && getComputedStyle(d).display !== 'none' ? d.getAttribute('side') : null };
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-asa-'))
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

    def grab():
        return chrome(GRAB)

    def until(condition, timeout=8):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {grab()}') from None

    def drag_to(x, y, release=True):
        driver.context('chrome')
        handle = driver.command('POST', '/element', {'using': 'css selector', 'value': '#zero-grab'})
        steps = [{'type': 'pointerMove', 'origin': handle, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0},
                 {'type': 'pointerMove', 'origin': 'pointer', 'x': 0, 'y': -20, 'duration': 80},
                 {'type': 'pointerMove', 'origin': 'viewport', 'x': int(x), 'y': int(y), 'duration': 260}]
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': steps}]})
        side = grab()['drop']
        if release:
            driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [{'type': 'pointerUp', 'button': 0}]}]})
        return side

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/a')
        for path in ('/b', '/c'):
            chrome("gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })", [origin + path])
        eventually(lambda: chrome("return gBrowser.visibleTabs.every(t => t.label && !t.label.startsWith('127.'))"), timeout=10)
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: (g := grab())['shown'] and g['card'] and abs(g['x'] - (g['card']['left'] + g['card']['right']) / 2) <= 2
              and g['card']['bottom'] < g['y'] < g['H'])
        chrome("BrowserCommands.openTab()")
        until(lambda: not grab()['shown'])
        chrome("gBrowser.removeTab(gBrowser.selectedTab); gBrowser.selectedTab = gBrowser.visibleTabs[0]")
        until(lambda: grab()['shown'])
        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        until(lambda: not grab()['shown'])
        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        until(lambda: grab()['shown'])
        check('El asa está debajo de la web, centrada; no en una pestaña vacía ni con la web ampliada')

        split = "return gBrowser.selectedTab.splitview?.tabs.map(t => t.linkedBrowser.currentURI.spec.replace(/^http:\\/\\/127[^/]*/, '')) ?? null"
        g = grab()
        side = drag_to(g['card']['left'] + 80, (g['card']['top'] + g['card']['bottom']) / 2)
        assert side == 'left', f'no enseña el lado izquierdo: {side}'
        until(lambda: chrome(split) == ['/a', 'about:opentabs'])
        chrome("const v = gBrowser.selectedTab.splitview; const other = v.tabs.find(t => t.linkedBrowser.currentURI.spec === 'about:opentabs'); v.unsplitTabs(); gBrowser.removeTab(other); gBrowser.selectedTab = gBrowser.visibleTabs[0];")
        until(lambda: chrome(split) is None and grab()['shown'])
        g = grab()
        side = drag_to(g['card']['right'] - 80, (g['card']['top'] + g['card']['bottom']) / 2)
        assert side == 'right', f'no enseña el lado derecho: {side}'
        until(lambda: chrome(split) == ['about:opentabs', '/a'])
        chrome("const v = gBrowser.selectedTab.splitview; const other = v.tabs.find(t => t.linkedBrowser.currentURI.spec === 'about:opentabs'); v.unsplitTabs(); gBrowser.removeTab(other); gBrowser.selectedTab = gBrowser.visibleTabs[0];")
        until(lambda: chrome(split) is None and grab()['shown'])
        check('Llevada a un lado, la web se queda en ese lado de una vista dividida, con la lista de pestañas al otro')

        windows = "return [...Services.wm.getEnumerator('navigator:browser')].map(w => ({ tabs: w.gBrowser.visibleTabs.map(t => t.label), zero: w.document.documentElement.hasAttribute('zero') }))"
        g = grab()
        side = drag_to(g['W'] - 3, g['H'] / 2)
        assert side == 'window', f'no avisa de que se va a una ventana: {side}'
        until(lambda: len(chrome(windows)) == 2 and any(w['tabs'] == ['Kioto'] and w['zero'] for w in chrome(windows)), timeout=15)
        chrome("for (const w of Services.wm.getEnumerator('navigator:browser')) if (w !== window) w.close();")
        check('Llevada al filo de la ventana, la web se va a una ventana propia, en Zero')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
