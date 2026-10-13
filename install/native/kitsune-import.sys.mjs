/* Traer tus cosas de otro navegador a Kitsune.
 *
 * - Zen, Firefox, LibreWolf, Floorp y Waterfox guardan el perfil como Kitsune (Gecko): se
 *   leen marcadores, historial y pestañas abiertas de una COPIA de sus archivos (nunca se
 *   abre ni se cambia el perfil original). De Zen, además, sus espacios pasan a espacios de
 *   Kitsune y sus «Essentials» a pestañas fijadas.
 * - Chrome, Edge, Brave, Vivaldi, Opera…: el asistente de importación que ya trae Gecko.
 * - Contraseñas de Zen o Firefox: van cifradas con la clave de su perfil, así que se pasan
 *   con su exportación a CSV (se explica en el panel y se abre «Contraseñas»).
 * - Extensiones: se listan las que no tienes, con su página en la tienda.
 * Nada sale del equipo salvo, si lo pides, abrir la tienda de extensiones.
 */
const HTML = 'http://www.w3.org/1999/xhtml';
const OFFERED_PREF = 'kitsune.import.offered';
const WEB = /^(https?|ftp|file):/i;
const BOOKMARK_URL = /^(https?|ftp|file|javascript):/i;
const ROOTS = Object.freeze({ 'toolbar_____': 'Barra de marcadores', 'menu________': 'Menú de marcadores', 'unfiled_____': 'Otros marcadores', 'mobile______': 'Del móvil' });
const HISTORY_DAYS = 365;
const HISTORY_VISITS = 60000;
const CHROMIUM_NAMES = Object.freeze({
  chrome: 'Chrome', 'chrome-beta': 'Chrome Beta', 'chrome-dev': 'Chrome Dev', canary: 'Chrome Canary', chromium: 'Chromium',
  brave: 'Brave', edge: 'Edge', 'chromium-edge': 'Edge', 'chromium-edge-beta': 'Edge Beta', vivaldi: 'Vivaldi',
  opera: 'Opera', 'opera-gx': 'Opera GX', safari: 'Safari', 'chromium-360se': '360 Secure', yandex: 'Yandex',
});
// Dónde guarda cada navegador de la familia de Gecko su profiles.ini, por sistema.
export const GECKO_BROWSERS = Object.freeze([
  { kind: 'zen', name: 'Zen', linux: ['.zen', '.var/app/app.zen_browser.zen/.zen'], win: ['zen'], mac: ['zen'] },
  { kind: 'firefox', name: 'Firefox', linux: ['.mozilla/firefox', '.config/mozilla/firefox', '.var/app/org.mozilla.firefox/.mozilla/firefox', 'snap/firefox/common/.mozilla/firefox'], win: ['Mozilla/Firefox'], mac: ['Firefox'] },
  { kind: 'librewolf', name: 'LibreWolf', linux: ['.librewolf', '.var/app/io.gitlab.librewolf-community/.librewolf'], win: ['librewolf'], mac: ['librewolf'] },
  { kind: 'floorp', name: 'Floorp', linux: ['.floorp', '.var/app/one.ablaze.floorp/.floorp'], win: ['Floorp'], mac: ['Floorp'] },
  { kind: 'waterfox', name: 'Waterfox', linux: ['.waterfox'], win: ['Waterfox'], mac: ['Waterfox'] },
]);

/** profiles.ini → [{ name, path }] (rutas absolutas). */
export function parseProfilesIni(text, base) {
  const profiles = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    const section = /^\[(.+)\]$/.exec(line);
    if (section) { current = /^Profile\d+$/.test(section[1]) ? {} : null; if (current) profiles.push(current); continue; }
    const pair = /^([^=]+)=(.*)$/.exec(line);
    if (current && pair) current[pair[1].trim()] = pair[2].trim();
  }
  return profiles.filter(p => p.Path).map(p => {
    const relative = p.IsRelative !== '0';
    const path = relative ? [base, ...p.Path.split(/[\\/]/)].join('/') : p.Path;
    return { name: p.Name || p.Path, path: path.replace(/\/+/g, '/') };
  });
}

