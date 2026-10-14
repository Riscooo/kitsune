"""Modo ahorro a la vista en el motor real (perfil temporal, sin ventana en pantalla).

1. Con el modo ahorro puesto, la RAM de Kitsune sale en la barra y se actualiza; sin él, no.
2. «Dormir las que no uso» duerme las pestañas de fondo, pero no la que estás viendo ni las
   webs marcadas como «No dormir nunca».
3. Las pestañas dormidas se ven apagadas.
4. El panel dice cuánta RAM usa Kitsune y cuántas pestañas están despiertas y dormidas.
"""
import argparse
import hashlib
import http.server
import json
from pathlib import Path
import tempfile
import threading
import time

from browser_smoke import WebDriver, prepare_profile, eventually
from contrast_native import theme_control


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(f'<!doctype html><meta charset=utf-8><title>{self.path.strip("/") or "inicio"}</title><p>{self.path}'.encode())

    def log_message(self, *args):
        pass


def control(performance):
    value = theme_control('claro')
    value.pop('fingerprint')
    value['performance'] = performance
    value['fingerprint'] = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-saver-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    appearance = profile / 'chrome/kitsune-appearance.json'
    appearance.write_text(json.dumps(control('ahorro')))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_port
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    BUTTON = """const b = document.getElementById('kitsune-ram-button');
      return {on: document.documentElement.hasAttribute('kitsune-saver'), visible: !!b && b.getBoundingClientRect().width > 0, label: b?.getAttribute('label') ?? ''}"""
    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        eventually(lambda: chrome(BUTTON)['on'] and chrome(BUTTON)['visible'], timeout=20)
        eventually(lambda: chrome(BUTTON)['label'].endswith(('MB', 'GB')), timeout=15)
        label = chrome(BUTTON)['label']
        check(f'Con el modo ahorro, la RAM de Kitsune sale en la barra ({label})')

        chrome("""const P = Services.scriptSecurityManager.getSystemPrincipal();
          for (const u of arguments[0]) gBrowser.addTab(u, {triggeringPrincipal: P});""",
               [[f'http://127.0.0.1:{port}/fondo-uno', f'http://127.0.0.1:{port}/fondo-dos', f'http://localhost:{port}/musica']])
        eventually(lambda: chrome("return [...gBrowser.tabs].filter(t => /fondo|musica/.test(t.label)).length") == 3, timeout=15)
        # Cargadas del todo: mientras carga, la dirección de una pestaña aún es about:blank.
        eventually(lambda: chrome("return [...gBrowser.tabs].filter(t => /\\/(fondo-uno|fondo-dos|musica)$/.test(t.linkedBrowser.currentURI.spec)).length") == 3, timeout=15)
        chrome("Services.prefs.setStringPref('kitsune.saver.keepAwake', 'localhost')")
        slept = chrome("return ChromeUtils.importESModule('chrome://browser/content/kitsune-saver.sys.mjs').KitsuneSaver.sleepAll(window)")
        state = chrome("""return Object.fromEntries([...gBrowser.tabs].map(t => [t.label, {asleep: t.hasAttribute('pending'),
          opacity: getComputedStyle(t.querySelector('.tab-content')).opacity}]))""")
        assert slept == 2 and state['fondo-uno']['asleep'] and state['fondo-dos']['asleep'], (slept, state)
        assert not state['musica']['asleep'], state
        assert state['fondo-uno']['opacity'] == '0.55' and state['musica']['opacity'] == '1', state
        driver.screenshot('dormidas.png', chrome=True)
        check('«Dormir las que no uso» duerme las de fondo, respeta «No dormir nunca» y las dormidas se ven apagadas')

        chrome("document.getElementById('kitsune-ram-button').doCommand()")
        eventually(lambda: chrome("return document.getElementById('kitsune-saver-panel')?.state") == 'open', timeout=5)
        text = eventually(lambda: (t := chrome("return document.querySelector('#kitsune-saver-panel .kitsune-saver-total').textContent + ' | ' + document.querySelector('#kitsune-saver-panel .kitsune-saver-tabs').textContent")) and 'Kitsune usa' in t and t, timeout=5)
        assert 'dormidas' in text, text
        chrome("document.getElementById('kitsune-saver-panel').hidePopup()")
        check(f'El panel lo cuenta: {text}')

        appearance.write_text(json.dumps(control('normal')))
        eventually(lambda: not chrome(BUTTON)['on'] and not chrome(BUTTON)['visible'], timeout=15)
        check('Sin el modo ahorro, el medidor desaparece')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
