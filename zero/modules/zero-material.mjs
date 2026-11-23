/* Kitsune Zero · el material de la ventana (puro, sin Gecko: se prueba con Node).
 *
 * En Windows 11 el material lo pone el propio Windows (DWM) detrás de la ventana transparente de Zero: Gecko
 * llama a DwmSetWindowAttribute(DWMWA_SYSTEMBACKDROP_TYPE) en las ventanas con el atributo windowsmica cuando
 * widget.windows.mica está encendido, y widget.windows.mica.toplevel-backdrop dice cuál (nsWindow::
 * UpdateMicaBackdrop: 1 = Mica, DWMSBT_MAINWINDOW; 2 = Acrylic, DWMSBT_TRANSIENTWINDOW; otro valor = Mica Alt).
 * Los dos ajustes de Gecko se aplican en caliente a todas las ventanas (WinUtils::UpdateMicaInAllWindows).
 *
 * Lo que Windows no deja elegir no se finge: el radio del desenfoque y su saturación los decide DWM. Zero solo
 * controla lo que pinta encima (el tinte del marco y la opacidad de sus superficies).
 */

export const MATERIALS = Object.freeze(['auto', 'acrylic', 'mica', 'opaque']);

/** widget.windows.mica.toplevel-backdrop para cada material. */
export const TOPLEVEL_BACKDROP = Object.freeze({ mica: 1, acrylic: 2 });
export const GECKO_PREFS = Object.freeze({ enabled: 'widget.windows.mica', backdrop: 'widget.windows.mica.toplevel-backdrop' });

/** DWMWA_SYSTEMBACKDROP_TYPE existe desde Windows 11 22H2 (22621); Gecko no lo usa antes (WinUtils::MicaAvailable). */
export const SYSTEM_BACKDROP_BUILD = 22621;

export const SURFACE = Object.freeze({ min: 0.5, max: 1, default: 0.85 });
export const TINT = Object.freeze({ min: 0, max: 0.95, default: 0.7 });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** El material que toca: 'acrylic' | 'mica' | 'opaque' en Windows, null en los demás sistemas (allí manda el
 *  cristal de su escritorio, en zero-frame). Opaco si Windows no lo tiene, con alto contraste o con las
 *  transparencias apagadas. En «auto», Acrílico; con el modo ahorro, Mica (DWM la muestrea del fondo de
 *  escritorio una vez, en vez de desenfocar en vivo lo que hay detrás). */
export function resolveMaterial(pref, env = {}) {
  if (env.os !== 'WINNT') return null;
  if (!(Number(env.build) >= SYSTEM_BACKDROP_BUILD)) return 'opaque';
  if (env.highContrast || env.reducedTransparency) return 'opaque';
  const wanted = MATERIALS.includes(pref) ? pref : 'auto';
  if (wanted !== 'auto') return wanted;
  return env.saver ? 'mica' : 'acrylic';
}

/** ¿Deja ver lo de detrás? */
export const glassy = material => material === 'acrylic' || material === 'mica';

/** Los ajustes de Gecko para un material: { 'widget.windows.mica': bool, 'widget.windows.mica.toplevel-backdrop'?: n }. */
export function geckoPrefs(material) {
  if (!glassy(material)) return { [GECKO_PREFS.enabled]: false };
  return { [GECKO_PREFS.enabled]: true, [GECKO_PREFS.backdrop]: TOPLEVEL_BACKDROP[material] };
}

/** Un número guardado como texto, dentro de sus límites; si no vale, el de serie. */
function level(value, { min, max, default: fallback }) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, min, max) : fallback;
}

/** La opacidad de las superficies de Zero (isla, raíl, menús): de 0,5 a 1. */
export const surfaceAlpha = value => level(value, SURFACE);
/** Cuánto color de la luz lleva el marco encima del material: de 0 (solo el material) a 0,95. */
export const tintAlpha = value => level(value, TINT);
