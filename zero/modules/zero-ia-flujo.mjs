/* Kitsune Zero · el asistente: las líneas de Claude Code, traducidas (puro, sin Gecko: se prueba con Node).
 *
 * El puente (zero-ia-claude.sys.mjs) lanza `claude -p --output-format stream-json --verbose
 * --include-partial-messages --input-format stream-json` y le llega una línea JSON por cosa que pasa. Aquí se
 * traducen a eventos sencillos para el panel:
 *
 *   { tipo: 'listo', sesion, modelo, herramientas, mcp }  arranca un turno (Claude Code repite su «init» en cada
 *                                                        mensaje); `herramientas`, con los nombres cortos; `mcp`,
 *                                                        cómo quedó el servidor de Kitsune ('connected', 'failed'…)
 *   { tipo: 'texto', delta, nuevo? }                     un trozo de la respuesta (`nuevo`: empieza un bloque de
 *                                                        texto, p. ej. después de usar una herramienta)
 *   { tipo: 'herramienta', id, nombre, entrada }         Claude usa una herramienta (las de Kitsune, sin su prefijo
 *                                                        `mcp__kitsune__`: «pestanas_listar»; las suyas, tal cual:
 *                                                        «WebSearch»)
 *   { tipo: 'resultado-herramienta', id, nombre, error } ha terminado (`error`: null, o el mensaje)
 *   { tipo: 'reintento', intento, maximo, espera, error, estado }  la API ha fallado y Claude Code lo reintenta
 *   { tipo: 'error', mensaje }                           el turno ha acabado mal (va seguido de su «fin»)
 *   { tipo: 'fin', sesion, coste, duracion, parado? }    se acabó el turno; `coste`, en dólares, lo que lleva este
 *                                                        proceso (a precio de lista: con la suscripción no se cobra
 *                                                        aparte); `duracion`, en ms; `parado`, si se cortó a mano
 *
 * Lo de los subagentes (parent_tool_use_id) y lo que el panel no necesita (estado, hooks…) no sale. El formato es el
 * de Claude Code 2.1.319, comprobado con el CLI (tests/fixtures/zero-ia/).
 */
export const SERVIDOR = 'kitsune';

/** El nombre de una herramienta como lo ve el panel: las del servidor de Kitsune, sin su prefijo. */
export function nombreCorto(nombre, servidor = SERVIDOR) {
  const prefijo = `mcp__${servidor}__`;
  const texto = String(nombre ?? '');
  return texto.startsWith(prefijo) ? texto.slice(prefijo.length) : texto;
}

/** El texto de un tool_result (una cadena o una lista de bloques). */
function textoDe(contenido) {
  if (typeof contenido === 'string') return contenido;
  if (!Array.isArray(contenido)) return '';
  return contenido.map(bloque => bloque?.type === 'text' ? String(bloque.text ?? '') : '').filter(Boolean).join('\n');
}

