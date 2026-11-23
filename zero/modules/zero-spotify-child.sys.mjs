/* Kitsune Zero · Spotify en Windows, la parte que vive en su web (ver zero-spotify.mjs).
 *
 * Antes de que corra nada de la página, su navigator.requestMediaKeySystemAccess dice que no hay Widevine (en Windows
 * Kitsune no lleva la firma que Spotify le pide, así que para él no lo hay). Lo demás, PlayReady incluido, va al de Gecko
 * tal cual. No lee nada de la página.
 */
import { esWidevine } from './zero-spotify.mjs';

export class KitsuneZeroSpotifyChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type !== 'DOMWindowCreated') return;
    const win = this.contentWindow;
    if (!win?.Navigator) return;
    const proto = Cu.waiveXrays(win).Navigator.prototype;
    const deGecko = proto.requestMediaKeySystemAccess;
    if (typeof deGecko !== 'function') return; // una página sin cifrar: no hay DRM
    Cu.exportFunction(function requestMediaKeySystemAccess(sistema, opciones) {
      if (esWidevine(sistema)) return win.Promise.reject(new win.DOMException('Key system is unsupported', 'NotSupportedError'));
      return deGecko.call(Cu.waiveXrays(this), sistema, opciones);
    }, proto, { defineAs: 'requestMediaKeySystemAccess' });
  }
}
