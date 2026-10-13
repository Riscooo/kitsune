"""El inicio integrado (Windows y macOS) en el motor real, sin servidor local.

Monta la extensión inicio@kitsune igual que la receta del motor, la instala como
extensión interna en un perfil temporal (con un HOME temporal: los perfiles de
Gecko que se creen no tocan los de verdad) y comprueba desde su propia página:

1. El inicio carga sin servidor, con el perfil genérico «Personal».
2. Pasar a Oscuro guarda los ajustes en el perfil y el módulo nativo aplica el control.
3. Un fondo propio se vuelve a codificar en JPEG, se guarda y se ve en el inicio.
4. Editar el perfil (nombre y modo Cómodo) lo guarda y deja el modo en su user.js.
5. Los fondos de serie se bajan y comprueban, la galería se completa y uno se pone de fondo.
6. Crear un usuario no crea un perfil de Gecko (vive en un contenedor de este) y
   Ajustes se abre en una pestaña aquí mismo.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time

from browser_smoke import ROOT, WebDriver, prepare_profile, eventually

spec = importlib.util.spec_from_file_location('engine', ROOT / 'install/kitsune-engine.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)
UUID = '4b1d7c2e-9a3f-4e6b-8c51-2f7a0d9e6b13'
HOME = f'moz-extension://{UUID}/start/index.html'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-home-integrated-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    shared = root / 'perfiles'
    with (profile / 'user.js').open('a') as prefs:
        # Lo que kitsune.cfg hace en un motor nuevo: el UUID fijo del inicio integrado.
        prefs.write(f'user_pref("extensions.webextensions.uuids", {json.dumps(json.dumps({"inicio@kitsune": UUID}))});\n')
        prefs.write(f'user_pref("kitsune.home.profilesRoot", {json.dumps(str(shared))});\n')
        prefs.write('user_pref("kitsune.home.testResource", "resource://kitsune-home-test/");\n')
    extension = engine.stage_home_extension(root / 'extension', '0.7.1')
    fake_home = root / 'home'; fake_home.mkdir()
    real_home = os.environ['HOME']
    os.environ['HOME'] = str(fake_home)
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, *values, asynchronous=False):
        driver.context('chrome'); return driver.script(script, values, asynchronous)

    def page(script, *values, asynchronous=False):
        driver.context('content'); return driver.script(script, values, asynchronous)

    def api(method, path, body=None):
        return page("""const [method, path, body, done] = arguments;
          fetch(path, {method, headers: {'Content-Type': 'application/json'}, body: body === null ? undefined : JSON.stringify(body)})
            .then(async r => done({status: r.status, body: await r.json()}), e => done({error: String(e)}));""",
                    method, path, body, asynchronous=True)

    try:
        driver = WebDriver(profile, evidence, browser=args.browser, headed=True)
        os.environ['HOME'] = real_home
        installed = chrome("""const [folder, done] = arguments;
          const resources = Services.io.getProtocolHandler('resource').QueryInterface(Ci.nsIResProtocolHandler);
          const directory = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile); directory.initWithPath(folder);
          resources.setSubstitution('kitsune-home-test', Services.io.newFileURI(directory));
          const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
          AddonManager.maybeInstallBuiltinAddon('inicio@kitsune', '0.7.1', 'resource://kitsune-home-test/')
            .then(() => AddonManager.getAddonByID('inicio@kitsune'))
            .then(addon => done({id: addon.id, hidden: addon.hidden, isBuiltin: addon.isBuiltin,
                                  url: WebExtensionPolicy.getByID('inicio@kitsune')?.getURL('start/index.html')}),
                  error => done({error: String(error)}));""", str(extension), asynchronous=True)
        assert installed.get('url') == HOME and installed['hidden'] and installed['isBuiltin'], installed
        check('La extensión del inicio se instala como interna y oculta, con su dirección fija')

        driver.navigate(HOME)
        eventually(lambda: page("return document.documentElement.dataset.storageReady") == 'true', timeout=15)
        eventually(lambda: 'Personal' in page("return document.querySelector('#welcome-line').textContent"), timeout=10)
        profiles = api('GET', '/api/profiles')
        assert profiles['status'] == 200 and [p['name'] for p in profiles['body']['profiles']] == ['Personal'], profiles
        assert profiles['body']['profiles'][0]['email'] == ''
        driver.settle(); time.sleep(1.5)
        driver.screenshot('inicio-integrado.png', chrome=True)
        check('El inicio carga sin servidor, con el perfil genérico «Personal» y sin datos de nadie')

        driver.context('content'); driver.click('#settings-open')
        eventually(lambda: page("return !document.querySelector('#theme-oscuro').disabled"), timeout=10)
        page("document.querySelector('label[for=theme-oscuro]').click()")
        eventually(lambda: json.loads((profile / 'kitsune-home.json').read_text())['data']['theme'] == 'oscuro', timeout=10)
        eventually(lambda: json.loads((profile / 'chrome/kitsune-appearance.json').read_text())['theme'] == 'oscuro', timeout=10)
        control = json.loads((profile / 'chrome/kitsune-appearance.json').read_text())
        assert control['version'] == 7 and control['theme'] == 'oscuro' and control['palette']['bg'] == '#161a19', control
        eventually(lambda: api('GET', '/api/appearance')['body']['native']['status'] == 'applied', timeout=15)
        assert chrome("return Services.prefs.getIntPref('ui.systemUsesDarkTheme', -1)") == 1
        check('Oscuro se guarda en el perfil y el módulo nativo aplica el control del inicio integrado')

        image = page("""const canvas = document.createElement('canvas'); canvas.width = 3000; canvas.height = 1200;
          const context = canvas.getContext('2d'); const gradient = context.createLinearGradient(0, 0, 3000, 0);
          gradient.addColorStop(0, '#963d32'); gradient.addColorStop(1, '#161a19');
          context.fillStyle = gradient; context.fillRect(0, 0, 3000, 1200); return canvas.toDataURL('image/png');""")
        stored = api('POST', '/api/background', {'imageData': image})
        if stored['status'] != 200: print(chrome("return Services.console.getMessageArray().map(m => m.message || String(m)).filter(t => /inicio integrado/.test(t)).slice(-3).join('\\n')"))
        assert stored['status'] == 200, stored
        digest = stored['body']['data']['background']
        saved = profile / 'chrome' / f'kitsune-background-{digest}.jpg'
        data = saved.read_bytes()
        assert data[:3] == b'\xff\xd8\xff' and len(data) < 4 * 1024 * 1024, len(data)
        driver.navigate(HOME)
        eventually(lambda: page("return document.documentElement.dataset.background") == 'on', timeout=15)
        assert page("return getComputedStyle(document.documentElement).getPropertyValue('--home-background')").startswith('url("blob:')
        loaded = page("""const done = arguments[0]; const url = getComputedStyle(document.documentElement).getPropertyValue('--home-background').match(/blob:[^")]+/)[0];
          const image = new Image(); image.onload = () => done([image.naturalWidth, image.naturalHeight]); image.onerror = () => done(null); image.src = url;""", asynchronous=True)
        assert loaded == [2560, 1024], loaded
        assert api('POST', '/api/background', {'imageData': 'data:image/svg+xml;base64,PHN2Zy8+'})['status'] == 400
        driver.settle(); time.sleep(1.5)
        driver.screenshot('fondo-integrado.png', chrome=True)
        check('Un fondo propio se vuelve a codificar en JPEG, se guarda en el perfil y se ve en el inicio')

        # Fondos de serie: la primera vez se bajan del CDN (comprobados) y la galería se completa sola.
        eventually(lambda: api('GET', '/api/wallpapers')['body']['pending'] is False, timeout=240)
        gallery = api('GET', '/api/wallpapers')['body']['categories']
        names = [category['name'] for category in gallery]
        assert {'Abstractos', 'Colores'} <= set(names) and 'firefox' not in str(gallery).lower(), names
        preset = gallery[0]['items'][0]
        chosen = api('POST', '/api/background', {'preset': preset['id']})
        assert chosen['status'] == 200 and chosen['body']['data']['background'] == preset['sha256'], chosen
        thumb = page("""const [path, done] = arguments; browser.kitsuneHome.request('GET', path).then(r => {
          const image = new Image(); image.onload = () => done([image.naturalWidth, image.naturalHeight]); image.onerror = () => done(null);
          image.src = URL.createObjectURL(new Blob([r.bytes], {type: r.contentType})); });""", f"/api/wallpapers/{preset['id']}.jpg", asynchronous=True)
        assert thumb == [320, 200], thumb
        driver.context('content'); driver.navigate(HOME)
        eventually(lambda: page("return document.documentElement.dataset.storageReady") == 'true', timeout=15)
        driver.click('#settings-open')
        eventually(lambda: page("return document.querySelectorAll('#preset-gallery .preset-tile img').length") > 20, timeout=15)
        eventually(lambda: page("return [...document.querySelectorAll('#preset-gallery .preset-tile img')].filter(i => i.naturalWidth === 320).length") > 20, timeout=15)
        driver.settle(); time.sleep(1)
        driver.screenshot('galeria-integrada.png', chrome=True)
        check(f"Fondos de serie: {sum(len(c['items']) for c in gallery)} comprobados en {len(gallery)} categorías, sin los de Firefox, y uno elegido de fondo")

        revision = api('GET', '/api/profiles')['body']['revision']
        edited = api('PATCH', '/api/profiles/default', {'name': 'Ana', 'email': '', 'color': 'pink', 'revision': revision,
                                                        'privacyMode': 'comodo'})
        assert edited['status'] == 200 and edited['body']['profiles'][0]['name'] == 'Ana', edited
        assert 'user_pref("kitsune.privacy.requested", "comodo");' in (profile / 'user.js').read_text()
        assert api('PATCH', '/api/profiles/default', {'name': 'Ana', 'email': '', 'color': 'pink', 'revision': revision})['status'] == 409
        registry = json.loads((shared / 'kitsune-profiles.json').read_text())
        assert registry['profiles'][0]['privacyMode'] == 'comodo'
        check('Editar el perfil guarda nombre y modo, y deja el modo en su user.js para el próximo arranque')

        created = api('POST', '/api/profiles', {'name': 'Trabajo', 'email': 'yo@example.com', 'color': 'teal',
                                                'revision': edited['body']['revision']})
        if created['status'] != 200: print(chrome("return Services.console.getMessageArray().map(m => m.message || String(m)).filter(t => /inicio integrado/.test(t)).slice(-3).join('\\n')"))
        assert created['status'] == 200, created
        record = json.loads((shared / 'kitsune-profiles.json').read_text())
        new = next(p for p in record['profiles'] if p['id'] == created['body']['createdId'])
        # Usuarios en la misma ventana: un usuario nuevo es un contenedor de este perfil.
        assert new['path'] == f"kitsune-usuario:{new['id']}", new
        assert not any(f'kitsune-{new["id"]}' in path.read_text() for path in fake_home.rglob('profiles.ini'))
        tabs = chrome("return gBrowser.tabs.length")
        opened = api('POST', '/api/profiles/default/open', {'action': 'settings'})
        assert opened['status'] == 200 and opened['body']['launchRequested'], opened
        eventually(lambda: chrome("return gBrowser.tabs.length") == tabs + 1, timeout=10)
        eventually(lambda: chrome("return gBrowser.selectedBrowser.currentURI.spec").startswith('about:preferences'), timeout=10)
        check('Crear un usuario no crea un perfil de Gecko, y Ajustes se abre aquí')
        report['status'] = 'passed'
    finally:
        os.environ['HOME'] = real_home
        if driver: driver.close()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
