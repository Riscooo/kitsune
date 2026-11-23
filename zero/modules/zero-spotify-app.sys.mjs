/* Kitsune Zero · la app de Spotify de este ordenador (Windows): que esté abierta, qué suena y sus botones.
 *
 * La web de Spotify elige y la app suena (zero-spotify). Como el sonido no sale de la web, el controlador de medios de Gecko
 * no sabe nada: el minipanel y el panel de sonido se llevan con los controles multimedia de Windows (System Media Transport
 * Controls), los mismos de las teclas del teclado. Ni la API de Spotify (que pide Premium) ni ninguna DRM.
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
    dura: numero(dato?.dura), va: numero(dato?.va), instalada: dato?.instalada === true, estaba: dato?.estaba === true,
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
  #vez = 0;
  #fallos = 0;
  #parada = null;
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
  /** Abre la app (minimizada) si no lo está: 'estaba', 'abierta' o 'sin-app' (no está instalada). */
  async asegurar() {
    let dato = null;
    await this.pedir('asegurar', d => { dato = d; });
    // Si el ayudante no contesta, se sigue como si estuviera: lo dirá la propia web.
    return !dato || dato.estaba ? 'estaba' : dato.instalada ? 'abierta' : 'sin-app';
  }
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

  /** Una orden y su respuesta, en fila. Con `alDato`, la respuesta es suya (no es lo que suena). */
  pedir(orden, alDato = null) {
    const vez = this.#cola.then(async () => {
      // Sin nadie mirando no se pregunta qué suena (un «estado» que se quedó en la fila al cerrar el panel).
      if (!this.#usos && orden === 'estado') return this.ahora;
      lazy.clearTimeout(this.#parada);
      let reloj = null;
      try {
        const proc = await this.#lanzar();
        const tope = new Promise((_, no) => { reloj = lazy.setTimeout(() => no(new Error('no contesta')), 12_000); });
        await proc.stdin.write(`${orden}\n`);
        const dato = limpio(JSON.parse(await Promise.race([this.#linea(proc), tope])));
        this.error = null;
        this.#fallos = 0;
        if (alDato) { alDato(dato); return this.ahora; }
        this.ahora = { ...dato, portada: dato.portada ?? (dato.abierta ? this.ahora.portada : '') };
      } catch (error) {
        this.error = error;
        this.#fallos++;
        this.#parar();
        throw error;
      } finally {
        lazy.clearTimeout(reloj);
        // Una orden suelta: el ayudante no se queda.
        if (!this.#usos) this.#parada = lazy.setTimeout(() => { if (!this.#usos) this.#parar(); }, 8000);
      }
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
    if (this.#usos === 1) {
      const vez = ++this.#vez;
      const vuelta = async () => {
        if (!this.#usos || vez !== this.#vez) return;
        await this.pedir('estado');
        if (!this.#usos || vez !== this.#vez) return;
        // Si este Windows no puede (sin los controles multimedia, por ejemplo), cada vez se insiste menos.
        const espera = this.#fallos ? Math.min(60_000, 3000 * 2 ** Math.min(this.#fallos, 5)) : this.ahora.suena ? 1500 : 3000;
        this.#reloj = lazy.setTimeout(vuelta, espera);
      };
      void vuelta();
    }
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
