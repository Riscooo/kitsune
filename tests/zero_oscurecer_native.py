"""Kitsune Zero · el modo oscuro de las webs, en el motor real (perfil temporal, sin ventana en pantalla).

Decisión de Risco (21-10): en Zero, «Estilo» es Claro u Oscuro; en Oscuro las webs van en su versión oscura y
las que solo son claras se oscurecen («el modo oscuro, vaya»), con el actor de Kitsune (kitsune-oscurecer-child).

1. En Oscuro, una web clara sin versión oscura se ve oscura, y su foto conserva su color.
2. Una web con su propio modo oscuro llega oscura y no se toca (no se invierte a clara).
3. En Claro, la web clara se ve clara.
4. «No oscurecer esta web», en el menú de la página, la deja como es; y «Oscurecer esta web» la vuelve a oscurecer.
5. Los documentos se leen (Risco, 9-11: «en los Word, en los PowerPoint… no se lee nada»): el texto pintado en un
   lienzo transparente (Google Docs) sale claro sobre oscuro; el texto encima de una imagen (el fondo de una
   diapositiva) se ve con sus colores, sobre la imagen; y un marco claro dentro de una web oscura se oscurece solo.

--oscurecer-del-repo: el actor que oscurece sale de install/native del repositorio (sin compilar el motor).

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


def white_png():
    buffer = io.BytesIO()
    Image.new('RGB', (64, 36), (252, 252, 250)).save(buffer, 'PNG')
    return base64.b64encode(buffer.getvalue()).decode()


PAGES = {
    # Clara y sin versión oscura: fondo blanco, texto negro y una foto roja.
    '/clara': f"""<!doctype html><meta charset="utf-8"><title>Clara</title>
<body style="margin:0;background:#fff;color:#111;font:16px sans-serif">
<p style="padding:20px">Una web clara, sin modo oscuro.</p>
<img id="foto" src="data:image/png;base64,{red_png()}" style="position:absolute;left:300px;top:200px;width:80px;height:80px">
</body>""",
    # Un editor que pinta el texto en un lienzo transparente, como Google Docs.
    '/lienzo': """<!doctype html><meta charset="utf-8"><title>Lienzo</title>
<body style="margin:0;background:#fff;color:#111;font:16px sans-serif">
<canvas class="kix-mosaico" width="640" height="360" style="position:absolute;left:100px;top:100px;width:640px;height:360px"></canvas>
<script>const c = document.querySelector('canvas').getContext('2d'); c.fillStyle = '#111'; c.font = 'bold 44px sans-serif';
for (let i = 0; i < 6; i++) c.fillText('Hola desde un lienzo', 20, 60 + i * 52);</script></body>""",
    # Una diapositiva: su fondo es una imagen blanca y el texto (negro) va encima.
    '/diapositiva': f"""<!doctype html><meta charset="utf-8"><title>Diapositiva</title>
<body style="margin:0;background:#fff;color:#111;font:16px sans-serif">
<div class="slide" style="position:absolute;left:100px;top:100px;width:640px;height:360px">
<img src="data:image/png;base64,{white_png()}" style="position:absolute;inset:0;width:100%;height:100%">
<div class="caja" style="position:absolute;left:40px;top:120px;font:bold 56px sans-serif;color:#111">Diapositiva legible</div>
</div></body>""",
    # Una web oscura con un marco claro dentro (como Word en la web, que va en un marco).
    '/marco': """<!doctype html><meta charset="utf-8"><title>Marco</title>
<body style="margin:0;background:#151515;color:#eee">
<iframe src="/clara" style="position:absolute;left:100px;top:100px;width:700px;height:500px;border:0"></iframe></body>""",
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
    parser.add_argument('--oscurecer-del-repo', action='store_true')
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
        if args.oscurecer_del_repo:
            zero_harness.darken_from_repo(chrome)
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

        def region(name, box):
            """Los tonos (luminancia 0–255) de una zona de la captura: el más oscuro, el más claro y el que más hay."""
            driver.context('content')
            img = Image.open(driver.screenshot(f'{next(shots):02d}-{name}.png')).convert('L')
            k = driver.script('return devicePixelRatio')
            crop = img.crop(tuple(int(v * k) for v in box))
            hist = crop.histogram()
            values = [v for v, n in enumerate(hist) if n]
            return {'min': values[0], 'max': values[-1], 'mode': max(range(256), key=lambda v: hist[v])}

        driver.navigate(origin + '/lienzo')
        # El fondo, oscuro, y en el lienzo letras claras: lo que más hay es oscuro y hay tinta clara de verdad.
        until(lambda: (z := region('lienzo', (110, 110, 730, 450)))['mode'] < 60 and z['max'] > 180,
              lambda: f'el texto del lienzo no se lee en oscuro: {region("lienzo-fallo", (110, 110, 730, 450))}', timeout=8)
        check('El texto pintado en un lienzo transparente (como Google Docs) sale claro sobre la página oscura')

        driver.navigate(origin + '/diapositiva')
        # La diapositiva conserva su papel blanco y su texto negro: los dos con el color con que se diseñaron.
        until(lambda: (z := region('diapositiva', (110, 110, 730, 450)))['mode'] > 200 and z['min'] < 70,
              lambda: f'el texto sobre la imagen de la diapositiva no se lee: {region("diapositiva-fallo", (110, 110, 730, 450))}', timeout=8)
        outside = region('diapositiva-fuera', (800, 40, 1000, 90))
        assert outside['mode'] < 60, f'la página alrededor de la diapositiva no se oscurece: {outside}'
        check('El texto encima de una imagen (el fondo de una diapositiva) se ve con sus colores, sobre la imagen')

        driver.navigate(origin + '/marco')
        until(lambda: region('marco', (600, 520, 790, 590))['mode'] < 60,
              lambda: f'el marco claro dentro de la web oscura sigue claro: {region("marco-fallo", (600, 520, 790, 590))}', timeout=8)
        check('Un marco claro dentro de una web oscura se oscurece él solo (Word y PowerPoint en la web van en uno)')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
