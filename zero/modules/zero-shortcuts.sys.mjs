/* Kitsune Zero · los accesos directos: la pastilla de abajo de la columna de la izquierda.
 *
 * Decisión de Risco (15-10): «abajo, entre las pestañas y el logo de Kitsune/ajustes, otra píldora para
 * meter los accesos directos que queramos». Los iconos de las webs guardadas del perfil en el que se está;
 * el «+» guarda la página en la que se está (también se puede soltar encima un enlace o una pestaña); al
 * pulsar uno lleva a esa web (a su pestaña si está abierta, si no en una nueva); el clic derecho lo quita.
 * Cada perfil (espacio) tiene los suyos. Va en Windows, macOS y Linux.
 *
 * - kitsune.zero.shortcuts: { perfil: [{ url, title, icon }] }.
 */
import { prefName } from './zero-config.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const PREF = 'shortcuts';
const MAX = 12;
const state = new WeakMap();

const el = (doc, tag, attrs = {}, kids = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
};
const initialOf = name => ([...String(name ?? '').replace(/^www\./, '').trim()][0] ?? '·').toLocaleUpperCase();

function readAll(host) {
  try { const value = JSON.parse(host.prefs.getStringPref(prefName(host.prefix, PREF), '')); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
}
function writeAll(host, value) {
  try { host.prefs.setStringPref(prefName(host.prefix, PREF), JSON.stringify(value)); } catch { /* sin ajustes */ }
}
function profileOf(win, host) {
  try { return host.spaces?.current(win) ?? 'base'; } catch { return 'base'; }
}
const listOf = (win, host) => readAll(host)[profileOf(win, host)] ?? [];

/** Las webs que se pueden guardar: http(s) y poco más (nada de páginas internas). */
function usable(url) {
  try { return /^https?:$/.test(new URL(url).protocol); } catch { return false; }
}

function addShortcut(win, st, { url, title, icon }) {
  if (!usable(url)) return;
  const all = readAll(st.host), id = profileOf(win, st.host);
  const items = (all[id] ?? []).filter(item => item.url !== url);
  items.push({ url, title: title || new URL(url).hostname, icon: icon || null });
  all[id] = items.slice(-MAX);
  writeAll(st.host, all);
}

function removeShortcut(win, st, url) {
  const all = readAll(st.host), id = profileOf(win, st.host);
  all[id] = (all[id] ?? []).filter(item => item.url !== url);
  writeAll(st.host, all);
}

/** A esa web: a su pestaña si está abierta (en este perfil), si no en una nueva. */
function go(win, url) {
  const gb = win.gBrowser;
  const open = gb.visibleTabs.find(tab => !tab.closing && tab.linkedBrowser?.currentURI?.spec === url);
  if (open) { gb.selectedTab = open; return; }
  if (win.openTrustedLinkIn) win.openTrustedLinkIn(url, 'tab');
  else gb.selectedTab = gb.addTab(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
}

function render(win, st) {
  const doc = win.document;
  const items = listOf(win, st.host);
  const nodes = items.map(item => {
    let node = [...st.list.children].find(n => n.dataset.url === item.url);
    if (!node) node = el(doc, 'button', { type: 'button', class: 'zero-shortcut', 'data-url': item.url }, [el(doc, 'span', { class: 'zero-fav', 'aria-hidden': 'true' })]);
    node.setAttribute('aria-label', item.title);
    node.title = item.title;
    const fav = node.querySelector('.zero-fav');
    if (item.icon && fav.dataset.broken !== item.icon) {
      if (fav.querySelector('img')?.getAttribute('src') !== item.icon) {
        const img = el(doc, 'img', { src: item.icon, alt: '' });
        img.addEventListener('error', () => { fav.dataset.broken = item.icon; fav.replaceChildren(initialOf(new URL(item.url).hostname)); });
        fav.replaceChildren(img);
      }
    } else if (!fav.querySelector('img') && fav.textContent !== initialOf(new URL(item.url).hostname)) {
      fav.replaceChildren(initialOf(new URL(item.url).hostname));
    }
    return node;
  });
  const now = [...st.list.children];
  if (now.length !== nodes.length || now.some((node, i) => node !== nodes[i])) st.list.replaceChildren(...nodes);
}

export function attach(win, ctx) {
  const doc = win.document, { host } = ctx;
  const dock = doc.getElementById('zero-dock');
  if (!dock) return;
  const t = host.t ?? (es => es);
  const st = { host, cleanups: [] };
  state.set(win, st);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };

  st.list = el(doc, 'div', { class: 'zero-shortcut-list', role: 'list' });
  st.add = el(doc, 'button', { type: 'button', class: 'zero-shortcut-add', 'aria-label': t('Guardar esta web', 'Save this site'), title: t('Guardar esta web', 'Save this site') },
    [el(doc, 'span', { class: 'zero-fav', 'aria-hidden': 'true' }, ['+'])]);
  st.pill = el(doc, 'div', { id: 'zero-shortcuts', class: 'zero-pill', role: 'group', 'aria-label': t('Accesos directos', 'Shortcuts') }, [st.list, st.add]);
  dock.append(st.pill);
  st.cleanups.push(() => st.pill.remove());

  st.add.addEventListener('click', () => {
    const gb = win.gBrowser, tab = gb.selectedTab;
    let icon = null;
    try { icon = gb.getIcon?.(tab) ?? tab.getAttribute('image'); } catch { /* sin icono */ }
    addShortcut(win, st, { url: gb.selectedBrowser.currentURI?.spec ?? '', title: tab.label, icon });
  });
  st.list.addEventListener('click', event => {
    const node = event.target.closest('.zero-shortcut');
    if (node) go(win, node.dataset.url);
  });
  st.list.addEventListener('contextmenu', event => {
    const node = event.target.closest('.zero-shortcut');
    if (!node) return;
    event.preventDefault();
    removeShortcut(win, st, node.dataset.url);
  });
  // Soltar encima un enlace o una pestaña lo guarda.
  const linkOf = transfer => {
    const uri = transfer?.getData('text/x-moz-url')?.split('\n')[0] || transfer?.getData('text/uri-list')?.split('\n').find(line => line && !line.startsWith('#'));
    return uri?.trim() || null;
  };
  st.pill.addEventListener('dragover', event => {
    const types = [...(event.dataTransfer?.types ?? [])];
    if (types.includes('text/x-moz-url') || types.includes('text/uri-list') || types.includes('application/x-moz-tabbrowser-tab')) { event.preventDefault(); st.pill.setAttribute('dropping', ''); }
  });
  st.pill.addEventListener('dragleave', () => st.pill.removeAttribute('dropping'));
  st.pill.addEventListener('drop', event => {
    st.pill.removeAttribute('dropping');
    const tab = event.dataTransfer?.mozGetDataAt?.('application/x-moz-tabbrowser-tab', 0);
    const url = tab?.linkedBrowser?.currentURI?.spec ?? linkOf(event.dataTransfer);
    if (!url) return;
    event.preventDefault();
    addShortcut(win, st, { url, title: tab?.label ?? null, icon: tab ? (win.gBrowser.getIcon?.(tab) ?? null) : null });
  });

  try { const undo = host.spaces?.watch(win, () => render(win, st)); if (undo) st.cleanups.push(undo); } catch { /* sin espacios */ }
  listen(win.gBrowser.tabContainer, 'TabSelect', () => render(win, st));
  const prefs = { observe: () => render(win, st) };
  host.prefs.addObserver(prefName(host.prefix, PREF), prefs);
  st.cleanups.push(() => host.prefs.removeObserver(prefName(host.prefix, PREF), prefs));
  render(win, st);
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}
