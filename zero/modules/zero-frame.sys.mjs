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
  return { niri, rule };
}

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
  if (root.getAttribute('zero-backdrop') !== 'web') {
    root.style.removeProperty('--zero-backdrop-image'); delete st.backdrop.dataset.painted;
    // Con el cristal del sistema, detrás está el escritorio: no se sabe su luz, se queda en blanco.
    root.removeAttribute('zero-frame-ink'); st.frameInk = 'white';
  }
  paintColors(win, st);
}

/** Dónde van los botones de ampliar y dividir. Con la tarjeta, en el marco, a la derecha de los de
 *  ventana: no tapan la web. Con la web ampliada no queda marco y van encima, en la zona de arriba que
 *  menos usan las webs (ver FULL_SPOT). */
function placeGrow(win, st) {
  const doc = win.document, root = doc.documentElement;
  const card = doc.getElementById('tabbrowser-tabpanels').getBoundingClientRect();
  const height = st.grow.getBoundingClientRect().height || 30;
  if (root.hasAttribute('zero-full')) {
    // Arriba a la derecha, juntos: los de ampliar pegados al borde y los de ventana a su izquierda.
    const grow = st.grow.getBoundingClientRect(), lights = st.lights.getBoundingClientRect();
    const growX = win.innerWidth - CORNER.right - grow.width;
    st.grow.style.setProperty('--zero-grow-x', `${Math.round(growX)}px`);
    st.grow.style.setProperty('--zero-grow-y', `${CORNER.top}px`);
    st.lights.style.setProperty('--zero-lights-x', `${Math.round(growX - CORNER.gap - lights.width)}px`);
    // Lo que se quiera poner en la esquina (el pomodoro) va a la izquierda de los de ventana.
    root.style.setProperty('--zero-corner-left', `${Math.round(growX - CORNER.gap - lights.width)}px`);
    st.lights.style.setProperty('--zero-lights-y', `${Math.round(CORNER.top + (grow.height - lights.height) / 2)}px`);
  } else {
    const lights = doc.getElementById('zero-lights')?.getBoundingClientRect();
    st.grow.style.setProperty('--zero-grow-x', `${Math.round((lights?.right ?? 62) + 14)}px`);
    st.grow.style.setProperty('--zero-grow-y', `${Math.max(2, Math.round((card.top - height) / 2))}px`);
  }
}

// Con la web ampliada no queda marco: los botones de ventana y los de ampliar se guardan en un tirador
// fino pegado al filo de arriba, en la esquina derecha, y salen al acercarse. Es la zona que menos usan
// las webs (tools/zonas_web.py, 52 webs a dos anchos): ahí un tirador de 36 × 6 solo toca algo en el
// 9,6 % de ellas; donde estaban (arriba a la izquierda), los de ampliar tapaban algo en el 58,7 %.
const CORNER = { top: 6, right: 8, gap: 6 };

/** Cambia el sitio de la tarjeta (ampliar, entrar en Zero) sin redimensionar la web en cada
 *  fotograma: la web toma su tamaño nuevo una sola vez y la tarjeta viaja desde donde estaba con una
 *  transformación, que la hace la tarjeta gráfica (FLIP). Avisa con «zero-move» (el cristal en vivo
 *  lo sigue). */
export function flip(win, change) {
  const panels = win.document.getElementById('tabbrowser-tabpanels');
  if (!panels) { change(); return null; }
  const first = panels.getBoundingClientRect();
  for (const animation of panels.getAnimations()) animation.cancel(); // uno a medias: se sale de donde está ahora
  change();
  const last = panels.getBoundingClientRect();
  const ms = parseFloat(win.getComputedStyle(win.document.documentElement).getPropertyValue('--zero-t-move')) || 0;
  if (!first.width || !last.width || ms < 2 || win.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const dx = first.left - last.left, dy = first.top - last.top, sx = first.width / last.width, sy = first.height / last.height;
  if (Math.abs(dx) + Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return null;
  const animation = panels.animate([
    { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
    { transformOrigin: '0 0', transform: 'none' },
  ], { duration: ms, easing: 'cubic-bezier(.32, .72, 0, 1)' });
  win.dispatchEvent(new win.CustomEvent('zero-move', { detail: { ms } }));
  return animation;
}

function setFull(win, st, on) {
  const root = win.document.documentElement;
  const animation = flip(win, () => root.toggleAttribute('zero-full', on));
  animation?.finished.then(() => placeGrow(win, st), () => {});
  const button = st.grow.querySelector('[data-action=full]');
  button.textContent = on ? '⤡' : '⤢';
  button.title = on ? st.host.t('Dejar de ampliar', 'Restore') : st.host.t('Ampliar', 'Fill the window');
  placeGrow(win, st);
}

export function attach(win, ctx) {
  const doc = win.document, root = doc.documentElement, { host } = ctx;
  const st = { host, env: { niri: false, rule: false }, cleanups: [] };
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
    el(doc, 'button', { 'data-action': 'split', title: host.t('Dividir', 'Split') }, ['◫']),
  ]);
  st.grow.addEventListener('click', event => {
    const action = event.target.closest('button')?.dataset.action;
    if (action === 'full') setFull(win, st, !root.hasAttribute('zero-full'));
    else if (action === 'split') win.BrowserCommands?.addTabSplitView?.();
  });
  st.backdrop = el(doc, 'canvas', { id: 'zero-backdrop', hidden: 'true' });
  st.notch = el(doc, 'div', { id: 'zero-notch', 'aria-hidden': 'true' });
  doc.body.append(lights, st.grow, st.backdrop, st.notch);
  st.cleanups.push(() => { lights.remove(); st.grow.remove(); st.backdrop.remove(); st.notch.remove(); });
  setFull(win, st, false);

  let frame = 0;
  listen(win, 'mousemove', event => {
    if (frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      const card = doc.getElementById('tabbrowser-tabpanels').getBoundingClientRect();
      const on = el => { const r = el.getBoundingClientRect(); return event.clientX >= r.left - 6 && event.clientX <= r.right + 6 && event.clientY >= r.top - 6 && event.clientY <= r.bottom + 6; };
      const full = root.hasAttribute('zero-full');
      // Salen al acercarse: con la tarjeta, a su rincón de arriba a la izquierda; con la web ampliada,
      // a la esquina de arriba a la derecha (o estando encima de ellos).
      const near = full
        ? (event.clientX >= win.innerWidth - 240 && event.clientY <= 56) || (st.grow.classList.contains('near') && (on(st.grow) || on(lights)))
        : (event.clientX <= card.left + 150 && event.clientY <= card.top + 60) || on(st.grow);
      st.grow.classList.toggle('near', near);
      lights.classList.toggle('near', full && near);
      st.notch.classList.toggle('away', near);
      root.toggleAttribute('zero-corner-open', full && near);
    });
  });
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
  compositorEnv().then(env => { if (state.get(win) === st) { st.env = env; applyBackdrop(win, st); } });
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  win.clearTimeout(st.timer);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
  const root = win.document.documentElement;
  for (const name of ['zero-full', 'zero-backdrop', 'zero-corner-open', 'zero-frame-ink']) root.removeAttribute(name);
  for (const name of ['--zero-tint', '--zero-backdrop-image', '--zero-corner-left']) root.style.removeProperty(name);
}
