/* Oscurecer las webs claras (proceso de la web). Solo con Oscuro (o Negro absoluto) y
 * «Oscurecer las webs claras» en «Tu inicio»: mira si la página es clara (el fondo de unos
 * pocos puntos y el del lienzo) y, si lo es, le pone una hoja fija de Kitsune que la pasa a
 * negativo. Las webs con modo oscuro propio ya llegan oscuras y no se tocan. No cambia el DOM
 * de la web, no lee su texto y no envía nada: todo se decide aquí.
 *
 * Es el modo «filtro» de Dark Reader y lo que hacen Chrome (modo oscuro automático) o Samsung
 * Internet a su manera: toda la página en negativo con el tono girado media vuelta, así que el
 * rojo sigue siendo rojo y el azul azul, solo que sobre negro. Fotos, vídeos, lienzos, marcos y
 * fondos con imagen vuelven a su color (un poco más suaves, como piden las guías de modo oscuro).
 */
const ENABLED = 'kitsune.oscurecer.enabled';
// Las webs que no se oscurecen: las publica el proceso principal (kitsune-appearance) en sharedData, porque Gecko
// no deja ver a los procesos de las webs las preferencias de texto del usuario (les llegan vacías).
const EXCEPTIONS = 'kitsune-oscurecer-excepciones';
const DARK = '(prefers-color-scheme: dark)';
// Blanco → #121212 y negro → #ededed: ni negro puro detrás del texto ni blanco que deslumbre.
const NEGATIVE = 'invert(1) hue-rotate(180deg) contrast(.86)';
const MEDIA = 'img,picture,video,canvas,iframe,embed,object,svg image,[style*="url("]';
const PAGE_CSS = `:root{filter:${NEGATIVE}!important}` +
  `:root :is(${MEDIA}){filter:hue-rotate(180deg) invert(1)!important}` +
  // Dentro de algo que ya volvió a su color, nada más: si no, se invertiría dos veces.
  `:root :is(${MEDIA}) :is(${MEDIA}){filter:none!important}` +
  // En Gecko, los diálogos modales y los popovers siguen dentro del filtro de la página (no llevan
  // otro). A pantalla completa, ningún filtro: el vídeo se ve tal cual y no se gasta en invertirlo.
  `:root:has(:fullscreen),:root:has(:fullscreen) :is(${MEDIA}){filter:none!important}`;
// El visor de PDF ya es oscuro: solo las hojas, que son papel blanco.
const PDF_CSS = `.pdfViewer .page{filter:${NEGATIVE}!important}`;
const sheetUri = css => 'data:text/css;charset=utf-8,' + encodeURIComponent(css);
const PAGE_SHEET = sheetUri(PAGE_CSS), PDF_SHEET = sheetUri(PDF_CSS);
const RESTORE = 'hue-rotate(180deg) invert(1)';

/* Los documentos (Risco, 9-11: «en los Word, en los PowerPoint… con el modo oscuro no se lee nada»). Dos casos
 * en los que devolver su color a «lo que es imagen» deja el texto sin leerse:
 *
 * 1. El papel pintado en un lienzo. Google Docs (y Sheets, y otros editores) dibujan el texto en <canvas>
 *    transparentes: si el lienzo vuelve a su color, su tinta negra queda sobre la página ya oscura. Esos lienzos
 *    («papel»: casi todo transparente o casi todo blanco, con algo de tinta oscura) se oscurecen con la página.
 * 2. El texto encima de una imagen: el fondo de una diapositiva (PowerPoint, Slides), la foto de una cabecera… La
 *    imagen vuelve a su color y el texto de encima se invertía (blanco sobre blanco). Lo de encima vuelve también a
 *    su color: se ve como lo diseñó la web, que lo pensó para esa imagen.
 *
 * Sin tocar el DOM de la web: cada cosa se señala con un selector (su clase, su id o su camino desde <body>) en la
 * misma hoja de usuario, que se rehace cuando cambia lo que hay. */
const MAX_RULES = 60;
const PAPER_MIN = 64;                 // un lienzo más pequeño (iconos, gráficos de una línea) no se mira
const COVER_MIN = { w: 160, h: 90 };  // una imagen más pequeña no es fondo de nada

