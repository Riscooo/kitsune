"""Kitsune Zero · las reglas de cada sistema (esquinas y pantalla completa), en el motor real y en Linux.

En Linux no hay macOS ni Windows: lo que se prueba aquí es que Zero aplica bien lo que zero-frame pone para cada
uno (el atributo zero-os y --zero-os-radius, que en un Mac o un Windows de verdad salen de Services.appinfo y
Services.sysinfo). Que casen con las ventanas de verdad se mira en un Mac y en un Windows.

1. En Linux, las esquinas de 48 px (las de la regla de niri): el cuerpo y la lámina.
2. Con las de macOS 26 (16 px), el cuerpo, el fondo pintado y la lámina usan las mismas.
3. En macOS, a pantalla completa (el botón verde), Zero sigue: la isla, el raíl y la marca; sin esquinas, la
   lámina sin canto y con la franja de la cámara fundida arriba (Dani, 15-10).
4. Con las de Windows 11 (8 px) y la ventana maximizada, rectas: Windows no redondea una ventana maximizada.

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import json
from pathlib import Path
import tempfile

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness

LOOK = """
const root = document.documentElement, cs = getComputedStyle(root);
const seen = id => { const n = document.getElementById(id); if (!n) return false; const s = getComputedStyle(n), r = n.getBoundingClientRect();
  return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.3 && r.width > 0; };
const { ZeroPane } = ChromeUtils.importESModule('chrome://browser/content/zero/zero-pane.sys.mjs');
return { os: root.getAttribute('zero-os'), radius: cs.getPropertyValue('--zero-win-radius').trim(),
         body: parseFloat(getComputedStyle(document.body).borderTopLeftRadius), bg: parseFloat(getComputedStyle(document.getElementById('zero-bg') ?? document.body).borderTopLeftRadius),
         pane: ZeroPane.look(window), full: !!window.fullScreen,
         island: seen('nav-bar'), rail: seen('zero-rail'), mark: seen('zero-mark') };
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-sistemas-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def look():
        return chrome(LOOK)

    def until(condition, timeout=8):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {look()}') from None

    def system(os, radius):
        # Lo que pondría zero-frame en ese sistema.
        chrome("document.documentElement.setAttribute('zero-os', arguments[0]); document.documentElement.style.setProperty('--zero-os-radius', arguments[1] + 'px'); window.dispatchEvent(new Event('resize'))", [os, radius])

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("Services.prefs.setStringPref('kitsune.zero.backdrop', 'system')")
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: (l := look())['os'] == 'linux' and l['radius'] == '48px' and l['body'] == 48 and l['pane'] and l['pane']['radius'] == 48)
        check('En Linux, las esquinas de 48 px en el cuerpo y en la lámina')

        system('mac', 16)
        until(lambda: (l := look())['radius'] == '16px' and l['body'] == 16 and l['pane']['radius'] == 16 and l['pane']['edge'] == 1)
        chrome("Services.prefs.setStringPref('kitsune.zero.backdrop', 'space')")
        until(lambda: (l := look())['bg'] == 16)
        chrome("Services.prefs.setStringPref('kitsune.zero.backdrop', 'system')")
        check('Con las de macOS 26 (16 px), el cuerpo, el fondo pintado y la lámina usan las mismas')

        chrome("window.fullScreen = true")
        until(lambda: (l := look())['full'] and l['radius'] == '0px' and l['island'] and l['rail'] and l['mark']
              and l['pane']['radius'] == 0 and l['pane']['edge'] == 0 and l['pane']['topShade'] == 96)
        chrome("window.fullScreen = false")
        until(lambda: (l := look())['radius'] == '16px' and not l['full'] and l['pane']['edge'] == 1 and l['pane']['topShade'] == 0)
        check('En macOS, a pantalla completa Zero sigue, sin esquinas ni canto y con la franja de arriba fundida')

        system('windows', 8)
        until(lambda: (l := look())['radius'] == '8px' and l['pane']['radius'] == 8)
        chrome("document.documentElement.setAttribute('sizemode', 'maximized')")
        until(lambda: (l := look())['radius'] == '0px' and l['body'] == 0)
        chrome("document.documentElement.setAttribute('sizemode', 'normal')")
        until(lambda: look()['radius'] == '8px')
        check('Con las de Windows 11 (8 px), y rectas con la ventana maximizada')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
