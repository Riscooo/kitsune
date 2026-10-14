"""Tintas en el motor real (perfil temporal, sin ventana en pantalla, servidor del inicio).

1. «Tu inicio» → Apariencia enseña una muestra por tinta del catálogo, con Papel elegida.
2. Elegir Sakura pinta la ventana (los tokens --kb-* del módulo nativo) y el propio inicio.
3. Sakura en Oscuro usa su paleta oscura; volver a Papel lo deja como siempre.
4. La ventana con cada tinta del catálogo se sigue leyendo (contraste ≥ 3:1, como contrast_native.py).
"""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import urllib.request

from browser_smoke import ROOT, WebDriver, prepare_profile, eventually
from contrast_native import AUDIT, MINIMUM

spec = importlib.util.spec_from_file_location('appearance', ROOT / 'install/appearance.py')
appearance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appearance)
home_spec = importlib.util.spec_from_file_location('native_test_home', ROOT / 'install/home-server.py')
home = importlib.util.module_from_spec(home_spec)
home_spec.loader.exec_module(home)
CATALOG = appearance.tintas.load()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-tintas-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    state = root / 'state'; state.mkdir()
    (root / 'native').mkdir(); (root / 'native/kitsune-appearance.sys.mjs').write_text('// disponible')
    profiles = home.profiles_module.ProfileManager(root, state)
    profiles.snapshot()
    manager = appearance.AppearanceManager(root, state)
    server = home.create_server(profile / 'start', state / 'home.json', port=0, profiles=profiles, appearance=manager)
    worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    report = {'root': str(root), 'checks': []}
    driver = None

    def api(path, method='GET', value=None):
        headers = {'Origin': origin}
        if value is not None:
            headers.update({'Content-Type': 'application/json', 'X-Kitsune-Token': server.token})
        request = urllib.request.Request(origin + path, method=method, headers=headers, data=None if value is None else json.dumps(value).encode())
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    def save(**patch):
        snapshot = api('/api/settings')
        result = api('/api/settings', 'PUT', {'revision': snapshot['revision'], 'data': {**snapshot['data'], **patch}})
        eventually(lambda: api('/api/appearance')['native']['status'] == 'applied' and
                   api('/api/appearance')['fingerprint'] == result['appearance']['fingerprint'], timeout=25)

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def content(script):
        driver.context('content'); return driver.script(script)

    window_bg = lambda: chrome("return getComputedStyle(document.documentElement).getPropertyValue('--kb-bg').trim()")
    home_bg = lambda: content("return getComputedStyle(document.documentElement).getPropertyValue('--kb-bg').trim()")
    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        save(motion=True)
        driver.navigate(origin + '/')
        eventually(lambda: content("return document.documentElement.dataset.storageReady") == 'true', timeout=15)
        driver.click('#settings-open')
        eventually(lambda: content("return document.querySelectorAll('#tinta-grid .tinta').length") == len(CATALOG), timeout=10)
        assert content("return document.querySelector('#tinta-grid [aria-checked=true]').dataset.tinta") == 'papel'
        check(f'El selector enseña las {len(CATALOG)} tintas del catálogo, con Papel elegida')

        eventually(lambda: content("return !document.querySelector('#tinta-grid [data-tinta=sakura]').disabled"), timeout=10)
        content("document.querySelector('#tinta-grid [data-tinta=sakura]').click()")
        sakura = CATALOG['sakura']
        eventually(lambda: window_bg() == sakura['claro']['bg'], timeout=20)
        eventually(lambda: home_bg() == sakura['claro']['bg'], timeout=10)
        time.sleep(0.5)
        driver.screenshot('sakura.png', chrome=True)
        check('Elegir Sakura pinta la ventana y el propio inicio con su paleta')

        save(theme='oscuro')
        eventually(lambda: window_bg() == sakura['oscuro']['bg'], timeout=20)
        save(theme='claro', tinta='papel')
        eventually(lambda: window_bg() == CATALOG['papel']['claro']['bg'], timeout=20)
        check('Sakura en Oscuro usa su paleta oscura, y volver a Papel lo deja como siempre')

        driver.navigate('about:blank')
        for tinta in CATALOG:
            for theme in ('claro', 'oscuro'):
                save(tinta=tinta, theme=theme)
                eventually(lambda: window_bg() == CATALOG[tinta][theme]['bg'], timeout=20)
                # Al cambiar de tema, la barra funde sus colores durante 1,1 s: se mide al acabar.
                eventually(lambda: not chrome("return document.documentElement.hasAttribute('kitsune-theme-changing')"), timeout=5)
                time.sleep(0.3)
                result = chrome(AUDIT, ['toolbox'])
                if result['low']:
                    driver.screenshot(f'poco-contraste-{tinta}-{theme}.png', chrome=True)
                assert result['checked'] > 0 and not result['low'], f'{tinta} {theme}: {result["low"]}'
        check(f'La ventana se lee con las {len(CATALOG)} tintas en Claro y en Oscuro (≥ {MINIMUM:g}:1)')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown(); server.server_close(); worker.join(timeout=3)
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
