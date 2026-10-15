/* Kitsune Zero · el raíl: las pestañas a la izquierda, en una cápsula de cristal de 36 px.
 *
 * Zero hace su propio raíl con gBrowser.visibleTabs (las pestañas de Gecko, arriba o al lado, se
 * esconden): así el efecto Dock y cada animación son suyos. Iconos redondos (el favicon o la
 * inicial), las fijadas arriba y, si el anfitrión tiene espacios y hay más de uno, sus iconos encima.
 * Al pasar el ratón se abre a 186 px con los títulos entrando uno tras otro. Con la web ampliada se
 * aparta y vuelve al acercar el ratón al borde izquierdo (#zero-edge).
 */
import { dockScales } from './zero-dock.mjs';
import { userOf, paintUser } from './zero-who.sys.mjs';
import { lightIcon } from './zero-icon.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const state = new WeakMap(); // ventana → { cleanups, items, … }

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};

const initialOf = label => ([...String(label ?? '').trim()][0] ?? '·').toLocaleUpperCase();

/** Un tono estable para la inicial de cada web (el mismo dominio, el mismo color). */
function hueOf(text) {
  let hash = 0;
  for (const char of String(text)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % 360;
}

function siteOf(tab) {
  try { return tab.linkedBrowser.currentURI.host || tab.label; } catch { return tab.label; }
}

function item(doc, kind, extra = {}) {
  return el(doc, 'button', { type: 'button', class: `zero-item ${kind}`, ...extra }, [
    el(doc, 'span', { class: 'zero-fav', 'aria-hidden': 'true' }),
    el(doc, 'span', { class: 'zero-tt' }),
  ]);
}

/** Una pestaña: una fila (no un botón, porque lleva dentro el de cerrar) que se maneja igual con el
 *  teclado: Intro o espacio la eligen y Supr la cierra. La × sale al pasar el ratón con el raíl abierto. */
function tabItem(doc, host) {
  return el(doc, 'div', { class: 'zero-item zero-tab', role: 'tab', tabindex: '0' }, [
    el(doc, 'span', { class: 'zero-fav', 'aria-hidden': 'true' }),
    el(doc, 'button', { type: 'button', class: 'zero-sound', tabindex: '-1', title: host.t('Silenciar o volver a oír', 'Mute or unmute'), 'aria-label': host.t('Silenciar o volver a oír', 'Mute or unmute') }),
    el(doc, 'span', { class: 'zero-tt' }),
    el(doc, 'button', { type: 'button', class: 'zero-close', tabindex: '-1', title: host.t('Cerrar pestaña', 'Close tab'), 'aria-label': host.t('Cerrar pestaña', 'Close tab') }),
  ]);
}

/** El icono: el favicon en un círculo claro, o la inicial sobre su color. */
function setFav(doc, fav, icon, letter, hue) {
  if (icon) {
    let img = fav.querySelector('img');
    if (!img) {
      img = el(doc, 'img', { alt: '' });
      img.addEventListener('error', () => { fav.dataset.broken = img.src; setFav(doc, fav, null, letter, hue); });
      img.addEventListener('load', () => { const light = lightIcon(doc, img); if (light !== null) fav.toggleAttribute('light-icon', light); });
      fav.replaceChildren(img);
    }
    if (fav.dataset.broken === icon) return setFav(doc, fav, null, letter, hue);
    if (img.getAttribute('src') !== icon) img.setAttribute('src', icon);
    fav.removeAttribute('letter');
    fav.style.removeProperty('--zero-fav-hue');
  } else {
    if (fav.textContent !== letter || fav.querySelector('img')) fav.replaceChildren(letter);
    fav.removeAttribute('light-icon');
    fav.setAttribute('letter', '');
    fav.style.setProperty('--zero-fav-hue', String(hue));
  }
}

/** Las pestañas «de paso» del anfitrión (en Kitsune, la vista rápida) no salen en el raíl. */
function passing(st, tab) {
  try { return !!st.host.tabs?.passing?.(tab); } catch { return false; }
}

/** La que se marca como elegida: la elegida o, si es de paso, la que tiene debajo (su vista dividida). */
function current(win, st) {
  const selected = win.gBrowser.selectedTab;
  if (!passing(st, selected)) return selected;
  return selected.splitview?.tabs?.find(tab => tab !== selected && !passing(st, tab)) ?? selected;
}

function fill(win, st, tab, node) {
  const doc = win.document;
  const label = tab.label || '';
  const title = node.querySelector('.zero-tt');
  if (title.textContent !== label) title.textContent = label;
  // El nombre, para los lectores de pantalla; sin title: el bocadillo nativo tapaba el raíl abierto,
  // que ya enseña los títulos.
  if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label);
  let icon = null;
  try { icon = win.gBrowser.getIcon?.(tab) ?? tab.getAttribute('image'); } catch { /* sin icono */ }
  setFav(doc, node.querySelector('.zero-fav'), icon || null, initialOf(label), hueOf(siteOf(tab)));
  node.toggleAttribute('selected', tab === current(win, st));
  node.toggleAttribute('pinned', tab.pinned);
  node.toggleAttribute('busy', tab.hasAttribute('busy'));
  // Lo que suena (y lo silenciado), con su altavoz en el icono.
  node.toggleAttribute('soundplaying', tab.hasAttribute('soundplaying'));
  node.toggleAttribute('muted', tab.hasAttribute('muted'));
  // De qué grupo es: una raya con su color al otro lado del icono.
  node.toggleAttribute('grouped', !!tab.group);
  if (tab.group) node.style.setProperty('--zero-group', `var(--tab-group-${tab.group.color || 'blue'})`);
  else node.style.removeProperty('--zero-group');
  // De qué usuario es: una raya con su color junto al icono (el base, sin raya).
  const who = userOf(win, tab);
  node.toggleAttribute('user', !!who);
  paintUser(node, who);
}

