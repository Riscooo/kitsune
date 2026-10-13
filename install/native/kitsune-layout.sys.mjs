/* Distribución de la ventana de Kitsune: vista dividida y modo compacto.
 *
 * - Vista dividida: la de Gecko 157 (dos webs a la vez, con el divisor para cambiar el
 *   tamaño). Kitsune le pone atajo: Ctrl+Alt+D divide la pestaña en la que estás (la otra
 *   mitad deja elegir pestaña) y, si ya está dividida, la separa. Alt+clic en una pestaña
 *   la divide con la actual (eso ya lo hace Gecko).
 * - Modo compacto: solo se ve la web. Las barras (y la barra lateral, con las pestañas a un
 *   lado) se esconden y salen al acercar el ratón al borde, al enfocar la barra de
 *   direcciones (Ctrl+L) o mientras haya un menú suyo abierto. Ctrl+Alt+C lo activa y lo
 *   quita, también desde el menú de las barras. Se recuerda al reiniciar.
 * Solo atributos y estilos de la ventana: nada toca las webs.
 */
export const COMPACT_PREF = 'kitsune.compact.enabled';
const windows = new Set();
let observing = false;

const xul = (doc, tag, attributes = {}) => {
  const node = doc.createXULElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
};

/** Divide la pestaña en la que estás o, si ya está dividida, la separa. */
export function toggleSplit(win) {
  const tab = win.gBrowser?.selectedTab;
  if (!tab) return;
  if (tab.splitview) tab.splitview.unsplitTabs('keyboard_shortcut');
  else win.BrowserCommands?.addTabSplitView();
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
    const item = xul(doc, 'menuitem', { id: 'kitsune-compact-menuitem', type: 'checkbox', label: 'Modo compacto', acceltext: 'Ctrl+Alt+C' });
    item.addEventListener('command', () => setCompact(!compactEnabled()));
    menu.append(item);
  }
  applyCompact(win);
}

function decorateKeys(win) {
  const doc = win.document;
  const keyset = xul(doc, 'keyset', { id: 'kitsune-layout-keys' });
  const add = (id, key, run) => {
    const node = xul(doc, 'key', { id, key, modifiers: 'accel,alt' });
    node.addEventListener('command', run);
    keyset.append(node);
  };
  add('kitsune-split-key', 'D', () => toggleSplit(win));
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
  },
  toggleSplit: win => toggleSplit(win),
  compactEnabled: () => compactEnabled(),
  setCompact: enabled => setCompact(enabled),
};
