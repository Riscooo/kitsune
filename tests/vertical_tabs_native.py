"""Pestañas a un lado en el motor real (perfil temporal, sin ventana en pantalla).

1. «Tu inicio» → Ajustes → Pestañas → «A un lado» las pasa a una barra lateral, en directo:
   la elección viaja por el servidor del inicio y el control v8 hasta el módulo nativo.
2. «Iconos» deja la barra estrecha (se abre al pasar el ratón) y «Arriba» las devuelve
   arriba y quita lo que puso Kitsune (sidebar.revamp vuelve a su valor de Kitsune).
3. Sin la tarjeta de Mozilla de «arrastra aquí las pestañas importantes».
4. El texto de la barra lateral se lee en Claro y en Oscuro (≥ 3:1, como contrast_native.py).
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

STATE = """const tabs = document.getElementById('tabbrowser-tabs');
  return {orient: tabs.getAttribute('orient'), expanded: tabs.hasAttribute('expanded'),
          vertical: Services.prefs.getBoolPref('sidebar.verticalTabs'), revamp: Services.prefs.getBoolPref('sidebar.revamp'),
          revampSet: Services.prefs.prefHasUserValue('sidebar.revamp'),
          visibility: Services.prefs.getStringPref('sidebar.visibility', ''),
          applied: Services.prefs.getStringPref('kitsune.tabs.applied', ''),
          width: document.getElementById('sidebar-container')?.getBoundingClientRect().width ?? 0,
          promo: !!document.querySelector('#drag-to-pin-promo-card:not([hidden])')?.getBoundingClientRect().height};"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-vertical-tabs-'))
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

    def api(path, method='GET', value=None):
        headers = {'Origin': origin}
        if value is not None:
            headers.update({'Content-Type': 'application/json', 'X-Kitsune-Token': server.token})
        request = urllib.request.Request(origin + path, method=method, headers=headers,
                                         data=None if value is None else json.dumps(value).encode())
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    def save(**patch):
        snapshot = api('/api/settings')
        result = api('/api/settings', 'PUT', {'revision': snapshot['revision'], 'data': {**snapshot['data'], **patch}})
        eventually(lambda: api('/api/appearance')['native']['status'] == 'applied' and
                   api('/api/appearance')['fingerprint'] == result['appearance']['fingerprint'], timeout=25)

    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def content(script):
        driver.context('content'); return driver.script(script)

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        save(motion=True)
        first = chrome(STATE)
        assert first['orient'] == 'horizontal' and not first['vertical'] and first['applied'] == 'arriba', first
        check('Por defecto, las pestañas siguen arriba y Kitsune no toca nada')

        # Desde el propio inicio, como lo haría Risco.
        driver.navigate(origin + '/')
        eventually(lambda: content("return document.documentElement.dataset.storageReady") == 'true', timeout=15)
        driver.click('#settings-open')
        eventually(lambda: content("return !document.querySelector('[data-tabs=lado]').disabled"), timeout=10)
        content("document.querySelector('[data-tabs=lado]').click()")
        eventually(lambda: chrome(STATE)['orient'] == 'vertical', timeout=20)
        side = chrome(STATE)
        assert side['vertical'] and side['revamp'] and side['visibility'] == 'always-show' and side['applied'] == 'lado', side
        assert side['expanded'] and side['width'] > 150, side
        assert content("return document.querySelector('[data-tabs=lado]').getAttribute('aria-pressed')") == 'true'
        assert not side['promo'], side
        for url in ('data:text/html;charset=utf-8,<title>Correo</title>uno', 'data:text/html;charset=utf-8,<title>Documentación</title>dos'):
            chrome("gBrowser.addTab(arguments[0], {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()})", [url])
        time.sleep(1)
        driver.screenshot('a-un-lado.png', chrome=True)
        check('«A un lado» pasa las pestañas a una barra lateral en directo, sin la tarjeta de Mozilla')

        save(tabs='iconos')
        eventually(lambda: chrome(STATE)['visibility'] == 'expand-on-hover', timeout=10)
        eventually(lambda: not chrome(STATE)['expanded'], timeout=10)
        icons = chrome(STATE)
        assert icons['orient'] == 'vertical' and icons['width'] < 80, icons
        driver.screenshot('iconos.png', chrome=True)
        check(f"«Iconos» deja la barra estrecha ({icons['width']:.0f} px) y se abre al pasar el ratón")

        for theme in ('claro', 'oscuro'):
            save(tabs='lado', theme=theme)
            eventually(lambda: chrome(STATE)['expanded'], timeout=10)
            time.sleep(1)
            result = chrome(AUDIT, ['sidebar'])
            assert result['checked'] >= 3, result
            assert not result['low'], f'{theme}: texto con poco contraste en la barra lateral: {result["low"]}'
            driver.screenshot(f'a-un-lado-{theme}.png', chrome=True)
            check(f'En {theme.capitalize()}, los {result["checked"]} textos de la barra lateral se leen (≥ {MINIMUM:g}:1)')

        save(tabs='arriba')
        eventually(lambda: chrome(STATE)['orient'] == 'horizontal', timeout=20)
        top = chrome(STATE)
        assert not top['vertical'] and not top['revampSet'] and not top['revamp'] and top['applied'] == 'arriba', top
        check('«Arriba» las devuelve arriba y quita lo que puso Kitsune (sidebar.revamp vuelve a apagado)')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown(); server.server_close(); worker.join(timeout=3)
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
