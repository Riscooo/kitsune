/* Distribución de la ventana de Kitsune: vista dividida y modo compacto.
 *
 * - Vista dividida: la de Gecko, pero hasta con cuatro webs (Gecko solo usa dos). Ctrl+Alt+D
 *   divide la pestaña en la que estás (la otra mitad deja elegir pestaña) y, si ya está
 *   dividida, le añade otro panel; con varias pestañas seleccionadas (Ctrl+clic), las junta.
 *   Ctrl+Alt+Mayús+D la separa. Tres webs van en columnas y cuatro en una cuadrícula de 2×2
 *   (kitsune-layout.css, con el número de paneles en [kitsune-split]).
 * - Modo compacto: solo se ve la web. Las barras (y la barra lateral, con las pestañas a un
 *   lado) se esconden y salen al acercar el ratón al borde, al enfocar la barra de
 *   direcciones (Ctrl+L) o mientras haya un menú suyo abierto. Ctrl+Alt+C lo activa y lo
 *   quita, también desde el menú de las barras. Se recuerda al reiniciar.
 * Solo atributos y estilos de la ventana: nada toca las webs.
 */
// Textos en el idioma de Kitsune (kitsune-i18n.sys.mjs); sin Gecko (pruebas de Node), en castellano.
const t = (spanish, english) => {
  try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-i18n.sys.mjs').t(spanish, english); } catch { return spanish; }
};
export const COMPACT_PREF = 'kitsune.compact.enabled';
const windows = new Set();
let observing = false;

const xul = (doc, tag, attributes = {}) => {
  const node = doc.createXULElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
};

export const MAX_SPLIT = 4;

/** Qué hace Ctrl+Alt+D: juntar las seleccionadas, dividir, añadir un panel o nada (ya hay cuatro). */
export function splitAction({ splitCount = 0, selected = 1 } = {}) {
  if (splitCount) return splitCount < MAX_SPLIT ? 'add' : 'full';
  return selected >= 2 ? 'join' : 'split';
}

/** Ctrl+Alt+D: divide la pestaña; si ya está dividida, le añade un panel para elegir pestaña. */
export function toggleSplit(win) {
  const gBrowser = win.gBrowser;
  const tab = gBrowser?.selectedTab;
  if (!tab || tab.pinned || tab.hidden) return;
  const chosen = gBrowser.selectedTabs.filter(item => !item.pinned && !item.splitview);
  const action = splitAction({ splitCount: tab.splitview?.tabs.length ?? 0, selected: chosen.length });
  if (action === 'join') {
    gBrowser.addTabSplitView(chosen.slice(0, MAX_SPLIT), { insertBefore: chosen[0], trigger: 'keyboard_shortcut' });
  } else if (action === 'split') {
    win.BrowserCommands?.addTabSplitView();
  } else if (action === 'add') {
    const fresh = gBrowser.addTrustedTab('about:opentabs');
    tab.splitview.addTabs([fresh]);
    gBrowser.selectedTab = fresh;
  }
  markSplit(win);
}

/** Ctrl+Alt+Mayús+D: separa la vista dividida en la que estás. */
export function unsplit(win) {
  win.gBrowser?.selectedTab?.splitview?.unsplitTabs('keyboard_shortcut');
  markSplit(win);
}

/** El número de paneles, para el CSS: en la web que se ve (3 en columnas, 4 en 2×2) y en cada
 * grupo de la barra de pestañas (con sitio para todas sus pestañas). */
function markSplit(win) {
  const mark = (node, count) => count > 2 ? node?.setAttribute('kitsune-split', String(count)) : node?.removeAttribute('kitsune-split');
  mark(win.document.getElementById('tabbrowser-tabpanels'), win.gBrowser?.selectedTab?.splitview?.tabs.length ?? 0);
  for (const wrapper of win.gBrowser?.tabContainer?.querySelectorAll('tab-split-view-wrapper') ?? []) mark(wrapper, wrapper.tabs?.length ?? 0);
}

