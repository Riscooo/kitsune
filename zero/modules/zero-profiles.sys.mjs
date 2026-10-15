/* Kitsune Zero · los perfiles y su modo: las dos pastillas de arriba de la columna de la izquierda.
 *
 * Decisión de Risco (15-10): entre los botones de ventana y la marca, una columna de pastillas: arriba los
 * perfiles, debajo un interruptor para pasar entre «Currar» y «Chill», en medio las pestañas y abajo los
 * accesos directos. «Así también aprovechamos la barra de la izquierda.» Y por la tarde: «que me salgan los
 * diferentes perfiles uno encima de otro para cambiar de forma rápida», y poder editarlos y borrarlos. En la
 * pastilla, una bolita por perfil (la del de ahora, entera y con su aro) y un «+»: un clic en otra cambia de
 * perfil; en la de ahora (o el clic derecho en cualquiera), su ficha al lado: nombre, icono, color, imagen
 * y «Borrar» (pregunta antes; sus pestañas pasan al primero que quede; el último no se borra).
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
const DETAILS_PREF = 'profiles.details';
// Lo que guarda cada modo (los ajustes de Zero) y lo que pone de serie.
const KEYS = Object.freeze([PREFS.pomodoro, PREFS.pomodoroPreset, PREFS.silence, PREFS.silenceNotify, PREFS.silenceBlock, PREFS.sounds]);
const DEFAULTS = Object.freeze({
  work: { [PREFS.pomodoro]: true, [PREFS.silence]: true, [PREFS.sounds]: false },
  chill: { [PREFS.pomodoro]: false, [PREFS.silence]: false, [PREFS.sounds]: false },
});
const state = new WeakMap();
// Como los espacios de Kitsune: sus seis tintas, hasta nueve y unos iconos a mano (o su inicial).
const COLORS = Object.freeze(['blue', 'pink', 'violet', 'teal', 'amber', 'red']);
const ICONS = Object.freeze(['🦊', '💼', '🎓', '🏠', '🎮', '🎵', '📚', '✈️']);
const MAX_PROFILES = 9;

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
  if (!focusEnabled(st)) return;
  const id = profilesOf(win, st).current;
  const all = readJSON(st.host, MODES_PREF, {});
  all.profiles ??= {};
  (all.profiles[id] ??= {}).mode = mode;
  writeJSON(st.host, MODES_PREF, all);
  apply(st, id);
  render(win, st);
}

const focusEnabled = st => { try { return st.host.prefs.getBoolPref(prefName(st.host.prefix, PREFS.focus), true); } catch { return true; } };

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
  // La pila: una bolita por perfil, en su orden, y el «+» debajo (hasta nueve).
  const nodes = list.map(profile => {
    let node = st.bubbles.get(profile.id);
    if (!node) { node = el(doc, 'button', { type: 'button', class: 'zero-profile-bubble' }); st.bubbles.set(profile.id, node); }
    paintBubble(doc, node, profile, images);
    const on = profile.id === current;
    node.toggleAttribute('current', on);
    node.setAttribute('aria-pressed', String(on));
    node.setAttribute('aria-label', on ? `${st.t('Perfil', 'Profile')}: ${profile.name}` : `${st.t('Cambiar a', 'Switch to')} ${profile.name}`);
    node.title = on ? `${profile.name} · ${st.t('clic para editarlo', 'click to edit')}` : profile.name;
    return node;
  });
  for (const [id, node] of st.bubbles) if (!list.some(profile => profile.id === id)) { node.remove(); st.bubbles.delete(id); }
  st.add.hidden = list.length >= MAX_PROFILES;
  const want = [...nodes, st.add], now = [...st.pill.children];
  if (now.length !== want.length || now.some((node, i) => node !== want[i])) st.pill.replaceChildren(...want);

  const mode = modeOf(st, current);
  const words = { work: st.t('Currar', 'Work'), chill: st.t('Chill', 'Chill') };
  if (mode) st.mode.dataset.mode = mode; else delete st.mode.dataset.mode;
  st.mode.setAttribute('aria-pressed', String(mode === 'work'));
  st.mode.setAttribute('aria-label', mode ? `${st.t('Modo', 'Mode')}: ${words[mode]}` : st.t('Modo: elige Currar o Chill', 'Mode: choose Work or Chill'));
  st.mode.title = mode ? words[mode] : `${words.work} / ${words.chill}`;
  st.mode.hidden = !focusEnabled(st);
  paintIdentity(win, st, list.find(profile => profile.id === current), images[current]);
  if (st.menu.hasAttribute('open')) fillEditor(win, st);
}

function paintIdentity(win, st, profile, image) {
  if (!profile || !st.identity) return;
  const details = readJSON(st.host, DETAILS_PREF, {})[profile.id] ?? {};
  if (image) { st.identityImage.src = image; st.identityImage.hidden = false; st.identityGlyph.hidden = true; }
  else { st.identityImage.hidden = true; st.identityGlyph.hidden = false; st.identityGlyph.textContent = profile.icon || initialOf(profile.name); st.identityGlyph.dataset.color = profile.color || 'teal'; }
  st.identityName.textContent = profile.name;
  st.identityAccount.textContent = details.email || details.accounts || '';
  st.identityAccount.hidden = !st.identityAccount.textContent;
}

/** La ficha de un perfil (o en blanco, para uno nuevo): cristal ahumado, al lado de la pastilla. */
function buildEditor(win, st) {
  const doc = win.document, t = st.t;
  const action = (name, label) => el(doc, 'button', { type: 'button', 'data-action': name }, [label]);
  st.name = el(doc, 'input', { type: 'text', class: 'zero-profile-name', maxlength: '24', placeholder: t('Nombre', 'Name'), 'aria-label': t('Nombre del perfil', 'Profile name') });
  st.email = el(doc, 'input', { type: 'email', class: 'zero-profile-detail', maxlength: '120', placeholder: t('Correo de este perfil', 'Email for this profile'), 'aria-label': t('Correo del perfil', 'Profile email') });
  st.accounts = el(doc, 'input', { type: 'text', class: 'zero-profile-detail', maxlength: '180', placeholder: t('Cuentas: Google, trabajo…', 'Accounts: Google, work…'), 'aria-label': t('Cuentas del perfil', 'Profile accounts') });
  st.icons = el(doc, 'div', { class: 'zero-profile-icons', role: 'radiogroup', 'aria-label': t('Icono', 'Icon') },
    ['', ...ICONS].map(icon => el(doc, 'button', { type: 'button', role: 'radio', 'data-icon': icon, title: icon || t('Su inicial', 'Its initial') }, [icon || 'Aa'])));
  const colorNames = { blue: t('Añil', 'Indigo'), pink: t('Rosa', 'Pink'), violet: t('Violeta', 'Violet'), teal: t('Jade', 'Jade'), amber: t('Ámbar', 'Amber'), red: t('Óxido', 'Rust') };
  st.colors = el(doc, 'div', { class: 'zero-profile-colors', role: 'radiogroup', 'aria-label': t('Color', 'Colour') },
    COLORS.map(color => el(doc, 'button', { type: 'button', role: 'radio', 'data-color': color, title: colorNames[color], 'aria-label': colorNames[color] })));
  // Sus sesiones (Risco, 15-10): con las de los demás perfiles, o las suyas (su Google, sus cookies, sus
  // inicios de sesión, en su propio contenedor). Solo si este Kitsune sabe hacerlo.
  st.sessions = el(doc, 'div', { class: 'zero-profile-sessions' }, [
    el(doc, 'span', { class: 'zero-profile-label' }, [t('Sesiones', 'Sessions')]),
    el(doc, 'div', { class: 'zero-profile-seg', role: 'radiogroup', 'aria-label': t('Sesiones', 'Sessions') }),
    el(doc, 'span', { class: 'zero-profile-hint' }),
  ]);
  st.pictures = el(doc, 'div', { class: 'zero-profile-row' }, [action('image', t('Poner imagen…', 'Set picture…')), action('unimage', t('Quitar imagen', 'Remove picture'))]);
  st.foot = el(doc, 'div', { class: 'zero-profile-row zero-profile-foot' }, [action('delete', t('Borrar perfil', 'Delete profile')), action('create', t('Crear', 'Create'))]);
  st.question = el(doc, 'span', { class: 'zero-profile-question' });
  st.confirm = el(doc, 'div', { class: 'zero-profile-confirm' }, [st.question, el(doc, 'div', { class: 'zero-profile-row' }, [action('cancel', t('Cancelar', 'Cancel')), action('confirm', t('Borrar', 'Delete'))])]);
  st.menu = el(doc, 'div', { id: 'zero-profiles', role: 'dialog', 'aria-label': t('Perfil', 'Profile') }, [st.name, st.email, st.accounts, st.icons, st.colors, st.sessions, st.pictures, st.foot, st.confirm]);
}

