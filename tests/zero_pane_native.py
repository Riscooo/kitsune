"""Kitsune Zero · la lámina de vidrio alrededor de la ventana, en el motor real (perfil temporal, sin ventana en pantalla).

Decisión de Risco (15-10, maqueta «D»): Zero es una lámina de vidrio con el canto redondo (34 px, con una
entrada suave: el doblez empieza casi plano y se curva al final) que dobla lo que tiene detrás, alrededor de
toda la ventana, con brillos en el canto. Tiene que funcionar en Windows, macOS y cualquier Linux: la dibuja
Kitsune (WebGL), sobre el fondo que Kitsune conoce.

1. Al entrar en Zero, detrás de todo (la tarjeta y las piezas) hay una lámina que cubre la ventana; con la
   web ampliada no está, y al dejar de ampliar vuelve.
2. Con el fondo de la web (el de Windows, macOS y Linux sin compositor que ayude), el canto dobla esa foto:
   en la franja del canto cambia al quitarle la fuerza al vidrio (kitsune.zero.glass.strength = 0) y más
   adentro, no.
3. Quieta no se repinta (no cuesta nada mientras no cambie la web, el tamaño o el fondo).

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

# Rayas verticales de colores, anchas: la foto del marco las conserva y el doblez se ve.
PAGE = ('<!doctype html><meta charset=utf-8><title>Rayas</title><body style="margin:0;height:3000px;'
        'background:repeating-linear-gradient(90deg,#d23 0 64px,#2a3 64px 128px,#23d 128px 192px)">')


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(PAGE.encode())

    def log_message(self, *args):
        pass


PANE = """
const p = document.getElementById('zero-pane');
if (!p) return null;
const r = p.getBoundingClientRect(), cs = getComputedStyle(p);
const { ZeroPane } = ChromeUtils.importESModule('chrome://browser/content/zero/zero-pane.sys.mjs');
return { shown: !p.hidden && cs.display !== 'none' && Number(cs.opacity) > 0.9, box: [r.left, r.top, r.width, r.height],
         z: parseInt(cs.zIndex), W: innerWidth, H: innerHeight, draws: ZeroPane.draws(window),
         full: document.documentElement.hasAttribute('zero-full') };
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-pane-'))
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

    def pane():
        return chrome(PANE)

    def until(condition, timeout=6):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {pane()}') from None

    def covers(p):
        return p and p['shown'] and p['z'] < 0 and abs(p['box'][0]) <= 1 and abs(p['box'][1]) <= 1 \
            and abs(p['box'][2] - p['W']) <= 1 and abs(p['box'][3] - p['H']) <= 1

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        chrome("Services.prefs.setStringPref('kitsune.zero.backdrop', 'web')")
        driver.navigate(origin + '/rayas')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: covers(pane()))
        chrome("document.getElementById('kitsune-zero-full-key').doCommand()")
        until(lambda: (p := pane()) and p['full'] and not p['shown'])
        chrome("document.getElementById('kitsune-zero-full-key').doCommand()")
        until(lambda: (p := pane()) and not p['full'] and covers(p))
        check('Detrás de todo, una lámina que cubre la ventana; con la web ampliada no está')

        from PIL import Image
        def margin(name):
            """El margen izquierdo (entre el filo y la tarjeta), a una altura sin raíl ni botones."""
            time.sleep(0.8)
            img = Image.open(driver.screenshot(name, chrome=True)).convert('RGB')
            k = chrome("return devicePixelRatio"); y = int(chrome("return innerHeight") * 0.22 * k)
            return [img.getpixel((int(x * k), y)) for x in range(0, 48)]
        def apart(a, b):
            return sum(abs(p - q) for p, q in zip(a, b)) / 3
        chrome("Services.prefs.setIntPref('kitsune.zero.glass.strength', 100)")
        glass = margin('vidrio.png')
        chrome("Services.prefs.setIntPref('kitsune.zero.glass.strength', 0)")
        flat = margin('sin-vidrio.png')
        chrome("Services.prefs.clearUserPref('kitsune.zero.glass.strength')")
        edge = sum(apart(glass[x], flat[x]) for x in range(2, 28)) / 26
        inside = sum(apart(glass[x], flat[x]) for x in range(38, 46)) / 8
        assert edge >= 12 and inside <= 4, f'el canto no dobla la foto (o dobla también más adentro): canto {edge:.1f}, dentro {inside:.1f}'
        check('Con el fondo de la web, el canto dobla la foto del marco; más adentro, nada')

        time.sleep(1.0)  # lo que dejó pendiente el último cambio de ajuste
        before = pane()['draws']
        time.sleep(2.0)
        assert pane()['draws'] == before, f'se repinta sin cambiar nada: {before} → {pane()["draws"]}'
        check('Quieta no se repinta')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
