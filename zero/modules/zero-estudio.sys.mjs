/* Kitsune Zero · el modo Estudio: sus páginas, en cada ventana (lo puro, en zero-estudio.mjs).
 *
 * El modo lo pone zero-profiles (el libro, junto al maletín y la luna). Aquí:
 * - Al entrar, lo que había abierto se aparta (se queda como estaba, sin recargar) y vuelven las páginas del estudio de ese
 *   perfil, con su historial y por donde ibas. Al salir, al revés.
 * - Cada página que se abre estudiando queda apuntada, cifrada, en el perfil. Aunque se cierre la pestaña, la ventana o
 *   Kitsune, vuelve la próxima vez. Para quitarla de verdad: el panel del estudio (otro clic en el libro) o el clic derecho
 *   en la pestaña.
 * - Al entrar se abre el bloc, si es lo que se dejó abierto la última vez.
 */
import { prefName, PREFS } from './zero-config.sys.mjs';
import { limpia, anotar, quitar, porAbrir, plan, guardable } from './zero-estudio.mjs';
import { idNuevo } from './zero-notas.mjs';
import * as cofre from './zero-cofre.sys.mjs';
import * as notas from './zero-notas.sys.mjs';
import { setTimeout, clearTimeout } from 'resource://gre/modules/Timer.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const CLAVE = 'kitsuneZeroEstudio';   // el valor de cada pestaña del estudio, en la sesión de Gecko: su id
const MODOS = 'modes';
const BLOC = 'estudio.bloc';          // si el bloc se dejó abierto estudiando
const state = new WeakMap();
const ventanas = new Set();
const tienda = { datos: null, cargando: null, espera: null, tocada: false };

const el = (doc, tag, attrs = {}, kids = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
};

// ---------------------------------------------------------------- lo guardado

function cargar() {
  tienda.cargando ??= (async () => { tienda.datos = limpia(await cofre.leer('estudio')); })();
  tienda.cargando.catch(error => { console.error('Kitsune Zero: estudio', error); tienda.cargando = null; });
  return tienda.cargando;
}
// En fila: quien espera (al cerrar Kitsune) espera también a la que estuviera a medias.
function guardarYa() {
  clearTimeout(tienda.espera);
  tienda.fila = (tienda.fila ?? Promise.resolve()).then(async () => {
    if (!tienda.tocada || !tienda.datos) return;
    tienda.tocada = false;
    try { await cofre.guardar('estudio', tienda.datos); } catch (error) { tienda.tocada = true; console.error('Kitsune Zero: estudio', error); }
  });
  return tienda.fila;
}
function guardar() {
  tienda.tocada = true;
  clearTimeout(tienda.espera);
  tienda.espera = setTimeout(() => void guardarYa(), 1200);
  if (!tienda.alCerrar) {
    tienda.alCerrar = true;
    ChromeUtils.importESModule('resource://gre/modules/AsyncShutdown.sys.mjs').AsyncShutdown.profileBeforeChange.addBlocker('Kitsune Zero: guardar el estudio', () => guardarYa());
  }
}

// ---------------------------------------------------------------- las pestañas

const idDe = tab => { try { return (tab.documentGlobal ?? tab.ownerGlobal).SessionStore.getCustomTabValue(tab, CLAVE) || ''; } catch { return ''; } };
const marcar = (tab, id) => { try { (tab.documentGlobal ?? tab.ownerGlobal).SessionStore.setCustomTabValue(tab, CLAVE, id); } catch { /* cerrándose */ } };
const desmarcar = tab => { try { (tab.documentGlobal ?? tab.ownerGlobal).SessionStore.deleteCustomTabValue(tab, CLAVE); } catch { /* cerrándose */ } };

