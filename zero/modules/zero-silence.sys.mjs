/* Kitsune Zero · el silencio: que nada te enganche mientras trabajas.
 *
 * Opcional y apagado de serie (ajuste «silence»). Encendido, y cada cosa a elegir:
 * - Avisos en silencio: mientras trabajas, el «no molestar» de Gecko (las notificaciones de las webs
 *   no salen). En Linux, Gecko lo tiene solo con sus avisos propios (no con los del sistema): mientras
 *   dura, Zero los elige en la rama de valores de serie, que no se guarda en disco, y luego lo deja
 *   como estaba (si Gecko se cierra de golpe, al volver ya está como siempre).
 * - Webs vetadas: tu lista; mientras trabajas, la web sale tapada por un cristal con su dominio y lo
 *   que falta para el descanso, y «Mantén para entrar» da 10 minutos. Con «Solo currar», también en
 *   el descanso.
 * - Aviso de scroll infinito: tras 10 minutos bajando en la misma página, la isla lo dice.
 * «Mientras trabajas»: con el pomodoro, mientras corre un trabajo; sin él, siempre (Zero ya es modo
 * trabajo). Los banners de cookies y el autoplay con sonido ya los quita Kitsune (sus modos de
 * privacidad): Zero no toca esos ajustes.
 */
import { parseHosts, blockedHost, working, ScrollWatch } from './zero-silence.mjs';
import { PRESETS, view } from './zero-pomodoro.mjs';
import { clock } from './zero-pomodoro.sys.mjs';
import { prefName, PREFS } from './zero-config.sys.mjs';
import { GlassPane } from './zero-glass.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const HOLD = 1500;              // ms manteniendo «Entrar» para entrar
const ALLOW = 10 * 60_000;      // lo que dura el permiso para entrar
const SCROLL_LIMIT = 10 * 60_000;
const state = new WeakMap();    // ventana → { … }
const allowed = new Map();      // dominio → hasta cuándo se puede entrar

/** Para las pruebas: olvidar los permisos de «Mantén para entrar». */
export function forgetAllowed() { allowed.clear(); }

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};

// ---------------------------------------------------------------- «no molestar» (uno para todo Gecko)

const quiet = new Set();   // ventanas que lo quieren puesto
let saved = null;          // cómo estaba todo antes de que Zero lo pusiera
const SYSTEM_BACKEND = 'alerts.useSystemBackend';

function alertsService() {
  try { return Cc['@mozilla.org/alerts-service;1'].getService(Ci.nsIAlertsService).QueryInterface(Ci.nsIAlertsDoNotDisturb); } catch { return null; }
}

const readDnd = service => { try { return service.manualDoNotDisturb; } catch { return null; } };

function wantQuiet(win, on) {
  const service = alertsService();
  if (!service) return;
  if (on) {
    if (!quiet.size) {
      const defaults = Services.prefs.getDefaultBranch('');
      saved = { dnd: readDnd(service), backend: defaults.getPrefType(SYSTEM_BACKEND) ? defaults.getBoolPref(SYSTEM_BACKEND) : null };
      // Si los avisos del sistema no tienen «no molestar» (Linux), los de Gecko sí: solo en la rama
      // de serie (no se guarda) y solo si nadie lo ha elegido a mano.
      if (readDnd(service) === null && saved.backend !== null && !Services.prefs.prefHasUserValue(SYSTEM_BACKEND)) defaults.setBoolPref(SYSTEM_BACKEND, false);
    }
    quiet.add(win);
    try { if (!service.manualDoNotDisturb) service.manualDoNotDisturb = true; } catch { /* este sistema no lo tiene */ }
  } else if (quiet.delete(win) && !quiet.size) {
    try { service.manualDoNotDisturb = !!saved?.dnd; } catch { /* no lo tenía */ }
    if (saved?.backend !== null && saved?.backend !== undefined) Services.prefs.getDefaultBranch('').setBoolPref(SYSTEM_BACKEND, saved.backend);
    saved = null;
  }
}

// ---------------------------------------------------------------- los ajustes

