/* Kitsune Zero · el volumen de Kitsune, la parte que vive en la web (proceso de la web).
 *
 * Solo toca el volumen de los <audio> y <video> de la página: lo multiplica por el de Kitsune (0 a 1, en
 * sharedData) y respeta el que ponga la propia web (si la web lo cambia, ese pasa a ser su nivel). No lee
 * nada de la página ni le manda nada a Kitsune.
 */
const KEY = 'kitsune-zero-volume';

export class KitsuneZeroAudioChild extends JSWindowActorChild {
  constructor() {
    super();
    this.levels = new WeakMap(); // elemento → el volumen que quiere la web
  }

  scale() {
    const value = Number(Services.cpmm.sharedData.get(KEY));
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  }

  apply(media) {
    const scale = this.scale();
    if (!this.levels.has(media)) this.levels.set(media, media.volume);
    const wanted = Math.min(1, Math.max(0, this.levels.get(media) * scale));
    if (Math.abs(media.volume - wanted) > 0.001) media.volume = wanted;
  }

  applyAll() {
    for (const media of this.document?.querySelectorAll('audio, video') ?? []) this.apply(media);
  }

  // «play» (al empezar a sonar) y «volumechange» (la web cambia su volumen): los registra zero-audio.
  handleEvent(event) {
    const media = event.target;
    if (!(media instanceof this.contentWindow.HTMLMediaElement)) return;
    if (event.type === 'volumechange') {
      // Si no es el que pusimos, lo ha cambiado la web: lo que ha puesto es lo que quiere (su nivel), y
      // encima va el de Kitsune.
      const known = this.levels.get(media);
      if (known === undefined || Math.abs(media.volume - known * this.scale()) <= 0.001) return;
      this.levels.set(media, media.volume);
    }
    this.apply(media);
  }

  receiveMessage(message) {
    if (message.name === 'ZeroAudio:apply') this.applyAll();
    return null;
  }
}
