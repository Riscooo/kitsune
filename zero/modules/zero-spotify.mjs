/* Kitsune Zero · Spotify en Windows, la parte pura (sin Gecko).
 *
 * Por qué no sonaba: en Windows, Spotify solo da licencias de Widevine a navegadores con la firma de Google (VMP), y
 * Kitsune no la tiene (ni se puede poner la de otro: sería hacerse pasar por él). Spotify elige Widevine porque Kitsune
 * lo ofrece, su servidor contesta 403 y el reproductor se salta las canciones. Pero el reproductor web de Spotify admite
 * también PlayReady, la DRM que trae Windows, con su propio servidor de licencias: la usa cuando no hay Widevine. Así que
 * a Spotify, y solo a Spotify, no se le ofrece el Widevine que iba a rechazar.
 */

/** Las webs (y sus marcos: los reproductores incrustados) a las que no se ofrece Widevine. */
export const ORIGENES = Object.freeze(['https://open.spotify.com/*']);

/** ¿Hace falta? Solo en Windows y mientras el motor no lleve su firma de Widevine (kitsune.exe.sig). */
export const haceFalta = ({ os, firmado }) => os === 'WINNT' && !firmado;

/** ¿Es de Widevine ese sistema de claves? */
export const esWidevine = sistema => /^com\.widevine\./.test(String(sistema ?? ''));

/** Lo que contesta el servidor de licencias de Spotify: { sistema, dada, status }, o null si no es una licencia. */
export function licencia({ host, path, status, method }) {
  if (method === 'OPTIONS' || !/(^|\.)spotify\.com$/.test(String(host ?? ''))) return null;
  const tipo = /\/(widevine|playready)-license\/v\d+\/(?!application-certificate)/.exec(String(path ?? ''));
  if (!tipo) return null;
  return { sistema: tipo[1], dada: status >= 200 && status < 300, status };
}
