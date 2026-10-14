/* Kitsune Zero · cristal en vivo sobre la web.
 *
 * El desenfoque de CSS (backdrop-filter) no ve la web: la pinta otro proceso. Cada pieza de cristal
 * que queda encima de la web (la isla y el raíl con la web ampliada, el raíl abierto, los botones de
 * ampliar, los ajustes) lleva justo debajo un <canvas> con una foto desenfocada de lo que tiene
 * detrás; el fondo, los filos de luz y el desenfoque de la pieza quedan encima, como siempre. De esa
 * foto sale la luz: el texto pasa a tinta sobre lo claro (atributo zero-ink).
 *
 * Para que vaya fluido, el lienzo y la foto van por separado:
 * - el lienzo sigue a su pieza en cada fotograma (posición, tamaño, opacidad) y recorta la última
 *   foto, que ya está desenfocada: dibujarlo cuesta casi nada;
 * - la foto es solo del trozo que la pieza puede ocupar (medido: 3–5 ms, frente a 17–30 ms la vista
 *   entera), con margen arriba y abajo; entre foto y foto se desplaza con el scroll de la web, que
 *   cuenta zero-glass-child.sys.mjs desde dentro de la página;
 * - hay foto nueva solo si la web ha cambiado (teclas, una carga, otra pestaña, un vídeo sonando, el
 *   ratón sobre la web) o si el scroll ha salido del margen; como mucho, unas 15 por segundo.
 * Todo se para 1,5 s después de lo último que se movió. Con el modo ahorro, a 15 fps.
 */
import { lightOf, inkFor } from './zero-light.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const SCALE = 0.5;       // la foto, a mitad de resolución
const BLUR = 10;         // px de desenfoque, como el backdrop-filter del cristal
const PAD = 24;          // margen de la foto para que el desenfoque no oscurezca los bordes
const SLACK = 240;       // margen extra arriba y abajo: el scroll desplaza la foto sin hacer otra
const SHOT_GAP = 66;     // ms mínimos entre dos fotos de una misma pieza (~15 por segundo)
const MOUSE_GAP = 250;   // el ratón sobre la web cuenta como cambio como mucho cada 250 ms
const TAIL = 1500;       // ms que sigue vivo tras lo último que se movió
const SAVER_FRAME = 66;  // ~15 fps en modo ahorro
const ACTOR = 'KitsuneZeroGlass';

// Las propiedades que, al transicionar, mueven una pieza o la tarjeta (o la hacen aparecer).
const MOVES = /^(width|height|max-(width|height)|left|top|right|bottom|inset|transform|translate|scale|opacity|margin|padding|border-.*radius)/;

const panes = new Map();          // elemento → { win, canvas, ink, reach, shots: Map(browser → foto), … }
const engines = new WeakMap();    // ventana → { until, frame, timer, version, count, snapshots, … }
const scrolls = new WeakMap();    // <browser> → { x, y } (lo que cuenta la web)
const asking = new WeakSet();     // <browser> a los que ya se ha preguntado dónde están

// ---------------------------------------------------------------- el actor (lo que dice la web)

export class KitsuneZeroGlassParent extends JSWindowActorParent {
  receiveMessage({ name, data }) {
    if (name !== 'ZeroGlass:scroll') return;
    const browser = this.browsingContext.top?.embedderElement;
    if (!browser || !data) return;
    scrolls.set(browser, data);
    const win = browser.ownerGlobal;
    if (engines.has(win)) kick(win);
    // Para las piezas que quieran saber que se está bajando (el aviso de scroll infinito).
    try { win.dispatchEvent(new win.CustomEvent('zero-scroll', { detail: { browser } })); } catch { /* ventana cerrándose */ }
  }
}

let actorUsers = 0;

function useActor() {
  if (actorUsers++ > 0) return;
  try {
    ChromeUtils.registerWindowActor(ACTOR, {
      parent: { esModuleURI: import.meta.url },
      child: {
        esModuleURI: new URL('./zero-glass-child.sys.mjs', import.meta.url).href,
        events: { scroll: { mozSystemGroup: true }, pageshow: {} },
      },
      allFrames: false,
      messageManagerGroups: ['browsers'],
      safeForUntrustedWebProcess: true, // solo cuenta el scroll: nada que la web pueda aprovechar
    });
  } catch { /* ya estaba */ }
}

