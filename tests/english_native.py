"""Kitsune en inglés en el motor real (perfil temporal con intl.locale.requested = en-US).

Lo nuevo de Kitsune (paleta, espacios, modo compacto, vista rápida, traer de otro navegador)
sale en inglés cuando la interfaz está en inglés; en castellano, como siempre (las demás pruebas).
"""
import argparse
import json
from pathlib import Path
import tempfile

from browser_smoke import WebDriver, prepare_profile, eventually


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-english-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    with (profile / 'user.js').open('a') as prefs:
        prefs.write('user_pref("intl.locale.requested", "en-US");\n')
    report = {'root': str(root), 'checks': []}
    driver = None

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
        eventually(lambda: chrome("return document.getElementById('kitsune-glance')?.state") == 'open', timeout=10)
        buttons = chrome("return [...document.querySelectorAll('#kitsune-glance .kitsune-glance-head button')].map(b => b.textContent)")
        assert buttons[:2] == ['Split', 'Open in tab'], buttons
        chrome("document.getElementById('kitsune-glance').hidePopup()")
        chrome("ChromeUtils.importESModule('chrome://browser/content/kitsune-import.sys.mjs').KitsuneImport.open(window)")
        eventually(lambda: chrome("return document.getElementById('kitsune-import-panel')?.state") == 'open', timeout=5)
        heading = chrome("return document.querySelector('#kitsune-import-panel h2').textContent")
        assert heading == 'Bring from another browser', heading
        chrome("document.getElementById('kitsune-import-panel').hidePopup()")
        check('Vista rápida y «Bring from another browser» en inglés')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
