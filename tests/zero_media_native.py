"""Kitsune Zero · lo que suena en otra pestaña, en la isla, en el motor real (perfil temporal, sin
ventana en pantalla y sin sonido: la salida de Gecko va a volumen 0 y el audio es ruido a −60 dB).

En Zero no está la tarjeta de Kitsune «lo que suena» (vive en la barra de herramientas, que en Zero es
la isla): la isla hace de actividad en directo, como la música en la Dynamic Island.

1. Cuando suena algo en una pestaña que no estás viendo, la isla lo dice un momento («título · artista»).
2. Mientras suena, junto al dominio hay una onda pequeña; en la propia pestaña que suena, no.
3. Con la isla abierta, un botón pausa y sigue; el de siguiente sale solo si la web lo permite, y va.
4. Un clic en el aviso lleva a la pestaña que suena.
5. Si se cierra la pestaña que sonaba, la onda se va.

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
import wave

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness


def quiet_wav(seconds=8, rate=22050):
    """Ruido a −60 dBFS: Gecko lo da por «sonando», pero no se oiría (y además la salida va a 0)."""
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b''.join(struct.pack('<h', random.randint(-33, 33)) for _ in range(seconds * rate)))
    return buf.getvalue()


WAV = quiet_wav()
PAGE = '''<!doctype html><meta charset=utf-8><title>Radio zorro</title><audio id=a loop src="/cancion.wav"></audio>
<script>
navigator.mediaSession.metadata = new MediaMetadata({ title: 'Kitsune no yomeiri', artist: 'Lluvia con sol' });
// «Siguiente», como un reproductor de verdad: otra canción (y el título, para que la prueba lo vea).
if (location.search.includes('siguiente')) navigator.mediaSession.setActionHandler('nexttrack', () => {
  document.title = 'siguiente'; navigator.mediaSession.metadata = new MediaMetadata({ title: 'Inari no tsuki', artist: 'Lluvia con sol' }); });
</script>'''.encode()


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/cancion.wav'):
            self.send_response(200)
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Content-Length', str(len(WAV)))
            self.end_headers()
            self.wfile.write(WAV)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(PAGE if self.path.startswith('/radio') else b'<!doctype html><meta charset=utf-8><title>Kioto</title><h1>Kioto</h1>')

    def log_message(self, *args):
        pass


ISLAND = """
const now = document.querySelector('#zero-host .zero-now'); const toolbox = document.getElementById('navigator-toolbox');
const seen = el => !!el && el.getBoundingClientRect().width >= 6 && getComputedStyle(el).display !== 'none' && Number(getComputedStyle(el).opacity) > 0.5;
const msg = document.getElementById('zero-island-msg');
return { alert: toolbox.hasAttribute('zero-island-alert') ? msg.textContent.trim() : '', action: !!msg?.hasAttribute('action'),
         now: seen(now), playing: !!now?.hasAttribute('playing'),
         toggle: seen(document.querySelector('#zero-host .zero-now-toggle')), next: seen(document.querySelector('#zero-host .zero-now-next')),
         selected: gBrowser.selectedTab.label };
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-musica-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    # Nada por los altavoces: la salida de Gecko a volumen 0 desde antes de arrancar.
    with (profile / 'user.js').open('a') as prefs:
        prefs.write('user_pref("media.volume_scale", "0.0");\nuser_pref("media.autoplay.default", 0);\n')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def island():
        return chrome(ISLAND)

    def until(condition, timeout=8):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {island()}') from None

    def pointer(actions):
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': actions}]})

    def element(selector):
        driver.context('chrome')
        return driver.command('POST', '/element', {'using': 'css selector', 'value': selector})

    def click(selector):
        pointer([{'type': 'pointerMove', 'origin': element(selector), 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0}])

    def playing():
        return chrome("return gBrowser.tabs.find(t => t.label === 'Radio zorro' || t.label === 'siguiente')?.linkedBrowser.browsingContext.mediaController?.isPlaying ?? null")

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        assert chrome("return Services.prefs.getCharPref('media.volume_scale', '1.0')") == '0.0'
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/radio?siguiente')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !!document.getElementById('zero-host')"), timeout=5)
        driver.context('content')
        driver.script("document.getElementById('a').play()")
        until(lambda: playing() is True)
        assert not island()['now'], island()  # en la propia pestaña que suena, nada

        chrome("gBrowser.selectedTab = gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })", [origin + '/kioto'])
        until(lambda: 'Kitsune no yomeiri' in island()['alert'] and 'Lluvia con sol' in island()['alert'] and island()['action'])
        check('Cuando suena algo en otra pestaña, la isla lo dice un momento (título · artista)')

        until(lambda: (i := island())['now'] and i['playing'] and not i['alert'], timeout=10)
        check('Mientras suena, junto al dominio hay una onda pequeña')

        pointer([{'type': 'pointerMove', 'origin': element('#nav-bar'), 'x': 0, 'y': 0}])
        until(lambda: island()['toggle'] and island()['next'])
        click('#zero-host .zero-now-toggle')
        until(lambda: playing() is False and not island()['playing'])
        click('#zero-host .zero-now-toggle')
        until(lambda: playing() is True and island()['playing'])
        click('#zero-host .zero-now-next')
        until(lambda: chrome("return gBrowser.tabs.some(t => t.label === 'siguiente')"))
        check('Con la isla abierta, pausa y sigue, y «siguiente» va (si la web lo permite)')

        # Con la canción nueva, la isla lo vuelve a decir; un clic en el aviso lleva a la pestaña que suena.
        pointer([{'type': 'pointerMove', 'origin': 'viewport', 'x': 700, 'y': 600}])
        until(lambda: 'Inari no tsuki' in island()['alert'] and island()['action'])
        click('#zero-island-msg')
        until(lambda: island()['selected'] == 'siguiente')
        check('Un clic en el aviso lleva a la pestaña que suena')

        chrome("gBrowser.selectedTab = gBrowser.tabs.find(t => t.label === 'Kioto')")
        until(lambda: island()['now'])
        chrome("gBrowser.removeTab(gBrowser.tabs.find(t => t.label === 'siguiente'))")
        until(lambda: not island()['now'])
        check('Si se cierra la pestaña que sonaba, la onda se va')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
