"""Paleta de Kitsune (Ctrl+K) en el motor real (perfil temporal, sin ventana en pantalla).

1. Ctrl+K abre la paleta (y ya no es «buscar en la web» de Gecko).
2. Las acciones enseñan su atajo, el de verdad (el de la tecla de Gecko o de Kitsune).
3. Escribir y pulsar Intro ejecuta la acción: «compacto» pone el modo compacto.
4. Busca pestañas también en otros espacios y, al elegirla, va a ese espacio.
5. «?» enseña todas las acciones con atajo; lo que no encaja se puede buscar en la web.
"""
import argparse
import json
from pathlib import Path
import tempfile
import time

from browser_smoke import WebDriver, prepare_profile, eventually

STATE = """const p = document.getElementById('kitsune-palette');
  return {state: p?.state ?? 'none', items: [...(p?.querySelectorAll('.kitsune-palette-item') ?? [])].map(li => ({
    label: li.querySelector('.kitsune-palette-label').textContent, kind: li.querySelector('.kitsune-palette-kind').textContent,
    shortcut: li.querySelector('.kitsune-palette-shortcut').textContent, selected: li.getAttribute('aria-selected') === 'true'}))};"""
TYPE = """const input = document.querySelector('#kitsune-palette .kitsune-palette-input');
  input.value = arguments[0]; input.dispatchEvent(new Event('input'));"""
ENTER = """document.querySelector('#kitsune-palette .kitsune-palette-input').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-palette-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=(), asynchronous=False):
        driver.context('chrome'); return driver.script(script, list(arguments), asynchronous=asynchronous)

    def open_palette():
        chrome("document.getElementById('kitsune-palette-key').doCommand()")
        eventually(lambda: chrome(STATE)['state'] == 'open', timeout=5)

    def typed(text, wanted):
        chrome(TYPE, [text])
        return eventually(lambda: (state := chrome(STATE)) and wanted(state['items']) and state, timeout=5)

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        eventually(lambda: chrome("return !!document.getElementById('kitsune-palette-key')"), timeout=15)
        assert chrome("return document.getElementById('key_search')?.getAttribute('disabled')") == 'true'
        open_palette()
        check('Ctrl+K abre la paleta (la tecla de buscar en la web de Gecko queda apagada)')

        action = lambda item: item['label'] == 'Nueva pestaña' and item['kind'] == 'Acción'
        items = typed('nueva pestaña', lambda items: any(action(item) for item in items))['items']
        first = next(item for item in items if action(item))
        assert first['shortcut'] in ('Ctrl+T', '⌘T'), first
        items = typed('dividir', lambda items: any(item['label'].startswith('Dividir') for item in items))['items']
        assert next(item for item in items if item['label'].startswith('Dividir'))['shortcut'] in ('Ctrl+Alt+D', '⌃⌥⌘D', '⌥⌘D'), items
        check(f"Las acciones enseñan su atajo de verdad (Nueva pestaña: {first['shortcut']})")

        typed('compacto', lambda items: items and items[0]['label'] == 'Modo compacto')
        chrome(ENTER)
        eventually(lambda: chrome("return document.documentElement.hasAttribute('kitsune-compact')"), timeout=5)
        assert chrome(STATE)['state'] == 'closed'
        chrome("document.getElementById('kitsune-compact-key').doCommand()")
        check('Escribir «compacto» y pulsar Intro pone el modo compacto')

        # Una pestaña en otro espacio: la paleta la encuentra y lleva a ese espacio.
        chrome("""const done = arguments[arguments.length - 1];
          const S = ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs').KitsuneSpaces;
          S.create({name: 'Trabajo', color: 'blue'}).then(id => S.switchTo(window, id)).then(() => {
            gBrowser.selectedTab = gBrowser.addTab('data:text/html;charset=utf-8,<title>Informe trimestral</title>x',
              {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});
            return S.switchTo(window, S.list().spaces[0].id);
          }).then(() => done(true));""", asynchronous=True)
        eventually(lambda: chrome("return [...gBrowser.tabs].some(t => t.label === 'Informe trimestral' && t.hidden)"), timeout=10)
        open_palette()
        typed('informe', lambda items: items and items[0]['label'] == 'Informe trimestral')
        chrome(ENTER)
        eventually(lambda: chrome("return gBrowser.selectedTab.label") == 'Informe trimestral', timeout=5)
        active = chrome("const S = ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs').KitsuneSpaces; return S.list().spaces.find(s => s.id === S.active(window)).name")
        assert active == 'Trabajo', active
        check('Encuentra pestañas de otros espacios y, al elegir una, va a su espacio')

        open_palette()
        help_items = typed('?', lambda items: len(items) > 10)['items']
        assert all(item['shortcut'] for item in help_items), help_items
        web = typed('zorros del ártico', lambda items: any(item['label'].startswith('Buscar «zorros') for item in items))['items']
        address = typed('kitsune.example', lambda items: items and items[0]['label'] == 'Ir a kitsune.example')['items']
        time.sleep(0.3)
        chrome("document.getElementById('kitsune-palette').hidePopup()")
        check(f"«?» enseña las {len(help_items)} acciones con atajo; lo demás se busca en la web o se abre como dirección")
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
