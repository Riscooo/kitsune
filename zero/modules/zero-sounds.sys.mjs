/* Kitsune Zero · los sonidos: grabaciones reales CC0 mezcladas por capas.
 *
 * Opcionales y apagados de serie (ajuste «sounds»). Encendidos, en los ajustes sale un nivel por
 * capa (lluvia, bosque, cafetería, olas, fuego y río) y «Se paran en el descanso». Suenan una sola vez
 * aunque haya varias ventanas en Zero: el audio vive en una de ellas y, si se cierra, pasa a otra.
 * Cada capa entra y sale con un fundido de unos segundos (nada salta) y solo se carga si suena.
 */
import { LAYERS, parseLevels, gains } from './zero-sounds.mjs';
import { PRESETS, view } from './zero-pomodoro.mjs';
import { clock } from './zero-pomodoro.sys.mjs';
import { prefName, PREFS } from './zero-config.sys.mjs';

const RAMP = 0.6;               // s (constante de tiempo del fundido: llega en unos 3 s)
const windows = new Set();      // ventanas en Zero con la pieza puesta
const state = new WeakMap();    // ventana → { host, p, timer, cleanups }

// ---------------------------------------------------------------- el audio (uno para todas)

const audio = { win: null, ctx: null, master: null, layers: new Map(), target: {} };

const NAMES = { lluvia: ['Lluvia', 'Rain'], bosque: ['Bosque', 'Forest'], cafeteria: ['Cafetería', 'Café'], olas: ['Olas', 'Waves'], fuego: ['Fuego', 'Fire'], rio: ['Río', 'River'] };

function ensureAudio(win) {
  if (audio.ctx && audio.win === win) return audio.ctx;
  closeAudio();
  audio.win = win;
  audio.ctx = new win.AudioContext({ latencyHint: 'playback' });
  audio.master = audio.ctx.createGain();
  audio.master.connect(audio.ctx.destination);
  return audio.ctx;
}

function closeAudio() {
  for (const layer of audio.layers.values()) { try { layer.source?.stop(); } catch { /* ya parado */ } }
  audio.layers.clear();
  try { audio.ctx?.close(); } catch { /* ya cerrado */ }
  audio.ctx = null; audio.master = null; audio.win = null;
}

async function load(win, layer) {
  const response = await win.fetch(layer.file);
  return audio.ctx.decodeAudioData(await response.arrayBuffer());
}

/** Una capa: su grabación en bucle, empezando en un punto al azar, con su ganancia (de 0). */
function ensureLayer(win, layer) {
  if (audio.layers.has(layer.id)) return audio.layers.get(layer.id);
  const entry = { gain: audio.ctx.createGain(), source: null, ready: false };
  entry.gain.gain.value = 0;
  entry.gain.connect(audio.master);
  audio.layers.set(layer.id, entry);
  load(win, layer).then(buffer => {
    if (audio.layers.get(layer.id) !== entry) return;
    entry.source = audio.ctx.createBufferSource();
    entry.source.buffer = buffer;
    entry.source.loop = true;
    entry.source.connect(entry.gain);
    entry.source.start(0, Math.random() * buffer.duration);
    entry.ready = true;
    apply();
  }).catch(() => { audio.layers.delete(layer.id); });
  return entry;
}

