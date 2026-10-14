/* Vista rápida de enlaces (como el Glance de Zen): Alt+clic en un enlace lo abre flotando sobre
 * la página, con el usuario (contenedor) de la pestaña y el permiso de la página que lo pidió.
 * Es una pestaña de verdad, oculta en la barra y unida a la actual con la vista dividida de Gecko
 * (lo que deja pintar dos webs a la vez); kitsune-layout.css la hace flotar encima. Así «Abrir en
 * pestaña» la deja tal cual, sin volver a cargarla, y «Dividir» solo le quita lo de flotar.
 * Esc, un clic fuera o × la cierran. Si la pestaña actual no se puede dividir (fijada o ya
 * dividida), flota en un panel como antes y al pasarla a pestaña se carga de nuevo.
 * En ventanas privadas se abre en una pestaña normal.
 */
// Textos en el idioma de Kitsune (kitsune-i18n.sys.mjs); sin Gecko (pruebas de Node), en castellano.
const t = (spanish, english) => {
  try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-i18n.sys.mjs').t(spanish, english); } catch { return spanish; }
};
const HTML = 'http://www.w3.org/1999/xhtml';
let registered = false;

export class KitsuneGlanceParent extends JSWindowActorParent {
  receiveMessage({ name, data }) {
    if (name !== 'Glance:Open' || typeof data?.url !== 'string' || !/^https?:/.test(data.url)) return;
    const browser = this.browsingContext.top.embedderElement;
    const win = browser?.documentGlobal ?? browser?.ownerGlobal;
    if (!win?.gBrowser) return;
    // Del proceso de la web solo se cree la dirección (y se comprueba): el permiso de la página
    // que pide el enlace lo da el proceso principal, que es quien la conoce de verdad.
    openGlance(win, data.url, { principal: this.manager.documentPrincipal, userContextId: Number(browser.getAttribute('usercontextid')) || 0 });
  }
}

/** Registra el actor una vez por proceso (solo en las pestañas, no en paneles ni barras). */
export function registerGlance() {
  if (registered) return;
  registered = true;
  ChromeUtils.registerWindowActor('KitsuneGlance', {
    parent: { esModuleURI: 'chrome://browser/content/kitsune-glance.sys.mjs' },
    child: { esModuleURI: 'chrome://browser/content/kitsune-glance-child.sys.mjs', events: { click: { capture: true } } },
    allFrames: true,
    // Gecko 157 exige decirlo para las webs: el padre no se fía de nada que no compruebe.
    safeForUntrustedWebProcess: true,
    matches: ['http://*/*', 'https://*/*'],
    messageManagerGroups: ['browsers'],
  });
}

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};

/** La barra de arriba: título, web, «Dividir», «Abrir en pestaña» y ×. */
function buildHead(doc, { close, tab, split }) {
  const header = el(doc, 'div', { class: 'kitsune-glance-head' }, [
    el(doc, 'span', { class: 'kitsune-glance-title' }),
    el(doc, 'span', { class: 'kitsune-glance-host' }),
    el(doc, 'button', { type: 'button', class: 'kitsune-glance-split', title: t('Abrirla junto a la pestaña actual', 'Open it next to the current tab') }, [t('Dividir', 'Split')]),
    el(doc, 'button', { type: 'button', class: 'kitsune-glance-tab', title: t('Abrirla en una pestaña', 'Open it in a tab') }, [t('Abrir en pestaña', 'Open in tab')]),
    el(doc, 'button', { type: 'button', class: 'kitsune-glance-close', title: t('Cerrar (Esc)', 'Close (Esc)'), 'aria-label': t('Cerrar', 'Close') }, ['×']),
  ]);
  header.querySelector('.kitsune-glance-close').addEventListener('click', close);
  header.querySelector('.kitsune-glance-tab').addEventListener('click', tab);
  header.querySelector('.kitsune-glance-split').addEventListener('click', split);
  return header;
}

/** El título y la web de lo que se está viendo (puede navegar dentro de la vista). */
function showTitle(header, browser, url) {
  const spec = browser.currentURI?.spec;
  const host = text => { try { return new URL(text).host; } catch { return ''; } };
  if (!spec || spec === 'about:blank') {
    header.querySelector('.kitsune-glance-title').textContent = host(url);
    return;
  }
  header.querySelector('.kitsune-glance-title').textContent = browser.contentTitle || host(spec);
  header.querySelector('.kitsune-glance-host').textContent = browser.contentTitle ? host(spec) : '';
}