function prefs(host) {
  const name = key => prefName(host.prefix, PREFS[key]);
  const bool = (key, fallback) => { try { return host.prefs.getBoolPref(name(key), fallback); } catch { return fallback; } };
  const text = (key, fallback) => { try { return host.prefs.getStringPref(name(key), fallback); } catch { return fallback; } };
  return {
    name,
    on: () => bool('silence', false),
    notify: () => bool('silenceNotify', true),
    block: () => bool('silenceBlock', true),
    blocked: () => parseHosts(text('silenceBlocked', '')),
    onlyWork: () => bool('silenceOnlyWork', false),
    scroll: () => bool('silenceScroll', true),
    // El pomodoro, para saber si se está trabajando.
    pomodoro: () => {
      const on = bool('pomodoro', false);
      if (!on) return { pomodoroOn: false };
      let saved = null;
      try { saved = JSON.parse(text('pomodoroState', '') || 'null'); } catch { /* sin reloj */ }
      const preset = PRESETS[text('pomodoroPreset', '25')] ?? PRESETS['25'];
      return { pomodoroOn: true, ...view(saved, preset, clock.now()) };
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
  const toggle = (key, fallback, label, detail, when) => ({
    kind: 'switch', id: PREFS[key], label, detail,
    get: () => { try { return host.prefs.getBoolPref(p.name(key), fallback); } catch { return fallback; } },
    set: value => host.prefs.setBoolPref(p.name(key), value),
    watch: watch([key]), when,
  });
  const blocking = () => p.on() && p.block();
  return {
    id: 'silence',
    watch: watch(['silence', 'silenceBlock']),
    rows: [
      toggle('silence', false, t('Silencio', 'Quiet'),
        t('Que nada te enganche. Los banners de cookies y el autoplay con sonido ya los quita Kitsune.', 'Nothing to hook you. Kitsune already removes cookie banners and autoplay with sound.')),
      toggle('silenceNotify', true, t('Avisos en silencio', 'Quiet notifications'),
        t('Las notificaciones de las webs no salen mientras trabajas', 'Website notifications stay quiet while you work'), p.on),
      toggle('silenceBlock', true, t('Webs vetadas', 'Blocked sites'),
        t('Tapadas mientras trabajas; manteniendo, entras 10 minutos', 'Covered while you work; hold to get in for 10 minutes'), p.on),
      {
        kind: 'list', id: PREFS.silenceBlocked, label: t('Vetadas', 'Blocked'), placeholder: 'youtube.com, x.com, reddit.com',
        get: () => { try { return host.prefs.getStringPref(p.name('silenceBlocked'), ''); } catch { return ''; } },
        set: value => host.prefs.setStringPref(p.name('silenceBlocked'), parseHosts(value).join(', ')),
        watch: watch(['silenceBlocked']), when: blocking,
      },
      toggle('silenceOnlyWork', false, t('Solo currar', 'Only work'), t('Las vetadas, también en el descanso', 'Blocked sites, also during breaks'), blocking),
      toggle('silenceScroll', true, t('Aviso de scroll infinito', 'Endless scroll nudge'),
        t('Tras 10 minutos bajando en la misma página', 'After 10 minutes scrolling the same page'), p.on),
    ],
  };
}

// ---------------------------------------------------------------- la web vetada

function buildBlocked(win, st, domain) {
  const doc = win.document, t = st.host.t;
  const hold = el(doc, 'button', { type: 'button', class: 'zero-hold' }, [
    el(doc, 'span', { class: 'zero-hold-fill', 'aria-hidden': 'true' }),
    el(doc, 'span', { class: 'zero-hold-text' }, [t('Mantén para entrar', 'Hold to go in')]),
  ]);
  st.blocked = el(doc, 'section', { id: 'zero-blocked', role: 'dialog', 'aria-label': t('Web vetada', 'Blocked site') }, [
    el(doc, 'div', { class: 'zero-break-panel' }, [
      el(doc, 'div', { class: 'zero-break-time' }),
      el(doc, 'div', { class: 'zero-blocked-host' }, [domain]),
      el(doc, 'div', { class: 'zero-break-hint' }),
      hold,
    ]),
  ]);
  st.blocked.dataset.domain = domain;
  doc.body.append(st.blocked);
  let timer = 0;
  const begin = () => {
    if (timer) return;
    hold.classList.add('holding');
    timer = win.setTimeout(() => { timer = 0; allowed.set(domain, clock.now() + ALLOW); update(win, st); }, HOLD);
  };
  const cancel = () => { hold.classList.remove('holding'); win.clearTimeout(timer); timer = 0; };
  hold.addEventListener('pointerdown', event => { hold.setPointerCapture?.(event.pointerId); begin(); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) hold.addEventListener(type, cancel);
  hold.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); begin(); } });
  hold.addEventListener('keyup', event => { if (event.key === 'Enter' || event.key === ' ') cancel(); });
  st.dropHold = cancel;
  GlassPane.attach(st.blocked, win, st.host);
}

function dropBlocked(st) {
  if (!st.blocked) return;
  st.dropHold?.();
  GlassPane.detach(st.blocked);
  st.blocked.remove();
  st.blocked = null;
}

