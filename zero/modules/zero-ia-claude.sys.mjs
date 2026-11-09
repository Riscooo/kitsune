/* Kitsune Zero · el asistente: el puente con Claude Code (el CLI `claude` de la persona, con su sesión iniciada).
 *
 * Un proceso por conversación, vivo entre mensajes (--input-format stream-json): cada mensaje se le escribe por su
 * entrada y lo que contesta llega línea a línea (stream-json), traducido a eventos por zero-ia-flujo.mjs. Si el
 * proceso muere, el siguiente mensaje lo vuelve a lanzar con --resume y la misma conversación.
 *
 * Aislado de la configuración de la persona: ni sus ajustes (hooks, plugins, permisos, CLAUDE.md, MCP…) ni su
 * memoria. Solo tiene las herramientas del navegador (el servidor MCP de Kitsune) y WebSearch: las webs son contenido no
 * fiable (pueden llevar instrucciones escondidas), así que nada de shell ni de leer o escribir archivos, y tampoco
 * WebFetch, que dejaría a una web mandar datos a otra dirección sin que se viera (para leer una web, el navegador:
 * pagina_leer, o abrirla en una pestaña, que se ve).
 *
 *   const ruta = await buscarClaude();
 *   const sesion = new SesionClaude({ ruta, mcp: { url, token }, instrucciones, onEvento });
 *   await sesion.enviar('¿Qué pestañas tengo?'); sesion.parar(); await sesion.cerrar();
 */
import { crearTraductor, mensajeUsuario, ordenParar, SERVIDOR } from './zero-ia-flujo.mjs';

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  Subprocess: 'resource://gre/modules/Subprocess.sys.mjs',
  setTimeout: 'resource://gre/modules/Timer.sys.mjs',
  clearTimeout: 'resource://gre/modules/Timer.sys.mjs',
});

const esperar = ms => new Promise(listo => lazy.setTimeout(listo, ms));
const esWindows = () => Services.appinfo.OS === 'WINNT';

/** Las herramientas propias de Claude Code que tiene el asistente: buscar en la web. */
export const HERRAMIENTAS_CLAUDE = Object.freeze(['WebSearch']);
/** Las que nunca (ya quedan fuera con --tools; esto es por si una versión del CLI no lo entendiera). */
export const VETADAS = Object.freeze(['WebFetch', 'Bash', 'BashOutput', 'KillShell', 'PowerShell', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Read',
  'Glob', 'Grep', 'LS', 'Task', 'Agent', 'Skill', 'SlashCommand']);
/** Sus ajustes (--settings): sin memoria automática y sin hooks de ningún sitio. */
export const AJUSTES = Object.freeze({ autoMemoryEnabled: false, disableAllHooks: true });

// Variables de una sesión de Claude Code que no deben pasar al proceso del asistente (si Kitsune se abrió desde
// una terminal con Claude Code, el hijo creería ser una subsesión suya).
const VARIABLES_DE_SESION = /^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|MESSAGING_SOCKET|MESSAGING_TOKEN|EXECPATH|SSE_PORT)|CLAUDE_PID|CLAUDE_EFFORT)$/;

function archivo(ruta) {
  const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  file.initWithPath(ruta);
  return file;
}

function ejecutable(ruta) {
  try {
    const file = archivo(ruta);
    return file.exists() && file.isFile() && (esWindows() || file.isExecutable());
  } catch { return false; }
}

/** Dónde está `claude`: en el PATH o en los sitios donde lo dejan sus instaladores (el nativo, el antiguo «local»,
 *  npm, Homebrew…). La ruta, o null si no está. Un Kitsune abierto desde el escritorio puede no tener ~/.local/bin en
 *  su PATH: por eso se miran también esos sitios. */
