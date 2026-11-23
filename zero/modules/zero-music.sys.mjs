/* Kitsune Zero · la música, como en Opera.
 *
 * Decisión de Risco (15-10): «integrar que puedas enlazar tu cuenta de Spotify o lo que sea, como hace Opera,
 * y que si lo minimizas puedas tener un mini panel de control flotante que puedas poner donde quieras, que
 * siempre se superponga a no ser que lo cierres, pero que no se corte el audio».
 *
 * - En la pastilla de los accesos directos, arriba, un botón de música. La primera vez, la lista de servicios;
 *   el elegido se guarda (kitsune.zero.music.service: su nombre, o una dirección para otro cualquiera).
 * - El reproductor es la web del servicio, con tu cuenta, en un navegador propio dentro de un panel de cristal
 *   junto a la columna: la música sigue aunque se cambie de pestaña o se cierre el panel.
 * - Minimizado, un minipanel flotante (portada, título, anterior, pausa y siguiente) que se arrastra a donde
 *   se quiera (kitsune.zero.music.mini, en px desde arriba a la izquierda) y queda encima de todo; cerrarlo
 *   no corta la música, y el botón vuelve a abrir el panel con la misma.
 * - Lo que suena lo dice la propia web (MediaSession) al controlador de medios de Gecko.
 * - El panel tiene el ancho que pide la web del servicio (Spotify no baja de 800 px: con 380 se cortaba, Risco
 *   19-10); se estrecha o ensancha desde su borde derecho (kitsune.zero.music.width; doble clic, el de serie),
 *   y si queda más estrecho que la web, esta se ve entera pero más pequeña (zero-music-fit).
 * - La DRM (Risco, 22-10: con Spotify no sonaba nada): está apagada hasta que una web la pide, y la barra
 *   «Activar DRM» de Gecko solo sale en las pestañas. Si la pide la web del panel, el panel saca la suya (lo
 *   dice zero-drm-child); su botón la activa como el de Gecko, y cuando Widevine está instalado la web se recarga.
 * - En Windows, Spotify suena en su web con la DRM del sistema (zero-spotify) y, si su servidor no da la licencia, se
 *   ofrece llevar la app de Spotify desde el mismo panel (zero-spotify-app), que vale con cuenta gratis.
 * Va en Windows, macOS y Linux.
 */
import { prefName } from './zero-config.sys.mjs';
import { fitMusic, MUSIC_MIN_WIDTH } from './zero-music-fit.mjs';
import { conPlayReady, alLicencia } from './zero-spotify.sys.mjs';
import { app as appSpotify, disponible as hayAppSpotify } from './zero-spotify-app.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const SERVICE_PREF = 'music.service';
const MINI_PREF = 'music.mini';
const WIDTH_PREF = 'music.width';
const DRM_ACTOR = 'KitsuneZeroDrm';
// Widevine es la única DRM que Gecko descarga (las demás vienen con el sistema): su versión, al quedar instalada.
const WIDEVINE_PREF = 'media.gmp-widevinecdm.version';
// El ancho por debajo del cual la web de cada servicio se corta (medido el 19-10; 0, se adapta a cualquiera).
export const SERVICES = Object.freeze([
  ['spotify', 'Spotify', 'https://open.spotify.com/', 800],
  ['youtube-music', 'YouTube Music', 'https://music.youtube.com/', 0],
  ['apple-music', 'Apple Music', 'https://music.apple.com/', 0],
  ['soundcloud', 'SoundCloud', 'https://soundcloud.com/', 960],
  ['deezer', 'Deezer', 'https://www.deezer.com/', 0],
  ['tidal', 'Tidal', 'https://listen.tidal.com/', 0],
].map(([id, name, url, width]) => Object.freeze({ id, name, url, width })));
/** La app de Spotify del ordenador, en lugar de su web (solo Windows; ver zero-spotify-app). */
export const APP = Object.freeze({ id: 'spotify-app', name: 'Spotify', url: 'spotify-app:', width: 0, app: true });
const EVENTS = ['activated', 'deactivated', 'metadatachange', 'playbackstatechange', 'supportedkeyschange', 'positionstatechange'];
const state = new WeakMap();