/** Por qué está vetada y cuándo se podrá entrar. */
function reason(t, pomo, onlyWork, isWork) {
  if (!isWork && onlyWork) return [t('SOLO CURRAR', 'ONLY WORK'), t('Está puesto «Solo currar»', '«Only work» is on')];
  if (pomo.pomodoroOn && pomo.phase === 'work') {
    const minutes = Math.max(1, Math.ceil(pomo.left / 60_000));
    return [t('TRABAJANDO', 'WORKING'), t(`Vuelve en el descanso · ${minutes} min`, `Back at the break · ${minutes} min`)];
  }
  return [t('EN ZERO', 'IN ZERO'), t('Vetada mientras trabajas', 'Blocked while you work')];
}

// ---------------------------------------------------------------- cada segundo

function update(win, st) {
  const p = st.p, t = st.host.t;
  if (!p.on()) { wantQuiet(win, false); dropBlocked(st); st.alertedFor = null; return; }
  const pomo = p.pomodoro();
  const isWork = working(pomo);
  wantQuiet(win, p.notify() && isWork);

  // En el descanso estricto, su cristal ya tapa la web: aquí no se pone otro encima.
  if (win.document.getElementById('zero-break')) { dropBlocked(st); return; }
  const browser = win.gBrowser.selectedBrowser;
  let host = '';
  try { host = browser.currentURI.host; } catch { /* sin dominio (about:, data:) */ }
  const domain = p.block() ? blockedHost(host, p.blocked()) : null;
  const shut = !!domain && (isWork || p.onlyWork()) && !((allowed.get(domain) ?? 0) > clock.now());
  if (!shut) { dropBlocked(st); return; }
  if (st.blocked && st.blocked.dataset.domain !== domain) dropBlocked(st);
  if (!st.blocked) buildBlocked(win, st, domain);
  const [label, hint] = reason(t, pomo, p.onlyWork(), isWork);
  st.blocked.querySelector('.zero-break-time').textContent = label;
  st.blocked.querySelector('.zero-break-hint').textContent = hint;
  // La isla lo dice una vez por cada vez que llegas a la web.
  const key = `${domain} ${browser.currentURI?.spec ?? ''}`;
  if (st.alertedFor !== key) {
    st.alertedFor = key;
    st.island?.alert(t(`${domain} está vetada`, `${domain} is blocked`), hint, 4000, 'blocked');
  }
}

export function attach(win, ctx) {
  const { host } = ctx;
  if (!host?.prefs) return;
  const st = { host, p: prefs(host), island: ctx.island, blocked: null, alertedFor: null, watch: new ScrollWatch({ limit: SCROLL_LIMIT }), cleanups: [] };
  state.set(win, st);
  ctx.settings?.add(section(host));
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };
  const refresh = () => { if (state.get(win) === st) update(win, st); };
  const observer = { observe: refresh };
  for (const key of ['silence', 'silenceNotify', 'silenceBlock', 'silenceBlocked', 'silenceOnlyWork', 'pomodoro', 'pomodoroState']) {
    host.prefs.addObserver(st.p.name(key), observer);
    st.cleanups.push(() => host.prefs.removeObserver(st.p.name(key), observer));
  }
  listen(win.gBrowser.tabContainer, 'TabSelect', refresh);
  listen(win, 'zero-break-change', refresh); // el descanso estricto pone o quita su cristal
  const progress = { onLocationChange: (browser, webProgress) => { if (webProgress?.isTopLevel && browser === win.gBrowser.selectedBrowser) { st.alertedFor = null; refresh(); } } };
  win.gBrowser.addTabsProgressListener(progress);
  st.cleanups.push(() => win.gBrowser.removeTabsProgressListener(progress));
  // El aviso de scroll infinito: el scroll lo cuenta la web (zero-glass).
  listen(win, 'zero-scroll', event => {
    const browser = event.detail?.browser;
    if (!st.p.on() || !st.p.scroll() || browser !== win.gBrowser.selectedBrowser) return;
    let page = '';
    try { page = browser.currentURI.spec; } catch { return; }
    if (st.watch.scrolled(page, clock.now())) {
      const t = host.t;
      st.island?.alert(t(`Llevas ${SCROLL_LIMIT / 60_000} min bajando aquí`, `${SCROLL_LIMIT / 60_000} minutes scrolling here`),
        t('¿seguro que buscabas esto?', 'is this what you were looking for?'), 6000, 'scroll');
    }
  });
  // Cada segundo, solo mientras el silencio está encendido: apagado (como viene de serie) no despierta a nadie.
  const tick = () => {
    const on = st.p.on();
    if (on && !st.timer) st.timer = win.setInterval(refresh, 1000);
    else if (!on && st.timer) { win.clearInterval(st.timer); st.timer = 0; }
  };
  const ticking = { observe: tick };
  host.prefs.addObserver(st.p.name('silence'), ticking);
  st.cleanups.push(() => { host.prefs.removeObserver(st.p.name('silence'), ticking); if (st.timer) win.clearInterval(st.timer); });
  tick();
  update(win, st);
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
  wantQuiet(win, false);
  dropBlocked(st);
}