function dropActor() {
  if (--actorUsers > 0) return;
  actorUsers = 0;
  try { ChromeUtils.unregisterWindowActor(ACTOR); } catch { /* ya no estaba */ }
}

/** Dónde está el scroll de esa web; si aún no lo ha dicho, se le pregunta (y de momento, null). */
function scrollOf(browser) {
  const known = scrolls.get(browser);
  if (known) return known;
  if (!asking.has(browser)) {
    asking.add(browser);
    try {
      browser.browsingContext.currentWindowGlobal.getActor(ACTOR).sendQuery('ZeroGlass:where')
        .then(at => { if (at && !scrolls.has(browser)) scrolls.set(browser, at); kick(browser.ownerGlobal); })
        .catch(() => {}).finally(() => asking.delete(browser));
    } catch { asking.delete(browser); }
  }
  return null;
}

// ---------------------------------------------------------------- geometría

/** El antepasado del elemento que cuelga de <body>: el canvas va justo antes, a su misma altura. */
function topOf(element) {
  let node = element;
  while (node.parentNode && node.parentNode !== node.ownerDocument.body) node = node.parentNode;
  return node;
}

const box = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });

function intersect(a, b) {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right), bottom = Math.min(a.bottom, b.bottom);
  return right - left >= 1 && bottom - top >= 1 ? box(left, top, right, bottom) : null;
}

const union = (a, b) => box(Math.min(a.left, b.left), Math.min(a.top, b.top), Math.max(a.right, b.right), Math.max(a.bottom, b.bottom));

/** Las webs que se ven: la de la pestaña elegida y, con la vista dividida, las de al lado. */
function webs(win) {
  const panels = win.document.getElementById('tabbrowser-tabpanels');
  if (!panels) return [];
  return [...panels.querySelectorAll('.browserSidebarContainer')]
    .filter(panel => panel.classList.contains('deck-selected') || panel.classList.contains('split-view-panel-active'))
    .map(panel => panel.querySelector('browser[type="content"]'))
    .filter(browser => browser?.browsingContext?.currentWindowGlobal && browser.clientWidth);
}

// ---------------------------------------------------------------- las fotos

/** Foto del trozo que la pieza puede ocupar sobre esa web, ya desenfocada, en coordenadas del documento. */
async function shoot(win, eng, pane, browser, rect, reach, at) {
  const zoom = browser.fullZoom || 1;
  const area = intersect(box(reach.left - PAD, reach.top - PAD - SLACK, reach.right + PAD, reach.bottom + PAD + SLACK), rect);
  if (!area) return;
  // En píxeles del documento: lo que se ve más el scroll (drawSnapshot mide desde el principio).
  const doc = { x: (area.left - rect.left) / zoom + at.x, y: (area.top - rect.top) / zoom + at.y, w: area.width / zoom, h: area.height / zoom };
  const version = eng.version;
  const bitmap = await browser.browsingContext.currentWindowGlobal.drawSnapshot(new win.DOMRect(doc.x, doc.y, doc.w, doc.h), SCALE * zoom, 'white');
  try {
    if (!panes.has(pane.element)) return;
    const k = bitmap.width / doc.w; // píxeles de la foto por píxel del documento
    const blurred = new win.OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = blurred.getContext('2d');
    ctx.filter = `blur(${BLUR * SCALE}px) saturate(1.7)`;
    // Un poco más grande que la foto: así el desenfoque no oscurece los bordes.
    ctx.drawImage(bitmap, -2, -2, bitmap.width + 4, bitmap.height + 4);
    pane.shots.set(browser, { canvas: blurred, doc, k, version });
    eng.snapshots += 1;
    eng.lastShot = { w: Math.round(area.width), h: Math.round(area.height) };
  } finally {
    bitmap.close?.();
  }
}

