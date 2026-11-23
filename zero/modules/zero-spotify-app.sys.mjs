/* Kitsune Zero · la app de Spotify, desde el panel de la música (Windows).
 *
 * Risco (23-11): «quiero que investigues a fondo una manera de conseguir que Spotify funcione, porque alguna 100 % debe de
 * haber sin pagar». Esta no depende de ninguna DRM ni de la API de Spotify (que pide Premium): suena la app oficial, con
 * cuenta gratis o de pago, y Kitsune la lleva con los controles multimedia de Windows (System Media Transport Controls),
 * los mismos que usan las teclas del teclado: qué suena, la portada, pausa, siguiente, anterior y avanzar.
 *
 * Lo hace un PowerShell del sistema que solo vive mientras se usa (zero-spotify-app.ps1): se le manda una orden por línea
 * y contesta un JSON. Hacia el panel, esto se comporta como el controlador de medios de Gecko (isPlaying, getMetadata…).
 */
const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  Subprocess: 'resource://gre/modules/Subprocess.sys.mjs',
  setTimeout: 'resource://gre/modules/Timer.sys.mjs',
  clearTimeout: 'resource://gre/modules/Timer.sys.mjs',
});

const GUION = 'chrome://browser/content/zero/zero-spotify-app.ps1';
export const disponible = () => Services.appinfo.OS === 'WINNT';

/** Lo que contesta el guion, comprobado. */
export function limpio(dato) {
  const texto = v => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 300);
  const numero = v => (Number.isFinite(v) && v >= 0 ? Math.min(v, 100_000) : 0);
  return {
    abierta: dato?.abierta === true, titulo: texto(dato?.titulo), artista: texto(dato?.artista), album: texto(dato?.album), suena: dato?.suena === true,
    dura: numero(dato?.dura), va: numero(dato?.va),
    puede: { siguiente: dato?.puede?.siguiente === true, anterior: dato?.puede?.anterior === true, ir: dato?.puede?.ir === true },
    ...(typeof dato?.portada === 'string' && (dato.portada === '' || /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(dato.portada)) ? { portada: dato.portada } : {}),
  };
}

/** El controlador de la app: uno para todas las ventanas. */
class ControlApp {
  #proc = null;
  #arranca = null;
  #cola = Promise.resolve();
  #escuchas = new Map();
  #reloj = null;
  #usos = 0;
  ahora = { ...limpio(null), portada: '' };
  error = null;

  // ------------------------------------------------------------ como el controlador de medios de Gecko
  get isActive() { return this.ahora.abierta && !!this.ahora.titulo; }
  get isPlaying() { return this.ahora.suena; }
  getMetadata() { return { title: this.ahora.titulo, artist: this.ahora.artista, album: this.ahora.album, artwork: this.ahora.portada ? [{ src: this.ahora.portada }] : [] }; }
  play() { void this.pedir('alternar'); }
  pause() { void this.pedir('alternar'); }
  nextTrack() { void this.pedir('siguiente'); }
  prevTrack() { void this.pedir('anterior'); }
  seekTo(segundos) { void this.pedir(`ir ${Math.max(0, Number(segundos) || 0).toFixed(1)}`); }
  abrir() { void this.pedir('abrir').then(() => lazy.setTimeout(() => void this.pedir('estado'), 2500)); }
  addEventListener(tipo, fn) { if (!this.#escuchas.has(tipo)) this.#escuchas.set(tipo, new Set()); this.#escuchas.get(tipo).add(fn); }
  removeEventListener(tipo, fn) { this.#escuchas.get(tipo)?.delete(fn); }
  #avisar() { for (const fns of this.#escuchas.values()) for (const fn of fns) { try { fn(); } catch { /* un panel cerrado */ } } }

  // ------------------------------------------------------------ el guion
  async #lanzar() {
    if (this.#proc) return this.#proc;
    this.#arranca ??= (async () => {
      const carpeta = PathUtils.join(Services.dirsvc.get('ProfD', Ci.nsIFile).path, 'kitsune-zero-spotify');
      await IOUtils.makeDirectory(carpeta, { createAncestors: true });
      const guion = PathUtils.join(carpeta, 'zero-spotify-app.ps1');
      await IOUtils.writeUTF8(guion, await (await fetch(GUION)).text());
      const sistema = Services.dirsvc.get('SysD', Ci.nsIFile).path;
      const proc = await lazy.Subprocess.call({
        command: PathUtils.join(sistema, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        arguments: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', guion],
        // Con 'ignore', en Windows el proceso no llega a arrancar: se lee y se tira.
        stderr: 'pipe', workdir: carpeta,
      });
      void (async () => { try { while (await proc.stderr.readString()) { /* se tira */ } } catch { /* cerrado */ } })();
      this.#proc = proc;
      proc.wait().then(() => { if (this.#proc === proc) { this.#proc = null; this.resto = ''; } }, () => {});
      return proc;
    })().finally(() => { this.#arranca = null; });
    return this.#arranca;
  }

  async #linea(proc) {
    this.resto ??= '';
    for (;;) {
      const fin = this.resto.indexOf('\n');
      if (fin >= 0) { const linea = this.resto.slice(0, fin); this.resto = this.resto.slice(fin + 1); return linea; }
      const trozo = await proc.stdout.readString();
      if (!trozo) throw new Error('se ha cerrado');
      this.resto += trozo;
    }
  }

  /** Una orden y su respuesta, en fila. */
  pedir(orden) {
    const vez = this.#cola.then(async () => {
      const proc = await this.#lanzar();
      let reloj = null;
      const tope = new Promise((_, no) => { reloj = lazy.setTimeout(() => no(new Error('no contesta')), 12_000); });
      try {
        await proc.stdin.write(`${orden}\n`);
        const dato = limpio(JSON.parse(await Promise.race([this.#linea(proc), tope])));
        this.error = null;
        this.ahora = { ...dato, portada: dato.portada ?? (dato.abierta ? this.ahora.portada : '') };
      } catch (error) {
        this.error = error;
        this.#parar();
        throw error;
      } finally { lazy.clearTimeout(reloj); }
      this.#avisar();
      return this.ahora;
    });
    this.#cola = vez.catch(() => {});
    return vez.catch(error => { console.error('Kitsune Zero: la app de Spotify', error); this.#avisar(); return this.ahora; });
  }

  #parar() {
    const proc = this.#proc;
    this.#proc = null;
    this.resto = '';
    try { proc?.kill(0); } catch { /* ya estaba */ }
  }

  /** Mientras alguien lo mira, se pregunta cada poco qué suena; si no, el guion se cierra. */
  usar() {
    this.#usos++;
    const vuelta = async () => {
      if (!this.#usos) return;
      await this.pedir('estado');
      if (this.#usos) this.#reloj = lazy.setTimeout(vuelta, this.ahora.suena ? 1500 : 3000);
    };
    if (this.#usos === 1) void vuelta();
    let suelto = false;
    return () => {
      if (suelto) return;
      suelto = true;
      if (--this.#usos > 0) return;
      lazy.clearTimeout(this.#reloj);
      this.#parar();
    };
  }
}

export const app = new ControlApp();
