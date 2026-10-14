/* Copia de Kitsune: tus cosas en un archivo cifrado, para llevarlas a otro ordenador sin servidor.
 *
 * - Guardar: marcadores, espacios con sus pestañas y, si quieres, el historial (90 días) y las
 *   contraseñas, en un archivo .kitsune cifrado con tu contraseña (PBKDF2-SHA-256 con 600 000
 *   vueltas y AES-GCM de 256 bits). Sin la contraseña no se puede leer, ni siquiera saber qué lleva.
 * - Traer: los marcadores van a una carpeta «De otro Kitsune (fecha)»; los espacios se crean (o se
 *   usan los que ya tengan ese nombre) con sus pestañas, que se abren sin cargar; el historial se
 *   suma; y una contraseña que ya tengas (misma web y usuario) no se repite.
 * Nada sale del equipo: el archivo lo llevas tú (un pendrive, tu nube…).
 */
// Textos en el idioma de Kitsune (kitsune-i18n.sys.mjs); sin Gecko (pruebas de Node), en castellano.
const t = (spanish, english) => {
  try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-i18n.sys.mjs').t(spanish, english); } catch { return spanish; }
};
const HTML = 'http://www.w3.org/1999/xhtml';
export const ITERATIONS = 600000;
export const MIN_PASSWORD = 8;
const WEB = /^(https?|ftp|file):/i;
const BOOKMARK_URL = /^(https?|ftp|file|javascript):/i;
const LIMITS = Object.freeze({ bookmarks: 50000, tabs: 2000, spaces: 9, pages: 40000, logins: 10000, text: 4096 });
const HISTORY_DAYS = 90;

const encoder = new TextEncoder();
const text = (value, max = LIMITS.text) => typeof value === 'string' ? [...value.replace(/[\u0000-\u001f\u007f]/g, ' ')].slice(0, max).join('').trim() : '';

async function keyFor(password, salt, iterations, crypto) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** El sobre del archivo: lo que va dentro, cifrado con la contraseña. */
export async function encryptCopy(plain, password, { iterations = ITERATIONS, crypto = globalThis.crypto } = {}) {
  if (typeof password !== 'string' || [...password].length < MIN_PASSWORD) throw new Error('password');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(password, salt, iterations, crypto);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(plain))));
  return { kitsune: 'copia', version: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: salt.toBase64() }, cipher: 'AES-GCM', iv: iv.toBase64(), data: data.toBase64() };
}

/** Lo de dentro de un sobre; Error('password') si la contraseña no es la buena (o el archivo se tocó). */
export async function decryptCopy(envelope, password, { crypto = globalThis.crypto } = {}) {
  if (!envelope || envelope.kitsune !== 'copia' || envelope.version !== 1 || envelope.cipher !== 'AES-GCM' ||
      envelope.kdf?.name !== 'PBKDF2' || envelope.kdf.hash !== 'SHA-256' || !Number.isInteger(envelope.kdf.iterations) ||
      envelope.kdf.iterations < 100000 || envelope.kdf.iterations > 10000000) throw new Error('format');
  let salt, iv, data;
  try {
    salt = Uint8Array.fromBase64(envelope.kdf.salt);
    iv = Uint8Array.fromBase64(envelope.iv);
    data = Uint8Array.fromBase64(envelope.data);
  } catch { throw new Error('format'); }
  const key = await keyFor(password, salt, envelope.kdf.iterations, crypto);
  let plain;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data); } catch { throw new Error('password'); }
  return checkCopy(JSON.parse(new TextDecoder().decode(plain)));
}

const checkItems = (items, depth = 0, count = { n: 0 }) => (Array.isArray(items) ? items : []).flatMap(item => {
  if (depth > 30 || count.n > LIMITS.bookmarks || !item || typeof item !== 'object') return [];
  if (item.type === 'separator') return [{ type: 'separator' }];
  if (typeof item.url === 'string') {
    if (!BOOKMARK_URL.test(item.url)) return [];
    count.n++;
    return [{ title: text(item.title), url: item.url }];
  }
  const children = checkItems(item.children, depth + 1, count);
  return children.length ? [{ title: text(item.title) || t('Carpeta', 'Folder'), children }] : [];
});

