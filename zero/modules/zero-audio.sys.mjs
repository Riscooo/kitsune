/* Kitsune Zero · el sonido: la pastilla del altavoz, abajo en la columna (en la variante «Sobrio»; en «Nácar»
 * están los accesos directos y la música en su pastilla, y esta no se ve: zero.css).
 *
 * Dani (15-10): «que te detecte si te estás escuchando algo y que puedas bajar el volumen ahí del propio
 * navegador, que no te abra una pestaña, y quitarlo»; y en esa pastilla nada de abrir pestañas.
 * - Un clic en el altavoz abre el panel de sonido: el volumen de Kitsune (un deslizador), silenciar todo,
 *   lo que suena en cada pestaña (pausa, silenciar, ir a ella) y la música (el reproductor de zero-music).
 * - El volumen de Kitsune multiplica el de cada <audio> y <video> (respetando el que ponga la web): lo
 *   aplica zero-audio-child en cada web, con el nivel en sharedData (kitsune.zero.volume lo guarda).
 * - La pastilla lo dice: el altavoz tachado con todo en silencio y una onda que late si algo suena.
 */
import { prefName, PREFS } from './zero-config.sys.mjs';
import { openMusic, musicName } from './zero-music.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const ACTOR = 'KitsuneZeroAudio';
const KEY = 'kitsune-zero-volume';
const state = new WeakMap();
let registered = 0;

// La parte de Kitsune del actor no hace nada: las órdenes van de aquí a la web (ZeroAudio:apply).
export class KitsuneZeroAudioParent extends JSWindowActorParent {}

const el = (doc, tag, attrs = {}, kids = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
};
const controllerOf = tab => { try { return tab?.linkedBrowser?.browsingContext?.mediaController ?? null; } catch { return null; } };
const live = tab => !!tab?.isConnected && !tab.closing;

