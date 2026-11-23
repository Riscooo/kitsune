/* Kitsune Zero · el reparto, la parte pura (sin Gecko): cómo se colocan la web, el bloc y el asistente en la ventana.
 *
 * Risco (23-11): «cuando tengas la ia y el block de notas y una página abierta, quiero que todo se reagrupe de la mejor
 * manera para que todo esté bien organizado». Manda la web: los paneles cogen su sitio a un lado y, entre los dos,
 * - en una ventana ancha, dos columnas (la del bloc, pegada a la web: se lee y se escribe sin cruzar la pantalla);
 * - en una normal, una sola columna con el bloc arriba y el asistente abajo, y una línea entre los dos para repartirla;
 * - en una baja, uno cada vez (el último que se abrió);
 * - cada uno en su lado, si se han puesto en lados distintos;
 * - en una estrecha, flotan encima: la web no se queda en una tira.
 */
export const HUECO = 10;
export const MARCO = Object.freeze({ arriba: 46, abajo: 26, izq: 50, der: 10, web: 26 });
/** Lo que necesita la web para no estropearse, y para que quepan dos columnas a su lado sin que se note. */
export const WEB = Object.freeze({ minima: 460, comoda: 1120 });
export const PANEL = Object.freeze({ minAncho: 300, minAlto: 250 });

const entre = (v, min, max) => Math.max(min, Math.min(max, v));
const numero = (v, otro) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : otro);

/** Dónde va cada cosa. `ia` y `notas` son null si están cerrados; `orden` dice cuál se abrió el último. */
export function repartir({ ancho, alto, ia = null, notas = null, parte = 0.56, ultimo = 'notas' }) {
  const tope = Math.max(PANEL.minAncho, Math.round(ancho * 0.7));
  const anchoDe = p => entre(Math.round(numero(p.ancho, 380)), PANEL.minAncho, tope);
  const libre = ancho - MARCO.izq - MARCO.web;       // lo que tiene la web sin paneles
  const altura = alto - MARCO.arriba - MARCO.abajo;  // lo que mide una columna entera
  const lado = p => (p?.lado === 'izq' ? 'izq' : 'der');
  const out = { forma: 'web', web: { izq: 0, der: 0 }, ia: null, notas: null, linea: null };
  const columna = (p, a, { fuera = 0, arriba = MARCO.arriba, abajo = MARCO.abajo } = {}) => ({
    ancho: a, arriba, abajo, izq: lado(p) === 'izq' ? MARCO.izq + fuera : null, der: lado(p) === 'der' ? MARCO.der + fuera : null, flota: false, oculto: false,
  });
  const cabe = extra => libre - extra >= WEB.minima;

  const iaEnColumna = ia && ia.forma !== 'esquina' && ia.forma !== 'pestana';
  if (notas && iaEnColumna) {
    const an = anchoDe(notas), ai = anchoDe(ia);
    if (lado(notas) !== lado(ia)) {
      out.forma = 'lados';
      out.notas = columna(notas, an); out.ia = columna(ia, ai);
      if (cabe(an + ai + 2 * HUECO)) { out.web[lado(notas)] = an + HUECO; out.web[lado(ia)] = ai + HUECO; }
      else {
        // No caben los dos: el último empuja a la web si puede, y el otro flota.
        const primero = ultimo === 'ia' ? ['ia', ai, ia] : ['notas', an, notas];
        out[primero[0] === 'ia' ? 'notas' : 'ia'].flota = true;
        if (cabe(primero[1] + HUECO)) out.web[lado(primero[2])] = primero[1] + HUECO; else out[primero[0]].flota = true;
      }
      return out;
    }
    const l = lado(notas), dos = an + ai + 2 * HUECO;
    if (libre - dos >= WEB.comoda) {
      out.forma = 'columnas';
      out.ia = columna(ia, ai); out.notas = columna(notas, an, { fuera: ai + HUECO });
      out.web[l] = dos;
      return out;
    }
    const a = Math.max(an, ai);
    if (altura >= 2 * PANEL.minAlto + HUECO) {
      out.forma = 'pila';
      const alturaNotas = entre(Math.round((altura - HUECO) * entre(Number(parte) || 0.56, 0.2, 0.8)), PANEL.minAlto, altura - HUECO - PANEL.minAlto);
      out.notas = columna(notas, a, { abajo: alto - MARCO.arriba - alturaNotas });
      out.ia = columna(ia, a, { arriba: MARCO.arriba + alturaNotas + HUECO });
      out.linea = { ancho: a, arriba: MARCO.arriba + alturaNotas, izq: out.notas.izq, der: out.notas.der };
    } else {
      out.forma = 'turnos';
      out.notas = columna(notas, a); out.ia = columna(ia, a);
      out[ultimo === 'ia' ? 'notas' : 'ia'].oculto = true;
    }
    if (cabe(a + HUECO)) out.web[l] = a + HUECO;
    else { out.notas.flota = true; out.ia.flota = true; }
    return out;
  }

  if (notas) {
    const a = anchoDe(notas);
    out.forma = 'notas';
    out.notas = columna(notas, a);
    if (cabe(a + HUECO)) out.web[lado(notas)] = a + HUECO; else out.notas.flota = true;
  }
  if (ia) {
    const a = anchoDe(ia);
    if (ia.forma === 'esquina') {
      const junto = out.notas && !out.notas.flota && lado(notas) === lado(ia) ? out.notas.ancho + HUECO : 0;
      out.forma = out.notas ? 'notas' : 'web';
      out.ia = { ancho: a, alto: entre(Math.round(numero(ia.alto, 520)), 260, Math.max(260, alto - 2 * HUECO)), abajo: MARCO.web,
        izq: lado(ia) === 'izq' ? MARCO.izq + HUECO + junto : null, der: lado(ia) === 'der' ? MARCO.web + junto : null, flota: true, oculto: false };
    } else if (ia.forma === 'pestana') {
      out.ia = { ancho: null, arriba: MARCO.arriba, abajo: MARCO.abajo, izq: MARCO.izq + out.web.izq, der: MARCO.web + out.web.der, flota: true, oculto: false };
    } else {
      out.forma = 'ia';
      out.ia = columna(ia, a);
      if (cabe(a + HUECO)) out.web[lado(ia)] = a + HUECO; else out.ia.flota = true;
    }
  }
  return out;
}

/** La parte de la columna que se queda el bloc si la línea se lleva a `y` (px desde arriba de la ventana). */
export function parteEn(y, alto) {
  const altura = alto - MARCO.arriba - MARCO.abajo - HUECO;
  return Math.round(entre((y - MARCO.arriba) / Math.max(1, altura), 0.2, 0.8) * 1000) / 1000;
}
