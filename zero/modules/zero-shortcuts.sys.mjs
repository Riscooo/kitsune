/* Kitsune Zero · la pastilla de abajo de la columna de la izquierda: la del sonido.
 *
 * Antes guardaba accesos directos (Risco, 15-10), con un «+» que abría pestañas. Dani (15-10): «no tiene
 * sentido que se puedan abrir pestañas ahí; solamente en lo de la mitad». Ahora es solo el sitio del
 * altavoz (zero-audio pone dentro su botón, que abre el panel de sonido y, desde él, la música).
 * Los accesos que se guardaron (kitsune.zero.shortcuts) se quedan en los ajustes, sin tocar.
 */
const HTML = 'http://www.w3.org/1999/xhtml';
const state = new WeakMap();

export function attach(win, ctx) {
  const doc = win.document, { host } = ctx;
  const dock = doc.getElementById('zero-dock');
  if (!dock) return;
  const t = host.t ?? (es => es);
  const pill = doc.createElementNS(HTML, 'div');
  for (const [k, v] of Object.entries({ id: 'zero-shortcuts', class: 'zero-pill', role: 'group', 'aria-label': t('Sonido', 'Sound') })) pill.setAttribute(k, v);
  dock.append(pill);
  state.set(win, pill);
}

export function detach(win) {
  state.get(win)?.remove();
  state.delete(win);
}
