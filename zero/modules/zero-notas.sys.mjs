/* Kitsune Zero · el bloc de notas: su botón en la columna y su panel.
 *
 * Risco (23-11): «nos vendría muy bien tener un block de notas… que puedas guardarlos ahí, quiero que ese block sea ultra
 * privado… que sea algo en local, también quiero que se puedan abrir esas notas antiguas… que sea algo clean, y no
 * sobresaturar a la gente».
 *
 * - Dos vistas, una a la vez: la lista (buscar, las fijadas primero) y la nota. Se guarda solo, cifrado, en el perfil.
 * - Sin contraseña general. A una nota se le puede poner una (menú ⋯): de ella solo se ve el título, y se vuelve a cerrar
 *   al salir de ella, al cerrar el panel o a los cinco minutos sin tocarla.
 * - Lo que se marca en una web llega aquí con zero-rotulador (citar) y lo del asistente con guardar().
 * - El panel va a un lado, junto a la web y al asistente (zero-reparto). Ctrl+Alt+N lo abre y lo cierra.
 */
import { prefName } from './zero-config.sys.mjs';
import { resumen, urlLimpia, aMarkdown, deTexto, tituloLimpio } from './zero-notas.mjs';
import { MINIMO_CONTRASENA } from './zero-cofre.mjs';
import * as almacen from './zero-notas-almacen.sys.mjs';
import { crearEditor } from './zero-notas-editor.sys.mjs';
import * as reparto from './zero-reparto.sys.mjs';
import { sumar } from './zero-stats.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const P = { lado: 'notas.lado', ancho: 'notas.ancho', ultima: 'notas.ultima' };
const OLVIDO = 5 * 60_000;
const state = new WeakMap();

const el = (doc, tag, attrs = {}, kids = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
  node.append(...kids);
  return node;
};
const pref = (host, key, fallback) => { try { return host.prefs.getStringPref(prefName(host.prefix, key), fallback); } catch { return fallback; } };
const setPref = (host, key, value) => { try { host.prefs.setStringPref(prefName(host.prefix, key), String(value)); } catch { /* sin ajustes */ } };

function forma(win, st) {
  if (!st.panel.hasAttribute('open')) return null;
  const ancho = st.estirando ?? (Number(pref(st.host, P.ancho, '400')) || 400);
  return { lado: pref(st.host, P.lado, 'right') === 'left' ? 'izq' : 'der', ancho };
}

