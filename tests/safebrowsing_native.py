"""Safe Browsing con la clave propia (motor real, perfil temporal; necesita red).

Descarga las listas públicas de Google (sin las de descargas, exclusivas de la
clave de Mozilla) y bloquea la página de prueba de phishing de Google. Sin clave en
~/.config/kitsune-browser/safebrowsing-api-key, la prueba se salta.
"""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import time

from browser_smoke import WebDriver, prepare_profile, eventually

KEY = Path.home() / ".config/kitsune-browser/safebrowsing-api-key"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    if not KEY.is_file():
        print(json.dumps({"status": "skipped", "reason": "sin clave de Safe Browsing"}))
        return
    root = Path(tempfile.mkdtemp(prefix='kitsune-safebrowsing-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    with (profile / 'user.js').open('a') as prefs:
        prefs.write('user_pref("remote.prefs.recommended", false);\n')
    driver = WebDriver(profile, evidence, browser=args.browser)
    report = {'checks': []}
    try:
        driver.context('chrome')
        state = driver.script("""const k = Services.urlFormatter.formatURL('%GOOGLE_SAFEBROWSING_API_KEY%');
          return {key: k.startsWith('AIza'), lists: Services.prefs.getCharPref('browser.safebrowsing.provider.google5.lists'),
            locked: ['block_potentially_unwanted', 'block_uncommon'].every(n => Services.prefs.prefIsLocked('browser.safebrowsing.downloads.remote.' + n))};""")
        assert state['key'] and 'badbinurl' not in state['lists'] and 'downloadwhite' not in state['lists'] and state['locked'], state
        driver.script("""Cc['@mozilla.org/url-classifier/listmanager;1'].getService(Ci.nsIUrlListManager)
          .forceUpdates(Services.prefs.getCharPref('browser.safebrowsing.provider.google5.lists'));""")
        eventually(lambda: driver.script("return Services.prefs.prefHasUserValue('browser.safebrowsing.provider.google5.lastupdatetime')"), timeout=150, interval=2)
        report['checks'].append('La clave propia está compilada y descarga las listas públicas de Google')
        time.sleep(2)
        try:
            driver.navigate('https://testsafebrowsing.appspot.com/s/phishing.html')
        except RuntimeError:
            pass
        driver.context('chrome')
        uri = eventually(lambda: (u := driver.script("return gBrowser.selectedBrowser.documentURI.spec")).startswith('about:blocked') and u, timeout=20)
        assert 'deceptiveBlocked' in uri, uri
        driver.screenshot('phishing-bloqueado.png')
        report['checks'].append('La página de prueba de phishing de Google sale bloqueada')
        report['status'] = 'passed'
    finally:
        driver.close()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
