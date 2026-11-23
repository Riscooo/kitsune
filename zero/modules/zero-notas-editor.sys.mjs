/* Kitsune Zero · el bloc: la hoja donde se escribe.
 *
 * Es un documento HTML propio, dentro de un marco del panel y sin scripts (zero-notas-editor.html): el navegador lo lleva
 * desde aquí. Se escribe en bloques planos (un <div data-t> por bloque: texto, título, lista, casilla o cita) y lo que se
 * guarda son esos bloques, nunca HTML: lo que se pega o se suelta entra como texto.
 *
 * Como en los editores buenos (Notion, Bear, Apple Notas), sin botones por medio: «# », «- », «[] » y «> » al empezar una
 * línea hacen un título, una lista, una casilla o una cita; Ctrl+B, I y U, y el rotulador con Ctrl+Mayús+H.
 */
import { atajo, bloquesLimpios, deTexto } from './zero-notas.mjs';

const PAGINA = 'chrome://browser/content/zero/zero-notas-editor.html';
const ROTULADOR = '#ffe066';

function pintarBloque(doc, b) {
  const nodo = doc.createElement('div');
  nodo.dataset.t = b.t;
  if (b.hecho) nodo.dataset.hecho = '';
  if (b.de) { if (b.de.url) nodo.dataset.url = b.de.url; nodo.dataset.titulo = b.de.titulo || b.de.url; }
  for (const trozo of b.x) {
    const [texto, marcas] = Array.isArray(trozo) ? trozo : [trozo, ''];
    let dentro = doc.createTextNode(texto);
    for (const [marca, etiqueta] of [['b', 'b'], ['i', 'i'], ['u', 'u'], ['s', 's'], ['m', 'span']]) {
      if (!marcas.includes(marca)) continue;
      const fuera = doc.createElement(etiqueta);
      if (marca === 'm') fuera.style.backgroundColor = ROTULADOR;
      fuera.append(dentro);
      dentro = fuera;
    }
    nodo.append(dentro);
  }
  if (!nodo.firstChild) nodo.append(doc.createElement('br'));
  return nodo;
}

const sinFondo = color => color === 'transparent' || /, 0\)$/.test(color);
const MARCA_DE = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', MARK: 'm' };
function trozosDe(nodo, marcas = '', out = []) {
  for (const hijo of nodo.childNodes) {
    if (hijo.nodeType === 3) { if (hijo.data) out.push(marcas ? [hijo.data, marcas] : hijo.data); continue; }
    if (hijo.nodeType !== 1 || hijo.localName === 'br') continue;
    let suyas = marcas;
    const marca = MARCA_DE[hijo.nodeName.toUpperCase()];
    if (marca && !suyas.includes(marca)) suyas += marca;
    const fondo = hijo.style?.backgroundColor;
    if (fondo) { if (sinFondo(fondo)) suyas = suyas.replace('m', ''); else if (!suyas.includes('m')) suyas += 'm'; }
    trozosDe(hijo, suyas, out);
  }
  return out;
}

/** Lo que hay en la hoja, en bloques. */
function leerBloques(hoja) {
  const out = [];
  for (const nodo of hoja.childNodes) {
    if (nodo.nodeType === 3) { if (nodo.data.trim()) out.push({ t: 'p', x: [nodo.data] }); continue; }
    if (nodo.nodeType !== 1 || nodo.localName === 'br') continue;
    const b = { t: nodo.dataset?.t ?? 'p', x: trozosDe(nodo) };
    if (nodo.hasAttribute('data-hecho')) b.hecho = true;
    if (b.t === 'q' && nodo.dataset.titulo) b.de = { url: nodo.dataset.url ?? '', titulo: nodo.dataset.titulo };
    out.push(b);
  }
  return bloquesLimpios(out);
}

