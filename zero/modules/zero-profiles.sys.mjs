/* Kitsune Zero · los perfiles y su modo: las dos pastillas de arriba de la columna de la izquierda.
 *
 * Decisión de Risco (15-10): entre los botones de ventana y la marca, una columna de pastillas: arriba el
 * perfil (una bolita, la del perfil en el que estás; al pulsarla, un menú con tus perfiles, «Nuevo perfil»
 * e «Imagen»), debajo un interruptor para pasar entre «Currar» y «Chill», en medio las pestañas y abajo los
 * accesos directos. «Así también aprovechamos la barra de la izquierda.»
 *
 * Los perfiles son los espacios del navegador (host.spaces; en Kitsune, sus espacios): cada uno guarda sus
 * pestañas (las de los demás se esconden), su color, su icono y, si se quiere, su usuario (su contenedor).
 * Va en Windows, macOS y Linux.
 *
 * Cada perfil tiene sus dos modos y cada modo guarda su configuración (pomodoro y sus tiempos, silencio y
 * webs vetadas, sonidos): de serie, currar enciende pomodoro y silencio y chill los apaga; lo que se cambia
 * estando en un modo se queda en ese modo. Al cambiar de perfil se pone el suyo.
 *
 * - kitsune.zero.modes: { profiles: { id: { mode, work: {…}, chill: {…} } } }.
 * - kitsune.zero.profiles.images: { id: url } (la imagen de cada perfil; pequeña, en data:).
 */
import { PREFS, prefName } from './zero-config.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const MODES_PREF = 'modes';
const IMAGES_PREF = 'profiles.images';
// Lo que guarda cada modo (los ajustes de Zero) y lo que pone de serie.
const KEYS = Object.freeze([PREFS.pomodoro, PREFS.pomodoroPreset, PREFS.silence, PREFS.silenceNotify, PREFS.silenceBlock, PREFS.sounds]);
const DEFAULTS = Object.freeze({
  work: { [PREFS.pomodoro]: true, [PREFS.silence]: true, [PREFS.sounds]: false },
  chill: { [PREFS.pomodoro]: false, [PREFS.silence]: false, [PREFS.sounds]: false },
});
const state = new WeakMap();

const el = (doc, tag, attrs = {}, kids = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
};
const initialOf = name => ([...String(name ?? '').trim()][0] ?? '·').toLocaleUpperCase();

function readJSON(host, name, fallback) {
  try { return JSON.parse(host.prefs.getStringPref(prefName(host.prefix, name), '')) ?? fallback; } catch { return fallback; }
}
function writeJSON(host, name, value) {
  try { host.prefs.setStringPref(prefName(host.prefix, name), JSON.stringify(value)); } catch { /* sin ajustes */ }
}
function readPref(host, key) {
  const name = prefName(host.prefix, key);
  try { return key === PREFS.pomodoroPreset ? host.prefs.getStringPref(name, '25') : host.prefs.getBoolPref(name, false); } catch { return null; }
}
function writePref(host, key, value) {
  const name = prefName(host.prefix, key);
  try { if (typeof value === 'string') host.prefs.setStringPref(name, value); else host.prefs.setBoolPref(name, !!value); } catch { /* sin ajustes */ }
}

/** Los perfiles (los espacios) y el de esta ventana. */
function profilesOf(win, st) {
  let list = [], current = null;
  try { list = st.host.spaces?.list(win) ?? []; current = st.host.spaces?.current(win) ?? null; } catch { list = []; }
  if (!list.length) list = [{ id: 'base', name: st.t('Perfil', 'Profile'), color: 'teal', icon: '' }];
  return { list, current: current ?? list[0].id };
}

const modeOf = (st, id) => readJSON(st.host, MODES_PREF, {}).profiles?.[id]?.mode ?? null;

/** Pone la configuración del modo de ese perfil (la guardada o, si no hay, la de serie). */
function apply(st, id) {
  const profile = readJSON(st.host, MODES_PREF, {}).profiles?.[id];
  if (!profile?.mode) return;
  const config = { ...DEFAULTS[profile.mode], ...(profile[profile.mode] ?? {}) };
  st.applying = true;
  try { for (const key of KEYS) if (key in config) writePref(st.host, key, config[key]); } finally { st.applying = false; }
}

