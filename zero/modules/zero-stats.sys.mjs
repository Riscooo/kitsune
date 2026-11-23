/* Kitsune Zero · tus estadísticas: una pastilla de la columna (entre los accesos directos y los ajustes) que abre un
 * panel con dónde pasas el tiempo, cuántas búsquedas haces y en qué se te va (Risco, 9-11). Desde el 23-11, a toda la
 * ventana y con logros: «que se abra una especie de dashboard en toda la pantalla con el tiempo de uso… y meter logros».
 *
 * Cómo se cuenta (uno para todas las ventanas):
 * - Tiempo: cada 5 s, a la web (su dominio) de la pestaña que se ve en la ventana con el foco, si la persona está
 *   ahí (ha tocado el teclado o el ratón en los últimos 2 min) o la pestaña suena (un vídeo, música). Las ventanas
 *   privadas no cuentan, ni las páginas internas.
 * - Búsquedas: cada página de resultados de un buscador instalado (Services.search.parseSubmissionURL). No se
 *   guarda qué se buscó.
 * - Webs: cada página nueva que se abre en una pestaña.
 * - Estudio: el tiempo, con la ventana en modo Estudio. Y lo que suman otras piezas con sumar(): notas, subrayados,
 *   citas y pomodoros. De las notas solo se cuenta cuántas; nada de lo que dicen.
 * Se guarda en el perfil (kitsune-zero-estadisticas.json), solo en este ordenador; se puede apagar y borrar desde
 * el propio panel o desde los ajustes. Lo puro (sumar, resumir, categorías) está en zero-stats.mjs.
 */
import { setInterval, clearInterval } from 'resource://gre/modules/Timer.sys.mjs';
import { prefName } from './zero-config.sys.mjs';
import { dayKey, emptyData, sanitize, addTime, addSearch, addPage, addCount, merge, prune, summarize, compare, byMonth, calendar, formatDuration, CATEGORIES } from './zero-stats.mjs';
import { estado, medidas, nuevos } from './zero-logros.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const FILE = 'kitsune-zero-estadisticas.json';
const PREF = 'stats';          // contar o no (de serie, sí)
const SPAN_PREF = 'stats.span'; // lo último que se miró: 1, 7, 30 o 365 días
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
    try {
      tracker.data = sanitize(await IOUtils.readJSON(path()));
    } catch (error) {
      tracker.data = emptyData();
      // Si hay archivo y no se entiende, se aparta antes de empezar de nuevo: un año de historial no se pisa.
      if (!(DOMException.isInstance(error) && error.name === 'NotFoundError')) {
        console.error('Kitsune Zero: las estadísticas no se pueden leer', error);
        tracker.readOnly = true;
        try { await IOUtils.copy(path(), `${path()}.ilegible-${dayKey()}`); tracker.readOnly = false; } catch { /* ni copiarlo: no se guarda nada esta vez */ }
      }
    }
    prune(tracker.data, dayKey());
  })();
  return tracker.loading;
}

async function save() {
  if (!tracker.dirty || !tracker.data || tracker.readOnly) return;
  tracker.dirty = false;
  try { await IOUtils.writeJSON(path(), tracker.data, { tmpPath: `${path()}.tmp` }); } catch { tracker.dirty = true; }
}

function changed() {
  tracker.dirty = true;
  for (const fn of tracker.listeners) { try { fn(); } catch { /* un panel cerrado */ } }
}

/** Los logros que se acaban de conseguir: se apuntan y la isla de la ventana que se usa lo dice, de uno en uno. */
function achievements() {
  if (!tracker.data) return;
  const found = nuevos(tracker.data, dayKey());
  if (!found.length) return;
  tracker.dirty = true;
  const win = Services.focus.activeWindow ?? [...tracker.windows][0], st = win && state.get(win);
  if (!st?.island) return;
  found.slice(0, 3).forEach((item, i) => win.setTimeout(() => st.island.alert(st.t(item.es, item.en), st.t('Logro conseguido', 'Achievement unlocked'), 4200), i * 4600));
}

