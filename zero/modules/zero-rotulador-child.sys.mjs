/* Kitsune Zero · el rotulador, la parte que vive en la web.
 *
 * Avisa de que hay algo seleccionado (dónde está en la pantalla, nada más; el texto solo se lee cuando la persona pulsa
 * algo), pinta los subrayados que le da Kitsune con la API de resaltado de CSS (sin tocar el DOM de la página) y, si la
 * página cambia por dentro, los vuelve a buscar. No guarda nada: los subrayados viven cifrados en el perfil.
 */
import { ancla, encontrar, COLORES } from './zero-notas.mjs';

const HOJA = 'data:text/css,' + encodeURIComponent(
  '::highlight(kitsune-zero-amarillo){background-color:#ffe066!important;color:#1d2321!important}' +
  '::highlight(kitsune-zero-verde){background-color:#a8e6a1!important;color:#1d2321!important}' +
  '::highlight(kitsune-zero-rosa){background-color:#ffc2d9!important;color:#1d2321!important}');
const FUERA = new Set(['script', 'style', 'noscript', 'textarea', 'template']);
const MAXIMO = 20_000;
const REPASO = 900;

export class KitsuneZeroNotasChild extends JSWindowActorChild {
  constructor() {
    super();
    this.lista = [];            // los subrayados de esta página: { id, color, exacto, … }
    this.rangos = new Map();    // id → Range
    this.avisado = false;
  }

  // ------------------------------------------------------------ el texto de la página

  /** Todo el texto, de un tirón, y dónde empieza cada nodo. */
  indice() {
    const doc = this.document, nodos = [];
    let texto = '';
    if (!doc?.body) return { texto, nodos };
    const paseo = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
    for (let n = paseo.nextNode(); n; n = paseo.nextNode()) {
      if (FUERA.has(n.parentNode?.localName)) continue;
      nodos.push({ n, en: texto.length });
      texto += n.data;
    }
    return { texto, nodos };
  }

  rango({ nodos }, inicio, fin) {
    const sitio = (pos, cierra) => {
      // El último nodo que empieza antes (o justo en) la posición.
      let a = 0, b = nodos.length - 1, en = -1;
      while (a <= b) { const m = (a + b) >> 1; if (cierra ? nodos[m].en < pos : nodos[m].en <= pos) { en = m; a = m + 1; } else b = m - 1; }
      return en < 0 ? null : [nodos[en].n, Math.min(pos - nodos[en].en, nodos[en].n.length)];
    };
    const de = sitio(inicio, false), hasta = sitio(fin, true);
    if (!de || !hasta) return null;
    const r = this.document.createRange();
    r.setStart(...de);
    r.setEnd(...hasta);
    return r;
  }

  /** Lo seleccionado, como posiciones en el texto. */
  posiciones(sel, { nodos }) {
    const r = sel.getRangeAt(0);
    let inicio = -1, fin = -1;
    for (const { n, en } of nodos) {
      if (!r.intersectsNode(n)) continue;
      const de = n === r.startContainer ? r.startOffset : 0, hasta = n === r.endContainer ? r.endOffset : n.length;
      if (hasta <= de) continue;
      if (inicio < 0) inicio = en + de;
      fin = en + hasta;
    }
    return inicio < 0 ? null : [inicio, fin];
  }

  seleccion() {
    const sel = this.contentWindow?.getSelection?.();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const activo = this.document.activeElement;
    if (activo?.isContentEditable || ['input', 'textarea'].includes(activo?.localName)) return null;
    return sel;
  }

  donde(rect) {
    // En píxeles de la pantalla (también dentro de un marco de otro proceso).
    const r = this.contentWindow.windowUtils.toScreenRect(rect.x, rect.y, rect.width, rect.height);
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }

  // ------------------------------------------------------------ pintar

  pintar() {
    const win = this.contentWindow;
    if (!win?.CSS?.highlights) return;
    if (!this.hoja) {
      try { win.windowUtils.loadSheetUsingURIString(HOJA, win.windowUtils.USER_SHEET); } catch { /* ya estaba */ }
      this.hoja = true;
    }
    for (const color of COLORES) {
      const rangos = this.lista.filter(s => s.color === color).map(s => this.rangos.get(s.id)).filter(Boolean);
      const nombre = `kitsune-zero-${color}`;
      if (rangos.length) win.CSS.highlights.set(nombre, new win.Highlight(...rangos)); else win.CSS.highlights.delete(nombre);
    }
  }

