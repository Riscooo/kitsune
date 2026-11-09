/* Kitsune Zero · tus estadísticas: una pastilla de la columna (entre los accesos directos y los ajustes) que abre un
 * panel con dónde pasas el tiempo, cuántas búsquedas haces y en qué se te va (Risco, 9-11).
 *
 * Cómo se cuenta (uno para todas las ventanas):
 * - Tiempo: cada 5 s, a la web (su dominio) de la pestaña que se ve en la ventana con el foco, si la persona está
 *   ahí (ha tocado el teclado o el ratón en los últimos 2 min) o la pestaña suena (un vídeo, música). Las ventanas
 *   privadas no cuentan, ni las páginas internas.
 * - Búsquedas: cada página de resultados de un buscador instalado (Services.search.parseSubmissionURL). No se
 *   guarda qué se buscó.
 * - Webs: cada página nueva que se abre en una pestaña.
 * Se guarda en el perfil (kitsune-zero-estadisticas.json), solo en este ordenador; se puede apagar y borrar desde
 * el propio panel o desde los ajustes. Lo puro (sumar, resumir, categorías) está en zero-stats.mjs.
 */
import { setInterval, clearInterval } from 'resource://gre/modules/Timer.sys.mjs';
import { prefName } from './zero-config.sys.mjs';
import { dayKey, emptyData, sanitize, addTime, addSearch, addPage, prune, summarize, formatDuration, CATEGORIES } from './zero-stats.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const FILE = 'kitsune-zero-estadisticas.json';
const PREF = 'stats';          // contar o no (de serie, sí)
const SPAN_PREF = 'stats.span'; // lo último que se miró: 1, 7 o 30 días
const TICK = 5;                // segundos entre cuenta y cuenta
const IDLE = 120_000;          // sin tocar nada en 2 min, ya no se está mirando
const SAVE_EVERY = 60_000;
const state = new WeakMap();

// El contador, uno para todas las ventanas.
const tracker = { host: null, data: null, loading: null, timer: null, saveTimer: null, dirty: false, windows: new Set(), listeners: new Set(), lastSearch: '' };

const el = (doc, tag, attrs = {}, kids = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
};

function enabled(host) {
  try { return host.prefs.getBoolPref(prefName(host.prefix, PREF), true); } catch { return true; }
}
const path = () => PathUtils.join(Services.dirsvc.get('ProfD', Ci.nsIFile).path, FILE);

async function load() {
  tracker.loading ??= (async () => {
    try { tracker.data = sanitize(await IOUtils.readJSON(path())); } catch { tracker.data = emptyData(); }
    prune(tracker.data, dayKey());
  })();
  return tracker.loading;
}

async function save() {
  if (!tracker.dirty || !tracker.data) return;
  tracker.dirty = false;
  try { await IOUtils.writeJSON(path(), tracker.data, { tmpPath: `${path()}.tmp` }); } catch { tracker.dirty = true; }
}

function changed() {
  tracker.dirty = true;
  for (const fn of tracker.listeners) { try { fn(); } catch { /* un panel cerrado */ } }
}

function isPrivate(win) {
  try { return ChromeUtils.importESModule('resource://gre/modules/PrivateBrowsingUtils.sys.mjs').PrivateBrowsingUtils.isWindowPrivate(win); } catch { return false; }
}

/** El dominio que cuenta de una dirección (www.youtube.com → youtube.com), o null si no es una web. */
export function siteOf(uri) {
  try {
    if (!/^https?$/.test(uri.scheme)) return null;
    try { return Services.eTLD.getBaseDomain(uri); } catch { return uri.host.replace(/^www\./, '') || null; }
  } catch { return null; }
}

/** El servicio de búsqueda: desde Gecko 158 ya no está en Services (Services.search), sino en su módulo. */
export function searchService() {
  return Services.search ?? ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs').SearchService;
}

