/* Kitsune Zero · el marco: la ventana de cristal, la web en tarjeta (y ampliada), los botones de
 * ventana y el velo del color de la web.
 *
 * - Ventana de cristal: con Zero, la raíz y el resto del marco son transparentes y Gecko pasa la
 *   ventana a transparente él solo (nsLayoutUtils::GetFrameTransparency). El desenfoque de lo que hay
 *   detrás lo pone el compositor (niri 26.04+, con zero/linux/kitsune-zero.kdl). Sin él, «fondo de la
 *   web»: una foto diminuta de la web, muy desenfocada, detrás de todo.
 * - Velo: el color dominante de la web, muy leve, que cambia despacio con cada página.
 */
import { lightOf, inkFor } from './zero-light.mjs';
import { PREFS, prefName } from './zero-config.sys.mjs';

/** El color que manda en una foto (RGBA): ni el papel blanco ni el texto negro, salvo que no haya más. */
export function dominantColor(bytes) {
  if (!bytes?.length) return null;
  const buckets = new Map();
  const add = (key, r, g, b, weight) => {
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, w: 0 };
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.n += 1; bucket.w += weight;
    buckets.set(key, bucket);
  };
  const plain = [];
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    const [r, g, b, a] = [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]];
    if (a < 128) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (min > 232 || max < 24) { plain.push([r, g, b]); continue; }   // papel y tinta: solo si no hay otra cosa
    const saturation = max ? (max - min) / max : 0;
    add(`${r >> 4},${g >> 4},${b >> 4}`, r, g, b, 1 + 2 * saturation);
  }
  let best = null;
  for (const bucket of buckets.values()) if (!best || bucket.w > best.w) best = bucket;
  if (!best) {
    if (!plain.length) return null;
    best = plain.reduce((acc, [r, g, b]) => ({ r: acc.r + r, g: acc.g + g, b: acc.b + b, n: acc.n + 1 }), { r: 0, g: 0, b: 0, n: 0 });
  }
  const hex = v => Math.round(v / best.n).toString(16).padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

/** Cristal del sistema (desenfoque del compositor) o fondo del color de la web. */
export function backdropMode(pref, env = {}) {
  if (pref === 'web') return 'web';
  if (pref === 'system') return 'system';
  return env.niri && env.rule ? 'system' : 'web';
}

// ---------------------------------------------------------------- la pieza (Gecko)

const HTML = 'http://www.w3.org/1999/xhtml';
const NIRI_RULE = '.config/niri/kitsune-zero.kdl';
const state = new WeakMap(); // ventana → { cleanups, … }

// Con la ventana transparente, sin regiones opacas para el compositor (Wayland): Gecko le dice qué partes
// de la ventana son opacas y, al desampliar tras cambiar de app, eso se quedaba viejo (la web ampliada
// llenaba la ventana) y lo transparente salía negro (Risco, 15-10). Es una preferencia de toda la sesión:
// se cambia su valor por defecto (no se guarda en el perfil) mientras haya alguna ventana así, y vuelve.
const OPAQUE = 'widget.wayland.opaque-region.enabled';
const transparent = new Set();
let opaqueDefault = null;
function syncOpaque() {
  try {
    const branch = Services.prefs.getDefaultBranch('');
    if (opaqueDefault === null) opaqueDefault = branch.getBoolPref(OPAQUE, true);
    branch.setBoolPref(OPAQUE, transparent.size ? false : opaqueDefault);
  } catch { /* sin esa preferencia */ }
}

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};

/** ¿Hay quien desenfoque detrás de la ventana? niri 26.04+ con la regla de Zero instalada. */
async function compositorEnv() {
  let niri = false, rule = false;
  try { niri = !!Services.env.get('NIRI_SOCKET'); } catch { /* sin entorno */ }
  try { rule = niri && await IOUtils.exists(PathUtils.join(Services.dirsvc.get('Home', Ci.nsIFile).path, ...NIRI_RULE.split('/'))); } catch { /* sin archivo */ }
  return (knownEnv = { niri, rule });
}

// Lo último que se supo del compositor: así, al entrar en Zero, el fondo es desde el principio el que
// toca (si se esperase a mirarlo, pasaría un fotograma o dos por la foto de la web: un parpadeo).
let knownEnv = null;