// En qué ha quedado la DRM que pide una web (lo dice zero-drm-child): solo cuenta la del panel de la música.
export class KitsuneZeroDrmParent extends JSWindowActorParent {
  receiveMessage({ name, data }) {
    if (name !== 'ZeroDrm:status') return;
    const browser = this.browsingContext.top?.embedderElement;
    // Gecko 157 llama documentGlobal a lo que antes era ownerGlobal.
    const st = browser && state.get(browser.documentGlobal ?? browser.ownerGlobal);
    if (st?.browser === browser) drmStatus(st, data?.status);
  }
}

let drmUsers = 0;

function useDrmActor() {
  if (drmUsers++ > 0) return;
  try {
    ChromeUtils.registerWindowActor(DRM_ACTOR, {
      parent: { esModuleURI: import.meta.url },
      child: { esModuleURI: new URL('./zero-drm-child.sys.mjs', import.meta.url).href, observers: ['mediakeys-request'] },
      allFrames: true,
      messageManagerGroups: ['browsers'],
      safeForUntrustedWebProcess: true, // solo dice en qué ha quedado la DRM: nada que la web pueda aprovechar
    });
  } catch { /* ya estaba */ }
}

function dropDrmActor() {
  if (--drmUsers > 0) return;
  drmUsers = 0;
  try { ChromeUtils.unregisterWindowActor(DRM_ACTOR); } catch { /* ya no estaba */ }
}

const el = (doc, tag, attrs = {}, kids = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
};

/** El servicio elegido: { name, url }, o null. Vale el nombre de uno de la lista o una dirección http(s). */
export function serviceOf(value) {
  if (value === APP.id) return APP;
  const known = SERVICES.find(service => service.id === value);
  if (known) return known;
  try {
    const url = new URL(value);
    // Una dirección de uno de la lista (una lista de Spotify, por ejemplo) pide el mismo ancho que él.
    const width = SERVICES.find(service => new URL(service.url).hostname === url.hostname)?.width ?? 0;
    if (/^https?:$/.test(url.protocol)) return { id: 'custom', name: url.hostname.replace(/^www\./, ''), url: url.href, width };
  } catch { /* nada */ }
  return null;
}

const readService = host => { try { return host.prefs.getStringPref(prefName(host.prefix, SERVICE_PREF), ''); } catch { return ''; } };
const readWidth = host => { try { return host.prefs.getIntPref(prefName(host.prefix, WIDTH_PREF), 0); } catch { return 0; } };

/** Abre la música desde `anchor` (su botón, o el altavoz del panel de sonido en la variante «Sobrio»): la
 *  primera vez, la lista de servicios; luego, el reproductor (o lo minimiza si ya está a la vista). */
export function openMusic(win, anchor) {
  const st = state.get(win);
  if (!st) return;
  if (anchor && anchor !== st.anchor) { st.anchor?.removeAttribute('on'); st.anchor = anchor; }
  const service = serviceOf(readService(st.host));
  if (!service) { if (st.services.hasAttribute('open')) closeServices(st); else openServices(win, st); return; }
  closeServices(st);
  ensurePanel(win, st, service);
  show(win, st, st.view === 'open' ? 'mini' : 'open');
}

/** Lo que suena en la música (para el panel de sonido): { service, title, artist, art, playing, live }, o null
 *  sin servicio elegido. */
export function musicNow(win) {
  const st = state.get(win);
  const service = st ? serviceOf(readService(st.host)) : null;
  if (!service) return null;
  const c = st.controller;
  let meta = null;
  try { meta = c?.isActive ? c.getMetadata() : null; } catch { /* la web no dice nada */ }
  return { service: service.name, title: meta?.title || '', artist: meta?.artist || '', art: meta?.artwork?.at(-1)?.src ?? null,
           playing: !!c?.isPlaying, live: !!c?.isActive };
}

