/* Kitsune Zero · Spotify en Windows, la parte pura (sin Gecko).
 *
 * Por qué su web no suena en Kitsune (comprobado con una cuenta el 23-11-2026; ver docs/zero/estudio.md): en Windows, el
 * servidor de licencias de Spotify contesta 403 a un Widevine sin la firma de Google (VMP), y 404 a PlayReady, que ya no
 * sirve para música. La firma hay que pedírsela a Google; ponerse la de otro navegador sería hacerse pasar por él.
 *
 * Lo que sí: Spotify Connect, de la propia Spotify. Se busca y se elige en su web, dentro de Kitsune, y el sonido lo pone
 * su app en este ordenador, con la cuenta de cada uno. Nada se salta: es la app oficial la que reproduce.
 */

export const ORIGENES = Object.freeze(['https://open.spotify.com/*']);

/** ¿Hace falta? Solo en Windows y mientras el motor no lleve su firma de Widevine (kitsune.exe.sig). */
export const haceFalta = ({ os, firmado }) => os === 'WINNT' && !firmado;

export const esSpotify = url => { try { return new URL(String(url)).hostname === 'open.spotify.com'; } catch { return false; } };

/** Lo que contesta el servidor de licencias de Spotify: { sistema, dada, status }, o null si no es una licencia. */
export function licencia({ host, path, status, method }) {
  if (method === 'OPTIONS' || !/(^|\.)spotify\.com$/.test(String(host ?? ''))) return null;
  const tipo = /\/(widevine|playready)-license\/v\d+\/(?!application-certificate)/.exec(String(path ?? ''));
  if (!tipo) return null;
  return { sistema: tipo[1], dada: status >= 200 && status < 300, status };
}

const llano = texto => String(texto ?? '').replace(/\s+/g, ' ').trim();

/** De las filas de «Conectar a un dispositivo» (sus textos), la de este ordenador: la que acaba en su nombre. -1 si no está. */
export function filaDe(textos, equipo) {
  const nombre = llano(equipo).toLocaleUpperCase();
  return nombre ? textos.findIndex(texto => llano(texto).toLocaleUpperCase().endsWith(nombre)) : -1;
}

/** ¿Dice la barra que suena en este ordenador? (en cualquier idioma: solo se mira su nombre) */
export const suenaEn = (texto, equipo) => { const nombre = llano(equipo).toLocaleUpperCase(); return !!nombre && llano(texto).toLocaleUpperCase().endsWith(nombre); };
