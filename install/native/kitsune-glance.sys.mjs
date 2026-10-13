/* Vista rápida de enlaces (como el Glance de Zen): Alt+clic en un enlace lo abre en una
 * ventana flotante sobre la página, con el usuario (contenedor) de la pestaña y el permiso
 * de la página que lo pidió. Esc, un clic fuera o «Cerrar» la quitan; «Abrir en pestaña» y
 * «Dividir» la convierten en pestaña (sola o junto a la actual). No es una pestaña, así que
 * no cuenta para el modo ahorro. En ventanas privadas se abre en una pestaña normal.
 */
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

function buildPanel(win) {
  const doc = win.document;
  let panel = doc.getElementById('kitsune-glance');
  if (panel) return panel;
  panel = doc.createXULElement('panel');
  for (const [name, value] of Object.entries({ id: 'kitsune-glance', class: 'kitsune-glance', noautofocus: 'true', consumeoutsideclicks: 'true' })) panel.setAttribute(name, value);
  const header = el(doc, 'div', { class: 'kitsune-glance-head' }, [
    el(doc, 'span', { class: 'kitsune-glance-title' }),
    el(doc, 'span', { class: 'kitsune-glance-host' }),
    el(doc, 'button', { type: 'button', class: 'kitsune-glance-split', title: 'Abrirla junto a la pestaña actual' }, ['Dividir']),
    el(doc, 'button', { type: 'button', class: 'kitsune-glance-tab', title: 'Abrirla en una pestaña' }, ['Abrir en pestaña']),
    el(doc, 'button', { type: 'button', class: 'kitsune-glance-close', title: 'Cerrar (Esc)', 'aria-label': 'Cerrar' }, ['×']),
  ]);
  const body = doc.createXULElement('vbox');
  body.className = 'kitsune-glance-body';
  body.append(header);
  panel.append(body);
  header.querySelector('.kitsune-glance-close').addEventListener('click', () => panel.hidePopup());
  header.querySelector('.kitsune-glance-tab').addEventListener('click', () => promote(win, false));
  header.querySelector('.kitsune-glance-split').addEventListener('click', () => promote(win, true));
  panel.addEventListener('popuphidden', event => {
    if (event.target !== panel) return;
    win.clearInterval(panel.timer);
    doc.documentElement.removeAttribute('kitsune-glance');
    panel.querySelector('browser')?.remove();
  });
  doc.getElementById('mainPopupSet').append(panel);
  return panel;
}

/** La vista rápida pasa a pestaña (la carga de nuevo en ella) y, si se pide, junto a la actual. */
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

export function openGlance(win, url, { principal = null, userContextId = 0 } = {}) {
  const triggeringPrincipal = principal?.isContentPrincipal ? principal : Services.scriptSecurityManager.createNullPrincipal({ userContextId });
  if (win.PrivateBrowsingUtils?.isWindowPrivate(win)) {
    win.gBrowser.addTab(url, { triggeringPrincipal, relatedToCurrent: true });
    return null;
  }
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
  const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
  panel.querySelector('.kitsune-glance-title').textContent = host;
  panel.querySelector('.kitsune-glance-host').textContent = '';
  doc.documentElement.setAttribute('kitsune-glance', 'true');
  panel.openPopupAtScreen(Math.round(win.mozInnerScreenX + area.x + (area.width - width) / 2), Math.round(win.mozInnerScreenY + area.y + (area.height - height) / 2), false);
  browser.loadURI(Services.io.newURI(url), { triggeringPrincipal });
  // El título y la web de lo que se está viendo (puede navegar dentro de la vista).
  win.clearInterval(panel.timer);
  panel.timer = win.setInterval(() => {
    const spec = browser.currentURI?.spec;
    if (!spec || spec === 'about:blank') return;
    let shown = '';
    try { shown = new URL(spec).host; } catch { /* sin host */ }
    panel.querySelector('.kitsune-glance-title').textContent = browser.contentTitle || shown;
    panel.querySelector('.kitsune-glance-host').textContent = browser.contentTitle ? shown : '';
  }, 400);
  return browser;
}

export const KitsuneGlance = {
  start() { try { registerGlance(); } catch { /* sin vista rápida */ } },
  open: (win, url, options) => openGlance(win, url, options),
};