/** ¿Cabe en la foto lo que hay debajo de la pieza ahora? */
function covers(shot, need) {
  return need.x >= shot.doc.x - 0.5 && need.y >= shot.doc.y - 0.5
    && need.x + need.w <= shot.doc.x + shot.doc.w + 0.5 && need.y + need.h <= shot.doc.y + shot.doc.h + 0.5;
}

/** ¿Hace falta otra foto? Si no hay, si la web ha cambiado desde la última o si lo que se ve ya no
 *  cabe en ella (el scroll ha salido del margen, o la pieza ha crecido). */
function stale(eng, shot, need) {
  return !shot || shot.version < eng.version || !covers(shot, need);
}

// ---------------------------------------------------------------- cada fotograma

function hide(element, pane) {
  if (!pane.canvas.hidden) pane.canvas.hidden = true;
  pane.ink = 'white';
  element.removeAttribute('zero-ink');
}

/** Coloca el lienzo de una pieza y lo dibuja con la última foto. Devuelve si ha dibujado algo. */
function frame(win, eng, element, pane, browsers) {
  const cs = win.getComputedStyle(element);
  const top = topOf(element);
  const opacity = Number(cs.opacity) * Number(win.getComputedStyle(top).opacity);
  const r = element.getBoundingClientRect();
  if (r.width < 1 || r.height < 1 || opacity <= 0.01 || cs.visibility === 'hidden') return hide(element, pane), false;
  const here = box(r.left, r.top, r.right, r.bottom);
  const hits = browsers.map(browser => ({ browser, rect: browser.getBoundingClientRect() }))
    .map(hit => ({ ...hit, part: intersect(here, hit.rect) })).filter(hit => hit.part);
  if (!hits.length) return hide(element, pane), false;

  // El lienzo, en el sitio de la pieza en este mismo fotograma.
  const { canvas } = pane;
  const style = canvas.style;
  style.left = `${r.left}px`; style.top = `${r.top}px`;
  style.width = `${r.width}px`; style.height = `${r.height}px`;
  style.borderRadius = cs.borderRadius;
  style.opacity = String(opacity);
  style.zIndex = win.getComputedStyle(top).zIndex;
  const width = Math.max(1, Math.ceil(r.width * SCALE)), height = Math.max(1, Math.ceil(r.height * SCALE));
  const resized = canvas.width !== width || canvas.height !== height;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d');
  const draws = [];
  let waiting = false;
  const now = Date.now();
  for (const { browser, rect, part } of hits) {
    const at = scrollOf(browser);
    if (!at) continue;
    const zoom = browser.fullZoom || 1;
    // Lo que hay debajo de la pieza, en píxeles del documento.
    const need = { x: (part.left - rect.left) / zoom + at.x, y: (part.top - rect.top) / zoom + at.y, w: part.width / zoom, h: part.height / zoom };
    const shot = pane.shots.get(browser);
    if (stale(eng, shot, need) && !pane.shooting && now - pane.shotAt >= SHOT_GAP) {
      pane.shooting = true;
      pane.shotAt = now;
      const reach = pane.reach(here);
      shoot(win, eng, pane, browser, rect, intersect(union(reach, here), rect) ?? here, at)
        .catch(() => {}).finally(() => { pane.shooting = false; kick(win, 200); });
    }
    if (!shot) continue;
    if (!covers(shot, need)) waiting = true; // un salto más allá del margen: llega otra foto enseguida
    // La foto, desplazada con el scroll: se recorta justo lo que hay debajo ahora.
    draws.push([shot.canvas, (need.x - shot.doc.x) * shot.k, (need.y - shot.doc.y) * shot.k, need.w * shot.k, need.h * shot.k,
      (part.left - r.left) * SCALE, (part.top - r.top) * SCALE, part.width * SCALE, part.height * SCALE]);
  }
  // Mientras llega la foto de un salto, se queda lo que había (borrarlo dejaría un instante sin cristal).
  if (waiting && !resized && !canvas.hidden) return true;
  if (!draws.length) return hide(element, pane), false;
  ctx.clearRect(0, 0, width, height);
  for (const args of draws) ctx.drawImage(...args);
  canvas.hidden = false;
  // La luz, de vez en cuando (no cambia de un fotograma a otro).
  if (eng.ticks % 6 === 0 || pane.ink === undefined) {
    pane.ink = inkFor(lightOf(ctx.getImageData(0, 0, width, height).data), pane.ink);
    element.toggleAttribute('zero-ink', pane.ink === 'ink');
  }
  return true;
}

