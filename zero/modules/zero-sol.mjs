/* Kitsune Zero · la luz del día (puro, sin Gecko: se prueba con Node y lo pueden usar otros programas).
 *
 * Un motor de temas que no es de Zero: dice qué luz toca a cada hora (amanecer, día, atardecer, noche), con
 * los colores interpolados entre una y otra, y cuándo merece la pena volver a mirar. Zero lo usa en
 * zero-luz.sys.mjs; el resto del escritorio (barra de tareas, fondo de Wallpaper Engine, otros programas) puede
 * usar lo mismo con tools/sol/sol.mjs, que escribe el tema en JSON. Ver docs/zero/luz.md.
 *
 * - Salida y puesta del sol con las fórmulas de SunCalc (Agafonkin, BSD; las de Astronomy Answers): unos
 *   pocos minutos de error, de sobra para cambiar un color. Las coordenadas bastan con un decimal (~10 km).
 * - Sin coordenadas, «por la hora»: una salida y una puesta fijas (07:30 y 19:30 de serie).
 * - Los colores se mezclan en OKLab (perceptual: el paso de marfil a grafito no pasa por un gris sucio) con
 *   una curva suave, y el texto nunca se mezcla de un esquema a otro: se elige el del esquema que manda y se
 *   empuja hasta tener contraste (WCAG) con la superficie que haya en ese momento.
 * - Sin bucles: next dice cuándo cambia algo visible (cada `step` minutos durante una transición; si no, al
 *   empezar la siguiente).
 */

export const SCHEMA = 1;
export const PERIODS = Object.freeze(['amanecer', 'dia', 'atardecer', 'noche']);
export const MODES = Object.freeze(['solar', 'clock', 'fixed', 'off']);
export const COLOR_TOKENS = Object.freeze(['surface', 'raised', 'line', 'text', 'quiet', 'accent', 'shadow']);

/** Las cuatro luces. Superficies blancas, mates y poco saturadas; el día es la identidad. `material` es cuánto se
 *  deja ver el material de detrás (0 nada, 1 todo): de noche, algo menos. */
export const PALETTES = Object.freeze({
  amanecer: Object.freeze({ surface: '#fff6e8', raised: '#fffbf5', line: '#e6dac8', text: '#2a251e', quiet: '#655d50', accent: '#94733d', shadow: '#3a2c14', scheme: 'light', material: 0.85 }),
  dia: Object.freeze({ surface: '#f5f7fa', raised: '#fbfcfd', line: '#dbe0e7', text: '#1d222a', quiet: '#58616d', accent: '#4f6984', shadow: '#1a2333', scheme: 'light', material: 0.85 }),
  atardecer: Object.freeze({ surface: '#ede2df', raised: '#f5edea', line: '#d8c7c2', text: '#2d2422', quiet: '#655652', accent: '#975f49', shadow: '#3a1f18', scheme: 'light', material: 0.85 }),
  noche: Object.freeze({ surface: '#252d39', raised: '#2d3644', line: '#3d4858', text: '#e8ecf1', quiet: '#a4aebb', accent: '#93a9c4', shadow: '#05080d', scheme: 'dark', material: 0.8 }),
});

/** El «Estilo» con la luz (Risco, 12-11: «encima de la iluminación, también un modo oscuro como antes»):
 *  - 'auto': las cuatro luces de arriba, claras de día y oscuras de noche;
 *  - 'dark': siempre oscuro, pero la luz sigue tiñéndolo: umbra al amanecer, grafito de día, ciruela al atardecer
 *    y azul noche;
 *  - 'light': siempre claro, también de noche (una noche clara, fría). */
export const SCHEMES = Object.freeze(['auto', 'light', 'dark']);

