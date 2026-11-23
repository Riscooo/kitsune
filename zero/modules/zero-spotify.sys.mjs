/* Kitsune Zero · Spotify en Windows: la web en Kitsune y el sonido por la app de Spotify (Connect). El porqué, en
 * zero-spotify.mjs.
 *
 * - conectar(browser) deja la web de Spotify sonando por la app de este ordenador; si la app no está abierta, la abre.
 *   La web necesita la DRM encendida hasta para elegir dispositivo (sin ella su reproductor no arranca): 'sin-drm'.
 * - Si el servidor de Spotify niega una licencia a la web (lo normal aquí), se conecta solo: la canción que se iba a saltar
 *   suena por la app. Se mira el código de la respuesta, nunca lo que va dentro; con kitsune.zero.music.diagnostico se
 *   apunta en el perfil (kitsune-zero-musica.log).
 * Si algún día Kitsune lleva la firma de Widevine (kitsune.exe.sig junto al programa), todo esto se apaga solo.
 */
import { ORIGENES, haceFalta, licencia } from './zero-spotify.mjs';
import { prefName } from './zero-config.sys.mjs';
import { app } from './zero-spotify-app.sys.mjs';
import { setTimeout } from 'resource://gre/modules/Timer.sys.mjs';

const ACTOR = 'KitsuneZeroSpotify';
const estado = { en: false, host: null, escuchas: new Set() };
const enCurso = new WeakMap(); // browser → la conexión que se está haciendo
const ultima = new WeakMap();  // browser → cuándo se conectó por última vez por una licencia negada

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

const pausa = ms => new Promise(listo => setTimeout(listo, ms));
const actorDe = browser => { try { return browser.browsingContext?.currentWindowGlobal?.getActor(ACTOR) ?? null; } catch { return null; } };

/** Deja la web de `browser` sonando por la app. Devuelve 'conectado', 'sin-sesion', 'sin-drm', 'sin-app', 'no-ha-ido' o 'no-va'; mientras,
 *  `alEstado('abriendo')` si hay que abrir la app. */
export function conectar(browser, { alEstado = null } = {}) {
  if (!estado.en) return Promise.resolve('no-va');
  let vez = enCurso.get(browser);
  if (!vez) {
    vez = intentar(browser, alEstado).finally(() => enCurso.delete(browser));
    enCurso.set(browser, vez);
  }
  return vez;
}

async function intentar(browser, alEstado) {
  if (!Services.prefs.getBoolPref('media.eme.enabled', false)) { apuntar('connect: sin-drm'); return 'sin-drm'; }
  let abierta = false, falla = 0;
  /** La app, abierta: 'estaba', 'abierta' (se acaba de abrir) o 'sin-app'. Una vez por intento. */
  const asegurar = async () => {
    if (abierta) return 'estaba';
    const como = await app.asegurar();
    if (como !== 'sin-app') abierta = true;
    if (como === 'abierta') alEstado?.('abriendo');
    return como;
  };
  for (let i = 0; i < 18; i++) {
    let dice = 'cargando';
    try { dice = await (actorDe(browser)?.sendQuery('ZeroSpotify:conectar', { equipo: equipo() }) ?? 'cargando'); } catch { /* la página ha cambiado */ }
    if (dice === 'sin-sesion') { apuntar('connect: sin-sesion'); return dice; }
    if (dice === 'conectado' || dice === 'no-esta') {
      // La web puede decir que suena en una app que ya se cerró: se comprueba que está.
      const como = await asegurar();
      if (como === 'sin-app') { apuntar('connect: sin-app'); return 'sin-app'; }
      if (dice === 'conectado' && como === 'estaba') { apuntar('connect: conectado'); return dice; }
      if (como === 'abierta') await pausa(5000);
    }
    if (dice === 'no-ha-ido' && ++falla >= 3) break;
    await pausa(dice === 'cargando' ? 1200 : 2200);
    if (!browser.isConnected) break;
  }
  apuntar('connect: no-ha-ido');
  return 'no-ha-ido';
}

const observador = {
  observe(subject) {
    let dato = null, browser = null;
    try {
      const canal = subject.QueryInterface(Ci.nsIHttpChannel);
      const { host, filePath } = canal.URI;
      if (!host.endsWith('spotify.com')) return;
      dato = licencia({ host, path: filePath, status: canal.responseStatus, method: canal.requestMethod });
      if (!dato) return;
      browser = canal.loadInfo.browsingContext?.top?.embedderElement ?? null;
    } catch { return; }
    apuntar(`licencia ${dato.sistema}: ${dato.status}`);
    for (const fn of estado.escuchas) { try { fn(dato, browser); } catch { /* un panel cerrado */ } }
    // Una canción que la web no puede poner: que suene por la app. Sin insistir (cada cancelada pediría otra).
    if (dato.dada || !browser || Date.now() - (ultima.get(browser) ?? 0) < 15_000) return;
    ultima.set(browser, Date.now());
    void conectar(browser);
  },
};

/** Enterarse de lo que contesta el servidor de licencias; devuelve cómo dejarlo. */
export function alLicencia(fn) {
  estado.escuchas.add(fn);
  return () => estado.escuchas.delete(fn);
}

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
  Services.obs.addObserver(observador, 'http-on-examine-response');
}

/** Para las pruebas. */
export const _debug = { estado, observador };
