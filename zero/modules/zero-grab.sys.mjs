/* Kitsune Zero · el asa de la página: agarrarla para la multitarea.
 *
 * Risco (15-10): «que las páginas sean grabbeables para poder ponerlo en el espacio multitarea y así aprovecharlo
 * al máximo posible». Debajo de la web, centrada, una barrita (como la de un iPad) que se agarra y se lleva:
 * - a un lado de la ventana: la web se queda en ese lado, en una vista dividida, y al otro sale la lista de
 *   pestañas de Gecko (about:opentabs) para elegir la de al lado;
 * - al filo de la ventana (o fuera): a una ventana propia, que el sistema puede colocar (Snap en Windows,
 *   Mission Control en macOS, las columnas de niri).
 * Mientras se lleva, la web enseña dónde caería (#zero-split-drop, el mismo aviso que al soltar encima una pestaña
 * del raíl). Con la vista ya dividida, solo el filo: a su ventana.
 */
const HTML = 'http://www.w3.org/1999/xhtml';
const EDGE = 14;   // px del filo de la ventana que cuentan como «fuera»
const DEAD = 6;    // px que hay que mover para que sea arrastrar y no un clic
const state = new WeakMap();

const el = (doc, tag, attrs = {}) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

/** Dónde caería la página llevada por su asa: 'window' (al filo de la ventana o fuera: a una ventana propia),
 *  'left' o 'right' (ese lado de una vista dividida) o null. `size`: la ventana; `card`: la tarjeta de la web. */
export function pageDrop({ point, card, size, split = false, canSplit = true, canWindow = true }) {
  const out = point.x < EDGE || point.y < EDGE || point.x > size.width - EDGE || point.y > size.height - EDGE;
  if (out) return canWindow ? 'window' : null;
  if (split || !canSplit || !card) return null;
  if (point.x < card.left || point.x > card.right || point.y < card.top || point.y > card.bottom) return null;
  return point.x < card.left + card.width / 2 ? 'left' : 'right';
}

/** La tarjeta de la web que se ve (o de toda la vista dividida). */
function cardRect(doc) {
  const panels = doc.getElementById('tabbrowser-tabpanels');
  const rects = [...(panels?.querySelectorAll(':scope > :is(.deck-selected, .split-view-panel)') ?? [])]
    .map(panel => panel.getBoundingClientRect()).filter(r => r.width > 1 && r.height > 1);
  if (!rects.length) return null;
  const left = Math.min(...rects.map(r => r.left)), top = Math.min(...rects.map(r => r.top));
  const right = Math.max(...rects.map(r => r.right)), bottom = Math.max(...rects.map(r => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function place(win, st) {
  st.frame = 0;
  const card = cardRect(win.document);
  // Centrada bajo la web, en el margen de debajo (si no hay margen, con la web a toda la ventana, no se ve: zero.css).
  if (!card || win.innerHeight - card.bottom < 12) { st.handle.hidden = true; return; }
  st.handle.hidden = false;
  st.handle.style.left = `${Math.round(card.left + card.width / 2)}px`;
  st.handle.style.top = `${Math.round(card.bottom + (win.innerHeight - card.bottom) / 2)}px`;
}

function schedule(win, st) {
  if (!st.frame) st.frame = win.requestAnimationFrame(() => place(win, st));
}

/** El aviso de dónde caería: el del raíl (#zero-split-drop), sobre la tarjeta o sobre toda la ventana. */
function showDrop(win, st, side, card) {
  const hint = win.document.getElementById('zero-split-drop');
  if (!hint) return;
  if (!side) { hint.removeAttribute('side'); return; }
  const box = side === 'window' ? { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight } : card;
  if (hint.getAttribute('side') !== side) {
    hint.setAttribute('side', side);
    hint.dataset.label = side === 'window' ? st.t('A una ventana propia', 'To its own window') : st.t('Aquí, y al otro lado eliges otra', 'Here, and pick another for the other side');
  }
  Object.assign(hint.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
}

function drop(win, side) {
  const gBrowser = win.gBrowser, tab = gBrowser.selectedTab;
  if (!tab || tab.closing) return;
  try {
    if (side === 'window') {
      tab.splitview?.unsplitTabs?.();
      gBrowser.replaceTabWithWindow(tab);
    } else {
      // Como «Dividir» de Gecko: al otro lado, la lista de pestañas para elegir cuál va.
      const other = gBrowser.addTrustedTab('about:opentabs');
      gBrowser.addTabSplitView(side === 'left' ? [tab, other] : [other, tab], { insertBefore: tab, trigger: 'drag' });
      gBrowser.selectedTab = other;
    }
  } catch (error) { console.error('Zero: no se pudo llevar la página', error); }
}

export function attach(win, ctx) {
  const doc = win.document, { host } = ctx;
  const t = host.t ?? (es => es);
  const st = { t, cleanups: [], frame: 0 };
  state.set(win, st);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };
  const label = t('Agarrar la página: a un lado o a otra ventana', 'Grab the page: to one side or to another window');
  st.handle = el(doc, 'div', { id: 'zero-grab', role: 'button', title: label, 'aria-label': label, hidden: 'true' });
  doc.body.append(st.handle);
  st.cleanups.push(() => st.handle.remove());

  // Se coloca con la tarjeta: al cambiar el tamaño, al moverse la tarjeta, al cambiar de pestaña o de vista.
  for (const type of ['resize', 'zero-move']) listen(win, type, () => schedule(win, st));
  listen(win.gBrowser.tabContainer, 'TabSelect', () => schedule(win, st));
  const panels = doc.getElementById('tabbrowser-tabpanels');
  if (panels) listen(panels, 'transitionend', () => schedule(win, st));
  const observer = new win.MutationObserver(() => schedule(win, st));
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['zero-full', 'zero-empty', 'inFullscreen', 'sizemode'] });
  if (panels) observer.observe(panels, { attributes: true, attributeFilter: ['splitview'] });
  st.cleanups.push(() => observer.disconnect());
  schedule(win, st);

  let drag = null;
  listen(st.handle, 'pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false, side: null };
    try { st.handle.setPointerCapture(event.pointerId); } catch { /* sin captura */ }
  });
  listen(st.handle, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < DEAD) return;
      drag.active = true;
      st.handle.setAttribute('grabbing', '');
    }
    st.handle.style.translate = `${dx}px ${dy}px`;
    const gBrowser = win.gBrowser, tab = gBrowser.selectedTab, card = cardRect(doc);
    drag.side = pageDrop({ point: { x: event.clientX, y: event.clientY }, card, size: { width: win.innerWidth, height: win.innerHeight },
      split: !!tab?.splitview, canSplit: typeof gBrowser.addTabSplitView === 'function' && !tab?.pinned,
      canWindow: gBrowser.visibleTabs.length > 1 && !tab?.pinned });
    showDrop(win, st, drag.side, card);
  });
  const end = event => {
    if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
    const done = drag;
    drag = null;
    st.handle.removeAttribute('grabbing');
    st.handle.style.removeProperty('translate');
    showDrop(win, st, null);
    if (done.active && done.side) drop(win, done.side);
    schedule(win, st);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(st.handle, type, end);
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  if (st.frame) win.cancelAnimationFrame(st.frame);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}
