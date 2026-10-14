"""Espacios en el motor real (perfil temporal, sin ventana en pantalla).

1. De serie hay un espacio («General») y arriba solo se ve el «+» para crear otro.
2. Un espacio nuevo empieza con tu inicio; sus pestañas nuevas son suyas y las del otro
   se ocultan. Se cambia con un clic y con Ctrl+Alt+1…9, y vuelve a la última pestaña usada.
3. Las fijadas se ven en todos. Una pestaña se lleva a otro espacio desde su menú.
4. Al cerrar la última pestaña de un espacio, el espacio se queda con tu inicio.
5. Elegir una pestaña de otro espacio (desde la barra de direcciones, por ejemplo) cambia a él.
6. Con las pestañas a un lado, el selector va abajo en la barra lateral.
7. Al cerrar y volver a abrir Kitsune, cada pestaña sigue en su espacio y la ventana en el suyo.
8. Quitar un espacio deja sus pestañas en el primero, sin perder ninguna.
9. Un grupo de Gecko de otro espacio no se queda a la vista; un espacio puede llevar un emoji;
   «Dormir sus pestañas» duerme las de un espacio.
"""
import argparse
import json
import os
from pathlib import Path
import tempfile
import time

from browser_smoke import WebDriver, prepare_profile, eventually

MODULE = "ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs').KitsuneSpaces"
STATE = f"""const S = {MODULE};
  const visible = [...gBrowser.tabs].filter(t => !t.hidden);
  return {{spaces: S.list().spaces.map(s => s.name), active: S.list().spaces.find(s => s.id === S.active(window))?.name,
          tabs: gBrowser.tabs.length, visible: visible.map(t => t.label), selected: gBrowser.selectedTab.label,
          pinnedVisible: [...gBrowser.tabs].filter(t => t.pinned).every(t => !t.hidden),
          top: [...document.querySelectorAll('#kitsune-spaces-top .kitsune-space')].filter(b => b.getBoundingClientRect().width > 0).length,
          side: document.querySelector('#kitsune-spaces-side')?.getBoundingClientRect().height ?? 0}};"""
