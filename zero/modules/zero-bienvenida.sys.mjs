/* Kitsune Zero · el primer arranque: tres tarjetas pequeñas, cada una junto a lo que cuenta, y ya.
 *
 * «Un primer arranque que enseñe lo justo»: solo en un perfil nuevo y solo como navegador aparte (host.app). Se salta con Esc
 * o con «Saltar» y no vuelve. Quien ya usaba Kitsune Zero no la ve nunca.
 */
import { prefName, PREFS } from './zero-config.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const VISTA = 'bienvenida';
const DIA = 86_400_000;
const state = new WeakMap();
let mostrada = false; // en una sola ventana

const el = (doc, tag, attrs = {}, kids = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
};
const leer = (host, key, otro) => { try { return host.prefs.getBoolPref(prefName(host.prefix, key), otro); } catch { return true; } };
const apuntar = host => { try { host.prefs.setBoolPref(prefName(host.prefix, VISTA), true); } catch { /* sin ajustes */ } };

async function perfilNuevo() {
  try {
    const { ProfileAge } = ChromeUtils.importESModule('resource://gre/modules/ProfileAge.sys.mjs');
    return Date.now() - await (await ProfileAge()).created < DIA;
  } catch { return false; }
}

const pasos = t => [
  { junto: '#nav-bar', titulo: t('Esto es la isla', 'This is the island'), texto: t('Escribe para buscar o para ir a una web. Al pasar el ratón salen atrás, adelante y el menú.', 'Type to search or to go to a page. Hover it for back, forward and the menu.') },
  { junto: '#zero-dock', titulo: t('A la izquierda, lo tuyo', 'Your things, on the left'), texto: t('Tus perfiles, los modos (Currar, Chill y Estudio), las pestañas y la música.', 'Your profiles, the modes (Work, Chill and Study), your tabs and your music.') },
  { junto: '#zero-notas-boton', titulo: t('Tu bloc y tu asistente', 'Your notes and your assistant'), texto: t('El bloc va cifrado y se queda en este ordenador (Ctrl+Alt+N). El asistente usa tu Claude y no puede leerlo.', 'Your notes are encrypted and stay on this computer (Ctrl+Alt+N). The assistant uses your Claude and cannot read them.') },
];

function pintar(win, st) {
  const doc = win.document, t = st.t, paso = st.pasos[st.i], ultimo = st.i === st.pasos.length - 1;
  st.titulo.textContent = paso.titulo;
  st.texto.textContent = paso.texto;
  st.seguir.textContent = ultimo ? t('Empezar', 'Start') : t('Siguiente', 'Next');
  st.saltar.hidden = ultimo;
  [...st.puntos.children].forEach((p, i) => p.toggleAttribute('on', i === st.i));
  const r = doc.querySelector(paso.junto)?.getBoundingClientRect();
  if (!r || !r.width) { st.aro.hidden = true; return; }
  st.aro.hidden = false;
  Object.assign(st.aro.style, { left: `${r.x - 5}px`, top: `${r.y - 5}px`, width: `${r.width + 10}px`, height: `${r.height + 10}px` });
  // Al lado de lo que cuenta: debajo de la isla, a la derecha de la columna.
  const w = st.tarjeta.offsetWidth, h = st.tarjeta.offsetHeight, abajo = r.width > r.height;
  const x = abajo ? r.x + r.width / 2 - w / 2 : r.right + 20, y = abajo ? r.bottom + 18 : r.y + r.height / 2 - h / 2;
  st.tarjeta.style.left = `${Math.round(Math.max(12, Math.min(win.innerWidth - w - 12, x)))}px`;
  st.tarjeta.style.top = `${Math.round(Math.max(12, Math.min(win.innerHeight - h - 12, y)))}px`;
}

function cerrar(win, st) {
  apuntar(st.host);
  st.caja?.removeAttribute('open');
  win.setTimeout(() => { st.caja?.remove(); st.caja = null; }, 320);
}

function abrir(win, st) {
  const doc = win.document, t = st.t;
  st.pasos = pasos(t);
  st.i = 0;
  st.titulo = el(doc, 'h4'); st.texto = el(doc, 'p');
  st.saltar = el(doc, 'button', { type: 'button', class: 'zb-saltar' }, [t('Saltar', 'Skip')]);
  st.seguir = el(doc, 'button', { type: 'button', class: 'zb-seguir' });
  st.puntos = el(doc, 'span', { class: 'zb-puntos', 'aria-hidden': 'true' }, st.pasos.map(() => el(doc, 'i')));
  st.tarjeta = el(doc, 'div', { class: 'zb-tarjeta', role: 'dialog', 'aria-label': t('Bienvenida', 'Welcome'), 'aria-live': 'polite' }, [st.titulo, st.texto, el(doc, 'div', { class: 'zb-pie' }, [st.puntos, st.saltar, st.seguir])]);
  st.aro = el(doc, 'div', { class: 'zb-aro', 'aria-hidden': 'true' });
  st.caja = el(doc, 'div', { id: 'zero-bienvenida' }, [st.aro, st.tarjeta]);
  doc.body.append(st.caja);
  st.saltar.addEventListener('click', () => cerrar(win, st));
  st.seguir.addEventListener('click', () => { if (++st.i < st.pasos.length) pintar(win, st); else cerrar(win, st); });
  pintar(win, st);
  win.requestAnimationFrame(() => { st.caja?.setAttribute('open', ''); st.seguir.focus({ focusVisible: false }); });
}

export function attach(win, ctx) {
  const { host } = ctx;
  if (!host?.app || !host.prefs || mostrada || win.PrivateBrowsingUtils?.isWindowPrivate(win)) return;
  if (leer(host, VISTA, false) || leer(host, PREFS.welcomed, false)) return;
  const st = { host, t: host.t ?? (es => es), cleanups: [] };
  state.set(win, st);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };
  listen(win, 'keydown', event => { if (event.key === 'Escape' && st.caja) { event.preventDefault(); cerrar(win, st); } }, true);
  listen(win, 'resize', () => { if (st.caja) pintar(win, st); });
  void (async () => {
    if (!await perfilNuevo()) { apuntar(host); return; }
    if (mostrada || state.get(win) !== st) return;
    mostrada = true;
    st.reloj = win.setTimeout(() => { if (state.get(win) === st) abrir(win, st); }, 1600);
  })();
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  win.clearTimeout(st.reloj);
  st.caja?.remove();
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}

/** Para las pruebas. */
export const _debug = { abrir: win => abrir(win, state.get(win)), estado: win => state.get(win) };
