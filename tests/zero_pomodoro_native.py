"""Kitsune Zero · el pomodoro, en el motor real (perfil temporal, sin ventana en pantalla).

El tiempo se adelanta con el reloj del módulo (clock.now), para no esperar 25 minutos.

1. Apagado de serie: no hay anillo y en los ajustes solo sale el interruptor «Pomodoro».
2. Al encenderlo sale el anillo arriba a la derecha, en el marco (sin tocar la tarjeta ni pegarse a la curva
   de la esquina), y las filas
   de tiempos, descanso y guía.
3. Un clic empieza: con el ratón encima se abre, mínimo, con la hora y nada más («25:00», sin «Empezar» ni
   «Trabajo 1 de 4», que dicen el anillo a los lectores de pantalla y su bocadillo), y saltar y reiniciar
   como iconos; el anillo se va vaciando.
4. Es uno para todas las ventanas: otra ventana en Zero enseña el mismo tiempo.
5. El último minuto, el anillo respira («ending»), con opacidad y transform (sin repintar cada fotograma).
6. Descanso suave: al acabar el trabajo la isla avisa y el anillo cambia de color.
7. Al acabar el descanso, la isla dice «¿Seguimos?» y el anillo espera a que se pulse.
8. Descanso estricto: un cristal tapa la web (no la isla ni el raíl) con la guía y el tiempo; soltar
   «Mantén para saltar» antes de tiempo no salta y mantenerlo 1,5 s sí.
9. Con la web ampliada el anillo no está (decisión de Risco, 15-10); el tiempo sigue y vuelve al salir.
10. Apagarlo quita todo.
11. Un clic en el texto del tiempo no pausa (solo el anillo empieza o pausa), y con el teclado el
    anillo se abre igual que con el ratón.
12. Al cerrarse, sin tirones (Risco, 15-10): la hora se apaga en su sitio (mientras se ve no se desliza) y
    la píldora y sus botones se recogen a la vez, sin saltos de un fotograma a otro.
13. Apagarlo desde los ajustes: sus filas se recogen y el panel no da un salto al quitarlas.
14. Al encenderlo (al pasar a «Currar»), el anillo no aparece de golpe (Risco, 15-10: «sale demasiado
    brusco»): nace pequeño y transparente, crece con un rebote y su arco se dibuja; al apagarlo se encoge y
    se desvanece antes de irse.

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

MIN = 60_000


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(b'<!doctype html><meta charset=utf-8><title>Kioto</title><body style="margin:0;background:#fbfaf7"><h1>Los zorros de Kioto</h1>')

    def log_message(self, *args):
        pass


POMO = """
const box = el => { const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom } : null; };
const seen = el => !!el && el.getBoundingClientRect().width > 2 && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0.5;
const pomo = document.getElementById('zero-pomo'); const brk = document.getElementById('zero-break');
const notch = document.getElementById('zero-notch');
return {
  pomo: pomo ? { box: box(pomo), seen: seen(pomo), phase: pomo.getAttribute('phase'), running: pomo.hasAttribute('running'), ending: pomo.hasAttribute('ending'),
                 label: pomo.querySelector('.zero-pomo-label')?.textContent.trim() ?? '', labelSeen: seen(pomo.querySelector('.zero-pomo-label')),
                 says: pomo.querySelector('.zero-pomo-ring')?.getAttribute('aria-label') ?? '',
                 progress: Number(getComputedStyle(pomo).getPropertyValue('--zero-pomo-p') || 'NaN') } : null,
  card: box(document.getElementById('tabbrowser-tabpanels')), W: innerWidth,
  rows: [...document.querySelectorAll('#zero-settings .zero-row')].map(r => r.textContent.trim()),
  alert: document.getElementById('navigator-toolbox').hasAttribute('zero-island-alert') ? document.getElementById('zero-island-msg').textContent.trim() : '',
  brk: brk ? { seen: seen(brk), box: box(brk), text: brk.textContent.replace(/\\s+/g, ' ').trim() } : null,
  island: box(document.getElementById('nav-bar')), rail: box(document.getElementById('zero-rail')),
  notch: notch ? { seen: seen(notch), fill: getComputedStyle(notch, '::after').width } : null,
  full: document.documentElement.hasAttribute('zero-full'),
};
"""
CLOCK = "ChromeUtils.importESModule('chrome://browser/content/zero/zero-pomodoro.sys.mjs').clock"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-pomo-'))
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

    def state():
        return chrome(POMO)

    def until(condition, timeout=6):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {state()}') from None

    def element(selector):
        driver.context('chrome')
        return driver.command('POST', '/element', {'using': 'css selector', 'value': selector})

    def click(selector):
        driver.context('chrome')
        driver.command('POST', f"/element/{list(element(selector).values())[0]}/click", {})

    def pointer(actions):
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': actions}]})

    def away():
        pointer([{'type': 'pointerMove', 'origin': 'viewport', 'x': 700, 'y': 600}])

    def forward(ms):
        # Adelanta el reloj del pomodoro (y espera a su siguiente segundo).
        chrome(f"const c = {CLOCK}; const before = c.now; const extra = arguments[0]; c.now = () => before() + extra;", [ms])
        time.sleep(1.3)

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/kioto')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: chrome("return !!document.getElementById('zero-mark')"))

        s = state()
        assert s['pomo'] is None or not s['pomo']['seen'], s
        click('#zero-mark')
        until(lambda: [r for r in state()['rows'] if r.startswith('Pomodoro')])
        rows = state()['rows']
        assert not any(r.startswith(('Tiempos', 'Descanso', 'Guía')) for r in rows), rows
        check('Apagado de serie: no hay anillo y en los ajustes solo sale el interruptor')

        click('#zero-settings [data-pref="pomodoro"]')
        # Ya quieto (entra con su animación: ver 14).
        until(lambda: state()['pomo'] and state()['pomo']['seen'] and chrome("return document.getElementById('zero-pomo').getAnimations({ subtree: true }).length") == 0)
        s = state()
        p, card = s['pomo']['box'], s['card']
        # Arriba a la derecha, pero sin pegarse al borde (Risco, 15-10): a 8 px o más de la curva de la
        # esquina (48 px de radio).
        c = (s['W'] - (p['x'] + p['w'] / 2), p['y'] + p['h'] / 2)
        gap = 48 - ((48 - c[0]) ** 2 + (48 - c[1]) ** 2) ** 0.5 - p['w'] / 2
        assert p['bottom'] <= card['y'] and s['W'] - p['right'] <= 40 and p['w'] <= 34 and gap >= 8, f'anillo a {gap:.1f} px de la curva · {s}'
        until(lambda: all(any(r.startswith(name) for r in state()['rows']) for name in ('Tiempos', 'Descanso', 'Guía')))
        chrome("document.getElementById('zero-mark').click()")  # cierra los ajustes
        check('Al encenderlo sale el anillo arriba a la derecha, en el marco, y las filas de tiempos, descanso y guía')

        # Parado, con el ratón encima: solo la hora (sin «Empezar»).
        pointer([{'type': 'pointerMove', 'origin': element('#zero-pomo'), 'x': 0, 'y': 0}])
        until(lambda: state()['pomo']['labelSeen'] and state()['pomo']['label'] == '25:00' and 'Empezar' in state()['pomo']['says'])
        away()
        click('#zero-pomo .zero-pomo-ring')
        until(lambda: state()['pomo']['running'] and state()['pomo']['phase'] == 'work')
        pointer([{'type': 'pointerMove', 'origin': element('#zero-pomo'), 'x': 0, 'y': 0}])
        until(lambda: state()['pomo']['labelSeen'] and state()['pomo']['label'] in ('25:00', '24:59', '24:58', '24:57') and 'Trabajo 1 de 4' in state()['pomo']['says'])
        assert chrome("return ['skip', 'reset'].every(a => document.querySelector(`#zero-pomo [data-action=${a}]`))")
        first = state()['pomo']['progress']
        forward(10 * MIN)
        until(lambda: state()['pomo']['progress'] < first - 0.3 and state()['pomo']['label'].startswith(('15:00', '14:5')) and '·' not in state()['pomo']['label'])
        away()
        check('Un clic empieza; con el ratón encima, solo la hora, saltar y reiniciar como iconos; el anillo se vacía')

        chrome("window.__otra = OpenBrowserWindow();")
        until(lambda: chrome("return !!window.__otra.gBrowserInit?.delayedStartupFinished && !!window.__otra.document.getElementById('kitsune-zero-key')"), timeout=15)
        chrome("const d = window.__otra.document; if (!d.documentElement.hasAttribute('zero')) d.getElementById('kitsune-zero-key').doCommand();")  # desde Zero ya nace en Zero
        until(lambda: chrome("const p = window.__otra.document.getElementById('zero-pomo'); return !!p && p.getAttribute('phase') === 'work' && p.hasAttribute('running')"), timeout=8)
        chrome("window.__otra.close(); delete window.__otra;")
        check('Es uno para todas las ventanas: otra ventana en Zero lo enseña igual')

        forward(14 * MIN + 20_000)
        until(lambda: state()['pomo']['ending'])
        # Respira con opacidad y transform (el compositor), sin repintar en cada fotograma.
        endless = """const box = document.getElementById(arguments[0]); const own = ['offset', 'easing', 'composite', 'computedOffset', 'simulateComputeValuesFailure'];
            const anims = document.getAnimations().filter(a => a.effect?.getTiming().iterations === Infinity && box?.contains(a.effect.target));
            return { count: anims.length, props: [...new Set(anims.flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k).filter(p => !own.includes(p)))))] };"""
        moving = chrome(endless, ['zero-pomo'])
        assert moving['count'] >= 1 and set(moving['props']) <= {'opacity', 'transform'}, f'animaciones que no paran en el pomodoro: {moving}'
        check('El último minuto, el anillo respira')

        forward(MIN)
        until(lambda: state()['pomo']['phase'] == 'short' and 'Descanso' in state()['alert'])
        check('Descanso suave: al acabar el trabajo, la isla avisa y el anillo cambia')

        forward(5 * MIN + 2000)
        until(lambda: state()['pomo']['phase'] == 'waiting' and not state()['pomo']['running'] and 'Seguimos' in state()['alert'])
        check('Al acabar el descanso, la isla pregunta «¿Seguimos?» y el anillo espera')

        chrome("Services.prefs.setStringPref('kitsune.zero.pomodoro.break', 'strict')")
        click('#zero-pomo .zero-pomo-ring')
        until(lambda: state()['pomo']['running'] and state()['pomo']['phase'] == 'work')
        forward(25 * MIN + 2000)
        until(lambda: state()['brk'] and state()['brk']['seen'])
        s = state()
        # El cristal entra con su animación (escala 0,985 → 1): se mide cuando ya ha llegado.
        until(lambda: (s := state())['brk'] and abs(s['brk']['box']['x'] - s['card']['x']) <= 2 and abs(s['brk']['box']['w'] - s['card']['w']) <= 2)
        s = state()
        b = s['brk']['box']
        assert 'Mantén para saltar' in s['brk']['text'], s
        assert s['island']['y'] + s['island']['h'] <= b['y'] and s['rail']['x'] + s['rail']['w'] <= b['x'] + 2, s
        hold = list(element('#zero-break .zero-hold').values())[0]
        # Al quitarse el cristal, la ventana se entera (zero-break-change: zero-silence lo vigila); con Gecko 157 no
        # llegaba (ownerGlobal ya no existe).
        chrome("window.__breakChanges = 0; window.addEventListener('zero-break-change', () => window.__breakChanges++)")
        driver.context('chrome')
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [
            {'type': 'pointerMove', 'origin': {'element-6066-11e4-a52e-4f735466cecf': hold}, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0},
            {'type': 'pause', 'duration': 500}, {'type': 'pointerUp', 'button': 0}]}]})
        time.sleep(0.5)
        assert state()['brk']['seen'] and state()['pomo']['phase'] == 'short', state()
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [
            {'type': 'pointerMove', 'origin': {'element-6066-11e4-a52e-4f735466cecf': hold}, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0},
            {'type': 'pause', 'duration': 1800}, {'type': 'pointerUp', 'button': 0}]}]})
        until(lambda: not (state()['brk'] and state()['brk']['seen']) and state()['pomo']['phase'] == 'waiting')
        assert chrome("return window.__breakChanges") > 0, 'la ventana no se ha enterado de que se quita el cristal'
        away()
        check('Descanso estricto: un cristal tapa la web con la guía; soltar antes no salta y mantener 1,5 s sí')

        click('#zero-pomo .zero-pomo-ring')
        until(lambda: state()['pomo']['running'])
        forward(5 * MIN)  # con algo de progreso que enseñar
        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        until(lambda: state()['full'] and not state()['pomo']['seen'] and state()['pomo']['box']['w'] == 0)
        chrome("document.querySelector('#zero-grow button[data-action=full]').click()")
        until(lambda: not state()['full'] and state()['pomo']['seen'] and state()['pomo']['running'])
        check('Con la web ampliada el anillo no está; el tiempo sigue y vuelve al salir')

        pointer([{'type': 'pointerMove', 'origin': element('#zero-pomo'), 'x': 0, 'y': 0}])
        until(lambda: state()['pomo']['labelSeen'])
        click('#zero-pomo .zero-pomo-label')
        time.sleep(0.4)
        assert state()['pomo']['running'], state()
        away()
        until(lambda: not state()['pomo']['labelSeen'])
        chrome("document.querySelector('#zero-pomo .zero-pomo-ring').focus()")
        until(lambda: state()['pomo']['labelSeen'] and chrome("return document.querySelector('#zero-pomo [data-action=skip]').getBoundingClientRect().width") > 10)
        chrome("document.querySelector('#zero-pomo .zero-pomo-ring').blur()")
        check('Un clic en el texto no pausa, y con el teclado el anillo se abre igual')

        # El cierre, fotograma a fotograma (se graba dentro de la ventana: Marionette hace una cosa cada vez).
        pointer([{'type': 'pointerMove', 'origin': element('#zero-pomo'), 'x': 0, 'y': 0}])
        until(lambda: state()['pomo']['labelSeen'] and chrome("return document.querySelector('#zero-pomo [data-action=skip]').getBoundingClientRect().width") > 23)
        time.sleep(0.8)
        chrome("""window.__pomo = []; const t0 = performance.now(); const p = document.getElementById('zero-pomo');
            const label = p.querySelector('.zero-pomo-label');
            const step = () => { const r = label.getBoundingClientRect(), q = p.getBoundingClientRect();
              window.__pomo.push({ right: r.right, op: +getComputedStyle(label).opacity, w: q.width, acts: [...p.querySelectorAll('.zero-pomo-action')].map(a => a.getBoundingClientRect().width) });
              if (performance.now() - t0 < 1200) requestAnimationFrame(step); };
            requestAnimationFrame(step);""")
        away()
        time.sleep(1.5)
        rec = chrome("return window.__pomo")
        seen = [f for f in rec if f['op'] >= 0.15]
        drift = max(abs(f['right'] - rec[0]['right']) for f in seen)
        # Un salto: un fotograma que se mueve mucho más que sus vecinos (la velocidad del cierre depende de
        # los fotogramas por segundo; un pico no).
        moves = [abs(b['w'] - a['w']) for a, b in zip(rec, rec[1:])]
        steps = max((moves[i] - (moves[i - 1] + moves[i + 1]) / 2 for i in range(1, len(moves) - 1)), default=0)
        # Los botones se recogen con la píldora: mientras la píldora no se ha movido, ellos tampoco.
        early = [f for f in rec if abs(f['w'] - rec[0]['w']) < 0.5]
        apart = max((abs(f['acts'][0] - rec[0]['acts'][0]) for f in early), default=0)
        assert drift <= 4 and steps <= 4 and apart <= 0.5 and rec[-1]['w'] <= 33, \
            f'cierre con tirón: la hora se desliza {drift:.1f} px mientras se ve, pico de {steps:.1f} px sobre sus vecinos, botones antes que la píldora {apart:.1f} px · {rec[-1]}'
        check('Al cerrarse, la hora se apaga en su sitio y la píldora se recoge sin tirones')

        # Apagado desde los ajustes: sus filas se recogen y el panel no da un salto al quitarlas.
        click('#zero-mark')
        until(lambda: chrome("return document.getElementById('zero-settings').hasAttribute('open')"))
        time.sleep(0.8)
        chrome("""window.__rows = []; const t0 = performance.now(); const panel = document.getElementById('zero-settings');
            const step = () => { window.__rows.push({ top: panel.getBoundingClientRect().top, n: panel.querySelectorAll('.zero-row').length });
              if (performance.now() - t0 < 1200) requestAnimationFrame(step); };
            requestAnimationFrame(step);""")
        click('#zero-settings [data-pref="pomodoro"]')
        time.sleep(1.4)
        rows = chrome("return window.__rows")
        gone = [i for i in range(1, len(rows)) if rows[i]['n'] < rows[i - 1]['n']]
        assert gone, f'no se fueron filas: {rows[-1]}'
        snap = max(abs(rows[i]['top'] - rows[i - 1]['top']) for i in gone)
        assert snap <= 0.5, f'el panel salta {snap:.1f} px al quitar las filas'
        click('#zero-mark')
        until(lambda: state()['pomo'] is None and state()['brk'] is None)
        check('Apagarlo quita todo')

        # Entrar y salir con animación: muestras de cada fotograma (opacidad y escala del anillo).
        sample = """window.__pomo = []; const t0 = performance.now();
            const step = () => { const r = document.getElementById('zero-pomo');
              if (r) { const m = new DOMMatrix(getComputedStyle(r).transform === 'none' ? undefined : getComputedStyle(r).transform);
                       window.__pomo.push({ t: performance.now() - t0, o: Number(getComputedStyle(r).opacity), s: m.a,
                                            sweep: r.hasAttribute('entering'), anims: r.getAnimations({ subtree: true }).length }); }
              else window.__pomo.push({ t: performance.now() - t0, gone: true });
              if (performance.now() - t0 < 1500) requestAnimationFrame(step); };
            requestAnimationFrame(step);"""
        chrome(sample)
        chrome("Services.prefs.setBoolPref('kitsune.zero.pomodoro', true)")
        time.sleep(1.7)
        frames = [f for f in chrome("return window.__pomo") if not f.get('gone')]
        assert frames, 'el anillo no salió'
        first, last = frames[0], frames[-1]
        assert first['o'] < 0.6 and first['s'] < 0.8, f'el anillo aparece de golpe: {first}'
        assert max(f['s'] for f in frames) > 1.02, f'sin rebote: {max(f["s"] for f in frames)}'
        assert any(f['sweep'] for f in frames), 'el arco no se dibuja'
        assert last['o'] == 1 and abs(last['s'] - 1) < 1e-3 and last['anims'] == 0 and not last['sweep'], f'no acaba quieto: {last}'
        chrome(sample)
        chrome("Services.prefs.setBoolPref('kitsune.zero.pomodoro', false)")
        time.sleep(1.7)
        frames = chrome("return window.__pomo")
        leaving = [f for f in frames if not f.get('gone')]
        assert leaving and any(f['o'] < 0.9 and f['s'] < 0.95 for f in leaving), f'se va de golpe: {frames[:3]}'
        assert frames[-1].get('gone') and leaving[-1]['t'] < 600, f'no se va: {frames[-1]} · {len(leaving)}'
        check('Al encenderlo, el anillo entra con su animación (crece con un rebote y dibuja su arco); al apagarlo se encoge y se va')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
