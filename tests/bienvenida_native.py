"""La bienvenida de «Tu inicio» en el motor real.

1. Un perfil nuevo la ve la primera vez: elegir Oscuro, una tinta y las pestañas al lado se
   guarda al momento, y «Empezar» la da por vista (al volver ya no sale).
2. Unos ajustes de antes (sin la clave «bienvenida») no la ven.
3. Con Kitsune en inglés sale en inglés, sin nada en castellano.
(En las demás pruebas no sale: el navegador está automatizado. Aquí se pide con ?bienvenida.)
"""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import threading

from browser_smoke import ROOT, WebDriver, prepare_profile, eventually

spec = importlib.util.spec_from_file_location('appearance', ROOT / 'install/appearance.py')
appearance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appearance)
home_spec = importlib.util.spec_from_file_location('native_test_home', ROOT / 'install/home-server.py')
home = importlib.util.module_from_spec(home_spec)
home_spec.loader.exec_module(home)


def start(root, english=False, legacy=False):
    profile, _ = prepare_profile(root)
    if english:
        with (profile / 'user.js').open('a') as prefs:
            prefs.write('user_pref("intl.locale.requested", "en-US");\n')
    state = root / 'state'
    state.mkdir()
    if legacy:
        # Unos ajustes de 0.7, sin la clave «bienvenida».
        data = {key: value for key, value in home.DEFAULT_DATA.items() if key not in ('bienvenida', 'densidad')}
        (state / 'home.json').write_text(json.dumps({'version': 2, 'data': data, 'revision': 3}))
    (root / 'native').mkdir()
    (root / 'native/kitsune-appearance.sys.mjs').write_text('// disponible')
    profiles = home.profiles_module.ProfileManager(root, state)
    profiles.snapshot()
    manager = appearance.AppearanceManager(root, state)
    server = home.create_server(profile / 'start', state / 'home.json', port=0, profiles=profiles, appearance=manager)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return profile, server, manager


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    base = Path(tempfile.mkdtemp(prefix='kitsune-bienvenida-'))
    evidence = base / 'evidence'
    evidence.mkdir()

    def check(name):
        print('PASS ' + name, flush=True)

    def run(name, english=False, legacy=False):
        root = base / name
        root.mkdir()
        profile, server, manager = start(root, english, legacy)
        origin = f'http://127.0.0.1:{server.server_port}'
        driver = WebDriver(profile, evidence, browser=args.browser)
        return driver, server, origin, manager

    def content(driver, script):
        driver.context('content')
        return driver.script(script)

    def settings(server):
        return server.store.snapshot()['data']

    driver = server = None
    try:
        driver, server, origin, _ = run('nuevo')
        driver.navigate(origin + '/?bienvenida')
        eventually(lambda: content(driver, "return document.getElementById('welcome-dialog').open"), timeout=20)
        assert settings(server)['bienvenida'] is False
        eventually(lambda: content(driver, "return document.querySelectorAll('#welcome-tintas .tinta').length") == 6, timeout=10)
        driver.screenshot('bienvenida.png')
        content(driver, "document.querySelector('[data-welcome-theme=oscuro]').click()")
        eventually(lambda: settings(server)['theme'] == 'oscuro', timeout=10)
        content(driver, "document.querySelector('#welcome-tintas .tinta[title=Sakura]').click()")
        eventually(lambda: settings(server)['tinta'] == 'sakura', timeout=10)
        content(driver, "document.querySelector('[data-welcome-tabs=lado]').click()")
        eventually(lambda: settings(server)['tabs'] == 'lado', timeout=10)
        pressed = content(driver, "return [...document.querySelectorAll('#welcome-dialog [aria-pressed=true], #welcome-tintas [aria-checked=true]')].map(b => b.textContent)")
        assert pressed == ['Oscuro', 'Sakura', 'Al lado'], pressed
        driver.screenshot('bienvenida-oscuro.png')
        content(driver, "document.getElementById('welcome-start').click()")
        eventually(lambda: settings(server)['bienvenida'] is True, timeout=10)
        assert not content(driver, "return document.getElementById('welcome-dialog').open")
        driver.navigate(origin + '/?bienvenida')
        eventually(lambda: content(driver, "return document.documentElement.dataset.ready === 'true'"), timeout=20)
        assert not content(driver, "return document.getElementById('welcome-dialog').open")
        check('Un perfil nuevo ve la bienvenida: Oscuro, Sakura y las pestañas al lado se guardan al momento, y «Empezar» la da por vista')
        driver.close(); driver = None; server.shutdown()

        driver, server, origin, _ = run('antiguo', legacy=True)
        driver.navigate(origin + '/?bienvenida')
        eventually(lambda: content(driver, "return document.documentElement.dataset.ready === 'true'"), timeout=20)
        assert settings(server)['bienvenida'] is True
        assert not content(driver, "return document.getElementById('welcome-dialog').open")
        check('Quien ya usaba Kitsune (ajustes sin «bienvenida») no la ve')
        driver.close(); driver = None; server.shutdown()

        driver, server, origin, manager = run('ingles', english=True)
        eventually(lambda: manager.language()['locale'].startswith('en'), timeout=20)
        driver.navigate(origin + '/?bienvenida')
        eventually(lambda: content(driver, "return document.getElementById('welcome-dialog').open"), timeout=20)
        title = eventually(lambda: (value := content(driver, "return document.getElementById('bienvenida-title').textContent")) == 'Welcome to Kitsune' and value, timeout=10)
        spanish = content(driver, """const out = []; const walker = document.createTreeWalker(document.getElementById('welcome-dialog'), NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/[áéíóúñ¿]/i.test(n.nodeValue) && !/Índigo|Bambú/.test(n.nodeValue)) out.push(n.nodeValue.trim()); return out""")
        assert not spanish, spanish
        driver.screenshot('welcome.png')
        check(f'Con Kitsune en inglés, la bienvenida sale en inglés («{title}»)')
    finally:
        if driver:
            driver.close()
        if server:
            server.shutdown()
        print(evidence, flush=True)


if __name__ == '__main__':
    main()
