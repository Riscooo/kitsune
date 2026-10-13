"""Privacidad que se ve en el motor real (perfil temporal, sin ventana en pantalla).

1. El módulo nativo resume lo que Gecko ha bloqueado (su base de datos de protecciones,
   la de about:protections) en chrome/kitsune-privacy.json: solo números por tipo.
2. El servidor del inicio lo sirve en /api/privacidad.
3. El inicio lo dice bajo el buscador («Esta semana Kitsune ha bloqueado…»), con un botón
   al informe completo.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time

from browser_smoke import ROOT, WebDriver, prepare_profile, eventually

spec = importlib.util.spec_from_file_location('appearance', ROOT / 'install/appearance.py')
appearance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appearance)
home_spec = importlib.util.spec_from_file_location('native_test_home', ROOT / 'install/home-server.py')
home = importlib.util.module_from_spec(home_spec)
home_spec.loader.exec_module(home)

# Lo que Gecko apunta al bloquear: por web, [estado, bloqueado, veces]. 4096 = rastreador,
# 0x40000000 = cookie de rastreo (Ci.nsIWebProgressListener.STATE_BLOCKED_TRACKING_CONTENT y
# STATE_COOKIES_BLOCKED_TRACKER).
EVENTS = """const done = arguments[arguments.length - 1];
const S = Cc['@mozilla.org/tracking-db-service;1'].getService(Ci.nsITrackingDBService);
const L = Ci.nsIWebProgressListener;
S.saveEvents(JSON.stringify({
  'https://anuncios.example': [[L.STATE_BLOCKED_TRACKING_CONTENT, true, 7]],
  'https://huellas.example': [[L.STATE_BLOCKED_FINGERPRINTING_CONTENT, true, 2]],
  'https://galletas.example': [[L.STATE_COOKIES_BLOCKED_TRACKER, true, 3]],
})).then(() => ChromeUtils.importESModule('chrome://browser/content/kitsune-appearance.sys.mjs').KitsuneAppearance.writePrivacyStats())
  .then(() => done(true), e => done('ERR ' + e));"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-privacy-line-'))
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

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        driver.context('chrome')
        assert driver.script(EVENTS, asynchronous=True) is True
        stats = json.loads((profile / 'chrome/kitsune-privacy.json').read_text())
        # Gecko cuenta una vez cada web y estado (no las veces de la lista).
        assert stats['today']['trackers'] == 1 and stats['today']['cookies'] == 1 and stats['today']['fingerprinters'] == 1, stats
        assert stats['week']['total'] == 3 and set(stats) == {'version', 'at', 'today', 'week'}, stats
        assert 'example' not in json.dumps(stats)
        check('El módulo resume lo bloqueado por tipo (hoy: un rastreador, una cookie y una huella) y sin ninguna web')

        served = manager.privacy()
        assert served['available'] and served['week']['total'] == 3, served
        check('El servidor del inicio lo sirve en /api/privacidad')

        driver.navigate(origin + '/')
        driver.context('content')
        text = eventually(lambda: (t := driver.script("const l = document.getElementById('privacy-line'); return l.hidden ? '' : l.textContent")) and t, timeout=15)
        assert 'Esta semana Kitsune ha bloqueado 3 rastreadores (3 hoy)' in text and 'Ver el informe' in text, text
        assert driver.script("return document.querySelector('.privacy-report').dataset.nativeAction") == 'protections'
        time.sleep(1.5)  # el inicio entra con su animación de tinta
        driver.screenshot('inicio-privacidad.png', chrome=True)
        check(f'El inicio lo dice bajo el buscador: «{text}»')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown(); server.server_close(); worker.join(timeout=3)
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
