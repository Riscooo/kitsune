"""Kitsune Zero · reordenar pestañas arrastrándolas en el raíl, en el motor real (sin ventana en pantalla).

1. Al arrastrar una pestaña, se levanta y las demás le hacen hueco (se apartan con suavidad).
2. Al soltarla queda en su sitio nuevo (también en Gecko), sin elegirla.
3. Un arrastre corto (menos de 6 px) es un clic: elige la pestaña y no la mueve.
4. Una fijada no se mezcla con las demás.
5. Soltar una pestaña lejos del raíl (a la derecha) la lleva a una ventana nueva, que nace en Zero, como
   arrastrarla fuera de la barra de pestañas en Kitsune.

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

TITLES = {'/a': 'Kioto', '/b': 'Nara', '/c': 'Osaka', '/d': 'Kobe', '/e': 'Uji'}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        title = TITLES.get(self.path, 'Otra')
        self.wfile.write(f'<!doctype html><meta charset=utf-8><title>{title}</title><h1>{title}</h1>'.encode())

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-arrastre-'))
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

    def order():
        return chrome("return gBrowser.visibleTabs.map(t => t.label)")

    def rail():
        return chrome("return [...document.querySelectorAll('#zero-rail .zero-tab:not([leaving])')].map(n => n.querySelector('.zero-tt').textContent)")

    def until(condition, timeout=6):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · gecko {order()} · raíl {rail()}') from None

    def element(selector):
        driver.context('chrome')
        return driver.command('POST', '/element', {'using': 'css selector', 'value': selector})

    def actions(steps):
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': steps}]})

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/a')
        for path in ('/b', '/c', '/d', '/e'):
            chrome("gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })", [origin + path])
        chrome("gBrowser.pinTab(gBrowser.visibleTabs[0])")  # Kioto, fijada
        eventually(lambda: chrome("return gBrowser.visibleTabs.every(t => t.label && !t.label.startsWith('127.'))"), timeout=10)
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: order() == ['Kioto', 'Nara', 'Osaka', 'Kobe', 'Uji'] and rail() == order())
        selected = chrome("return gBrowser.selectedTab.label")

        # Uji (la última) sube hasta antes de Nara: se pulsa, se mueve despacio y se mira a mitad.
        uji = element('#zero-rail .zero-tab:nth-child(5)')
        nara_y = chrome("return document.querySelector('#zero-rail .zero-tab:nth-child(2)').getBoundingClientRect().top + 4")
        uji_y = chrome("const r = document.querySelector('#zero-rail .zero-tab:nth-child(5)').getBoundingClientRect(); return r.top + r.height / 2")
        actions([{'type': 'pointerMove', 'origin': uji, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0},
                 {'type': 'pointerMove', 'origin': 'pointer', 'x': 0, 'y': -12, 'duration': 60},
                 {'type': 'pointerMove', 'origin': 'pointer', 'x': 0, 'y': round(nara_y - uji_y + 12), 'duration': 240}])
        lifted = chrome("""const rows = [...document.querySelectorAll('#zero-rail .zero-tab')];
            return { dragging: rows[4].hasAttribute('dragging'), moved: rows.slice(1, 4).map(r => r.style.transform || getComputedStyle(r).transform) };""")
        assert lifted['dragging'] and all(m not in ('', 'none') for m in lifted['moved']), lifted
        check('Al arrastrar, la pestaña se levanta y las demás le hacen hueco')
        actions([{'type': 'pointerUp', 'button': 0}])
        until(lambda: order() == ['Kioto', 'Uji', 'Nara', 'Osaka', 'Kobe'] and rail() == order())
        time.sleep(0.4)
        assert chrome("return gBrowser.selectedTab.label") == selected, chrome("return gBrowser.selectedTab.label")
        assert chrome("return [...document.querySelectorAll('#zero-rail .zero-tab')].every(r => !r.hasAttribute('dragging') && !r.style.transform)")
        check('Al soltarla queda en su sitio nuevo, también en Gecko, sin elegirla')

        osaka = element('#zero-rail .zero-tab:nth-child(4)')
        actions([{'type': 'pointerMove', 'origin': osaka, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0},
                 {'type': 'pointerMove', 'origin': 'pointer', 'x': 0, 'y': 3, 'duration': 40}, {'type': 'pointerUp', 'button': 0}])
        until(lambda: chrome("return gBrowser.selectedTab.label") == 'Osaka')
        assert order() == ['Kioto', 'Uji', 'Nara', 'Osaka', 'Kobe'], order()
        check('Un arrastre corto es un clic: elige la pestaña y no la mueve')

        kobe = element('#zero-rail .zero-tab:nth-child(5)')
        kioto_y = chrome("return document.querySelector('#zero-rail .zero-tab:nth-child(1)').getBoundingClientRect().top + 2")
        kobe_y = chrome("const r = document.querySelector('#zero-rail .zero-tab:nth-child(5)').getBoundingClientRect(); return r.top + r.height / 2")
        actions([{'type': 'pointerMove', 'origin': kobe, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0},
                 {'type': 'pointerMove', 'origin': 'pointer', 'x': 0, 'y': -12, 'duration': 60},
                 {'type': 'pointerMove', 'origin': 'pointer', 'x': 0, 'y': round(kioto_y - kobe_y + 12), 'duration': 240}, {'type': 'pointerUp', 'button': 0}])
        until(lambda: order()[0] == 'Kioto' and order()[1] == 'Kobe' and chrome("return gBrowser.visibleTabs[0].pinned && !gBrowser.visibleTabs[1].pinned"))
        check('Una fijada no se mezcla con las demás')

        osaka = element(f"#zero-rail .zero-tab:nth-child({rail().index('Osaka') + 1})")
        actions([{'type': 'pointerMove', 'origin': osaka, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0},
                 {'type': 'pointerMove', 'origin': 'pointer', 'x': 40, 'y': 10, 'duration': 80},
                 {'type': 'pointerMove', 'origin': 'pointer', 'x': 260, 'y': 20, 'duration': 240}])
        assert chrome("return document.querySelector('#zero-rail .zero-tab[dragging]')?.hasAttribute('tearing')"), 'debería avisar de que se va a otra ventana'
        actions([{'type': 'pointerUp', 'button': 0}])
        windows = "return [...Services.wm.getEnumerator('navigator:browser')].map(w => ({ tabs: w.gBrowser.visibleTabs.map(t => t.label), zero: w.document.documentElement.hasAttribute('zero') }))"
        until(lambda: len(chrome(windows)) == 2 and any(w['tabs'] == ['Osaka'] for w in chrome(windows)), timeout=15)
        other = next(w for w in chrome(windows) if w['tabs'] == ['Osaka'])
        assert other['zero'], chrome(windows)
        assert 'Osaka' not in order(), order()
        chrome("for (const w of Services.wm.getEnumerator('navigator:browser')) if (w !== window) w.close();")
        check('Soltar una pestaña lejos del raíl la lleva a una ventana nueva, en Zero')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
