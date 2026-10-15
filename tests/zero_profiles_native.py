"""Kitsune Zero · la barra de la izquierda en pastillas: perfiles y modo, en el motor real (perfil temporal, sin ventana en pantalla).

Decisión de Risco (15-10): entre los botones de ventana y la marca, una columna de pastillas: arriba los
perfiles, debajo un interruptor para pasar entre «Currar» y «Chill», en medio las pestañas y abajo los
accesos directos. Los perfiles son los espacios de Kitsune: cada uno guarda sus pestañas (las de los demás se
esconden), su color, su icono y, si se quiere, su usuario. Y (Risco, 15-10, tarde): «que me salgan los
diferentes perfiles uno encima de otro para cambiar de forma rápida», editarlos y borrarlos. Va en Windows,
macOS y Linux.

1. A la izquierda, una columna: la pastilla de los perfiles, la del modo y la de las pestañas, una debajo de
   otra y alineadas.
2. En la pastilla, todos los perfiles, uno encima de otro (el de ahora marcado) y un «+»; un clic en otro
   cambia de perfil (se ven sus pestañas, no las del otro).
3. Un clic en el de ahora (o el clic derecho en cualquiera) abre su ficha al lado: nombre, icono y color se
   cambian al momento.
4. El «+» abre una ficha en blanco: con un nombre, «Crear» hace el perfil y pasa a él.
5. «Borrar» pregunta antes (y «Cancelar» no borra); al confirmar se va el perfil y lo que Zero guardaba de él
   (su modo, su imagen, sus accesos directos). El último perfil no se puede borrar.
6. El modo son dos botones, no un interruptor (Risco, 15-10: «en vez de ser un slider, sean dos botones, uno
   con una luna y otro para trabajar»): «Currar» (un maletín: pomodoro y silencio) y «Chill» (una luna: sin
   ellos); el del modo de ahora, marcado (y pulsarlo otra vez no lo cambia). Cada perfil guarda su modo y lo
   que se cambia en él: al volver a un perfil, vuelve el suyo.
7. Con una imagen puesta, la bolita la enseña.
8. En la ficha, sus sesiones (Risco, 15-10: «¿se guardan las sesiones iniciadas en Google?»): compartidas o
   propias (su contenedor: su Google, sus cookies); al cambiarlas, sus pestañas pasan a ellas. Uno nuevo
   sale con las suyas propias. (Con un Kitsune que aún no sabe hacerlo, la ficha no las enseña.)

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import http.server
import json
from pathlib import Path
import tempfile
import threading
import time
import sys

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
const box = el => { const r = (typeof el === 'string' ? document.getElementById(el) : el)?.getBoundingClientRect(); return r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; };
const editor = document.getElementById('zero-profiles');
const pref = name => { try { return Services.prefs.getBoolPref('kitsune.zero.' + name); } catch { return null; } };
const json = name => { try { return JSON.parse(Services.prefs.getStringPref('kitsune.zero.' + name, '')) ?? {}; } catch { return {}; } };
const { KitsuneSpaces } = ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs');
const add = document.querySelector('#zero-profile .zero-profile-add');
return {
  profile: box('zero-profile'), mode: box('zero-mode'), rail: box('zero-rail'),
  stack: [...document.querySelectorAll('#zero-profile .zero-profile-bubble')].map(b => ({ space: b.dataset.space, current: b.hasAttribute('current'),
            glyph: b.textContent.trim(), color: b.dataset.color, img: b.querySelector('img')?.getAttribute('src') ?? null, box: box(b) })),
  add: !!add && !add.hidden && !!box(add),
  editor: editor?.hasAttribute('open') ? { space: editor.dataset.space ?? '', name: editor.querySelector('.zero-profile-name')?.value ?? null,
            confirming: editor.hasAttribute('confirming'), canDelete: !(editor.querySelector('[data-action=delete]')?.disabled ?? true), box: box(editor) } : null,
  spaces: KitsuneSpaces.list().spaces.map(({ id, name, color, icon }) => ({ id, name, color, icon: icon ?? '' })),
  zeroIds: { modes: Object.keys(json('modes').profiles ?? {}), images: Object.keys(json('profiles.images')), shortcuts: Object.keys(json('shortcuts')) },
  switchMode: document.getElementById('zero-mode')?.dataset.mode ?? null,
  modeButtons: [...document.querySelectorAll('#zero-mode > button[data-mode]')].map(b => ({ mode: b.dataset.mode, pressed: b.getAttribute('aria-pressed') === 'true',
            label: b.getAttribute('aria-label'), icon: getComputedStyle(b, '::before').maskImage.startsWith('url('), box: box(b) })),
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

    def right_click(selector):
        driver.context('chrome')
        node = driver.command('POST', '/element', {'using': 'css selector', 'value': selector})
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [
            {'type': 'pointerMove', 'origin': node, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 2}, {'type': 'pointerUp', 'button': 2}]}]})
        driver.command('DELETE', '/actions')

    def type_into(selector, text, enter=False):
        # Como una persona: en el campo (ya enfocado al abrir la ficha), todo seleccionado (Ctrl+A) y se
        # escribe encima.
        assert chrome("return document.activeElement === document.querySelector(arguments[0])", [selector]), 'el campo no tiene el foco'
        modifier = '\ue03d' if sys.platform == 'darwin' else '\ue009'
        keys = [{'type': 'keyDown', 'value': modifier}, {'type': 'keyDown', 'value': 'a'}, {'type': 'keyUp', 'value': 'a'}, {'type': 'keyUp', 'value': modifier}]
        for char in text + ('\ue007' if enter else ''):
            keys += [{'type': 'keyDown', 'value': char}, {'type': 'keyUp', 'value': char}]
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'key', 'id': 'teclado', 'actions': keys}]})
        driver.command('DELETE', '/actions')

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
        until(lambda: (s := state())['profile'] and s['mode'] and s['rail'] and s['stack'])
        s = state()
        assert s['profile']['y'] + s['profile']['h'] <= s['mode']['y'] and s['mode']['y'] + s['mode']['h'] <= s['rail']['y'], s
        assert abs(s['profile']['x'] - s['rail']['x']) <= 1 and abs(s['mode']['x'] - s['rail']['x']) <= 1, s
        check('A la izquierda, una columna: perfiles, modo y pestañas, una debajo de otra')

        s = state()
        assert [b['space'] for b in s['stack']] == [first, casa] and [b['current'] for b in s['stack']] == [True, False] and s['add'], s
        centre = lambda b: b['box']['x'] + b['box']['w'] / 2
        assert s['stack'][1]['box']['y'] > s['stack'][0]['box']['y'] and abs(centre(s['stack'][1]) - centre(s['stack'][0])) <= 1, s
        click(f'#zero-profile .zero-profile-bubble[data-space="{casa}"]')
        until(lambda: (s := state())['space'] == casa and [b['current'] for b in s['stack']] == [False, True] and s['editor'] is None and 'trabajo' not in s['railTabs'])
        driver.context('chrome')
        chrome("gBrowser.selectedTab = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })", [origin + '/casa'])
        until(lambda: 'casa' in state()['railTabs'])
        click(f'#zero-profile .zero-profile-bubble[data-space="{first}"]')
        until(lambda: (s := state())['space'] == first and 'trabajo' in s['railTabs'] and 'casa' not in s['railTabs'])
        check('Los perfiles, uno encima de otro: un clic en otro cambia de perfil, cada uno con sus pestañas')

        click(f'#zero-profile .zero-profile-bubble[data-space="{first}"]')
        until(lambda: (e := state()['editor']) and e['space'] == first)
        s = state()
        assert s['editor']['box']['x'] >= s['profile']['x'] + s['profile']['w'], s
        type_into('#zero-profiles .zero-profile-name', 'Curro', enter=True)
        until(lambda: next(sp for sp in state()['spaces'] if sp['id'] == first)['name'] == 'Curro')
        click('#zero-profiles .zero-profile-colors [data-color="violet"]')
        click('#zero-profiles .zero-profile-icons [data-icon="🎮"]')
        until(lambda: (sp := next(sp for sp in state()['spaces'] if sp['id'] == first)) and sp['color'] == 'violet' and sp['icon'] == '🎮')
        until(lambda: (b := state()['stack'][0]) and b['color'] == 'violet' and b['glyph'] == '🎮')
        click('#zero-profiles .zero-profile-icons [data-icon=""]')
        until(lambda: next(sp for sp in state()['spaces'] if sp['id'] == first)['icon'] == '' and state()['stack'][0]['glyph'] == 'C')
        driver.shortcut('\ue00c')
        until(lambda: state()['editor'] is None)
        check('Un clic en el de ahora abre su ficha: nombre, icono y color, al momento')

        click('#zero-profile .zero-profile-add')
        until(lambda: (e := state()['editor']) and e['space'] == '' and e['name'] == '')
        type_into('#zero-profiles .zero-profile-name', 'Clase')
        click('#zero-profiles [data-action="create"]')
        until(lambda: (s := state())['editor'] is None and len(s['stack']) == 3 and s['stack'][2]['current'] and s['spaces'][2]['name'] == 'Clase')
        clase = state()['spaces'][2]['id']
        check('El «+» abre una ficha en blanco: «Crear» hace el perfil y pasa a él')

        # Lo que Zero guarda de Casa: su modo, su imagen y sus accesos directos.
        chrome("""const set = (name, value) => Services.prefs.setStringPref('kitsune.zero.' + name, JSON.stringify(value));
          set('modes', { profiles: { [arguments[0]]: { mode: 'work' } } }); set('profiles.images', { [arguments[0]]: 'data:image/png;base64,AA==' });
          set('shortcuts', { [arguments[0]]: [{ url: 'https://example.com/', title: 'Ejemplo', icon: null }] });""", [casa])
        right_click(f'#zero-profile .zero-profile-bubble[data-space="{casa}"]')
        until(lambda: (e := state()['editor']) and e['space'] == casa and e['canDelete'])
        click('#zero-profiles [data-action="delete"]')
        until(lambda: state()['editor']['confirming'])
        click('#zero-profiles [data-action="cancel"]')
        until(lambda: (e := state()['editor']) and not e['confirming'] and casa in [sp['id'] for sp in state()['spaces']])
        click('#zero-profiles [data-action="delete"]')
        until(lambda: state()['editor']['confirming'])
        click('#zero-profiles [data-action="confirm"]')
        until(lambda: (s := state())['editor'] is None and casa not in [sp['id'] for sp in s['spaces']] and len(s['stack']) == 2)
        ids = state()['zeroIds']
        assert casa not in ids['modes'] and casa not in ids['images'] and casa not in ids['shortcuts'], ids
        right_click(f'#zero-profile .zero-profile-bubble[data-space="{clase}"]')
        until(lambda: (e := state()['editor']) and e['space'] == clase)
        click('#zero-profiles [data-action="delete"]')
        click('#zero-profiles [data-action="confirm"]')
        until(lambda: len(state()['stack']) == 1 and state()['space'] == first)
        click(f'#zero-profile .zero-profile-bubble[data-space="{first}"]')
        until(lambda: (e := state()['editor']) and e['space'] == first and not e['canDelete'])
        driver.shortcut('\ue00c')
        check('«Borrar» pregunta antes; al confirmar se va el perfil y lo suyo de Zero; el último no se puede borrar')

        casa = driver.script(f"const done = arguments[arguments.length - 1]; {spaces}.create({{ name: 'Casa', color: 'pink', user: null }}).then(done, e => done(String(e)));", [], asynchronous=True)
        until(lambda: len(state()['stack']) == 2)
        def pressed(mode):
            buttons = state()['modeButtons']
            return [b['mode'] for b in buttons] == ['work', 'chill'] and [b['mode'] for b in buttons if b['pressed']] == ([mode] if mode else []) \
                and [b['label'] for b in buttons] == ['Currar', 'Chill'] and all(b['icon'] and b['box'] and b['box']['w'] >= 24 for b in buttons)
        until(lambda: pressed(None))
        click('#zero-mode [data-mode="work"]')
        until(lambda: (s := state())['switchMode'] == 'work' and s['pomodoro'] is True and s['silence'] is True and pressed('work'))
        click('#zero-mode [data-mode="work"]')  # otra vez: se queda en currar
        time.sleep(0.3)
        until(lambda: (s := state())['switchMode'] == 'work' and s['pomodoro'] is True and pressed('work'))
        click('#zero-mode [data-mode="chill"]')
        until(lambda: (s := state())['switchMode'] == 'chill' and s['pomodoro'] is False and s['silence'] is False and pressed('chill'))
        chrome("Services.prefs.setBoolPref('kitsune.zero.sounds', true)")
        time.sleep(0.3)
        # Casa: su propio modo (currar), y al volver al primero, el suyo (chill con sonidos).
        click(f'#zero-profile .zero-profile-bubble[data-space="{casa}"]')
        until(lambda: state()['space'] == casa)
        click('#zero-mode [data-mode="work"]')
        until(lambda: (s := state())['switchMode'] == 'work' and s['pomodoro'] is True and s['sounds'] is False)
        click(f'#zero-profile .zero-profile-bubble[data-space="{first}"]')
        until(lambda: (s := state())['space'] == first and s['switchMode'] == 'chill' and s['pomodoro'] is False and s['sounds'] is True)
        check('Dos botones, Currar (maletín) y Chill (luna), con el de ahora marcado; cada perfil guarda su modo')

        image = 'data:image/svg+xml,' + '%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 4 4%22%3E%3Crect width=%224%22 height=%224%22 fill=%22%23e8743b%22/%3E%3C/svg%3E'
        chrome("Services.prefs.setStringPref('kitsune.zero.profiles.images', JSON.stringify({ [arguments[0]]: arguments[1] }))", [first, image])
        until(lambda: state()['stack'][0]['img'] == image)
        check('Con una imagen puesta, la bolita la enseña')

        sessions = f"return {spaces}.sessions(arguments[0])"
        seg = "const s = document.querySelector('#zero-profiles .zero-profile-sessions'); return s && !s.hidden ? [...s.querySelectorAll('[data-sessions]')].map(b => [b.dataset.sessions, b.getAttribute('aria-checked') === 'true']) : null"
        contexts = "return [...gBrowser.tabs].filter(t => !t.hidden && !t.pinned && !t.closing).map(t => t.userContextId)"
        if chrome(f"return typeof {spaces}.setSessions") != 'function':
            click(f'#zero-profile .zero-profile-bubble[data-space="{first}"]')
            until(lambda: (e := state()['editor']) and e['space'] == first)
            assert chrome(seg) is None, 'la ficha enseña sesiones que este Kitsune no sabe hacer'
            driver.shortcut('\ue00c')
            print('SALTA las sesiones propias: este Kitsune aún no sabe hacerlas', flush=True)
        else:
            click(f'#zero-profile .zero-profile-bubble[data-space="{first}"]')
            until(lambda: (e := state()['editor']) and e['space'] == first and chrome(seg) == [['shared', True], ['own', False]])
            click('#zero-profiles [data-sessions="own"]')
            until(lambda: chrome(sessions, [first]) == 'own' and all(c > 0 for c in chrome(contexts)) and chrome(seg) == [['shared', False], ['own', True]])
            assert 'Google' in chrome("return document.querySelector('#zero-profiles .zero-profile-hint').textContent")
            click('#zero-profiles [data-sessions="shared"]')
            until(lambda: chrome(sessions, [first]) == 'shared' and all(c == 0 for c in chrome(contexts)))
            driver.shortcut('\ue00c')
            click('#zero-profile .zero-profile-add')
            until(lambda: (e := state()['editor']) and e['space'] == '' and chrome(seg) == [['shared', False], ['own', True]])
            type_into('#zero-profiles .zero-profile-name', 'Clase')
            click('#zero-profiles [data-action="create"]')
            until(lambda: (s := state())['editor'] is None and s['spaces'][-1]['name'] == 'Clase' and s['space'] == s['spaces'][-1]['id'])
            until(lambda: chrome(sessions, [state()['spaces'][-1]['id']]) == 'own' and all(c > 0 for c in chrome(contexts)))
            check('En la ficha, sus sesiones: compartidas o propias (sus pestañas pasan a ellas); uno nuevo, con las suyas')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
