"""Kitsune Zero · el marco, en el motor real (perfil temporal, sin ventana en pantalla).

1. Con el cristal del sistema, la raíz y el marco son transparentes (Gecko hace la ventana transparente).
2. La web es una tarjeta a 50/46/26/26 px de los bordes, con radio de 18 px (26 a la derecha y abajo: así
   el vidrio del canto se ve alrededor de toda la ventana también con una web, Risco 15-10).
3. Con la vista dividida de 2, son dos tarjetas separadas por 10 px.
4. Ampliar la deja a 0 px y radio 0; dejar de ampliar la devuelve. Mientras se anima, la web cambia
   de tamaño una sola vez (la animación es de transformación, no de márgenes), sin deformarse (la misma
   escala en horizontal y en vertical) y sin enseñar la web a medio repintar (Risco, 15-10: «los textos se
   deforman en 1 ms y hay 1, 2 o 3 fps que se rayan»): al empezar va encima una foto de cómo se veía, que se
   funde cuando la web ya tiene su tamaño nuevo, y al acabar no queda.
5. Los botones de ventana van en fila arriba a la izquierda, sin pegarse al borde (a 12 px o más de la
   curva de la esquina); el marco se arrastra y la web no.
   Con la web en tarjeta, los de ampliar y dividir van en el marco, a su derecha: no tapan la web.
6. Con el fondo de la web, detrás hay una foto de la web y la raíz ya no es transparente.
7. El velo del marco (alrededor de la tarjeta) toma el color de la web (rojo con una página roja).
8. Y el de lo que se ve, no el del principio de la página (azul con una página abierta en su parte azul).
9. Con la web ampliada, en reposo no queda nada encima de la web: ni la isla, ni los botones de ventana, ni
   los de ampliar, ni el pomodoro; solo un tirador fino pegado al filo de arriba, en el centro (la isla).
10. Cada cosa se queda donde estaba, escondida, y sale al llevar el puntero al filo de arriba encima de su
    sitio (decisión de Risco, 15-10): los de ventana arriba a la izquierda, los de ampliar a su derecha
    y la isla en el centro; al irse, se vuelven a guardar. El pomodoro no sale con la web ampliada.
11. Con el fondo de la web, si el marco queda claro, lo que va encima (el dominio de la isla) pasa a
    tinta; si queda oscuro, vuelve a blanco.
12. Con el fondo «auto», al entrar en Zero el fondo es desde el principio el que toca (con niri y su
    regla, el cristal del sistema): no pasa un momento por la foto de la web (un parpadeo oscuro).
13. Los botones de ampliar se pueden arrastrar a donde se quiera y se quedan allí (también al salir y
    volver a entrar en Zero); sus iconos, centrados en botones redondos.
14. Con el fondo del sistema, Zero es una lámina de cristal tipo Apple (decisiones de Risco del 15-10):
    la ventana con las esquinas redondeadas (48 px) y su borde como el de una pompa de jabón (la lámina,
    zero-pane: ver zero_pane_native): sin líneas dibujadas ni franjas con límites (captura 46), una luz
    que nace del filo y se funde hacia dentro sin volver a subir, la misma a la izquierda que a la
    derecha; transparente por dentro, sin velo. Ningún filo de las piezas es un anillo recortado con máscara (a escala 1 se veían
    los píxeles). Los botones de ventana se ven sobre blanco y sobre oscuro; el raíl,
    algo más presente sobre oscuro. Sus piezas, de cristal transparente: sobre
    blanco, la isla, el pomodoro abierto y los botones de ampliar se ven claros (sin tinte oscuro); el
    texto, blanco con un halo con el sistema en oscuro y en tinta (≥ 3:1) en claro. El panel de ajustes
    se lee (≥ 4,5:1) con blanco o negro detrás: cristal ahumado en oscuro, claro en claro; la marca de
    Kitsune se ve (≥ 0,85).
15. Salir de la web ampliada (Risco, 15-10): con Esc, si la web no lo usa (una web que lo usa para cerrar
    lo suyo se queda ampliada); con un vídeo a pantalla completa, Esc saca del vídeo y, en la misma
    pulsación, deja de ampliar. Y un atajo, Ctrl+Alt+F (se puede cambiar en «Atajos de teclado…»), que
    amplía y deja de ampliar.
16. Con la ventana transparente (el fondo del sistema), Kitsune no le dice al compositor que partes de la
    ventana son opacas (Wayland): al desampliar tras cambiar de app esa información se quedaba vieja y lo
    transparente salía negro (Risco, 15-10). Es para la sesión (no se guarda) y al salir de Zero vuelve.

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import http.server
import json
from pathlib import Path
import tempfile
import threading
import time
import urllib.parse

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness

PAGES = {
    '/rojo': '<!doctype html><meta charset=utf-8><title>Rojo</title><body style="margin:0;background:#c8553d"><h1 style="color:#fff">Rojo</h1>',
    '/claro': '<!doctype html><meta charset=utf-8><title>Claro</title><body style="margin:0;background:#fbfaf7"><p>Hola</p>',
    # Roja arriba y azul más abajo: abierta en #azul, lo que se ve es azul.
    '/abajo': '<!doctype html><meta charset=utf-8><title>Abajo</title><body style="margin:0"><div style="height:2400px;background:#c8553d"></div>'
              '<div id=azul style="height:3000px;background:#2f5fb8"></div>',
    # Una web que usa Esc para cerrar lo suyo (un diálogo).
    '/esc': '<!doctype html><meta charset=utf-8><title>Esc</title><body style="margin:0;background:#fbfaf7">'
            '<script>addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); document.title = "cerrado"; } })</script>',
    '/video': '<!doctype html><meta charset=utf-8><title>Video</title><body style="margin:0;background:#111">'
              '<div id=v style="width:400px;height:220px;background:#123"></div>'
              '<button id=b onclick="document.getElementById(\'v\').requestFullscreen()">Pantalla completa</button>',
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

        eventually(lambda: card_at(frame(), 50, 46, 26, 26, 0.5) and frame()['radius'] == '18px', timeout=5)
        check('La web es una tarjeta a 50/46/26/26 px de los bordes, con radio de 18 px')

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
        # Dejar de ampliar, fotograma a fotograma: la escala de la tarjeta y la foto de encima.
        driver.context('chrome')
        rec = driver.script("""const done = arguments[arguments.length - 1]; const out = []; const t0 = performance.now();
            const p = document.getElementById('tabbrowser-tabpanels');
            const step = () => { const m = new DOMMatrix(getComputedStyle(p).transform === 'none' ? '' : getComputedStyle(p).transform);
              const photo = document.getElementById('zero-flip-photo');
              out.push({ t: performance.now() - t0, sx: m.a, sy: m.d, photo: photo ? Number(getComputedStyle(photo).opacity) : null });
              if (performance.now() - t0 < 1100) requestAnimationFrame(step); else done(out); };
            document.querySelector('#zero-grow button[data-action=full]').click();
            requestAnimationFrame(step);""", [], asynchronous=True)
        moving = [f for f in rec if abs(f['sx'] - 1) > 0.001 or abs(f['sy'] - 1) > 0.001]
        skew = max((abs(f['sx'] - f['sy']) for f in moving), default=0)
        assert moving and skew <= 0.002, f'al dejar de ampliar la web se deforma (escalas distintas en x e y: {skew:.4f})'
        first = next(f for f in rec if f['photo'] is not None or f is moving[0])
        assert first['photo'] is not None and first['photo'] >= 0.95, f'al empezar no va la foto encima: {rec[:4]}'
        assert rec[-1]['photo'] is None, f'la foto se queda: {rec[-1]}'
        eventually(lambda: not frame()['full'] and card_at(frame(), 50, 46, 26, 26, 0.5) and frame()['radius'] == '18px', timeout=5)
        check('Ampliar la deja a 0 px y radio 0; dejar de ampliar la devuelve, sin deformar ni enseñar la web a medio repintar')

        f = frame()
        lights = f['lights']
        assert len(lights) == 3 and len({round(l['y']) for l in lights}) == 1, lights
        assert lights[0]['x'] < lights[1]['x'] < lights[2]['x'] and lights[0]['x'] < 40 and lights[0]['y'] < 30, lights
        # Lejos del filo (Risco, 15-10: «muy pegados al borde»): el primero, a 12 px o más de la curva de la
        # esquina (48 px de radio).
        c = (lights[0]['x'] + lights[0]['w'] / 2, lights[0]['y'] + lights[0]['h'] / 2)
        gap = 48 - ((48 - c[0]) ** 2 + (48 - c[1]) ** 2) ** 0.5 - lights[0]['w'] / 2
        assert gap >= 12, f'botones de ventana pegados al borde: {gap:.1f} px de la curva · {lights[0]}'
        # Lo mismo la marca de Kitsune, abajo a la izquierda.
        m = chrome("const r = document.getElementById('zero-mark').getBoundingClientRect(); return [r.left + r.width / 2, innerHeight - (r.top + r.height / 2), r.width / 2]")
        mark_gap = 48 - ((48 - m[0]) ** 2 + (48 - m[1]) ** 2) ** 0.5 - m[2]
        assert mark_gap >= 12, f'la marca, pegada al borde: {mark_gap:.1f} px de la curva · {m}'
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
            return { W: innerWidth, notch: seen('zero-notch'), lights: seen('zero-lights'), grow: seen('zero-grow'), island: seen('navigator-toolbox'),
                     pomo: (p => !!p && p.on && p.w > 0)(seen('zero-pomo')), full: document.documentElement.hasAttribute('zero-full') };"""
        def pointer(x, y):
            driver.context('chrome')
            driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'},
                                                             'actions': [{'type': 'pointerMove', 'origin': 'viewport', 'x': x, 'y': y}]}]})
        chrome("Services.prefs.setBoolPref('kitsune.zero.pomodoro', true)")
        eventually(lambda: chrome("return !!document.getElementById('zero-pomo')"), timeout=5)
        before = chrome(corner)  # dónde están con la tarjeta
        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        pointer(700, 600)
        def resting():
            c = chrome(corner)
            n = c['notch']
            return (c['full'] and n and n['on'] and n['h'] <= 6 and n['y'] <= 1 and abs((n['x'] + n['right']) / 2 - c['W'] / 2) <= 2
                    and not c['lights']['on'] and not c['grow']['on'] and not c['island']['on'] and not c['pomo'])
        try:
            eventually(resting, timeout=5)
        except AssertionError:
            raise AssertionError(chrome(corner)) from None
        check('Con la web ampliada, en reposo no queda nada encima de la web, salvo un tirador fino arriba en el centro')

        def reveal(name, x):
            pointer(int(x), 3)
            try:
                eventually(lambda: (c := chrome(corner))[name]['on'], timeout=5)
            except AssertionError:
                raise AssertionError(f'{name} no sale: {chrome(corner)}') from None
            c = chrome(corner)
            assert not c['pomo'], c
            pointer(700, 600)
            eventually(resting, timeout=5)
            return c
        # Los de ventana, en su sitio (arriba a la izquierda), sin moverse de donde estaban con la tarjeta.
        c = reveal('lights', (before['lights']['x'] + before['lights']['right']) / 2)
        assert abs(c['lights']['x'] - before['lights']['x']) <= 2 and c['lights']['y'] < 40, (before['lights'], c['lights'])
        c = reveal('grow', (before['grow']['x'] + before['grow']['right']) / 2)
        assert abs(c['grow']['x'] - before['grow']['x']) <= 2 and c['grow']['x'] < c['W'] / 2, (before['grow'], c['grow'])
        c = reveal('island', c['W'] / 2)
        assert c['island']['y'] < 20 and abs((c['island']['x'] + c['island']['right']) / 2 - c['W'] / 2) <= 2, c['island']
        check('Cada cosa se queda en su sitio, escondida, y sale con el puntero en el filo de arriba encima de ella; el pomodoro, no')
        chrome("document.querySelector('#zero-grow button[data-action=full]').click(); Services.prefs.clearUserPref('kitsune.zero.pomodoro')")

        ink = """const c = getComputedStyle(document.querySelector('#zero-host .zero-host-text')).color.match(/[\\d.]+/g).map(Number);
            return { attr: document.documentElement.hasAttribute('zero-frame-ink'), light: (c[0] + c[1] + c[2]) / 3 };"""
        driver.navigate(origin + '/claro')
        eventually(lambda: chrome(ink)['attr'] and chrome(ink)['light'] < 100, timeout=10)
        driver.navigate(origin + '/rojo')
        eventually(lambda: not chrome(ink)['attr'] and chrome(ink)['light'] > 200, timeout=10)
        check('Con el fondo de la web y el marco claro, lo de encima pasa a tinta; con el oscuro, a blanco')

        chrome("Services.prefs.setStringPref('kitsune.zero.backdrop', 'auto')")
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !document.documentElement.hasAttribute('zero')"), timeout=5)
        # Lo que toca en este ordenador: el cristal del sistema con niri y la regla de Zero; si no, la web.
        expected = chrome("""const niri = !!Services.env.get('NIRI_SOCKET');
            const rule = Services.dirsvc.get('Home', Ci.nsIFile); rule.append('.config'); rule.append('niri'); rule.append('kitsune-zero.kdl');
            return niri && rule.exists() ? 'system' : 'web';""")
        chrome("""window.__fondos = []; window.__vigia = new MutationObserver(() => { const v = document.documentElement.getAttribute('zero-backdrop'); if (v) window.__fondos.push(v); });
            window.__vigia.observe(document.documentElement, { attributes: true, attributeFilter: ['zero-backdrop'] });
            document.getElementById('kitsune-zero-key').doCommand();""")
        eventually(lambda: chrome("return document.documentElement.getAttribute('zero-backdrop')") == expected, timeout=5)
        time.sleep(0.5)
        seen = chrome("window.__vigia.disconnect(); return window.__fondos")
        assert seen and all(v == expected for v in seen), (expected, seen)
        check('Con el fondo «auto», al entrar en Zero el fondo es desde el principio el que toca')

        # Arrastrar los de ampliar 300 px a la derecha y 200 abajo: se quedan allí, también al volver a entrar.
        pointer(60, 60)  # con la tarjeta salen al acercarse a su rincón
        eventually(lambda: chrome(corner)['grow']['on'], timeout=5)
        g = chrome(corner)['grow']
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [
            {'type': 'pointerMove', 'origin': 'viewport', 'x': int(g['x'] + 4), 'y': int(g['y'] + g['h'] / 2)}, {'type': 'pointerDown', 'button': 0}]
            + [{'type': 'pointerMove', 'origin': 'viewport', 'x': int(g['x'] + 4 + 30 * i), 'y': int(g['y'] + g['h'] / 2 + 20 * i), 'duration': 20} for i in range(1, 11)]
            + [{'type': 'pointerUp', 'button': 0}]}]})
        driver.command('DELETE', '/actions')
        moved = lambda: (m := chrome(corner)['grow']) and abs(m['x'] - (g['x'] + 300)) <= 6 and abs(m['y'] - (g['y'] + 200)) <= 6
        try:
            eventually(moved, timeout=5)
        except AssertionError:
            raise AssertionError(f'arrastrar: antes {g}, ahora {chrome(corner)["grow"]}') from None
        assert not chrome("return document.documentElement.hasAttribute('zero-full')"), 'arrastrar no es pulsar'
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !document.documentElement.hasAttribute('zero')"), timeout=5)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !!document.getElementById('zero-grow')"), timeout=5)
        pointer(int(g['x'] + 300 + g['w'] / 2), int(g['y'] + 200 + g['h'] / 2))
        eventually(moved, timeout=5)
        round_ok = chrome("return [...document.querySelectorAll('#zero-grow > button')].every(b => { const r = b.getBoundingClientRect(); return Math.abs(r.width - r.height) < 1; })")
        assert round_ok, 'botones de ampliar redondos'
        chrome("Services.prefs.clearUserPref('kitsune.zero.growAt')")
        pointer(700, 600)
        check('Los botones de ampliar se arrastran a donde se quiera y se quedan allí')

        # Sin pantalla no hay compositor: detrás de la ventana, blanco (el peor caso para el texto blanco).
        from PIL import Image
        chrome("Services.prefs.setStringPref('kitsune.zero.backdrop', 'system')")
        eventually(lambda: chrome("return innerWidth") == 1540 and chrome("return document.documentElement.getAttribute('zero-backdrop')") == 'system', timeout=5)
        def lum(c):
            v = [x / 255 for x in c[:3]]
            v = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in v]
            return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
        def glass(selector, inset, text_selector):
            """La luz media del cristal (una franja sin texto) en la captura, y el color y halo de su texto."""
            box = chrome(f"const p = document.querySelector('{selector}'); const r = p.getBoundingClientRect(); const t = getComputedStyle(document.querySelector('{text_selector}')); return [r.left, r.top, r.right, r.bottom, devicePixelRatio, t.color, t.textShadow]")
            shot = Image.open(driver.screenshot('cristal.png', chrome=True)).convert('RGB')
            k = box[4]; x0, y0, x1, y1 = inset
            strip = shot.crop((int((box[0] + x0) * k), int((box[1] + y0) * k), int((box[0] + x1) * k), int((box[1] + y1) * k)))
            values = sorted(lum(c) for c in strip.getdata())
            background = values[len(values) // 2]
            text = [int(x) for x in box[5][box[5].index('(') + 1:-1].split(',')[:3]]
            light, dark = max(background, lum(text)), min(background, lum(text))
            return {'light': background, 'ratio': (light + 0.05) / (dark + 0.05), 'text': text, 'halo': box[6] not in ('none', '')}
        def clear_glass(g, dark):
            # Claro sobre blanco (nada de tinte oscuro); el texto, blanco con halo o en tinta legible.
            return g['light'] >= 0.7 and ((dark and min(g['text']) >= 240 and g['halo']) or (not dark and g['ratio'] >= 3.0))
        # La lámina (captura 45 de Risco): un cristal grueso encima. Se mide sobre un gris oscuro liso detrás
        # (una hoja de agente, solo para la foto; sin pantalla, detrás hay blanco y la luz no se ve).
        # Las esquinas de la lámina, de 48 px como en la maqueta elegida: el canto no es más ancho que la
        # curva (si lo fuera, el doblez se parte en la diagonal).
        assert float(chrome("return parseFloat(getComputedStyle(document.body).borderTopLeftRadius)")) == 48
        GREY = 42
        dark_sheet = 'data:text/css,' + urllib.parse.quote(f':root {{ background: rgb({GREY}, {GREY}, {GREY}) !important; }}')
        def photo(name):
            img = Image.open(driver.screenshot(name, chrome=True)).convert('L')
            k = chrome("return devicePixelRatio")
            W, H = chrome("return [innerWidth, innerHeight]")
            def row(x0, x1, y):
                """Los grises de x0 a x1 (px CSS) en la fila y (media de 5 filas)."""
                return [sum(img.getpixel((int(x * k), int((y + d) * k))) for d in (-2, -1, 0, 1, 2)) / 5 for x in range(int(x0), int(x1))]
            return img, k, W, H, row
        lines = chrome("""const out = [];
            for (const p of [null, '::before', '::after']) {
              const cs = getComputedStyle(document.body, p);
              if (p && cs.content === 'none') continue;
              for (const layer of cs.boxShadow.split(/,(?![^(]*\\))/)) {
                const n = layer.replace(/rgba?\\([^)]*\\)/, '').match(/-?[\\d.]+px/g) || [];
                if (layer.includes('inset') && parseFloat(n[2] ?? '0') < 1) out.push([p, layer.trim()]);
              }
              if (p && parseFloat(cs.borderTopWidth) > 0) out.push([p, 'border ' + cs.borderTopWidth]);
            }
            return out;""")
        assert not lines, f'la lámina dibuja líneas (sombras sin desenfoque o bordes): {lines}'
        def lamina():
            img, k, W, H, row = photo('lamina.png')
            y = H * 0.25
            left, right = row(0, 40, y), row(W - 40, W, y)[::-1]  # la derecha, contada desde su filo
            return {
                'rim': (max(left[0:3]), max(right[0:3])),
                'glow': (sum(left[1:6]) / 5, sum(right[1:6]) / 5), 'behind': left[30],
                # Se funde: desde el filo hacia dentro, la luz no vuelve a subir (ni línea ni franja).
                'rise': max(left[i + 1] - left[i] for i in range(3, 39)),
                'middle': max(row(0, 3, H * 0.5)),
            }
        chrome("window.windowUtils.loadSheetUsingURIString(arguments[0], window.windowUtils.AGENT_SHEET)", [dark_sheet])
        try:
            time.sleep(0.4)
            lam = lamina()
            fused = lam['glow'][0] >= lam['behind'] + 3 and lam['rise'] <= 3
            even = abs(lam['rim'][0] - lam['rim'][1]) <= 12 and abs(lam['glow'][0] - lam['glow'][1]) <= 6
            assert fused and even, f'el borde no se funde (o no es igual a los dos lados): {lam}'
            # Los botones de ventana, sobre oscuro: claros.
            img, k, W, H, row = photo('botones-oscuro.png')
            light = chrome("const r = document.querySelector('#zero-lights > button').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]")
            on_dark = img.getpixel((int(light[0] * k), int(light[1] * k)))
            assert on_dark >= 200, f'botones de ventana sobre oscuro: {on_dark}'
            # El raíl, algo más presente sobre oscuro (su cristal, junto a su borde, sin iconos).
            rail = chrome("const r = document.getElementById('zero-rail').getBoundingClientRect(); return [r.left, r.top + r.height / 2]")
            glass_rail = sum(row(rail[0] + 2, rail[0] + 5, rail[1])) / 3
            assert glass_rail >= GREY + 18, f'el raíl casi no se ve sobre oscuro: {glass_rail}'
        finally:
            chrome("window.windowUtils.removeSheetUsingURIString(arguments[0], window.windowUtils.AGENT_SHEET)", [dark_sheet])
        # Y sobre blanco: su contorno se ve.
        time.sleep(0.4)
        img, k, W, H, row = photo('botones-blanco.png')
        box = chrome("const r = document.querySelector('#zero-lights > button').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]")
        on_white = min(img.getpixel((int(x * k), int(y * k))) for x in range(int(box[0]) - 2, int(box[2]) + 2) for y in range(int(box[1]) - 2, int(box[3]) + 3))
        assert on_white <= 205, f'botones de ventana sobre blanco: {on_white}'
        masked = chrome("""const pieces = [document.body, ...['nav-bar', 'zero-rail', 'zero-grow'].map(id => document.getElementById(id))];
            return pieces.flatMap(el => ['::before', '::after'].map(p => [el.id || el.localName, p, getComputedStyle(el, p).maskComposite]))
                         .filter(([, , c]) => c.includes('exclude') || c.includes('subtract') || c.includes('intersect'));""")
        assert not masked, f'filos recortados con máscara (se ven los píxeles): {masked}'
        chrome("Services.prefs.setBoolPref('kitsune.zero.pomodoro', true)")
        eventually(lambda: chrome("return !!document.getElementById('zero-pomo')"), timeout=5)
        veil = "return getComputedStyle(document.getElementById('tabbrowser-tabbox')).backgroundColor"
        assert chrome(veil) in ('rgba(0, 0, 0, 0)', 'transparent'), f'velo del marco: {chrome(veil)}'
        for dark in (1, 0):
            chrome(f"Services.prefs.setIntPref('ui.systemUsesDarkTheme', {dark})")
            eventually(lambda: chrome("return matchMedia('(prefers-color-scheme: dark)').matches") == bool(dark), timeout=5)
            pieces = {'isla': ('#nav-bar', (12, 10, 26, 22), '#zero-host'), 'ampliar': ('#zero-grow', (4, 4, 10, 10), '#zero-grow')}
            for name, (selector, inset, text) in pieces.items():
                if name == 'ampliar':
                    pointer(70, 70)  # los botones de ampliar salen al acercarse
                    eventually(lambda: float(chrome("return getComputedStyle(document.getElementById('zero-grow')).opacity")) > 0.9, timeout=5)
                try:
                    eventually(lambda: clear_glass(glass(selector, inset, text), dark), timeout=5)
                except AssertionError:
                    raise AssertionError(f'{name} con el sistema {"oscuro" if dark else "claro"}: {glass(selector, inset, text)}') from None
            pointer(chrome("const r = document.getElementById('zero-pomo').getBoundingClientRect(); return r.left + r.width / 2"), 20)
            eventually(lambda: chrome("return document.getElementById('zero-pomo').getBoundingClientRect().width") > 120, timeout=5)
            try:
                eventually(lambda: clear_glass(glass('#zero-pomo', (10, 3, 22, 7), '#zero-pomo .zero-pomo-label'), dark), timeout=5)
            except AssertionError:
                raise AssertionError(f'pomodoro con el sistema {"oscuro" if dark else "claro"}: {glass("#zero-pomo", (10, 3, 22, 7), "#zero-pomo .zero-pomo-label")}') from None
            pointer(700, 600)
        mark = "return Number(getComputedStyle(document.getElementById('zero-mark')).opacity)"
        eventually(lambda: chrome(mark) >= 0.85, timeout=5)
        # El panel de ajustes se lee haya lo que haya detrás (blanco o negro), en los dos modos.
        panel = """const p = document.getElementById('zero-settings'); const cs = getComputedStyle(p);
            return { bg: cs.backgroundColor.match(/[\\d.]+/g).map(Number), text: cs.color.match(/[\\d.]+/g).map(Number) };"""
        def legible(behind):
            q = chrome(panel)
            a = q['bg'][3] if len(q['bg']) > 3 else 1
            bg = [q['bg'][i] * a + behind * (1 - a) for i in range(3)]
            l1, l2 = lum(bg), lum(q['text'])
            return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)
        for dark in (1, 0):
            chrome(f"Services.prefs.setIntPref('ui.systemUsesDarkTheme', {dark})")
            eventually(lambda: chrome("return matchMedia('(prefers-color-scheme: dark)').matches") == bool(dark), timeout=5)
            assert legible(255) >= 4.5 and legible(0) >= 4.5, f'panel de ajustes {"oscuro" if dark else "claro"}: {chrome(panel)} · {legible(255):.1f} / {legible(0):.1f}'
        chrome("Services.prefs.clearUserPref('kitsune.zero.pomodoro')")
        chrome("Services.prefs.clearUserPref('ui.systemUsesDarkTheme')")
        check('Con el fondo del sistema, Zero es una lámina de cristal redondeada y sus piezas de cristal transparente')

        # Salir de la web ampliada: Esc (pulsado con la web delante, como de verdad) y el atajo.
        full = lambda: chrome("return document.documentElement.hasAttribute('zero-full')")
        def esc():
            chrome("gBrowser.selectedBrowser.focus()")
            driver.context('chrome')
            driver.command('POST', '/actions', {'actions': [{'type': 'key', 'id': 'teclado', 'actions': [{'type': 'keyDown', 'value': '\ue00c'}, {'type': 'keyUp', 'value': '\ue00c'}]}]})
        assert chrome("return document.getElementById('kitsune-zero-full-key')?.getAttribute('modifiers')") == 'accel,alt', 'falta el atajo de ampliar'
        def ctrl_alt_f():
            chrome("gBrowser.selectedBrowser.focus()")
            driver.context('chrome')
            down = [{'type': 'keyDown', 'value': k} for k in ('\ue009', '\ue00a', 'f')]
            up = [{'type': 'keyUp', 'value': k} for k in ('f', '\ue00a', '\ue009')]
            driver.command('POST', '/actions', {'actions': [{'type': 'key', 'id': 'teclado', 'actions': down + up}]})
            driver.command('DELETE', '/actions')
        ctrl_alt_f()
        eventually(full, timeout=5)
        ctrl_alt_f()
        eventually(lambda: not full(), timeout=5)
        ctrl_alt_f()
        eventually(full, timeout=5)
        esc()
        eventually(lambda: not full(), timeout=5)
        driver.navigate(origin + '/esc')
        chrome("document.getElementById('kitsune-zero-full-key').doCommand()")
        eventually(full, timeout=5)
        esc()
        driver.context('content')
        eventually(lambda: driver.script('return document.title') == 'cerrado', timeout=5)
        time.sleep(0.6)
        assert full(), 'la web usó Esc (cerraba lo suyo) y aun así dejó de ampliar'
        driver.navigate(origin + '/video')
        assert full()
        driver.context('content')
        element = driver.command('POST', '/element', {'using': 'css selector', 'value': '#b'})
        driver.command('POST', f"/element/{list(element.values())[0]}/click", {})
        eventually(lambda: chrome("return document.documentElement.hasAttribute('inDOMFullscreen')"), timeout=5)
        esc()
        eventually(lambda: not chrome("return document.documentElement.hasAttribute('inDOMFullscreen')") and not full(), timeout=5)
        check('Esc deja de ampliar (si la web no lo usa) y, con un vídeo a pantalla completa, sale de las dos; Ctrl+Alt+F amplía y deja de ampliar')

        opaque = "return [Services.prefs.getDefaultBranch('').getBoolPref('widget.wayland.opaque-region.enabled', true), Services.prefs.prefHasUserValue('widget.wayland.opaque-region.enabled')]"
        chrome("Services.prefs.setStringPref('kitsune.zero.backdrop', 'system')")
        eventually(lambda: chrome(opaque) == [False, False], timeout=5)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !document.documentElement.hasAttribute('zero')") and chrome(opaque) == [True, False], timeout=5)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome(opaque) == [False, False], timeout=5)
        check('Con la ventana transparente, sin regiones opacas para el compositor (solo en la sesión; al salir, vuelve)')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