/** Mira el compositor ya (al cargar Zero), para que la primera ventana no tenga que esperar. */
export function warm() { if (!knownEnv) compositorEnv().catch(() => {}); }

/** El fondo que toca con lo que ya se sabe del compositor, o null si aún no se sabe. */
export function knownBackdrop(pref) { return knownEnv ? backdropMode(pref, knownEnv) : null; }

/** Una foto pequeña de lo que se ve en la web: { bytes, canvas } (o null si no se puede). Sin
 *  rectángulo, drawSnapshot fotografía la vista (con su scroll); con uno, mediría desde el principio
 *  del documento. */
async function snapshot(win, width, height) {
  const browser = win.gBrowser.selectedBrowser;
  const global = browser.browsingContext?.currentWindowGlobal;
  if (!global || !browser.clientWidth) return null;
  const scale = Math.min(width / browser.clientWidth, height / browser.clientHeight);
  const bitmap = await global.drawSnapshot(null, scale, 'white');
  const canvas = new win.OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return { bytes: ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas };
}

function paintColors(win, st) {
  if (st.painting) { st.again = true; return; }
  st.painting = true;
  const done = () => { st.painting = false; if (st.again) { st.again = false; schedule(win, st); } };
  snapshot(win, 96, 60).then(async shot => {
    if (!shot || !state.has(win)) return;
    const root = win.document.documentElement;
    const tint = dominantColor(shot.bytes);
    if (tint) root.style.setProperty('--zero-tint', tint);
    if (root.getAttribute('zero-backdrop') === 'web') {
      // Fondo de la web: la foto, aún más suave (desenfocada en un lienzo pequeño), estirada detrás de todo.
      const canvas = st.backdrop;
      canvas.width = 96; canvas.height = 60;
      const ctx = canvas.getContext('2d');
      ctx.filter = 'blur(4px) saturate(1.35)';
      ctx.drawImage(shot.canvas, -8, -8, 112, 76);
      root.style.setProperty('--zero-backdrop-image', `url("${canvas.toDataURL('image/png')}")`);
      canvas.dataset.painted = '1';
      // El marco es esa foto: si es clara, lo que va encima (isla, anillo, raíl, botones) pasa a tinta.
      st.frameInk = inkFor(lightOf(ctx.getImageData(0, 0, canvas.width, canvas.height).data), st.frameInk);
      root.toggleAttribute('zero-frame-ink', st.frameInk === 'ink');
    }
  }).catch(() => {}).finally(done);
}

function schedule(win, st) {
  win.clearTimeout(st.timer);
  st.timer = win.setTimeout(() => paintColors(win, st), 500);
}

function applyBackdrop(win, st) {
  const root = win.document.documentElement;
  const pref = (() => { try { return st.host.prefs.getStringPref(`${st.host.prefix}backdrop`, 'auto'); } catch { return 'auto'; } })();
  root.setAttribute('zero-backdrop', backdropMode(pref, st.env));
  if (root.getAttribute('zero-backdrop') === 'system') transparent.add(win); else transparent.delete(win);
  syncOpaque();
  if (root.getAttribute('zero-backdrop') !== 'web') {
    root.style.removeProperty('--zero-backdrop-image'); delete st.backdrop.dataset.painted;
    // Con el fondo del sistema, detrás está el escritorio (transparente) y no se sabe su luz: las piezas
    // son de cristal transparente (decisión de Risco, 15-10) y su texto sigue el modo del sistema: en
    // oscuro, blanco con halo; en claro, tinta.
    st.frameInk = win.matchMedia('(prefers-color-scheme: dark)').matches ? 'white' : 'ink';
    root.toggleAttribute('zero-frame-ink', st.frameInk === 'ink');
  }
  paintColors(win, st);
}

/** Dónde dejó quien usa Zero los botones de ampliar (arrastrándolos), en fracciones de la ventana. */
function savedGrow(st) {
  try {
    const at = JSON.parse(st.host.prefs.getStringPref(prefName(st.host.prefix, PREFS.growAt), '') || 'null');
    return at && Number.isFinite(at.x) && Number.isFinite(at.y) ? at : null;
  } catch { return null; }
}

