"""New tabs open the profile's own Kitsune home, on the real engine (temporary profile).

Ctrl+T and the + button load the local home page; the address bar stays empty and
focused, as with Gecko's own new tab, and the old customize panel never appears.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import threading

from browser_smoke import ROOT, WebDriver, prepare_profile, eventually

home_spec = importlib.util.spec_from_file_location('native_test_home', ROOT / 'install/home-server.py')
home = importlib.util.module_from_spec(home_spec)
home_spec.loader.exec_module(home)
spec = importlib.util.spec_from_file_location('appearance', ROOT / 'install/appearance.py')
appearance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appearance)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-newtab-native-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    state = root / 'state'; state.mkdir()
    profiles = home.profiles_module.ProfileManager(root, state)
    profiles.snapshot()
    server = home.create_server(profile / 'start', state / 'home.json', port=0, profiles=profiles,
                                appearance=appearance.AppearanceManager(root, state))
    worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
    origin = f'http://127.0.0.1:{server.server_port}/'
    with (profile / 'user.js').open('a') as prefs:
        prefs.write(f'user_pref("browser.startup.homepage", {json.dumps(origin)});\n')
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script):
        driver.context('chrome'); return driver.script(script)

    def selected():
        return chrome("""return {url:gBrowser.selectedBrowser.currentURI.spec, bar:gURLBar.value,
          focused:document.activeElement === gURLBar.inputField || gURLBar.focused, tabs:gBrowser.tabs.length,
          title:gBrowser.selectedTab.label};""")

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        eventually(lambda: chrome("return ChromeUtils.importESModule('resource:///modules/AboutNewTab.sys.mjs').AboutNewTab.newTabURL") == origin, timeout=15)
        driver.shortcut('t', ('',))
        state_ = eventually(lambda: (s := selected())['url'] == origin and s['title'] == 'Kitsune · Inicio' and s, timeout=15)
        assert state_['bar'] == '' and state_['focused'], state_
        driver.command('POST', '/window', {'handle': driver.command('GET', '/window/handles')[-1]})
        driver.context('content')
        assert driver.script("return location.href") == origin
        # La página puede estar aún cargando (location ya es el inicio, el DOM todavía no).
        eventually(lambda: driver.script("return document.readyState === 'complete' && !!document.querySelector('#search-form')"), timeout=15)
        assert driver.script("return !document.querySelector('.customize-menu, .personalize-button')")
        driver.screenshot('pestana-nueva.png', chrome=True)
        check('Ctrl+T abre el inicio de Kitsune con la barra de direcciones vacía y enfocada')
        chrome("document.getElementById('tabs-newtab-button').click()")
        eventually(lambda: selected()['tabs'] == 3 and selected()['url'] == origin, timeout=15)
        check('El botón + también abre el inicio de Kitsune (sin el panel de fondos de Firefox)')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown(); server.server_close(); worker.join(timeout=3)
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
