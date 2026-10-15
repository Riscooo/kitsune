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

(En la prueba, el «servicio» es una página local con audio y su MediaSession.)

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


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body, kind = (TONE, 'audio/wav') if self.path == '/tono.wav' else (PLAYER.encode(), 'text/html; charset=utf-8')
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
                    'user_pref("media.autoplay.blocking_policy", 0);\nuser_pref("media.block-autoplay-until-in-foreground", false);\n')
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
        click('#zero-sound-pill .zero-sound-button')
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

        # En «Sobrio» (Dani, 15-10) no está la pastilla de la música (ni los accesos directos): se abre desde el
        # panel de sonido, «Música → Abrir», con la misma música.
        click('#zero-mini .zero-mini-close')
        chrome("Services.prefs.setStringPref('kitsune.zero.variant', 'sobrio')")
        until(lambda: chrome("""const shown = id => { const n = document.getElementById(id); return !!n && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width > 0; };
            return !shown('zero-music-pill') && !shown('zero-shortcuts') && shown('zero-sound-pill');"""))
        music()
        until(lambda: (s := state())['panel'] and s['playing'] and s['url'] == origin + '/radio')
        chrome("Services.prefs.clearUserPref('kitsune.zero.variant')")
        check('En «Sobrio», la música se abre desde el panel de sonido, con la misma música')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
