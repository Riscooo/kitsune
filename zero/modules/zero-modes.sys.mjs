/* Kitsune Zero · los modos: los usuarios, y «currar» o «chill».
 *
 * Decisión de Risco (15-10): arriba del raíl, los usuarios de Kitsune como bolitas, con la imagen que cada
 * uno quiera; al pulsar el tuyo eliges «Currar» o «Chill» para ese día, y cada modo guarda su configuración
 * (pomodoro y sus tiempos, silencio y webs vetadas, sonidos). Cambiar de usuario o de modo lo aplica todo de
 * una vez. «Así también aprovechamos la barra de la izquierda.»
 *
 * Los usuarios de Kitsune son contenedores de Gecko (y el base, sin contenedor), en Windows, macOS y Linux:
 * Zero los lee de Gecko; de Kitsune solo le hace falta el nombre del base (host.users.baseName()).
 *
 * - kitsune.zero.modes: { users: { id: { mode, work: {…}, chill: {…} } } } (id: «base» o el contenedor).
 * - kitsune.zero.users.images: { id: url } (la imagen de cada bolita; una imagen pequeña, en data:).
 * - El usuario de ahora es el de la pestaña elegida: cambiar de pestaña a la de otro usuario aplica su modo.
 * - Lo que se cambia en los ajustes estando en un modo se guarda en ese modo.
 */
import { PREFS, prefName } from './zero-config.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const MODES_PREF = 'modes';
const IMAGES_PREF = 'users.images';
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
const identities = () => {
  try { return ChromeUtils.importESModule('moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs').ContextualIdentityService; } catch { return null; }
};

function readJSON(host, name, fallback) {
  try { return JSON.parse(host.prefs.getStringPref(prefName(host.prefix, name), '')) ?? fallback; } catch { return fallback; }
}
function writeJSON(host, name, value) {
  try { host.prefs.setStringPref(prefName(host.prefix, name), JSON.stringify(value)); } catch { /* sin ajustes */ }
}

/** Los usuarios: el base y uno por contenedor, con su nombre, su color y su inicial. */
function usersOf(win, host, t) {
  const base = { id: 'base', context: 0, name: (() => { try { return host.users?.baseName?.() || t('Yo', 'Me'); } catch { return t('Yo', 'Me'); } })(), color: null };
  const service = identities();
  const more = (service?.getPublicIdentities() ?? []).map(identity => ({
    id: String(identity.userContextId), context: identity.userContextId, color: identity.color,
    name: service.getUserContextLabel(identity.userContextId) || identity.name || '?',
  }));
  return [base, ...more];
}

const userIdOf = tab => String(tab?.userContextId || 0) === '0' ? 'base' : String(tab.userContextId);

function readPref(host, key) {
  const name = prefName(host.prefix, key);
  try {
    if (key === PREFS.pomodoroPreset) return host.prefs.getStringPref(name, '25');
    return host.prefs.getBoolPref(name, false);
  } catch { return null; }
}
function writePref(host, key, value) {
  const name = prefName(host.prefix, key);
  try { if (typeof value === 'string') host.prefs.setStringPref(name, value); else host.prefs.setBoolPref(name, !!value); } catch { /* sin ajustes */ }
}

/** Pone la configuración del modo de ese usuario (la guardada o, si no hay, la de serie). */
function apply(win, st, id) {
  const all = readJSON(st.host, MODES_PREF, {});
  const user = all.users?.[id];
  if (!user?.mode) return;
  const config = { ...DEFAULTS[user.mode], ...(user[user.mode] ?? {}) };
  st.applying = true;
  try { for (const key of KEYS) if (key in config) writePref(st.host, key, config[key]); } finally { st.applying = false; }
}

function setMode(win, st, id, mode) {
  const all = readJSON(st.host, MODES_PREF, {});
  all.users ??= {};
  const user = all.users[id] ??= {};
  user.mode = mode;
  user.day = new Date().toISOString().slice(0, 10);
  writeJSON(st.host, MODES_PREF, all);
  apply(win, st, id);
  render(win, st);
}

/** Lo que se cambia estando en un modo se queda en ese modo. */
function remember(win, st, key) {
  if (st.applying) return;
  const id = userIdOf(win.gBrowser.selectedTab);
  const all = readJSON(st.host, MODES_PREF, {});
  const user = all.users?.[id];
  if (!user?.mode) return;
  user[user.mode] = { ...(user[user.mode] ?? {}), [key]: readPref(st.host, key) };
  writeJSON(st.host, MODES_PREF, all);
}

