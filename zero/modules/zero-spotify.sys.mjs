/* Kitsune Zero · Spotify en Windows: la web en Kitsune y el sonido por la app de Spotify (Connect). El porqué, en
 * zero-spotify.mjs.
 *
 * Cuando la web va a poner una canción ella misma, pide una licencia que su servidor le va a negar (403) y salta de canción
 * en canción hasta quedarse muda (Risco, 12-11 y 23-11). Aquí esa petición se retiene antes de salir, la web se conecta con
 * la app de este ordenador (abriéndola si hace falta) y la canción suena por ella, la misma y sin saltos; la petición
 * retenida, que ya no sirve, se descarta. Si no se puede conectar, se suelta y pasa lo que pasaba.
 *
 * Solo se actúa en ese momento: abrir la web no abre la app ni le quita la música a otro dispositivo. Se miran la dirección y
 * el código de la respuesta, nunca lo que va dentro; con kitsune.zero.music.diagnostico se apunta en el perfil
 * (kitsune-zero-musica.log).
 *
 * La web necesita la DRM encendida hasta para elegir dispositivo (sin ella su reproductor no arranca).
 * Si algún día Kitsune lleva la firma de Widevine (kitsune.exe.sig junto al programa), todo esto se apaga solo.
 */
import { ORIGENES, haceFalta, licencia } from './zero-spotify.mjs';
import { prefName } from './zero-config.sys.mjs';
import { app } from './zero-spotify-app.sys.mjs';
import { setTimeout } from 'resource://gre/modules/Timer.sys.mjs';

const ACTOR = 'KitsuneZeroSpotify';
const TOPE = 45_000; // lo que se espera a la app, abriéndola incluida
const estado = { en: false, host: null, escuchas: new Set() };
const enCurso = new WeakMap(); // browser → la conexión que se está haciendo

export class KitsuneZeroSpotifyParent extends JSWindowActorParent {}

function firmado() {
  try {
    const exe = Services.dirsvc.get('XREExeF', Ci.nsIFile);
    const firma = exe.parent.clone();
    firma.append(`${exe.leafName}.sig`);
    return firma.exists();
  } catch { return false; }
}

function apuntar(dato) {
  let on = false;
  try { on = estado.host.prefs.getBoolPref(prefName(estado.host.prefix, 'music.diagnostico'), false); } catch { /* sin ajustes */ }
  if (!on) return;
  const file = PathUtils.join(PathUtils.profileDir, 'kitsune-zero-musica.log');
  void IOUtils.writeUTF8(file, `${new Date().toISOString()} ${dato}\n`, { mode: 'appendOrCreate' }).catch(() => {});
}

/** ¿Va Spotify por su app en este Kitsune? */
export const porLaApp = () => estado.en;
/** Cómo se llama este ordenador (así se llama la app en Spotify Connect). */
export const equipo = () => Services.env.get('COMPUTERNAME') || Services.dns.myHostName || '';

/** Enterarse de cómo va la conexión de una web: fn(browser, 'conectando' | 'abriendo' | 'conectado' | 'sin-sesion' | 'sin-drm' |
 *  'sin-app' | 'no-ha-ido'). Devuelve cómo dejarlo. */
export function alEstado(fn) {
  estado.escuchas.add(fn);
  return () => estado.escuchas.delete(fn);
}
function decir(browser, como) {
  apuntar(`connect: ${como}`);
  for (const fn of estado.escuchas) { try { fn(browser, como); } catch { /* una ventana cerrada */ } }
}

const pausa = ms => new Promise(listo => setTimeout(listo, ms));
const actorDe = browser => { try { return browser.browsingContext?.currentWindowGlobal?.getActor(ACTOR) ?? null; } catch { return null; } };

/** Deja la web de `browser` sonando por la app. Devuelve 'conectado', 'sin-sesion', 'sin-drm', 'sin-app', 'no-ha-ido' o
 *  'no-va' (aquí no hace falta). */
export function conectar(browser) {
  if (!estado.en) return Promise.resolve('no-va');
  let vez = enCurso.get(browser);
  if (!vez) {
    vez = intentar(browser).catch(error => { console.error('Kitsune Zero: Spotify', error); return 'no-ha-ido'; })
      .then(como => { enCurso.delete(browser); decir(browser, como); return como; });
    enCurso.set(browser, vez);
  }
  return vez;
}

