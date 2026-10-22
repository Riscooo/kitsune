/* Kitsune Zero · la DRM en el panel de la música, la parte que vive en la web (proceso de la web).
 *
 * Cuando una web pide la DRM (Spotify, Widevine), Gecko lo avisa en su proceso con «mediakeys-request» y su
 * propio actor saca la barra «Activar DRM»… solo en las pestañas. Esto le pasa a Kitsune lo mismo que a Gecko
 * (en qué ha quedado: apagada, instalándose, lista), y zero-music saca la barra en el panel. No lee nada de la
 * página.
 */
export class KitsuneZeroDrmChild extends JSWindowActorChild {
  // «mediakeys-request» (lo registra zero-music).
  observe(subject, topic, data) {
    let status = null;
    try { ({ status } = JSON.parse(data)); } catch { return; }
    if (typeof status === 'string') this.sendAsyncMessage('ZeroDrm:status', { status });
  }
}