/** Lo de dentro, comprobado y recortado: solo lo que Kitsune sabe traer. */
export function checkCopy(value) {
  if (!value || typeof value !== 'object' || value.version !== 1) throw new Error('format');
  const spaces = (Array.isArray(value.spaces) ? value.spaces : []).filter(space => text(space?.name, 24)).slice(0, LIMITS.spaces)
    .map(space => ({ name: text(space.name, 24), color: typeof space.color === 'string' ? space.color : null }));
  const tabs = (Array.isArray(value.tabs) ? value.tabs : []).filter(tab => typeof tab?.url === 'string' && WEB.test(tab.url)).slice(0, LIMITS.tabs)
    .map(tab => ({ url: tab.url, title: text(tab.title), pinned: tab.pinned === true, space: text(tab.space, 24) || null }));
  const pages = (Array.isArray(value.history) ? value.history : []).filter(page => typeof page?.url === 'string' && WEB.test(page.url)).slice(0, LIMITS.pages)
    .map(page => ({ url: page.url, title: text(page.title), visits: (Array.isArray(page.visits) ? page.visits : []).slice(0, 20)
      .filter(visit => Number.isFinite(visit?.date) && visit.date > 0 && Number.isInteger(visit.transition) && visit.transition >= 1 && visit.transition <= 9)
      .map(visit => ({ date: visit.date, transition: visit.transition })) })).filter(page => page.visits.length);
  const logins = (Array.isArray(value.logins) ? value.logins : []).slice(0, LIMITS.logins)
    .filter(login => typeof login?.origin === 'string' && /^https?:\/\/[^/]+$/i.test(login.origin) && typeof login.password === 'string' && login.password)
    .map(login => ({ origin: login.origin, formActionOrigin: typeof login.formActionOrigin === 'string' ? login.formActionOrigin : null,
      httpRealm: typeof login.httpRealm === 'string' ? login.httpRealm : null, username: typeof login.username === 'string' ? login.username : '',
      password: login.password, usernameField: typeof login.usernameField === 'string' ? login.usernameField : '',
      passwordField: typeof login.passwordField === 'string' ? login.passwordField : '' }));
  const bookmarks = (Array.isArray(value.bookmarks) ? value.bookmarks : []).map(root => ({ title: text(root?.title) || t('Marcadores', 'Bookmarks'), children: checkItems(root?.children) }))
    .filter(root => root.children.some(item => item.type !== 'separator'));
  return { version: 1, created: typeof value.created === 'string' ? value.created : null, bookmarks, spaces, tabs, history: pages, logins };
}

export const countItems = items => items.reduce((sum, item) => sum + (item.url ? 1 : item.children ? countItems(item.children) : 0), 0);

/** Lo que lleva una copia, en una línea («120 marcadores, 3 espacios con 14 pestañas…»). */
export function summary(copy) {
  const parts = [];
  const bookmarks = copy.bookmarks.reduce((sum, root) => sum + countItems(root.children), 0);
  if (bookmarks) parts.push(t(`${bookmarks} marcador${bookmarks === 1 ? '' : 'es'}`, `${bookmarks} bookmark${bookmarks === 1 ? '' : 's'}`));
  if (copy.spaces.length || copy.tabs.length) parts.push(t(`${copy.spaces.length} espacio${copy.spaces.length === 1 ? '' : 's'} con ${copy.tabs.length} pestaña${copy.tabs.length === 1 ? '' : 's'}`,
    `${copy.spaces.length} space${copy.spaces.length === 1 ? '' : 's'} with ${copy.tabs.length} tab${copy.tabs.length === 1 ? '' : 's'}`));
  if (copy.history.length) parts.push(t(`${copy.history.length} página${copy.history.length === 1 ? '' : 's'} del historial`, `${copy.history.length} history page${copy.history.length === 1 ? '' : 's'}`));
  if (copy.logins.length) parts.push(t(`${copy.logins.length} contraseña${copy.logins.length === 1 ? '' : 's'}`, `${copy.logins.length} password${copy.logins.length === 1 ? '' : 's'}`));
  return parts.join(' · ');
}