const cuando = (ms, t) => {
  const d = new Date(ms), hoy = new Date();
  const dia = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((dia(hoy) - dia(d)) / 86_400_000);
  const locale = t('es-ES', 'en-GB');
  if (dias <= 0) return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
  if (dias === 1) return t('ayer', 'yesterday');
  return new Intl.DateTimeFormat(locale, dias < 300 ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
};

// ---------------------------------------------------------------- las vistas

function vista(st, nombre) {
  st.panel.setAttribute('vista', nombre);
  cerrarMenu(st);
}

function pintarLista(win, st) {
  const doc = win.document, t = st.t;
  const notas = almacen.lista(st.buscar.value);
  st.vaciaLista.hidden = notas.length > 0;
  st.vaciaLista.textContent = st.buscar.value.trim() ? t('No hay ninguna nota con eso.', 'No notes match that.') : t('Aún no hay notas. Escribe la primera.', 'No notes yet. Write your first one.');
  st.lista.replaceChildren(...notas.map(nota => {
    const { titulo, texto } = resumen(nota, t);
    const fila = el(doc, 'button', { type: 'button', class: 'zn-nota', role: 'listitem', 'data-id': nota.id }, [
      el(doc, 'span', { class: 'zn-nota-titulo' }, [titulo]),
      el(doc, 'span', { class: 'zn-nota-texto' }, [nota.conContrasena && !texto ? t('Con contraseña', 'Password protected') : texto]),
      el(doc, 'span', { class: 'zn-nota-cuando' }, [cuando(nota.tocada, t)]),
    ]);
    fila.toggleAttribute('fijada', nota.fijada);
    fila.toggleAttribute('cerrada', !!nota.conContrasena);
    return fila;
  }));
  const mal = almacen.cuantasEstropeadas();
  st.aviso.hidden = !mal;
  if (mal) st.aviso.textContent = t(`${mal} no se han podido abrir. Siguen guardadas.`, `${mal} could not be opened. They are still stored.`);
}

async function irALista(win, st) {
  await dejarNota(win, st);
  vista(st, 'lista');
  pintarLista(win, st);
}

/** Sale de la nota: la guarda, la cierra si lleva contraseña y la olvida si está en blanco. */
async function dejarNota(win, st) {
  win.clearTimeout(st.olvido);
  const id = st.id;
  if (!id) return;
  recoger(win, st);
  st.id = null;
  await almacen.guardarYa(id);
  await almacen.cerrarNota(id);
  almacen.soltar(id);
}

async function editor(win, st) {
  st.editorListo ??= crearEditor(win, st.hueco, {
    guia: st.t('Escribe aquí. «# » hace un título, «- » una lista y «[] » una casilla.', 'Write here. «# » makes a heading, «- » a list and «[] » a checkbox.'),
    alEscribir: () => escrito(win, st),
    alOrigen: (url, texto) => abrirOrigen(win, st, url, texto),
    alEscape: () => cerrarConTeclado(win, st),
  }).then(ed => { st.editor = ed; ed.colores(win.getComputedStyle(st.panel)); return ed; });
  // Si no ha salido, la próxima vez se vuelve a intentar.
  st.editorListo.catch(error => { console.error('Kitsune Zero: bloc', error); st.editorListo = null; });
  return st.editorListo;
}

/** Abre una nota en el panel (o la pantalla de su contraseña). */
async function irANota(win, st, id, { foco = true } = {}) {
  if (st.id && st.id !== id) await dejarNota(win, st);
  const nota = almacen.ver(id);
  if (!nota) { vista(st, 'lista'); pintarLista(win, st); return; }
  st.id = id;
  setPref(st.host, P.ultima, id);
  st.titulo.value = nota.titulo;
  pintarCabecera(win, st);
  if (!nota.bloques) {
    vista(st, 'cerrada');
    st.clave.value = '';
    st.claveMal.hidden = true;
    if (foco) st.clave.focus();
    return;
  }
  vista(st, 'nota');
  const ed = await editor(win, st);
  if (st.id !== id) return;
  ed.colores(win.getComputedStyle(st.panel));
  ed.poner(nota.bloques);
  st.puesta = id;
  if (foco) { if (nota.titulo || nota.bloques.some(b => b.x.length)) ed.alFinal(); else ed.enfocar(); }
  alRato(win, st);
}

function pintarCabecera(win, st) {
  const nota = st.id ? almacen.ver(st.id) : null;
  st.panel.toggleAttribute('con-contrasena', !!nota?.conContrasena);
}

function nueva(win, st, con) {
  const id = almacen.crear(con);
  return irANota(win, st, id).then(() => id);
}

// ---------------------------------------------------------------- escribir

const PAUSA = 250;
function escrito(win, st) {
  win.clearTimeout(st.escribiendo);
  st.escribiendo = win.setTimeout(() => recoger(win, st), PAUSA);
  alRato(win, st);
}

/** Lo escrito pasa al almacén (que lo guarda cifrado). */
function recoger(win, st) {
  win.clearTimeout(st.escribiendo);
  if (!st.id || !st.editor || st.puesta !== st.id || st.panel.getAttribute('vista') !== 'nota') return;
  const antes = almacen.ver(st.id), bloques = st.editor.leer(), titulo = tituloLimpio(st.titulo.value);
  if (!antes?.bloques || (antes.titulo === titulo && JSON.stringify(antes.bloques) === JSON.stringify(bloques))) return;
  const estaba = antes.bloques.some(b => b.x.length) || antes.titulo.trim();
  almacen.cambiar(st.id, { titulo, bloques }, win);
  if (!estaba) sumar('notas');
}

/** Una nota con contraseña se cierra sola al rato sin tocarla. */
function alRato(win, st) {
  win.clearTimeout(st.olvido);
  if (!st.id || !almacen.ver(st.id)?.conContrasena) return;
  const id = st.id;
  st.olvido = win.setTimeout(async () => { if (st.id !== id) return; recoger(win, st); await almacen.cerrarNota(id); void irANota(win, st, id, { foco: false }); }, OLVIDO);
}

async function abrirOrigen(win, st, url, texto) {
  const destino = urlLimpia(url);
  if (!destino) return;
  const limpio = u => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return u; } };
  const ya = win.gBrowser.visibleTabs.find(tab => limpio(tab.linkedBrowser?.currentURI?.spec ?? '') === limpio(destino));
  if (ya) win.gBrowser.selectedTab = ya;
  else win.openTrustedLinkIn(destino, 'tab');
  void texto;
}

