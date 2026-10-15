"""Kitsune Zero · cosas de cada día que la isla esconde, en el motor real (perfil temporal, sin ventana en pantalla).

1. Guardar en marcadores (Ctrl+D) abre su panel bajo la isla, no en una esquina.
2. Cambiar el tamaño de la web (Ctrl + / −) lo dice la isla un momento («Tamaño · 110 %»).
3. Buscar en la página (Ctrl+F) saca su barra dentro de la tarjeta.
4. Con muchas pestañas el raíl cabe en la ventana, se desplaza, y la pestaña elegida siempre se ve
   (también al entrar en Zero con ella abajo del todo).
5. La barra lateral de Gecko (historial, marcadores, la de una extensión) sale como otra tarjeta junto a
   la web, que se aparta; también al otro lado; al cerrarla, la web vuelve a su sitio.
6. Una barra de aviso (una ventana emergente bloqueada…) sale bajo la isla, centrada, ancha y redondeada,
   no aplastada dentro de la isla.
7. Un diálogo de la pestaña (imprimir) cabe entero en la tarjeta: Gecko lo sube 5 px para que cuelgue
   de la barra, y en Zero la tarjeta le recortaría las esquinas de arriba.
8. La dirección de un enlace (al pasar por encima) sale como una píldora separada de la esquina de la
   tarjeta, no como la etiqueta cuadrada de Gecko pegada al borde.
9. Se ve de qué usuario es cada pestaña (Kitsune los lleva en contenedores): en el raíl, una raya de su
   color junto al icono; en la isla, un punto de su color antes del dominio, que con la isla abierta
   dice su nombre. La del usuario base no lleva nada.
10. En una ventana privada, la isla lleva el antifaz de navegación privada delante del dominio (en Zero
    no está la barra de pestañas, donde Gecko lo pone); en una normal, no. Con «solo iconos» y la música
    sonando, todo cabe en la isla.
11. Con el modo compacto de Kitsune (Ctrl+Alt+C), la isla sigue a la vista: Zero ya es lo mínimo, y
    escondida no volvía ni con el ratón arriba.

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
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(b'<!doctype html><meta charset=utf-8><title>Kioto</title><h1>Los zorros de Kioto</h1>')

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-diario-'))
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

    def alert():
        return chrome("const t = document.getElementById('navigator-toolbox'); return t.hasAttribute('zero-island-alert') ? document.getElementById('zero-island-msg').textContent.trim() : ''")

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !!document.getElementById('zero-host')"), timeout=5)

        chrome("PlacesCommandHook.bookmarkPage()")
        eventually(lambda: chrome("return document.getElementById('editBookmarkPanel')?.state") == 'open', timeout=8)
        place = chrome("""const r = document.getElementById('editBookmarkPanel').getBoundingClientRect(); const n = document.getElementById('nav-bar').getBoundingClientRect();
            return { top: r.top, left: r.left, w: r.width, islandBottom: n.bottom, islandLeft: n.left, islandRight: n.right };""")
        assert place['w'] > 100 and place['islandBottom'] - 2 <= place['top'] < place['islandBottom'] + 80 and place['left'] < place['islandRight'] + 60 and place['left'] + place['w'] > place['islandLeft'] - 60, place
        chrome("document.getElementById('editBookmarkPanel').hidePopup()")
        check('Guardar en marcadores abre su panel bajo la isla')

        chrome("FullZoom.enlarge()")
        eventually(lambda: 'Tamaño' in alert() and '%' in alert(), timeout=5)
        percent = chrome("return Math.round(ZoomManager.getZoomForBrowser(gBrowser.selectedBrowser) * 100)")
        assert f'{percent} %' in alert(), (percent, alert())
        chrome("FullZoom.reset()")
        eventually(lambda: '100 %' in alert(), timeout=5)
        check('Cambiar el tamaño de la web lo dice la isla un momento')

        driver.context('chrome')
        bar = driver.script("""const done = arguments[arguments.length - 1];
            gBrowser.getFindBar().then(fb => { fb.open(); setTimeout(() => { const r = fb.getBoundingClientRect(); const p = document.getElementById('tabbrowser-tabpanels').getBoundingClientRect();
              done({ ok: !fb.hidden && r.width > 100 && r.height > 20 && r.left >= p.left - 1 && r.right <= p.right + 1 && r.bottom <= p.bottom + 1 }); fb.close(); }, 600); });""", [], asynchronous=True)
        assert bar['ok'], bar
        check('Buscar en la página saca su barra dentro de la tarjeta')

        for i in range(40):
            chrome("gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(), skipAnimation: true })", [f'{origin}/{i}'])
        look = """const rail = document.getElementById('zero-rail'); const r = rail.getBoundingClientRect(); const sel = rail.querySelector('.zero-tab[selected]')?.getBoundingClientRect();
            return { fits: r.top >= 0 && r.bottom <= innerHeight, scrolls: rail.scrollHeight > rail.clientHeight, seen: !!sel && sel.top >= r.top - 1 && sel.bottom <= r.bottom + 1,
                     rail: [r.top, r.bottom], scrollTop: rail.scrollTop, selected: sel && [sel.top, sel.bottom] };"""

        def selected_in_view(what):
            try:
                eventually(lambda: (l := chrome(look))['fits'] and l['scrolls'] and l['seen'], timeout=5)
            except AssertionError:
                raise AssertionError(f'{what}: {chrome(look)}') from None

        for pick in ('gBrowser.visibleTabs.at(-1)', 'gBrowser.visibleTabs[0]', 'gBrowser.visibleTabs[25]'):
            chrome(f"gBrowser.selectedTab = {pick}")
            selected_in_view(pick)
        chrome("gBrowser.selectedTab = gBrowser.visibleTabs.at(-2)")
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !document.getElementById('zero-rail')"), timeout=5)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        selected_in_view('al entrar en Zero')
        check('Con muchas pestañas el raíl cabe, se desplaza y la elegida siempre se ve (también al entrar en Zero)')

        for i in range(40):
            chrome("gBrowser.removeTab(gBrowser.visibleTabs.at(-1))")
        boxes = """const R = n => { const r = n.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; };
            const side = document.getElementById('sidebar-box');
            return { W: innerWidth, H: innerHeight, side: R(side), radius: getComputedStyle(side).borderTopLeftRadius,
                     card: R(document.getElementById('tabbrowser-tabpanels')) };"""
        card = chrome(boxes)['card']
        chrome("SidebarController.show('viewHistorySidebar')")
        def beside(at_end):
            def ok():
                b = chrome(boxes); s, c = b['side'], b['card']
                if s['w'] < 150 or b['radius'] != '18px' or abs(s['t'] - card['t']) > 1 or abs(s['b'] - card['b']) > 1:
                    return False
                if at_end:
                    return abs(s['r'] - card['r']) <= 1 and abs(c['l'] - card['l']) <= 1 and 6 <= s['l'] - c['r'] <= 14
                return abs(s['l'] - card['l']) <= 1 and abs(c['r'] - card['r']) <= 1 and 6 <= c['l'] - s['r'] <= 14
            try:
                eventually(ok, timeout=5)
            except AssertionError:
                raise AssertionError(f'barra lateral {"a la derecha" if at_end else "a la izquierda"}: {chrome(boxes)} · antes {card}') from None
        beside(False)
        chrome("SidebarController.reversePosition()")
        beside(True)
        chrome("SidebarController.reversePosition(); SidebarController.hide()")
        eventually(lambda: (c := chrome(boxes)['card']) and all(abs(c[k] - card[k]) <= 1 for k in 'lrtb'), timeout=5)
        check('La barra lateral sale como otra tarjeta junto a la web, a un lado o al otro, y al cerrarla la web vuelve')

        chrome("""const box = gBrowser.getNotificationBox(); box.appendNotification('zero-prueba', { label: 'Kitsune ha impedido que esta web abra una ventana emergente.', priority: box.PRIORITY_WARNING_MEDIUM }, [{ label: 'Opciones', callback() { return true; } }]);""")
        bar = """const n = gBrowser.getNotificationBox().getNotificationWithValue('zero-prueba'); if (!n) return null; const r = n.getBoundingClientRect(); const i = document.getElementById('nav-bar').getBoundingClientRect();
            return { l: r.left, r: r.right, t: r.top, h: r.height, w: r.width, W: innerWidth, islandBottom: i.bottom, radius: parseFloat(getComputedStyle(n).borderTopLeftRadius) };"""
        try:
            eventually(lambda: (n := chrome(bar)) and n['w'] >= min(560, n['W'] - 140) - 1 and n['h'] <= 90 and n['islandBottom'] <= n['t'] <= n['islandBottom'] + 30
                       and abs((n['l'] + n['r']) / 2 - n['W'] / 2) <= 2 and n['radius'] >= 10, timeout=5)
        except AssertionError:
            raise AssertionError(f'barra de aviso: {chrome(bar)}') from None
        chrome("gBrowser.getNotificationBox().removeAllNotifications(true)")
        check('Una barra de aviso sale bajo la isla, centrada, ancha y redondeada')

        chrome("PrintUtils.startPrintWindow(gBrowser.selectedBrowser.browsingContext)")
        sheet = """const box = [...document.querySelectorAll('.dialogBox')].find(n => n.getBoundingClientRect().height > 100); if (!box) return null;
            const r = box.getBoundingClientRect(); const c = gBrowser.selectedBrowser.closest('.browserSidebarContainer').getBoundingClientRect();
            return { top: r.top, cardTop: c.top, l: r.left, r: r.right, cardL: c.left, cardR: c.right };"""
        try:
            eventually(lambda: (b := chrome(sheet)) and b['top'] >= b['cardTop'] + 4 and b['l'] >= b['cardL'] and b['r'] <= b['cardR'], timeout=10)
        except AssertionError:
            raise AssertionError(f'imprimir: {chrome(sheet)}') from None
        chrome("document.querySelector('.printSettingsBrowser')?.contentDocument?.querySelector('#cancel-button')?.click()")
        check('Un diálogo de la pestaña (imprimir) cabe entero en la tarjeta')

        chrome("XULBrowserWindow.setOverLink(arguments[0])", [origin + '/zorros/de/kioto'])
        pill = """const l = document.getElementById('statuspanel-label'); const p = document.getElementById('statuspanel'); const r = l.getBoundingClientRect(); const cs = getComputedStyle(l);
            const c = gBrowser.selectedBrowser.closest('.browserSidebarContainer').getBoundingClientRect();
            return { shown: !p.hidden && !p.hasAttribute('inactive') && r.width > 20, l: r.left, b: r.bottom, cardL: c.left, cardB: c.bottom,
                     radii: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius].map(parseFloat) };"""
        try:
            eventually(lambda: (q := chrome(pill))['shown'] and min(q['radii']) >= 8 and q['l'] >= q['cardL'] + 8 and q['b'] <= q['cardB'] - 8, timeout=5)
        except AssertionError:
            raise AssertionError(f'enlace: {chrome(pill)}') from None
        chrome("XULBrowserWindow.setOverLink('')")
        check('La dirección de un enlace sale como una píldora separada de la esquina')

        chrome("""const id = ContextualIdentityService.create('Dani', 'fingerprint', 'pink').userContextId;
            window.__dani = gBrowser.addTab(arguments[0], { userContextId: id, triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
            gBrowser.selectedTab = window.__dani;""", [origin + '/dani'])
        whose = """const color = el => el && getComputedStyle(el).backgroundColor;
            const row = n => [...document.querySelectorAll('#zero-rail .zero-tab')].find(r => r.title === gBrowser.visibleTabs[n].label);
            const bar = r => r && getComputedStyle(r, '::before');
            const dot = document.querySelector('#zero-host .zero-user'); const d = dot?.getBoundingClientRect();
            const last = gBrowser.visibleTabs.length - 1;
            return { dani: { bar: bar(row(last))?.backgroundColor, ink: row(last) && getComputedStyle(row(last)).color, w: parseFloat(bar(row(last))?.width), content: bar(row(last))?.content },
                     base: { content: bar(row(0))?.content, w: parseFloat(bar(row(0))?.width) || 0 },
                     dot: dot && { w: d.width, color: color(dot), shown: getComputedStyle(dot).display !== 'none' }, who: dot?.textContent };"""
        clear = ('rgba(0, 0, 0, 0)', 'transparent', None)
        try:
            eventually(lambda: (w := chrome(whose)) and w['dani']['bar'] not in clear and w['dani']['bar'] != w['dani']['ink'] and w['dani']['w'] >= 1.5 and w['base']['content'] in ('none', 'normal', None)
                       and w['dot'] and w['dot']['shown'] and w['dot']['w'] >= 4 and w['dot']['color'] not in clear and w['dot']['color'] == w['dani']['bar'] and 'Dani' in (w['who'] or ''), timeout=5)
            chrome("gBrowser.selectedTab = gBrowser.visibleTabs[0]")
            eventually(lambda: (w := chrome(whose))['dot'] is None or not w['dot']['shown'], timeout=5)
        except AssertionError:
            raise AssertionError(f'usuario: {chrome(whose)}') from None
        chrome("gBrowser.removeTab(window.__dani); delete window.__dani;")
        check('Se ve de qué usuario es cada pestaña, en el raíl y en la isla')

        mask = """const w = arguments[0] ? window.__privada : window; const h = w.document.getElementById('zero-host'); if (!h) return null;
            const b = w.getComputedStyle(h, '::before'); return { image: b.backgroundImage, w: parseFloat(b.width) || 0, content: b.content };"""
        assert chrome(mask, [False])['content'] in ('none', 'normal'), chrome(mask, [False])
        chrome("window.__privada = OpenBrowserWindow({ private: true });")
        eventually(lambda: chrome("const w = window.__privada; return !!w.gBrowserInit?.delayedStartupFinished && !!w.document.getElementById('kitsune-zero-key')"), timeout=15)
        # Desde una ventana en Zero ya nace en Zero (hereda); si no, se enciende.
        chrome("const d = window.__privada.document; if (!d.documentElement.hasAttribute('zero')) d.getElementById('kitsune-zero-key').doCommand();")
        try:
            eventually(lambda: (m := chrome(mask, [True])) and 'private' in m['image'] and m['w'] >= 12, timeout=5)
        except AssertionError:
            raise AssertionError(f'privada: {chrome(mask, [True])}') from None
        # Con «solo iconos» y la música sonando, el antifaz y lo demás caben (la isla crece lo justo).
        chrome("""Services.prefs.setBoolPref('kitsune.zero.islandIcons', true);
            ChromeUtils.importESModule('chrome://browser/content/zero/zero-island.sys.mjs').nowPlaying(window.__privada, { playing: true, title: 'x', canNext: false, toggle() {}, next() {}, go() {} });""")
        fits = """const w = window.__privada; const d = w.document; const n = d.getElementById('nav-bar').getBoundingClientRect(); const h = d.getElementById('zero-host');
            const parts = [...h.children].filter(c => c.getBoundingClientRect().width > 0 && w.getComputedStyle(c).display !== 'none').map(c => { const r = c.getBoundingClientRect(); return [c.className, r.left, r.right]; });
            const first = parts.length ? Math.min(...parts.map(p => p[1])) : 0; const mask = parseFloat(w.getComputedStyle(h, '::before').width) || 0;
            const gap = parseFloat(w.getComputedStyle(h).columnGap) || 0;
            return { island: [n.left, n.right], parts, maskLeft: first - gap - mask,
                     ok: parts.length >= 2 && first - gap - mask >= n.left + 4 && parts.every(([, l, r]) => r <= n.right - 4) };"""
        try:
            eventually(lambda: chrome(fits)['ok'], timeout=5)
        except AssertionError:
            raise AssertionError(f'privada con solo iconos: {chrome(fits)}') from None
        chrome("Services.prefs.setBoolPref('kitsune.zero.islandIcons', false)")
        chrome("window.__privada.close(); delete window.__privada;")
        check('En una ventana privada, la isla lleva el antifaz delante del dominio (y con «solo iconos», cabe)')

        chrome("Services.prefs.setBoolPref('kitsune.compact.enabled', true)")
        eventually(lambda: chrome("return document.documentElement.hasAttribute('kitsune-compact')"), timeout=5)
        island = "const r = document.getElementById('nav-bar').getBoundingClientRect(); const t = getComputedStyle(document.getElementById('navigator-toolbox')); return { top: r.top, opacity: Number(t.opacity) };"
        try:
            eventually(lambda: (i := chrome(island))['top'] >= 6 and i['opacity'] > 0.9, timeout=5)
        except AssertionError:
            raise AssertionError(f'compacto: {chrome(island)}') from None
        chrome("Services.prefs.clearUserPref('kitsune.compact.enabled')")
        check('Con el modo compacto de Kitsune, la isla sigue a la vista')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