function setMode(win, st, mode) {
  const id = profilesOf(win, st).current;
  const all = readJSON(st.host, MODES_PREF, {});
  all.profiles ??= {};
  (all.profiles[id] ??= {}).mode = mode;
  writeJSON(st.host, MODES_PREF, all);
  apply(st, id);
  render(win, st);
}

/** Lo que se cambia estando en un modo se queda en ese modo. */
function remember(win, st, key) {
  if (st.applying) return;
  const id = profilesOf(win, st).current;
  const all = readJSON(st.host, MODES_PREF, {});
  const profile = all.profiles?.[id];
  if (!profile?.mode) return;
  profile[profile.mode] = { ...(profile[profile.mode] ?? {}), [key]: readPref(st.host, key) };
  writeJSON(st.host, MODES_PREF, all);
}

/** Una bolita de perfil: su imagen, o su icono (o su inicial) sobre su color. */
function paintBubble(doc, node, profile, images) {
  node.dataset.space = profile.id;
  node.dataset.color = profile.color || 'teal';
  const image = images[profile.id];
  if (image) {
    if (node.querySelector('img')?.getAttribute('src') !== image) node.replaceChildren(el(doc, 'img', { src: image, alt: '' }));
  } else {
    const glyph = profile.icon || initialOf(profile.name);
    if (node.textContent !== glyph || node.querySelector('img')) node.replaceChildren(glyph);
  }
}

function render(win, st) {
  const doc = win.document;
  const { list, current } = profilesOf(win, st);
  const images = readJSON(st.host, IMAGES_PREF, {});
  const profile = list.find(p => p.id === current) ?? list[0];
  paintBubble(doc, st.bubble, profile, images);
  const mode = modeOf(st, profile.id);
  const words = { work: st.t('Currar', 'Work'), chill: st.t('Chill', 'Chill') };
  st.bubble.setAttribute('aria-label', `${st.t('Perfil', 'Profile')}: ${profile.name}`);
  st.bubble.title = profile.name;
  if (mode) st.mode.dataset.mode = mode; else delete st.mode.dataset.mode;
  st.mode.setAttribute('aria-pressed', String(mode === 'work'));
  st.mode.setAttribute('aria-label', mode ? `${st.t('Modo', 'Mode')}: ${words[mode]}` : st.t('Modo: elige Currar o Chill', 'Mode: choose Work or Chill'));
  st.mode.title = mode ? words[mode] : `${words.work} / ${words.chill}`;
  if (st.menu.hasAttribute('open')) fillMenu(win, st);
}

function fillMenu(win, st) {
  const doc = win.document;
  const { list, current } = profilesOf(win, st);
  const images = readJSON(st.host, IMAGES_PREF, {});
  const rows = list.map(profile => {
    const bubble = el(doc, 'span', { class: 'zero-profile-bubble', 'aria-hidden': 'true' });
    paintBubble(doc, bubble, profile, images);
    const row = el(doc, 'button', { type: 'button', role: 'menuitemradio', 'data-space': profile.id }, [bubble, el(doc, 'span', {}, [profile.name])]);
    row.toggleAttribute('current', profile.id === current);
    row.setAttribute('aria-checked', String(profile.id === current));
    return row;
  });
  st.menu.replaceChildren(...rows, el(doc, 'span', { class: 'zero-profiles-sep', 'aria-hidden': 'true' }),
    el(doc, 'button', { type: 'button', role: 'menuitem', 'data-action': 'new' }, [el(doc, 'span', { class: 'zero-profiles-plus', 'aria-hidden': 'true' }, ['+']), st.t('Nuevo perfil', 'New profile')]),
    el(doc, 'button', { type: 'button', role: 'menuitem', 'data-action': 'image' }, [st.t('Imagen', 'Picture')]));
}

function openMenu(win, st) {
  const r = st.pill.getBoundingClientRect();
  st.menu.style.setProperty('--zero-menu-x', `${Math.round(r.right + 8)}px`);
  st.menu.style.setProperty('--zero-menu-y', `${Math.round(r.top)}px`);
  fillMenu(win, st);
  st.menu.setAttribute('open', '');
}
const closeMenu = st => st.menu.removeAttribute('open');

