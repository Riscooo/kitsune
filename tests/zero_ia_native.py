"""Kitsune Zero · el asistente (Claude Code dentro de Zero), en el motor real (perfil temporal, sin ventana en
pantalla y sin sonido).

1. El servidor MCP (zero-ia-mcp) solo atiende con el token, sin Origin ni Sec-Fetch (lo que manda una web) y con
   nuestro Host; GET, cuerpos enormes y JSON roto, fuera. Habla MCP con un cliente en Python: initialize,
   notifications/initialized, tools/list y tools/call.
2. Las herramientas del navegador (zero-ia-herramientas y su actor zero-ia-child): listar, abrir (solo http y
   https), ir, cerrar, leer una web local (texto visible, sin lo oculto, recortado a 40 000) y su selección, buscar
   con el buscador de serie y el historial; las del lobo reenvían y devuelven sus errores.
3. El puente (zero-ia-claude) con un `claude` falso (tests/fixtures/claude_falso.py) que habla stream-json y llama
   de verdad al servidor MCP: los eventos de un turno, con qué argumentos se lanza (aislado de la configuración de
   la persona), parar a media respuesta, relanzar con --resume si muere y cerrar.
4. Con --claude-de-verdad, una vez con el `claude` de la persona y el modelo más barato (haiku): que conteste y que
   use pestanas_listar por el servidor MCP. Gasta de su cuenta: no se repite sin necesidad.

--zero-del-repo: Zero sale de zero/ del repositorio (ver zero_harness.py).
"""
import argparse
import http.client
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlparse

from browser_smoke import WebDriver, prepare_profile, eventually
import zero_harness

FALSO = Path(__file__).resolve().parent / 'fixtures/claude_falso.py'
INSTRUCCIONES = 'Eres el lobo de Kitsune. Contesta en español y muy breve.'


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/buscar':
            q = parse_qs(url.query).get('q', [''])[0]
            page = f'<!doctype html><meta charset=utf-8><title>Resultados de {q}</title><p>Resultados para {q}</p>'
        elif url.path == '/dos':
            page = '<!doctype html><meta charset=utf-8><title>Liebres</title><h1>Liebres del prado</h1>'
        elif url.path == '/larga':
            page = '<!doctype html><meta charset=utf-8><title>Larga</title><p>' + 'zorro ' * 20000 + '</p>'
        else:
            page = ('<!doctype html><meta charset=utf-8><title>Zorros del bosque</title><h1>Zorros del bosque</h1>'
                    '<p id=sel>El zorro rojo vive en el bosque.</p><p style="display:none">SECRETO OCULTO</p>')
        data = page.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class Mcp:
    """Un cliente MCP mínimo (Streamable HTTP, respuestas JSON) para hablar con el servidor de Kitsune."""

    def __init__(self, puerto, token):
        self.puerto, self.token, self.ident = puerto, token, 0

    def http(self, cuerpo, *, token=True, cabeceras=None, metodo='POST', ruta='/mcp'):
        conexion = http.client.HTTPConnection('127.0.0.1', self.puerto, timeout=60)
        datos = cuerpo if isinstance(cuerpo, bytes) else json.dumps(cuerpo).encode()
        todas = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}
        if token:
            todas['Authorization'] = f'Bearer {self.token if token is True else token}'
        todas.update(cabeceras or {})
        conexion.request(metodo, ruta, body=datos if metodo == 'POST' else None, headers=todas)
        respuesta = conexion.getresponse()
        crudo = respuesta.read()
        conexion.close()
        tipo = respuesta.getheader('Content-Type') or ''
        return respuesta.status, dict(respuesta.getheaders()), (json.loads(crudo) if crudo and 'json' in tipo else crudo.decode())

    def pedir(self, metodo, params=None):
        self.ident += 1
        estado, _, cuerpo = self.http({'jsonrpc': '2.0', 'id': self.ident, 'method': metodo, **({'params': params} if params is not None else {})})
        assert estado == 200, (estado, cuerpo)
        assert cuerpo['id'] == self.ident, cuerpo
        return cuerpo

    def herramienta(self, nombre, argumentos=None):
        resultado = self.pedir('tools/call', {'name': nombre, 'arguments': argumentos or {}})['result']
        texto = resultado['content'][0]['text']
        if resultado.get('isError'):
            return None, texto
        try:
            return json.loads(texto), None
        except ValueError:
            return texto, None