/** Lo que enseña la ficha: lo del perfil (o lo del borrador de uno nuevo). */
function fillEditor(win, st) {
  const { list } = profilesOf(win, st);
  const id = st.menu.dataset.space;
  const profile = id ? list.find(item => item.id === id) : null;
  if (id && !profile) { closeMenu(st); return; } // lo han borrado
  const value = profile ?? st.draft;
  const details = profile ? (readJSON(st.host, DETAILS_PREF, {})[profile.id] ?? {}) : st.draft.details;
  if (win.document.activeElement !== st.email) st.email.value = details?.email ?? '';
  if (win.document.activeElement !== st.accounts) st.accounts.value = details?.accounts ?? '';
  for (const button of st.icons.children) button.setAttribute('aria-checked', String(button.dataset.icon === (value.icon || '')));
  for (const button of st.colors.children) button.setAttribute('aria-checked', String(button.dataset.color === value.color));
  // Sus sesiones: las del perfil (o las del borrador); sin saberlo este Kitsune, no se enseñan.
  const known = st.host.spaces?.sessions?.((profile ?? list[0])?.id) ?? null;
  const sessions = profile ? known : known && st.draft.sessions;
  st.sessions.hidden = !sessions;
  if (sessions) {
    const t = st.t, user = !['own', 'shared'].includes(sessions) ? sessions : null;
    const userName = user ? (st.host.users?.nameOf?.(user) ?? t('su usuario', 'its user')) : null;
    const options = [['shared', t('Compartidas', 'Shared')], ['own', t('Propias', 'Own')], ...(user ? [[user, t(`De ${userName}`, `${userName}'s`)]] : [])];
    const seg = st.sessions.querySelector('.zero-profile-seg');
    if (seg.dataset.options !== options.map(o => o[0]).join(' ')) {
      seg.replaceChildren(...options.map(([value, label]) => el(win.document, 'button', { type: 'button', role: 'radio', 'data-sessions': value }, [label])));
      seg.dataset.options = options.map(o => o[0]).join(' ');
    }
    for (const button of seg.children) button.setAttribute('aria-checked', String(button.dataset.sessions === sessions));
    st.sessions.querySelector('.zero-profile-hint').textContent = sessions === 'own'
      ? t('Su propio Google, sus cookies y sus inicios de sesión.', 'Its own Google, cookies and sign-ins.')
      : sessions === 'shared' ? t('Las mismas cuentas que los demás perfiles.', 'The same accounts as the other profiles.')
      : t(`Las cuentas de ${userName}.`, `${userName}'s accounts.`);
  }
  st.pictures.hidden = !profile;
  st.pictures.querySelector('[data-action=unimage]').hidden = !readJSON(st.host, IMAGES_PREF, {})[id];
  st.foot.querySelector('[data-action=create]').hidden = !!profile;
  const remove = st.foot.querySelector('[data-action=delete]');
  remove.hidden = !profile;
  remove.disabled = list.length <= 1;
  remove.title = list.length <= 1 ? st.t('Es tu único perfil', 'It is your only profile') : '';
}

