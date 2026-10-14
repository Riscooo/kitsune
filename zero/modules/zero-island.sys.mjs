/* Kitsune Zero · la isla: la barra de navegación de Gecko (#nav-bar), reestilada, no rehecha.
 *
 * Se conservan la barra de direcciones, sus sugerencias y los botones; Zero solo cambia su forma.
 * En reposo, 176 × 32 y solo el dominio (#zero-host). Con el ratón encima (o un menú suyo abierto),
 * 400 px con atrás, adelante y recargar. Escribiendo, 560 px. Con un aviso, 470 px un momento. La
 * altura no cambia nunca: la isla vive en su franja y no pisa la web.
 * Estado en el atributo zero-island del #navigator-toolbox: "" (reposo), "open" o "typing".
 */
import { prefName, PREFS } from './zero-config.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const NO_ICON = 'chrome://global/skin/icons/defaultFavicon.svg';
const state = new WeakMap(); // ventana → { cleanups, … }

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};

/** Lo que dice la isla en reposo: el dominio de la web, o el título si no es una web (el inicio, about:…). */
function label(win) {
  const browser = win.gBrowser.selectedBrowser;
  try {
    const uri = browser.currentURI;
    if (/^https?$/.test(uri.scheme) && uri.host) return { text: uri.host.replace(/^www\./, ''), secure: uri.scheme === 'https' };
  } catch { /* sin dirección */ }
  return { text: win.gBrowser.selectedTab.label || '', secure: false };
}

export function attach(win, ctx = {}) {
  const doc = win.document;
  const toolbox = doc.getElementById('navigator-toolbox');
  const navbar = doc.getElementById('nav-bar');
  if (!toolbox || !navbar) return;
  const st = { cleanups: [] };
  state.set(win, st);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };

  st.host = el(doc, 'span', { id: 'zero-host' });
  st.msg = el(doc, 'span', { id: 'zero-island-msg' });
  navbar.append(st.host, st.msg);
  st.cleanups.push(() => { st.host.remove(); st.msg.remove(); });
  const icon = el(doc, 'img', { class: 'zero-host-icon', alt: '' });
  icon.addEventListener('error', () => { if (icon.getAttribute('src') !== NO_ICON) icon.setAttribute('src', NO_ICON); });
  const lock = el(doc, 'span', { class: 'zero-lock' });
  const text = el(doc, 'span', { class: 'zero-host-text' });
  st.host.append(icon, lock, text);
  const update = () => {
    const { text: value, secure } = label(win);
    text.textContent = value;
    st.host.toggleAttribute('secure', secure);
    let src = null;
    try { src = win.gBrowser.getIcon(win.gBrowser.selectedTab); } catch { /* sin icono */ }
    if (icon.getAttribute('src') !== (src || NO_ICON)) icon.setAttribute('src', src || NO_ICON);
  };
  update();
  listen(win.gBrowser.tabContainer, 'TabSelect', update);
  listen(win.gBrowser.tabContainer, 'TabAttrModified', update);
  const progress = { onLocationChange: () => update() };
  win.gBrowser.addProgressListener(progress);
  st.cleanups.push(() => win.gBrowser.removeProgressListener(progress));

  // El estado: «typing» con el foco en la barra de direcciones; «open» con el ratón encima o con
  // un menú suyo abierto (el de Kitsune, el historial de atrás…), para que no se encoja bajo el menú.
  const input = win.gURLBar?.inputField;
  st.hover = false;
  st.menus = new Set();
  const refresh = () => {
    const value = input && doc.activeElement === input ? 'typing' : st.hover || st.menus.size ? 'open' : '';
    if (value) toolbox.setAttribute('zero-island', value); else toolbox.removeAttribute('zero-island');
  };
  if (input) {
    listen(input, 'focus', refresh);
    listen(input, 'blur', refresh);
  }
  listen(navbar, 'mouseenter', () => { st.hover = true; refresh(); });
  listen(navbar, 'mouseleave', () => { st.hover = false; refresh(); });
  const fromIsland = popup => {
    const anchor = popup.anchorNode ?? popup.triggerNode;
    return !!anchor && navbar.contains(anchor);
  };
  listen(doc, 'popupshowing', event => { if (fromIsland(event.target)) { st.menus.add(event.target); refresh(); } });
  listen(doc, 'popuphidden', event => { if (st.menus.delete(event.target)) refresh(); });
  refresh();

  // Solo iconos (ajuste de Zero): en reposo, el icono de la web; abierta, los botones sin el dominio.
  const { host } = ctx;
  if (host?.prefs) {
    const name = prefName(host.prefix, PREFS.islandIcons);
    const apply = () => { let on = false; try { on = host.prefs.getBoolPref(name, false); } catch { /* de serie */ } toolbox.toggleAttribute('zero-icons', on); };
    const observer = { observe: apply };
    host.prefs.addObserver(name, observer);
    st.cleanups.push(() => host.prefs.removeObserver(name, observer));
    apply();
  }
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  win.clearTimeout(st.alertTimer);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
  const toolbox = win.document.getElementById('navigator-toolbox');
  toolbox?.removeAttribute('zero-island');
  toolbox?.removeAttribute('zero-island-alert');
  toolbox?.removeAttribute('zero-icons');
}

// Los iconos de los avisos (los de Zero y algunos de Gecko): pequeños y del color del texto.
const ICONS = {
  break: 'chrome://browser/content/zero/zero-icono-hoja.svg',
  resume: 'chrome://browser/content/zero/zero-icono-seguir.svg',
  blocked: 'chrome://global/skin/icons/blocked.svg',
  scroll: 'chrome://global/skin/icons/arrow-down.svg',
  quiet: 'chrome://browser/skin/notification-icons/desktop-notification-blocked.svg',
};

/** Un aviso en la isla (lo usan el pomodoro y el silencio): se ensancha, lo dice y vuelve. Con
 *  `icon` (break, resume, blocked, scroll, quiet), un icono pequeño delante. */
export function alert(win, text, detail = '', ms = 3200, icon = null) {
  const st = state.get(win);
  if (!st) return;
  const doc = win.document;
  const mark = ICONS[icon] ? [el(doc, 'span', { class: 'zero-alert-icon', 'aria-hidden': 'true', style: `--zero-icon: url("${ICONS[icon]}")` })] : [];
  st.msg.replaceChildren(...mark, el(doc, 'b', {}, [text]), ...(detail ? [el(doc, 'small', {}, [` · ${detail}`])] : []));
  const toolbox = doc.getElementById('navigator-toolbox');
  toolbox.setAttribute('zero-island-alert', '');
  win.clearTimeout(st.alertTimer);
  st.alertTimer = win.setTimeout(() => toolbox.removeAttribute('zero-island-alert'), ms);
}