/** Dónde van los botones de ampliar y dividir: donde los dejó quien usa Zero o, si no, en el marco, a
 *  la derecha de los de ventana (no tapan la web). Con la web ampliada se quedan en su sitio,
 *  escondidos (decisión de Risco, 15-10). */
function placeGrow(win, st) {
  const box = st.grow.getBoundingClientRect();
  const width = box.width || 62, height = box.height || 32;
  const at = savedGrow(st);
  let x, y;
  if (at) {
    x = Math.min(Math.max(4, at.x * win.innerWidth), win.innerWidth - width - 4);
    y = Math.min(Math.max(2, at.y * win.innerHeight), win.innerHeight - height - 2);
  } else {
    const lights = st.lights.getBoundingClientRect();
    x = (lights.right || 62) + 14;
    y = Math.max(2, (FRAME_TOP - height) / 2);
  }
  st.grow.style.setProperty('--zero-grow-x', `${Math.round(x)}px`);
  st.grow.style.setProperty('--zero-grow-y', `${Math.round(y)}px`);
}

// Lo alto del marco sobre la tarjeta (su margen de arriba): ahí, centrados, los botones del marco.
const FRAME_TOP = 46;
// Con la web ampliada, cada cosa sale al llevar el puntero al filo de arriba, encima de su sitio.
const EDGE = 6;

/** Cambia el sitio de la tarjeta (ampliar, entrar en Zero) sin redimensionar la web en cada
 *  fotograma: la web toma su tamaño nuevo una sola vez y la tarjeta viaja desde donde estaba con una
 *  transformación, que la hace la tarjeta gráfica (FLIP). Avisa con «zero-move» (el cristal en vivo
 *  lo sigue). */