/** Una hoja dentro de `caja`: { poner(bloques), leer(), enfocar(), alFinal(), orden(nombre), colores(), quitar() }. */
export async function crearEditor(win, caja, { guia, alEscribir, alOrigen, alEscape, marco = null }) {
  const doc = win.document;
  const frame = marco ?? doc.createElementNS('http://www.w3.org/1999/xhtml', 'iframe');
  frame.className = 'zero-notas-hoja';
  frame.setAttribute('src', PAGINA);
  caja.append(frame);
  // En la ventana del navegador, el «load» de un marco suyo no siempre llega: se mira el documento.
  for (let i = 0; i < 400 && !(frame.contentDocument?.documentURI === PAGINA && frame.contentDocument.readyState === 'complete'); i++) await new Promise(listo => win.setTimeout(listo, 15));
  if (!frame.contentDocument?.getElementById('hoja')) { frame.remove(); throw new Error('la hoja del bloc no se ha cargado'); }
  const d = frame.contentDocument, w = frame.contentWindow, hoja = d.getElementById('hoja');
  hoja.dataset.guia = guia;
  try { d.execCommand('defaultParagraphSeparator', false, 'div'); d.execCommand('styleWithCSS', false, 'false'); } catch { /* sin eso, igual */ }

  const bloqueDe = nodo => { let n = nodo; while (n && n.parentNode !== hoja) n = n.parentNode; return n?.nodeType === 1 ? n : null; };
  const actual = () => bloqueDe(w.getSelection().anchorNode);
  const alPrincipio = bloque => {
    const s = w.getSelection();
    if (!s.isCollapsed || !bloque) return false;
    const r = d.createRange();
    r.setStart(bloque, 0);
    r.setEnd(s.anchorNode, s.anchorOffset);
    return r.toString() === '';
  };
  const pintarVacia = () => hoja.toggleAttribute('vacia', hoja.childElementCount <= 1 && !hoja.textContent && (hoja.firstElementChild?.dataset?.t ?? 'p') === 'p');
  const cambio = () => { pintarVacia(); alEscribir?.(); };
  /** Que todo lo de la hoja sean bloques (Gecko, al borrarlo todo, deja la hoja sin ninguno). */
  const arreglar = () => {
    for (const nodo of [...hoja.childNodes]) {
      if (nodo.nodeType === 1 && nodo.localName === 'div') { if (!nodo.dataset.t) nodo.dataset.t = 'p'; continue; }
      const s = w.getSelection(), suyo = nodo.contains(s.anchorNode) || (s.anchorNode === hoja && hoja.childNodes.length === 1), offset = s.anchorOffset, ancla = s.anchorNode;
      const bloque = d.createElement('div');
      bloque.dataset.t = 'p';
      nodo.replaceWith(bloque);
      bloque.append(nodo);
      if (suyo) { if (ancla === hoja) s.collapse(bloque, 0); else s.collapse(ancla, offset); }
    }
    if (!hoja.firstElementChild) { const b = pintarBloque(d, { t: 'p', x: [] }); hoja.append(b); w.getSelection().collapse(b, 0); }
  };
  const tipo = (bloque, t) => {
    if (!bloque) return;
    bloque.dataset.t = t;
    if (t !== 'c') bloque.removeAttribute('data-hecho');
    if (t !== 'q') { bloque.removeAttribute('data-url'); bloque.removeAttribute('data-titulo'); }
    cambio();
  };
  /** ¿Está todo lo seleccionado ya con el rotulador? */
  const todoMarcado = r => {
    const paseo = d.createTreeWalker(hoja, 4 /* SHOW_TEXT */);
    let algo = false;
    for (let n = paseo.nextNode(); n; n = paseo.nextNode()) {
      if (!n.data || !r.intersectsNode(n)) continue;
      if ((n === r.startContainer && r.startOffset >= n.length) || (n === r.endContainer && r.endOffset === 0)) continue;
      algo = true;
      let e = n.parentNode;
      while (e !== hoja && !e.style?.backgroundColor) e = e.parentNode;
      if (e === hoja || sinFondo(e.style.backgroundColor)) return false;
    }
    return algo;
  };
  const orden = nombre => {
    hoja.focus();
    if (nombre === 'rotulador') {
      const s = w.getSelection();
      if (s.isCollapsed) return;
      const marcado = todoMarcado(s.getRangeAt(0));
      d.execCommand('styleWithCSS', false, 'true');
      d.execCommand('hiliteColor', false, marcado ? 'transparent' : ROTULADOR);
      d.execCommand('styleWithCSS', false, 'false');
      cambio();
      return;
    }
    if (['bold', 'italic', 'underline'].includes(nombre)) { d.execCommand(nombre, false, null); cambio(); return; }
    // Un título, una lista o una casilla: los bloques que toca lo seleccionado (otra vez, texto).
    const s = w.getSelection(), r = s.rangeCount ? s.getRangeAt(0) : null;
    const tocados = [...hoja.children].filter(b => r?.intersectsNode(b) && !(b !== bloqueDe(r.startContainer) && r.endContainer === b && r.endOffset === 0));
    const todos = tocados.length && tocados.every(b => b.dataset.t === nombre);
    for (const b of tocados) tipo(b, todos ? 'p' : nombre);
  };

  hoja.addEventListener('beforeinput', event => {
    // Nada de HTML ni de formatos que no son los del bloc.
    if (/^(insertFromPaste|insertFromDrop|insertFromYank|format(?!Bold|Italic|Underline|BackColor))/.test(event.inputType)) { event.preventDefault(); return; }
    if (event.inputType === 'insertParagraph') {
      const b = actual();
      if (b && ['l', 'c', 'q', 'h'].includes(b.dataset.t) && !b.textContent) { event.preventDefault(); tipo(b, 'p'); return; }
    }
    if (event.inputType === 'insertText' && event.data === ' ') {
      const b = actual(), s = w.getSelection();
      if (b?.dataset.t === 'p' && s.isCollapsed) {
        const r = d.createRange();
        r.setStart(b, 0); r.setEnd(s.anchorNode, s.anchorOffset);
        const t = atajo(r.toString());
        if (t) {
          event.preventDefault();
          s.removeAllRanges(); s.addRange(r);
          d.execCommand('delete', false, null);
          tipo(actual() ?? b, t);
        }
      }
    }
  });
  hoja.addEventListener('input', event => {
    arreglar();
    if (event.inputType === 'insertParagraph') {
      const b = actual();
      if (b) {
        // Tras un título o una cita se sigue con texto; una casilla nueva nace sin marcar.
        b.removeAttribute('data-hecho');
        if (['h', 'q'].includes(b.dataset.t)) {
          // El origen se queda en la última línea de la cita.
          if (b.previousElementSibling?.dataset.t === 'q' && b.dataset.titulo && b.textContent) { const antes = b.previousElementSibling; antes.removeAttribute('data-url'); antes.removeAttribute('data-titulo'); }
          if (!b.textContent) { b.dataset.t = 'p'; b.removeAttribute('data-url'); b.removeAttribute('data-titulo'); }
        }
      }
    }
    cambio();
  });
  hoja.addEventListener('keydown', event => {
    const ctrl = event.ctrlKey || event.metaKey, tecla = event.key.toLowerCase();
    if (event.key === 'Escape') { event.preventDefault(); alEscape?.(); return; }
    if (event.key === 'Backspace' && !ctrl) {
      const b = actual();
      if (b && b.dataset.t !== 'p' && alPrincipio(b)) { event.preventDefault(); tipo(b, 'p'); return; }
    }
    if (event.key === 'Tab') { event.preventDefault(); if (!event.shiftKey) d.execCommand('insertText', false, '\t'); return; }
    if (!ctrl || event.altKey) return;
    const nombre = { b: 'bold', i: 'italic', u: 'underline' }[tecla];
    if (nombre && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); orden(nombre); }
    else if (event.shiftKey && tecla === 'h') { event.preventDefault(); event.stopPropagation(); orden('rotulador'); }
    else if (event.key === 'Enter') { const b = actual(); if (b?.dataset.t === 'c') { event.preventDefault(); b.toggleAttribute('data-hecho'); cambio(); } }
  });
  const meter = texto => {
    const bloques = deTexto(texto);
    hoja.focus();
    bloques.forEach((b, i) => {
      if (i) d.execCommand('insertParagraph', false, null);
      const plano = b.x.join('');
      if (plano) d.execCommand('insertText', false, plano);
      const nodo = actual();
      if (nodo && (i || b.t !== 'p')) { nodo.dataset.t = b.t; nodo.toggleAttribute('data-hecho', !!b.hecho); nodo.removeAttribute('data-url'); nodo.removeAttribute('data-titulo'); }
    });
    cambio();
  };
  hoja.addEventListener('paste', event => { event.preventDefault(); meter(event.clipboardData.getData('text/plain')); });
  hoja.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('text/plain')) event.preventDefault(); });
  hoja.addEventListener('drop', event => {
    event.preventDefault();
    const texto = event.dataTransfer.getData('text/plain');
    if (!texto) return;
    const en = d.caretPositionFromPoint(event.clientX, event.clientY);
    if (en && hoja.contains(en.offsetNode)) w.getSelection().collapse(en.offsetNode, en.offset);
    meter(texto);
  });
  hoja.addEventListener('mousedown', event => {
    const b = bloqueDe(event.target);
    if (b?.dataset.t === 'c' && event.target === b && event.clientX - b.getBoundingClientRect().left < 22) { event.preventDefault(); b.toggleAttribute('data-hecho'); cambio(); }
  });
  hoja.addEventListener('click', event => {
    const b = bloqueDe(event.target);
    if (b?.dataset.t !== 'q' || !b.dataset.url || event.target !== b) return;
    const r = d.createRange();
    r.selectNodeContents(b);
    const abajo = [...r.getClientRects()].at(-1)?.bottom ?? 0;
    if (event.clientY > abajo) { event.preventDefault(); alOrigen?.(b.dataset.url, b.textContent); }
  });

  return {
    frame, hoja,
    poner(bloques) {
      hoja.replaceChildren(...bloques.map(b => pintarBloque(d, b)));
      // La hoja nueva no se deshace hacia la de antes.
      hoja.contentEditable = 'false'; hoja.contentEditable = 'true';
      try { d.execCommand('defaultParagraphSeparator', false, 'div'); d.execCommand('styleWithCSS', false, 'false'); } catch { /* igual */ }
      pintarVacia();
      w.scrollTo(0, 0);
    },
    leer: () => leerBloques(hoja),
    enfocar() { hoja.focus(); },
    alFinal() {
      hoja.focus();
      const ultimo = hoja.lastElementChild;
      if (ultimo) { const r = d.createRange(); r.selectNodeContents(ultimo); r.collapse(false); const s = w.getSelection(); s.removeAllRanges(); s.addRange(r); ultimo.scrollIntoView({ block: 'nearest' }); }
    },
    conFoco: () => doc.activeElement === frame,
    orden, meter,
    colores(estilo) {
      const raiz = d.documentElement.style, c = nombre => estilo.getPropertyValue(nombre).trim();
      raiz.setProperty('--tinta', c('--zero-piece-text') || '#fff');
      raiz.setProperty('--apagado', c('--zero-piece-quiet') || '#aaa');
      raiz.setProperty('--suave', c('--zero-piece-hover') || '#333');
      raiz.setProperty('--acento', c('--zero-ia-accent') || '#3a8f74');
      raiz.setProperty('--rotulador', c('--zero-rotulador') || '#e9c84a');
      raiz.setProperty('--sobre-rotulador', c('--zero-sobre-rotulador') || '#1d2321');
      raiz.colorScheme = estilo.colorScheme || 'light dark';
    },
    quitar() { frame.remove(); },
  };
}
