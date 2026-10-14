/* Espacios de Kitsune: grupos de pestañas que se ven por separado, como los de Zen.
 *
 * - Cada espacio tiene nombre, una de las seis tintas de los usuarios y, si se quiere,
 *   un usuario (su contenedor): la primera pestaña del espacio se abre con él y las
 *   siguientes lo heredan de la pestaña en la que estás.
 * - La lista vive en <perfil>/kitsune-spaces.json. El espacio de cada pestaña y el de cada
 *   ventana se guardan en la sesión de Gecko (valores propios), así que sobreviven a cerrar.
 * - Cambiar de espacio oculta las pestañas de los demás (hideTab/showTab de Gecko) y
 *   selecciona la última que usaste en ese. Las fijadas se ven en todos.
 * - Selector arriba (en la tira de pestañas) y abajo en la barra lateral si van a un lado.
 *   Ctrl+Alt+1…9 va a cada espacio y Ctrl+Alt+AvPág/RePág al siguiente y al anterior.
 * - Nada de esto sale del equipo: no hay red, ni código de las webs, ni datos del usuario
 *   más allá de nombres y colores que pone él.
 */
const FILE = 'kitsune-spaces.json';
const TAB_KEY = 'kitsuneSpace';
const WINDOW_KEY = 'kitsuneSpace';
const HTML = 'http://www.w3.org/1999/xhtml';
const SPACE_ID = /^e-[0-9a-f]{8}$/;
const USER_ID = /^(default|p-[0-9a-f]{16})$/;
export const COLORS = Object.freeze(['blue', 'pink', 'violet', 'teal', 'amber', 'red']);
export const COLOR_NAMES = Object.freeze({ blue: 'Añil', pink: 'Rosa', violet: 'Violeta', teal: 'Jade', amber: 'Ámbar', red: 'Óxido' });
export const MAX_SPACES = 9;
export const MAX_NAME = 24;
export const FIRST_ID = 'e-00000000';
export const defaultSpaces = () => ({ version: 1, spaces: [{ id: FIRST_ID, name: 'General', color: 'teal', user: null }] });

const hasControl = text => [...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
/** El nombre tal cual se guarda: sin espacios de más, hasta 24 caracteres. null si no vale. */
export function cleanName(name) {
  if (typeof name !== 'string') return null;
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean || hasControl(clean)) return null;
  return [...clean].slice(0, MAX_NAME).join('');
}

const validSpace = space => space && typeof space === 'object' && !Array.isArray(space) &&
  Object.keys(space).length === 4 && SPACE_ID.test(space.id) && cleanName(space.name) === space.name &&
  COLORS.includes(space.color) && (space.user === null || USER_ID.test(space.user));

/** kitsune-spaces.json → la lista. Si no se entiende, la de siempre (un espacio «General»). */
export function parseSpaces(text) {
  let value;
  try { value = JSON.parse(text); } catch { return defaultSpaces(); }
  if (!value || value.version !== 1 || !Array.isArray(value.spaces) || !value.spaces.length || value.spaces.length > MAX_SPACES ||
      !value.spaces.every(validSpace) || new Set(value.spaces.map(space => space.id)).size !== value.spaces.length) return defaultSpaces();
  return { version: 1, spaces: value.spaces.map(space => ({ ...space })) };
}

const copy = data => ({ version: 1, spaces: data.spaces.map(space => ({ ...space })) });
const randomId = () => 'e-' + [...crypto.getRandomValues(new Uint8Array(4))].map(byte => byte.toString(16).padStart(2, '0')).join('');

/** Un espacio nuevo al final. Devuelve { data, id } o null si no cabe o el nombre no vale. */
export function addSpace(data, { name, color, user = null }, makeId = randomId) {
  const clean = cleanName(name);
  if (!clean || data.spaces.length >= MAX_SPACES || !COLORS.includes(color) || (user !== null && !USER_ID.test(user))) return null;
  let id = makeId();
  while (data.spaces.some(space => space.id === id)) id = makeId();
  const next = copy(data);
  next.spaces.push({ id, name: clean, color, user });
  return { data: next, id };
}

