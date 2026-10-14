"""Texto del navegador legible con el sistema en oscuro y en claro (motor real, perfil temporal).

Kitsune pinta la interfaz con su papel y su tinta, pero Gecko calcula algunos colores con
light-dark() según el sistema. Cuando Gecko cambia el nombre de una variable (pasó en la 157 con
--tab-text-color-selected y --urlbarview-text-color-selected), el texto vuelve al color del
sistema: blanco sobre papel con el sistema oscuro. Como el motor se actualiza solo, esta prueba
recorre el texto visible de la barra (con una pestaña y los resultados de la barra de direcciones
abiertos), el menú principal y la barra de buscar en la página, con el sistema en oscuro y en
claro antes de que el perfil tenga tema (lo que se ve hasta que el inicio escribe el control del
módulo nativo, que desde entonces fuerza el esquema al del tema), y con los temas Claro y Oscuro
ya aplicados. Exige un contraste de al menos 3:1 con el fondo que tiene detrás.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time

from browser_smoke import ROOT, WebDriver, eventually, prepare_profile

sys.path.insert(0, str(ROOT / 'install'))
from appearance import PAPEL, SUMI  # noqa: E402  (las paletas de Claro y Oscuro, de una sola fuente)

MINIMUM = 3.0

# Texto de nodos y de <label value> (XUL), con su fondo opaco más cercano hacia arriba.
AUDIT = r"""
const [where] = arguments;
const parse = color => {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const [r, g, b, a = 1] = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return {r, g, b, a};
};
const luminance = ({r, g, b}) => {
  const channel = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const backgroundOf = element => {
  for (let e = element; e && e.nodeType === 1; e = e.parentElement || e.getRootNode()?.host) {
    const color = parse(getComputedStyle(e).backgroundColor);
    if (color && color.a > 0.5) return color;
  }
  return null;
};
const texts = rootNode => {
  const list = [];
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) list.push([node.textContent.trim(), node.parentElement]);
  for (const label of rootNode.querySelectorAll('label[value], description[value]')) list.push([label.getAttribute('value').trim(), label]);
  for (const host of rootNode.querySelectorAll('*')) if (host.shadowRoot) list.push(...texts(host.shadowRoot));
  return list;
};
const roots = {toolbox: 'navigator-toolbox', menu: 'appMenu-popup', sidebar: 'sidebar-container', find: null};
const rootNode = where === 'find' ? gFindBar : document.getElementById(roots[where]);
const low = [];
let checked = 0;
for (const [text, element] of texts(rootNode)) {
  if (text.length < 2 || !element) continue;
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  if (box.width < 2 || box.height < 2 || style.visibility !== 'visible' || Number(style.opacity) < 0.3) continue;
  const fg = parse(style.color), bg = backgroundOf(element);
  if (!fg || !bg) continue;
  const [light, dark] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  const ratio = (light + 0.05) / (dark + 0.05);
  checked++;
  if (ratio < MINIMUM) low.push({text: text.slice(0, 40), ratio: Number(ratio.toFixed(2)), color: style.color,
                                 background: `rgb(${bg.r}, ${bg.g}, ${bg.b})`, element: element.className || element.localName});
}
return {checked, low};
""".replace('MINIMUM', str(MINIMUM))


def theme_control(theme):
    """El control que escribe «Tu inicio» (appearance.py) para ese tema, tal cual lo lee el módulo nativo."""
    value = {'version': 6, 'palette': SUMI if theme == 'oscuro' else PAPEL, 'motion': True, 'googleRemember': False,
             'theme': theme, 'background': None, 'windowControls': 'izquierda', 'brand': True,
             'performance': 'normal', 'ramLimit': 2048, 'minimize': True}
    value['fingerprint'] = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
    return value


def audit(browser, system_dark, theme, evidence):
    """Sin `theme`, un perfil sin tema todavía con el sistema en oscuro o en claro; con él, ese tema aplicado."""
    root = Path(tempfile.mkdtemp(prefix='kitsune-contrast-'))
    profile, _ = prepare_profile(root)
    with (profile / 'user.js').open('a') as prefs:
        prefs.write(f'user_pref("ui.systemUsesDarkTheme", {1 if system_dark else 0});\n')
    if theme:
        (profile / 'chrome').mkdir(exist_ok=True)
        (profile / 'chrome/kitsune-appearance.json').write_text(json.dumps(theme_control(theme)))
    driver = WebDriver(profile, evidence, browser=browser, headed=True)
    results = {}
    try:
        driver.context('chrome')
        if theme:
            # El módulo aplica la paleta del tema y lleva el esquema de Gecko al del tema.
            bg = (SUMI if theme == 'oscuro' else PAPEL)['bg']
            eventually(lambda: driver.script("return getComputedStyle(document.documentElement).getPropertyValue('--kb-bg').trim()") == bg,
                       timeout=15)
            eventually(lambda: driver.script("return matchMedia('(prefers-color-scheme: dark)').matches") == (theme == 'oscuro'), timeout=15)
        else:
            assert driver.script("return matchMedia('(prefers-color-scheme: dark)').matches") == system_dark
        driver.script("gURLBar.focus(); gURLBar.value = 'kitsune'; gURLBar.startQuery();")
        time.sleep(1.5)
        results['toolbox'] = driver.script(AUDIT, ['toolbox'])
        driver.script("gURLBar.view.close(); PanelUI.show();")
        # Con el PC cargado (justo después de compilar el motor) el menú tarda más de 1,5 s en abrirse.
        eventually(lambda: driver.script("return PanelUI.panel.state") == 'open', timeout=15)
        time.sleep(0.5)
        results['menu'] = driver.script(AUDIT, ['menu'])
        driver.script("PanelUI.hide(); gLazyFindCommand('onFindCommand');")
        time.sleep(1.5)
        results['find'] = driver.script(AUDIT, ['find'])
    finally:
        driver.close()
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    evidence = Path(tempfile.mkdtemp(prefix='kitsune-contrast-evidence-'))
    report = {}
    cases = (('sin tema todavía y el sistema oscuro', True, None), ('sin tema todavía y el sistema claro', False, None),
             ('con el tema Claro (sistema oscuro)', True, 'claro'), ('con el tema Oscuro (sistema claro)', False, 'oscuro'))
    for name, dark, theme in cases:
        results = audit(args.browser, dark, theme, evidence)
        report[name] = results
        for where, result in results.items():
            assert result['checked'] > 0, f'{name}, {where}: no se ha revisado ningún texto'
            assert not result['low'], f'{name}, {where}: texto con poco contraste: {result["low"]}'
        total = sum(result['checked'] for result in results.values())
        print(f'PASS {name[0].upper() + name[1:]}: los {total} textos de la barra, el menú y buscar se leen (≥ {MINIMUM:g}:1)', flush=True)
    (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(evidence, flush=True)


if __name__ == '__main__':
    main()