export function flip(win, change, first = null) {
  const panels = win.document.getElementById('tabbrowser-tabpanels');
  if (!panels) { change(); return null; }
  // La duración, la de Zero: al entrar existe después del cambio y al salir, antes.
  const move = () => parseFloat(win.getComputedStyle(win.document.documentElement).getPropertyValue('--zero-t-move')) || 0;
  const before = move();
  first ??= panels.getBoundingClientRect();
  for (const animation of panels.getAnimations()) animation.cancel(); // uno a medias: se sale de donde está ahora
  change();
  const last = panels.getBoundingClientRect();
  const ms = Math.max(before, move());
  if (!first.width || !last.width || ms < 2 || win.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const dx = first.left - last.left, dy = first.top - last.top, sx = first.width / last.width, sy = first.height / last.height;
  if (Math.abs(dx) + Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return null;
  // Sin deformar la web (Risco, 15-10: «los textos se deforman»): la misma escala en los dos ejes, la que
  // cubre donde estaba, centrada; lo que sobra se recorta (y si estaba en toda la ventana, ya lo recorta el
  // borde de la ventana, y así no se recorta su sombra al volver a ser tarjeta).
  const s = Math.max(sx, sy);
  const tx = first.left + first.width / 2 - (last.left + last.width * s / 2);
  const ty = first.top + first.height / 2 - (last.top + last.height * s / 2);
  const ix = Math.max(0, (last.width - first.width / s) / 2), iy = Math.max(0, (last.height - first.height / s) / 2);
  const whole = first.left <= 0.5 && first.top <= 0.5 && first.right >= win.innerWidth - 0.5 && first.bottom >= win.innerHeight - 0.5;
  const from = { transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${s})` };
  const to = { transformOrigin: '0 0', transform: 'none' };
  if (!whole && (ix > 0.5 || iy > 0.5)) { from.clipPath = `inset(${iy}px ${ix}px)`; to.clipPath = 'inset(0px 0px)'; }
  const animation = panels.animate([from, to], { duration: ms, easing: 'cubic-bezier(.32, .72, 0, 1)' });
  win.dispatchEvent(new win.CustomEvent('zero-move', { detail: { ms } }));
  return animation;
}

/** Una foto de cómo se ve la web ahora (para taparla mientras se repinta con su tamaño nuevo), o null si
 *  no llega a tiempo (no se espera más de 120 ms). */
async function photoOf(win) {
  const browser = win.gBrowser?.selectedBrowser;
  const global = browser?.browsingContext?.currentWindowGlobal;
  if (!global || !browser.clientWidth) return null;
  try {
    return await Promise.race([global.drawSnapshot(null, 0.5, 'white'), new Promise(done => win.setTimeout(() => done(null), 120))]);
  } catch { return null; }
}

/** La foto, encima de la web dentro de su tarjeta (viaja y se recorta con ella), mientras la web se
 *  repinta con su tamaño nuevo: luego se funde y se quita. Sin ella, los primeros fotogramas enseñaban la
 *  web vieja estirada («hay 1, 2 o 3 fps que se rayan», Risco 15-10). */
function carryPhoto(win, bitmap) {
  const doc = win.document;
  const stack = win.gBrowser.selectedBrowser.closest('.browserStack');
  if (!stack || !bitmap) { bitmap?.close?.(); return; }
  doc.getElementById('zero-flip-photo')?.remove();
  const canvas = doc.createElementNS(HTML, 'canvas');
  canvas.id = 'zero-flip-photo';
  const r = stack.getBoundingClientRect(), k = win.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * k)); canvas.height = Math.max(1, Math.round(r.height * k));
  // Que cubra su caja sin deformarse (como «cover»).
  const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
  const w = bitmap.width * scale, h = bitmap.height * scale;
  canvas.getContext('2d').drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  bitmap.close?.();
  stack.append(canvas);
  canvas.animate([{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration: 280, easing: 'ease-out' })
    .finished.then(() => canvas.remove(), () => canvas.remove());
}

async function setFull(win, st, on) {
  const root = win.document.documentElement;
  const turn = st.fullTurn = (st.fullTurn ?? 0) + 1;
  // Al cambiar de verdad (y a la vista), primero la foto de cómo se ve; si mientras tanto se ha pedido
  // otra cosa, esta se queda en nada.
  const changing = root.hasAttribute('zero-full') !== on && !win.document.hidden && !win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bitmap = changing ? await photoOf(win) : null;
  if (turn !== st.fullTurn || !state.has(win)) { bitmap?.close?.(); return; }
  // Esc solo sirve (para dejar de ampliar) con la web ampliada; si no, ni se mira.
  if (on) st.esc?.removeAttribute('disabled'); else st.esc?.setAttribute('disabled', 'true');
  const animation = flip(win, () => root.toggleAttribute('zero-full', on));
  if (animation) carryPhoto(win, bitmap); else bitmap?.close?.();
  animation?.finished.then(() => placeGrow(win, st), () => {});
  const button = st.grow.querySelector('[data-action=full]');
  button.toggleAttribute('on', on); // su icono, del CSS (centrado; un carácter de texto no lo estaba)
  button.title = on ? st.host.t('Dejar de ampliar', 'Restore') : st.host.t('Ampliar', 'Fill the window');
  placeGrow(win, st);
}

/** Ampliar la web o dejar de ampliarla (el atajo, Ctrl+Alt+F). */
export function toggleFull(win, on) {
  const st = state.get(win);
  if (st) setFull(win, st, on ?? !win.document.documentElement.hasAttribute('zero-full'));
}

export function attach(win, ctx) {
  const doc = win.document, root = doc.documentElement, { host } = ctx;
  const st = { host, env: knownEnv ?? { niri: false, rule: false }, cleanups: [] };
  state.set(win, st);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };

  // Botones de ventana, en fila, como los de Kitsune: cerrar, minimizar y ampliar.
  const lights = st.lights = el(doc, 'div', { id: 'zero-lights' }, [
    el(doc, 'button', { 'data-action': 'close', title: host.t('Cerrar', 'Close') }),
    el(doc, 'button', { 'data-action': 'min', title: host.t('Minimizar', 'Minimize') }),
    el(doc, 'button', { 'data-action': 'max', title: host.t('Maximizar', 'Maximize') }),
  ]);
  lights.addEventListener('click', event => {
    const action = event.target.closest('button')?.dataset.action;
    if (action === 'close') win.close();
    else if (action === 'min') win.minimize();
    else if (action === 'max') win.windowState === win.STATE_MAXIMIZED ? win.restore() : win.maximize();
  });

  // Ampliar / dejar de ampliar, y dividir: aparecen al acercarse a la esquina de la tarjeta.
  st.grow = el(doc, 'div', { id: 'zero-grow' }, [
    el(doc, 'button', { 'data-action': 'full' }),
    el(doc, 'button', { 'data-action': 'split', title: host.t('Dividir', 'Split'), 'aria-label': host.t('Dividir', 'Split') }),
  ]);
  st.grow.addEventListener('click', event => {
    if (st.dragged) { st.dragged = false; return; } // venía de arrastrarlos, no de pulsar
    const action = event.target.closest('button')?.dataset.action;
    if (action === 'full') setFull(win, st, !root.hasAttribute('zero-full'));
    else if (action === 'split') win.BrowserCommands?.addTabSplitView?.();
  });
  st.backdrop = el(doc, 'canvas', { id: 'zero-backdrop', hidden: 'true' });
  st.notch = el(doc, 'div', { id: 'zero-notch', 'aria-hidden': 'true' });
  doc.body.append(lights, st.grow, st.backdrop, st.notch);
  st.cleanups.push(() => { lights.remove(); st.grow.remove(); st.backdrop.remove(); st.notch.remove(); });
  // Esc deja de ampliar (Risco, 15-10). Es un atajo de la ventana, como los de Gecko: con la web delante,
  // Gecko le pasa la tecla primero y solo lo ejecuta si la web no la ha usado (para cerrar lo suyo).
  host.keys?.add(win, 'kitsune-zero-esc-key', 'VK_ESCAPE', '', () => { if (root.hasAttribute('zero-full')) setFull(win, st, false); });
  st.esc = doc.getElementById('kitsune-zero-esc-key');
  st.cleanups.push(() => st.esc?.setAttribute('disabled', 'true'));
  // Con un vídeo a pantalla completa, Esc lo saca (eso lo hace Gecko, antes que nadie) y, en la misma
  // pulsación, deja de ampliar: se vuelve a la ventana tal cual, sin pasar por la web ampliada.
  listen(win, 'keydown', event => {
    if (event.key !== 'Escape' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (root.hasAttribute('zero-full') && (doc.fullscreenElement || root.hasAttribute('inDOMFullscreen'))) setFull(win, st, false);
  }, { mozSystemGroup: true, capture: true });
  setFull(win, st, false);

  let frame = 0;
  listen(win, 'mousemove', event => {
    if (frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      const card = doc.getElementById('tabbrowser-tabpanels').getBoundingClientRect();
      const on = (el, pad = 6) => { const r = el.getBoundingClientRect(); return event.clientX >= r.left - pad && event.clientX <= r.right + pad && event.clientY >= r.top - pad && event.clientY <= r.bottom + pad; };
      const full = root.hasAttribute('zero-full');
      const grow = st.grow.getBoundingClientRect();
      const kept = el => el.classList.contains('near') && on(el, 14);
      let growNear, lightsNear = false, peek = false;
      if (full) {
        // Cada cosa sale al llevar el puntero al filo de arriba encima de su sitio, y se queda mientras
        // se está encima; los de ampliar, si se dejaron más abajo, al acercarse a ellos.
        const top = event.clientY <= EDGE;
        const over = (r, pad = 24) => event.clientX >= r.left - pad && event.clientX <= r.right + pad;
        growNear = (grow.top < FRAME_TOP ? top && over(grow) : on(st.grow, 40)) || kept(st.grow);
        lightsNear = (top && over(lights.getBoundingClientRect())) || kept(lights);
        const nav = doc.getElementById('nav-bar');
        peek = (top && Math.abs(event.clientX - win.innerWidth / 2) <= 300) || (root.hasAttribute('zero-peek') && !!nav && on(nav, 16));
      } else {
        growNear = savedGrow(st) ? on(st.grow, 40) : (event.clientX <= card.left + 150 && event.clientY <= card.top + 60) || on(st.grow);
      }
      if (st.grow.hasAttribute('dragging')) growNear = true;
      st.grow.classList.toggle('near', growNear);
      lights.classList.toggle('near', full && lightsNear);
      root.toggleAttribute('zero-peek', full && peek);
      st.notch.classList.toggle('away', peek);
    });
  });
  // Los de ampliar se arrastran a donde se quiera (pasados 6 px; menos, es pulsar) y se quedan allí.
  // Mientras está pulsado se escucha toda la ventana: el primer paso ya puede caer fuera de ellos.
  let drag = null;
  const follow = event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x0, event.clientY - drag.y0) < 6) return;
      drag.active = true;
      st.grow.setAttribute('dragging', '');
    }
    const x = Math.min(Math.max(4, event.clientX - drag.dx), win.innerWidth - drag.w - 4);
    const y = Math.min(Math.max(2, event.clientY - drag.dy), win.innerHeight - drag.h - 2);
    st.grow.style.setProperty('--zero-grow-x', `${Math.round(x)}px`);
    st.grow.style.setProperty('--zero-grow-y', `${Math.round(y)}px`);
  };
  const drop = event => {
    if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.id)) return;
    const done = drag; drag = null;
    win.removeEventListener('pointermove', follow, true);
    win.removeEventListener('pointerup', drop, true);
    win.removeEventListener('pointercancel', drop, true);
    if (!done.active) return;
    st.grow.removeAttribute('dragging');
    st.dragged = true; // y el clic que llega detrás no amplía
    win.setTimeout(() => { st.dragged = false; }, 0);
    const r = st.grow.getBoundingClientRect();
    try { host.prefs.setStringPref(prefName(host.prefix, PREFS.growAt), JSON.stringify({ x: +(r.left / win.innerWidth).toFixed(4), y: +(r.top / win.innerHeight).toFixed(4) })); } catch { /* sin ajustes */ }
  };
  st.grow.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const r = st.grow.getBoundingClientRect();
    drag = { id: event.pointerId, dx: event.clientX - r.left, dy: event.clientY - r.top, x0: event.clientX, y0: event.clientY, w: r.width, h: r.height, active: false };
    win.addEventListener('pointermove', follow, true);
    win.addEventListener('pointerup', drop, true);
    win.addEventListener('pointercancel', drop, true);
  });
  st.cleanups.push(() => { win.removeEventListener('pointermove', follow, true); win.removeEventListener('pointerup', drop, true); win.removeEventListener('pointercancel', drop, true); });

  listen(win, 'resize', () => placeGrow(win, st));
  const panels = doc.getElementById('tabbrowser-tabpanels');
  listen(panels, 'transitionend', () => placeGrow(win, st));

  // Velo (y fondo de la web) con cada pestaña y cada página que termina de cargar.
  listen(win.gBrowser.tabContainer, 'TabSelect', () => schedule(win, st));
  const progress = {
    onStateChange(browser, webProgress, request, flags) {
      if (browser === win.gBrowser.selectedBrowser && webProgress?.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_STOP) schedule(win, st);
    },
  };
  win.gBrowser.addTabsProgressListener(progress);
  st.cleanups.push(() => win.gBrowser.removeTabsProgressListener(progress));
  const observer = { observe: () => applyBackdrop(win, st) };
  host.prefs.addObserver(`${host.prefix}backdrop`, observer);
  st.cleanups.push(() => host.prefs.removeObserver(`${host.prefix}backdrop`, observer));

  applyBackdrop(win, st);
  // Si el sistema pasa de claro a oscuro (o al revés), la tinta de lo de encima también.
  const scheme = win.matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => applyBackdrop(win, st);
  scheme.addEventListener('change', onScheme);
  st.cleanups.push(() => scheme.removeEventListener('change', onScheme));
  // Se vuelve a mirar (la regla de niri se puede haber instalado o quitado), y solo se repinta si cambia.
  compositorEnv().then(env => {
    if (state.get(win) !== st || (env.niri === st.env.niri && env.rule === st.env.rule)) return;
    st.env = env; applyBackdrop(win, st);
  }).catch(() => {});
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  transparent.delete(win);
  syncOpaque();
  win.document.getElementById('zero-flip-photo')?.remove(); // la foto de un ampliar a medias
  win.clearTimeout(st.timer);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
  const root = win.document.documentElement;
  for (const name of ['zero-full', 'zero-backdrop', 'zero-peek', 'zero-frame-ink']) root.removeAttribute(name);
  for (const name of ['--zero-tint', '--zero-backdrop-image']) root.style.removeProperty(name);
}
