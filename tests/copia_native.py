"""Copia de Kitsune en el motor real: de un perfil a otro, con un archivo cifrado.

1. En un perfil con marcadores, un espacio «Trabajo» con dos pestañas, historial y una contraseña,
   se guarda una copia: el archivo no deja ver nada de eso.
2. En un perfil nuevo, con otra contraseña no se abre; con la buena llegan los marcadores (en su
   carpeta), el espacio con sus pestañas (sin cargar), el historial y la contraseña.
3. La copia está en el menú y en la paleta, con su panel.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading

from browser_smoke import WebDriver, prepare_profile, eventually

SPACES = "ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs').KitsuneSpaces"
COPIA = "ChromeUtils.importESModule('chrome://browser/content/kitsune-copia.sys.mjs').KitsuneCopia"
PASSWORD = 'zorro de nueve colas'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-copia-'))
    evidence = root / 'evidence'
    evidence.mkdir()
    pages = root / 'web'
    pages.mkdir()
    for name in ('informe', 'correo'):
        (pages / f'{name}.html').write_text(f'<title>{name.capitalize()}</title><h1>{name}</h1>')

    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(pages)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    # «localhost» y no 127.0.0.1: la copia deja fuera las direcciones del inicio local.
    origin = f'http://localhost:{server.server_port}'
    copy_path = root / 'mi.kitsune'

    def session(name):
        (root / name).mkdir()
        profile, _ = prepare_profile(root / name)
        return WebDriver(profile, evidence, browser=args.browser)

    def chrome(driver, script, *values, asynchronous=False):
        driver.context('chrome')
        return driver.script(script, list(values), asynchronous)

    def check(name):
        print('PASS ' + name, flush=True)

    driver = None
    try:
        driver = session('origen')
        eventually(lambda: chrome(driver, f"return !!{SPACES}.list().spaces.length && !!document.getElementById('kitsune-copia-panel')"), timeout=20)
        prepared = chrome(driver, f"""const [origin, done] = arguments; (async () => {{
            const {{ PlacesUtils }} = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
            await PlacesUtils.bookmarks.insert({{ parentGuid: PlacesUtils.bookmarks.toolbarGuid, url: 'https://github.com/Riscooo/kitsune', title: 'Kitsune en GitHub' }});
            await PlacesUtils.history.insert({{ url: 'https://es.wikipedia.org/wiki/Kitsune', title: 'Kitsune', visits: [{{ date: new Date() }}] }});
            const login = Cc['@mozilla.org/login-manager/loginInfo;1'].createInstance(Ci.nsILoginInfo);
            login.init('https://cuenta.example', 'https://cuenta.example', null, 'kai', 'clave-de-prueba', 'u', 'p');
            await Services.logins.addLoginAsync(login);
            const S = {SPACES}; const id = await S.create({{ name: 'Trabajo', color: 'blue', user: null }});
            await S.switchTo(window, id);
            const P = Services.scriptSecurityManager.getSystemPrincipal();
            for (const name of ['informe', 'correo']) gBrowser.selectedTab = gBrowser.addTab(`${{origin}}/${{name}}.html`, {{ triggeringPrincipal: P }});
          }})().then(() => done(true), e => done(String(e)));""", origin, asynchronous=True)
        assert prepared is True, prepared
        eventually(lambda: chrome(driver, "return [...gBrowser.tabs].filter(t => /informe|correo/.test(t.linkedBrowser.currentURI.spec)).length") == 2, timeout=15)
        saved = chrome(driver, f"""const [path, password, done] = arguments;
          {COPIA}.save(window, {{ path, password, bookmarks: true, tabs: true, history: true, logins: true }})
            .then(copy => done({{ tabs: copy.tabs.map(t => t.space + ' ' + t.title), spaces: copy.spaces.map(s => s.name), logins: copy.logins.length }}), e => done(String(e)));""",
                       str(copy_path), PASSWORD, asynchronous=True)
        assert 'Trabajo' in saved['spaces'] and 'Trabajo Informe' in saved['tabs'] and saved['logins'] == 1, saved
        raw = copy_path.read_text()
        assert json.loads(raw)['kitsune'] == 'copia' and 'github' not in raw and 'clave-de-prueba' not in raw and 'Trabajo' not in raw
        driver.close(); driver = None
        check('Una copia guarda marcadores, el espacio con sus pestañas, historial y contraseñas, y el archivo no deja ver nada')

        driver = session('destino')
        eventually(lambda: chrome(driver, "return !!document.getElementById('kitsune-copia-panel')"), timeout=20)
        LOAD = f"""const [path, password, done] = arguments;
          {COPIA}.load(window, {{ path, password, bookmarks: true, tabs: true, history: true, logins: true }})
            .then(({{ result }}) => done(result), e => done({{ error: e.message }}));"""
        wrong = chrome(driver, LOAD, str(copy_path), 'otra contraseña', asynchronous=True)
        assert wrong == {'error': 'password'}, wrong
        result = chrome(driver, LOAD, str(copy_path), PASSWORD, asynchronous=True)
        assert result['bookmarks'] == 1 and result['tabs'] == 2 and result['spaces'] == 1 and result['logins'] == 1 and result['pages'] >= 1, result
        state = chrome(driver, f"""const done = arguments[0]; (async () => {{
            const {{ PlacesUtils }} = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
            const found = await PlacesUtils.bookmarks.fetch({{ url: 'https://github.com/Riscooo/kitsune' }});
            const folder = found ? await PlacesUtils.bookmarks.fetch(found.parentGuid) : null;
            const top = folder ? await PlacesUtils.bookmarks.fetch(folder.parentGuid) : null;
            const visited = await PlacesUtils.history.hasVisits('https://es.wikipedia.org/wiki/Kitsune');
            const logins = await Services.logins.searchLoginsAsync({{ origin: 'https://cuenta.example' }});
            const S = {SPACES}; const trabajo = S.list().spaces.find(s => s.name === 'Trabajo');
            const {{ tabSpace }} = ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs');
            const tabs = [...gBrowser.tabs].filter(t => tabSpace(t) === trabajo?.id).map(t => ({{ label: t.label, lazy: !t.linkedPanel || !t.linkedBrowser.isConnected || t.hasAttribute('pending') }}));
            return {{ folder: top?.title, visited, logins: logins.map(l => l.username + ':' + l.password), tabs }};
          }})().then(done, e => done(String(e)));""", asynchronous=True)
        assert state['folder'] and state['folder'].startswith('De otro Kitsune'), state
        assert state['visited'] and state['logins'] == ['kai:clave-de-prueba'], state
        assert sorted(tab['label'] for tab in state['tabs']) == ['Correo', 'Informe'], state
        check('En otro perfil, con otra contraseña no se abre; con la buena llegan marcadores, el espacio con sus pestañas, historial y la contraseña')

        chrome(driver, f"{COPIA}.open(window)")
        eventually(lambda: chrome(driver, "return document.getElementById('kitsune-copia-panel').state") == 'open', timeout=5)
        boxes = chrome(driver, "return [...document.querySelectorAll('#kitsune-copia-panel input[type=checkbox]')].map(i => i.name + '=' + i.checked)")
        assert boxes == ['bookmarks=true', 'tabs=true', 'history=false', 'logins=false'], boxes
        driver.screenshot('panel.png', chrome=True)
        chrome(driver, "document.getElementById('kitsune-copia-panel').hidePopup()")
        check('El panel de la copia: marcadores y pestañas de serie; historial y contraseñas, si los marcas')
    finally:
        if driver:
            driver.close()
        server.shutdown()
        print(evidence, flush=True)


if __name__ == '__main__':
    main()