/** PlacesUtils.promiseBookmarksTree → las raíces con algo dentro, como las guarda la copia. */
export function bookmarksFromTree(tree) {
  const ROOTS = { toolbar_____: t('Barra de marcadores', 'Bookmarks toolbar'), menu________: t('Menú de marcadores', 'Bookmarks menu'),
    unfiled_____: t('Otros marcadores', 'Other bookmarks'), mobile______: t('Del móvil', 'Mobile bookmarks') };
  const convert = node => node.type === 'text/x-moz-place-separator' ? { type: 'separator' }
    : node.type === 'text/x-moz-place' ? { title: node.title ?? '', url: node.uri }
    : { title: node.title ?? '', children: (node.children ?? []).map(convert) };
  return (tree?.children ?? []).filter(root => Object.hasOwn(ROOTS, root.guid))
    .map(root => ({ title: ROOTS[root.guid], children: checkItems((root.children ?? []).map(convert)) }))
    .filter(root => root.children.some(item => item.type !== 'separator'));
}

// ---------------------------------------------------------------- dentro de Gecko

const lazy = {
  get PlacesUtils() { return ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs').PlacesUtils; },
  get spaces() { return ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs'); },
};

/** Junta lo que se ha pedido de este Kitsune. */
async function collect(win, { bookmarks = true, tabs = true, history = false, logins = false } = {}) {
  const copy = { version: 1, created: new Date().toISOString(), bookmarks: [], spaces: [], tabs: [], history: [], logins: [] };
  if (bookmarks) copy.bookmarks = bookmarksFromTree(await lazy.PlacesUtils.promiseBookmarksTree(lazy.PlacesUtils.bookmarks.rootGuid));
  if (tabs) {
    const { KitsuneSpaces, tabSpace } = lazy.spaces;
    const list = KitsuneSpaces.list().spaces;
    const nameOf = id => list.find(space => space.id === id)?.name ?? null;
    copy.spaces = list.map(space => ({ name: space.name, color: space.color }));
    for (const window of Services.wm.getEnumerator('navigator:browser')) {
      if (window.PrivateBrowsingUtils?.isWindowPrivate(window) || !window.gBrowser) continue;
      for (const tab of window.gBrowser.tabs) {
        const url = tab.linkedBrowser?.currentURI?.spec;
        if (!url || !WEB.test(url) || /^https?:\/\/127\.0\.0\.1:\d+\//.test(url)) continue;
        copy.tabs.push({ url, title: tab.label, pinned: tab.pinned, space: tab.pinned ? null : nameOf(tabSpace(tab)) });
      }
    }
  }
  if (history) {
    const db = await lazy.PlacesUtils.promiseDBConnection();
    const since = (Date.now() - HISTORY_DAYS * 86400000) * 1000;
    const rows = await db.execute(`SELECT p.url, p.title, v.visit_date, v.visit_type FROM moz_historyvisits v
      JOIN moz_places p ON p.id = v.place_id WHERE v.visit_date > :since ORDER BY v.visit_date DESC LIMIT 60000`, { since });
    const pages = new Map();
    for (const row of rows) {
      const url = row.getResultByName('url');
      if (!WEB.test(url)) continue;
      let page = pages.get(url);
      if (!page) { page = { url, title: row.getResultByName('title') ?? '', visits: [] }; pages.set(url, page); }
      if (page.visits.length < 20) page.visits.push({ date: Math.floor(row.getResultByName('visit_date') / 1000), transition: row.getResultByName('visit_type') });
    }
    copy.history = [...pages.values()].slice(0, LIMITS.pages);
  }
  if (logins) {
    copy.logins = (await Services.logins.getAllLogins()).map(login => ({ origin: login.origin, formActionOrigin: login.formActionOrigin,
      httpRealm: login.httpRealm, username: login.username, password: login.password, usernameField: login.usernameField, passwordField: login.passwordField }));
  }
  return checkCopy(copy);
}

/** Trae a este Kitsune lo que se haya elegido de una copia. Devuelve cuánto ha traído. */
async function restore(win, copy, { bookmarks = true, tabs = true, history = true, logins = true } = {}) {
  const { PlacesUtils } = lazy;
  const result = { bookmarks: 0, spaces: 0, tabs: 0, pages: 0, logins: 0 };
  if (bookmarks && copy.bookmarks.length) {
    const date = new Date(copy.created ?? Date.now()).toLocaleDateString(t('es-ES', 'en-US'));
    const toFolder = item => item.type === 'separator' ? { type: PlacesUtils.bookmarks.TYPE_SEPARATOR }
      : item.url ? { title: item.title, url: item.url }
      : { title: item.title, type: PlacesUtils.bookmarks.TYPE_FOLDER, children: item.children.map(toFolder) };
    await PlacesUtils.bookmarks.insertTree({ guid: PlacesUtils.bookmarks.menuGuid, children: [{
      title: t(`De otro Kitsune (${date})`, `From another Kitsune (${date})`), type: PlacesUtils.bookmarks.TYPE_FOLDER,
      children: copy.bookmarks.map(root => ({ title: root.title, type: PlacesUtils.bookmarks.TYPE_FOLDER, children: root.children.map(toFolder) })),
    }] }, { fixupOrSkipInvalidEntries: true });
    result.bookmarks = copy.bookmarks.reduce((sum, root) => sum + countItems(root.children), 0);
  }
  if (tabs && copy.tabs.length) {
    const { KitsuneSpaces, COLORS, MAX_SPACES } = lazy.spaces;
    const ids = new Map();
    for (const space of copy.spaces) {
      if (!copy.tabs.some(tab => tab.space === space.name)) continue;
      let id = KitsuneSpaces.list().spaces.find(item => item.name === space.name)?.id ?? null;
      if (!id && KitsuneSpaces.list().spaces.length < MAX_SPACES) {
        id = await KitsuneSpaces.create({ name: space.name, color: COLORS.includes(space.color) ? space.color : COLORS[KitsuneSpaces.list().spaces.length % COLORS.length], user: null });
        if (id) result.spaces++;
      }
      ids.set(space.name, id ?? KitsuneSpaces.list().spaces.at(-1).id);
    }
    const system = Services.scriptSecurityManager.getSystemPrincipal();
    for (const tab of copy.tabs) {
      const fresh = win.gBrowser.addTab(tab.url, { triggeringPrincipal: system, createLazyBrowser: true, lazyTabTitle: tab.title, skipAnimation: true, inBackground: true });
      if (tab.pinned) win.gBrowser.pinTab(fresh);
      else KitsuneSpaces.assignTab(fresh, (tab.space && ids.get(tab.space)) || KitsuneSpaces.active(win));
      result.tabs++;
    }
    await KitsuneSpaces.refresh(win);
  }
  if (history && copy.history.length) {
    for (let index = 0; index < copy.history.length; index += 500) {
      try {
        await PlacesUtils.history.insertMany(copy.history.slice(index, index + 500).map(page => ({ url: page.url, title: page.title || undefined,
          visits: page.visits.map(visit => ({ date: new Date(visit.date), transition: visit.transition })) })));
      } catch { /* las que no valgan se saltan */ }
    }
    result.pages = copy.history.length;
  }
  if (logins && copy.logins.length) {
    const existing = await Services.logins.getAllLogins();
    const have = new Set(existing.map(login => `${login.origin}\n${login.httpRealm ?? ''}\n${login.username}`));
    for (const login of copy.logins) {
      if (have.has(`${login.origin}\n${login.httpRealm ?? ''}\n${login.username}`)) continue;
      try {
        const info = Cc['@mozilla.org/login-manager/loginInfo;1'].createInstance(Ci.nsILoginInfo);
        info.init(login.origin, login.httpRealm ? null : (login.formActionOrigin ?? ''), login.httpRealm,
          login.username, login.password, login.usernameField, login.passwordField);
        await Services.logins.addLoginAsync(info);
        result.logins++;
      } catch { /* una que Gecko no acepte se salta */ }
    }
  }
  return result;
}

export const KitsuneCopia = {
  /** Guarda la copia en `path`. Devuelve lo que lleva. */
  async save(win, { path, password, ...choices }) {
    const copy = await collect(win, choices);
    await IOUtils.writeJSON(path, await encryptCopy(copy, password), { tmpPath: `${path}.tmp` });
    return copy;
  },
  /** Abre una copia (con su contraseña) y la trae. Devuelve { copy, result }. */
  async load(win, { path, password, ...choices }) {
    const copy = await decryptCopy(await IOUtils.readJSON(path), password);
    return { copy, result: await restore(win, copy, choices) };
  },
  open: win => openPanel(win),
  decorate: win => decorate(win),
};

// ---------------------------------------------------------------- interfaz

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};

async function pickFile(win, mode) {
  const picker = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
  const save = mode === 'save';
  picker.init(win.browsingContext, save ? t('Guardar una copia de Kitsune', 'Save a Kitsune copy') : t('Abrir una copia de Kitsune', 'Open a Kitsune copy'),
    save ? Ci.nsIFilePicker.modeSave : Ci.nsIFilePicker.modeOpen);
  picker.appendFilter(t('Copia de Kitsune', 'Kitsune copy'), '*.kitsune');
  if (save) picker.defaultString = `kitsune-${new Date().toISOString().slice(0, 10)}.kitsune`;
  const answer = await new Promise(resolve => picker.open(resolve));
  return answer === Ci.nsIFilePicker.returnCancel ? null : picker.file.path;
}

function buildPanel(win) {
  const doc = win.document;
  const panel = doc.createXULElement('panel');
  for (const [name, value] of Object.entries({ id: 'kitsune-copia-panel', type: 'arrow', class: 'kitsune-space-panel kitsune-import-panel', noautofocus: 'true' })) panel.setAttribute(name, value);
  const check = (name, label, checked) => el(doc, 'label', { class: 'kitsune-import-check' }, [el(doc, 'input', { type: 'checkbox', name, ...(checked ? { checked: 'checked' } : {}) }), label]);
  const password = (name, label) => el(doc, 'label', { class: 'kitsune-space-field' }, [label, el(doc, 'input', { type: 'password', name, autocomplete: 'new-password', minlength: String(MIN_PASSWORD) })]);
  const form = el(doc, 'form', { class: 'kitsune-space-form kitsune-import-form' }, [
    el(doc, 'h2', { class: 'kitsune-space-panel-title' }, [t('Copia de Kitsune', 'Kitsune copy')]),
    el(doc, 'p', {}, [t('Tus cosas en un archivo cifrado con tu contraseña, para llevarlas a otro ordenador. Sin servidor: el archivo lo llevas tú.',
      'Your things in a file encrypted with your password, to take them to another computer. No server: you carry the file.')]),
    el(doc, 'div', { class: 'kitsune-import-what' }, [check('bookmarks', t('Marcadores', 'Bookmarks'), true), check('tabs', t('Espacios y pestañas', 'Spaces and tabs'), true),
      check('history', t('Historial (90 días)', 'History (90 days)'), false), check('logins', t('Contraseñas', 'Passwords'), false)]),
    password('password', t('Contraseña de la copia', 'Copy password')),
    password('repeat', t('Repítela (solo para guardar)', 'Repeat it (only to save)')),
    el(doc, 'p', { class: 'kitsune-import-status', role: 'status' }),
    el(doc, 'div', { class: 'kitsune-space-panel-actions' }, [
      el(doc, 'button', { type: 'button', class: 'kitsune-space-panel-cancel' }, [t('Cerrar', 'Close')]),
      el(doc, 'button', { type: 'button', class: 'kitsune-copia-load' }, [t('Traer copia…', 'Bring copy…')]),
      el(doc, 'button', { type: 'submit', class: 'kitsune-space-panel-save kitsune-copia-save' }, [t('Guardar copia…', 'Save copy…')])]),
  ]);
  panel.append(form);
  const status = form.querySelector('.kitsune-import-status');
  const choices = () => Object.fromEntries(['bookmarks', 'tabs', 'history', 'logins'].map(name => [name, form.elements[name].checked]));
  const busy = value => { for (const button of form.querySelectorAll('button')) button.disabled = value; };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const { value } = form.elements.password;
    if ([...value].length < MIN_PASSWORD) { status.textContent = t(`La contraseña necesita al menos ${MIN_PASSWORD} caracteres.`, `The password needs at least ${MIN_PASSWORD} characters.`); return; }
    if (value !== form.elements.repeat.value) { status.textContent = t('Las dos contraseñas no coinciden.', 'The two passwords do not match.'); return; }
    const path = await pickFile(win, 'save');
    if (!path) return;
    busy(true);
    status.textContent = t('Guardando…', 'Saving…');
    try {
      const copy = await KitsuneCopia.save(win, { path, password: value, ...choices() });
      status.textContent = t(`Copia guardada: ${summary(copy) || 'vacía'}. Sin su contraseña no se puede abrir.`, `Copy saved: ${summary(copy) || 'empty'}. It cannot be opened without its password.`);
    } catch (error) {
      status.textContent = t('No se ha podido guardar la copia.', 'The copy could not be saved.');
      Services.console.logStringMessage('Kitsune: copia: ' + error);
    } finally { busy(false); }
  });
  form.querySelector('.kitsune-copia-load').addEventListener('click', async () => {
    const { value } = form.elements.password;
    if (!value) { status.textContent = t('Escribe la contraseña de la copia y vuelve a pulsar.', 'Type the copy password and press again.'); return; }
    const path = await pickFile(win, 'open');
    if (!path) return;
    busy(true);
    status.textContent = t('Trayendo…', 'Bringing…');
    try {
      const { result } = await KitsuneCopia.load(win, { path, password: value, ...choices() });
      status.textContent = t(`Traído: ${result.bookmarks} marcadores, ${result.tabs} pestañas (${result.spaces} espacios nuevos), ${result.pages} páginas del historial y ${result.logins} contraseñas.`,
        `Brought: ${result.bookmarks} bookmarks, ${result.tabs} tabs (${result.spaces} new spaces), ${result.pages} history pages and ${result.logins} passwords.`);
    } catch (error) {
      status.textContent = error.message === 'password' ? t('Esa no es la contraseña de esta copia.', 'That is not the password of this copy.')
        : t('Ese archivo no es una copia de Kitsune.', 'That file is not a Kitsune copy.');
    } finally { busy(false); }
  });
  form.querySelector('.kitsune-space-panel-cancel').addEventListener('click', () => panel.hidePopup());
  panel.addEventListener('popuphidden', () => { form.elements.password.value = ''; form.elements.repeat.value = ''; status.textContent = ''; });
  doc.getElementById('mainPopupSet').append(panel);
}