/** Cambia nombre, tinta o usuario de un espacio. null si no existe o algo no vale. */
export function editSpace(data, id, patch) {
  const index = data.spaces.findIndex(space => space.id === id);
  if (index < 0) return null;
  const next = copy(data);
  const space = next.spaces[index];
  if ('name' in patch) { const clean = cleanName(patch.name); if (!clean) return null; space.name = clean; }
  if ('color' in patch) { if (!COLORS.includes(patch.color)) return null; space.color = patch.color; }
  if ('user' in patch) { if (patch.user !== null && !USER_ID.test(patch.user)) return null; space.user = patch.user; }
  return next;
}

/** Mueve un espacio un puesto a la izquierda (-1) o a la derecha (+1). */
export function moveSpace(data, id, delta) {
  const index = data.spaces.findIndex(space => space.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= data.spaces.length) return null;
  const next = copy(data);
  [next.spaces[index], next.spaces[target]] = [next.spaces[target], next.spaces[index]];
  return next;
}

/** Quita un espacio (nunca el último). Sus pestañas pasan al primero que quede. */
export function removeSpace(data, id) {
  if (data.spaces.length <= 1 || !data.spaces.some(space => space.id === id)) return null;
  const next = copy(data);
  next.spaces = next.spaces.filter(space => space.id !== id);
  return next;
}

/** El espacio de un valor guardado: el suyo si existe; si no, el primero. */
export const resolveSpace = (data, value) => data.spaces.some(space => space.id === value) ? value : data.spaces[0].id;

/** El siguiente (+1) o el anterior (-1), dando la vuelta. */
export function stepSpace(data, id, delta) {
  const index = Math.max(0, data.spaces.findIndex(space => space.id === id));
  return data.spaces[(index + delta + data.spaces.length) % data.spaces.length].id;
}

/**
 * Qué hacer al ir al espacio `target`, sobre las pestañas de una ventana
 * ([{ pinned, space, lastAccessed, selected, hidden }], con `space` ya resuelto):
 * cuál seleccionar (la última usada del espacio; null si no tiene ninguna), cuáles
 * mostrar y cuáles ocultar. Las fijadas se ven siempre y nunca se ocultan.
 */
export function planSwitch(tabs, target) {
  const inside = [], outside = [];
  tabs.forEach((tab, index) => { if (!tab.pinned) (tab.space === target ? inside : outside).push(index); });
  let select = null;
  for (const index of inside) if (select === null || (tabs[index].lastAccessed || 0) > (tabs[select].lastAccessed || 0)) select = index;
  const current = tabs.findIndex(tab => tab.selected);
  // Una fijada seleccionada se queda si el espacio no tiene pestañas propias.
  if (select === null && current >= 0 && tabs[current].pinned) select = current;
  return { select, show: inside.filter(index => tabs[index].hidden), hide: outside.filter(index => !tabs[index].hidden), empty: !inside.length };
}

// ---------------------------------------------------------------- dentro de Gecko

const state = { data: defaultSpaces(), loaded: null, windows: new Set(), switching: new WeakSet() };
// Gecko 157 lo movió a moz-src:; con un Gecko anterior, su dirección de antes.
let sessionStoreModule = null;
function sessionStore() {
  if (sessionStoreModule) return sessionStoreModule;
  for (const url of ['moz-src:///browser/components/sessionstore/SessionStore.sys.mjs', 'resource:///modules/sessionstore/SessionStore.sys.mjs']) {
    try { return (sessionStoreModule = ChromeUtils.importESModule(url).SessionStore); } catch { /* la siguiente */ }
  }
  throw Error('Kitsune: no se encuentra la sesión de Gecko');
}
const filePath = () => PathUtils.join(PathUtils.profileDir, FILE);
const homeURL = () => Services.prefs.getStringPref('browser.startup.homepage', 'about:home').split('|')[0];
const system = () => Services.scriptSecurityManager.getSystemPrincipal();
const users = () => {
  try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-users.sys.mjs').KitsuneUsers; } catch { return null; }
};

