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
10. El clic derecho en una pestaña abre el menú de pestaña de Gecko para esa pestaña, con sus textos.
11. Una pestaña que suena lleva un altavoz en su icono; un clic en él la silencia (y otro le devuelve el
    sonido) sin elegirla.
12. Un grupo de pestañas de Gecko lleva una fila propia (un círculo de su color; abierto el raíl, su
    nombre) y sus pestañas, una raya de su color. Un clic en la fila lo pliega (sus pestañas se van y el
    círculo dice cuántas tiene) y otro lo despliega (o Intro, con el teclado); si lo pliega Gecko, el
    raíl también se entera.

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
        chrome("document.getElementById('tabContextMenu').hidePopup()")
        until(lambda: chrome("return document.getElementById('tabContextMenu').state") == 'closed')
        check('El clic derecho en una pestaña abre el menú de pestaña para esa pestaña')

        away()
        # Gecko marca «soundplaying» al sonar algo; aquí se marca a mano (lo que se prueba es el raíl).
        chrome("const t = gBrowser.visibleTabs.at(-1); t.setAttribute('soundplaying', 'true'); t.dispatchEvent(new CustomEvent('TabAttrModified', { bubbles: true, detail: { changed: ['soundplaying'] } }));")
        badge = """const row = [...document.querySelectorAll('#zero-rail .zero-tab')].at(-1); const b = row?.querySelector('.zero-sound');
            return b ? { seen: getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width >= 8, muted: row.hasAttribute('muted') } : null;"""
        until(lambda: (b := chrome(badge)) and b['seen'])
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
              : { tab: r.title, grouped: r.hasAttribute('grouped'), line: r.hasAttribute('grouped') ? getComputedStyle(r, '::after').backgroundColor : null });"""
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
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
