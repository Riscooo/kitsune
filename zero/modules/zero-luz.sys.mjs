/* Kitsune Zero · la luz y el material.
 *
 * - La luz: el tema del momento (zero-sol.mjs: amanecer, día, atardecer, noche, interpolados) en variables CSS
 *   (--sol-*) en la raíz de cada ventana con Zero, y su esquema en zero-sol-scheme. Un solo temporizador para
 *   todas las ventanas, que se despierta cuando cambia algo visible (cada pocos minutos durante una transición;
 *   si no, al empezar la siguiente) y al volver de una suspensión. Ni bucles ni fotogramas: el cambio entre dos
 *   miradas es tan pequeño que no se ve, y no se recarga ni se recrea nada.
 * - El material (Windows 11): Acrílico o Mica de DWM detrás de la ventana transparente de Zero, con los ajustes de
 *   Gecko que lo encienden (zero-material.mjs). zero-material en la raíz dice cuál; zero-frame lo trata como «el
 *   cristal del sistema» (fondo «system») y zero.css pinta encima el tinte del marco y las superficies, cada una
 *   con su opacidad. Las webs siguen opacas con sus colores; transparentes solo con el ajuste experimental.
 * - Sus ajustes, en la sección «Luz y material».
 *
 * Avisa a las demás piezas con dos eventos en la ventana: «zero-sol» (cambió el esquema claro/oscuro) y
 * «zero-material» (cambió el material).
 */
import { PREFS, DEFAULTS, prefName } from './zero-config.sys.mjs';
import { themeAt, normalizeConfig, cssVars, parseCoords, parseClock } from './zero-sol.mjs';
import { resolveMaterial, glassy, geckoPrefs, surfaceAlpha, tintAlpha, SURFACE, TINT, SYSTEM_BACKDROP_BUILD } from './zero-material.mjs';

