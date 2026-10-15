"""Kitsune Zero · el movimiento, en el motor real (perfil temporal, sin ventana en pantalla).

1. Las piezas de Zero solo usan dos curvas: «llegar» (forma y sitio) y «aparecer» (opacidad y color).
2. Al cerrar, el contenido se va antes que la forma (la isla y el raíl encogen un poco después).
3. Al abrir, primero la forma y luego el contenido (140 ms después).
4. Al salir de Zero la web vuelve a su sitio viajando, como al entrar (no de golpe).
5. Con «reducir movimiento», todo lo de Zero es instantáneo.

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import json
from pathlib import Path
import tempfile

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness

CALM = 'cubic-bezier(0.32, 0.72, 0, 1)'
SOFT = 'cubic-bezier(0.4, 0, 0.2, 1)'

# Cada pieza de Zero y lo que se mueve en ella: [selector, propiedades].
MOTION = """
const pieces = ['#navigator-toolbox', '#nav-bar', '#back-button', '#stop-reload-button', '#PanelUI-button', '#zero-host', '#zero-island-msg',
  '#tabbrowser-tabpanels', '#tabbrowser-tabbox', '#zero-lights > button', '#zero-grow', '#zero-grow > button', '#zero-rail', '#zero-rail .zero-item',
  '#zero-rail .zero-fav', '#zero-rail .zero-tt', '#zero-rail .zero-sep', '#zero-mark', '#zero-settings', '#zero-settings .zero-switch'];
const split = value => value.split(/,(?![^(]*\\))/).map(part => part.trim());
const seconds = value => value.endsWith('ms') ? parseFloat(value) / 1000 : parseFloat(value);
const out = {};
for (const selector of pieces) {
  const el = document.querySelector(selector);
  if (!el) { out[selector] = null; continue; }
  const cs = getComputedStyle(el);
  const props = split(cs.transitionProperty), durations = split(cs.transitionDuration).map(seconds), delays = split(cs.transitionDelay).map(seconds), curves = split(cs.transitionTimingFunction);
  out[selector] = props.map((prop, i) => ({ prop, duration: durations[i % durations.length], delay: delays[i % delays.length], curve: curves[i % curves.length] }));
}
return out;
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-motion-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def motion():
        return chrome(MOTION)

    def find(m, selector, prop):
        return next((t for t in m[selector] or [] if t['prop'] == prop), None)

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate('data:text/html,<title>Kioto</title>hola')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !!document.getElementById('zero-mark')"), timeout=5)

        m = motion()
        wrong = {sel: [(t['prop'], t['curve']) for t in ts if t['duration'] > 0 and t['prop'] != 'none' and t['curve'] not in (CALM, SOFT)]
                 for sel, ts in m.items() if ts}
        wrong = {sel: ts for sel, ts in wrong.items() if ts}
        assert not wrong, wrong
        shape = {sel: [t['prop'] for t in ts if t['duration'] > 0 and t['prop'] in ('width', 'max-width', 'margin', 'transform', 'left', 'top', 'padding', 'border-radius')
                       and t['curve'] != CALM] for sel, ts in m.items() if ts}
        shape = {sel: ts for sel, ts in shape.items() if ts}
        assert not shape, shape
        check('Solo dos curvas: «llegar» para forma y sitio, «aparecer» para opacidad y color')

        # En reposo (lo que rige al cerrar): la forma espera un poco y el contenido se va ya.
        width, buttons = find(m, '#navigator-toolbox', 'width'), find(m, '#back-button', 'opacity')
        rail = find(m, '#zero-rail', 'width')
        assert width['delay'] > 0 and buttons['delay'] == 0 and rail['delay'] > 0, (width, buttons, rail)
        check('Al cerrar, el contenido se va antes que la forma')

        chrome("document.getElementById('navigator-toolbox').setAttribute('zero-island', 'open')")
        m = motion()
        width, buttons = find(m, '#navigator-toolbox', 'width'), find(m, '#back-button', 'opacity')
        assert width['delay'] == 0 and abs(buttons['delay'] - 0.14) < 1e-6, (width, buttons)
        chrome("document.getElementById('navigator-toolbox').removeAttribute('zero-island')")
        check('Al abrir, primero la forma y el contenido 140 ms después')

        # Salir: la web vuelve a su sitio con un viaje (transformación), como al entrar.
        travel = """chrome_travel: { const a = document.getElementById('tabbrowser-tabpanels').getAnimations()
            .find(a => a.effect?.getKeyframes?.().some(k => k.transform && k.transform !== 'none'));
          return a ? { ms: a.effect.getComputedTiming().duration, state: a.playState } : null; }"""
        # (La de entrar dura 720 ms: se espera a que la tarjeta esté quieta.)
        eventually(lambda: chrome("return document.getElementById('tabbrowser-tabpanels').getAnimations().length === 0"), timeout=5)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        out = chrome(travel)
        assert out and out['ms'] > 200, out
        eventually(lambda: chrome("return !document.documentElement.hasAttribute('zero') && !document.getElementById('zero-mark')"), timeout=5)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !!document.getElementById('zero-mark')"), timeout=5)
        check('Al salir de Zero la web vuelve a su sitio viajando, como al entrar')

        chrome("Services.prefs.setIntPref('ui.prefersReducedMotion', 1)")
        eventually(lambda: chrome("return matchMedia('(prefers-reduced-motion: reduce)').matches"), timeout=5)
        def slow():
            found = {sel: [(t['prop'], t['duration'], t['delay']) for t in ts if t['prop'] != 'none' and (t['duration'] > 0.002 or t['delay'] > 0)]
                     for sel, ts in motion().items() if ts}
            return {sel: ts for sel, ts in found.items() if ts}
        # El cambio llega a todos los elementos en el siguiente repintado (con el PC cargado, algo después).
        try:
            eventually(lambda: not slow(), timeout=5)
        except AssertionError:
            raise AssertionError(slow()) from None
        check('Con «reducir movimiento», todo lo de Zero es instantáneo')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
