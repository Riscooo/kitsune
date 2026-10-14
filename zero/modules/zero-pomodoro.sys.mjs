/* Kitsune Zero · el pomodoro: el anillo, los avisos y los descansos.
 *
 * Opcional y apagado de serie (ajuste «pomodoro»): apagado no sale nada, ni el anillo ni sus filas en
 * los ajustes (solo el interruptor). El reloj (zero-pomodoro.mjs) se guarda en un ajuste del
 * anfitrión: es uno para todas las ventanas y sobrevive a reinicios; cada ventana en Zero lo mira una
 * vez por segundo.
 *
 * - El anillo, arriba a la derecha en el marco: se vacía mientras corre y respira el último minuto. Al
 *   pasar el ratón se abre con el tiempo («18:42 · Trabajo 2 de 4») y los botones de saltar y
 *   reiniciar. Un clic empieza, pausa o sigue. Con la web ampliada se guarda en la esquina (el tirador
 *   hace de barra de progreso) y sale con los demás botones al acercarse.
 * - Al acabar el trabajo, la isla avisa. Con el descanso estricto, además, un cristal tapa las webs
 *   (no las piezas de Zero) con una guía (respirar o estirar) y «Mantén para saltar».
 * - Al acabar el descanso, la isla pregunta «¿Seguimos?» y el anillo espera: nada arranca solo.
 */
import { PRESETS, view, normalize, toggle, skip, reset } from './zero-pomodoro.mjs';
import { prefName, PREFS } from './zero-config.sys.mjs';
import { GlassPane } from './zero-glass.sys.mjs';

/** De dónde sale la hora (las pruebas la adelantan). */
export const clock = { now: () => Date.now() };

const HTML = 'http://www.w3.org/1999/xhtml';
const HOLD = 1500;              // ms manteniendo «Saltar» para saltar el descanso
const BREATH = { in: 4000, out: 6000 };
const state = new WeakMap();    // ventana → { … }

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};

const clockText = ms => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- los ajustes

function prefs(host) {
  const name = key => prefName(host.prefix, PREFS[key]);
  const bool = key => { try { return host.prefs.getBoolPref(name(key), false); } catch { return false; } };
  const text = (key, fallback) => { try { return host.prefs.getStringPref(name(key), fallback); } catch { return fallback; } };
  return {
    name,
    on: () => bool('pomodoro'),
    preset: () => PRESETS[text('pomodoroPreset', '25')] ?? PRESETS['25'],
    presetKey: () => (PRESETS[text('pomodoroPreset', '25')] ? text('pomodoroPreset', '25') : '25'),
    strict: () => text('pomodoroBreak', 'soft') === 'strict',
    guide: () => text('pomodoroGuide', 'breathe'),
    saved: () => { try { return JSON.parse(text('pomodoroState', '') || 'null'); } catch { return null; } },
    save: value => host.prefs.setStringPref(name('pomodoroState'), JSON.stringify(value)),
  };
}

function section(win, host) {
  const p = prefs(host);
  const t = host.t;
  const watch = keys => fn => {
    const observer = { observe: () => fn() };
    for (const key of keys) host.prefs.addObserver(p.name(key), observer);
    return () => { for (const key of keys) host.prefs.removeObserver(p.name(key), observer); };
  };
  const segment = (key, label, options, detail) => ({
    kind: 'segment', id: PREFS[key], label, detail, options,
    get: () => { try { return host.prefs.getStringPref(p.name(key), options[0].value); } catch { return options[0].value; } },
    set: value => host.prefs.setStringPref(p.name(key), value),
    watch: watch([key]),
    when: p.on,
  });
  return {
    id: 'pomodoro',
    watch: watch(['pomodoro']),
    rows: [
      {
        kind: 'switch', id: PREFS.pomodoro, label: t('Pomodoro', 'Pomodoro'),
        detail: t('Un anillo con tu tiempo de trabajo y de descanso', 'A ring with your work and break time'),
        get: p.on, set: value => host.prefs.setBoolPref(p.name('pomodoro'), value), watch: watch(['pomodoro']),
      },
      segment('pomodoroPreset', t('Tiempos', 'Times'), [
        { value: '25', label: '25 · 5' }, { value: '50', label: '50 · 10' }, { value: '90', label: '90 · 15' },
      ], t('Trabajo · descanso; cada cuatro, uno largo', 'Work · break; a long one every four')),
      segment('pomodoroBreak', t('Descanso', 'Break'), [
        { value: 'soft', label: t('Suave', 'Gentle') }, { value: 'strict', label: t('Estricto', 'Strict') },
      ], t('Estricto: un cristal tapa las webs', 'Strict: glass covers the pages')),
      segment('pomodoroGuide', t('Guía', 'Guide'), [
        { value: 'breathe', label: t('Respirar', 'Breathe') }, { value: 'stretch', label: t('Estirar', 'Stretch') },
        { value: 'alternate', label: t('Alternar', 'Alternate') },
      ], t('En el descanso estricto', 'In the strict break')),
    ],
  };
}