function load() {
  state.loaded ??= (async () => {
    try { state.data = parseSpaces(new TextDecoder().decode(await IOUtils.read(filePath(), { maxBytes: 65536 }))); } catch { state.data = defaultSpaces(); }
  })();
  return state.loaded;
}
async function commit(next) {
  if (!next) return false;
  state.data = next;
  await IOUtils.writeJSON(filePath(), next, { tmpPath: filePath() + '.tmp' });
  // Se vuelve a colocar cada ventana: un espacio quitado deja su ventana y sus pestañas en el primero.
  for (const win of state.windows) await switchTo(win, activeSpace(win));
  return true;
}

export function tabSpace(tab) {
  let value = '';
  try { value = sessionStore().getCustomTabValue(tab, TAB_KEY); } catch { /* sin sesión: el primero */ }
  return resolveSpace(state.data, value);
}
function setTabSpace(tab, id) {
  try { sessionStore().setCustomTabValue(tab, TAB_KEY, id); } catch { /* pestaña cerrándose */ }
}
export function activeSpace(win) {
  let value = win.__kitsuneSpace ?? '';
  if (!value) { try { value = sessionStore().getCustomWindowValue(win, WINDOW_KEY); } catch { /* ventana nueva */ } }
  return resolveSpace(state.data, value);
}

async function contextFor(space) {
  if (!space?.user) return 0;
  try { return (await users()?.contextFor(space.user)) ?? 0; } catch { return 0; }
}

/** Pone la ventana en el espacio `id`: oculta las pestañas de los demás y selecciona la suya. */
/** Al cambiar de espacio, las pestañas y la web entran deslizándose desde su lado (como en Zen). */
function slide(win, from, to) {
  const order = state.data.spaces.map(space => space.id);
  const delta = Math.sign(order.indexOf(to) - order.indexOf(from));
  if (!delta || from === to || win.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const options = { duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)' };
  const frames = [{ opacity: 0.35, transform: `translateX(${18 * delta}px)` }, { opacity: 1, transform: 'none' }];
  for (const node of [win.gBrowser.tabContainer, win.gBrowser.tabbox]) {
    try { node?.animate(frames, options); } catch { /* sin animación */ }
  }
}

export async function switchTo(win, id, { fresh = false } = {}) {
  await load();
  const gBrowser = win.gBrowser;
  const space = state.data.spaces.find(item => item.id === id);
  if (!gBrowser || !space || state.switching.has(win)) return;
  const previous = win.__kitsuneSpace ?? null;
  state.switching.add(win);
  try {
    win.__kitsuneSpace = id;
    try { sessionStore().setCustomWindowValue(win, WINDOW_KEY, id); } catch { /* ventana sin sesión todavía */ }
    const tabs = [...gBrowser.tabs];
    const plan = planSwitch(tabs.map(tab => ({ pinned: tab.pinned, space: tabSpace(tab), lastAccessed: tab.lastAccessed,
      selected: tab.selected, hidden: tab.hidden })), id);
    let selected = plan.select === null ? null : tabs[plan.select];
    if (!selected || fresh) {
      // Un espacio vacío empieza con tu inicio, con el usuario del espacio.
      selected = gBrowser.addTab(homeURL(), { triggeringPrincipal: system(), userContextId: await contextFor(space), skipAnimation: true });
      setTabSpace(selected, id);
    }
    for (const index of plan.show) gBrowser.showTab(tabs[index]);
    gBrowser.selectedTab = selected;
    // Gecko no oculta la seleccionada: primero se cambia de pestaña y después se oculta el resto.
    for (const index of plan.hide) if (tabs[index] !== selected) gBrowser.hideTab(tabs[index]);
  } finally {
    state.switching.delete(win);
  }
  render(win);
  if (previous) slide(win, previous, id);
}

/** Lleva una pestaña a otro espacio (y la ventana se queda donde estaba). */
async function moveTab(win, tab, id) {
  if (tab.pinned || !state.data.spaces.some(space => space.id === id)) return;
  setTabSpace(tab, id);
  if (id === activeSpace(win)) { win.gBrowser.showTab(tab); render(win); return; }
  if (tab.selected) {
    const other = [...win.gBrowser.tabs].filter(item => item !== tab && !item.hidden && (item.pinned || tabSpace(item) === activeSpace(win)))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (other) win.gBrowser.selectedTab = other;
    else {
      const space = state.data.spaces.find(item => item.id === activeSpace(win));
      win.gBrowser.selectedTab = win.gBrowser.addTab(homeURL(), { triggeringPrincipal: system(), userContextId: await contextFor(space), skipAnimation: true });
    }
  }
  win.gBrowser.hideTab(tab);
  render(win);
}

// ---------------------------------------------------------------- interfaz

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};
const xul = (doc, tag, attributes = {}) => {
  const node = doc.createXULElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
};
const shortcutLabel = (win, index) => `${win.AppConstants?.platform === 'macosx' ? '⌃⌥' : 'Ctrl+Alt+'}${index + 1}`;