function openEditor(win, st, id, anchor) {
  const { list } = profilesOf(win, st);
  const profile = id ? list.find(item => item.id === id) : null;
  if (id && !profile) return;
  const used = new Set(list.map(item => item.color));
  // Uno nuevo, con sus propias sesiones de serie (como un perfil de Chrome); se puede cambiar.
  st.draft = profile ? null : { name: '', icon: '', color: COLORS.find(color => !used.has(color)) ?? COLORS[list.length % COLORS.length], sessions: 'own', details: { email: '', accounts: '' } };
  st.menu.dataset.space = profile?.id ?? '';
  st.menu.removeAttribute('confirming');
  st.name.value = profile?.name ?? '';
  fillEditor(win, st);
  const pill = st.pill.getBoundingClientRect(), at = (anchor ?? st.pill).getBoundingClientRect();
  st.menu.style.setProperty('--zero-menu-x', `${Math.round(pill.right + 10)}px`);
  st.menu.style.setProperty('--zero-menu-y', `${Math.round(Math.max(8, Math.min(at.top - 12, win.innerHeight - st.menu.offsetHeight - 8)))}px`);
  st.menu.setAttribute('open', '');
  st.name.focus();
  if (profile) st.name.select();
}
const closeMenu = st => { st.menu.removeAttribute('open'); st.menu.removeAttribute('confirming'); };