/** Una imagen para el perfil: se elige un archivo y se guarda pequeña (64 px), como data:. */
function chooseImage(win, st, id) {
  const picker = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
  picker.init(win.browsingContext, st.t('Imagen del perfil', 'Profile picture'), Ci.nsIFilePicker.modeOpen);
  picker.appendFilters(Ci.nsIFilePicker.filterImages);
  picker.open(async result => {
    if (result !== Ci.nsIFilePicker.returnOK || !picker.file) return;
    try {
      const bytes = await IOUtils.read(picker.file.path, { maxBytes: 8 * 1024 * 1024 });
      const bitmap = await win.createImageBitmap(new win.Blob([bytes]));
      const canvas = new win.OffscreenCanvas(64, 64), ctx = canvas.getContext('2d');
      const scale = Math.max(64 / bitmap.width, 64 / bitmap.height);
      ctx.drawImage(bitmap, (64 - bitmap.width * scale) / 2, (64 - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const url = await new Promise(done => { const reader = new win.FileReader(); reader.onload = () => done(reader.result); reader.readAsDataURL(blob); });
      const images = readJSON(st.host, IMAGES_PREF, {});
      images[id] = url;
      writeJSON(st.host, IMAGES_PREF, images);
    } catch (error) { console.error('Zero: no se pudo poner la imagen', error); }
  });
}

export function attach(win, ctx) {
  const doc = win.document, { host } = ctx;
  const dock = doc.getElementById('zero-dock');
  // En una ventana privada no hay perfiles (ni espacios).
  if (!dock || win.PrivateBrowsingUtils?.isWindowPrivate(win)) return;
  const t = host.t ?? (es => es);
  const st = { host, t, cleanups: [], applying: false };
  state.set(win, st);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };

  st.bubble = el(doc, 'button', { type: 'button', class: 'zero-profile-bubble', 'aria-haspopup': 'menu' });
  st.pill = el(doc, 'div', { id: 'zero-profile', class: 'zero-pill' }, [st.bubble]);
  st.mode = el(doc, 'button', { type: 'button', id: 'zero-mode', class: 'zero-pill' }, [el(doc, 'span', { class: 'zero-mode-knob', 'aria-hidden': 'true' })]);
  st.menu = el(doc, 'div', { id: 'zero-profiles', role: 'menu', 'aria-label': t('Perfiles', 'Profiles') });
  dock.prepend(st.pill, st.mode);
  doc.body.append(st.menu);
  st.cleanups.push(() => { st.pill.remove(); st.mode.remove(); st.menu.remove(); });

  st.bubble.addEventListener('click', () => { if (st.menu.hasAttribute('open')) closeMenu(st); else openMenu(win, st); });
  st.mode.addEventListener('click', () => setMode(win, st, modeOf(st, profilesOf(win, st).current) === 'work' ? 'chill' : 'work'));
  st.menu.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    closeMenu(st);
    if (button.dataset.space) { void Promise.resolve(host.spaces?.select(win, button.dataset.space)).catch(() => {}); return; }
    if (button.dataset.action === 'new') host.spaces?.openEditor?.(win, st.bubble);
    else if (button.dataset.action === 'image') chooseImage(win, st, profilesOf(win, st).current);
  });
  listen(win, 'mousedown', event => { if (st.menu.hasAttribute('open') && !st.menu.contains(event.target) && !st.pill.contains(event.target)) closeMenu(st); }, true);
  listen(win, 'keydown', event => { if (event.key === 'Escape') closeMenu(st); }, true);

  // Al cambiar de perfil (de espacio), su modo; y lo de la bolita.
  st.last = profilesOf(win, st).current;
  const changed = () => {
    const id = profilesOf(win, st).current;
    if (id !== st.last) { st.last = id; apply(st, id); }
    render(win, st);
  };
  try { const undo = host.spaces?.watch(win, changed); if (undo) st.cleanups.push(undo); } catch { /* sin espacios */ }
  listen(win.gBrowser.tabContainer, 'TabSelect', changed);
  const prefs = { observe: (_, __, name) => {
    const key = name.slice(host.prefix.length);
    if (key === MODES_PREF || key === IMAGES_PREF) render(win, st);
    else if (KEYS.includes(key)) remember(win, st, key);
  } };
  host.prefs.addObserver(host.prefix, prefs);
  st.cleanups.push(() => host.prefs.removeObserver(host.prefix, prefs));
  render(win, st);
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}
