/* Kitsune Zero · el bloc de notas, la parte pura (sin Gecko): qué es una nota, comprobarla, buscar, resumir y pasarla a texto.
 *
 * Una nota: { id, titulo, creada, tocada, fijada, bloques } o, con contraseña, { …, cerrada: sobre } sin bloques.
 * Un bloque: { t, x, hecho?, de? }
 *   t: 'p' texto · 'h' título · 'l' lista · 'c' casilla (hecho) · 'q' cita (de: { url, titulo })
 *   x: trozos: 'texto' o ['texto', marcas], con marcas de «biusm» (negrita, cursiva, subrayado, tachado, rotulador)
 * Nunca se guarda HTML: lo que se pinta se construye desde aquí, y lo que no tiene esta forma se descarta.
 */
export const TIPOS = Object.freeze(['p', 'h', 'l', 'c', 'q']);
export const MARCAS = 'biusm';
const MAX_TITULO = 160, MAX_BLOQUES = 20_000, MAX_TEXTO = 2_000_000;
const ID = /^[a-z0-9-]{6,40}$/;

export const idNuevo = (ahora = Date.now(), azar = crypto.getRandomValues(new Uint8Array(6))) =>
  `${ahora.toString(36)}-${[...azar].map(b => b.toString(16).padStart(2, '0')).join('')}`;

export const notaNueva = (ahora = Date.now()) => ({ id: idNuevo(ahora), titulo: '', creada: ahora, tocada: ahora, fijada: false, bloques: [{ t: 'p', x: [] }] });

