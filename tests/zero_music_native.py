"""Kitsune Zero · la música (como en Opera), en el motor real (perfil temporal, sin ventana en pantalla).

Decisión de Risco (15-10): «integrar que puedas enlazar tu cuenta de Spotify o lo que sea, como hace Opera, y
que si lo minimizas puedas tener un mini panel de control flotante que puedas poner donde quieras, que
siempre se superponga a no ser que lo cierres, pero que no se corte el audio». Va en Windows, macOS y Linux:
el reproductor es la web del servicio (con tu cuenta), en un navegador propio dentro de Kitsune.

1. Un botón de música en su propia pastilla, aparte de la de los accesos directos (Risco, 15-10: «separa el
   botón de la música del de acceso directo»), justo encima y alineada con ella; la primera vez, al pulsarlo,
   sale la lista de servicios (Spotify, YouTube Music, Apple Music, SoundCloud, Deezer, Tidal).
2. Con un servicio elegido, el botón abre el panel de la música con su web, y suena.
3. Al minimizarlo, el panel se va, sale el minipanel flotante (con el título de lo que suena) y la música
   sigue; pausa y vuelve a sonar desde él.
4. El minipanel se arrastra a donde se quiera y se queda allí (también al volver a abrirlo).
5. Al cerrarlo se va, y la música sigue; «Abrir» vuelve a abrir el panel, con la misma música.
6. La web de Spotify no baja de 800 px (Risco, 19-10: con el panel de 380 px se cortaba y «así no se puede
   manejar»): el panel le da ese ancho; si no cabe en la ventana, la web se ve entera pero más pequeña.
7. El panel se estrecha o ensancha desde su borde y se queda así (doble clic: el de serie); la web sigue entera.

(En la prueba, el «servicio» es una página local con audio y su MediaSession; el de Spotify no llega a
cargar: todas las direcciones van a 127.0.0.1.)

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import http.server
import io
import json
from pathlib import Path
import random
import struct
import tempfile
import threading
import time
import wave

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness


def quiet_wav(seconds=8, rate=22050):
    """Ruido a −60 dBFS durante 8 s: Gecko lo da por «sonando» (sus controles de medios piden 3 s o más),
    pero no se oye (y además la salida va a volumen 0)."""
    out = io.BytesIO()
    with wave.open(out, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b''.join(struct.pack('<h', random.randint(-33, 33)) for _ in range(seconds * rate)))
    return out.getvalue()


TONE = quiet_wav()
PLAYER = ('<!doctype html><meta charset=utf-8><title>Radio Kitsune</title><body style="background:#123;color:#fff">'
          '<h1>Radio Kitsune</h1><audio id=a src="/tono.wav" loop autoplay></audio>'
          '<script>navigator.mediaSession.metadata = new MediaMetadata({ title: "Zorros de Kioto", artist: "Kitsune" });'
          'navigator.mediaSession.setActionHandler("nexttrack", () => { document.title = "siguiente"; });</script>')


# Como la de Spotify, una web que no baja de 800 px; dice en su título el ancho que ve.
WIDE = ('<!doctype html><meta charset=utf-8><title>0</title><body style="min-width:800px">'
        '<script>const say = () => document.title = Math.floor(innerWidth); say(); onresize = say;</script>')


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body, kind = ((TONE, 'audio/wav') if self.path == '/tono.wav' else
                      (WIDE.encode(), 'text/html; charset=utf-8') if self.path == '/ancho' else
                      (PLAYER.encode(), 'text/html; charset=utf-8'))
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


STATE = """
const seen = el => !!el && !el.hidden && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0.5 && el.getBoundingClientRect().width > 0;
const panel = document.getElementById('zero-music'), mini = document.getElementById('zero-mini');
const player = panel?.querySelector('browser');
let controller = null; try { controller = player?.browsingContext?.mediaController ?? null; } catch {}
const r = mini?.getBoundingClientRect();
return {
  button: (() => { const b = document.querySelector('#zero-dock > #zero-music-pill.zero-pill > .zero-music'), s = document.getElementById('zero-shortcuts');
    if (!b || !s || s.contains(b)) return false;
    const p = b.parentElement.getBoundingClientRect(), q = s.getBoundingClientRect();
    return Math.abs(p.left - q.left) < 1 && Math.abs(p.width - q.width) < 1 && p.bottom + 4 <= q.top; })(),
  services: [...document.querySelectorAll('#zero-music-services [data-service]')].filter(seen).map(b => b.dataset.service),
  panel: seen(panel), url: player?.currentURI?.spec ?? null,
  playing: !!controller?.isPlaying,
  mini: seen(mini), title: mini?.querySelector('.zero-mini-title')?.textContent.trim() ?? '',
  at: r ? [Math.round(r.left), Math.round(r.top)] : null,
};
"""

# El ancho del panel, el zoom de su web y el ancho que ve la web (lo dice en su título la de /ancho).
FIT = """
const panel = document.getElementById('zero-music'), player = panel?.querySelector('browser');
if (!panel || !player) return null;
const r = panel.getBoundingClientRect(), seen = Number(player.contentTitle);
let width = null; try { width = Services.prefs.getIntPref('kitsune.zero.music.width'); } catch {}
return { open: panel.hasAttribute('open'), url: player.currentURI?.spec ?? '', width: Math.round(r.width),
         zoom: Math.round(player.fullZoom * 1000) / 1000, web: Number.isFinite(seen) ? seen : 0,
         inside: r.left >= 0 && r.right <= innerWidth + 0.5, saved: width };
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-musica-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    with (profile / 'user.js').open('a') as prefs:
        # Nada por los altavoces: la salida de Gecko a volumen 0 desde antes de arrancar.
        prefs.write('user_pref("media.volume_scale", "0.0");\nuser_pref("media.autoplay.default", 0);\n'
                    'user_pref("media.autoplay.blocking_policy", 0);\nuser_pref("media.block-autoplay-until-in-foreground", false);\n'
                    # Nada sale a internet: Spotify es la página de la prueba (por http, sin HTTPS obligatorio).
                    'user_pref("network.dns.forceResolve", "127.0.0.1");\nuser_pref("dom.security.https_only_mode", false);\n'
                    'user_pref("dom.security.https_first", false);\nuser_pref("dom.security.https_first_schemeless", false);\n')
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

    def until(condition, timeout=10):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {state()}') from None

    def click(selector):
        driver.context('chrome')
        node = driver.command('POST', '/element', {'using': 'css selector', 'value': selector})
        driver.command('POST', f"/element/{list(node.values())[0]}/click", {})

    def music():
        # En la variante «Sobrio» (Dani), la música se abre desde el panel de sonido (el altavoz de la columna):
        # «Música → Abrir».
        click('#zero-dock .zero-sound-button')
        eventually(lambda: chrome("return document.getElementById('zero-sound')?.hasAttribute('open')"), timeout=5)
        click('#zero-sound .zero-sound-music-open')

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/inicio')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: state()['button'])
        click('#zero-music-pill .zero-music')
        until(lambda: {'spotify', 'youtube-music', 'apple-music', 'soundcloud', 'deezer', 'tidal'} <= set(state()['services']))
        click('#zero-music-pill .zero-music')  # otra vez: se cierra sin elegir
        until(lambda: not state()['services'])
        check('Un botón de música, en su pastilla (aparte de los accesos directos); la primera vez, la lista de servicios')

        # El «servicio» de la prueba: una web propia (también se puede poner una dirección).
        chrome("Services.prefs.setStringPref('kitsune.zero.music.service', arguments[0])", [origin + '/radio'])
        click('#zero-music-pill .zero-music')
        until(lambda: (s := state())['panel'] and s['url'] == origin + '/radio' and s['playing'], timeout=15)
        check('Con un servicio elegido, el botón abre el panel de la música con su web, y suena')

        click('#zero-music .zero-music-minimize')
        until(lambda: (s := state())['mini'] and not s['panel'] and s['playing'] and 'Zorros de Kioto' in s['title'])
        click('#zero-mini .zero-mini-play')
        until(lambda: not state()['playing'])
        click('#zero-mini .zero-mini-play')
        until(lambda: state()['playing'])
        check('Minimizado: el minipanel flotante con lo que suena, y la música sigue (y se pausa desde él)')

        before = state()['at']
        driver.context('chrome')
        grip = driver.command('POST', '/element', {'using': 'css selector', 'value': '#zero-mini .zero-mini-grip'})
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [
            {'type': 'pointerMove', 'origin': grip, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0}]
            + [{'type': 'pointerMove', 'origin': 'pointer', 'x': -30, 'y': -20, 'duration': 16} for _ in range(8)]
            + [{'type': 'pointerUp', 'button': 0}]}]})
        driver.command('DELETE', '/actions')
        until(lambda: (a := state()['at']) and abs(a[0] - (before[0] - 240)) <= 8 and abs(a[1] - (before[1] - 160)) <= 8)
        moved = state()['at']
        check('El minipanel se arrastra a donde se quiera')

        click('#zero-mini .zero-mini-close')
        until(lambda: (s := state())['mini'] is False and s['playing'])
        time.sleep(1)
        assert state()['playing'], state()
        click('#zero-music-pill .zero-music')
        until(lambda: (s := state())['panel'] and s['playing'] and s['url'] == origin + '/radio')
        click('#zero-music .zero-music-minimize')
        until(lambda: (s := state())['mini'] and s['at'] and abs(s['at'][0] - moved[0]) <= 2 and abs(s['at'][1] - moved[1]) <= 2)
        check('Al cerrarlo la música sigue, y el panel vuelve con la misma (y el minipanel, donde se dejó)')

        # También desde el panel de sonido (el altavoz, debajo de la nota): «Música», con lo que suena, y «Abrir»
        # (Risco, 15-10: «rediseñar lo de la música»). En las dos variantes, con la nota y los accesos a la vista.
        click('#zero-mini .zero-mini-close')
        chrome("Services.prefs.setStringPref('kitsune.zero.variant', 'sobrio')")
        until(lambda: chrome("""const shown = id => { const n = document.getElementById(id); return !!n && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width > 0; };
            return shown('zero-music-pill') && shown('zero-shortcuts') && !!document.querySelector('#zero-music-pill .zero-sound-button');"""))
        click('#zero-dock .zero-sound-button')
        eventually(lambda: chrome("return document.getElementById('zero-sound')?.hasAttribute('open')"), timeout=5)
        eventually(lambda: chrome("return document.querySelector('#zero-sound .zero-sound-music b')?.textContent.includes('Zorros de Kioto') && !document.querySelector('#zero-sound .zero-sound-music .zero-sound-play').hidden"), timeout=5)
        click('#zero-sound .zero-sound-music-open')
        until(lambda: (s := state())['panel'] and s['playing'] and s['url'] == origin + '/radio')
        chrome("Services.prefs.clearUserPref('kitsune.zero.variant')")
        check('El panel de sonido enseña lo que suena en la música y la abre (también en «Sobrio», con la nota y los accesos)')

        def fit():
            return chrome(FIT)

        def fit_until(condition, timeout=10):
            try:
                return eventually(condition, timeout=timeout)
            except AssertionError as error:
                raise AssertionError(f'{error} · {fit()}') from None

        click('#zero-music .zero-music-minimize')
        chrome("Services.prefs.setStringPref('kitsune.zero.music.service', 'spotify')")
        click('#zero-music-pill .zero-music')
        fit_until(lambda: (s := fit()) and s['open'] and 'open.spotify.com' in s['url'] and s['width'] >= 800
                  and s['zoom'] == 1 and s['inside'])
        # La de la prueba, en una dirección de Spotify (pide lo mismo que él): se mide lo que ve desde dentro.
        click('#zero-music .zero-music-minimize')
        chrome("Services.prefs.setStringPref('kitsune.zero.music.service', arguments[0])",
               [f'http://open.spotify.com:{server.server_port}/ancho'])
        click('#zero-music-pill .zero-music')
        fit_until(lambda: (s := fit()) and s['open'] and s['url'].endswith('/ancho') and s['width'] >= 800
                  and s['zoom'] == 1 and s['web'] >= 800 and s['inside'], timeout=15)
        check('Spotify (su web no baja de 800 px) tiene el ancho que necesita en el panel')

        driver.command('POST', '/window/rect', {'width': 760, 'height': 1000})
        fit_until(lambda: (s := fit()) and s['inside'] and s['width'] < 800 and s['zoom'] < 1 and s['web'] >= 799)
        driver.command('POST', '/window/rect', {'width': 1540, 'height': 1000})
        fit_until(lambda: (s := fit()) and s['width'] >= 800 and s['zoom'] == 1)
        check('Si no cabe en la ventana, la web de Spotify se ve entera pero más pequeña')

        def drag_edge(dx):
            driver.context('chrome')
            edge = driver.command('POST', '/element', {'using': 'css selector', 'value': '#zero-music .zero-music-edge'})
            driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [
                {'type': 'pointerMove', 'origin': edge, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0}]
                + [{'type': 'pointerMove', 'origin': 'pointer', 'x': dx // 10, 'y': 0, 'duration': 16} for _ in range(10)]
                + [{'type': 'pointerUp', 'button': 0}]}]})
            driver.command('DELETE', '/actions')

        wide = fit()['width']
        drag_edge(-300)
        fit_until(lambda: (s := fit()) and abs(s['width'] - (wide - 300)) <= 4 and s['saved'] == s['width']
                  and s['zoom'] < 1 and s['web'] >= 799)
        narrow = fit()
        click('#zero-music .zero-music-minimize')
        click('#zero-mini .zero-mini-open')
        fit_until(lambda: (s := fit()) and s['open'] and s['width'] == narrow['width'] and s['web'] >= 799)
        driver.context('chrome')
        edge = driver.command('POST', '/element', {'using': 'css selector', 'value': '#zero-music .zero-music-edge'})
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [
            {'type': 'pointerMove', 'origin': edge, 'x': 0, 'y': 0}]
            + [{'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0}] * 2}]})
        driver.command('DELETE', '/actions')
        fit_until(lambda: (s := fit()) and s['width'] == wide and s['saved'] is None and s['zoom'] == 1)
        check('El panel se estrecha desde su borde y se queda así, con la web entera (doble clic: el de serie)')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
