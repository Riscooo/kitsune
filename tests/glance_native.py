"""Vista rápida en el motor real (perfil temporal, sin ventana en pantalla, servidor local).

1. Alt+clic en un enlace abre la web enlazada flotando sobre la página: es una pestaña oculta
   en la barra, unida a la actual con la vista dividida de Gecko; la página de debajo no navega
   y se apaga un poco.
2. Un clic normal en el mismo enlace navega como siempre (la vista rápida no estorba).
3. Esc la cierra, y también un clic fuera (en la página de debajo): no queda ni pestaña ni división.
4. «Abrir en pestaña» la deja como pestaña normal SIN volver a cargarla (misma página, el servidor
   no la vuelve a servir).
5. «Dividir» la deja junto a la pestaña de debajo, en la vista dividida de siempre.
6. Desde una pestaña fijada (que no se puede dividir) flota en un panel, como antes.
7. Si se cierra la pestaña de debajo, la vista rápida se queda como pestaña normal.

Con --modulo-del-repo, la vista rápida sale de install/native del repositorio en vez de la del
motor (para probarla antes de compilarlo).
"""
import argparse
import http.server
import json
from pathlib import Path
import tempfile
import threading

from browser_smoke import WebDriver, prepare_profile, eventually

ROOT = Path(__file__).resolve().parents[1]
HITS = {}
PAGES = {
    '/': '<!doctype html><meta charset=utf-8><title>Origen</title><p><a id="enlace" href="/destino">Ver el destino</a></p>',
    '/destino': '<!doctype html><meta charset=utf-8><title>Destino</title><h1>Destino</h1><p><a id="otra" href="/otra">Otra</a></p>',
    '/otra': '<!doctype html><meta charset=utf-8><title>Otra</title><h1>Otra</h1>',
}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        HITS[self.path] = HITS.get(self.path, 0) + 1
        body = PAGES.get(self.path)
        self.send_response(200 if body else 404)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        # Sin caché: si la vista rápida se cargase otra vez al pasarla a pestaña, el servidor lo vería.
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write((body or 'no').encode())

    def log_message(self, *args):
        pass


# El actor de la vista rápida con el módulo del repositorio (el hijo, que no cambia, sigue siendo el del motor).
FROM_REPO = """
const res = Services.io.getProtocolHandler('resource').QueryInterface(Ci.nsIResProtocolHandler);
const dir = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
dir.initWithPath(arguments[0]);
res.setSubstitution('kitsunetest', Services.io.newFileURI(dir));
try { ChromeUtils.unregisterWindowActor('KitsuneGlance'); } catch {}
ChromeUtils.registerWindowActor('KitsuneGlance', {
  parent: { esModuleURI: 'resource://kitsunetest/kitsune-glance.sys.mjs' },
  child: { esModuleURI: 'chrome://browser/content/kitsune-glance-child.sys.mjs', events: { click: { capture: true } } },
  allFrames: true, safeForUntrustedWebProcess: true, matches: ['http://*/*', 'https://*/*'], messageManagerGroups: ['browsers'],
});
"""

