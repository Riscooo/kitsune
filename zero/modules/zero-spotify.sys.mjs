/* Kitsune Zero · Spotify en Windows: que suene con la DRM de Windows (PlayReady). El porqué, en zero-spotify.mjs.
 *
 * - Gecko trae PlayReady en Windows, pero solo lo da a las webs de una lista de Mozilla
 *   (media.eme.mfcdm.origin-filter.enabled): aquí se abre, en la rama de serie (lo que ponga la persona, manda).
 * - El actor (zero-spotify-child) quita Widevine solo en open.spotify.com.
 * - Se mira qué contesta el servidor de licencias (solo el código de la respuesta, nunca lo que va dentro): el panel de
 *   la música lo usa para decir si la DRM no ha ido. Con kitsune.zero.music.diagnostico se apunta en el perfil
 *   (kitsune-zero-musica.log).
 * Si algún día Kitsune lleva la firma de Widevine (kitsune.exe.sig junto al programa), todo esto se apaga solo.
 */
import { ORIGENES, haceFalta, licencia } from './zero-spotify.mjs';
import { prefName } from './zero-config.sys.mjs';

const ACTOR = 'KitsuneZeroSpotify';
const FILTRO = 'media.eme.mfcdm.origin-filter.enabled';
const estado = { en: false, ultima: null, escuchas: new Set(), host: null };

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

const observador = {
  observe(subject) {
    let dato = null;
    try {
      const canal = subject.QueryInterface(Ci.nsIHttpChannel);
      const { host, filePath } = canal.URI;
      if (!host.endsWith('spotify.com')) return;
      dato = licencia({ host, path: filePath, status: canal.responseStatus, method: canal.requestMethod });
    } catch { return; }
    if (!dato) return;
    estado.ultima = dato;
    apuntar(`licencia ${dato.sistema}: ${dato.status}`);
    for (const fn of estado.escuchas) { try { fn(dato); } catch { /* un panel cerrado */ } }
  },
};

/** ¿Va Spotify con PlayReady en este Kitsune? */
export const conPlayReady = () => estado.en;

/** Enterarse de lo que contesta el servidor de licencias; devuelve cómo dejarlo. */
export function alLicencia(fn) {
  estado.escuchas.add(fn);
  return () => estado.escuchas.delete(fn);
}

/** Una vez, al empezar Zero (antes de que se abra ninguna web). */
export function start(host) {
  if (estado.host) return;
  estado.host = host;
  estado.en = haceFalta({ os: Services.appinfo.OS, firmado: firmado() });
  if (!estado.en) return;
  try { Services.prefs.getDefaultBranch('').setIntPref(FILTRO, 0); } catch { /* este Gecko no lo tiene */ }
  try {
    ChromeUtils.registerWindowActor(ACTOR, {
      parent: { esModuleURI: import.meta.url },
      child: { esModuleURI: new URL('./zero-spotify-child.sys.mjs', import.meta.url).href, events: { DOMWindowCreated: {} } },
      allFrames: true,
      matches: [...ORIGENES],
      messageManagerGroups: ['browsers'],
      safeForUntrustedWebProcess: true, // no recibe nada de la web ni le manda nada
    });
  } catch { /* ya estaba */ }
  Services.obs.addObserver(observador, 'http-on-examine-response');
}

/** Para las pruebas. */
export const _debug = { estado, FILTRO };
