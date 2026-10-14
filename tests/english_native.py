"""Kitsune en inglés en el motor real (perfil temporal con intl.locale.requested = en-US).

Lo nuevo de Kitsune (paleta, espacios, modo compacto, vista rápida, traer de otro navegador)
sale en inglés cuando la interfaz está en inglés; en castellano, como siempre (las demás pruebas).
"""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import threading

from browser_smoke import ROOT, WebDriver, prepare_profile, eventually

spec = importlib.util.spec_from_file_location('appearance', ROOT / 'install/appearance.py')
appearance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appearance)
home_spec = importlib.util.spec_from_file_location('native_test_home', ROOT / 'install/home-server.py')
home = importlib.util.module_from_spec(home_spec)
home_spec.loader.exec_module(home)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-english-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    with (profile / 'user.js').open('a') as prefs:
        prefs.write('user_pref("intl.locale.requested", "en-US");\n')
    state = root / 'state'; state.mkdir()
    (root / 'native').mkdir(); (root / 'native/kitsune-appearance.sys.mjs').write_text('// disponible')
    profiles = home.profiles_module.ProfileManager(root, state)
    profiles.snapshot()
    manager = appearance.AppearanceManager(root, state)
    server = home.create_server(profile / 'start', state / 'home.json', port=0, profiles=profiles, appearance=manager)
    worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    report = {'root': str(root), 'checks': []}
    driver = None

    def content(script):
        driver.context('content'); return driver.script(script)

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        assert chrome("return Services.locale.appLocaleAsBCP47").startswith('en'), 'la interfaz no está en inglés'
        eventually(lambda: chrome("return !!document.getElementById('kitsune-palette-key')"), timeout=15)
        chrome("document.getElementById('kitsune-palette-key').doCommand()")
        eventually(lambda: chrome("return document.getElementById('kitsune-palette')?.state") == 'open', timeout=5)
        chrome("const i = document.querySelector('#kitsune-palette input'); i.value = 'new tab'; i.dispatchEvent(new Event('input'));")
        labels = eventually(lambda: (l := chrome("return [...document.querySelectorAll('#kitsune-palette .kitsune-palette-item')].map(li => li.querySelector('.kitsune-palette-kind').textContent + ': ' + li.querySelector('.kitsune-palette-label').textContent)")) and any('Action: New tab' == x for x in l) and l, timeout=5)
        assert chrome("return document.querySelector('#kitsune-palette input').placeholder").startswith('Tabs, spaces')
        chrome("document.getElementById('kitsune-palette').hidePopup()")
        check(f'La paleta en inglés: {", ".join(labels[:3])}')

        add = chrome("return document.querySelector('#kitsune-spaces-top .kitsune-space-add').title")
        assert add == 'New space', add
        chrome("document.querySelector('#kitsune-spaces-top .kitsune-space-add').click()")
        eventually(lambda: chrome("return document.getElementById('kitsune-space-panel').state") == 'open', timeout=5)
        title = chrome("return document.querySelector('#kitsune-space-panel .kitsune-space-panel-title').textContent + ' / ' + document.querySelector('#kitsune-space-panel .kitsune-space-panel-save').textContent")
        assert title == 'New space / Create', title
        chrome("document.getElementById('kitsune-space-panel').hidePopup()")
        compact = chrome("return document.getElementById('kitsune-compact-menuitem').getAttribute('label')")
        assert compact == 'Compact mode', compact
        check(f'Espacios y modo compacto en inglés («{title}», «{compact}»)')

        chrome("ChromeUtils.importESModule('chrome://browser/content/kitsune-glance.sys.mjs').KitsuneGlance.open(window, 'https://example.com/', {})")
        # Es una pestaña flotante con su barra en el panel (ver glance_native.py).
        eventually(lambda: chrome("return document.querySelectorAll('[kitsune-glance-panel] .kitsune-glance-head button').length") == 3, timeout=10)
        buttons = chrome("return [...document.querySelectorAll('[kitsune-glance-panel] .kitsune-glance-head button')].map(b => b.textContent)")
        assert buttons[:2] == ['Split', 'Open in tab'], buttons
        chrome("document.querySelector('[kitsune-glance-panel] .kitsune-glance-close').click()")
        eventually(lambda: not chrome("return gBrowser.tabs.some(t => t.hasAttribute('kitsune-glance'))"), timeout=5)
        chrome("ChromeUtils.importESModule('chrome://browser/content/kitsune-import.sys.mjs').KitsuneImport.open(window)")
        eventually(lambda: chrome("return document.getElementById('kitsune-import-panel')?.state") == 'open', timeout=5)
        heading = chrome("return document.querySelector('#kitsune-import-panel h2').textContent")
        assert heading == 'Bring from another browser', heading
        chrome("document.getElementById('kitsune-import-panel').hidePopup()")
        check('Vista rápida y «Bring from another browser» en inglés')

        # «Tu inicio» y su ayuda: el idioma lo dice Kitsune (/api/idioma), no la página.
        eventually(lambda: manager.language()['locale'].startswith('en'), timeout=15)
        driver.navigate(origin + '/')
        eventually(lambda: content("return document.documentElement.lang") == 'en', timeout=15)
        eventually(lambda: content("return document.getElementById('welcome-line').textContent").startswith('Welcome'), timeout=15)
        placeholder = content("return document.getElementById('query').placeholder")
        assert placeholder == 'Search Google or type a URL', placeholder
        driver.click('#settings-open')
        heading = eventually(lambda: (h := content("return document.getElementById('settings-title').textContent")) == 'Your home' and h, timeout=10)
        tabs = content("return [...document.querySelectorAll('[data-tabs]')].map(b => b.textContent).join(' / ')")
        assert tabs == 'Top / Side / Icons', tabs
        spanish = content("""const out = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) { const e = n.parentElement; if (!e || e.closest('[hidden], script, style, dialog:not([open])')) continue;
            if (/[áéíóúñ¿]/i.test(n.nodeValue) && e.getClientRects().length) out.push(n.nodeValue.trim()) } return out""")
        assert not spanish, spanish
        driver.navigate(origin + '/ayuda/')
        eventually(lambda: content("return document.querySelector('main[lang=en]') && !document.querySelector('main[lang=en]').hidden"), timeout=10)
        assert content("return document.querySelector('main[lang=en] h1').textContent") == 'Kitsune help'
        check(f'«Tu inicio» y su ayuda en inglés, sin nada en castellano a la vista («{heading}», «{tabs}»)')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown(); server.server_close(); worker.join(timeout=3)
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