GLANCE = """
const box = el => { const r = el?.getBoundingClientRect(); return r ? {x: r.x, y: r.y, w: r.width, h: r.height} : null; };
const g = gBrowser.tabs.find(t => t.hasAttribute('kitsune-glance'));
const area = document.getElementById('tabbrowser-tabpanels');
const panel = g ? document.getElementById(g.linkedPanel) : null;
const under = g?.splitview?.tabs.find(t => t !== g) ?? null;
const popup = document.getElementById('kitsune-glance');
return {
  tab: !!g, url: g?.linkedBrowser.currentURI.spec ?? null, selectedIsGlance: !!g && gBrowser.selectedTab === g,
  under: under?.linkedBrowser.currentURI.spec ?? null, head: panel?.querySelector('.kitsune-glance-title')?.textContent ?? '',
  stripWidth: g ? g.getBoundingClientRect().width : null, panel: box(panel), area: box(area),
  underPanel: under ? box(document.getElementById(under.linkedPanel)) : null,
  dim: area.hasAttribute('kitsune-glance'), tabs: gBrowser.tabs.length,
  selected: gBrowser.selectedBrowser.currentURI.spec, selectedSplit: gBrowser.selectedTab.splitview?.tabs.length ?? 0,
  selectedTitle: gBrowser.selectedTab.label, selectedVisible: gBrowser.selectedTab.getBoundingClientRect().width > 0,
  window: gBrowser.selectedBrowser.browsingContext?.currentWindowGlobal?.innerWindowId ?? null,
  glanceWindow: g?.linkedBrowser.browsingContext?.currentWindowGlobal?.innerWindowId ?? null,
  popup: popup?.state ?? 'none', popupUrl: popup?.querySelector('browser')?.currentURI?.spec ?? null,
};
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--modulo-del-repo', action='store_true', help='la vista rápida de install/native, no la del motor')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-glance-'))
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

    def content(script):
        driver.context('content'); return driver.script(script)

    def alt_click(selector):
        driver.context('content')
        found = driver.element(selector)
        element = found if isinstance(found, dict) else {'element-6066-11e4-a52e-4f735466cecf': found}
        driver.command('POST', '/actions', {'actions': [
            {'type': 'key', 'id': 'teclado', 'actions': [{'type': 'keyDown', 'value': '\ue00a'}, {'type': 'pause', 'duration': 0},
                                                         {'type': 'pause', 'duration': 0}, {'type': 'keyUp', 'value': '\ue00a'}]},
            {'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [
                {'type': 'pointerMove', 'origin': element, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0},
                {'type': 'pointerUp', 'button': 0}, {'type': 'pause', 'duration': 0}]},
        ]})
        driver.command('DELETE', '/actions')

    def glance():
        return chrome(GLANCE)

    def open_from_origin():
        """Vuelve al origen (en una pestaña sin dividir) y abre la vista rápida del enlace."""
        driver.navigate(origin + '/')
        eventually(lambda: content("return document.readyState") == 'complete' and glance()['selected'] == origin + '/', timeout=10)
        alt_click('#enlace')
        eventually(lambda: glance()['tab'] and glance()['url'] == origin + '/destino', timeout=15)
        eventually(lambda: glance()['head'] == 'Destino', timeout=10)
        return glance()

    def closed(tabs):
        g = glance()
        return not g['tab'] and g['tabs'] == tabs and g['selected'] == origin + '/' and g['selectedSplit'] == 0 and not g['dim']

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        if args.modulo_del_repo:
            chrome(FROM_REPO, [str(ROOT / 'install/native')])
        driver.navigate(origin + '/')
        tabs = glance()['tabs']
        g = open_from_origin()
        assert g['selectedIsGlance'] and g['under'] == origin + '/' and g['dim'], g
        assert g['tabs'] == tabs + 1 and g['stripWidth'] == 0, g
        # Flota: más pequeña que la zona de las webs y centrada; la de debajo ocupa todo el ancho.
        p, a, u = g['panel'], g['area'], g['underPanel']
        assert p['w'] < a['w'] * 0.9 and p['h'] < a['h'] * 0.95, g
        assert abs((p['x'] + p['w'] / 2) - (a['x'] + a['w'] / 2)) < 4, g
        assert u['w'] > a['w'] * 0.9, g
        check('Alt+clic abre el enlace flotando sobre la página (una pestaña oculta), y la de debajo no navega')

        driver.context('chrome')
        driver.shortcut('\ue00c')  # Esc
        eventually(lambda: closed(tabs), timeout=5)
        driver.context('content')
        driver.click('#enlace')
        eventually(lambda: glance()['selected'] == origin + '/destino', timeout=10)
        assert not glance()['tab'] and glance()['popup'] in ('none', 'closed')
        check('Esc la cierra, y un clic normal navega como siempre')

        open_from_origin()
        chrome("const g = gBrowser.tabs.find(t => t.hasAttribute('kitsune-glance')); gBrowser.selectedTab = g.splitview.tabs.find(t => t !== g);")
        eventually(lambda: closed(tabs), timeout=5)
        check('Un clic fuera (en la página de debajo) la cierra sin dejar pestaña ni división')

        g = open_from_origin()
        hits, window = HITS.get('/destino', 0), g['glanceWindow']
        chrome("document.querySelector('[kitsune-glance-panel] .kitsune-glance-tab').click()")
        eventually(lambda: not glance()['tab'] and glance()['selected'] == origin + '/destino' and glance()['selectedSplit'] == 0, timeout=10)
        g = glance()
        assert g['window'] == window and HITS.get('/destino', 0) == hits, (g, window, HITS)
        assert g['tabs'] == tabs + 1 and g['selectedVisible'] and g['selectedTitle'] == 'Destino' and not g['dim'], g
        # Sigue siendo una pestaña normal: navega y la pestaña y la barra de direcciones la siguen.
        chrome("gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]),"
               " { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })", [origin + '/otra'])
        eventually(lambda: glance()['selected'] == origin + '/otra' and glance()['selectedTitle'] == 'Otra', timeout=10)
        eventually(lambda: chrome("return gURLBar.value").endswith('/otra'), timeout=5)
        check('«Abrir en pestaña» la deja como pestaña normal sin volver a cargarla')

        chrome("gBrowser.removeTab(gBrowser.selectedTab)")
        g = open_from_origin()
        hits = HITS.get('/destino', 0)
        chrome("document.querySelector('[kitsune-glance-panel] .kitsune-glance-split').click()")
        eventually(lambda: not glance()['tab'] and glance()['selectedSplit'] == 2 and not glance()['dim'], timeout=10)
        g = glance()
        assert g['selected'] == origin + '/destino' and g['selectedVisible'] and HITS.get('/destino', 0) == hits, g
        check('«Dividir» la deja junto a la de debajo, en la vista dividida de siempre')

        chrome("gBrowser.selectedTab.splitview.unsplitTabs(); gBrowser.removeTab(gBrowser.selectedTab);"
               "gBrowser.pinTab(gBrowser.selectedTab);")
        driver.navigate(origin + '/')
        eventually(lambda: content("return document.readyState") == 'complete', timeout=10)
        alt_click('#enlace')
        eventually(lambda: glance()['popup'] == 'open' and glance()['popupUrl'] == origin + '/destino', timeout=15)
        assert not glance()['tab'], glance()
        count = glance()['tabs']
        chrome("document.querySelector('#kitsune-glance .kitsune-glance-tab').click()")
        eventually(lambda: glance()['tabs'] == count + 1 and glance()['selected'] == origin + '/destino', timeout=10)
        assert glance()['popup'] == 'closed'
        check('Desde una pestaña fijada flota en un panel, como antes')

        # La última: cierra la pestaña de debajo, que es la de esta sesión de WebDriver.
        chrome("const d = gBrowser.tabs.find(t => t.pinned); gBrowser.unpinTab(d); gBrowser.removeTab(gBrowser.selectedTab); gBrowser.selectedTab = d;")
        g = open_from_origin()
        count = g['tabs']
        chrome("const g = gBrowser.tabs.find(t => t.hasAttribute('kitsune-glance')); gBrowser.removeTab(g.splitview.tabs.find(t => t !== g));")
        eventually(lambda: not glance()['tab'] and glance()['selected'] == origin + '/destino' and glance()['selectedSplit'] == 0, timeout=10)
        g = glance()
        assert g['tabs'] == count - 1 and g['selectedVisible'] and not g['dim'], g
        check('Si se cierra la pestaña de debajo, la vista rápida se queda como pestaña normal')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