// Los temporizadores de Gecko, al usarlos (así este módulo se puede importar fuera de Gecko, en las pruebas de Node).
let timers = null;
const setTimeout = (fn, ms) => (timers ??= ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs')).setTimeout(fn, ms);
const clearTimeout = id => timers?.clearTimeout(id);

const TRANSPARENT_BROWSER = 'browser.tabs.allow_transparent_browser';
const windows = new Map(); // ventana → { cleanups, vars }
let host = null;
let theme = null;
let timer = null;
let globalCleanups = [];

// ---------------------------------------------------------------- ajustes

const str = key => { try { return host.prefs.getStringPref(prefName(host.prefix, PREFS[key]), DEFAULTS[key]); } catch { return DEFAULTS[key]; } };
const bool = key => { try { return host.prefs.getBoolPref(prefName(host.prefix, PREFS[key]), DEFAULTS[key]); } catch { return DEFAULTS[key]; } };

/** La configuración de la luz, de los ajustes de Zero. */
export function lightConfig() {
  const coords = parseCoords(str('lightCoords'));
  const [sunrise, sunset] = String(str('lightClock')).split('-');
  return normalizeConfig({
    mode: str('light'), latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null,
    sunrise, sunset, period: str('lightPeriod'), transition: str('lightTransition'), scheme: str('lightScheme'),
  });
}

// ---------------------------------------------------------------- el material

/** Lo que hace falta saber del sistema para elegir el material. Sin ventana, sin las preferencias de accesibilidad. */
function materialEnv(win) {
  const os = Services.appinfo.OS;
  let build = 0;
  if (os === 'WINNT') {
    try { build = Services.sysinfo.isWindows10BuildOrLater(SYSTEM_BACKDROP_BUILD) ? SYSTEM_BACKDROP_BUILD : 19041; } catch { /* sin versión */ }
  }
  const media = query => { try { return !!win?.matchMedia(query).matches; } catch { return false; } };
  return {
    os, build,
    highContrast: media('(forced-colors: active)'),
    reducedTransparency: media('(prefers-reduced-transparency: reduce)'),
    saver: !!host?.saver?.active,
  };
}

/** El material de ahora: 'acrylic' | 'mica' | 'opaque' en Windows; null en los demás sistemas. */
export function currentMaterial(win = null) {
  if (!host) return null;
  return resolveMaterial(str('material'), materialEnv(win));
}

/** Enciende (o apaga) el material de DWM en Gecko. Los ajustes de Gecko se aplican en caliente a todas sus ventanas;
 *  solo se escriben si cambian. */
function applyGecko(material) {
  if (Services.appinfo.OS !== 'WINNT') return;
  for (const [name, value] of Object.entries(geckoPrefs(material))) {
    try {
      if (typeof value === 'boolean') { if (Services.prefs.getBoolPref(name, false) !== value) Services.prefs.setBoolPref(name, value); }
      else if (Services.prefs.getIntPref(name, 0) !== value) Services.prefs.setIntPref(name, value);
    } catch (error) { console.error('Kitsune Zero: no se pudo poner el material', name, error); }
  }
}

/** Las webs transparentes (experimental): solo con cristal detrás, y las pestañas que se creen desde entonces. */
function applyWebTransparency(on) {
  try {
    if (on) { if (!Services.prefs.getBoolPref(TRANSPARENT_BROWSER, false)) Services.prefs.setBoolPref(TRANSPARENT_BROWSER, true); }
    else if (Services.prefs.prefHasUserValue(TRANSPARENT_BROWSER)) Services.prefs.clearUserPref(TRANSPARENT_BROWSER);
  } catch { /* sin el ajuste */ }
}

// ---------------------------------------------------------------- aplicar

function setVar(root, st, name, value) {
  const text = String(value);
  if (st.vars.get(name) === text) return;
  st.vars.set(name, text);
  root.style.setProperty(name, text);
}

function clearVars(root, st) {
  for (const name of st.vars.keys()) root.style.removeProperty(name);
  st.vars.clear();
}

/** El tema de ahora (uno para todas las ventanas). */
function compute() {
  const config = lightConfig();
  theme = config.mode === 'off' ? null : themeAt(Date.now(), config);
  return theme;
}

/** Pone la luz y el material en una ventana: atributos y variables, solo lo que cambia. */
function paint(win, st) {
  const root = win.document.documentElement;
  const material = currentMaterial(win);
  applyGecko(material);
  // Gecko pone el material en las ventanas con windowsmica (browser.xhtml lo trae; por si otro anfitrión no).
  if (material && !root.hasAttribute('windowsmica')) root.setAttribute('windowsmica', 'true');
  const before = root.getAttribute('zero-material');
  if (material) root.setAttribute('zero-material', material); else root.removeAttribute('zero-material');
  setVar(root, st, '--zero-surface-alpha', surfaceAlpha(str('surfaceOpacity')));
  setVar(root, st, '--zero-frame-tint', glassy(material) ? tintAlpha(str('surfaceTint')) : 1);
  const clear = glassy(material) && bool('webTransparent');
  root.toggleAttribute('zero-web-clear', clear);
  applyWebTransparency(clear);
  if (before !== (material ?? null)) win.dispatchEvent(new win.CustomEvent('zero-material', { detail: { material } }));

  const schemeBefore = root.getAttribute('zero-sol-scheme');
  const styleBefore = root.getAttribute('zero-sol-style');
  if (theme) {
    root.setAttribute('zero-sol', theme.period);
    root.setAttribute('zero-sol-scheme', theme.scheme);
    // El estilo elegido (Auto, Claro u Oscuro): zero-frame decide con él si las webs siguen el modo (como sin la luz).
    root.setAttribute('zero-sol-style', theme.style ?? 'auto');
    for (const [name, value] of Object.entries(cssVars(theme))) setVar(root, st, name, value);
  } else {
    for (const name of ['zero-sol', 'zero-sol-scheme', 'zero-sol-style']) root.removeAttribute(name);
    for (const name of [...st.vars.keys()].filter(n => n.startsWith('--sol-'))) { root.style.removeProperty(name); st.vars.delete(name); }
  }
  if (schemeBefore !== root.getAttribute('zero-sol-scheme') || styleBefore !== root.getAttribute('zero-sol-style')) {
    win.dispatchEvent(new win.CustomEvent('zero-sol', { detail: { scheme: theme?.scheme ?? null, style: theme?.style ?? null } }));
  }
}

function schedule() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!windows.size || !theme?.next) return;
  timer = setTimeout(refresh, Math.max(30000, theme.next - Date.now()));
}

/** Vuelve a mirar la hora y lo pone en todas las ventanas. */
export function refresh() {
  if (!host) return;
  compute();
  for (const [win, st] of windows) { try { paint(win, st); } catch (error) { console.error('Kitsune Zero: luz', error); } }
  schedule();
}

/** Para las ventanas que nacen en Zero (zero.sys.mjs, antes del primer pintado): la luz y el material desde el
 *  primer fotograma, sin pasar por el aspecto de serie. */