/** Pausa/sigue ('play') o pasa de canción ('next', 'prev'). */
function drive(st, name) {
  const c = st?.controller;
  try {
    // Gecko 158 pide el motivo de la pausa (las versiones que no lo piden no lo miran).
    if (name === 'play') { if (c.isPlaying) c.pause('user'); else c.play(); }
    else if (name === 'next') c.nextTrack();
    else if (name === 'prev') c.prevTrack();
  } catch { /* aún no suena nada */ }
}

/** Lo mismo, desde fuera (el panel de sonido). */
export function musicControl(win, name) { drive(state.get(win), name); }

function controllerOf(st) {
  if (st.isApp) return appSpotify;
  try { return st.browser?.browsingContext?.mediaController ?? null; } catch { return null; }
}

/** El panel con el reproductor (se crea la primera vez y ya no se quita: la música no se corta). */
function ensurePanel(win, st, service) {
  const doc = win.document;
  if (st.panel && st.serviceUrl === service.url) return;
  if (!st.panel) {
    st.title = el(doc, 'span', { class: 'zero-music-name' });
    st.drmText = el(doc, 'span');
    st.drmButton = el(doc, 'button', { type: 'button' }, [st.t('Activar DRM', 'Enable DRM')]);
    st.drm = el(doc, 'div', { class: 'zero-music-drm', role: 'status', hidden: 'true' }, [st.drmText, st.drmButton]);
    st.panel = el(doc, 'section', { id: 'zero-music', 'aria-label': st.t('Música', 'Music') }, [
      el(doc, 'header', {}, [
        st.title,
        el(doc, 'button', { type: 'button', class: 'zero-music-change', title: st.t('Otro servicio', 'Another service'), 'aria-label': st.t('Otro servicio', 'Another service') }),
        el(doc, 'button', { type: 'button', class: 'zero-music-minimize', title: st.t('Minimizar', 'Minimize'), 'aria-label': st.t('Minimizar', 'Minimize') }),
      ]),
      st.drm,
    ]);
    st.panel.querySelector('.zero-music-minimize').addEventListener('click', () => show(win, st, 'mini'));
    st.panel.querySelector('.zero-music-change').addEventListener('click', () => { show(win, st, 'closed'); openServices(win, st); });
    st.drmButton.addEventListener('click', () => { if (st.drmView === 'denied') choose(win, st, APP.id); else enableDrm(st); });
    st.panel.append(resizeEdge(win, st));
    doc.body.append(st.panel);
    useDrmActor();
    st.cleanups.push(() => { stopDrmWait(st); dropDrmActor(); });
  }
  showDrm(st, null);
  st.browser?.remove();
  st.browser = null;
  st.appBox?.remove();
  st.appBox = null;
  st.isApp = !!service.app;
  st.serviceUrl = service.url;
  st.need = service.width ?? 0;
  st.title.textContent = service.name;
  if (st.isApp) { buildApp(win, st); watchController(win, st); return; }
  const browser = doc.createXULElement('browser');
  for (const [k, v] of Object.entries({ type: 'content', remote: 'true', maychangeremoteness: 'true', disableglobalhistory: 'true', messagemanagergroup: 'browsers', flex: '1' })) browser.setAttribute(k, v);
  browser.classList.add('zero-music-player');
  st.panel.append(browser);
  st.browser = browser;
  // Activo, como la pestaña elegida: se pinta y puede empezar a sonar sola (Firefox no deja a las de fondo).
  try { browser.docShellIsActive = true; } catch { /* sin esa propiedad */ }
  allowAutoplay(service.url);
  browser.loadURI(Services.io.newURI(service.url), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  watchController(win, st);
}

/** La app de Spotify en el panel: lo que suena, grande, y sus botones. */
function buildApp(win, st) {
  const doc = win.document, t = st.t;
  const button = (cls, label) => el(doc, 'button', { type: 'button', class: cls, title: label, 'aria-label': label });
  const a = st.appUi = {
    art: el(doc, 'img', { class: 'zero-app-art', alt: '', hidden: 'true' }), title: el(doc, 'b'), artist: el(doc, 'span'),
    bar: el(doc, 'input', { type: 'range', min: '0', max: '1000', value: '0', class: 'zero-app-bar', 'aria-label': t('Por dónde va', 'Position') }),
    now: el(doc, 'small'), long: el(doc, 'small'), prev: button('zero-app-prev', t('Anterior', 'Previous')), play: button('zero-app-play', t('Reproducir', 'Play')), next: button('zero-app-next', t('Siguiente', 'Next')),
    open: el(doc, 'button', { type: 'button', class: 'zero-app-open' }, [t('Abrir Spotify', 'Open Spotify')]),
  };
  st.appBox = el(doc, 'div', { class: 'zero-music-app' }, [
    el(doc, 'div', { class: 'zero-app-cover' }, [a.art]), el(doc, 'div', { class: 'zero-app-text' }, [a.title, a.artist]),
    el(doc, 'div', { class: 'zero-app-line' }, [a.now, a.bar, a.long]), el(doc, 'div', { class: 'zero-app-buttons' }, [a.prev, a.play, a.next]), a.open,
  ]);
  st.panel.append(st.appBox);
  a.prev.addEventListener('click', () => appSpotify.prevTrack());
  a.next.addEventListener('click', () => appSpotify.nextTrack());
  a.play.addEventListener('click', () => appSpotify.play());
  a.open.addEventListener('click', () => appSpotify.abrir());
  a.bar.addEventListener('change', () => { appSpotify.seekTo((Number(a.bar.value) / 1000) * appSpotify.ahora.dura); a.bar.blur(); });
}

const minutes = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function paintApp(win, st) {
  const a = st.appUi, n = appSpotify.ahora, t = st.t;
  if (!a || !st.appBox) return;
  const on = appSpotify.isActive;
  st.appBox.toggleAttribute('off', !on);
  st.appBox.toggleAttribute('playing', n.suena);
  a.title.textContent = on ? n.titulo : t('Abre Spotify y pon algo', 'Open Spotify and play something');
  a.artist.textContent = on ? n.artista : t('Se controla desde aquí, con tu cuenta, gratis o Premium.', 'Control it from here, with your account, free or Premium.');
  if (n.portada) { if (a.art.getAttribute('src') !== n.portada) a.art.setAttribute('src', n.portada); a.art.hidden = false; } else a.art.hidden = true;
  a.now.textContent = minutes(n.va); a.long.textContent = minutes(n.dura);
  a.bar.disabled = !n.puede.ir;
  if (win.document.activeElement !== a.bar) a.bar.value = String(n.dura ? Math.round((n.va / n.dura) * 1000) : 0);
  a.prev.disabled = !n.puede.anterior; a.next.disabled = !n.puede.siguiente; a.play.disabled = !on;
  const label = n.suena ? t('Pausa', 'Pause') : t('Reproducir', 'Play');
  a.play.title = label; a.play.setAttribute('aria-label', label);
}

/** Se pregunta a la app mientras se ve (el panel o el minipanel). */
function useApp(st) {
  const wanted = st.isApp && st.view !== 'closed';
  if (wanted && !st.stopApp) st.stopApp = appSpotify.usar();
  else if (!wanted && st.stopApp) { st.stopApp(); st.stopApp = null; }
}

/** Cambia de servicio (desde la lista, o al pasar de la web de Spotify a su app). */
function choose(win, st, id) {
  try {
    st.host.prefs.setStringPref(prefName(st.host.prefix, SERVICE_PREF), id);
    // Otro servicio, con el ancho que pida su web.
    st.host.prefs.clearUserPref(prefName(st.host.prefix, WIDTH_PREF));
  } catch { /* sin ajustes */ }
  ensurePanel(win, st, serviceOf(id));
  show(win, st, 'open');
}

/** El reproductor que se ha elegido suena sin un clic dentro de su web. Con el autoplay con sonido bloqueado (lo de
 *  serie), un play() que no venga de un clic en la página falla: al abrir el panel (la web retoma lo que sonaba) o al
 *  usar el minipanel, la isla o las teclas multimedia, que son de Zero y no de la web. Spotify lo toma por una
 *  canción que no se puede poner y pasa a la siguiente (Risco, 12-11: «te pasa las 3 primeras canciones»). El
 *  permiso es del origen del servicio y solo para esta sesión. */
function allowAutoplay(url) {
  try {
    const principal = Services.scriptSecurityManager.createContentPrincipalFromOrigin(new URL(url).origin);
    Services.perms.addFromPrincipal(principal, 'autoplay-media', Ci.nsIPermissionManager.ALLOW_ACTION, Ci.nsIPermissionManager.EXPIRE_SESSION);
  } catch { /* una dirección sin origen */ }
}

const esSpotify = st => { try { return new URL(st.serviceUrl).hostname === 'open.spotify.com'; } catch { return false; } };

/** La DRM que pide la web del panel: apagada, la barra para activarla; sin Widevine (Gecko ya lo está
 *  descargando), la barra lo dice y la web se recarga al quedar instalado; lista (cuando la web crea sus claves),
 *  sin barra. */
function drmStatus(st, status) {
  if (status === 'api-disabled' || status === 'cdm-disabled') showDrm(st, 'off');
  else if (status === 'cdm-not-installed') { showDrm(st, 'installing'); reloadWhenInstalled(st); }
  else if (status === 'available' || status === 'cdm-created') showDrm(st, null);
}

/** 'off' (apagada: el aviso y su botón), 'installing' (solo el aviso), 'denied' (Spotify no ha dado la licencia: su app) o
 *  null (sin barra). */
function showDrm(st, view) {
  st.drm.hidden = !view;
  st.drmView = view;
  if (!view) return;
  const name = st.title.textContent;
  st.drmText.textContent = view === 'off'
    ? st.t(`${name} necesita la DRM (contenido protegido) para sonar.`, `${name} needs DRM (protected content) to play.`)
    : view === 'denied' ? st.t('Spotify no deja sonar su web aquí. Con su app, sí.', 'Spotify will not play its website here. Its app will.')
    : st.t('Instalando la DRM (Widevine)…', 'Installing DRM (Widevine)…');
  st.drmButton.textContent = view === 'denied' ? st.t('Usar la app', 'Use the app') : st.t('Activar DRM', 'Enable DRM');
  st.drmButton.hidden = view === 'installing';
}

/** Lo mismo que el botón de la barra de Gecko: la enciende (también Widevine, si se apagó) y recarga la web; al
 *  encenderla, Gecko instala Widevine si falta, y la web se recarga cuando lo tiene. */
function enableDrm(st) {
  Services.prefs.setBoolPref('media.eme.enabled', true);
  if (Services.prefs.getPrefType('media.gmp-widevinecdm.enabled') && !Services.prefs.getBoolPref('media.gmp-widevinecdm.enabled')) {
    Services.prefs.setBoolPref('media.gmp-widevinecdm.enabled', true);
  }
  // Spotify en Windows va con la DRM del sistema (zero-spotify): no hay nada que descargar.
  if (esSpotify(st) && conPlayReady()) { showDrm(st, null); st.browser?.reload(); return; }
  showDrm(st, 'installing');
  reloadWhenInstalled(st);
}

// Con Widevine, la barra se va y la web se recarga (si vuelve a fallar, la vuelve a sacar).
function reloadWhenInstalled(st) {
  if (st.drmWait) return;
  st.drmWait = () => {
    if (!Services.prefs.getStringPref(WIDEVINE_PREF, '')) return;
    stopDrmWait(st);
    showDrm(st, null);
    st.browser?.reload();
  };
  Services.prefs.addObserver(WIDEVINE_PREF, st.drmWait);
  st.drmWait();
}

function stopDrmWait(st) {
  if (!st.drmWait) return;
  Services.prefs.removeObserver(WIDEVINE_PREF, st.drmWait);
  st.drmWait = null;
}

/** Lo que dice el controlador de medios de Gecko (lo que suena), en el minipanel. */
function watchController(win, st) {
  const update = () => paintMini(win, st);
  const hook = () => {
    // El zoom va con la web: si cambia de proceso al cargar, se vuelve a poner.
    applyZoom(st);
    const controller = controllerOf(st);
    if (controller === st.controller) return;
    if (st.controller) for (const name of EVENTS) st.controller.removeEventListener(name, update);
    st.controller = controller;
    if (controller) for (const name of EVENTS) controller.addEventListener(name, update);
    update();
  };
  win.clearInterval(st.hooking);
  // El controlador cambia con el proceso de la web (al cargar): se vuelve a mirar de vez en cuando.
  st.hooking = win.setInterval(hook, 1000);
  hook();
}

function paintMini(win, st) {
  if (st.isApp) paintApp(win, st);
  const controller = st.controller;
  let meta = null;
  try { meta = controller?.getMetadata(); } catch { /* la web no dice nada */ }
  const title = meta?.title || st.browser?.contentTitle || st.title?.textContent || '';
  st.miniTitle.textContent = title;
  st.miniArtist.textContent = meta?.artist || '';
  const art = meta?.artwork?.at(-1)?.src ?? null;
  if (art) { if (st.miniArt.getAttribute('src') !== art) st.miniArt.setAttribute('src', art); st.miniArt.hidden = false; }
  else st.miniArt.hidden = true;
  const playing = !!controller?.isPlaying;
  st.mini.toggleAttribute('playing', playing);
  st.mini.querySelector('.zero-mini-play').setAttribute('aria-label', playing ? st.t('Pausa', 'Pause') : st.t('Reproducir', 'Play'));
}

/** Dónde va el minipanel: donde se dejó (dentro de la ventana) o abajo a la derecha. */
function placeMini(win, st) {
  let at = null;
  try { at = JSON.parse(st.host.prefs.getStringPref(prefName(st.host.prefix, MINI_PREF), 'null')); } catch { /* de serie */ }
  const w = st.mini.offsetWidth || 300, h = st.mini.offsetHeight || 64;
  const x = at ? at.x : win.innerWidth - w - 40, y = at ? at.y : win.innerHeight - h - 40;
  st.mini.style.left = `${Math.round(Math.min(Math.max(4, x), win.innerWidth - w - 4))}px`;
  st.mini.style.top = `${Math.round(Math.min(Math.max(4, y), win.innerHeight - h - 4))}px`;
}

/** 'open' (el panel), 'mini' (el minipanel) o 'closed' (nada a la vista; la música sigue). */
function show(win, st, view) {
  st.view = view;
  st.panel?.toggleAttribute('open', view === 'open');
  st.mini.toggleAttribute('open', view === 'mini');
  st.anchor?.toggleAttribute('on', view !== 'closed');
  // Con el panel a la vista se pinta; si no, como una pestaña de fondo: no se pinta, pero sigue sonando.
  try { if (st.browser) st.browser.docShellIsActive = view === 'open'; } catch { /* sin esa propiedad */ }
  if (view === 'mini') { placeMini(win, st); paintMini(win, st); }
  if (view === 'open') layoutPanel(win, st);
  if (st.isApp) paintApp(win, st);
  useApp(st);
}

/** Junto a la columna, con el ancho que pide su web (o el que se le dejó) dentro de la ventana. */
function layoutPanel(win, st, chosen = readWidth(st.host)) {
  const dock = win.document.getElementById('zero-dock')?.getBoundingClientRect();
  const left = Math.round((dock?.right ?? 50) + 12);
  // Con el mismo margen a la derecha que abajo.
  const { width, zoom } = fitMusic({ need: st.need, chosen, room: win.innerWidth - left - 26 });
  st.panel.style.left = `${left}px`;
  st.panel.style.width = `${width}px`;
  st.zoom = zoom;
  applyZoom(st);
}

function applyZoom(st) {
  try { if (st.browser && st.zoom && Math.abs(st.browser.fullZoom - st.zoom) > 0.001) st.browser.fullZoom = st.zoom; } catch { /* aún sin web */ }
}

/** El borde derecho del panel: se arrastra para estrecharlo o ensancharlo (y se queda así); doble clic, el
 *  ancho de serie. */
function resizeEdge(win, st) {
  const edge = el(win.document, 'div', { class: 'zero-music-edge', title: st.t('Arrastrar para cambiar el ancho', 'Drag to resize') });
  let drag = null, frame = 0;
  const move = event => {
    if (!drag) return;
    drag.width = Math.max(MUSIC_MIN_WIDTH, Math.round(drag.from + event.clientX - drag.x));
    // Un cambio de ancho por fotograma: la web se recoloca con cada uno.
    frame ||= win.requestAnimationFrame(() => { frame = 0; if (drag) layoutPanel(win, st, drag.width); });
  };
  const drop = event => {
    if (!drag) return;
    const { width } = drag;
    drag = null;
    try { edge.releasePointerCapture(event.pointerId); } catch { /* ya suelto */ }
    st.panel.removeAttribute('resizing');
    if (!width) return; // un clic, sin arrastrar
    // Se guarda el que se ve (dentro de la ventana).
    layoutPanel(win, st, width);
    try { st.host.prefs.setIntPref(prefName(st.host.prefix, WIDTH_PREF), parseInt(st.panel.style.width, 10)); } catch { /* sin ajustes */ }
  };
  edge.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, from: st.panel.getBoundingClientRect().width, width: 0 };
    st.panel.setAttribute('resizing', '');
    try { edge.setPointerCapture(event.pointerId); } catch { /* sin captura */ }
  });
  edge.addEventListener('pointermove', move);
  edge.addEventListener('pointerup', drop);
  edge.addEventListener('lostpointercapture', drop);
  edge.addEventListener('dblclick', () => {
    try { st.host.prefs.clearUserPref(prefName(st.host.prefix, WIDTH_PREF)); } catch { /* sin ajustes */ }
    layoutPanel(win, st);
  });
  return edge;
}

