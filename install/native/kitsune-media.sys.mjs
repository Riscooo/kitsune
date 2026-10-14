/* Lo que suena: cuando una pestaña que no estás viendo reproduce música o un vídeo, una
 * tarjeta con su título, su carátula y los botones (anterior, pausa, siguiente, silenciar).
 * Un clic en el título te lleva a esa pestaña, aunque esté en otro espacio.
 *
 * - Con las pestañas a un lado, abajo en la barra lateral (encima de los espacios); con
 *   las pestañas arriba, compacta en la barra de herramientas. Lo decide kitsune-layout.css
 *   con sidebar.verticalTabs.
 * - Usa el MediaController de Gecko (el mismo de las teclas multimedia del sistema): el
 *   título, el artista y la carátula son los que da la web con la Media Session; si no da
 *   nada, el título de la pestaña.
 * - La carátula se pide con el principal de la pestaña (como su favicon): con sus cookies
 *   y su contenedor, nunca con los de otro usuario.
 */
// Textos en el idioma de Kitsune (kitsune-i18n.sys.mjs); sin Gecko (pruebas de Node), en castellano.
const t = (spanish, english) => {
  try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-i18n.sys.mjs').t(spanish, english); } catch { return spanish; }
};
const HTML = 'http://www.w3.org/1999/xhtml';
const EVENTS = ['activated', 'deactivated', 'metadatachange', 'playbackstatechange', 'supportedkeyschange'];
const windows = new Map();

/** La carátula más grande que sea https (o data:) de la Media Session, o ''. */
export function pickArtwork(artwork = []) {
  const size = image => Math.max(0, ...String(image?.sizes ?? '').split(/\s+/).map(value => Number.parseInt(value, 10) || 0));
  const usable = artwork.filter(image => /^(https:|data:image\/)/i.test(String(image?.src ?? '')));
  return usable.sort((a, b) => size(b) - size(a))[0]?.src ?? '';
}

/** Qué enseñar de lo que suena: título, segunda línea y botones. */
export function describe({ metadata, tabLabel = '', host = '', playing = false, keys = [], muted = false }) {
  const title = String(metadata?.title || tabLabel || host).trim().slice(0, 200);
  const artist = String(metadata?.artist || '').trim().slice(0, 200);
  return {
    title,
    subtitle: artist && artist !== title ? artist : host,
    playing,
    prev: keys.includes('previoustrack'),
    next: keys.includes('nexttrack'),
    muted,
  };
}

const controllerOf = tab => { try { return tab?.linkedBrowser?.browsingContext?.mediaController ?? null; } catch { return null; } };
const hostOf = tab => { try { return tab.linkedBrowser.currentURI.host; } catch { return ''; } };
const open = tab => !!tab?.isConnected && !tab.closing;

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};

function buildCard(doc, id, extra = {}) {
  const button = (action, label) => el(doc, 'button', { type: 'button', class: `kitsune-media-button kitsune-media-${action}`, 'data-action': action, title: label, 'aria-label': label });
  return el(doc, 'div', { id, class: 'kitsune-media', role: 'group', 'aria-label': t('Lo que suena', 'Now playing'), hidden: 'true', ...extra }, [
    el(doc, 'button', { type: 'button', class: 'kitsune-media-go', 'data-action': 'go', title: t('Ir a la pestaña', 'Go to the tab') }, [
      el(doc, 'img', { class: 'kitsune-media-art', alt: '', referrerpolicy: 'no-referrer' }),
      el(doc, 'span', { class: 'kitsune-media-text' }, [el(doc, 'span', { class: 'kitsune-media-title' }), el(doc, 'span', { class: 'kitsune-media-subtitle' })]),
    ]),
    el(doc, 'div', { class: 'kitsune-media-buttons' }, [
      button('prev', t('Anterior', 'Previous')), button('playpause', t('Pausa', 'Pause')), button('next', t('Siguiente', 'Next')), button('mute', t('Silenciar', 'Mute')),
    ]),
  ]);
}

