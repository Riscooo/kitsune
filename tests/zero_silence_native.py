"""Kitsune Zero · el silencio, en el motor real (perfil temporal, sin ventana en pantalla).

1. Apagado de serie: en los ajustes solo sale el interruptor «Silencio» (con lo que ya hace Kitsune).
2. Encendido salen «Avisos en silencio», «Webs vetadas» (con su lista), «Solo currar» y «Aviso de
   scroll infinito».
3. Avisos: con el pomodoro trabajando se pone el «no molestar»; en el descanso se quita; al apagar el
   silencio queda como estaba.
4. Webs vetadas: durante el trabajo una web de la lista sale tapada por un cristal con su dominio, y
   la isla lo dice; mantener 1,5 s deja entrar.
5. En el descanso no se tapa; con «Solo currar», sí (y con el descanso estricto, solo sale su cristal).
6. Tras 10 min bajando en la misma página, la isla avisa.

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
from PIL import Image

MIN = 60_000


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(b'<!doctype html><meta charset=utf-8><title>Web</title><body style="margin:0;height:4000px"><h1>Una web</h1>')

    def log_message(self, *args):
        pass


STATE = """
const seen = el => !!el && el.getBoundingClientRect().width > 2 && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0.5;
const box = el => { const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
const blocked = document.getElementById('zero-blocked');
let dnd = null; try { dnd = Cc['@mozilla.org/alerts-service;1'].getService(Ci.nsIAlertsService).QueryInterface(Ci.nsIAlertsDoNotDisturb).manualDoNotDisturb; } catch {}
return {
  rows: [...document.querySelectorAll('#zero-settings .zero-row')].map(r => r.textContent.trim()),
  dnd, alert: document.getElementById('navigator-toolbox').hasAttribute('zero-island-alert') ? document.getElementById('zero-island-msg').textContent.trim() : '',
  blocked: blocked ? { seen: seen(blocked), text: blocked.textContent.replace(/\\s+/g, ' ').trim(), box: box(blocked) } : null,
  card: box(document.getElementById('tabbrowser-tabpanels')),
  phase: document.getElementById('zero-pomo')?.getAttribute('phase') ?? null,
};
"""
CLOCK = "ChromeUtils.importESModule('chrome://browser/content/zero/zero-pomodoro.sys.mjs').clock"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-silencio-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_port
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=()):
        driver.context('chrome'); return driver.script(script, list(arguments))

    def state():
        return chrome(STATE)

    def until(condition, timeout=6):
        try:
            return eventually(condition, timeout=timeout)
        except AssertionError as error:
            raise AssertionError(f'{error} · {state()}') from None

    def element(selector):
        driver.context('chrome')
        return list(driver.command('POST', '/element', {'using': 'css selector', 'value': selector}).values())[0]

    def click(selector):
        driver.context('chrome')
        driver.command('POST', f'/element/{element(selector)}/click', {})

    def forward(ms):
        chrome(f"const c = {CLOCK}; const before = c.now; c.now = () => before() + arguments[0];", [ms])
        time.sleep(1.3)

    def pref(kind, name, value):
        chrome(f"Services.prefs.set{kind}Pref(arguments[0], arguments[1])", [name, value])

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(f'http://127.0.0.1:{port}/')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        until(lambda: chrome("return !!document.getElementById('zero-mark')"))
        before_dnd = state()['dnd']

        click('#zero-mark')
        # Que acabe de abrirse (con la hoja aún creciendo, el clic cae en otro sitio).
        until(lambda: any(r.startswith('Silencio') for r in state()['rows']) and chrome("return getComputedStyle(document.getElementById('zero-settings')).opacity") == '1')
        rows = state()['rows']
        silence = next(r for r in rows if r.startswith('Silencio'))
        # Su explicación (que lo de las cookies y el autoplay ya lo hace Kitsune) va en su «i».
        why = chrome("return document.querySelector('#zero-settings [data-pref=silence]').closest('.zero-row').querySelector('.zero-info')?.getAttribute('aria-label') ?? ''")
        assert silence.startswith('Silencio') and 'Kitsune' in why and not any(r.startswith(('Avisos', 'Webs vetadas', 'Solo currar', 'Aviso de scroll')) for r in rows), rows
        check('Apagado de serie: solo el interruptor «Silencio», con lo que ya hace Kitsune')

        click('#zero-settings [data-pref="silence"]')
        until(lambda: all(any(r.startswith(name) for r in state()['rows']) for name in ('Avisos en silencio', 'Webs vetadas', 'Solo currar', 'Aviso de scroll')))
        assert chrome("return !!document.querySelector('#zero-settings input[data-pref=\"silence.blocked\"]')")
        driver.context('chrome')
        driver.command('POST', f"/element/{element('#zero-settings input[data-pref=\"silence.blocked\"]')}/value", {'text': 'localhost, 127.0.0.1.nip.io\ue007'})  # \ue007: Intro
        until(lambda: 'localhost' in chrome("return Services.prefs.getStringPref('kitsune.zero.silence.blocked', '')"))
        chrome("document.getElementById('zero-mark').click()")
        check('Encendido salen avisos, webs vetadas (con su lista), solo currar y aviso de scroll')

        pref('Bool', 'kitsune.zero.pomodoro', True)
        until(lambda: chrome("return !!document.getElementById('zero-pomo')"))
        click('#zero-pomo .zero-pomo-ring')
        until(lambda: state()['dnd'] is True)
        forward(25 * MIN + 2000)
        until(lambda: state()['phase'] == 'short' and state()['dnd'] == before_dnd)
        check('Avisos: el «no molestar» se pone mientras se trabaja y se quita en el descanso')

        driver.navigate(f'http://localhost:{port}/feed')
        time.sleep(1.5)
        assert not (state()['blocked'] and state()['blocked']['seen']), state()
        check('En el descanso, una web vetada no se tapa')

        forward(5 * MIN + 2000)
        until(lambda: state()['phase'] == 'waiting')
        click('#zero-pomo .zero-pomo-ring')
        until(lambda: state()['blocked'] and state()['blocked']['seen'] and 'localhost' in state()['blocked']['text'])
        # El cristal entra con su animación (escala 0,985 → 1): se mide cuando ya ha llegado.
        until(lambda: (s := state())['blocked'] and abs(s['blocked']['box']['x'] - s['card']['x']) <= 1 and abs(s['blocked']['box']['w'] - s['card']['w']) <= 1)
        until(lambda: 'localhost' in state()['alert'] and 'vetada' in state()['alert'])
        # Se lee: sobre una web blanca, el fondo de la tarjeta queda oscuro para el texto blanco (≥ 4,5:1).
        time.sleep(0.8)
        panel = chrome("const r = document.querySelector('#zero-blocked .zero-break-panel').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, devicePixelRatio]")
        shot = Image.open(driver.screenshot('vetada.png', chrome=True)).convert('RGB')
        k = panel[4]
        # Una franja del fondo de la tarjeta, sin texto: justo bajo su borde de arriba.
        strip = shot.crop((int((panel[0] + 40) * k), int((panel[1] + 8) * k), int((panel[2] - 40) * k), int((panel[1] + 18) * k)))
        def lum(c):
            v = [x / 255 for x in c]
            v = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in v]
            return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
        values = sorted(lum(c) for c in strip.getdata())
        background = values[len(values) // 2]
        ratio = 1.05 / (background + 0.05)
        assert ratio >= 4.5, f'contraste del texto blanco sobre la tarjeta de web vetada: {ratio:.1f}:1'
        driver.context('chrome')
        hold = element('#zero-blocked .zero-hold')
        driver.command('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'raton', 'parameters': {'pointerType': 'mouse'}, 'actions': [
            {'type': 'pointerMove', 'origin': {'element-6066-11e4-a52e-4f735466cecf': hold}, 'x': 0, 'y': 0}, {'type': 'pointerDown', 'button': 0},
            {'type': 'pause', 'duration': 1800}, {'type': 'pointerUp', 'button': 0}]}]})
        until(lambda: not (state()['blocked'] and state()['blocked']['seen']))
        check('Webs vetadas: durante el trabajo, tapadas con su dominio y aviso (que se lee); mantener 1,5 s deja entrar')

        chrome("ChromeUtils.importESModule('chrome://browser/content/zero/zero-silence.sys.mjs').forgetAllowed()")
        pref('Bool', 'kitsune.zero.silence.onlyWork', True)
        forward(25 * MIN + 2000)
        until(lambda: state()['phase'] == 'short' and state()['blocked'] and state()['blocked']['seen'])
        # Con el descanso estricto, su cristal ya tapa la web: no salen los dos.
        pref('String', 'kitsune.zero.pomodoro.break', 'strict')
        until(lambda: chrome("return !!document.getElementById('zero-break')") and state()['blocked'] is None)
        pref('String', 'kitsune.zero.pomodoro.break', 'soft')
        until(lambda: state()['blocked'] and state()['blocked']['seen'])
        pref('Bool', 'kitsune.zero.silence.onlyWork', False)
        until(lambda: not (state()['blocked'] and state()['blocked']['seen']))
        check('Con «Solo currar», vetadas también en el descanso')

        driver.navigate(f'http://127.0.0.1:{port}/larga')
        time.sleep(1)
        chrome(f"""const c = {CLOCK}; const base = c.now(); const browser = gBrowser.selectedBrowser;
            for (let i = 0; i <= 640; i++) {{ c.now = () => base + i * 1000; window.dispatchEvent(new CustomEvent('zero-scroll', {{ detail: {{ browser }} }})); }}""")
        until(lambda: 'bajando' in state()['alert'])
        check('Tras 10 min bajando en la misma página, la isla avisa')

        pref('Bool', 'kitsune.zero.silence', False)
        until(lambda: state()['dnd'] == before_dnd and state()['blocked'] is None)
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