function tick(forced = null) {
  if (!tracker.data || !tracker.host || !enabled(tracker.host)) return;
  const win = forced ?? Services.focus.activeWindow;
  if (!win || !tracker.windows.has(win) || isPrivate(win) || win.windowState === win.STATE_MINIMIZED) return;
  const tab = win.gBrowser?.selectedTab;
  let idle = 0;
  try { idle = Cc['@mozilla.org/widget/useridleservice;1'].getService(Ci.nsIUserIdleService).idleTime; } catch { /* sin servicio: se cuenta */ }
  if (idle > IDLE && !(tab?.hasAttribute('soundplaying') && !tab.hasAttribute('muted'))) return;
  const site = siteOf(win.gBrowser.selectedBrowser?.currentURI);
  if (site && addTime(tracker.data, dayKey(), site, TICK)) changed();
}

/** Una página nueva en una pestaña: cuenta como web visitada y, si es la de resultados de un buscador, como
 *  búsqueda (la misma dirección dos veces seguidas, una). */
function visited(win, uri) {
  if (!tracker.data || !enabled(tracker.host) || isPrivate(win) || !/^https?$/.test(uri?.scheme ?? '')) return;
  const today = dayKey();
  addPage(tracker.data, today);
  try {
    const found = searchService().parseSubmissionURL(uri.spec);
    if (found?.engine && found.terms && tracker.lastSearch !== uri.spec) { addSearch(tracker.data, today); tracker.lastSearch = uri.spec; }
  } catch { /* el buscador aún no está listo */ }
  changed();
}

function startTracking(win, host) {
  tracker.host ??= host;
  tracker.windows.add(win);
  void load();
  tracker.timer ??= setInterval(tick, TICK * 1000);
  tracker.saveTimer ??= setInterval(() => void save(), SAVE_EVERY);
  if (!tracker.quit) {
    tracker.quit = { observe: () => void save() };
    Services.obs.addObserver(tracker.quit, 'quit-application-granted');
  }
}

function stopTracking(win) {
  tracker.windows.delete(win);
  void save();
  if (tracker.windows.size) return;
  clearInterval(tracker.timer); clearInterval(tracker.saveTimer);
  tracker.timer = tracker.saveTimer = null;
  if (tracker.quit) { try { Services.obs.removeObserver(tracker.quit, 'quit-application-granted'); } catch { /* ya no estaba */ } tracker.quit = null; }
}

/** Borra todo lo contado (desde el panel o los ajustes). */
export async function forget() {
  tracker.data = emptyData();
  tracker.dirty = true;
  await save();
  changed();
}

/** Para las pruebas: lo contado ahora mismo y contar ya una vuelta. */
export const _debug = { tick: win => tick(win), visited, data: () => tracker.data, save, load, file: () => path() };

// ---------------------------------------------------------------- el panel

const ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="8" width="3" height="6" rx="1.2"/><rect x="6.5" y="4" width="3" height="10" rx="1.2"/><rect x="11" y="1.5" width="3" height="12.5" rx="1.2"/></svg>');

