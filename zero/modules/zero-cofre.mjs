/* Kitsune Zero · el cofre, la parte pura (WebCrypto, sin Gecko): cifrar y descifrar lo que no debe leer nadie más.
 *
 * Risco (23-11): «quiero que ese block sea ultra privado… que eso se quede privado y eso no lo pueda leer nadie, rollo
 * que sea algo en local», sin contraseña general; y que «haya opción de poner contraseña a algunas notas».
 *
 * - Todo lo del bloc va cifrado con AES-GCM de 256 bits. La llave la guarda el sistema (zero-cofre.sys.mjs).
 * - Una nota con contraseña se cifra además con la suya (PBKDF2-SHA-256 de 600 000 vueltas, como la copia de Kitsune).
 * - La copia que se lleva a otro ordenador va con la misma fórmula y la contraseña que se le ponga.
 */
const encoder = new TextEncoder(), decoder = new TextDecoder();
export const VUELTAS = 600_000;
export const MINIMO_CONTRASENA = 4;

export const aBase64 = bytes => {
  let texto = '';
  for (let i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(texto);
};
export const deBase64 = texto => Uint8Array.from(atob(String(texto)), c => c.charCodeAt(0));
const azar = n => crypto.getRandomValues(new Uint8Array(n));

export const llaveNueva = () => azar(32);
export const importarLlave = bytes => crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

/** Cifra un valor (JSON). `para` ata el sobre a su sitio: el de una nota no sirve en el lugar de otra. */
export async function cerrar(llave, valor, para) {
  const iv = azar(12);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`kitsune-zero:${para}`) }, llave, encoder.encode(JSON.stringify(valor))));
  return { v: 1, iv: aBase64(iv), data: aBase64(data) };
}

/** Lo que había dentro, o lanza si no es suyo, está tocado o la llave no es esa. */
export async function abrir(llave, sobre, para) {
  if (!sobre || sobre.v !== 1 || typeof sobre.iv !== 'string' || typeof sobre.data !== 'string') throw new Error('sobre');
  const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deBase64(sobre.iv), additionalData: encoder.encode(`kitsune-zero:${para}`) }, llave, deBase64(sobre.data));
  return JSON.parse(decoder.decode(plano));
}

async function llaveDe(contrasena, sal, vueltas) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(contrasena), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: vueltas }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Una cerradura con contraseña: su sal y su llave (para volver a cerrar sin pedirla otra vez). */
export async function cerraduraNueva(contrasena, vueltas = VUELTAS) {
  const sal = azar(16);
  return { sal: aBase64(sal), vueltas, llave: await llaveDe(contrasena, sal, vueltas) };
}

export async function cerrarConCerradura(cerradura, valor, para) {
  return { ...(await cerrar(cerradura.llave, valor, para)), sal: cerradura.sal, vueltas: cerradura.vueltas };
}

/** Abre con la contraseña: { valor, cerradura }. Lanza Error('contraseña') si no es esa. */
export async function abrirConContrasena(contrasena, sobre, para) {
  const vueltas = sobre?.vueltas;
  if (!Number.isInteger(vueltas) || vueltas < 1 || vueltas > 5_000_000 || typeof sobre.sal !== 'string') throw new Error('sobre');
  const llave = await llaveDe(contrasena, deBase64(sobre.sal), vueltas);
  let valor;
  try { valor = await abrir(llave, sobre, para); } catch { throw new Error('contraseña'); }
  return { valor, cerradura: { sal: sobre.sal, vueltas, llave } };
}