/** Lleva cada capa a su ganancia, despacio; las que callan del todo se sueltan al rato. */
function apply() {
  if (!audio.ctx) return;
  const now = audio.ctx.currentTime;
  let any = false;
  for (const layer of LAYERS) {
    const target = audio.target[layer.id] ?? 0;
    if (target > 0) {
      any = true;
      const entry = ensureLayer(audio.win, layer);
      if (entry.ready) entry.gain.gain.setTargetAtTime(target, now, RAMP);
    } else if (audio.layers.has(layer.id)) {
      audio.layers.get(layer.id).gain.gain.setTargetAtTime(0, now, RAMP);
    }
  }
  if (any && audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
  // Todo callado: el contexto se suspende cuando ya no se oye nada (no gasta).
  if (!any) {
    const ctx = audio.ctx;
    audio.win?.setTimeout(() => { if (audio.ctx === ctx && !Object.values(audio.target).some(v => v > 0)) ctx.suspend().catch(() => {}); }, 4000);
  }
}

// ---------------------------------------------------------------- los ajustes

function prefs(host) {
  const name = key => prefName(host.prefix, PREFS[key]);
  const bool = (key, fallback) => { try { return host.prefs.getBoolPref(name(key), fallback); } catch { return fallback; } };
  const text = (key, fallback) => { try { return host.prefs.getStringPref(name(key), fallback); } catch { return fallback; } };
  return {
    name,
    on: () => bool('sounds', false),
    pause: () => bool('soundsPause', true),
    levels: () => parseLevels(text('soundsLevels', '{"lluvia":0.5}')),
    setLevel: (id, value) => host.prefs.setStringPref(name('soundsLevels'), JSON.stringify({ ...parseLevels(text('soundsLevels', '{"lluvia":0.5}')), [id]: value })),
    phase: () => {
      if (!bool('pomodoro', false)) return 'idle';
      let saved = null;
      try { saved = JSON.parse(text('pomodoroState', '') || 'null'); } catch { /* sin reloj */ }
      return view(saved, PRESETS[text('pomodoroPreset', '25')] ?? PRESETS['25'], clock.now()).phase;
    },
  };
}

function section(host) {
  const p = prefs(host), t = host.t;
  const watch = keys => fn => {
    const observer = { observe: () => fn() };
    for (const key of keys) host.prefs.addObserver(p.name(key), observer);
    return () => { for (const key of keys) host.prefs.removeObserver(p.name(key), observer); };
  };
  return {
    id: 'sounds',
    watch: watch(['sounds']),
    rows: [
      {
        kind: 'switch', id: PREFS.sounds, label: t('Sonidos', 'Sounds'),
        detail: t('Grabaciones reales, con licencia CC0, mezcladas a tu gusto', 'Real recordings, CC0 licensed, mixed to taste'),
        get: p.on, set: value => host.prefs.setBoolPref(p.name('sounds'), value), watch: watch(['sounds']),
      },
      ...LAYERS.map(layer => ({
        kind: 'slider', id: `sounds.${layer.id}`, label: t(...NAMES[layer.id]),
        get: () => p.levels()[layer.id], set: value => p.setLevel(layer.id, value),
        watch: watch(['soundsLevels']), when: p.on,
      })),
      {
        kind: 'switch', id: PREFS.soundsPause, label: t('Se paran en el descanso', 'Pause during breaks'),
        get: p.pause, set: value => host.prefs.setBoolPref(p.name('soundsPause'), value), watch: watch(['soundsPause']), when: p.on,
      },
    ],
  };
}

// ---------------------------------------------------------------- cada segundo

function update(win, st) {
  const p = st.p;
  audio.target = gains(p.levels(), { on: p.on(), phase: p.phase(), pauseInBreak: p.pause() });
  const wanted = Object.values(audio.target).some(v => v > 0);
  // El audio vive en una ventana; si no hay, en esta.
  if (wanted && !audio.ctx) ensureAudio(win);
  if (audio.win === win) apply();
}

export function attach(win, ctx) {
  const { host } = ctx;
  if (!host?.prefs) return;
  const st = { host, p: prefs(host), cleanups: [] };
  state.set(win, st);
  windows.add(win);
  ctx.settings?.add(section(host));
  const refresh = () => { if (state.get(win) === st) update(win, st); };
  const observer = { observe: refresh };
  for (const key of ['sounds', 'soundsLevels', 'soundsPause', 'pomodoro', 'pomodoroState']) {
    host.prefs.addObserver(st.p.name(key), observer);
    st.cleanups.push(() => host.prefs.removeObserver(st.p.name(key), observer));
  }
  st.timer = win.setInterval(refresh, 1000);
  st.cleanups.push(() => win.clearInterval(st.timer));
  const unload = () => detach(win);
  win.addEventListener('unload', unload, { once: true });
  st.cleanups.push(() => win.removeEventListener('unload', unload));
  update(win, st);
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  windows.delete(win);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
  // Si el audio vivía aquí, pasa a otra ventana en Zero (o se calla).
  if (audio.win === win) {
    closeAudio();
    const next = [...windows][0];
    if (next) update(next, state.get(next));
  }
}

/** Para las pruebas: cómo está el audio, y abrir las seis grabaciones (su duración en segundos). */
export const Sounds = {
  debug: () => ({
    running: audio.ctx?.state === 'running',
    gains: Object.fromEntries([...audio.layers].map(([id, entry]) => [id, entry.gain.gain.value])),
  }),
  async check(win) {
    const ctx = new win.OfflineAudioContext(2, 48000, 48000);
    const out = {};
    for (const layer of LAYERS) {
      const buffer = await ctx.decodeAudioData(await (await win.fetch(layer.file)).arrayBuffer());
      out[layer.id] = Math.round(buffer.duration);
    }
    return out;
  },
};
