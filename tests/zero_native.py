"""Kitsune Zero en el motor real: encender y apagar por ventana (perfil temporal, sin ventana en pantalla).

1. Ctrl+Alt+0 pone Zero en la ventana (atributo «zero» y su hoja de estilo) y lo quita.
2. Otra ventana ya abierta no cambia.
3. Una ventana nueva nace como la ventana desde la que se abre (Ctrl+N en una en Zero, en Zero; en una
   normal, normal); con «Ventanas nuevas: normales» (kitsune.zero.inherit = false), siempre normal; y
   con kitsune.zero.always, siempre en Zero. Una ventana cerrada que se reabre vuelve como era. La que nace
   en Zero ya se pinta en Zero la primera vez (sin enseñar antes Kitsune normal).
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
import time

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

        # Otra ventana, ya abierta antes de encender Zero en esta.
        chrome("OpenBrowserWindow()")
        eventually(lambda: len(chrome(STATE, ['all'])) == 2, timeout=15)
        eventually(lambda: chrome("return [...Services.wm.getEnumerator('navigator:browser')].every(w => w.document.getElementById('kitsune-zero-key'))"), timeout=15)
        chrome("window.focus()")
        eventually(lambda: chrome("return Services.focus.activeWindow === window"), timeout=5)

        press_zero()
        eventually(lambda: state()['zero'] and state()['sheet'] == '1', timeout=5)
        check('Ctrl+Alt+0 pone Zero en la ventana, con su hoja de estilo')

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

        # Ventanas nuevas: como la ventana desde la que se abren.
        WINDOWS = "return [...Services.wm.getEnumerator('navigator:browser')]"
        def focus(which):
            chrome(f"const w = {which}; w.focus(); window.__foco = w;")
            eventually(lambda: chrome("return Services.focus.activeWindow === window.__foco"), timeout=5)
        # Lo que enseña la ventana nueva en su primer pintado (si ya es Zero, no hay salto de Kitsune normal a Zero).
        chrome("""window.__pintado = null;
            window.__mira = { observe(win) { win.addEventListener('DOMContentLoaded', () => win.addEventListener('MozAfterPaint', () => {
              if (window.__pintado === null) window.__pintado = win.document.documentElement.hasAttribute('zero'); }, { once: true }), { once: true }); } };
            Services.obs.addObserver(window.__mira, 'domwindowopened');""")
        def open_from(which):
            focus(which)
            chrome("window.__pintado = null; window.__nueva = window.__foco.OpenBrowserWindow();")
            eventually(lambda: chrome("const w = window.__nueva; return !!w.document?.getElementById('kitsune-zero-key') && w.gBrowserInit?.delayedStartupFinished"), timeout=15)
            born = chrome("return window.__nueva.document.documentElement.hasAttribute('zero')")
            painted = chrome("return window.__pintado")
            chrome("window.__nueva.close(); delete window.__nueva;")
            eventually(lambda: len(chrome(WINDOWS)) == 2, timeout=10)
            assert painted == born, f'el primer pintado era {"Zero" if painted else "Kitsune normal"} y la ventana nace {"en Zero" if born else "normal"}'
            return born
        press_zero()
        eventually(lambda: state()['zero'], timeout=5)
        assert open_from('window') is True, 'desde una ventana en Zero, la nueva debería nacer en Zero'
        assert open_from("[...Services.wm.getEnumerator('navigator:browser')].find(w => w !== window)") is False, 'desde una normal, normal'
        chrome("Services.prefs.setBoolPref('kitsune.zero.inherit', false)")
        assert open_from('window') is False, 'con «normales», normal aunque se abra desde Zero'
        chrome("Services.prefs.clearUserPref('kitsune.zero.inherit')")
        # Reabrir una ventana cerrada (Ctrl+Shift+N) desde una en Zero: vuelve como era, no hereda.
        other = "[...Services.wm.getEnumerator('navigator:browser')].find(w => w !== window)"
        chrome(f"const o = {other}; o.gBrowser.selectedBrowser.loadURI(Services.io.newURI('data:text/html,<title>Nara</title>Nara'), {{ triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }});")
        eventually(lambda: chrome(f"return {other}.gBrowser.selectedTab.label") == 'Nara', timeout=10)
        chrome(f"{other}.close()")
        eventually(lambda: len(chrome(WINDOWS)) == 1 and chrome("return SessionStore.getClosedWindowCount()") >= 1, timeout=10)
        focus('window')
        chrome("window.__vuelta = SessionStore.undoCloseWindow(0);")
        eventually(lambda: chrome("const w = window.__vuelta; return !!w.document?.getElementById('kitsune-zero-key') && w.gBrowserInit?.delayedStartupFinished && w.gBrowser.selectedTab.label === 'Nara'"), timeout=15)
        time.sleep(1)
        assert chrome("return window.__vuelta.document.documentElement.hasAttribute('zero')") is False, 'la ventana reabierta no estaba en Zero: no debería heredarlo'
        chrome("delete window.__vuelta;")
        focus('window')
        press_zero()
        eventually(lambda: not state()['zero'], timeout=5)
        chrome("Services.obs.removeObserver(window.__mira, 'domwindowopened'); delete window.__mira;")
        check('Una ventana nueva nace como la ventana desde la que se abre (y con «normales», normal), ya en su primer pintado')

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