// ---------------------------------------------------------------- las guías del descanso

const STRETCHES = [
  ['Gira la cabeza despacio hacia la izquierda', 'Turn your head slowly to the left'],
  ['Y ahora hacia la derecha', 'Now to the right'],
  ['Baja la barbilla al pecho y respira', 'Lower your chin to your chest and breathe'],
  ['Sube los hombros… y suéltalos', 'Raise your shoulders… and let them drop'],
  ['Mira algo lejano, a más de seis metros', 'Look at something far away, more than six metres'],
  ['Estira los brazos hacia arriba', 'Stretch your arms up'],
];
const STRETCH_STEP = 20_000;

function guideFor(p, cycle) {
  const guide = p.guide();
  if (guide === 'alternate') return cycle % 2 ? 'breathe' : 'stretch';
  return guide === 'stretch' ? 'stretch' : 'breathe';
}

// ---------------------------------------------------------------- el anillo

function buildRing(win, st) {
  const doc = win.document, t = st.host.t;
  st.ring = el(doc, 'div', { id: 'zero-pomo', role: 'timer', 'aria-live': 'off' }, [
    el(doc, 'span', { class: 'zero-pomo-label' }),
    el(doc, 'button', { type: 'button', class: 'zero-pomo-action', 'data-action': 'reset', title: t('Reiniciar', 'Reset'), 'aria-label': t('Reiniciar', 'Reset') }),
    el(doc, 'button', { type: 'button', class: 'zero-pomo-action', 'data-action': 'skip', title: t('Saltar a lo siguiente', 'Skip ahead'), 'aria-label': t('Saltar a lo siguiente', 'Skip ahead') }),
    el(doc, 'button', { type: 'button', class: 'zero-pomo-ring', title: t('Empezar o pausar', 'Start or pause'), 'aria-label': t('Empezar o pausar', 'Start or pause') }),
  ]);
  st.ring.addEventListener('click', event => {
    // Solo el anillo empieza o pausa, y los botones hacen lo suyo: un clic en el tiempo (al leerlo)
    // no cambia nada.
    if (!event.target.closest('[data-action], .zero-pomo-ring')) return;
    const action = event.target.closest('[data-action]')?.dataset.action;
    const p = st.p, now = clock.now(), saved = p.saved();
    const next = action === 'skip' ? skip(saved, p.preset(), now) : action === 'reset' ? reset() : toggle(saved, p.preset(), now);
    p.save(normalize(next, p.preset(), now));
  });
  win.document.body.append(st.ring);
  GlassPane.attach(st.ring, win, st.host);
}

function dropRing(st) {
  if (!st.ring) return;
  GlassPane.detach(st.ring);
  st.ring.remove();
  st.ring = null;
}

const LABELS = {
  work: (t, v) => `${clockText(v.left)} · ${t('Trabajo', 'Work')} ${v.cycle} ${t('de', 'of')} ${v.every}`,
  short: (t, v) => `${clockText(v.left)} · ${t('Descanso', 'Break')}`,
  long: (t, v) => `${clockText(v.left)} · ${t('Descanso largo', 'Long break')}`,
  waiting: (t, v) => `${t('Listo', 'Ready')} · ${t('Trabajo', 'Work')} ${v.cycle} ${t('de', 'of')} ${v.every}`,
  idle: (t, v) => `${clockText(v.left)} · ${t('Empezar', 'Start')}`,
};

