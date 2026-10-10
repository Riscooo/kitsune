#!/usr/bin/env python3
"""Home settings through native Gecko, real loopback API and disposable state.

Native action dispatch and appearance acknowledgements are test doubles. This
checks their UI, not actual browser-theme application or online accounts.
"""
from __future__ import annotations

import argparse
import contextlib
import copy
import json
from pathlib import Path
import shutil
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request

from browser_smoke import DEFAULT_BROWSER, ROOT, WebDriver, eventually, prepare_profile, wait_start
from profiles_ui import load_home


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=DEFAULT_BROWSER)
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-settings-panels-'))
    evidence = args.evidence.absolute() if args.evidence else root / 'evidence'
    evidence.mkdir(parents=True, exist_ok=True)
    profile, _ = prepare_profile(root)
    browser_data = root / 'browser-data'
    templates = browser_data / 'templates'
    templates.mkdir(parents=True)
    shutil.copyfile(ROOT / 'install/user.js', templates / 'user.js')
    shutil.copytree(ROOT / 'chrome', templates / 'chrome')
    (browser_data / 'native').mkdir()
    (browser_data / 'native/kitsune-appearance.sys.mjs').write_text('// Availability marker for an explicitly mocked native acknowledgement.\n')
    home = load_home()
    launches = []
    manager = home.profiles_module.ProfileManager(browser_data, root / 'state', launch=lambda *request: launches.append(request))
    manager.snapshot()
    appearance = home.make_appearance(browser_data, root / 'state', 'default')
    state_file = root / 'state/home.json'
    server = home.create_server(profile / 'start', state_file, port=0, profiles=manager, appearance=appearance)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    report = {'isolatedRoot': str(root), 'checks': [], 'screenshots': [], 'launchesMocked': True, 'nativeAcknowledgementsMocked': True}
    driver = None

    def js(source, *values, asynchronous=False):
        driver.context('content')
        return driver.script(source, values, asynchronous=asynchronous)

    def data():
        return server.store.snapshot()['data']

    def saved(predicate=lambda value: True):
        def matches():
            value = data()
            return predicate(value) and js("""const value=arguments[0], body=document.body.dataset;
              return document.documentElement.dataset.storageReady==='true'
                && document.querySelector('#save-state').textContent==='Guardado en este perfil'
                && body.motion===(value.motion?'on':'off')
                && body.focus===(value.focus?'on':'off')
                && body.clock===(value.modules.clock?'on':'off') && body.shortcuts===(value.modules.shortcuts?'on':'off')
                && document.querySelector('#newtab-toggle').checked===value.newTab;""", value)
        eventually(matches)

    def console_errors():
        driver.context('chrome')
        result = driver.script("return Services.console.getMessageArray().map(m=>({message:m.message,source:m.sourceName||'',flags:m.flags??null,category:m.category||''})).filter(m=>m.source.startsWith(arguments[0])&&m.flags===0&&m.category.toLowerCase().includes('javascript'));", [origin])
        driver.context('content')
        return result

    def tab(name):
        driver.click(f'[data-settings-tab={name}]')
        assert js("return !document.querySelector(arguments[0]).hidden", f'[data-settings-panel={name}]')

    def capture(name):
        driver.settle()
        report['screenshots'].append(driver.screenshot(name, chrome=True))
        driver.context('content')

    def ack():
        value = server.refresh_appearance()
        appearance.ack.write_text(json.dumps({'version': 1, 'fingerprint': value['fingerprint'], 'at': time.time() * 1000, 'googleRemember': False, 'googlePolicyManaged': False}))
        eventually(lambda: js("return document.querySelector('#theme-status').textContent==='Tema aplicado al navegador.'"))

    def loaded():
        wait_start(driver)
        eventually(lambda: js("return document.documentElement.dataset.storageReady==='true'&&document.documentElement.dataset.profilesReady==='true'"))

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        driver.navigate(origin + '/')
        loaded()
        assert js("return !!document.querySelector('#clock-time').textContent && !!document.querySelector('#date').textContent")
        capture('home-1540.png')
        driver.click('#settings-open')
        assert js("return document.querySelector('#settings-dialog').open")
        driver.click('[data-settings-tab=appearance]')
        driver.shortcut('\ue014')
        assert js("return document.activeElement.dataset.settingsTab==='modules' && !document.querySelector('#settings-panel-modules').hidden")
        driver.shortcut('\ue010')
        assert js("return document.activeElement.dataset.settingsTab==='navigation'")
        driver.shortcut('\ue011')
        tab('appearance')
        report['checks'].append('Settings opens accessibly; arrow/end keyboard navigation selects real tab panels')

        assert js("""return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()==='#963d32'
          && getComputedStyle(document.body).backgroundColor==='rgb(246, 245, 241)'
          && !document.querySelector('.scene,[data-wallpaper],[data-accent],#art-toggle,#theme-sync-toggle')
          && [...document.querySelectorAll('#settings-panel-appearance input')].map(input=>input.id).join()==='theme-claro,theme-oscuro,background-file,motion-toggle'""")
        for path, status in (('/logo.svg', 200), ('/logo-dark.svg', 200), ('/seal.svg', 200)):
            with urllib.request.urlopen(origin + path) as response:
                assert response.status == status and response.headers['Content-Type'].startswith('image/svg+xml'), path
        try:
            urllib.request.urlopen(origin + '/anime-veil.webp')
            raise AssertionError('Nightfall art must no longer be served')
        except urllib.error.HTTPError as error:
            assert error.code == 404, error.code
        report['checks'].append('Home is paper and ink: rust accent, no scene/wallpaper/accent controls, Apariencia only offers motion; logo and seal served, Nightfall art gone')

        driver.click('#motion-toggle')
        saved(lambda value: not value['motion'])
        eventually(lambda: js("return document.querySelector('#theme-status').textContent==='Aplicando el tema al navegador…'"))
        ack()
        assert js("return getComputedStyle(document.querySelector('.greeting')).animationName==='none'")
        report['checks'].append('Motion toggle stops the ink-settle animation and waits for the real native acknowledgement (acks mocked)')
        tab('modules')
        driver.click('#module-clock')
        saved(lambda value: not value['modules']['clock'])
        assert js("return getComputedStyle(document.querySelector('.clock-module')).display==='none'")
        driver.click('#module-shortcuts')
        saved(lambda value: not value['modules']['shortcuts'])
        assert js("return getComputedStyle(document.querySelector('.favorites')).display==='none'")
        driver.click('#module-clock')
        driver.click('#module-shortcuts')
        saved(lambda value: value['modules']['clock'] and value['modules']['shortcuts'])
        report['checks'].append('Both module toggles alter the UI and confirmed stored preferences; consecutive toggles preserve each other')

        tab('navigation')
        driver.click('#newtab-toggle')
        saved(lambda value: value['newTab'])
        assert js("return [...document.querySelectorAll('.quick-link>a')].every(a=>a.target==='_blank'&&a.rel.includes('noopener'))")
        for action in ('search', 'privacy', 'downloads', 'extensions', 'passwords', 'sync', 'settings'):
            driver.click(f'[data-native-action={action}]')
            eventually(lambda: len(launches) and launches[-1] == ('default', action))
            eventually(lambda: js("return !document.querySelector('[data-native-action=settings]').disabled"))
        assert len(launches) == 7
        report['checks'].append('New-tab preference updates real links; seven native navigation actions dispatch to the current profile (launcher mocked)')

        tab('appearance')
        old_update = server.store.update
        conflict = {'injected': False}

        def update_once(value, revision):
            if not conflict['injected']:
                conflict['injected'] = True
                state = server.store.snapshot()
                other = copy.deepcopy(state['data'])
                other['modules']['clock'] = False
                old_update(other, state['revision'])
            return old_update(value, revision)

        server.store.update = update_once
        driver.click('#motion-toggle')
        saved(lambda value: value['motion'] and not value['modules']['clock'])
        server.store.update = old_update
        assert conflict['injected']
        report['checks'].append('A real409 mutation conflict rebases the chosen preference without discarding the other window module change')
        before = copy.deepcopy(data())
        server.store.unavailable = True
        driver.click('#motion-toggle')
        eventually(lambda: js("return document.documentElement.dataset.storageReady==='false'&&!document.querySelector('#settings-retry').hidden"))
        assert server.store.data == before
        assert js("return document.querySelector('#motion-toggle').checked") == before['motion']
        capture('settings-offline-1540.png')
        server.store.unavailable = False
        driver.click('#settings-retry')
        saved()
        assert data() == before
        driver.click('#motion-toggle')
        saved(lambda value: not value['motion'])
        report['checks'].append('Real503 read/write outage restores last confirmed controls, never claims saved, and Retry reconnects before the next successful write')

        driver.shortcut('\ue00c')
        eventually(lambda: js("return document.activeElement.id==='settings-open'"))
        driver.click('#focus-toggle')
        saved(lambda value: value['focus'])
        assert js("return getComputedStyle(document.querySelector('.favorites')).display==='none'")
        driver.click('#focus-toggle')
        saved(lambda value: not value['focus'])
        driver.click('.add-link')
        driver.fill('#link-name', 'Prueba local')
        driver.fill('#link-url', origin + '/?safe-test')
        driver.click('#link-form button[type=submit]')
        eventually(lambda: js("return !document.querySelector('#link-dialog').open"))
        saved(lambda value: any(link['name'] == 'Prueba local' for link in value['links']))
        driver.click('#edit-links')
        driver.click('[aria-label="Editar Prueba local"]')
        driver.fill('#link-name', 'Prueba editada')
        driver.click('#link-form button[type=submit]')
        eventually(lambda: js("return !document.querySelector('#link-dialog').open"))
        driver.click('[aria-label="Editar Prueba editada"]')
        driver.click('#delete-link')
        eventually(lambda: js("return !document.querySelector('#link-dialog').open"))
        saved(lambda value: not any(link['name'].startswith('Prueba ') for link in value['links']))
        report['checks'].append('Focus/Escape restore usable home controls; shortcut create/edit/delete still traverses UI, API and stored links')

        expected = copy.deepcopy(data())
        before_restart_errors = console_errors()
        assert not before_restart_errors, before_restart_errors
        driver.close()
        driver = WebDriver(profile, evidence, browser=args.browser)
        driver.navigate(origin + '/')
        loaded()
        assert data() == expected
        assert js("return document.querySelector('#motion-toggle').checked") == expected['motion']
        assert js("return document.querySelector('#module-clock').checked") == expected['modules']['clock']
        assert js("return document.querySelector('#newtab-toggle').checked") == expected['newTab']
        report['checks'].append('Confirmed preferences survive a real browser close/restart without changing browser cleanup policy')

        driver.context('chrome')
        driver.script("const done=arguments[arguments.length-1];document.documentElement.style.setProperty('min-width','0px','important');requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));", asynchronous=True)
        driver.context('content')
        driver.command('POST', '/window/rect', {'width': 390, 'height': 844})
        eventually(lambda: js('return innerWidth===390'))
        driver.click('#settings-open')
        for panel in ('appearance', 'modules', 'navigation'):
            tab(panel)
            assert js("const d=document.querySelector('#settings-dialog');return d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=391")
            capture(f'settings-{panel}-390.png')
        report['checks'].append('All three settings panels fit390px without horizontal overflow')
        errors = before_restart_errors + console_errors()
        assert not errors, errors
        report.update(status='passed', consoleErrors=errors, finalSettings=expected, dispatchedActions=launches)
    except Exception as error:
        report.update(status='failed', error=str(error) or traceback.format_exc())
        if driver:
            with contextlib.suppress(Exception): capture('failure.png')
        raise
    finally:
        if driver: driver.close()
        server.shutdown(); server.server_close()
        (evidence / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