// ---------------------------------------------------------------- el menú ⋯, los avisos y las contraseñas

function cerrarMenu(st) { st.menu.removeAttribute('open'); st.mas.setAttribute('aria-expanded', 'false'); }

function abrirMenu(win, st) {
  if (st.menu.hasAttribute('open')) { cerrarMenu(st); return; }
  const t = st.t, doc = win.document, enNota = st.id && ['nota', 'cerrada'].includes(st.panel.getAttribute('vista'));
  const nota = enNota ? almacen.ver(st.id) : null;
  const filas = [];
  const fila = (texto, hacer, clase) => { const b = el(doc, 'button', { type: 'button', role: 'menuitem', class: clase }, [texto]); b.addEventListener('click', () => { cerrarMenu(st); void hacer(); }); filas.push(b); };
  if (nota) {
    fila(nota.fijada ? t('Dejar de fijar', 'Unpin') : t('Fijar arriba', 'Pin to top'), () => almacen.cambiar(st.id, { fijada: !nota.fijada }));
    if (nota.bloques) {
      if (nota.conContrasena) fila(t('Quitar la contraseña', 'Remove the password'), async () => { recoger(win, st); if (await almacen.quitarContrasena(st.id)) { pintarCabecera(win, st); decir(win, st, t('Sin contraseña', 'Password removed')); } });
      else fila(t('Ponerle contraseña…', 'Add a password…'), () => pedirClave(win, st, 'poner'));
      fila(t('Copiar el texto', 'Copy the text'), () => { Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(aMarkdown(almacen.ver(st.id))); decir(win, st, t('Copiado', 'Copied')); });
    }
    fila(t('Borrar la nota', 'Delete the note'), () => borrar(win, st, st.id), 'zn-mal');
  } else {
    fila(t('Copia para otro ordenador…', 'Backup for another computer…'), () => pedirClave(win, st, 'copia'));
    fila(t('Traer una copia…', 'Bring a backup…'), () => traer(win, st));
  }
  filas.push(el(doc, 'hr'));
  fila(t('Poner al otro lado', 'Move to the other side'), () => setPref(st.host, P.lado, pref(st.host, P.lado, 'right') === 'left' ? 'right' : 'left'));
  st.menu.replaceChildren(...filas);
  st.menu.setAttribute('open', '');
  st.mas.setAttribute('aria-expanded', 'true');
  st.menu.querySelector('button')?.focus();
}

/** Una línea abajo, un momento (con «Deshacer» si se da `hacer`). */
function decir(win, st, texto, accion = null, hacer = null) {
  win.clearTimeout(st.diciendo);
  st.dice.replaceChildren(el(win.document, 'span', {}, [texto]));
  if (hacer) {
    const b = el(win.document, 'button', { type: 'button' }, [accion]);
    b.addEventListener('click', () => { st.dice.removeAttribute('open'); hacer(); });
    st.dice.append(b);
  }
  st.dice.setAttribute('open', '');
  st.diciendo = win.setTimeout(() => st.dice.removeAttribute('open'), hacer ? 7000 : 2200);
}

async function borrar(win, st, id) {
  win.clearTimeout(st.escribiendo);
  st.id = null;
  const deshacer = await almacen.borrar(id);
  vista(st, 'lista');
  pintarLista(win, st);
  decir(win, st, st.t('Nota borrada', 'Note deleted'), st.t('Deshacer', 'Undo'), () => { deshacer(); void irANota(win, st, id); });
}