function openServices(win, st) {
  const r = (st.anchor ?? win.document.getElementById('zero-dock') ?? win.document.body).getBoundingClientRect();
  st.services.style.left = `${Math.round(r.right + 14)}px`;
  st.services.style.top = `${Math.round(r.top)}px`;
  st.services.setAttribute('open', '');
}
const closeServices = st => st.services.removeAttribute('open');

export function attach(win, ctx) {
  const doc = win.document, { host } = ctx;
  const dock = doc.getElementById('zero-dock');
  if (!dock) return;
  const t = host.t ?? (es => es);
  const st = { host, t, cleanups: [], view: 'closed' };
  state.set(win, st);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };

  st.button = el(doc, 'button', { type: 'button', class: 'zero-music', title: t('Música', 'Music'), 'aria-label': t('Música', 'Music') },
    [el(doc, 'span', { class: 'zero-fav', 'aria-hidden': 'true' })]);
  // En su pastilla, aparte de los accesos directos (Risco, 15-10) y justo encima de ellos. En la variante
  // «Sobrio» no se ve: allí la música se abre desde el panel de sonido (zero-audio, «Música → Abrir»).
  st.pill = el(doc, 'div', { id: 'zero-music-pill', class: 'zero-pill', role: 'group', 'aria-label': t('Música', 'Music') }, [st.button]);
  const shortcutsPill = doc.getElementById('zero-shortcuts');
  if (shortcutsPill?.parentNode === dock) shortcutsPill.before(st.pill); else dock.append(st.pill);
  st.anchor = st.button;
  st.services = el(doc, 'div', { id: 'zero-music-services', role: 'menu', 'aria-label': t('Servicio de música', 'Music service') },
    [...SERVICES, ...(hayAppSpotify() ? [{ id: APP.id, name: t('Spotify (su app)', 'Spotify (its app)') }] : [])]
      .map(service => el(doc, 'button', { type: 'button', role: 'menuitem', 'data-service': service.id }, [service.name])));
  st.miniArt = el(doc, 'img', { class: 'zero-mini-art', alt: '', hidden: 'true' });
  st.miniTitle = el(doc, 'span', { class: 'zero-mini-title' });
  st.miniArtist = el(doc, 'span', { class: 'zero-mini-artist' });
  const control = (cls, label) => el(doc, 'button', { type: 'button', class: cls, 'aria-label': label, title: label });
  st.mini = el(doc, 'div', { id: 'zero-mini', role: 'group', 'aria-label': t('Lo que suena', 'Now playing') }, [
    el(doc, 'div', { class: 'zero-mini-grip', title: t('Arrastrar', 'Drag') }, [st.miniArt, el(doc, 'span', { class: 'zero-mini-text' }, [st.miniTitle, st.miniArtist])]),
    control('zero-mini-prev', t('Anterior', 'Previous')), control('zero-mini-play', t('Reproducir', 'Play')), control('zero-mini-next', t('Siguiente', 'Next')),
    control('zero-mini-open', t('Abrir el reproductor', 'Open the player')), control('zero-mini-close', t('Cerrar', 'Close')),
  ]);
  doc.body.append(st.services, st.mini);
  st.cleanups.push(() => {
    win.clearInterval(st.hooking);
    if (st.controller) for (const name of EVENTS) { try { st.controller.removeEventListener(name, paintMini); } catch { /* ya no está */ } }
    st.anchor?.removeAttribute('on'); st.pill.remove(); st.services.remove(); st.mini.remove(); st.panel?.remove();
  });

  st.button.addEventListener('click', () => openMusic(win, st.button));
  st.services.addEventListener('click', event => {
    const button = event.target.closest('[data-service]');
    if (!button) return;
    closeServices(st);
    choose(win, st, button.dataset.service);
  });
  // Si el servidor de Spotify niega la licencia en el panel, se ofrece su app (con una que dé después, la barra se va).
  st.cleanups.push(alLicencia(({ dada }) => {
    if (!esSpotify(st) || !hayAppSpotify()) return;
    if (!dada) showDrm(st, 'denied'); else if (st.drmView === 'denied') showDrm(st, null);
  }));
  st.cleanups.push(() => { st.stopApp?.(); st.stopApp = null; });
  listen(win, 'mousedown', event => { if (st.services.hasAttribute('open') && !st.services.contains(event.target) && !st.anchor?.contains(event.target)) closeServices(st); }, true);
  listen(win, 'keydown', event => { if (event.key === 'Escape') closeServices(st); }, true);

  const act = name => () => drive(st, name);
  st.mini.querySelector('.zero-mini-play').addEventListener('click', act('play'));
  st.mini.querySelector('.zero-mini-next').addEventListener('click', act('next'));
  st.mini.querySelector('.zero-mini-prev').addEventListener('click', act('prev'));
  st.mini.querySelector('.zero-mini-open').addEventListener('click', () => show(win, st, 'open'));
  st.mini.querySelector('.zero-mini-close').addEventListener('click', () => show(win, st, 'closed'));

  // Se arrastra desde su portada y su título, y se queda donde se suelta.
  const grip = st.mini.querySelector('.zero-mini-grip');
  let drag = null;
  const move = event => {
    if (!drag) return;
    st.mini.style.left = `${Math.round(Math.min(Math.max(4, event.clientX - drag.dx), win.innerWidth - st.mini.offsetWidth - 4))}px`;
    st.mini.style.top = `${Math.round(Math.min(Math.max(4, event.clientY - drag.dy), win.innerHeight - st.mini.offsetHeight - 4))}px`;
  };
  const drop = () => {
    if (!drag) return;
    drag = null;
    win.removeEventListener('pointermove', move, true); win.removeEventListener('pointerup', drop, true);
    st.mini.removeAttribute('dragging');
    try { host.prefs.setStringPref(prefName(host.prefix, MINI_PREF), JSON.stringify({ x: parseFloat(st.mini.style.left), y: parseFloat(st.mini.style.top) })); } catch { /* sin ajustes */ }
  };
  grip.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const r = st.mini.getBoundingClientRect();
    drag = { dx: event.clientX - r.left, dy: event.clientY - r.top };
    st.mini.setAttribute('dragging', '');
    win.addEventListener('pointermove', move, true); win.addEventListener('pointerup', drop, true);
  });
  st.cleanups.push(() => { win.removeEventListener('pointermove', move, true); win.removeEventListener('pointerup', drop, true); });
  listen(win, 'resize', () => { if (st.view === 'mini') placeMini(win, st); if (st.view === 'open') layoutPanel(win, st); });
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}
