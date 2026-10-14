"""Lo que suena, en el motor real (sin sonido: media.volume_scale = 0).

1. Una pestaña con música (con Media Session: título, artista, carátula y «siguiente»): mientras
   la ves, no hay tarjeta; al irte a otra, abajo en la barra lateral con su título y su carátula.
2. Pausa, seguir, siguiente y silenciar desde la tarjeta llegan a la web.
3. Desde otro espacio sigue a la vista, y un clic en el título te lleva a la pestaña (y a su
   espacio). Con las pestañas arriba, la tarjeta va compacta en la barra.
4. Al cerrar la pestaña, la tarjeta se va. Y en la paleta, «Pausar o seguir lo que suena».
5. Con Kitsune en inglés, en inglés.
"""
import argparse
import base64
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import math
from pathlib import Path
import struct
import tempfile
import threading
import time
import wave

from browser_smoke import WebDriver, prepare_profile, eventually

MEDIA = "ChromeUtils.importESModule('chrome://browser/content/kitsune-media.sys.mjs').KitsuneMedia"
SPACES = "ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs').KitsuneSpaces"
# Un cuadrado de óxido de 8×8 como carátula (data:, para no depender de la red).
COVER = 'data:image/png;base64,' + base64.b64encode(bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000080000000808020000004b6d29dc000000144944415478'
    '9c639ce365c0800d3061151db41200de780126b60d03070000000049454e44ae426082')).decode()
PAGE = f"""<!doctype html><meta charset=utf-8><title>Música de prueba</title>
<audio id=a src="tono.wav" loop></audio>
<script>
  window.nexts = 0;
  navigator.mediaSession.metadata = new MediaMetadata({{ title: 'Canción de prueba', artist: 'Kitsune',
    artwork: [{{ src: '{COVER}', sizes: '8x8', type: 'image/png' }}] }});
  navigator.mediaSession.setActionHandler('nexttrack', () => {{ window.nexts++; document.title = 'Siguiente ' + window.nexts; }});
  navigator.mediaSession.setActionHandler('previoustrack', () => {{}});
</script>"""
CARD = """const card = document.getElementById(arguments[0]);
  const box = card.getBoundingClientRect();
  return { hidden: card.hidden, shown: box.width > 0 && box.height > 0,
    title: card.querySelector('.kitsune-media-title').textContent, subtitle: card.querySelector('.kitsune-media-subtitle').textContent,
    art: card.querySelector('.kitsune-media-art').getAttribute('src') || '', loaded: card.querySelector('.kitsune-media-art').naturalWidth,
    note: getComputedStyle(card.querySelector('.kitsune-media-go'), '::before').content !== 'none', playing: card.hasAttribute('playing'), muted: card.hasAttribute('muted'),
    prev: !card.querySelector('.kitsune-media-prev').hidden, next: !card.querySelector('.kitsune-media-next').hidden,
    labels: [card, ...card.querySelectorAll('[aria-label]')].map(node => node.getAttribute('aria-label')),
    go: card.querySelector('.kitsune-media-go').title };"""