/** ¿Qué hay en un lienzo? Con sus píxeles (RGBA): «papel» si casi todo es transparente o blanco y lleva algo de
 *  tinta oscura (texto), «imagen» si no; null si no se ve nada (vacío o ilegible: entonces se deja como estaba). */
export function classifyPixels(data) {
  const n = Math.floor((data?.length ?? 0) / 4);
  if (!n) return null;
  let clear = 0, white = 0, ink = 0, seen = 0;
  for (let i = 0; i < n * 4; i += 4) {
    const a = data[i + 3];
    if (a < 24) { clear++; continue; }
    seen++;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (r > 228 && g > 228 && b > 228) white++;
    else if (light < 0.42) ink++;
  }
  if (!seen) return null;
  const share = value => value / n;
  if ((share(clear) >= 0.5 || share(white) >= 0.5) && share(clear) + share(white) >= 0.8 && share(ink) >= 0.004) return 'papel';
  return 'imagen';
}

/** Un selector que señala solo este elemento, sin cambiarle nada: su id si es único, si no su camino desde <body>
 *  con :nth-child (como mucho 32 pasos). */
export function selectorOf(element, escape = value => value) {
  if (!element) return null;
  const doc = element.ownerDocument;
  if (element.id && /^[A-Za-z][\w-]*$/.test(element.id) && doc?.querySelectorAll?.(`#${escape(element.id)}`).length === 1) return `#${escape(element.id)}`;
  const parts = [];
  for (let node = element; node && node !== doc?.body && node !== doc?.documentElement; node = node.parentElement) {
    const parent = node.parentElement;
    if (!parent || parts.length >= 32) return null;
    const index = Array.prototype.indexOf.call(parent.children, node) + 1;
    if (index < 1) return null;
    parts.unshift(`${escape(node.localName)}:nth-child(${index})`);
  }
  return parts.length ? `body>${parts.join('>')}` : null;
}

const hasOwnText = element => {
  if (element.localName === 'text' || element.localName === 'tspan') return true;
  for (const node of element.childNodes ?? []) if (node.nodeType === 3 && node.data.trim()) return true;
  return false;
};

/** Lo que hay que cambiar en esta página ya oscurecida: los lienzos que son papel y lo que va encima de una imagen. */
export function documentRules(win, memory = new WeakMap()) {
  const doc = win?.document;
  if (!doc?.querySelectorAll || !doc.elementsFromPoint || !doc.body) return '';
  const escape = value => { try { return win.CSS.escape(value); } catch { return value; } };
  const W = win.innerWidth, H = win.innerHeight;
  const onScreen = r => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W;
  const paper = new Set(), natural = new Set();

  // 1. Los lienzos: se leen sus píxeles en pequeño (48×48). La lectura se guarda un rato por lienzo.
  let scratch = null;
  const now = Date.now();
  for (const canvas of [...doc.querySelectorAll('canvas')].slice(0, 40)) {
    const r = canvas.getBoundingClientRect();
    if (r.width < PAPER_MIN || r.height < PAPER_MIN || !onScreen(r)) continue;
    let known = memory.get(canvas);
    if (!known || (known.kind !== 'papel' && now - known.at > 5000 && known.tries < 4)) {
      let kind = null;
      try {
        scratch ??= doc.createElement('canvas');
        scratch.width = 48; scratch.height = 48;
        const ctx = scratch.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, 48, 48);
        ctx.drawImage(canvas, 0, 0, 48, 48);
        kind = classifyPixels(ctx.getImageData(0, 0, 48, 48).data);
      } catch { kind = null; }
      known = { kind, at: now, tries: (known?.tries ?? 0) + 1 };
      memory.set(canvas, known);
    }
    if (known.kind !== 'papel') continue;
    // Los mosaicos de un mismo editor comparten clase: un solo selector vale para los que vengan al bajar.
    const classes = [...(canvas.classList ?? [])].map(escape);
    const byClass = classes.length ? `canvas.${classes.join('.')}` : null;
    const shared = byClass && [...doc.querySelectorAll(byClass)].every(other => memory.get(other)?.kind !== 'imagen');
    const selector = shared ? byClass : selectorOf(canvas, escape);
    if (selector) paper.add(selector);
  }

  // 2. Lo que va encima de una imagen que vuelve a su color.
  const media = [...doc.querySelectorAll(MEDIA)]
    .map(element => ({ element, r: element.getBoundingClientRect() }))
    .filter(({ element, r }) => r.width >= COVER_MIN.w && r.height >= COVER_MIN.h && onScreen(r) && !element.closest?.('canvas') &&
                                 element.localName !== 'iframe' && !(element.localName === 'canvas' && paper.size && [...paper].some(s => element.matches?.(s))))
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)
    .slice(0, 24);
  for (const { element, r } of media) {
    const x0 = Math.max(r.left, 0), x1 = Math.min(r.right, W), y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, H);
    const points = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.2], [0.5, 0.8]]
      .map(([fx, fy]) => [x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy]);
    for (const [x, y] of points) {
      const stack = doc.elementsFromPoint(x, y);
      const at = stack.indexOf(element);
      if (at <= 0) continue;
      // Lo de encima con texto propio, que no esté dentro de la imagen (eso ya vuelve con ella).
      const text = stack.slice(0, at).find(node => !element.contains(node) && !node.contains(element) && hasOwnText(node));
      if (!text) continue;
      // Se sube hasta el bloque entero (el cuadro de texto de la diapositiva) sin llegar a lo que contiene la imagen.
      let block = text;
      while (block.parentElement && !block.parentElement.contains(element) && block.parentElement !== doc.body) {
        const pr = block.parentElement.getBoundingClientRect();
        if (pr.width > r.width * 1.1 || pr.height > r.height * 1.1) break;
        block = block.parentElement;
      }
      const selector = selectorOf(block, escape);
      if (selector) natural.add(selector);
      if (natural.size + paper.size >= MAX_RULES) break;
    }
    if (natural.size + paper.size >= MAX_RULES) break;
  }
  let css = '';
  for (const selector of paper) css += `:root:root ${selector}{filter:none!important}`;
  for (const selector of natural) {
    css += `:root:root ${selector}{filter:${RESTORE}!important}` +
           `:root:root ${selector} :is(${MEDIA}){filter:none!important}`;
  }
  return css;
}

