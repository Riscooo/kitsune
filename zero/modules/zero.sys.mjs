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
import { readPrefs, PREFS, prefName, shortcutText } from './zero-config.sys.mjs';
import * as frame from './zero-frame.sys.mjs';
import * as pane from './zero-pane.sys.mjs';
import * as island from './zero-island.sys.mjs';
import * as rail from './zero-rail.sys.mjs';
import * as profiles from './zero-profiles.sys.mjs';
import * as shortcuts from './zero-shortcuts.sys.mjs';
import * as music from './zero-music.sys.mjs';
import * as mark from './zero-mark.sys.mjs';
import * as pomodoro from './zero-pomodoro.sys.mjs';
import * as silence from './zero-silence.sys.mjs';
import * as sounds from './zero-sounds.sys.mjs';
import * as downloads from './zero-downloads.sys.mjs';
import * as media from './zero-media.sys.mjs';
import * as audio from './zero-audio.sys.mjs';
import * as grab from './zero-grab.sys.mjs';
import * as glass from './zero-glass.sys.mjs';

const SHEET = 'chrome://browser/content/zero/zero.css';
const REMEMBER = 'kitsune-zero';
let host = null;
// Las piezas de Zero, en orden: al encender se ponen así y al apagar se quitan al revés.
// La lámina va la primera (detrás de todo, y así recibe ya la primera foto del marco); el cristal en
// vivo, el último: se pone detrás de las piezas que ya están.
const pieces = [pane, frame, island, rail, grab, profiles, shortcuts, music, audio, mark, pomodoro, silence, sounds, downloads, media, glass];
const decorated = new WeakSet();
const starting = new WeakSet(); // ventanas que ya esperan a terminar de arrancar
const early = new WeakSet();    // ventanas que ya se pintan en Zero y esperan a sus piezas
const listeners = new WeakMap(); // ventana → Set de funciones (active) => …
const aside = new WeakSet();     // ventanas que apartaron Zero para personalizar la barra

const active = win => win.document.documentElement.hasAttribute('zero');

// Las ventanas que restaura la sesión al arrancar siguen su propio recuerdo, no la de al lado.
let sessionRestored = false;

/** La ventana desde la que se abre esta: la última que tuvo el foco (la nueva aún no lo tiene). */
function openedFrom(win) {
  try {
    const { BrowserWindowTracker } = ChromeUtils.importESModule('resource:///modules/BrowserWindowTracker.sys.mjs');
    return BrowserWindowTracker.orderedWindows.find(other => other !== win && !other.closed) ?? null;
  } catch { return null; }
}

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

/** Que nada aparezca de golpe: lo que llega (las piezas al entrar, las barras de Kitsune al salir)
 *  entra con un fundido corto, el de «aparecer» de Zero. Con «reducir movimiento», nada. */
function fadeIn(win, ids, ms) {
  if (ms < 2 || win.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const id of ids) win.document.getElementById(id)?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'cubic-bezier(.4, 0, .2, 1)' });
}
const fadeOf = win => parseFloat(win.getComputedStyle(win.document.documentElement).getPropertyValue('--zero-t-fade')) || 0;

/** La primera vez que se entra en Zero, la isla dice un momento cómo volver (al acabar de entrar). */
function welcome(win) {
  const name = prefName(host.prefix, PREFS.welcomed);
  try { if (host.prefs.getBoolPref(name, false)) return; host.prefs.setBoolPref(name, true); } catch { return; }
  const keys = shortcutText(Services.appinfo.OS);
  win.setTimeout(() => { if (active(win)) island.alert(win, 'Kitsune Zero', host.t(`${keys} para volver`, `${keys} to go back`), 3600); }, 900);
}

function toggle(win, on = !active(win), { keep = false } = {}) {
  // Personalizando la barra, Zero no se pone encima: vuelve solo al terminar (ver decorate).
  if (on && win.document.documentElement.hasAttribute('customizing')) return;
  const waiting = early.delete(win);
  if (on === active(win) && !waiting) return;
  const ctx = {
    host,
    onChange: fn => onChange(win, fn),
    // Para las fases siguientes: sus filas en los ajustes y sus avisos en la isla.
    settings: { add: section => mark.addSection(win, section) },
    island: {
      alert: (text, detail, ms, icon, options) => island.alert(win, text, detail, ms, icon, options),
      activity: (key, data) => island.activity(win, key, data),
      endActivity: key => island.endActivity(win, key),
      nowPlaying: data => island.nowPlaying(win, data),
    },
  };
  if (on) {
    // La web pasa a tarjeta viajando desde donde estaba (flip), no de golpe; si la ventana ya nació
    // con el aspecto de Zero, no hay viaje: solo llegan las piezas.
    if (!waiting) frame.flip(win, () => { win.document.documentElement.setAttribute('zero', ''); sheet(win, true); });
    for (const p of pieces) { try { p.attach(win, ctx); } catch (error) { console.error('Kitsune Zero:', error); } }
    fadeIn(win, ['navigator-toolbox', 'zero-rail', 'zero-lights', 'zero-mark', 'zero-pomo'], fadeOf(win));
    welcome(win);
  } else {
    const fade = fadeOf(win);
    // La web vuelve a su sitio viajando, como al entrar: desde donde se ve ahora (antes de quitar las
    // piezas, que con la web ampliada también la mueven).
    const first = win.document.getElementById('tabbrowser-tabpanels')?.getBoundingClientRect();
    for (const p of [...pieces].reverse()) { try { p.detach(win); } catch (error) { console.error('Kitsune Zero:', error); } }
    // (Una ventana que se pintó en Zero sin llegar a tener piezas también lleva su fondo.)
    frame.flip(win, () => {
      for (const name of ['zero', 'zero-backdrop']) win.document.documentElement.removeAttribute(name);
      sheet(win, false);
    }, first);
    fadeIn(win, ['navigator-toolbox', 'sidebar-main'], fade);
  }
  if (!keep) remember(win, on);
  for (const fn of listeners.get(win) ?? []) { try { fn(on); } catch { /* una escucha rota no para a las demás */ } }
}