const limpio = texto => String(texto ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
export const tituloLimpio = texto => limpio(texto).replace(/\s+/g, ' ').slice(0, MAX_TITULO);

/** Solo http y https: lo demás no se abre ni se guarda como origen. */
export function urlLimpia(url) {
  try { const u = new URL(String(url)); return /^https?:$/.test(u.protocol) ? u.href.slice(0, 4000) : ''; } catch { return ''; }
}

/** Trozos juntos, sin vacíos y con las marcas en orden. */
export function trozosLimpios(x) {
  const out = [];
  for (const trozo of Array.isArray(x) ? x : []) {
    const texto = limpio(Array.isArray(trozo) ? trozo[0] : trozo).replace(/\n/g, ' ');
    if (!texto) continue;
    const marcas = Array.isArray(trozo) ? [...MARCAS].filter(m => String(trozo[1] ?? '').includes(m)).join('') : '';
    const ultimo = out.at(-1), suyas = Array.isArray(ultimo) ? ultimo[1] : '';
    if (ultimo !== undefined && suyas === marcas) out[out.length - 1] = marcas ? [ultimo[0] + texto, marcas] : ultimo + texto;
    else out.push(marcas ? [texto, marcas] : texto);
  }
  return out;
}

export function bloqueLimpio(b) {
  if (!b || typeof b !== 'object') return null;
  const t = TIPOS.includes(b.t) ? b.t : 'p';
  const out = { t, x: trozosLimpios(b.x) };
  if (t === 'c' && b.hecho) out.hecho = true;
  if (t === 'q' && b.de) {
    const url = urlLimpia(b.de.url), titulo = tituloLimpio(b.de.titulo);
    if (url || titulo) out.de = { url, titulo };
  }
  return out;
}

export function bloquesLimpios(lista) {
  const out = [];
  let total = 0;
  for (const b of Array.isArray(lista) ? lista.slice(0, MAX_BLOQUES) : []) {
    const bloque = bloqueLimpio(b);
    if (!bloque) continue;
    total += textoDeBloque(bloque).length;
    if (total > MAX_TEXTO) break;
    out.push(bloque);
  }
  return out.length ? out : [{ t: 'p', x: [] }];
}

/** Una nota leída del disco, comprobada; null si no lo es. */
export function notaLimpia(n) {
  if (!n || typeof n !== 'object' || !ID.test(n.id)) return null;
  const hora = v => (Number.isFinite(v) && v > 0 ? v : Date.now());
  const base = { id: n.id, titulo: tituloLimpio(n.titulo), creada: hora(n.creada), tocada: hora(n.tocada), fijada: !!n.fijada };
  if (n.cerrada && typeof n.cerrada === 'object') return { ...base, cerrada: n.cerrada };
  return { ...base, bloques: bloquesLimpios(n.bloques) };
}

export const textoDeBloque = b => (b?.x ?? []).map(t => (Array.isArray(t) ? t[0] : t)).join('');
export const textoDe = nota => (nota?.bloques ?? []).map(textoDeBloque).join('\n');
export const vacia = nota => !nota.cerrada && !nota.titulo.trim() && !textoDe(nota).trim();

/** Lo que enseña la lista: su título (o su primera línea) y por dónde va el texto. */
export function resumen(nota, t = es => es) {
  if (nota.cerrada) return { titulo: nota.titulo || t('Nota con contraseña', 'Locked note'), texto: '' };
  const lineas = nota.bloques.map(textoDeBloque).map(l => l.trim()).filter(Boolean);
  const titulo = nota.titulo.trim() || lineas.shift() || t('Nota nueva', 'New note');
  return { titulo: titulo.slice(0, 120), texto: lineas.join(' · ').slice(0, 160) };
}

const plano = texto => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();

/** Las notas que casan (sin tildes ni mayúsculas; todas las palabras), fijadas primero y luego la última tocada. El
 *  contenido de las cerradas no se busca: solo su título. */
export function buscar(notas, consulta = '') {
  const palabras = plano(consulta).split(/\s+/).filter(Boolean);
  return notas
    .filter(n => { if (!palabras.length) return true; const donde = plano(`${n.titulo}\n${n.cerrada ? '' : textoDe(n)}`); return palabras.every(p => donde.includes(p)); })
    .sort((a, b) => Number(b.fijada) - Number(a.fijada) || b.tocada - a.tocada || a.id.localeCompare(b.id));
}

/** Una nota con una cita añadida: si acaba en un párrafo vacío, la cita va delante de él. */
export function conCita(nota, texto, de = null, ahora = Date.now()) {
  const lineas = limpio(texto).split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (!lineas.length) return nota;
  const origen = de && (urlLimpia(de.url) || tituloLimpio(de.titulo)) ? { url: urlLimpia(de.url), titulo: tituloLimpio(de.titulo) } : null;
  // El origen, una vez: en la última línea de la cita.
  const citas = lineas.map((l, i) => ({ t: 'q', x: [l], ...(origen && i === lineas.length - 1 ? { de: origen } : {}) }));
  const bloques = [...nota.bloques];
  while (bloques.length && bloques.at(-1).t === 'p' && !textoDeBloque(bloques.at(-1)).trim()) bloques.pop();
  return { ...nota, bloques: [...bloques, ...citas, { t: 'p', x: [] }], tocada: ahora };
}

/** Un texto con líneas (lo que se pega, o lo que dice el asistente) en bloques. */
export function deTexto(texto) {
  return bloquesLimpios(limpio(texto).split('\n').map(linea => {
    const m = /^\s*(?:(#{1,6})|([-*•])|(\[[ xX]?\])|(>))\s+(.*)$/.exec(linea);
    if (!m) return { t: 'p', x: [linea] };
    if (m[1]) return { t: 'h', x: [m[5]] };
    if (m[3]) return { t: 'c', x: [m[5]], hecho: /x/i.test(m[3]) };
    return { t: m[2] ? 'l' : 'q', x: [m[5]] };
  }));
}

/** El atajo escrito al principio de un bloque («# », «- », «[] », «> »): en qué se convierte, o null. */
export const atajo = texto => ({ '#': 'h', '-': 'l', '*': 'l', '[]': 'c', '[ ]': 'c', '>': 'q' })[String(texto ?? '').trim()] ?? null;

const md = x => x.map(t => {
  if (!Array.isArray(t)) return t;
  let s = t[0];
  if (t[1].includes('m')) s = `==${s}==`;
  if (t[1].includes('b')) s = `**${s}**`;
  if (t[1].includes('i')) s = `*${s}*`;
  if (t[1].includes('s')) s = `~~${s}~~`;
  return s;
}).join('');

/** La nota en Markdown (para sacarla del bloc, si la persona quiere). */
export function aMarkdown(nota) {
  const cuerpo = (nota.bloques ?? []).map(b => {
    const s = md(b.x);
    if (b.t === 'h') return `## ${s}`;
    if (b.t === 'l') return `- ${s}`;
    if (b.t === 'c') return `- [${b.hecho ? 'x' : ' '}] ${s}`;
    if (b.t === 'q') return `> ${s}${b.de ? `\n>\n> — ${b.de.url ? `[${b.de.titulo || b.de.url}](${b.de.url})` : b.de.titulo}` : ''}`;
    return s;
  }).join('\n\n').replace(/\n\n(?=- )/g, '\n');
  return `${nota.titulo ? `# ${nota.titulo}\n\n` : ''}${cuerpo}`.trim() + '\n';
}

// ---------------------------------------------------------------- los subrayados de las webs

/** La dirección a la que se atan (sin lo de detrás de «#», que no cambia de página… salvo que sea una ruta: «#/…»). */
export function pagina(url) {
  try {
    const u = new URL(String(url));
    if (!/^(https?|file):$/.test(u.protocol)) return '';
    if (!/^#!?\//.test(u.hash)) u.hash = '';
    for (const clave of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/.test(clave)) u.searchParams.delete(clave);
    return u.href;
  } catch { return ''; }
}

export const COLORES = Object.freeze(['amarillo', 'verde', 'rosa']);
const VENTANA = 40;

/** Cómo se recuerda un trozo de una página: el texto y lo de alrededor (TextQuoteSelector del W3C). */
export function ancla(texto, inicio, fin) {
  return { exacto: texto.slice(inicio, fin), antes: texto.slice(Math.max(0, inicio - VENTANA), inicio), despues: texto.slice(fin, fin + VENTANA), donde: inicio };
}

const igualesAlFinal = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; };
const igualesAlPrincipio = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };

/** Dónde está ahora ese trozo en el texto de la página: [inicio, fin], o null si ya no está. Entre varios iguales, el que
 *  mejor casa con lo de alrededor y, a igualdad, el más cercano a donde estaba. */
export function encontrar(texto, a) {
  if (!a?.exacto) return null;
  let mejor = null;
  for (let i = texto.indexOf(a.exacto), veces = 0; i >= 0 && veces < 2000; i = texto.indexOf(a.exacto, i + 1), veces++) {
    const fin = i + a.exacto.length;
    const puntos = igualesAlFinal(texto.slice(Math.max(0, i - VENTANA), i), a.antes ?? '') + igualesAlPrincipio(texto.slice(fin, fin + VENTANA), a.despues ?? '');
    const lejos = Math.abs(i - (a.donde ?? 0));
    if (!mejor || puntos > mejor.puntos || (puntos === mejor.puntos && lejos < mejor.lejos)) mejor = { puntos, lejos, en: [i, fin] };
  }
  return mejor?.en ?? null;
}

/** Los subrayados leídos del disco, comprobados: { página: [{ id, color, exacto, antes, despues, donde, cuando }] }. */
export function subrayadosLimpios(valor) {
  const out = {};
  const paginas = valor && typeof valor === 'object' && !Array.isArray(valor) ? Object.entries(valor).slice(0, 5000) : [];
  for (const [url, lista] of paginas) {
    if (!pagina(url) || !Array.isArray(lista)) continue;
    const buenos = lista.slice(0, 500).map(s => {
      if (!s || !ID.test(s.id) || typeof s.exacto !== 'string' || !s.exacto || s.exacto.length > 20_000) return null;
      const trozo = v => String(v ?? '').slice(0, VENTANA);
      return { id: s.id, color: COLORES.includes(s.color) ? s.color : COLORES[0], exacto: s.exacto, antes: trozo(s.antes), despues: trozo(s.despues), donde: Number.isFinite(s.donde) ? s.donde : 0, cuando: Number.isFinite(s.cuando) ? s.cuando : 0 };
    }).filter(Boolean);
    if (buenos.length) out[url] = buenos;
  }
  return out;
}