function buildPanel(win) {
  const doc = win.document;
  let panel = doc.getElementById('kitsune-glance');
  if (panel) return panel;
  panel = doc.createXULElement('panel');
  for (const [name, value] of Object.entries({ id: 'kitsune-glance', class: 'kitsune-glance', noautofocus: 'true', consumeoutsideclicks: 'true' })) panel.setAttribute(name, value);
  const header = buildHead(doc, { close: () => panel.hidePopup(), tab: () => promote(win, false), split: () => promote(win, true) });
  const body = doc.createXULElement('vbox');
  body.className = 'kitsune-glance-body';
  body.append(header);
  panel.append(body);
  panel.addEventListener('popuphidden', event => {
    if (event.target !== panel) return;
    win.clearInterval(panel.timer);
    doc.documentElement.removeAttribute('kitsune-glance');
    panel.querySelector('browser')?.remove();
  });
  doc.getElementById('mainPopupSet').append(panel);
  return panel;
}

/** La del panel pasa a pestaña (la carga de nuevo en ella) y, si se pide, junto a la actual. */
function promote(win, split) {
  const panel = win.document.getElementById('kitsune-glance');
  const browser = panel?.querySelector('browser');
  if (!browser) return;
  const url = browser.currentURI?.spec || panel.dataset.url;
  const principal = browser.contentPrincipal?.isContentPrincipal ? browser.contentPrincipal : panel.principal;
  const current = win.gBrowser.selectedTab;
  const tab = win.gBrowser.addTab(url, { triggeringPrincipal: principal, userContextId: Number(panel.dataset.userContextId) || 0, relatedToCurrent: true, inBackground: false });
  panel.hidePopup();
  if (split && !current.splitview && !current.pinned) win.gBrowser.addTabSplitView([current, tab], { insertBefore: current });
  win.gBrowser.selectedTab = tab;
}

/** Cómo se abre: «tab» (pestaña flotante), «panel» (como antes) o «plain» (pestaña normal). */
export function glanceMode({ isPrivate = false, canSplit = true, pinned = false, inSplit = false } = {}) {
  if (isPrivate) return 'plain';
  return canSplit && !pinned && !inSplit ? 'tab' : 'panel';
}

export function openGlance(win, url, { principal = null, userContextId = 0 } = {}) {
  const triggeringPrincipal = principal?.isContentPrincipal ? principal : Services.scriptSecurityManager.createNullPrincipal({ userContextId });
  const current = win.gBrowser.selectedTab;
  const mode = glanceMode({ isPrivate: !!win.PrivateBrowsingUtils?.isWindowPrivate(win), canSplit: typeof win.gBrowser.addTabSplitView === 'function',
    pinned: current.pinned, inSplit: !!current.splitview });
  if (mode === 'plain') {
    win.gBrowser.addTab(url, { triggeringPrincipal, relatedToCurrent: true });
    return null;
  }
  if (mode === 'tab') {
    const tab = openGlanceTab(win, url, { triggeringPrincipal, userContextId });
    if (tab) return tab.linkedBrowser;
  }
  return openGlancePanel(win, url, { triggeringPrincipal, userContextId });
}

// ---------- Como pestaña (la de siempre) ----------

const glances = new WeakMap(); // ventana → la vista rápida abierta en ella

function openGlanceTab(win, url, { triggeringPrincipal, userContextId }) {
  const { gBrowser, document: doc } = win;
  closeGlanceTab(win);
  const under = gBrowser.selectedTab;
  const tab = gBrowser.addTab(url, { triggeringPrincipal, userContextId, relatedToCurrent: true, inBackground: true, skipAnimation: true });
  tab.setAttribute('kitsune-glance', 'true');
  let split = null;
  try { split = gBrowser.addTabSplitView([under, tab], { insertBefore: under }); } catch { /* sin vista dividida */ }
  if (!split) {
    gBrowser.removeTab(tab, { animate: false, skipSessionStore: true });
    return null;
  }
  split.setAttribute('kitsune-glance', 'true');
  const panel = doc.getElementById(tab.linkedPanel);
  panel?.setAttribute('kitsune-glance-panel', 'true');
  gBrowser.tabpanels.setAttribute('kitsune-glance', 'true');
  const header = buildHead(doc, { close: () => closeGlanceTab(win), tab: () => promoteTab(win, false), split: () => promoteTab(win, true) });
  panel?.prepend(header);
  const state = { tab, under, split, panel, header };
  // Un clic fuera elige la pestaña de debajo (o cualquier otra): eso la cierra.
  state.onSelect = event => {
    if (event.target !== tab) win.setTimeout(() => glances.get(win) === state && closeGlanceTab(win, { select: false }), 0);
  };
  // Si se va la de debajo (Gecko deshace entonces la división) o se cierra ella, deja de ser vista rápida
  // y se queda como pestaña normal.
  state.onClose = event => { if (event.target === tab || event.target === under) forget(win); };
  state.onUnsplit = () => { if (!tab.splitview && glances.get(win) === state) promoteTab(win, false); };
  // Esc dentro de la vista rápida (la web o su barra), antes que la web: como con el panel de antes.
  state.onKey = event => {
    if (event.key !== 'Escape' || gBrowser.selectedTab !== tab || !(event.target === tab.linkedBrowser || header.contains(event.target))) return;
    event.preventDefault();
    event.stopPropagation();
    closeGlanceTab(win);
  };
  gBrowser.tabContainer.addEventListener('TabSelect', state.onSelect);
  gBrowser.tabContainer.addEventListener('TabClose', state.onClose);
  gBrowser.tabContainer.addEventListener('SplitViewRemoved', state.onUnsplit);
  win.addEventListener('keydown', state.onKey, true);
  glances.set(win, state);
  gBrowser.selectedTab = tab;
  showTitle(header, tab.linkedBrowser, url);
  state.timer = win.setInterval(() => showTitle(header, tab.linkedBrowser, url), 400);
  return tab;
}

