/* Kitsune Zero · cristal en vivo sobre la web.
 *
 * El desenfoque de CSS (backdrop-filter) no ve la web: la pinta otro proceso. Cada pieza de cristal
 * que queda encima de la web (la isla y el raíl con la web ampliada, el raíl abierto, los botones de
 * ampliar) lleva justo debajo un <canvas> con la parte de una foto de la web (drawSnapshot a escala
 * 0,5) que tiene detrás, desenfocada y saturada; el fondo, los filos de luz y el desenfoque de la pieza quedan encima,
 * como siempre. De esa foto sale la luz: el texto pasa a tinta sobre lo claro (atributo zero-ink).
 *
 * Solo se repinta mientras algo se mueve (rueda, teclas, ratón, una pieza que se mueve, otra página,
 * un vídeo sonando), a 60 fps, y 1,5 s después se para. Con el modo ahorro, a 15 fps.
 */
import { lightOf, inkFor } from './zero-light.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const SCALE = 0.5;     // la foto, a mitad de resolución (medido: ~1 ms la vista entera)
const BLUR = 10;       // px de desenfoque, como el backdrop-filter del cristal
const PAD = 20;        // margen de la foto para que el desenfoque no oscurezca los bordes
const TAIL = 1500;     // ms que sigue repintando tras lo último que se movió
const SAVER_FRAME = 66; // ~15 fps en modo ahorro

// Las propiedades que, al transicionar, mueven una pieza o la tarjeta (o la hacen aparecer).
const MOVES = /^(width|height|max-(width|height)|left|top|right|bottom|inset|transform|translate|scale|opacity|margin|padding|border-.*radius)/;

const panes = new Map();         // elemento → { win, canvas, ink }
const engines = new WeakMap();   // ventana → { until, frame, timer, busy, count, cleanups, host }

/** El antepasado del elemento que cuelga de <body>: el canvas va justo antes, a su misma altura. */
function topOf(element) {
  let node = element;
  while (node.parentNode && node.parentNode !== node.ownerDocument.body) node = node.parentNode;
  return node;
}

function intersect(a, b) {
  const x = Math.max(a.left, b.left), y = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right), bottom = Math.min(a.bottom, b.bottom);
  return right - x >= 1 && bottom - y >= 1 ? { x, y, w: right - x, h: bottom - y } : null;
}

/** Las webs que se ven: la de la pestaña elegida y, con la vista dividida, las de al lado. */
function webs(win) {
  const panels = win.document.getElementById('tabbrowser-tabpanels');
  if (!panels) return [];
  return [...panels.querySelectorAll('.browserSidebarContainer')]
    .filter(panel => panel.classList.contains('deck-selected') || panel.classList.contains('split-view-panel-active'))
    .map(panel => panel.querySelector('browser[type="content"]'))
    .filter(browser => browser?.browsingContext?.currentWindowGlobal && browser.clientWidth);
}

function hide(element, pane) {
  if (!pane.canvas.hidden) pane.canvas.hidden = true;
  pane.ink = 'white';
  element.removeAttribute('zero-ink');
}

/** Una foto de lo que se ve de cada web (drawSnapshot sin rectángulo: la vista, con su scroll;
 *  con un rectángulo mediría desde el principio del documento). Una por web y fotograma, y cada
 *  pieza recorta la suya. */
async function shoot(win, browsers) {
  return Promise.all(browsers.map(async browser => {
    const rect = browser.getBoundingClientRect();
    const bitmap = await browser.browsingContext.currentWindowGlobal.drawSnapshot(null, SCALE, 'white');
    // Píxeles de la foto por píxel de la ventana (con el zoom de la web, la foto mide otra cosa).
    return { browser, rect, bitmap, kx: bitmap.width / rect.width, ky: bitmap.height / rect.height };
  }));
}

function paintPane(win, element, pane, shots) {
  const box = element.getBoundingClientRect();
  const cs = win.getComputedStyle(element);
  const opacity = Number(cs.opacity) * Number(win.getComputedStyle(topOf(element)).opacity);
  if (box.width < 1 || box.height < 1 || opacity <= 0.01 || cs.visibility === 'hidden') return hide(element, pane), false;
  const hits = shots.map(shot => ({ ...shot, part: intersect(box, shot.rect) })).filter(hit => hit.part);
  if (!hits.length) return hide(element, pane), false;

  const { canvas } = pane;
  const style = canvas.style;
  style.left = `${box.left}px`; style.top = `${box.top}px`;
  style.width = `${box.width}px`; style.height = `${box.height}px`;
  style.borderRadius = cs.borderRadius;
  style.opacity = String(opacity);
  style.zIndex = win.getComputedStyle(topOf(element)).zIndex;
  const width = Math.max(1, Math.ceil(box.width * SCALE)), height = Math.max(1, Math.ceil(box.height * SCALE));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  for (const { rect, bitmap, kx, ky, part } of hits) {
    // Lo que hay debajo, con margen para que el desenfoque no oscurezca los bordes.
    const area = intersect({ left: part.x - PAD, top: part.y - PAD, right: part.x + part.w + PAD, bottom: part.y + part.h + PAD }, rect);
    ctx.save();
    ctx.beginPath();
    ctx.rect((part.x - box.left) * SCALE, (part.y - box.top) * SCALE, part.w * SCALE, part.h * SCALE);
    ctx.clip();
    ctx.filter = `blur(${BLUR * SCALE}px) saturate(1.7)`;
    ctx.drawImage(bitmap, (area.x - rect.left) * kx, (area.y - rect.top) * ky, area.w * kx, area.h * ky,
      (area.x - box.left) * SCALE, (area.y - box.top) * SCALE, area.w * SCALE, area.h * SCALE);
    ctx.restore();
  }
  canvas.hidden = false;
  pane.ink = inkFor(lightOf(ctx.getImageData(0, 0, width, height).data), pane.ink);
  element.toggleAttribute('zero-ink', pane.ink === 'ink');
  return true;
}

