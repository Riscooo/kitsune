/* Kitsune Zero · el rotulador: subrayar en las webs (y en los PDF) y llevar lo marcado al bloc.
 *
 * Risco (23-11): «que se puedan destacar palabras, que puedas usar un subrayador, y meter esas letras que tú quieras
 * seleccionar en el block de notas, para que puedas llevar ahí tu estudio». Y «que no sobresature»: la píldora (tres
 * colores y «Al bloc») solo sale junto a lo seleccionado cuando el bloc está abierto o en modo Estudio. Sin ella, lo mismo
 * está en el clic derecho.
 *
 * Los subrayados se guardan cifrados en el perfil, por página, con el texto de alrededor para volver a encontrarlos
 * (TextQuoteSelector del W3C). En las ventanas privadas se pinta, pero no se guarda nada ni se apunta la dirección.
 */
import { pagina, subrayadosLimpios, idNuevo, COLORES } from './zero-notas.mjs';
import * as cofre from './zero-cofre.sys.mjs';
import * as notas from './zero-notas.sys.mjs';
import { sumar } from './zero-stats.sys.mjs';
import { setTimeout, clearTimeout } from 'resource://gre/modules/Timer.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const ACTOR = 'KitsuneZeroNotas';
const state = new WeakMap();
const tienda = { datos: null, cargando: null, espera: null, tocada: false };
let usos = 0;

const el = (doc, tag, attrs = {}, kids = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
};
const privada = win => { try { return !!win.PrivateBrowsingUtils?.isWindowPrivate(win); } catch { return false; } };

// ---------------------------------------------------------------- los subrayados guardados

function cargar() {
  tienda.cargando ??= (async () => {
    // Sin nada guardado no hace falta ni abrir el cofre.
    const hay = await IOUtils.exists(PathUtils.join(cofre.carpeta(), 'subrayados.cofre')).catch(() => false);
    tienda.datos = hay ? subrayadosLimpios(await cofre.leer('subrayados')) : {};
  })();
  tienda.cargando.catch(error => { console.error('Kitsune Zero: subrayados', error); tienda.cargando = null; });
  return tienda.cargando;
}
async function guardarYa() {
  clearTimeout(tienda.espera);
  if (!tienda.tocada || !tienda.datos) return;
  tienda.tocada = false;
  try { await cofre.guardar('subrayados', tienda.datos); } catch (error) { tienda.tocada = true; console.error('Kitsune Zero: subrayados', error); }
}
function guardar() {
  tienda.tocada = true;
  clearTimeout(tienda.espera);
  tienda.espera = setTimeout(() => void guardarYa(), 500);
  if (!tienda.alCerrar) {
    tienda.alCerrar = true;
    ChromeUtils.importESModule('resource://gre/modules/AsyncShutdown.sys.mjs').AsyncShutdown.profileBeforeChange.addBlocker('Kitsune Zero: guardar los subrayados', () => guardarYa());
  }
}

// ---------------------------------------------------------------- el actor

const ventanaDe = actor => {
  const browser = actor.browsingContext?.top?.embedderElement;
  const win = browser && (browser.documentGlobal ?? browser.ownerGlobal);
  return win?.gBrowser?.getTabForBrowser?.(browser) ? win : null;
};
// La dirección, la que sabe Kitsune (no la que diga la web).
const paginaDe = actor => { try { return pagina(actor.manager.documentURI.spec); } catch { return ''; } };

export class KitsuneZeroNotasParent extends JSWindowActorParent {
  async receiveMessage({ name, data }) {
    const win = ventanaDe(this), st = win && state.get(win);
    if (!st) return;
    const numeros = data && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(data[k]));
    switch (name) {
      case 'ZeroNotas:lista': {
        if (privada(win)) return;
        await cargar().catch(() => {});
        const lista = tienda.datos?.[paginaDe(this)];
        if (lista) this.sendAsyncMessage('ZeroNotas:pintar', lista);
        break;
      }
      case 'ZeroNotas:seleccion':
        if (numeros && activo(win, st)) mostrar(win, st, this, data, null);
        break;
      case 'ZeroNotas:pulsado':
        if (numeros && typeof data.id === 'string') mostrar(win, st, this, data, data.id);
        break;
      case 'ZeroNotas:nada':
        esconder(st);
        break;
    }
  }

  didDestroy() {
    const win = ventanaDe(this), st = win && state.get(win);
    if (st?.actor === this) esconder(st);
  }
}