/** Suma a un contador (estudio, pomos, notas, subrayados, citas). Lo usan las demás piezas. */
export function sumar(key, n = 1) {
  if (!tracker.host || !enabled(tracker.host)) return;
  void load().then(() => {
    if (!addCount(tracker.data, dayKey(), key, n)) return;
    changed();
    achievements();
  });
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
  const today = dayKey();
  let some = !!site && addTime(tracker.data, today, site, TICK, new Date().getHours());
  if (site && win.document.documentElement.hasAttribute('zero-estudio')) { addCount(tracker.data, today, 'estudio', TICK); some = true; }
  if (some) changed();
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
  tracker.saveTimer ??= setInterval(() => { achievements(); void save(); }, SAVE_EVERY);
  void load().then(achievements);
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

/** Todo lo contado, para la copia de Kitsune; y juntarlo con lo de una. */
export async function todo() {
  await load();
  if (tracker.readOnly) throw new Error('ilegible');
  return tracker.data;
}
export async function traer(valor) {
  await load();
  const days = merge(tracker.data, sanitize(valor));
  tracker.dirty = true;
  await save();
  changed();
  return days;
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

// ---------------------------------------------------------------- el panel, a pantalla completa

const ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="8" width="3" height="6" rx="1.2"/><rect x="6.5" y="4" width="3" height="10" rx="1.2"/><rect x="11" y="1.5" width="3" height="12.5" rx="1.2"/></svg>');
const SPANS = [1, 7, 30, 365];
const WEEKS = 27;
const locale = t => t('es-ES', 'en-GB');
const dateOf = day => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); };

/** Las columnas de la gráfica: las horas de hoy, los días de la semana o del mes, o los meses del año. */
function columns(sum, span, t) {
  const fmt = options => new Intl.DateTimeFormat(locale(t), options);
  if (span === 1) return sum.hours.map((seconds, h) => ({ seconds, label: `${h}:00 – ${h + 1}:00`, tick: h % 6 === 0 ? `${h} h` : '' }));
  if (span === 365) return byMonth(sum.days).slice(-12).map(({ month, seconds }) => {
    const date = dateOf(`${month}-01`);
    return { seconds, label: fmt({ month: 'long', year: 'numeric' }).format(date), tick: fmt({ month: 'short' }).format(date).replace('.', '') };
  });
  return sum.days.map(({ day, seconds }, i) => ({
    seconds, label: fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(dateOf(day)),
    tick: span === 7 ? fmt({ weekday: 'short' }).format(dateOf(day)).replace('.', '') : (sum.days.length - 1 - i) % 7 === 0 ? fmt({ day: 'numeric', month: 'short' }).format(dateOf(day)).replace('.', '') : '',
  }));
}

/** El tope del eje: un número redondo de horas (o de minutos) por encima de lo más alto. */
function topOf(seconds) {
  const steps = [600, 1200, 1800, 3600, 2 * 3600, 3 * 3600, 4 * 3600, 6 * 3600, 8 * 3600, 12 * 3600, 24 * 3600];
  return steps.find(step => step >= seconds) ?? Math.ceil(seconds / (24 * 3600)) * 24 * 3600;
}

function rows(win, st, items, cls = '') {
  const doc = win.document, { t } = st, most = items[0]?.seconds || 1;
  return items.map(({ name, seconds, value, icon }) => {
    const kids = [];
    if (icon) {
      const img = el(doc, 'img', { src: icon, alt: '' });
      img.addEventListener('error', () => img.replaceWith(el(doc, 'span', { class: 'zero-stats-letter', 'aria-hidden': 'true' }, [name[0].toUpperCase()])), { once: true });
      kids.push(el(doc, 'span', { class: 'zero-stats-icon', 'aria-hidden': 'true' }, [img]));
    }
    kids.push(el(doc, 'span', { class: 'zero-stats-name' }, [name]), el(doc, 'span', { class: 'zero-stats-value' }, [value]),
      el(doc, 'span', { class: 'zero-stats-bar', 'aria-hidden': 'true', style: `--zero-stats-w: ${Math.max(0.02, seconds / most).toFixed(3)}` }));
    return el(doc, 'div', { class: `zero-stats-row ${cls}`, role: 'listitem', 'aria-label': `${name}: ${formatDuration(seconds, t)}` }, kids);
  });
}

