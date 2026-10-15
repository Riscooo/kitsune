"""Kitsune Zero como navegador aparte, en el motor real (perfil temporal, sin ventana en pantalla).

Risco (15-10): Kitsune Zero, un producto aparte (su icono, su instalación, su perfil), y el Kitsune de siempre sin
el modo Zero. Es el mismo motor: su paquete pone kitsune.product = "zero".

1. Con kitsune.product = "zero", la ventana nace en Zero sin pulsar nada, y no hay atajo para salir.
2. Una ventana nueva también nace en Zero.
3. En el menú ≡ no está la fila «Kitsune Zero» (entrar o salir), y en los ajustes de Zero no está «Ventanas nuevas».
4. La primera vez trae una copia del perfil de Kitsune (Risco, 15-10), sin cachés ni bloqueos, que ya no lo vuelve a
   intentar; con Kitsune abierto, espera y lo dice. (Con una carpeta y un registro de mentira: sin tocar el
   profiles.ini de verdad.)

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

        work = Path(tempfile.mkdtemp(prefix='kitsune-zero-traer-', dir=root))
        kitsune = work / 'kitsune'; (kitsune / 'cache2').mkdir(parents=True); (kitsune / 'storage/default').mkdir(parents=True)
        (kitsune / 'places.sqlite').write_bytes(b'historial'); (kitsune / 'logins.json').write_text('{"logins": []}')
        (kitsune / 'prefs.js').write_text('user_pref("kitsune.zero.railIcons", true);\n'); (kitsune / 'cache2/x').write_text('cache')
        (kitsune / 'storage/default/site').write_text('datos')
        BRING = """const done = arguments[arguments.length - 1];
            const file = path => { const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile); f.initWithPath(path); return f; };
            const { KitsuneZeroHost } = ChromeUtils.importESModule('chrome://browser/content/kitsune-zero-host.sys.mjs');
            const profiles = [{ dir: file(arguments[0]), profile: null, places: true, current: false, used: 1 }];
            window.__launched = null;
            KitsuneZeroHost.bringProfile(window, { force: true, firstRun: true, profiles, root: file(arguments[1]),
              register: dir => ({ rootDir: dir }), launch: profile => { window.__launched = profile.rootDir.path; } })
              .then(result => done({ result, launched: window.__launched, state: Services.prefs.getStringPref('kitsune.zero.profileImport', '') }),
                    error => done({ error: String(error) }));"""
        # Con Kitsune abierto (su «lock» apunta a un proceso vivo, este), espera y lo dice.
        (kitsune / 'lock').symlink_to(f'127.0.0.1:+{chrome("return Services.appinfo.processID")}')
        driver.context('chrome')
        waiting = driver.script(BRING, [str(kitsune), str(work / 'raiz')], asynchronous=True)
        assert waiting.get('result') == 'waiting' and waiting['state'] == 'waiting' and not waiting['launched'], waiting
        assert chrome("return !!gNotificationBox.getNotificationWithValue('kitsune-zero-import')"), 'no dice que hay que cerrar Kitsune'
        (kitsune / 'lock').unlink()
        brought = driver.script(BRING, [str(kitsune), str(work / 'raiz')], asynchronous=True)
        copy = Path(brought.get('result') or '')
        assert brought.get('launched') == str(copy) and brought['state'] == 'done' and copy.parent == work / 'raiz', brought
        assert (copy / 'places.sqlite').read_bytes() == b'historial' and (copy / 'storage/default/site').read_text() == 'datos', list(copy.iterdir())
        assert not (copy / 'cache2').exists() and not (copy / 'lock').exists(), list(copy.iterdir())
        prefs_js = (copy / 'prefs.js').read_text()
        assert 'kitsune.zero.railIcons' in prefs_js and 'user_pref("kitsune.zero.profileImport", "done");' in prefs_js, prefs_js
        again = driver.script(BRING, [str(kitsune), str(work / 'raiz')], asynchronous=True)
        assert again.get('result') is None and again['state'] == 'done', again
        check('La primera vez trae una copia del perfil de Kitsune (sin cachés); con Kitsune abierto, espera y lo dice')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
