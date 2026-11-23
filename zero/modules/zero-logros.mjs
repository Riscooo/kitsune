/* Kitsune Zero · los logros, la parte pura (sin Gecko).
 *
 * Risco (23-11): «meter logros, que puede estar guapo eso». Premian lo que sirve (estudiar, descansar con el pomodoro,
 * tomar notas, la constancia), nunca pasar más horas delante de una web. Se calculan con lo que ya cuentan las
 * estadísticas, en este ordenador.
 *
 * Un logro: { id, grado ('bronce' | 'plata' | 'oro'), icono, es/en (nombre), porque/why (qué hay que hacer), meta,
 * valor(medidas) }. Está conseguido cuando el valor llega a la meta, y ya no se pierde.
 */
import { lastDays, categoryOf } from './zero-stats.mjs';

const HORA = 3600;
/** Un día cuenta como de estudio con un cuarto de hora. */
export const DIA_DE_ESTUDIO = 15 * 60;

const l = (id, grado, icono, es, en, porque, why, meta, valor, unidad = '') => Object.freeze({ id, grado, icono, es, en, porque, why, meta, valor, unidad });

export const LOGROS = Object.freeze([
  l('primera-nota', 'bronce', 'nota', 'Primera nota', 'First note', 'Escribe tu primera nota', 'Write your first note', 1, m => m.notas),
  l('cuaderno', 'plata', 'nota', 'Cuaderno', 'Notebook', 'Escribe 25 notas', 'Write 25 notes', 25, m => m.notas),
  l('biblioteca', 'oro', 'nota', 'Biblioteca', 'Library', 'Escribe 100 notas', 'Write 100 notes', 100, m => m.notas),
  l('rotulador', 'bronce', 'rotulador', 'Rotulador', 'Highlighter', 'Subraya algo en una web', 'Highlight something on a page', 1, m => m.subrayados),
  l('fosforito', 'plata', 'rotulador', 'Fosforito', 'Neon', 'Subraya 100 veces', 'Highlight 100 times', 100, m => m.subrayados),
  l('fuentes', 'plata', 'cita', 'Con fuentes', 'Well sourced', 'Lleva 25 citas al bloc', 'Send 25 quotes to your notes', 25, m => m.citas),
  l('primera-hora', 'bronce', 'libro', 'Primera hora', 'First hour', 'Una hora en modo Estudio', 'One hour in Study mode', HORA, m => m.estudio, 'tiempo'),
  l('diez-horas', 'plata', 'libro', 'Con ganas', 'Committed', 'Diez horas en modo Estudio', 'Ten hours in Study mode', 10 * HORA, m => m.estudio, 'tiempo'),
  l('cincuenta-horas', 'oro', 'libro', 'Maestría', 'Mastery', 'Cincuenta horas en modo Estudio', 'Fifty hours in Study mode', 50 * HORA, m => m.estudio, 'tiempo'),
  l('sesion-larga', 'plata', 'libro', 'De una sentada', 'In one go', 'Tres horas de estudio en un día', 'Three study hours in one day', 3 * HORA, m => m.mejorDia, 'tiempo'),
  l('racha-3', 'bronce', 'llama', 'Tres seguidos', 'Three in a row', 'Estudia tres días seguidos', 'Study three days in a row', 3, m => m.rachaMejor),
  l('racha-7', 'plata', 'llama', 'Una semana', 'One week', 'Estudia siete días seguidos', 'Study seven days in a row', 7, m => m.rachaMejor),
  l('racha-30', 'oro', 'llama', 'Un mes', 'One month', 'Estudia treinta días seguidos', 'Study thirty days in a row', 30, m => m.rachaMejor),
  l('pomo-1', 'bronce', 'reloj', 'Primer pomodoro', 'First pomodoro', 'Termina un pomodoro', 'Finish one pomodoro', 1, m => m.pomos),
  l('pomo-25', 'plata', 'reloj', 'Ritmo', 'Rhythm', 'Termina 25 pomodoros', 'Finish 25 pomodoros', 25, m => m.pomos),
  l('pomo-100', 'oro', 'reloj', 'Metrónomo', 'Metronome', 'Termina 100 pomodoros', 'Finish 100 pomodoros', 100, m => m.pomos),
  l('equilibrio', 'bronce', 'balanza', 'Equilibrio', 'Balance', 'Un día con más estudio que redes y vídeo', 'A day with more study than social and video', 1, m => m.equilibrio),
  l('equilibrio-10', 'oro', 'balanza', 'En tu sitio', 'Centred', 'Diez días con más estudio que redes y vídeo', 'Ten days with more study than social and video', 10, m => m.equilibrio),
  l('explorador', 'plata', 'brujula', 'Con curiosidad', 'Curious', 'Visita 100 webs distintas', 'Visit 100 different sites', 100, m => m.sitios),
  l('veterano', 'oro', 'mascara', 'De la casa', 'One of us', 'Cien días con Kitsune Zero', 'A hundred days with Kitsune Zero', 100, m => m.dias),
]);

/** Lo que miran los logros, de los datos de las estadísticas. */
export function medidas(datos, hoy) {
  const total = datos.total ?? {};
  const dias = Object.keys(datos.days).sort();
  const sitios = new Set();
  let mejorDia = 0, equilibrio = 0, rachaMejor = 0, racha = 0, anterior = null;
  for (const dia of dias) {
    const d = datos.days[dia];
    let distrae = 0;
    for (const [site, s] of Object.entries(d.sites ?? {})) { sitios.add(site); if (['social', 'video'].includes(categoryOf(site))) distrae += s; }
    const estudio = d.estudio ?? 0;
    mejorDia = Math.max(mejorDia, estudio);
    if (estudio < DIA_DE_ESTUDIO) continue;
    if (estudio > distrae) equilibrio++;
    racha = anterior && lastDays(dia, 2)[0] === anterior ? racha + 1 : 1;
    anterior = dia;
    rachaMejor = Math.max(rachaMejor, racha);
  }
  // La de ahora: sigue viva si el último día de estudio es hoy o ayer.
  const [ayer] = lastDays(hoy, 2);
  return {
    notas: total.notas ?? 0, subrayados: total.subrayados ?? 0, citas: total.citas ?? 0, pomos: total.pomos ?? 0, estudio: total.estudio ?? 0,
    mejorDia, equilibrio, rachaMejor, racha: anterior === hoy || anterior === ayer ? racha : 0, sitios: sitios.size, dias: dias.length,
  };
}

/** Cada logro con lo que lleva: { ...logro, lleva, parte (0 a 1), dia (cuándo se consiguió) | null }. */
export function estado(datos, hoy) {
  const m = medidas(datos, hoy);
  return LOGROS.map(logro => {
    const lleva = Math.max(0, logro.valor(m) || 0), dia = datos.logros?.[logro.id] ?? null;
    return { ...logro, lleva, parte: dia ? 1 : Math.min(1, lleva / logro.meta), dia };
  });
}

/** Los que se acaban de conseguir (y se apuntan con el día de hoy). La primera vez que se miran, los que ya estaban hechos
 *  se apuntan sin avisar de todos de golpe. */
export function nuevos(datos, hoy) {
  const primera = !datos.logros;
  datos.logros ??= {};
  const hechos = estado(datos, hoy).filter(logro => !logro.dia && logro.lleva >= logro.meta);
  for (const logro of hechos) datos.logros[logro.id] = hoy;
  return primera ? [] : hechos;
}
