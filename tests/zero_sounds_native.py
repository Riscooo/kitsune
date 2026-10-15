"""Kitsune Zero · los sonidos, en el motor real (perfil temporal, sin ventana en pantalla).

1. Apagado de serie: en los ajustes solo sale el interruptor «Sonidos».
2. Encendido salen las seis capas (lluvia, bosque, cafetería, olas, fuego y río) y «Se paran en el
   descanso».
3. Las seis grabaciones se abren y duran más de un minuto.
4. Subir la lluvia la hace sonar (ganancia = nivel al cuadrado) y las demás siguen calladas.
5. En el descanso del pomodoro se callan, y al acabar vuelven.
6. Apagarlo calla todo.
7. Las barras se arrastran con el ratón de verdad (antes el panel se rehacía a cada paso y la barra se
   iba de debajo del ratón): el bosque, arrastrado hasta la mitad, se queda a la mitad, y la barra que se
   arrastra es la misma de principio a fin.

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import json
from pathlib import Path
import tempfile
import time

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness

MIN = 60_000
SOUNDS = "ChromeUtils.importESModule('chrome://browser/content/zero/zero-sounds.sys.mjs').Sounds"
CLOCK = "ChromeUtils.importESModule('chrome://browser/content/zero/zero-pomodoro.sys.mjs').clock"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-sonidos-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def rows():
        return chrome("return [...document.querySelectorAll('#zero-settings .zero-row')].map(r => r.textContent.trim())")

    def debug():
        return chrome(f"return {SOUNDS}.debug()")

    def until(condition, timeout=8):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {debug()} · {rows()}') from None

    def forward(ms):
        chrome(f"const c = {CLOCK}; const before = c.now; c.now = () => before() + arguments[0];", [ms])
        time.sleep(1.3)

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        # Que la prueba no se oiga: el audio va igual (y se mide), pero a volumen cero.
        chrome("Services.prefs.setStringPref('media.volume_scale', '0.0')")
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate('data:text/html,<title>Hola</title>hola')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: chrome("return !!document.getElementById('zero-mark')"))
        chrome("document.getElementById('zero-mark').click()")
        until(lambda: any(r.startswith('Sonidos') for r in rows()))
        assert not any(r.startswith(('Lluvia', 'Bosque', 'Se paran')) for r in rows()), rows()
        check('Apagado de serie: solo el interruptor «Sonidos»')

        chrome("document.querySelector('#zero-settings [data-pref=\"sounds\"]').click()")
        names = ('Lluvia', 'Bosque', 'Cafetería', 'Olas', 'Fuego', 'Río', 'Se paran en el descanso')
        until(lambda: all(any(r.startswith(n) for r in rows()) for n in names))
        assert chrome("return document.querySelectorAll('#zero-settings input[type=range]:not([data-pref^=background])').length") == 6
        check('Encendido salen las seis capas y «Se paran en el descanso»')

        driver.context('chrome')
        lengths = driver.script(f"const done = arguments[arguments.length - 1]; {SOUNDS}.check(window).then(done, e => done('error ' + e));", [], asynchronous=True)
        assert isinstance(lengths, dict) and len(lengths) == 6 and all(v > 60 for v in lengths.values()), lengths
        check('Las seis grabaciones se abren y duran más de un minuto')

        chrome("""const slider = document.querySelector('#zero-settings input[data-pref="sounds.lluvia"]');
                  slider.value = 60; slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true }));""")
        until(lambda: (d := debug())['running'] and abs(d['gains'].get('lluvia', 0) - 0.36) < 0.02 and all(v < 0.01 for k, v in d['gains'].items() if k != 'lluvia'))
        check('Subir la lluvia la hace sonar (nivel al cuadrado) y las demás siguen calladas')

        chrome("Services.prefs.setBoolPref('kitsune.zero.pomodoro', true)")
        until(lambda: chrome("return !!document.getElementById('zero-pomo')"))
        chrome("document.querySelector('#zero-pomo .zero-pomo-ring').click()")
        forward(25 * MIN + 2000)
        until(lambda: debug()['gains'].get('lluvia', 1) < 0.01)
        forward(5 * MIN + 2000)
        until(lambda: debug()['gains'].get('lluvia', 0) > 0.3)
        check('En el descanso se callan, y al acabar vuelven')

        # Arrastrar el bosque con el ratón, de la izquierda hasta la mitad, en pasos.
        chrome("document.querySelector('#zero-settings input[data-pref=\"sounds.bosque\"]').__mia = true")
        # (Con todas las filas, la hoja de ajustes puede ser más alta que la ventana: se desplaza hasta la barra.)
        chrome("document.querySelector('#zero-settings input[data-pref=\"sounds.bosque\"]').scrollIntoView({ block: 'center' })")
        driver.context('chrome')
        bar = driver.command('POST', '/element', {'using': 'css selector', 'value': '#zero-settings input[data-pref="sounds.bosque"]'})
        width = chrome("return document.querySelector('#zero-settings input[data-pref=\"sounds.bosque\"]').getBoundingClientRect().width")
        start = -width / 2 + 8
        steps = [{'type': 'pointerMove', 'origin': bar, 'x': int(start), 'y': 0}, {'type': 'pointerDown', 'button': 0}]
        steps += [{'type': 'pointerMove', 'origin': bar, 'x': int(start + (0 - start) * i / 10), 'y': 0, 'duration': 30} for i in range(1, 11)]
        steps += [{'type': 'pointerUp', 'button': 0}]
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': steps}]})
        driver.command('DELETE', '/actions')
        level = "return [JSON.parse(Services.prefs.getStringPref('kitsune.zero.sounds.levels', '{}')).bosque ?? 0, document.querySelector('#zero-settings input[data-pref=\"sounds.bosque\"]')?.__mia === true]"
        try:
            until(lambda: (l := chrome(level)) and 0.4 <= l[0] <= 0.6 and l[1], timeout=5)
        except AssertionError:
            raise AssertionError(f'arrastrar el bosque: {chrome(level)}') from None
        check('Las barras se arrastran con el ratón: el bosque, hasta la mitad, se queda a la mitad')

        chrome("Services.prefs.setBoolPref('kitsune.zero.sounds', false)")
        until(lambda: all(v < 0.01 for v in debug()['gains'].values()))
        check('Apagarlo calla todo')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
