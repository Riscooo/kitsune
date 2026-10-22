"""Aviso de versión nueva en el motor real (perfil temporal, lista de descargas local).

1. Con una versión publicada más nueva, sale la barra «Hay una versión nueva de Kitsune»
   y «Descargar» abre la web de descarga.
2. Pocos minutos después no vuelve a preguntar a la web (varias ventanas, un reinicio seguido); pasado ese rato sí, y
   si sigue la misma versión no la vuelve a preparar ni a avisar dos veces.
3. Con kitsune.update.check apagado, no pregunta.
"""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading

from browser_smoke import ROOT, WebDriver, prepare_profile, eventually

# Linux también avisa desde d526290: la prueba corre en Linux, así que mira la entrada «linux».
DOWNLOADS = {"version": "0.7 beta",
             "windows": {"url": "https://github.com/Riscooo/kitsune/releases/download/v0.7.0-beta.9/K.exe", "release": "0.7.0-beta.9"},
             "linux": {"url": "https://github.com/Riscooo/kitsune/releases/download/v0.7.0-beta.9/K.tar.xz", "release": "0.7.0-beta.9"}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            body = json.dumps(DOWNLOADS).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    root = Path(tempfile.mkdtemp(prefix='kitsune-updates-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    with (profile / 'user.js').open('a') as prefs:
        prefs.write('user_pref("kitsune.release", "0.7.0-beta.3");\n')
        prefs.write(f'user_pref("kitsune.update.testUrl", "http://127.0.0.1:{server.server_port}/downloads.json");\n')
        prefs.write('user_pref("kitsune.update.testPlatform", "windows");\n')
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, *values, asynchronous=False):
        driver.context('chrome'); return driver.script(script, values, asynchronous)

    try:
        driver = WebDriver(profile, evidence, browser=args.browser, headed=True)
        load = """const [folder, done] = arguments;
          const resources = Services.io.getProtocolHandler('resource').QueryInterface(Ci.nsIResProtocolHandler);
          const directory = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile); directory.initWithPath(folder);
          resources.setSubstitution('kitsune-native-test', Services.io.newFileURI(directory));
          window.KitsuneUpdatesTest = ChromeUtils.importESModule('resource://kitsune-native-test/kitsune-updates.sys.mjs').KitsuneUpdates;
          window.KitsuneUpdatesTest.check().then(found => done(found), error => done({error: String(error)}));"""
        found = chrome(load, str(ROOT / 'install/native'), asynchronous=True)
        assert found == {'release': '0.7.0-beta.9'}, found
        label = eventually(lambda: chrome("return gNotificationBox.getNotificationWithValue('kitsune-update')?.messageText?.textContent"
                                          " || gNotificationBox.getNotificationWithValue('kitsune-update')?.getAttribute('message')"
                                          " || gNotificationBox.getNotificationWithValue('kitsune-update')?.label || ''"), timeout=10)
        assert 'Hay una versión nueva de Kitsune: 0.7 beta 9' in str(label), label
        driver.screenshot('aviso.png', chrome=True)
        tabs = chrome("return gBrowser.tabs.length")
        chrome("""const bar = gNotificationBox.getNotificationWithValue('kitsune-update');
          const button = bar.buttonContainer?.querySelector('button') ?? bar.querySelector('button.notification-button')
            ?? bar.shadowRoot?.querySelector('button.notification-button') ?? [...(bar.shadowRoot?.querySelectorAll('button') ?? [])].find(b => b.label === 'Descargar' || b.textContent.includes('Descargar'));
          button.click();""")
        eventually(lambda: chrome("return gBrowser.tabs.length") == tabs + 1, timeout=10)
        eventually(lambda: chrome("return gBrowser.selectedBrowser.currentURI.spec").startswith('https://kitsune-navegador.vercel.app/'), timeout=15)
        check('Con una versión más nueva sale la barra de aviso y «Descargar» lleva a la web')
        again = chrome("const done = arguments[0]; window.KitsuneUpdatesTest.check().then(done, e => done(String(e)));", asynchronous=True)
        assert again == {'release': '0.7.0-beta.9'} and len(requests) == 1, (again, requests)
        later = chrome("""const done = arguments[0]; window.KitsuneUpdatesTest.check(Date.now() + 6 * 60 * 1000)
          .then(found => done({ found, bars: gNotificationBox.allNotifications.filter(n => n.getAttribute('value') === 'kitsune-update').length }), e => done(String(e)));""", asynchronous=True)
        # «Descargar» cerró la barra: con la misma versión no vuelve a salir cada cuarto de hora (ni dos a la vez).
        assert later == {'found': {'release': '0.7.0-beta.9'}, 'bars': 0} and len(requests) == 2, (later, requests)
        check('Pocos minutos después no vuelve a preguntar; pasado ese rato sí, sin avisar dos veces de la misma versión')
        chrome("Services.prefs.setStringPref('kitsune.update.lastCheck', '0'); Services.prefs.setBoolPref('kitsune.update.check', false)")
        off = chrome("const done = arguments[0]; window.KitsuneUpdatesTest.check().then(done, e => done(String(e)));", asynchronous=True)
        assert off is None and len(requests) == 2, (off, requests)
        check('Con kitsune.update.check apagado no pregunta')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
