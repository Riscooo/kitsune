/* Kitsune Zero · las reglas del silencio (puras, sin Gecko: se prueban con Node). */

/** La lista de webs vetadas, limpia: dominios en minúsculas, sin «www.», sin esquema ni ruta. */
export function parseHosts(text) {
  const seen = new Set();
  for (const raw of String(text ?? '').split(/[\s,;]+/)) {
    const host = raw.trim().toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/[/?#].*$/, '')
      .replace(/:\d+$/, '')
      .replace(/^www\./, '')
      .replace(/\.$/, '');
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) seen.add(host);
  }
  return [...seen];
}

/** El dominio de la lista que casa con esta web (ella o un subdominio suyo), o null. */
export function blockedHost(host, list) {
  const clean = String(host ?? '').toLowerCase().replace(/^www\./, '');
  if (!clean) return null;
  return list.find(domain => clean === domain || clean.endsWith(`.${domain}`)) ?? null;
}

/** ¿Es «durante el trabajo»? Con el pomodoro, mientras corre un trabajo; sin él, siempre (Zero ya es
 *  modo trabajo). */
export function working({ pomodoroOn, phase, running }) {
  if (!pomodoroOn) return true;
  return phase === 'work' && !!running;
}

/** Cuánto llevas bajando en una página: suma el tiempo entre avisos de scroll seguidos (una pausa de
 *  más de `gap` no cuenta) y avisa al pasar de `limit`; después vuelve a contar. */
export class ScrollWatch {
  constructor({ limit = 10 * 60_000, gap = 5_000 } = {}) {
    this.limit = limit;
    this.gap = gap;
    this.page = null;
    this.total = 0;
    this.last = null;
  }

  /** Un aviso de scroll en `page` a la hora `now`: true si toca avisar. */
  scrolled(page, now) {
    if (page !== this.page) { this.page = page; this.total = 0; this.last = null; }
    if (this.last !== null && now - this.last <= this.gap) this.total += now - this.last;
    this.last = now;
    if (this.total < this.limit) return false;
    this.total = 0;
    return true;
  }

  minutes(page) {
    return page === this.page ? Math.floor(this.total / 60_000) : 0;
  }
}