const entryOf = tab => {
  const entries = Array.isArray(tab?.entries) ? tab.entries : [];
  const index = Number.isInteger(tab?.index) && tab.index >= 1 && tab.index <= entries.length ? tab.index : entries.length;
  return entries[index - 1] ?? null;
};
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';

/**
 * Pestañas de una sesión de Gecko (sessionstore: { windows: [{ tabs }] }) o de Zen
 * (zen-sessions: { tabs, spaces }) → [{ url, title, pinned, space }]. Solo webs y archivos;
 * las Essentials de Zen son fijadas y sus fijadas por espacio, pestañas normales de su espacio.
 */
export function tabsFromSession(session) {
  const raw = Array.isArray(session?.tabs) ? session.tabs
    : (Array.isArray(session?.windows) ? session.windows.flatMap(win => Array.isArray(win?.tabs) ? win.tabs : []) : []);
  const tabs = [];
  const seen = new Set();
  for (const tab of raw) {
    const entry = entryOf(tab);
    const url = text(entry?.url, 8192);
    if (!WEB.test(url)) continue;
    const essential = tab.zenEssential === true;
    const space = typeof tab.zenWorkspace === 'string' && tab.zenWorkspace ? tab.zenWorkspace : null;
    // Zen guarda la misma pestaña en cada ventana: se queda una (por su id de sincronización si lo tiene).
    const key = tab.zenSyncId ? `id:${tab.zenSyncId}` : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    tabs.push({ url, title: text(entry?.title, 512) || url, pinned: essential || (tab.pinned === true && !space), space: essential ? null : space });
  }
  return tabs;
}

/** Los espacios de Zen (de zen-sessions, de una ventana de la sesión o de la tabla de Places), por orden. */
export function spacesFromZen(session, rows = []) {
  const list = Array.isArray(session?.spaces) && session.spaces.length ? session.spaces
    : (session?.windows ?? []).map(win => win?.spaces).find(spaces => Array.isArray(spaces) && spaces.length) ?? rows;
  return list.filter(space => space && typeof space.uuid === 'string' && typeof space.name === 'string')
    .map((space, index) => ({ uuid: space.uuid, name: space.name, icon: typeof space.icon === 'string' ? space.icon : '', position: Number.isFinite(space.position) ? space.position : index }))
    .sort((a, b) => a.position - b.position);
}

/** El nombre de un espacio de Zen en Kitsune: con su emoji delante, si lo tiene. */
export function spaceName(space) {
  const icon = space.icon && [...space.icon].length <= 4 && !/^(chrome|moz|https?|data):/i.test(space.icon) ? space.icon.trim() : '';
  return `${icon ? icon + ' ' : ''}${space.name}`.replace(/\s+/g, ' ').trim();
}

/**
 * Filas de moz_bookmarks (id, parent, type, title, position, guid, url) → los árboles de las
 * raíces con algo dentro, listos para PlacesUtils.bookmarks.insertTree.
 */
export function bookmarkTrees(rows) {
  const children = new Map();
  const byId = new Map();
  for (const row of rows) {
    byId.set(row.id, row);
    if (!children.has(row.parent)) children.set(row.parent, []);
    children.get(row.parent).push(row);
  }
  for (const list of children.values()) list.sort((a, b) => a.position - b.position);
  const build = (row, depth = 0) => {
    if (depth > 30) return null;
    if (row.type === 3) return { type: 'separator' };
    if (row.type === 1) return row.url && BOOKMARK_URL.test(row.url) ? { title: text(row.title, 4096), url: row.url } : null;
    if (row.type === 2) {
      const items = (children.get(row.id) ?? []).map(child => build(child, depth + 1)).filter(Boolean);
      return items.some(item => item.type !== 'separator') ? { title: text(row.title, 4096) || 'Carpeta', type: 'folder', children: items } : null;
    }
    return null;
  };
  const trees = [];
  for (const [guid, title] of Object.entries(ROOTS)) {
    const root = rows.find(row => row.guid === guid);
    if (!root) continue;
    const items = (children.get(root.id) ?? []).map(child => build(child)).filter(Boolean);
    if (items.some(item => item.type !== 'separator')) trees.push({ title, children: items });
  }
  return trees;
}
export const countBookmarks = items => items.reduce((sum, item) => sum + (item.url ? 1 : item.children ? countBookmarks(item.children) : 0), 0);