export const DARK_PALETTES = Object.freeze({
  amanecer: Object.freeze({ surface: '#2b2620', raised: '#352f28', line: '#4a4137', text: '#f3ebdf', quiet: '#bcae9b', accent: '#d9b07a', shadow: '#0b0804', scheme: 'dark', material: 0.8 }),
  dia: Object.freeze({ surface: '#202429', raised: '#292e35', line: '#3a414b', text: '#eceff3', quiet: '#a9b1bc', accent: '#94b3d8', shadow: '#040609', scheme: 'dark', material: 0.8 }),
  atardecer: Object.freeze({ surface: '#2a2226', raised: '#342a2f', line: '#4a3c42', text: '#f2e7e8', quiet: '#bba8ac', accent: '#dc9c88', shadow: '#0a0405', scheme: 'dark', material: 0.8 }),
  noche: Object.freeze({ surface: '#1b212b', raised: '#242b37', line: '#343d4c', text: '#e7ebf1', quiet: '#9fa9b8', accent: '#8ea7c8', shadow: '#020306', scheme: 'dark', material: 0.8 }),
});

export const LIGHT_PALETTES = Object.freeze({
  ...PALETTES,
  noche: Object.freeze({ surface: '#e8eaf1', raised: '#f2f3f8', line: '#cfd3de', text: '#1e2230', quiet: '#565d6f', accent: '#56678f', shadow: '#141826', scheme: 'light', material: 0.85 }),
});

/** Las cuatro luces de un estilo. */
export const paletteFamily = scheme => (scheme === 'dark' ? DARK_PALETTES : scheme === 'light' ? LIGHT_PALETTES : PALETTES);

export const DEFAULT_CONFIG = Object.freeze({
  mode: 'solar',        // 'solar' (con coordenadas) | 'clock' (salida y puesta fijas) | 'fixed' (una luz) | 'off'
  latitude: null,
  longitude: null,
  sunrise: '07:30',     // «por la hora», y sin coordenadas
  sunset: '19:30',
  period: 'dia',        // con 'fixed'
  scheme: 'auto',       // el estilo: 'auto' | 'light' | 'dark' (SCHEMES)
  transition: 50,       // minutos que tarda cada cambio a cada lado de la salida y la puesta
  step: 5,              // minutos entre dos repintados durante una transición
});

// ---------------------------------------------------------------- el sol

const RAD = Math.PI / 180;
const DAY = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;
const toDays = ms => ms / DAY - 0.5 + J1970 - J2000;
const fromJulian = j => (j + 0.5 - J1970) * DAY;

/** Salida, mediodía y puesta del sol del día solar más cercano a `date` en esas coordenadas (grados; longitud
 *  positiva al este). { sunrise, noon, sunset } en milisegundos, o { noon, polar: 'day' | 'night' } si ese día el
 *  sol no sale o no se pone. */
export function sunTimes(date, latitude, longitude) {
  const lw = RAD * -longitude, phi = RAD * latitude;
  const d = toDays(+date);
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = RAD * (357.5291 + 0.98560028 * ds);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(OBLIQUITY));
  const transit = ds2 => J2000 + ds2 + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const noon = fromJulian(transit(ds));
  const cosH = (Math.sin(RAD * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH > 1) return { noon, polar: 'night' };
  if (cosH < -1) return { noon, polar: 'day' };
  const w = Math.acos(cosH);
  const set = fromJulian(transit(0.0009 + (w + lw) / (2 * Math.PI) + n));
  return { sunrise: noon - (set - noon), noon, sunset: set };
}

// ---------------------------------------------------------------- color

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** '#rgb' o '#rrggbb' → [r, g, b] de 0 a 255, o null. */
export function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const s = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1];
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
}