/** Los logros, del grupo que falta menos al que falta más; los conseguidos, delante. */
function renderAchievements(win, st, data) {
  const doc = win.document, { t } = st, today = dayKey();
  const list = estado(data, today);
  const got = list.filter(item => item.dia).length;
  st.achCount.textContent = `${got} ${t('de', 'of')} ${list.length}`;
  const ordered = [...list].sort((a, b) => Number(!!b.dia) - Number(!!a.dia) || (b.dia ?? '').localeCompare(a.dia ?? '') || b.parte - a.parte);
  st.achievements.replaceChildren(...ordered.map(item => {
    const amount = item.unidad === 'tiempo' ? `${formatDuration(item.lleva, t)} ${t('de', 'of')} ${formatDuration(item.meta, t)}` : `${Math.floor(item.lleva)} ${t('de', 'of')} ${item.meta}`;
    const when = item.dia ? new Intl.DateTimeFormat(locale(t), { day: 'numeric', month: 'short', year: 'numeric' }).format(dateOf(item.dia)) : amount;
    const node = el(doc, 'div', { class: 'zero-logro', role: 'listitem', 'data-icono': item.icono, 'data-grado': item.grado, style: `--p: ${item.parte.toFixed(3)}`,
      'aria-label': `${t(item.es, item.en)}. ${t(item.porque, item.why)}. ${item.dia ? t('Conseguido', 'Unlocked') : amount}` }, [
      el(doc, 'span', { class: 'zero-logro-medalla', 'aria-hidden': 'true' }, [el(doc, 'i')]),
      el(doc, 'b', {}, [t(item.es, item.en)]),
      el(doc, 'small', {}, [t(item.porque, item.why)]),
      el(doc, 'em', {}, [when]),
    ]);
    node.toggleAttribute('hecho', !!item.dia);
    return node;
  }));
}

function render(win, st) {
  const { t } = st, doc = win.document;
  if (!st.panel.hasAttribute('open')) return;
  const on = enabled(st.host);
  st.panel.toggleAttribute('off', !on);
  for (const button of st.spans.children) { const its = Number(button.dataset.span) === st.span; button.toggleAttribute('on', its); button.setAttribute('aria-checked', String(its)); }
  const data = tracker.data ?? emptyData(), today = dayKey();
  const sum = summarize(data, today, st.span);

  // La cifra grande, y cómo va frente a lo de antes (en el año, sin comparar: no hay otro antes).
  st.time.textContent = formatDuration(sum.total, t);
  const { cambio } = st.span === 365 ? { cambio: null } : compare(data, today, st.span);
  const before = { 1: t('que ayer', 'than yesterday'), 7: t('que los 7 días antes', 'than the 7 days before'), 30: t('que los 30 días antes', 'than the 30 days before') }[st.span];
  const pct = cambio === null ? null : Math.round(Math.abs(cambio) * 100);
  st.delta.textContent = pct === null ? '' : pct === 0 ? t('Igual', 'Same') : `${pct} % ${cambio < 0 ? t('menos', 'less') : t('más', 'more')} ${before}`;
  const streak = medidas(data, today).racha;
  st.streak.hidden = streak < 2;
  st.streak.textContent = t(`${streak} días seguidos estudiando`, `${streak} study days in a row`);
  st.study.textContent = formatDuration(sum.counters.estudio, t);
  st.pomos.textContent = String(sum.counters.pomos);
  st.notesCount.textContent = String(sum.counters.notas);
  st.marks.textContent = String(sum.counters.subrayados);
  st.searches.textContent = String(sum.searches);
  st.pages.textContent = String(sum.pages);

  // La gráfica: una columna por hora, día o mes, con dos líneas de referencia y su valor al pasar el ratón.
  const cols = columns(sum, st.span, t), top = topOf(Math.max(...cols.map(c => c.seconds), 60));
  const axis = [top, top / 2].map(v => formatDuration(v, t));
  [st.axisTop, st.axisMid].forEach((node, i) => { node.textContent = axis[i]; });
  st.days.style.setProperty('--zero-stats-n', String(cols.length));
  st.days.replaceChildren(...cols.map(({ seconds, label, tick }) => {
    const text = `${label[0].toUpperCase()}${label.slice(1)} · ${seconds ? formatDuration(seconds, t) : t('nada', 'nothing')}`;
    return el(doc, 'span', { class: 'zero-stats-day', role: 'listitem', tabindex: '0', 'aria-label': text, 'data-label': text, 'data-initial': tick, style: `--zero-stats-h: ${(seconds / top).toFixed(3)}` }, [el(doc, 'i')]);
  }));
  st.chartTitle.textContent = { 1: t('Hoy, hora a hora', 'Today, hour by hour'), 7: t('Cada día', 'Each day'), 30: t('Cada día', 'Each day'), 365: t('Cada mes', 'Each month') }[st.span];
  st.dayTip.textContent = st.span === 1 && !cols.some(c => c.seconds) && sum.total ? t('Las horas se cuentan desde esta versión.', 'Hours are counted from this version on.') : '';

  // Dónde y en qué.
  const sites = sum.sites.slice(0, 6);
  st.sites.replaceChildren(...rows(win, st, sites.map(({ site, seconds }) => ({ name: site, seconds, value: formatDuration(seconds, t), icon: `page-icon:https://${site}/` }))));
  st.sitesEmpty.hidden = sites.length > 0;
  const cats = sum.categories.slice(0, 6).map(({ id, seconds }) => {
    const info = CATEGORIES.find(c => c.id === id);
    return { name: t(info?.es ?? id, info?.en ?? id), seconds, value: `${Math.round((sum.total ? seconds / sum.total : 0) * 100)} %` };
  });
  st.cats.replaceChildren(...rows(win, st, cats, 'zero-stats-cat'));
  st.catsEmpty.hidden = cats.length > 0;

  // El medio año de un vistazo.
  const weeks = calendar(data, today, WEEKS);
  const dayFmt = new Intl.DateTimeFormat(locale(t), { weekday: 'long', day: 'numeric', month: 'long' }), monthFmt = new Intl.DateTimeFormat(locale(t), { month: 'short' });
  let lastMonth = '';
  st.heat.replaceChildren(...weeks.map(week => {
    const first = week.find(Boolean), month = first?.day.slice(0, 7) ?? lastMonth, name = month !== lastMonth && first && Number(first.day.slice(8)) <= 7 ? monthFmt.format(dateOf(first.day)).replace('.', '') : '';
    lastMonth = month;
    return el(doc, 'span', { class: 'zero-heat-week', 'data-month': name }, week.map(cell => {
      if (!cell) return el(doc, 'i', { class: 'zero-heat-none' });
      const text = `${dayFmt.format(dateOf(cell.day))} · ${cell.seconds ? formatDuration(cell.seconds, t) : t('nada', 'nothing')}`;
      return el(doc, 'i', { 'data-level': String(cell.level), 'data-label': text[0].toUpperCase() + text.slice(1) });
    }));
  }));
  renderAchievements(win, st, data);
}