/** ¿Hay algo que se mueve solo? Un vídeo o un audio sonando en una web que se ve. */
function playing(win) {
  return webs(win).some(browser => win.gBrowser.getTabForBrowser(browser)?.hasAttribute('soundplaying'));
}

function loop(win) {
  const eng = engines.get(win);
  if (!eng) return;
  eng.frame = 0; eng.timer = 0;
  const live = Date.now() <= eng.until || playing(win);
  if (!live) return;
  if (playing(win) && Date.now() - eng.changedAt > SHOT_GAP) changed(eng); // lo que suena, se mueve
  eng.ticks += 1;
  const browsers = webs(win);
  let drawn = false;
  for (const [element, pane] of panes) {
    if (pane.win !== win) continue;
    try { drawn = frame(win, eng, element, pane, browsers) || drawn; } catch { hide(element, pane); }
  }
  if (drawn) eng.count += 1;
  let saver = false;
  try { saver = !!eng.host?.saver?.active; } catch { /* sin anfitrión */ }
  if (saver) eng.timer = win.setTimeout(() => loop(win), SAVER_FRAME);
  else eng.frame = win.requestAnimationFrame(() => loop(win));
}

function kick(win, ms = TAIL) {
  const eng = engines.get(win);
  if (!eng) return;
  eng.until = Math.max(eng.until, Date.now() + ms);
  if (!eng.frame && !eng.timer) loop(win);
}

/** La web ha podido cambiar: las fotos que haya se rehacen (como mucho, una cada SHOT_GAP). */
function changed(eng) {
  eng.version += 1;
  eng.changedAt = Date.now();
}

function engine(win, host) {
  if (engines.has(win)) return engines.get(win);
  const eng = { until: 0, frame: 0, timer: 0, version: 0, changedAt: 0, mouseAt: 0, ticks: 0, count: 0, snapshots: 0, lastShot: null, cleanups: [], host };
  engines.set(win, eng);
  useActor();
  eng.cleanups.push(dropActor);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); eng.cleanups.push(() => target.removeEventListener(type, fn, options)); };
  // Una ventana que se cierra en Zero no pasa por detach: se suelta aquí (si no, se quedaría en «panes»).
  listen(win, 'unload', () => detach(win), { once: true });
  const nudge = () => kick(win);
  const webChanged = () => { changed(eng); kick(win); };
  const overWeb = event => event.target?.localName === 'browser';
  // Lo que pasa en la web pasa antes por la ventana de Gecko. Las teclas y la rueda pueden cambiarla;
  // el ratón sobre la web también (lo que se ilumina al pasar), pero se cuenta con calma.
  listen(win, 'keydown', webChanged, { capture: true, passive: true });
  listen(win, 'wheel', nudge, { capture: true, passive: true }); // el scroll lo cuenta la web
  listen(win, 'mousemove', event => {
    if (overWeb(event) && Date.now() - eng.mouseAt > MOUSE_GAP) { eng.mouseAt = Date.now(); changed(eng); }
    kick(win);
  }, { capture: true, passive: true });
  listen(win, 'resize', webChanged, { capture: true, passive: true });
  // Las transiciones que mueven o cambian de tamaño u opacidad una pieza o la tarjeta (un color, como
  // el velo o la tinta, no cambia lo que hay debajo del cristal).
  const moves = event => {
    if (!MOVES.test(event.propertyName ?? '')) return;
    const target = event.target;
    if (win.document.getElementById('tabbrowser-tabpanels')?.contains(target)
        || [...panes].some(([element, pane]) => pane.win === win && (topOf(element).contains(target) || target.contains?.(element)))) kick(win);
  };
  for (const type of ['transitionrun', 'transitionend']) listen(win.document, type, moves, true);
  // Las piezas que se mueven con una animación propia (ampliar) lo avisan así.
  listen(win, 'zero-move', event => kick(win, (event.detail?.ms ?? 800) + 300));
  listen(win.gBrowser.tabContainer, 'TabSelect', webChanged);
  listen(win.gBrowser.tabContainer, 'TabAttrModified', event => { if (event.detail?.changed?.includes('soundplaying')) nudge(); });
  // Una página nueva (o que termina de cargar) en la ventana: su scroll se vuelve a preguntar.
  const progress = {
    onLocationChange: (browser, webProgress) => { if (webProgress?.isTopLevel) { scrolls.delete(browser); webChanged(); } },
    onStateChange: (browser, webProgress, request, flags) => { if (webProgress?.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_STOP) webChanged(); },
  };
  win.gBrowser.addTabsProgressListener(progress);
  eng.cleanups.push(() => win.gBrowser.removeTabsProgressListener(progress));
  return eng;
}

