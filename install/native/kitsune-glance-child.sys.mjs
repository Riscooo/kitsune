/* Vista rápida (proceso de la web): Alt+clic izquierdo en un enlace http(s), sin otras
 * teclas, se lo pide a la ventana en vez de navegar. Nada más: no lee la página ni envía
 * otra cosa que la dirección del enlace. Se apaga con kitsune.glance.enabled. */
export class KitsuneGlanceChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type !== 'click' || !event.isTrusted || event.button !== 0 || !event.altKey ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
    if (!Services.prefs.getBoolPref('kitsune.glance.enabled', true)) return;
    const link = event.composedPath().find(node => (node.localName === 'a' || node.localName === 'area') && node.href);
    if (!link) return;
    let url;
    try { url = new URL(link.href); } catch { return; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.sendAsyncMessage('Glance:Open', { url: url.href });
  }
}