/** Filas de visitas (url, title, visit_date en µs, visit_type) → páginas para PlacesUtils.history.insertMany. */
export function historyPages(rows, now = Date.now()) {
  const pages = new Map();
  for (const row of rows) {
    if (!row.url || !WEB.test(row.url) || row.visit_type === 4 || !(row.visit_type >= 1 && row.visit_type <= 9)) continue;
    const date = Math.min(Math.floor(row.visit_date / 1000), now);
    if (!Number.isFinite(date) || date <= 0) continue;
    let page = pages.get(row.url);
    if (!page) {
      page = { url: row.url, visits: [] };
      if (text(row.title, 4096)) page.title = text(row.title, 4096);
      pages.set(row.url, page);
    }
    if (page.visits.length < 20) page.visits.push({ date, transition: row.visit_type });
  }
  return [...pages.values()];
}

/** extensions.json → las extensiones que puso el usuario (no las de serie), con nombre e id. */
export function userExtensions(json) {
  return (Array.isArray(json?.addons) ? json.addons : [])
    .filter(addon => addon?.type === 'extension' && addon.location === 'app-profile' && typeof addon.id === 'string' &&
      !/@(mozilla\.org|search\.mozilla\.org|zen-browser\.app)$/.test(addon.id))
    .map(addon => ({ id: addon.id, name: text(addon.defaultLocale?.name, 120) || addon.id }));
}

// ---------------------------------------------------------------- dentro de Gecko

