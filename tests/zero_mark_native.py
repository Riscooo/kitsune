"""Kitsune Zero · la marca de agua y los ajustes, en el motor real (perfil temporal, sin ventana en pantalla).

1. La marca está abajo a la izquierda (a 13 px y 16 px de los bordes) y se ve: con el sistema en oscuro, en
   blanco y con opacidad 0,62; en claro (el marco pasa a tinta), en tinta a 0,5.
2. Un clic abre los ajustes (#zero-settings), que brotan de la marca; se cierran con un clic fuera o con Esc.
3. «Ventanas nuevas» (como esta / en Zero / normales) cambia kitsune.zero.inherit y kitsune.zero.always,
   y «Fondo» (del sistema / de la web) cambia kitsune.zero.backdrop y el aspecto al momento. «Pestañas» (con texto / solo
   iconos, el raíl) cambia kitsune.zero.railIcons; la isla de arriba no tiene esa opción.
4. No salen filas de fases sin hacer (pomodoro, silencio, sonidos…).
5. Con la web ampliada la marca se aparta, y vuelve al acercarse al borde izquierdo.
7. Sin textos descriptivos bajo las opciones: las que lo tienen llevan una «i» que, con el ratón encima,
   lo dice en una etiqueta junto a ella; la fila «La i de ayuda» las quita todas (y las vuelve a poner).
6. Los ajustes no repiten el atajo en la cabecera. Nada pasa de golpe: al encender una opción, sus filas
   entran con una animación (y al apagarla se van igual); el interruptor que se pulsa es el mismo (no se
   rehace) y su bolita recorre el camino; en un segmento, la pastilla de la elegida se desliza hasta ella.

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
        # El puntero, lejos de la marca (sin moverlo, su sitio es cualquiera y puede quedar encima de ella).
        pointer([{'type': 'pointerMove', 'origin': 'viewport', 'x': 800, 'y': 400}])

        until(lambda: (m := mark())['mark'] is not None and abs(m['mark']['x'] - 13) <= 1 and abs(m['H'] - m['mark']['bottom'] - 16) <= 1
              and m['color'] == 'rgb(255, 255, 255)' and abs(m['opacity'] - 0.62) < 0.01)
        # Con el sistema en claro (y el cristal del sistema), el marco pasa a tinta y la marca también.
        chrome("Services.prefs.setIntPref('ui.systemUsesDarkTheme', 0)")
        until(lambda: (m := mark())['color'] == 'rgb(29, 35, 33)' and abs(m['opacity'] - 0.5) < 0.01)
        chrome("Services.prefs.clearUserPref('ui.systemUsesDarkTheme')")
        check('La marca está abajo a la izquierda y se ve: blanca a 0,62 con el sistema en oscuro, en tinta a 0,5 en claro')

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
        assert len(rows) == 7 and [r.split(' ')[0][:8] for r in rows[4:]] == ['Pomodoro', 'Silencio', 'Sonidos'], rows
        assert not any(word in ' '.join(rows) for word in ('Tiempos', 'Webs vetadas', 'Aviso de scroll', 'Lluvia')), rows
        assert chrome("return !document.querySelector('#zero-settings [data-pref=islandIcons]')"), 'la isla de arriba no lleva «solo iconos»'
        click('#zero-settings [data-pref="railIcons"] [data-value="icons"]')
        until(lambda: chrome("return Services.prefs.getBoolPref('kitsune.zero.railIcons', false)") is True)
        click('#zero-settings [data-pref="railIcons"] [data-value="text"]')
        until(lambda: chrome("return Services.prefs.getBoolPref('kitsune.zero.railIcons', false)") is False)
        check('No salen filas de fases sin hacer')

        head = chrome("return document.querySelector('#zero-settings h4').textContent")
        assert 'Ctrl' not in head and '⌘' not in head, head
        driver.context('chrome')
        turned = driver.script("""const done = arguments[arguments.length - 1];
            const sw = document.querySelector('#zero-settings [data-pref=pomodoro]'); sw.__mio = true;
            const before = [...document.querySelectorAll('#zero-settings .zero-row')]; before.forEach(r => r.__vieja = true);
            sw.click();
            setTimeout(() => {
              const now = document.querySelector('#zero-settings [data-pref=pomodoro]');
              const rows = [...document.querySelectorAll('#zero-settings .zero-row')];
              const fresh = rows.filter(r => !r.__vieja);
              done({ same: now?.__mio === true, kept: before.every(r => r.isConnected), fresh: fresh.length,
                     moving: fresh.filter(r => r.getAnimations().some(a => a.playState === 'running')).length,
                     knob: document.getAnimations().some(a => a.effect?.target === now && a.effect.pseudoElement === '::after' && a.playState === 'running') });
            }, 80);""", [], asynchronous=True)
        assert turned['same'] and turned['kept'] and turned['fresh'] >= 2 and turned['moving'] == turned['fresh'] and turned['knob'], turned
        time.sleep(0.8)
        driver.context('chrome')
        slid = driver.script("""const done = arguments[arguments.length - 1];
            const seg = document.querySelector('#zero-settings [data-pref="pomodoro.preset"]'); const thumb = seg?.querySelector('.zero-seg-thumb');
            if (!thumb) return done({ moving: false, thumb: false });
            const target = seg.querySelector('[data-value="50"]'); target.click();
            setTimeout(() => {
              const moving = thumb.getAnimations().some(a => a.playState === 'running');
              setTimeout(() => { const t = thumb.getBoundingClientRect(), b = target.getBoundingClientRect();
                done({ moving, left: t.left - b.left, width: t.width - b.width }); }, 700);
            }, 60);""", [], asynchronous=True)
        assert slid['moving'] and abs(slid['left']) < 1 and abs(slid['width']) < 1, slid
        driver.context('chrome')
        gone = driver.script("""const done = arguments[arguments.length - 1];
            const count = () => document.querySelectorAll('#zero-settings .zero-row:not([leaving])').length;
            const before = document.querySelectorAll('#zero-settings .zero-row').length;
            document.querySelector('#zero-settings [data-pref=pomodoro]').click();
            setTimeout(() => {
              const leaving = [...document.querySelectorAll('#zero-settings .zero-row[leaving]')];
              const animated = leaving.filter(r => r.getAnimations().some(a => a.playState === 'running')).length;
              setTimeout(() => done({ before, leaving: leaving.length, animated, after: document.querySelectorAll('#zero-settings .zero-row').length, live: count() }), 800);
            }, 60);""", [], asynchronous=True)
        assert gone['leaving'] >= 2 and gone['animated'] == gone['leaving'] and gone['after'] == gone['live'] == 7, gone
        chrome("Services.prefs.clearUserPref('kitsune.zero.pomodoro.preset')")
        check('Sin el atajo en la cabecera; las filas entran y se van con animación, el interruptor y el segmento se deslizan')

        chrome("Services.prefs.setBoolPref('kitsune.zero.pomodoro', true)")
        until(lambda: chrome("return !!document.querySelector('#zero-settings [data-pref=\"pomodoro.preset\"]')"), timeout=5)
        # Con las filas ya quietas (entran con una animación).
        until(lambda: chrome("return document.querySelectorAll('#zero-settings .zero-row').length && [...document.querySelectorAll('#zero-settings .zero-row')].every(r => !r.getAnimations().length)"), timeout=5)
        hints = """const panel = document.getElementById('zero-settings');
            const smalls = [...panel.querySelectorAll('.zero-row-text small')].filter(n => n.getBoundingClientRect().height > 0).length;
            const infos = [...panel.querySelectorAll('.zero-info')].filter(n => n.getBoundingClientRect().width > 0);
            const tip = document.getElementById('zero-settings-tip');
            return { smalls, infos: infos.length, tip: tip && { text: tip.textContent, shown: Number(getComputedStyle(tip).opacity) > 0.9 } };"""
        h = chrome(hints)
        assert h['smalls'] == 0 and h['infos'] >= 2, h
        detail = chrome("return document.querySelector('#zero-settings [data-pref=pomodoro]').closest('.zero-row').querySelector('.zero-info').getAttribute('aria-label')")
        assert detail, 'la i del pomodoro dice algo'
        driver.context('chrome')
        info = driver.command('POST', '/element', {'using': 'css selector', 'value': '#zero-settings .zero-row:has([data-pref=pomodoro]) .zero-info'})
        pointer([{'type': 'pointerMove', 'origin': info, 'x': 0, 'y': 0}])
        until(lambda: (t := chrome(hints)['tip']) and t['shown'] and t['text'] == detail, timeout=5)
        pointer([{'type': 'pointerMove', 'origin': 'viewport', 'x': 1200, 'y': 400}])
        until(lambda: not chrome(hints)['tip']['shown'], timeout=5)
        click('#zero-settings [data-pref="hints"]')
        until(lambda: chrome(hints)['infos'] == 0 and chrome("return Services.prefs.getBoolPref('kitsune.zero.hints', true)") is False, timeout=5)
        click('#zero-settings [data-pref="hints"]')
        until(lambda: chrome(hints)['infos'] >= 2, timeout=5)
        chrome("Services.prefs.clearUserPref('kitsune.zero.hints'); Services.prefs.clearUserPref('kitsune.zero.pomodoro')")
        check('Sin textos bajo las opciones: una «i» con la explicación al pasar el ratón, que se puede quitar')
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