/** Lo que se le escribe a Claude Code por su entrada para mandarle un mensaje (una línea). */
export function mensajeUsuario(texto) {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: String(texto) }, parent_tool_use_id: null, session_id: '' })}\n`;
}

/** Lo que se le escribe para cortar la respuesta en curso (una línea). Contesta con un control_response y
 *  el turno acaba con un «result» de terminal_reason «aborted_…». */
export function ordenParar(id) {
  return `${JSON.stringify({ type: 'control_request', request_id: String(id), request: { subtype: 'interrupt' } })}\n`;
}

/** Un traductor para un proceso de Claude Code: `linea(texto)` devuelve la lista de eventos de esa línea. Guarda lo
 *  que hace falta entre líneas (qué herramienta era cada id, qué texto llegó ya a trozos). */
export function crearTraductor({ servidor = SERVIDOR } = {}) {
  const nombres = new Map();   // id del tool_use → nombre corto
  const aTrozos = new Set();   // ids de los mensajes cuyo texto ya llegó por stream_event
  let mensaje = null;          // el mensaje que llega a trozos ahora
  const bloquesNuevos = new Set(); // índices de bloque de texto aún sin su primer trozo

  function sistema(linea) {
    if (linea.subtype === 'init') {
      const mcp = Array.isArray(linea.mcp_servers) ? linea.mcp_servers.find(item => item?.name === servidor)?.status ?? null : null;
      return [{
        tipo: 'listo',
        sesion: linea.session_id ?? null,
        modelo: linea.model ?? null,
        herramientas: Array.isArray(linea.tools) ? linea.tools.map(nombre => nombreCorto(nombre, servidor)) : [],
        mcp,
      }];
    }
    if (linea.subtype === 'api_retry') {
      return [{ tipo: 'reintento', intento: linea.attempt ?? null, maximo: linea.max_retries ?? null, espera: linea.retry_delay_ms ?? null, error: linea.error ?? null, estado: linea.error_status ?? null }];
    }
    return [];
  }

  function evento(linea) {
    const ev = linea.event ?? {};
    if (ev.type === 'message_start') {
      mensaje = ev.message?.id ?? linea.api_message_id ?? null;
      bloquesNuevos.clear();
      return [];
    }
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
      bloquesNuevos.add(ev.index);
      return [];
    }
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
      const id = linea.api_message_id ?? mensaje;
      if (id) aTrozos.add(id);
      const delta = String(ev.delta.text ?? '');
      if (!delta) return [];
      if (bloquesNuevos.delete(ev.index)) return [{ tipo: 'texto', delta, nuevo: true }];
      return [{ tipo: 'texto', delta }];
    }
    return [];
  }

  function asistente(linea) {
    // Los errores de la API llegan como un mensaje «sintético» con el texto del error: lo cuenta el «result».
    if (linea.error || linea.is_api_error_message) return [];
    const msg = linea.message ?? {};
    const eventos = [];
    for (const bloque of Array.isArray(msg.content) ? msg.content : []) {
      if (bloque?.type === 'text' && bloque.text && !aTrozos.has(msg.id)) {
        // Sin --include-partial-messages, el texto llega entero aquí.
        eventos.push({ tipo: 'texto', delta: String(bloque.text), nuevo: true });
      } else if (bloque?.type === 'tool_use') {
        const nombre = nombreCorto(bloque.name, servidor);
        nombres.set(bloque.id, nombre);
        eventos.push({ tipo: 'herramienta', id: bloque.id ?? null, nombre, entrada: bloque.input ?? {} });
      }
    }
    return eventos;
  }

  function usuario(linea) {
    const contenido = linea.message?.content;
    if (!Array.isArray(contenido)) return [];
    return contenido.filter(bloque => bloque?.type === 'tool_result').map(bloque => ({
      tipo: 'resultado-herramienta',
      id: bloque.tool_use_id ?? null,
      nombre: nombres.get(bloque.tool_use_id) ?? null,
      error: bloque.is_error ? (textoDe(bloque.content) || 'Error') : null,
    }));
  }

  function resultado(linea) {
    const parado = /^aborted/.test(String(linea.terminal_reason ?? ''));
    const fin = { tipo: 'fin', sesion: linea.session_id ?? null, coste: linea.total_cost_usd ?? null, duracion: linea.duration_ms ?? null };
    if (parado) fin.parado = true;
    if (linea.is_error && !parado) {
      const errores = Array.isArray(linea.errors) ? linea.errors.filter(Boolean).join('\n') : '';
      return [{ tipo: 'error', mensaje: String(linea.result || errores || linea.subtype || 'Error') }, fin];
    }
    return [fin];
  }

  return {
    linea(texto) {
      const crudo = String(texto ?? '').trim();
      if (!crudo) return [];
      let linea;
      try { linea = JSON.parse(crudo); } catch { return []; }
      if (!linea || typeof linea !== 'object') return [];
      // Lo de los subagentes no sale: el panel ve lo de la conversación.
      if (linea.parent_tool_use_id) return [];
      switch (linea.type) {
        case 'system': return sistema(linea);
        case 'stream_event': return evento(linea);
        case 'assistant': return asistente(linea);
        case 'user': return usuario(linea);
        case 'result': return resultado(linea);
        default: return [];
      }
    },
  };
}

/** Todas las líneas de golpe (para las pruebas): la lista de eventos. */
export function traducir(lineas, opciones) {
  const traductor = crearTraductor(opciones);
  return [].concat(...lineas.map(linea => traductor.linea(linea)));
}
