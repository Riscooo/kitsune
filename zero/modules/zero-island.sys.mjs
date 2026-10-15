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
import { lightIcon } from './zero-icon.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const NO_ICON = 'chrome://global/skin/icons/defaultFavicon.svg';
const state = new WeakMap(); // ventana → { cleanups, … }

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};

/** Lo que dice la isla en reposo: el dominio de la web, o el título si no es una web (el inicio, about:…).
 *  `site`: 'secure' (https), 'insecure' (http) o null si no es una web. */
function label(win) {
  const browser = win.gBrowser.selectedBrowser;
  try {
    let uri = browser.currentURI;
    // En la vista de lectura, la web que se lee.
    if (uri.spec.startsWith('about:reader?')) uri = Services.io.newURI(new URLSearchParams(uri.spec.slice('about:reader?'.length)).get('url'));
    if (/^https?$/.test(uri.scheme) && uri.host) return { text: uri.host.replace(/^www\./, ''), site: uri.scheme === 'https' ? 'secure' : 'insecure' };
  } catch { /* sin dirección */ }
  return { text: win.gBrowser.selectedTab.label || '', site: null };
}

// Las páginas que cuentan como «nada abierto»: la nueva pestaña y la de inicio (las de Gecko o las que
// ponga el navegador, como el inicio de Kitsune) y las en blanco.
const BLANK = new Set(['', 'about:blank', 'about:newtab', 'about:home', 'about:privatebrowsing']);
export function isEmptyPage(win, spec) {
  if (BLANK.has(spec)) return true;
  try {
    const { AboutNewTab } = ChromeUtils.importESModule('resource:///modules/AboutNewTab.sys.mjs');
    if (spec === AboutNewTab.newTabURL) return true;
  } catch { /* sin pestaña nueva propia */ }
  try {
    const { HomePage } = ChromeUtils.importESModule('resource:///modules/HomePage.sys.mjs');
    if (HomePage.get(win).split('|').includes(spec)) return true;
  } catch { /* sin página de inicio */ }
  return false;
}

/** Lo más delicado que comparte alguna pestaña de la ventana —la pantalla, la cámara o el micrófono— y
 *  qué pestaña es (Gecko lo marca en «sharing»; ventana, aplicación o pestaña cuentan como pantalla). */