export async function buscarClaude() {
  const casa = Services.dirsvc.get('Home', Ci.nsIFile).path;
  const candidatos = [];
  for (const nombre of esWindows() ? ['claude.exe', 'claude.cmd'] : ['claude']) {
    try { candidatos.push(await lazy.Subprocess.pathSearch(nombre)); } catch { /* no está en el PATH */ }
  }
  if (esWindows()) {
    const appdata = Services.env.get('APPDATA');
    candidatos.push(
      PathUtils.join(casa, '.local', 'bin', 'claude.exe'),
      PathUtils.join(casa, '.claude', 'local', 'claude.exe'),
      appdata && PathUtils.join(appdata, 'npm', 'claude.cmd'),
    );
  } else {
    candidatos.push(
      PathUtils.join(casa, '.local', 'bin', 'claude'),
      PathUtils.join(casa, '.claude', 'local', 'claude'),
      PathUtils.join(casa, '.npm-global', 'bin', 'claude'),
      PathUtils.join(casa, '.bun', 'bin', 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      '/usr/bin/claude',
    );
  }
  return candidatos.find(ruta => ruta && ejecutable(ruta)) ?? null;
}

/** Los argumentos con que se lanza `claude` (ver el README de Zero: por qué cada uno). */
export function argumentosClaude({ archivos, modelo, sesion, reanudar }) {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    // Ni los ajustes de la persona, ni los del proyecto, ni los locales: sin sus hooks, plugins, permisos ni CLAUDE.md.
    '--setting-sources', '',
    '--settings', archivos.ajustes,
    // Solo el servidor MCP de Kitsune (ni los de la persona ni los conectores de claude.ai).
    '--strict-mcp-config',
    '--mcp-config', archivos.mcp,
    '--tools', HERRAMIENTAS_CLAUDE.join(','),
    '--allowedTools', [`mcp__${SERVIDOR}`, ...HERRAMIENTAS_CLAUDE].join(','),
    '--disallowedTools', VETADAS.join(','),
    // Lo que no esté permitido arriba se deniega sin preguntar (no hay nadie a quien preguntar).
    '--permission-mode', 'dontAsk',
    '--disable-slash-commands',
    '--no-chrome',
  ];
  if (archivos.instrucciones) args.push('--append-system-prompt-file', archivos.instrucciones);
  if (modelo) args.push('--model', String(modelo));
  args.push(reanudar ? '--resume' : '--session-id', sesion);
  return args;
}

function uuid() {
  return Services.uuid.generateUUID().toString().replace(/[{}]/g, '');
}

function entorno() {
  const todo = lazy.Subprocess.getEnvironment();
  return Object.fromEntries(Object.entries(todo).filter(([nombre]) => !VARIABLES_DE_SESION.test(nombre)));
}

// Las sesiones vivas: al cerrar Kitsune se cierran (si no, el proceso se queda sin nadie que lo lea).
const vivas = new Set();
let vigilando = false;
function vigilarSalida() {
  if (vigilando) return;
  vigilando = true;
  Services.obs.addObserver(() => { for (const sesion of [...vivas]) void sesion.cerrar(); }, 'quit-application-granted');
}

export class SesionClaude {
  #ruta; #mcp; #instrucciones; #carpeta; #modelo; #onEvento; #onLinea;
  #sesion; #persistida; #proc = null; #arrancando = null; #pendientes = 0; #parando = false; #cerrada = false;
  #archivos = null; #ultimo = null; #reintentado = false; #ordenes = 0; #fines = 0;

  /** - `ruta`: la de `claude` (buscarClaude());
   *  - `mcp`: { url, token } del servidor de Kitsune (iniciarServidor());
   *  - `instrucciones`: lo que se añade a las instrucciones de Claude (--append-system-prompt-file);
   *  - `carpeta`: su carpeta de trabajo (por defecto, kitsune-ia en el perfil);
   *  - `modelo`: el de --model ('haiku', 'sonnet', 'opus'…); sin él, el de serie de Claude Code;
   *  - `sesion`: una conversación anterior para seguirla (su id); sin ella, una nueva;
   *  - `onEvento(evento)`: los de zero-ia-flujo.mjs, más { tipo: 'cerrado', codigo, inesperado } cuando el proceso
   *    acaba (al cerrar, o porque ha muerto: el siguiente enviar() lo relanza con --resume);
   *  - `onLinea(texto)`: cada línea tal cual llega de Claude Code (para depurar; opcional). */
  constructor({ ruta, mcp, instrucciones = '', carpeta, modelo, sesion, onEvento, onLinea } = {}) {
    if (!ruta) throw new Error('Falta la ruta de claude (buscarClaude())');
    if (!mcp?.url || !mcp?.token) throw new Error('Falta el servidor MCP de Kitsune ({ url, token })');
    this.#ruta = ruta;
    this.#mcp = { url: String(mcp.url), token: String(mcp.token) };
    this.#instrucciones = String(instrucciones ?? '');
    this.#carpeta = carpeta ?? PathUtils.join(PathUtils.profileDir, 'kitsune-ia');
    this.#modelo = modelo ?? null;
    this.#sesion = sesion ?? uuid();
    this.#persistida = !!sesion;
    this.#onEvento = typeof onEvento === 'function' ? onEvento : () => {};
    this.#onLinea = typeof onLinea === 'function' ? onLinea : null;
  }