function onChange(win, fn) {
  if (!listeners.has(win)) listeners.set(win, new Set());
  listeners.get(win).add(fn);
  return () => listeners.get(win)?.delete(fn);
}

async function decorate(win) {
  if (!host || decorated.has(win) || starting.has(win)) return;
  starting.add(win);
  // De dónde viene, antes de esperar: luego la nueva ya tiene el foco.
  const from = sessionRestored ? openedFrom(win) : null;
  win.SessionStore?.promiseAllWindowsRestored?.then(() => { sessionRestored = true; }, () => {});
  // Si ya se sabe que nace en Zero, su aspecto se pone ahora, antes de que se pinte por primera vez:
  // así no enseña un momento Kitsune normal para luego transformarse. Las piezas llegan al arrancar.
  const first = readPrefs(host.prefs, host.prefix);
  if (win.toolbar?.visible !== false && (first.always || (first.inherit && from && active(from)))) {
    const root = win.document.documentElement;
    root.setAttribute('zero', '');
    root.setAttribute('zero-variant', frame.variantOf(first.variant));
    const backdrop = frame.knownBackdrop(first.backdrop, win.matchMedia('(prefers-color-scheme: dark)').matches, first.variant);
    if (backdrop) root.setAttribute('zero-backdrop', backdrop);
    sheet(win, true);
    early.add(win);
  }
  // Si la sesión restaura esta ventana (al arrancar o al reabrir una cerrada), vuelve como estaba, en
  // Zero o no, y no hereda nada. Puede pasar antes de que termine de arrancar: se escucha desde ya.
  let restored = false;
  win.addEventListener('SSWindowRestored', () => {
    restored = true;
    if (decorated.has(win)) toggle(win, readPrefs(host.prefs, host.prefix).always || remembered(win));
  });
  // El arranque de Kitsune llama mientras se lee browser.xhtml, cuando aún no hay gBrowser: se espera
  // a que la ventana termine de arrancar antes de mirar nada.
  if (!win.gBrowser || !win.gBrowserInit?.delayedStartupFinished) await win.delayedStartupPromise;
  if (decorated.has(win) || !win.gBrowser || !win.toolbar?.visible) {
    if (early.delete(win)) { for (const name of ['zero', 'zero-backdrop']) win.document.documentElement.removeAttribute(name); sheet(win, false); }
    return;
  }
  decorated.add(win);
  host.keys?.add(win, 'kitsune-zero-key', '0', 'accel,alt', () => toggle(win));
  // Ampliar la web y dejar de ampliarla (Risco, 15-10); se cambia en «Atajos de teclado…».
  host.keys?.add(win, 'kitsune-zero-full-key', 'F', 'accel,alt', () => { if (active(win)) frame.toggleFull(win); });
  // Personalizar la barra (menú ≡ → Personalizar) necesita verla: mientras dura, Zero se aparta (sin
  // olvidarse para la próxima sesión) y vuelve al terminar.
  win.gNavToolbox?.addEventListener('beforecustomization', () => { if (active(win)) { aside.add(win); toggle(win, false, { keep: true }); } });
  win.gNavToolbox?.addEventListener('aftercustomization', () => { if (aside.delete(win)) toggle(win, true, { keep: true }); });
  const { always, inherit } = readPrefs(host.prefs, host.prefix);
  const wanted = always || remembered(win) || (inherit && !restored && from && active(from));
  if (wanted || early.has(win)) toggle(win, wanted);
}

export const Zero = {
  start(h) { host ??= h; frame.warm(); },
  decorate: win => decorate(win),
  toggle: (win, on) => toggle(win, on),
  active: win => active(win),
  onChange: (win, fn) => onChange(win, fn),
};
