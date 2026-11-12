"""Kitsune Zero · el lobo y su panel (el asistente con el Claude de quien lo usa), en el motor real (perfil temporal,
sin ventana en pantalla). Con un `claude` falso (tests/fixtures/claude_falso.py): no gasta nada.

Risco (9-11): «yo cojo mi Claude y lo meto como asistente dentro de Kitsune Zero… el lobo de mascota pero rollo 16 bit,
con animaciones… los ajustes, un engranaje, y el botón del lobo, el asistente… que se te abra a la derecha o izquierda…
que puedas modificar el espacio que te ocupa… y un botón para ocultarlo».

1. En la columna: el engranaje (ajustes) y, debajo, el lobo (un lienzo de pixel art que se mueve solo).
2. Un clic en el lobo abre su panel a la derecha, en columna, y la web se aparta; en la esquina flota encima; en
   «Pestaña» ocupa la web; a la izquierda, junto a la columna.
3. Se estira desde su borde (y lo recuerda); «Ocultar el asistente» lo quita de la columna y vuelve desde los ajustes.
   Ningún texto a la vista dice «lobo»: se ve el dibujo y basta.
4. Sin Claude Code, el panel dice cómo instalarlo.
5. Con Claude (el falso): la respuesta llega a trozos y se pinta (markdown sin HTML), lo que hace sale en una línea,
   el lobo cambia de animación, Claude lo anima por el MCP y crea una animación nueva que se guarda en el perfil.
6. Sin Zero no queda nada.

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import http.server
import json
import os
from pathlib import Path
import sys
import tempfile
import threading

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness

FAKE = Path(__file__).resolve().parent / 'fixtures' / 'claude_falso.py'


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = '<!doctype html><meta charset=utf-8><title>Zorros árticos</title><h1>Zorros árticos</h1><p>Viven en el Ártico y cambian de pelaje.</p>'.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


LOOK = """const ia = document.getElementById('zero-ia'); const dock = document.getElementById('zero-dock');
const wolf = document.getElementById('zero-wolf'); const mark = document.getElementById('zero-mark');
const card = document.getElementById('tabbrowser-tabpanels').getBoundingClientRect(); const r = ia.getBoundingClientRect();
return { pills: [...dock.children].map(n => n.id), wolfHidden: wolf?.hidden ?? null, gear: !!mark?.querySelector('.zero-gear'),
         canvas: wolf?.querySelector('canvas') ? { w: wolf.querySelector('canvas').width, h: wolf.querySelector('canvas').height } : null,
         open: ia.hasAttribute('open'), side: ia.getAttribute('side'), shape: ia.getAttribute('shape'), opacity: Number(getComputedStyle(ia).opacity),
         panel: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height },
         card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom }, W: innerWidth, H: innerHeight,
         noClaude: ia.hasAttribute('no-claude'), install: getComputedStyle(ia.querySelector('.zero-ia-install')).display !== 'none' };"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-lobo-'))
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

    def look():
        return chrome(LOOK)

    def until(condition, timeout=6):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {look()}') from None

    def click(selector):
        driver.context('chrome')
        element = driver.command('POST', '/element', {'using': 'css selector', 'value': selector})
        driver.command('POST', f"/element/{list(element.values())[0]}/click", {})

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !!document.getElementById('zero-wolf')"), timeout=5)

        until(lambda: (l := look())['pills'][-2:] == ['zero-mark', 'zero-wolf'] and l['gear'] and l['canvas'] and l['canvas']['w'] >= 24)
        frames = set()
        for _ in range(30):  # el «quieto» del icono parpadea cada ~5 s
            frames.add(chrome("return document.querySelector('#zero-wolf canvas').toDataURL()"))
            if len(frames) >= 2: break
            chrome("return new Promise(r => setTimeout(r, 250))")
        assert len(frames) >= 2, 'el lobo de la columna no se mueve'
        check('En la columna, el engranaje de los ajustes y debajo el lobo, que se mueve solo')

        before = look()['card']
        click('#zero-wolf')
        until(lambda: (l := look())['open'] and l['opacity'] > 0.95 and l['side'] == 'right' and l['shape'] == 'column')
        l = look()
        assert l['panel']['right'] > l['W'] - 20 and l['panel']['w'] >= 300, l
        until(lambda: (l := look())['card']['right'] <= l['panel']['left'] + 1 and l['card']['right'] < before['right'] - 250)
        check('Un clic en el lobo abre su panel a la derecha, en columna, y la web se aparta para dejarle sitio')

        # Risco (12-11): «que solo salga el lobo pero que no ponga nada de lobo»: ni en el panel ni en los ajustes.
        con_lobo = chrome("""
          const textos = [];
          for (const raiz of [document.getElementById('zero-ia'), document.getElementById('zero-wolf'), document.getElementById('zero-settings')]) {
            if (!raiz) continue;
            textos.push(raiz.textContent);
            for (const el of [raiz, ...raiz.querySelectorAll('*')]) for (const a of ['title', 'aria-label', 'placeholder']) textos.push(el.getAttribute(a) ?? '');
          }
          return textos.filter(texto => /lobo|wolf/i.test(texto)).map(texto => texto.trim().slice(0, 80));
        """)
        assert con_lobo == [], con_lobo
        check('Ningún texto del panel, del botón ni de los ajustes dice «lobo»: solo se ve el dibujo')

        click('#zero-ia .zero-ia-shapes [data-shape="corner"]')
        until(lambda: (l := look())['shape'] == 'corner' and abs(l['card']['right'] - before['right']) <= 1 and l['panel']['h'] < l['H'] - 100)
        click('#zero-ia .zero-ia-shapes [data-shape="tab"]')
        until(lambda: (l := look())['shape'] == 'tab' and abs(l['panel']['left'] - l['card']['left']) <= 2 and abs(l['panel']['right'] - l['card']['right']) <= 2)
        click('#zero-ia .zero-ia-shapes [data-shape="column"]')
        click('#zero-ia .zero-ia-side')
        until(lambda: (l := look())['side'] == 'left' and l['panel']['left'] >= 44 and l['card']['left'] >= l['panel']['right'] - 1)
        click('#zero-ia .zero-ia-side')
        until(lambda: look()['side'] == 'right')
        check('En la esquina flota encima, en «Pestaña» ocupa la web y a la izquierda va junto a la columna')

        width = look()['panel']['w']
        driver.context('chrome')
        grip = driver.command('POST', '/element', {'using': 'css selector', 'value': '#zero-ia .zero-ia-grip-w'})
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [
            {'type': 'pointerMove', 'origin': grip, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0},
            {'type': 'pointerMove', 'origin': grip, 'x': -60, 'y': 0, 'duration': 120},
            {'type': 'pointerMove', 'origin': grip, 'x': -120, 'y': 0, 'duration': 120}, {'type': 'pointerUp', 'button': 0}]}]})
        driver.command('DELETE', '/actions')
        until(lambda: look()['panel']['w'] > width + 100)
        saved = int(chrome("return Services.prefs.getStringPref('kitsune.zero.ia.width')"))
        assert saved > width + 100, saved
        until(lambda: (l := look())['card']['right'] <= l['panel']['left'] + 1)
        check('Se estira desde su borde (lo recuerda) y la web se aparta lo que haga falta')

        click('#zero-ia .zero-ia-hide')
        until(lambda: (l := look())['wolfHidden'] and not l['open'])
        assert chrome("return Services.prefs.getBoolPref('kitsune.zero.ia.shown')") is False
        until(lambda: abs(look()['card']['right'] - before['right']) <= 1)
        chrome("Services.prefs.setBoolPref('kitsune.zero.ia.shown', true)")
        until(lambda: look()['wolfHidden'] is False)
        check('«Ocultar el asistente» lo quita de la columna (y la web vuelve a su sitio); vuelve desde los ajustes')

        chrome("Services.prefs.setStringPref('kitsune.zero.ia.claude', '/no/existe/claude')")
        click('#zero-wolf')
        until(lambda: (l := look())['open'] and l['noClaude'] and l['install'])
        check('Sin Claude Code, el panel dice cómo instalarlo')

        # Con el claude falso.
        chrome("Services.prefs.setStringPref('kitsune.zero.ia.claude', arguments[0])", [str(FAKE)])
        until(lambda: not look()['noClaude'])
        chrome("""const box = document.querySelector('#zero-ia .zero-ia-input'); box.value = 'Resúmeme esta página';
                  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));""")
        talk = """const ia = document.getElementById('zero-ia');
            return { me: [...ia.querySelectorAll('.zero-ia-yo')].map(n => n.textContent), claude: [...ia.querySelectorAll('.zero-ia-claude')].map(n => n.textContent),
                     strong: ia.querySelectorAll('.zero-ia-claude strong').length, scripts: ia.querySelectorAll('.zero-ia-claude script, .zero-ia-claude img').length,
                     tools: [...ia.querySelectorAll('.zero-ia-tool')].map(n => n.textContent), busy: ia.hasAttribute('busy'),
                     status: ia.querySelector('.zero-ia-status').textContent };"""
        try:
            eventually(lambda: (c := chrome(talk))['me'] == ['Resúmeme esta página'] and any('Zorros' in text for text in c['claude']) and not c['busy'], timeout=20)
        except AssertionError as error:
            raise AssertionError(f'{error} · {chrome(talk)}') from None
        c = chrome(talk)
        assert c['strong'] >= 1 and c['scripts'] == 0, c
        assert any('Leyendo la página' in tool for tool in c['tools']), c
        check('Con Claude, la respuesta llega a trozos y se pinta (markdown, sin HTML), y lo que hace sale en una línea')

        own = Path(chrome("return PathUtils.join(Services.dirsvc.get('ProfD', Ci.nsIFile).path, 'kitsune-zero-lobo', 'animaciones.json')"))
        until(lambda: own.is_file(), timeout=20)
        saved = json.loads(own.read_text())
        assert 'animaciones' in saved and saved['animaciones'], saved
        check('Claude anima al lobo por el MCP y se dibuja una animación nueva, que se guarda aparte en el perfil')

        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !document.getElementById('zero-ia') && !document.getElementById('zero-wolf')"), timeout=5)
        check('Sin Zero no queda nada de esto')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
