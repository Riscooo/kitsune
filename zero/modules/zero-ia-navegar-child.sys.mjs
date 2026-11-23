/* Kitsune Zero · manejar una web desde Claude Code: la parte que vive en la web (proceso de la web).
 *
 * Solo hace algo cuando Kitsune se lo pide (zero-ia-navegar.sys.mjs), y eso solo pasa con el servidor MCP de fuera
 * (el de Claude Code en una terminal, con el ajuste «Usar Kitsune Zero desde Claude Code»): el asistente del panel no
 * tiene estas herramientas. No escucha nada de la página ni le deja nada en el DOM (las referencias a los elementos se
 * guardan aquí, en un mapa), y la página no puede llamarlo.
 *
 * Como una persona: el clic es del ratón (se mueve, pulsa y suelta en el centro del elemento, después de comprobar que
 * no lo tapa nada), lo escrito va tecla a tecla (nsITextInputProcessor, el teclado de Gecko) y el JavaScript corre con
 * los permisos de la página (un sandbox con su principal, como la consola), nunca con los de Kitsune.
 *
 * Lo que dispara eventos en la página (clic, teclas, elegir) se hace justo después de contestar: si la web abre un
 * alert() en ese momento, Kitsune ya tiene la respuesta y puede decírselo a Claude (pagina_dialogo).
 */
const MAXIMO_ELEMENTOS = 2000;
const MAXIMO_RECORRIDO = 40_000;   // elementos que se miran como mucho
const MAXIMO_REFS = 5000;
const MAXIMO_RESULTADO = 100_000;  // caracteres del resultado de pagina_ejecutar

const ROLES = {
  button: 'botón', link: 'enlace', checkbox: 'casilla', switch: 'interruptor', radio: 'radio', tab: 'pestaña',
  menuitem: 'opción de menú', menuitemcheckbox: 'opción de menú', menuitemradio: 'opción de menú', option: 'opción',
  combobox: 'combo', textbox: 'campo', searchbox: 'campo search', slider: 'deslizador', spinbutton: 'campo numérico',
  treeitem: 'elemento de árbol',
};
const TIPOS_INPUT = {
  checkbox: 'casilla', radio: 'radio', button: 'botón', submit: 'botón', reset: 'botón', image: 'botón', file: 'archivo',
  range: 'deslizador', color: 'color', text: 'campo',
};
// Los <input> donde se escribe con el teclado.
const DE_TEXTO = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);
const SIN_RECORRER = new Set(['script', 'style', 'template', 'noscript', 'head', 'meta', 'link', 'title']);
const MARCOS = new Set(['iframe', 'frame', 'object', 'embed']);

