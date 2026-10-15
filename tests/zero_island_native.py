"""Kitsune Zero · la isla (la barra de menú), en el motor real (perfil temporal, sin ventana en pantalla).

1. En reposo mide 176 × 32 y enseña solo el dominio de la página.
2. Con el ratón encima se abre a 400 × 32 con atrás, adelante y recargar.
3. Escribiendo (foco en la barra de direcciones) mide 560 × 32, y las sugerencias se abren y se leen.
4. Nunca baja: su borde inferior queda al menos 4 px por encima de la tarjeta en todos los estados.
5. Las pestañas de arriba y la barra de marcadores de Gecko no se ven.
6. Un aviso la ensancha a 470 × 32 un momento (con su icono, si lo lleva) y vuelve a reposo.
7. Con un menú suyo abierto (el de Kitsune) sigue abierta aunque el ratón se vaya, y se cierra con él.
8. Las sugerencias salen debajo de la isla, centradas con ella y de su mismo ancho.
9. El botón del menú (≡) es redondo, como los demás de la isla.
10. El menú de Kitsune, abierto desde la isla, va con el aspecto de Zero: hoja clara de esquinas
    redondas y filas redondeadas. Opaca (un menú es una ventana aparte: lo de detrás no se desenfoca, solo
    asomaría), y con su sombra dentro del margen que Gecko le deja (si no, la sombra se corta en recto).
11. Con «solo iconos», la isla en reposo es una pastilla pequeña con el icono de la web y sin texto, y
    abierta enseña los botones sin el dominio.
12. Abierta, lleva el candado de la web (roto si no es https) y al pulsarlo sale la información de la
    web de Gecko (permisos, cookies, certificado) bajo la isla, que sigue abierta mientras tanto.
    Pulsar el dominio sigue siendo para escribir.
13. Abierta, a la derecha del dominio salen las acciones que tocan en esa web: la vista de lectura si la
    página se puede leer (y al pulsarla entra y sale de ella) y traducir si Gecko lo ofrece; si no, nada.
    En la vista de lectura, la isla dice el dominio de la web que se lee (no el título).
14. Un título largo (una página que no es una web, como about:…) se corta al final con «…», dentro de
    la isla: no se sale por los dos lados.
15. Con el teclado: si el foco llega a un botón de la isla (F6, Mayús+Tab), la isla se abre y el botón
    se ve; al irse el foco, vuelve a reposo.
16. Con las flechas se llega también a los botones propios de Zero (el candado, leer, traducir, la
    música) y con Intro hacen lo suyo (el candado abre la información de la web).
17. En una ventana estrecha (una columna de niri), la isla no pisa los botones de ventana ni se sale:
    abierta, con un aviso o escribiendo, encoge para caber, centrada; las sugerencias, igual.
18. Con «solo iconos», si además lleva el punto de un usuario y la onda de la música, la isla crece lo
    justo para que quepan (no se recortan).
19. Con «solo iconos», un favicon claro sobre transparente (el gato de GitHub en oscuro) lleva un fondo
    oscuro para verse sobre el cristal claro; uno oscuro, no.
20. Mientras carga la web que se ve, la isla lleva una línea fina de progreso en su borde de abajo, que
    avanza y se va al terminar.
21. Si una web de la ventana usa la cámara, el micrófono o comparte la pantalla, la isla lleva un punto
    tras el dominio, como el de iOS: verde la cámara, naranja el micrófono, rojo la pantalla. Aunque sea
    otra pestaña (lo que importa es saber que está encendida); al apagarse, se va. Con la isla abierta, el
    punto se pulsa y lleva a esa pestaña.
22. Al pasar a una pestaña de otra web, el dominio de la isla entra con un fundido corto, no de golpe;
    entre dos pestañas de la misma web no se mueve nada, y con «reducir movimiento», tampoco.

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
        self.send_header('Content-Type', 'image/svg+xml' if self.path.endswith('.svg') else 'text/html; charset=utf-8')
        self.end_headers()
        if self.path == '/despacio':
            import time as _t
            self.wfile.write(b'<!doctype html><meta charset=utf-8><title>Despacio</title>')
            for i in range(30):
                self.wfile.write(('<p>' + 'zorro ' * 400 + '</p>').encode()); self.wfile.flush(); _t.sleep(0.1)
            return
        if self.path == '/blanco.svg':
            self.wfile.write(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="#fff"/></svg>')
            return
        if self.path == '/gato-blanco':
            self.wfile.write('<!doctype html><meta charset=utf-8><title>Gato blanco</title><link rel=icon href="/blanco.svg"><h1>Gato</h1>'.encode())
            return
        if self.path.startswith('/articulo'):
            para = ('<p>Los zorros de Kioto viven entre los santuarios de Fushimi Inari, donde miles de torii naranjas forman '
                    'túneles que suben por la montaña. Cuentan que son mensajeros de Inari y que guardan las cosechas de arroz, '
                    'y por eso los visitantes les dejan ofrendas de tofu frito y figuritas de cerámica junto a cada altar.</p>')
            self.wfile.write(('<!doctype html><meta charset=utf-8><title>Los zorros de Kioto</title><article><h1>Los zorros de Kioto</h1>'
                              + para * 12 + '</article>').encode())
            return
        self.wfile.write(b'<!doctype html><meta charset=utf-8><title>Kioto</title><h1>Los zorros de Kioto</h1>')

    def log_message(self, *args):
        pass


ISLAND = """
const box = el => { const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
// A la vista: con sus antepasados (la opacidad se multiplica y un padre estrecho que recorta lo tapa).
const shown = id => {
  const el = document.getElementById(id); if (!el) return false;
  const r = el.getBoundingClientRect(); let left = r.left, right = r.right, opacity = 1;
  if (getComputedStyle(el).visibility === 'hidden') return false;
  for (let node = el; node?.nodeType === 1; node = node.parentNode) {
    const cs = getComputedStyle(node); opacity *= Number(cs.opacity);
    if (node !== el && cs.overflowX !== 'visible') { const p = node.getBoundingClientRect(); left = Math.max(left, p.left); right = Math.min(right, p.right); }
  }
  return right - left > 4 && r.height > 4 && opacity > 0.3; // atrás y adelante sin historial van atenuados (0,4), y se ven
};
const toolbox = document.getElementById('navigator-toolbox');
return {
  island: box(document.getElementById('nav-bar')), card: box(document.getElementById('tabbrowser-tabpanels')),
  host: document.getElementById('zero-host')?.textContent ?? null,
  state: toolbox.getAttribute('zero-island') ?? '',
  back: shown('back-button'), forward: shown('forward-button'), reload: shown('reload-button'),
  tabs: box(document.getElementById('TabsToolbar'))?.h ?? 0, bookmarks: box(document.getElementById('PersonalToolbar'))?.h ?? 0,
  results: gURLBar.view.isOpen ? box(gURLBar.view.panel) : null, W: innerWidth,
};
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-island-'))
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

    def island():
        return chrome(ISLAND)

    def sized(w, h=32, tolerance=1.5):
        i = island()['island']
        return abs(i['w'] - w) <= tolerance and abs(i['h'] - h) <= tolerance

    def clear_of_card():
        i = island()
        return i['island']['y'] + i['island']['h'] <= i['card']['y'] - 4

    def until(condition, timeout=5):
        # Si no se cumple, el error dice cómo estaba la isla (más útil que «no se cumplió»).
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {island()}') from None

    def hover(element_id):
        driver.context('chrome')
        element = driver.command('POST', '/element', {'using': 'css selector', 'value': f'#{element_id}'})
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'},
                                                         'actions': [{'type': 'pointerMove', 'origin': element, 'x': 0, 'y': 0}]}]})

    def away():
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'},
                                                         'actions': [{'type': 'pointerMove', 'origin': 'viewport', 'x': 700, 'y': 600}]}]})
        driver.command('DELETE', '/actions')

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/kioto')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")

        until(lambda: sized(176) and island()['host'] == '127.0.0.1', timeout=5)
        # La tarjeta llega a su sitio con su transición: se espera a que acabe.
        until(clear_of_card, timeout=5)
        check('En reposo mide 176 × 32 y enseña solo el dominio')

        hover('nav-bar')
        until(lambda: sized(400) and island()['back'] and island()['forward'] and island()['reload'], timeout=5)
        assert clear_of_card(), island()
        check('Con el ratón encima se abre a 400 × 32 con atrás, adelante y recargar')
        away()
        until(lambda: sized(176), timeout=5)

        # El menú de Kitsune se abre desde la isla: mientras está abierto, la isla no se encoge.
        hover('nav-bar')
        until(lambda: sized(400), timeout=5)
        chrome("PanelUI.show()")
        until(lambda: chrome("return PanelUI.panel.state") == 'open', timeout=5)
        away()
        time.sleep(1.2)
        assert sized(400) and island()['state'] == 'open', island()
        chrome("PanelUI.hide()")
        until(lambda: sized(176) and island()['state'] == '', timeout=5)
        check('Con un menú suyo abierto sigue abierta aunque el ratón se vaya, y se cierra con él')

        chrome("gURLBar.focus(); gURLBar.search('kioto');")  # startQuery() a secas busca el texto vacío
        until(lambda: sized(560) and island()['state'] == 'typing', timeout=5)
        until(lambda: island()['results'] is not None and island()['results']['w'] >= 400, timeout=5)
        i = island()
        assert clear_of_card() and i['results']['x'] >= 0 and i['results']['x'] + i['results']['w'] <= i['W'], i
        check('Escribiendo mide 560 × 32 y las sugerencias se abren y se leen')
        r, j = i['results'], i['island']
        assert abs((r['x'] + r['w'] / 2) - (j['x'] + j['w'] / 2)) <= 2 and abs(r['w'] - j['w']) <= 2 and r['y'] >= j['y'] + j['h'], i
        check('Las sugerencias salen debajo de la isla, centradas con ella y de su mismo ancho')
        chrome("gURLBar.view.close(); gURLBar.blur(); gBrowser.selectedBrowser.focus();")
        until(lambda: sized(176), timeout=5)

        i = island()
        assert i['tabs'] == 0 and i['bookmarks'] == 0, i
        check('Las pestañas de arriba y la barra de marcadores de Gecko no se ven')

        menu_button = chrome("""const stack = document.querySelector('#PanelUI-menu-button .toolbarbutton-badge-stack');
            const cs = getComputedStyle(stack); const r = stack.getBoundingClientRect();
            return { radius: parseFloat(cs.borderTopLeftRadius), w: r.width };""")
        assert menu_button['radius'] >= menu_button['w'] / 2 - 1, menu_button
        check('El botón del menú (≡) es redondo, como los demás de la isla')

        hover('nav-bar')
        until(lambda: sized(400), timeout=5)
        chrome("PanelUI.show()")
        until(lambda: chrome("return PanelUI.panel.state") == 'open', timeout=5)
        look = chrome("""const panel = PanelUI.panel; const content = panel.shadowRoot?.querySelector('[part=content]') ?? panel;
            const cs = getComputedStyle(content); const row = document.querySelector('#appMenu-mainView .subviewbutton');
            const bg = cs.backgroundColor.match(/[\\d.]+/g).map(Number);
            // Hasta dónde llega la sombra (desplazamiento + desenfoque + extensión, de cada capa) y el margen que tiene.
            const reach = cs.boxShadow.split(/,(?![^(]*\\))/).map(layer => { const n = layer.replace(/rgba?\\([^)]*\\)/, '').trim().split(/\\s+/).map(parseFloat).filter(v => !isNaN(v));
              const [x = 0, y = 0, blur = 0, spread = 0] = n; return Math.max(Math.abs(x), Math.abs(y)) + blur + spread; });
            return { radius: parseFloat(cs.borderTopLeftRadius), bg, row: parseFloat(getComputedStyle(row).borderTopLeftRadius),
                     shadow: Math.max(0, ...reach), margin: parseFloat(getComputedStyle(panel).getPropertyValue('--panel-box-shadow-margin')) || 0 };""")
        light = sum(look['bg'][:3]) / 3
        assert look['radius'] >= 16 and light > 225 and look['row'] >= 8, look
        assert len(look['bg']) == 3 or look['bg'][3] == 1, look  # opaca
        assert look['shadow'] <= look['margin'] * 1.25, look   # la sombra cabe (la cola de un desenfoque gaussiano apenas se ve)
        chrome("PanelUI.hide()")
        away()
        until(lambda: sized(176), timeout=5)
        check('El menú de Kitsune va con el aspecto de Zero')

        chrome("Services.prefs.setBoolPref('kitsune.zero.islandIcons', true)")
        icons = """const host = document.getElementById('zero-host'); const icon = host.querySelector('.zero-host-icon'); const text = host.querySelector('.zero-host-text');
            const seen = el => el && el.getBoundingClientRect().width > 2 && getComputedStyle(el).display !== 'none' && Number(getComputedStyle(el).opacity) > 0.5;
            return { icon: seen(icon), text: seen(text), hostOpacity: Number(getComputedStyle(host).opacity) };"""
        until(lambda: island()['island']['w'] <= 64 and chrome(icons)['icon'] and not chrome(icons)['text'], timeout=5)
        hover('nav-bar')
        until(lambda: island()['back'] and island()['reload'] and not chrome(icons)['text'] and island()['island']['w'] < 260, timeout=5)
        # El icono de la web, en el hueco: ni encima de ↻ ni de ≡.
        gap = chrome("""const r = id => document.getElementById(id).getBoundingClientRect(); const i = document.querySelector('#zero-host .zero-host-icon').getBoundingClientRect();
            return { icon: [i.left, i.right], reload: r('reload-button').right, menu: r('PanelUI-button').left };""")
        assert gap['icon'][0] >= gap['reload'] and gap['icon'][1] <= gap['menu'], gap
        away()
        chrome("Services.prefs.setBoolPref('kitsune.zero.islandIcons', false)")
        until(lambda: sized(176) and chrome(icons)['text'], timeout=5)
        check('Con «solo iconos», la isla es una pastilla pequeña con el icono de la web, sin texto')

        def click(selector):
            driver.context('chrome')
            element = driver.command('POST', '/element', {'using': 'css selector', 'value': selector})
            driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'},
                'actions': [{'type': 'pointerMove', 'origin': element, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0}]}]})
        site = """const p = gIdentityHandler._identityPopup; const lock = document.querySelector('#zero-host .zero-lock'); const l = lock.getBoundingClientRect();
            const r = p?.getBoundingClientRect() ?? {}; const n = document.getElementById('nav-bar').getBoundingClientRect();
            return { state: p?.state ?? 'closed', anchored: !!p && !!p.anchorNode && document.getElementById('nav-bar').contains(p.anchorNode), lock: l.width, top: r.top, islandBottom: n.bottom, island: document.getElementById('navigator-toolbox').getAttribute('zero-island') };"""
        hover('nav-bar')
        until(lambda: sized(400) and chrome(site)['lock'] >= 10, timeout=5)
        click('#zero-host .zero-lock')
        try:
            until(lambda: (q := chrome(site))['state'] == 'open' and q['anchored'] and q['islandBottom'] - 2 <= q['top'] <= q['islandBottom'] + 30, timeout=5)
            away()
            time.sleep(0.6)
            assert chrome(site)['island'] == 'open', chrome(site)
        except AssertionError:
            raise AssertionError(f'información de la web: {chrome(site)}') from None
        chrome("PanelMultiView.hidePopup(gIdentityHandler._identityPopup)")
        until(lambda: chrome(site)['state'] == 'closed' and sized(176), timeout=5)
        hover('nav-bar')
        until(lambda: sized(400), timeout=5)
        click('#zero-host .zero-host-text')
        until(lambda: island()['state'] == 'typing', timeout=5)
        chrome("gURLBar.handleRevert(); gBrowser.selectedBrowser.focus();")
        away()
        until(lambda: sized(176), timeout=5)
        check('Abierta, el candado abre la información de la web bajo la isla; el dominio sigue siendo para escribir')

        actions = """const seen = el => !!el && el.getBoundingClientRect().width >= 10 && getComputedStyle(el).display !== 'none' && Number(getComputedStyle(el).opacity) > 0.5;
            const reader = document.querySelector('#zero-host .zero-action[data-action="reader"]'); const translate = document.querySelector('#zero-host .zero-action[data-action="translate"]');
            return { reader: seen(reader), readerActive: !!reader?.hasAttribute('active'), translate: seen(translate), url: gBrowser.currentURI.spec,
                     geckoReader: !document.getElementById('reader-mode-button').hidden };"""
        hover('nav-bar')
        until(lambda: sized(400), timeout=5)
        assert not chrome(actions)['reader'] and not chrome(actions)['translate'], chrome(actions)
        away()
        driver.navigate(origin + '/articulo')
        until(lambda: chrome(actions)['geckoReader'], timeout=10)
        hover('nav-bar')
        try:
            until(lambda: sized(400) and chrome(actions)['reader'] and not chrome(actions)['translate'], timeout=5)
            click('#zero-host .zero-action[data-action="reader"]')
            until(lambda: chrome(actions)['url'].startswith('about:reader') and chrome(actions)['readerActive'], timeout=10)
            until(lambda: (island()['host'] or '').startswith('127.0.0.1'), timeout=5)
            hover('nav-bar')
            until(lambda: chrome(actions)['reader'], timeout=5)
            click('#zero-host .zero-action[data-action="reader"]')
            until(lambda: chrome(actions)['url'].endswith('/articulo') and not chrome(actions)['readerActive'], timeout=10)
            # Traducir: sale cuando Gecko enseña su botón (aquí se le hace salir a mano).
            chrome("document.getElementById('translations-button').hidden = false")
            hover('nav-bar')
            until(lambda: chrome(actions)['translate'], timeout=5)
            chrome("document.getElementById('translations-button').hidden = true")
            until(lambda: not chrome(actions)['translate'], timeout=5)
        except AssertionError:
            raise AssertionError(f'acciones: {chrome(actions)}') from None
        away()
        driver.navigate(origin + '/kioto')
        until(lambda: sized(176), timeout=5)
        check('Abierta, salen las acciones que tocan en esa web: la vista de lectura (entra y sale) y traducir')

        long_title = 'Los zorros de nueve colas que guardan los santuarios de Fushimi Inari en Kioto'
        driver.navigate('data:text/html;charset=utf-8,<title>' + long_title.replace(' ', '%20') + '</title>hola')
        clipped = """const t = document.querySelector('#zero-host .zero-host-text'); const r = t.getBoundingClientRect(); const n = document.getElementById('nav-bar').getBoundingClientRect();
            return { text: t.textContent, inside: r.left >= n.left + 6 && r.right <= n.right - 6, ellipsis: getComputedStyle(t).textOverflow, cut: t.scrollWidth > t.clientWidth };"""
        try:
            until(lambda: (c := chrome(clipped))['text'] == long_title and c['inside'] and c['ellipsis'] == 'ellipsis' and c['cut'], timeout=5)
        except AssertionError:
            raise AssertionError(f'título largo: {chrome(clipped)}') from None
        driver.navigate(origin + '/kioto')
        until(lambda: sized(176) and island()['host'] == '127.0.0.1', timeout=5)
        check('Un título largo se corta al final con «…», dentro de la isla')

        away()
        until(lambda: sized(176), timeout=5)
        # Como lo haría alguien con el teclado: a la dirección y Mayús+Tab (la navegación de Gecko por la barra).
        chrome("gURLBar.focus()")
        driver.command('POST', '/actions', {'actions': [{'type': 'key', 'id': 'teclado', 'actions': [
            {'type': 'keyDown', 'value': '\ue008'}, {'type': 'keyDown', 'value': '\ue004'}, {'type': 'keyUp', 'value': '\ue004'}, {'type': 'keyUp', 'value': '\ue008'}]}]})
        focused = "const a = document.activeElement; return a && a !== gURLBar.inputField && document.getElementById('nav-bar').contains(a) ? (a.id || a.localName) : null"
        try:
            until(lambda: chrome(focused) and sized(400) and chrome("const a = document.activeElement; return a.getBoundingClientRect().width > 10 && Number(getComputedStyle(a).opacity) > 0.3"), timeout=5)
        except AssertionError:
            raise AssertionError(f'foco en la isla: {chrome("const a = document.activeElement; return [a?.id || a?.localName, a?.getBoundingClientRect().width, document.getElementById(\'navigator-toolbox\').getAttribute(\'zero-island\')]")}') from None
        chrome("gBrowser.selectedBrowser.focus()")
        until(lambda: sized(176), timeout=5)
        check('Con el teclado, el foco en un botón abre la isla y el botón se ve; al irse, vuelve')

        # Con las flechas hasta el candado, e Intro.
        chrome("gURLBar.focus()")
        def keys(*values):
            steps = []
            for v in values: steps += [{'type': 'keyDown', 'value': v}, {'type': 'keyUp', 'value': v}]
            driver.command('POST', '/actions', {'actions': [{'type': 'key', 'id': 'teclado', 'actions': steps}]})
        keys('')  # Tab: al grupo de botones de detrás de la dirección
        on_lock = "return !!document.activeElement?.classList?.contains('zero-lock')"
        for _ in range(12):
            if chrome(on_lock): break
            keys('')  # →
        try:
            until(lambda: chrome(on_lock), timeout=3)
            keys('')  # Intro
            until(lambda: chrome("return gIdentityHandler._identityPopup?.state") == 'open', timeout=5)
        except AssertionError:
            raise AssertionError(f'flechas hasta el candado: {chrome("const a = document.activeElement; return [a?.id || a?.className, gIdentityHandler._identityPopup?.state]")}') from None
        chrome("PanelMultiView.hidePopup(gIdentityHandler._identityPopup); gBrowser.selectedBrowser.focus();")
        until(lambda: sized(176), timeout=5)
        check('Con las flechas se llega a los botones de Zero (el candado) y con Intro hacen lo suyo')

        fit = """const n = document.getElementById('nav-bar').getBoundingClientRect(); const l = document.getElementById('zero-lights').getBoundingClientRect();
            const v = gURLBar.view.isOpen ? gURLBar.view.panel.getBoundingClientRect() : null;
            return { W: innerWidth, island: [n.left, n.right], lights: l.right, view: v && [v.left, v.right],
                     ok: n.left >= l.right + 8 && n.right <= innerWidth - 8 && Math.abs((n.left + n.right) / 2 - innerWidth / 2) <= 1.5
                         && (!v || (Math.abs(v.left - n.left) <= 1 && Math.abs(v.right - n.right) <= 1)) };"""
        for narrow in (640, 500):
            driver.command('POST', '/window/rect', {'width': narrow, 'height': 900})
            try:
                until(lambda: chrome("return innerWidth") <= narrow and chrome(fit)['ok'], timeout=5)
                chrome("document.getElementById('navigator-toolbox').setAttribute('zero-island', 'open')")
                until(lambda: chrome(fit)['ok'] and chrome("return document.getElementById('nav-bar').getBoundingClientRect().width") > 176, timeout=5)
                chrome("document.getElementById('navigator-toolbox').removeAttribute('zero-island'); gURLBar.focus(); gURLBar.inputField.value = 'kioto'; gURLBar.startQuery({ searchString: 'kioto' });")
                until(lambda: chrome("return gURLBar.view.isOpen") and chrome(fit)['ok'], timeout=5)
            except AssertionError:
                raise AssertionError(f'ventana de {narrow}: {chrome(fit)}') from None
            chrome("gURLBar.view.close(); gURLBar.handleRevert(); gBrowser.selectedBrowser.focus();")
        driver.command('POST', '/window/rect', {'width': 1540, 'height': 1000})
        until(lambda: chrome("return innerWidth") == 1540 and sized(176), timeout=5)
        check('En una ventana estrecha la isla encoge para caber, centrada, sin pisar los botones de ventana')

        chrome("""Services.prefs.setBoolPref('kitsune.zero.islandIcons', true);
            const id = ContextualIdentityService.create('Dani', 'fingerprint', 'pink').userContextId;
            window.__dani = gBrowser.selectedTab = gBrowser.addTab(arguments[0], { userContextId: id, triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });""", [origin + '/kioto'])
        chrome("ChromeUtils.importESModule('chrome://browser/content/zero/zero-island.sys.mjs').nowPlaying(window, { playing: true, title: 'Kitsune no yomeiri', canNext: false, toggle() {}, next() {}, go() {} })")
        inside = """const n = document.getElementById('nav-bar').getBoundingClientRect(); const h = document.getElementById('zero-host');
            const parts = [...h.children].filter(c => c.getBoundingClientRect().width > 0 && getComputedStyle(c).display !== 'none').map(c => { const r = c.getBoundingClientRect(); return [c.className, r.left, r.right]; });
            return { island: [n.left, n.right], parts, ok: parts.length >= 3 && parts.every(([, l, r]) => l >= n.left + 4 && r <= n.right - 4) };"""
        try:
            until(lambda: chrome(inside)['ok'], timeout=5)
        except AssertionError:
            raise AssertionError(f'solo iconos con usuario y música: {chrome(inside)}') from None
        chrome("ChromeUtils.importESModule('chrome://browser/content/zero/zero-island.sys.mjs').nowPlaying(window, null); gBrowser.removeTab(window.__dani); delete window.__dani; Services.prefs.setBoolPref('kitsune.zero.islandIcons', false);")
        until(lambda: sized(176), timeout=5)
        check('Con «solo iconos», el punto del usuario y la onda de la música caben (la isla crece lo justo)')

        chrome("Services.prefs.setBoolPref('kitsune.zero.islandIcons', true)")
        driver.navigate(origin + '/gato-blanco')
        icon = """const i = document.querySelector('#zero-host .zero-host-icon'); const c = getComputedStyle(i).backgroundColor.match(/[\\d.]+/g).map(Number);
            return { src: i.getAttribute('src')?.slice(0, 30), loaded: i.complete && i.naturalWidth > 0, light: i.hasAttribute('light-icon'), alpha: c[3] ?? 1, lum: (c[0] + c[1] + c[2]) / 3 };"""
        try:
            until(lambda: (i := chrome(icon))['loaded'] and i['light'] and i['alpha'] > 0.5 and i['lum'] < 100, timeout=10)
        except AssertionError:
            raise AssertionError(f'favicon claro en la isla: {chrome(icon)}') from None
        driver.navigate(origin + '/kioto')
        until(lambda: not chrome(icon)['light'], timeout=10)
        chrome("Services.prefs.setBoolPref('kitsune.zero.islandIcons', false)")
        until(lambda: sized(176), timeout=5)
        check('Con «solo iconos», un favicon claro lleva un fondo oscuro para verse')

        line = """const l = document.querySelector('#nav-bar .zero-load'); if (!l) return null; const cs = getComputedStyle(l);
            return { on: l.hasAttribute('on'), p: Number(cs.getPropertyValue('--zero-load') || 0), opacity: Number(cs.opacity), w: l.getBoundingClientRect().width };"""
        driver.context('chrome')
        driver.script("gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })", [origin + '/despacio'])
        seen = []
        def loading():
            l = chrome(line)
            if l and l['on'] and l['opacity'] > 0.3 and 0 < l['p'] < 1:
                seen.append(l['p'])
            return len(seen) >= 2
        try:
            until(loading, timeout=8)
            until(lambda: (l := chrome(line)) is not None and not l['on'], timeout=10)
        except AssertionError:
            raise AssertionError(f'progreso de carga: {chrome(line)} · visto {seen}') from None
        assert seen == sorted(seen), seen
        check('Mientras carga la web, la isla lleva una línea de progreso que avanza y se va al terminar')

        rec = """const r = document.querySelector('#zero-host .zero-rec'); if (!r) return null; const cs = getComputedStyle(r); const b = r.getBoundingClientRect();
            const t = document.querySelector('#zero-host .zero-host-text').getBoundingClientRect();
            const [red, green, blue] = cs.backgroundColor.match(/[\\d.]+/g).map(Number);
            return { shown: cs.display !== 'none' && b.width >= 5 && Number(cs.opacity) > 0.5, after: b.left >= t.right - 1, red, green, blue, label: r.getAttribute('aria-label') || '' };"""
        share = "gBrowser.updateBrowserSharing(arguments[0] ? gBrowser.visibleTabs.find(t => t !== gBrowser.selectedTab).linkedBrowser : gBrowser.selectedBrowser, { webRTC: arguments[1] })"
        chrome("gBrowser.addTab('about:blank', { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })")
        try:
            chrome(share, [False, {'sharing': 'camera', 'camera': True}])
            until(lambda: (r := chrome(rec)) and r['shown'] and r['after'] and r['green'] > r['red'] and r['green'] > r['blue'] and 'cámara' in r['label'].lower(), timeout=5)
            chrome(share, [False, {}])
            until(lambda: not chrome(rec)['shown'], timeout=5)
            chrome(share, [True, {'sharing': 'microphone', 'microphone': True}])
            until(lambda: (r := chrome(rec)) and r['shown'] and r['red'] > 200 and 100 < r['green'] < 200 and 'micrófono' in r['label'].lower(), timeout=5)
            chrome(share, [True, {'sharing': 'screen', 'screen': 'Screen'}])
            until(lambda: (r := chrome(rec)) and r['shown'] and r['red'] > 200 and r['green'] < 100 and 'pantalla' in r['label'].lower(), timeout=5)
            # Abierta, el punto lleva a la pestaña que comparte.
            sharer = chrome("return gBrowser.visibleTabs.indexOf(gBrowser.visibleTabs.find(t => t.hasAttribute('sharing')))")
            before = chrome("return gBrowser.visibleTabs.indexOf(gBrowser.selectedTab)")
            assert before != sharer
            hover('nav-bar')
            until(lambda: chrome("return document.getElementById('navigator-toolbox').getAttribute('zero-island')") == 'open', timeout=5)
            time.sleep(0.8)
            click('#zero-host .zero-rec')
            until(lambda: chrome("return gBrowser.visibleTabs.indexOf(gBrowser.selectedTab)") == sharer, timeout=5)
            away()
            chrome("gBrowser.selectedTab = gBrowser.visibleTabs[arguments[0]]", [before])
            chrome(share, [True, {}])
            until(lambda: not chrome(rec)['shown'], timeout=5)
        except AssertionError:
            raise AssertionError(f'cámara/micrófono: {chrome(rec)}') from None
        check('Con la cámara, el micrófono o la pantalla en uso (en cualquier pestaña), un punto tras el dominio, que lleva a esa pestaña')

        # Tres pestañas: dos de esta web y una de otra (localhost en vez de 127.0.0.1).
        other = origin.replace('127.0.0.1', 'localhost')
        chrome("""const P = Services.scriptSecurityManager.getSystemPrincipal();
            window.__webs = [gBrowser.addTab(arguments[0] + '/a', { triggeringPrincipal: P }), gBrowser.addTab(arguments[0] + '/b', { triggeringPrincipal: P }), gBrowser.addTab(arguments[1] + '/c', { triggeringPrincipal: P })];""", [origin, other])
        until(lambda: chrome("return window.__webs.every(t => !t.hasAttribute('busy') && t.linkedBrowser.currentURI.spec.startsWith('http'))"), timeout=10)
        driver.context('chrome')
        moved = """const done = arguments[arguments.length - 1];
            gBrowser.selectedTab = window.__webs[arguments[0]];
            setTimeout(() => { const t = document.querySelector('#zero-host .zero-host-text');
              done({ text: t.textContent, moving: t.getAnimations().filter(a => a.playState === 'running').length }); }, 60);"""
        chrome("gBrowser.selectedTab = window.__webs[0]")
        time.sleep(0.6)
        same = driver.script(moved, [1], asynchronous=True)
        time.sleep(0.6)
        other_web = driver.script(moved, [2], asynchronous=True)
        time.sleep(0.6)
        chrome("Services.prefs.setIntPref('ui.prefersReducedMotion', 1)")
        until(lambda: chrome("return matchMedia('(prefers-reduced-motion: reduce)').matches"), timeout=5)
        quiet = driver.script(moved, [0], asynchronous=True)
        chrome("Services.prefs.clearUserPref('ui.prefersReducedMotion'); gBrowser.removeTabs(window.__webs); delete window.__webs;")
        assert same['moving'] == 0 and other_web['moving'] >= 1 and 'localhost' in other_web['text'] and quiet['moving'] == 0, (same, other_web, quiet)
        check('Al pasar a otra web, el dominio de la isla entra con un fundido (no entre pestañas de la misma web)')

        chrome("ChromeUtils.importESModule('chrome://browser/content/zero/zero-island.sys.mjs').alert(window, 'Tres avisos esperando', 'te los enseño en el descanso', 1500, 'quiet')")
        until(lambda: sized(470) and clear_of_card(), timeout=5)
        # Con icono: pequeño, delante del texto y a la vista.
        until(lambda: chrome("""const i = document.querySelector('#zero-island-msg .zero-alert-icon'); const t = document.querySelector('#zero-island-msg b');
            if (!i || !t) return false; const r = i.getBoundingClientRect(); return r.width >= 12 && r.width <= 16 && r.right <= t.getBoundingClientRect().left + 1;"""), timeout=5)
        until(lambda: sized(176), timeout=8)
        check('Un aviso la ensancha a 470 × 32 un momento y vuelve a reposo')
        check('Nunca baja: siempre queda por encima de la tarjeta')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