def tone(path, seconds=20, rate=8000):
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(b''.join(struct.pack('<h', int(9000 * math.sin(2 * math.pi * 440 * n / rate))) for n in range(seconds * rate)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-media-'))
    evidence = root / 'evidence'
    evidence.mkdir()
    pages = root / 'web'
    pages.mkdir()
    tone(pages / 'tono.wav')
    (pages / 'musica.html').write_text(PAGE)

    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(pages)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/musica.html'

    def session(name, english=False):
        (root / name).mkdir()
        profile, _ = prepare_profile(root / name)
        with (profile / 'user.js').open('a') as prefs:
            # Sin sonido de verdad y sin bloquear la reproducción automática de la prueba.
            prefs.write('user_pref("media.volume_scale", "0.0");\nuser_pref("media.autoplay.default", 0);\n'
                        'user_pref("media.autoplay.blocking_policy", 0);\n')
            if english:
                prefs.write('user_pref("intl.locale.requested", "en-US");\n')
        return WebDriver(profile, evidence, browser=args.browser)

    def chrome(driver, script, *values, asynchronous=False):
        driver.context('chrome')
        return driver.script(script, list(values), asynchronous)

    def card(driver, which='kitsune-media-side'):
        return chrome(driver, CARD, which)

    def play(driver):
        """La música suena en la primera pestaña (la de Marionette)."""
        driver.navigate(url)
        eventually(lambda: driver.script("return document.readyState === 'complete' && !!navigator.mediaSession.metadata"), timeout=15)
        driver.script("document.getElementById('a').play()")
        eventually(lambda: chrome(driver, f"return {MEDIA}.current(window)?.playing === true"), timeout=20)

    def elsewhere(driver):
        """Otra pestaña, la que pasas a ver."""
        chrome(driver, """const P = Services.scriptSecurityManager.getSystemPrincipal();
          gBrowser.selectedTab = gBrowser.addTab('about:blank', { triggeringPrincipal: P });""")

    def check(name):
        print('PASS ' + name, flush=True)

    driver = None
    try:
        driver = session('es')
        eventually(lambda: chrome(driver, "return !!document.getElementById('kitsune-media-side') && !!document.getElementById('kitsune-media-top')"), timeout=20)
        chrome(driver, "Services.prefs.setBoolPref('sidebar.revamp', true); Services.prefs.setBoolPref('sidebar.verticalTabs', true)")
        play(driver)
        time.sleep(0.5)
        assert card(driver)['hidden'], 'mientras ves la pestaña que suena, no hay tarjeta'
        elsewhere(driver)
        view = eventually(lambda: (value := card(driver))['shown'] and value['loaded'] and value, timeout=10)
        assert view['title'] == 'Canción de prueba' and view['subtitle'] == 'Kitsune' and view['playing'], view
        assert view['art'].startswith('data:image/png') and view['loaded'] == 8 and not view['note'], view
        assert view['prev'] and view['next'] and not view['muted'], view
        assert not card(driver, 'kitsune-media-top')['shown'], 'con las pestañas a un lado, la de arriba no se ve'
        time.sleep(0.5)
        driver.screenshot('a-un-lado.png', chrome=True)
        check('Al irte de la pestaña que suena, la tarjeta sale en la barra lateral con su título, su artista y su carátula')
        # Una carátula que no carga: ni marco roto ni hueco, la nota.
        driver.context('content')
        driver.script("navigator.mediaSession.metadata = new MediaMetadata({ title: 'Sin carátula', artwork: [{ src: 'data:image/png;base64,AAAA' }] })")
        broken = eventually(lambda: (value := card(driver))['title'] == 'Sin carátula' and value, timeout=10)
        time.sleep(0.5)
        broken = card(driver)
        assert not broken['loaded'] and broken['note'] and broken['subtitle'] == '127.0.0.1', broken
        driver.context('content')
        driver.script(f"navigator.mediaSession.metadata = new MediaMetadata({{ title: 'Canción de prueba', artist: 'Kitsune', artwork: [{{ src: '{COVER}' }}] }})")
        eventually(lambda: card(driver)['loaded'], timeout=10)
        check('Si la carátula no carga, sale una nota (no un marco roto) y abajo la web')

        press = "document.querySelector('#' + arguments[0] + ' .kitsune-media-' + arguments[1]).click()"
        chrome(driver, press, 'kitsune-media-side', 'playpause')
        eventually(lambda: not card(driver)['playing'], timeout=10)
        assert chrome(driver, f"return {MEDIA}.current(window)?.playing") is False
        chrome(driver, press, 'kitsune-media-side', 'playpause')
        eventually(lambda: card(driver)['playing'], timeout=10)
        chrome(driver, press, 'kitsune-media-side', 'next')
        eventually(lambda: chrome(driver, "return gBrowser.tabs[0].label") == 'Siguiente 1', timeout=10)
        chrome(driver, press, 'kitsune-media-side', 'mute')
        eventually(lambda: card(driver)['muted'] and chrome(driver, "return gBrowser.tabs[0].hasAttribute('muted')"), timeout=10)
        chrome(driver, press, 'kitsune-media-side', 'mute')
        eventually(lambda: not card(driver)['muted'], timeout=10)
        check('Pausa, seguir, siguiente y silenciar desde la tarjeta llegan a la web')

        moved = chrome(driver, f"""const done = arguments[0]; (async () => {{
            const S = {SPACES}; const home = S.list().active ?? S.list().spaces[0].id;
            const id = await S.create({{ name: 'Trabajo', color: 'blue', user: null }});
            await S.switchTo(window, id);
            return {{ home, id }};
          }})().then(done, e => done(String(e)));""", asynchronous=True)
        assert isinstance(moved, dict), moved
        eventually(lambda: card(driver)['shown'], timeout=10)
        chrome(driver, press, 'kitsune-media-side', 'go')
        eventually(lambda: chrome(driver, "return gBrowser.selectedBrowser.currentURI.spec") == url, timeout=10)
        eventually(lambda: card(driver)['hidden'], timeout=10)
        visible = chrome(driver, "return !gBrowser.selectedTab.hidden")
        assert visible, 'la pestaña que suena se ve: Kitsune ha vuelto a su espacio'
        check('Desde otro espacio la tarjeta sigue a la vista y su título te lleva a la pestaña y a su espacio')

        chrome(driver, "Services.prefs.setBoolPref('sidebar.verticalTabs', false); Services.prefs.clearUserPref('sidebar.revamp')")
        chrome(driver, "gBrowser.selectedTab = gBrowser.tabs.find(tab => !tab.hidden && tab !== gBrowser.selectedTab)")
        top = eventually(lambda: (value := card(driver, 'kitsune-media-top'))['shown'] and value, timeout=10)
        assert top['title'] == 'Canción de prueba' and not card(driver)['shown'], top
        height = chrome(driver, "return Math.round(document.getElementById('kitsune-media-top').getBoundingClientRect().height)")
        bar = chrome(driver, "return Math.round(document.getElementById('nav-bar').getBoundingClientRect().height)")
        assert height <= bar, (height, bar)
        time.sleep(0.5)
        driver.screenshot('arriba.png', chrome=True)
        check(f'Con las pestañas arriba, la tarjeta va compacta en la barra ({height} px de {bar})')

        # En la paleta, «pausar suena»: la primera es pausar o seguir.
        label = chrome(driver, """const P = ChromeUtils.importESModule('chrome://browser/content/kitsune-palette.sys.mjs');
          const item = P.rank('pausar suena', P.localResults(window, 'pausar suena'))[0]; item?.run(); return item?.label""")
        assert label == 'Pausar o seguir lo que suena', label
        eventually(lambda: not card(driver, 'kitsune-media-top')['playing'], timeout=10)
        chrome(driver, "gBrowser.removeTab(gBrowser.tabs.find(tab => tab.linkedBrowser.currentURI.spec === arguments[0]))", url)
        eventually(lambda: card(driver, 'kitsune-media-top')['hidden'] and chrome(driver, f"return {MEDIA}.current(window)") is None, timeout=10)
        check('La paleta pausa lo que suena, y al cerrar la pestaña la tarjeta se va')
        driver.close(); driver = None

        driver = session('en', english=True)
        eventually(lambda: chrome(driver, "return !!document.getElementById('kitsune-media-side')"), timeout=20)
        chrome(driver, "Services.prefs.setBoolPref('sidebar.revamp', true); Services.prefs.setBoolPref('sidebar.verticalTabs', true)")
        play(driver)
        elsewhere(driver)
        view = eventually(lambda: (value := card(driver))['shown'] and value, timeout=10)
        assert {'Now playing', 'Previous', 'Pause', 'Next', 'Mute'} <= set(view['labels']) and 'Go to the tab' in view['go'], view
        check('Con Kitsune en inglés, la tarjeta habla inglés')
    finally:
        if driver:
            driver.close()
        server.shutdown()
        print(evidence, flush=True)


if __name__ == '__main__':
    main()