/** El volumen de Kitsune guardado (de 0 a 1). */
export function volumeOf(host) {
  const value = Number((() => { try { return host.prefs.getStringPref(prefName(host.prefix, PREFS.volume), '1'); } catch { return '1'; } })());
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/** Pone el volumen de Kitsune: lo guarda, lo comparte con las webs y lo aplica ya a todo lo que suena. */
export function setVolume(host, value) {
  const level = Math.min(1, Math.max(0, Number(value) || 0));
  try { host.prefs.setStringPref(prefName(host.prefix, PREFS.volume), String(Math.round(level * 100) / 100)); } catch { /* sin ajustes */ }
  share(level);
  for (const win of Services.wm.getEnumerator('navigator:browser')) {
    for (const tab of win.gBrowser?.tabs ?? []) if (controllerOf(tab)?.isActive || tab.hasAttribute('soundplaying')) applyTo(tab.linkedBrowser);
  }
  for (const win of Services.wm.getEnumerator('navigator:browser')) {
    for (const player of win.document.querySelectorAll('.zero-music-player')) applyTo(player);
  }
}

function share(level) {
  try { Services.ppmm.sharedData.set(KEY, level); Services.ppmm.sharedData.flush(); } catch { /* sin procesos */ }
}

function applyTo(browser) {
  for (const context of browser?.browsingContext?.getAllBrowsingContextsInSubtree?.() ?? []) {
    try { context.currentWindowGlobal?.getActor(ACTOR).sendAsyncMessage('ZeroAudio:apply'); } catch { /* aún cargando */ }
  }
}

function register(host) {
  if (registered++) return;
  share(volumeOf(host));
  try {
    ChromeUtils.registerWindowActor(ACTOR, {
      parent: { esModuleURI: import.meta.url },
      child: {
        esModuleURI: new URL('./zero-audio-child.sys.mjs', import.meta.url).href,
        events: { play: { capture: true, mozSystemGroup: true }, volumechange: { capture: true, mozSystemGroup: true } },
      },
      allFrames: true,
      messageManagerGroups: ['browsers'],
      safeForUntrustedWebProcess: true, // solo cambia el volumen de lo que suena: nada que la web pueda aprovechar
    });
  } catch { /* ya estaba */ }
}

function unregister() {
  if (--registered > 0) return;
  registered = 0;
  try { ChromeUtils.unregisterWindowActor(ACTOR); } catch { /* ya no estaba */ }
}

/** Las pestañas con algo que suena (o en pausa) de esta ventana, la que suena primero. */
function soundingTabs(win) {
  return win.gBrowser.tabs.filter(tab => live(tab) && (controllerOf(tab)?.isActive || tab.hasAttribute('soundplaying') || tab.hasAttribute('muted')))
    .sort((a, b) => Number(b.hasAttribute('soundplaying')) - Number(a.hasAttribute('soundplaying')));
}

function iconOf(win, tab) {
  try { return win.gBrowser.getIcon?.(tab) ?? tab.getAttribute('image') ?? null; } catch { return null; }
}

function render(win, st) {
  const doc = win.document, t = st.t;
  const tabs = soundingTabs(win);
  const level = volumeOf(st.host);
  const allMuted = tabs.length > 0 && tabs.every(tab => tab.hasAttribute('muted'));
  // La pastilla: tachada si todo está en silencio (o el volumen a cero); late si algo suena.
  st.button.toggleAttribute('muted', allMuted || level === 0);
  st.button.toggleAttribute('playing', tabs.some(tab => tab.hasAttribute('soundplaying') && !tab.hasAttribute('muted')));
  if (!st.panel.hasAttribute('open')) return;
  if (doc.activeElement !== st.slider) st.slider.value = String(Math.round(level * 100));
  st.slider.style.setProperty('--zero-fill', `${st.slider.value}%`);
  st.percent.textContent = `${st.slider.value} %`;
  st.muteAll.toggleAttribute('on', allMuted);
  st.muteAll.disabled = !tabs.length;
  st.muteAll.textContent = allMuted ? t('Quitar silencio', 'Unmute all') : t('Silenciar todo', 'Mute all');
  const rows = tabs.map(tab => {
    const controller = controllerOf(tab);
    let meta = null;
    try { meta = controller?.isActive ? controller.getMetadata() : null; } catch { /* la web no dice nada */ }
    const row = el(doc, 'div', { class: 'zero-sound-row', role: 'listitem' });
    const icon = iconOf(win, tab);
    // Su icono, o su inicial si no tiene (como en el raíl).
    const fav = el(doc, 'span', { class: 'zero-sound-fav', 'aria-hidden': 'true' }, icon ? [el(doc, 'img', { src: icon, alt: '' })] : [([...String(tab.label || '·').trim()][0] ?? '·').toLocaleUpperCase()]);
    if (!icon) fav.setAttribute('letter', '');
    const name = el(doc, 'button', { type: 'button', class: 'zero-sound-name', title: t('Ir a la pestaña', 'Go to the tab') }, [
      el(doc, 'b', {}, [String(meta?.title || tab.label || '')]),
      el(doc, 'small', {}, [String(meta?.artist || (() => { try { return tab.linkedBrowser.currentURI.host; } catch { return ''; } })())]),
    ]);
    name.addEventListener('click', () => { if (live(tab)) { win.gBrowser.selectedTab = tab; close(st); } });
    const playing = !!controller?.isPlaying;
    const play = el(doc, 'button', { type: 'button', class: 'zero-sound-play', 'aria-label': playing ? t('Pausa', 'Pause') : t('Seguir', 'Play'), title: playing ? t('Pausa', 'Pause') : t('Seguir', 'Play') });
    play.toggleAttribute('playing', playing);
    play.hidden = !controller?.isActive;
    play.addEventListener('click', () => { try { controller.isPlaying ? controller.pause('user') : controller.play(); } catch { /* ya no está */ } win.setTimeout(() => render(win, st), 120); });
    const muted = tab.hasAttribute('muted');
    const mute = el(doc, 'button', { type: 'button', class: 'zero-sound-mute', 'aria-label': muted ? t('Quitar silencio', 'Unmute') : t('Silenciar', 'Mute'), title: muted ? t('Quitar silencio', 'Unmute') : t('Silenciar', 'Mute') });
    mute.toggleAttribute('muted', muted);
    mute.addEventListener('click', () => { tab.toggleMuteAudio(); });
    row.append(fav, name, play, mute);
    return row;
  });
  if (!rows.length) rows.push(el(doc, 'p', { class: 'zero-sound-none' }, [t('No suena nada ahora mismo.', 'Nothing is playing right now.')]));
  st.list.replaceChildren(...rows);
  const service = musicName(st.host);
  st.musicName.textContent = service ?? t('Elige un servicio', 'Choose a service');
}

function place(win, st) {
  const r = st.button.getBoundingClientRect(), dock = win.document.getElementById('zero-dock')?.getBoundingClientRect();
  const height = st.panel.offsetHeight || 280;
  st.panel.style.left = `${Math.round((dock?.right ?? r.right) + 12)}px`;
  st.panel.style.top = `${Math.round(Math.max(12, Math.min(r.top + r.height / 2 - height / 2, win.innerHeight - height - 12)))}px`;
}

function open(win, st) {
  st.panel.setAttribute('open', '');
  st.button.setAttribute('aria-expanded', 'true');
  render(win, st);
  place(win, st);
  win.clearInterval(st.timer);
  // Mientras está abierto, al día (lo que suena cambia de título, se pausa desde la web…).
  st.timer = win.setInterval(() => render(win, st), 1000);
}

function close(st) {
  st.panel.removeAttribute('open');
  st.button.setAttribute('aria-expanded', 'false');
  st.panel.ownerGlobal?.clearInterval(st.timer);
}

export function attach(win, ctx) {
  const doc = win.document, { host } = ctx;
  const dock = doc.getElementById('zero-dock');
  if (!dock) return;
  const t = host.t ?? (es => es);
  const st = { host, t, cleanups: [] };
  state.set(win, st);
  register(host);
  st.cleanups.push(unregister);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };

  st.button = el(doc, 'button', { type: 'button', class: 'zero-sound-button', title: t('Sonido', 'Sound'), 'aria-label': t('Sonido', 'Sound'), 'aria-expanded': 'false', 'aria-controls': 'zero-sound' },
    [el(doc, 'span', { class: 'zero-fav', 'aria-hidden': 'true' })]);
  st.pill = el(doc, 'div', { id: 'zero-sound-pill', class: 'zero-pill', role: 'group', 'aria-label': t('Sonido', 'Sound') }, [st.button]);
  dock.append(st.pill);
  st.slider = el(doc, 'input', { type: 'range', class: 'zero-slider', min: '0', max: '100', step: '1', 'aria-label': t('Volumen de Kitsune', 'Kitsune volume') });
  st.percent = el(doc, 'span', { class: 'zero-sound-percent', 'aria-hidden': 'true' });
  st.muteAll = el(doc, 'button', { type: 'button', class: 'zero-sound-all' });
  st.list = el(doc, 'div', { class: 'zero-sound-list', role: 'list', 'aria-label': t('Lo que suena', 'What is playing') });
  st.musicName = el(doc, 'span', { class: 'zero-sound-music-name' });
  const musicOpen = el(doc, 'button', { type: 'button', class: 'zero-sound-music-open' }, [t('Abrir', 'Open')]);
  st.panel = el(doc, 'section', { id: 'zero-sound', role: 'dialog', 'aria-label': t('Sonido', 'Sound') }, [
    el(doc, 'header', {}, [el(doc, 'h4', {}, [t('Sonido', 'Sound')]), st.muteAll]),
    el(doc, 'div', { class: 'zero-sound-volume' }, [el(doc, 'span', { class: 'zero-sound-speaker', 'aria-hidden': 'true' }), st.slider, st.percent]),
    el(doc, 'h5', {}, [t('Suena ahora', 'Playing now')]),
    st.list,
    el(doc, 'div', { class: 'zero-sound-music' }, [el(doc, 'span', { class: 'zero-sound-note', 'aria-hidden': 'true' }), el(doc, 'div', {}, [el(doc, 'b', {}, [t('Música', 'Music')]), st.musicName]), musicOpen]),
  ]);
  doc.body.append(st.panel);
  st.cleanups.push(() => { win.clearInterval(st.timer); st.pill.remove(); st.panel.remove(); });

  st.button.addEventListener('click', () => { if (st.panel.hasAttribute('open')) close(st); else open(win, st); });
  st.slider.addEventListener('input', () => { setVolume(host, Number(st.slider.value) / 100); render(win, st); });
  st.muteAll.addEventListener('click', () => {
    const tabs = soundingTabs(win), muted = tabs.every(tab => tab.hasAttribute('muted'));
    for (const tab of tabs) if (tab.hasAttribute('muted') === muted) tab.toggleMuteAudio();
  });
  musicOpen.addEventListener('click', () => { close(st); openMusic(win, st.button); });
  // Se cierra al pulsar fuera o con Esc.
  listen(win, 'mousedown', event => { if (st.panel.hasAttribute('open') && !st.panel.contains(event.target) && !st.button.contains(event.target)) close(st); }, true);
  listen(win, 'keydown', event => { if (event.key === 'Escape' && st.panel.hasAttribute('open')) close(st); }, true);
  listen(win, 'resize', () => { if (st.panel.hasAttribute('open')) place(win, st); });

  const tabs = win.gBrowser.tabContainer;
  listen(tabs, 'TabAttrModified', event => {
    if (event.detail?.changed?.some(name => name === 'soundplaying' || name === 'muted' || name === 'image' || name === 'label')) render(win, st);
  });
  for (const type of ['TabClose', 'TabOpen']) listen(tabs, type, () => win.setTimeout(() => render(win, st), 0));
  // Lo que suena en una pestaña nueva (o en el reproductor de música) también va con el volumen de Kitsune.
  const progress = { onStateChange(browser, webProgress, request, flags) { if (webProgress?.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_STOP && volumeOf(host) < 1) applyTo(browser); } };
  win.gBrowser.addTabsProgressListener(progress);
  st.cleanups.push(() => win.gBrowser.removeTabsProgressListener(progress));
  const prefs = { observe: () => render(win, st) };
  host.prefs.addObserver(prefName(host.prefix, 'music.service'), prefs);
  st.cleanups.push(() => host.prefs.removeObserver(prefName(host.prefix, 'music.service'), prefs));
  render(win, st);
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}