function openPanel(win) {
  const panel = win.document.getElementById('kitsune-copia-panel');
  win.PanelUI?.hide?.();
  panel?.openPopup(win.document.getElementById('PanelUI-menu-button'), 'bottomright topright', 0, 4);
}

// En el menú principal, junto a «Traer de otro navegador…». Espera a que la ventana esté lista.
async function decorate(win) {
  if (!win.gBrowser || !win.gBrowserInit?.delayedStartupFinished) await win.delayedStartupPromise;
  if (!win.gBrowser || !win.toolbar?.visible || win.document.getElementById('kitsune-copia-panel')) return;
  buildPanel(win);
  const doc = win.document;
  const insert = () => {
    const settings = doc.getElementById('appMenu-settings-button');
    if (!settings || doc.getElementById('appMenu-kitsune-copia')) return;
    const button = doc.createXULElement('toolbarbutton');
    for (const [name, value] of Object.entries({ id: 'appMenu-kitsune-copia', class: 'subviewbutton', label: t('Copia de Kitsune…', 'Kitsune copy…') })) button.setAttribute(name, value);
    button.addEventListener('command', () => openPanel(win));
    settings.before(button);
  };
  insert();
  doc.addEventListener('ViewShowing', event => { if (event.target.id === 'appMenu-mainView') insert(); }, true);
}
