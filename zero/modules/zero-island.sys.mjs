/* Kitsune Zero · la isla: la barra de navegación de Gecko (#nav-bar), reestilada, no rehecha.
 *
 * Se conservan la barra de direcciones, sus sugerencias y los botones; Zero solo cambia su forma.
 * En reposo, 176 × 32 y solo el dominio (#zero-host). Con el ratón encima (o un menú suyo abierto),
 * 400 px con atrás, adelante y recargar. Escribiendo, 560 px. Con un aviso, 470 px un momento. La
 * altura no cambia nunca: la isla vive en su franja y no pisa la web.
 * Estado en el atributo zero-island del #navigator-toolbox: "" (reposo), "open" o "typing".
 */
import { prefName, PREFS } from './zero-config.sys.mjs';
import { userOf, paintUser } from './zero-who.sys.mjs';

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
  st.bar = el(doc, 'span', { id: 'zero-island-progress', 'aria-hidden': 'true' });
  st.activities = new Map();
  navbar.append(st.host, st.msg, st.bar);
  st.cleanups.push(() => { st.host.remove(); st.msg.remove(); st.bar.remove(); });
  // Un aviso o una actividad que se pueden pulsar (abrir lo descargado).
  st.msg.addEventListener('click', () => { const action = st.action; if (action) { try { action(); } catch { /* ya no está */ } } });
  const icon = el(doc, 'img', { class: 'zero-host-icon', alt: '' });
  icon.addEventListener('error', () => { if (icon.getAttribute('src') !== NO_ICON) icon.setAttribute('src', NO_ICON); });
  const lock = el(doc, 'span', { class: 'zero-lock' });
  const text = el(doc, 'span', { class: 'zero-host-text' });
  // De qué usuario es la web: un punto de su color que, con la isla abierta, dice su nombre.
  const user = el(doc, 'span', { class: 'zero-user' });
  st.host.append(icon, user, lock, text);
  const update = () => {
    const { text: value, secure } = label(win);
    text.textContent = value;
    st.host.toggleAttribute('secure', secure);
    const who = userOf(win, win.gBrowser.selectedTab);
    st.host.toggleAttribute('user', !!who);
    paintUser(user, who);
    if (user.textContent !== (who?.name ?? '')) user.textContent = who?.name ?? '';
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

  // El tamaño de la web: en Zero no se ve su indicador, así que la isla lo dice un momento al cambiarlo
  // (no al llegar a una web que ya tenía el suyo guardado: ahí cambia la dirección).
  const zoomOf = browser => { try { return Math.round(win.ZoomManager.getZoomForBrowser(browser) * 100); } catch { return null; } };
  const where = browser => { try { return browser.currentURI.spec; } catch { return ''; } };
  st.zoom = { spec: where(win.gBrowser.selectedBrowser), value: zoomOf(win.gBrowser.selectedBrowser) };
  listen(win, 'FullZoomChange', event => {
    const browser = event.target;
    if (browser !== win.gBrowser.selectedBrowser) return;
    const value = zoomOf(browser), spec = where(browser);
    if (value !== null && spec === st.zoom.spec && value !== st.zoom.value) {
      const t = ctx.host?.t ?? (es => es);
      alert(win, t('Tamaño', 'Zoom'), `${value} %`, 1600, 'zoom');
    }
    st.zoom = { spec, value };
  });
  listen(win.gBrowser.tabContainer, 'TabSelect', () => { st.zoom = { spec: where(win.gBrowser.selectedBrowser), value: zoomOf(win.gBrowser.selectedBrowser) }; });

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
  download: 'chrome://browser/skin/downloads/downloads.svg',
  zoom: 'chrome://global/skin/icons/search-glass.svg',
  done: 'chrome://global/skin/icons/check.svg',
};

/** Pinta un mensaje en la isla (aviso o actividad): icono, texto, detalle, barra y clic. */
function show(win, st, { text, detail = '', icon = null, progress = null, action = null }) {
  const doc = win.document;
  const mark = ICONS[icon] ? [el(doc, 'span', { class: 'zero-alert-icon', 'aria-hidden': 'true', style: `--zero-icon: url("${ICONS[icon]}")` })] : [];
  st.msg.replaceChildren(...mark, el(doc, 'b', {}, [text]), ...(detail ? [el(doc, 'small', {}, [` · ${detail}`])] : []));
  st.msg.toggleAttribute('action', !!action);
  st.action = action;
  st.bar.toggleAttribute('on', progress !== null);
  if (progress !== null) st.bar.style.setProperty('--zero-progress', String(Math.min(1, Math.max(0, progress))));
  doc.getElementById('navigator-toolbox').setAttribute('zero-island-alert', '');
}

/** Cuando acaba un aviso: si hay una actividad (una descarga), vuelve a ella; si no, la isla descansa. */
function rest(win, st) {
  const latest = [...st.activities.values()].at(-1);
  if (latest) { show(win, st, latest); return; }
  st.msg.removeAttribute('action');
  st.action = null;
  st.bar.removeAttribute('on');
  win.document.getElementById('navigator-toolbox')?.removeAttribute('zero-island-alert');
}

/** Un aviso en la isla (lo usan el pomodoro y el silencio): se ensancha, lo dice y vuelve. Con
 *  `icon` (break, resume, blocked, scroll, quiet, download, done), un icono pequeño delante; con
 *  `action`, se puede pulsar. */
export function alert(win, text, detail = '', ms = 3200, icon = null, { action = null } = {}) {
  const st = state.get(win);
  if (!st) return;
  show(win, st, { text, detail, icon, action });
  win.clearTimeout(st.alertTimer);
  st.alerting = true;
  st.alertTimer = win.setTimeout(() => { st.alerting = false; rest(win, st); }, ms);
}

/** Una actividad en directo (como en la Dynamic Island): se queda mientras dure, con su barra de
 *  progreso (0 a 1, o null sin barra). Un aviso la tapa un momento y luego vuelve. */
export function activity(win, key, data) {
  const st = state.get(win);
  if (!st) return;
  st.activities.delete(key);
  st.activities.set(key, data);
  if (!st.alerting) show(win, st, data);
}

export function endActivity(win, key) {
  const st = state.get(win);
  if (!st || !st.activities.delete(key)) return;
  if (!st.alerting) rest(win, st);
}
