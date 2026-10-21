"""Kitsune Zero · el modo oscuro de las webs, en el motor real (perfil temporal, sin ventana en pantalla).

Decisión de Risco (21-10): en Zero, «Estilo» es Claro u Oscuro; en Oscuro las webs van en su versión oscura y
las que solo son claras se oscurecen («el modo oscuro, vaya»), con el actor de Kitsune (kitsune-oscurecer-child).

1. En Oscuro, una web clara sin versión oscura se ve oscura, y su foto conserva su color.
2. Una web con su propio modo oscuro llega oscura y no se toca (no se invierte a clara).
3. En Claro, la web clara se ve clara.
4. «No oscurecer esta web», en el menú de la página, la deja como es; y «Oscurecer esta web» la vuelve a oscurecer.

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py). El actor que oscurece es de
Kitsune: hace falta un motor compilado con él.
"""
import argparse
import base64
import http.server
import io
import json
from pathlib import Path
import tempfile
import threading
import time

from PIL import Image

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness


def red_png():
    buffer = io.BytesIO()
    Image.new('RGB', (80, 80), (220, 30, 30)).save(buffer, 'PNG')
    return base64.b64encode(buffer.getvalue()).decode()


PAGES = {
    # Clara y sin versión oscura: fondo blanco, texto negro y una foto roja.
    '/clara': f"""<!doctype html><meta charset="utf-8"><title>Clara</title>
<body style="margin:0;background:#fff;color:#111;font:16px sans-serif">
<p style="padding:20px">Una web clara, sin modo oscuro.</p>
<img id="foto" src="data:image/png;base64,{red_png()}" style="position:absolute;left:300px;top:200px;width:80px;height:80px">
</body>""",
    # Con su propio modo oscuro.
    '/oscura': """<!doctype html><meta charset="utf-8"><title>Oscura</title><meta name="color-scheme" content="light dark">
<style>body{margin:0;background:#fff;color:#111}@media (prefers-color-scheme: dark){body{background:#202020;color:#eee}}</style>
<body><p style="padding:20px">Una web con su modo oscuro.</p></body>""",
}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = PAGES.get(self.path, '<!doctype html><title>?</title>').encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-oscurecer-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    report = {'root': str(root), 'checks': []}
    driver = None
    shots = iter(range(1, 100))

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def page(name):
        """El fondo (lejos del texto) y el centro de la foto, en la captura de la web."""
        driver.context('content')
        img = Image.open(driver.screenshot(f'{next(shots):02d}-{name}.png')).convert('RGB')
        k = driver.script('return devicePixelRatio')
        background = img.getpixel((int(600 * k), int(400 * k)))
        photo = img.getpixel((int(340 * k), int(240 * k)))
        return {'background': sum(background) / 3, 'photo': photo}

    def until(condition, describe, timeout=8):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError:
            raise AssertionError(describe()) from None

    def mode(variant):
        chrome("Services.prefs.setStringPref('kitsune.zero.variant', arguments[0])", [variant])

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return document.documentElement.hasAttribute('zero')"), timeout=10)

        mode('sobrio')
        until(lambda: chrome("return Services.prefs.getBoolPref('kitsune.oscurecer.enabled', false)"),
              lambda: 'en Oscuro, Zero no enciende «Oscurecer las webs claras»')
        driver.navigate(origin + '/clara')
        until(lambda: (p := page('clara-oscuro'))['background'] < 60, lambda: f'en Oscuro, la web clara sigue clara: {page("clara-oscuro-fallo")}')
        photo = page('clara-oscuro-foto')['photo']
        assert photo[0] >= 140 and photo[1] <= 100 and photo[2] <= 100, f'la foto no conserva su rojo: {photo}'
        check('En Oscuro, una web clara se ve oscura y su foto conserva su color')

        driver.navigate(origin + '/oscura')
        time.sleep(1.6)  # el actor vuelve a mirar al poco de cargar
        own = page('oscura')['background']
        assert 20 <= own <= 50, f'la web con su modo oscuro no queda como ella lo pinta (#202020): {own}'
        check('Una web con su propio modo oscuro llega oscura y no se toca')

        mode('nacar')
        driver.navigate(origin + '/clara')
        until(lambda: page('clara-claro')['background'] > 200, lambda: f'en Claro, la web clara se oscurece: {page("clara-claro-fallo")}')
        check('En Claro, la web clara se ve clara')

        mode('sobrio')
        until(lambda: page('clara-oscuro-otra-vez')['background'] < 60, lambda: f'al volver a Oscuro, la web abierta no se oscurece: {page("vuelta-fallo")}')
        MENU = """const menu = document.getElementById('contentAreaContextMenu');
            if (!menu) return 'sin menú';
            menu.dispatchEvent(new Event('popupshowing'));
            const item = document.getElementById('kitsune-oscurecer-web');
            if (!item) return null;
            const label = item.getAttribute('label'), hidden = item.hidden;
            if (arguments[0]) item.doCommand();
            return { label, hidden };"""
        item = chrome(MENU, [True])
        assert item and not item['hidden'] and item['label'] == 'No oscurecer esta web', f'el menú de la página no ofrece dejarla como es: {item}'
        until(lambda: page('excepcion')['background'] > 200, lambda: f'«No oscurecer esta web» no la deja clara: {page("excepcion-fallo")}')
        item = chrome(MENU, [True])
        assert item['label'] == 'Oscurecer esta web', item
        until(lambda: page('sin-excepcion')['background'] < 60, lambda: f'«Oscurecer esta web» no la vuelve a oscurecer: {page("sin-excepcion-fallo")}')
        check('«No oscurecer esta web» la deja como es, y «Oscurecer esta web» la vuelve a oscurecer')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