function render(win) {
  const doc = win.document;
  const current = activeSpace(win);
  const active = state.data.spaces.find(space => space.id === current);
  doc.documentElement.setAttribute('kitsune-space-color', active?.color ?? 'teal');
  // Con un solo espacio no se tiñe nada: la ventana es la de siempre.
  doc.documentElement.toggleAttribute('kitsune-spaces-many', state.data.spaces.length > 1);
  for (const strip of doc.querySelectorAll('.kitsune-spaces')) {
    const buttons = state.data.spaces.map((space, index) => {
      const selected = space.id === current;
      const button = el(doc, 'button', { type: 'button', class: 'kitsune-space', role: 'tab', 'data-space': space.id,
        'data-space-color': space.color, 'aria-selected': String(selected), tabindex: selected ? '0' : '-1',
        title: `${space.name} · ${shortcutLabel(win, index)}` }, [el(doc, 'span', { class: 'kitsune-space-dot', 'aria-hidden': 'true' }),
        el(doc, 'span', { class: 'kitsune-space-name' }, [space.name])]);
      return button;
    });
    const add = el(doc, 'button', { type: 'button', class: 'kitsune-space-add', title: 'Nuevo espacio', 'aria-label': 'Nuevo espacio' }, ['+']);
    add.hidden = state.data.spaces.length >= MAX_SPACES;
    strip.replaceChildren(...buttons, add);
    strip.dataset.count = String(state.data.spaces.length);
  }
}

function openEditor(win, anchor, id = null) {
  const doc = win.document;
  const panel = doc.getElementById('kitsune-space-panel');
  const space = id ? state.data.spaces.find(item => item.id === id) : null;
  panel.dataset.space = space?.id ?? '';
  panel.querySelector('.kitsune-space-panel-title').textContent = space ? 'Editar espacio' : 'Nuevo espacio';
  panel.querySelector('.kitsune-space-panel-save').textContent = space ? 'Guardar' : 'Crear';
  const input = panel.querySelector('input');
  input.value = space?.name ?? '';
  const used = new Set(state.data.spaces.map(item => item.color));
  const color = space?.color ?? COLORS.find(item => !used.has(item)) ?? COLORS[state.data.spaces.length % COLORS.length];
  for (const swatch of panel.querySelectorAll('[data-color]')) swatch.setAttribute('aria-checked', String(swatch.dataset.color === color));
  const select = panel.querySelector('select');
  const list = users()?.list?.() ?? { users: [] };
  select.replaceChildren(el(doc, 'option', { value: '' }, ['El de la pestaña en la que estés']),
    ...list.users.map(user => el(doc, 'option', { value: user.id }, [user.name])));
  select.value = space?.user && list.users.some(user => user.id === space.user) ? space.user : '';
  panel.querySelector('.kitsune-space-panel-error').textContent = '';
  panel.openPopup(anchor, 'after_start', 0, 4);
  win.setTimeout(() => { input.focus(); input.select(); }, 60);
}