function render(win, st) {
  const { t } = st, doc = win.document;
  if (!st.panel.hasAttribute('open')) return;
  const on = enabled(st.host);
  st.panel.toggleAttribute('off', !on);
  for (const button of st.spans.children) button.toggleAttribute('on', Number(button.dataset.span) === st.span);
  const data = tracker.data ?? emptyData();
  const sum = summarize(data, dayKey(), st.span);
  st.time.textContent = formatDuration(sum.total, t);
  st.searches.textContent = String(sum.searches);
  st.pages.textContent = String(sum.pages);
  // Dónde: las 6 webs con más tiempo, con su barra (la más larga, la de más tiempo).
  const top = sum.sites.slice(0, 6), most = top[0]?.seconds || 1;
  st.sites.replaceChildren(...top.map(({ site, seconds }) => {
    const icon = el(doc, 'img', { src: `page-icon:https://${site}/`, alt: '' });
    icon.addEventListener('error', () => icon.replaceWith(el(doc, 'span', { class: 'zero-stats-letter', 'aria-hidden': 'true' }, [site[0].toUpperCase()])), { once: true });
    const row = el(doc, 'div', { class: 'zero-stats-row', role: 'listitem', 'aria-label': `${site}: ${formatDuration(seconds, t)}` }, [
      el(doc, 'span', { class: 'zero-stats-icon', 'aria-hidden': 'true' }, [icon]),
      el(doc, 'span', { class: 'zero-stats-name' }, [site]),
      el(doc, 'span', { class: 'zero-stats-value' }, [formatDuration(seconds, t)]),
      el(doc, 'span', { class: 'zero-stats-bar', 'aria-hidden': 'true', style: `--zero-stats-w: ${Math.max(0.04, seconds / most).toFixed(3)}` }),
    ]);
    return row;
  }));
  st.sitesEmpty.hidden = top.length > 0;
  // En qué: las categorías con su parte del total.
  const cats = sum.categories.slice(0, 6);
  st.cats.replaceChildren(...cats.map(({ id, seconds }) => {
    const info = CATEGORIES.find(c => c.id === id);
    const share = sum.total ? seconds / sum.total : 0;
    const name = t(info?.es ?? id, info?.en ?? id);
    return el(doc, 'div', { class: 'zero-stats-row zero-stats-cat', role: 'listitem', 'aria-label': `${name}: ${Math.round(share * 100)} %` }, [
      el(doc, 'span', { class: 'zero-stats-name' }, [name]),
      el(doc, 'span', { class: 'zero-stats-value' }, [`${Math.round(share * 100)} %`]),
      el(doc, 'span', { class: 'zero-stats-bar', 'aria-hidden': 'true', style: `--zero-stats-w: ${Math.max(0.03, share).toFixed(3)}` }),
    ]);
  }));
  st.catsBox.hidden = !cats.length;
  // Cada día (con 7 o 30): una barra por día, con su valor al pasar el ratón.
  st.daysBox.hidden = st.span === 1;
  if (st.span > 1) {
    const max = Math.max(...sum.days.map(d => d.seconds), 1);
    const format = new Intl.DateTimeFormat(t('es-ES', 'en-GB'), { weekday: 'short', day: 'numeric' });
    st.days.replaceChildren(...sum.days.map(({ day, seconds }) => {
      const [y, m, d] = day.split('-').map(Number);
      const label = `${format.format(new Date(y, m - 1, d))} · ${formatDuration(seconds, t)}`;
      const initial = st.span <= 7 ? new Intl.DateTimeFormat(t('es-ES', 'en-GB'), { weekday: 'narrow' }).format(new Date(y, m - 1, d)) : '';
      return el(doc, 'span', { class: 'zero-stats-day', role: 'listitem', 'aria-label': label, 'data-label': label, 'data-initial': initial, style: `--zero-stats-h: ${(seconds / max).toFixed(3)}` }, [el(doc, 'i')]);
    }));
    st.days.style.setProperty('--zero-stats-n', String(sum.days.length));
    st.dayTip.textContent = t('Pasa el ratón por un día', 'Hover a day');
  }
}

function place(win, st) {
  const r = st.button.getBoundingClientRect(), dock = win.document.getElementById('zero-dock')?.getBoundingClientRect();
  const height = st.panel.offsetHeight || 420;
  st.panel.style.left = `${Math.round((dock?.right ?? r.right) + 12)}px`;
  st.panel.style.top = `${Math.round(Math.max(12, Math.min(r.top + r.height / 2 - height / 2, win.innerHeight - height - 12)))}px`;
}

async function open(win, st) {
  await load();
  st.panel.setAttribute('open', '');
  st.button.setAttribute('aria-expanded', 'true');
  render(win, st);
  place(win, st);
}

function close(st) {
  st.panel.removeAttribute('open');
  st.button.setAttribute('aria-expanded', 'false');
}

