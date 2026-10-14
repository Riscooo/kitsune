"""Vista dividida y modo compacto en el motor real (perfil temporal, sin ventana en pantalla).

1. Ctrl+Alt+D divide la pestaña en la que estás: la otra mitad deja elegir pestaña
   (about:opentabs), en papel y tinta, sin el degradado violeta de Mozilla. Otra vez
   Ctrl+Alt+D la separa.
2. Ctrl+Alt+C pasa a modo compacto: las barras se esconden y la web ocupa su sitio;
   salen al enfocar la barra de direcciones. Otra vez Ctrl+Alt+C las deja como siempre.
3. El modo compacto se recuerda al cerrar y volver a abrir Kitsune.
"""
import argparse
import json
from pathlib import Path
import tempfile
import time

from browser_smoke import WebDriver, prepare_profile, eventually
from contrast_native import theme_control

PAPER = 'rgb(246, 245, 241)'
TOOLBOX = """const t = document.getElementById('navigator-toolbox').getBoundingClientRect();
  const c = gBrowser.selectedBrowser.getBoundingClientRect();
  return {compact: document.documentElement.hasAttribute('kitsune-compact'), bottom: Math.round(t.bottom),
          browserTop: Math.round(c.top), pref: Services.prefs.getBoolPref('kitsune.compact.enabled', false),
          opacity: getComputedStyle(document.getElementById('navigator-toolbox')).opacity};"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-layout-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    (profile / 'chrome/kitsune-appearance.json').write_text(json.dumps(theme_control('claro')))
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        eventually(lambda: chrome("return !!document.getElementById('kitsune-split-key')"), timeout=15)
        chrome("""const t = gBrowser.addTab('data:text/html;charset=utf-8,<title>Izquierda</title><h1>Izquierda</h1>',
                    {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});
                  gBrowser.selectedTab = t;""")
        eventually(lambda: chrome("return gBrowser.selectedTab.label") == 'Izquierda', timeout=10)
        chrome("document.getElementById('kitsune-split-key').doCommand()")
        eventually(lambda: chrome("return !!gBrowser.selectedTab.splitview && gBrowser.selectedBrowser.currentURI.spec") == 'about:opentabs', timeout=10)
        # El fondo de la página para elegir: el papel de Kitsune (el módulo pone --kb-bg en about:opentabs).
        background = lambda: chrome("""const b = gBrowser.selectedBrowser;
          return b.contentDocument ? getComputedStyle(b.contentDocument.documentElement).backgroundColor : null""")
        eventually(lambda: background() in (PAPER, None), timeout=10)
        driver.screenshot('dividida.png', chrome=True)
        bg = background()
        if bg is None:
            # Página en otro proceso: se mira en píxeles, a media altura de la mitad derecha.
            from PIL import Image
            image = Image.open(evidence / 'dividida.png').convert('RGB')
            pixel = image.getpixel((int(image.width * 0.85), int(image.height * 0.8)))
            bg = 'rgb({}, {}, {})'.format(*pixel)
        assert bg == PAPER, bg
        chrome("document.getElementById('kitsune-unsplit-key').doCommand()")
        eventually(lambda: not chrome("return gBrowser.tabs.some(t => t.splitview)"), timeout=10)
        check('Ctrl+Alt+D divide la pestaña (la otra mitad, para elegir pestaña, en papel) y Ctrl+Alt+Mayús+D la separa')

        # Hasta cuatro webs: tres pestañas seleccionadas se juntan en columnas; otra pulsación añade
        # la cuarta (en 2×2) y una quinta ya no hace nada.
        chrome("""const P = Services.scriptSecurityManager.getSystemPrincipal();
          const tabs = ['Uno', 'Dos', 'Tres'].map(t => gBrowser.addTab(`data:text/html,<title>${t}</title><h1>${t}</h1>`, {triggeringPrincipal: P}));
          gBrowser.selectedTab = tabs[0]; gBrowser.addToMultiSelectedTabs(tabs[1]); gBrowser.addToMultiSelectedTabs(tabs[2]);""")
        chrome("document.getElementById('kitsune-split-key').doCommand()")
        LAYOUT = """const box = document.getElementById('tabbrowser-tabpanels');
          const panels = [...box.querySelectorAll('.split-view-panel-active')].map(p => ({col: p.getAttribute('column'), ...p.getBoundingClientRect().toJSON()}))
            .sort((a, b) => a.col - b.col);
          const wrapper = gBrowser.selectedTab.splitview;
          return {count: wrapper?.tabs.length ?? 0, attr: box.getAttribute('kitsune-split'), wrapper: wrapper?.getAttribute('kitsune-split'), panels};"""
        three = eventually(lambda: (v := chrome(LAYOUT))['count'] == 3 and v['attr'] == '3' and v, timeout=10)
        lefts = [round(p['left']) for p in three['panels']]
        assert lefts == sorted(lefts) and len({round(p['top']) for p in three['panels']}) == 1 and three['wrapper'] == '3', three
        driver.screenshot('tres.png', chrome=True)
        chrome("document.getElementById('kitsune-split-key').doCommand()")
        four = eventually(lambda: (v := chrome(LAYOUT))['count'] == 4 and v['attr'] == '4' and v, timeout=10)
        tops = sorted({round(p['top']) for p in four['panels']})
        assert len(tops) == 2 and four['panels'][0]['left'] == four['panels'][2]['left'], four
        driver.screenshot('cuatro.png', chrome=True)
        chrome("document.getElementById('kitsune-split-key').doCommand()")
        time.sleep(0.5)
        assert chrome(LAYOUT)['count'] == 4
        chrome("document.getElementById('kitsune-unsplit-key').doCommand()")
        eventually(lambda: not chrome("return gBrowser.tabs.some(t => t.splitview)") and not chrome("return document.getElementById('tabbrowser-tabpanels').hasAttribute('kitsune-split')"), timeout=10)
        check('Hasta cuatro webs: tres seleccionadas se juntan en columnas, la cuarta va en 2×2 y Ctrl+Alt+Mayús+D lo separa todo')

        normal = chrome(TOOLBOX)
        assert not normal['compact'] and normal['browserTop'] >= normal['bottom'] - 1, normal
        chrome("document.getElementById('kitsune-compact-key').doCommand()")
        eventually(lambda: chrome(TOOLBOX)['compact'], timeout=5)
        time.sleep(0.6)
        compact = chrome(TOOLBOX)
        assert compact['pref'] and compact['bottom'] <= 6 and compact['browserTop'] <= 6 and compact['opacity'] == '0', compact
        driver.screenshot('compacto.png', chrome=True)
        chrome("gURLBar.focus()")
        time.sleep(0.6)
        focused = chrome(TOOLBOX)
        assert focused['bottom'] >= normal['bottom'] - 1 and focused['opacity'] == '1', focused
        chrome("gURLBar.blur(); gBrowser.selectedBrowser.focus()")
        check(f"Ctrl+Alt+C esconde las barras (la web sube {normal['browserTop'] - compact['browserTop']} px) y salen al enfocar la barra de direcciones")

        driver.close(); driver = None
        driver = WebDriver(profile, evidence, browser=args.browser)
        eventually(lambda: chrome(TOOLBOX)['compact'], timeout=15)
        chrome("document.getElementById('kitsune-compact-key').doCommand()")
        eventually(lambda: not chrome(TOOLBOX)['compact'] and not chrome(TOOLBOX)['pref'], timeout=5)
        check('El modo compacto se recuerda al volver a abrir Kitsune, y Ctrl+Alt+C lo quita')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
