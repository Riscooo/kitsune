#!/usr/bin/env python3
"""Isolated Gecko chrome regression, never the user's running browser.

Headless Gecko has no GTK decoration provider. Test-only LookAndFeel prefs
simulate its CSD capability; this verifies real native DOM/commands and CSS,
not Wayland/Niri's response to maximize or native decoration negotiation.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import tempfile

from browser_smoke import DEFAULT_BROWSER, ROOT, WebDriver, eventually, prepare_profile


SNAPSHOT = """
const visible = e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 &&
  getComputedStyle(e).visibility !== 'hidden';
return {
  customTitlebar: CustomTitlebar.enabled,
  fullscreen: window.fullScreen,
  mode: document.documentElement.getAttribute('sizemode'),
  boxes: [...document.querySelectorAll('.titlebar-buttonbox-container')]
    .filter(visible).map(e => ({toolbar:e.parentNode.id,
      rect:e.getBoundingClientRect().toJSON(),
      buttons:[...e.querySelectorAll('.titlebar-button')].filter(visible)
        .map(b=>({command:b.getAttribute('command'),
          rect:b.getBoundingClientRect().toJSON(),
          dot:b.querySelector('.toolbarbutton-icon').getBoundingClientRect().toJSON(),
          color:getComputedStyle(b.querySelector('.toolbarbutton-icon')).backgroundColor,
          label:b.getAttribute('data-l10n-id')}))})),
  tabLeft:document.getElementById('tabbrowser-tabs').getBoundingClientRect().left,
  fullscreenKey:document.getElementById('key_enterFullScreen')?.getAttribute('command'),
  hasGlobalOverlay:!!document.querySelector('[data-inkshadow-overlay]')
};
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', type=Path, default=DEFAULT_BROWSER)
    parser.add_argument('--evidence', type=Path,
                        default=ROOT / 'tests/evidence/window-chrome-2026-10-02')
    args = parser.parse_args()
    args.evidence.mkdir(parents=True, exist_ok=True)
    report = {'scope': 'isolated-headless-native-Gecko',
              'simulated': ['GTK CSD capability (no compositor)'],
              'notValidated': ['Niri maximize/restore behavior',
                               'running personal browser (not restarted)'],
              'checks': [], 'screenshots': []}
    browser = None
    with tempfile.TemporaryDirectory(prefix='kitsune-window-chrome-') as directory:
        profile, _ = prepare_profile(Path(directory))
        # These are solely fixture capabilities, never installed in user.js.
        # Native pref names: mozilla-firefox/firefox/widget/nsXPLookAndFeel.cpp.
        with (profile / 'user.js').open('a') as handle:
            for key in ('GtkCSDAvailable', 'GtkCSDCloseButton',
                        'GtkCSDMaximizeButton', 'GtkCSDMinimizeButton'):
                handle.write(f'\nuser_pref("ui.{key}", 1);')
        try:
            browser = WebDriver(profile, args.evidence, browser=args.browser)
            browser.context('chrome')

            def snapshot():
                browser.context('chrome')
                return browser.script(SNAPSHOT)

            def when(predicate):
                value = snapshot()
                return value if predicate(value) else None

            normal = eventually(lambda: when(value_check))
            box = normal['boxes'][0]
            buttons = box['buttons']
            assert [b['command'] for b in sorted(buttons, key=lambda b: b['rect']['x'])] == [
                'cmd_closeWindow', 'cmd_maximizeWindow'], normal
            for button in buttons:
                assert button['rect']['width'] == 26 and button['rect']['height'] == 28, button
                assert button['dot']['width'] == 12 and button['dot']['height'] == 12, button
                assert button['label'], button
            assert box['rect']['right'] <= normal['tabLeft'], normal
            assert {b['color'] for b in buttons} == {'rgb(150, 61, 50)', 'rgb(115, 120, 111)'}, normal  # óxido y apagado de Tinta
            assert normal['fullscreenKey'] == 'View:FullScreen', normal
            assert not normal['hasGlobalOverlay'], normal
            report['checks'].append('native close/maximize, left order, 26x28 hit targets, 12px dots, localization, F11 preserved')
            report['normal'] = normal
            report['screenshots'].append(browser.screenshot('native-chrome-normal.png', chrome=True))

            browser.click('#TabsToolbar .titlebar-max')
            maximized = eventually(lambda: when(lambda value: value['mode'] == 'maximized'))
            assert {b['command'] for b in maximized['boxes'][0]['buttons']} == {'cmd_closeWindow', 'cmd_restoreWindow'}, maximized
            report['checks'].append('native maximize command and restore-button state in headless Gecko')
            browser.click('#TabsToolbar .titlebar-restore')
            eventually(lambda: snapshot()['mode'] == 'normal')
            report['checks'].append('native restore command in headless Gecko')

            browser.shortcut('\ue03b')  # WebDriver F11, own window only.
            eventually(lambda: snapshot()['fullscreen'])
            browser.shortcut('\ue03b')
            eventually(lambda: not snapshot()['fullscreen'])
            report['checks'].append('native F11 enters and exits fullscreen')

            browser.script('Services.prefs.setIntPref("ui.GtkCSDMaximizeButton", 0);')
            eventually(lambda: len(snapshot()['boxes'][0]['buttons']) == 1)
            assert snapshot()['boxes'][0]['buttons'][0]['command'] == 'cmd_closeWindow'
            browser.script('Services.prefs.setIntPref("ui.GtkCSDMaximizeButton", 1);')
            eventually(lambda: value_check(snapshot()))
            browser.script('Services.prefs.setIntPref("browser.tabs.inTitlebar", 0);')
            eventually(lambda: snapshot()['boxes'] == [])
            browser.script('Services.prefs.setIntPref("browser.tabs.inTitlebar", 1);')
            eventually(lambda: value_check(snapshot()))
            report['checks'].append('native platform capability and titlebar-hidden rules remain respected')

            # Close only an extra window from this disposable browser session.
            handles_before = browser.command('GET', '/window/handles')
            browser.shortcut('n', ('\ue009',))  # Native Ctrl+N; Gecko rejects WebDriver newWindow here.
            created = eventually(lambda: [handle for handle in browser.command('GET', '/window/handles')
                                           if handle not in handles_before])
            browser.command('POST', '/window', {'handle': created[0]})
            browser.context('chrome')
            eventually(lambda: value_check(snapshot()))
            browser.click('#TabsToolbar .titlebar-close')
            eventually(lambda: len(browser.command('GET', '/window/handles')) == len(handles_before))
            report['checks'].append('native close button closes only isolated fixture window')
            report['passed'] = True
        except Exception as error:
            report['passed'] = False
            report['error'] = str(error)
            if browser:
                report['lastSnapshot'] = snapshot()
                report['screenshots'].append(browser.screenshot('failure-native-chrome.png', chrome=True))
            raise
        finally:
            if browser:
                browser.close()
            (args.evidence / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


def value_check(value):
    return value['customTitlebar'] and len(value['boxes']) == 1 and len(value['boxes'][0]['buttons']) == 2


if __name__ == '__main__':
    main()
