"""Kitsune Zero · el sonido, la pastilla de abajo de la columna, en el motor real (perfil temporal, sin ventana
en pantalla y sin sonido: la salida de Gecko va a volumen 0 y el audio es ruido a −60 dB).

Dani (15-10): «que te detecte si te estás escuchando algo y que puedas bajar el volumen ahí del propio
navegador, que no te abra una pestaña», y en esa pastilla nada de abrir pestañas.

1. La pastilla de abajo es la del sonido: el altavoz y nada más (ni «+» ni accesos que abran pestañas).
2. Con algo sonando en otra pestaña, el altavoz lo dice; al pulsarlo, el panel de sonido lo enseña.
3. El volumen de Kitsune multiplica el de lo que suena (y respeta el que pone la web): al 30 %, un audio a
   0,8 queda a 0,24; si la web lo pone a 0,5, a 0,15; al 100 %, a 0,5. Se guarda en kitsune.zero.volume.
4. Silenciar una pestaña desde el panel y «Silenciar todo» la silencian sin abrir ninguna; pausa y sigue.
5. Un clic en lo que suena lleva a su pestaña y cierra el panel; Esc también lo cierra.

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
PAGE = b'''<!doctype html><meta charset=utf-8><title>Radio zorro</title><audio id=a loop src="/cancion.wav"></audio>
<script>const a = document.getElementById('a'); a.volume = 0.8; a.play();</script>'''


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/cancion.wav'):
            self.send_response(200)
            self.send_header('Content-Type', 'audio/wav')
            self.end_headers()
            self.wfile.write(WAV)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(PAGE if self.path.startswith('/radio') else b'<!doctype html><meta charset=utf-8><title>Kioto</title><h1>Kioto</h1>')

    def log_message(self, *args):
        pass


STATE = """
const seen = el => !!el && !el.hidden && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0.5 && el.getBoundingClientRect().width > 0;
const pill = document.getElementById('zero-shortcuts'), button = pill?.querySelector('.zero-sound-button'), panel = document.getElementById('zero-sound');
const radio = gBrowser.tabs.find(t => t.label === 'Radio zorro');
return {
  button: seen(button), add: !!pill?.querySelector('.zero-shortcut-add, .zero-shortcut, [data-url]'), kids: pill ? pill.children.length : 0,
  playing: !!button?.hasAttribute('playing'), panel: !!panel?.hasAttribute('open') && seen(panel),
  rows: [...(panel?.querySelectorAll('.zero-sound-row b') ?? [])].map(b => b.textContent),
  muted: !!radio?.hasAttribute('muted'), paused: !(radio?.linkedBrowser.browsingContext.mediaController?.isPlaying ?? false),
  selected: gBrowser.selectedTab.label, tabs: gBrowser.tabs.length,
};
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-sonido-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    # Nada por los altavoces: la salida de Gecko a volumen 0 desde antes de arrancar.
    with (profile / 'user.js').open('a') as prefs:
        prefs.write('user_pref("media.volume_scale", "0.0");\nuser_pref("media.autoplay.default", 0);\n'
                    'user_pref("media.block-autoplay-until-in-foreground", false);\n')
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

    def pointer(actions):
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': actions}]})

    def click(selector):
        driver.context('chrome')
        target = driver.command('POST', '/element', {'using': 'css selector', 'value': selector})
        pointer([{'type': 'pointerMove', 'origin': target, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0}])

    def in_radio(script):
        """Algo en la web de la radio: Marionette va a su pestaña (la elige un momento) y vuelve a la de Kioto."""
        index = chrome("return gBrowser.tabs.findIndex(t => t.label === 'Radio zorro')")
        back = chrome("return gBrowser.tabs.findIndex(t => t.label === 'Kioto')")
        driver.context('content')  # (las manijas de las pestañas, en el contexto de la web)
        handles = driver.command('GET', '/window/handles')
        driver.command('POST', '/window', {'handle': handles[index]})
        driver.context('content')
        value = driver.script(script)
        driver.command('POST', '/window', {'handle': handles[back]})
        return value

    def volume():
        """El volumen del audio de la radio."""
        return round(in_radio("return document.getElementById('a').volume"), 3)

    def volume_is(expected):
        seen = []
        try:
            eventually(lambda: seen.append(volume()) or seen[-1] == expected, timeout=8)
        except AssertionError:
            raise AssertionError(f'volumen: se esperaba {expected} y era {seen[-3:]}') from None

    def set_volume(percent):
        chrome("""const s = document.querySelector('#zero-sound .zero-slider'); s.value = String(arguments[0]); s.dispatchEvent(new Event('input', { bubbles: true }));""", [percent])

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        assert chrome("return Services.prefs.getCharPref('media.volume_scale', '1.0')") == '0.0'
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/kioto')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: state()['button'])
        s = state()
        assert not s['add'] and s['kids'] == 1, s
        check('La pastilla de abajo es la del sonido: el altavoz y nada más (ni «+» ni accesos)')

        chrome("gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })", [origin + '/radio'])
        until(lambda: state()['playing'] and not state()['paused'], timeout=10)
        tabs = state()['tabs']
        click('#zero-shortcuts .zero-sound-button')
        until(lambda: (s := state())['panel'] and s['rows'] == ['Radio zorro'])
        assert state()['tabs'] == tabs, state()
        check('Con algo sonando en otra pestaña, el altavoz lo dice y el panel lo enseña (sin abrir pestañas)')

        set_volume(30)
        until(lambda: chrome("return Services.prefs.getStringPref('kitsune.zero.volume', '1')") == '0.3')
        volume_is(0.24)
        in_radio("document.getElementById('a').volume = 0.5")
        volume_is(0.15)
        set_volume(100)
        volume_is(0.5)
        check('El volumen de Kitsune multiplica el de lo que suena y respeta el de la web (0,24 · 0,15 · 0,5)')

        if not state()['panel']:
            click('#zero-shortcuts .zero-sound-button')
            until(lambda: state()['panel'])
        click('#zero-sound .zero-sound-mute')
        until(lambda: state()['muted'])
        click('#zero-sound .zero-sound-all')
        until(lambda: not state()['muted'])
        click('#zero-sound .zero-sound-all')
        until(lambda: state()['muted'])
        click('#zero-sound .zero-sound-all')
        until(lambda: not state()['muted'])
        click('#zero-sound .zero-sound-play')
        until(lambda: state()['paused'])
        click('#zero-sound .zero-sound-play')
        until(lambda: not state()['paused'])
        assert state()['tabs'] == tabs, state()
        check('Silenciar, «Silenciar todo», pausa y seguir, desde el panel y sin abrir pestañas')

        click('#zero-sound .zero-sound-name')
        until(lambda: (s := state())['selected'] == 'Radio zorro' and not s['panel'])
        chrome("gBrowser.selectedTab = gBrowser.tabs.find(t => t.label === 'Kioto')")
        click('#zero-shortcuts .zero-sound-button')
        until(lambda: state()['panel'])
        driver.context('chrome'); driver.shortcut('')
        until(lambda: not state()['panel'])
        check('Un clic en lo que suena lleva a su pestaña y cierra el panel; Esc también lo cierra')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