function stop(win) {
  const eng = engines.get(win);
  if (!eng) return;
  engines.delete(win);
  if (eng.frame) win.cancelAnimationFrame(eng.frame);
  if (eng.timer) win.clearTimeout(eng.timer);
  for (const undo of eng.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}

export const GlassPane = {
  /** Pone el cristal en vivo detrás de `element` (se ve solo cuando está encima de la web).
   *  `reach(caja)` dice hasta dónde puede llegar la pieza (la foto cubre eso, para que al crecer no
   *  tenga que esperar a otra); por omisión, su caja de ahora. */
  attach(element, win, host = null, { reach = here => here } = {}) {
    if (panes.has(element)) return;
    const doc = win.document;
    const canvas = doc.createElementNS(HTML, 'canvas');
    canvas.className = 'zero-glass';
    if (element.id) canvas.id = `zero-glass-${element.id}`;
    canvas.hidden = true;
    topOf(element).before(canvas);
    panes.set(element, { element, win, canvas, ink: 'white', reach, shots: new Map(), shooting: false, shotAt: 0 });
    engine(win, host);
    kick(win);
  },
  detach(element) {
    const pane = panes.get(element);
    if (!pane) return;
    panes.delete(element);
    pane.canvas.remove();
    element.removeAttribute('zero-ink');
    if (![...panes.values()].some(other => other.win === pane.win)) stop(pane.win);
  },
  /** Que se mueva un rato (para las piezas que se mueven sin evento propio). */
  kick: (win, ms) => kick(win, ms),
  /** Para las pruebas: piezas con cristal (todas las ventanas), lienzos dibujados, fotos hechas y
   *  el tamaño de la última (en píxeles de la ventana). */
  count: () => panes.size,
  repaints: win => engines.get(win)?.count ?? 0,
  snapshots: win => engines.get(win)?.snapshots ?? 0,
  lastShot: win => engines.get(win)?.lastShot ?? null,
};

// ---------------------------------------------------------------- la pieza

// Hasta dónde llega cada pieza (las medidas de zero.css): la isla, 560 px centrados al escribir; el
// raíl, 186 px abierto; el resto, su caja.
const ISLAND_MAX = 560, RAIL_OPEN = 186;
const PIECES = [
  { id: 'nav-bar', reach: here => { const middle = (here.left + here.right) / 2; return box(middle - ISLAND_MAX / 2, here.top, middle + ISLAND_MAX / 2, here.bottom); } },
  { id: 'zero-rail', reach: here => box(here.left, here.top, here.left + RAIL_OPEN, here.bottom) },
  { id: 'zero-grow' },
  { id: 'zero-lights' },
  { id: 'zero-settings' },
];

export function attach(win, ctx) {
  for (const { id, reach } of PIECES) {
    const element = win.document.getElementById(id);
    if (element) GlassPane.attach(element, win, ctx.host, reach ? { reach } : {});
  }
}

export function detach(win) {
  for (const [element, pane] of [...panes]) if (pane.win === win) GlassPane.detach(element);
  stop(win);
}
