/* Kitsune Zero · ajustes: sus nombres y sus valores de serie, en un único sitio.
 * El prefijo lo pone el anfitrión (Kitsune usa «kitsune.zero.»); si algún día Zero sale como
 * navegador aparte, cambia el prefijo y nada más.
 */
export const PREFS = Object.freeze({
  always: 'always',       // las ventanas nuevas nacen en Zero
  inherit: 'inherit',     // las ventanas nuevas nacen como la ventana desde la que se abren
  variant: 'variant',     // el modo (Risco, 21-10): 'nacar' = Claro | 'sobrio' = Oscuro (variantOf)
  backdrop: 'backdrop',   // 'auto' | 'system' (desenfoque del compositor) | 'web' (fondo del color de la web)
  backgroundImage: 'background.image',     // ruta de la foto propia del fondo
  backgroundOpacity: 'background.opacity', // opacidad del fondo pintado (espacio, niebla, foto), de 0.2 a 1 (string)
  focus: 'focus.enabled',                  // el modo Currar/Chill y sus automatismos
  volume: 'volume',       // el volumen de Kitsune, de 0 a 1 (string): multiplica el de lo que suena (zero-audio)
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
  welcomed: 'welcomed',               // ya se dijo una vez cómo volver de Zero
  railIcons: 'railIcons',             // el raíl con solo iconos (sin ensancharse ni títulos)
  hints: 'hints',                     // la «i» de ayuda junto a las opciones de los ajustes
  growAt: 'growAt',                   // dónde se dejaron los botones de ampliar (JSON {x, y}, de 0 a 1)
  glassStrength: 'glass.strength',    // la fuerza de la lámina de vidrio (doblez y brillos), de 0 a 100 o más
});

export const DEFAULTS = Object.freeze({ always: false, inherit: true, variant: 'nacar', backdrop: 'auto', backgroundImage: '', backgroundOpacity: '1', focus: true, volume: '1', islandIcons: false,
  pomodoro: false, pomodoroPreset: '25', pomodoroBreak: 'soft', pomodoroGuide: 'breathe', pomodoroState: '',
  silence: false, silenceNotify: true, silenceBlock: true, silenceBlocked: '', silenceOnlyWork: false, silenceScroll: true,
  sounds: false, soundsLevels: '{"lluvia":0.5}', soundsPause: true, welcomed: false, railIcons: false, hints: true, growAt: '' });

export const prefName = (prefix, key) => `${prefix}${key}`;

/** Los dos modos de Zero (Risco, 21-10; antes, las variantes Nácar y Sobrio): «nacar» es Claro (las piezas de
 *  cristal claro y transparente) y «sobrio» es Oscuro (el cristal ahumado). Lo de alrededor (esquinas, filo,
 *  lámina, fondo de serie) es el de Sobrio en los dos. Cualquier otra cosa, la de serie (Claro). */
export const variantOf = value => value === 'sobrio' ? 'sobrio' : 'nacar';

/** Las webs siguen el modo: el valor de layout.css.prefers-color-scheme.content-override (0 oscuro, 1 claro). */
export const websiteScheme = value => variantOf(value) === 'sobrio' ? 0 : 1;

/** El atajo de Zero, escrito como lo escribe cada sistema (en Mac, Cmd y Opción). */
export const shortcutText = os => os === 'Darwin' ? '⌘⌥0' : 'Ctrl+Alt+0';

/** Los ajustes de Zero; si no se pueden leer, los de serie. */
export function readPrefs(prefs, prefix) {
  const read = (getter, key) => {
    try { return prefs[getter](prefName(prefix, PREFS[key]), DEFAULTS[key]); } catch { return DEFAULTS[key]; }
  };
  // Cada ajuste se lee con el tipo de su valor de serie.
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, read(typeof value === 'boolean' ? 'getBoolPref' : 'getStringPref', key)]));
}