async function open(win, st) {
  await load();
  st.panel.setAttribute('open', '');
  st.button.setAttribute('aria-expanded', 'true');
  win.document.documentElement.setAttribute('zero-stats-open', '');
  render(win, st);
  st.scroll.scrollTop = 0;
  st.close.focus({ focusVisible: false });
}

function close(win, st) {
  if (!st.panel.hasAttribute('open')) return;
  st.panel.removeAttribute('open');
  st.button.setAttribute('aria-expanded', 'false');
  win.document.documentElement.removeAttribute('zero-stats-open');
  st.tip.removeAttribute('open');
}

/** El valor de lo que está bajo el ratón (o con el foco), en una etiqueta que lo sigue. */
function tipOver(win, st, node) {
  const label = node?.dataset?.label;
  if (!label) { st.tip.removeAttribute('open'); return; }
  st.tip.textContent = label;
  st.tip.setAttribute('open', '');
  const r = (node.querySelector('i') ?? node).getBoundingClientRect(), w = st.tip.offsetWidth;
  st.tip.style.left = `${Math.round(Math.max(8, Math.min(win.innerWidth - w - 8, r.left + r.width / 2 - w / 2)))}px`;
  st.tip.style.top = `${Math.round(r.top - st.tip.offsetHeight - 8)}px`;
}