export const compactEnabled = () => Services.prefs.getBoolPref(COMPACT_PREF, false);
export function setCompact(enabled) {
  if (enabled) Services.prefs.setBoolPref(COMPACT_PREF, true);
  else if (Services.prefs.prefHasUserValue(COMPACT_PREF)) Services.prefs.clearUserPref(COMPACT_PREF);
}

function applyCompact(win) {
  const root = win.document.documentElement;
  root.toggleAttribute('kitsune-compact', compactEnabled());
  if (!compactEnabled()) root.removeAttribute('kitsune-compact-reveal');
  const item = win.document.getElementById('kitsune-compact-menuitem');
  if (item) item.setAttribute('checked', String(compactEnabled()));
}

const prefObserver = { observe() { for (const win of windows) applyCompact(win); } };

function decorateCompact(win) {
  const doc = win.document;
  const root = doc.documentElement;
  const toolbox = doc.getElementById('navigator-toolbox');
  // La altura de las barras, para que la web ocupe su sitio mientras están escondidas.
  if (toolbox) {
    const measure = () => root.style.setProperty('--kitsune-toolbox-height', `${toolbox.getBoundingClientRect().height}px`);
    new win.ResizeObserver(measure).observe(toolbox);
    measure();
    // Mientras haya un menú o panel abierto desde las barras, se quedan a la vista.
    let open = 0;
    toolbox.addEventListener('popupshown', event => { if (event.target.localName !== 'tooltip') { open++; root.setAttribute('kitsune-compact-reveal', 'true'); } });
    toolbox.addEventListener('popuphidden', event => {
      if (event.target.localName === 'tooltip') return;
      open = Math.max(0, open - 1);
      if (!open) root.removeAttribute('kitsune-compact-reveal');
    });
  }
  // En el menú de las barras (clic derecho), junto a los demás ajustes de la ventana.
  const menu = doc.getElementById('toolbar-context-menu');
  if (menu) {
    const item = xul(doc, 'menuitem', { id: 'kitsune-compact-menuitem', type: 'checkbox', label: t('Modo compacto', 'Compact mode'), acceltext: 'Ctrl+Alt+C' });
    item.addEventListener('command', () => setCompact(!compactEnabled()));
    menu.append(item);
  }
  applyCompact(win);
}

function decorateKeys(win) {
  const doc = win.document;
  const keyset = xul(doc, 'keyset', { id: 'kitsune-layout-keys' });
  const add = (id, key, run, modifiers = 'accel,alt') => {
    const node = xul(doc, 'key', { id, key, modifiers });
    node.addEventListener('command', run);
    keyset.append(node);
  };
  add('kitsune-split-key', 'D', () => toggleSplit(win));
  add('kitsune-unsplit-key', 'D', () => unsplit(win), 'accel,alt,shift');
  add('kitsune-compact-key', 'C', () => setCompact(!compactEnabled()));
  doc.documentElement.append(keyset);
}

export const KitsuneLayout = {
  async decorate(win) {
    if (!win.gBrowser || !win.gBrowserInit?.delayedStartupFinished) await win.delayedStartupPromise;
    if (windows.has(win) || !win.gBrowser || !win.toolbar?.visible) return;
    windows.add(win);
    win.addEventListener('unload', () => windows.delete(win), { once: true });
    if (!observing) { Services.prefs.addObserver(COMPACT_PREF, prefObserver); observing = true; }
    decorateKeys(win);
    decorateCompact(win);
    // Al cambiar de pestaña o al cambiar los paneles (soltar una pestaña, cerrar uno…), se recoloca.
    const remark = () => markSplit(win);
    for (const type of ['TabSelect', 'SplitViewCreated', 'TabSplitViewActivate', 'TabSplitViewDeactivate', 'TabClose']) {
      win.gBrowser.tabContainer.addEventListener(type, () => win.setTimeout(remark, 0));
    }
  },
  toggleSplit: win => toggleSplit(win),
  unsplit: win => unsplit(win),
  compactEnabled: () => compactEnabled(),
  setCompact: enabled => setCompact(enabled),
};