export function early(win, h) {
  host ??= h;
  if (!theme) compute();
  paint(win, { vars: new Map() });
}

/** Al arrancar Zero: si todas las ventanas van a ser de Zero, el material ya puesto antes de que se pinte ninguna. */
export function warm(h, { always = false } = {}) {
  host ??= h;
  if (always || host.app) applyGecko(currentMaterial(null));
}

function watchGlobal() {
  if (globalCleanups.length) return;
  const observer = { observe: () => refresh() };
  const branches = ['light.', PREFS.material, 'surface.', PREFS.webTransparent].map(key => prefName(host.prefix, key));
  for (const name of branches) host.prefs.addObserver(name, observer);
  const wake = { observe: () => refresh() };
  // Al volver de una suspensión (o al cambiar la hora del sistema), la luz se pone al día.
  for (const topic of ['wake_notification', 'system-clock-change']) Services.obs.addObserver(wake, topic);
  globalCleanups = [
    () => { for (const name of branches) host.prefs.removeObserver(name, observer); },
    () => { for (const topic of ['wake_notification', 'system-clock-change']) { try { Services.obs.removeObserver(wake, topic); } catch { /* ya no estaba */ } } },
  ];
}

// ---------------------------------------------------------------- ajustes de la luz

function section(win) {
  const { prefs, prefix } = host;
  const t = host.t;
  const set = key => value => prefs.setStringPref(prefName(prefix, PREFS[key]), String(value));
  const mode = () => lightConfig().mode;
  const windowsGlass = () => Services.appinfo.OS === 'WINNT';
  return {
    id: 'luz',
    watch: fn => {
      const observer = { observe: () => fn() };
      const names = ['light.', PREFS.material, 'surface.', PREFS.webTransparent].map(key => prefName(prefix, key));
      for (const name of names) prefs.addObserver(name, observer);
      return () => { for (const name of names) prefs.removeObserver(name, observer); };
    },
    rows: [
      {
        kind: 'segment', id: PREFS.light,
        label: t('Luz', 'Light'),
        detail: t('Del sol: los colores siguen la salida y la puesta del sol en tus coordenadas (sin ellas, la hora). Por la hora: a horas fijas. Fija: una luz siempre. Apagada: el aspecto de siempre.',
                  'Sun: colours follow sunrise and sunset at your coordinates (without them, the clock). Clock: at fixed times. Fixed: always one light. Off: the usual look.'),
        options: [{ value: 'solar', label: t('Del sol', 'Sun') }, { value: 'clock', label: t('Por la hora', 'Clock') },
                  { value: 'fixed', label: t('Fija', 'Fixed') }, { value: 'off', label: t('Apagada', 'Off') }],
        get: () => mode(),
        set: set('light'),
      },
      {
        kind: 'list', id: PREFS.lightCoords, when: () => mode() === 'solar',
        label: t('Coordenadas', 'Coordinates'),
        detail: t('Latitud y longitud con un decimal (unos 10 km): no hace falta más. Kitsune no pide tu ubicación.',
                  'Latitude and longitude with one decimal (about 10 km): no more is needed. Kitsune never asks for your location.'),
        placeholder: '40.4, -3.7',
        get: () => str('lightCoords'),
        set: value => {
          const coords = parseCoords(value);
          if (!String(value).trim()) set('lightCoords')('');
          else if (coords) set('lightCoords')(`${coords.latitude}, ${coords.longitude}`);
        },
      },
      {
        kind: 'list', id: PREFS.lightClock, when: () => mode() === 'clock' || (mode() === 'solar' && !parseCoords(str('lightCoords'))),
        label: t('Salida y puesta', 'Sunrise and sunset'),
        placeholder: '07:30-19:30',
        get: () => str('lightClock'),
        set: value => {
          const [a, b] = String(value).split('-');
          if (parseClock(a) !== null && parseClock(b) !== null && parseClock(b) > parseClock(a)) set('lightClock')(`${a.trim()}-${b.trim()}`);
        },
      },
      {
        kind: 'segment', id: PREFS.lightPeriod, when: () => mode() === 'fixed',
        label: t('Qué luz', 'Which light'),
        options: [{ value: 'amanecer', label: t('Amanecer', 'Dawn') }, { value: 'dia', label: t('Día', 'Day') },
                  { value: 'atardecer', label: t('Atardecer', 'Dusk') }, { value: 'noche', label: t('Noche', 'Night') }],
        get: () => lightConfig().period,
        set: set('lightPeriod'),
      },
      {
        kind: 'segment', id: PREFS.material, when: windowsGlass,
        label: t('Material', 'Material'),
        detail: t('Lo pone Windows 11 detrás de la ventana. Acrílico desenfoca lo que hay detrás; Mica toma el color del fondo de escritorio y gasta menos. El desenfoque lo decide Windows. Con las transparencias de Windows apagadas, opaco.',
                  'Windows 11 draws it behind the window. Acrylic blurs what is behind; Mica takes the desktop colour and costs less. Windows decides the blur. With Windows transparency effects off, opaque.'),
        options: [{ value: 'auto', label: 'Auto' }, { value: 'acrylic', label: t('Acrílico', 'Acrylic') },
                  { value: 'mica', label: 'Mica' }, { value: 'opaque', label: t('Opaco', 'Opaque') }],
        get: () => str('material'),
        set: set('material'),
      },
      {
        // De 50 % a 100 % (en pantalla, todo el recorrido).
        kind: 'slider', id: PREFS.surfaceOpacity,
        label: t('Superficies', 'Surfaces'),
        detail: t('La opacidad de la isla, el raíl y los menús. El texto y los iconos siempre se ven enteros.',
                  'Opacity of the island, rail and menus. Text and icons always stay solid.'),
        get: () => (surfaceAlpha(str('surfaceOpacity')) - SURFACE.min) / (SURFACE.max - SURFACE.min),
        set: value => set('surfaceOpacity')((SURFACE.min + value * (SURFACE.max - SURFACE.min)).toFixed(2)),
      },
      {
        kind: 'slider', id: PREFS.surfaceTint, when: () => glassy(currentMaterial(win)),
        label: t('Tinte', 'Tint'),
        detail: t('Cuánto color de la luz lleva el marco sobre el material: más, más blanco; menos, más se ve el escritorio.',
                  'How much of the light colour the frame carries over the material: more is whiter; less shows more desktop.'),
        get: () => tintAlpha(str('surfaceTint')) / TINT.max,
        set: value => set('surfaceTint')((value * TINT.max).toFixed(2)),
      },
      {
        kind: 'switch', id: PREFS.webTransparent, when: () => glassy(currentMaterial(win)),
        label: t('Webs transparentes (experimental)', 'Transparent pages (experimental)'),
        detail: t('Las páginas sin fondo propio dejan ver el material. Solo en las pestañas nuevas; muchas webs cuentan con un fondo blanco y se leerán peor.',
                  'Pages without their own background show the material. New tabs only; many sites rely on a white background and will be harder to read.'),
        get: () => bool('webTransparent'),
        set: on => prefs.setBoolPref(prefName(prefix, PREFS.webTransparent), !!on),
      },
    ],
  };
}