KNOWN = {'Correo', 'Notas', 'Música', 'Informe', 'Hoja de cálculo'}
OPEN = """for (const [title, pin] of arguments[0]) {
  const t = gBrowser.addTab('data:text/html;charset=utf-8,<title>' + title + '</title>' + title,
    {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(), skipAnimation: true});
  if (pin) gBrowser.pinTab(t);
}"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-spaces-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    # Esta prueba vuelve a abrir la sesión: se restaura lo que había (las demás pruebas empiezan en blanco).
    # En Cómodo, como el perfil de Risco: Estricto borra la sesión al cerrar y no hay pestañas que restaurar.
    with (profile / 'user.js').open('a') as prefs:
        prefs.write('user_pref("browser.startup.page", 3);\n')
    os.environ['KITSUNE_PRIVACY_MODE'] = 'comodo'
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def state():
        return chrome(STATE)

    def select(label):
        # El título llega cuando carga la página: hasta entonces la pestaña no se llama así.
        eventually(lambda: chrome("return [...gBrowser.tabs].some(t => t.label === arguments[0])", [label]), timeout=10)
        chrome("gBrowser.selectedTab = [...gBrowser.tabs].find(t => t.label === arguments[0])", [label])

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        eventually(lambda: chrome("return !!document.querySelector('#kitsune-spaces-top')"), timeout=15)
        first = state()
        assert first['spaces'] == ['General'] and first['active'] == 'General' and first['top'] == 0, first
        assert chrome("return getComputedStyle(document.querySelector('#kitsune-spaces-top .kitsune-space-add')).display") != 'none'
        check('De serie hay un espacio, «General», y arriba solo se ve el «+»')

        chrome(OPEN, [[['Correo', False], ['Notas', False], ['Música', True]]])
        select('Notas')
        # Crear desde el panel del «+», como lo haría Risco.
        chrome("document.querySelector('#kitsune-spaces-top .kitsune-space-add').click()")
        eventually(lambda: chrome("return document.getElementById('kitsune-space-panel').state") == 'open', timeout=5)
        chrome("""const p = document.getElementById('kitsune-space-panel');
          p.querySelector('input').value = 'Trabajo';
          p.querySelector('[data-color=blue]').click();
          p.querySelector('form').requestSubmit();""")
        eventually(lambda: state()['active'] == 'Trabajo', timeout=10)
        work = state()
        assert work['spaces'] == ['General', 'Trabajo'] and work['top'] == 2, work
        # Música (fijada) y la pestaña nueva con tu inicio; nada de General.
        assert len(work['visible']) == 2 and 'Música' in work['visible'] and work['selected'] not in KNOWN, work
        assert 'Correo' not in work['visible'] and 'Notas' not in work['visible'] and work['pinnedVisible'], work
        chrome(OPEN, [[['Informe', False], ['Hoja de cálculo', False]]])
        select('Informe')
        driver.screenshot('trabajo.png', chrome=True)
        check('Un espacio nuevo empieza con tu inicio y oculta las pestañas del otro; las fijadas se ven en todos')

        chrome("document.getElementById('kitsune-space-key-1').doCommand()")
        eventually(lambda: state()['active'] == 'General', timeout=10)
        general = state()
        assert general['selected'] == 'Notas' and 'Informe' not in general['visible'] and 'Correo' in general['visible'], general
        chrome("document.querySelector('#kitsune-spaces-top .kitsune-space[aria-selected=false]').click()")
        eventually(lambda: state()['active'] == 'Trabajo', timeout=10)
        assert state()['selected'] == 'Informe', state()
        check('Ctrl+Alt+1 y un clic cambian de espacio, y cada uno vuelve a la última pestaña que usaste')

        eventually(lambda: 'Hoja de cálculo' in state()['visible'], timeout=10)
        chrome(f"const S = {MODULE}; return S.moveTab(window, [...gBrowser.tabs].find(t => t.label === 'Hoja de cálculo'), S.list().spaces[0].id)")
        eventually(lambda: 'Hoja de cálculo' not in state()['visible'], timeout=5)
        chrome("document.getElementById('kitsune-space-key-1').doCommand()")
        eventually(lambda: 'Hoja de cálculo' in state()['visible'], timeout=10)
        check('Una pestaña se lleva a otro espacio y aparece allí')

        # En General: elegir una pestaña de Trabajo (como desde «Cambiar a la pestaña») lleva a Trabajo.
        select('Informe')
        eventually(lambda: state()['active'] == 'Trabajo', timeout=10)
        assert 'Correo' not in state()['visible'], state()
        check('Elegir una pestaña de otro espacio cambia a ese espacio')

        # Cerrar todas las de Trabajo: se queda con tu inicio, sin saltar a General.
        chrome("for (const t of [...gBrowser.tabs].filter(t => !t.hidden && !t.pinned)) gBrowser.removeTab(t, {animate: false});")
        time.sleep(1.5)
        closed = state()
        assert closed['active'] == 'Trabajo' and closed['selected'] not in KNOWN and 'Correo' not in closed['visible'], closed
        check('Al cerrar la última pestaña de un espacio, el espacio se queda con tu inicio')

        # Un grupo de pestañas de Gecko entero en otro espacio no se queda a la vista (solo su etiqueta).
        driver.context('chrome')
        groups = driver.script(f"""const done = arguments[0]; (async () => {{
            const S = {MODULE}; const P = Services.scriptSecurityManager.getSystemPrincipal();
            const here = S.active(window);
            const a = gBrowser.addTab('data:text/html,<title>GA</title>', {{triggeringPrincipal: P}});
            const b = gBrowser.addTab('data:text/html,<title>GB</title>', {{triggeringPrincipal: P}});
            const group = gBrowser.addTabGroup([a, b], {{label: 'Grupo', color: 'blue'}});
            const other = S.list().spaces.find(space => space.id !== here).id;
            await S.switchTo(window, other); await new Promise(r => setTimeout(r, 300));
            // <tab-group> es display: contents: lo que se ve es su etiqueta.
            const label = () => (group.labelElement ?? group.querySelector('.tab-group-label')).getBoundingClientRect().width;
            const away = label() === 0;
            await S.switchTo(window, here); await new Promise(r => setTimeout(r, 300));
            const back = label() > 0;
            gBrowser.removeTabGroup(group);
            return {{away, back}};
          }})().then(done, e => done(String(e)));""", [], True)
        assert groups == {'away': True, 'back': True}, groups
        check('Un grupo de pestañas que está en otro espacio no deja su etiqueta a la vista')

        # Un icono para el espacio: se elige en su editor (doble clic) y sale en lugar del punto.
        chrome(f"""const id = {MODULE}.active(window);
          document.querySelector(`#kitsune-spaces-top .kitsune-space[data-space="${{id}}"]`).dispatchEvent(new MouseEvent('dblclick', {{bubbles: true}}));""")
        eventually(lambda: chrome("return document.getElementById('kitsune-space-panel').state") == 'open', timeout=5)
        chrome("""const p = document.getElementById('kitsune-space-panel');
          p.querySelector('[data-icon="💼"]').click(); p.querySelector('form').requestSubmit();""")
        eventually(lambda: chrome("return document.querySelector('#kitsune-spaces-top .kitsune-space[aria-selected=true] .kitsune-space-icon')?.textContent") == '💼', timeout=5)
        assert chrome(f"return {MODULE}.list().spaces.find(s => s.name === 'Trabajo').icon") == '💼'
        assert not chrome("return !!document.querySelector('#kitsune-spaces-top .kitsune-space[aria-selected=true] .kitsune-space-dot')")
        check('Un espacio puede llevar un emoji, que sale en lugar de su punto')

        # «Dormir sus pestañas» (menú del espacio) duerme las de General desde Trabajo.
        asleep = """const M = ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs');
          const general = M.KitsuneSpaces.list().spaces[0].id;
          return [...gBrowser.tabs].filter(t => !t.pinned && M.tabSpace(t) === general && t.linkedBrowser.currentURI.spec.startsWith('data:')).map(t => [t.label, t.hasAttribute('pending')]);"""
        assert not any(pending for _, pending in chrome(asleep)), chrome(asleep)
        chrome(f"""const menu = document.getElementById('kitsune-space-menu');
          menu.dataset.space = {MODULE}.list().spaces[0].id;
          menu.querySelector('[data-action=sleep]').doCommand();""")
        try:
            eventually(lambda: all(pending for _, pending in chrome(asleep)), timeout=10)
        except AssertionError:
            raise AssertionError(f'Siguen despiertas: {chrome(asleep)}; ' + str(chrome("return [...gBrowser.tabs].map(t => [t.label, t.linkedBrowser.isRemoteBrowser, t.linkedBrowser.currentURI.spec.slice(0, 40), t.hidden])")))
        select('Notas')
        eventually(lambda: dict(chrome(asleep)).get('Notas') is False, timeout=10)
        check(f'«Dormir sus pestañas» duerme las {len(chrome(asleep))} de otro espacio, y vuelven al abrirlas')
        chrome("document.getElementById('kitsune-space-key-2').doCommand()")
        eventually(lambda: state()['active'] == 'Trabajo', timeout=10)
        chrome("Services.prefs.setBoolPref('sidebar.verticalTabs', true)")
        eventually(lambda: state()['side'] > 20, timeout=10)
        time.sleep(1)
        driver.screenshot('a-un-lado.png', chrome=True)
        # La barra lateral lleva de fondo la tinta del espacio.
        wash = chrome("return getComputedStyle(document.querySelector('sidebar-main')).backgroundImage")
        assert 'linear-gradient' in wash, wash
        # Dos dedos en horizontal sobre la barra lateral (panel táctil): un espacio por gesto.
        swipe = """const side = document.querySelector('sidebar-main');
          for (const dx of arguments[0]) side.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: 2, deltaMode: 0, bubbles: true, cancelable: true }));"""
        before = state()['active']
        chrome(swipe, [[60, 60, 60, 60, 60]])
        eventually(lambda: state()['active'] != before, timeout=5)
        after = state()['active']
        time.sleep(0.5)
        assert state()['active'] == after, 'un gesto solo cambia una vez'
        time.sleep(0.5)
        chrome(swipe, [[-80, -80]])
        eventually(lambda: state()['active'] == before, timeout=5)
        # La rueda del ratón (líneas) o un gesto casi vertical no cambian de espacio.
        chrome("""const side = document.querySelector('sidebar-main');
          side.dispatchEvent(new WheelEvent('wheel', { deltaX: 3, deltaMode: 1, bubbles: true }));
          side.dispatchEvent(new WheelEvent('wheel', { deltaX: 150, deltaY: 400, deltaMode: 0, bubbles: true }));""")
        time.sleep(0.8)
        assert state()['active'] == before, state()
        chrome("Services.prefs.setBoolPref('sidebar.verticalTabs', false); Services.prefs.clearUserPref('sidebar.revamp')")
        eventually(lambda: state()['side'] == 0, timeout=10)
        check('Con las pestañas a un lado, el selector va abajo, la barra lleva la tinta del espacio y deslizar dos dedos cambia de espacio')

        before = state()
        time.sleep(2)  # que la sesión se escriba (browser.sessionstore.interval = 1 s)
        driver.close(); driver = None
        driver = WebDriver(profile, evidence, browser=args.browser)
        try:
            eventually(lambda: chrome("return gBrowser.tabs.length") >= before['tabs'] - 1 and state()['active'] == 'Trabajo', timeout=25)
        except AssertionError:
            raise AssertionError(f"Tras volver a abrir: {state()} (antes: {before}); "
                                 f"limpiar al cerrar: {chrome('return Services.prefs.getBoolPref(\'privacy.sanitize.sanitizeOnShutdown\', false)')}")
        after = state()
        assert after['spaces'] == ['General', 'Trabajo'], after
        assert 'Correo' not in after['visible'] and 'Notas' not in after['visible'], after
        chrome("document.getElementById('kitsune-space-key-1').doCommand()")
        eventually(lambda: state()['active'] == 'General', timeout=10)
        assert {'Correo', 'Notas', 'Hoja de cálculo'} <= set(state()['visible']), state()
        check('Al cerrar y volver a abrir Kitsune, cada pestaña sigue en su espacio y la ventana en el suyo')

        chrome(f"const S = {MODULE}; return S.remove(S.list().spaces[1].id)")
        eventually(lambda: state()['spaces'] == ['General'], timeout=10)
        gone = state()
        assert gone['active'] == 'General' and gone['top'] == 0 and 'Correo' in gone['visible'], gone
        assert chrome("return [...gBrowser.tabs].every(t => !t.hidden)"), gone
        check('Quitar un espacio deja sus pestañas en el primero, sin perder ninguna')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