const calm = { duration: 460, easing: 'cubic-bezier(.32, .72, 0, 1)' };
const quiet = win => win.matchMedia('(prefers-reduced-motion: reduce)').matches;

function fadeIn(win, node) {
  if (quiet(win)) return;
  node.animate([{ opacity: 0, transform: 'scale(.6)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'none' }], calm);
}

/** La que se va se encoge y se desvanece en su sitio; luego se quita. */
function fadeOut(win, node) {
  node.setAttribute('leaving', '');
  if (quiet(win)) { node.remove(); return; }
  const height = node.getBoundingClientRect().height;
  node.animate([{ opacity: 1, height: `${height}px` }, { opacity: 0, height: '0px', marginBlock: '0px' }], { duration: 280, easing: 'cubic-bezier(.4, 0, .2, 1)' })
    .finished.then(() => node.remove(), () => node.remove());
}

function renderSpaces(win, st) {
  const doc = win.document;
  const spaces = st.host.spaces;
  let list = [], current = null;
  try { list = spaces?.list(win) ?? []; current = spaces?.current(win) ?? null; } catch { list = []; }
  const show = list.length > 1;
  st.spacesBox.hidden = !show;
  st.sep.hidden = !show;
  if (!show) { st.spacesBox.replaceChildren(); return 0; }
  const nodes = list.map((space, index) => {
    const node = st.spacesBox.querySelector(`[data-space="${win.CSS.escape(space.id)}"]`) ?? item(doc, 'zero-space', { 'data-space': space.id });
    node.querySelector('.zero-tt').textContent = space.name;
    node.setAttribute('aria-label', space.name);
    const fav = node.querySelector('.zero-fav');
    const glyph = space.icon || initialOf(space.name);
    if (fav.textContent !== glyph) fav.textContent = glyph;
    node.toggleAttribute('selected', space.id === current);
    node.style.setProperty('--i', String(index));
    return node;
  });
  st.spacesBox.replaceChildren(...nodes);
  return nodes.length;
}

function render(win, st) {
  const doc = win.document;
  const offset = renderSpaces(win, st);
  const shown = new Set(win.gBrowser.visibleTabs.filter(tab => !tab.closing && !passing(st, tab)));
  // En el orden de Gecko: cada grupo de pestañas con su fila (aunque esté plegado) y, detrás, las suyas
  // que se ven. Las de otro espacio (hidden) no cuentan, ni para su grupo.
  const order = [];
  let last = null;
  for (const tab of win.gBrowser.tabs) {
    if (tab.closing || tab.hidden || passing(st, tab)) continue;
    const group = tab.group ?? null;
    if (group && group !== last) order.push(group);
    last = group;
    if (shown.has(tab)) order.push(tab);
  }
  const live = [];
  order.forEach((entry, index) => {
    let node;
    if (shown.has(entry)) {
      const tab = entry;
      node = st.items.get(tab);
      if (!node) {
        node = tabItem(doc, st.host);
        st.items.set(tab, node);
        st.tabOf.set(node, tab);
        // El menú de pestaña de Gecko mira «.tab» en lo que se ha pulsado (la fila o lo de dentro).
        for (const part of [node, ...node.querySelectorAll('*')]) part.tab = tab;
      }
      fill(win, st, tab, node);
    } else {
      const group = entry;
      node = st.items.get(group);
      if (!node) {
        node = groupItem(doc, st.host);
        st.items.set(group, node);
        st.groupOf.set(node, group);
      }
      fillGroup(win, st, group, node);
    }
    node.style.setProperty('--i', String(offset + index));
    live.push(node);
  });
  // En orden, sin mover las que se están yendo.
  let cursor = st.tabsBox.firstChild;
  for (const node of live) {
    while (cursor?.hasAttribute('leaving')) cursor = cursor.nextSibling;
    if (cursor === node) { cursor = cursor.nextSibling; continue; }
    const fresh = !node.parentNode;
    st.tabsBox.insertBefore(node, cursor);
    if (fresh && st.fresh.has(st.tabOf.get(node))) fadeIn(win, node);
  }
  st.fresh.clear();
  const keep = new Set(order);
  for (const [entry, node] of st.items) {
    if (keep.has(entry)) continue;
    st.items.delete(entry);
    fadeOut(win, node);
  }
  st.add.style.setProperty('--i', String(offset + order.length));
}

/** Un grupo de pestañas de Gecko: una fila con un círculo de su color (su inicial; plegado, cuántas
 *  pestañas tiene) y su nombre. Un clic lo pliega o lo despliega. */
function groupItem(doc, host) {
  return el(doc, 'div', { class: 'zero-item zero-group', role: 'button', tabindex: '0' }, [
    el(doc, 'span', { class: 'zero-fav', 'aria-hidden': 'true' }),
    el(doc, 'span', { class: 'zero-tt' }),
  ]);
}

function fillGroup(win, st, group, node) {
  const name = group.label || st.host.t('Grupo', 'Group');
  const count = group.tabs.filter(tab => !tab.closing && !tab.hidden).length;
  const title = node.querySelector('.zero-tt');
  if (title.textContent !== name) title.textContent = name;
  node.setAttribute('aria-label', name);
  node.toggleAttribute('collapsed', !!group.collapsed);
  node.setAttribute('aria-expanded', String(!group.collapsed));
  const glyph = group.collapsed ? String(count) : initialOf(name);
  const fav = node.querySelector('.zero-fav');
  if (fav.textContent !== glyph) fav.textContent = glyph;
  node.style.setProperty('--zero-group', `var(--tab-group-${group.color || 'blue'})`);
}

/** Reordenar arrastrando (con el puntero, para cuidar la animación): pasados 6 px, la pestaña se
 *  levanta y sigue al ratón, las de su grupo (fijadas o no) le hacen hueco, y al soltarla Gecko la
 *  mueve. Un arrastre más corto es un clic. */
function reorder(win, st) {
  let drag = null;
  const DEAD = 6, TEAR = 80;
  st.rail.addEventListener('pointerdown', event => {
    st.dragged = false;
    if (event.button !== 0) return;
    const node = event.target.closest('.zero-tab');
    if (!node || node.hasAttribute('leaving') || event.target.closest('.zero-close, .zero-sound')) return;
    drag = { node, tab: st.tabOf.get(node), startY: event.clientY, startX: event.clientX, pointerId: event.pointerId, active: false };
  });
  st.rail.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId || !drag.tab) return;
    const dy = event.clientY - drag.startY;
    const dx = event.clientX - drag.startX;
    if (!drag.active) {
      if (Math.abs(dy) < DEAD && Math.abs(dx) < DEAD) return;
      drag.active = true;
      try { st.rail.setPointerCapture(event.pointerId); } catch { /* sin captura */ }
      st.rail.setAttribute('reordering', '');
      dock(st, null);
      drag.rows = [...st.tabsBox.children].filter(row => !row.hasAttribute('leaving') && st.tabOf.get(row)?.pinned === drag.tab.pinned);
      drag.index = drag.rows.indexOf(drag.node);
      drag.centers = drag.rows.map(row => { const r = row.getBoundingClientRect(); return r.top + r.height / 2; });
      drag.step = drag.rows.length > 1 ? (drag.centers.at(-1) - drag.centers[0]) / (drag.rows.length - 1) : 28;
      drag.node.setAttribute('dragging', '');
    }
    drag.node.style.transform = `translateY(${dy}px) scale(1.04)`;
    // Dónde caería: pasa al sitio de una vecina cuando su centro cruza el de ella.
    const center = drag.centers[drag.index] + dy;
    let target = drag.index;
    while (target > 0 && center < drag.centers[target - 1]) target--;
    while (target < drag.centers.length - 1 && center > drag.centers[target + 1]) target++;
    drag.target = target;
    // Lejos del raíl (a la derecha), soltarla la lleva a una ventana nueva, como sacarla de la barra de
    // pestañas en Kitsune; la fila lo avisa. Una fijada o la única pestaña, no.
    drag.outside = event.clientX - st.rail.getBoundingClientRect().right > TEAR && !drag.tab.pinned && win.gBrowser.visibleTabs.length > 1;
    drag.node.toggleAttribute('tearing', drag.outside);
    drag.rows.forEach((row, i) => {
      if (row === drag.node) return;
      const shift = target < drag.index && i >= target && i < drag.index ? drag.step
        : target > drag.index && i <= target && i > drag.index ? -drag.step : 0;
      row.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  });
  const end = event => {
    if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    const done = drag;
    drag = null;
    if (!done.active) return; // un clic: lo elige el clic
    st.dragged = true;        // y el clic que llega detrás de soltar no la elige
    // Sin transición al soltar: la fila ya está donde va y el orden nuevo llega a la vez.
    st.rail.setAttribute('settling', '');
    for (const row of done.rows) row.style.transform = '';
    done.node.removeAttribute('dragging');
    done.node.removeAttribute('tearing');
    st.rail.removeAttribute('reordering');
    if (done.outside && !done.tab.closing) {
      win.gBrowser.replaceTabWithWindow(done.tab);
    } else if (done.target !== undefined && done.target !== done.index) {
      const anchor = st.tabOf.get(done.rows[done.target]);
      if (anchor && !done.tab.closing) {
        if (done.target < done.index) win.gBrowser.moveTabBefore(done.tab, anchor);
        else win.gBrowser.moveTabAfter(done.tab, anchor);
      }
    }
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => st.rail?.removeAttribute('settling')));
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) st.rail.addEventListener(type, end);
}