export const toHex = rgb => `#${rgb.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

const toLinear = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

function rgbToOklab([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
               -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
               -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map(c => (c = clamp(c, 0, 1), c <= 0.0031308 ? 255 * 12.92 * c : 255 * (1.055 * c ** (1 / 2.4) - 0.055)));
}

/** Mezcla dos colores en OKLab (t = 0, el primero; 1, el segundo). */
export function mix(from, to, t) {
  const a = rgbToOklab(parseHex(from)), b = rgbToOklab(parseHex(to));
  return toHex(oklabToRgb(a.map((v, i) => v + (b[i] - v) * t)));
}

/** Luminancia relativa (WCAG 2), de 0 a 1. */
export function luminance(hex) {
  const [r, g, b] = parseHex(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos colores, de 1 a 21. */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** El color, con la misma tinta (tono y croma en OKLab), aclarado u oscurecido lo justo para llegar a `ratio`
 *  sobre cada uno de los fondos (uno o una lista). `scheme` dice hacia dónde: 'dark' aclara y 'light' oscurece;
 *  sin él, hacia donde hay más sitio sobre el primer fondo. Si no se llega, lo más lejos posible. */
export function ensureContrast(hex, background, ratio, scheme = null) {
  const backgrounds = Array.isArray(background) ? background : [background];
  const worst = color => Math.min(...backgrounds.map(b => contrast(color, b)));
  if (worst(hex) >= ratio) return hex;
  const lab = rgbToOklab(parseHex(hex));
  // Sin esquema: donde el negro y el blanco contrastan igual (luminancia 0,179).
  const darker = scheme ? scheme === 'light' : luminance(backgrounds[0]) >= 0.179;
  const target = darker ? 0 : 1;
  let lo = 0, hi = 1, best = toHex(oklabToRgb([target, 0, 0]));
  for (let i = 0; i < 24; i += 1) {
    const t = (lo + hi) / 2;
    const candidate = toHex(oklabToRgb([lab[0] + (target - lab[0]) * t, lab[1] * (1 - t), lab[2] * (1 - t)]));
    if (worst(candidate) >= ratio) { best = candidate; hi = t; } else lo = t;
  }
  return best;
}

// ---------------------------------------------------------------- configuración

const PERIOD_SET = new Set(PERIODS);

/** 'HH:MM' → minutos desde medianoche, o null. */
export function parseClock(text) {
  const m = /^\s*(\d{1,2})[:.h](\d{2})\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** '40.4, -3.7' → { latitude, longitude } con un decimal (unos 10 km: no hace falta más para el sol), o null. */
export function parseCoords(text) {
  const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const latitude = Number(m[1].replace(',', '.')), longitude = Number(m[2].replace(',', '.'));
  if (!(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180)) return null;
  const round = v => Math.round(v * 10) / 10 || 0;
  return { latitude: round(latitude), longitude: round(longitude) };
}

/** La configuración con cada valor en su sitio (lo que no vale, el de serie). */
export function normalizeConfig(input = {}) {
  const c = { ...DEFAULT_CONFIG };
  if (MODES.includes(input.mode)) c.mode = input.mode;
  const lat = Number(input.latitude), lon = Number(input.longitude);
  if (input.latitude !== null && input.latitude !== undefined && input.latitude !== '' && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
      input.longitude !== null && input.longitude !== undefined && input.longitude !== '' && Number.isFinite(lon) && Math.abs(lon) <= 180) {
    c.latitude = lat; c.longitude = lon;
  }
  if (parseClock(input.sunrise) !== null) c.sunrise = input.sunrise.trim();
  if (parseClock(input.sunset) !== null) c.sunset = input.sunset.trim();
  if (parseClock(c.sunset) <= parseClock(c.sunrise)) { c.sunrise = DEFAULT_CONFIG.sunrise; c.sunset = DEFAULT_CONFIG.sunset; }
  if (PERIOD_SET.has(input.period)) c.period = input.period;
  if (SCHEMES.includes(input.scheme)) c.scheme = input.scheme;
  const transition = Number(input.transition), step = Number(input.step);
  if (Number.isFinite(transition)) c.transition = clamp(transition, 5, 180);
  if (Number.isFinite(step)) c.step = clamp(step, 1, 30);
  c.palettes = normalizePalettes(input.palettes, c.scheme);
  return c;
}

/** Paletas propias sobre las de serie (las del estilo): solo los colores que sean '#rrggbb', y el esquema y el
 *  material válidos. */
export function normalizePalettes(custom, scheme = 'auto') {
  const out = {};
  const family = paletteFamily(scheme);
  for (const period of PERIODS) {
    const base = family[period], given = custom?.[period] ?? {};
    const palette = { ...base };
    for (const token of COLOR_TOKENS) if (parseHex(given[token])) palette[token] = toHex(parseHex(given[token]));
    if (given.scheme === 'light' || given.scheme === 'dark') palette.scheme = given.scheme;
    if (Number.isFinite(Number(given.material))) palette.material = clamp(Number(given.material), 0, 1);
    out[period] = palette;
  }
  return out;
}

// ---------------------------------------------------------------- la línea del día

/** El día local (a medianoche) que contiene `ms`, desplazado `offset` días. */
function localDay(ms, offset = 0) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
}

/** Salida y puesta de un día local: del sol, si hay coordenadas y el modo es «solar»; si no, las de la hora. */
export function dayEvents(day, config) {
  if (config.mode === 'solar' && config.latitude !== null && config.longitude !== null) {
    const noon = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12);
    const sun = sunTimes(noon, config.latitude, config.longitude);
    if (sun.polar) return { polar: sun.polar, start: +day, end: +localDay(+day, 1), source: 'solar' };
    return { sunrise: sun.sunrise, sunset: sun.sunset, source: 'solar' };
  }
  const at = minutes => +new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
  return { sunrise: at(parseClock(config.sunrise)), sunset: at(parseClock(config.sunset)), source: 'clock' };
}

/** Los fotogramas clave de un día: [ms, luz]. De noche hasta un poco antes de salir el sol; el amanecer justo
 *  después; el día; el atardecer justo antes de ponerse, y la noche después. Con días cortos, las transiciones de
 *  día se acortan para que el día siga existiendo. */
export function dayKeys(events, transitionMinutes) {
  if (events.polar) {
    const period = events.polar === 'day' ? 'dia' : 'noche';
    return [[events.start, period], [events.end, period]];
  }
  const { sunrise: R, sunset: S } = events;
  const t = transitionMinutes * 60000;
  const a = Math.min(t, Math.max(0, S - R) / 4.5);
  return [[R - t, 'noche'], [R + a / 2, 'amanecer'], [R + 2 * a, 'dia'], [S - 2 * a, 'dia'], [S - a / 2, 'atardecer'], [S + t, 'noche']];
}

/** Ayer, hoy y mañana seguidos (las transiciones pueden cruzar la medianoche), ordenados. */
export function timeline(ms, config) {
  const keys = [];
  for (const offset of [-1, 0, 1]) keys.push(...dayKeys(dayEvents(localDay(ms, offset), config), config.transition));
  keys.sort((p, q) => p[0] - q[0]);
  return keys;
}

const smooth = u => u * u * (3 - 2 * u);

/** Dónde está `ms` en la línea: las dos luces de su tramo y cuánto lleva (0 a 1, con la curva ya aplicada). */
export function position(ms, keys) {
  if (!keys.length) return { from: 'dia', to: 'dia', t: 0, start: ms, end: ms };
  if (ms < keys[0][0]) return { from: keys[0][1], to: keys[0][1], t: 0, start: -Infinity, end: keys[0][0] };
  for (let i = 0; i + 1 < keys.length; i += 1) {
    const [t0, p0] = keys[i], [t1, p1] = keys[i + 1];
    if (ms >= t0 && ms < t1) return { from: p0, to: p1, t: t1 > t0 ? smooth((ms - t0) / (t1 - t0)) : 1, start: t0, end: t1 };
  }
  const last = keys[keys.length - 1];
  return { from: last[1], to: last[1], t: 0, start: last[0], end: Infinity };
}

// ---------------------------------------------------------------- el tema

const MIN_TEXT = 4.5;   // WCAG AA para el texto
const MIN_QUIET = 3;    // texto secundario e iconos
const MIN_ACCENT = 3;

/** El tema de un momento: la luz que manda, los colores (mezclados), el esquema claro u oscuro, el material, el
 *  sol de hoy y cuándo volver a mirar (`next`, en ms; null si no va a cambiar solo). */
export function themeAt(date = Date.now(), input = {}) {
  const config = input.palettes && input.mode && 'transition' in input ? input : normalizeConfig(input);
  const ms = +date;
  const palettes = config.palettes;
  let pos, events = null;
  if (config.mode === 'fixed' || config.mode === 'off') {
    pos = { from: config.period, to: config.period, t: 0, start: -Infinity, end: Infinity };
  } else {
    events = dayEvents(localDay(ms), config);
    pos = position(ms, timeline(ms, config));
  }
  const a = palettes[pos.from], b = palettes[pos.to];
  const colors = {};
  for (const token of ['surface', 'raised', 'line', 'accent', 'shadow']) colors[token] = a === b ? a[token] : mix(a[token], b[token], pos.t);
  // El esquema lo dice la superficie que hay de verdad: oscuro cuando el blanco contrasta más que el negro.
  const scheme = a.scheme === b.scheme ? a.scheme : (luminance(colors.surface) < 0.179 ? 'dark' : 'light');
  if (a.scheme !== b.scheme) {
    // Cerca del cruce, la superficie elevada se acerca a la base: si quedasen a lados distintos de 0,179, ningún
    // texto se leería bien sobre las dos.
    const near = clamp(1 - Math.abs(luminance(colors.surface) - 0.179) / 0.06, 0, 1);
    if (near > 0) colors.raised = mix(colors.raised, colors.surface, near);
  }
  // El texto no se mezcla entre esquemas: el de la luz de ese esquema (la más cercana), y con contraste.
  const textFrom = a.scheme === b.scheme ? null : (a.scheme === scheme ? a : b);
  for (const token of ['text', 'quiet']) colors[token] = textFrom ? textFrom[token] : (a === b ? a[token] : mix(a[token], b[token], pos.t));
  // Sobre las dos superficies (la base y la elevada), y siempre hacia el lado de su esquema.
  const grounds = [colors.surface, colors.raised];
  colors.text = ensureContrast(colors.text, grounds, MIN_TEXT, scheme);
  colors.quiet = ensureContrast(colors.quiet, grounds, MIN_QUIET, scheme);
  colors.accent = ensureContrast(colors.accent, grounds, MIN_ACCENT, scheme);
  const material = Math.round((a.material + (b.material - a.material) * pos.t) * 1000) / 1000;
  const period = pos.t < 0.5 ? pos.from : pos.to;
  let next = null;
  if (config.mode === 'solar' || config.mode === 'clock') {
    const moving = pos.from !== pos.to;
    next = moving ? Math.min(ms + config.step * 60000, pos.end) : pos.end;
    if (!Number.isFinite(next)) next = ms + 60 * 60000;
    next = Math.max(next, ms + 30000);
  }
  return {
    schema: SCHEMA,
    at: ms,
    mode: config.mode,
    source: events?.source ?? config.mode,
    period,
    from: pos.from,
    to: pos.to,
    progress: Math.round(pos.t * 1000) / 1000,
    scheme,
    style: config.scheme,
    colors,
    material,
    sun: events && !events.polar ? { sunrise: events.sunrise, sunset: events.sunset } : (events?.polar ? { polar: events.polar } : null),
    next,
  };
}

/** Las variables CSS del tema (--sol-*), para cualquier documento. */
export function cssVars(theme) {
  const vars = {};
  for (const token of COLOR_TOKENS) vars[`--sol-${token}`] = theme.colors[token];
  vars['--sol-material'] = String(theme.material);
  return vars;
}

/** El tema para otros programas (JSON estable; ver docs/zero/luz.md): fechas en ISO y los colores también en
 *  «r g b» de 0 a 1 (lo que pide Wallpaper Engine en sus propiedades de color). */
export function exportTheme(theme) {
  const iso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
  const unit = Object.fromEntries(Object.entries(theme.colors).map(([k, v]) => [k, parseHex(v).map(c => Math.round(c / 255 * 1000) / 1000).join(' ')]));
  return {
    schema: theme.schema,
    at: iso(theme.at),
    mode: theme.mode,
    source: theme.source,
    period: theme.period,
    from: theme.from,
    to: theme.to,
    progress: theme.progress,
    scheme: theme.scheme,
    style: theme.style ?? 'auto',
    colors: theme.colors,
    colorsUnit: unit,
    material: theme.material,
    sun: theme.sun?.sunrise ? { sunrise: iso(theme.sun.sunrise), sunset: iso(theme.sun.sunset) } : theme.sun,
    next: iso(theme.next),
  };
}