function paintRing(win, st, v) {
  const t = st.host.t, ring = st.ring, root = win.document.documentElement;
  const paused = !v.running && ['work', 'short', 'long'].includes(v.phase);
  ring.setAttribute('phase', v.phase);
  ring.toggleAttribute('running', v.running);
  ring.toggleAttribute('ending', v.ending);
  ring.toggleAttribute('paused', paused);
  const fraction = v.phase === 'idle' || v.phase === 'waiting' ? 1 : v.left / v.total;
  ring.style.setProperty('--zero-pomo-p', fraction.toFixed(4));
  const label = paused ? `${clockText(v.left)} · ${t('En pausa', 'Paused')}` : LABELS[v.phase](t, v);
  const node = ring.querySelector('.zero-pomo-label');
  if (node.textContent !== label) node.textContent = label;
  // El tirador de la esquina (con la web ampliada) hace de barra de progreso.
  root.toggleAttribute('zero-pomo-running', v.running);
  root.style.setProperty('--zero-pomo-progress', (1 - fraction).toFixed(4));
  root.setAttribute('zero-pomo-phase', v.phase);
}

// ---------------------------------------------------------------- el descanso estricto

function buildBreak(win, st, v) {
  const doc = win.document, t = st.host.t;
  const hold = el(doc, 'button', { type: 'button', class: 'zero-hold' }, [
    el(doc, 'span', { class: 'zero-hold-fill', 'aria-hidden': 'true' }),
    el(doc, 'span', { class: 'zero-hold-text' }, [t('Mantén para saltar', 'Hold to skip')]),
  ]);
  st.brk = el(doc, 'section', { id: 'zero-break', role: 'dialog', 'aria-label': t('Descanso', 'Break') }, [
    el(doc, 'div', { class: 'zero-break-panel' }, [
      el(doc, 'div', { class: 'zero-break-time' }),
      el(doc, 'div', { class: 'zero-breath', 'aria-hidden': 'true' }),
      el(doc, 'div', { class: 'zero-break-cue', 'aria-live': 'polite' }),
      el(doc, 'div', { class: 'zero-break-hint' }),
      hold,
    ]),
  ]);
  st.brk.dataset.guide = guideFor(st.p, v.cycle);
  doc.body.append(st.brk);
  // Mantener 1,5 s salta; soltar antes, no. Con el ratón o con Intro/espacio.
  let timer = 0;
  const begin = () => { if (timer) return; hold.classList.add('holding'); timer = win.setTimeout(() => { timer = 0; const p = st.p, now = clock.now(); p.save(normalize(skip(p.saved(), p.preset(), now), p.preset(), now)); }, HOLD); };
  const cancel = () => { hold.classList.remove('holding'); win.clearTimeout(timer); timer = 0; };
  hold.addEventListener('pointerdown', event => { hold.setPointerCapture?.(event.pointerId); begin(); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) hold.addEventListener(type, cancel);
  hold.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); begin(); } });
  hold.addEventListener('keyup', event => { if (event.key === 'Enter' || event.key === ' ') cancel(); });
  st.dropBreakTimer = cancel;
  GlassPane.attach(st.brk, win, st.host);
  // Para las piezas que tapan la web (el silencio): ahora tapa el descanso.
  win.dispatchEvent(new win.CustomEvent('zero-break-change'));
  // La respiración, a compás con el reloj desde que empezó el descanso.
  const elapsed = v.total - v.left;
  st.brk.querySelector('.zero-breath').style.animationDelay = `-${elapsed % (BREATH.in + BREATH.out)}ms`;
  win.setTimeout(() => hold.focus(), 0);
}

