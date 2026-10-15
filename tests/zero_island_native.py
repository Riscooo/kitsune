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