export function attach(win, ctx) {
  const doc = win.document, { host } = ctx;
  const dock = doc.getElementById('zero-dock');
  if (!dock || !host?.prefs) return;
  const t = host.t ?? (es => es);
  const st = { host, t, cleanups: [], span: 1, island: ctx.island };
  try { const saved = Number(host.prefs.getStringPref(prefName(host.prefix, SPAN_PREF), '7')); st.span = SPANS.includes(saved) ? saved : 7; } catch { /* de serie */ }
  state.set(win, st);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };
  startTracking(win, host);
  st.cleanups.push(() => stopTracking(win));
  listen(win, 'unload', () => detach(win), { once: true });
  ctx.settings?.add(settingsSection(host));

  const title = t('Tus estadísticas', 'Your stats');
  st.button = el(doc, 'button', { type: 'button', class: 'zero-stats-button', title, 'aria-label': title, 'aria-expanded': 'false', 'aria-controls': 'zero-stats' },
    [el(doc, 'span', { class: 'zero-fav', 'aria-hidden': 'true', style: `--zero-stats-icon: url("${ICON}")` })]);
  st.pill = el(doc, 'div', { id: 'zero-stats-pill', class: 'zero-pill', role: 'group', 'aria-label': title }, [st.button]);
  // Entre los accesos directos y lo de abajo (Risco, 9-11: «entre Kitsune y los accesos directos»).
  const after = doc.getElementById('zero-shortcuts');
  if (after?.parentNode === dock) after.after(st.pill); else dock.append(st.pill);

  st.spans = el(doc, 'span', { class: 'zero-stats-spans', role: 'radiogroup', 'aria-label': t('Cuánto tiempo', 'How long') },
    [[1, t('Hoy', 'Today')], [7, t('7 días', '7 days')], [30, t('30 días', '30 days')], [365, t('Un año', 'One year')]].map(([span, label]) =>
      el(doc, 'button', { type: 'button', role: 'radio', 'data-span': String(span) }, [label])));
  const figure = (label, node) => el(doc, 'div', { class: 'zero-stats-figure' }, [node, el(doc, 'small', {}, [label])]);
  const card = (cls, heading, kids, extra = []) => el(doc, 'section', { class: `zero-stats-card ${cls}` }, [el(doc, 'div', { class: 'zero-stats-head' }, [heading, ...extra]), ...kids]);
  const h5 = text => el(doc, 'h5', {}, text ? [text] : []);
  for (const key of ['time', 'study', 'pomos', 'notesCount', 'marks', 'searches', 'pages']) st[key] = el(doc, 'b');
  st.delta = el(doc, 'span', { class: 'zero-stats-delta' });
  st.streak = el(doc, 'span', { class: 'zero-stats-streak', hidden: 'true' });
  st.chartTitle = h5();
  st.axisTop = el(doc, 'small'); st.axisMid = el(doc, 'small');
  st.days = el(doc, 'div', { class: 'zero-stats-days', role: 'list', 'aria-label': t('Tiempo', 'Time') });
  st.dayTip = el(doc, 'small', { class: 'zero-stats-daytip' });
  st.sites = el(doc, 'div', { class: 'zero-stats-list', role: 'list', 'aria-label': t('Dónde pasas más tiempo', 'Where your time goes') });
  st.sitesEmpty = el(doc, 'p', { class: 'zero-stats-empty' }, [t('Aún no hay nada contado. Navega un poco y vuelve.', 'Nothing counted yet. Browse a little and come back.')]);
  st.cats = el(doc, 'div', { class: 'zero-stats-list', role: 'list', 'aria-label': t('En qué', 'On what') });
  st.catsEmpty = el(doc, 'p', { class: 'zero-stats-empty' }, ['—']);
  st.heat = el(doc, 'div', { class: 'zero-heat', role: 'img', 'aria-label': t('Los últimos seis meses, día a día', 'The last six months, day by day') });
  st.achCount = el(doc, 'small', { class: 'zero-stats-count' });
  st.achievements = el(doc, 'div', { class: 'zero-logros', role: 'list', 'aria-label': t('Logros', 'Achievements') });
  st.toggle = el(doc, 'button', { type: 'button', class: 'zero-stats-action' });
  st.clear = el(doc, 'button', { type: 'button', class: 'zero-stats-action' }, [t('Borrar', 'Clear')]);
  st.close = el(doc, 'button', { type: 'button', class: 'zero-stats-close', title: t('Cerrar (Esc)', 'Close (Esc)'), 'aria-label': t('Cerrar', 'Close') });
  st.tip = el(doc, 'div', { id: 'zero-stats-tip', role: 'tooltip' });
  st.scroll = el(doc, 'div', { class: 'zero-stats-scroll' }, [el(doc, 'div', { class: 'zero-stats-page' }, [
    el(doc, 'header', {}, [el(doc, 'h4', {}, [title]), st.spans]),
    el(doc, 'div', { class: 'zero-stats-hero' }, [
      el(doc, 'div', { class: 'zero-stats-figure zero-stats-big' }, [st.time, el(doc, 'small', {}, [t('navegando', 'browsing')]), st.delta, st.streak]),
      el(doc, 'div', { class: 'zero-stats-figures' }, [figure(t('en modo Estudio', 'in Study mode'), st.study), figure(t('pomodoros', 'pomodoros'), st.pomos), figure(t('notas nuevas', 'new notes'), st.notesCount),
        figure(t('subrayados', 'highlights'), st.marks), figure(t('búsquedas', 'searches'), st.searches), figure(t('webs', 'pages'), st.pages)]),
    ]),
    card('zero-stats-chart', st.chartTitle, [el(doc, 'div', { class: 'zero-stats-plot' }, [el(doc, 'span', { class: 'zero-stats-grid', 'aria-hidden': 'true' }, [st.axisTop, st.axisMid]), st.days]), st.dayTip]),
    el(doc, 'div', { class: 'zero-stats-two' }, [
      card('', h5(t('Dónde pasas más tiempo', 'Where your time goes')), [st.sites, st.sitesEmpty]),
      card('', h5(t('En qué', 'On what')), [st.cats, st.catsEmpty]),
    ]),
    card('', h5(t('Los últimos seis meses', 'The last six months')), [st.heat], [el(doc, 'span', { class: 'zero-heat-key', 'aria-hidden': 'true' }, [t('menos', 'less'), ...[0, 1, 2, 3, 4].map(n => el(doc, 'i', { 'data-level': String(n) })), t('más', 'more')])]),
    card('', h5(t('Logros', 'Achievements')), [st.achievements], [st.achCount]),
    el(doc, 'footer', {}, [el(doc, 'small', {}, [t('Solo en este ordenador', 'Only on this computer')]), st.toggle, st.clear]),
  ])]);
  st.panel = el(doc, 'section', { id: 'zero-stats', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [st.scroll, st.close]);
  doc.body.append(st.panel, st.tip);
  st.cleanups.push(() => { st.pill.remove(); st.panel.remove(); st.tip.remove(); doc.documentElement.removeAttribute('zero-stats-open'); });
  const paintToggle = () => { st.toggle.textContent = enabled(host) ? t('Pausar', 'Pause') : t('Contar', 'Resume'); };
  paintToggle();

  st.button.addEventListener('click', () => { if (st.panel.hasAttribute('open')) close(win, st); else void open(win, st); });
  st.close.addEventListener('click', () => { close(win, st); st.button.focus({ focusVisible: false }); });
  st.spans.addEventListener('click', event => {
    const span = Number(event.target.closest('[data-span]')?.dataset.span);
    if (!span) return;
    st.span = span;
    try { host.prefs.setStringPref(prefName(host.prefix, SPAN_PREF), String(span)); } catch { /* sin ajustes */ }
    render(win, st);
  });
  for (const node of [st.days, st.heat]) {
    node.addEventListener('mouseover', event => tipOver(win, st, event.target.closest('[data-label]')));
    node.addEventListener('mouseleave', () => tipOver(win, st, null));
    node.addEventListener('focusin', event => tipOver(win, st, event.target.closest('[data-label]')));
    node.addEventListener('focusout', () => tipOver(win, st, null));
  }
  st.scroll.addEventListener('scroll', () => tipOver(win, st, null), { passive: true });
  st.toggle.addEventListener('click', () => { try { host.prefs.setBoolPref(prefName(host.prefix, PREF), !enabled(host)); } catch { /* sin ajustes */ } });
  st.clear.addEventListener('click', () => {
    // Dos pasos: el primer clic pregunta.
    if (!st.clear.hasAttribute('sure')) { st.clear.setAttribute('sure', ''); st.clear.textContent = t('¿Borrar todo, también los logros?', 'Clear everything, achievements too?'); return; }
    st.clear.removeAttribute('sure'); st.clear.textContent = t('Borrar', 'Clear');
    void forget();
  });
  // Con el panel abierto, como mucho una vuelta cada dos segundos: se cuenta cada poco y no tiene que parpadear.
  const refresh = () => {
    if (!st.panel.hasAttribute('open') || st.refreshing) return;
    st.refreshing = win.setTimeout(() => { st.refreshing = 0; if (!st.panel.querySelector('.zero-stats-day:hover, .zero-heat i:hover')) render(win, st); }, 2000);
  };
  tracker.listeners.add(refresh);
  st.cleanups.push(() => { tracker.listeners.delete(refresh); win.clearTimeout(st.refreshing); });
  const observer = { observe: () => { paintToggle(); render(win, st); } };
  host.prefs.addObserver(prefName(host.prefix, PREF), observer);
  st.cleanups.push(() => host.prefs.removeObserver(prefName(host.prefix, PREF), observer));
  listen(win, 'keydown', event => { if (event.key === 'Escape' && st.panel.hasAttribute('open')) { event.preventDefault(); close(win, st); st.button.focus({ focusVisible: false }); } }, true);
  // Ir a otra pestaña, o pedir una nueva, cierra el panel: no tapa lo que se acaba de pedir.
  listen(win.gBrowser.tabContainer, 'TabSelect', () => close(win, st));

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
