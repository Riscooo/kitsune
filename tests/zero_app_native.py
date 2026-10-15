"""Kitsune Zero como navegador aparte, en el motor real (perfil temporal, sin ventana en pantalla).

Risco (15-10): Kitsune Zero, un producto aparte (su icono, su instalación, su perfil), y el Kitsune de siempre sin
el modo Zero. Es el mismo motor: su paquete pone kitsune.product = "zero".

1. Con kitsune.product = "zero", la ventana nace en Zero sin pulsar nada, y no hay atajo para salir.
2. Una ventana nueva también nace en Zero.
3. En el menú ≡ no está la fila «Kitsune Zero» (entrar o salir), y en los ajustes de Zero no está «Ventanas nuevas».

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import json
from pathlib import Path
import tempfile

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-app-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    with (profile / 'user.js').open('a') as prefs:
        prefs.write('user_pref("kitsune.product", "zero");\n')
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    windows = "return [...Services.wm.getEnumerator('navigator:browser')].map(w => ({ zero: w.document.documentElement.hasAttribute('zero'), key: !!w.document.getElementById('kitsune-zero-key') }))"
    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        eventually(lambda: (w := chrome(windows)) and all(x['zero'] for x in w), timeout=15)
        assert not any(x['key'] for x in chrome(windows)), chrome(windows)
        check('La ventana nace en Zero sin pulsar nada, y no hay atajo para salir')

        chrome("OpenBrowserWindow()")
        eventually(lambda: len(w := chrome(windows)) == 2 and all(x['zero'] for x in w), timeout=15)
        chrome("for (const w of Services.wm.getEnumerator('navigator:browser')) if (w !== window) w.close();")
        check('Una ventana nueva también nace en Zero')

        driver.context('chrome')
        driver.script("const done = arguments[arguments.length - 1]; PanelUI.show(); setTimeout(done, 900);", [], asynchronous=True)
        row = chrome("const r = !!document.getElementById('appMenu-kitsune-zero'); PanelUI.hide(); return r;")
        assert not row, 'el menú ≡ tiene la fila de entrar o salir de Zero'
        chrome("document.getElementById('zero-mark').click()")
        eventually(lambda: chrome("return document.getElementById('zero-settings')?.hasAttribute('open')"), timeout=5)
        rows = chrome("return [...document.querySelectorAll('#zero-settings [data-pref]')].map(n => n.dataset.pref)")
        assert 'windows' not in rows and 'variant' in rows, rows
        check('Sin la fila «Kitsune Zero» en el menú ≡ ni «Ventanas nuevas» en los ajustes')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