async function saveEditor(win) {
  const panel = win.document.getElementById('kitsune-space-panel');
  const name = panel.querySelector('input').value;
  const color = panel.querySelector('[data-color][aria-checked="true"]')?.dataset.color ?? 'teal';
  const user = panel.querySelector('select').value || null;
  if (!cleanName(name)) { panel.querySelector('.kitsune-space-panel-error').textContent = 'Ponle un nombre.'; return; }
  const id = panel.dataset.space;
  if (id) await commit(editSpace(state.data, id, { name, color, user }));
  else {
    const added = addSpace(state.data, { name, color, user });
    if (!added) { panel.querySelector('.kitsune-space-panel-error').textContent = `Caben ${MAX_SPACES} espacios como mucho.`; return; }
    await commit(added.data);
    await switchTo(win, added.id);
  }
  panel.hidePopup();
}

function buildPanel(win) {
  const doc = win.document;
  const panel = xul(doc, 'panel', { id: 'kitsune-space-panel', type: 'arrow', class: 'kitsune-space-panel', noautofocus: 'true' });
  const colors = el(doc, 'div', { class: 'kitsune-space-colors', role: 'radiogroup', 'aria-label': 'Tinta' },
    COLORS.map(color => el(doc, 'button', { type: 'button', role: 'radio', 'data-color': color, 'data-space-color': color,
      'aria-checked': 'false', title: COLOR_NAMES[color], 'aria-label': COLOR_NAMES[color] })));
  const form = el(doc, 'form', { class: 'kitsune-space-form' }, [
    el(doc, 'h2', { class: 'kitsune-space-panel-title' }, ['Nuevo espacio']),
    el(doc, 'label', {}, ['Nombre', el(doc, 'input', { type: 'text', maxlength: String(MAX_NAME), placeholder: 'Trabajo, Clase, Ocio…', spellcheck: 'false' })]),
    el(doc, 'span', { class: 'kitsune-space-label' }, ['Tinta']), colors,
    el(doc, 'label', {}, ['Usuario de sus pestañas nuevas', el(doc, 'select')]),
    el(doc, 'p', { class: 'kitsune-space-panel-error', role: 'alert' }),
    el(doc, 'div', { class: 'kitsune-space-panel-actions' }, [
      el(doc, 'button', { type: 'button', class: 'kitsune-space-panel-cancel' }, ['Cancelar']),
      el(doc, 'button', { type: 'submit', class: 'kitsune-space-panel-save' }, ['Crear'])]),
  ]);
  panel.append(form);
  colors.addEventListener('click', event => {
    const swatch = event.target.closest('[data-color]');
    if (!swatch) return;
    for (const item of colors.children) item.setAttribute('aria-checked', String(item === swatch));
  });
  form.addEventListener('submit', event => { event.preventDefault(); void saveEditor(win).catch(() => {}); });
  form.querySelector('.kitsune-space-panel-cancel').addEventListener('click', () => panel.hidePopup());
  doc.getElementById('mainPopupSet').append(panel);
}

function buildMenu(win) {
  const doc = win.document;
  const menu = xul(doc, 'menupopup', { id: 'kitsune-space-menu' });
  const item = (label, action) => { const node = xul(doc, 'menuitem', { label }); node.dataset.action = action; return node; };
  menu.append(item('Editar…', 'edit'), item('Mover a la izquierda', 'left'), item('Mover a la derecha', 'right'),
    xul(doc, 'menuseparator'), item('Eliminar espacio', 'remove'));
  menu.addEventListener('popupshowing', () => {
    const id = menu.dataset.space;
    const index = state.data.spaces.findIndex(space => space.id === id);
    menu.querySelector('[data-action=left]').disabled = index <= 0;
    menu.querySelector('[data-action=right]').disabled = index < 0 || index >= state.data.spaces.length - 1;
    menu.querySelector('[data-action=remove]').disabled = state.data.spaces.length <= 1;
  });
  menu.addEventListener('command', event => {
    const id = menu.dataset.space, action = event.target.dataset.action;
    if (action === 'edit') openEditor(win, menu.triggerNode ?? doc.querySelector('.kitsune-spaces'), id);
    if (action === 'left' || action === 'right') void commit(moveSpace(state.data, id, action === 'left' ? -1 : 1)).catch(() => {});
    if (action === 'remove') {
      const space = state.data.spaces.find(item => item.id === id);
      if (space && Services.prompt.confirm(win, 'Eliminar espacio', `¿Eliminar «${space.name}»? Sus pestañas pasan a «${state.data.spaces.find(item => item.id !== id).name}».`)) {
        void commit(removeSpace(state.data, id)).catch(() => {});
      }
    }
  });
  doc.getElementById('mainPopupSet').append(menu);

  // En el menú de la pestaña: llevarla a otro espacio.
  const tabMenu = doc.getElementById('tabContextMenu');
  if (tabMenu) {
    const move = xul(doc, 'menu', { id: 'kitsune-move-to-space', label: 'Mover a otro espacio' });
    const popup = xul(doc, 'menupopup');
    move.append(popup);
    const anchor = doc.getElementById('context_moveTabOptions');
    anchor ? anchor.after(move) : tabMenu.prepend(move);
    tabMenu.addEventListener('popupshowing', event => {
      if (event.target !== tabMenu) return;
      const tab = win.TabContextMenu?.contextTab;
      const here = tab ? tabSpace(tab) : null;
      move.hidden = !tab || tab.pinned || state.data.spaces.length < 2;
      popup.replaceChildren(...state.data.spaces.filter(space => space.id !== here).map(space => {
        const node = xul(doc, 'menuitem', { label: space.name, class: 'kitsune-space-menuitem', 'data-space-color': space.color });
        node.addEventListener('command', () => void moveTab(win, tab, space.id).catch(() => {}));
        return node;
      }));
    });
  }
}

