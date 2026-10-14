/* Kitsune Zero · el mezclador de sonidos (puro, sin Gecko: se prueba con Node).
 *
 * Seis capas, cada una una grabación real con licencia CC0 (ver zero/SONIDOS.md), que se mezclan a
 * gusto. Cada capa tiene su nivel (0 a 1) y su ganancia es el nivel al cuadrado, que es como lo oye el
 * oído (a media barra suena a media voz). Apagado, o en un descanso si se ha pedido que se pare, todo
 * calla.
 */
const BASE = 'chrome://browser/content/zero/';

export const LAYERS = Object.freeze(['lluvia', 'bosque', 'cafeteria', 'olas', 'fuego', 'rio'].map(id => Object.freeze({
  id, file: `${BASE}zero-sonido-${id}.ogg`,
})));

const clamp = value => (typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/** Los niveles guardados (JSON), con todas las capas y entre 0 y 1; lo que no se entiende, a 0. */
export function parseLevels(text) {
  let saved = {};
  try { saved = JSON.parse(text) ?? {}; } catch { /* roto: todo a 0 */ }
  if (typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  return Object.fromEntries(LAYERS.map(({ id }) => [id, clamp(saved[id])]));
}

/** La ganancia de cada capa ahora mismo. */
export function gains(levels, { on, phase, pauseInBreak }) {
  const quiet = !on || (pauseInBreak && (phase === 'short' || phase === 'long'));
  return Object.fromEntries(LAYERS.map(({ id }) => [id, quiet ? 0 : clamp(levels[id]) ** 2]));
}
