"""Claro/Oscuro and the home background on Kitsune's real engine (temporary profile).

1. Oscuro reaches the open window without restarting: sumi palette, dark scheme in
   the chrome, in about:newtab and for websites that offer it, dark logo.
2. A background uploaded to the home server shows in about:newtab and on the home
   page (checked on screenshot pixels, so the image really loads).
3. Removing it and going back to Claro restores paper everywhere.
"""
import argparse
import base64
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import urllib.request

from PIL import Image

from browser_smoke import ROOT, WebDriver, prepare_profile, eventually

spec = importlib.util.spec_from_file_location('appearance', ROOT / 'install/appearance.py')
appearance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(appearance)
wall_spec = importlib.util.spec_from_file_location('native_test_wallpapers', ROOT / 'install/wallpapers.py')
wallpapers = importlib.util.module_from_spec(wall_spec)
wall_spec.loader.exec_module(wallpapers)
home_spec = importlib.util.spec_from_file_location('native_test_home', ROOT / 'install/home-server.py')
home = importlib.util.module_from_spec(home_spec)
home_spec.loader.exec_module(home)

RED = (200, 30, 40)
DARK_PAGE = ('data:text/html,<style>body{background:%23fff}@media (prefers-color-scheme: dark){body{background:%23000}}</style>'
             '<title>Esquema</title><h1>Web con modo oscuro</h1>')