/** Luminancia relativa (0 negro … 1 blanco) y opacidad de un color calculado por Gecko. */
export function parseColor(css) {
  const value = String(css ?? '').trim();
  const linear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  let m = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/.exec(value);
  if (m) return { l: luminance(m[1] / 255, m[2] / 255, m[3] / 255), a: m[4] === undefined ? 1 : Number(m[4]) };
  m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(value);
  if (m) return { l: luminance(+m[1], +m[2], +m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
  // oklab/oklch: su L al cubo se parece mucho a la luminancia; lab/lch: la de CIE.
  m = /^(ok)?(?:lab|lch)\(\s*([\d.]+)(%?)[^/)]*(?:\/\s*([\d.]+))?\s*\)$/.exec(value);
  if (m) {
    const lightness = Number(m[2]) / (m[3] || !m[1] ? 100 : 1);
    return { l: m[1] ? lightness ** 3 : ((lightness * 100 + 16) / 116) ** 3, a: m[4] === undefined ? 1 : Number(m[4]) };
  }
  return null;
}

const SKIP = new Set(['img', 'picture', 'video', 'canvas', 'iframe', 'embed', 'object', 'svg']);
/** ¿Es clara la página? Tres de cuatro puntos (o el lienzo) con un fondo claro. */
export function isLightPage(win) {
  const doc = win.document, root = doc.documentElement;
  if (!root) return false;
  const style = element => win.getComputedStyle(element);
  const paint = element => {
    const color = element && parseColor(style(element).backgroundColor);
    return color && color.a >= 0.5 ? color.l : null;
  };
  // El lienzo: el fondo de <html> o, si no tiene, el de <body> (CSS lo lleva a toda la ventana, también debajo de
  // un body corto); si ninguno pinta, blanco salvo que la web pida el esquema oscuro, en su CSS o en su
  // <meta name="color-scheme"> (Risco, 21-10: una web con modo oscuro propio salía invertida a clara).
  const scheme = `${style(root).colorScheme} ${doc.querySelector?.('meta[name="color-scheme"]')?.content ?? ''}`;
  const canvas = paint(root) ?? paint(doc.body) ?? (/\bdark\b/.test(scheme) && win.matchMedia(DARK).matches ? 0.02 : 1);
  const width = win.innerWidth, height = win.innerHeight;
  if (!width || !height) return false;
  const points = [[width / 2, height / 2], [width / 2, Math.min(120, height / 4)], [width / 4, height * 0.6], [width * 0.75, height * 0.75]];
  let light = 0;
  for (const [x, y] of points) {
    let element = doc.elementFromPoint(x, y), found = null;
    while (element && !found) {
      if (!SKIP.has(element.localName)) {
        const color = parseColor(style(element).backgroundColor);
        if (color && color.a >= 0.5) found = color.l;
      }
      element = element.parentElement;
    }
    if ((found ?? canvas) > 0.5) light++;
  }
  return light >= 3;
}

const hosts = list => new Set(Array.isArray(list) ? list.map(host => String(host).trim().toLowerCase()).filter(Boolean) : []);

export class KitsuneOscurecerChild extends JSWindowActorChild {
  actorCreated() {
    this.applied = null;
    this.exceptions = null;
    this.recheck = () => this.check();
    this.memory = new WeakMap();
    // Al bajar o pulsar en un documento salen lienzos y diapositivas nuevas: se mira otra vez, como mucho cada 1,5 s.
    this.later = () => {
      if (!this.applied || this.applied === PDF_SHEET || this.waiting) return;
      this.waiting = true;
      this.contentWindow?.setTimeout(() => { this.waiting = false; this.check(); }, 1500);
    };
  }

  didDestroy() {
    this.media?.removeEventListener('change', this.recheck);
    this.media = null;
    for (const type of ['scroll', 'click', 'keyup']) { try { this.contentWindow?.removeEventListener(type, this.later, true); } catch { /* ya no está */ } }
  }

  // Al cambiar la opción, la lista o el tema, el proceso principal avisa (los avisos de preferencias y de sharedData
  // no le llegan a este actor; Risco, 21-10). Se mira otra vez al poco: el tema nuevo puede tardar en llegar a la web.
  receiveMessage(message) {
    if (message.name !== 'KitsuneOscurecer:Recheck') return;
    if (Array.isArray(message.data?.exceptions)) this.exceptions = message.data.exceptions;
    this.check();
    this.contentWindow?.setTimeout(() => this.check(), 300);
  }

  handleEvent(event) {
    if (event.target !== this.document) return;
    if (!this.media) {
      try {
        this.media = this.contentWindow.matchMedia(DARK);
        this.media.addEventListener('change', this.recheck);
      } catch { /* sin ventana: nada que oscurecer */ }
    }
    this.check();
    // Hay webs que ponen su tema (oscuro o claro) un poco después de cargar, y los editores de documentos tardan en
    // pintar sus hojas.
    if (event.type === 'pageshow') {
      for (const ms of [1200, 4000, 10000]) this.contentWindow?.setTimeout(() => this.check(), ms);
      if (!this.listening) {
        this.listening = true;
        for (const type of ['scroll', 'click', 'keyup']) { try { this.contentWindow?.addEventListener(type, this.later, { capture: true, passive: true }); } catch { /* sin ventana */ } }
      }
    }
  }

  wanted() {
    const win = this.contentWindow, doc = this.document;
    if (!win || !doc?.documentElement || doc.mozSyntheticDocument) return null;
    if (!Services.prefs.getBoolPref(ENABLED, false) || !win.matchMedia(DARK).matches) return null;
    let host = '';
    try { host = doc.documentURIObject.host.toLowerCase(); } catch { /* file:// y demás: sin nombre */ }
    if (host && hosts(this.exceptions ?? Services.cpmm.sharedData.get(EXCEPTIONS)).has(host)) return null;
    if (doc.contentType === 'application/pdf') return PDF_SHEET;
    if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(doc.contentType)) return null;
    if (!isLightPage(win)) return null;
    let extra = '';
    try { extra = documentRules(win, this.memory); } catch { extra = ''; }
    return extra ? sheetUri(PAGE_CSS + extra) : PAGE_SHEET;
  }

  check() {
    let next = null;
    try { next = this.wanted(); } catch { next = null; }
    if (next === this.applied) return;
    const utils = this.contentWindow?.windowUtils;
    if (!utils) return;
    try {
      if (this.applied) utils.removeSheetUsingURIString(this.applied, utils.USER_SHEET);
      if (next) utils.loadSheetUsingURIString(next, utils.USER_SHEET);
      this.applied = next;
    } catch { /* la página sigue como estaba */ }
  }
}