function setArt(img, state) {
  const { tab } = state;
  const meta = (() => { try { return state.controller.getMetadata(); } catch { return null; } })();
  let src = pickArtwork(meta?.artwork), principal = '';
  if (src) {
    try {
      const { E10SUtils } = ChromeUtils.importESModule('resource://gre/modules/E10SUtils.sys.mjs');
      principal = E10SUtils.serializePrincipal(tab.linkedBrowser.contentPrincipal);
    } catch { src = ''; }
  }
  // Sin carátula, el favicon de la pestaña (ya cargado, con su propio principal).
  if (!src) { src = tab.getAttribute('image') || ''; principal = tab.getAttribute('iconloadingprincipal') || ''; }
  if (img.dataset.src === src) return;
  img.dataset.src = src;
  // Solo se ve cuando ha cargado de verdad (kitsune-layout.css); si no, la nota.
  img.removeAttribute('loaded');
  if (principal) img.setAttribute('triggeringprincipal', principal); else img.removeAttribute('triggeringprincipal');
  if (src) img.src = src; else img.removeAttribute('src');
}

function render(state) {
  const { tab } = state;
  if (tab && controllerOf(tab) !== state.controller) attach(state, tab);
  const controller = state.controller;
  const active = !!(open(tab) && controller?.isActive);
  const show = active && !tab.selected;
  state.win.document.documentElement.toggleAttribute('kitsune-media', show);
  for (const card of state.cards) {
    card.hidden = !show;
    if (!show) continue;
    let metadata = null;
    try { metadata = controller.getMetadata(); } catch { /* sin datos de la web */ }
    const view = describe({ metadata, tabLabel: tab.label, host: hostOf(tab), playing: controller.isPlaying, keys: [...(controller.supportedKeys ?? [])], muted: tab.hasAttribute('muted') });
    card.querySelector('.kitsune-media-title').textContent = view.title;
    card.querySelector('.kitsune-media-subtitle').textContent = view.subtitle;
    card.querySelector('.kitsune-media-go').title = `${view.title}${view.subtitle ? ' · ' + view.subtitle : ''}\n${t('Ir a la pestaña', 'Go to the tab')}`;
    card.toggleAttribute('playing', view.playing);
    card.toggleAttribute('muted', view.muted);
    const play = card.querySelector('.kitsune-media-playpause');
    const playLabel = view.playing ? t('Pausa', 'Pause') : t('Seguir', 'Play');
    play.title = playLabel; play.setAttribute('aria-label', playLabel); play.setAttribute('aria-pressed', String(!view.playing));
    card.querySelector('.kitsune-media-prev').hidden = !view.prev;
    card.querySelector('.kitsune-media-next').hidden = !view.next;
    const mute = card.querySelector('.kitsune-media-mute');
    const muteLabel = view.muted ? t('Quitar el silencio', 'Unmute') : t('Silenciar', 'Mute');
    mute.title = muteLabel; mute.setAttribute('aria-label', muteLabel); mute.setAttribute('aria-pressed', String(view.muted));
    setArt(card.querySelector('.kitsune-media-art'), state);
  }
}

function attach(state, tab) {
  if (state.controller) for (const name of EVENTS) state.controller.removeEventListener(name, state.listener);
  state.tab = tab;
  state.controller = controllerOf(tab);
  if (state.controller) for (const name of EVENTS) state.controller.addEventListener(name, state.listener);
}

/** Si la pestaña que sonaba se calla o se cierra: la última que siga sonando (o en pausa). */
function pick(state) {
  state.seen = state.seen.filter(open);
  const candidates = state.seen.map(tab => ({ tab, controller: controllerOf(tab) })).filter(item => item.controller?.isActive);
  const best = candidates.findLast(item => item.controller.isPlaying) ?? candidates.at(-1);
  attach(state, best?.tab ?? null);
}