/** El espacio de una pestaña: el que diga el anfitrión; si no lo sabe, el que apunta en la sesión. */
function espacioDe(st, tab) {
  try { const id = st.host.spaces?.of?.(tab); if (id) return id; } catch { /* sin espacios */ }
  let id = '';
  try { id = (tab.documentGlobal ?? tab.ownerGlobal).SessionStore.getCustomTabValue(tab, 'kitsuneSpace'); } catch { /* nueva */ }
  const lista = espacios(st);
  return lista.includes(id) ? id : lista[0];
}
const espacios = st => { try { const l = (st.host.spaces?.list(st.win) ?? []).map(s => s.id); return l.length ? l : ['base']; } catch { return ['base']; } };
const espacioActual = st => { try { return st.host.spaces?.current(st.win) ?? 'base'; } catch { return 'base'; } };
const suyas = (st, espacio = espacioActual(st)) => [...st.win.gBrowser.tabs].filter(tab => !tab.closing && !tab.pinned && espacioDe(st, tab) === espacio);

function estudiando(st, espacio = espacioActual(st)) {
  try {
    st.sinModos = !st.host.prefs.getBoolPref(prefName(st.host.prefix, PREFS.focus), true);
    if (st.sinModos) return false;
    return JSON.parse(st.host.prefs.getStringPref(prefName(st.host.prefix, MODOS), '') || '{}').profiles?.[espacio]?.mode === 'study';
  } catch { return false; }
}

/** Lo que se recuerda de una pestaña: su historial y por dónde iba; nada de formularios ni de almacenamiento de la web. */
function estadoDe(win, tab) {
  try {
    const s = JSON.parse(win.SessionStore.getTabState(tab));
    for (const clave of ['formdata', 'storage', 'extData', 'image', 'searchMode', 'hidden', 'lastAccessed']) delete s[clave];
    // Las doce últimas hasta la que se está viendo (y las de «adelante» que quepan), con el índice en su sitio.
    const todas = s.entries ?? [], aqui = Number.isInteger(s.index) ? Math.min(Math.max(s.index, 1), todas.length) : todas.length;
    const desde = Math.max(0, aqui - 10);
    s.entries = todas.slice(desde, desde + 12);
    s.index = aqui - desde;
    return JSON.stringify(s);
  } catch { return ''; }
}

