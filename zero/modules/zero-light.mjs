/* Kitsune Zero · la luz de lo que hay detrás de un cristal (puro, sin Gecko: se prueba con Node).
 *
 * El cristal mira la foto de lo que tiene debajo y elige el color del texto: tinta sobre lo claro,
 * blanco sobre lo oscuro. La luz es la luma media (pesos de Rec. 709 sobre los valores sRGB, sin
 * linealizar: así 0,5 cae donde tinta y blanco contrastan igual), sin contar lo transparente.
 */

/** Luz media de unos píxeles RGBA, de 0 (negro) a 1 (blanco); null si no hay nada opaco. */
export function lightOf(bytes) {
  let sum = 0, count = 0;
  for (let i = 0; i + 3 < (bytes?.length ?? 0); i += 4) {
    if (bytes[i + 3] < 128) continue;
    sum += 0.2126 * bytes[i] + 0.7152 * bytes[i + 1] + 0.0722 * bytes[i + 2];
    count += 1;
  }
  // Redondeada: los pesos suman 0,999… en coma flotante, y el blanco tiene que dar 1.
  return count ? Math.round(sum / count / 255 * 1e6) / 1e6 : null;
}

/** Tinta o blanco, con histéresis para que no parpadee en el límite: tinta por encima de 0,62,
 *  blanco por debajo de 0,52 y, entre medias (o sin luz), lo que hubiera. */
export function inkFor(light, previous = 'white') {
  if (light === null || light === undefined) return previous;
  if (light > 0.62) return 'ink';
  if (light < 0.52) return 'white';
  return previous;
}
