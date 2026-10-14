"""Kitsune Zero en el motor real: encender y apagar por ventana (perfil temporal, sin ventana en pantalla).

1. Ctrl+Alt+0 pone Zero en la ventana (atributo «zero» y su hoja de estilo) y lo quita.
2. Otra ventana abierta no cambia.
3. Con kitsune.zero.always, una ventana nueva nace en Zero.
4. La ventana recuerda Zero para la próxima sesión (SessionStore) y lo olvida al apagarlo.
5. Al apagarlo no queda nada de Zero: ni nodos «zero-…», ni atributos «zero…» en ningún nodo, ni
   variables «--zero-…» en la raíz.
6. Tampoco si se apaga en pleno uso: con la web ampliada, escribiendo en la isla, con un aviso y con
   los ajustes abiertos.

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
  leftovers: [...w.document.querySelectorAll('[id^="zero-"], .zero-glass')].map(n => n.id || n.className),
  attrs: [...w.document.querySelectorAll('*')].flatMap(n => [...n.attributes].map(a => a.name).filter(name => name.startsWith('zero')).map(name => `${n.id || n.localName}[${name}]`)),
  vars: [...w.document.documentElement.style].filter(name => name.startsWith('--zero')),
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
        assert s['leftovers'] == [] and s['attrs'] == [] and s['vars'] == [] and s['remembered'] == '', s
        check('Al apagarlo no queda nada de Zero, y la ventana ya no lo recuerda')

        # En pleno uso: web ampliada, escribiendo en la isla, un aviso y los ajustes abiertos.
        press_zero()
        eventually(lambda: state()['zero'] and chrome("return !!document.getElementById('zero-mark')"), timeout=5)
        # Hay otra ventana abierta: Gecko no da el foco (ni su evento) a una ventana de fondo.
        chrome("window.focus()")
        eventually(lambda: chrome("return Services.focus.activeWindow === window"), timeout=5)
        chrome("""document.querySelector('#zero-grow button[data-action=full]').click();
                  document.getElementById('zero-mark').click();
                  ChromeUtils.importESModule('chrome://browser/content/zero/zero-island.sys.mjs').alert(window, 'Aviso', 'de prueba', 5000);
                  gURLBar.focus(); gURLBar.search('kioto');""")
        eventually(lambda: chrome("""const t = document.getElementById('navigator-toolbox');
            return document.documentElement.hasAttribute('zero-full') && t.getAttribute('zero-island') === 'typing'
              && t.hasAttribute('zero-island-alert') && document.getElementById('zero-settings').hasAttribute('open')"""), timeout=5)
        press_zero()
        eventually(lambda: not state()['zero'] and state()['sheet'] == '', timeout=5)
        s = state()
        assert s['leftovers'] == [] and s['attrs'] == [] and s['vars'] == [], s
        check('Tampoco queda nada si se apaga en pleno uso')

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