def solid_png(color, size=(1600, 1000)):
    output = io.BytesIO()
    Image.new('RGB', size, color).save(output, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode()


def pixel(path, x, y):
    with Image.open(path) as image:
        return image.convert('RGB').getpixel((x, y))


def reddish(rgb):
    r, g, b = rgb
    return r > g + 40 and r > b + 40


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-theme-native-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    state = root / 'state'; state.mkdir()
    profiles = home.profiles_module.ProfileManager(root, state)
    profiles.snapshot()
    # Librería de fondos de serie mínima: un color, como la deja wallpapers.py.
    (root / 'wallpapers').mkdir()
    preset_id = '11111111-2222-4333-8444-555555555555'
    preset_sha, preset_jpeg, preset_thumb = wallpapers.solid('#1e5aff')
    (root / 'wallpapers' / f'{preset_id}.jpg').write_bytes(preset_jpeg)
    (root / 'wallpapers' / f'{preset_id}-thumb.jpg').write_bytes(preset_thumb)
    (root / 'wallpapers/index.json').write_text(json.dumps({'version': 1, 'categories': [{'id': 'solid-colors', 'name': 'Colores',
        'items': [{'id': preset_id, 'sha256': preset_sha, 'source': 'color:#1e5aff', 'color': '#1e5aff'}]}]}))
    # Perfil con «Apariencia de las webs: Claro» guardada de antes, como el de Risco.
    (profile / 'prefs.js').write_text('user_pref("layout.css.prefers-color-scheme.content-override", 1);\n')
    manager = appearance.AppearanceManager(root, state)
    server = home.create_server(profile / 'start', state / 'home.json', port=0, profiles=profiles, appearance=manager)
    worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
    origin = f'http://127.0.0.1:{server.server_port}'

    def api(path, method='GET', value=None):
        headers = {'Origin': origin}
        if value is not None:
            headers.update({'Content-Type': 'application/json', 'X-Kitsune-Token': server.token})
        request = urllib.request.Request(origin + path, method=method, headers=headers,
                                         data=None if value is None else json.dumps(value).encode())
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    def save_settings(**patch):
        snapshot = api('/api/settings')
        return api('/api/settings', 'PUT', {'revision': snapshot['revision'], 'data': {**snapshot['data'], **patch}})

    report = {'root': str(root), 'browser': str(args.browser), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, *script_args):
        driver.context('chrome'); return driver.script(script, script_args)

    def content(script):
        driver.context('content'); return driver.script(script)

    def applied(fingerprint=None):
        def ready():
            value = api('/api/appearance')
            return value['native']['status'] == 'applied' and (fingerprint is None or value['fingerprint'] == fingerprint)
        return eventually(ready, timeout=25)

    def chrome_state():
        return chrome("""const root=document.documentElement, style=getComputedStyle(root);
          return {bg:style.getPropertyValue('--kb-bg').trim(), scheme:style.colorScheme,
            dark:matchMedia('(prefers-color-scheme: dark)').matches,
            brand:getComputedStyle(document.querySelector('#TabsToolbar'),'::before').backgroundImage,
            prefs:Services.prefs.getIntPref('ui.systemUsesDarkTheme',-1)};""")

    def newtab_state():
        return content("""const style=getComputedStyle(document.body);
          return {dark:matchMedia('(prefers-color-scheme: dark)').matches, background:style.backgroundImage,
            logo:getComputedStyle(document.querySelector('.logo-and-wordmark .logo')).backgroundImage,
            bg:getComputedStyle(document.documentElement).getPropertyValue('--kb-bg').trim()};""")

    try:
        save_settings(motion=False)
        driver = WebDriver(profile, evidence, browser=args.browser)
        driver.navigate('about:newtab')
        applied()
        light = chrome_state()
        assert light['bg'] == appearance.PAPEL['bg'] and not light['dark'] and light['prefs'] == 0, light
        check('Claro de partida: papel y esquema claro')

        applied(save_settings(theme='oscuro')['appearance']['fingerprint'])
        dark = eventually(lambda: (s := chrome_state())['dark'] and s, timeout=10)
        assert dark['bg'] == appearance.SUMI['bg'] and dark['scheme'] == 'dark' and dark['prefs'] == 1, dark
        assert 'kitsune-dark.svg' in dark['brand'], dark
        driver.screenshot('oscuro-ventana.png', chrome=True)
        check('Oscuro llega a la ventana abierta sin reiniciar: sumi, esquema oscuro y logo en negativo')
        tab = eventually(lambda: (s := newtab_state())['dark'] and s, timeout=10)
        assert tab['bg'] == appearance.SUMI['bg'] and 'kitsune-dark.svg' in tab['logo'], tab
        driver.screenshot('oscuro-nueva-pestana.png')
        check('La nueva pestaña también se pone oscura (también con la protección anti-huella de Estricto)')
        driver.navigate(DARK_PAGE)
        assert eventually(lambda: content("return getComputedStyle(document.body).backgroundColor") == 'rgb(0, 0, 0)', timeout=10)
        assert not chrome("return Services.prefs.prefHasUserValue('layout.css.prefers-color-scheme.content-override')")
        check('Las webs que tienen modo oscuro lo reciben, aunque el perfil las tuviera fijadas en claro')

        uploaded = api('/api/background', 'POST', {'imageData': solid_png(RED)})
        digest = uploaded['data']['background']
        applied(uploaded['appearance']['fingerprint'])
        driver.navigate('about:newtab')
        tab = eventually(lambda: digest in (s := newtab_state())['background'] and s, timeout=10)
        driver.settle()
        shot = driver.screenshot('oscuro-fondo-nueva-pestana.png')
        assert reddish(pixel(shot, 40, 40)), pixel(shot, 40, 40)
        check('El fondo propio se ve en la nueva pestaña, bajo el velo')
        driver.navigate(origin + '/')
        eventually(lambda: content("return document.documentElement.dataset.background") == 'on', timeout=10)
        assert content("return document.documentElement.dataset.theme") == 'oscuro'
        driver.settle()
        shot = driver.screenshot('oscuro-fondo-inicio.png')
        assert reddish(pixel(shot, 40, 300)), pixel(shot, 40, 300)
        assert not content("return !!document.querySelector('.footer-note')")
        assert content("return document.querySelector('link[rel=icon]').getAttribute('href')") == 'favicon-dark.svg'
        check('El inicio sale oscuro, con el fondo propio, icono de pestaña en negativo y sin «Kitsune · Tinta» abajo a la izquierda')
        driver.click('#settings-open')
        eventually(lambda: content(f"return !!document.querySelector('.preset-tile[data-preset=\"{preset_id}\"]:not(:disabled)')"), timeout=10)
        driver.click(f'.preset-tile[data-preset="{preset_id}"]')
        eventually(lambda: preset_sha in content("return document.documentElement.style.getPropertyValue('--home-background')"), timeout=10)
        assert content(f"return document.querySelector('.preset-tile[data-preset=\"{preset_id}\"]').getAttribute('aria-pressed')") == 'true'
        driver.screenshot('oscuro-fondo-de-serie-ajustes.png')
        content("document.querySelector('[data-close=settings-dialog]').click()")
        driver.settle()
        shot = driver.screenshot('oscuro-fondo-de-serie.png')
        r, g, b = pixel(shot, 40, 300)
        assert b > r + 30 and b > g + 10, (r, g, b)
        check('Un fondo de serie se elige con un clic en «Tu inicio» y se ve al momento')

        removed = save_settings(background=None)
        applied(removed['appearance']['fingerprint'])
        assert not list((profile / 'chrome').glob('kitsune-background-*'))
        applied(save_settings(theme='claro')['appearance']['fingerprint'])
        back = eventually(lambda: (s := chrome_state())['bg'] == appearance.PAPEL['bg'] and s, timeout=10)
        assert not back['dark'] and back['prefs'] == 0 and 'kitsune-dark.svg' not in back['brand'], back
        driver.navigate('about:newtab')
        tab = eventually(lambda: not (s := newtab_state())['dark'] and s, timeout=10)
        assert tab['background'] == 'none' and tab['bg'] == appearance.PAPEL['bg'], tab
        driver.screenshot('claro-nueva-pestana.png')
        check('Quitar el fondo y volver a Claro deja todo en papel')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown(); server.server_close(); worker.join(timeout=3)
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