const limpio = texto => String(texto ?? '').replace(/\s+/g, ' ').trim();
const normal = texto => limpio(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** El padre de un nodo aunque esté en un shadow root (su anfitrión). */
const padreDe = nodo => nodo?.parentNode?.nodeType === 11 ? nodo.parentNode.host ?? null : nodo?.parentNode ?? null;

/** ¿Está `dentro` dentro de `fuera` (o es él), atravesando shadow roots? */
function contiene(fuera, dentro) {
  for (let nodo = dentro; nodo; nodo = padreDe(nodo)) if (nodo === fuera) return true;
  return false;
}

const esCampoDeTexto = el => (el.localName === 'input' && DE_TEXTO.has(el.type)) || el.localName === 'textarea';

function visible(el) {
  try {
    if (!el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false;
  } catch { /* sin checkVisibility */ }
  const caja = el.getBoundingClientRect();
  return caja.width > 0 && caja.height > 0;
}

function rol(el) {
  return String(el.getAttribute?.('role') ?? '').trim().split(/\s+/)[0].toLowerCase();
}

/** Qué es un elemento con el que se puede interactuar (en castellano), o null si no lo es. */
function tipoDe(el) {
  const papel = rol(el);
  if (ROLES[papel]) return ROLES[papel];
  switch (el.localName) {
    case 'a': case 'area': return el.hasAttribute('href') ? 'enlace' : null;
    case 'button': case 'summary': return 'botón';
    case 'select': return el.multiple ? 'lista' : 'desplegable';
    case 'textarea': return 'área de texto';
    case 'input': {
      if (el.type === 'hidden') return null;
      return TIPOS_INPUT[el.type] ?? `campo ${el.type}`;
    }
  }
  if (el.isContentEditable && !el.parentElement?.isContentEditable) return 'editable';
  if (el.hasAttribute('onclick')) return 'clicable';
  const indice = el.getAttribute('tabindex');
  if (indice !== null && /^\d+$/.test(indice.trim())) return 'enfocable';
  return null;
}

function textoPorIds(el, ids) {
  const raiz = el.getRootNode?.() ?? el.ownerDocument;
  return limpio(ids.split(/\s+/).map(id => {
    const otro = raiz.getElementById?.(id) ?? el.ownerDocument.getElementById(id);
    return otro ? (otro.innerText ?? otro.textContent ?? '') : '';
  }).join(' '));
}

/** Su nombre, como lo diría un lector de pantalla (más o menos): aria-labelledby, aria-label, su <label>, el texto
 *  que se ve, el alt de su imagen, title, placeholder… */
function nombreDe(el) {
  const porIds = el.getAttribute('aria-labelledby');
  if (porIds) { const texto = textoPorIds(el, porIds); if (texto) return texto; }
  const aria = limpio(el.getAttribute('aria-label'));
  if (aria) return aria;
  const tag = el.localName;
  if (tag === 'input' && ['button', 'submit', 'reset'].includes(el.type)) {
    return limpio(el.value) || { submit: 'Enviar', reset: 'Restablecer' }[el.type] || '';
  }
  if (tag === 'input' && el.type === 'image') return limpio(el.alt) || limpio(el.value);
  if (['input', 'select', 'textarea'].includes(tag) || el.labels?.length) {
    const etiquetas = [];
    for (let i = 0; i < (el.labels?.length ?? 0); i++) etiquetas.push(el.labels[i].innerText ?? el.labels[i].textContent ?? '');
    const texto = limpio(etiquetas.join(' '));
    if (texto) return texto;
  }
  if (!['input', 'select', 'textarea'].includes(tag)) {
    const texto = limpio(el.innerText ?? el.textContent ?? '');
    if (texto) return texto.slice(0, 300);
    const imagen = el.querySelector?.('img[alt]:not([alt=""])');
    if (imagen) return limpio(imagen.getAttribute('alt'));
    const titulo = el.querySelector?.('svg title');
    if (titulo) return limpio(titulo.textContent);
  }
  return limpio(el.getAttribute('title')) || limpio(el.getAttribute('placeholder')) || limpio(el.getAttribute('name'))
    || limpio(el.getAttribute('alt'));
}

/** Lo que tiene escrito o elegido (las contraseñas no). */
function valorDe(el) {
  const tag = el.localName;
  if (tag === 'input') {
    if (el.type === 'password') return null;
    if (DE_TEXTO.has(el.type) || ['range', 'color'].includes(el.type)) return String(el.value ?? '');
    return null;
  }
  if (tag === 'textarea') return String(el.value ?? '');
  if (tag === 'select') {
    const elegidas = [];
    for (let i = 0; i < el.options.length; i++) if (el.options[i].selected) elegidas.push(limpio(el.options[i].text));
    return elegidas.join(', ');
  }
  if (el.isContentEditable) return limpio(el.innerText ?? '').slice(0, 300);
  return null;
}

function estadosDe(el, activo) {
  const estados = [];
  const aria = nombre => el.getAttribute(nombre);
  if (el.disabled || aria('aria-disabled') === 'true') estados.push('desactivado');
  const casilla = el.localName === 'input' && ['checkbox', 'radio'].includes(el.type);
  if (casilla) estados.push(el.checked ? (el.type === 'radio' ? 'elegida' : 'marcada') : 'sin marcar');
  else if (aria('aria-checked') === 'true') estados.push('marcada');
  else if (aria('aria-checked') === 'false') estados.push('sin marcar');
  if (aria('aria-pressed') === 'true') estados.push('pulsado');
  if (aria('aria-selected') === 'true') estados.push('elegida');
  if (el.localName === 'summary') estados.push(el.parentElement?.open ? 'abierto' : 'cerrado');
  else if (aria('aria-expanded') === 'true') estados.push('abierto');
  else if (aria('aria-expanded') === 'false') estados.push('cerrado');
  if (el.required || aria('aria-required') === 'true') estados.push('obligatorio');
  if (el.readOnly) estados.push('solo lectura');
  if (el.localName === 'input' && el.type === 'password' && el.value) estados.push('con texto');
  const actual = aria('aria-current');
  if (actual && actual !== 'false') estados.push('actual');
  if (el === activo) estados.push('con el foco');
  return estados;
}

/** Dónde queda respecto a lo que se ve: '' (a la vista), 'arriba', 'abajo' o 'lado'. */
function vistaDe(caja, win) {
  if (caja.bottom <= 0) return 'arriba';
  if (caja.top >= win.innerHeight) return 'abajo';
  if (caja.right <= 0 || caja.left >= win.innerWidth) return 'lado';
  return '';
}

function hrefDe(el) {
  let href = '';
  try { href = typeof el.href === 'string' ? el.href : el.getAttribute('href') ?? ''; } catch { /* sin href */ }
  return /^javascript:/i.test(href) ? 'javascript:…' : href;
}

/** El elemento con el foco, también dentro de shadow roots. */
function activoDe(doc) {
  let activo = doc.activeElement;
  while (activo?.openOrClosedShadowRoot?.activeElement) activo = activo.openOrClosedShadowRoot.activeElement;
  return activo;
}

/* Se evalúa dentro de la página (en el sandbox de pagina_ejecutar, con sus permisos): por eso va entera aquí, sin usar
 * nada de fuera. Convierte el resultado en JSON sin romperse con lo que no es JSON (nodos, ciclos, Map…). */
function serializarEnLaPagina(valor, maximo) {
  const vistos = new WeakSet();
  const etiqueta = v => Object.prototype.toString.call(v).slice(8, -1);
  const nodo = n => {
    if (n.nodeType === 1) {
      let texto = `<${n.localName}`;
      if (n.id) texto += ` id="${n.id}"`;
      const clase = typeof n.className === 'string' ? n.className.trim() : '';
      if (clase) texto += ` class="${clase.slice(0, 80)}"`;
      texto += '>';
      const dentro = String(n.innerText ?? n.textContent ?? '').replace(/\s+/g, ' ').trim();
      return dentro ? `${texto} ${dentro.slice(0, 150)}` : texto;
    }
    if (n.nodeType === 3) return `#texto ${String(n.data).slice(0, 200)}`;
    if (n.nodeType === 9) return `#documento ${n.URL}`;
    return `#${n.nodeName}`;
  };
  const pasar = (v, nivel) => {
    if (v === null) return null;
    switch (typeof v) {
      case 'string': return v.length > 50_000 ? `${v.slice(0, 50_000)}…` : v;
      case 'number': return Number.isFinite(v) ? v : String(v);
      case 'boolean': return v;
      case 'undefined': return '(undefined)';
      case 'bigint': return `${v}n`;
      case 'symbol': return String(v);
      case 'function': return `(función ${v.name || 'anónima'})`;
    }
    if (vistos.has(v)) return '(circular)';
    if (nivel >= 8) return '(…)';
    vistos.add(v);
    try {
      if (typeof v.nodeType === 'number' && typeof v.nodeName === 'string') return nodo(v);
      if (v.window === v) return `(ventana ${v.location?.href ?? ''})`;
      const tipo = etiqueta(v);
      if (tipo === 'Date') return Number.isNaN(v.getTime()) ? '(fecha no válida)' : v.toISOString();
      if (tipo === 'RegExp') return String(v);
      if (tipo === 'Error' || (typeof v.message === 'string' && typeof v.name === 'string' && 'stack' in v)) return { error: v.name, mensaje: v.message };
      if (typeof v.toJSON === 'function') return pasar(v.toJSON(), nivel + 1);
      if (tipo === 'Map') return { '(Map)': Array.from(v).slice(0, 200).map(([k, x]) => [pasar(k, nivel + 1), pasar(x, nivel + 1)]) };
      const lista = Array.isArray(v) || ArrayBuffer.isView(v) || tipo === 'Set'
        || (typeof v.length === 'number' && typeof v.item === 'function');
      if (lista) {
        const todos = Array.from(v);
        const salida = todos.slice(0, 500).map(x => pasar(x, nivel + 1));
        if (todos.length > 500) salida.push(`(… ${todos.length - 500} más)`);
        return salida;
      }
      const salida = {};
      const claves = Object.keys(v);
      for (const clave of claves.slice(0, 200)) {
        try { salida[clave] = pasar(v[clave], nivel + 1); } catch (error) { salida[clave] = `(no se puede leer: ${error?.message ?? error})`; }
      }
      if (claves.length > 200) salida['(…)'] = `${claves.length - 200} claves más`;
      return salida;
    } catch (error) {
      return `(no se puede leer: ${error?.message ?? error})`;
    }
  };
  const tipo = valor === null ? 'null' : Array.isArray(valor) ? 'array' : typeof valor;
  const json = JSON.stringify(pasar(valor, 0), null, 1) ?? 'null';
  return JSON.stringify({ tipo, json: json.length > maximo ? `${json.slice(0, maximo)}…` : json, recortado: json.length > maximo });
}

const textoDeError = error => {
  try {
    const nombre = error?.name ? String(error.name) : 'Error';
    const mensaje = error?.message != null ? String(error.message) : String(error);
    return `${nombre}: ${mensaje}`.slice(0, 2000);
  } catch { return 'Error'; }
};
const esDeSintaxis = error => { try { return error?.name === 'SyntaxError' || /^SyntaxError\b/.test(String(error)); } catch { return false; } };

export class KitsuneZeroNavegarChild extends JSWindowActorChild {
  #refs = new Map();        // número → elemento
  #numeros = new WeakMap(); // elemento → número
  #siguiente = 1;
  #tip = null;

  #refDe(el, desde) {
    const ya = this.#numeros.get(el);
    if (ya) return ya;
    this.#siguiente = Math.max(this.#siguiente, Number.isInteger(desde) ? desde : 1);
    const numero = this.#siguiente++;
    this.#refs.set(numero, el);
    this.#numeros.set(el, numero);
    if (this.#refs.size > MAXIMO_REFS) {
      const [viejo, suyo] = this.#refs.entries().next().value;
      this.#refs.delete(viejo);
      this.#numeros.delete(suyo);
    }
    return numero;
  }

  #elemento(ref) {
    const el = this.#refs.get(Number(ref));
    if (!el) throw new Error(`La referencia e${ref} no es de esta página (se ha recargado o ha cambiado de dirección): pide otra vez pagina_elementos`);
    if (!el.isConnected) throw new Error(`[e${ref}] ya no está en la página (ha cambiado): pide otra vez pagina_elementos`);
    return el;
  }

  /** «[e12] botón "Enviar"», para contarle a Claude qué se ha tocado. */
  #describir(el, desde) {
    if (!el) return '';
    const tipo = tipoDe(el) ?? el.localName;
    const nombre = nombreDe(el).slice(0, 100);
    return `[e${this.#refDe(el, desde)}] ${tipo}${nombre ? ` ${JSON.stringify(nombre)}` : ''}`;
  }

  #luego(hacer) {
    Services.tm.dispatchToMainThread(() => {
      try { hacer(); } catch (error) { console.error('Kitsune Zero (navegar):', error); }
    });
  }

  #respuesta(datos) {
    return { ...datos, siguiente: this.#siguiente };
  }

  /** Recorre los elementos en el orden de la página, también los de dentro de shadow roots; sin entrar en lo que no
   *  se pinta (display: none). */
  * #recorrer() {
    const doc = this.document, win = this.contentWindow;
    const pila = [doc.documentElement];
    let mirados = 0;
    while (pila.length && mirados < MAXIMO_RECORRIDO) {
      const el = pila.pop();
      if (!el || SIN_RECORRER.has(el.localName)) continue;
      mirados++;
      let pintado = true;
      try { pintado = el.checkVisibility(); } catch { /* sin checkVisibility */ }
      // display: contents no tiene caja, pero lo de dentro sí se pinta.
      if (!pintado && win.getComputedStyle(el)?.display !== 'contents') continue;
      yield el;
      const hijos = [];
      // Sin entrar en los de Gecko (lo de dentro de un <input>, de un <video>…): son parte del elemento.
      const sombra = el.openOrClosedShadowRoot;
      if (sombra && !sombra.isUAWidget?.()) for (let i = 0; i < sombra.children.length; i++) hijos.push(sombra.children[i]);
      for (let i = 0; i < el.children.length; i++) hijos.push(el.children[i]);
      for (let i = hijos.length - 1; i >= 0; i--) pila.push(hijos[i]);
    }
    return mirados >= MAXIMO_RECORRIDO;
  }

  elementos({ desde } = {}) {
    const doc = this.document, win = this.contentWindow;
    const activo = activoDe(doc);
    const elementos = [];
    let marcos = 0, recortada = false;
    const estilo = el => { try { return win.getComputedStyle(el); } catch { return null; } };
    const recorrido = this.#recorrer();
    for (;;) {
      const paso = recorrido.next();
      if (paso.done) { if (paso.value) recortada = true; break; }
      const el = paso.value;
      if (MARCOS.has(el.localName)) { if (visible(el)) marcos++; continue; }
      let tipo = tipoDe(el), objetivo = el;
      if (!tipo && el.localName === 'label' && el.control && !visible(el.control)) {
        // Una casilla escondida (la de verdad) con su etiqueta a la vista: se toca la etiqueta.
        tipo = tipoDe(el.control);
        objetivo = el.control;
        if (!['casilla', 'radio', 'interruptor'].includes(tipo)) tipo = null;
      }
      if (!tipo && el.localName === 'label') continue; // su campo ya sale, con el texto de la etiqueta
      if (!tipo) {
        // Lo que tiene cursor de mano y no lo hereda (un <div> con onClick de React, por ejemplo).
        if (estilo(el)?.cursor !== 'pointer') continue;
        const padre = padreDe(el);
        if (padre?.nodeType === 1 && estilo(padre)?.cursor === 'pointer') continue;
        tipo = 'clicable';
      }
      if (!visible(el)) continue;
      if (elementos.length >= MAXIMO_ELEMENTOS) { recortada = true; break; }
      const caja = el.getBoundingClientRect();
      const datos = { ref: this.#refDe(el, desde), tipo, nombre: nombreDe(el) || nombreDe(objetivo), vista: vistaDe(caja, win) };
      const valor = valorDe(objetivo);
      if (valor != null) datos.valor = valor;
      if (tipo === 'enlace') datos.href = hrefDe(el);
      if (objetivo.localName === 'select') {
        datos.opciones = [];
        for (let i = 0; i < Math.min(40, objetivo.options.length); i++) datos.opciones.push(limpio(objetivo.options[i].text));
        if (objetivo.options.length > 40) datos.masOpciones = objetivo.options.length - 40;
      }
      const estados = estadosDe(objetivo, activo);
      if (estados.length) datos.estados = estados;
      elementos.push(datos);
    }
    return this.#respuesta({ titulo: String(doc.title ?? ''), direccion: String(doc.URL ?? ''), elementos, marcos, recortada });
  }

  localizar({ selector, desde } = {}) {
    let el;
    try { el = this.document.querySelector(String(selector)); } catch (error) {
      throw new Error(`«${String(selector).slice(0, 100)}» no es un selector CSS válido`);
    }
    if (!el) throw new Error(`Ningún elemento de la página coincide con «${String(selector).slice(0, 100)}»`);
    return this.#respuesta({ ref: this.#refDe(el, desde), descripcion: this.#describir(el, desde) });
  }

  /** Lo trae a la vista si no se ve entero y devuelve el punto donde pulsaría una persona (el centro de su primera
   *  caja, dentro de lo que se ve), o null si no tiene nada visible. */
  #alaVista(el) {
    const win = this.contentWindow;
    const caja = el.getBoundingClientRect();
    const entero = caja.top >= 0 && caja.left >= 0 && caja.bottom <= win.innerHeight && caja.right <= win.innerWidth;
    if (!entero) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const cajas = el.getClientRects();
    let elegida = null;
    for (let i = 0; i < cajas.length; i++) if (cajas[i].width > 0 && cajas[i].height > 0) { elegida = cajas[i]; break; }
    elegida ??= el.getBoundingClientRect();
    const izquierda = Math.max(0, elegida.left), derecha = Math.min(win.innerWidth, elegida.right);
    const arriba = Math.max(0, elegida.top), abajo = Math.min(win.innerHeight, elegida.bottom);
    if (derecha <= izquierda || abajo <= arriba) return null;
    return { x: (izquierda + derecha) / 2, y: (arriba + abajo) / 2 };
  }

  /** Lo que hay en ese punto si no es `el` (ni algo suyo, ni su etiqueta): lo que lo tapa. */
  #tapadoPor(el, punto) {
    const doc = this.document;
    let encima = doc.elementFromPoint(punto.x, punto.y);
    while (encima?.openOrClosedShadowRoot) {
      const dentro = encima.openOrClosedShadowRoot.elementFromPoint(punto.x, punto.y);
      if (!dentro || dentro === encima) break;
      encima = dentro;
    }
    if (!encima || contiene(el, encima)) return null;
    for (let i = 0; i < (el.labels?.length ?? 0); i++) if (contiene(el.labels[i], encima)) return null;
    return encima;
  }

  #raton(tipo, punto, { boton = 0, clics = 1 } = {}) {
    const win = this.contentWindow;
    if (typeof win.synthesizeMouseEvent === 'function') {
      win.synthesizeMouseEvent(tipo, punto.x, punto.y, { button: boton, clickCount: clics, inputSource: 1 /* ratón */ },
        { isDOMEventSynthesized: false, isWidgetEventSynthesized: false });
    } else {
      win.windowUtils.sendMouseEvent(tipo, punto.x, punto.y, boton, clics, 0, false, 0, 1, false, false);
    }
  }

  clic({ ref, desde, doble = false, boton = 0, forzar = false, encima = false } = {}) {
    const el = this.#elemento(ref);
    if (el.localName === 'input' && el.type === 'file') {
      throw new Error('Es un campo para subir archivos: abriría el selector de archivos del sistema, y eso no se puede manejar desde aquí');
    }
    const descripcion = this.#describir(el, desde);
    // Su lista se abre fuera de la página (en Kitsune) y desde aquí no se podría elegir nada en ella.
    if (el.localName === 'select' && !encima) throw new Error(`${descripcion} es un desplegable: elige la opción con pagina_elegir`);
    const punto = this.#alaVista(el);
    if (!punto && !forzar) throw new Error(`${descripcion} no se ve (está oculto o no tiene tamaño): mira pagina_captura o usa forzar: true`);
    const tapa = punto ? this.#tapadoPor(el, punto) : null;
    if (tapa && !forzar) {
      throw new Error(`No se puede ${encima ? 'pasar el ratón por' : 'hacer clic en'} ${descripcion}: lo tapa ${this.#describir(tapa, desde)}. `
        + 'Ciérralo antes (un aviso de cookies, un menú…) o usa forzar: true para pulsarlo por dentro, sin el ratón.');
    }
    const conRaton = punto && !tapa;
    this.#luego(() => {
      if (!conRaton) {
        if (encima) el.dispatchEvent(new this.contentWindow.MouseEvent('mouseover', { bubbles: true, composed: true }));
        else { el.click(); if (doble) { el.click(); el.dispatchEvent(new this.contentWindow.MouseEvent('dblclick', { bubbles: true, composed: true, detail: 2 })); } }
        return;
      }
      this.#raton('mousemove', punto);
      if (encima) return;
      this.#raton('mousedown', punto, { boton, clics: 1 });
      this.#raton('mouseup', punto, { boton, clics: 1 });
      if (doble) {
        this.#raton('mousedown', punto, { boton, clics: 2 });
        this.#raton('mouseup', punto, { boton, clics: 2 });
      }
    });
    return this.#respuesta({ descripcion, modo: conRaton ? 'ratón' : 'por dentro', punto: punto ? { x: Math.round(punto.x), y: Math.round(punto.y) } : null });
  }

  /** El teclado de Gecko para esta página (nsITextInputProcessor): sus teclas son de verdad para la web. Su «entrada»
   *  se vuelve a abrir antes de cada tecla, como hace Marionette: en el proceso de la web no dura más de una. */
  #teclado() {
    this.#tip ??= Cc['@mozilla.org/text-input-processor;1'].createInstance(Ci.nsITextInputProcessor);
    const tip = this.#tip, win = this.contentWindow;
    let listo = false;
    try { listo = tip.beginInputTransactionForTests(win); } catch { listo = false; }
    if (!listo) throw new Error('Ahora no se puede usar el teclado en esta página (otra entrada de texto la está usando)');
    return tip;
  }

  /** Pulsa y suelta una tecla ({ tecla, imprimible, modificadores }), con sus modificadores apretados mientras.
   *  Devuelve true si la página se la ha quedado (preventDefault en keydown o keypress). */
  #pulsar({ tecla, imprimible, modificadores = [] }) {
    const tip = this.#teclado();
    const Teclado = this.contentWindow.KeyboardEvent;
    const apretados = [];
    for (const modificador of modificadores) {
      if (tip.getModifierState(modificador)) continue;
      tip.keydown(new Teclado('', { key: modificador }), tip.KEY_NON_PRINTABLE_KEY | tip.KEY_DONT_DISPATCH_MODIFIER_KEY_EVENT);
      apretados.push(modificador);
    }
    try {
      let opciones, banderas;
      if (imprimible) {
        const keyCode = tip.guessKeyCodeValueOfPrintableKeyInUSEnglishKeyboardLayout(tecla, undefined);
        const code = tip.guessCodeValueOfPrintableKeyInUSEnglishKeyboardLayout(tecla, undefined);
        opciones = { key: tecla, code, keyCode };
        banderas = tip.KEY_FORCE_PRINTABLE_KEY | (keyCode ? 0 : tip.KEY_KEEP_KEYCODE_ZERO);
      } else {
        opciones = { key: tecla, code: tip.computeCodeValueOfNonPrintableKey(tecla, undefined) };
        banderas = tip.KEY_NON_PRINTABLE_KEY;
      }
      const evento = new Teclado('', opciones);
      const hecho = tip.keydown(evento, banderas);
      this.#teclado().keyup(evento, banderas);
      return (hecho & (tip.KEYDOWN_IS_CONSUMED | tip.KEYPRESS_IS_CONSUMED)) !== 0;
    } finally {
      for (const modificador of apretados.reverse()) {
        tip.keyup(new Teclado('', { key: modificador }), tip.KEY_NON_PRINTABLE_KEY | tip.KEY_DONT_DISPATCH_MODIFIER_KEY_EVENT);
      }
    }
  }

  #enfocar(el) {
    if (activoDe(this.document) !== el) el.focus();
  }

  escribir({ ref, desde, texto = '', borrar = true, enviar = false } = {}) {
    const el = this.#elemento(ref);
    const descripcion = this.#describir(el, desde);
    const campo = esCampoDeTexto(el);
    if (!campo && !el.isContentEditable) throw new Error(`${descripcion} no es un campo donde se pueda escribir (para elegir en un desplegable, pagina_elegir)`);
    if (el.disabled) throw new Error(`${descripcion} está desactivado`);
    if (el.readOnly) throw new Error(`${descripcion} es de solo lectura`);
    this.#alaVista(el);
    this.#enfocar(el);
    const unaLinea = el.localName === 'input';
    const escrito = unaLinea ? String(texto).replace(/[\r\n]+/g, '') : String(texto).replace(/\r\n?/g, '\n');
    const leer = () => (campo ? String(el.value ?? '') : String(el.innerText ?? '').replace(/\n$/, ''));
    const doc = this.document;
    if (borrar && leer()) {
      if (campo) el.select();
      else this.contentWindow.getSelection().selectAllChildren(el);
      this.#pulsar({ tecla: 'Backspace', imprimible: false });
      if (leer() && campo) {
        el.value = '';
        el.dispatchEvent(new this.contentWindow.Event('input', { bubbles: true, composed: true }));
      }
    } else if (!borrar) {
      try {
        if (campo) el.setSelectionRange(el.value.length, el.value.length);
        else { const seleccion = this.contentWindow.getSelection(); seleccion.selectAllChildren(el); seleccion.collapseToEnd(); }
      } catch { /* algunos tipos (email, number) no dejan mover el cursor: se escribe donde esté */ }
    }
    const antes = leer();
    let modo = 'teclado';
    for (const caracter of escrito) {
      if (caracter === '\n') this.#pulsar({ tecla: 'Enter', imprimible: false });
      else if (caracter === '\t') doc.execCommand('insertText', false, '\t');
      else this.#pulsar({ tecla: caracter, imprimible: true });
    }
    if (escrito && leer() === antes) {
      // Si el teclado no ha llegado (raro), como pegar el texto; y si tampoco, el valor a mano (con su evento input).
      modo = 'insertText';
      this.#enfocar(el);
      try { doc.execCommand('insertText', false, escrito); } catch { /* sin editor */ }
      if (leer() === antes && campo) {
        modo = 'valor';
        el.value = antes + escrito;
        el.dispatchEvent(new this.contentWindow.Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new this.contentWindow.Event('change', { bubbles: true }));
      }
    }
    if (enviar) this.#luego(() => this.#pulsar({ tecla: 'Enter', imprimible: false }));
    const contrasena = el.localName === 'input' && el.type === 'password';
    const final = leer();
    return this.#respuesta({
      descripcion, modo,
      valor: contrasena ? `(contraseña de ${final.length} caracteres)` : final.slice(0, 2000),
      completo: final.endsWith(escrito),
    });
  }

  teclas({ ref, desde, teclas = [] } = {}) {
    let descripcion = '';
    if (ref != null) {
      const el = this.#elemento(ref);
      descripcion = this.#describir(el, desde);
      this.#alaVista(el);
      this.#enfocar(el);
    }
    this.#teclado(); // que diga ya si no se puede
    const doc = this.document, win = this.contentWindow;
    this.#luego(() => {
      for (const tecla of teclas) {
        const antes = activoDe(doc);
        const quedada = this.#pulsar(tecla);
        // Con la ventana de Kitsune sin el foco del sistema (Claude en una terminal), Gecko no mueve el foco con el Tab
        // de la web: se mueve aquí, como lo habría hecho él (si la página no se ha quedado la tecla).
        const soloShift = tecla.modificadores.every(modificador => modificador === 'Shift');
        if (tecla.tecla === 'Tab' && soloShift && !quedada && activoDe(doc) === antes) {
          const atras = tecla.modificadores.includes('Shift');
          try {
            Services.focus.moveFocus(win, antes && antes !== doc.body ? antes : null,
              atras ? Ci.nsIFocusManager.MOVEFOCUS_BACKWARD : Ci.nsIFocusManager.MOVEFOCUS_FORWARD, Ci.nsIFocusManager.FLAG_BYKEY);
          } catch { /* sin más donde ir */ }
        }
      }
    });
    return this.#respuesta({ descripcion, foco: this.#describir(activoDe(doc), desde) });
  }

  elegir({ ref, desde, opciones = [] } = {}) {
    const el = this.#elemento(ref);
    const descripcion = this.#describir(el, desde);
    if (el.localName !== 'select') throw new Error(`${descripcion} no es un desplegable <select>: si es uno hecho a mano, ábrelo con pagina_clic y elige con pagina_clic`);
    if (el.disabled) throw new Error(`${descripcion} está desactivado`);
    const todas = [];
    for (let i = 0; i < el.options.length; i++) todas.push(el.options[i]);
    const elegidas = opciones.map(buscada => {
      const texto = String(buscada), n = normal(texto);
      const opcion = todas.find(o => o.value === texto) ?? todas.find(o => normal(o.label || o.text) === n)
        ?? todas.find(o => normal(o.text).startsWith(n)) ?? todas.find(o => normal(o.text).includes(n));
      if (!opcion) {
        const lista = todas.slice(0, 30).map(o => JSON.stringify(limpio(o.text))).join(', ');
        throw new Error(`«${texto.slice(0, 80)}» no es ninguna opción de ${descripcion}. Opciones: ${lista}${todas.length > 30 ? ', …' : ''}`);
      }
      if (opcion.disabled) throw new Error(`La opción ${JSON.stringify(limpio(opcion.text))} está desactivada`);
      return opcion;
    });
    if (!elegidas.length) throw new Error('No se ha dicho qué opción elegir');
    if (!el.multiple && elegidas.length > 1) throw new Error(`${descripcion} solo deja elegir una opción`);
    this.#alaVista(el);
    this.#enfocar(el);
    if (el.multiple) for (const opcion of todas) opcion.selected = elegidas.includes(opcion);
    else elegidas[0].selected = true;
    const win = this.contentWindow;
    this.#luego(() => {
      el.dispatchEvent(new win.Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new win.Event('change', { bubbles: true }));
    });
    return this.#respuesta({ descripcion, elegidas: elegidas.map(opcion => limpio(opcion.text)) });
  }

  /** Lo que se desplaza: el elemento (o su primer antepasado con barra) o, si no, lo que hay en el centro de la vista;
   *  al final, la página. */
  #desplazable(desde, vertical) {
    const win = this.contentWindow, doc = this.document;
    const puede = el => {
      const estilo = win.getComputedStyle(el);
      const desborde = vertical ? estilo?.overflowY : estilo?.overflowX;
      if (!['auto', 'scroll', 'overlay'].includes(desborde)) return false;
      return vertical ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
    };
    for (let el = desde; el && el.nodeType === 1; el = padreDe(el)) {
      if (el === doc.documentElement || el === doc.body) break;
      if (puede(el)) return el;
    }
    return doc.scrollingElement ?? doc.documentElement;
  }

  desplazar({ ref, desde, direccion, cantidad = 1 } = {}) {
    const win = this.contentWindow, doc = this.document;
    const el = ref != null ? this.#elemento(ref) : null;
    if (el && !direccion) {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      return this.#respuesta({ descripcion: `${this.#describir(el, desde)} a la vista`, ...this.#posicion(doc.scrollingElement ?? doc.documentElement) });
    }
    const vertical = !['izquierda', 'derecha'].includes(direccion);
    const raiz = doc.scrollingElement ?? doc.documentElement;
    // La página, si puede moverse hacia ahí; si no (webs que lo llevan todo dentro de una zona con su propia barra, o
    // la página ya está al final), lo que hay en el centro de la vista, como haría la rueda del ratón.
    const atras = ['arriba', 'izquierda', 'principio'].includes(direccion);
    const sitio = vertical ? raiz.scrollTop : raiz.scrollLeft;
    const maximo = vertical ? raiz.scrollHeight - raiz.clientHeight : raiz.scrollWidth - raiz.clientWidth;
    const paginaPuede = atras ? sitio > 0 : sitio < maximo - 1;
    const objetivo = el ? this.#desplazable(el, vertical)
      : paginaPuede ? raiz : this.#desplazable(doc.elementFromPoint(win.innerWidth / 2, win.innerHeight / 2), vertical);
    const pagina = objetivo === raiz;
    const alto = pagina ? win.innerHeight : objetivo.clientHeight, ancho = pagina ? win.innerWidth : objetivo.clientWidth;
    const pasos = Math.max(0.1, Math.min(50, Number(cantidad) || 1));
    const opciones = { behavior: 'instant' };
    switch (direccion) {
      case 'arriba': opciones.top = -alto * 0.85 * pasos; break;
      case 'izquierda': opciones.left = -ancho * 0.85 * pasos; break;
      case 'derecha': opciones.left = ancho * 0.85 * pasos; break;
      case 'principio': opciones.top = -objetivo.scrollHeight; break;
      case 'final': opciones.top = objetivo.scrollHeight; break;
      default: opciones.top = alto * 0.85 * pasos;
    }
    if (pagina) win.scrollBy(opciones); else objetivo.scrollBy(opciones);
    return this.#respuesta({ descripcion: pagina ? 'la página' : this.#describir(objetivo, desde), ...this.#posicion(objetivo) });
  }

  #posicion(objetivo) {
    const y = Math.round(objetivo.scrollTop), x = Math.round(objetivo.scrollLeft);
    const maxY = Math.max(0, objetivo.scrollHeight - objetivo.clientHeight), maxX = Math.max(0, objetivo.scrollWidth - objetivo.clientWidth);
    return { x, y, alto: objetivo.scrollHeight, ancho: objetivo.scrollWidth, alPrincipio: y <= 1, alFinal: y >= maxY - 1, maxX, maxY };
  }

  /** El rectángulo que fotografiar, en px CSS del documento: lo que se ve, la página entera o un elemento. */
  zona({ ref, desde, completa = false } = {}) {
    const win = this.contentWindow, doc = this.document;
    const base = { dpr: win.devicePixelRatio || 1, titulo: String(doc.title ?? ''), direccion: String(doc.URL ?? '') };
    if (ref != null) {
      const el = this.#elemento(ref);
      this.#alaVista(el);
      const caja = el.getBoundingClientRect();
      const izquierda = Math.max(0, caja.left), arriba = Math.max(0, caja.top);
      const derecha = Math.min(win.innerWidth, caja.right), abajo = Math.min(win.innerHeight, caja.bottom);
      if (derecha <= izquierda || abajo <= arriba) throw new Error(`${this.#describir(el, desde)} no se ve (está oculto o no tiene tamaño)`);
      return this.#respuesta({ ...base, descripcion: this.#describir(el, desde), x: izquierda + win.scrollX, y: arriba + win.scrollY, ancho: derecha - izquierda, alto: abajo - arriba });
    }
    if (completa) {
      const raiz = doc.documentElement;
      return this.#respuesta({ ...base, x: 0, y: 0, ancho: Math.max(raiz.scrollWidth, Math.round(win.innerWidth)), alto: Math.max(raiz.scrollHeight, Math.round(win.innerHeight)) });
    }
    return this.#respuesta({ ...base, x: win.scrollX, y: win.scrollY, ancho: Math.round(win.innerWidth), alto: Math.round(win.innerHeight) });
  }

  /** Para pagina_esperar: ¿hay un elemento visible con ese selector? ¿sale ese texto? */
  buscar({ selector, texto } = {}) {
    const doc = this.document;
    let hay = true;
    if (selector) {
      let el;
      try { el = doc.querySelector(String(selector)); } catch { throw new Error(`«${String(selector).slice(0, 100)}» no es un selector CSS válido`); }
      hay = !!el && visible(el);
    }
    if (hay && texto) hay = normal(doc.body?.innerText ?? doc.documentElement?.textContent ?? '').includes(normal(texto));
    return { hay, listo: String(doc.readyState) };
  }

  estado({ desde } = {}) {
    const doc = this.document;
    const activo = activoDe(doc);
    return this.#respuesta({
      titulo: String(doc.title ?? ''), direccion: String(doc.URL ?? ''), listo: String(doc.readyState),
      foco: activo && activo !== doc.body && activo !== doc.documentElement ? this.#describir(activo, desde) : '',
    });
  }

  async ejecutar({ codigo } = {}) {
    const win = this.contentWindow;
    // Con el principal de la página y viendo sus objetos tal cual (wantXrays: false), como la consola: nada de Kitsune.
    const sandbox = Cu.Sandbox(win, {
      sandboxPrototype: win, sameZoneAs: win, wantXrays: false, wantComponents: false,
      sandboxName: 'Kitsune Zero · pagina_ejecutar',
    });
    const evaluar = fuente => Cu.evalInSandbox(fuente, sandbox, '1.8', 'kitsune-zero-pagina-ejecutar.js', 1, false);
    const serializar = evaluar(`(${serializarEnLaPagina.toString()})`);
    let funcion;
    try {
      // Primero como expresión (document.title); si no lo es, como cuerpo de una función (con return).
      try { funcion = evaluar(`(async () => (${codigo}\n))`); } catch (error) {
        if (!esDeSintaxis(error)) throw error;
        funcion = evaluar(`(async () => {${codigo}\n})`);
      }
    } catch (error) {
      return { error: textoDeError(error) };
    }
    let valor;
    try { valor = await funcion(); } catch (error) { return { error: textoDeError(error) }; }
    try {
      return { resultado: String(serializar(valor, MAXIMO_RESULTADO)) };
    } catch (error) {
      return { error: `No se pudo convertir el resultado: ${textoDeError(error)}` };
    }
  }

  receiveMessage({ name, data }) {
    const datos = data ?? {};
    switch (name) {
      case 'ZeroNavegar:elementos': return this.elementos(datos);
      case 'ZeroNavegar:localizar': return this.localizar(datos);
      case 'ZeroNavegar:clic': return this.clic(datos);
      case 'ZeroNavegar:escribir': return this.escribir(datos);
      case 'ZeroNavegar:teclas': return this.teclas(datos);
      case 'ZeroNavegar:elegir': return this.elegir(datos);
      case 'ZeroNavegar:desplazar': return this.desplazar(datos);
      case 'ZeroNavegar:zona': return this.zona(datos);
      case 'ZeroNavegar:buscar': return this.buscar(datos);
      case 'ZeroNavegar:estado': return this.estado(datos);
      case 'ZeroNavegar:ejecutar': return this.ejecutar(datos);
    }
    return null;
  }
}
