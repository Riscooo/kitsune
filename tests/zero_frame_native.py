"""Kitsune Zero · el marco, en el motor real (perfil temporal, sin ventana en pantalla).

1. Con el cristal del sistema, la raíz y el marco son transparentes (Gecko hace la ventana transparente).
2. La web es una tarjeta a 50/46/12/12 px de los bordes, con radio de 18 px.
3. Con la vista dividida de 2, son dos tarjetas separadas por 10 px.
4. Ampliar la deja a 0 px y radio 0; dejar de ampliar la devuelve. Mientras se anima, la web cambia
   de tamaño una sola vez (la animación es de transformación, no de márgenes).
5. Los botones de ventana van en fila arriba a la izquierda; el marco se arrastra y la web no.
   Con la web en tarjeta, los de ampliar y dividir van en el marco, a su derecha: no tapan la web.
6. Con el fondo de la web, detrás hay una foto de la web y la raíz ya no es transparente.
7. El velo del marco (alrededor de la tarjeta) toma el color de la web (rojo con una página roja).
8. Y el de lo que se ve, no el del principio de la página (azul con una página abierta en su parte azul).
9. Con la web ampliada, en reposo solo queda un tirador fino pegado al filo de arriba, en la esquina
   derecha (la zona que menos usan las webs, según tools/zonas_web.py): ni los botones de ventana ni
   los de ampliar tapan la web.
10. Al acercarse a esa esquina salen juntos los de ventana y los de ampliar y dividir, y al irse se
    vuelven a guardar.

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

PAGES = {
    '/rojo': '<!doctype html><meta charset=utf-8><title>Rojo</title><body style="margin:0;background:#c8553d"><h1 style="color:#fff">Rojo</h1>',
    '/claro': '<!doctype html><meta charset=utf-8><title>Claro</title><body style="margin:0;background:#fbfaf7"><p>Hola</p>',
    # Roja arriba y azul más abajo: abierta en #azul, lo que se ve es azul.
    '/abajo': '<!doctype html><meta charset=utf-8><title>Abajo</title><body style="margin:0"><div style="height:2400px;background:#c8553d"></div>'
              '<div id=azul style="height:3000px;background:#2f5fb8"></div>',
}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = PAGES.get(self.path, 'no')
        self.send_response(200 if self.path in PAGES else 404)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *args):
        pass


FRAME = """
const box = el => { const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
const cs = el => getComputedStyle(el);
const dragging = el => { let value = ''; for (const rule of InspectorUtils.getMatchingCSSRules(el)) { const m = /-moz-window-dragging:\s*([\w-]+)/.exec(rule.cssText); if (m) value = m[1]; } return value; };
const panels = document.getElementById('tabbrowser-tabpanels');
const card = gBrowser.selectedBrowser.closest('.browserSidebarContainer');
const active = [...panels.querySelectorAll('.browserSidebarContainer')].filter(p => p.classList.contains('deck-selected') || p.classList.contains('split-view-panel-active'));
const lights = [...document.querySelectorAll('#zero-lights > button')].map(box);
const backdrop = document.getElementById('zero-backdrop');
return {
  W: innerWidth, H: innerHeight, panels: box(panels), card: box(card), radius: cs(card).borderTopLeftRadius,
  cards: active.map(box).sort((a, b) => a.x - b.x),
  root: cs(document.documentElement).backgroundColor, body: cs(document.body).backgroundColor,
  browser: cs(document.getElementById('browser')).backgroundColor,
  // -moz-window-dragging es solo de chrome y no sale por CSSOM: se lee del texto de la última regla que casa (la que gana).
  drag: dragging(document.getElementById('browser')), webDrag: dragging(panels),
  lights, full: document.documentElement.hasAttribute('zero-full'),
  mode: document.documentElement.getAttribute('zero-backdrop'),
  backdrop: !!backdrop, painted: backdrop?.dataset.painted === '1',
  tint: cs(document.getElementById('tabbrowser-tabbox')).backgroundColor,
  grow: [...document.querySelectorAll('#zero-grow button')].map(b => b.dataset.action),
};
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-frame-'))
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

    def frame():
        return chrome(FRAME)

    def near(a, b, tolerance=1.5):
        return abs(a - b) <= tolerance

    def card_at(f, left, top, right, bottom, tolerance=1.5):
        p = f['panels']
        return (near(p['x'], left, tolerance) and near(p['y'], top, tolerance) and near(f['W'] - (p['x'] + p['w']), right, tolerance)
                and near(f['H'] - (p['y'] + p['h']), bottom, tolerance))

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        chrome("Services.prefs.setStringPref('kitsune.zero.backdrop', 'system')")
        driver.navigate(origin + '/rojo')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")

        eventually(lambda: frame()['mode'] == 'system', timeout=5)
        # El marco se aclara con su transición (las de Kitsune incluidas): se espera a que acabe.
        eventually(lambda: all(frame()[k] == 'rgba(0, 0, 0, 0)' for k in ('root', 'body', 'browser')), timeout=5)
        check('Con el cristal del sistema, la raíz y el marco son transparentes')

        eventually(lambda: card_at(frame(), 50, 46, 12, 12, 0.5) and frame()['radius'] == '18px', timeout=5)
        check('La web es una tarjeta a 50/46/12/12 px de los bordes, con radio de 18 px')

        chrome("const t = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });"
               "gBrowser.addTabSplitView([gBrowser.selectedTab, t]);", [origin + '/claro'])
        eventually(lambda: len(frame()['cards']) == 2, timeout=10)
        a, b = frame()['cards']
        assert near(b['x'] - (a['x'] + a['w']), 10, 2), (a, b)
        check('Con la vista dividida de 2, son dos tarjetas separadas por 10 px')
        chrome("gBrowser.selectedTab.splitview.unsplitTabs(); gBrowser.removeTab(gBrowser.tabs.at(-1))")
        eventually(lambda: len(frame()['cards']) == 1, timeout=10)

        assert 'full' in frame()['grow'], frame()
        # Se graba el tamaño de la web en cada fotograma mientras se amplía.
        driver.context('chrome')
        sizes = driver.script("""const done = arguments[arguments.length - 1]; const sizes = new Set(); const t0 = performance.now();
            const step = () => { const b = gBrowser.selectedBrowser; sizes.add(b.clientWidth + '×' + b.clientHeight);
              if (performance.now() - t0 < 900) requestAnimationFrame(step); else done([...sizes]); };
            requestAnimationFrame(step);
            document.querySelector('#zero-grow button[data-action=full]').click();""", [], asynchronous=True)
        assert len(sizes) <= 2, sizes
        eventually(lambda: frame()['full'] and card_at(frame(), 0, 0, 0, 0, 0.5) and frame()['radius'] == '0px', timeout=5)
        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        eventually(lambda: not frame()['full'] and card_at(frame(), 50, 46, 12, 12, 0.5) and frame()['radius'] == '18px', timeout=5)
        check('Ampliar la deja a 0 px y radio 0; dejar de ampliar la devuelve')

        f = frame()
        lights = f['lights']
        assert len(lights) == 3 and len({round(l['y']) for l in lights}) == 1, lights
        assert lights[0]['x'] < lights[1]['x'] < lights[2]['x'] and lights[0]['x'] < 40 and lights[0]['y'] < 30, lights
        assert f['drag'] == 'drag' and f['webDrag'] == 'no-drag', f
        grow = chrome("const r = document.getElementById('zero-grow').getBoundingClientRect(); return { x: r.left, y: r.top, right: r.right, bottom: r.bottom }")
        assert grow['bottom'] <= f['panels']['y'] and grow['x'] > lights[2]['x'] + lights[2]['w'], (grow, f['panels'], lights)
        check('Los botones de ventana van en fila arriba a la izquierda (y los de ampliar, en el marco a su derecha); el marco se arrastra y la web no')

        chrome("Services.prefs.setStringPref('kitsune.zero.backdrop', 'web')")
        eventually(lambda: frame()['mode'] == 'web' and frame()['backdrop'] and frame()['painted'], timeout=10)
        assert frame()['root'] != 'rgba(0, 0, 0, 0)', frame()
        check('Con el fondo de la web, detrás hay una foto de la web y la raíz ya no es transparente')

        def tint_rgb():
            # rgb(r, g, b[, a]) o color(srgb r g b / a), que es como sale un color-mix()
            tint = frame()['tint'] or ''
            inside = tint[tint.find('(') + 1:tint.rfind(')')].split('/')[0].replace(',', ' ').split()
            if inside and inside[0] == 'srgb':
                return tuple(float(x) * 255 for x in inside[1:4])
            if len(inside) >= 3:
                return tuple(float(x) for x in inside[:3])
            return None

        def reddish():
            rgb = tint_rgb()
            return rgb is not None and rgb[0] > rgb[2] + 60
        eventually(reddish, timeout=10)
        check('El velo toma el color de la web (rojo con una página roja)')

        driver.navigate(origin + '/abajo#azul')
        try:
            eventually(lambda: (rgb := tint_rgb()) is not None and rgb[2] > rgb[0] + 30, timeout=10)
        except AssertionError:
            raise AssertionError(f'velo {frame()["tint"]}') from None
        check('El velo toma el color de lo que se ve, no el del principio de la página')

        corner = """const seen = id => { const el = document.getElementById(id); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
              return { x: r.left, y: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height, on: Number(cs.opacity) > 0.5 && cs.visibility !== 'hidden' }; };
            return { W: innerWidth, notch: seen('zero-notch'), lights: seen('zero-lights'), grow: seen('zero-grow'), full: document.documentElement.hasAttribute('zero-full') };"""
        def pointer(x, y):
            driver.context('chrome')
            driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'},
                                                             'actions': [{'type': 'pointerMove', 'origin': 'viewport', 'x': x, 'y': y}]}]})
        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        pointer(700, 600)
        def resting():
            c = chrome(corner)
            n = c['notch']
            return (c['full'] and n and n['on'] and n['h'] <= 6 and n['y'] <= 1 and c['W'] - n['right'] <= 16
                    and not c['lights']['on'] and not c['grow']['on'])
        try:
            eventually(resting, timeout=5)
        except AssertionError:
            raise AssertionError(chrome(corner)) from None
        check('Con la web ampliada, en reposo solo queda un tirador fino en el filo de arriba, a la derecha')

        c = chrome(corner)
        pointer(c['W'] - 30, 4)
        def revealed():
            c = chrome(corner)
            return (c['lights']['on'] and c['grow']['on'] and not c['notch']['on']
                    and c['lights']['x'] > c['W'] / 2 and c['grow']['x'] > c['W'] / 2 and c['lights']['y'] < 40 and c['grow']['y'] < 40)
        try:
            eventually(revealed, timeout=5)
        except AssertionError:
            raise AssertionError(chrome(corner)) from None
        pointer(700, 600)
        eventually(resting, timeout=5)
        check('Al acercarse a la esquina salen juntos los de ventana y los de ampliar, y luego se guardan')
        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
