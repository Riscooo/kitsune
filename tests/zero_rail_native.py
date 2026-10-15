"""Kitsune Zero · el raíl (las pestañas, a la izquierda), en el motor real (perfil temporal, sin ventana en pantalla).

1. Tiene un icono redondo por pestaña visible (su favicon o su inicial), en orden, con las fijadas arriba.
2. Un clic selecciona la pestaña y el clic central la cierra.
3. Una pestaña nueva aparece con fundido.
4. Pasa de 36 a 186 de ancho con el ratón encima, y los títulos entran escalonados (28 ms).
5. Con el ratón encima, el icono más cercano es el que más crece (efecto Dock).
6. Con la web ampliada se aparta (opacidad 0) y vuelve al acercarse al borde izquierdo.
7. Con dos espacios o más, arriba salen sus iconos y un clic cambia de espacio.
8. La vista rápida de Kitsune no sale en el raíl (es de paso) y flota encima de la tarjeta.
9. Con el raíl abierto, la fila bajo el ratón enseña una × que cierra esa pestaña sin elegirla; con el
   raíl cerrado no sale.
10. El clic derecho en una pestaña abre el menú de pestaña de Gecko para esa pestaña, con sus textos y
    el aspecto del menú ≡ de Zero.
11. Una pestaña que suena lleva un altavoz en su icono; un clic en él la silencia (y otro le devuelve el
    sonido) sin elegirla. Su pulso, que dura lo que la música, solo anima opacidad y transform (el
    compositor), sin repintar en cada fotograma.
12. Un grupo de pestañas de Gecko lleva una fila propia (un círculo de su color; abierto el raíl, su
    nombre) y sus pestañas, una raya de su color. Un clic en la fila lo pliega (sus pestañas se van y el
    círculo dice cuántas tiene) y otro lo despliega (o Intro, con el teclado); si lo pliega Gecko, el
    raíl también se entera.
13. Con el teclado (Tab por sus filas) el raíl se abre con los títulos, como con el ratón; al volver a
    la web, se cierra. Un clic de ratón no lo deja abierto.
14. Un favicon claro sobre transparente (como el de GitHub con el sistema en oscuro: el gato blanco) va
    en un círculo oscuro, que si no es blanco sobre blanco y no se ve; uno oscuro, en el claro de siempre.
15. Sin bocadillos nativos encima del raíl abierto (que ya enseña los títulos): las filas llevan su nombre
    en aria-label, no en title.
16. Un enlace soltado en el raíl se abre en una pestaña nueva, como en la barra de pestañas de Kitsune;
    uno «javascript:», no.
17. Una pestaña de fondo que cambia de título (un chat con mensajes nuevos) o pide atención lleva un
    punto en su icono, como las fijadas de Kitsune; al elegirla, se va.
18. Varias a la vez, como en la barra de pestañas: Ctrl + clic añade o quita una, Mayús + clic marca un
    tramo, y se ven marcadas; un clic normal deja solo esa.
19. Una pestaña descargada de memoria (menú de pestaña → Descargar) lleva el icono apagado, como en la
    barra de pestañas de Kitsune; al volver a ella, se enciende.
20. La pestaña que usa la cámara, el micrófono o comparte la pantalla lleva un punto de su color (verde,
    naranja, rojo, como en la isla) en la esquina de arriba a la izquierda de su icono; al apagarse, se va.
21. Elegir una pestaña repinta solo las filas que cambian (la que se deja y la elegida), no todas: con
    muchas pestañas, repintarlas todas costaba más que un fotograma a 240 Hz. Y la isla, una vez (no una
    por cada aviso de Gecko: como mucho dos).

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

TITLES = {'/kioto': 'Kioto', '/nara': 'Nara', '/osaka': 'Osaka', '/kobe': 'Kobe', '/uji': 'Uji', '/descargada': 'Descargada'}


# Un gato blanco sobre transparente (lo que pinta GitHub con el sistema en oscuro) y uno negro.
ICONS = {'/blanco.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="#fff"/></svg>',
         '/negro.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="#111"/></svg>'}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/chat':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write('<!doctype html><meta charset=utf-8><title>Chat</title><script>setTimeout(() => document.title = "(1) Chat", 2500)</script>'.encode())
            return
        if self.path in ICONS:
            self.send_response(200)
            self.send_header('Content-Type', 'image/svg+xml')
            self.end_headers()
            self.wfile.write(ICONS[self.path].encode())
            return
        if self.path in ('/gato-blanco', '/gato-negro'):
            color = self.path.split('-')[1]
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(f'<!doctype html><meta charset=utf-8><title>Gato {color}</title><link rel=icon href="/{color}.svg"><h1>Gato</h1>'.encode())
            return
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

        # Las del espacio anterior se desvanecen antes de irse: se cuenta cuando ya no están.
        until(lambda: len(rail()['tabs']) == len(rail()['gecko']))
        count = len(rail()['tabs'])
        under = chrome("return gBrowser.selectedTab.label")
        chrome("ChromeUtils.importESModule('chrome://browser/content/kitsune-glance.sys.mjs').KitsuneGlance.open(window, arguments[0])", [origin + '/nara'])
        glance = """const panel = document.querySelector('#tabbrowser-tabpanels [kitsune-glance-panel]');
            const card = document.getElementById('tabbrowser-tabpanels').getBoundingClientRect();
            const r = panel?.getBoundingClientRect();
            return panel ? { inside: r.left > card.left + 20 && r.right < card.right - 20 && r.top > card.top + 10 && r.bottom < card.bottom - 10,
                             round: parseFloat(getComputedStyle(panel).borderTopLeftRadius) >= 12 } : null;"""
        until(lambda: (g := chrome(glance)) is not None and g['inside'] and g['round'], timeout=8)
        until(lambda: len(rail()['tabs']) == count and [t['title'] for t in rail()['tabs'] if t['on']] == [under])
        check('La vista rápida no sale en el raíl y flota encima de la tarjeta')

        chrome("gBrowser.selectedTab.splitview?.unsplitTabs?.()")
        for path in ('/osaka', '/uji'):
            add_tab(path)
        until(lambda: len(rail()['tabs']) >= 3)
        closer = """const rows = [...document.querySelectorAll('#zero-rail .zero-tab')];
            return rows.map(row => { const x = row.querySelector('.zero-close'); const cs = x && getComputedStyle(x); const r = x?.getBoundingClientRect();
              return { title: row.querySelector('.zero-tt').textContent, seen: !!x && Number(cs.opacity) > 0.4 && r.width > 8 && cs.visibility !== 'hidden' }; });"""
        away()
        until(lambda: not any(row['seen'] for row in chrome(closer)))
        hover('#zero-rail .zero-tab:last-child')
        until(lambda: abs(rail()['rail']['w'] - 186) <= 1)
        rows = chrome(closer)
        until(lambda: [row['seen'] for row in chrome(closer)] == [False] * (len(rows) - 1) + [True])
        selected = chrome("return gBrowser.selectedTab.label")
        doomed = rows[-1]['title']
        driver.command('POST', f"/element/{list(element('#zero-rail .zero-tab:last-child .zero-close').values())[0]}/click", {})
        until(lambda: doomed not in [t['title'] for t in rail()['tabs']] and chrome("return gBrowser.selectedTab.label") == selected, timeout=6)
        check('Con el raíl abierto, la × de la fila bajo el ratón cierra esa pestaña sin elegirla')

        away()
        target = rail()['tabs'][1]['title']
        pointer([{'type': 'pointerMove', 'origin': element('#zero-rail .zero-tab:nth-child(2)'), 'x': 0, 'y': 0},
                 {'type': 'pointerDown', 'button': 2}, {'type': 'pointerUp', 'button': 2}])
        until(lambda: chrome("return document.getElementById('tabContextMenu').state") == 'open')
        assert chrome("return TabContextMenu.contextTab?.label") == target, chrome("return TabContextMenu.contextTab?.label")
        # Con sus textos: Gecko los carga al abrirlo desde su barra de pestañas; desde el raíl también.
        labels = "return ['context_reloadTab', 'context_pinTab', 'context_duplicateTab', 'context_closeTab'].map(id => document.getElementById(id)?.label ?? '')"
        try:
            until(lambda: all(chrome(labels)))
        except AssertionError:
            raise AssertionError(f'menú de pestaña sin textos: {chrome(labels)}') from None
        # Y con el aspecto del menú ≡ de Zero: hoja clara y opaca de esquinas redondas, filas redondeadas.
        look = chrome("""const m = document.getElementById('tabContextMenu'); const c = getComputedStyle(m.shadowRoot?.querySelector('[part~=content]') ?? m);
            const row = getComputedStyle(document.getElementById('context_reloadTab')); const bg = c.backgroundColor.match(/[\\d.]+/g).map(Number);
            return { radius: parseFloat(c.borderTopLeftRadius), bg, row: parseFloat(row.borderTopLeftRadius) };""")
        assert look['radius'] >= 12 and look['row'] >= 6 and sum(look['bg'][:3]) / 3 > 225 and (len(look['bg']) == 3 or look['bg'][3] == 1), look
        chrome("document.getElementById('tabContextMenu').hidePopup()")
        until(lambda: chrome("return document.getElementById('tabContextMenu').state") == 'closed')
        check('El clic derecho en una pestaña abre el menú de pestaña para esa pestaña')

        away()
        # Gecko marca «soundplaying» al sonar algo; aquí se marca a mano (lo que se prueba es el raíl).
        chrome("const t = gBrowser.visibleTabs.at(-1); t.setAttribute('soundplaying', 'true'); t.dispatchEvent(new CustomEvent('TabAttrModified', { bubbles: true, detail: { changed: ['soundplaying'] } }));")
        badge = """const row = [...document.querySelectorAll('#zero-rail .zero-tab')].at(-1); const b = row?.querySelector('.zero-sound');
            return b ? { seen: getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width >= 8, muted: row.hasAttribute('muted') } : null;"""
        until(lambda: (b := chrome(badge)) and b['seen'])
        # Su pulso dura lo que la música (horas): solo opacidad y transform, que mueve el compositor sin
        # repintar en cada fotograma.
        endless = """const box = document.getElementById(arguments[0]); const own = ['offset', 'easing', 'composite', 'computedOffset', 'simulateComputeValuesFailure'];
            const anims = document.getAnimations().filter(a => a.effect?.getTiming().iterations === Infinity && box?.contains(a.effect.target));
            return { count: anims.length, props: [...new Set(anims.flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k).filter(p => !own.includes(p)))))] };"""
        moving = chrome(endless, ['zero-rail'])
        assert moving['count'] >= 1 and set(moving['props']) <= {'opacity', 'transform'}, f'animaciones que no paran en el raíl: {moving}'
        selected = chrome("return gBrowser.selectedTab.label")
        driver.command('POST', f"/element/{list(element('#zero-rail .zero-tab:last-child .zero-sound').values())[0]}/click", {})
        until(lambda: chrome("return gBrowser.visibleTabs.at(-1).hasAttribute('muted')") and chrome(badge)['muted'])
        assert chrome("return gBrowser.selectedTab.label") == selected
        driver.command('POST', f"/element/{list(element('#zero-rail .zero-tab:last-child .zero-sound').values())[0]}/click", {})
        until(lambda: not chrome("return gBrowser.visibleTabs.at(-1).hasAttribute('muted')"))
        check('Una pestaña que suena lleva un altavoz; un clic la silencia y otro le devuelve el sonido')

        groups = """const rows = [...document.querySelectorAll('#zero-rail .zero-tabs > .zero-item:not([leaving])')];
            const color = el => getComputedStyle(el).getPropertyValue('--zero-group').trim();
            return rows.map(r => r.classList.contains('zero-group')
              ? { group: r.querySelector('.zero-tt').textContent, fav: r.querySelector('.zero-fav').textContent, collapsed: r.hasAttribute('collapsed'),
                  bg: getComputedStyle(r.querySelector('.zero-fav')).backgroundColor }
              : { tab: r.getAttribute('aria-label'), grouped: r.hasAttribute('grouped'), line: r.hasAttribute('grouped') ? getComputedStyle(r, '::after').backgroundColor : null });"""
        add_tab('/uji')
        add_tab('/ise')
        until(lambda: chrome("return gBrowser.visibleTabs.length") >= 5)
        chrome("window.__grupo = gBrowser.addTabGroup(gBrowser.visibleTabs.slice(-2), { label: 'Zorros', color: 'orange' });")
        clear = ('rgba(0, 0, 0, 0)', 'transparent', None, '')
        def grouped_rows(collapsed):
            g = chrome(groups)
            head = [i for i, r in enumerate(g) if r.get('group') == 'Zorros']
            if len(head) != 1 or g[head[0]]['bg'] in clear or g[head[0]]['collapsed'] != collapsed:
                return False
            inside = [r for r in g[head[0] + 1:head[0] + 3] if 'tab' in r]
            if collapsed:
                return g[head[0]]['fav'] == '2' and not any(r.get('grouped') for r in g)
            return len(inside) == 2 and all(r['grouped'] and r['line'] not in clear for r in inside) and g[head[0]]['fav'] == 'Z'
        try:
            until(lambda: grouped_rows(False))
            driver.command('POST', f"/element/{list(element('#zero-rail .zero-group').values())[0]}/click", {})
            until(lambda: grouped_rows(True) and chrome("return window.__grupo.collapsed"))
            driver.command('POST', f"/element/{list(element('#zero-rail .zero-group').values())[0]}/click", {})
            until(lambda: grouped_rows(False) and not chrome("return window.__grupo.collapsed"))
            chrome("window.__grupo.collapsed = true")
            until(lambda: grouped_rows(True))
            # Con el teclado: Intro en la fila lo despliega.
            chrome("document.querySelector('#zero-rail .zero-group').focus()")
            driver.command('POST', '/actions', {'actions': [{'type': 'key', 'id': 'teclado', 'actions': [{'type': 'keyDown', 'value': '\ue007'}, {'type': 'keyUp', 'value': '\ue007'}]}]})
            until(lambda: grouped_rows(False))
            # Si se renombra (o cambia de color), la fila también.
            chrome("window.__grupo.label = 'Kitsunes'; window.__grupo.color = 'purple';")
            until(lambda: any(r.get('group') == 'Kitsunes' and r['fav'] == 'K' for r in chrome(groups))
                  and chrome("return document.querySelector('#zero-rail .zero-group').style.getPropertyValue('--zero-group').includes('purple')"))
        except AssertionError:
            raise AssertionError(f'grupos: {chrome(groups)}') from None
        check('Un grupo lleva su fila y sus pestañas su raya; un clic lo pliega y otro lo despliega, y si lo pliega Gecko también')

        away()
        width = "return document.getElementById('zero-rail').getBoundingClientRect().width"
        until(lambda: chrome(width) < 40, timeout=5)
        # Un clic de ratón en una fila (que se lleva el foco) no lo deja abierto al irse el ratón.
        pointer([{'type': 'pointerMove', 'origin': element('#zero-rail .zero-tab:nth-child(2)'), 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0}])
        away()
        until(lambda: chrome(width) < 40, timeout=5)
        # Con el teclado: Tab de una fila a otra.
        chrome("document.querySelector('#zero-rail .zero-tab').focus()")
        driver.command('POST', '/actions', {'actions': [{'type': 'key', 'id': 'teclado', 'actions': [{'type': 'keyDown', 'value': ''}, {'type': 'keyUp', 'value': ''}]}]})
        try:
            until(lambda: chrome(width) > 180 and chrome("return !!document.activeElement?.closest?.('#zero-rail')"), timeout=5)
        except AssertionError:
            raise AssertionError(f'raíl con teclado: {chrome("return [document.activeElement?.className, document.getElementById(\'zero-rail\').getBoundingClientRect().width]")}') from None
        chrome("gBrowser.selectedBrowser.focus()")
        until(lambda: chrome(width) < 40, timeout=5)
        check('Con el teclado el raíl se abre con los títulos; al volver a la web se cierra, y un clic no lo deja abierto')

        add_tab('/gato-blanco')
        add_tab('/gato-negro')
        circle = """const out = {}; for (const row of document.querySelectorAll('#zero-rail .zero-tab')) {
              if (!row.getAttribute('aria-label')?.startsWith('Gato')) continue; const fav = row.querySelector('.zero-fav'); const img = fav.querySelector('img');
              const c = getComputedStyle(fav).backgroundColor.match(/[\\d.]+/g).map(Number);
              out[row.getAttribute('aria-label')] = { loaded: !!img && img.complete && img.naturalWidth > 0, light: (c[0] + c[1] + c[2]) / 3 }; } return out;"""
        try:
            until(lambda: (c := chrome(circle)).get('Gato blanco', {}).get('loaded') and c.get('Gato negro', {}).get('loaded')
                  and c['Gato blanco']['light'] < 100 and c['Gato negro']['light'] > 200, timeout=10)
        except AssertionError:
            raise AssertionError(f'círculos de los favicon: {chrome(circle)}') from None
        check('Un favicon claro sobre transparente va en un círculo oscuro; uno oscuro, en el claro')

        names = chrome("""return [...document.querySelectorAll('#zero-rail .zero-item:not([leaving])')].map(r => ({ title: r.getAttribute('title'), label: r.getAttribute('aria-label'), text: r.querySelector('.zero-tt').textContent }));""")
        assert names and all(n['title'] is None and n['label'] for n in names), names
        assert all(n['label'] == n['text'] for n in names if n['text'] not in ('', None)), names
        check('Sin bocadillos nativos sobre el raíl: el nombre de cada fila va en aria-label')

        drop = """const dt = new DataTransfer(); dt.setData('text/uri-list', arguments[0]); dt.setData('text/plain', arguments[0]);
            const rail = document.getElementById('zero-rail');
            const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
            rail.dispatchEvent(over);
            rail.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
            return over.defaultPrevented;"""
        count = "return gBrowser.tabs.length"
        before = chrome(count)
        assert chrome(drop, [origin + '/uji']), 'el raíl debería aceptar el enlace'
        until(lambda: chrome(count) == before + 1 and chrome("return gBrowser.tabs.some(t => t.linkedBrowser.currentURI.spec.endsWith('/uji'))"), timeout=10)
        chrome(drop, ['javascript:alert(1)'])
        time.sleep(1)
        assert chrome(count) == before + 1, 'un javascript: no debería abrirse'
        check('Un enlace soltado en el raíl se abre en una pestaña nueva (javascript:, no)')

        add_tab('/chat')
        dot = """const row = [...document.querySelectorAll('#zero-rail .zero-tab')].find(r => (r.getAttribute('aria-label') || '').includes('Chat'));
            const d = row?.querySelector('.zero-dot'); return { label: row?.getAttribute('aria-label'), on: !!row?.hasAttribute('attention'),
              seen: !!d && d.getBoundingClientRect().width >= 5 && getComputedStyle(d).display !== 'none' };"""
        try:
            until(lambda: (d := chrome(dot))['label'] == '(1) Chat' and d['on'] and d['seen'], timeout=10)
        except AssertionError:
            raise AssertionError(f'punto de atención: {chrome(dot)}') from None
        chrome("gBrowser.selectedTab = gBrowser.tabs.find(t => t.label === '(1) Chat')")
        until(lambda: not chrome(dot)['on'] and not chrome(dot)['seen'], timeout=5)
        check('Una pestaña de fondo que cambia de título lleva un punto en su icono; al elegirla, se va')

        def modified_click(selector, key):
            driver.context('chrome')
            target = element(selector)
            driver.command('POST', '/actions', {'actions': [
                {'type': 'key', 'id': 'teclado', 'actions': [{'type': 'keyDown', 'value': key}, {'type': 'pause', 'duration': 0}, {'type': 'pause', 'duration': 0}, {'type': 'pause', 'duration': 0}, {'type': 'keyUp', 'value': key}]},
                {'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [
                    {'type': 'pause', 'duration': 0}, {'type': 'pointerMove', 'origin': target, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0}, {'type': 'pause', 'duration': 0}]}]})
            driver.command('DELETE', '/actions')
        marked = """return { gecko: gBrowser.selectedTabs.map(t => t.label), rail: [...document.querySelectorAll('#zero-rail .zero-tab[multiselected]')].map(r => r.getAttribute('aria-label')),
                   ring: [...document.querySelectorAll('#zero-rail .zero-tab[multiselected] .zero-fav')].every(f => getComputedStyle(f).boxShadow.includes('232, 116, 59')) };"""
        rows = chrome("return [...document.querySelectorAll('#zero-rail .zero-tab:not([pinned])')].map((r, i) => r.getAttribute('aria-label'))")
        chrome("gBrowser.selectedTab = gBrowser.visibleTabs.find(t => !t.pinned)")
        first = chrome("return gBrowser.selectedTab.label")
        nth = lambda label: f'#zero-rail .zero-tab[aria-label="{label}"]'
        others = [r for r in rows if r != first][:3]
        CTRL, SHIFT = '', ''
        try:
            modified_click(nth(others[1]), CTRL)
            until(lambda: set(chrome(marked)['gecko']) == {first, others[1]} and set(chrome(marked)['rail']) >= {others[1]} and chrome(marked)['ring'], timeout=5)
            modified_click(nth(others[1]), CTRL)
            until(lambda: chrome(marked)['gecko'] == [first], timeout=5)
            modified_click(nth(others[2]), SHIFT)
            until(lambda: len(chrome(marked)['gecko']) >= 3, timeout=5)
            driver.command('POST', f"/element/{list(element(nth(others[0])).values())[0]}/click", {})
            until(lambda: chrome(marked)['gecko'] == [others[0]] and chrome(marked)['rail'] == [], timeout=5)
        except AssertionError:
            raise AssertionError(f'varias a la vez: {chrome(marked)}') from None
        check('Varias a la vez: Ctrl + clic añade o quita, Mayús + clic un tramo, y se ven marcadas')

        chrome("gBrowser.selectedTab = gBrowser.visibleTabs.find(t => !t.pinned)")
        chrome("const t = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); t.setAttribute('data-prueba', 'descargar')", [origin + '/descargada'])
        eventually(lambda: chrome("const t = document.querySelector('tab[data-prueba]'); return !t.hasAttribute('busy') && t.label === 'Descargada'"), timeout=10)
        faded = """const t = document.querySelector('tab[data-prueba]');
            const row = [...document.querySelectorAll('#zero-rail .zero-tab')].find(r => r.getAttribute('aria-label') === t.label); if (!row) return null;
            const f = getComputedStyle(row.querySelector('.zero-fav')); return { opacity: Number(f.opacity), filter: f.filter, pending: t.hasAttribute('pending') };"""
        try:
            assert chrome(faded)['opacity'] > 0.95, chrome(faded)
            chrome("gBrowser.discardBrowser(document.querySelector('tab[data-prueba]'), true)")
            eventually(lambda: (f := chrome(faded))['pending'] and f['opacity'] <= 0.6 and 'grayscale' in f['filter'], timeout=5)
            chrome("gBrowser.selectedTab = document.querySelector('tab[data-prueba]')")
            eventually(lambda: (f := chrome(faded)) and not f['pending'] and f['opacity'] > 0.95, timeout=8)
        except AssertionError:
            raise AssertionError(f'descargada: {chrome(faded)}') from None
        check('Una pestaña descargada lleva el icono apagado; al volver a ella, se enciende')

        rec = """const t = document.querySelector('tab[data-prueba]'); const row = [...document.querySelectorAll('#zero-rail .zero-tab')].find(r => r.getAttribute('aria-label') === t.label);
            const d = row?.querySelector('.zero-rec'); if (!d) return null; const cs = getComputedStyle(d); const b = d.getBoundingClientRect(); const f = row.querySelector('.zero-fav').getBoundingClientRect();
            const [red, green, blue] = cs.backgroundColor.match(/[\\d.]+/g).map(Number);
            return { shown: cs.display !== 'none' && b.width >= 5, corner: b.left <= f.left + 4 && b.top <= f.top + 4, red, green, blue };"""
        share = "gBrowser.updateBrowserSharing(document.querySelector('tab[data-prueba]').linkedBrowser, { webRTC: arguments[0] })"
        try:
            chrome(share, [{'sharing': 'camera', 'camera': True}])
            eventually(lambda: (r := chrome(rec)) and r['shown'] and r['corner'] and r['green'] > r['red'] and r['green'] > r['blue'], timeout=5)
            chrome(share, [{'sharing': 'microphone', 'microphone': True}])
            eventually(lambda: (r := chrome(rec)) and r['shown'] and r['red'] > 200 and 100 < r['green'] < 200, timeout=5)
            chrome(share, [{}])
            eventually(lambda: (r := chrome(rec)) and not r['shown'], timeout=5)
        except AssertionError:
            raise AssertionError(f'cámara en el raíl: {chrome(rec)}') from None
        check('La pestaña que usa la cámara o el micrófono lleva un punto de su color en el icono')

        # Cada fila que se repinta (y la isla, al repintarse) pregunta a Gecko por su icono: se cuentan las
        # preguntas de cada uno.
        chrome("""const own = gBrowser.getIcon.bind(gBrowser); window.__iconos = { rail: new Set(), island: 0 };
            gBrowser.getIcon = tab => { const stack = new Error().stack; if (stack.includes('zero-rail')) window.__iconos.rail.add(tab); if (stack.includes('zero-island')) window.__iconos.island++; return own(tab); };""")
        rows = chrome("return document.querySelectorAll('#zero-rail .zero-tab').length")
        assert rows >= 8, rows
        counts = []
        for pick in (2, 5, 1):
            chrome("window.__iconos = { rail: new Set(), island: 0 }; gBrowser.selectedTab = gBrowser.visibleTabs[arguments[0]]", [pick])
            time.sleep(0.3)
            counts.append(chrome("return { rail: window.__iconos.rail.size, island: window.__iconos.island }"))
            assert chrome("return document.querySelector('#zero-rail .zero-tab[selected]')?.getAttribute('aria-label')") == chrome("return gBrowser.selectedTab.label")
        assert max(c['rail'] for c in counts) <= 2 and max(c['island'] for c in counts) <= 2, f'al elegir una pestaña se repintan (de {rows} filas): {counts}'
        chrome("delete gBrowser.getIcon")
        check('Elegir una pestaña repinta solo las filas que cambian')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
