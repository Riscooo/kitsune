#!/usr/bin/env python3
"""Un `claude` falso para las pruebas del asistente de Kitsune Zero (zero_ia_native.py): no gasta nada.

Habla stream-json como Claude Code 2.1.319 (las mismas líneas, más cortas) y llama de verdad al servidor MCP de
Kitsune que le llega en --mcp-config. Apunta en su carpeta de trabajo (llamadas.jsonl) con qué argumentos y qué
variables lo lanzaron, para que la prueba lo compruebe.

Mensajes especiales: «lento» contesta despacio (para cortarlo con parar); «muere» se cae a medio turno.
"""
import json
import os
import queue
import sys
import threading
import time
import urllib.request
import uuid

ARGS = sys.argv[1:]


def opcion(nombre):
    return ARGS[ARGS.index(nombre) + 1] if nombre in ARGS else None


with open('llamadas.jsonl', 'a') as registro:
    registro.write(json.dumps({'args': ARGS, 'claudecode': 'CLAUDECODE' in os.environ,
                               'sesion_externa': 'CLAUDE_CODE_SESSION_ID' in os.environ, 'cwd': os.getcwd()}) + '\n')

SESIONES = 'sesiones.txt'
conocidas = open(SESIONES).read().split() if os.path.exists(SESIONES) else []
sesion = opcion('--resume') or opcion('--session-id') or str(uuid.uuid4())


def escribir(objeto):
    objeto.setdefault('session_id', sesion)
    objeto.setdefault('uuid', str(uuid.uuid4()))
    sys.stdout.write(json.dumps(objeto, ensure_ascii=False) + '\n')
    sys.stdout.flush()


if opcion('--resume') and sesion not in conocidas:
    escribir({'type': 'result', 'subtype': 'error_during_execution', 'is_error': True, 'duration_ms': 0, 'num_turns': 0,
              'total_cost_usd': 0, 'errors': [f'No conversation found with session ID: {sesion}']})
    sys.stderr.write(f'No conversation found with session ID: {sesion}\n')
    sys.exit(1)
if sesion not in conocidas:
    with open(SESIONES, 'a') as archivo:
        archivo.write(sesion + '\n')

config = json.load(open(opcion('--mcp-config')))['mcpServers']['kitsune']
gastado = 0.0


