/* Kitsune Zero · entrada.
 *
 * Zero es un modo de ventana: Ctrl+Alt+0 la pasa a Zero y la devuelve, con las mismas pestañas.
 * Este módulo no importa nada de Kitsune: lo que necesita del navegador que lo lleva (textos,
 * ajustes, atajos) se lo da un «anfitrión» en start(host). Así Zero se puede sacar algún día como
 * navegador aparte sin tocar su código (ver zero/README.md).
 *
 * Cada pieza de Zero (marco, isla, raíl…) es un módulo con attach(win, ctx) y detach(win), en la
 * lista «pieces». El CSS, zero.css, solo se carga en las ventanas con Zero.
 */
import { readPrefs } from './zero-config.sys.mjs';
import * as frame from './zero-frame.sys.mjs';
import * as island from './zero-island.sys.mjs';
import * as rail from './zero-rail.sys.mjs';
import * as mark from './zero-mark.sys.mjs';
import * as glass from './zero-glass.sys.mjs';

const SHEET = 'chrome://browser/content/zero/zero.css';
const REMEMBER = 'kitsune-zero';
let host = null;
// Las piezas de Zero, en orden: al encender se ponen así y al apagar se quitan al revés.
// El cristal en vivo va el último: se pone detrás de las piezas que ya están.
const pieces = [frame, island, rail, mark, glass];
const decorated = new WeakSet();
const listeners = new WeakMap(); // ventana → Set de funciones (active) => …

const active = win => win.document.documentElement.hasAttribute('zero');

function remembered(win) {
  try { return win.SessionStore.getCustomWindowValue(win, REMEMBER) === '1'; } catch { return false; }
}

function remember(win, on) {
  try { win.SessionStore.setCustomWindowValue(win, REMEMBER, on ? '1' : ''); } catch { /* sin sesión */ }
}

// Hoja de usuario, como el userChrome.css de Kitsune: así sus !important pueden con los de Kitsune
// (en la cascada, un !important de autor pierde siempre ante uno de usuario).
function sheet(win, on) {
  const utils = win.windowUtils;
  try {
    if (on) utils.loadSheetUsingURIString(SHEET, utils.USER_SHEET);
    else utils.removeSheetUsingURIString(SHEET, utils.USER_SHEET);
  } catch { /* ya estaba (o ya no estaba) */ }
}

function toggle(win, on = !active(win)) {
  if (on === active(win)) return;
  const ctx = {
    host,
    onChange: fn => onChange(win, fn),
    // Para las fases siguientes: sus filas en los ajustes y sus avisos en la isla.
    settings: { add: section => mark.addSection(win, section) },
    island: { alert: (text, detail, ms) => island.alert(win, text, detail, ms) },
  };
  if (on) {
    // La web pasa a tarjeta viajando desde donde estaba (flip), no de golpe.
    frame.flip(win, () => { win.document.documentElement.setAttribute('zero', ''); sheet(win, true); });
    for (const p of pieces) { try { p.attach(win, ctx); } catch (error) { console.error('Kitsune Zero:', error); } }
  } else {
    for (const p of [...pieces].reverse()) { try { p.detach(win); } catch (error) { console.error('Kitsune Zero:', error); } }
    win.document.documentElement.removeAttribute('zero');
    sheet(win, false);
  }
  remember(win, on);
  for (const fn of listeners.get(win) ?? []) { try { fn(on); } catch { /* una escucha rota no para a las demás */ } }
}

function onChange(win, fn) {
  if (!listeners.has(win)) listeners.set(win, new Set());
  listeners.get(win).add(fn);
  return () => listeners.get(win)?.delete(fn);
}

async function decorate(win) {
  if (!host || decorated.has(win)) return;
  // El arranque de Kitsune llama mientras se lee browser.xhtml, cuando aún no hay gBrowser: se espera
  // a que la ventana termine de arrancar antes de mirar nada.
  if (!win.gBrowser || !win.gBrowserInit?.delayedStartupFinished) await win.delayedStartupPromise;
  if (decorated.has(win) || !win.gBrowser || !win.toolbar?.visible) return;
  decorated.add(win);
  host.keys?.add(win, 'kitsune-zero-key', '0', 'accel,alt', () => toggle(win));
  const { always } = readPrefs(host.prefs, host.prefix);
  if (always || remembered(win)) toggle(win, true);
  // La sesión se restaura después de abrir la ventana: si esta estaba en Zero, vuelve en Zero.
  win.addEventListener('SSWindowRestored', () => { if (remembered(win)) toggle(win, true); });
}

export const Zero = {
  start(h) { host ??= h; },
  decorate: win => decorate(win),
  toggle: (win, on) => toggle(win, on),
  active: win => active(win),
  onChange: (win, fn) => onChange(win, fn),
};
