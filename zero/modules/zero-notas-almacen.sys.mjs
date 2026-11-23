/* Kitsune Zero · el bloc: las notas guardadas (una lista para todas las ventanas), sobre el cofre cifrado.
 *
 * Solo lo usan las piezas de Zero que pinta el propio navegador. Ni las webs, ni el asistente, ni el MCP (el de dentro o el
 * de Claude Code) tienen ninguna herramienta que llegue aquí: lo que lee el asistente sale hacia Claude, y las notas no
 * salen. (Risco, 23-11: «ultra privado… que eso no lo pueda leer nadie, que sea algo en local».)
 */
import * as cofre from './zero-cofre.sys.mjs';
import { abrirConContrasena, cerrarConCerradura, cerraduraNueva, MINIMO_CONTRASENA } from './zero-cofre.mjs';
import { notaLimpia, notaNueva, bloquesLimpios, buscar, vacia, conCita } from './zero-notas.mjs';
import { setTimeout, clearTimeout } from 'resource://gre/modules/Timer.sys.mjs';

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, { AsyncShutdown: 'resource://gre/modules/AsyncShutdown.sys.mjs' });

const ESPERA = 500;
const notas = new Map();        // id → nota (las cerradas, sin bloques)
const abiertas = new Map();     // id → { cerradura, bloques }: las que tienen contraseña y están abiertas ahora
const pendientes = new Map();   // id → temporizador de guardar
const escuchas = new Set();     // fn(id | null, quien)
let cargando = null;
let estropeadas = 0;

const avisar = (id, quien = null) => { for (const fn of escuchas) { try { fn(id, quien); } catch (error) { console.error('Kitsune Zero: bloc', error); } } };
export const alCambiar = fn => { escuchas.add(fn); return () => escuchas.delete(fn); };

/** Lee todas las notas (la primera vez). Lanza Error('llave') si el sistema no deja abrir el cofre. */
export function cargar() {
  cargando ??= (async () => {
    estropeadas = 0;
    for (const id of await cofre.notas()) {
      try {
        const nota = notaLimpia(await cofre.leer(`notas/${id}`));
        if (nota && nota.id === id) notas.set(id, nota); else estropeadas++;
      } catch (error) { estropeadas++; console.error('Kitsune Zero: una nota no se puede abrir', error); }
    }
    lazy.AsyncShutdown.profileBeforeChange.addBlocker('Kitsune Zero: guardar el bloc', () => guardarYa());
  })();
  cargando.catch(() => { cargando = null; });
  return cargando;
}

/** Las que no se han podido abrir (siguen en su sitio: no se borran). */
export const cuantasEstropeadas = () => estropeadas;

/** La nota como se ve: una cerrada que está abierta ahora, con sus bloques. */
export function ver(id) {
  const nota = notas.get(id);
  if (!nota) return null;
  const abierta = abiertas.get(id);
  return abierta ? { ...nota, cerrada: undefined, bloques: abierta.bloques, conContrasena: true } : nota.cerrada ? { ...nota, conContrasena: true } : nota;
}
export const lista = consulta => buscar([...notas.values()], consulta).map(n => (n.cerrada ? { ...n, conContrasena: true } : n));
export const hay = () => notas.size > 0;

async function escribir(id) {
  clearTimeout(pendientes.get(id));
  pendientes.delete(id);
  const nota = notas.get(id);
  if (!nota) return;
  const abierta = abiertas.get(id);
  if (abierta) nota.cerrada = await cerrarConCerradura(abierta.cerradura, abierta.bloques, `nota:${id}`);
  if (notas.get(id) === nota) await cofre.guardar(`notas/${id}`, nota);
}

/** Guarda lo que falte (al cerrar Kitsune, o al cerrar el panel). */
export async function guardarYa(id = null) {
  const ids = id ? (pendientes.has(id) ? [id] : []) : [...pendientes.keys()];
  await Promise.all(ids.map(uno => escribir(uno).catch(error => console.error('Kitsune Zero: no se pudo guardar una nota', error))));
}

function pronto(id) {
  clearTimeout(pendientes.get(id));
  pendientes.set(id, setTimeout(() => void escribir(id).catch(error => {
    console.error('Kitsune Zero: no se pudo guardar una nota', error);
    avisar('error');
  }), ESPERA));
}

/** Una nota nueva (no se escribe en el disco hasta que tenga algo). */
export function crear(con = {}) {
  const nota = notaLimpia({ ...notaNueva(), ...con });
  notas.set(nota.id, nota);
  if (!vacia(nota)) pronto(nota.id);
  avisar(nota.id);
  return nota.id;
}

/** Cambia el título, los bloques o si está fijada. `quien` es la ventana que lo hace (para que las demás se enteren). */
export function cambiar(id, { titulo, bloques, fijada }, quien = null) {
  const nota = notas.get(id);
  if (!nota) return;
  const abierta = abiertas.get(id);
  if (bloques !== undefined) {
    if (nota.cerrada && !abierta) return; // cerrada: no se toca
    if (abierta) abierta.bloques = bloquesLimpios(bloques); else nota.bloques = bloquesLimpios(bloques);
  }
  if (titulo !== undefined) nota.titulo = notaLimpia({ ...nota, titulo }).titulo;
  if (fijada !== undefined) nota.fijada = !!fijada; else nota.tocada = Date.now();
  if (nota.cerrada || !vacia(nota)) pronto(id);
  avisar(id, quien);
}