const buscadores = url => { try { return !!ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs').SearchService.parseSubmissionURL(url)?.terms; } catch { return false; } };

/** Las páginas vivas del estudio de un espacio, en todas las ventanas. */
function vivas(espacio) {
  const out = [];
  for (const win of ventanas) {
    const st = state.get(win);
    if (!st || win.closed) continue;
    try {
      for (const tab of suyas(st, espacio)) {
        const id = idDe(tab), url = tab.linkedBrowser?.currentURI?.spec ?? '';
        const direccion = guardable(url) ? url : direccionPendiente(win, tab);
        if (id && guardable(direccion)) out.push({ id, url: direccion, titulo: tab.label, estado: estadoDe(win, tab) });
      }
    } catch { /* una ventana que se está cerrando no para a las demás */ }
  }
  return out;
}
/** Una pestaña que aún no se ha cargado (vuelve dormida) dice su dirección en su historial. */
function direccionPendiente(win, tab) {
  try { const s = JSON.parse(win.SessionStore.getTabState(tab)); return s.entries?.[(s.index ?? s.entries.length) - 1]?.url ?? s.userTypedValue ?? ''; } catch { return ''; }
}

function apuntar(espacio) {
  if (!tienda.datos) return;
  const antes = JSON.stringify(tienda.datos.espacios[espacio] ?? []);
  const ahora = vivas(espacio);
  tienda.datos = anotar(tienda.datos, espacio, ahora);
  // Los resultados de un buscador no vuelven una vez cerrados: son de paso.
  for (const p of tienda.datos.espacios[espacio] ?? []) if (!p.abierta && buscadores(p.url)) tienda.datos = quitar(tienda.datos, espacio, p.id);
  if (JSON.stringify(tienda.datos.espacios[espacio] ?? []) !== antes) guardar();
}
function apuntarPronto(st) {
  st.win.clearTimeout(st.espera);
  const espacio = espacioActual(st);
  st.espera = st.win.setTimeout(() => { if (state.get(st.win) === st && st.en) apuntar(espacio); pintarPanel(st); }, 800);
}

// ---------------------------------------------------------------- entrar, salir y colocar

function pestanaNueva(st) {
  const { win } = st;
  const tab = win.gBrowser.addTrustedTab(win.BROWSER_NEW_TAB_URL ?? 'about:newtab', { skipAnimation: true });
  return tab;
}

/** Desde Gecko 159, cerrar la última pestaña que se ve cierra la ventana, aunque tenga otras escondidas (las de fuera del
 *  estudio, o las de otro perfil). Antes de cerrarla se abre una nueva; sin escondidas, como siempre. */
function sinCerrarLaVentana(st) {
  const { gBrowser } = st.win;
  const suyos = { removeTab: gBrowser.removeTab, removeTabs: gBrowser.removeTabs };
  const antes = cierran => {
    const quedan = [...gBrowser.tabs].filter(tab => !tab.closing && !cierran.includes(tab));
    if (!cierran.length || quedan.some(tab => !tab.hidden) || !quedan.length || !cierran.some(tab => tab.selected)) return;
    const nueva = pestanaNueva(st);
    if (st.en && !idDe(nueva)) marcar(nueva, idNuevo());
    gBrowser.selectedTab = nueva;
  };
  const seguro = cierran => { try { antes(cierran); } catch (error) { console.error('Kitsune Zero: estudio', error); } };
  const mios = {
    removeTab(tab, ...resto) { if (state.get(st.win) === st) seguro([tab]); return suyos.removeTab.call(this, tab, ...resto); },
    removeTabs(tabs, ...resto) { const lista = [...tabs]; if (state.get(st.win) === st) seguro(lista); return suyos.removeTabs.call(this, lista, ...resto); },
  };
  Object.assign(gBrowser, mios);
  // Si otra pieza los ha envuelto después, no se quitan: sin este estado ya no hacen nada.
  return () => { for (const name of Object.keys(mios)) if (gBrowser[name] === mios[name]) delete gBrowser[name]; };
}

/** Enseña las pestañas de lo que toca (estudio o no) y esconde las demás, en el espacio de ahora. */
function colocar(st) {
  const { win } = st, { gBrowser } = win;
  if (st.colocando) return;
  st.colocando = true;
  try {
    const tabs = suyas(st);
    const p = plan(tabs.map(tab => ({ estudio: !!idDe(tab), fijada: false, oculta: tab.hidden, elegida: tab.selected, vista: tab.lastAccessed })), st.en);
    let elegida = p.elegir >= 0 ? tabs[p.elegir] : null;
    // Sin los modos (o sin Zero) no hay libro con el que volver: nada se queda escondido.
    if (st.sinModos) { for (const tab of tabs) if (tab.hidden) gBrowser.showTab(tab); return; }
    for (const i of p.mostrar) gBrowser.showTab(tabs[i]);
    if (!elegida && !(gBrowser.selectedTab.pinned && !st.en)) elegida = pestanaNueva(st);
    if (elegida && st.en && !idDe(elegida)) marcar(elegida, idNuevo());
    if (elegida && gBrowser.selectedTab !== elegida && !gBrowser.selectedTab.pinned) gBrowser.selectedTab = elegida;
    else if (elegida && gBrowser.selectedTab.pinned && st.entrando) gBrowser.selectedTab = elegida;
    // Gecko no esconde la elegida: primero se cambia y luego se esconden las demás.
    for (const i of p.esconder) if (tabs[i] !== gBrowser.selectedTab) gBrowser.hideTab(tabs[i], 'kitsune-zero-estudio');
  } finally { st.colocando = false; }
}

/** Abre (dormidas) las páginas apuntadas que no estén ya en ninguna ventana. */
function volver(st, espacio) {
  const hay = new Set();
  for (const otra of ventanas) { if (otra.closed) continue; try { for (const tab of otra.gBrowser.tabs) if (!tab.closing && idDe(tab)) hay.add(idDe(tab)); } catch { /* cerrándose */ } }
  for (const p of porAbrir(tienda.datos, espacio, hay)) abrirPagina(st, p);
}

function abrirPagina(st, p, { delante = false } = {}) {
  const { win } = st;
  let estado = null;
  try { estado = p.estado ? JSON.parse(p.estado) : null; } catch { /* sin estado */ }
  const userContextId = Number.isInteger(estado?.userContextId) ? estado.userContextId : 0;
  const perezosa = !delante;
  const tab = win.gBrowser.addTrustedTab(p.url, { skipAnimation: true, createLazyBrowser: perezosa, inBackground: true, userContextId, ...(perezosa ? { noInitialLabel: true } : {}) });
  marcar(tab, p.id);
  if (estado?.entries?.length) {
    try {
      const space = win.SessionStore.getCustomTabValue(tab, 'kitsuneSpace');
      win.SessionStore.setTabState(tab, { ...estado, hidden: false, extData: { ...(space ? { kitsuneSpace: space } : {}), [CLAVE]: p.id } });
    } catch { /* con su dirección basta */ }
  }
  if (p.titulo && perezosa) { try { win.gBrowser.setInitialTabTitle(tab, p.titulo); } catch { /* su dirección */ } }
  if (delante) win.gBrowser.selectedTab = tab;
  return tab;
}

async function mirar(st) {
  const { win } = st;
  const espacio = espacioActual(st), en = estudiando(st, espacio);
  if (en === st.en && espacio === st.espacio) { if (st.listo) colocar(st); return; }
  const antes = { en: st.en, espacio: st.espacio };
  if (antes.en && antes.espacio) { apuntar(antes.espacio); setBloc(st); }
  st.en = en;
  st.espacio = espacio;
  win.document.documentElement.toggleAttribute('zero-estudio', en);
  cerrarPanel(st);
  if (!en) { if (st.listo || antes.en) colocar(st); return; }
  try { await cargar(); } catch { /* sin llave: se estudia igual, sin recordar */ }
  // La sesión de Gecko puede estar devolviendo las pestañas: primero, ella.
  try { await win.SessionStore.promiseAllWindowsRestored; } catch { /* sin sesión */ }
  if (state.get(win) !== st || !st.en || st.espacio !== espacio) return;
  st.entrando = true;
  // Vuelven en la ventana que se está usando (si hay varias en Estudio, no en todas).
  const activa = Services.wm.getMostRecentWindow('navigator:browser');
  if (tienda.datos && (activa === win || !ventanas.has(activa) || !state.get(activa)?.en)) volver(st, espacio);
  colocar(st);
  st.entrando = false;
  apuntarPronto(st);
  if (bloc(st)) notas.mostrar(win, true, { volver: true });
}
const bloc = st => { try { return st.host.prefs.getBoolPref(prefName(st.host.prefix, BLOC), true); } catch { return true; } };
const setBloc = st => { try { st.host.prefs.setBoolPref(prefName(st.host.prefix, BLOC), notas.abierto(st.win)); } catch { /* sin ajustes */ } };

// ---------------------------------------------------------------- el panel: las páginas del estudio

function pintarPanel(st) {
  if (!st.panel.hasAttribute('open')) return;
  const doc = st.win.document, t = st.t, espacio = espacioActual(st);
  const lista = tienda.datos?.espacios[espacio] ?? [], hay = new Map(suyas(st).map(tab => [idDe(tab), tab]));
  st.lista.replaceChildren(...lista.map(p => {
    const icono = el(doc, 'img', { src: `page-icon:${p.url}`, alt: '' });
    const fila = el(doc, 'div', { class: 'ze-pagina', role: 'listitem', 'data-id': p.id }, [
      el(doc, 'button', { type: 'button', class: 'ze-ir', title: p.url }, [icono, el(doc, 'span', {}, [p.titulo || p.url])]),
      el(doc, 'button', { type: 'button', class: 'ze-quitar', title: t('Quitar del estudio', 'Remove from the study'), 'aria-label': t(`Quitar ${p.titulo || p.url} del estudio`, `Remove ${p.titulo || p.url} from the study`) }),
    ]);
    fila.toggleAttribute('cerrada', !hay.has(p.id));
    return fila;
  }));
  st.nada.hidden = lista.length > 0;
}
function abrirPanel(st) {
  apuntar(espacioActual(st));
  st.panel.setAttribute('open', '');
  pintarPanel(st);
  const r = st.win.document.querySelector('#zero-mode > [data-mode="study"]')?.getBoundingClientRect();
  if (r) {
    st.panel.style.left = `${Math.round(r.right + 16)}px`;
    st.panel.style.top = `${Math.round(Math.max(8, Math.min(r.top - 10, st.win.innerHeight - st.panel.offsetHeight - 8)))}px`;
  }
}
function cerrarPanel(st) { st.panel?.removeAttribute('open'); }

function quitarDelEstudio(st, id) {
  const espacio = espacioActual(st);
  const tab = suyas(st).find(item => idDe(item) === id);
  if (tienda.datos) { tienda.datos = quitar(tienda.datos, espacio, id); guardar(); }
  if (tab) {
    desmarcar(tab);
    // Se queda abierta, con lo de fuera del estudio.
    if (tab.selected) { const otra = suyas(st).find(item => item !== tab && idDe(item)) ?? pestanaNueva(st); if (!idDe(otra)) marcar(otra, idNuevo()); st.win.gBrowser.selectedTab = otra; }
    st.win.gBrowser.hideTab(tab, 'kitsune-zero-estudio');
  }
  pintarPanel(st);
}

/** Otro clic en el libro, estudiando: las páginas del estudio. Lo llama zero-profiles. */
export function alPulsar(win) {
  const st = state.get(win);
  if (!st?.en) return;
  if (st.panel.hasAttribute('open')) cerrarPanel(st); else abrirPanel(st);
}
export const enEstudio = win => !!state.get(win)?.en;

// ---------------------------------------------------------------- montar y desmontar

export function attach(win, ctx) {
  const doc = win.document, { host } = ctx;
  if (!doc.getElementById('zero-mode') || !win.gBrowser || !win.SessionStore || win.PrivateBrowsingUtils?.isWindowPrivate(win)) return;
  const t = host.t ?? (es => es);
  const st = { win, host, t, cleanups: [], en: false, espacio: null, listo: false, colocando: false, entrando: false };
  state.set(win, st);
  ventanas.add(win);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };

  st.lista = el(doc, 'div', { class: 'ze-lista', role: 'list' });
  st.nada = el(doc, 'p', { class: 'ze-nada' }, [t('Lo que abras aquí se queda guardado.', 'Whatever you open here is kept.')]);
  st.panel = el(doc, 'section', { id: 'zero-estudio', role: 'dialog', 'aria-label': t('Tu estudio', 'Your study') }, [
    el(doc, 'h4', {}, [t('Tu estudio', 'Your study')]), st.lista, st.nada,
    el(doc, 'small', {}, [t('Aunque las cierres, vuelven cuando entres.', 'Even if you close them, they come back next time.')]),
  ]);
  doc.body.append(st.panel);
  st.cleanups.push(() => { win.clearTimeout(st.espera); st.panel.remove(); doc.documentElement.removeAttribute('zero-estudio'); });
  st.lista.addEventListener('click', event => {
    const id = event.target.closest('.ze-pagina')?.dataset.id;
    if (!id) return;
    if (event.target.closest('.ze-quitar')) { quitarDelEstudio(st, id); return; }
    const tab = suyas(st).find(item => idDe(item) === id);
    if (tab) win.gBrowser.selectedTab = tab;
    else { const p = tienda.datos?.espacios[espacioActual(st)]?.find(item => item.id === id); if (p) abrirPagina(st, p, { delante: true }); }
    cerrarPanel(st);
  });
  listen(win, 'mousedown', event => { if (st.panel.hasAttribute('open') && !st.panel.contains(event.target) && !doc.getElementById('zero-mode')?.contains(event.target)) cerrarPanel(st); }, true);
  listen(win, 'keydown', event => { if (event.key === 'Escape') cerrarPanel(st); }, true);

  const tabs = win.gBrowser.tabContainer;
  listen(tabs, 'TabOpen', event => {
    const tab = event.target;
    // Las que devuelve la sesión traen lo suyo; las demás, del modo en que se abren.
    if (st.en && !st.colocando && !tab.pinned && !idDe(tab)) marcar(tab, idNuevo());
    if (st.en) apuntarPronto(st);
  });
  listen(tabs, 'TabClose', event => {
    const tab = event.target;
    if (!tab.pinned && st.en && espacioDe(st, tab) === espacioActual(st)) apuntarPronto(st);
  });
  st.cleanups.push(sinCerrarLaVentana(st));
  listen(tabs, 'TabSelect', event => {
    const tab = event.target;
    if (st.colocando || !st.listo || tab.pinned || win.gBrowser._removingTabs?.size || espacioActual(st) !== st.espacio || espacioDe(st, tab) !== st.espacio) return;
    // Se ha ido a una de fuera del estudio (desde la barra de direcciones): se viene al estudio. Y al revés, sale de él.
    if (!!idDe(tab) !== st.en) { if (st.en) marcar(tab, idNuevo()); else desmarcar(tab); colocar(st); }
    if (st.en) apuntarPronto(st);
  });
  for (const type of ['TabMove', 'TabPinned', 'TabUnpinned', 'SSTabRestored']) listen(tabs, type, () => { if (st.en) apuntarPronto(st); });
  const progreso = { onLocationChange(browser, wp) { if (wp?.isTopLevel && st.en) apuntarPronto(st); } };
  win.gBrowser.addTabsProgressListener(progreso);
  st.cleanups.push(() => win.gBrowser?.removeTabsProgressListener(progreso));
  listen(win, 'SSWindowRestored', () => void mirar(st));
  listen(win, 'SSWindowClosing', () => { if (st.en) { apuntar(espacioActual(st)); setBloc(st); } });
  // La ventana se cierra: nada que recolocar; solo dejar de contar con ella.
  listen(win, 'unload', () => { state.delete(win); ventanas.delete(win); void guardarYa(); }, { once: true });

  // Quitarla del estudio desde la pestaña (la barra de Gecko no se ve en Zero, pero su menú lo usa el raíl).
  const menuPestana = doc.getElementById('tabContextMenu');
  if (menuPestana) {
    const item = doc.createXULElement('menuitem');
    item.id = 'zero-menu-estudio';
    item.setAttribute('label', t('Quitar del estudio', 'Remove from the study'));
    const tab = () => win.TabContextMenu?.contextTab;
    item.addEventListener('command', () => { const id = tab() && idDe(tab()); if (id) quitarDelEstudio(st, id); });
    menuPestana.append(item);
    const antes = event => { if (event.target === menuPestana) item.hidden = !(st.en && tab() && idDe(tab())); };
    menuPestana.addEventListener('popupshowing', antes);
    st.cleanups.push(() => { menuPestana.removeEventListener('popupshowing', antes); item.remove(); });
  }

  // El modo (de este perfil), el perfil, y encender o apagar los modos.
  const alCambiar = () => void mirar(st);
  const observer = { observe: alCambiar };
  for (const key of [MODOS, PREFS.focus]) { host.prefs.addObserver(prefName(host.prefix, key), observer); st.cleanups.push(() => host.prefs.removeObserver(prefName(host.prefix, key), observer)); }
  try { const dejar = host.spaces?.watch(win, alCambiar); if (dejar) st.cleanups.push(dejar); } catch { /* sin espacios */ }
  const empezar = async () => {
    try { await win.SessionStore.promiseAllWindowsRestored; } catch { /* sin sesión */ }
    if (state.get(win) !== st) return;
    st.listo = true;
    await mirar(st);
    // Si la última vez se cerró estudiando y ahora no toca, las del estudio se quedan escondidas.
    if (state.get(win) === st && !st.en) colocar(st);
  };
  void empezar().catch(error => console.error('Kitsune Zero: estudio', error));
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  if (st.en) { apuntar(espacioActual(st)); setBloc(st); st.en = false; }
  if (!win.closed) { st.sinModos = true; try { colocar(st); } catch { /* la ventana se cierra */ } }
  void guardarYa();
  state.delete(win);
  ventanas.delete(win);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}

/** Para las pruebas. */
export const _debug = { estado: win => state.get(win), tienda, cargar, guardarYa, idDe, mirar: win => mirar(state.get(win)), olvidar: () => { tienda.datos = null; tienda.cargando = null; } };
