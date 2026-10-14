"""Atajos de teclado a tu gusto, en el motor real (pulsaciones de verdad con WebDriver, en chrome).

1. El panel lista los atajos de Kitsune y de Gecko con su combinación.
2. Cambiar el del modo compacto a Ctrl+Alt+J: Ctrl+Alt+J lo pone y Ctrl+Alt+C ya no.
3. Una combinación que ya es de otra cosa (Ctrl+Mayús+Y, descargas) no se pisa; la nueva
   pestaña con Ctrl+Alt+N funciona y Ctrl+T deja de abrirla.
4. Retroceso deja sin atajo (la paleta con Ctrl+K), una ventana nueva sale con los atajos
   cambiados, y «Restaurar todos» lo devuelve todo a como venía.
"""
import argparse
from pathlib import Path
import tempfile
import time

from browser_smoke import WebDriver, prepare_profile, eventually

KEYS = "ChromeUtils.importESModule('chrome://browser/content/kitsune-keys.sys.mjs').KitsuneKeys"
LAYOUT = "ChromeUtils.importESModule('chrome://browser/content/kitsune-layout.sys.mjs').KitsuneLayout"
CTRL, ALT, SHIFT = '', '', ''
# Graba una combinación en el panel: pulsa el botón del atajo y «pulsa» las teclas sobre él.
RECORD = """const [id, init] = arguments;
  const panel = document.getElementById('kitsune-keys-panel');
  panel.querySelector(`.kitsune-keys-combo[data-id="${id}"]`).click();
  panel.querySelector(`.kitsune-keys-combo[data-id="${id}"]`).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  return { status: panel.querySelector('.kitsune-keys-status').textContent, combo: panel.querySelector(`.kitsune-keys-combo[data-id="${id}"]`).textContent };"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-keys-'))
    evidence = root / 'evidence'
    evidence.mkdir()
    profile, _ = prepare_profile(root)
    driver = None

    def chrome(script, *values):
        driver.context('chrome')
        return driver.script(script, list(values))

    def press(key, *modifiers):
        # En contexto chrome: pulsaciones de verdad que pasan por las teclas de la ventana
        # (las de contexto web se quedan en el proceso de la página).
        driver.context('chrome')
        driver.shortcut(key, modifiers)

    def check(name):
        print('PASS ' + name, flush=True)

    def open_panel():
        chrome(f"{KEYS}.open(window)")
        eventually(lambda: chrome("return document.getElementById('kitsune-keys-panel')?.state") == 'open', timeout=5)

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        eventually(lambda: chrome("return !!document.getElementById('kitsune-compact-key') && !!document.getElementById('kitsune-palette-key')"), timeout=20)
        open_panel()
        rows = chrome("""return [...document.querySelectorAll('#kitsune-keys-panel .kitsune-keys-row')].map(row =>
          [row.dataset.id, row.querySelector('.kitsune-keys-label').textContent, row.querySelector('.kitsune-keys-combo').textContent])""")
        found = {row[0]: row for row in rows}
        assert len(rows) >= 20 and found['kitsune-palette-key'][2] == 'Ctrl+K' and found['kitsune-compact-key'][2] == 'Ctrl+Alt+C', rows
        assert found['key_newNavigatorTab'][1] == 'Nueva pestaña' and found['key_newNavigatorTab'][2] == 'Ctrl+T', rows
        check(f'El panel lista {len(rows)} atajos de Kitsune y de Gecko con su combinación')

        before = chrome(f"return {LAYOUT}.compactEnabled()")
        result = chrome(RECORD, 'kitsune-compact-key', {'key': 'j', 'code': 'KeyJ', 'ctrlKey': True, 'altKey': True})
        assert result['combo'] == 'Ctrl+Alt+J' and not result['status'], result
        chrome("document.getElementById('kitsune-keys-panel').hidePopup()")
        time.sleep(0.3)
        press('c', CTRL, ALT)
        time.sleep(0.8)
        assert chrome(f"return {LAYOUT}.compactEnabled()") == before, 'Ctrl+Alt+C ya no es el modo compacto'
        press('j', CTRL, ALT)
        eventually(lambda: chrome(f"return {LAYOUT}.compactEnabled()") != before, timeout=5)
        press('j', CTRL, ALT)
        eventually(lambda: chrome(f"return {LAYOUT}.compactEnabled()") == before, timeout=5)
        check('El modo compacto pasa a Ctrl+Alt+J: con él se pone y se quita, y Ctrl+Alt+C ya no hace nada')

        open_panel()
        taken = chrome(RECORD, 'key_newNavigatorTab', {'key': 'Y', 'code': 'KeyY', 'ctrlKey': True, 'shiftKey': True})
        assert 'Descargas' in taken['status'] and taken['combo'] == 'Pulsa la combinación…', taken
        chrome("""const panel = document.getElementById('kitsune-keys-panel');
          panel.querySelector('.kitsune-keys-combo[data-id="key_newNavigatorTab"]').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', code: 'Escape' }));""")
        assert chrome("return document.querySelector('#kitsune-keys-panel .kitsune-keys-combo[data-id=\"key_newNavigatorTab\"]').textContent") == 'Ctrl+T'
        result = chrome(RECORD, 'key_newNavigatorTab', {'key': 'n', 'code': 'KeyN', 'ctrlKey': True, 'altKey': True})
        assert result['combo'] == 'Ctrl+Alt+N', result
        chrome("document.getElementById('kitsune-keys-panel').hidePopup()")
        time.sleep(0.3)
        tabs = chrome("return gBrowser.tabs.length")
        press('t', CTRL)
        time.sleep(0.8)
        assert chrome("return gBrowser.tabs.length") == tabs, 'Ctrl+T ya no abre pestaña'
        press('n', CTRL, ALT)
        eventually(lambda: chrome("return gBrowser.tabs.length") == tabs + 1, timeout=5)
        chrome("gBrowser.removeTab(gBrowser.selectedTab)")
        check('Una combinación de otra cosa no se pisa (lo dice); Ctrl+Alt+N abre pestaña y Ctrl+T deja de hacerlo')

        open_panel()
        result = chrome(RECORD, 'kitsune-palette-key', {'key': 'Backspace', 'code': 'Backspace'})
        assert result['combo'] == 'Sin atajo', result
        chrome("document.getElementById('kitsune-keys-panel').hidePopup()")
        time.sleep(0.3)
        press('k', CTRL)
        time.sleep(0.8)
        assert chrome("return document.getElementById('kitsune-palette')?.state ?? 'closed'") != 'open', 'Ctrl+K ya no abre la paleta'
        # Una ventana nueva sale con los atajos cambiados.
        handles = driver.command('GET', '/window/handles')
        chrome("OpenBrowserWindow()")
        new = eventually(lambda: [handle for handle in driver.command('GET', '/window/handles') if handle not in handles], timeout=15)
        driver.command('POST', '/window', {'handle': new[0]})
        other = eventually(lambda: (value := chrome("""const key = id => { const node = document.getElementById(id); return node && [node.getAttribute('key'), node.getAttribute('modifiers'), node.getAttribute('disabled')]; };
          return { compact: key('kitsune-compact-key'), tab: key('key_newNavigatorTab'), palette: key('kitsune-palette-key') }"""))['compact'] and value['compact'][0] == 'J' and value, timeout=15)
        assert other['tab'][:2] == ['N', 'accel,alt'] and other['palette'][2] == 'true', other
        chrome("window.close()")
        driver.command('POST', '/window', {'handle': handles[0]})
        check('Retroceso deja la paleta sin atajo, y una ventana nueva sale con los atajos cambiados')

        open_panel()
        chrome("document.querySelector('#kitsune-keys-panel .kitsune-keys-reset-all').click()")
        rows = chrome("return Object.fromEntries([...document.querySelectorAll('#kitsune-keys-panel .kitsune-keys-row')].map(row => [row.dataset.id, row.querySelector('.kitsune-keys-combo').textContent]))")
        assert rows['kitsune-palette-key'] == 'Ctrl+K' and rows['kitsune-compact-key'] == 'Ctrl+Alt+C' and rows['key_newNavigatorTab'] == 'Ctrl+T', rows
        assert not chrome("return Services.prefs.prefHasUserValue('kitsune.keys.custom')")
        chrome("document.getElementById('kitsune-keys-panel').hidePopup()")
        time.sleep(0.3)
        tabs = chrome("return gBrowser.tabs.length")
        press('t', CTRL)
        eventually(lambda: chrome("return gBrowser.tabs.length") == tabs + 1, timeout=5)
        check('«Restaurar todos» lo devuelve todo a como venía (Ctrl+T vuelve a abrir pestaña)')
    finally:
        if driver:
            driver.close()
        print(evidence, flush=True)


if __name__ == '__main__':
    main()
