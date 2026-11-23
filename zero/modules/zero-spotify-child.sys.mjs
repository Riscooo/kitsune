/* Kitsune Zero · Spotify en Windows, la parte que vive en su web (ver zero-spotify.mjs).
 *
 * Solo hace algo cuando Kitsune se lo pide (ZeroSpotify:conectar, dejar o tocar): pulsa «Conectar a un dispositivo» y elige este ordenador,
 * como haría la persona, para que lo que se ponga en la web suene por la app de Spotify. No lee nada más de la página.
 */
import { filaDe, suenaEn } from './zero-spotify.mjs';

export class KitsuneZeroSpotifyChild extends JSWindowActorChild {
  esperar(ms) { return new Promise(listo => this.contentWindow.setTimeout(listo, ms)); }

  async hasta(fn, ms) {
    for (let t = 0; t < ms; t += 150) { const algo = fn(); if (algo) return algo; await this.esperar(150); }
    return fn();
  }

  /** 'sin-sesion' | 'cargando' | 'conectado' | 'no-esta' (la app no está abierta aún) | 'no-ha-ido'. */
  async conectar(equipo, espera) {
    const doc = this.document, $ = s => doc.querySelector(s);
    this.dejado = false;
    if ($('[data-testid="login-button"]')) return 'sin-sesion';
    const barra = () => $('[data-testid="now-playing-bar"]');
    if (!barra()) return 'cargando';
    const conectado = () => suenaEn(barra()?.textContent, equipo);
    // «Conectando a…» también acaba en su nombre: se espera a que la barra deje de cambiar (el tiempo no cuenta).
    const quieto = async () => {
      const texto = () => (barra()?.textContent ?? '').replace(/\d+:\d+/g, '');
      for (let i = 0, antes = null, igual = 0; i < 20 && igual < 6; i++) { const ahora = texto(); igual = ahora === antes ? igual + 1 : 0; antes = ahora; await this.esperar(350); }
      return conectado();
    };
    if (conectado()) return (await quieto()) ? 'conectado' : 'cargando';
    // «Conectar a un dispositivo» va justo después de la cola; así no depende del idioma.
    const botones = [...barra().querySelectorAll('button')], cola = botones.indexOf($('[data-testid="control-button-queue"]'));
    const boton = cola >= 0 ? botones[cola + 1] : null;
    if (!boton) return 'cargando';
    const filas = () => [...doc.querySelectorAll('[data-testid^="device-picker-row"]')];
    const yaAbierto = filas().length > 0;
    if (!yaAbierto) boton.click();
    let fila = null;
    await this.hasta(() => { const f = filas(), i = filaDe(f.map(e => e.textContent), equipo); fila = f[i] ?? null; return fila || this.dejado; }, espera);
    let estado = 'no-esta';
    if (fila) {
      (fila.querySelector('button, [role="button"]') ?? fila).click();
      estado = (await this.hasta(conectado, 6000)) && (await quieto()) ? 'conectado' : 'no-ha-ido';
    }
    // El panel de dispositivos se queda como estaba.
    if (!yaAbierto && filas().length) boton.click();
    return estado;
  }

  async receiveMessage({ name, data }) {
    if (name === 'ZeroSpotify:tocar') { this.document.querySelector('[data-testid="control-button-playpause"]')?.click(); return null; }
    if (name === 'ZeroSpotify:dejar') { this.dejado = true; return null; }
    if (name !== 'ZeroSpotify:conectar') return null;
    // De una en una.
    this.vez = (this.vez ?? Promise.resolve()).catch(() => {}).then(() => this.conectar(String(data?.equipo ?? ''), Math.min(20_000, Number(data?.espera) || 3500)));
    return this.vez;
  }
}