/** La hoja que pide una contraseña: 'poner' (a esta nota), 'copia' (para sacarla) o 'traer' (para abrirla). */
function pedirClave(win, st, para) {
  const t = st.t;
  st.pide = para;
  recoger(win, st);
  st.desde = st.panel.getAttribute('vista');
  st.pideTitulo.textContent = { poner: t('Una contraseña para esta nota', 'A password for this note'), copia: t('Copia para otro ordenador', 'Backup for another computer'), traer: t('Abrir la copia', 'Open the backup') }[para];
  st.pideTexto.textContent = {
    poner: t('De la nota solo se verá el título. Si la olvidas, no se puede recuperar.', 'Only its title will show. If you forget it, it cannot be recovered.'),
    copia: t('Un archivo cifrado con la contraseña que elijas. Hará falta para abrirlo.', 'A file encrypted with the password you choose. You will need it to open it.'),
    traer: t('La contraseña que se le puso al hacerla.', 'The password it was made with.') }[para];
  st.clave1.value = st.clave2.value = '';
  st.clave2.hidden = para === 'traer';
  st.pideMal.hidden = true;
  st.pideBoton.textContent = { poner: t('Ponerla', 'Set it'), copia: t('Guardar copia', 'Save backup'), traer: t('Traer', 'Bring') }[para];
  vista(st, 'pide');
  st.clave1.focus();
}

async function claveDada(win, st) {
  const t = st.t, clave = st.clave1.value;
  const mal = texto => { st.pideMal.textContent = texto; st.pideMal.hidden = false; };
  if (clave.length < MINIMO_CONTRASENA) { mal(t(`Al menos ${MINIMO_CONTRASENA} caracteres.`, `At least ${MINIMO_CONTRASENA} characters.`)); return; }
  if (st.pide !== 'traer' && clave !== st.clave2.value) { mal(t('No son iguales.', 'They do not match.')); return; }
  st.pideBoton.disabled = true;
  try {
    if (st.pide === 'poner') {
      if (await almacen.ponerContrasena(st.id, clave)) decir(win, st, t('Con contraseña', 'Password set'));
      pintarCabecera(win, st);
      vista(st, 'nota');
      alRato(win, st);
    } else if (st.pide === 'copia') {
      const texto = await almacen.hacerCopia(clave);
      const archivo = await elegirArchivo(win, st, true);
      if (archivo) { await IOUtils.writeUTF8(archivo, texto, { tmpPath: `${archivo}.tmp` }); decir(win, st, t('Copia guardada', 'Backup saved')); }
      vista(st, 'lista');
    } else {
      const n = await almacen.traerCopia(st.copia, clave);
      vista(st, 'lista');
      pintarLista(win, st);
      decir(win, st, n ? t(`${n} notas traídas`, `${n} notes brought`) : t('Ya estaba todo', 'Nothing new'));
    }
    st.clave1.value = st.clave2.value = '';
  } catch (error) {
    if (error?.message === 'contraseña') mal(t('No es esa contraseña.', 'Wrong password.'));
    else if (error?.message === 'copia' || error?.message === 'sobre') mal(t('Ese archivo no es una copia del bloc.', 'That file is not a notes backup.'));
    else { console.error('Kitsune Zero: bloc', error); mal(t('No ha salido bien.', 'That did not work.')); }
  } finally { st.pideBoton.disabled = false; }
}

function elegirArchivo(win, st, guardar) {
  const t = st.t;
  const picker = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
  picker.init(win.browsingContext, guardar ? t('Guardar la copia del bloc', 'Save the notes backup') : t('Traer una copia del bloc', 'Bring a notes backup'), guardar ? Ci.nsIFilePicker.modeSave : Ci.nsIFilePicker.modeOpen);
  picker.appendFilter(t('Copia del bloc', 'Notes backup'), '*.kitsune-bloc');
  if (guardar) { picker.defaultString = `bloc-${new Date().toLocaleDateString('sv-SE')}.kitsune-bloc`; picker.defaultExtension = 'kitsune-bloc'; }
  return new Promise(listo => picker.open(r => listo(r === Ci.nsIFilePicker.returnCancel ? null : picker.file?.path ?? null)));
}

async function traer(win, st) {
  const archivo = await elegirArchivo(win, st, false);
  if (!archivo) return;
  try { st.copia = await IOUtils.readUTF8(archivo, { maxBytes: 64 * 1024 * 1024 }); } catch { decir(win, st, st.t('No se puede leer', 'It cannot be read')); return; }
  pedirClave(win, st, 'traer');
}

// ---------------------------------------------------------------- abrir y cerrar el panel

