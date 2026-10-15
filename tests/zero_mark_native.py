"""Kitsune Zero · la marca de agua y los ajustes, en el motor real (perfil temporal, sin ventana en pantalla).

1. La marca está abajo a la izquierda (a 13 px y 16 px de los bordes): con el sistema en oscuro, en blanco
   y con opacidad 0,34; en claro (el marco pasa a tinta), en tinta.
2. Un clic abre los ajustes (#zero-settings), que brotan de la marca; se cierran con un clic fuera o con Esc.
3. «Ventanas nuevas» (como esta / en Zero / normales) cambia kitsune.zero.inherit y kitsune.zero.always,
   y «Fondo» (del sistema / de la web) cambia kitsune.zero.backdrop y el aspecto al momento. «Isla» (con texto / solo iconos) cambia
   kitsune.zero.islandIcons.
4. No salen filas de fases sin hacer (pomodoro, silencio, sonidos…).
5. Con la web ampliada la marca se aparta, y vuelve al acercarse al borde izquierdo.

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import http.server
import json
from pathlib import Path
import tempfile
import threading

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(b'<!doctype html><meta charset=utf-8><title>Kioto</title><h1>Los zorros de Kioto</h1>')

    def log_message(self, *args):
        pass


MARK = """
const box = el => { const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right } : null; };
const mark = document.getElementById('zero-mark'), panel = document.getElementById('zero-settings');
const cs = mark && getComputedStyle(mark), ps = panel && getComputedStyle(panel);
let origin = null;
if (panel) {
  // El punto del que brota el panel, en coordenadas de la ventana.
  const [ox, oy] = ps.transformOrigin.split(' ').map(parseFloat);
  const r = panel.getBoundingClientRect();
  origin = { x: panel.offsetLeft + ox, y: panel.offsetTop + oy };
}
return {
  mark: box(mark), color: cs?.color, opacity: cs ? Number(cs.opacity) : null, H: innerHeight,
  open: !!panel?.hasAttribute('open'), panelOpacity: ps ? Number(ps.opacity) : null, origin,
  rows: [...(panel?.querySelectorAll('.zero-row') ?? [])].map(row => row.textContent.trim()),
  always: Services.prefs.getBoolPref('kitsune.zero.always', false),
  inherit: Services.prefs.getBoolPref('kitsune.zero.inherit', true),
  backdropPref: Services.prefs.getStringPref('kitsune.zero.backdrop', 'auto'),
  backdrop: document.documentElement.getAttribute('zero-backdrop'),
  full: document.documentElement.hasAttribute('zero-full'),
};
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-mark-'))
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

    def mark():
        return chrome(MARK)

    def until(condition, timeout=5):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {mark()}') from None

    def element(selector):
        driver.context('chrome')
        return list(driver.command('POST', '/element', {'using': 'css selector', 'value': selector}).values())[0]

    def click(selector):
        driver.context('chrome')
        driver.command('POST', f'/element/{element(selector)}/click', {})

    def pointer(actions):
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': actions}]})

    def keys(*values):
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'key', 'id': 'teclado', 'actions':
            [a for v in values for a in ({'type': 'keyDown', 'value': v}, {'type': 'keyUp', 'value': v})]}]})

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/kioto')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("Services.prefs.setIntPref('ui.systemUsesDarkTheme', 1)")
        chrome("document.getElementById('kitsune-zero-key').doCommand()")

        until(lambda: (m := mark())['mark'] is not None and abs(m['mark']['x'] - 13) <= 1 and abs(m['H'] - m['mark']['bottom'] - 16) <= 1
              and m['color'] == 'rgb(255, 255, 255)' and abs(m['opacity'] - 0.34) < 0.01)
        # Con el sistema en claro (y el cristal del sistema), el marco pasa a tinta y la marca también.
        chrome("Services.prefs.setIntPref('ui.systemUsesDarkTheme', 0)")
        until(lambda: (m := mark())['color'] == 'rgb(29, 35, 33)' and abs(m['opacity'] - 0.26) < 0.01)
        chrome("Services.prefs.clearUserPref('ui.systemUsesDarkTheme')")
        check('La marca está abajo a la izquierda: blanca a 0,34 con el sistema en oscuro, en tinta en claro')

        click('#zero-mark')
        until(lambda: mark()['open'] and mark()['panelOpacity'] == 1)
        m = mark()
        assert m['mark']['x'] - 6 <= m['origin']['x'] <= m['mark']['right'] + 6 and m['mark']['y'] - 6 <= m['origin']['y'] <= m['mark']['bottom'] + 6, m
        pointer([{'type': 'pointerMove', 'origin': 'viewport', 'x': 800, 'y': 400}, {'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0}])
        until(lambda: not mark()['open'] and mark()['panelOpacity'] == 0)
        click('#zero-mark')
        until(lambda: mark()['open'])
        keys('')  # Esc
        until(lambda: not mark()['open'])
        check('Un clic abre los ajustes, que brotan de la marca, y se cierran con un clic fuera o con Esc')

        click('#zero-mark')
        until(lambda: mark()['open'] and mark()['panelOpacity'] == 1)
        click('#zero-settings [data-pref="windows"] [data-value="always"]')
        until(lambda: mark()['always'] is True and mark()['inherit'] is True)
        click('#zero-settings [data-pref="windows"] [data-value="normal"]')
        until(lambda: mark()['always'] is False and mark()['inherit'] is False)
        click('#zero-settings [data-pref="windows"] [data-value="inherit"]')
        until(lambda: mark()['always'] is False and mark()['inherit'] is True)
        click('#zero-settings [data-pref="backdrop"] [data-value="web"]')
        until(lambda: mark()['backdropPref'] == 'web' and mark()['backdrop'] == 'web')
        click('#zero-settings [data-pref="backdrop"] [data-value="system"]')
        until(lambda: mark()['backdropPref'] == 'system' and mark()['backdrop'] == 'system')
        assert mark()['open'], mark()  # tocar dentro no lo cierra
        check('«Ventanas nuevas» y «Fondo» cambian sus ajustes y el aspecto al momento')

        rows = mark()['rows']
        # Las de Zero (ventanas nuevas, fondo, isla) y los interruptores del pomodoro, el silencio y los
        # sonidos, apagados: sin sus opciones.
        assert len(rows) == 6 and [r.split(' ')[0][:8] for r in rows[3:]] == ['Pomodoro', 'Silencio', 'SonidosG'], rows
        assert not any(word in ' '.join(rows) for word in ('Tiempos', 'Webs vetadas', 'Aviso de scroll', 'Lluvia')), rows
        click('#zero-settings [data-pref="islandIcons"] [data-value="icons"]')
        until(lambda: chrome("return Services.prefs.getBoolPref('kitsune.zero.islandIcons', false)") is True)
        click('#zero-settings [data-pref="islandIcons"] [data-value="text"]')
        until(lambda: chrome("return Services.prefs.getBoolPref('kitsune.zero.islandIcons', false)") is False)
        check('No salen filas de fases sin hacer')
        keys('')
        until(lambda: not mark()['open'])

        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        until(lambda: mark()['full'] and mark()['opacity'] == 0)
        pointer([{'type': 'pointerMove', 'origin': driver.command('POST', '/element', {'using': 'css selector', 'value': '#zero-edge'}), 'x': 0, 'y': 0}])
        until(lambda: mark()['opacity'] > 0.3)
        check('Con la web ampliada la marca se aparta y vuelve al acercarse al borde izquierdo')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
