"""Kitsune Zero · el raíl (las pestañas, a la izquierda), en el motor real (perfil temporal, sin ventana en pantalla).

1. Tiene un icono redondo por pestaña visible (su favicon o su inicial), en orden, con las fijadas arriba.
2. Un clic selecciona la pestaña y el clic central la cierra.
3. Una pestaña nueva aparece con fundido.
4. Pasa de 36 a 186 de ancho con el ratón encima, y los títulos entran escalonados (28 ms).
5. Con el ratón encima, el icono más cercano es el que más crece (efecto Dock).
6. Con la web ampliada se aparta (opacidad 0) y vuelve al acercarse al borde izquierdo.
7. Con dos espacios o más, arriba salen sus iconos y un clic cambia de espacio.

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

TITLES = {'/kioto': 'Kioto', '/nara': 'Nara', '/osaka': 'Osaka', '/kobe': 'Kobe', '/uji': 'Uji'}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        title = TITLES.get(self.path, 'Otra')
        self.wfile.write(f'<!doctype html><meta charset=utf-8><title>{title}</title><h1>{title}</h1>'.encode())

    def do_HEAD(self):
        self.send_response(404); self.end_headers()

    def log_message(self, *args):
        pass


RAIL = """
const box = el => { const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
const rail = document.getElementById('zero-rail');
const tabs = [...rail?.querySelectorAll('.zero-tab') ?? []];
return {
  rail: box(rail), opacity: rail ? Number(getComputedStyle(rail).opacity) : null,
  tabs: tabs.map(item => {
    const fav = item.querySelector('.zero-fav'); const cs = getComputedStyle(fav);
    return { title: item.querySelector('.zero-tt')?.textContent ?? '', on: item.hasAttribute('selected'), pinned: item.hasAttribute('pinned'),
             round: parseFloat(cs.borderTopLeftRadius) >= parseFloat(cs.width) / 2 - 0.5, initial: fav.textContent, image: !!fav.querySelector('img'),
             s: Number(item.style.getPropertyValue('--s') || 1), delay: getComputedStyle(item.querySelector('.zero-tt')).transitionDelay, box: box(item) };
  }),
  gecko: gBrowser.visibleTabs.map(tab => ({ title: tab.label, pinned: tab.pinned, selected: tab.selected })),
  spaces: [...rail?.querySelectorAll('.zero-space') ?? []].map(item => ({ id: item.dataset.space, on: item.hasAttribute('selected') })),
};
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-rail-'))
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

    def until(condition, timeout=5):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {rail()}') from None

    def element(selector):
        driver.context('chrome')
        return driver.command('POST', '/element', {'using': 'css selector', 'value': selector})

    def pointer(actions):
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': actions}]})

    def hover(selector, x=0, y=0):
        pointer([{'type': 'pointerMove', 'origin': element(selector), 'x': x, 'y': y}])

    def away():
        pointer([{'type': 'pointerMove', 'origin': 'viewport', 'x': 760, 'y': 500}])
        driver.command('DELETE', '/actions')

    def add_tab(path):
        chrome("gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })", [origin + path])

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/kioto')
        for path in ('/nara', '/osaka', '/kobe'):
            add_tab(path)
        chrome("gBrowser.pinTab(gBrowser.visibleTabs.at(-1))")  # Kobe, fijada: sube arriba
        eventually(lambda: chrome("return gBrowser.visibleTabs.every(t => t.label && !t.label.startsWith('127.'))"), timeout=10)
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")

        def listed():
            r = rail()
            return (len(r['tabs']) == len(r['gecko']) == 4 and [t['title'] for t in r['tabs']] == [g['title'] for g in r['gecko']]
                    and r['tabs'][0]['pinned'] and r['tabs'][0]['title'] == 'Kobe' and all(t['round'] for t in r['tabs'])
                    and all(t['image'] or t['initial'] == t['title'][0].upper() for t in r['tabs']))
        until(listed)
        check('Un icono redondo por pestaña visible, en orden y con las fijadas arriba')

        driver.command('POST', f"/element/{list(element('#zero-rail .zero-tab:nth-child(3)').values())[0]}/click", {})
        until(lambda: chrome("return gBrowser.selectedTab.label") == rail()['tabs'][2]['title'] and rail()['tabs'][2]['on'])
        closing = rail()['tabs'][3]['title']
        pointer([{'type': 'pointerMove', 'origin': element('#zero-rail .zero-tab:nth-child(4)'), 'x': 0, 'y': 0},
                 {'type': 'pointerDown', 'button': 1}, {'type': 'pointerUp', 'button': 1}])
        until(lambda: closing not in [t['title'] for t in rail()['tabs']] and len(rail()['tabs']) == 3)
        away()
        check('Un clic selecciona la pestaña y el clic central la cierra')

        fading = chrome("""gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
                           const last = [...document.querySelectorAll('#zero-rail .zero-tab')].at(-1);
                           return last ? last.getAnimations().some(a => a.playState === 'running') : null;""", [origin + '/uji'])
        assert fading, fading
        until(lambda: len(rail()['tabs']) == 4)
        check('Una pestaña nueva aparece con fundido')

        until(lambda: abs(rail()['rail']['w'] - 36) <= 1)
        hover('#zero-rail')
        until(lambda: abs(rail()['rail']['w'] - 186) <= 1)
        delays = [float(t['delay'].split(',')[0].rstrip('ms').rstrip('s')) * (1 if t['delay'].endswith('ms') else 1000) for t in rail()['tabs']]
        steps = [round(b - a) for a, b in zip(delays, delays[1:])]
        assert all(step == 28 for step in steps), (delays, steps)
        check('Pasa de 36 a 186 con el ratón encima y los títulos entran escalonados')

        for k in (0, 2):
            hover(f'#zero-rail .zero-tab:nth-child({k + 1})')
            until(lambda: max(range(len(rail()['tabs'])), key=lambda i: rail()['tabs'][i]['s']) == k and rail()['tabs'][k]['s'] > 1.15)
        away()
        until(lambda: all(t['s'] == 1 for t in rail()['tabs']))
        check('El icono más cercano al ratón es el que más crece (efecto Dock)')

        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        until(lambda: rail()['opacity'] == 0)
        hover('#zero-edge')
        until(lambda: rail()['opacity'] == 1)
        away()
        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        until(lambda: rail()['opacity'] == 1)
        check('Con la web ampliada se aparta y vuelve al acercarse al borde izquierdo')

        driver.context('chrome')
        space = driver.script("""const done = arguments[arguments.length - 1];
            const { KitsuneSpaces } = ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs');
            KitsuneSpaces.create({ name: 'Para luego', color: 'violet' }).then(done, e => done('error: ' + e));""", [], asynchronous=True)
        assert space and not str(space).startswith('error'), space
        until(lambda: len(rail()['spaces']) == 2 and rail()['spaces'][0]['on'])
        driver.command('POST', f"/element/{list(element('#zero-rail .zero-space[data-space="%s"]' % space).values())[0]}/click", {})
        until(lambda: chrome("return ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs').KitsuneSpaces.active(window)") == space
              and rail()['spaces'][1]['on'], timeout=8)
        check('Con dos espacios o más, arriba salen sus iconos y un clic cambia de espacio')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
