"""Kitsune Zero · la lámina de vidrio alrededor de la ventana, en el motor real (perfil temporal, sin ventana en pantalla).

Decisión de Risco (15-10): el borde de Zero, alrededor de toda la ventana, como una pompa de jabón («rollo
burbuja, la clave de Opera Air y de Liquid Glass»): una película irisada en el filo, que brilla más de lado y
se funde hacia dentro, con reflejos suaves; el centro, limpio. Tiene que funcionar en Windows, macOS y
cualquier Linux: la dibuja Kitsune (WebGL), y no necesita ver lo de detrás.

1. Al entrar en Zero, detrás de todo (la tarjeta y las piezas) hay una lámina que cubre la ventana; con la
   web ampliada no está, y al dejar de ampliar vuelve.
2. Su filo es una película de pompa, sobre lo que haya detrás (un gris oscuro liso, solo para la foto): con
   algo de color (irisada, no una raya blanca) pero contenida, como una pompa de verdad («menos notorio…
   no luces de feria», Risco 15-10), que se funde hacia dentro sin volver a subir; más adentro, nada (sin
   velo). Con kitsune.zero.glass.strength = 0 no hay nada. Igual con el fondo de la web.
3. Quieta no se repinta (no cuesta nada mientras no cambie el tamaño o la fuerza).

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import http.server
import json
from pathlib import Path
import tempfile
import threading
import time
import urllib.parse

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
        GREY = 42
        dark = 'data:text/css,' + urllib.parse.quote(f':root {{ background: rgb({GREY}, {GREY}, {GREY}) !important; }}')
        def edge(name):
            """El filo izquierdo, a una altura sin raíl ni botones: [(r, g, b)] de x = 0 a 47."""
            time.sleep(0.8)
            img = Image.open(driver.screenshot(name, chrome=True)).convert('RGB')
            k = chrome("return devicePixelRatio"); y = int(chrome("return innerHeight") * 0.22 * k)
            return [img.getpixel((int(x * k), y)) for x in range(0, 48)]
        chrome("window.windowUtils.loadSheetUsingURIString(arguments[0], window.windowUtils.AGENT_SHEET)", [dark])
        try:
            for mode in ('system', 'web'):
                chrome("Services.prefs.setStringPref('kitsune.zero.backdrop', arguments[0])", [mode])
                time.sleep(1.8)  # el marco cambia de fondo con su fundido (el tinte, 1,4 s)
                chrome("Services.prefs.setIntPref('kitsune.zero.glass.strength', 0)")
                off = edge(f'sin-pompa-{mode}.png')
                chrome("Services.prefs.clearUserPref('kitsune.zero.glass.strength')")
                rim = edge(f'pompa-{mode}.png')
                light = [sum(c) / 3 for c in rim]
                # El color que añade la pompa (lo de detrás puede traer el suyo, como la foto de la web).
                chroma = max(max(d) - min(d) for d in ([a - b for a, b in zip(r, o)] for r, o in zip(rim[0:6], off[0:6])))
                rise = max(light[i + 1] - light[i] for i in range(2, 40))
                lift = light[1] - sum(off[1]) / 3
                clean = all(abs(a - b) <= 3 for a, b in zip(rim[40], off[40]))
                assert 10 <= chroma <= 36 and 5 <= lift <= 20 and rise <= 3 and clean, \
                    f'{mode}: el filo no es una película de pompa (color {chroma}, sube la luz {lift:.0f}, rebota {rise}, dentro {rim[40]} / sin {off[40]})'
        finally:
            chrome("Services.prefs.clearUserPref('kitsune.zero.glass.strength')")
            chrome("Services.prefs.setStringPref('kitsune.zero.backdrop', 'system')")
            chrome("window.windowUtils.removeSheetUsingURIString(arguments[0], window.windowUtils.AGENT_SHEET)", [dark])
        check('El filo es una película de pompa: irisada, se funde hacia dentro y el centro queda limpio')

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
