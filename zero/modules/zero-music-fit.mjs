/* Kitsune Zero · el ancho del panel de la música (puro, sin Gecko: se prueba con Node).
 *
 * Hay webs que no bajan de un ancho (la de Spotify, 800 px; la de SoundCloud, 960): por debajo se cortan y no
 * se pueden manejar (Risco, 19-10). El panel les da ese ancho; si no cabe en la ventana, o si se ha estrechado
 * a mano, la web se ve entera pero más pequeña (zoom).
 */
export const MUSIC_WIDTH = 380;
export const MUSIC_MIN_WIDTH = 320;

/** `need`: lo que pide la web (0 si se adapta a cualquiera); `chosen`: el que se dejó al estirarlo (0 si
 *  nunca); `room`: lo que cabe en la ventana. Devuelve el ancho del panel y el zoom de su web. */
export function fitMusic({ need = 0, chosen = 0, room = Infinity }) {
  const wanted = chosen || Math.max(MUSIC_WIDTH, need);
  const width = Math.round(Math.max(Math.min(wanted, room), Math.min(MUSIC_MIN_WIDTH, room)));
  return { width, zoom: need > width ? width / need : 1 };
}