function paintBreak(win, st, v) {
  const t = st.host.t, brk = st.brk;
  const elapsed = v.total - v.left;
  brk.querySelector('.zero-break-time').textContent = `${(v.phase === 'long' ? t('Descanso largo', 'Long break') : t('Descanso', 'Break')).toUpperCase()} · ${clockText(v.left)}`;
  let cue, hint;
  if (brk.dataset.guide === 'stretch') {
    const step = Math.floor(elapsed / STRETCH_STEP) % STRETCHES.length;
    cue = t(...STRETCHES[step]);
    hint = `${t('Paso', 'Step')} ${step + 1} ${t('de', 'of')} ${STRETCHES.length} · ${Math.ceil((STRETCH_STEP - elapsed % STRETCH_STEP) / 1000)} s`;
  } else {
    cue = elapsed % (BREATH.in + BREATH.out) < BREATH.in ? t('Inspira…', 'Breathe in…') : t('Suelta…', 'Breathe out…');
    hint = t('4 segundos dentro · 6 fuera', '4 seconds in · 6 out');
  }
  const cueNode = brk.querySelector('.zero-break-cue');
  if (cueNode.textContent !== cue) cueNode.textContent = cue;
  brk.querySelector('.zero-break-hint').textContent = hint;
}

function dropBreak(st) {
  if (!st.brk) return;
  st.dropBreakTimer?.();
  GlassPane.detach(st.brk);
  const win = st.brk.ownerGlobal;
  st.brk.remove();
  st.brk = null;
  try { win?.dispatchEvent(new win.CustomEvent('zero-break-change')); } catch { /* ventana cerrándose */ }
}

// ---------------------------------------------------------------- cada segundo

function update(win, st) {
  const p = st.p;
  const root = win.document.documentElement;
  if (!p.on()) {
    dropRing(st);
    dropBreak(st);
    for (const name of ['zero-pomo-running', 'zero-pomo-phase']) root.removeAttribute(name);
    root.style.removeProperty('--zero-pomo-progress');
    st.lastPhase = null;
    return;
  }
  if (!st.ring) buildRing(win, st);
  const v = view(p.saved(), p.preset(), clock.now());
  paintRing(win, st, v);
  // Los avisos, solo al cambiar de fase mientras se mira (no al abrir la ventana).
  if (st.lastPhase && st.lastPhase !== v.phase) {
    const t = st.host.t;
    if (st.lastPhase === 'work' && (v.phase === 'short' || v.phase === 'long')) {
      st.island?.alert(`${v.phase === 'long' ? t('Descanso largo', 'Long break') : t('Descanso', 'Break')} · ${clockText(v.left)}`,
        t('levántate, mira lejos, bebe agua', 'stand up, look far away, drink some water'), 6000, 'break');
    } else if ((st.lastPhase === 'short' || st.lastPhase === 'long') && v.phase === 'waiting') {
      st.island?.alert(t('¿Seguimos?', 'Shall we go on?'), t('pulsa el anillo cuando quieras', 'click the ring whenever you like'), 6000, 'resume');
    }
  }
  st.lastPhase = v.phase;
  // El descanso estricto: mientras dura, en todas las ventanas en Zero.
  const strict = p.strict() && v.running && (v.phase === 'short' || v.phase === 'long');
  if (strict && !st.brk) buildBreak(win, st, v);
  if (!strict) dropBreak(st);
  if (st.brk) paintBreak(win, st, v);
}

export function attach(win, ctx) {
  const { host } = ctx;
  if (!host?.prefs) return;
  const st = { host, p: prefs(host), island: ctx.island, ring: null, brk: null, lastPhase: null, cleanups: [] };
  state.set(win, st);
  ctx.settings?.add(section(win, host));
  const refresh = () => { if (state.get(win) === st) update(win, st); };
  const observer = { observe: refresh };
  for (const key of ['pomodoro', 'pomodoroState', 'pomodoroPreset', 'pomodoroBreak', 'pomodoroGuide']) {
    host.prefs.addObserver(st.p.name(key), observer);
    st.cleanups.push(() => host.prefs.removeObserver(st.p.name(key), observer));
  }
  st.timer = win.setInterval(refresh, 1000);
  st.cleanups.push(() => win.clearInterval(st.timer));
  update(win, st);
  st.lastPhase = st.p.on() ? view(st.p.saved(), st.p.preset(), clock.now()).phase : null;
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
  dropRing(st);
  dropBreak(st);
  const root = win.document.documentElement;
  for (const name of ['zero-pomo-running', 'zero-pomo-phase']) root.removeAttribute(name);
  root.style.removeProperty('--zero-pomo-progress');
}
