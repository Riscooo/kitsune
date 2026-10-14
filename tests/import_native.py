"""Traer de otro navegador en el motor real (perfiles temporales, sin ventana en pantalla).

Se prepara un «Zen» de mentira con el propio motor: un perfil con marcadores, historial y
su zen-sessions.jsonlz4 (dos espacios, una Essential y pestañas en cada uno), apuntado
desde un ~/.zen/profiles.ini en un HOME temporal. Después, en otro perfil:

1. Kitsune encuentra ese Zen y lo ofrece en una barra la primera vez.
2. Trae los marcadores (en «De Zen (fecha)», con sus carpetas), el historial y las
   pestañas: los espacios de Zen pasan a espacios de Kitsune y la Essential, a fijada.
3. El panel «Traer de otro navegador» se abre desde el menú y lista ese Zen.
4. El perfil de origen no cambia (se lee una copia).
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time

from browser_smoke import WebDriver, prepare_profile, eventually

ZEN_SESSION = {
    'spaces': [{'uuid': '{trabajo}', 'name': 'Trabajo', 'icon': '💼', 'position': 1},
               {'uuid': '{ocio}', 'name': 'Ocio', 'icon': '', 'position': 2}],
    'tabs': [
        {'entries': [{'url': 'https://correo.example/', 'title': 'Correo'}], 'index': 1, 'zenWorkspace': '{trabajo}', 'zenSyncId': 'a'},
        {'entries': [{'url': 'https://informe.example/', 'title': 'Informe'}], 'index': 1, 'zenWorkspace': '{trabajo}', 'zenSyncId': 'b'},
        {'entries': [{'url': 'https://video.example/', 'title': 'Vídeo'}], 'index': 1, 'zenWorkspace': '{ocio}', 'zenSyncId': 'c'},
        {'entries': [{'url': 'https://musica.example/', 'title': 'Música'}], 'index': 1, 'zenEssential': True, 'pinned': True, 'zenSyncId': 'd'},
    ],
}
SOURCE_SETUP = """
const done = arguments[arguments.length - 1];
(async () => {
  const B = PlacesUtils.bookmarks;
  await B.insertTree({guid: B.toolbarGuid, children: [
    {title: 'Kitsune', url: 'https://kitsune.example/'},
    {title: 'Clase', type: B.TYPE_FOLDER, children: [{title: 'Apuntes', url: 'https://apuntes.example/'}]}]});
  await PlacesUtils.history.insertMany([
    {url: 'https://visitada.example/', title: 'Visitada', visits: [{date: new Date(Date.now() - 86400000)}]},
    {url: 'https://otra.example/', title: 'Otra', visits: [{date: new Date(Date.now() - 3600000), transition: 2}]}]);
  await IOUtils.writeJSON(PathUtils.join(PathUtils.profileDir, 'zen-sessions.jsonlz4'), arguments[0], {compress: true});
  done(true);
})().catch(e => done('ERR ' + e));
"""


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-import-'))
    evidence = root / 'evidence'; evidence.mkdir()
    report = {'root': str(root), 'checks': []}

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    # El «Zen» de origen, en Cómodo: Estricto borraría su historial al cerrarlo.
    os.environ['KITSUNE_PRIVACY_MODE'] = 'comodo'
    source_root = root / 'zen'; source_root.mkdir()
    source, _ = prepare_profile(source_root)
    driver = WebDriver(source, evidence, browser=args.browser)
    try:
        driver.context('chrome')
        assert driver.script(SOURCE_SETUP, [ZEN_SESSION], asynchronous=True) is True
        time.sleep(1)
    finally:
        driver.close()
    home = root / 'home'
    (home / '.zen').mkdir(parents=True)
    (home / '.zen/profiles.ini').write_text(f'[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=Default (release)\nIsRelative=0\nPath={source}\nDefault=1\n')
    before = {name: digest(source / name) for name in ('places.sqlite', 'zen-sessions.jsonlz4')}

    # Kitsune, con ese HOME (geckodriver no pasa env: va en os.environ, ver users_native.py).
    target_root = root / 'kitsune'; target_root.mkdir()
    target, _ = prepare_profile(target_root)
    with (target / 'user.js').open('a') as prefs:
        prefs.write('user_pref("kitsune.import.offered", false);\n')
    os.environ['HOME'] = str(home)
    driver = WebDriver(target, evidence, browser=args.browser)

    def chrome(script, arguments=(), asynchronous=False):
        driver.context('chrome'); return driver.script(script, list(arguments), asynchronous=asynchronous)

    MODULE = "ChromeUtils.importESModule('chrome://browser/content/kitsune-import.sys.mjs').KitsuneImport"
    try:
        eventually(lambda: chrome("return !!gNotificationBox.getNotificationWithValue('kitsune-import')"), timeout=20)
        label = chrome("return gNotificationBox.getNotificationWithValue('kitsune-import').messageText?.textContent ?? ''")
        assert 'Zen' in label and 'espacios' in label, label
        driver.screenshot('barra.png', chrome=True)
        sources = chrome(f"const done = arguments[arguments.length - 1]; {MODULE}.findSources().then(done, e => done('ERR ' + e))", asynchronous=True)
        zen = next(item for item in sources if item['kind'] == 'zen')
        assert Path(zen['path']) == source, sources
        check('Kitsune encuentra el Zen del equipo y lo ofrece en una barra la primera vez')

        result = chrome(f"""const done = arguments[arguments.length - 1];
          {MODULE}.importGecko(window, arguments[0], {{bookmarks: true, history: true, tabs: true}}).then(done, e => done('ERR ' + e + e.stack))""",
                        [zen], asynchronous=True)
        assert isinstance(result, dict), result
        assert result['bookmarks'] == 2 and result['pages'] >= 2 and result['tabs'] == 4 and result['spaces'] == 2, result
        tree = chrome("""const done = arguments[arguments.length - 1];
          PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.menuGuid).then(t => done(JSON.stringify(t)))""", asynchronous=True)
        folder = next(child for child in json.loads(tree)['children'] if child['title'].startswith('De Zen ('))
        toolbar = folder['children'][0]
        assert toolbar['title'] == 'Barra de marcadores', folder
        assert [child['title'] for child in toolbar['children']] == ['Kitsune', 'Clase'], toolbar
        visited = chrome("""const done = arguments[arguments.length - 1];
          PlacesUtils.history.fetch('https://visitada.example/').then(info => done(info?.title ?? null))""", asynchronous=True)
        assert visited == 'Visitada', visited
        check(f"Trae {result['bookmarks']} marcadores con sus carpetas (en «{folder['title']}») y {result['pages']} páginas del historial")

        spaces = chrome("""const S = ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs');
          const list = S.KitsuneSpaces.list().spaces;
          return {names: list.map(s => s.name), icons: list.map(s => s.icon ?? ''),
                  tabs: [...gBrowser.tabs].map(t => [t.label, t.pinned, list.find(s => s.id === S.tabSpace(t))?.name])}""")
        assert spaces['names'] == ['General', 'Trabajo', 'Ocio'] and spaces['icons'] == ['', '💼', ''], spaces
        tabs = {label: (pinned, space) for label, pinned, space in spaces['tabs']}
        assert tabs['Correo'] == (False, 'Trabajo') and tabs['Informe'] == (False, 'Trabajo'), tabs
        assert tabs['Vídeo'] == (False, 'Ocio') and tabs['Música'][0] is True, tabs
        check('Los espacios de Zen pasan a espacios de Kitsune con sus pestañas y su emoji, y la Essential queda fijada')

        chrome(f"{MODULE}.open(window)")
        eventually(lambda: chrome("return document.getElementById('kitsune-import-panel').state") == 'open', timeout=5)
        eventually(lambda: chrome("return document.querySelectorAll('#kitsune-import-panel .kitsune-import-source').length") >= 1, timeout=10)
        assert 'Zen' in chrome("return document.querySelector('#kitsune-import-panel .kitsune-import-source').textContent")
        driver.screenshot('panel.png', chrome=True)
        chrome("document.getElementById('kitsune-import-panel').hidePopup(); PanelUI.show();")
        eventually(lambda: chrome("return !!document.getElementById('appMenu-kitsune-import')"), timeout=10)
        chrome("PanelUI.hide()")
        check('«Traer de otro navegador» está en el menú y su panel lista el Zen del equipo')
    finally:
        driver.close()
    after = {name: digest(source / name) for name in ('places.sqlite', 'zen-sessions.jsonlz4')}
    assert after == before, (before, after)
    check('El perfil de Zen no ha cambiado: se ha leído una copia')
    report['status'] = 'passed'
    (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(str(evidence), flush=True)


if __name__ == '__main__': main()