export function attach(win, ctx) {
  const doc = win.document, { host } = ctx;
  const dock = doc.getElementById('zero-dock');
  if (!dock || !host?.prefs) return;
  const t = host.t ?? (es => es);
  const st = { host, t, cleanups: [], span: 1 };
  try { st.span = [1, 7, 30].includes(Number(host.prefs.getStringPref(prefName(host.prefix, SPAN_PREF), '1'))) ? Number(host.prefs.getStringPref(prefName(host.prefix, SPAN_PREF), '1')) : 1; } catch { /* de serie */ }
  state.set(win, st);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };
  startTracking(win, host);
  st.cleanups.push(() => stopTracking(win));
  ctx.settings?.add(settingsSection(host));

  const title = t('Tus estadísticas', 'Your stats');
  st.button = el(doc, 'button', { type: 'button', class: 'zero-stats-button', title, 'aria-label': title, 'aria-expanded': 'false', 'aria-controls': 'zero-stats' },
    [el(doc, 'span', { class: 'zero-fav', 'aria-hidden': 'true', style: `--zero-stats-icon: url("${ICON}")` })]);
  st.pill = el(doc, 'div', { id: 'zero-stats-pill', class: 'zero-pill', role: 'group', 'aria-label': title }, [st.button]);
  // Entre los accesos directos y lo de abajo (Risco, 9-11: «entre Kitsune y los accesos directos»).
  const after = doc.getElementById('zero-shortcuts');
  if (after?.parentNode === dock) after.after(st.pill); else dock.append(st.pill);

  st.spans = el(doc, 'span', { class: 'zero-stats-spans', role: 'radiogroup', 'aria-label': t('Cuánto tiempo', 'How long') },
    [[1, t('Hoy', 'Today')], [7, t('7 días', '7 days')], [30, t('30 días', '30 days')]].map(([span, label]) =>
      el(doc, 'button', { type: 'button', role: 'radio', 'data-span': String(span) }, [label])));
  const figure = (label, node) => el(doc, 'div', { class: 'zero-stats-figure' }, [node, el(doc, 'small', {}, [label])]);
  st.time = el(doc, 'b'); st.searches = el(doc, 'b'); st.pages = el(doc, 'b');
  st.sites = el(doc, 'div', { class: 'zero-stats-list', role: 'list', 'aria-label': t('Dónde pasas más tiempo', 'Where your time goes') });
  st.sitesEmpty = el(doc, 'p', { class: 'zero-stats-empty' }, [t('Aún no hay nada contado. Navega un poco y vuelve.', 'Nothing counted yet. Browse a little and come back.')]);
  st.cats = el(doc, 'div', { class: 'zero-stats-list', role: 'list' });
  st.catsBox = el(doc, 'div', {}, [el(doc, 'h5', {}, [t('En qué', 'On what')]), st.cats]);
  st.days = el(doc, 'div', { class: 'zero-stats-days', role: 'list', 'aria-label': t('Tiempo de cada día', 'Time per day') });
  st.dayTip = el(doc, 'small', { class: 'zero-stats-daytip' });
  st.daysBox = el(doc, 'div', {}, [el(doc, 'h5', {}, [t('Cada día', 'Each day')]), st.days, st.dayTip]);
  st.toggle = el(doc, 'button', { type: 'button', class: 'zero-stats-action' });
  st.clear = el(doc, 'button', { type: 'button', class: 'zero-stats-action' }, [t('Borrar', 'Clear')]);
  st.panel = el(doc, 'section', { id: 'zero-stats', role: 'dialog', 'aria-label': title }, [
    el(doc, 'header', {}, [el(doc, 'h4', {}, [title]), st.spans]),
    el(doc, 'div', { class: 'zero-stats-figures' }, [figure(t('navegando', 'browsing'), st.time), figure(t('búsquedas', 'searches'), st.searches), figure(t('webs', 'pages'), st.pages)]),
    el(doc, 'h5', {}, [t('Dónde pasas más tiempo', 'Where your time goes')]), st.sites, st.sitesEmpty,
    st.catsBox, st.daysBox,
    el(doc, 'footer', {}, [el(doc, 'small', {}, [t('Solo en este ordenador', 'Only on this computer')]), st.toggle, st.clear]),
  ]);
  doc.body.append(st.panel);
  st.cleanups.push(() => { st.pill.remove(); st.panel.remove(); });
  const paintToggle = () => { st.toggle.textContent = enabled(host) ? t('Pausar', 'Pause') : t('Contar', 'Resume'); };
  paintToggle();

  st.button.addEventListener('click', () => { if (st.panel.hasAttribute('open')) close(st); else void open(win, st); });
  st.spans.addEventListener('click', event => {
    const span = Number(event.target.closest('[data-span]')?.dataset.span);
    if (!span) return;
    st.span = span;
    try { host.prefs.setStringPref(prefName(host.prefix, SPAN_PREF), String(span)); } catch { /* sin ajustes */ }
    render(win, st); place(win, st);
  });
  st.days.addEventListener('mouseover', event => { const day = event.target.closest('.zero-stats-day'); if (day) st.dayTip.textContent = day.dataset.label; });
  st.toggle.addEventListener('click', () => { try { host.prefs.setBoolPref(prefName(host.prefix, PREF), !enabled(host)); } catch { /* sin ajustes */ } });
  st.clear.addEventListener('click', () => {
    // Dos pasos: el primer clic pregunta.
    if (!st.clear.hasAttribute('sure')) { st.clear.setAttribute('sure', ''); st.clear.textContent = t('¿Borrar todo?', 'Clear all?'); return; }
    st.clear.removeAttribute('sure'); st.clear.textContent = t('Borrar', 'Clear');
    void forget();
  });
  const refresh = () => { if (st.panel.hasAttribute('open')) render(win, st); };
  tracker.listeners.add(refresh);
  st.cleanups.push(() => tracker.listeners.delete(refresh));
  const observer = { observe: () => { paintToggle(); refresh(); } };
  host.prefs.addObserver(prefName(host.prefix, PREF), observer);
  st.cleanups.push(() => host.prefs.removeObserver(prefName(host.prefix, PREF), observer));
  listen(win, 'mousedown', event => { if (st.panel.hasAttribute('open') && !st.panel.contains(event.target) && !st.button.contains(event.target)) close(st); }, true);
  listen(win, 'keydown', event => { if (event.key === 'Escape' && st.panel.hasAttribute('open')) { close(st); st.button.focus(); } }, true);
  listen(win, 'resize', () => { if (st.panel.hasAttribute('open')) place(win, st); });

  // Las webs que se abren (y las búsquedas): las de todas las pestañas de la ventana.
  const progress = {
    onLocationChange(browser, webProgress, request, location, flags) {
      if (!webProgress?.isTopLevel || flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT) return;
      visited(win, location);
    },
  };
  win.gBrowser.addTabsProgressListener(progress);
  st.cleanups.push(() => win.gBrowser.removeTabsProgressListener(progress));
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}

/** La fila de los ajustes: contar o no. */
export function settingsSection(host) {
  return {
    id: 'stats',
    rows: [{
      kind: 'switch', id: PREF,
      label: host.t('Estadísticas', 'Stats'),
      detail: host.t('Cuenta dónde pasas el tiempo y cuántas búsquedas haces, solo en este ordenador.', 'Counts where your time goes and how many searches you make, only on this computer.'),
      get: () => enabled(host),
      set: on => host.prefs.setBoolPref(prefName(host.prefix, PREF), !!on),
      watch: fn => {
        const observer = { observe: () => fn() };
        host.prefs.addObserver(prefName(host.prefix, PREF), observer);
        return () => host.prefs.removeObserver(prefName(host.prefix, PREF), observer);
      },
    }],
  };
}
