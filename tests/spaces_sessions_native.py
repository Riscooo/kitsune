"""Espacios con sus propias sesiones, en el motor real (perfil temporal, sin ventana en pantalla).

Risco (15-10): «¿en los perfiles se guardan las sesiones iniciadas en Google y todo?». Un espacio (un perfil
de Zero) puede tener sus propias sesiones: un contenedor solo suyo (sus cookies, su Google, sus inicios de
sesión), con su nombre y su tinta.

1. Con sesiones propias, sus pestañas se reabren en su contenedor (con su nombre); las de los demás, igual.
2. Una pestaña nueva en ese espacio (Ctrl+T) va en su contenedor; y si se queda sin pestañas, la de inicio
   también.
3. Al cambiarle el nombre o la tinta, su contenedor también cambia.
4. Al volver a «compartidas», sus pestañas vuelven a las de todos; y si vuelven a ser propias, es el mismo
   contenedor (con lo que tenía).
5. Al quitar el espacio, su contenedor se queda (sus pestañas, ahora en el primero, siguen con lo suyo).
6. Un enlace que llega de otra app (Discord, el correo…) entra con las sesiones del espacio en el que estás.
"""
import argparse
import json
from pathlib import Path
import tempfile

from browser_smoke import WebDriver, prepare_profile, eventually

MODULE = "ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs').KitsuneSpaces"
IDENTITIES = "ChromeUtils.importESModule('moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs').ContextualIdentityService"
STATE = f"""const S = {MODULE}, I = {IDENTITIES};
  const name = c => c ? I.getPublicIdentityFromId(c)?.name ?? null : null;
  const byId = Object.fromEntries(S.list().spaces.map(s => [s.id, s.name]));
  return {{ active: byId[S.active(window)],
           tabs: [...gBrowser.tabs].filter(t => !t.closing).map(t => ({{ space: byId[ChromeUtils.importESModule('moz-src:///browser/components/sessionstore/SessionStore.sys.mjs').SessionStore.getCustomTabValue(t, 'kitsuneSpace')] ?? 'General', context: t.userContextId, container: name(t.userContextId), url: t.linkedBrowser.currentURI.spec }})),
           sessions: Object.fromEntries(S.list().spaces.map(s => [s.name, S.sessions(s.id)])),
           pref: Services.prefs.getStringPref('kitsune.spaces.sessions', '') }};"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-sesiones-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    with (profile / 'user.js').open('a') as prefs:
        prefs.write('user_pref("privacy.userContext.enabled", true);\n')
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def wait(script, arguments=()):
        driver.context('chrome')
        return driver.script(f"const done = arguments[arguments.length - 1]; Promise.resolve((async () => {{ {script} }})()).then(done, e => done('error: ' + e));", list(arguments), asynchronous=True)

    def state():
        return chrome(STATE)

    def until(condition, timeout=10):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {state()}') from None

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        eventually(lambda: chrome(f"return !!{MODULE}.list().spaces.length"), timeout=15)
        assert chrome(f"return typeof {MODULE}.setSessions") == 'function', 'este Kitsune no sabe de sesiones propias'
        curro = wait(f"return {MODULE}.create({{ name: 'Curro', color: 'blue', user: null }})")
        first = chrome(f"return {MODULE}.list().spaces[0].id")
        wait(f"await {MODULE}.switchTo(window, arguments[0])", [curro])
        until(lambda: (s := state())['active'] == 'Curro' and [t['context'] for t in s['tabs'] if t['space'] == 'Curro'] == [0])
        assert state()['sessions'] == {'General': 'shared', 'Curro': 'shared'}, state()

        assert wait(f"return {MODULE}.setSessions(arguments[0], 'own')", [curro]) is True
        until(lambda: (s := state())['sessions']['Curro'] == 'own'
              and all(t['context'] > 0 and t['container'] == 'Curro' for t in s['tabs'] if t['space'] == 'Curro')
              and all(t['context'] == 0 for t in s['tabs'] if t['space'] == 'General'))
        context = next(t['context'] for t in state()['tabs'] if t['space'] == 'Curro')
        check('Con sesiones propias, sus pestañas van en su contenedor (con su nombre); las de los demás, igual')

        chrome("BrowserCommands.openTab()")
        until(lambda: len([t for t in state()['tabs'] if t['space'] == 'Curro']) == 2)
        assert all(t['context'] == context for t in state()['tabs'] if t['space'] == 'Curro'), state()
        wait(f"await {MODULE}.switchTo(window, arguments[0])", [first])
        chrome("for (const t of [...gBrowser.tabs]) if (t.hidden) gBrowser.removeTab(t, { animate: false })")
        until(lambda: not [t for t in state()['tabs'] if t['space'] == 'Curro'])
        wait(f"await {MODULE}.switchTo(window, arguments[0])", [curro])
        until(lambda: (tabs := [t for t in state()['tabs'] if t['space'] == 'Curro']) and all(t['context'] == context for t in tabs))
        check('Una pestaña nueva en ese espacio va en su contenedor, y la de inicio también')

        wait(f"await {MODULE}.edit(arguments[0], {{ name: 'Oficina', color: 'red' }})", [curro])
        until(lambda: chrome(f"const i = {IDENTITIES}.getPublicIdentityFromId(arguments[0]); return [i.name, i.color]", [context]) == ['Oficina', 'red'])
        check('Al cambiarle el nombre o la tinta, su contenedor también cambia')

        assert wait(f"return {MODULE}.setSessions(arguments[0], 'shared')", [curro]) is True
        until(lambda: (s := state())['sessions']['Oficina'] == 'shared' and all(t['context'] == 0 for t in s['tabs'] if t['space'] == 'Oficina'))
        assert wait(f"return {MODULE}.setSessions(arguments[0], 'own')", [curro]) is True
        until(lambda: all(t['context'] == context for t in state()['tabs'] if t['space'] == 'Oficina'))
        check('Al volver a compartidas, sus pestañas vuelven a las de todos; y si vuelven a ser propias, es el mismo contenedor')

        chrome("gBrowser.selectedTab = [...gBrowser.tabs].find(t => !t.hidden && t.userContextId === arguments[0])", [context])
        chrome("window.browserDOMWindow.openURI(Services.io.newURI('http://127.0.0.1:9/de-otra-app'), null, Ci.nsIBrowserDOMWindow.OPEN_NEWTAB, Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL, Services.scriptSecurityManager.getSystemPrincipal())")
        until(lambda: any(t['url'].endswith('/de-otra-app') or t['url'] == 'about:blank' and t['context'] == context for t in state()['tabs'][-1:]))
        external = chrome("return [...gBrowser.tabs].filter(t => !t.closing).at(-1).userContextId")
        assert external == context, f'el enlace de otra app entró en el contenedor {external}, no en el del espacio ({context})'
        check('Un enlace de otra app entra con las sesiones del espacio en el que estás')

        wait(f"await {MODULE}.remove(arguments[0])", [curro])
        until(lambda: (s := state())['sessions'] == {'General': 'shared'} and curro not in s['pref'])
        assert chrome(f"return !!{IDENTITIES}.getPublicIdentityFromId(arguments[0])", [context]), 'se ha borrado el contenedor'
        check('Al quitar el espacio, su contenedor se queda (con sus pestañas)')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__':
    main()
