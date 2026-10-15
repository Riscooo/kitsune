"""Kitsune Zero · los accesos directos, la pastilla de abajo de la columna, en el motor real (perfil temporal, sin ventana en pantalla).

Decisión de Risco (15-10): «abajo, entre las pestañas y el logo de Kitsune/ajustes, otra píldora para meter
los accesos directos que queramos». Cada perfil tiene los suyos. Va en Windows, macOS y Linux.

1. Debajo de las pestañas, la pastilla de los accesos directos, con un «+».
2. El «+» guarda la página en la que se está: sale su icono, con su nombre.
3. Al pulsarlo lleva a esa web: a su pestaña, si está abierta; si no, en una nueva.
4. El clic derecho lo quita.
5. Cada perfil tiene los suyos: en otro perfil no está, y al volver, sí.

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
        name = self.path.strip('/') or 'inicio'
        self.wfile.write(f'<!doctype html><meta charset=utf-8><title>{name.capitalize()}</title><h1>{name}</h1>'.encode())

    def log_message(self, *args):
        pass


STATE = """
const box = id => { const r = document.getElementById(id)?.getBoundingClientRect(); return r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; };
const pill = document.getElementById('zero-shortcuts');
return {
  rail: box('zero-rail'), pill: box('zero-shortcuts'),
  add: !!pill?.querySelector('.zero-shortcut-add'),
  items: [...(pill?.querySelectorAll('.zero-shortcut[data-url]') ?? [])].map(b => ({ url: b.dataset.url, label: b.getAttribute('aria-label') })),
  tabs: gBrowser.visibleTabs.length, url: gBrowser.selectedBrowser.currentURI.spec,
};
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-accesos-'))
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

    def state():
        return chrome(STATE)

    def until(condition, timeout=8):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {state()}') from None

    def click(selector, button=0):
        driver.context('chrome')
        node = driver.command('POST', '/element', {'using': 'css selector', 'value': selector})
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [
            {'type': 'pointerMove', 'origin': node, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': button}, {'type': 'pointerUp', 'button': button}]}]})
        driver.command('DELETE', '/actions')

    spaces = "ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs').KitsuneSpaces"
    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/kioto')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: (s := state())['pill'] and s['add'])
        s = state()
        assert s['pill']['y'] >= s['rail']['y'] + s['rail']['h'] and abs(s['pill']['x'] - s['rail']['x']) <= 1, s
        check('Debajo de las pestañas, la pastilla de los accesos directos, con su «+»')

        click('#zero-shortcuts .zero-shortcut-add')
        until(lambda: [i['url'] for i in state()['items']] == [origin + '/kioto'] and state()['items'][0]['label'] == 'Kioto')
        check('El «+» guarda la página en la que se está, con su icono y su nombre')

        chrome("gBrowser.selectedTab = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })", [origin + '/osaka'])
        until(lambda: state()['url'] == origin + '/osaka')
        tabs = state()['tabs']
        click('#zero-shortcuts .zero-shortcut[data-url]')
        until(lambda: (s := state())['url'] == origin + '/kioto' and s['tabs'] == tabs)
        chrome("gBrowser.removeTab(gBrowser.tabs.find(t => t.linkedBrowser.currentURI.spec === arguments[0]))", [origin + '/kioto'])
        until(lambda: state()['tabs'] == tabs - 1)
        click('#zero-shortcuts .zero-shortcut[data-url]')
        until(lambda: (s := state())['url'] == origin + '/kioto' and s['tabs'] == tabs)
        check('Al pulsarlo lleva a esa web: a su pestaña si está abierta, si no en una nueva')

        driver.context('chrome')
        other = driver.script(f"const done = arguments[arguments.length - 1]; {spaces}.create({{ name: 'Casa', color: 'pink', user: null }}).then(done, e => done(String(e)));", [], asynchronous=True)
        first = chrome(f"return {spaces}.active(window)")
        driver.script(f"const done = arguments[arguments.length - 1]; {spaces}.switchTo(window, arguments[0]).then(() => done(), () => done());", [other], asynchronous=True)
        until(lambda: state()['items'] == [])
        driver.script(f"const done = arguments[arguments.length - 1]; {spaces}.switchTo(window, arguments[0]).then(() => done(), () => done());", [first], asynchronous=True)
        until(lambda: [i['url'] for i in state()['items']] == [origin + '/kioto'])
        check('Cada perfil tiene los suyos')

        click('#zero-shortcuts .zero-shortcut[data-url]', button=2)
        until(lambda: state()['items'] == [])
        check('El clic derecho lo quita')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
