"""Kitsune Zero · la barra de la izquierda en pastillas: perfil y modo, en el motor real (perfil temporal, sin ventana en pantalla).

Decisión de Risco (15-10): entre los botones de ventana y la marca, una columna de pastillas: arriba el perfil
(una bolita, la del perfil en el que estás; al pulsarla, un menú con tus perfiles y un «+» para crear otro),
debajo un interruptor para pasar entre «Currar» y «Chill», en medio las pestañas y abajo los accesos directos.
Los perfiles son los espacios de Kitsune: cada uno guarda sus pestañas (las de los demás se esconden), su
color, su icono y, si se quiere, su usuario. Va en Windows, macOS y Linux.

1. A la izquierda, una columna: la pastilla del perfil (una bolita), la del modo y la de las pestañas, una
   debajo de otra y alineadas.
2. Al pulsar la bolita sale el menú de perfiles (los espacios, con el de ahora marcado, «Nuevo perfil» e
   «Imagen»); elegir otro cambia de espacio (se ven sus pestañas, no las del otro) y la bolita pasa a él.
3. «Nuevo perfil» abre el editor de espacios de Kitsune.
4. El interruptor pasa entre «Currar» (pomodoro y silencio) y «Chill» (sin ellos); cada perfil guarda su modo
   y lo que se cambia en él: al volver a un perfil, vuelve el suyo.
5. Con una imagen puesta, la bolita la enseña.

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import http.server
import json
from pathlib import Path
import tempfile
import threading
import time

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        name = self.path.strip('/') or 'inicio'
        self.wfile.write(f'<!doctype html><meta charset=utf-8><title>{name}</title><h1>{name}</h1>'.encode())

    def log_message(self, *args):
        pass


STATE = """
const box = id => { const r = document.getElementById(id)?.getBoundingClientRect(); return r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; };
const bubble = document.querySelector('#zero-profile .zero-profile-bubble');
const menu = document.getElementById('zero-profiles');
const pref = name => { try { return Services.prefs.getBoolPref('kitsune.zero.' + name); } catch { return null; } };
const { KitsuneSpaces } = ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs');
return {
  profile: box('zero-profile'), mode: box('zero-mode'), rail: box('zero-rail'),
  bubble: bubble && { space: bubble.dataset.space, letter: bubble.textContent.trim(), img: bubble.querySelector('img')?.getAttribute('src') ?? null },
  menu: menu && menu.hasAttribute('open') ? { items: [...menu.querySelectorAll('[data-space]')].map(b => [b.dataset.space, b.hasAttribute('current')]),
                                              actions: [...menu.querySelectorAll('[data-action]')].map(b => b.dataset.action) } : null,
  switchMode: document.getElementById('zero-mode')?.dataset.mode ?? null,
  space: KitsuneSpaces.active(window),
  railTabs: [...document.querySelectorAll('#zero-rail .zero-tab')].map(r => r.getAttribute('aria-label')),
  pomodoro: pref('pomodoro'), silence: pref('silence'), sounds: pref('sounds'),
};
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-perfiles-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def state():
        return chrome(STATE)

    def until(condition, timeout=8):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {state()}') from None

    def click(selector):
        driver.context('chrome')
        node = driver.command('POST', '/element', {'using': 'css selector', 'value': selector})
        driver.command('POST', f"/element/{list(node.values())[0]}/click", {})

    spaces = "ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs').KitsuneSpaces"
    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/trabajo')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        driver.context('chrome')
        casa = driver.script(f"const done = arguments[arguments.length - 1]; {spaces}.create({{ name: 'Casa', color: 'pink', user: null, icon: '🏠' }}).then(done, e => done(String(e)));", [], asynchronous=True)
        assert casa and not str(casa).startswith('Error'), casa
        first = chrome(f"return {spaces}.active(window)")
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: (s := state())['profile'] and s['mode'] and s['rail'] and s['bubble'])
        s = state()
        assert s['profile']['y'] + s['profile']['h'] <= s['mode']['y'] and s['mode']['y'] + s['mode']['h'] <= s['rail']['y'], s
        assert abs(s['profile']['x'] - s['rail']['x']) <= 1 and abs(s['mode']['x'] - s['rail']['x']) <= 1, s
        assert s['bubble']['space'] == first, s
        check('A la izquierda, una columna: perfil, modo y pestañas, una debajo de otra')

        click('#zero-profile .zero-profile-bubble')
        until(lambda: (m := state()['menu']) and len(m['items']) >= 2 and 'new' in m['actions'] and 'image' in m['actions'])
        assert [sp for sp, cur in state()['menu']['items'] if cur] == [first]
        click(f'#zero-profiles [data-space="{casa}"]')
        until(lambda: (s := state())['space'] == casa and s['bubble']['space'] == casa and s['menu'] is None and 'trabajo' not in s['railTabs'])
        driver.context('chrome')
        chrome("gBrowser.selectedTab = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })", [origin + '/casa'])
        until(lambda: 'casa' in state()['railTabs'])
        click('#zero-profile .zero-profile-bubble')
        until(lambda: state()['menu'])
        click(f'#zero-profiles [data-space="{first}"]')
        until(lambda: (s := state())['space'] == first and 'trabajo' in s['railTabs'] and 'casa' not in s['railTabs'])
        check('El menú de perfiles cambia de perfil, y cada uno con sus pestañas')

        click('#zero-profile .zero-profile-bubble')
        until(lambda: state()['menu'])
        click('#zero-profiles [data-action="new"]')
        until(lambda: chrome("return document.getElementById('kitsune-space-panel')?.state") == 'open')
        chrome("document.getElementById('kitsune-space-panel').hidePopup()")
        check('«Nuevo perfil» abre el editor de espacios de Kitsune')

        click('#zero-mode')
        until(lambda: (s := state())['switchMode'] == 'work' and s['pomodoro'] is True and s['silence'] is True)
        click('#zero-mode')
        until(lambda: (s := state())['switchMode'] == 'chill' and s['pomodoro'] is False and s['silence'] is False)
        chrome("Services.prefs.setBoolPref('kitsune.zero.sounds', true)")
        time.sleep(0.3)
        # Casa: su propio modo (currar), y al volver al primero, el suyo (chill con sonidos).
        click('#zero-profile .zero-profile-bubble')
        until(lambda: state()['menu'])
        click(f'#zero-profiles [data-space="{casa}"]')
        until(lambda: state()['space'] == casa)
        click('#zero-mode')
        until(lambda: (s := state())['switchMode'] == 'work' and s['pomodoro'] is True and s['sounds'] is False)
        click('#zero-profile .zero-profile-bubble')
        until(lambda: state()['menu'])
        click(f'#zero-profiles [data-space="{first}"]')
        until(lambda: (s := state())['space'] == first and s['switchMode'] == 'chill' and s['pomodoro'] is False and s['sounds'] is True)
        check('El interruptor pasa entre Currar y Chill, y cada perfil guarda su modo')

        image = 'data:image/svg+xml,' + '%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 4 4%22%3E%3Crect width=%224%22 height=%224%22 fill=%22%23e8743b%22/%3E%3C/svg%3E'
        chrome("Services.prefs.setStringPref('kitsune.zero.profiles.images', JSON.stringify({ [arguments[0]]: arguments[1] }))", [first, image])
        until(lambda: state()['bubble']['img'] == image)
        check('Con una imagen puesta, la bolita la enseña')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