async function intentar(browser) {
  if (!Services.prefs.getBoolPref('media.eme.enabled', false)) return 'sin-drm';
  decir(browser, 'conectando');
  const fin = Date.now() + TOPE;
  // La app se abre mientras la web se va preparando.
  let como = null;
  const abriendo = app.asegurar().then(r => { como = r; if (r === 'abierta') decir(browser, 'abriendo'); return r; });
  for (let fallos = 0; Date.now() < fin && browser.isConnected;) {
    let dice = 'cargando';
    // Si la app se acaba de abrir, la web la espera con la lista de dispositivos abierta (sin abrirla y cerrarla).
    try { dice = await (actorDe(browser)?.sendQuery('ZeroSpotify:conectar', { equipo: equipo(), espera: como === 'estaba' ? 5000 : 14_000 }) ?? 'cargando'); } catch { /* la página ha cambiado */ }
    if (dice === 'sin-sesion') return dice;
    if (await abriendo === 'sin-app') return 'sin-app';
    if (dice === 'conectado') {
      if (como === 'estaba') return dice;
      // La web puede decir que suena en una app que estaba cerrada: con ella recién abierta, se mira otra vez.
      como = 'estaba';
      await pausa(4000);
      continue;
    }
    if (dice === 'no-ha-ido' && ++fallos >= 3) break;
    await pausa(900);
  }
  return 'no-ha-ido';
}

/** Le da a reproducir (o a pausa) en la web: para el minipanel, cuando la app no está abierta. */
export function tocar(browser) {
  try { actorDe(browser)?.sendAsyncMessage('ZeroSpotify:tocar'); } catch { /* la página ha cambiado */ }
}

const browserDe = canal => { try { return canal.loadInfo.browsingContext?.top?.embedderElement ?? null; } catch { return null; } };

const siguiendo = new WeakSet();
/** Lo que se iba a poner en la web pasa a la app en pausa (aún no había empezado): se le da a reproducir, si no suena ya. */
async function seguir(browser) {
  if (siguiendo.has(browser)) return;
  siguiendo.add(browser);
  try {
    for (let i = 0; i < 3; i++) {
      await pausa(i ? 3000 : 1200);
      // El estado de la app (no «estado»: se pregunta aunque nadie mire el minipanel).
      const { abierta, suena } = await app.pedir('mirar');
      if (abierta && suena) break;
      apuntar('connect: reproducir');
      tocar(browser);
    }
  } finally { siguiendo.delete(browser); }
}

/** Retiene la petición de licencia mientras se conecta con la app: 'conectado', se descarta; si no, se suelta. */
function retener(canal, browser) {
  canal.suspend();
  let suelto = false;
  const soltar = cancelar => {
    if (suelto) return;
    suelto = true;
    try { if (cancelar) canal.cancel(Cr.NS_BINDING_ABORTED); } catch { /* ya no está */ }
    try { canal.resume(); } catch { /* ya no está */ }
  };
  void conectar(browser).then(como => {
    if (como !== 'conectado') { soltar(false); return; }
    seguir(browser);
    // Descartarla ya haría que la web la diera por fallida y saltara de canción: al pasar a la app, ella misma la deja. Lo que
    // quede, al rato.
    setTimeout(() => soltar(true), 60_000);
  }, () => soltar(false));
}

const observador = {
  observe(subject, tema) {
    try {
      const canal = subject.QueryInterface(Ci.nsIHttpChannel);
      const { host, filePath } = canal.URI;
      if (!host.endsWith('spotify.com')) return;
      const antes = tema === 'http-on-modify-request';
      const dato = licencia({ host, path: filePath, status: antes ? 0 : canal.responseStatus, method: canal.requestMethod });
      if (!dato) return;
      const browser = browserDe(canal);
      if (!antes) { apuntar(`licencia ${dato.sistema}: ${dato.status}`); return; }
      if (dato.sistema !== 'widevine' || canal.requestMethod !== 'POST' || !browser) return;
      apuntar('licencia retenida');
      retener(canal, browser);
    } catch (error) { console.error('Kitsune Zero: Spotify', error); }
  },
};

/** Una vez, al empezar Zero. */
export function start(host) {
  if (estado.host) return;
  estado.host = host;
  estado.en = haceFalta({ os: Services.appinfo.OS, firmado: firmado() });
  if (!estado.en) return;
  try {
    ChromeUtils.registerWindowActor(ACTOR, {
      parent: { esModuleURI: import.meta.url },
      child: { esModuleURI: new URL('./zero-spotify-child.sys.mjs', import.meta.url).href },
      allFrames: false,
      matches: [...ORIGENES],
      messageManagerGroups: ['browsers'],
      safeForUntrustedWebProcess: true, // solo contesta a Kitsune; la web no puede pedirle nada
    });
  } catch { /* ya estaba */ }
  for (const tema of ['http-on-modify-request', 'http-on-examine-response']) Services.obs.addObserver(observador, tema);
}

/** Para las pruebas. */
export const _debug = { estado, observador };