// ---------------------------------------------------------------- la pieza

export function attach(win, ctx) {
  host ??= ctx.host;
  const st = { cleanups: [], vars: new Map() };
  windows.set(win, st);
  watchGlobal();
  if (!theme || windows.size === 1) compute();
  paint(win, st);
  // Si Windows cambia el alto contraste o las transparencias, el material se vuelve a elegir.
  for (const query of ['(forced-colors: active)', '(prefers-reduced-transparency: reduce)']) {
    const list = win.matchMedia(query);
    const onChange = () => paint(win, st);
    list.addEventListener('change', onChange);
    st.cleanups.push(() => list.removeEventListener('change', onChange));
  }
  ctx.settings?.add(section(win));
  schedule();
}

export function detach(win) {
  const st = windows.get(win);
  if (!st) return;
  windows.delete(win);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
  const root = win.document.documentElement;
  for (const name of ['zero-sol', 'zero-sol-scheme', 'zero-sol-style', 'zero-material', 'zero-web-clear']) root.removeAttribute(name);
  clearVars(root, st);
  if (!windows.size) {
    // Sin ventanas de Zero, ni temporizador ni material (las ventanas normales de Kitsune son opacas).
    if (timer) { clearTimeout(timer); timer = null; }
    for (const undo of globalCleanups) { try { undo(); } catch { /* ya no estaba */ } }
    globalCleanups = [];
    if (!host?.app) { applyGecko('opaque'); applyWebTransparency(false); }
  }
}

/** Para las pruebas nativas: el tema y el material de ahora, y cuándo se volverá a mirar. */
export function snapshot() {
  return { theme, material: currentMaterial(windows.keys().next().value ?? null), windows: windows.size, timer: !!timer };
}
