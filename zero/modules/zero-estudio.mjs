/* Kitsune Zero · el modo Estudio, la parte pura (sin Gecko): las páginas de cada sesión de estudio.
 *
 * Risco (23-11): «quiero que haya un modo estudio, donde si entras en ese modo, las páginas se guardan aunque las cierres,
 * que siempre que cierres y vuelvas a abrir, que vuelvan a estar las páginas abiertas de antes de la sesión de estudio».
 *
 * Cada perfil (espacio) tiene su estudio: { v: 1, espacios: { id: [{ id, url, titulo, estado?, abierta }] } }. Una página que
 * se cierra se queda apuntada (abierta: false) y vuelve la próxima vez; solo se va si se quita del estudio.
 */
export const MAXIMO = 60;
const ID = /^[a-z0-9-]{6,40}$/;
const ESPACIO = /^[a-z0-9-]{1,40}$/;
const MAX_ESTADO = 200_000;

export const vacio = () => ({ v: 1, espacios: {} });

/** ¿Se guarda esa dirección? Las webs y los archivos (un PDF del disco); las páginas internas, no. */
export function guardable(url) {
  try { return /^(https?|file):$/.test(new URL(String(url)).protocol); } catch { return false; }
}

function paginaLimpia(p) {
  if (!p || !ID.test(p.id) || !guardable(p.url)) return null;
  const out = { id: p.id, url: String(p.url).slice(0, 8000), titulo: String(p.titulo ?? '').replace(/\s+/g, ' ').slice(0, 200), abierta: p.abierta !== false };
  if (typeof p.estado === 'string' && p.estado && p.estado.length <= MAX_ESTADO) out.estado = p.estado;
  return out;
}

export function limpia(valor) {
  const out = vacio();
  const espacios = valor && typeof valor === 'object' && valor.espacios && typeof valor.espacios === 'object' ? valor.espacios : {};
  for (const [id, lista] of Object.entries(espacios).slice(0, 50)) {
    if (!ESPACIO.test(id) || !Array.isArray(lista)) continue;
    const vistas = new Set(), buenas = [];
    for (const p of lista.slice(0, MAXIMO).map(paginaLimpia)) if (p && !vistas.has(p.id)) { vistas.add(p.id); buenas.push(p); }
    if (buenas.length) out.espacios[id] = buenas;
  }
  return out;
}

/** Apunta las páginas vivas de un espacio, en su orden. Las que ya no están vivas se quedan, cerradas, en su sitio. */
export function anotar(datos, espacio, vivas) {
  const antes = datos.espacios[espacio] ?? [];
  const nuevas = vivas.map(p => paginaLimpia({ ...p, abierta: true })).filter(Boolean).slice(0, MAXIMO);
  const porId = new Map(nuevas.map(p => [p.id, p])), urls = new Set(nuevas.map(p => p.url));
  // Las de antes que siguen vivas ocupan sus huecos en el orden de ahora; una cerrada que se ha vuelto a abrir a mano
  // (la misma dirección) ya no se apunta dos veces.
  const orden = nuevas.filter(p => antes.some(a => a.id === p.id));
  const lista = [];
  for (const a of antes) {
    if (porId.has(a.id)) lista.push(orden.shift());
    else if (!urls.has(a.url)) lista.push({ ...a, abierta: false });
  }
  for (const p of nuevas) if (!lista.includes(p)) lista.push(p);
  // Si no caben, las primeras en irse son las cerradas más antiguas.
  while (lista.length > MAXIMO) { const i = lista.findIndex(p => !p.abierta); lista.splice(i >= 0 ? i : 0, 1); }
  const espacios = { ...datos.espacios };
  if (lista.length) espacios[espacio] = lista; else delete espacios[espacio];
  return { v: 1, espacios };
}

export function quitar(datos, espacio, id) {
  const lista = (datos.espacios[espacio] ?? []).filter(p => p.id !== id);
  const espacios = { ...datos.espacios };
  if (lista.length) espacios[espacio] = lista; else delete espacios[espacio];
  return { v: 1, espacios };
}

/** Las que hay que abrir al entrar: todas las apuntadas que no estén ya vivas en alguna ventana. */
export const porAbrir = (datos, espacio, vivas) => (datos.espacios[espacio] ?? []).filter(p => !vivas.has(p.id));

/** Qué enseñar y qué esconder, y a qué pestaña ir, entre las de un espacio: [{ estudio, fijada, oculta, elegida, vista }]. */
export function plan(pestanas, estudiando) {
  const toca = p => p.fijada || p.estudio === estudiando;
  const mostrar = [], esconder = [];
  pestanas.forEach((p, i) => { if (p.fijada) return; if (toca(p)) { if (p.oculta) mostrar.push(i); } else if (!p.oculta) esconder.push(i); });
  let elegir = pestanas.findIndex(p => p.elegida && toca(p));
  if (elegir < 0) pestanas.forEach((p, i) => { if (!p.fijada && toca(p) && (elegir < 0 || (p.vista || 0) > (pestanas[elegir].vista || 0))) elegir = i; });
  return { mostrar, esconder, elegir };
}