async function abrir(win, st, abierto = !st.panel.hasAttribute('open'), { foco = true } = {}) {
  st.panel.toggleAttribute('open', abierto);
  st.boton.setAttribute('aria-expanded', String(abierto));
  st.boton.toggleAttribute('open', abierto);
  if (abierto) reparto.delante(win, 'notas');
  reparto.colocar(win);
  for (const fn of st.alAbrir) fn(abierto);
  if (!abierto) { await dejarNota(win, st); return; }
  try { await almacen.cargar(); } catch (error) {
    vista(st, 'sin-llave');
    if (error?.message !== 'llave') console.error('Kitsune Zero: bloc', error);
    return;
  }
  if (!st.panel.hasAttribute('open') || st.id) return;
  // Se vuelve a donde se estaba: la última nota, o la lista; sin notas, una en blanco.
  const ultima = pref(st.host, P.ultima, '');
  if (st.volver && ultima && almacen.ver(ultima)) await irANota(win, st, ultima, { foco });
  else if (!almacen.hay()) await nueva(win, st);
  else { vista(st, 'lista'); pintarLista(win, st); if (foco) st.buscar.focus(); }
  st.volver = false;
}

function cerrarConTeclado(win, st) {
  if (st.menu.hasAttribute('open')) { cerrarMenu(st); st.mas.focus(); return; }
  void abrir(win, st, false);
  st.boton.focus();
}

/** ¿Está abierto el bloc en esta ventana? */
export const abierto = win => !!state.get(win)?.panel.hasAttribute('open');

/** Abre (o cierra) el bloc. `volver`: en la última nota, no en la lista. */
export function mostrar(win, on = true, { volver = false, foco = false } = {}) {
  const st = state.get(win);
  if (!st || st.panel.hasAttribute('open') === on) return;
  st.volver = volver;
  void abrir(win, st, on, { foco });
}

export function alAbrir(win, fn) {
  const st = state.get(win);
  st?.alAbrir.add(fn);
  return () => st?.alAbrir.delete(fn);
}

/** La nota a la que va lo que se guarda desde fuera: la que se ve, o la última que se usó; si no, una nueva. */
async function destino(win, st, titulo) {
  await almacen.cargar();
  if (st.id && almacen.ver(st.id)?.bloques) { recoger(win, st); return st.id; }
  const ultima = pref(st.host, P.ultima, '');
  if (ultima && almacen.ver(ultima)?.bloques) return ultima;
  const id = almacen.crear({ titulo: tituloLimpio(titulo) });
  setPref(st.host, P.ultima, id);
  sumar('notas');
  return id;
}

async function repintarSi(win, st, id) {
  if (st.id !== id || st.panel.getAttribute('vista') !== 'nota' || !st.editor) return;
  st.editor.poner(almacen.ver(id).bloques);
  st.editor.frame.contentWindow.scrollTo(0, st.editor.hoja.scrollHeight);
}

/** Lleva un texto marcado a la nota, con su origen. Abre el bloc en esa nota si está abierto (o con `abrir`). */
export async function citar(win, texto, de, { abrir: abrirlo = true } = {}) {
  const st = state.get(win);
  if (!st || !String(texto ?? '').trim()) return false;
  try {
    const id = await destino(win, st, de?.titulo);
    if (!almacen.citar(id, texto, de)) return false;
    sumar('citas');
    if (st.panel.hasAttribute('open')) { if (st.id === id) await repintarSi(win, st, id); else await irANota(win, st, id, { foco: false }); } else if (abrirlo) { st.volver = true; await abrir(win, st, true, { foco: false }); }
    if (st.panel.hasAttribute('open')) decir(win, st, st.t('En tu nota', 'Added to your note'));
    return true;
  } catch (error) { console.error('Kitsune Zero: bloc', error); return false; }
}

/** Guarda lo que ha dicho el asistente. Va de él al bloc, nunca al revés. */
export async function guardar(win, texto) {
  const st = state.get(win);
  if (!st || !String(texto ?? '').trim()) return false;
  try {
    const id = await destino(win, st, '');
    if (!almacen.anadir(id, deTexto(texto))) return false;
    if (st.panel.hasAttribute('open')) { if (st.id === id) await repintarSi(win, st, id); else await irANota(win, st, id, { foco: false }); } else { st.volver = true; await abrir(win, st, true, { foco: false }); }
    decir(win, st, st.t('En tu nota', 'Added to your note'));
    return true;
  } catch (error) { console.error('Kitsune Zero: bloc', error); return false; }
}

// ---------------------------------------------------------------- montar y desmontar