export function sharingOf(win) {
  const rank = { microphone: 1, camera: 2, screen: 3 };
  let best = null;
  for (const tab of win.gBrowser.tabs) {
    const value = tab.getAttribute('sharing');
    if (!value) continue;
    const kind = value === 'camera' || value === 'microphone' ? value : 'screen';
    if (!best || rank[kind] > rank[best.kind]) best = { kind, tab };
  }
  return best;
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
  // Un favicon claro sobre transparente lleva un fondo oscuro (sobre el cristal claro no se vería).
  icon.addEventListener('load', () => { const light = lightIcon(doc, icon); icon.toggleAttribute('light-icon', !!light); });
  // El candado (y el icono, con «solo iconos») se pulsan: botones también para el teclado de Gecko,
  // que recorre con las flechas lo que tiene role="button" y lo pulsa con Intro.
  const t = ctx.host?.t ?? (es => es);
  const siteTitle = t('Información de la web', 'Site information');
  const lock = el(doc, 'span', { class: 'zero-lock', role: 'button', tabindex: '-1', title: siteTitle, 'aria-label': siteTitle });
  const text = el(doc, 'span', { class: 'zero-host-text' });
  // De qué usuario es la web: un punto de su color que, con la isla abierta, dice su nombre.
  const user = el(doc, 'span', { class: 'zero-user' });
  // Una web de la ventana usa la cámara, el micrófono o la pantalla: un punto tras el dominio, como el
  // de iOS. De cualquier pestaña, no solo la que se ve: lo que importa es saber que está encendida.
  // Con la isla abierta se pulsa y lleva a esa pestaña (como tocar el punto en iOS).
  const rec = el(doc, 'span', { class: 'zero-rec', role: 'button', tabindex: '-1' });
  rec.addEventListener('click', event => {
    if (event.button !== 0 || toolbox.getAttribute('zero-island') !== 'open') return;
    const tab = sharingOf(win)?.tab;
    if (tab) { event.preventDefault(); win.gBrowser.selectedTab = tab; }
  });
  st.host.append(icon, user, lock, text, rec);
  const recLabels = {
    camera: t('Una web usa la cámara', 'A site is using the camera'),
    microphone: t('Una web usa el micrófono', 'A site is using the microphone'),
    screen: t('Una web comparte la pantalla', 'A site is sharing the screen'),
  };
  const update = () => {
    const { text: value, site } = label(win);
    // Otra web: el dominio (y su icono) entran con un fundido corto, como cambia el texto en la Dynamic
    // Island; la misma web no mueve nada.
    if (text.textContent !== value) {
      const first = !st.painted;
      text.textContent = value;
      if (!first && !win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (const part of [text, icon]) part.animate([{ opacity: 0, filter: 'blur(2px)' }, { opacity: 1, filter: 'none' }], { duration: 260, easing: 'cubic-bezier(.4, 0, .2, 1)' });
      }
    }
    st.painted = true;
    st.host.toggleAttribute('secure', site === 'secure');
    if (site) st.host.setAttribute('site', site); else st.host.removeAttribute('site');
    const who = userOf(win, win.gBrowser.selectedTab);
    st.host.toggleAttribute('user', !!who);
    paintUser(user, who);
    if (user.textContent !== (who?.name ?? '')) user.textContent = who?.name ?? '';
    const sharing = sharingOf(win)?.kind;
    if (sharing) { st.host.setAttribute('sharing', sharing); rec.setAttribute('aria-label', recLabels[sharing]); rec.setAttribute('title', recLabels[sharing]); }
    else { st.host.removeAttribute('sharing'); rec.removeAttribute('aria-label'); rec.removeAttribute('title'); }
    let src = null;
    try { src = win.gBrowser.getIcon(win.gBrowser.selectedTab); } catch { /* sin icono */ }
    if (icon.getAttribute('src') !== (src || NO_ICON)) icon.setAttribute('src', src || NO_ICON);
  };
  update();
  // La información de la web (permisos, cookies, certificado): con la isla abierta, el candado (o el
  // icono, con «solo iconos») se pulsa. El panel de Gecko se ancla al candado de su barra, que en Zero
  // no se ve: se le presta el de la isla solo mientras se abre.
  const siteInfo = event => {
    const handler = win.gIdentityHandler;
    if (!handler || event.button !== 0 || !st.host.hasAttribute('site') || toolbox.getAttribute('zero-island') !== 'open') return;
    event.preventDefault();
    // Si se escribió algo en la isla y se dejó sin ir, Gecko no abre el panel: la isla en reposo ya
    // enseña la web de verdad, así que la barra vuelve a ella.
    if (win.gURLBar.getAttribute('pageproxystate') !== 'valid' && !win.gURLBar.focused) win.gURLBar.handleRevert();
    // El ancla: un punto del alto de la isla bajo lo pulsado, para que el panel salga debajo de ella.
    const from = event.currentTarget.getBoundingClientRect(), bar = navbar.getBoundingClientRect();
    st.anchor.style.left = `${from.left - bar.left}px`;
    const own = handler._identityIconBox;
    handler._identityIconBox = st.anchor;
    try { handler.handleIdentityButtonEvent(event); } finally { handler._identityIconBox = own; }
  };
  st.anchor = el(doc, 'span', { class: 'zero-anchor', 'aria-hidden': 'true' });
  navbar.append(st.anchor);
  st.cleanups.push(() => st.anchor.remove());

  // Sin nada abierto (la pestaña nueva o la de inicio): sin tarjeta, la isla baja al centro como buscador
  // (zero-empty en la raíz; lo demás es CSS). Deja de estarlo en cuanto empieza a cargar otra web.
  st.loading = new WeakMap(); // navegador → lo que está cargando (para no esperar a que llegue)
  const root = doc.documentElement;
  const setEmpty = () => {
    if (state.get(win) !== st) return;
    const browser = win.gBrowser.selectedBrowser;
    const target = st.loading.get(browser) ?? browser.currentURI?.spec ?? '';
    const empty = isEmptyPage(win, target), was = root.hasAttribute('zero-empty');
    root.toggleAttribute('zero-empty', empty);
    // Con la ventana sin ver (otra app delante) Gecko no anima: el fundido de la tarjeta se quedaba parado
    // con ella a la vista (la página nueva, en negro) hasta volver a Kitsune (Risco, 15-10). Ahí, al momento.
    if (was !== empty && doc.hidden) {
      for (const id of ['tabbrowser-tabpanels', 'navigator-toolbox']) {
        for (const animation of doc.getElementById(id)?.getAnimations({ subtree: true }) ?? []) {
          try { animation.finish(); } catch { /* una que no acaba nunca: se deja */ }
        }
      }
    }
    // Al dejar de estar vacía (se ha buscado algo), mientras la isla sube: lo escrito se va al momento y
    // el dominio entra al llegar arriba, sin cruzarse los dos textos.
    if (was && !empty) {
      root.setAttribute('zero-leaving-empty', '');
      win.clearTimeout(st.leaving);
      st.leaving = win.setTimeout(() => root.removeAttribute('zero-leaving-empty'), 760);
    }
  };
  st.cleanups.push(() => { win.clearTimeout(st.leaving); root.removeAttribute('zero-empty'); root.removeAttribute('zero-leaving-empty'); });
  // El buscador de siempre, con su icono delante del campo.
  const engine = el(doc, 'img', { class: 'zero-engine', alt: '' });
  navbar.append(engine);
  st.cleanups.push(() => engine.remove());
  // (En Gecko 158 el servicio de búsqueda es un módulo; antes, Services.search.)
  const paintEngine = () => {
    let search = null;
    try { search = ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs').SearchService; } catch { search = Services.search ?? null; }
    try {
      Promise.resolve(search?.getDefault()).then(e => e?.getIconURL?.(32)).then(url => { if (url) engine.setAttribute('src', url); }, () => {});
    } catch { /* sin buscador */ }
  };
  paintEngine();
  // Elegir el buscador (Risco, 15-10: «que puedas elegir el buscador que quieras»): en la pestaña vacía el
  // icono es un botón; abre una píldora con los buscadores (solo sus iconos; el nombre, al pasar el ratón) y
  // el que se elige pasa a ser el de siempre.
  const picker = el(doc, 'div', { id: 'zero-engines', role: 'listbox', 'aria-label': t('Buscador', 'Search engine') });
  doc.body.append(picker);
  st.cleanups.push(() => picker.remove());
  const searchService = () => { try { return ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs').SearchService; } catch { return Services.search ?? null; } };
  const closePicker = () => picker.removeAttribute('open');
  const openPicker = async () => {
    const search = searchService();
    if (!search) return;
    const [list, current] = await Promise.all([search.getVisibleEngines(), search.getDefault()]);
    const items = await Promise.all(list.map(async engine => {
      const button = el(doc, 'button', { 'data-engine': engine.name, title: engine.name, 'aria-label': engine.name, role: 'option' });
      const url = await engine.getIconURL?.(32);
      if (url) button.append(el(doc, 'img', { src: url, alt: '' }));
      else button.append(engine.name.slice(0, 1));
      button.toggleAttribute('current', engine.name === current?.name);
      button.setAttribute('aria-selected', String(engine.name === current?.name));
      button.addEventListener('click', () => {
        Promise.resolve(search.setDefault(engine, search.CHANGE_REASON?.USER ?? 0)).catch(() => {});
        closePicker();
      });
      return button;
    }));
    picker.replaceChildren(...items);
    picker.setAttribute('open', '');
  };
  engine.addEventListener('mousedown', event => event.preventDefault()); // sin quitarle el foco a nada
  engine.addEventListener('click', () => { if (picker.hasAttribute('open')) closePicker(); else openPicker(); });
  listen(win, 'mousedown', event => { if (picker.hasAttribute('open') && !picker.contains(event.target) && event.target !== engine) closePicker(); }, true);
  listen(win, 'keydown', event => { if (event.key === 'Escape') closePicker(); }, true);
  const pickerWatch = new win.MutationObserver(() => { if (!root.hasAttribute('zero-empty')) closePicker(); });
  pickerWatch.observe(root, { attributes: true, attributeFilter: ['zero-empty'] });
  st.cleanups.push(() => pickerWatch.disconnect());
  const engines = { observe: paintEngine };
  Services.obs.addObserver(engines, 'browser-search-engine-modified');
  st.cleanups.push(() => Services.obs.removeObserver(engines, 'browser-search-engine-modified'));

  // Mientras carga la web que se ve: una línea fina en el borde de abajo de la isla, que avanza con lo
  // que dice Gecko (y, si no dice nada, despacio hacia el final) y se va al terminar.
  const load = el(doc, 'span', { class: 'zero-load', 'aria-hidden': 'true' });
  navbar.append(load);
  st.cleanups.push(() => { win.clearInterval(st.creep); win.clearTimeout(st.loadDone); load.remove(); });
  const setLoad = (on, p = null) => {
    win.clearTimeout(st.loadDone);
    load.toggleAttribute('on', on);
    if (p !== null) { st.loadP = Math.max(st.loadP ?? 0, Math.min(1, p)); load.style.setProperty('--zero-load', String(st.loadP)); }
  };
  const start = () => {
    st.loadP = 0; setLoad(true, 0.08);
    win.clearInterval(st.creep);
    st.creep = win.setInterval(() => setLoad(true, (st.loadP ?? 0) + (0.9 - (st.loadP ?? 0)) * 0.08), 200);
  };
  const stop = () => {
    win.clearInterval(st.creep); st.creep = 0;
    if (!load.hasAttribute('on')) return;
    setLoad(true, 1);
    st.loadDone = win.setTimeout(() => { load.removeAttribute('on'); st.loadP = 0; load.style.setProperty('--zero-load', '0'); }, 320);
  };
  const WPL = Ci.nsIWebProgressListener;
  const loader = {
    onStateChange(webProgress, request, flags) {
      if (!webProgress?.isTopLevel || !(flags & WPL.STATE_IS_NETWORK)) return;
      const browser = win.gBrowser.selectedBrowser;
      if (flags & WPL.STATE_START) {
        let name = ''; try { name = request?.name ?? ''; } catch { /* sin nombre */ }
        if (name) st.loading.set(browser, name);
        setEmpty();
        start();
      } else if (flags & WPL.STATE_STOP) {
        st.loading.delete(browser);
        setEmpty();
        stop();
      }
    },
    onProgressChange(webProgress, request, curSelf, maxSelf, curTotal, maxTotal) {
      if (webProgress?.isTopLevel && maxTotal > 0 && load.hasAttribute('on')) setLoad(true, 0.08 + 0.9 * (curTotal / maxTotal));
    },
  };
  win.gBrowser.addProgressListener(loader);
  st.cleanups.push(() => win.gBrowser.removeProgressListener(loader));
  // Otra pestaña: la línea es la suya (cargando o no).
  listen(win.gBrowser.tabContainer, 'TabSelect', () => { setEmpty(); if (win.gBrowser.selectedTab.hasAttribute('busy')) start(); else { win.clearInterval(st.creep); load.removeAttribute('on'); st.loadP = 0; } });
  setEmpty();
  for (const part of [lock, icon]) part.addEventListener('click', siteInfo);

  // Lo que se puede hacer con esta web, solo cuando toca (como en la Dynamic Island): leerla en la
  // vista de lectura y traducirla. Siguen a los botones de Gecko, que en Zero no se ven.
  const actions = el(doc, 'span', { class: 'zero-actions' });
  const action = (name, title, run) => {
    const button = el(doc, 'span', { class: 'zero-action', 'data-action': name, role: 'button', tabindex: '-1', title, 'aria-label': title, hidden: 'true' });
    button.addEventListener('click', event => {
      if (event.button !== 0 || toolbox.getAttribute('zero-island') !== 'open') return;
      try { run(event); } catch (error) { console.error('Kitsune Zero:', error); }
    });
    return button;
  };
  const reader = action('reader', t('Vista de lectura', 'Reader view'), event => win.AboutReaderParent.toggleReaderMode(event));
  // Sin venir de su botón, Gecko ancla el panel de traducir al menú ≡, que está en la isla.
  const translate = action('translate', t('Traducir la página', 'Translate page'), event => win.FullPageTranslationsPanel.open(event));
  actions.append(reader, translate);
  // Lo que suena en otra pestaña (zero-media): en reposo, una onda; abierta, pausa y siguiente.
  const now = el(doc, 'span', { class: 'zero-now' }, [el(doc, 'span', { class: 'zero-now-wave', 'aria-hidden': 'true' }, [el(doc, 'i'), el(doc, 'i'), el(doc, 'i')])]);
  const nowButton = (name, title, run) => {
    const button = el(doc, 'span', { class: `zero-now-${name}`, role: 'button', tabindex: '-1', title, 'aria-label': title });
    button.addEventListener('click', event => {
      if (event.button !== 0 || toolbox.getAttribute('zero-island') !== 'open') return;
      try { run(st.now.data); } catch (error) { console.error('Kitsune Zero:', error); }
    });
    return button;
  };
  const nowToggle = nowButton('toggle', t('Pausa', 'Pause'), data => data?.toggle());
  const nowNext = nowButton('next', t('Siguiente', 'Next'), data => data?.next());
  // Silenciar esa pestaña desde la isla (el volumen de Kitsune está en el panel de sonido, en la columna).
  const nowMute = nowButton('mute', t('Silenciar', 'Mute'), data => data?.toggleMute?.());
  now.append(nowToggle, nowNext, nowMute);
  st.now = { node: now, toggle: nowToggle, next: nowNext, mute: nowMute, data: null, t };
  st.host.append(now, actions);
  const mirror = () => {
    const geckoReader = doc.getElementById('reader-mode-button'), geckoTranslate = doc.getElementById('translations-button');
    reader.hidden = !geckoReader || geckoReader.hidden;
    reader.toggleAttribute('active', !!geckoReader?.hasAttribute('readeractive'));
    translate.hidden = !geckoTranslate || geckoTranslate.hidden;
    translate.toggleAttribute('active', !!geckoTranslate?.hasAttribute('translationsactive'));
    st.host.toggleAttribute('actions', !reader.hidden || !translate.hidden);
  };
  const watcher = new win.MutationObserver(mirror);
  for (const id of ['reader-mode-button', 'translations-button']) {
    const node = doc.getElementById(id);
    if (node) watcher.observe(node, { attributes: true, attributeFilter: ['hidden', 'readeractive', 'translationsactive'] });
  }
  st.cleanups.push(() => watcher.disconnect());
  mirror();
  // Al elegir otra pestaña, Gecko avisa varias veces seguidas (la dirección, la elegida, sus atributos):
  // la isla se repinta una vez, al acabar la tanda.
  const soon = () => {
    if (st.soon) return;
    st.soon = true;
    win.queueMicrotask(() => { st.soon = false; if (state.get(win) === st) update(); });
  };
  listen(win.gBrowser.tabContainer, 'TabSelect', soon);
  // De las demás pestañas, a la isla solo le importa si usan la cámara o el micrófono.
  listen(win.gBrowser.tabContainer, 'TabAttrModified', event => { if (event.target.selected || event.detail?.changed?.includes('sharing')) soon(); });
  const progress = { onLocationChange: () => { setEmpty(); soon(); } };
  win.gBrowser.addProgressListener(progress);
  st.cleanups.push(() => win.gBrowser.removeProgressListener(progress));

  // El estado: «typing» con el foco en la barra de direcciones; «open» con el ratón encima, con el
  // foco en uno de sus botones o con un menú suyo abierto (el de Kitsune, el historial de atrás…),
  // para que no se encoja bajo el menú.
  const input = win.gURLBar?.inputField;
  st.hover = false;
  st.menus = new Set();
  const refresh = () => {
    const value = input && doc.activeElement === input ? 'typing' : st.hover || st.menus.size || st.focused ? 'open' : '';
    if (value) toolbox.setAttribute('zero-island', value); else toolbox.removeAttribute('zero-island');
  };
  if (input) {
    listen(input, 'focus', refresh);
    listen(input, 'blur', refresh);
  }
  // Con el teclado (F6, Mayús+Tab): el foco en un botón de la isla también la abre, para que se vea.
  // Solo el foco de teclado (:focus-visible): un clic de ratón en un botón no la deja abierta.
  const focus = () => {
    const active = doc.activeElement;
    st.focused = !!active && active !== input && navbar.contains(active) && active.matches(':focus-visible');
    refresh();
  };
  listen(navbar, 'focusin', focus);
  listen(navbar, 'focusout', () => win.setTimeout(focus, 0));
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
  media: 'chrome://browser/skin/tabbrowser/tab-audio-playing-small.svg',
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

/** Lo que suena en otra pestaña (o null): { playing, title, still, canNext, toggle(), next(),
 *  muted, toggleMute(), go() }. En
 *  reposo, una onda junto al dominio; con la isla abierta, pausa (o seguir) y siguiente. */
export function nowPlaying(win, data) {
  const st = state.get(win);
  if (!st?.now) return;
  const { node, toggle, next, mute, t } = st.now;
  st.now.data = data;
  st.host.toggleAttribute('now', !!data);
  node.toggleAttribute('playing', !!data?.playing);
  node.toggleAttribute('still', !!data?.still); // modo ahorro: la onda, quieta
  node.title = data?.title ?? '';
  next.hidden = !data?.canNext;
  mute.toggleAttribute('muted', !!data?.muted);
  const muteLabel = data?.muted ? t('Quitar silencio', 'Unmute') : t('Silenciar', 'Mute');
  mute.title = muteLabel; mute.setAttribute('aria-label', muteLabel);
  const label = data?.playing ? t('Pausa', 'Pause') : t('Seguir', 'Play');
  if (toggle.title !== label) { toggle.title = label; toggle.setAttribute('aria-label', label); }
}

export function endActivity(win, key) {
  const st = state.get(win);
  if (!st || !st.activities.delete(key)) return;
  if (!st.alerting) rest(win, st);
}
