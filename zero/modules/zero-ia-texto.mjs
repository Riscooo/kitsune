/* Kitsune Zero · el texto del asistente: de markdown (lo que escribe Claude) a un árbol de nodos sencillos que el
 * panel convierte en elementos, sin innerHTML. Puro: se prueba con Node.
 *
 * Lo que entiende: párrafos, títulos (#, ##, ###), listas (- * 1.), citas (>), bloques de código (```), código en
 * línea, negrita, cursiva, tachado y enlaces [texto](https://…). Un enlace que no sea http(s) se queda en texto: lo
 * que llega de Claude puede venir de una web (no fiable) y no debe poder ejecutar nada.
 *
 * Un nodo: { tag: 'p' | 'h' | 'ul' | 'ol' | 'li' | 'pre' | 'quote' | 'b' | 'i' | 's' | 'code' | 'a', text?, href?,
 * level?, children? } o una cadena (texto tal cual).
 */
const MAX_INPUT = 200_000;

export function safeHref(href) {
  try {
    const url = new URL(String(href).trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

/** El texto de una línea con sus marcas en línea. */
export function inline(text) {
  const out = [];
  const source = String(text ?? '');
  // Por orden de prioridad: código, enlaces, negrita, tachado, cursiva.
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_/g;
  let last = 0, match;
  while ((match = pattern.exec(source))) {
    if (match.index > last) out.push(source.slice(last, match.index));
    const [, code, label, href, bold, bold2, strike, em, em2] = match;
    if (code !== undefined) out.push({ tag: 'code', text: code });
    else if (label !== undefined) {
      const safe = safeHref(href);
      out.push(safe ? { tag: 'a', href: safe, children: inline(label) } : label);
    } else if (bold ?? bold2) out.push({ tag: 'b', children: inline(bold ?? bold2) });
    else if (strike !== undefined) out.push({ tag: 's', children: inline(strike) });
    else out.push({ tag: 'i', children: inline(em ?? em2) });
    last = pattern.lastIndex;
  }
  if (last < source.length) out.push(source.slice(last));
  return out;
}

/** El texto entero, en bloques. Un bloque de código sin cerrar (mientras llega la respuesta) se enseña igual. */
export function parse(markdown) {
  const lines = String(markdown ?? '').slice(0, MAX_INPUT).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [], list = null, quote = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ tag: 'p', children: paragraph.flatMap((line, i) => (i ? ['\n', ...inline(line)] : inline(line))) });
    paragraph = [];
    if (list) blocks.push(list);
    list = null;
    if (quote) blocks.push({ tag: 'quote', children: parse(quote.join('\n')) });
    quote = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```(\S*)/.exec(line);
    if (fence) {
      flush();
      const body = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      blocks.push({ tag: 'pre', lang: fence[1] || '', text: body.join('\n') });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) { flush(); blocks.push({ tag: 'h', level: heading[1].length, children: inline(heading[2]) }); continue; }
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) {
      if (!quote) { const keep = quote; flush(); quote = keep ?? []; }
      quote.push(quoted[1]);
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line), number = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
    if (bullet || number) {
      const tag = bullet ? 'ul' : 'ol';
      if (paragraph.length || quote || (list && list.tag !== tag)) flush();
      list ??= { tag, children: [] };
      list.children.push({ tag: 'li', children: inline((bullet ?? number)[1]) });
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) { list.children.at(-1).children.push(' ', ...inline(line.trim())); continue; }
    if (list || quote) flush();
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** Solo el texto (para leerlo en voz alta o copiarlo sin marcas). */
export function plain(nodes) {
  return (Array.isArray(nodes) ? nodes : [nodes]).map(node => typeof node === 'string' ? node : node.text ?? plain(node.children ?? [])).join('');
}
