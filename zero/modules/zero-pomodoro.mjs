/* Kitsune Zero · el reloj del pomodoro (puro, sin Gecko: se prueba con Node).
 *
 * El estado que se guarda es pequeño: la fase (idle, work, short, long, waiting), el ciclo (qué
 * trabajo de los cuatro), cuándo empezó la fase si va corriendo y cuánto quedaba si está en pausa.
 * Lo demás se calcula: view() dice qué toca en cada instante, y pasa sola de trabajo a descanso y de
 * descanso a «waiting» (nada arranca solo después de un descanso: espera un clic).
 */
const MIN = 60_000;

export const PRESETS = Object.freeze({
  '25': Object.freeze({ work: 25, short: 5, long: 15, every: 4 }),
  '50': Object.freeze({ work: 50, short: 10, long: 30, every: 4 }),
  '90': Object.freeze({ work: 90, short: 15, long: 45, every: 4 }),
});

const RUNNING = new Set(['work', 'short', 'long']);
const PHASES = new Set(['idle', 'waiting', ...RUNNING]);

export const initial = () => ({ phase: 'idle', cycle: 1, startedAt: null, pausedLeft: null });

const duration = (phase, preset) => (phase === 'short' ? preset.short : phase === 'long' ? preset.long : preset.work) * MIN;
const number = value => typeof value === 'number' && Number.isFinite(value);

/** Un estado guardado que no se entiende vuelve a empezar. */
function sane(state) {
  if (!state || typeof state !== 'object' || !PHASES.has(state.phase)) return initial();
  const cycle = Number.isInteger(state.cycle) && state.cycle >= 1 ? state.cycle : 1;
  if (!RUNNING.has(state.phase)) return { phase: state.phase, cycle, startedAt: null, pausedLeft: null };
  if (number(state.pausedLeft)) return { phase: state.phase, cycle, startedAt: null, pausedLeft: Math.max(0, state.pausedLeft) };
  if (number(state.startedAt)) return { phase: state.phase, cycle, startedAt: state.startedAt, pausedLeft: null };
  return initial();
}

/** El estado al día: las fases que ya han acabado, pasadas. */
export function normalize(state, preset, now) {
  let s = sane(state);
  while (RUNNING.has(s.phase) && s.startedAt !== null) {
    const end = s.startedAt + duration(s.phase, preset);
    if (now < end) break;
    s = s.phase === 'work'
      ? { phase: s.cycle % preset.every === 0 ? 'long' : 'short', cycle: s.cycle, startedAt: end, pausedLeft: null }
      : { phase: 'waiting', cycle: s.phase === 'long' ? 1 : s.cycle + 1, startedAt: null, pausedLeft: null };
  }
  return s;
}

export function view(state, preset, now) {
  const s = normalize(state, preset, now);
  const running = RUNNING.has(s.phase) && s.startedAt !== null;
  const total = duration(s.phase, preset);
  const left = running ? Math.max(0, s.startedAt + total - now) : s.pausedLeft ?? total;
  return { phase: s.phase, running, left, total, cycle: s.cycle, every: preset.every, ending: s.phase === 'work' && running && left <= MIN };
}

export function start(state, preset, now) {
  const s = normalize(state, preset, now);
  if (s.phase !== 'idle' && s.phase !== 'waiting') return s;
  return { phase: 'work', cycle: s.cycle, startedAt: now, pausedLeft: null };
}

export function pause(state, preset, now) {
  const s = normalize(state, preset, now);
  if (!RUNNING.has(s.phase) || s.startedAt === null) return s;
  return { ...s, startedAt: null, pausedLeft: view(s, preset, now).left };
}

export function resume(state, preset, now) {
  const s = normalize(state, preset, now);
  if (!RUNNING.has(s.phase) || s.pausedLeft === null) return s;
  return { ...s, startedAt: now - (duration(s.phase, preset) - s.pausedLeft), pausedLeft: null };
}

/** A la fase siguiente: del trabajo al descanso, del descanso a esperar, y de esperar a trabajar. */
export function skip(state, preset, now) {
  const s = normalize(state, preset, now);
  if (s.phase === 'work') return { phase: s.cycle % preset.every === 0 ? 'long' : 'short', cycle: s.cycle, startedAt: now, pausedLeft: null };
  if (s.phase === 'short' || s.phase === 'long') return { phase: 'waiting', cycle: s.phase === 'long' ? 1 : s.cycle + 1, startedAt: null, pausedLeft: null };
  return start(s, preset, now);
}

export const reset = () => initial();

/** El clic en el anillo: empezar, pausar o seguir, según toque. */
export function toggle(state, preset, now) {
  const s = normalize(state, preset, now);
  if (s.phase === 'idle' || s.phase === 'waiting') return start(s, preset, now);
  return s.startedAt !== null ? pause(s, preset, now) : resume(s, preset, now);
}
