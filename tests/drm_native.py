#!/usr/bin/env python3
"""La DRM en Estricto, en el motor real (perfil temporal, sin ventana en pantalla).

Risco, 21-10: en Estricto Spotify no sonaba nunca (LibreWolf apagaba el proveedor de complementos y pedía la
aprobación de GeckoView, que en escritorio rompe la DRM). Ahora, como Firefox en Linux:

1. En un perfil nuevo (Estricto) la DRM está apagada, pero no rota: el proveedor de complementos encendido y sin
   la aprobación de GeckoView.
2. Una web que pide Widevine saca la barra para activarla, y su botón la activa (media.eme.enabled).
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading

from browser_smoke import WebDriver, prepare_profile, eventually

PAGE = b"""<!doctype html><meta charset="utf-8"><title>DRM</title><p>Una web que pide Widevine.</p>
<script>
navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'],
  videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }])
  .then(() => { document.title = 'DRM: si'; }, error => { document.title = 'DRM: ' + error.name; });
</script>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-drm-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        prefs = chrome("""return { mode: Services.prefs.getStringPref('kitsune.privacy.active', ''),
            eme: Services.prefs.getBoolPref('media.eme.enabled'), provider: Services.prefs.getBoolPref('media.gmp-provider.enabled'),
            approval: Services.prefs.getBoolPref('media.eme.require-app-approval'), ui: Services.prefs.getBoolPref('browser.eme.ui.enabled') };""")
        assert prefs == {'mode': 'estricto', 'eme': False, 'provider': True, 'approval': False, 'ui': True}, prefs
        check('En Estricto la DRM está apagada, pero no rota (proveedor de complementos encendido, sin la aprobación de GeckoView)')

        driver.navigate(f'http://127.0.0.1:{server.server_port}/')
        BAR = """const box = gBrowser.getNotificationBox(gBrowser.selectedBrowser), bar = box.getNotificationWithValue('drmContentDisabled');
            if (!bar) return null;
            const buttons = [...(bar.buttonContainer?.querySelectorAll('button') ?? bar.querySelectorAll('button'))].filter(b => !b.closest('.close-icon') && b.label);
            return { buttons: buttons.map(b => b.label) };"""
        bar = eventually(lambda: chrome(BAR), timeout=15)
        assert bar['buttons'], bar
        chrome("""const box = gBrowser.getNotificationBox(gBrowser.selectedBrowser), bar = box.getNotificationWithValue('drmContentDisabled');
            const buttons = [...(bar.buttonContainer?.querySelectorAll('button') ?? bar.querySelectorAll('button'))].filter(b => b.label);
            buttons.at(-1).click();""")
        eventually(lambda: chrome("return Services.prefs.getBoolPref('media.eme.enabled')") is True, timeout=10)
        check(f'Una web que pide Widevine saca la barra para activar la DRM, y «{bar["buttons"][-1]}» la activa')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