SERVIDOR = """
const done = arguments[arguments.length - 1];
(async () => {
  const { iniciarServidor, datosParaClaudeCode } = ChromeUtils.importESModule('chrome://browser/content/zero/zero-ia-mcp.sys.mjs');
  const { herramientasDe } = ChromeUtils.importESModule('chrome://browser/content/zero/zero-ia-herramientas.sys.mjs');
  const animaciones = ['saludar', 'pensar'];
  window.__loboHizo = [];
  const lobo = {
    animar: nombre => { if (!animaciones.includes(nombre)) return false; window.__loboHizo.push(nombre); },
    listar: () => animaciones.map(nombre => ({ nombre })),
    crear: animacion => {
      const errores = [];
      if (!animacion?.nombre) errores.push('Falta «nombre»');
      if (!Array.isArray(animacion?.pasos)) errores.push('Faltan los «pasos»');
      if (!errores.length) animaciones.push(animacion.nombre);
      return errores;
    },
  };
  const servidor = await iniciarServidor({ herramientas: herramientasDe(window, { lobo }), nombre: 'kitsune' });
  window.__servidorIA = servidor;
  done({ puerto: servidor.puerto, token: servidor.token, url: servidor.url, datos: datosParaClaudeCode(servidor) });
})().catch(error => done({ error: String(error), stack: error.stack }));
"""

BUSCADOR = """
const done = arguments[arguments.length - 1];
(async () => {
  const { SearchService } = ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
  await SearchService.init();
  const motor = await SearchService.addUserEngine({ name: 'Zorros', url: arguments[0] + '/buscar?q={searchTerms}' });
  await SearchService.setDefault(motor, SearchService.CHANGE_REASON.USER);
  done((await SearchService.getDefault()).name);
})().catch(error => done({ error: String(error) }));
"""

SESION = """
const done = arguments[arguments.length - 1];
const [ruta, instrucciones, carpeta, modelo, buscar] = arguments;
(async () => {
  const { SesionClaude, buscarClaude } = ChromeUtils.importESModule('chrome://browser/content/zero/zero-ia-claude.sys.mjs');
  const servidor = window.__servidorIA;
  window.__eventosIA = [];
  window.__lineasIA = [];
  const elegida = buscar ? await buscarClaude() : ruta;
  if (!elegida) return done({ error: 'No se encuentra claude' });
  window.__sesionIA = new SesionClaude({
    ruta: elegida, mcp: { url: servidor.url, token: servidor.token }, instrucciones, ...(carpeta ? { carpeta } : {}),
    ...(modelo ? { modelo } : {}), onEvento: evento => window.__eventosIA.push(evento), onLinea: linea => window.__lineasIA.push(linea),
  });
  done({ ruta: elegida, sesion: window.__sesionIA.sesion });
})().catch(error => done({ error: String(error), stack: error.stack }));
"""

