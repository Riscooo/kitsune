/* Kitsune Zero · cristal en vivo, la parte que vive en la web (proceso de la web).
 *
 * Solo cuenta dónde está el scroll de la página: con eso, el cristal fotografía únicamente el trozo
 * que tiene debajo (drawSnapshot mide desde el principio del documento) y, entre foto y foto, la
 * desplaza con el scroll a cada fotograma. No lee nada más de la página.
 */
export class KitsuneZeroGlassChild extends JSWindowActorChild {
  where() {
    const win = this.contentWindow;
    return win ? { x: win.scrollX, y: win.scrollY } : null;
  }

  // «scroll» y «pageshow» (los registra zero-glass.sys.mjs): se dice dónde está la vista.
  handleEvent() {
    const at = this.where();
    if (at) this.sendAsyncMessage('ZeroGlass:scroll', at);
  }

  receiveMessage(message) {
    if (message.name === 'ZeroGlass:where') return this.where();
    return null;
  }
}
