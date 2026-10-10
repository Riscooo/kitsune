"""Ventana, modo ahorro y veta de tinta en el motor real (perfil temporal).

1. Los botones de cerrar y ampliar pasan a la derecha y el logo se oculta, en directo.
2. El modo ahorro pone sus ajustes (60 fps, menos procesos, sin bfcache) y al volver
   a Normal los quita; el inicio dice cuánta memoria usa Kitsune.
3. Al pasar a Oscuro, el inicio cruza la veta de tinta (view transition).
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

spec = importlib.util.spec_from_file_location('appearance', ROOT / 'install/appearance.py')
appearance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appearance)
home_spec = importlib.util.spec_from_file_location('native_test_home', ROOT / 'install/home-server.py')
home = importlib.util.module_from_spec(home_spec)
home_spec.loader.exec_module(home)
SAVER = {'layout.frame_rate': 60, 'dom.ipc.processCount': 2, 'browser.sessionhistory.max_total_viewers': 0}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-window-saver-'))
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

    def chrome(script):
        driver.context('chrome'); return driver.script(script)

    def content(script):
        driver.context('content'); return driver.script(script)

    try:
        driver = WebDriver(profile, evidence, browser=args.browser, headed=True)
        save(motion=True)
        side = lambda: chrome("""const c=document.querySelector('#TabsToolbar .titlebar-buttonbox-container').getBoundingClientRect();
          return c.x + c.width / 2 > innerWidth / 2 ? 'derecha' : 'izquierda';""")
        assert side() == 'izquierda', side()
        save(windowControls='derecha', brand=False)
        eventually(lambda: side() == 'derecha', timeout=10)
        assert chrome("return getComputedStyle(document.getElementById('TabsToolbar'),'::before').display") == 'none'
        driver.screenshot('botones-derecha.png', chrome=True)
        save(windowControls='izquierda', brand=True)
        eventually(lambda: side() == 'izquierda', timeout=10)
        check('Los botones de la ventana cambian de lado y el logo se oculta, sin reiniciar')

        prefs = lambda: chrome("return " + json.dumps(list(SAVER)) + ".map(n => Services.prefs.prefHasUserValue(n) ? Services.prefs.getIntPref(n) : null)")
        save(performance='ahorro', ramLimit=1024)
        eventually(lambda: prefs() == list(SAVER.values()), timeout=10)
        assert chrome("return Services.prefs.getStringPref('kitsune.performance.applied','')") == 'ahorro'
        save(performance='normal')
        eventually(lambda: prefs() == [None] * len(SAVER), timeout=10)
        check('El modo ahorro pone 60 fps, menos procesos y sin bfcache, y al volver a Normal se quitan')
        memory = api('/api/rendimiento')
        assert isinstance(memory['memoryMB'], int) and memory['memoryMB'] > 50 and memory['processes'] >= 2, memory
        check(f"El inicio sabe cuánta memoria usa Kitsune ({memory['memoryMB']} MB en {memory['processes']} procesos)")

        driver.navigate(origin + '/')
        eventually(lambda: content("return document.documentElement.dataset.storageReady") == 'true', timeout=15)
        assert content("return typeof document.startViewTransition") == 'function'
        driver.click('#settings-open')
        eventually(lambda: content("return !document.querySelector('#theme-oscuro').disabled"), timeout=10)
        content("document.querySelector('label[for=theme-oscuro]').click()")
        eventually(lambda: content("return document.documentElement.dataset.inkDir || ''") == 'ltr', timeout=3)
        # La veta entra en la llamada de la transición, un instante después de marcar la dirección.
        eventually(lambda: content("return !!document.querySelector('.ink-vein')"), timeout=3)
        time.sleep(0.5)
        driver.screenshot('veta-a-medias.png', chrome=True)
        eventually(lambda: not content("return !!document.querySelector('.ink-vein')"), timeout=5)
        assert content("return document.documentElement.dataset.theme") == 'oscuro'
        check('Al pasar a Oscuro cruza la veta de tinta y termina en el tema nuevo')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown(); server.server_close(); worker.join(timeout=3)
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