async function paint(win, eng) {
  const mine = [...panes].filter(([, pane]) => pane.win === win);
  if (!mine.length) return;
  const shots = await shoot(win, webs(win)).catch(() => []);
  let painted = false;
  try {
    for (const [element, pane] of mine) {
      if (!panes.has(element)) continue;
      try { painted = paintPane(win, element, pane, shots) || painted; } catch { hide(element, pane); }
    }
  } finally {
    for (const shot of shots) shot.bitmap.close?.();
  }
  if (painted) eng.count += 1;
}

/** ¿Hay algo que se mueve solo? Un vídeo o un audio sonando en una web que se ve. */
function playing(win) {
  return webs(win).some(browser => win.gBrowser.getTabForBrowser(browser)?.hasAttribute('soundplaying'));
}

function loop(win) {
  const eng = engines.get(win);
  if (!eng) return;
  eng.frame = 0; eng.timer = 0;
  if (Date.now() > eng.until && !playing(win)) return;
  if (!eng.busy) {
    eng.busy = true;
    paint(win, eng).catch(() => {}).finally(() => { eng.busy = false; });
  }
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

function engine(win, host) {
  if (engines.has(win)) return engines.get(win);
  const eng = { until: 0, frame: 0, timer: 0, busy: false, count: 0, cleanups: [], host };
  engines.set(win, eng);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); eng.cleanups.push(() => target.removeEventListener(type, fn, options)); };
  const nudge = () => kick(win);
  // La rueda, las teclas y el ratón sobre la web pasan antes por la ventana de Gecko.
  for (const type of ['wheel', 'keydown', 'mousemove', 'resize']) listen(win, type, nudge, { capture: true, passive: true });
  // Las transiciones, solo las que mueven o cambian de tamaño u opacidad una pieza o la tarjeta: un
  // color (el velo, la tinta) no cambia lo que hay debajo del cristal.
  const moves = event => {
    if (!MOVES.test(event.propertyName ?? '')) return;
    const target = event.target;
    if (win.document.getElementById('tabbrowser-tabpanels')?.contains(target)
        || [...panes].some(([element, pane]) => pane.win === win && (topOf(element).contains(target) || target.contains?.(element)))) kick(win);
  };
  for (const type of ['transitionrun', 'transitionend']) listen(win.document, type, moves, true);
  listen(win.gBrowser.tabContainer, 'TabSelect', nudge);
  listen(win.gBrowser.tabContainer, 'TabAttrModified', event => { if (event.detail?.changed?.includes('soundplaying')) nudge(); });
  const progress = { onLocationChange: nudge, onStateChange: nudge };
  win.gBrowser.addProgressListener(progress);
  eng.cleanups.push(() => win.gBrowser.removeProgressListener(progress));
  return eng;
}

export const GlassPane = {
  /** Pone el cristal en vivo detrás de `element` (se ve solo cuando está encima de la web). */
  attach(element, win, host = null) {
    if (panes.has(element)) return;
    const doc = win.document;
    const canvas = doc.createElementNS(HTML, 'canvas');
    canvas.className = 'zero-glass';
    if (element.id) canvas.id = `zero-glass-${element.id}`;
    canvas.hidden = true;
    topOf(element).before(canvas);
    panes.set(element, { win, canvas, ink: 'white' });
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
  /** Que repinte un rato (para las piezas que se mueven sin evento propio). */
  kick: (win, ms) => kick(win, ms),
  /** Cuántas veces ha repintado esta ventana (para las pruebas). */
  repaints: win => engines.get(win)?.count ?? 0,
};

function stop(win) {
  const eng = engines.get(win);
  if (!eng) return;
  engines.delete(win);
  if (eng.frame) win.cancelAnimationFrame(eng.frame);
  if (eng.timer) win.clearTimeout(eng.timer);
  for (const undo of eng.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}

// ---------------------------------------------------------------- la pieza

const PIECES = ['nav-bar', 'zero-rail', 'zero-grow', 'zero-settings'];

export function attach(win, ctx) {
  for (const id of PIECES) {
    const element = win.document.getElementById(id);
    if (element) GlassPane.attach(element, win, ctx.host);
  }
}

export function detach(win) {
  for (const [element, pane] of [...panes]) if (pane.win === win) GlassPane.detach(element);
  stop(win);
}