function estirar(win, st) {
  let a = null;
  st.asa.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    a = { x: event.clientX, de: st.panel.getBoundingClientRect().width, izq: pref(st.host, P.lado, 'right') === 'left' };
    st.asa.setPointerCapture(event.pointerId);
    st.panel.setAttribute('resizing', '');
    reparto.tirar(win, 'notas');
  });
  st.asa.addEventListener('pointermove', event => {
    if (!a) return;
    st.estirando = Math.round(Math.min(win.innerWidth * 0.7, Math.max(300, a.de + (event.clientX - a.x) * (a.izq ? 1 : -1))));
    reparto.colocar(win, { vivo: true });
  });
  const soltar = () => {
    if (!a) return;
    a = null;
    st.panel.removeAttribute('resizing');
    const ancho = st.estirando;
    st.estirando = null;
    reparto.tirar(win, null, ancho);
    if (ancho) setPref(st.host, P.ancho, ancho); else reparto.colocar(win);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) st.asa.addEventListener(type, soltar);
  st.asa.addEventListener('dblclick', () => setPref(st.host, P.ancho, 400));
}

export function attach(win, ctx) {
  const doc = win.document, { host } = ctx;
  const dock = doc.getElementById('zero-dock');
  if (!dock || !host?.prefs) return;
  const t = host.t ?? (es => es);
  const st = { host, t, cleanups: [], id: null, editor: null, editorListo: null, alAbrir: new Set(), volver: true, estirando: null };
  state.set(win, st);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };

  const titulo = t('Bloc de notas', 'Notes');
  st.boton = el(doc, 'button', { type: 'button', id: 'zero-notas-boton', class: 'zero-pill', title: `${titulo} (Ctrl+Alt+N)`, 'aria-label': titulo, 'aria-expanded': 'false', 'aria-controls': 'zero-notas' }, [el(doc, 'span', { class: 'zero-notas-icono', 'aria-hidden': 'true' })]);
  dock.append(st.boton);
  const boton = (clase, es, en) => el(doc, 'button', { type: 'button', class: `zn-boton ${clase}`, title: t(es, en), 'aria-label': t(es, en) });
  st.atras = boton('zn-atras', 'Todas las notas', 'All notes');
  st.nueva = boton('zn-nueva', 'Nota nueva', 'New note');
  st.mas = boton('zn-mas', 'Más', 'More');
  st.mas.setAttribute('aria-haspopup', 'menu'); st.mas.setAttribute('aria-expanded', 'false');
  st.cerrar = boton('zn-cerrar', 'Cerrar', 'Close');
  st.titulo = el(doc, 'input', { type: 'text', class: 'zn-titulo', maxlength: '160', placeholder: t('Sin título', 'Untitled'), 'aria-label': t('Título de la nota', 'Note title') });
  st.nombre = el(doc, 'h4', { class: 'zn-nombre' }, [titulo]);
  st.buscar = el(doc, 'input', { type: 'search', class: 'zn-buscar', placeholder: t('Buscar en tus notas', 'Search your notes'), 'aria-label': t('Buscar en tus notas', 'Search your notes') });
  st.lista = el(doc, 'div', { class: 'zn-lista', role: 'list', 'aria-label': titulo });
  st.vaciaLista = el(doc, 'p', { class: 'zn-vacia' });
  st.aviso = el(doc, 'p', { class: 'zn-aviso', hidden: 'true' });
  st.hueco = el(doc, 'div', { class: 'zn-hoja' });
  const herramienta = (orden, es, en) => el(doc, 'button', { type: 'button', class: 'zn-herramienta', 'data-orden': orden, title: t(es, en), 'aria-label': t(es, en) });
  st.barra = el(doc, 'div', { class: 'zn-barra', role: 'toolbar', 'aria-label': t('Formato', 'Format') }, [
    herramienta('rotulador', 'Rotulador (Ctrl+Mayús+H)', 'Highlighter (Ctrl+Shift+H)'), herramienta('bold', 'Negrita (Ctrl+B)', 'Bold (Ctrl+B)'),
    herramienta('h', 'Título', 'Heading'), herramienta('l', 'Lista', 'List'), herramienta('c', 'Casilla', 'Checkbox'),
    el(doc, 'span', { class: 'zn-local', title: t('Cifrado y solo en este ordenador', 'Encrypted, only on this computer') }, [t('Solo aquí', 'Only here')]),
  ]);
  st.clave = el(doc, 'input', { type: 'password', class: 'zn-clave', autocomplete: 'off', placeholder: t('Contraseña', 'Password'), 'aria-label': t('Contraseña de la nota', 'Note password') });
  st.claveMal = el(doc, 'p', { class: 'zn-mal', hidden: 'true', role: 'alert' }, [t('No es esa contraseña.', 'Wrong password.')]);
  st.clave1 = el(doc, 'input', { type: 'password', class: 'zn-clave', autocomplete: 'new-password', placeholder: t('Contraseña', 'Password'), 'aria-label': t('Contraseña', 'Password') });
  st.clave2 = el(doc, 'input', { type: 'password', class: 'zn-clave', autocomplete: 'new-password', placeholder: t('Otra vez', 'Again'), 'aria-label': t('Repite la contraseña', 'Repeat the password') });
  st.pideTitulo = el(doc, 'h5'); st.pideTexto = el(doc, 'p'); st.pideMal = el(doc, 'p', { class: 'zn-mal', hidden: 'true', role: 'alert' });
  st.pideBoton = el(doc, 'button', { type: 'submit', class: 'zn-hecho' });
  st.pideNo = el(doc, 'button', { type: 'button', class: 'zn-no' }, [t('Cancelar', 'Cancel')]);
  st.pideForma = el(doc, 'form', { class: 'zn-pide' }, [st.pideTitulo, st.pideTexto, st.clave1, st.clave2, st.pideMal, el(doc, 'div', { class: 'zn-fila' }, [st.pideNo, st.pideBoton])]);
  st.claveForma = el(doc, 'form', { class: 'zn-cerrada' }, [el(doc, 'span', { class: 'zn-candado', 'aria-hidden': 'true' }), el(doc, 'p', {}, [t('Esta nota tiene contraseña.', 'This note has a password.')]), st.clave, st.claveMal, el(doc, 'button', { type: 'submit', class: 'zn-hecho' }, [t('Abrir', 'Open')])]);
  st.menu = el(doc, 'div', { class: 'zn-menu', role: 'menu' });
  st.dice = el(doc, 'div', { class: 'zn-dice', role: 'status' });
  st.asa = el(doc, 'div', { class: 'zero-ia-grip zero-ia-grip-w', 'aria-hidden': 'true' });
  st.panel = el(doc, 'section', { id: 'zero-notas', role: 'dialog', 'aria-label': titulo, vista: 'lista' }, [
    st.asa,
    el(doc, 'header', {}, [st.atras, st.nombre, st.titulo, st.nueva, st.mas, st.cerrar]),
    el(doc, 'div', { class: 'zn-vista zn-v-lista' }, [st.buscar, st.lista, st.vaciaLista, st.aviso]),
    el(doc, 'div', { class: 'zn-vista zn-v-nota' }, [st.hueco, st.barra]),
    el(doc, 'div', { class: 'zn-vista zn-v-cerrada' }, [st.claveForma]),
    el(doc, 'div', { class: 'zn-vista zn-v-pide' }, [st.pideForma]),
    el(doc, 'div', { class: 'zn-vista zn-v-sin-llave' }, [el(doc, 'p', { class: 'zn-vacia' }, [t('Windows no deja abrir la llave de tus notas en esta cuenta. Siguen guardadas: ábrelas con la cuenta de siempre, o trae una copia desde «⋯» en otro perfil.', 'The system will not open the key to your notes in this account. They are still stored: open them from your usual account, or bring a backup.')])]),
    st.menu, st.dice,
  ]);
  doc.body.append(st.panel);
  st.cleanups.push(() => { win.clearTimeout(st.escribiendo); win.clearTimeout(st.olvido); win.clearTimeout(st.diciendo); st.boton.remove(); st.panel.remove(); });
  const dejar = reparto.registrar(win, 'notas', { panel: st.panel, forma: () => forma(win, st), ancho: px => setPref(host, P.ancho, px) });
  st.cleanups.push(dejar);

  st.boton.addEventListener('click', () => {
    // Con el panel detrás (en una ventana baja, a turnos), el botón lo trae delante.
    if (st.panel.hasAttribute('open') && st.panel.hasAttribute('oculto')) { reparto.delante(win, 'notas'); reparto.colocar(win); return; }
    st.volver = true;
    void abrir(win, st);
  });
  st.cerrar.addEventListener('click', () => void abrir(win, st, false));
  st.atras.addEventListener('click', () => void irALista(win, st));
  st.nueva.addEventListener('click', () => void nueva(win, st));
  st.mas.addEventListener('click', () => abrirMenu(win, st));
  st.buscar.addEventListener('input', () => pintarLista(win, st));
  st.lista.addEventListener('click', event => { const id = event.target.closest('.zn-nota')?.dataset.id; if (id) void irANota(win, st, id); });
  st.titulo.addEventListener('input', () => {
    if (st.panel.getAttribute('vista') === 'nota') escrito(win, st);
    else if (st.id) almacen.cambiar(st.id, { titulo: st.titulo.value }, win);
  });
  st.titulo.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); st.editor?.enfocar(); } });
  st.barra.addEventListener('mousedown', event => event.preventDefault()); // que la hoja no pierda lo seleccionado
  st.barra.addEventListener('click', event => { const orden = event.target.closest('[data-orden]')?.dataset.orden; if (orden) st.editor?.orden(orden); });
  st.claveForma.addEventListener('submit', async event => {
    event.preventDefault();
    const id = st.id;
    const bien = await almacen.abrirNota(id, st.clave.value);
    if (st.id !== id) return;
    st.clave.value = '';
    st.claveMal.hidden = bien;
    if (bien) void irANota(win, st, id);
  });
  st.pideForma.addEventListener('submit', event => { event.preventDefault(); void claveDada(win, st); });
  st.pideNo.addEventListener('click', () => { st.clave1.value = st.clave2.value = ''; st.copia = null; if (st.id) { vista(st, 'nota'); st.editor?.enfocar(); } else { vista(st, 'lista'); pintarLista(win, st); } });
  st.panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (st.panel.getAttribute('vista') === 'pide') st.pideNo.click(); else cerrarConTeclado(win, st); } });
  st.panel.addEventListener('pointerdown', () => reparto.delante(win, 'notas'));
  listen(win, 'mousedown', event => { if (st.menu.hasAttribute('open') && !st.menu.contains(event.target) && !st.mas.contains(event.target)) cerrarMenu(st); }, true);
  estirar(win, st);
  // Lo que cambia en otra ventana (o se guarda desde una web).
  st.cleanups.push(almacen.alCambiar((id, quien) => {
    if (quien === win) return;
    if (id === 'error') { decir(win, st, t('No se ha podido guardar en el disco', 'Could not save to disk')); return; }
    if (!st.panel.hasAttribute('open')) return;
    if (st.panel.getAttribute('vista') === 'lista') pintarLista(win, st);
    else if (id && id === st.id) {
      const nota = almacen.ver(id);
      if (!nota) { st.id = null; vista(st, 'lista'); pintarLista(win, st); return; }
      pintarCabecera(win, st);
      if (!nota.bloques && st.panel.getAttribute('vista') === 'nota') { void irANota(win, st, id, { foco: false }); return; }
      if (st.panel.getAttribute('vista') === 'nota' && st.editor && !st.editor.conFoco() && doc.activeElement !== st.titulo && JSON.stringify(st.editor.leer()) !== JSON.stringify(nota.bloques)) { st.titulo.value = nota.titulo; st.editor.poner(nota.bloques); }
    }
  }));
  const observer = { observe: () => reparto.colocar(win) };
  for (const key of [P.lado, P.ancho]) { host.prefs.addObserver(prefName(host.prefix, key), observer); st.cleanups.push(() => host.prefs.removeObserver(prefName(host.prefix, key), observer)); }
  // La luz o el modo cambian: la hoja, con sus colores.
  const mira = new win.MutationObserver(() => win.requestAnimationFrame(() => st.editor?.colores(win.getComputedStyle(st.panel))));
  mira.observe(doc.documentElement, { attributes: true, attributeFilter: ['zero-frame-ink', 'zero-variant', 'zero-sol', 'zero-sol-scheme', 'style'] });
  st.cleanups.push(() => mira.disconnect());
  host.keys?.add(win, 'kitsune-zero-notas-key', 'N', 'accel,alt', () => { const s = state.get(win); if (s) { s.volver = true; void abrir(win, s); } });
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  if (st.id) recoger(win, st);
  void almacen.guardarYa();
  state.delete(win);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}

/** Para las pruebas. */
export const _debug = { estado: win => state.get(win), recoger: win => recoger(win, state.get(win)) };