ENVIAR = """
const done = arguments[arguments.length - 1];
window.__sesionIA.enviar(arguments[0]).then(() => done({ ok: true }), error => done({ error: String(error) }));
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--zero-del-repo', action='store_true')
    parser.add_argument('--claude-de-verdad', action='store_true', help='también con el claude de la persona (gasta: modelo haiku)')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-zero-ia-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    report = {'root': str(root), 'checks': []}
    driver = None
    os.chmod(FALSO, os.stat(FALSO).st_mode | stat.S_IXUSR)

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def chrome(script, arguments=(), asynchronous=False):
        driver.context('chrome'); return driver.script(script, list(arguments), asynchronous=asynchronous)

    def content(script, arguments=()):
        driver.context('content'); return driver.script(script, list(arguments))

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        zero_harness.prepare(chrome, args.zero_del_repo)
        driver.navigate(origin + '/')
        chrome("gBrowser.selectedTab = gBrowser.addTrustedTab(arguments[0]); gBrowser.selectedTab = gBrowser.tabs[0];", [origin + '/dos'])
        eventually(lambda: chrome("return gBrowser.tabs[1].linkedBrowser.currentURI.spec") == origin + '/dos' and
                   not chrome("return gBrowser.tabs[1].linkedBrowser.webProgress.isLoadingDocument"), timeout=10)

        # ------------------------------------------------------------------ 1. el servidor MCP
        datos = chrome(SERVIDOR, asynchronous=True)
        assert 'error' not in datos, datos
        puerto, token = datos['puerto'], datos['token']
        assert re.fullmatch(r'[0-9a-f]{64}', token), token
        assert datos['url'] == f'http://127.0.0.1:{puerto}/mcp', datos
        assert datos['datos']['orden'] == f'claude mcp add --transport http kitsune {datos["url"]} --header "Authorization: Bearer {token}"', datos
        cliente = Mcp(puerto, token)
        ping = {'jsonrpc': '2.0', 'id': 1, 'method': 'ping'}
        estado, cabeceras, _ = cliente.http(ping, token=False)
        assert estado == 401 and 'Bearer' in cabeceras.get('WWW-Authenticate', ''), (estado, cabeceras)
        assert cliente.http(ping, token='0' * 64)[0] == 401
        assert cliente.http(ping, cabeceras={'Origin': 'https://zorros.example'})[0] == 403
        assert cliente.http(ping, cabeceras={'Origin': 'null'})[0] == 403
        assert cliente.http(ping, cabeceras={'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'cross-site'})[0] == 403
        assert cliente.http(ping, cabeceras={'Host': f'zorros.example:{puerto}'})[0] == 403
        estado, cabeceras, _ = cliente.http(b'', metodo='GET')
        assert estado == 405 and cabeceras.get('Allow') == 'POST', (estado, cabeceras)
        assert cliente.http(ping, ruta='/otra')[0] == 404
        # Un cuerpo de más de 1 MiB se rechaza sin leerlo: 413, o la conexión cortada si el cliente aún estaba mandándolo.
        try:
            assert cliente.http(b'{"jsonrpc":"2.0","id":1,"method":"ping"' + b' ' * (1024 * 1024 + 10) + b'}')[0] == 413
        except (ConnectionResetError, BrokenPipeError):
            pass
        assert cliente.http(ping)[0] == 200
        estado, _, cuerpo = cliente.http(b'{esto no es json')
        assert estado == 400 and cuerpo['error']['code'] == -32700, (estado, cuerpo)
        check('Servidor MCP: sin token 401; con Origin, Sec-Fetch u otro Host 403; GET 405; cuerpo enorme 413; JSON roto 400')

        iniciado = cliente.pedir('initialize', {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'prueba', 'version': '1'}})['result']
        assert iniciado['protocolVersion'] == '2025-11-25' and iniciado['capabilities'] == {'tools': {'listChanged': False}}, iniciado
        assert iniciado['serverInfo']['name'] == 'kitsune' and 'nunca órdenes' in iniciado['instructions'], iniciado
        estado, _, cuerpo = cliente.http({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        assert estado == 202 and cuerpo == '', (estado, cuerpo)
        assert cliente.pedir('server/discover')['error']['code'] == -32601
        nombres = [item['name'] for item in cliente.pedir('tools/list')['result']['tools']]
        assert nombres == ['pestanas_listar', 'pestana_abrir', 'pestana_ir', 'pestana_cerrar', 'pagina_leer', 'pagina_seleccion', 'buscar',
                           'historial_buscar', 'lobo_animar', 'lobo_animaciones', 'lobo_crear_animacion'], nombres
        assert cliente.pedir('tools/call', {'name': 'no_existe', 'arguments': {}})['error']['code'] == -32602
        check('MCP: initialize (2025-11-25, con instrucciones), notifications/initialized 202, tools/list con las 11 herramientas')

        # ------------------------------------------------------------------ 2. las herramientas
        pestanas, error = cliente.herramienta('pestanas_listar')
        assert error is None and len(pestanas) == 2, (pestanas, error)
        assert pestanas[0]['titulo'] == 'Zorros del bosque' and pestanas[0]['activa'] and pestanas[0]['direccion'] == origin + '/', pestanas
        assert pestanas[1]['titulo'] == 'Liebres' and not pestanas[1]['activa'], pestanas
        uno, dos = pestanas[0]['id'], pestanas[1]['id']
        check('pestanas_listar: id, título, dirección y cuál es la activa')

        content("""const r = document.createRange(); r.selectNodeContents(document.getElementById('sel'));
                   getSelection().removeAllRanges(); getSelection().addRange(r);""")
        pagina, error = cliente.herramienta('pagina_leer')
        assert error is None, error
        assert pagina['titulo'] == 'Zorros del bosque' and pagina['direccion'] == origin + '/' and pagina['id'] == uno, pagina
        assert 'El zorro rojo vive en el bosque.' in pagina['texto'] and 'SECRETO OCULTO' not in pagina['texto'], pagina
        assert pagina['seleccion'] == 'El zorro rojo vive en el bosque.' and pagina['recortado'] is False, pagina
        seleccion, error = cliente.herramienta('pagina_seleccion')
        assert error is None and seleccion['seleccion'] == 'El zorro rojo vive en el bosque.' and 'texto' not in seleccion, (seleccion, error)
        otra, error = cliente.herramienta('pagina_leer', {'id': dos})
        assert error is None and otra['titulo'] == 'Liebres' and 'Liebres del prado' in otra['texto'], (otra, error)
        check('pagina_leer: título, dirección, texto visible (sin lo oculto) y selección, de la activa o por id; pagina_seleccion')

        larga, error = cliente.herramienta('pestana_abrir', {'url': origin + '/larga', 'segundoPlano': True})
        assert error is None and larga['titulo'] == 'Larga' and not larga['activa'], (larga, error)
        leida, error = cliente.herramienta('pagina_leer', {'id': larga['id']})
        assert error is None and leida['recortado'] is True and len(leida['texto']) == 40000 and leida['longitud'] > 100000, (error, len(leida['texto']))
        check('pestana_abrir en segundo plano espera a que cargue; una página larga se recorta a 40 000 caracteres')

        for mala in ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://browser/content/browser.xhtml', 'about:config', 'data:text/html,hola']:
            _, error = cliente.herramienta('pestana_abrir', {'url': mala})
            assert error and 'http' in error, (mala, error)
        assert len(cliente.herramienta('pestanas_listar')[0]) == 3
        _, error = cliente.herramienta('pestana_abrir', {})
        assert 'Falta «url»' in error, error
        abierta, error = cliente.herramienta('pestana_abrir', {'url': origin + '/dos?otra=1'})
        assert error is None and abierta['activa'] and abierta['titulo'] == 'Liebres', (abierta, error)
        assert chrome("return gBrowser.selectedBrowser.currentURI.spec") == origin + '/dos?otra=1'
        check('pestana_abrir: solo http y https (javascript:, file:, chrome:, about:, data:, fuera); la abre delante')

        ido, error = cliente.herramienta('pestana_ir', {'id': uno})
        assert error is None and ido['activa'] and chrome("return gBrowser.selectedTab === gBrowser.tabs[0]"), (ido, error)
        cerrada, error = cliente.herramienta('pestana_cerrar', {'id': abierta['id']})
        assert error is None and cerrada['cerrada']['id'] == abierta['id'], (cerrada, error)
        eventually(lambda: len(cliente.herramienta('pestanas_listar')[0]) == 3, timeout=5)
        _, error = cliente.herramienta('pestana_ir', {'id': 9999})
        assert 'No hay ninguna pestaña con el id 9999' in error, error
        _, error = cliente.herramienta('pestana_ir', {'id': 'uno'})
        assert 'integer' in error, error
        check('pestana_ir pone delante; pestana_cerrar cierra; un id que no existe (o mal escrito) da error')

        chrome("gBrowser.selectedTab = gBrowser.addTrustedTab('about:blank')")
        _, error = cliente.herramienta('pagina_leer')
        assert error and 'no es una web' in error, error
        chrome("gBrowser.removeTab(gBrowser.selectedTab); gBrowser.selectedTab = gBrowser.tabs[0]")
        check('pagina_leer de algo que no es una web (about:blank) lo dice en vez de leerlo')

        motor = chrome(BUSCADOR, [origin], asynchronous=True)
        assert motor == 'Zorros', motor
        buscada, error = cliente.herramienta('buscar', {'consulta': 'zorro ártico'})
        assert error is None and buscada['buscador'] == 'Zorros' and buscada['activa'], (buscada, error)
        assert buscada['direccion'].startswith(origin + '/buscar?q=zorro') and buscada['titulo'] == 'Resultados de zorro ártico', buscada
        check('buscar: con el buscador de serie, en una pestaña nueva delante')

        def en_historial():
            encontradas, error = cliente.herramienta('historial_buscar', {'texto': 'zorros bosque', 'cuantos': 5})
            assert error is None, error
            return encontradas if any(item['direccion'] == origin + '/' and item['titulo'] == 'Zorros del bosque' for item in encontradas) else None
        encontradas = eventually(en_historial, timeout=10)
        assert all('bosque' in (item['titulo'] + item['direccion']).lower() for item in encontradas), encontradas
        assert encontradas[0]['visitada'].endswith('Z') and encontradas[0]['visitas'] >= 1, encontradas
        ultimas, _ = cliente.herramienta('historial_buscar', {'cuantos': 2})
        assert len(ultimas) == 2, ultimas
        nada, _ = cliente.herramienta('historial_buscar', {'texto': '%_ nada de esto'})
        assert nada == [], nada
        check('historial_buscar: por palabras (título o dirección), la última visita y las veces; sin texto, las últimas')

        lista, error = cliente.herramienta('lobo_animaciones')
        assert lista == [{'nombre': 'saludar'}, {'nombre': 'pensar'}], (lista, error)
        hecho, error = cliente.herramienta('lobo_animar', {'nombre': 'saludar'})
        assert error is None and 'saludar' in hecho and chrome("return window.__loboHizo") == ['saludar'], (hecho, error)
        _, error = cliente.herramienta('lobo_animar', {'nombre': 'volar'})
        assert 'no tiene ninguna animación «volar»' in error, error
        _, error = cliente.herramienta('lobo_crear_animacion', {'animacion': {'duracion': 2}})
        assert 'Falta «nombre»' in error and 'Faltan los «pasos»' in error, error
        creada, error = cliente.herramienta('lobo_crear_animacion', {'animacion': {'nombre': 'bailar', 'pasos': []}})
        assert error is None and '«bailar»' in creada, (creada, error)
        assert cliente.herramienta('lobo_animar', {'nombre': 'bailar'})[1] is None
        check('Lobo: animar, listar y crear se reenvían; sus errores vuelven a Claude')

        # ------------------------------------------------------------------ 3. el puente, con un claude falso
        carpeta = root / 'trabajo'
        sesion = chrome(SESION, [str(FALSO), INSTRUCCIONES, str(carpeta), 'haiku', False], asynchronous=True)
        assert 'error' not in sesion, sesion

        def eventos():
            return chrome("return window.__eventosIA")

        def turno(mensaje, hasta='fin', timeout=20):
            antes = len(eventos())
            enviado = chrome(ENVIAR, [mensaje], asynchronous=True)
            assert enviado == {'ok': True}, enviado
            eventually(lambda: any(e['tipo'] == hasta for e in eventos()[antes:]), timeout=timeout)
            return eventos()[antes:]

        primero = turno('¿Qué pestañas tengo?')
        tipos = [e['tipo'] for e in primero]
        assert tipos[:2] == ['listo', 'texto'] and 'herramienta' in tipos and tipos[-1] == 'fin', tipos
        herramienta = next(e for e in primero if e['tipo'] == 'herramienta')
        resultado = next(e for e in primero if e['tipo'] == 'resultado-herramienta')
        assert herramienta['nombre'] == 'pestanas_listar' and resultado['nombre'] == 'pestanas_listar' and resultado['error'] is None, primero
        texto = ''.join(e['delta'] for e in primero if e['tipo'] == 'texto')
        assert texto == 'Miro tus pestañas.Tienes 4 pestañas.', texto
        assert primero[0]['sesion'] == sesion['sesion'] and primero[-1]['sesion'] == sesion['sesion'], primero
        check('Puente: un turno con el claude falso da listo, texto, herramienta (pestanas_listar por MCP de verdad), resultado y fin')

        llamadas = [json.loads(linea) for linea in (carpeta / 'llamadas.jsonl').read_text().splitlines()]
        argv = llamadas[0]['args']

        def valor(nombre):
            return argv[argv.index(nombre) + 1]
        assert argv[0] == '-p' and valor('--input-format') == 'stream-json' and valor('--output-format') == 'stream-json', argv
        assert '--verbose' in argv and '--include-partial-messages' in argv and '--strict-mcp-config' in argv, argv
        assert valor('--setting-sources') == '' and valor('--tools') == 'WebSearch', argv
        assert valor('--allowedTools') == 'mcp__kitsune,WebSearch' and 'WebFetch' in valor('--disallowedTools') and valor('--permission-mode') == 'dontAsk', argv
        assert 'Bash' in valor('--disallowedTools').split(',') and 'Write' in valor('--disallowedTools').split(','), argv
        assert '--disable-slash-commands' in argv and '--no-chrome' in argv and valor('--model') == 'haiku', argv
        assert valor('--session-id') == sesion['sesion'] and '--resume' not in argv, argv
        assert json.loads(Path(valor('--settings')).read_text()) == {'autoMemoryEnabled': False, 'disableAllHooks': True}
        assert Path(valor('--append-system-prompt-file')).read_text() == INSTRUCCIONES
        mcp_json = Path(valor('--mcp-config'))
        configuracion = json.loads(mcp_json.read_text())['mcpServers']
        assert list(configuracion) == ['kitsune'] and configuracion['kitsune'] == {
            'type': 'http', 'url': datos['url'], 'headers': {'Authorization': f'Bearer {token}'}}, configuracion
        assert stat.S_IMODE(mcp_json.stat().st_mode) == 0o600 and stat.S_IMODE(carpeta.stat().st_mode) == 0o700
        assert token not in ' '.join(argv), 'el token no va en la línea de órdenes'
        assert llamadas[0]['cwd'] == str(carpeta) and not llamadas[0]['claudecode'] and not llamadas[0]['sesion_externa'], llamadas[0]
        check('Puente: claude aislado (sin ajustes de la persona, solo el MCP de Kitsune y WebSearch, sin WebFetch, dontAsk), token en un archivo 0600')

        segundo = turno('¿Y ahora?')
        assert [e['tipo'] for e in segundo][-1] == 'fin' and len(llamadas) == len((carpeta / 'llamadas.jsonl').read_text().splitlines()), segundo
        check('Puente: el mismo proceso sigue vivo entre mensajes')

        antes = len(eventos())
        assert chrome(ENVIAR, ['lento'], asynchronous=True) == {'ok': True}
        eventually(lambda: sum(e['tipo'] == 'texto' for e in eventos()[antes:]) >= 2, timeout=10)
        assert chrome("return window.__sesionIA.ocupada") is True
        chrome("const done = arguments[arguments.length - 1]; window.__sesionIA.parar().then(done);", asynchronous=True)
        eventually(lambda: any(e['tipo'] == 'fin' for e in eventos()[antes:]), timeout=4)
        fin = next(e for e in eventos()[antes:] if e['tipo'] == 'fin')
        assert fin.get('parado') is True and not any(e['tipo'] == 'error' for e in eventos()[antes:]), eventos()[antes:]
        assert chrome("return window.__sesionIA.ocupada") is False and chrome("return window.__sesionIA.viva") is True
        check('Puente: parar corta la respuesta a medias (fin con parado, sin error) y el proceso sigue')

        antes = len(eventos())
        assert chrome(ENVIAR, ['muere'], asynchronous=True) == {'ok': True}
        eventually(lambda: any(e['tipo'] == 'cerrado' for e in eventos()[antes:]), timeout=10)
        muerte = eventos()[antes:]
        assert [e['tipo'] for e in muerte] == ['listo', 'error', 'fin', 'cerrado'], muerte
        assert 'código 3' in muerte[1]['mensaje'] and muerte[3]['inesperado'] is True, muerte
        tras = turno('¿Sigues ahí?')
        assert tras[-1]['tipo'] == 'fin' and tras[-1]['sesion'] == sesion['sesion'], tras
        llamadas = [json.loads(linea) for linea in (carpeta / 'llamadas.jsonl').read_text().splitlines()]
        assert len(llamadas) == 2 and llamadas[1]['args'][llamadas[1]['args'].index('--resume') + 1] == sesion['sesion'], llamadas
        check('Puente: si claude muere, el turno acaba con error y el siguiente mensaje lo relanza con --resume (la misma conversación)')

        antes = len(eventos())
        chrome("const done = arguments[arguments.length - 1]; window.__sesionIA.cerrar().then(() => done(true));", asynchronous=True)
        eventually(lambda: any(e['tipo'] == 'cerrado' for e in eventos()[antes:]), timeout=6)
        cerrado = next(e for e in eventos()[antes:] if e['tipo'] == 'cerrado')
        assert cerrado['inesperado'] is False and chrome("return window.__sesionIA.viva") is False, cerrado
        assert not list(carpeta.glob('.mcp-*.json')) and not list(carpeta.glob('.instrucciones-*.md')), list(carpeta.iterdir())
        enviado = chrome(ENVIAR, ['hola'], asynchronous=True)
        assert 'cerrada' in enviado.get('error', ''), enviado
        check('Puente: cerrar acaba el proceso, borra sus archivos (el del token) y no deja enviar más')

        # Seguir una conversación que claude ya no tiene: empieza otra con el mismo mensaje (sin error).
        perdida = chrome(SESION.replace("...(modelo ? { modelo } : {}),", "...(modelo ? { modelo } : {}), sesion: '00000000-0000-4000-8000-000000000000',"),
                         [str(FALSO), '', str(carpeta), None, False], asynchronous=True)
        assert perdida['sesion'] == '00000000-0000-4000-8000-000000000000', perdida
        nueva = turno('¿Qué pestañas tengo?')
        assert [e['tipo'] for e in nueva if e['tipo'] in ('error', 'fin')] == ['fin'], nueva
        assert nueva[-1]['sesion'] != perdida['sesion'] and chrome("return window.__sesionIA.sesion") == nueva[-1]['sesion'], nueva
        llamadas = [json.loads(linea) for linea in (carpeta / 'llamadas.jsonl').read_text().splitlines()]
        assert '--resume' in llamadas[-2]['args'] and '--session-id' in llamadas[-1]['args'], llamadas[-2:]
        assert '--append-system-prompt-file' not in llamadas[-1]['args'] and '--model' not in llamadas[-1]['args'], llamadas[-1]
        chrome("const done = arguments[arguments.length - 1]; window.__sesionIA.cerrar().then(() => done(true));", asynchronous=True)
        check('Puente: seguir una conversación que claude ya no tiene empieza otra con el mismo mensaje')

        encontrado = chrome("const done = arguments[arguments.length - 1]; ChromeUtils.importESModule('chrome://browser/content/zero/zero-ia-claude.sys.mjs').buscarClaude().then(done);",
                            asynchronous=True)
        esperado = shutil.which('claude') or (str(Path.home() / '.local/bin/claude') if (Path.home() / '.local/bin/claude').exists() else None)
        assert encontrado == esperado, (encontrado, esperado)
        check(f'buscarClaude: {encontrado}')

        # ------------------------------------------------------------------ 4. con el claude de verdad
        if args.claude_de_verdad:
            sesion = chrome(SESION, [None, INSTRUCCIONES, None, 'haiku', True], asynchronous=True)
            assert 'error' not in sesion, sesion
            print('claude:', sesion['ruta'], flush=True)
            inicio = time.monotonic()
            pregunta = 'Usa la herramienta pestanas_listar para ver mis pestañas y dime en una sola frase cuántas tengo abiertas.'
            real = turno(pregunta, timeout=180)
            lineas = chrome("return window.__lineasIA")
            (evidence / 'de-verdad.jsonl').write_text(''.join(linea + '\n' for linea in lineas))
            tipos = [e['tipo'] for e in real]
            respuesta = ''.join(e['delta'] for e in real if e['tipo'] == 'texto')
            fin = real[-1]
            print('eventos:', tipos, flush=True)
            print('respuesta:', respuesta, flush=True)
            print(f"coste: {fin.get('coste')} USD · {fin.get('duracion')} ms · {time.monotonic() - inicio:.1f} s", flush=True)
            assert 'error' not in tipos, real
            listo = next(e for e in real if e['tipo'] == 'listo')
            assert listo['mcp'] == 'connected' and 'pestanas_listar' in listo['herramientas'], listo
            assert not [h for h in listo['herramientas'] if h in ('Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep')], listo
            init = next(json.loads(linea) for linea in lineas if '"subtype":"init"' in linea.replace(' ', ''))
            assert [s['name'] for s in init['mcp_servers']] == ['kitsune'], init['mcp_servers']
            assert all(p.get('path') == 'builtin' for p in init.get('plugins', [])), init.get('plugins')
            assert any(e['tipo'] == 'herramienta' and e['nombre'] == 'pestanas_listar' for e in real), real
            assert any(e['tipo'] == 'resultado-herramienta' and e['nombre'] == 'pestanas_listar' and e['error'] is None for e in real), real
            assert respuesta.strip(), real
            chrome("const done = arguments[arguments.length - 1]; window.__sesionIA.cerrar().then(() => done(true));", asynchronous=True)
            check('Claude de verdad (haiku): contesta y usa pestanas_listar por el servidor MCP de Kitsune, sin MCP ni plugins de la persona')

        chrome("window.__servidorIA.cerrar()")
        try:
            cliente.http(ping)
            raise AssertionError('el servidor sigue abierto')
        except OSError:
            pass
        check('Al cerrar el servidor, deja de escuchar')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown()
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)
        if args.claude_de_verdad:
            # Claude Code guarda la conversación por carpeta de trabajo (la del perfil temporal): fuera.
            proyectos = Path(os.environ.get('CLAUDE_CONFIG_DIR') or Path.home() / '.claude') / 'projects'
            rastro = proyectos / re.sub(r'[^A-Za-z0-9]', '-', str(profile / 'kitsune-ia'))
            if rastro.is_dir() and 'kitsune-zero-ia' in rastro.name:
                shutil.rmtree(rastro, ignore_errors=True)
            print('Las líneas de claude, en evidence/de-verdad.jsonl (bórralo al acabar: /tmp es pequeño)', flush=True)
        elif report.get('status') == 'passed':
            shutil.rmtree(root, ignore_errors=True)


if __name__ == '__main__': main()
