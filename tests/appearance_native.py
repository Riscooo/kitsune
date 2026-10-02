"""Native appearance and synthetic Google-cookie retention, never user sessions."""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import urllib.request

from browser_smoke import ROOT, WebDriver, prepare_profile, eventually

spec = importlib.util.spec_from_file_location('appearance', ROOT / 'install/appearance.py')
appearance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appearance)
home_spec = importlib.util.spec_from_file_location('native_test_home', ROOT / 'install/home-server.py')
home = importlib.util.module_from_spec(home_spec)
home_spec.loader.exec_module(home)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, required=True)
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-appearance-native-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    state = root / 'state'; state.mkdir()
    profiles = home.profiles_module.ProfileManager(root, state)
    profiles.snapshot()
    scheme = root / 'desktop-scheme.json'
    manager = appearance.AppearanceManager(root, state, scheme_file=scheme)
    server = home.create_server(profile / 'start', state / 'home.json', port=0, profiles=profiles, appearance=manager)
    worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
    origin = f'http://127.0.0.1:{server.server_port}'

    def api(path, method='GET', value=None):
        headers = {'Origin': origin}
        if value is not None:
            headers.update({'Content-Type':'application/json','X-Kitsune-Token':server.token})
        request = urllib.request.Request(origin + path, method=method, headers=headers,
                                         data=None if value is None else json.dumps(value).encode())
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)

    def save_settings(**patch):
        snapshot = api('/api/settings')
        return api('/api/settings', 'PUT', {'revision':snapshot['revision'],'data':{**snapshot['data'], **patch}})

    def remember(enabled):
        snapshot = api('/api/profiles')
        current = next(p for p in snapshot['profiles'] if p['id'] == 'default')
        return api('/api/profiles/default', 'PATCH', {key:current[key] for key in ('name','email','color')} |
                   {'revision':snapshot['revision'],'rememberGoogle':enabled})

    remember(True)
    save_settings(wallpaper='night',themeSync=True,accent='blue',art=True,motion=True)
    report = {'root':str(root),'browser':str(args.browser),'checks':[]}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, *args):
        driver.context('chrome'); return driver.script(script, args)

    def applied():
        return eventually(lambda: api('/api/appearance')['native']['status'] == 'applied', timeout=25)

    def cookies():
        return chrome("return Array.from(Services.cookies.cookies).filter(c=>c.name==='kitsune_retention_fixture').map(c=>c.host).sort();")

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        driver.navigate('about:newtab')
        applied()
        baseline = chrome("return {signed:Services.prefs.getBoolPref('xpinstall.signatures.required'),strictFile:Services.prefs.getBoolPref('security.fileuri.strict_origin_policy'),sanitize:Services.prefs.getBoolPref('privacy.sanitize.sanitizeOnShutdown'),cookies:Services.prefs.getIntPref('network.cookie.cookieBehavior'),https:Services.prefs.getBoolPref('dom.security.https_only_mode'),sandbox:Services.prefs.getIntPref('security.sandbox.content.level')};")
        assert baseline['signed'] and baseline['strictFile'] and baseline['sanitize'] and baseline['cookies'] == 5 and baseline['https'] and baseline['sandbox'] > 0, baseline
        check('Native bridge loaded normally; security controls preserved')
        assert chrome("return getComputedStyle(document.documentElement).getPropertyValue('--kb-bg').trim()") == appearance.PALETTES['night']['bg']
        check('Initial native chrome palette applied and acknowledged')
        save_settings(wallpaper='ember',motion=False); applied()
        assert chrome("return getComputedStyle(document.documentElement).getPropertyValue('--kb-bg').trim()") == appearance.PALETTES['ember']['bg']
        driver.context('content')
        eventually(lambda: driver.script("return getComputedStyle(document.documentElement).getPropertyValue('--kb-bg').trim()") == appearance.PALETTES['ember']['bg'])
        eventually(lambda: driver.script("return getComputedStyle(document.querySelector('.logo-and-wordmark .logo')).animationName") == 'none')
        driver.screenshot('native-live-ember.png', chrome=True)
        check('Open window and existing native tab update theme and motion without restart')
        driver.navigate('data:text/html,<title>Untouched site</title><h1>Ordinary website</h1>')
        assert driver.script("return getComputedStyle(document.documentElement).getPropertyValue('--kb-bg')") == ''
        check('Native appearance styles never enter ordinary websites')
        values = {source:appearance.PALETTES['night'][key] for key, source in appearance.SCHEME_KEYS.items()}
        values['primary'] = '#c4daf9'
        scheme.write_text(json.dumps({'colours':values}))
        save_settings(themeSync=False,accent='system'); applied()
        assert chrome("return getComputedStyle(document.documentElement).getPropertyValue('--kb-primary').trim()") == '#c4daf9'
        values['primary'] = '#bdedda'
        scheme.write_text(json.dumps({'colours':values}))
        eventually(lambda: chrome("return getComputedStyle(document.documentElement).getPropertyValue('--kb-primary').trim()") == '#bdedda', timeout=20)
        check('Desktop palette updates native chrome with home closed, through the background service')
        applied()
        assert api('/api/appearance')['native']['googleRemember'] is True
        # Synthetic persistent cookies with no authentication value. The bridge,
        # not this test, must add the Google-only shutdown exception.
        chrome("""for(const host of ['.google.com','.accounts.google.com','.example.test'])
          Services.cookies.add(host,'/','kitsune_retention_fixture','synthetic-test-only',true,false,false,
            Date.now()+86400000,{},Ci.nsICookie.SAMESITE_NONE,Ci.nsICookie.SCHEME_HTTPS);""")
        assert len(cookies()) == 3, cookies()
        driver.close(); driver = None
        driver = WebDriver(profile, evidence, browser=args.browser)
        applied()
        retained = cookies(); report['retainedSyntheticCookieHosts'] = retained
        assert retained == ['.accounts.google.com','.google.com'], retained
        check('Full browser restart preserves only synthetic Google cookies; unrelated cookies cleared')
        remember(False); applied()
        assert api('/api/appearance')['native']['googleRemember'] is False
        driver.close(); driver = None
        driver = WebDriver(profile, evidence, browser=args.browser)
        assert cookies() == []
        check('Turning retention off restores Google cleanup on the next full restart')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown(); server.server_close(); worker.join(timeout=3)
        (evidence / 'report.json').write_text(json.dumps(report, indent=2))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
