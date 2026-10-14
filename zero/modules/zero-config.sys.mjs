/* Kitsune Zero · ajustes: sus nombres y sus valores de serie, en un único sitio.
 * El prefijo lo pone el anfitrión (Kitsune usa «kitsune.zero.»); si algún día Zero sale como
 * navegador aparte, cambia el prefijo y nada más.
 */
export const PREFS = Object.freeze({
  always: 'always',       // las ventanas nuevas nacen en Zero
  backdrop: 'backdrop',   // 'auto' | 'system' (desenfoque del compositor) | 'web' (fondo del color de la web)
  islandIcons: 'islandIcons', // la isla con solo iconos (sin el dominio)
});

export const DEFAULTS = Object.freeze({ always: false, backdrop: 'auto', islandIcons: false });

export const prefName = (prefix, key) => `${prefix}${key}`;

/** Los ajustes de Zero; si no se pueden leer, los de serie. */
export function readPrefs(prefs, prefix) {
  const read = (getter, key) => {
    try { return prefs[getter](prefName(prefix, key), DEFAULTS[key]); } catch { return DEFAULTS[key]; }
  };
  return { always: read('getBoolPref', PREFS.always), backdrop: read('getStringPref', PREFS.backdrop), islandIcons: read('getBoolPref', PREFS.islandIcons) };
}