def mcp(metodo, params=None, ident=1):
    cuerpo = {'jsonrpc': '2.0', 'method': metodo, **({'id': ident} if ident is not None else {}), **({'params': params} if params else {})}
    peticion = urllib.request.Request(config['url'], data=json.dumps(cuerpo).encode(), method='POST',
                                      headers={**config['headers'], 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'})
    with urllib.request.urlopen(peticion, timeout=30) as respuesta:
        datos = respuesta.read()
        return json.loads(datos) if datos else None


def texto_a_trozos(mensaje, trozos, pausa=0.0, entrada=None):
    """Escribe un texto a trozos (stream_event). Devuelve False si llegó la orden de parar."""
    escribir({'type': 'stream_event', 'event': {'type': 'message_start', 'message': {'id': mensaje, 'type': 'message', 'role': 'assistant', 'content': []}},
              'parent_tool_use_id': None, 'api_message_id': mensaje})
    escribir({'type': 'stream_event', 'event': {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}},
              'parent_tool_use_id': None, 'api_message_id': mensaje})
    dicho = ''
    for trozo in trozos:
        if entrada is not None:
            try:
                orden = entrada.get(timeout=pausa)
                if orden.get('type') == 'control_request' and orden['request'].get('subtype') == 'interrupt':
                    escribir({'type': 'control_response', 'response': {'subtype': 'success', 'request_id': orden['request_id'], 'response': {'still_queued': []}}})
                    escribir({'type': 'assistant', 'message': {'id': mensaje, 'type': 'message', 'role': 'assistant', 'content': [{'type': 'text', 'text': dicho}]},
                              'parent_tool_use_id': None, 'aborted': True})
                    escribir({'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'text', 'text': '[Request interrupted by user]'}]}, 'parent_tool_use_id': None})
                    return False
            except queue.Empty:
                pass
        dicho += trozo
        escribir({'type': 'stream_event', 'event': {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': trozo}},
                  'parent_tool_use_id': None, 'api_message_id': mensaje})
    escribir({'type': 'assistant', 'message': {'id': mensaje, 'type': 'message', 'role': 'assistant', 'content': [{'type': 'text', 'text': dicho}]},
              'parent_tool_use_id': None})
    escribir({'type': 'stream_event', 'event': {'type': 'content_block_stop', 'index': 0}, 'parent_tool_use_id': None, 'api_message_id': mensaje})
    escribir({'type': 'stream_event', 'event': {'type': 'message_stop'}, 'parent_tool_use_id': None, 'api_message_id': mensaje})
    return True


def resultado(texto, inicio, parado=False):
    global gastado
    gastado += 0.0001
    base = {'type': 'result', 'duration_ms': int((time.time() - inicio) * 1000), 'total_cost_usd': gastado, 'num_turns': 1}
    if parado:
        escribir({**base, 'subtype': 'error_during_execution', 'is_error': True, 'result': None, 'terminal_reason': 'aborted_streaming',
                  'errors': ['[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null']})
    else:
        escribir({**base, 'subtype': 'success', 'is_error': False, 'result': texto, 'terminal_reason': 'completed', 'stop_reason': 'end_turn'})


def llamar(nombre, argumentos, ident):
    """Llama a una herramienta del MCP de Kitsune y lo cuenta como lo cuenta Claude Code (tool_use y tool_result)."""
    llamada = mcp('tools/call', {'name': nombre, 'arguments': argumentos}, ident=ident)['result']
    herramienta = f'toolu_falso_{nombre}_{ident}'
    escribir({'type': 'assistant', 'message': {'id': f'msg_h_{ident}', 'type': 'message', 'role': 'assistant',
                                               'content': [{'type': 'tool_use', 'id': herramienta, 'name': f'mcp__kitsune__{nombre}', 'input': argumentos}]},
              'parent_tool_use_id': None})
    escribir({'type': 'user', 'message': {'role': 'user', 'content': [{'tool_use_id': herramienta, 'type': 'tool_result', 'content': llamada['content'],
                                                                        **({'is_error': True} if llamada.get('isError') else {})}]},
              'parent_tool_use_id': None})
    return llamada


def escena_lobo(entrada, numero):
    """«Resúmeme esta página» (zero_asistente_native): lee la página, anima al lobo, se crea una animación y contesta
    con markdown (y una etiqueta HTML que el panel debe enseñar como texto)."""
    inicio = time.time()
    texto_a_trozos(f'msg_l_{numero}', ['Voy ', 'a ', 'leerla.'])
    mcp('initialize', {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'claude-falso', 'version': '0'}})
    mcp('notifications/initialized', ident=None)
    pagina = llamar('pagina_leer', {}, 10)
    titulo = 'Zorros' if 'Zorros' in json.dumps(pagina, ensure_ascii=False) else 'algo'
    llamar('lobo_animar', {'nombre': 'feliz'}, 11)
    datos = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'zero', 'assets', 'lobo.json')
    if os.path.exists(datos):
        ejemplo = json.load(open(datos)).get('ejemploClaude')
        if ejemplo:
            llamar('lobo_crear_animacion', {'animacion': ejemplo}, 12)
    final = f'**{titulo} árticos**: viven en el Ártico y cambian de pelaje. <img src=x onerror=alert(1)>'
    texto_a_trozos(f'msg_m_{numero}', [final[:20], final[20:]])
    resultado(final, inicio)


def turno(contenido, entrada, numero):
    inicio = time.time()
    escribir({'type': 'system', 'subtype': 'init', 'cwd': os.getcwd(), 'tools': ['WebFetch', 'WebSearch', 'mcp__kitsune__pestanas_listar'],
              'mcp_servers': [{'name': 'kitsune', 'status': 'connected', 'source': 'dynamic'}], 'model': opcion('--model') or 'claude-falso',
              'permissionMode': 'dontAsk', 'claude_code_version': '2.1.319'})
    if contenido == 'muere':
        sys.stdout.flush()
        os._exit(3)
    if contenido == 'Resúmeme esta página':
        escena_lobo(entrada, numero)
        return
    if contenido == 'lento':
        terminado = texto_a_trozos(f'msg_lento_{numero}', [f'zorro {i} ' for i in range(60)], pausa=0.25, entrada=entrada)
        resultado('zorros', inicio, parado=not terminado)
        return
    texto_a_trozos(f'msg_a_{numero}', ['Miro ', 'tus ', 'pestañas.'])
    mcp('initialize', {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'claude-falso', 'version': '0'}})
    mcp('notifications/initialized', ident=None)
    llamada = mcp('tools/call', {'name': 'pestanas_listar', 'arguments': {}}, ident=2)['result']
    herramienta = f'toolu_falso_{numero}'
    escribir({'type': 'assistant', 'message': {'id': f'msg_a_{numero}', 'type': 'message', 'role': 'assistant',
                                               'content': [{'type': 'tool_use', 'id': herramienta, 'name': 'mcp__kitsune__pestanas_listar', 'input': {}}]},
              'parent_tool_use_id': None})
    escribir({'type': 'user', 'message': {'role': 'user', 'content': [{'tool_use_id': herramienta, 'type': 'tool_result', 'content': llamada['content'],
                                                                        **({'is_error': True} if llamada.get('isError') else {})}]},
              'parent_tool_use_id': None})
    pestanas = json.loads(llamada['content'][0]['text'])
    final = f'Tienes {len(pestanas)} pestañas.'
    texto_a_trozos(f'msg_b_{numero}', ['Tienes ', f'{len(pestanas)} ', 'pestañas.'])
    resultado(final, inicio)


def main():
    entrada = queue.Queue()

    def leer():
        for linea in sys.stdin:
            if linea.strip():
                entrada.put(json.loads(linea))
        entrada.put(None)

    threading.Thread(target=leer, daemon=True).start()
    numero = 0
    while True:
        mensaje = entrada.get()
        if mensaje is None:
            return
        if mensaje.get('type') == 'control_request':
            escribir({'type': 'control_response', 'response': {'subtype': 'success', 'request_id': mensaje['request_id'], 'response': {}}})
            continue
        if mensaje.get('type') == 'user':
            numero += 1
            turno(mensaje['message']['content'], entrada, numero)


if __name__ == '__main__':
    main()