/** Efecto Dock: cada icono crece según lo cerca que esté del ratón y aparta a sus vecinos. */
function dock(st, pointerY) {
  const nodes = [...st.rail.querySelectorAll('.zero-item:not([leaving], [hidden] > *)')];
  if (pointerY === null) { for (const node of nodes) node.style.removeProperty('--s'); return; }
  const centers = nodes.map(node => { const r = node.getBoundingClientRect(); return r.top + r.height / 2; });
  dockScales(centers, pointerY).forEach((scale, i) => nodes[i].style.setProperty('--s', scale.toFixed(3)));
}

export function attach(win, ctx) {
  const doc = win.document, { host } = ctx;
  const st = { host, cleanups: [], items: new Map(), tabOf: new WeakMap(), groupOf: new WeakMap(), fresh: new Set() };
  state.set(win, st);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };

  st.edge = el(doc, 'div', { id: 'zero-edge' });
  st.spacesBox = el(doc, 'div', { class: 'zero-spaces', role: 'tablist' });
  st.sep = el(doc, 'div', { class: 'zero-sep' });
  st.tabsBox = el(doc, 'div', { class: 'zero-tabs', role: 'tablist' });
  st.add = item(doc, 'zero-new', { 'aria-label': host.t('Nueva pestaña', 'New tab') });
  st.add.querySelector('.zero-fav').textContent = '+';
  st.add.querySelector('.zero-tt').textContent = host.t('Nueva pestaña', 'New tab');
  st.rail = el(doc, 'nav', { id: 'zero-rail', 'aria-label': host.t('Pestañas', 'Tabs') }, [st.spacesBox, st.sep, st.tabsBox, st.add]);
  doc.body.append(st.edge, st.rail);
  st.cleanups.push(() => { st.edge.remove(); st.rail.remove(); });

  const close = tab => { if (tab && !tab.closing) win.gBrowser.removeTab(tab, { animate: true }); };
  st.rail.addEventListener('click', event => {
    if (st.dragged) { st.dragged = false; return; } // venía de arrastrar
    const node = event.target.closest('.zero-item');
    if (!node || node.hasAttribute('leaving')) return;
    // La ×: cierra esa pestaña sin elegirla; el altavoz la silencia o le devuelve el sonido.
    if (event.target.closest('.zero-close')) { event.stopPropagation(); close(st.tabOf.get(node)); return; }
    if (event.target.closest('.zero-sound')) { event.stopPropagation(); st.tabOf.get(node)?.toggleMuteAudio(); return; }
    if (node.classList.contains('zero-space')) { void Promise.resolve(host.spaces?.select(win, node.dataset.space)).catch(() => {}); return; }
    const group = st.groupOf.get(node);
    if (group) { group.collapsed = !group.collapsed; return; }
    if (node === st.add) { (win.BrowserCommands?.openTab ?? win.BrowserOpenTab)?.call(win.BrowserCommands ?? win); return; }
    const tab = st.tabOf.get(node);
    if (tab && !tab.closing) win.gBrowser.selectedTab = tab;
  });
  // Clic central: cierra la pestaña (como en la barra de pestañas).
  st.rail.addEventListener('auxclick', event => {
    if (event.button !== 1) return;
    const tab = st.tabOf.get(event.target.closest('.zero-tab'));
    if (tab && !tab.closing) { event.preventDefault(); close(tab); }
  });
  st.rail.addEventListener('mousedown', event => { if (event.button === 1) event.preventDefault(); }); // sin autodesplazamiento
  // Clic derecho en una pestaña: el menú de pestaña de Gecko (recargar, fijar, mover a otro espacio…).
  st.rail.addEventListener('contextmenu', event => {
    const node = event.target.closest('.zero-tab');
    if (!node || !st.tabOf.get(node)) return;
    event.preventDefault();
    // Gecko carga los textos de este menú al abrirlo desde su barra de pestañas: desde el raíl también
    // (si no, salen filas vacías hasta que se abra allí una vez).
    win.gBrowser.translateTabContextMenu?.();
    doc.getElementById('tabContextMenu')?.openPopupAtScreen(event.screenX, event.screenY, true, event);
  });
  st.rail.addEventListener('keydown', event => {
    // Un grupo: Intro o espacio lo pliegan o lo despliegan.
    const group = st.groupOf.get(event.target.closest?.('.zero-group'));
    if (group && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); group.collapsed = !group.collapsed; return; }
    const node = event.target.closest?.('.zero-tab');
    if (!node) return;
    const tab = st.tabOf.get(node);
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (tab && !tab.closing) win.gBrowser.selectedTab = tab; }
    else if (event.key === 'Delete') { event.preventDefault(); close(tab); }
  });

  let frame = 0, pointerY = null;
  reorder(win, st);
  st.rail.addEventListener('mousemove', event => {
    if (st.rail.hasAttribute('reordering')) return; // arrastrando: el Dock se aparta
    pointerY = event.clientY;
    if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; dock(st, pointerY); });
  });
  st.rail.addEventListener('mouseleave', () => { pointerY = null; win.cancelAnimationFrame(frame); frame = 0; dock(st, null); });

  const container = win.gBrowser.tabContainer;
  // Con muchas pestañas el raíl se desplaza: la elegida siempre a la vista, con un poco de aire.
  // Se mide con offsetTop y no con el rectángulo: la que acaba de abrirse aún entra encogida.
  const keepInView = (instant = false) => win.requestAnimationFrame(() => {
    const node = st.tabsBox.querySelector('.zero-tab[selected]:not([leaving])');
    if (!node || node.offsetParent !== st.rail) return;
    const air = 7, top = node.offsetTop - air, bottom = node.offsetTop + node.offsetHeight + air;
    const { scrollTop, clientHeight } = st.rail;
    const to = top < scrollTop ? top : bottom > scrollTop + clientHeight ? bottom - clientHeight : null;
    if (to !== null) st.rail.scrollTo({ top: to, behavior: instant || quiet(win) ? 'instant' : 'smooth' });
  });
  listen(container, 'TabSelect', () => keepInView());
  listen(container, 'TabOpen', event => { st.fresh.add(event.target); render(win, st); });
  for (const type of ['TabClose', 'TabSelect', 'TabMove', 'TabPinned', 'TabUnpinned', 'TabShow', 'TabHide',
    'TabGroupCreate', 'TabGroupRemoved', 'TabGroupCollapse', 'TabGroupExpand', 'TabGrouped', 'TabUngrouped', 'TabGroupUpdate', 'TabGroupMoved']) {
    listen(container, type, () => render(win, st));
  }
  listen(container, 'TabAttrModified', event => {
    const node = st.items.get(event.target);
    if (node) fill(win, st, event.target, node);
  });
  const unwatch = host.spaces?.watch?.(win, () => { render(win, st); keepInView(true); });
  if (unwatch) st.cleanups.push(unwatch);

  render(win, st);
  keepInView(true);
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}
