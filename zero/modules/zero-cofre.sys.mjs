/* Kitsune Zero · el cofre: los archivos cifrados del bloc, en el perfil (kitsune-zero-notas/). Nada sale de aquí.
 *
 * - La llave (256 bits, al azar) la envuelve el almacén de claves del sistema con OSKeyStore de Gecko: en Windows, el
 *   Administrador de credenciales; en macOS, el Llavero; en Linux, libsecret. Se abre sola con la sesión de la persona;
 *   quien se lleve los archivos a otro ordenador, o entre con otro usuario, no puede leerlos.
 * - llave.json no se rehace nunca si ya existe: con otra llave, lo guardado no se podría abrir.
 * - Cada cosa es un archivo con su nombre (notas/<id>, subrayados, estudio), atado a él: no se pueden cambiar de sitio.
 * - Cada día que se usa queda una copia (copias/AAAA-MM-DD, las 7 últimas), igual de cifrada.
 */
import { llaveNueva, importarLlave, cerrar, abrir, aBase64, deBase64 } from './zero-cofre.mjs';

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, { OSKeyStore: 'resource://gre/modules/OSKeyStore.sys.mjs' });

const CARPETA = 'kitsune-zero-notas';
const COPIAS = 7;
const NOMBRE = /^(notas\/[a-z0-9-]{6,40}|subrayados|estudio)$/;
let llave = null;
let copiado = false;

export const carpeta = () => PathUtils.join(Services.dirsvc.get('ProfD', Ci.nsIFile).path, CARPETA);
const ruta = nombre => PathUtils.join(carpeta(), ...`${nombre}.cofre`.split('/'));

/** La llave. Lanza Error('llave') si la que hay no se puede abrir (otro Windows, otro usuario): no se toca nada. */
export function abrirCofre() {
  llave ??= (async () => {
    const archivo = PathUtils.join(carpeta(), 'llave.json');
    await IOUtils.makeDirectory(PathUtils.join(carpeta(), 'notas'), { createAncestors: true, permissions: 0o700 });
    if (await IOUtils.exists(archivo)) {
      try {
        const { data } = await IOUtils.readJSON(archivo);
        return await importarLlave(deBase64(await lazy.OSKeyStore.decrypt(data, 'kitsune_notas')));
      } catch (error) {
        console.error('Kitsune Zero: la llave del bloc no se puede abrir', error);
        throw new Error('llave');
      }
    }
    const nueva = llaveNueva();
    const data = await lazy.OSKeyStore.encrypt(aBase64(nueva));
    await IOUtils.writeJSON(archivo, { v: 1, data }, { tmpPath: `${archivo}.tmp`, flush: true });
    return importarLlave(nueva);
  })();
  // Si no se pudo, la próxima vez se vuelve a intentar.
  llave.catch(() => { llave = null; });
  return llave;
}

/** Lo guardado con ese nombre, o null si no hay nada. Si está estropeado, lanza. */
export async function leer(nombre) {
  if (!NOMBRE.test(nombre)) throw new Error('nombre');
  const k = await abrirCofre();
  let sobre;
  try { sobre = await IOUtils.readJSON(ruta(nombre)); } catch (error) {
    if (DOMException.isInstance(error) && error.name === 'NotFoundError') return null;
    throw error;
  }
  return abrir(k, sobre, nombre);
}

export async function guardar(nombre, valor) {
  if (!NOMBRE.test(nombre)) throw new Error('nombre');
  const k = await abrirCofre();
  await copiaDelDia();
  const sobre = await cerrar(k, valor, nombre);
  await IOUtils.writeJSON(ruta(nombre), sobre, { tmpPath: `${ruta(nombre)}.tmp`, flush: true });
}

export async function borrar(nombre) {
  if (!NOMBRE.test(nombre)) throw new Error('nombre');
  await IOUtils.remove(ruta(nombre), { ignoreAbsent: true });
}

/** Los ids de las notas guardadas. */
export async function notas() {
  await abrirCofre();
  const hijos = await IOUtils.getChildren(PathUtils.join(carpeta(), 'notas')).catch(() => []);
  return hijos.map(path => PathUtils.filename(path)).filter(name => name.endsWith('.cofre')).map(name => name.slice(0, -6)).filter(id => NOMBRE.test(`notas/${id}`));
}

/** Antes del primer cambio del día, una copia de todo como estaba (ya cifrado); se quedan las 7 últimas. */
async function copiaDelDia() {
  if (copiado) return;
  copiado = true;
  try {
    const hoy = new Date().toLocaleDateString('sv-SE');
    const copias = PathUtils.join(carpeta(), 'copias'), destino = PathUtils.join(copias, hoy);
    if (await IOUtils.exists(destino)) return;
    const hay = (await IOUtils.getChildren(carpeta())).filter(path => !PathUtils.filename(path).startsWith('copias'));
    await IOUtils.makeDirectory(destino, { createAncestors: true, permissions: 0o700 });
    for (const path of hay) if (!path.endsWith('.tmp')) await IOUtils.copy(path, PathUtils.join(destino, PathUtils.filename(path)), { recursive: true });
    const dias = (await IOUtils.getChildren(copias)).filter(path => /^\d{4}-\d{2}-\d{2}$/.test(PathUtils.filename(path))).sort();
    for (const viejo of dias.slice(0, -COPIAS)) await IOUtils.remove(viejo, { recursive: true });
  } catch (error) { console.error('Kitsune Zero: la copia del bloc', error); }
}

/** Para las pruebas: olvidar la llave (como al volver a abrir Kitsune). */
export const _debug = { olvidar: () => { llave = null; copiado = false; } };