function registrar() {
  if (usos++ > 0) return;
  try {
    ChromeUtils.registerWindowActor(ACTOR, {
      parent: { esModuleURI: import.meta.url },
      child: {
        esModuleURI: new URL('./zero-rotulador-child.sys.mjs', import.meta.url).href,
        events: {
          mouseup: { mozSystemGroup: true, capture: true }, keyup: { mozSystemGroup: true, capture: true }, mousedown: { mozSystemGroup: true, capture: true },
          click: { mozSystemGroup: true }, scroll: { capture: true, passive: true, mozSystemGroup: true, createActor: false },
          DOMContentLoaded: {}, pageshow: { mozSystemGroup: true },
        },
      },
      allFrames: true,
      matches: ['http://*/*', 'https://*/*', 'file:///*'],
      messageManagerGroups: ['browsers'],
      safeForUntrustedWebProcess: true, // avisa de dónde hay algo seleccionado; el texto se le pide, y se comprueba aquí
    });
  } catch { /* ya estaba */ }
}
function dejarActor() {
  if (--usos > 0) return;
  usos = 0;
  try { ChromeUtils.unregisterWindowActor(ACTOR); } catch { /* ya no estaba */ }
}

// ---------------------------------------------------------------- la píldora

const activo = (win, st) => notas.abierto(win) || win.document.documentElement.hasAttribute('zero-estudio');

function mostrar(win, st, actor, rect, id) {
  st.actor = actor;
  st.id = id;
  st.pildora.toggleAttribute('puesto', !!id);
  const k = win.devicePixelRatio || 1;
  // De la pantalla (píxeles físicos) a la ventana.
  const x = rect.x / k - win.mozInnerScreenX, y = rect.y / k - win.mozInnerScreenY, w = rect.w / k, h = rect.h / k;
  st.pildora.setAttribute('open', '');
  const caja = st.pildora.getBoundingClientRect();
  const left = Math.max(8, Math.min(win.innerWidth - caja.width - 8, x + w / 2 - caja.width / 2));
  const arriba = y - caja.height - 10, top = arriba > 44 ? arriba : Math.min(win.innerHeight - caja.height - 8, y + h + 10);
  st.pildora.style.left = `${Math.round(left)}px`;
  st.pildora.style.top = `${Math.round(top)}px`;
}
function esconder(st) { st.pildora.removeAttribute('open'); st.actor = null; st.id = null; }

async function subrayar(win, st, actor, color) {
  const id = idNuevo();
  let s;
  try { s = await actor.sendQuery('ZeroNotas:marcar', { color, id }); } catch { return; }
  if (!s || s.id !== id) return;
  sumar('subrayados');
  if (privada(win)) return;
  await cargar().catch(() => {});
  const donde = paginaDe(actor);
  if (!tienda.datos || !donde) return;
  tienda.datos = subrayadosLimpios({ ...tienda.datos, [donde]: [...(tienda.datos[donde] ?? []), { ...s, cuando: Date.now() }] });
  guardar();
}

function quitar(win, actor, id) {
  try { actor.sendAsyncMessage('ZeroNotas:quitar', { id }); } catch { /* la página se fue */ }
  const donde = paginaDe(actor);
  if (!tienda.datos?.[donde]) return;
  const queda = tienda.datos[donde].filter(s => s.id !== id);
  if (queda.length) tienda.datos[donde] = queda; else delete tienda.datos[donde];
  guardar();
}

async function alBloc(win, st, actor, id) {
  let texto = '';
  if (id) texto = tienda.datos?.[paginaDe(actor)]?.find(s => s.id === id)?.exacto ?? '';
  if (!texto) { try { texto = await actor.sendQuery('ZeroNotas:texto'); } catch { return; } }
  texto = String(texto ?? '').slice(0, 20_000);
  if (!texto.trim()) return;
  // El origen es el de la pestaña (en un marco, la página que lo lleva). En una ventana privada, ninguno.
  const browser = actor.browsingContext?.top?.embedderElement;
  const de = privada(win) || !browser ? null : { url: browser.currentURI?.spec ?? '', titulo: browser.contentTitle || browser.currentURI?.host || '' };
  await notas.citar(win, texto, de);
}

/** El actor de lo que se ve (el de la pestaña elegida), para los atajos. */
function actorDe(win) {
  try { return win.gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.getActor(ACTOR); } catch { return null; }
}

// ---------------------------------------------------------------- el clic derecho

