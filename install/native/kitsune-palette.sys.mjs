/* Paleta de Kitsune (Ctrl+K): un solo cuadro para todo.
 *
 * - Pestañas abiertas de todos los espacios, espacios, marcadores e historial, y las
 *   acciones del navegador y de Kitsune. Cada acción enseña su atajo, sacado de la propia
 *   tecla de Gecko (ShortcutUtils), así que siempre es el de verdad y en macOS sale con ⌘.
 * - Las acciones con tecla hacen exactamente lo mismo que su atajo (key.doCommand()).
 * - Lo escrito que parece una dirección se puede abrir y, si no, buscar en la web.
 * - «?» enseña todas las acciones con su atajo. Todo funciona con el teclado.
 * Ctrl+K era «buscar en la web» de Gecko: esa tecla se apaga y la búsqueda vive aquí.
 */
const HTML = 'http://www.w3.org/1999/xhtml';
const decorated = new WeakSet();

/** Texto para comparar: minúsculas y sin tildes. */
export const fold = text => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Cuánto encaja `query` en `text`: 0 nada; más alto, mejor (empieza > palabra > dentro > letras en orden). */
export function score(query, text) {
  const q = fold(query).trim(), t = fold(text);
  if (!q) return 1;
  if (t.startsWith(q)) return 100 - Math.min(t.length - q.length, 50) / 100;
  if (new RegExp(`(^|[\\s·/.\\-«(])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) return 80;
  if (t.includes(q)) return 60;
  let index = 0;
  for (const char of t) if (char === q[index]) index++;
  return index === q.length ? 20 + 20 * (q.length / t.length) : 0;
}

/** Lo mejor de cada lista, por puntos y sin pasar de `limit`. Las palabras sueltas deben encajar todas. */
export function rank(query, items, limit = 8) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return items.map(item => {
    const haystack = [item.label, item.detail, ...(item.keywords ?? [])].join(' ');
    const points = words.length ? Math.min(...words.map(word => Math.max(score(word, item.label), score(word, haystack) * 0.9))) : 1;
    return { item, points: points * (item.weight ?? 1) };
  }).filter(entry => entry.points > 0).sort((a, b) => b.points - a.points).slice(0, limit).map(entry => entry.item);
}

/** ¿Lo escrito es una dirección? (algo.algo sin espacios, o con su esquema). */
export const looksLikeAddress = text => /^(https?:\/\/|about:)\S+$/i.test(text.trim()) || /^[^\s/]+\.[a-z]{2,}(?::\d+)?(\/\S*)?$/i.test(text.trim());

// Acciones: con su tecla de Gecko (o de Kitsune) o con lo que hacen.
const ACTIONS = [
  { label: 'Nueva pestaña', key: 'key_newNavigatorTab', keywords: ['abrir'] },
  { label: 'Cerrar pestaña', key: 'key_close' },
  { label: 'Reabrir la pestaña cerrada', key: 'key_restoreLastClosedTabOrWindowOrSession', keywords: ['deshacer', 'recuperar'] },
  { label: 'Duplicar pestaña', key: 'key_duplicateTab' },
  { label: 'Fijar o soltar la pestaña', run: win => { const tab = win.gBrowser.selectedTab; tab.pinned ? win.gBrowser.unpinTab(tab) : win.gBrowser.pinTab(tab); }, keywords: ['essentials'] },
  { label: 'Silenciar o activar el sonido de la pestaña', key: 'key_toggleMute', keywords: ['mute', 'audio'] },
  { label: 'Recargar', key: 'key_reload2' },
  { label: 'Nueva ventana', key: 'key_newNavigator' },
  { label: 'Nueva ventana privada', key: 'key_privatebrowsing', keywords: ['incognito', 'privado'] },
  { label: 'Buscar en la página', key: 'key_find' },
  { label: 'Pantalla completa', key: 'key_enterFullScreen' },
  { label: 'Modo lectura', key: 'key_toggleReaderMode' },
  { label: 'Imagen en imagen', key: 'key_togglePictureInPicture', keywords: ['video', 'pip'] },
  { label: 'Captura de pantalla', key: 'key_screenshot' },
  { label: 'Ampliar', key: 'key_fullZoomEnlarge', keywords: ['zoom'] },
  { label: 'Reducir', key: 'key_fullZoomReduce', keywords: ['zoom'] },
  { label: 'Tamaño normal', key: 'key_fullZoomReset', keywords: ['zoom'] },
  { label: 'Todas las pestañas', key: 'key_showAllTabs' },
  { label: 'Dividir la pestaña o separarla', key: 'kitsune-split-key', keywords: ['vista dividida', 'split'] },
  { label: 'Modo compacto', key: 'kitsune-compact-key', keywords: ['ocultar barras', 'zen'] },
  { label: 'Espacio siguiente', key: 'kitsune-space-key-next' },
  { label: 'Espacio anterior', key: 'kitsune-space-key-previous' },
  { label: 'Nuevo espacio', run: win => spaces()?.KitsuneSpaces.openEditor(win), keywords: ['workspace'] },
  { label: 'Pestañas arriba', run: () => setTabs(false), keywords: ['horizontal'] },
  { label: 'Pestañas a un lado', run: () => setTabs(true, 'always-show'), keywords: ['vertical', 'barra lateral'] },
  { label: 'Pestañas a un lado, solo iconos', run: () => setTabs(true, 'expand-on-hover'), keywords: ['vertical', 'plegada'] },
  { label: 'Traer de otro navegador', run: win => importer()?.open(win), keywords: ['importar', 'zen', 'chrome', 'firefox'] },
  { label: 'Tu inicio', key: 'goHome', keywords: ['home', 'ajustes de kitsune', 'tema', 'fondo', 'modo ahorro'] },
  { label: 'Descargas', key: 'key_openDownloads' },
  { label: 'Historial', key: 'showAllHistoryKb' },
  { label: 'Marcadores', key: 'manBookmarkKb', keywords: ['favoritos'] },
  { label: 'Añadir esta página a marcadores', key: 'addBookmarkAsKb', keywords: ['favorito'] },
  { label: 'Contraseñas', run: win => win.openTrustedLinkIn('about:logins', 'tab'), keywords: ['claves', 'logins'] },
  { label: 'Extensiones', key: 'key_openAddons', keywords: ['complementos', 'addons'] },
  { label: 'Ajustes del navegador', run: win => win.openPreferences(), keywords: ['preferencias', 'opciones'] },
  { label: 'Borrar historial reciente', key: 'key_sanitize', keywords: ['limpiar'] },
  { label: 'Administrador de procesos', key: 'key_aboutProcesses', keywords: ['memoria', 'ram', 'cpu'] },
  { label: 'Ver código fuente', key: 'key_viewSource' },
  { label: 'Herramientas de desarrollo', key: 'key_toggleToolbox', keywords: ['devtools', 'consola', 'inspector'] },
];

const lazy = {
  get ShortcutUtils() { return ChromeUtils.importESModule('resource://gre/modules/ShortcutUtils.sys.mjs').ShortcutUtils; },
  get PlacesUtils() { return ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs').PlacesUtils; },
};
const spaces = () => { try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs'); } catch { return null; } };
const importer = () => { try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-import.sys.mjs').KitsuneImport; } catch { return null; } };
function setTabs(vertical, visibility) {
  Services.prefs.setBoolPref('sidebar.verticalTabs', vertical);
  if (vertical) Services.prefs.setStringPref('sidebar.visibility', visibility);
}

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};
function shortcutOf(doc, id) {
  const key = id && doc.getElementById(id);
  if (!key || key.getAttribute('disabled') === 'true') return '';
  try { return lazy.ShortcutUtils.prettifyShortcut(key) || ''; } catch { return ''; }
}

// about:, data: y otras direcciones sin host lanzan al pedírselo: entonces, nada.
const hostOf = uri => { try { return uri?.host ?? ''; } catch { return ''; } };

/** Lo que se ofrece para lo escrito (sin marcadores ni historial, que llegan después). */
export function localResults(win, query) {
  const doc = win.document;
  const module = spaces();
  const list = module?.KitsuneSpaces.list().spaces ?? [];
  const nameOf = id => list.find(space => space.id === id)?.name ?? '';
  const actions = ACTIONS.filter(action => !action.key || doc.getElementById(action.key)).map(action => ({
    type: 'accion', label: action.label, keywords: action.keywords, shortcut: shortcutOf(doc, action.key),
    run: () => action.key ? doc.getElementById(action.key).doCommand() : action.run(win), weight: 1,
  }));
  if (query.trim() === '?') return actions.filter(action => action.shortcut);
  const tabs = [...win.gBrowser.tabs].filter(tab => !tab.closing).map(tab => ({
    type: 'pestana', label: tab.label, detail: [hostOf(tab.linkedBrowser?.currentURI), module && !tab.pinned ? nameOf(module.tabSpace(tab)) : (tab.pinned ? 'fijada' : '')].filter(Boolean).join(' · '),
    keywords: [tab.linkedBrowser?.currentURI?.spec ?? ''], run: () => { win.gBrowser.selectedTab = tab; }, weight: tab.selected ? 0.5 : 1.1,
  }));
  const spaceItems = list.map((space, index) => ({
    type: 'espacio', label: space.name, detail: 'Espacio', shortcut: shortcutOf(doc, `kitsune-space-key-${index + 1}`),
    keywords: ['espacio', 'workspace'], run: () => module.switchTo(win, space.id), weight: 1.05,
  }));
  if (!query.trim()) return [...rank('', tabs.filter(tab => tab.weight > 1), 6), ...actions.slice(0, 6)];
  const results = [...rank(query, [...spaceItems, ...tabs], 6), ...rank(query, actions, 6)];
  const typed = query.trim();
  const web = looksLikeAddress(typed)
    ? { type: 'web', label: `Ir a ${typed}`, run: () => win.openTrustedLinkIn(/^[a-z]+:/i.test(typed) ? typed : `https://${typed}`, 'current') }
    : { type: 'web', label: `Buscar «${typed}» en la web`, run: () => void searchWeb(win, typed) };
  return results.length && !looksLikeAddress(typed) ? [...results, web] : [web, ...results];
}

async function searchWeb(win, text) {
  const engine = await Services.search.getDefault();
  const submission = engine.getSubmission(text);
  win.openTrustedLinkIn(submission.uri.spec, win.gBrowser.selectedTab.isEmpty ? 'current' : 'tab');
}

/** Marcadores e historial que encajan (de Places, como mucho seis). */
async function placesResults(win, query) {
  const text = query.trim();
  if (text.length < 2 || text === '?') return [];
  const db = await lazy.PlacesUtils.promiseDBConnection();
  const like = `%${text.replace(/[\\%_]/g, char => '\\' + char)}%`;
  const rows = await db.executeCached(`SELECT h.url, h.title, EXISTS(SELECT 1 FROM moz_bookmarks b WHERE b.fk = h.id) AS marcado
    FROM moz_places h WHERE h.hidden = 0 AND h.url NOT LIKE 'place:%' AND (h.title LIKE :like ESCAPE '\\' OR h.url LIKE :like ESCAPE '\\')
    ORDER BY marcado DESC, h.frecency DESC LIMIT 6`, { like });
  return rows.map(row => {
    const url = row.getResultByName('url');
    let host = '';
    try { host = new URL(url).host; } catch { /* sin host */ }
    return { type: row.getResultByName('marcado') ? 'marcador' : 'historial', label: row.getResultByName('title') || url, detail: host, url,
      run: () => win.openTrustedLinkIn(url, win.gBrowser.selectedTab.isEmpty ? 'current' : 'tab') };
  });
}

const KIND = { accion: 'Acción', pestana: 'Pestaña', espacio: 'Espacio', marcador: 'Marcador', historial: 'Historial', web: '' };

function build(win) {
  const doc = win.document;
  const panel = doc.createXULElement('panel');
  for (const [name, value] of Object.entries({ id: 'kitsune-palette', class: 'kitsune-palette', noautofocus: 'true' })) panel.setAttribute(name, value);
  const input = el(doc, 'input', { type: 'text', class: 'kitsune-palette-input', placeholder: 'Pestañas, espacios, acciones, marcadores… («?» para ver los atajos)', spellcheck: 'false', 'aria-label': 'Paleta de Kitsune', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'kitsune-palette-list' });
  const list = el(doc, 'ul', { id: 'kitsune-palette-list', class: 'kitsune-palette-list', role: 'listbox' });
  const box = el(doc, 'div', { class: 'kitsune-palette-box' }, [input, list]);
  panel.append(box);
  doc.getElementById('mainPopupSet').append(panel);
  let items = [], active = 0, generation = 0;
  const paint = () => {
    list.replaceChildren(...items.map((item, index) => el(doc, 'li', { role: 'option', class: `kitsune-palette-item kitsune-palette-${item.type}`, 'aria-selected': String(index === active), 'data-index': String(index), id: `kitsune-palette-${index}` }, [
      el(doc, 'span', { class: 'kitsune-palette-kind' }, [KIND[item.type] ?? '']),
      el(doc, 'span', { class: 'kitsune-palette-label' }, [item.label]),
      el(doc, 'span', { class: 'kitsune-palette-detail' }, [item.detail ?? '']),
      el(doc, 'kbd', { class: 'kitsune-palette-shortcut' }, [item.shortcut ?? '']),
    ])));
    input.setAttribute('aria-activedescendant', items.length ? `kitsune-palette-${active}` : '');
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  const refresh = async () => {
    const mine = ++generation;
    items = localResults(win, input.value);
    active = 0;
    paint();
    const found = await placesResults(win, input.value).catch(() => []);
    if (mine !== generation || !found.length) return;
    const known = new Set(items.filter(item => item.type === 'pestana').map(item => item.keywords?.[0]));
    const extra = found.filter(item => !known.has(item.url));
    const webAt = items.findIndex(item => item.type === 'web');
    items = webAt > 0 ? [...items.slice(0, webAt), ...extra, ...items.slice(webAt)] : [...items, ...extra];
    paint();
  };
  const run = index => {
    const item = items[index];
    if (!item) return;
    panel.hidePopup();
    try { item.run(); } catch (error) { Services.console.logStringMessage('Kitsune: palette action failed: ' + error); }
  };
  input.addEventListener('input', () => void refresh());
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (items.length) active = (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      paint(); event.preventDefault();
    } else if (event.key === 'Enter') { run(active); event.preventDefault(); }
  });
  list.addEventListener('mousemove', event => {
    const row = event.target.closest('[data-index]');
    if (row && Number(row.dataset.index) !== active) { active = Number(row.dataset.index); paint(); }
  });
  list.addEventListener('click', event => { const row = event.target.closest('[data-index]'); if (row) run(Number(row.dataset.index)); });
  panel.addEventListener('popupshown', () => { input.focus(); input.select(); });
  panel.refresh = refresh;
  return panel;
}

export function openPalette(win, text = '') {
  const doc = win.document;
  const panel = doc.getElementById('kitsune-palette') ?? build(win);
  if (panel.state === 'open') { panel.hidePopup(); return; }
  panel.querySelector('input').value = text;
  void panel.refresh();
  // Arriba, centrada sobre la zona de las webs.
  const area = win.gBrowser.tabbox.getBoundingClientRect();
  const width = Math.min(640, Math.round(area.width * 0.9));
  panel.querySelector('.kitsune-palette-box').style.width = `${width}px`;
  panel.openPopupAtScreen(Math.round(win.mozInnerScreenX + area.x + (area.width - width) / 2), Math.round(win.mozInnerScreenY + area.y + 48), false);
}

export const KitsunePalette = {
  async decorate(win) {
    if (!win.gBrowser || !win.gBrowserInit?.delayedStartupFinished) await win.delayedStartupPromise;
    if (decorated.has(win) || !win.toolbar?.visible) return;
    decorated.add(win);
    const doc = win.document;
    // Ctrl+K era buscar en la web: ahora abre la paleta (y la búsqueda en la web está dentro).
    doc.getElementById('key_search')?.setAttribute('disabled', 'true');
    const keyset = doc.createXULElement('keyset');
    keyset.id = 'kitsune-palette-keys';
    const key = doc.createXULElement('key');
    for (const [name, value] of Object.entries({ id: 'kitsune-palette-key', key: 'K', modifiers: 'accel' })) key.setAttribute(name, value);
    key.addEventListener('command', () => openPalette(win));
    keyset.append(key);
    doc.documentElement.append(keyset);
  },
  open: (win, text) => openPalette(win, text),
};
