"""Kitsune Zero en el motor real: encender y apagar por ventana (perfil temporal, sin ventana en pantalla).

1. Ctrl+Alt+0 pone Zero en la ventana (atributo «zero» y su hoja de estilo) y lo quita.
2. Otra ventana abierta no cambia.
3. Con kitsune.zero.always, una ventana nueva nace en Zero.
4. La ventana recuerda Zero para la próxima sesión (SessionStore) y lo olvida al apagarlo.
5. Al apagarlo no queda nada de Zero: ni nodos «zero-…» ni atributos «zero…» en la raíz.

--zero-del-repo: Zero sale de zero/ y de install/native del repositorio (ver zero_harness.py).
"""
import argparse
import json
from pathlib import Path
import tempfile

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness

CTRL, ALT = '', ''

STATE = """
const win = arguments[0] === 'all' ? null : window;
const one = w => ({ zero: w.document.documentElement.hasAttribute('zero'),
  sheet: w.getComputedStyle(w.document.documentElement).getPropertyValue('--zero-on').trim(),
  leftovers: [...w.document.querySelectorAll('[id^="zero-"]')].map(n => n.id),
  attrs: [...w.document.documentElement.attributes].map(a => a.name).filter(n => n.startsWith('zero')),
  remembered: (() => { try { return SessionStore.getCustomWindowValue(w, 'kitsune-zero'); } catch (e) { return 'error: ' + e; } })() });
if (win) return one(win);
return [...Services.wm.getEnumerator('navigator:browser')].map(one);
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true', help='Zero de zero/ del repositorio, no del motor')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def state():
        return chrome(STATE, ['one'])

    def press_zero():
        driver.context('chrome'); driver.shortcut('0', (CTRL, ALT))

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        assert state()['zero'] is False and state()['sheet'] == '', state()

        press_zero()
        eventually(lambda: state()['zero'] and state()['sheet'] == '1', timeout=5)
        check('Ctrl+Alt+0 pone Zero en la ventana, con su hoja de estilo')

        chrome("OpenBrowserWindow()")
        eventually(lambda: len(chrome(STATE, ['all'])) == 2, timeout=15)
        eventually(lambda: chrome("return [...Services.wm.getEnumerator('navigator:browser')].every(w => w.document.getElementById('kitsune-zero-key'))"), timeout=15)
        windows = chrome(STATE, ['all'])
        assert sum(w['zero'] for w in windows) == 1, windows
        check('Otra ventana abierta no cambia')

        assert state()['remembered'] == '1', state()
        press_zero()
        eventually(lambda: not state()['zero'] and state()['sheet'] == '', timeout=5)
        s = state()
        assert s['leftovers'] == [] and s['attrs'] == [] and s['remembered'] == '', s
        check('Al apagarlo no queda nada de Zero, y la ventana ya no lo recuerda')

        chrome("Services.prefs.setBoolPref('kitsune.zero.always', true); OpenBrowserWindow()")
        eventually(lambda: len(chrome(STATE, ['all'])) == 3, timeout=15)
        eventually(lambda: sum(w['zero'] for w in chrome(STATE, ['all'])) == 1, timeout=15)
        newest = chrome("const ws = [...Services.wm.getEnumerator('navigator:browser')]; return ws.at(-1).document.documentElement.hasAttribute('zero')")
        assert newest is True
        check('Con «abrir siempre en Zero», la ventana nueva nace en Zero')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
