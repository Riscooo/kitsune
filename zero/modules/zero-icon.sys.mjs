/* Kitsune Zero · cómo es un favicon: claro u oscuro.
 *
 * Con el sistema en oscuro, muchas webs (GitHub…) pintan su favicon claro sobre transparente: sobre un
 * fondo claro (los círculos del raíl, la isla en tinta) no se vería. Lo usan el raíl y la isla.
 */
/** ¿Es un icono claro sobre transparente? Se mira tal como se pinta (16 × 16): claro si lo opaco es
 *  casi blanco y no llena el cuadro (un icono con su propio fondo, como la W de Wikipedia, no cuenta).
 *  null si no se puede leer (una imagen de otro origen). */
export function lightIcon(doc, img) {
  try {
    const canvas = doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
    canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16).data;
    let light = 0, opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 100) continue;
      opaque++;
      light += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    return opaque > 0 && opaque < 0.85 * 256 && light / opaque > 200;
  } catch { return null; }
}
