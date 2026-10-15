"""Kitsune Zero · la pestaña vacía, en el motor real (perfil temporal, sin ventana en pantalla).

Decisión de Risco (15-10): sin nada abierto, Zero es solo el fondo transparente, el raíl y la isla en el
centro de la pantalla como buscador; al buscar, la isla sube a su sitio con una animación.

1. En una pestaña vacía (la nueva o la de inicio, o en blanco) no hay tarjeta ni página de inicio: la
   tarjeta se esconde y la isla está en el centro de la ventana, ancha (≥ 500 px) y algo más alta, con
   el campo a la vista («Buscar con Google o introducir una dirección») y el icono del buscador delante;
   la isla es el campo (sin otra píldora dentro, también escribiendo) y de cristal (sin foto de la
   página de inicio escondida debajo).
   Los botones de ampliar no salen (no hay nada que ampliar).
2. Al ir a una web, la isla sube a su sitio con una animación (no de golpe) y la tarjeta vuelve; lo
   escrito se va al momento (no se cruza con el dominio, que entra al llegar arriba).
3. Una pestaña nueva (Ctrl+T) vuelve a ser vacía: la isla baja al centro y la tarjeta se va.
4. Elegir una pestaña con web o una vacía cambia lo uno y lo otro.
5. Con la ventana sin ver (otra app delante), una pestaña nueva esconde la tarjeta enseguida: Gecko no
   anima una ventana que no se ve, y el fundido se quedaba parado con la tarjeta a la vista (en negro)
   hasta volver a Kitsune (Risco, 15-10).

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


STATE = """
const toolbox = document.getElementById('navigator-toolbox'), nav = document.getElementById('nav-bar');
const n = nav.getBoundingClientRect(), panels = document.getElementById('tabbrowser-tabpanels');
const field = document.querySelector('#urlbar > .urlbar-input-container'), input = document.getElementById('urlbar-input');
const engine = document.querySelector('#nav-bar .zero-engine'), grow = document.getElementById('zero-grow');
return {
  empty: document.documentElement.hasAttribute('zero-empty'),
  island: { top: n.top, middle: (n.top + n.bottom) / 2, w: n.width, h: n.height },
  H: innerHeight,
  card: Number(getComputedStyle(panels).opacity),
  field: Number(getComputedStyle(field).opacity), placeholder: input.placeholder,
  engine: engine && { shown: Number(getComputedStyle(engine).opacity) > 0.9 && engine.getBoundingClientRect().width >= 12, src: engine.getAttribute('src') || '' },
  grow: grow ? Number(getComputedStyle(grow).opacity) : 0,
  glass: (c => !!c && !c.hidden)(document.getElementById('zero-glass-nav-bar')),
  fieldBox: (() => { const f = getComputedStyle(field); return { bg: f.backgroundColor, margin: parseFloat(f.marginLeft) }; })(),
  moving: toolbox.getAnimations().some(a => a.playState === 'running'),
};
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-vacia-'))
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

    def until(condition, timeout=6):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {state()}') from None

    def centered(s):
        return s['empty'] and abs(s['island']['middle'] - s['H'] / 2) < 40 and s['island']['w'] >= 500 and s['island']['h'] >= 38 \
            and s['card'] < 0.05 and s['field'] > 0.9 and s['placeholder'] and s['engine'] and s['engine']['shown'] and s['grow'] < 0.05 \
            and not s['glass'] and s['fieldBox']['bg'] in ('rgba(0, 0, 0, 0)', 'transparent') and s['fieldBox']['margin'] < 1

    def at_top(s):
        return not s['empty'] and s['island']['top'] <= 10 and s['island']['h'] <= 34 and s['card'] > 0.95

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("Services.prefs.setStringPref('kitsune.zero.backdrop', 'system')")
        chrome("gBrowser.selectedBrowser.loadURI(Services.io.newURI('about:blank'), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })")
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: centered(state()))
        chrome("gURLBar.focus()")
        until(lambda: centered(state()) and chrome("return document.getElementById('navigator-toolbox').getAttribute('zero-island')") == 'typing')
        chrome("gURLBar.blur()")
        check('En una pestaña vacía: sin tarjeta, la isla en el centro como buscador, con su icono')

        driver.context('chrome')
        gone = driver.script("""const done = arguments[arguments.length - 1];
            gURLBar.blur(); gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
            setTimeout(() => done(Number(getComputedStyle(document.querySelector('#urlbar > .urlbar-input-container')).opacity)), 60);""", [origin + '/kioto'], asynchronous=True)
        assert gone < 0.1, f'lo escrito sigue a la vista al subir la isla (se cruzaría con el dominio): {gone}'
        until(lambda: state()['moving'] or at_top(state()), timeout=3)
        moved = state()['moving']
        until(lambda: at_top(state()))
        assert moved, 'la isla subió sin animación'
        check('Al ir a una web, la isla sube a su sitio con una animación y la tarjeta vuelve')

        chrome("(window.BrowserCommands?.openTab ?? window.BrowserOpenTab).call(window.BrowserCommands ?? window)")
        until(lambda: centered(state()))
        check('Una pestaña nueva vuelve a ser vacía: la isla baja al centro')

        chrome("gBrowser.selectedTab = gBrowser.tabs[0]")
        until(lambda: at_top(state()))
        chrome("gBrowser.selectedTab = gBrowser.tabs.at(-1)")
        until(lambda: centered(state()))
        check('Elegir una pestaña con web o una vacía cambia lo uno y lo otro')

        chrome("gBrowser.selectedTab = gBrowser.tabs[0]")
        until(lambda: at_top(state()))
        chrome("window.browsingContext.isActive = false")
        try:
            chrome("(window.BrowserCommands?.openTab ?? window.BrowserOpenTab).call(window.BrowserCommands ?? window)")
            time.sleep(0.4)
            hidden = chrome("""const p = document.getElementById('tabbrowser-tabpanels');
                return { empty: document.documentElement.hasAttribute('zero-empty'), card: Number(getComputedStyle(p).opacity),
                         stuck: p.getAnimations().filter(a => a.playState === 'running').length };""")
            assert hidden['empty'] and hidden['card'] < 0.05 and not hidden['stuck'], f'con la ventana sin ver, la tarjeta sigue a la vista: {hidden}'
        finally:
            chrome("window.browsingContext.isActive = true")
        until(lambda: centered(state()))
        check('Con la ventana sin ver, una pestaña nueva esconde la tarjeta enseguida')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
