/* Kitsune Zero · el asistente: el servidor MCP del navegador (proceso principal).
 *
 * Le da a Claude Code (el del asistente, o cualquier otro que la persona conecte a mano) las herramientas del
 * navegador. Transporte «Streamable HTTP» de MCP con respuestas application/json (sin SSE), en 127.0.0.1 y nada más.
 * Lo de dentro (cabecera, permisos, JSON-RPC) está en zero-ia-protocolo.mjs, que se prueba con Node; aquí, el
 * enchufe: nsIServerSocket solo en loopback, una petición por conexión y tiempos máximos.
 *
 *   const servidor = await iniciarServidor({ herramientas, nombre: 'kitsune', puerto: 4710 });
 *   servidor.url, servidor.token, servidor.puerto; servidor.cerrar();
 *   datosParaClaudeCode(servidor).orden  // «claude mcp add --transport http kitsune …»
 */
import { atenderMcp, comprobarPeticion, leerCabecera, leerJson, LIMITES, respuestaHttp, RUTA } from './zero-ia-protocolo.mjs';

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  NetUtil: 'resource://gre/modules/NetUtil.sys.mjs',
  setTimeout: 'resource://gre/modules/Timer.sys.mjs',
  clearTimeout: 'resource://gre/modules/Timer.sys.mjs',
});

const RELOJ = { setTimeout: (fn, ms) => lazy.setTimeout(fn, ms), clearTimeout: id => lazy.clearTimeout(id) };
const LECTURA_MAXIMA = 10_000;   // ms para que llegue la petición entera
const CONEXIONES_MAXIMAS = 32;

/** Un token largo y aleatorio (256 bits, en hexadecimal). */
export function tokenNuevo() {
  const bytes = new Uint8Array(32);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else {
    const aleatorio = Cc['@mozilla.org/security/random-generator;1'].getService(Ci.nsIRandomGenerator).generateRandomBytes(32);
    bytes.set(aleatorio);
  }
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** El enchufe en 127.0.0.1: en `puerto` si está libre; si no (o sin puerto), uno cualquiera. */
function enchufe(puerto) {
  const intentos = Number.isInteger(puerto) && puerto > 0 && puerto < 65536 ? [puerto, -1] : [-1];
  let ultimo = null;
  for (const intento of intentos) {
    const socket = Cc['@mozilla.org/network/server-socket;1'].createInstance(Ci.nsIServerSocket);
    try {
      socket.init(intento, /* solo loopback */ true, -1);
      return socket;
    } catch (error) { ultimo = error; }
  }
  throw ultimo ?? new Error('No se pudo abrir el servidor del asistente');
}

/** Manda `bytes` por la conexión y la cierra con suavidad: se cierran sus dos flujos (así el socket termina de
 *  mandar lo que tenga antes de cerrarse; cerrar el transporte sin más cortaba las respuestas largas). */
function contestar(conexion, bytes) {
  if (conexion.respondida) return;
  conexion.respondida = true;
  conexion.fin();
  try {
    const origen = Cc['@mozilla.org/io/arraybuffer-input-stream;1'].createInstance(Ci.nsIArrayBufferInputStream);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    origen.setData(buffer, 0, buffer.byteLength);
    const salida = conexion.transporte.openOutputStream(0, 0, 0);
    // asyncCopy cierra la salida al acabar; luego, la entrada.
    lazy.NetUtil.asyncCopy(origen, salida, () => conexion.cerrar({ suave: true }));
  } catch {
    conexion.cerrar();
  }
}

/** Atiende una conexión: lee la petición (con sus límites), la comprueba y la contesta. */
function atender(transporte, opciones, vivas) {
  const trozos = [];
  let recibido = 0, cabecera = null, cerrada = false;
  const entrada = transporte.openInputStream(0, 0, 0).QueryInterface(Ci.nsIAsyncInputStream);
  const binario = Cc['@mozilla.org/binaryinputstream;1'].createInstance(Ci.nsIBinaryInputStream);
  binario.setInputStream(entrada);
  const conexion = {
    transporte,
    respondida: false,
    fin() { lazy.clearTimeout(this.tiempo); },
    cerrar({ suave = false } = {}) {
      if (cerrada) return;
      cerrada = true;
      this.fin();
      vivas.delete(conexion);
      try { entrada.close(); } catch { /* ya */ }
      if (!suave) { try { transporte.close(Cr.NS_ERROR_ABORT); } catch { /* ya */ } }
    },
  };
  vivas.add(conexion);
  const responder = (estado, cuerpo = null, extra = {}) => contestar(conexion, respuestaHttp(estado, cuerpo, extra));
  conexion.tiempo = lazy.setTimeout(() => responder(408, 'La petición ha tardado demasiado'), LECTURA_MAXIMA);

  const juntar = () => {
    const todo = new Uint8Array(recibido);
    let sitio = 0;
    for (const trozo of trozos) { todo.set(trozo, sitio); sitio += trozo.length; }
    return todo;
  };

  async function procesar(todo) {
    let mensaje;
    try { mensaje = leerJson(todo.subarray(cabecera.inicioCuerpo, cabecera.inicioCuerpo + cabecera.largo)); } catch {
      responder(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'El cuerpo no es JSON' } });
      return;
    }
    try {
      const { estado, cuerpo } = await atenderMcp(mensaje, { ...opciones, reloj: RELOJ });
      responder(estado, cuerpo ?? null);
    } catch (error) {
      responder(500, { jsonrpc: '2.0', id: mensaje?.id ?? null, error: { code: -32603, message: String(error?.message ?? error) } });
    }
  }

  const leer = {
    onInputStreamReady() {
      if (conexion.respondida) return;
      let disponible = 0;
      try { disponible = entrada.available(); } catch { conexion.cerrar(); return; }
      if (!disponible) { conexion.cerrar(); return; }
      const maximo = LIMITES.cabeceras + LIMITES.cuerpo + 1;
      const cuanto = Math.min(disponible, maximo - recibido + 1);
      const buffer = new ArrayBuffer(cuanto);
      const leidos = binario.readArrayBuffer(cuanto, buffer);
      trozos.push(new Uint8Array(buffer, 0, leidos));
      recibido += leidos;
      if (recibido > maximo) { responder(413, 'Demasiado grande'); return; }
      const todo = juntar();
      if (!cabecera) {
        const leida = leerCabecera(todo);
        if (leida?.error) { responder(leida.error, leida.mensaje); return; }
        if (leida) {
          const problema = comprobarPeticion(leida, opciones);
          if (problema) { responder(problema.estado, problema.mensaje, problema.cabeceras ?? {}); return; }
          cabecera = leida;
        }
      }
      if (cabecera && recibido >= cabecera.inicioCuerpo + cabecera.largo) {
        // Llegó entera: el tiempo de lectura acaba aquí (el de la herramienta lo pone atenderMcp).
        conexion.fin();
        void procesar(todo);
        return;
      }
      entrada.asyncWait(leer, 0, 0, Services.tm.mainThread);
    },
  };
  entrada.asyncWait(leer, 0, 0, Services.tm.mainThread);
}

