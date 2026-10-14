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
  silence: 'silence',                 // el silencio, encendido o no (apagado de serie)
  silenceNotify: 'silence.notify',    // los avisos de las webs, en «no molestar» mientras se trabaja
  silenceBlock: 'silence.block',      // tapar las webs vetadas mientras se trabaja
  silenceBlocked: 'silence.blocked',  // la lista de webs vetadas (dominios separados por comas)
  silenceOnlyWork: 'silence.onlyWork', // «Solo currar»: vetadas también en el descanso
  silenceScroll: 'silence.scroll',    // avisar tras 10 min bajando en la misma página
  sounds: 'sounds',                   // los sonidos, encendidos o no (apagados de serie)
  soundsLevels: 'sounds.levels',      // el nivel de cada capa (JSON, de 0 a 1; ver zero-sounds.mjs)
  soundsPause: 'sounds.pauseInBreak', // callarse en los descansos del pomodoro
});

export const DEFAULTS = Object.freeze({ always: false, backdrop: 'auto', islandIcons: false,
  pomodoro: false, pomodoroPreset: '25', pomodoroBreak: 'soft', pomodoroGuide: 'breathe', pomodoroState: '',
  silence: false, silenceNotify: true, silenceBlock: true, silenceBlocked: '', silenceOnlyWork: false, silenceScroll: true,
  sounds: false, soundsLevels: '{"lluvia":0.5}', soundsPause: true });

export const prefName = (prefix, key) => `${prefix}${key}`;

/** Los ajustes de Zero; si no se pueden leer, los de serie. */
export function readPrefs(prefs, prefix) {
  const read = (getter, key) => {
    try { return prefs[getter](prefName(prefix, PREFS[key]), DEFAULTS[key]); } catch { return DEFAULTS[key]; }
  };
  // Cada ajuste se lee con el tipo de su valor de serie.
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, read(typeof value === 'boolean' ? 'getBoolPref' : 'getStringPref', key)]));
}
