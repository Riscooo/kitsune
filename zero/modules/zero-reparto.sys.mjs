/* Kitsune Zero · el reparto: coloca la web, el bloc y el asistente en cada ventana (las reglas, puras, en zero-reparto.mjs).
 *
 * Cada panel se apunta con registrar(win, nombre, { panel, forma(), ancho?(px) }): `forma` dice cómo quiere estar ahora
 * ({ lado, forma, ancho, alto }, o null si está cerrado) y `ancho` guarda el ancho que se le da al estirar la columna que
 * comparten. La web cambia de sitio una vez, al abrir o al soltar: nunca en cada fotograma.
 */
import { prefName } from './zero-config.sys.mjs';
import { repartir, parteEn } from './zero-reparto.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const PARTE = 'reparto.parte';
const state = new WeakMap();

const leerParte = st => { try { return Number(st.host.prefs.getStringPref(prefName(st.host.prefix, PARTE), '0.56')) || 0.56; } catch { return 0.56; } };

export function registrar(win, nombre, panel) {
  const st = state.get(win);
  if (!st) return () => {};
  st.paneles.set(nombre, panel);
  return () => { st.paneles.delete(nombre); if (state.get(win) === st) colocar(win); };
}

/** El panel que se acaba de abrir o de usar (en una ventana baja, es el que se ve). */
export function delante(win, nombre) {
  const st = state.get(win);
  if (st) st.ultimo = nombre;
}

/** ¿Cómo están ahora? ('web', 'ia', 'notas', 'pila', 'columnas', 'lados', 'turnos') */
export const formaDe = win => state.get(win)?.reparto?.forma ?? 'web';

function ponerPanel(panel, r) {
  const s = panel.style, px = v => (v === null || v === undefined ? 'auto' : `${v}px`);
  s.top = px(r.arriba); s.bottom = px(r.abajo); s.left = px(r.izq); s.right = px(r.der);
  s.width = r.ancho === null ? 'auto' : px(r.ancho);
  s.height = r.alto ? px(r.alto) : '';
  panel.toggleAttribute('flota', !!r.flota);
  panel.toggleAttribute('oculto', !!r.oculto);
}

/** Lo coloca todo. Con `vivo` (mientras se estira algo), solo los paneles: la web espera a que se suelte. */
export function colocar(win, { vivo = false } = {}) {
  const st = state.get(win);
  if (!st) return;
  const doc = win.document, root = doc.documentElement;
  const datos = { ancho: win.innerWidth, alto: win.innerHeight, parte: st.parteViva ?? leerParte(st), ultimo: st.ultimo };
  for (const [nombre, p] of st.paneles) datos[nombre] = p.forma();
  // Estirando la columna que comparten, los dos a la vez.
  if (st.reparto?.forma === 'pila' && st.tirando && datos.ia && datos.notas) datos.ia.ancho = datos.notas.ancho = datos[st.tirando].ancho;
  const r = repartir(datos);
  st.reparto = r;
  for (const [nombre, p] of st.paneles) if (r[nombre]) ponerPanel(p.panel, r[nombre]); else p.panel.removeAttribute('oculto');
  st.linea.hidden = !r.linea;
  if (r.linea) ponerPanel(st.linea, { arriba: r.linea.arriba, abajo: null, izq: r.linea.izq, der: r.linea.der, ancho: r.linea.ancho });
  if (vivo) return;
  root.toggleAttribute('zero-lados', !!(r.web.izq || r.web.der));
  root.setAttribute('zero-reparto', r.forma);
  root.style.setProperty('--zero-lado-izq', `${r.web.izq}px`);
  root.style.setProperty('--zero-lado-der', `${r.web.der}px`);
}

/** Empieza (nombre) o acaba (null, con el ancho final) de estirar el ancho de un panel. */
export function tirar(win, nombre, ancho = null) {
  const st = state.get(win);
  if (!st) return;
  if (nombre) { st.tirando = nombre; return; }
  if (st.reparto?.forma === 'pila' && st.tirando && ancho) for (const [otro, p] of st.paneles) if (otro !== st.tirando) p.ancho?.(ancho);
  st.tirando = null;
}

export function attach(win, ctx) {
  const doc = win.document, { host } = ctx;
  const t = host.t ?? (es => es);
  const st = { host, paneles: new Map(), ultimo: 'notas', reparto: null, tirando: null, parteViva: null, cleanups: [] };
  state.set(win, st);
  // La línea entre el bloc y el asistente, cuando comparten columna: se arrastra; doble clic, como de serie.
  st.linea = doc.createElementNS(HTML, 'div');
  st.linea.id = 'zero-reparto-linea';
  st.linea.setAttribute('role', 'separator');
  st.linea.setAttribute('aria-orientation', 'horizontal');
  st.linea.setAttribute('aria-label', t('Repartir el espacio entre el bloc y el asistente', 'Share the space between notes and assistant'));
  st.linea.tabIndex = 0;
  st.linea.hidden = true;
  doc.body.append(st.linea);
  const guardar = parte => { try { host.prefs.setStringPref(prefName(host.prefix, PARTE), String(parte)); } catch { /* sin ajustes */ } };
  let arrastre = null;
  st.linea.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    arrastre = { dy: event.clientY - st.linea.getBoundingClientRect().top };
    st.linea.setPointerCapture(event.pointerId);
    st.linea.setAttribute('moviendo', '');
  });
  st.linea.addEventListener('pointermove', event => {
    if (!arrastre) return;
    st.parteViva = parteEn(event.clientY - arrastre.dy, win.innerHeight);
    colocar(win, { vivo: true });
  });
  const soltar = () => {
    if (!arrastre) return;
    arrastre = null;
    st.linea.removeAttribute('moviendo');
    if (st.parteViva) guardar(st.parteViva);
    st.parteViva = null;
    colocar(win);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) st.linea.addEventListener(type, soltar);
  st.linea.addEventListener('dblclick', () => { guardar(0.56); colocar(win); });
  st.linea.addEventListener('keydown', event => {
    const paso = { ArrowUp: -0.04, ArrowDown: 0.04 }[event.key];
    if (!paso) return;
    event.preventDefault();
    guardar(Math.min(0.8, Math.max(0.2, leerParte(st) + paso)));
    colocar(win);
  });
  const alCambiar = () => colocar(win);
  win.addEventListener('resize', alCambiar);
  st.cleanups.push(() => win.removeEventListener('resize', alCambiar), () => st.linea.remove());
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  const root = win.document.documentElement;
  for (const nombre of ['zero-lados', 'zero-reparto']) root.removeAttribute(nombre);
  for (const nombre of ['--zero-lado-izq', '--zero-lado-der']) root.style.removeProperty(nombre);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}