function buildStrips(win) {
  const doc = win.document;
  const strips = [];
  // Arriba: en la tira de pestañas, detrás del logo.
  const toolbar = doc.getElementById('TabsToolbar');
  const items = toolbar?.querySelector('.toolbar-items');
  if (items) { const strip = el(doc, 'div', { id: 'kitsune-spaces-top', class: 'kitsune-spaces', role: 'tablist', 'aria-label': 'Espacios' }); items.before(strip); strips.push(strip); }
  // A un lado: abajo de la barra lateral, debajo de las pestañas.
  const side = doc.querySelector('sidebar-main');
  if (side) { const strip = el(doc, 'div', { id: 'kitsune-spaces-side', class: 'kitsune-spaces', role: 'tablist', 'aria-label': 'Espacios', slot: 'tabstrip' }); side.append(strip); strips.push(strip); }
  for (const strip of strips) {
    strip.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.classList.contains('kitsune-space-add')) openEditor(win, button);
      else if (button.dataset.space) void switchTo(win, button.dataset.space).catch(() => {});
    });
    strip.addEventListener('dblclick', event => {
      const button = event.target.closest('.kitsune-space');
      if (button) openEditor(win, button, button.dataset.space);
    });
    strip.addEventListener('contextmenu', event => {
      const button = event.target.closest('.kitsune-space');
      if (!button) return;
      event.preventDefault();
      const menu = doc.getElementById('kitsune-space-menu');
      menu.dataset.space = button.dataset.space;
      menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
    });
    // Flechas para moverse entre espacios con el teclado, como en una lista de pestañas.
    strip.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const buttons = [...strip.querySelectorAll('.kitsune-space')];
      const index = buttons.indexOf(doc.activeElement);
      if (index < 0) return;
      buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length].focus();
      event.preventDefault();
    });
  }
}

function buildKeys(win) {
  const doc = win.document;
  const keyset = xul(doc, 'keyset', { id: 'kitsune-spaces-keys' });
  const add = (attributes, run) => { const key = xul(doc, 'key', { modifiers: 'accel,alt', ...attributes }); key.addEventListener('command', run); keyset.append(key); };
  for (let index = 0; index < MAX_SPACES; index++) {
    add({ id: `kitsune-space-key-${index + 1}`, key: String(index + 1) }, () => {
      const space = state.data.spaces[index];
      if (space) void switchTo(win, space.id).catch(() => {});
    });
  }
  add({ id: 'kitsune-space-key-next', keycode: 'VK_PAGE_DOWN' }, () => void switchTo(win, stepSpace(state.data, activeSpace(win), 1)).catch(() => {}));
  add({ id: 'kitsune-space-key-previous', keycode: 'VK_PAGE_UP' }, () => void switchTo(win, stepSpace(state.data, activeSpace(win), -1)).catch(() => {}));
  doc.documentElement.append(keyset);
}