  /** El id de la conversación (para seguirla otro día con `sesion`). */
  get sesion() { return this.#sesion; }
  /** ¿Está contestando (o tiene mensajes en cola)? */
  get ocupada() { return this.#pendientes > 0; }
  /** ¿Hay un proceso de claude vivo? */
  get viva() { return !!this.#proc; }

  #emitir(evento) {
    try { this.#onEvento(evento); } catch (error) { console.error('Kitsune Zero (asistente):', error); }
  }

  async #prepararArchivos() {
    if (this.#archivos) return this.#archivos;
    // La carpeta, solo de la persona: el token del servidor va en un archivo (no en la línea de órdenes, que en
    // Linux puede leer cualquiera con `ps`).
    await IOUtils.makeDirectory(this.#carpeta, { createAncestors: true, permissions: 0o700 });
    const marca = uuid().slice(0, 8);
    const archivos = {
      mcp: PathUtils.join(this.#carpeta, `.mcp-${marca}.json`),
      ajustes: PathUtils.join(this.#carpeta, '.ajustes.json'),
      instrucciones: this.#instrucciones ? PathUtils.join(this.#carpeta, `.instrucciones-${marca}.md`) : null,
    };
    const configuracion = { mcpServers: { [SERVIDOR]: { type: 'http', url: this.#mcp.url, headers: { Authorization: `Bearer ${this.#mcp.token}` } } } };
    await IOUtils.writeUTF8(archivos.mcp, JSON.stringify(configuracion));
    await IOUtils.writeUTF8(archivos.ajustes, JSON.stringify(AJUSTES));
    if (archivos.instrucciones) await IOUtils.writeUTF8(archivos.instrucciones, this.#instrucciones);
    for (const ruta of [archivos.mcp, archivos.instrucciones]) {
      if (ruta && !esWindows()) { try { await IOUtils.setPermissions(ruta, 0o600); } catch { /* sin permisos POSIX */ } }
    }
    this.#archivos = archivos;
    return archivos;
  }

  async #arrancar() {
    const archivos = await this.#prepararArchivos();
    const reanudar = this.#persistida;
    const proc = await lazy.Subprocess.call({
      command: this.#ruta,
      arguments: argumentosClaude({ archivos, modelo: this.#modelo, sesion: this.#sesion, reanudar }),
      environment: entorno(),
      stderr: 'pipe',
      workdir: this.#carpeta,
    });
    this.#proc = proc;
    proc.reanudada = reanudar;
    proc.vio = false; // ¿llegó a decir «listo»?
    const traductor = crearTraductor();
    const leyendo = Promise.all([this.#leer(proc, traductor), this.#leerErrores(proc)]);
    // Al acabar, primero lo que quedara por leer (su último «result», sus errores) y luego se da por cerrado.
    proc.acabado = proc.wait().then(({ exitCode }) => exitCode, () => null).then(async codigo => {
      proc.muerto = true;
      await Promise.race([leyendo, esperar(1000)]);
      this.#alAcabar(proc, codigo);
    });
    return proc;
  }

  async #leer(proc, traductor) {
    let resto = '';
    const linea = texto => {
      if (this.#onLinea) { try { this.#onLinea(texto); } catch { /* solo para depurar */ } }
      for (const evento of traductor.linea(texto)) this.#recibir(proc, evento);
    };
    try {
      for (;;) {
        const trozo = await proc.stdout.readString();
        if (!trozo) break;
        resto += trozo;
        let salto;
        while ((salto = resto.indexOf('\n')) >= 0) {
          linea(resto.slice(0, salto));
          resto = resto.slice(salto + 1);
        }
      }
    } catch { /* el proceso se cerró */ }
    if (resto.trim()) linea(resto);
  }

  async #leerErrores(proc) {
    try {
      for (;;) {
        const trozo = await proc.stderr.readString();
        if (!trozo) break;
        proc.errores = ((proc.errores ?? '') + trozo).slice(-4000);
      }
    } catch { /* cerrado */ }
  }

  #recibir(proc, evento) {
    if (evento.tipo === 'listo') {
      proc.vio = true;
      this.#persistida = true;
      if (evento.sesion) this.#sesion = evento.sesion;
    }
    if (evento.tipo === 'error' && proc.reanudada && !proc.vio && /No conversation found/i.test(evento.mensaje)) {
      // Se pidió seguir una conversación que Claude Code ya no tiene: se empieza otra con el mismo mensaje.
      proc.sinConversacion = true;
      return;
    }
    if (evento.tipo === 'fin') {
      if (proc.sinConversacion) return;
      this.#fines++;
      this.#pendientes = Math.max(0, this.#pendientes - 1);
      if (!this.#pendientes) this.#parando = false;
      if (evento.sesion) this.#sesion = evento.sesion;
    }
    this.#emitir(evento);
  }

  #alAcabar(proc, codigo) {
    if (proc !== this.#proc) return;
    this.#proc = null;
    if (proc.sinConversacion && !this.#cerrada && this.#ultimo != null && !this.#reintentado) {
      this.#reintentado = true;
      this.#persistida = false;
      this.#sesion = uuid();
      this.#pendientes = Math.max(0, this.#pendientes - 1); // el mensaje vuelve a contar al reenviarlo
      void this.#escribirMensaje(this.#ultimo).catch(error => this.#fallo(error));
      return;
    }
    if (this.#pendientes > 0) {
      // Murió (o se mató al parar) con un turno a medias: se cierra ese turno para el panel.
      const parado = this.#parando || this.#cerrada;
      if (!parado) {
        const detalle = String(proc.errores ?? '').trim().split('\n').slice(-3).join('\n');
        this.#emitir({ tipo: 'error', mensaje: `Claude se ha cerrado${codigo != null ? ` (código ${codigo})` : ''}${detalle ? `: ${detalle}` : ''}` });
      }
      this.#pendientes = 0;
      this.#emitir({ tipo: 'fin', sesion: this.#sesion, coste: null, duracion: null, ...(parado ? { parado: true } : {}) });
    }
    this.#parando = false;
    this.#emitir({ tipo: 'cerrado', codigo, inesperado: !this.#cerrada });
  }

  #fallo(error) {
    this.#pendientes = 0;
    this.#emitir({ tipo: 'error', mensaje: `No se pudo hablar con Claude: ${error?.message ?? error}` });
    this.#emitir({ tipo: 'fin', sesion: this.#sesion, coste: null, duracion: null });
  }

  async #escribirMensaje(texto) {
    // Si el proceso acaba de morir, primero se termina de cerrar (y luego se relanza).
    if (this.#proc?.muerto) await this.#proc.acabado;
    if (!this.#proc) {
      this.#arrancando ??= this.#arrancar().finally(() => { this.#arrancando = null; });
      await this.#arrancando;
    }
    this.#pendientes++;
    await this.#proc.stdin.write(mensajeUsuario(texto));
  }

  /** Le manda un mensaje (si hace falta, lanza claude o lo relanza con --resume). Resuelve cuando se ha escrito; la
   *  respuesta llega por onEvento. Si ya está contestando, Claude Code lo deja en cola. */
  async enviar(texto) {
    if (this.#cerrada) throw new Error('Esta conversación ya está cerrada');
    const mensaje = String(texto ?? '').trim();
    if (!mensaje) return;
    vivas.add(this);
    vigilarSalida();
    this.#ultimo = mensaje;
    this.#reintentado = false;
    try {
      await this.#escribirMensaje(mensaje);
    } catch (error) {
      this.#fallo(error);
      throw error;
    }
  }

  /** Corta la respuesta en curso (como Esc en Claude Code). Si en 5 s no ha parado, se mata el proceso (el
   *  siguiente mensaje lo relanza con la conversación). */
  async parar() {
    const proc = this.#proc;
    if (!proc || !this.#pendientes) return false;
    this.#parando = true;
    const fines = this.#fines;
    try { await proc.stdin.write(ordenParar(`parar-${++this.#ordenes}`)); } catch { /* ya no escucha */ }
    // Solo si el turno no ha acabado (si acabó y hay otro en cola, ese sigue).
    lazy.setTimeout(() => { if (this.#proc === proc && this.#parando && this.#fines === fines) void proc.kill(1000); }, 5000);
    return true;
  }

  /** Cierra la conversación: para lo que esté haciendo, cierra el proceso (si no se va solo en 3 s, se mata) y
   *  borra sus archivos. La conversación queda guardada en Claude Code (se puede seguir con `sesion`). */
  async cerrar() {
    if (this.#cerrada) return;
    this.#cerrada = true;
    vivas.delete(this);
    const proc = this.#proc;
    if (proc) {
      if (this.#pendientes) { try { await proc.stdin.write(ordenParar(`parar-${++this.#ordenes}`)); } catch { /* ya no escucha */ } }
      try { await proc.stdin.close(); } catch { /* ya cerrada */ }
      const salio = await Promise.race([proc.wait().then(() => true, () => true), esperar(3000).then(() => false)]);
      if (!salio) { try { await proc.kill(1000); } catch { /* ya */ } }
    }
    const archivos = this.#archivos;
    this.#archivos = null;
    for (const ruta of [archivos?.mcp, archivos?.instrucciones]) {
      if (ruta) { try { await IOUtils.remove(ruta); } catch { /* ya no estaba */ } }
    }
  }
}