/** Cambia la pestaña elegida al usuario `user`: en su sitio, una pestaña nueva en su contenedor. */
function switchTo(win, user) {
  const gb = win.gBrowser, tab = gb.selectedTab;
  if (!tab || tab.userContextId === user.context) return;
  const fresh = gb.addTab(win.BROWSER_NEW_TAB_URL || 'about:newtab', {
    userContextId: user.context, index: tab._tPos + 1, skipAnimation: true,
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  gb.selectedTab = fresh;
  gb.removeTab(tab, { animate: false });
}

function render(win, st) {
  const doc = win.document;
  const users = usersOf(win, st.host, st.t);
  const images = readJSON(st.host, IMAGES_PREF, {});
  const modes = readJSON(st.host, MODES_PREF, {}).users ?? {};
  const current = userIdOf(win.gBrowser.selectedTab);
  const words = { work: st.t('Currar', 'Work'), chill: st.t('Chill', 'Chill') };
  const nodes = users.map(user => {
    let node = st.box.querySelector(`.zero-user[data-user="${user.id}"]`);
    if (!node) {
      node = el(doc, 'button', { type: 'button', class: 'zero-item zero-user', 'data-user': user.id }, [
        el(doc, 'span', { class: 'zero-fav', 'aria-hidden': 'true' }), el(doc, 'span', { class: 'zero-tt' }),
      ]);
    }
    for (const name of [...node.classList]) if (name.startsWith('identity-color-')) node.classList.remove(name);
    if (user.color) node.classList.add(`identity-color-${user.color}`);
    const fav = node.querySelector('.zero-fav');
    const image = images[user.id];
    if (image) {
      if (fav.querySelector('img')?.getAttribute('src') !== image) fav.replaceChildren(el(doc, 'img', { src: image, alt: '' }));
    } else {
      const letter = ([...user.name.trim()][0] ?? '·').toLocaleUpperCase();
      if (fav.textContent !== letter || fav.querySelector('img')) fav.replaceChildren(letter);
    }
    const mode = modes[user.id]?.mode ?? null;
    if (mode) node.dataset.mode = mode; else delete node.dataset.mode;
    node.toggleAttribute('active', user.id === current);
    const label = mode ? `${user.name} · ${words[mode]}` : user.name;
    node.querySelector('.zero-tt').textContent = label;
    node.setAttribute('aria-label', label);
    return node;
  });
  // Solo si cambia algo: quitar y volver a poner las bolitas en cada cambio de pestaña movía el raíl (y su
  // efecto Dock) bajo el ratón.
  const now = [...st.box.children];
  if (now.length !== nodes.length || now.some((node, i) => node !== nodes[i])) st.box.replaceChildren(...nodes);
  st.users = users;
}

function closePick(st) { st.pick.removeAttribute('open'); }
function openPick(win, st, node) {
  const r = node.getBoundingClientRect(), rail = win.document.getElementById('zero-rail')?.getBoundingClientRect();
  st.pick.style.setProperty('--zero-pick-x', `${Math.round((rail?.right ?? r.right) + 8)}px`);
  st.pick.style.setProperty('--zero-pick-y', `${Math.round(r.top + r.height / 2)}px`);
  st.pick.dataset.user = node.dataset.user;
  const mode = node.dataset.mode;
  for (const b of st.pick.querySelectorAll('[data-mode]')) b.toggleAttribute('current', b.dataset.mode === mode);
  st.pick.setAttribute('open', '');
}

/** Una imagen para la bolita: se elige un archivo y se guarda pequeña (64 px), como data:. */
function chooseImage(win, st, id) {
  const picker = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
  picker.init(win.browsingContext, st.t('Imagen del usuario', 'User picture'), Ci.nsIFilePicker.modeOpen);
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
  const rail = doc.getElementById('zero-rail');
  // En una ventana privada no hay contenedores (ni usuarios).
  if (!rail || win.PrivateBrowsingUtils?.isWindowPrivate(win)) return;
  const t = host.t ?? (es => es);
  const st = { host, t, cleanups: [], applying: false };
  state.set(win, st);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };

  st.box = el(doc, 'div', { id: 'zero-modes', role: 'group', 'aria-label': t('Usuarios', 'Users') });
  st.sep = el(doc, 'span', { class: 'zero-sep zero-modes-sep', 'aria-hidden': 'true' });
  rail.prepend(st.box, st.sep);
  st.pick = el(doc, 'div', { id: 'zero-mode-pick', role: 'menu' }, [
    el(doc, 'button', { type: 'button', 'data-mode': 'work', role: 'menuitemradio' }, [t('Currar', 'Work')]),
    el(doc, 'button', { type: 'button', 'data-mode': 'chill', role: 'menuitemradio' }, [t('Chill', 'Chill')]),
    el(doc, 'button', { type: 'button', 'data-action': 'image', role: 'menuitem' }, [t('Imagen', 'Picture')]),
  ]);
  doc.body.append(st.pick);
  st.cleanups.push(() => { st.box.remove(); st.sep.remove(); st.pick.remove(); });

  st.box.addEventListener('click', event => {
    const node = event.target.closest('.zero-user');
    if (!node) return;
    const user = st.users?.find(u => u.id === node.dataset.user);
    if (!user) return;
    if (node.hasAttribute('active')) { if (st.pick.hasAttribute('open')) closePick(st); else openPick(win, st, node); return; }
    closePick(st);
    switchTo(win, user); // la pestaña cambia: TabSelect pone su modo
  });
  st.pick.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const id = st.pick.dataset.user;
    closePick(st);
    if (button.dataset.mode) setMode(win, st, id, button.dataset.mode);
    else if (button.dataset.action === 'image') chooseImage(win, st, id);
  });
  listen(win, 'mousedown', event => { if (st.pick.hasAttribute('open') && !st.pick.contains(event.target) && !st.box.contains(event.target)) closePick(st); }, true);
  listen(win, 'keydown', event => { if (event.key === 'Escape') closePick(st); }, true);

  // El usuario de ahora es el de la pestaña elegida: al cambiar a la de otro, su modo.
  st.last = userIdOf(win.gBrowser.selectedTab);
  listen(win.gBrowser.tabContainer, 'TabSelect', () => {
    const id = userIdOf(win.gBrowser.selectedTab);
    if (id !== st.last) { st.last = id; apply(win, st, id); }
    render(win, st);
  });
  // Los contenedores que se crean o se quitan, y los cambios de los ajustes (para el modo de ahora).
  const changed = { observe: () => render(win, st) };
  for (const topic of ['contextual-identity-created', 'contextual-identity-deleted', 'contextual-identity-updated']) {
    Services.obs.addObserver(changed, topic);
    st.cleanups.push(() => Services.obs.removeObserver(changed, topic));
  }
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
