/* Kitsune Zero · ajustes: sus nombres y sus valores de serie, en un único sitio.
 * El prefijo lo pone el anfitrión (Kitsune usa «kitsune.zero.»); si algún día Zero sale como
 * navegador aparte, cambia el prefijo y nada más.
 */
export const PREFS = Object.freeze({
  always: 'always',       // las ventanas nuevas nacen en Zero
  backdrop: 'backdrop',   // 'auto' | 'system' (desenfoque del compositor) | 'web' (fondo del color de la web)
  islandIcons: 'islandIcons', // la isla con solo iconos (sin el dominio)
  pomodoro: 'pomodoro',               // el pomodoro, encendido o no (apagado de serie)
  pomodoroPreset: 'pomodoro.preset',  // '25' | '50' | '90' (minutos de trabajo; ver zero-pomodoro.mjs)
  pomodoroBreak: 'pomodoro.break',    // 'soft' (avisa la isla) | 'strict' (un cristal tapa las webs)
  pomodoroGuide: 'pomodoro.guide',    // 'breathe' | 'stretch' | 'alternate' (en el descanso estricto)
  pomodoroState: 'pomodoro.state',    // el reloj (JSON), uno para todas las ventanas
});

export const DEFAULTS = Object.freeze({ always: false, backdrop: 'auto', islandIcons: false,
  pomodoro: false, pomodoroPreset: '25', pomodoroBreak: 'soft', pomodoroGuide: 'breathe', pomodoroState: '' });

export const prefName = (prefix, key) => `${prefix}${key}`;

/** Los ajustes de Zero; si no se pueden leer, los de serie. */
export function readPrefs(prefs, prefix) {
  const read = (getter, key) => {
    try { return prefs[getter](prefName(prefix, PREFS[key]), DEFAULTS[key]); } catch { return DEFAULTS[key]; }
  };
  // Cada ajuste se lee con el tipo de su valor de serie.
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, read(typeof value === 'boolean' ? 'getBoolPref' : 'getStringPref', key)]));
}