const lazy = {
  get Sqlite() { return ChromeUtils.importESModule('resource://gre/modules/Sqlite.sys.mjs').Sqlite; },
  get PlacesUtils() { return ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs').PlacesUtils; },
  get AddonManager() { return ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs').AddonManager; },
  get MigrationUtils() { return ChromeUtils.importESModule('resource:///modules/MigrationUtils.sys.mjs').MigrationUtils; },
  get spaces() { return ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs'); },
};
const exists = async path => { try { return (await IOUtils.stat(path)).type === 'regular'; } catch { return false; } };

function browserBases() {
  const home = Services.dirsvc.get('Home', Ci.nsIFile).path;
  const os = Services.appinfo.OS;
  if (os === 'WINNT') return { key: 'win', root: Services.dirsvc.get('AppData', Ci.nsIFile).path };
  if (os === 'Darwin') return { key: 'mac', root: PathUtils.join(home, 'Library', 'Application Support') };
  return { key: 'linux', root: home };
}

/** Navegadores de los que se puede traer algo: los de Gecko (por perfil) y los que sabe leer el asistente. */
export async function findSources() {
  const { key, root } = browserBases();
  const own = PathUtils.profileDir.replace(/[\\/]+$/, '');
  const sources = [];
  for (const browser of GECKO_BROWSERS) {
    for (const relative of browser[key]) {
      const base = PathUtils.join(root, ...relative.split('/'));
      let ini;
      try { ini = await IOUtils.readUTF8(PathUtils.join(base, 'profiles.ini')); } catch { continue; }
      for (const profile of parseProfilesIni(ini, base)) {
        const path = PathUtils.normalize ? PathUtils.normalize(profile.path) : profile.path;
        if (path.replace(/[\\/]+$/, '') === own || !(await exists(PathUtils.join(path, 'places.sqlite')))) continue;
        if (sources.some(source => source.path === path)) continue;
        sources.push({ id: `${browser.kind}:${path}`, kind: browser.kind, name: browser.name, profile: profile.name, path, gecko: true });
      }
    }
  }
  try {
    for (const migratorKey of lazy.MigrationUtils.availableMigratorKeys) {
      if (/^firefox|internal-testing/.test(migratorKey)) continue;
      if (await lazy.MigrationUtils.getMigrator(migratorKey)) {
        sources.push({ id: `wizard:${migratorKey}`, kind: migratorKey, name: CHROMIUM_NAMES[migratorKey] ?? migratorKey, gecko: false });
      }
    }
  } catch { /* sin asistente, solo los de Gecko */ }
  return sources;
}

async function copyFiles(path, names) {
  const folder = await IOUtils.createUniqueDirectory(PathUtils.tempDir, 'kitsune-importar');
  const copied = {};
  for (const name of names) {
    const from = PathUtils.join(path, ...name.split('/'));
    if (!(await exists(from))) continue;
    const to = PathUtils.join(folder, name.replace(/\//g, '-'));
    await IOUtils.copy(from, to);
    copied[name] = to;
  }
  return { folder, copied };
}

async function readSession(copied) {
  for (const name of ['zen-sessions.jsonlz4', 'sessionstore.jsonlz4', 'sessionstore-backups/recovery.jsonlz4', 'sessionstore-backups/previous.jsonlz4']) {
    if (!copied[name]) continue;
    try { return await IOUtils.readJSON(copied[name], { decompress: true }); } catch { /* el siguiente */ }
  }
  return null;
}

/** Trae lo elegido de un perfil de Gecko. Devuelve el resumen de lo que ha traído. */
export async function importGecko(win, source, { bookmarks = true, history = true, tabs = true } = {}, report = () => {}) {
  const files = ['places.sqlite', 'places.sqlite-wal', 'zen-sessions.jsonlz4', 'sessionstore.jsonlz4',
    'sessionstore-backups/recovery.jsonlz4', 'sessionstore-backups/previous.jsonlz4', 'extensions.json'];
  const { folder, copied } = await copyFiles(source.path, files);
  const result = { bookmarks: 0, pages: 0, tabs: 0, spaces: 0, extensions: [] };
  let db = null;
  try {
    if (copied['places.sqlite']) {
      // La copia lleva su -wal al lado (mismo nombre): SQLite lo integra al abrirla; el original no se toca.
      db = await lazy.Sqlite.openConnection({ path: copied['places.sqlite'] });
    }
    const date = new Date().toLocaleDateString('es-ES');
    if (db && bookmarks) {
      report('Marcadores…');
      const rows = (await db.execute(`SELECT b.id, b.parent, b.type, b.title, b.position, b.guid, p.url
        FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk`)).map(row => ({
        id: row.getResultByName('id'), parent: row.getResultByName('parent'), type: row.getResultByName('type'),
        title: row.getResultByName('title'), position: row.getResultByName('position'), guid: row.getResultByName('guid'), url: row.getResultByName('url') }));
      const trees = bookmarkTrees(rows);
      result.bookmarks = countBookmarks(trees);
      if (result.bookmarks) {
        const { PlacesUtils } = lazy;
        const toFolder = item => item.type === 'separator' ? { type: PlacesUtils.bookmarks.TYPE_SEPARATOR }
          : item.url ? { title: item.title, url: item.url }
          : { title: item.title, type: PlacesUtils.bookmarks.TYPE_FOLDER, children: item.children.map(toFolder) };
        await PlacesUtils.bookmarks.insertTree({ guid: PlacesUtils.bookmarks.menuGuid, children: [{
          title: `De ${source.name} (${date})`, type: PlacesUtils.bookmarks.TYPE_FOLDER,
          children: trees.map(tree => ({ title: tree.title, type: PlacesUtils.bookmarks.TYPE_FOLDER, children: tree.children.map(toFolder) })),
        }] }, { fixupOrSkipInvalidEntries: true });
      }
    }
    if (db && history) {
      report('Historial…');
      const since = (Date.now() - HISTORY_DAYS * 86400000) * 1000;
      const rows = (await db.execute(`SELECT p.url, p.title, v.visit_date, v.visit_type FROM moz_historyvisits v
        JOIN moz_places p ON p.id = v.place_id WHERE v.visit_date > :since ORDER BY v.visit_date DESC LIMIT ${HISTORY_VISITS}`, { since }))
        .map(row => ({ url: row.getResultByName('url'), title: row.getResultByName('title'), visit_date: row.getResultByName('visit_date'), visit_type: row.getResultByName('visit_type') }));
      const pages = historyPages(rows);
      for (let index = 0; index < pages.length; index += 500) {
        try { await lazy.PlacesUtils.history.insertMany(pages.slice(index, index + 500).map(page => ({ ...page, visits: page.visits.map(visit => ({ ...visit, date: new Date(visit.date) })) }))); } catch { /* las que no valgan se saltan */ }
      }
      result.pages = pages.length;
    }
    if (tabs) {
      report('Pestañas…');
      const session = await readSession(copied);
      let zenRows = [];
      if (source.kind === 'zen' && db) {
        try { zenRows = (await db.execute('SELECT uuid, name, icon, position FROM zen_workspaces ORDER BY position')).map(row => ({ uuid: row.getResultByName('uuid'), name: row.getResultByName('name'), icon: row.getResultByName('icon'), position: row.getResultByName('position') })); } catch { /* Zen nuevo: van en la sesión */ }
      }
      Object.assign(result, await openTabs(win, source, tabsFromSession(session), source.kind === 'zen' ? spacesFromZen(session, zenRows) : []));
    }
    if (copied['extensions.json']) {
      try {
        const listed = userExtensions(await IOUtils.readJSON(copied['extensions.json']));
        for (const extension of listed) if (!(await lazy.AddonManager.getAddonByID(extension.id))) result.extensions.push(extension);
      } catch { /* sin lista de extensiones */ }
    }
  } finally {
    try { await db?.close(); } catch { /* ya cerrada */ }
    try { await IOUtils.remove(folder, { recursive: true }); } catch { /* temporal */ }
  }
  return result;
}

/** Abre las pestañas traídas sin cargarlas (se cargan al elegirlas) y reparte las de Zen por espacios. */
async function openTabs(win, source, tabs, zenSpaces) {
  const gBrowser = win.gBrowser;
  const { KitsuneSpaces, COLORS, MAX_SPACES } = lazy.spaces;
  const map = new Map();
  let created = 0;
  for (const space of zenSpaces) {
    const name = spaceName(space);
    if (!tabs.some(tab => tab.space === space.uuid) || !name) continue;
    const existing = KitsuneSpaces.list().spaces.find(item => item.name === [...name].slice(0, 24).join(''));
    let id = existing?.id ?? null;
    if (!id && KitsuneSpaces.list().spaces.length < MAX_SPACES) {
      id = await KitsuneSpaces.create({ name, color: COLORS[(KitsuneSpaces.list().spaces.length) % COLORS.length], user: null });
      if (id) created++;
    }
    // Si ya no caben más espacios, sus pestañas van al último.
    map.set(space.uuid, id ?? KitsuneSpaces.list().spaces.at(-1).id);
  }
  const system = Services.scriptSecurityManager.getSystemPrincipal();
  let opened = 0;
  for (const tab of tabs.slice(0, 400)) {
    const fresh = gBrowser.addTab(tab.url, { triggeringPrincipal: system, createLazyBrowser: true, lazyTabTitle: tab.title, skipAnimation: true, inBackground: true });
    if (tab.pinned) gBrowser.pinTab(fresh);
    else KitsuneSpaces.assignTab(fresh, (tab.space && map.get(tab.space)) || KitsuneSpaces.active(win));
    opened++;
  }
  await KitsuneSpaces.refresh(win);
  return { tabs: opened, spaces: created };
}

// ---------------------------------------------------------------- interfaz

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};
const plural = (count, one, many) => `${count.toLocaleString('es-ES')} ${count === 1 ? one : many}`;

function summary(source, result) {
  const parts = [];
  if (result.bookmarks) parts.push(plural(result.bookmarks, 'marcador', 'marcadores'));
  if (result.pages) parts.push(plural(result.pages, 'página del historial', 'páginas del historial'));
  if (result.tabs) parts.push(plural(result.tabs, 'pestaña', 'pestañas'));
  if (result.spaces) parts.push(plural(result.spaces, 'espacio', 'espacios'));
  return parts.length ? `Traído de ${source.name}: ${parts.join(', ')}.` : `En ${source.name} no había nada que traer.`;
}

async function fillPanel(win) {
  const doc = win.document;
  const panel = doc.getElementById('kitsune-import-panel');
  const list = panel.querySelector('.kitsune-import-sources');
  const status = panel.querySelector('.kitsune-import-status');
  status.textContent = 'Buscando navegadores…';
  list.replaceChildren();
  panel.querySelector('.kitsune-import-result').replaceChildren();
  const sources = await findSources();
  panel.sources = sources;
  if (!sources.length) { status.textContent = 'No hay otros navegadores en este equipo de los que traer nada.'; return; }
  status.textContent = '';
  sources.forEach((source, index) => {
    const id = `kitsune-import-source-${index}`;
    const input = el(doc, 'input', { type: 'radio', name: 'kitsune-import-source', id, value: source.id });
    if (!index) input.checked = true;
    list.append(el(doc, 'label', { for: id, class: 'kitsune-import-source' }, [input,
      el(doc, 'span', {}, [el(doc, 'b', {}, [source.name]), el(doc, 'small', {}, [source.gecko ? `Perfil «${source.profile}»` : 'Con el asistente de importación'])])]));
  });
  const update = () => {
    const source = sources.find(item => item.id === panel.querySelector('input[name=kitsune-import-source]:checked')?.value);
    panel.querySelector('.kitsune-import-what').hidden = !source?.gecko;
    panel.querySelector('.kitsune-import-zen').hidden = source?.kind !== 'zen';
  };
  list.addEventListener('change', update);
  update();
}

async function runImport(win) {
  const doc = win.document;
  const panel = doc.getElementById('kitsune-import-panel');
  const source = panel.sources?.find(item => item.id === panel.querySelector('input[name=kitsune-import-source]:checked')?.value);
  if (!source) return;
  const status = panel.querySelector('.kitsune-import-status');
  const button = panel.querySelector('.kitsune-import-go');
  if (!source.gecko) {
    panel.hidePopup();
    lazy.MigrationUtils.showMigrationWizard(win, { entrypoint: lazy.MigrationUtils.MIGRATION_ENTRYPOINTS?.PREFERENCES, migratorKey: source.kind });
    return;
  }
  button.disabled = true;
  const options = Object.fromEntries([...panel.querySelectorAll('.kitsune-import-what input')].map(input => [input.name, input.checked]));
  try {
    const result = await importGecko(win, source, options, step => { status.textContent = step; });
    Services.prefs.setBoolPref(OFFERED_PREF, true);
    status.textContent = summary(source, result);
    const extras = panel.querySelector('.kitsune-import-result');
    const passwords = el(doc, 'p', {}, [`Contraseñas: en ${source.name}, abre Contraseñas (about:logins) → ⋯ → Exportar. Aquí, `,
      el(doc, 'a', { href: '#', class: 'kitsune-import-logins' }, ['Contraseñas → ⋯ → Importar desde un archivo']), '.']);
    extras.replaceChildren(passwords);
    passwords.querySelector('a').addEventListener('click', event => { event.preventDefault(); win.openTrustedLinkIn('about:logins', 'tab'); panel.hidePopup(); });
    if (result.extensions.length) {
      const names = result.extensions.slice(0, 8).map(extension => extension.name).join(', ');
      const link = el(doc, 'a', { href: '#' }, ['Abrirlas en la tienda']);
      link.addEventListener('click', event => {
        event.preventDefault();
        for (const extension of result.extensions.slice(0, 10)) win.openTrustedLinkIn(`https://addons.mozilla.org/es-ES/firefox/addon/${encodeURIComponent(extension.id)}/`, 'tab', { inBackground: true });
        panel.hidePopup();
      });
      extras.append(el(doc, 'p', {}, [`Extensiones que tenías allí y aquí no: ${names}${result.extensions.length > 8 ? '…' : ''}. `, link, '.']));
    }
  } catch (error) {
    status.textContent = 'No se ha podido traer todo. Si ese navegador está abierto, ciérralo y vuelve a intentarlo.';
    Services.console.logStringMessage('Kitsune: import failed: ' + error);
  } finally {
    button.disabled = false;
  }
}

function buildPanel(win) {
  const doc = win.document;
  const panel = doc.createXULElement('panel');
  for (const [name, value] of Object.entries({ id: 'kitsune-import-panel', type: 'arrow', class: 'kitsune-space-panel kitsune-import-panel', noautofocus: 'true' })) panel.setAttribute(name, value);
  const check = (name, label) => el(doc, 'label', { class: 'kitsune-import-check' }, [el(doc, 'input', { type: 'checkbox', name, checked: 'checked' }), label]);
  const form = el(doc, 'form', { class: 'kitsune-space-form kitsune-import-form' }, [
    el(doc, 'h2', { class: 'kitsune-space-panel-title' }, ['Traer de otro navegador']),
    el(doc, 'div', { class: 'kitsune-import-sources', role: 'radiogroup', 'aria-label': 'Navegador' }),
    el(doc, 'div', { class: 'kitsune-import-what' }, [check('bookmarks', 'Marcadores'), check('history', 'Historial (un año)'), check('tabs', 'Pestañas abiertas')]),
    el(doc, 'p', { class: 'kitsune-import-zen' }, ['Tus espacios de Zen pasan a espacios de Kitsune y sus Essentials, a pestañas fijadas.']),
    el(doc, 'p', { class: 'kitsune-import-status', role: 'status' }),
    el(doc, 'div', { class: 'kitsune-import-result' }),
    el(doc, 'div', { class: 'kitsune-space-panel-actions' }, [
      el(doc, 'button', { type: 'button', class: 'kitsune-space-panel-cancel' }, ['Cerrar']),
      el(doc, 'button', { type: 'submit', class: 'kitsune-space-panel-save kitsune-import-go' }, ['Traer'])]),
  ]);
  panel.append(form);
  form.addEventListener('submit', event => { event.preventDefault(); void runImport(win).catch(() => {}); });
  form.querySelector('.kitsune-space-panel-cancel').addEventListener('click', () => panel.hidePopup());
  doc.getElementById('mainPopupSet').append(panel);
}

export function openImport(win) {
  const panel = win.document.getElementById('kitsune-import-panel');
  const anchor = win.document.getElementById('PanelUI-menu-button');
  win.PanelUI?.hide?.();
  panel.openPopup(anchor, 'bottomright topright', 0, 4);
  void fillPanel(win).catch(() => {});
}

// El menú principal se construye la primera vez que se abre: entonces se añade la entrada.
function addMenuEntry(win) {
  const doc = win.document;
  const insert = () => {
    const settings = doc.getElementById('appMenu-settings-button');
    if (!settings || doc.getElementById('appMenu-kitsune-import')) return;
    const button = doc.createXULElement('toolbarbutton');
    for (const [name, value] of Object.entries({ id: 'appMenu-kitsune-import', class: 'subviewbutton', label: 'Traer de otro navegador…' })) button.setAttribute(name, value);
    button.addEventListener('command', () => openImport(win));
    settings.before(button);
  };
  insert();
  doc.addEventListener('ViewShowing', event => { if (event.target.id === 'appMenu-mainView') insert(); }, true);
}

/** La primera vez, si hay otro navegador con algo que traer, se ofrece en una barra. */
async function offer(win) {
  if (Services.prefs.getBoolPref(OFFERED_PREF, false)) return;
  const sources = (await findSources()).filter(source => source.gecko || source.kind);
  if (!sources.length || !win.gNotificationBox) return;
  const first = sources[0];
  await win.gNotificationBox.appendNotification('kitsune-import', {
    label: `¿Vienes de ${first.name}? Trae tus marcadores, tu historial y tus pestañas${first.kind === 'zen' ? ' (con sus espacios)' : ''}.`,
    priority: win.gNotificationBox.PRIORITY_INFO_LOW,
    eventCallback: event => { if (event === 'dismissed') Services.prefs.setBoolPref(OFFERED_PREF, true); },
  }, [
    { label: 'Traer mis cosas', accessKey: 'T', callback: () => { openImport(win); return false; } },
    { label: 'Ahora no', accessKey: 'n', callback: () => { Services.prefs.setBoolPref(OFFERED_PREF, true); } },
  ]);
}

const decorated = new WeakSet();
export const KitsuneImport = {
  async decorate(win) {
    if (!win.gBrowser || !win.gBrowserInit?.delayedStartupFinished) await win.delayedStartupPromise;
    if (decorated.has(win) || !win.toolbar?.visible || win.PrivateBrowsingUtils?.isWindowPrivate(win)) return;
    decorated.add(win);
    buildPanel(win);
    addMenuEntry(win);
    const { setTimeout } = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
    setTimeout(() => void offer(win).catch(() => {}), 4000);
  },
  findSources: () => findSources(),
  importGecko: (win, source, options) => importGecko(win, source, options),
  open: win => openImport(win),
};