/** Lleva un texto al final de una nota, como cita. Devuelve false si esa nota está cerrada o ya no existe. */
export function citar(id, texto, de) {
  const nota = ver(id);
  if (!nota?.bloques) return false;
  cambiar(id, { bloques: conCita(nota, texto, de).bloques });
  return true;
}

/** Añade bloques al final (lo que se guarda del asistente). */
export function anadir(id, bloques) {
  const nota = ver(id);
  if (!nota?.bloques) return false;
  const antes = [...nota.bloques];
  while (antes.length && antes.at(-1).t === 'p' && !antes.at(-1).x.length) antes.pop();
  cambiar(id, { bloques: [...antes, ...bloques, { t: 'p', x: [] }] });
  return true;
}

/** Borra una nota; devuelve cómo deshacerlo (mientras Kitsune siga abierto). */
export async function borrar(id) {
  const nota = notas.get(id), abierta = abiertas.get(id);
  if (!nota) return () => {};
  if (pendientes.has(id)) await escribir(id).catch(() => {});
  notas.delete(id);
  abiertas.delete(id);
  await cofre.borrar(`notas/${id}`);
  avisar(id);
  return () => {
    notas.set(id, nota);
    if (abierta) abiertas.set(id, abierta);
    pronto(id);
    avisar(id);
  };
}

/** Las vacías que se dejaron a medias no se guardan. */
export function soltar(id) {
  const nota = notas.get(id);
  if (nota && vacia(nota)) { clearTimeout(pendientes.get(id)); pendientes.delete(id); notas.delete(id); void cofre.borrar(`notas/${id}`).catch(() => {}); avisar(id); }
}

// ---------------------------------------------------------------- las que llevan contraseña

/** Le pone contraseña a una nota (y la deja abierta). */
export async function ponerContrasena(id, contrasena) {
  const nota = notas.get(id);
  if (!nota || nota.cerrada || String(contrasena).length < MINIMO_CONTRASENA) return false;
  const cerradura = await cerraduraNueva(contrasena);
  abiertas.set(id, { cerradura, bloques: nota.bloques });
  nota.cerrada = await cerrarConCerradura(cerradura, nota.bloques, `nota:${id}`);
  delete nota.bloques;
  await escribir(id);
  avisar(id);
  return true;
}

/** La quita (tiene que estar abierta). */
export async function quitarContrasena(id) {
  const nota = notas.get(id), abierta = abiertas.get(id);
  if (!nota || !abierta) return false;
  nota.bloques = abierta.bloques;
  delete nota.cerrada;
  abiertas.delete(id);
  await escribir(id);
  avisar(id);
  return true;
}

/** Abre una nota con su contraseña. false si no es esa. */
export async function abrirNota(id, contrasena) {
  const nota = notas.get(id);
  if (!nota?.cerrada) return false;
  try {
    const { valor, cerradura } = await abrirConContrasena(contrasena, nota.cerrada, `nota:${id}`);
    abiertas.set(id, { cerradura, bloques: bloquesLimpios(valor) });
  } catch { return false; }
  avisar(id);
  return true;
}

/** Vuelve a cerrarla (al salir de ella, al cerrar el panel o al rato sin tocarla). */
export async function cerrarNota(id) {
  if (!abiertas.has(id)) return;
  await guardarYa(id);
  abiertas.delete(id);
  avisar(id);
}
export const abiertaAhora = id => abiertas.has(id);

// ---------------------------------------------------------------- la copia para otro ordenador

/** Todo el bloc en un archivo cifrado con una contraseña (las notas con contraseña siguen llevando la suya). */
export async function hacerCopia(contrasena) {
  await cargar();
  await guardarYa();
  const sobre = await cerrarConCerradura(await cerraduraNueva(contrasena), { notas: [...notas.values()] }, 'copia');
  return JSON.stringify({ kitsune: 'bloc', v: 1, sobre });
}

/** Trae una copia: las notas que no están se añaden; de las que están, se queda la tocada más tarde. Devuelve cuántas
 *  han entrado. Lanza Error('contraseña') o Error('copia'). */
export async function traerCopia(texto, contrasena) {
  await cargar();
  let archivo;
  try { archivo = JSON.parse(texto); } catch { throw new Error('copia'); }
  if (archivo?.kitsune !== 'bloc' || archivo.v !== 1) throw new Error('copia');
  const { valor } = await abrirConContrasena(contrasena, archivo.sobre, 'copia');
  let entran = 0;
  for (const cruda of Array.isArray(valor?.notas) ? valor.notas : []) {
    const nota = notaLimpia(cruda);
    if (!nota || (notas.get(nota.id)?.tocada ?? 0) >= nota.tocada) continue;
    abiertas.delete(nota.id);
    notas.set(nota.id, nota);
    await escribir(nota.id);
    entran++;
  }
  if (entran) avisar(null);
  return entran;
}

/** Para las pruebas. */
export const _debug = { notas, abiertas, pendientes, olvidar: () => { cargando = null; notas.clear(); abiertas.clear(); } };
