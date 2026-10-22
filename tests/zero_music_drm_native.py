"""Kitsune Zero · la DRM en el panel de la música, en el motor real (perfil temporal, sin ventana en pantalla).

Risco, 22-10: «no puedo poner música en la extensión de Spotify». La DRM está apagada hasta que una web la pide
(en Estricto, y en Cómodo en Linux, que es lo que trae Gecko), y apagada, Gecko quita Widevine al arrancar. Su
barra «Activar DRM» solo sale en las pestañas: en el panel de la música, que no es una pestaña, no salía nada
(EncryptedMediaParent: «browser.getTabBrowser() is null») y Spotify no sonaba nunca.

1. Una web del panel que pide Widevine con la DRM apagada saca, en el propio panel, la barra para activarla.
2. Su botón activa la DRM; cuando Widevine está instalado, el panel se recarga solo, la web ya la tiene y la
   barra se va. (Widevine se descarga de verdad, de los servidores de Mozilla y Google: hace falta red.)

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import http.server
import json
import os
from pathlib import Path
import tempfile
import threading

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness

# Como Spotify: pide Widevine al cargar y dice en su título si la tiene.
PLAYER = b"""<!doctype html><meta charset="utf-8"><title>esperando</title><p>Una web que pide Widevine.</p>
<script>
navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'],
  videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }])
  .then(() => { document.title = 'DRM: si'; }, error => { document.title = 'DRM: ' + error.name; });
</script>"""


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = PLAYER if self.path == '/spotify' else b'<!doctype html><meta charset="utf-8"><title>Inicio</title>'
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


STATE = """
const panel = document.getElementById('zero-music'), player = panel?.querySelector('browser');
const bar = panel?.querySelector('.zero-music-drm');
const seen = el => !!el && !el.hidden && el.getBoundingClientRect().width > 0;
return { open: !!panel?.hasAttribute('open'), title: player?.contentTitle ?? null,
         bar: seen(bar), text: bar?.textContent.trim() ?? '', button: seen(bar?.querySelector('button')),
         eme: Services.prefs.getBoolPref('media.eme.enabled'),
         widevine: Services.prefs.getStringPref('media.gmp-widevinecdm.version', '') };
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-musica-drm-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    # Cómodo, con la DRM apagada a mano: como la deja Kitsune en Estricto desde la 0.8 beta 4 (y Gecko en Cómodo en
    # Linux), en cualquier sistema y con cualquier motor (el Estricto de antes pedía la aprobación de GeckoView,
    # que la rompe; drm_native prueba los ajustes de Estricto). geckodriver no pasa «env»: os.environ.
    os.environ['KITSUNE_PRIVACY_MODE'] = 'comodo'
    with (profile / 'user.js').open('a') as prefs:
        prefs.write('user_pref("media.eme.enabled", false);\n')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def state():
        return chrome(STATE)

    def until(condition, timeout=10):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {state()}') from None

    def click(selector):
        driver.context('chrome')
        node = driver.command('POST', '/element', {'using': 'css selector', 'value': selector})
        driver.command('POST', f"/element/{list(node.values())[0]}/click", {})

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        # Marionette apaga las descargas de los complementos de Gecko (Widevine, OpenH264): como en un perfil de verdad.
        chrome("Services.prefs.clearUserPref('media.gmp-manager.updateEnabled')")
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/inicio')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !!document.querySelector('#zero-music-pill .zero-music')"), timeout=10)
        assert not state()['widevine'], 'el perfil de la prueba ya trae Widevine'

        chrome("Services.prefs.setStringPref('kitsune.zero.music.service', arguments[0])", [origin + '/spotify'])
        click('#zero-music-pill .zero-music')
        until(lambda: (s := state())['open'] and s['title'] == 'DRM: NotSupportedError' and s['bar'] and s['button'])
        check('Una web del panel de la música que pide la DRM, con ella apagada, saca allí mismo la barra para activarla')

        click('#zero-music .zero-music-drm button')
        until(lambda: (s := state())['eme'] and s['widevine'] and s['title'] == 'DRM: si' and not s['bar'], timeout=120)
        check('Su botón activa la DRM: Widevine se instala, el panel se recarga solo y la web ya la tiene')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