/** Lo que Zero guarda de un perfil que se va: su modo, su imagen y sus accesos directos. */
function forget(st, id) {
  const modes = readJSON(st.host, MODES_PREF, {});
  if (modes.profiles?.[id]) { delete modes.profiles[id]; writeJSON(st.host, MODES_PREF, modes); }
  for (const name of [IMAGES_PREF, DETAILS_PREF, 'shortcuts']) {
    const all = readJSON(st.host, name, {});
    if (all && id in all) { delete all[id]; writeJSON(st.host, name, all); }
  }
}

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

  st.bubbles = new Map();
  st.add = el(doc, 'button', { type: 'button', class: 'zero-profile-add', title: t('Nuevo perfil', 'New profile'), 'aria-label': t('Nuevo perfil', 'New profile') }, ['+']);
  st.pill = el(doc, 'div', { id: 'zero-profile', class: 'zero-pill', role: 'group', 'aria-label': t('Perfiles', 'Profiles') }, [st.add]);
  st.mode = el(doc, 'button', { type: 'button', id: 'zero-mode', class: 'zero-pill' }, [el(doc, 'span', { class: 'zero-mode-knob', 'aria-hidden': 'true' })]);
  st.identityImage = el(doc, 'img', { alt: '', hidden: 'true' });
  st.identityGlyph = el(doc, 'span', { class: 'zero-empty-profile-glyph', 'aria-hidden': 'true' });
  st.identityName = el(doc, 'strong');
  st.identityAccount = el(doc, 'small');
  st.identity = el(doc, 'div', { id: 'zero-empty-profile', 'aria-label': t('Perfil actual', 'Current profile') }, [st.identityImage, st.identityGlyph, st.identityName, st.identityAccount]);
  buildEditor(win, st);
  dock.prepend(st.pill, st.mode);
  doc.body.append(st.menu, st.identity);
  st.cleanups.push(() => { st.pill.remove(); st.mode.remove(); st.menu.remove(); st.identity.remove(); });

  const after = promise => void Promise.resolve(promise).then(() => render(win, st), error => { console.error('Zero: perfiles', error); render(win, st); });
  st.pill.addEventListener('click', event => {
    if (event.target.closest('.zero-profile-add')) {
      if (st.menu.hasAttribute('open') && !st.menu.dataset.space) closeMenu(st); else openEditor(win, st, null, st.add);
      return;
    }
    const bubble = event.target.closest('.zero-profile-bubble[data-space]');
    if (!bubble) return;
    const { current } = profilesOf(win, st);
    if (bubble.dataset.space === current) {
      if (st.menu.hasAttribute('open') && st.menu.dataset.space === current) closeMenu(st); else openEditor(win, st, current, bubble);
      return;
    }
    closeMenu(st);
    after(host.spaces?.select(win, bubble.dataset.space));
  });
  st.pill.addEventListener('contextmenu', event => {
    const bubble = event.target.closest('.zero-profile-bubble[data-space]');
    if (!bubble) return;
    event.preventDefault();
    openEditor(win, st, bubble.dataset.space, bubble);
  });
  st.mode.addEventListener('click', () => setMode(win, st, modeOf(st, profilesOf(win, st).current) === 'work' ? 'chill' : 'work'));

  // La ficha: lo que se cambia, al momento; uno nuevo, al pulsar «Crear» (o Intro).
  const editing = () => st.menu.dataset.space || null;
  const change = patch => { const id = editing(); if (id) after(host.spaces?.edit(id, patch)); else { Object.assign(st.draft, patch); fillEditor(win, st); } };
  const create = () => {
    const { list } = profilesOf(win, st);
    const name = st.name.value.trim() || `${t('Perfil', 'Profile')} ${list.length + 1}`;
    const { color, icon, sessions, details } = st.draft;
    closeMenu(st);
    after(Promise.resolve(host.spaces?.create({ name, color, icon, user: null })).then(async id => {
      if (!id) return;
      if (details.email || details.accounts) { const all = readJSON(host, DETAILS_PREF, {}); all[id] = details; writeJSON(host, DETAILS_PREF, all); }
      if (sessions === 'own') await host.spaces?.setSessions?.(id, 'own');
      await host.spaces?.select(win, id);
    }));
  };
  const saveDetails = () => {
    const id = editing(), details = { email: st.email.value.trim(), accounts: st.accounts.value.trim() };
    if (id) {
      const all = readJSON(host, DETAILS_PREF, {});
      if (details.email || details.accounts) all[id] = details; else delete all[id];
      writeJSON(host, DETAILS_PREF, all);
    } else { st.draft.details = details; }
  };
  const rename = () => {
    const id = editing(), name = st.name.value.trim();
    if (!id) return;
    const profile = profilesOf(win, st).list.find(item => item.id === id);
    if (!name) { st.name.value = profile?.name ?? ''; return; }
    if (profile && name !== profile.name) change({ name });
  };
  st.name.addEventListener('change', rename);
  st.email.addEventListener('change', saveDetails);
  st.accounts.addEventListener('change', saveDetails);
  st.name.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (editing()) rename(); else create();
  });
  st.menu.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if ('icon' in button.dataset) { change({ icon: button.dataset.icon }); return; }
    if (button.dataset.sessions) {
      const id = editing();
      if (id) after(host.spaces?.setSessions?.(id, button.dataset.sessions));
      else { st.draft.sessions = button.dataset.sessions; fillEditor(win, st); }
      return;
    }
    if (button.dataset.color) { change({ color: button.dataset.color }); return; }
    const id = editing(), action = button.dataset.action;
    if (action === 'create') create();
    else if (action === 'image' && id) { closeMenu(st); chooseImage(win, st, id); }
    else if (action === 'unimage' && id) { const images = readJSON(host, IMAGES_PREF, {}); delete images[id]; writeJSON(host, IMAGES_PREF, images); }
    else if (action === 'delete' && id) {
      const { list } = profilesOf(win, st);
      const profile = list.find(item => item.id === id), next = list.find(item => item.id !== id);
      if (!profile || !next) return;
      st.question.textContent = t(`¿Borrar «${profile.name}»? Sus pestañas pasan a «${next.name}».`, `Delete «${profile.name}»? Its tabs move to «${next.name}».`);
      st.menu.setAttribute('confirming', '');
    } else if (action === 'cancel') st.menu.removeAttribute('confirming');
    else if (action === 'confirm' && id) {
      closeMenu(st);
      after(Promise.resolve(host.spaces?.remove(id)).then(() => forget(st, id)));
    }
  });
  listen(win, 'mousedown', event => { if (st.menu.hasAttribute('open') && !st.menu.contains(event.target) && !st.pill.contains(event.target)) closeMenu(st); }, true);
  listen(win, 'keydown', event => { if (event.key === 'Escape' && st.menu.hasAttribute('open')) closeMenu(st); }, true);

  // Al cambiar de perfil (de espacio), su modo; y lo de la bolita.
  st.last = profilesOf(win, st).current;
  const changed = () => {
    const id = profilesOf(win, st).current;
    if (id !== st.last) { st.last = id; if (focusEnabled(st)) apply(st, id); }
    render(win, st);
  };
  try { const undo = host.spaces?.watch(win, changed); if (undo) st.cleanups.push(undo); } catch { /* sin espacios */ }
  listen(win.gBrowser.tabContainer, 'TabSelect', changed);
  const prefs = { observe: (_, __, name) => {
    const key = name.slice(host.prefix.length);
    if (key === MODES_PREF || key === IMAGES_PREF || key === DETAILS_PREF) render(win, st);
    else if (key === PREFS.focus) {
      if (focusEnabled(st)) apply(st, profilesOf(win, st).current);
      else { writePref(st.host, PREFS.pomodoro, false); writePref(st.host, PREFS.silence, false); }
      render(win, st);
    }
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
