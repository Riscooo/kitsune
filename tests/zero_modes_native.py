"""Kitsune Zero · los modos (usuarios y «currar» o «chill»), en el motor real (perfil temporal, sin ventana en pantalla).

Decisión de Risco (15-10): arriba del raíl, los usuarios de Kitsune como bolitas, con la imagen que cada uno
quiera; al pulsar el tuyo eliges «Currar» o «Chill» para ese día, y cada modo guarda su configuración
(pomodoro y sus tiempos, silencio y webs vetadas, sonidos). Cambiar de usuario o de modo lo aplica todo de una
vez. Tiene que ir en Windows, macOS y Linux: los usuarios de Kitsune son contenedores de Gecko (y el base).

1. Arriba del raíl hay una bolita por usuario (el base y cada contenedor), con su inicial y su color, y la
   del usuario de la pestaña elegida, marcada.
2. Al pulsar la tuya sale el selector («Currar», «Chill», «Imagen»); «Currar» enciende el pomodoro y el
   silencio (lo de currar de serie) y la bolita lo dice; «Chill» los apaga.
3. Lo que se cambia estando en un modo se queda en ese modo: con los sonidos encendidos en «Chill», al pasar
   a «Currar» y volver a «Chill» siguen encendidos.
4. Pulsar la bolita de otro usuario cambia la pestaña a ese usuario (su contenedor), la marca pasa a su
   bolita y se aplica su propio modo (cada usuario tiene los suyos).
5. Con una imagen puesta, la bolita la enseña (en vez de la inicial).

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
        self.wfile.write(b'<!doctype html><meta charset=utf-8><title>Kioto</title><h1>Kioto</h1>')

    def log_message(self, *args):
        pass


MODES = """
const box = document.getElementById('zero-modes');
const users = box ? [...box.querySelectorAll('.zero-user')].map(b => ({ id: b.dataset.user, active: b.hasAttribute('active'), mode: b.dataset.mode ?? null,
  letter: b.querySelector('.zero-fav')?.textContent.trim() ?? '', img: b.querySelector('.zero-fav img')?.getAttribute('src') ?? null,
  color: [...b.classList].find(c => c.startsWith('identity-color-')) ?? null })) : null;
const pick = document.getElementById('zero-mode-pick');
const pref = name => { try { return Services.prefs.getBoolPref('kitsune.zero.' + name); } catch { return null; } };
return { first: box ? box.parentElement?.firstElementChild === box && box.parentElement.id === 'zero-rail' : false, users,
         pick: pick && pick.hasAttribute('open') ? [...pick.querySelectorAll('button')].map(b => b.dataset.mode ?? b.dataset.action) : null,
         pomodoro: pref('pomodoro'), silence: pref('silence'), sounds: pref('sounds'),
         context: gBrowser.selectedTab.userContextId };
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-modes-'))
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

    def modes():
        return chrome(MODES)

    def until(condition, timeout=6):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {modes()}') from None

    def click(selector):
        driver.context('chrome')
        node = driver.command('POST', '/element', {'using': 'css selector', 'value': selector})
        driver.command('POST', f"/element/{list(node.values())[0]}/click", {})

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        # Un segundo usuario: en Kitsune, un contenedor de Gecko.
        casa = chrome("""const { ContextualIdentityService: s } = ChromeUtils.importESModule('moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs');
            return s.create('Casa', 'fingerprint', 'pink').userContextId;""")
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: (m := modes())['users'] and len(m['users']) >= 2)
        m = modes()
        ids = [u['id'] for u in m['users']]
        assert m['first'] and 'base' in ids and str(casa) in ids, m
        home = next(u for u in m['users'] if u['id'] == 'base')
        other = next(u for u in m['users'] if u['id'] == str(casa))
        assert home['active'] and not other['active'] and other['letter'] == 'C' and other['color'] == 'identity-color-pink', m
        check('Arriba del raíl, una bolita por usuario, con su inicial y su color; la del usuario de la pestaña, marcada')

        click('#zero-modes .zero-user[active]')
        until(lambda: (p := modes()['pick']) and 'work' in p and 'chill' in p and 'image' in p)
        click('#zero-mode-pick [data-mode="work"]')
        until(lambda: (m := modes())['pomodoro'] is True and m['silence'] is True and m['pick'] is None
              and next(u for u in m['users'] if u['active'])['mode'] == 'work')
        click('#zero-modes .zero-user[active]')
        until(lambda: modes()['pick'])
        click('#zero-mode-pick [data-mode="chill"]')
        until(lambda: (m := modes())['pomodoro'] is False and m['silence'] is False and next(u for u in m['users'] if u['active'])['mode'] == 'chill')
        check('Al pulsar tu bolita eliges «Currar» o «Chill», y cada uno pone lo suyo')

        chrome("Services.prefs.setBoolPref('kitsune.zero.sounds', true)")
        time.sleep(0.3)
        for mode in ('work', 'chill'):
            click('#zero-modes .zero-user[active]')
            until(lambda: modes()['pick'])
            click(f'#zero-mode-pick [data-mode="{mode}"]')
            until(lambda: next(u for u in modes()['users'] if u['active'])['mode'] == mode)
        until(lambda: modes()['sounds'] is True)
        check('Lo que se cambia en un modo se queda en ese modo')

        click(f'#zero-modes .zero-user[data-user="{casa}"]')
        until(lambda: (m := modes())['context'] == casa and next(u for u in m['users'] if u['active'])['id'] == str(casa))
        # Casa no ha elegido nada aún: ni lo de currar ni lo de chill de base; su modo, el suyo.
        click('#zero-modes .zero-user[active]')
        until(lambda: modes()['pick'])
        click('#zero-mode-pick [data-mode="work"]')
        until(lambda: (m := modes())['pomodoro'] is True and m['sounds'] is False)
        click('#zero-modes .zero-user[data-user="base"]')
        until(lambda: (m := modes())['context'] == 0 and m['pomodoro'] is False and m['sounds'] is True)
        check('La bolita de otro usuario cambia la pestaña a él y aplica sus propios modos')

        image = 'data:image/svg+xml,' + '%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 4 4%22%3E%3Crect width=%224%22 height=%224%22 fill=%22%23e8743b%22/%3E%3C/svg%3E'
        chrome("Services.prefs.setStringPref('kitsune.zero.users.images', JSON.stringify({ [arguments[0]]: arguments[1] }))", [str(casa), image])
        until(lambda: next(u for u in modes()['users'] if u['id'] == str(casa))['img'] == image)
        check('Con una imagen puesta, la bolita la enseña')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
