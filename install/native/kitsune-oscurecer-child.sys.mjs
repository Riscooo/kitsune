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
const EXCEPTIONS = 'kitsune.oscurecer.excepciones';
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
  // El lienzo, si nada pinta encima: blanco salvo que la web pida el esquema oscuro.
  const canvas = /\bdark\b/.test(style(root).colorScheme) && win.matchMedia(DARK).matches ? 0.02 : 1;
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

const hosts = () => new Set(Services.prefs.getStringPref(EXCEPTIONS, '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean));

export class KitsuneOscurecerChild extends JSWindowActorChild {
  actorCreated() {
    this.applied = null;
    Services.prefs.addObserver(ENABLED, this);
    Services.prefs.addObserver(EXCEPTIONS, this);
  }

  didDestroy() {
    Services.prefs.removeObserver(ENABLED, this);
    Services.prefs.removeObserver(EXCEPTIONS, this);
    this.media?.removeEventListener('change', this);
    this.media = null;
  }

  // Al cambiar la opción, la lista de webs o el tema, las páginas abiertas se ponen al día.
  observe() { this.check(); }

  handleEvent(event) {
    if (event.type === 'change') { this.check(); return; }
    if (event.target !== this.document) return;
    if (!this.media) {
      try {
        this.media = this.contentWindow.matchMedia(DARK);
        this.media.addEventListener('change', this);
      } catch { /* sin ventana: nada que oscurecer */ }
    }
    this.check();
    // Hay webs que ponen su tema (oscuro o claro) un poco después de cargar.
    if (event.type === 'pageshow') this.contentWindow?.setTimeout(() => this.check(), 1200);
  }

  wanted() {
    const win = this.contentWindow, doc = this.document;
    if (!win || !doc?.documentElement || doc.mozSyntheticDocument) return null;
    if (!Services.prefs.getBoolPref(ENABLED, false) || !win.matchMedia(DARK).matches) return null;
    let host = '';
    try { host = doc.documentURIObject.host.toLowerCase(); } catch { /* file:// y demás: sin nombre */ }
    if (host && hosts().has(host)) return null;
    if (doc.contentType === 'application/pdf') return PDF_SHEET;
    if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(doc.contentType)) return null;
    return isLightPage(win) ? PAGE_SHEET : null;
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