function menu(win, st) {
  const doc = win.document, popup = doc.getElementById('contentAreaContextMenu');
  if (!popup) return;
  const item = (id, label, run) => {
    const node = doc.createXULElement('menuitem');
    node.id = id;
    node.setAttribute('label', label);
    node.addEventListener('command', run);
    return node;
  };
  // El marco del clic (puede ser uno de dentro de la página).
  const actor = () => { try { return (win.gContextMenu?.contentData?.frameBrowsingContext ?? win.gContextMenu?.browser?.browsingContext)?.currentWindowGlobal.getActor(ACTOR) ?? null; } catch { return actorDe(win); } };
  let suyo = null;
  const items = [
    item('zero-menu-subrayar', st.t('Subrayar', 'Highlight'), () => { if (suyo) void subrayar(win, st, suyo, COLORES[0]); }),
    item('zero-menu-bloc', st.t('Llevar al bloc de notas', 'Send to notes'), () => { if (suyo) void alBloc(win, st, suyo, null); }),
  ];
  const copiar = doc.getElementById('context-copy');
  if (copiar?.parentNode === popup) copiar.after(...items); else popup.append(...items);
  const antes = event => {
    if (event.target !== popup) return;
    const cm = win.gContextMenu;
    const on = !!(cm?.isTextSelected || cm?.isContentSelected) && !cm?.onEditable && !!cm?.browser && !!win.gBrowser.getTabForBrowser(cm.browser);
    suyo = on ? actor() : null;
    for (const node of items) node.hidden = !suyo;
    esconder(st);
  };
  popup.addEventListener('popupshowing', antes);
  st.cleanups.push(() => { popup.removeEventListener('popupshowing', antes); for (const node of items) node.remove(); });
}

// ---------------------------------------------------------------- montar y desmontar

export function attach(win, ctx) {
  const doc = win.document, { host } = ctx;
  if (!win.gBrowser || !host?.prefs) return;
  const t = host.t ?? (es => es);
  const st = { host, t, cleanups: [], actor: null, id: null };
  state.set(win, st);
  registrar();
  st.cleanups.push(dejarActor);
  const nombres = { amarillo: t('Subrayar en amarillo', 'Highlight in yellow'), verde: t('Subrayar en verde', 'Highlight in green'), rosa: t('Subrayar en rosa', 'Highlight in pink') };
  st.pildora = el(doc, 'div', { id: 'zero-rotulador', role: 'toolbar', 'aria-label': t('Lo seleccionado', 'Selection') }, [
    ...COLORES.map(color => el(doc, 'button', { type: 'button', class: 'zr-color', 'data-color': color, title: nombres[color], 'aria-label': nombres[color] })),
    el(doc, 'button', { type: 'button', class: 'zr-quitar' }, [t('Quitar', 'Remove')]),
    el(doc, 'button', { type: 'button', class: 'zr-bloc' }, [t('Al bloc', 'To notes')]),
  ]);
  doc.body.append(st.pildora);
  st.cleanups.push(() => st.pildora.remove());
  // Que pulsarla no le quite a la página lo seleccionado.
  st.pildora.addEventListener('mousedown', event => event.preventDefault());
  st.pildora.addEventListener('click', event => {
    const boton = event.target.closest('button'), { actor, id } = st;
    if (!boton || !actor) return;
    esconder(st);
    if (boton.dataset.color) void subrayar(win, st, actor, boton.dataset.color);
    else if (boton.classList.contains('zr-quitar')) quitar(win, actor, id);
    else void alBloc(win, st, actor, id);
  });
  const fuera = event => { if (!st.pildora.contains(event.target)) esconder(st); };
  win.addEventListener('mousedown', fuera, true);
  const tecla = event => { if (event.key === 'Escape') esconder(st); };
  win.addEventListener('keydown', tecla, true);
  const alIr = () => esconder(st);
  win.gBrowser.tabContainer.addEventListener('TabSelect', alIr);
  // Las webs que cambian de dirección sin cargar otra página: sus subrayados, los de la nueva.
  const progreso = {
    onLocationChange(browser, webProgress, request, location, flags) {
      if (!webProgress?.isTopLevel || !(flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT) || privada(win)) return;
      let actor = null;
      try { actor = browser.browsingContext.currentWindowGlobal.getActor(ACTOR); } catch { return; }
      const donde = pagina(location.spec);
      if (actor.zeroPagina === donde) return;
      actor.zeroPagina = donde;
      if (tienda.datos) actor.sendAsyncMessage('ZeroNotas:pintar', tienda.datos[donde] ?? []);
    },
  };
  win.gBrowser.addTabsProgressListener(progreso);
  st.cleanups.push(() => {
    win.removeEventListener('mousedown', fuera, true);
    win.removeEventListener('keydown', tecla, true);
    win.gBrowser?.tabContainer?.removeEventListener('TabSelect', alIr);
    win.gBrowser?.removeTabsProgressListener(progreso);
  });
  menu(win, st);
  host.keys?.add(win, 'kitsune-zero-subrayar-key', 'H', 'accel,alt', () => { const actor = state.has(win) && actorDe(win); if (actor) { esconder(state.get(win)); void subrayar(win, state.get(win), actor, COLORES[0]); } });
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  void guardarYa();
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}

/** Para las pruebas. */
export const _debug = { estado: win => state.get(win), tienda, subrayar: (win, color = COLORES[0]) => subrayar(win, state.get(win), actorDe(win), color), alBloc: win => alBloc(win, state.get(win), actorDe(win), null), guardarYa, olvidar: () => { tienda.datos = null; tienda.cargando = null; } };
