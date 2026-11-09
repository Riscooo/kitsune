"""Kitsune Zero · tus estadísticas, en el motor real (perfil temporal, sin ventana en pantalla).

Risco (9-11): «un dashboard de tus estadísticas con el navegador, dónde te has pasado más tiempo, cuántas búsquedas
has hecho, y que se vea en qué gastas más tiempo».

1. La pastilla va en la columna, justo después de los accesos directos.
2. El tiempo se cuenta para la web que se ve (su dominio) y las búsquedas, por la página de resultados del buscador.
3. El panel enseña el tiempo, las búsquedas y las webs, la lista de dónde y en qué; con 7 días, una barra por día.
4. «Pausar» deja de contar; «Borrar» (dos clics) lo deja a cero; lo contado se guarda en el perfil.
5. Sin Zero no queda nada.

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import http.server
import json
from pathlib import Path
import tempfile
import threading

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'<!doctype html><meta charset=utf-8><title>Zorros</title><h1>Una web de zorros</h1>'
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


STATS = "ChromeUtils.importESModule('chrome://browser/content/zero/zero-stats.sys.mjs')"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-stats-'))
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

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/')
        eventually(lambda: chrome("return !!document.getElementById('kitsune-zero-key')"), timeout=10)
        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !!document.getElementById('zero-stats-pill')"), timeout=5)

        order = chrome("return [...document.getElementById('zero-dock').children].map(n => n.id)")
        assert order.index('zero-stats-pill') == order.index('zero-shortcuts') + 1, order
        check('La pastilla de las estadísticas va en la columna, justo después de los accesos directos')

        eventually(lambda: chrome(f"return !!{STATS}._debug.data()"), timeout=5)
        for _ in range(4):
            chrome(f"{STATS}._debug.tick(window)")
        chrome(f"""const {{ _debug, searchService }} = {STATS};
            return searchService().init().then(() => searchService().getDefault()).then(engine => {{
              const url = engine.getSubmission('zorros árticos').uri;
              _debug.visited(window, url); _debug.visited(window, url);
            }});""")
        day = chrome(f"""const d = {STATS}._debug.data(); const k = Object.keys(d.days).sort().at(-1); return d.days[k];""")
        assert day['sites'].get('127.0.0.1', 0) >= 20, day
        assert day['searches'] == 1, day
        assert day['pages'] >= 2, day
        check('Se cuenta el tiempo de la web que se ve y una búsqueda por cada página de resultados (no dos por la misma)')

        chrome("document.querySelector('.zero-stats-button').click()")
        eventually(lambda: chrome("return document.getElementById('zero-stats').hasAttribute('open')"), timeout=5)
        look = chrome("""const p = document.getElementById('zero-stats'); const r = p.getBoundingClientRect();
            const dock = document.getElementById('zero-dock').getBoundingClientRect();
            return { figures: [...p.querySelectorAll('.zero-stats-figure b')].map(b => b.textContent),
                     sites: [...p.querySelectorAll('.zero-stats-list .zero-stats-name')].map(n => n.textContent),
                     left: r.left, dockRight: dock.right, opacity: Number(getComputedStyle(p).opacity), w: r.width,
                     daysHidden: p.querySelector('.zero-stats-days').parentNode.hidden };""")
        assert look['figures'][1] == '1' and int(look['figures'][2]) >= 2, look
        assert '127.0.0.1' in look['sites'] and 'Otras' in look['sites'], look
        assert look['left'] >= look['dockRight'] + 4 and look['w'] > 280 and look['daysHidden'], look
        check('El panel sale junto a la columna con el tiempo, las búsquedas, las webs, dónde y en qué')

        chrome("document.querySelector('#zero-stats [data-span=\"7\"]').click()")
        eventually(lambda: chrome("return document.querySelectorAll('#zero-stats .zero-stats-day').length") == 7, timeout=5)
        assert chrome("return Services.prefs.getStringPref('kitsune.zero.stats.span')") == '7'
        check('Con «7 días», una barra por día (y lo recuerda)')

        chrome("document.querySelector('#zero-stats footer .zero-stats-action').click()")  # Pausar
        assert chrome("return Services.prefs.getBoolPref('kitsune.zero.stats')") is False
        before = chrome(f"const d = {STATS}._debug.data(); const k = Object.keys(d.days).sort().at(-1); return d.days[k].sites['127.0.0.1'];")
        chrome(f"{STATS}._debug.tick(window)")
        after = chrome(f"const d = {STATS}._debug.data(); const k = Object.keys(d.days).sort().at(-1); return d.days[k].sites['127.0.0.1'];")
        assert before == after, (before, after)
        chrome("Services.prefs.setBoolPref('kitsune.zero.stats', true)")
        check('«Pausar» deja de contar')

        chrome(f"return {STATS}._debug.save()")
        saved = json.loads(Path(chrome(f"return {STATS}._debug.file()")).read_text())
        assert any('127.0.0.1' in d['sites'] for d in saved['days'].values()), saved
        clear = "document.querySelectorAll('#zero-stats footer .zero-stats-action')[1].click()"
        chrome(clear)
        assert chrome(f"const d = {STATS}._debug.data(); return Object.keys(d.days).length") > 0  # el primer clic solo pregunta
        chrome(clear)
        eventually(lambda: chrome(f"const d = {STATS}._debug.data(); return Object.keys(d.days).length") == 0, timeout=5)
        eventually(lambda: json.loads(Path(chrome(f"return {STATS}._debug.file()")).read_text())['days'] == {}, timeout=5)
        check('Lo contado se guarda en el perfil y «Borrar» (dos clics) lo deja a cero')

        chrome("document.getElementById('kitsune-zero-key').doCommand()")
        eventually(lambda: chrome("return !document.getElementById('zero-stats') && !document.getElementById('zero-stats-pill')"), timeout=5)
        check('Sin Zero no queda nada de esto')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