/** Deja de ser vista rápida (sin tocar la pestaña): quita la barra, lo de flotar y las escuchas. */
function forget(win) {
  const state = glances.get(win);
  if (!state) return null;
  glances.delete(win);
  win.clearInterval(state.timer);
  win.gBrowser.tabContainer.removeEventListener('TabSelect', state.onSelect);
  win.gBrowser.tabContainer.removeEventListener('TabClose', state.onClose);
  win.gBrowser.tabContainer.removeEventListener('SplitViewRemoved', state.onUnsplit);
  win.removeEventListener('keydown', state.onKey, true);
  state.header.remove();
  state.panel?.removeAttribute('kitsune-glance-panel');
  state.tab.removeAttribute('kitsune-glance');
  state.split.removeAttribute('kitsune-glance');
  win.gBrowser.tabpanels.removeAttribute('kitsune-glance');
  return state;
}

/** Cierra la vista rápida: vuelve a la pestaña de debajo (si se pide) y quita la suya sin dejar rastro. */
function closeGlanceTab(win, { select = true } = {}) {
  const state = forget(win);
  if (!state) return;
  if (select && state.under.isConnected && !state.under.closing) win.gBrowser.selectedTab = state.under;
  if (state.tab.isConnected && !state.tab.closing) win.gBrowser.removeTab(state.tab, { animate: false, skipSessionStore: true });
}

/** La vista rápida pasa a pestaña tal cual (sin cargarla otra vez) y, si se pide, junto a la de debajo. */
function promoteTab(win, split) {
  const state = forget(win);
  if (!state) return;
  if (!split) state.tab.splitview?.unsplitTabs();
  win.gBrowser.selectedTab = state.tab;
}

// ---------- En un panel (si la pestaña no se puede dividir) ----------

function openGlancePanel(win, url, { triggeringPrincipal, userContextId }) {
  const doc = win.document;
  const panel = buildPanel(win);
  panel.querySelector('browser')?.remove();
  panel.dataset.url = url;
  panel.dataset.userContextId = String(userContextId);
  panel.principal = triggeringPrincipal;
  const browser = doc.createXULElement('browser');
  for (const [name, value] of Object.entries({ type: 'content', remote: 'true', maychangeremoteness: 'true', nodefaultsrc: 'true',
    messagemanagergroup: 'kitsune-glance', flex: '1', class: 'kitsune-glance-browser' })) browser.setAttribute(name, value);
  if (userContextId) browser.setAttribute('usercontextid', String(userContextId));
  panel.querySelector('.kitsune-glance-body').append(browser);
  // Encima del contenido, centrada: 82 % del ancho y 88 % del alto de la zona de las webs.
  const area = win.gBrowser.tabbox.getBoundingClientRect();
  const width = Math.round(area.width * 0.82), height = Math.round(area.height * 0.88);
  const body = panel.querySelector('.kitsune-glance-body');
  body.style.width = `${width}px`;
  body.style.height = `${height}px`;
  const header = panel.querySelector('.kitsune-glance-head');
  header.querySelector('.kitsune-glance-host').textContent = '';
  showTitle(header, browser, url);
  doc.documentElement.setAttribute('kitsune-glance', 'true');
  panel.openPopupAtScreen(Math.round(win.mozInnerScreenX + area.x + (area.width - width) / 2), Math.round(win.mozInnerScreenY + area.y + (area.height - height) / 2), false);
  browser.loadURI(Services.io.newURI(url), { triggeringPrincipal });
  win.clearInterval(panel.timer);
  panel.timer = win.setInterval(() => showTitle(header, browser, url), 400);
  return browser;
}

export const KitsuneGlance = {
  start() { try { registerGlance(); } catch { /* sin vista rápida */ } },
  open: (win, url, options) => openGlance(win, url, options),
};