function listen(win) {
  const container = win.gBrowser.tabContainer;
  // Una pestaña nueva es del espacio en el que estás (las restauradas traen el suyo de la sesión).
  container.addEventListener('TabOpen', event => {
    const tab = event.target;
    let saved = '';
    try { saved = sessionStore().getCustomTabValue(tab, TAB_KEY); } catch { /* nueva */ }
    if (!saved) setTabSpace(tab, activeSpace(win));
  });
  // Si se elige una pestaña de otro espacio (desde la barra de direcciones, por ejemplo), se va a él.
  container.addEventListener('TabSelect', event => {
    const tab = event.target;
    // Mientras se cierra una pestaña, Gecko puede elegir una de otro espacio: eso lo arregla TabClose.
    if (state.switching.has(win) || tab.pinned || win.gBrowser._removingTabs?.size) return;
    const space = tabSpace(tab);
    if (space !== activeSpace(win)) void switchTo(win, space).catch(() => {});
  });
  // Al cerrar la última pestaña de un espacio, el espacio se queda con tu inicio.
  container.addEventListener('TabClose', event => {
    const tab = event.target;
    if (tab.pinned || state.switching.has(win)) return;
    const space = tabSpace(tab);
    if (space !== activeSpace(win)) return;
    const others = [...win.gBrowser.tabs].some(item => item !== tab && !item.closing && !item.pinned && tabSpace(item) === space);
    const anyElsewhere = [...win.gBrowser.tabs].some(item => item !== tab && !item.closing);
    if (!others && anyElsewhere) win.setTimeout(() => void switchTo(win, space, { fresh: true }).catch(() => {}), 0);
  });
  // Al restaurar la sesión, cada pestaña recupera su espacio y la ventana el suyo.
  win.addEventListener('SSWindowRestored', () => {
    win.__kitsuneSpace = null;
    void switchTo(win, activeSpace(win)).catch(() => {});
  });
}

export const KitsuneSpaces = {
  async decorate(win) {
    // El arranque de Kitsune corre antes de que la ventana tenga sus pestañas: se espera a que termine.
    if (!win.gBrowser || !win.gBrowserInit?.delayedStartupFinished) await win.delayedStartupPromise;
    if (state.windows.has(win) || !win.gBrowser) return;
    await load();
    // Las ventanas privadas y las emergentes no tienen espacios.
    if (win.PrivateBrowsingUtils?.isWindowPrivate(win) || !win.toolbar?.visible) return;
    state.windows.add(win);
    win.addEventListener('unload', () => state.windows.delete(win), { once: true });
    buildStrips(win);
    buildMenu(win);
    buildPanel(win);
    buildKeys(win);
    listen(win);
    await switchTo(win, activeSpace(win));
  },
  /** Para las pruebas y el inicio: la lista, el espacio de la ventana y cambiar de espacio. */
  list: () => copy(state.data),
  active: win => activeSpace(win),
  switchTo: (win, id) => switchTo(win, id),
  async create(spec) { await load(); const added = addSpace(state.data, spec); if (!added) return null; await commit(added.data); return added.id; },
  async edit(id, patch) { await load(); return commit(editSpace(state.data, id, patch)); },
  async remove(id) { await load(); return commit(removeSpace(state.data, id)); },
  moveTab: (win, tab, id) => moveTab(win, tab, id),
  /** El panel de «Nuevo espacio», junto al «+» que se vea (arriba o en la barra lateral). */
  openEditor(win) {
    const add = [...win.document.querySelectorAll('.kitsune-space-add')].find(node => node.getBoundingClientRect().width > 0);
    openEditor(win, add ?? win.document.getElementById('PanelUI-menu-button'));
  },
  /** Para el importador: deja la pestaña en ese espacio sin tocar la ventana (luego, refresh). */
  assignTab(tab, id) { if (state.data.spaces.some(space => space.id === id)) setTabSpace(tab, id); },
  /** Vuelve a colocar la ventana en su espacio (muestra y oculta lo que toque). */
  refresh: win => switchTo(win, activeSpace(win)),
};