  /** Busca en la página los que aún no tienen sitio (o lo han perdido). */
  colocar() {
    const faltan = this.lista.filter(s => { const r = this.rangos.get(s.id); return !r || r.collapsed || !r.startContainer.isConnected; });
    if (faltan.length) {
      const indice = this.indice();
      for (const s of faltan) {
        const en = encontrar(indice.texto, s), r = en && this.rango(indice, ...en);
        if (r) this.rangos.set(s.id, r); else this.rangos.delete(s.id);
      }
    }
    this.pintar();
  }

  vigilar() {
    if (this.mira || !this.lista.length || !this.document?.body) return;
    const win = this.contentWindow;
    this.mira = new win.MutationObserver(() => {
      if (this.repaso) return;
      this.repaso = win.setTimeout(() => { this.repaso = 0; try { this.colocar(); } catch { /* la página se fue */ } }, REPASO);
    });
    this.mira.observe(this.document.body, { childList: true, subtree: true, characterData: true });
  }

  // ------------------------------------------------------------ lo que pasa en la página

  handleEvent(event) {
    try {
      switch (event.type) {
        case 'mouseup': case 'keyup': {
          if (event.type === 'keyup' && !event.shiftKey && event.key !== 'Shift') return;
          if (event.button > 0) return;
          this.contentWindow.setTimeout(() => {
            const sel = this.contentWindow && this.seleccion();
            if (!sel || String(sel).trim().length < 2) return;
            this.avisado = true;
            this.sendAsyncMessage('ZeroNotas:seleccion', this.donde(sel.getRangeAt(0).getBoundingClientRect()));
          }, 0);
          break;
        }
        case 'mousedown': case 'scroll':
          if (this.avisado) { this.avisado = false; this.sendAsyncMessage('ZeroNotas:nada'); }
          break;
        case 'click': {
          if (!this.rangos.size || !this.contentWindow.getSelection().isCollapsed) return;
          const en = this.document.caretPositionFromPoint(event.clientX, event.clientY);
          if (!en) return;
          for (const [id, r] of this.rangos) {
            if (!r.isPointInRange(en.offsetNode, en.offset)) continue;
            const rect = [...r.getClientRects()].find(c => event.clientX >= c.left - 2 && event.clientX <= c.right + 2 && event.clientY >= c.top - 2 && event.clientY <= c.bottom + 2);
            if (!rect) continue;
            this.avisado = true;
            this.sendAsyncMessage('ZeroNotas:pulsado', { id, ...this.donde(rect) });
            return;
          }
          break;
        }
        case 'DOMContentLoaded': case 'pageshow':
          this.sendAsyncMessage('ZeroNotas:lista');
          break;
      }
    } catch { /* la página se está yendo */ }
  }

  receiveMessage({ name, data }) {
    switch (name) {
      case 'ZeroNotas:texto': {
        const sel = this.seleccion();
        return sel ? String(sel).trim().slice(0, MAXIMO) : '';
      }
      case 'ZeroNotas:marcar': {
        const sel = this.seleccion();
        if (!sel || !COLORES.includes(data.color)) return null;
        const indice = this.indice(), en = this.posiciones(sel, indice);
        if (!en || en[1] - en[0] > MAXIMO || !indice.texto.slice(...en).trim()) return null;
        const s = { id: data.id, color: data.color, ...ancla(indice.texto, ...en) };
        this.lista.push(s);
        this.rangos.set(s.id, this.rango(indice, ...en));
        this.pintar();
        this.vigilar();
        sel.removeAllRanges();
        return s;
      }
      case 'ZeroNotas:pintar':
        this.lista = Array.isArray(data) ? data : [];
        this.rangos.clear();
        if (this.lista.length || this.hoja) this.colocar();
        this.vigilar();
        return null;
      case 'ZeroNotas:quitar':
        this.lista = this.lista.filter(s => s.id !== data.id);
        this.rangos.delete(data.id);
        this.pintar();
        return null;
      case 'ZeroNotas:ir': {
        const r = this.rangos.get(data.id);
        r?.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return !!r;
      }
    }
    return null;
  }
}