/** Pone en marcha un servidor MCP en 127.0.0.1.
 *  - `herramientas`: [{ nombre, descripcion, esquema (JSON Schema), ejecutar: async args => resultado }], donde el
 *    resultado es un texto, un objeto (va como JSON) o { texto, imagen: { datos (base64), tipo } }. Si `ejecutar`
 *    lanza un error, Claude lo recibe como resultado con isError (para que lo lea y lo arregle).
 *  - `nombre`: el del servidor (en serverInfo); `puerto`: el que se prefiere (si está ocupado, otro);
 *  - `token`: uno propio (al menos 32 caracteres) para que no cambie entre arranques; si no, uno nuevo.
 *  - `instrucciones`: lo que se le dice a Claude del servidor (por defecto, que las webs son datos, no órdenes);
 *    `tiempoMaximo`: ms por herramienta (60 s).
 *  Devuelve { puerto, token, url, cerrar() }. */
export async function iniciarServidor({ herramientas = [], nombre = 'kitsune', puerto, token, instrucciones, tiempoMaximo, version } = {}) {
  const clave = typeof token === 'string' && token.length >= 32 ? token : tokenNuevo();
  const socket = enchufe(puerto);
  const elegido = socket.port;
  const vivas = new Set();
  const opciones = {
    herramientas, nombre, puerto: elegido, token: clave,
    ...(instrucciones !== undefined ? { instrucciones } : {}),
    ...(tiempoMaximo ? { tiempoMaximo } : {}),
    ...(version ? { version } : {}),
  };
  let cerrado = false;
  socket.asyncListen({
    onSocketAccepted(_servidor, transporte) {
      // Por si acaso: solo desde esta máquina (el enchufe ya solo escucha en loopback).
      let desde = '';
      try { desde = transporte.getScriptablePeerAddr().address; } catch { /* sin dirección */ }
      if (cerrado || desde !== '127.0.0.1' || vivas.size >= CONEXIONES_MAXIMAS) {
        try { transporte.close(Cr.NS_ERROR_ABORT); } catch { /* ya */ }
        return;
      }
      try { atender(transporte, opciones, vivas); } catch { try { transporte.close(Cr.NS_ERROR_ABORT); } catch { /* ya */ } }
    },
    onStopListening() {},
  });
  return {
    puerto: elegido,
    token: clave,
    url: `http://127.0.0.1:${elegido}${RUTA}`,
    get abierto() { return !cerrado; },
    cerrar() {
      if (cerrado) return;
      cerrado = true;
      try { socket.close(); } catch { /* ya */ }
      for (const conexion of [...vivas]) conexion.cerrar();
    },
  };
}

/** Para conectar el servidor a mano a Claude Code (o a otro cliente MCP): la orden de `claude mcp add` y la
 *  configuración en JSON (la de --mcp-config y .mcp.json). Ojo: el token y el puerto valen mientras el servidor
 *  siga abierto con ellos. */
export function datosParaClaudeCode(servidor, nombre = 'kitsune') {
  const cabecera = `Authorization: Bearer ${servidor.token}`;
  return {
    orden: `claude mcp add --transport http ${nombre} ${servidor.url} --header "${cabecera}"`,
    url: servidor.url,
    cabecera,
    configuracion: { mcpServers: { [nombre]: { type: 'http', url: servidor.url, headers: { Authorization: `Bearer ${servidor.token}` } } } },
  };
}
