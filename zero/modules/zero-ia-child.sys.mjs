/* Kitsune Zero · el asistente, la parte que vive en la web (proceso de la web).
 *
 * Solo contesta cuando Kitsune se lo pregunta (pagina_leer, pagina_seleccion): el título, la dirección, el texto
 * visible (recortado) y lo seleccionado. No escucha nada de la página ni le manda nada por su cuenta, y la página
 * no sabe que se ha leído.
 */
const MAXIMO_TEXTO = 200_000;
const MAXIMO_SELECCION = 10_000;

/** El texto como se lee: sin espacios de sobra ni montones de líneas en blanco. */
function limpiar(texto) {
  return String(texto ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class KitsuneZeroIAChild extends JSWindowActorChild {
  seleccion() {
    const win = this.contentWindow, doc = this.document;
    let texto = '';
    try { texto = String(win?.getSelection?.() ?? ''); } catch { /* sin selección */ }
    // Lo seleccionado dentro de un campo de texto no sale en getSelection().
    const activo = doc?.activeElement;
    if (!texto && activo && (activo.localName === 'textarea' || activo.localName === 'input') && typeof activo.selectionStart === 'number') {
      try { texto = String(activo.value ?? '').slice(activo.selectionStart, activo.selectionEnd); } catch { /* sin selección */ }
    }
    return limpiar(texto).slice(0, MAXIMO_SELECCION);
  }

  leer({ maximo = 40_000, soloSeleccion = false } = {}) {
    const doc = this.document;
    if (!doc) return null;
    const base = { titulo: String(doc.title ?? '').slice(0, 1000), direccion: String(doc.URL ?? ''), seleccion: this.seleccion() };
    if (soloSeleccion) return base;
    const tope = Math.min(MAXIMO_TEXTO, Math.max(1000, Number(maximo) || 40_000));
    // innerText: lo que se ve (sin lo oculto con CSS, sin scripts ni estilos).
    const texto = limpiar(doc.body?.innerText ?? doc.documentElement?.textContent ?? '');
    return {
      ...base,
      idioma: String(doc.documentElement?.lang ?? '').slice(0, 35),
      texto: texto.slice(0, tope),
      recortado: texto.length > tope,
      longitud: texto.length,
    };
  }

  receiveMessage(message) {
    if (message.name === 'ZeroIA:leer') return this.leer(message.data ?? {});
    return null;
  }
}
