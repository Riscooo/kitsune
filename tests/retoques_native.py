"""Retoques en el motor real.

1. El panel (menú → «Retoques…») lista los retoques, todos apagados de serie.
2. «Web flotante», «Dirección centrada» y «Sin botón de extensiones» cambian la ventana al
   momento; al apagarlos, vuelve a como estaba.
3. «Pestañas nuevas junto a la actual» y «Cerrar la última pestaña no cierra la ventana» cambian
   lo que hace Gecko; al apagarlos, sus ajustes vuelven al valor de serie.
"""
import argparse
from pathlib import Path
import tempfile
import time

from browser_smoke import WebDriver, prepare_profile, eventually

RETOQUES = "ChromeUtils.importESModule('chrome://browser/content/kitsune-retoques.sys.mjs').KitsuneRetoques"
LOOK = """const box = getComputedStyle(document.getElementById('tabbrowser-tabbox'));
  return { margin: box.marginBottom, radius: box.borderTopLeftRadius,
    center: getComputedStyle(document.getElementById('urlbar-input')).textAlign,
    extensions: getComputedStyle(document.getElementById('unified-extensions-button')).display };"""
TOGGLE = """const panel = document.getElementById('kitsune-retoques-panel');
  const input = panel.querySelector(`input[data-id="${arguments[0]}"]`);
  input.click(); return input.checked;"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-retoques-'))
    evidence = root / 'evidence'
    evidence.mkdir()
    profile, _ = prepare_profile(root)
    driver = None

    def chrome(script, *values):
        driver.context('chrome')
        return driver.script(script, list(values))

    def check(name):
        print('PASS ' + name, flush=True)

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        eventually(lambda: chrome("return !!document.getElementById('PanelUI-menu-button')"), timeout=20)
        # Desde el menú, como lo haría cualquiera.
        chrome("PanelUI.show()")
        eventually(lambda: chrome("return !!document.getElementById('appMenu-kitsune-retoques')"), timeout=10)
        chrome("document.getElementById('appMenu-kitsune-retoques').doCommand()")
        eventually(lambda: chrome("return document.getElementById('kitsune-retoques-panel')?.state") == 'open', timeout=5)
        rows = chrome("""return [...document.querySelectorAll('#kitsune-retoques-panel .kitsune-retoques-row')].map(row =>
          [row.dataset.id, row.querySelector('b').textContent, row.querySelector('input').checked])""")
        assert len(rows) >= 6 and not any(on for _, _, on in rows), rows
        assert {'flotante', 'centrada', 'junto'} <= {row[0] for row in rows}, rows
        check(f'El panel de Retoques lista {len(rows)}, todos apagados de serie')

        before = chrome(LOOK)
        assert before['margin'] == '0px' and before['center'] != 'center' and before['extensions'] != 'none', before
        for name in ('flotante', 'centrada', 'sinextensiones'):
            assert chrome(TOGGLE, name) is True
        after = eventually(lambda: (value := chrome(LOOK))['margin'] == '8px' and value, timeout=5)
        assert after['radius'] != '0px' and after['center'] == 'center' and after['extensions'] == 'none', after
        chrome("document.getElementById('kitsune-retoques-panel').hidePopup()")
        time.sleep(0.5)
        driver.screenshot('flotante.png', chrome=True)
        chrome(f"for (const id of ['flotante', 'centrada', 'sinextensiones']) {RETOQUES}.set(id, false)")
        assert eventually(lambda: chrome(LOOK) == before and True, timeout=5)
        check('Web flotante, dirección centrada y sin botón de extensiones cambian la ventana al momento, y se quitan igual')

        chrome(f"{RETOQUES}.open(window)")
        eventually(lambda: chrome("return document.getElementById('kitsune-retoques-panel')?.state") == 'open', timeout=5)
        assert chrome(TOGGLE, 'junto') is True and chrome(TOGGLE, 'ultima') is True
        prefs = chrome("return [Services.prefs.getBoolPref('browser.tabs.insertAfterCurrent'), Services.prefs.getBoolPref('browser.tabs.closeWindowWithLastTab')]")
        assert prefs == [True, False], prefs
        # Una pestaña nueva (como Ctrl+T) va junto a la actual, no al final.
        order = chrome("""const P = Services.scriptSecurityManager.getSystemPrincipal();
          for (const n of [1, 2, 3]) gBrowser.addTab('about:blank', { triggeringPrincipal: P });
          gBrowser.selectedTab = gBrowser.tabs[1];
          (window.BrowserCommands?.openTab ?? window.BrowserOpenTab).call(window.BrowserCommands ?? window);
          return gBrowser.tabs.indexOf(gBrowser.selectedTab);""")
        assert order == 2, order
        assert chrome(TOGGLE, 'junto') is False and chrome(TOGGLE, 'ultima') is False
        assert not chrome("return Services.prefs.prefHasUserValue('browser.tabs.insertAfterCurrent') || Services.prefs.prefHasUserValue('browser.tabs.closeWindowWithLastTab')")
        chrome("document.getElementById('kitsune-retoques-panel').hidePopup()")
        check('Pestañas nuevas junto a la actual y no cerrar la ventana con la última cambian lo que hace Gecko, y apagarlos vuelve al valor de serie')
    finally:
        if driver:
            driver.close()
        print(evidence, flush=True)


if __name__ == '__main__':
    main()
