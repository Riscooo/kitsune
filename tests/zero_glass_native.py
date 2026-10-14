"""Kitsune Zero · el cristal en vivo sobre la web, en el motor real (perfil temporal, sin ventana en pantalla).

El desenfoque de CSS no ve la web (la pinta otro proceso): cada pieza de cristal que queda encima de
la web lleva detrás un <canvas> con una foto desenfocada de lo que tiene debajo, y su texto pasa a
tinta sobre lo claro y a blanco sobre lo oscuro.

1. Con la web ampliada y una página negra arriba, el cristal de la isla está en su sitio y es oscuro.
2. Tras bajar con la rueda hasta lo blanco, el cristal es claro y la isla pasa a tinta (zero-ink).
3. Sin moverse nada durante 1 s, no se repinta.
4. Con la web en tarjeta, la isla está sobre el marco y no lleva cristal en vivo.
5. Al cerrar una ventana en Zero, su cristal se suelta (no se queda nada de ella).
6. Con el raíl abriéndose encima de la web, su cristal va pegado a él en cada fotograma.
7. Mover el ratón sin cristal encima de la web no hace ninguna foto.
8. Cada foto es solo del trozo que hay debajo de las piezas (menos de un cuarto de la vista).
9. Un salto de scroll más allá del margen de la foto no deja el cristal vacío ni un fotograma.
10. Las sugerencias al escribir llevan su cristal debajo (sin él se leía la web a través), pegado a ellas
    también cuando crecen.

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

PAGE = ('<!doctype html><meta charset=utf-8><title>Noche y día</title>'
        '<body style="margin:0"><div style="height:1600px;background:#000"></div><div style="height:4000px;background:#fff"></div>')


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(PAGE.encode())

    def log_message(self, *args):
        pass


GLASS = """
const box = el => { const r = el?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null; };
const canvas = document.getElementById('zero-glass-nav-bar');
let light = null;
if (canvas && !canvas.hidden && canvas.width && canvas.height) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { sum += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
  light = n ? sum / n / 255 : null;
}
const { GlassPane } = ChromeUtils.importESModule('chrome://browser/content/zero/zero-glass.sys.mjs');
return { canvas: canvas ? { shown: !canvas.hidden, box: box(canvas) } : null, island: box(document.getElementById('nav-bar')),
         light, ink: document.getElementById('nav-bar').hasAttribute('zero-ink'), repaints: GlassPane.repaints(window),
         full: document.documentElement.hasAttribute('zero-full') };
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-glass-'))
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

    def glass():
        return chrome(GLASS)

    def until(condition, timeout=5):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {glass()}') from None

    def browser():
        driver.context('chrome')
        return driver.command('POST', '/element', {'using': 'css selector', 'value': '#tabbrowser-tabpanels browser[type="content"][primary="true"]'})

    def wheel(dy):
        # Como una rueda de verdad: pasa por la ventana de Gecko antes de llegar a la web.
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'wheel', 'id': 'rueda', 'actions': [
            {'type': 'scroll', 'origin': browser(), 'x': 0, 'y': 0, 'deltaX': 0, 'deltaY': dy}]}]})

    def placed(g):
        c, i = g['canvas'], g['island']
        return c and c['shown'] and all(abs(c['box'][k] - i[k]) <= 1 for k in 'xywh')

    def pointer(actions):
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': actions}]})

    glass_api = "ChromeUtils.importESModule('chrome://browser/content/zero/zero-glass.sys.mjs').GlassPane"

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/noche')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: glass()['canvas'] is not None)
        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        until(lambda: (g := glass())['full'] and placed(g) and g['light'] is not None and g['light'] < 0.25 and not g['ink'])
        check('Con la web ampliada y la página negra arriba, el cristal de la isla está en su sitio y es oscuro')

        wheel(2400)
        until(lambda: (g := glass())['light'] is not None and g['light'] > 0.75 and g['ink'], timeout=8)
        check('Tras bajar con la rueda hasta lo blanco, el cristal es claro y la isla pasa a tinta')

        # El paso a tinta lanza transiciones (420 ms) que también cuentan como movimiento; luego, la
        # cola de 1,5 s. Pasado eso, en un segundo quieto no se repinta nada.
        time.sleep(3)
        before = glass()['repaints']
        time.sleep(1)
        after = glass()['repaints']
        assert after == before, (before, after)
        check('Sin moverse nada durante 1 s, no se repinta')

        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        until(lambda: not glass()['full'] and (glass()['canvas'] is None or not glass()['canvas']['shown']) and not glass()['ink'])
        check('Con la web en tarjeta, la isla está sobre el marco y no lleva cristal en vivo')

        panes = "return ChromeUtils.importESModule('chrome://browser/content/zero/zero-glass.sys.mjs').GlassPane.count()"
        alone = chrome(panes)
        chrome("window.__otra = OpenBrowserWindow();")
        eventually(lambda: chrome("return !!window.__otra.document.getElementById('kitsune-zero-key') && window.__otra.gBrowserInit?.delayedStartupFinished"), timeout=15)
        chrome("const d = window.__otra.document; if (!d.documentElement.hasAttribute('zero')) d.getElementById('kitsune-zero-key').doCommand();")  # desde Zero ya nace en Zero
        eventually(lambda: chrome(panes) > alone, timeout=5)
        chrome("window.__otra.close(); delete window.__otra;")
        try:
            eventually(lambda: chrome(panes) == alone, timeout=5)
        except AssertionError:
            raise AssertionError(f'quedan {chrome(panes)} piezas; antes {alone}') from None
        check('Al cerrar una ventana en Zero, su cristal se suelta')

        # 6. El raíl se abre (con la web en tarjeta, queda encima de ella): se graba cada fotograma.
        pointer([{'type': 'pointerMove', 'origin': 'viewport', 'x': 760, 'y': 500}])
        time.sleep(2)
        driver.context('chrome')
        rail = driver.command('POST', '/element', {'using': 'css selector', 'value': '#zero-rail'})
        record = """const done = arguments[arguments.length - 1]; const frames = []; const t0 = performance.now();
            const step = () => {
              const r = document.getElementById('zero-rail').getBoundingClientRect(); const c = document.getElementById('zero-glass-zero-rail');
              const g = c && !c.hidden ? c.getBoundingClientRect() : null;
              frames.push({ w: r.width, x: r.left, y: r.top, h: r.height, g: g && { w: g.width, x: g.left, y: g.top, h: g.height } });
              if (performance.now() - t0 < 900) requestAnimationFrame(step); else done(frames); };
            requestAnimationFrame(step);"""
        # Marionette atiende una orden cada vez: primero el ratón y, enseguida, la grabación (el raíl tarda
        # 620 ms en abrirse, así que se graba casi toda la apertura).
        pointer([{'type': 'pointerMove', 'origin': rail, 'x': 0, 'y': 0}])
        frames = driver.script(record, [], asynchronous=True)
        over = [f for f in frames if f['x'] + f['w'] > 52]       # ya encima de la web
        shown = [f for f in over if f['g']]
        off = [f for f in shown if any(abs(f['g'][k] - f[k]) > 1 for k in ('w', 'x', 'y', 'h'))]
        assert len(over) >= 10 and len(shown) >= len(over) - 2 and not off, (len(frames), len(over), len(shown), off[:3])
        check('Con el raíl abriéndose encima de la web, su cristal va pegado a él en cada fotograma')
        pointer([{'type': 'pointerMove', 'origin': 'viewport', 'x': 760, 'y': 500}])
        time.sleep(2)

        before = chrome(f"return {glass_api}.snapshots(window)")
        pointer([{'type': 'pointerMove', 'origin': 'viewport', 'x': 300 + i * 25, 'y': 450, 'duration': 30} for i in range(30)])
        time.sleep(0.5)
        assert chrome(f"return {glass_api}.snapshots(window)") == before, before
        check('Mover el ratón sin cristal encima de la web no hace ninguna foto')

        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        until(lambda: glass()['full'] and placed(glass()))
        wheel(300)
        time.sleep(1)
        shot = chrome(f"return {glass_api}.lastShot(window)")
        view = chrome("const b = gBrowser.selectedBrowser; return b.clientWidth * b.clientHeight")
        assert shot and shot['w'] * shot['h'] < view / 4, (shot, view)
        check('Cada foto es solo del trozo que hay debajo de las piezas')

        # Un salto (como Inicio o Avpág): la página se mueve de golpe 2400 px. Se mira cada fotograma.
        driver.context('content')
        driver.script("scrollTo(0, 0)")
        time.sleep(1.5)
        driver.context('chrome')
        driver.script("""window.__empty = 0; window.__frames = 0; const t0 = performance.now();
            const step = () => { const c = document.getElementById('zero-glass-nav-bar');
              const px = c && !c.hidden ? c.getContext('2d').getImageData(0, 0, c.width, c.height).data : null;
              let alpha = 0; if (px) for (let i = 3; i < px.length; i += 16) alpha += px[i];
              window.__frames++; if (!alpha) window.__empty++;
              if (performance.now() - t0 < 700) requestAnimationFrame(step); };
            requestAnimationFrame(step);""")
        driver.context('content')
        driver.script("scrollTo(0, 2400)")
        time.sleep(1)
        frames, empty = chrome("return [window.__frames, window.__empty]")
        assert frames > 20 and empty == 0, (frames, empty)
        check('Un salto de scroll no deja el cristal vacío ni un fotograma')

        chrome("gURLBar.focus(); gURLBar.select(); gURLBar.inputField.value = 'zorro'; gURLBar.startQuery({ searchString: 'zorro' });")
        under = """const v = gURLBar.view.panel; const c = document.getElementById('zero-glass-urlbar-view'); const r = v.getBoundingClientRect();
            const g = c && !c.hidden ? c.getBoundingClientRect() : null;
            return { open: gURLBar.view.isOpen, view: [r.left, r.top, r.width, r.height], glass: g && [g.left, g.top, g.width, g.height], radius: c?.style.borderRadius };"""
        def stuck():
            u = chrome(under)
            return u['open'] and u['view'][3] > 20 and u['glass'] and all(abs(a - b) <= 1 for a, b in zip(u['view'], u['glass']))
        try:
            until(stuck)
            chrome("gURLBar.view.panel.style.minHeight = '320px'")
            until(lambda: stuck() and chrome(under)['glass'][3] >= 319)
        except AssertionError:
            raise AssertionError(f'sugerencias: {chrome(under)}') from None
        chrome("gURLBar.view.panel.style.minHeight = ''; gURLBar.view.close(); gURLBar.handleRevert(); gBrowser.selectedBrowser.focus();")
        until(lambda: (u := chrome(under))['glass'] is None)
        check('Las sugerencias al escribir llevan su cristal debajo, pegado a ellas también cuando crecen')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
