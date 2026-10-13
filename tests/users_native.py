"""Usuarios en la misma ventana con el motor real, con perfiles y servidores desechables.

Inicio integrado (Windows, macOS y el paquete de Linux):
1. Cambiar desde el inicio sustituye esa pestaña, en su sitio, por el inicio del otro
   usuario en su contenedor; las demás pestañas no se tocan.
2. El inicio de esa pestaña responde como ese usuario.
3. Una pestaña nueva (como Ctrl+T) va con el usuario de la pestaña actual.
4. El contenedor del usuario lleva su nombre y su color, y no quedan los de ejemplo de Gecko.
5. La ventana lleva los botones de Kitsune (atributo kitsune-window-buttons).
Inicio del servidor local de Linux:
6. «/?cambiar=<id>» pedido por el inicio cambia la pestaña, y el servidor ve al usuario
   por la cabecera que pone el motor.
7. La misma dirección pedida desde otra web no cambia nada, y la página no puede
   falsear la cabecera.
"""
import argparse
import http.server
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading

from browser_smoke import ROOT, WebDriver, eventually, prepare_profile

UUID = '4b1d7c2e-9a3f-4e6b-8c51-2f7a0d9e6b13'
HOME = f'moz-extension://{UUID}/start/index.html'
spec = importlib.util.spec_from_file_location('engine', ROOT / 'install/kitsune-engine.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


def load_home():
    home_spec = importlib.util.spec_from_file_location('kitsune_users_native_home', ROOT / 'install/home-server.py')
    module = importlib.util.module_from_spec(home_spec)
    sys.modules[home_spec.name] = module
    home_spec.loader.exec_module(module)
    return module


class Session:
    def __init__(self, driver):
        self.driver = driver

    def chrome(self, script, *values, asynchronous=False):
        self.driver.context('chrome')
        return self.driver.script(script, values, asynchronous)

    def page(self, script, *values, asynchronous=False):
        self.driver.context('content')
        return self.driver.script(script, values, asynchronous)

    def fetch(self, method, path, body=None, headers=None):
        return self.page("""const [method, path, body, headers, done] = arguments;
          fetch(path, {method, headers: {'Content-Type': 'application/json', ...headers}, body: body === null ? undefined : JSON.stringify(body)})
            .then(async r => done({status: r.status, body: await r.json()}), e => done({error: String(e)}));""",
                         method, path, body, headers or {}, asynchronous=True)

    def tabs(self):
        return self.chrome("""const g = Services.wm.getMostRecentWindow('navigator:browser').gBrowser;
          return g.tabs.map(t => ({ucid: t.userContextId, url: t.linkedBrowser.currentURI.spec, selected: t.selected}));""")

    def follow_selected_tab(self):
        """Marionette pasa a la pestaña seleccionada (la nueva, tras un cambio de usuario).
        Su identificador de ventana es el browserId de la pestaña."""
        handle = str(self.chrome("return Services.wm.getMostRecentWindow('navigator:browser').gBrowser.selectedBrowser.browserId"))
        handles = self.driver.command('GET', '/window/handles')
        assert handle in handles, (handle, handles)
        self.driver.command('POST', '/window', {'handle': handle})
        return handle


def integrated(args, root, checks):
    profile, _ = prepare_profile(root / 'integrado')
    shared = root / 'integrado/perfiles'
    with (profile / 'user.js').open('a') as prefs:
        prefs.write(f'user_pref("extensions.webextensions.uuids", {json.dumps(json.dumps({"inicio@kitsune": UUID}))});\n')
        prefs.write(f'user_pref("kitsune.home.profilesRoot", {json.dumps(str(shared))});\n')
        prefs.write(f'user_pref("browser.startup.homepage", {json.dumps(HOME)});\n')
    evidence = root / 'integrado/evidence'
    evidence.mkdir()
    driver = WebDriver(profile, evidence, browser=args.browser, env={'HOME': str(root / 'integrado/home')})
    session = Session(driver)
    try:
        driver.navigate(HOME)
        eventually(lambda: session.page("return document.documentElement.dataset.profilesReady === 'true'"))
        first = session.fetch('GET', '/api/profiles')['body']
        assert first['currentId'] == first['baseId'], first
        created = session.fetch('POST', '/api/profiles', {'name': 'Insti', 'email': '', 'color': 'teal', 'revision': first['revision']})['body']
        user = created['createdId']
        session.chrome("""const g = Services.wm.getMostRecentWindow('navigator:browser').gBrowser;
          g.addTab('about:robots', {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});""")
        before = session.tabs()
        session.page("fetch(arguments[0], {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'switch'})}); return true",
                     f'/api/profiles/{user}/open')
        eventually(lambda: any(tab['selected'] and tab['ucid'] and tab['url'] == HOME for tab in session.tabs()))
        after = session.tabs()
        assert len(after) == len(before), (before, after)
        assert after[0]['ucid'] > 0 and after[0]['selected'] and after[0]['url'] == HOME, after
        assert after[1] == {**before[1], 'selected': False}, (before, after)
        checks.append('integrado: la pestaña del inicio pasa al otro usuario en su sitio; las demás no se tocan')

        session.follow_selected_tab()
        eventually(lambda: session.page("return document.documentElement.dataset.profilesReady === 'true'"))
        mine = session.fetch('GET', '/api/profiles')['body']
        assert mine['currentId'] == user and mine['baseId'] == first['baseId'], mine
        assert session.page("return document.querySelector('#welcome-line').textContent") == 'Bienvenido, Insti'
        checks.append('integrado: el inicio de esa pestaña es el del otro usuario')

        context = after[0]['ucid']
        session.chrome("Services.wm.getMostRecentWindow('navigator:browser').BrowserCommands.openTab(); return true")
        eventually(lambda: len(session.tabs()) == len(after) + 1)
        fresh = next(tab for tab in session.tabs() if tab['selected'])
        assert fresh['ucid'] == context, session.tabs()
        checks.append('integrado: la pestaña nueva va con el usuario de la pestaña actual')

        identities = session.chrome("""const { ContextualIdentityService } = ChromeUtils.importESModule('moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs');
          return ContextualIdentityService.getPublicIdentities().map(i => ({id: i.userContextId, name: i.name ?? null, l10n: i.l10nId ?? null, color: i.color}));""")
        assert identities == [{'id': context, 'name': 'Insti', 'l10n': None, 'color': 'turquoise'}], identities
        checks.append('integrado: un contenedor por usuario con su nombre y color, sin los de ejemplo')

        buttons = session.chrome("return Services.wm.getMostRecentWindow('navigator:browser').document.documentElement.getAttribute('kitsune-window-buttons')")
        assert buttons == 'kitsune', buttons
        checks.append('integrado: botones de Kitsune en Linux por defecto')
        driver.screenshot('integrado.png', chrome=True)
    finally:
        driver.close()


def server_home(args, root, checks):
    home = load_home()
    browser_data = root / 'servidor/browser'
    state = root / 'servidor/state'
    manager = home.profiles_module.ProfileManager(browser_data, state, launch=lambda *a: None)
    first = manager.snapshot()
    user = manager.create('Insti', '', 'teal', first['revision'])['createdId']
    profile, _ = prepare_profile(root / 'servidor')
    server = home.create_server(profile / 'start', state / 'home.json', port=0, profiles=manager)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    # Otra web que manda a «/?cambiar=…» del inicio: no debe cambiar nada.
    class Foreign(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = f'<!doctype html><title>otra</title><script>location.href = "{origin}/?cambiar={user}"</script>'.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass
    foreign = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Foreign)
    threading.Thread(target=foreign.serve_forever, daemon=True).start()
    with (profile / 'user.js').open('a') as prefs:
        prefs.write(f'user_pref("browser.startup.homepage", {json.dumps(origin + "/")});\n')
    evidence = root / 'servidor/evidence'
    evidence.mkdir()
    driver = WebDriver(profile, evidence, browser=args.browser, env={'KITSUNE_STATE_ROOT': str(state)})
    session = Session(driver)
    try:
        driver.navigate(origin + '/')
        eventually(lambda: session.page("return document.documentElement.dataset.profilesReady === 'true'"))
        assert session.fetch('GET', '/api/profiles')['body']['currentId'] == 'default'
        # La página no puede hacerse pasar por otro usuario: la cabecera la pone el motor.
        faked = session.fetch('GET', '/api/profiles', headers={'X-Kitsune-Usuario': user})['body']
        assert faked['currentId'] == 'default', faked
        checks.append('servidor: la página no puede falsear la cabecera del usuario')

        before = session.tabs()
        session.page("location.assign('/?cambiar=' + arguments[0]); return true", user)
        eventually(lambda: any(tab['selected'] and tab['ucid'] for tab in session.tabs()))
        after = session.tabs()
        assert len(after) == len(before) and after[0]['url'] == origin + '/', after
        session.follow_selected_tab()
        eventually(lambda: session.page("return document.documentElement.dataset.profilesReady === 'true'"))
        assert session.fetch('GET', '/api/profiles')['body']['currentId'] == user
        assert session.page("return document.querySelector('#welcome-line').textContent") == 'Bienvenido, Insti'
        checks.append('servidor: /?cambiar=<id> desde el inicio cambia la pestaña y el servidor ve al usuario')

        # Y de vuelta al principal desde el inicio de otro usuario (su origen lleva el sufijo del contenedor).
        session.page("location.assign('/?cambiar=default'); return true")
        eventually(lambda: any(tab['selected'] and tab['ucid'] == 0 and tab['url'] == origin + '/' for tab in session.tabs()))
        session.follow_selected_tab()
        eventually(lambda: session.page("return document.documentElement.dataset.profilesReady === 'true'"))
        assert session.fetch('GET', '/api/profiles')['body']['currentId'] == 'default'
        checks.append('servidor: desde el inicio de otro usuario se vuelve al principal')

        session.chrome("""const g = Services.wm.getMostRecentWindow('navigator:browser').gBrowser;
          g.selectedTab = g.addTab(arguments[0], {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});""",
                       f'http://127.0.0.1:{foreign.server_port}/')
        eventually(lambda: any(tab['selected'] and tab['url'].startswith(origin) for tab in session.tabs()))
        landed = next(tab for tab in session.tabs() if tab['selected'])
        assert landed['ucid'] == 0 and len(session.tabs()) == len(after) + 1, session.tabs()
        checks.append('servidor: otra web no puede cambiar el usuario de una pestaña')
        driver.screenshot('servidor.png', chrome=True)
    finally:
        driver.close()
        server.shutdown()
        foreign.shutdown()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-users-native-'))
    checks = []
    for name in ('integrado', 'servidor'):
        (root / name).mkdir()
    (root / 'integrado/home').mkdir()
    try:
        integrated(args, root, checks)
        server_home(args, root, checks)
        print(json.dumps({'status': 'passed', 'root': str(root), 'checks': checks}, ensure_ascii=False, indent=2))
    except Exception:
        print(json.dumps({'status': 'failed', 'root': str(root), 'checks': checks}, ensure_ascii=False, indent=2))
        raise


if __name__ == '__main__':
    main()
