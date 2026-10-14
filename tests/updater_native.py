"""Kitsune se actualiza solo en el paquete de Linux, en el motor real (kitsune-updater.sys.mjs).

Con una lista de descargas local (127.0.0.1) y un paquete falso cuyo instalar.sh deja una marca:
1. Si el .tar.xz no da el SHA-256 de su SHA256SUMS.txt, no se prepara nada y queda el aviso
   de siempre («Descargar»).
2. Con el SHA-256 bueno, se descarga, se comprueba, se descomprime y queda listo
   («está listo: se instala al cerrar»); instalar.sh no se ejecuta hasta cerrar Kitsune, y
   al cerrarlo sí, y se borra lo preparado.
3. Una versión que quedó preparada de otra sesión se instala al cerrar la siguiente, y las
   preparadas que ya no sirven (más viejas) se borran.
"""
import argparse
import hashlib
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import tempfile
import threading

from browser_smoke import ROOT, WebDriver, prepare_profile, eventually

RELEASE = '0.9.0'
NAME = f'Kitsune-{RELEASE}-Linux-x86_64.tar.xz'


def fake_package(root, marker):
    """Un paquete con la forma del de verdad: kitsune/kitsune y un instalar.sh que deja una marca."""
    package = root / 'paquete/kitsune'
    package.mkdir(parents=True)
    (package / 'kitsune').write_text('#!/bin/sh\nexit 0\n')
    (package / 'instalar.sh').write_text(f'#!/bin/sh\nprintf "%s\\n" "$0" > "{marker}"\necho Kitsune instalado\n')
    for name in ('kitsune', 'instalar.sh'):
        (package / name).chmod(0o755)
    folder = root / f'web/v{RELEASE}'
    folder.mkdir(parents=True)
    subprocess.run(['tar', '-cJf', str(folder / NAME), '-C', str(package.parent), 'kitsune'], check=True)
    return folder


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-updater-'))
    evidence = root / 'evidence'
    evidence.mkdir()
    marker = root / 'instalado'
    folder = fake_package(root, marker)
    good = hashlib.sha256((folder / NAME).read_bytes()).hexdigest()
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(root / 'web')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    (root / 'web/downloads.json').write_text(json.dumps({'version': '0.9', 'linux': {'url': f'{origin}/v{RELEASE}/{NAME}', 'release': RELEASE}}))
    installed_now = root / 'kitsune-actual'
    installed_now.mkdir()
    (installed_now / 'instalar.sh').write_text('#!/bin/sh\n')
    cache = root / 'cache'
    staged = cache / 'kitsune/actualizacion' / RELEASE
    # La caché de la actualización va donde diga XDG_CACHE_HOME; geckodriver no pasa «env», se hereda.
    os.environ['XDG_CACHE_HOME'] = str(cache)

    def session(name):
        (root / name).mkdir()
        profile, _ = prepare_profile(root / name)
        with (profile / 'user.js').open('a') as prefs:
            prefs.write('user_pref("kitsune.release", "0.8.0");\n')
            prefs.write(f'user_pref("kitsune.update.testUrl", "{origin}/downloads.json");\n')
            prefs.write(f'user_pref("kitsune.update.testInstallDir", "{installed_now}");\n')
        return WebDriver(profile, evidence, browser=args.browser, headed=True)

    def chrome(driver, script, *values, asynchronous=False):
        driver.context('chrome')
        return driver.script(script, list(values), asynchronous)

    def notice(driver):
        return eventually(lambda: chrome(driver, "const bar = gNotificationBox.getNotificationWithValue('kitsune-update');"
                                                 " return bar ? (bar.messageText?.textContent || bar.getAttribute('message') || bar.label || '') : '';"), timeout=15)

    load = """const [folder, done] = arguments;
      const resources = Services.io.getProtocolHandler('resource').QueryInterface(Ci.nsIResProtocolHandler);
      const directory = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile); directory.initWithPath(folder);
      resources.setSubstitution('kitsune-native-test', Services.io.newFileURI(directory));
      const { KitsuneUpdates } = ChromeUtils.importESModule('resource://kitsune-native-test/kitsune-updates.sys.mjs');
      KitsuneUpdates.check().then(found => done(found), error => done({ error: String(error) }));"""

    def check(name):
        print('PASS ' + name, flush=True)

    driver = None
    try:
        # 1. SHA-256 que no coincide: nada preparado, el aviso de siempre.
        (folder / 'SHA256SUMS.txt').write_text(f'{"0" * 64}  {NAME}\n')
        driver = session('mala')
        found = chrome(driver, load, str(ROOT / 'install/native'), asynchronous=True)
        assert found == {'release': RELEASE}, found
        assert 'Hay una versión nueva de Kitsune: 0.9' in notice(driver)
        assert not staged.exists() and not marker.exists()
        driver.close(); driver = None
        assert not marker.exists()
        check('Un paquete que no da su SHA-256 no se prepara: queda el aviso con «Descargar»')

        # 2. SHA-256 bueno: preparado, se instala al cerrar.
        (folder / 'SHA256SUMS.txt').write_text(f'{"1" * 64}  Kitsune-{RELEASE}-Windows-x64.exe\n{good}  {NAME}\n')
        driver = session('buena')
        found = chrome(driver, load, str(ROOT / 'install/native'), asynchronous=True)
        assert found == {'release': RELEASE, 'ready': True}, found
        assert 'Kitsune 0.9 está listo: se instala al cerrar Kitsune.' in notice(driver)
        assert (staged / 'listo.json').is_file() and (staged / 'kitsune/instalar.sh').is_file() and not (staged / NAME).exists()
        assert not marker.exists(), 'instalar.sh no se ejecuta hasta cerrar'
        driver.screenshot('listo.png', chrome=True)
        driver.close(); driver = None
        eventually(marker.exists, timeout=30)
        assert marker.read_text().strip() == str(staged / 'kitsune/instalar.sh')
        assert not staged.exists()
        check('Con su SHA-256, se prepara y se instala al cerrar Kitsune (y se borra lo preparado)')

        # 3. Preparada en otra sesión (y una vieja que sobra): se instala al cerrar la siguiente.
        marker.unlink()
        for release in (RELEASE, '0.7.0'):
            ready = cache / 'kitsune/actualizacion' / release
            (ready / 'kitsune').mkdir(parents=True)
            (ready / 'kitsune/instalar.sh').write_text(f'#!/bin/sh\nprintf "%s\\n" "{release}" > "{marker}"\n')
            (ready / 'listo.json').write_text(json.dumps({'release': release}))
        (root / 'web/downloads.json').write_text('{}')
        driver = session('retomada')
        # Lo hace el arranque de Kitsune (KitsuneUpdates.start); aquí, con la copia del repositorio.
        resumed = chrome(driver, load.replace('KitsuneUpdates.check()', 'KitsuneUpdates.resume()'), str(ROOT / 'install/native'), asynchronous=True)
        assert resumed == RELEASE, resumed
        assert 'Kitsune 0.9 está listo' in notice(driver)
        eventually(lambda: not (cache / 'kitsune/actualizacion/0.7.0').exists(), timeout=10)
        driver.close(); driver = None
        eventually(marker.exists, timeout=30)
        assert marker.read_text().strip() == RELEASE
        check('Una versión preparada en otra sesión se instala al cerrar la siguiente; la vieja se borra')
    finally:
        if driver:
            driver.close()
        server.shutdown()
        print(evidence, flush=True)


if __name__ == '__main__':
    main()