function act(state, action) {
  const { tab, controller, win } = state;
  if (!open(tab)) return;
  try {
    if (action === 'go') win.gBrowser.selectedTab = tab;
    else if (action === 'playpause') controller.isPlaying ? controller.pause('user') : controller.play();
    else if (action === 'prev') controller.prevTrack();
    else if (action === 'next') controller.nextTrack();
    else if (action === 'mute') tab.toggleMuteAudio();
  } catch { /* la web ya no tiene nada que controlar */ }
  render(state);
}

export const KitsuneMedia = {
  async decorate(win) {
    if (!win.gBrowser || !win.gBrowserInit?.delayedStartupFinished) await win.delayedStartupPromise;
    if (windows.has(win) || !win.toolbar?.visible) return;
    const doc = win.document;
    const state = { win, tab: null, controller: null, seen: [], cards: [] };
    state.listener = event => { if (event.type === 'deactivated') pick(state); render(state); };
    windows.set(win, state);
    // A un lado: abajo en la barra lateral, encima de los espacios.
    const side = doc.querySelector('sidebar-main');
    if (side) {
      const card = buildCard(doc, 'kitsune-media-side', { slot: 'tabstrip' });
      const spaces = doc.getElementById('kitsune-spaces-side');
      spaces?.parentNode === side ? spaces.before(card) : side.append(card);
      state.cards.push(card);
    }
    // Arriba: en la barra de herramientas, antes del menú.
    const menu = doc.getElementById('PanelUI-button');
    if (menu) {
      const item = doc.createXULElement('toolbaritem');
      item.id = 'kitsune-media-top-item';
      item.classList.add('chromeclass-toolbar-additional');
      const card = buildCard(doc, 'kitsune-media-top');
      item.append(card);
      menu.before(item);
      state.cards.push(card);
    }
    for (const card of state.cards) {
      card.addEventListener('click', event => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action) act(state, action);
      });
      const img = card.querySelector('.kitsune-media-art');
      img.addEventListener('load', () => img.toggleAttribute('loaded', img.naturalWidth > 0));
      // Si la carátula no carga, el favicon; si tampoco, la nota de CSS.
      img.addEventListener('error', () => {
        img.removeAttribute('loaded');
        const icon = state.tab?.getAttribute('image') || '';
        if (icon && img.dataset.src !== icon) { img.dataset.src = icon; img.setAttribute('triggeringprincipal', state.tab.getAttribute('iconloadingprincipal') || ''); img.src = icon; }
      });
    }
    const container = win.gBrowser.tabContainer;
    container.addEventListener('TabAttrModified', event => {
      const tab = event.target;
      const changed = event.detail?.changed ?? [];
      if (changed.includes('soundplaying') && tab.soundPlaying) {
        state.seen = [...state.seen.filter(item => item !== tab), tab];
        if (tab !== state.tab) attach(state, tab);
      }
      if (tab === state.tab && changed.some(name => ['soundplaying', 'muted', 'image', 'label', 'busy'].includes(name))) render(state);
    });
    container.addEventListener('TabSelect', () => render(state));
    container.addEventListener('TabClose', event => {
      state.seen = state.seen.filter(item => item !== event.target);
      if (event.target === state.tab) { pick(state); win.setTimeout(() => render(state), 0); }
    });
    container.addEventListener('TabBrowserDiscarded', event => { if (event.target === state.tab) { pick(state); render(state); } });
    win.addEventListener('unload', () => { attach(state, null); windows.delete(win); }, { once: true });
  },
  /** Para las pruebas y la paleta: qué suena en esta ventana. */
  current(win) {
    const state = windows.get(win);
    return state?.tab && state.controller?.isActive ? { tab: state.tab, playing: state.controller.isPlaying } : null;
  },
  /** Pausa o sigue lo que suena, o lleva a su pestaña (la paleta). */
  toggle(win) {
    const state = windows.get(win);
    if (state?.tab) act(state, 'playpause');
  },
  go(win) {
    const state = windows.get(win);
    if (state?.tab) act(state, 'go');
  },
};
