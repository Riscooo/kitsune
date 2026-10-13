/* Usuarios de Kitsune en la misma ventana, como las cuentas de Google.
 *
 * Todos viven en el perfil de Gecko en marcha: el usuario base (el del perfil) sin
 * contenedor y cada uno de los demás en su contenedor (contextual identity), con sus
 * propias cookies, sesiones y datos de las webs. Historial, marcadores, contraseñas y
 * extensiones son comunes.
 *
 * - Usuarios: los del registro del inicio (en Linux, el de profiles.py; en el inicio
 *   integrado, kitsune-profiles.json). Se vuelve a leer cuando cambia.
 * - Contenedores: uno por usuario, con su nombre y su color. Qué contenedor es de quién
 *   se guarda en <perfil>/kitsune-users.json. Los cuatro de ejemplo de Gecko se quitan
 *   una vez si no tienen pestañas ni cookies.
 * - Cambiar de usuario: la pestaña se sustituye en su sitio por el inicio en el
 *   contenedor del otro usuario. Las demás pestañas no se tocan.
 * - Linux (inicio en el servidor local): cada petición a ese servidor lleva la cabecera
 *   X-Kitsune-Usuario con el usuario del contenedor que la hace (por encima de lo que
 *   ponga la página), y «/?cambiar=<id>» pedido por el propio inicio es la orden de
 *   cambiar esa pestaña.
 */
const INTEGRATED_HOME = 'moz-extension://4b1d7c2e-9a3f-4e6b-8c51-2f7a0d9e6b13/start/index.html';
const USER_ID = /^(default|p-[0-9a-f]{16})$/;
const HEADER = 'X-Kitsune-Usuario';
const MAP_FILE = 'kitsune-users.json';
const SAMPLES_PREF = 'kitsune.users.samplesRemoved';
const SAMPLES = Object.freeze(['user-context-personal', 'user-context-work', 'user-context-banking', 'user-context-shopping']);
// Los seis colores de los usuarios de Kitsune, en los de los contenedores de Gecko.
export const GECKO_COLORS = Object.freeze({ blue: 'blue', pink: 'pink', violet: 'purple', teal: 'turquoise', amber: 'orange', red: 'red' });

/** <perfil>/kitsune-users.json → Map(id → userContextId). Si no se entiende, vacío. */
export function parseContainerMap(text) {
  const map = new Map();
  let value;
  try { value = JSON.parse(text); } catch { return map; }
  if (!value || value.version !== 1 || !value.containers || typeof value.containers !== 'object' || Array.isArray(value.containers)) return map;
  const used = new Set();
  for (const [id, context] of Object.entries(value.containers)) {
    if (!USER_ID.test(id) || !Number.isSafeInteger(context) || context <= 0 || used.has(context)) return new Map();
    used.add(context);
    map.set(id, context);
  }
  return map;
}

/** La página de inicio: el servidor local de Linux o el inicio integrado. */
export function homeKind(url) {
  const server = /^http:\/\/127\.0\.0\.1:([0-9]{2,5})\/$/.exec(url ?? '');
  if (server && Number(server[1]) > 0 && Number(server[1]) < 65536) {
    return { kind: 'server', origin: `http://127.0.0.1:${Number(server[1])}`, port: Number(server[1]) };
  }
  return url === INTEGRATED_HOME ? { kind: 'integrated' } : null;
}

/** El usuario al que cambiar si la carga es «/?cambiar=<id>» del inicio, pedida por el propio inicio. */
export function switchTarget({ url, triggeringOrigin, homeOrigin, isDocument }) {
  if (!isDocument || !homeOrigin || triggeringOrigin !== homeOrigin) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.origin !== homeOrigin || parsed.pathname !== '/' || parsed.hash) return null;
  const params = [...parsed.searchParams];
  if (params.length !== 1 || params[0][0] !== 'cambiar' || !USER_ID.test(params[0][1])) return null;
  return params[0][1];
}

/** El usuario de un contenedor; null para «sin contenedor» o uno que no es de ningún usuario. */
export function userForContainer(map, context) {
  if (!context) return null;
  for (const [id, value] of map) if (value === context) return id;
  return null;
}

const samePath = (a, b) => String(a).replace(/[\\/]+$/, '').toLowerCase() === String(b).replace(/[\\/]+$/, '').toLowerCase();

/** Registro del inicio → usuarios (id, nombre, color) y el usuario base. null si no se entiende. */
export function parseRegistry(value, kind, profileDir) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.profiles)) return null;
  const users = [];
  for (const profile of value.profiles) {
    if (!profile || !USER_ID.test(profile.id) || typeof profile.name !== 'string' || !profile.name || !Object.hasOwn(GECKO_COLORS, profile.color)) return null;
    users.push({ id: profile.id, name: profile.name, color: profile.color, path: typeof profile.path === 'string' ? profile.path : null });
  }
  // En Linux el base es siempre «default»; en el integrado, la ficha de este perfil de Gecko.
  const base = kind === 'server' ? users.find(user => user.id === 'default') : users.find(user => user.path && samePath(user.path, profileDir));
  if (!base) return null;
  return { users: users.map(({ id, name, color }) => ({ id, name, color })), baseId: base.id };
}

const state = { users: [], baseId: null, map: new Map(), mapLoaded: false, stamp: null, home: null };
let started = false, timer = null;

const timers = () => ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
const identities = () => ChromeUtils.importESModule('moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs').ContextualIdentityService;
const homeURL = () => Services.prefs.getStringPref('browser.startup.homepage', '').split('|')[0];

function registryPath(kind) {
  if (kind === 'server') {
    const home = Services.dirsvc.get('Home', Ci.nsIFile).path;
    const root = Services.env.get('KITSUNE_STATE_ROOT') ||
      PathUtils.join(Services.env.get('XDG_STATE_HOME') || PathUtils.join(home, '.local', 'state'), 'kitsune-browser');
    return PathUtils.join(root, 'profiles.json');
  }
  const root = Services.prefs.getStringPref('kitsune.home.profilesRoot', '') || Services.dirsvc.get('UAppData', Ci.nsIFile).path;
  return PathUtils.join(root, 'kitsune-profiles.json');
}
const mapPath = () => PathUtils.join(PathUtils.profileDir, MAP_FILE);

async function loadMap() {
  if (state.mapLoaded) return;
  try { state.map = parseContainerMap(new TextDecoder().decode(await IOUtils.read(mapPath(), { maxBytes: 65536 }))); } catch { state.map = new Map(); }
  state.mapLoaded = true;
}
async function saveMap() {
  await IOUtils.writeJSON(mapPath(), { version: 1, containers: Object.fromEntries(state.map) }, { tmpPath: mapPath() + '.tmp' });
}

/** Un contenedor por usuario (salvo el base), con su nombre y su color. */
function syncContainers() {
  const service = identities();
  let changed = false;
  for (const user of state.users) {
    if (user.id === state.baseId) continue;
    const color = GECKO_COLORS[user.color];
    const context = state.map.get(user.id);
    const identity = context ? service.getPublicIdentityFromId(context) : null;
    if (identity) {
      if (identity.name !== user.name || identity.color !== color) service.update(context, user.name, 'circle', color);
    } else {
      state.map.set(user.id, service.create(user.name, 'circle', color).userContextId);
      changed = true;
    }
  }
  if (changed) void saveMap().catch(() => {});
}

async function refresh(force = false) {
  state.home = homeKind(homeURL());
  await loadMap();
  const kind = state.home?.kind ?? 'integrated';
  const path = registryPath(kind);
  let info;
  try { info = await IOUtils.stat(path); } catch { return; }
  const stamp = `${info.lastModified}:${info.size}`;
  if (stamp === state.stamp && !force) return;
  let registry = null;
  try { registry = parseRegistry(JSON.parse(new TextDecoder().decode(await IOUtils.read(path, { maxBytes: 256 * 1024 }))), kind, PathUtils.profileDir); } catch { /* se reintenta en la próxima vuelta */ }
  if (!registry) return;
  state.stamp = stamp;
  state.users = registry.users;
  state.baseId = registry.baseId;
  syncContainers();
}

/** Fuera los cuatro contenedores de ejemplo de Gecko, una vez y solo si nunca se usaron. */
function removeSamples() {
  if (Services.prefs.getBoolPref(SAMPLES_PREF, false)) return;
  const service = identities();
  const open = new Set();
  for (const win of Services.wm.getEnumerator('navigator:browser')) for (const tab of win.gBrowser?.tabs ?? []) open.add(tab.userContextId);
  for (const identity of service.getPublicIdentities()) {
    if (!SAMPLES.includes(identity.l10nId) || open.has(identity.userContextId)) continue;
    if (Services.cookies.getCookiesWithOriginAttributes(JSON.stringify({ userContextId: identity.userContextId })).length) continue;
    service.remove(identity.userContextId);
  }
  Services.prefs.setBoolPref(SAMPLES_PREF, true);
}

/** Sustituye la pestaña por el inicio del usuario `id`, en su sitio. false si no hay nada que hacer. */
function switchTab(tab, id) {
  const gBrowser = tab?.ownerGlobal?.gBrowser;
  if (!gBrowser || !state.users.some(user => user.id === id)) return false;
  // En una ventana privada no hay contenedores.
  if (tab.ownerGlobal.PrivateBrowsingUtils?.isWindowPrivate(tab.ownerGlobal)) return false;
  if (id !== state.baseId) syncContainers();
  const context = id === state.baseId ? 0 : state.map.get(id);
  if (context === undefined || tab.userContextId === context) return false;
  const fresh = gBrowser.addTab(homeURL(), {
    userContextId: context, tabIndex: tab._tPos + 1, skipAnimation: true, pinned: tab.pinned,
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  if (gBrowser.selectedTab === tab) gBrowser.selectedTab = fresh;
  gBrowser.removeTab(tab, { animate: false });
  return true;
}

// Linux: la cabecera con el usuario y la orden de cambio, solo para el servidor del inicio.
const httpObserver = {
  observe(subject) {
    const home = state.home;
    if (home?.kind !== 'server') return;
    let channel;
    try { channel = subject.QueryInterface(Ci.nsIHttpChannel); } catch { return; }
    const uri = channel.URI;
    if (uri.scheme !== 'http' || uri.host !== '127.0.0.1' || uri.port !== home.port) return;
    const info = channel.loadInfo;
    channel.setRequestHeader(HEADER, userForContainer(state.map, info.originAttributes?.userContextId ?? 0) ?? state.baseId ?? 'default', false);
    const triggering = info.triggeringPrincipal;
    const target = switchTarget({
      // Sin el sufijo del contenedor (^userContextId=N): también se cambia desde el inicio de otro usuario.
      url: uri.spec, homeOrigin: home.origin, triggeringOrigin: triggering?.isContentPrincipal ? triggering.originNoSuffix : null,
      isDocument: info.externalContentPolicyType === Ci.nsIContentPolicy.TYPE_DOCUMENT,
    });
    if (!target) return;
    channel.cancel(Cr.NS_BINDING_ABORTED);
    const browser = info.browsingContext?.top?.embedderElement;
    const tab = browser?.ownerGlobal?.gBrowser?.getTabForBrowser(browser);
    // Un usuario recién creado puede no estar aún en la lista: se relee el registro antes.
    if (tab) void refresh(true).then(() => switchTab(tab, target)).catch(() => {});
  },
};

export const KitsuneUsers = {
  start() {
    if (started) return;
    started = true;
    state.home = homeKind(homeURL());
    Services.obs.addObserver(httpObserver, 'http-on-modify-request');
    Services.obs.addObserver(this, 'quit-application-granted');
    void refresh().then(() => removeSamples()).catch(() => {});
    timer = timers().setInterval(() => void refresh().catch(() => {}), 3000);
  },
  observe() {
    timers().clearInterval(timer);
    timer = null;
    try { Services.obs.removeObserver(httpObserver, 'http-on-modify-request'); } catch { /* ya no estaba */ }
    try { Services.obs.removeObserver(this, 'quit-application-granted'); } catch { /* ya no estaba */ }
  },
  /** Vuelve a leer el registro (el inicio integrado lo llama tras guardar). */
  refresh: () => refresh(true),
  /** Id del usuario del contenedor de un <browser>; null si es el base o no es de nadie. */
  async userFor(browser) {
    await loadMap();
    return userForContainer(state.map, Number(browser?.getAttribute('usercontextid')) || 0);
  },
  /** El contenedor del usuario `id` (0 el base), creándolo si hace falta; null si no es un usuario. */
  async contextFor(id) {
    await refresh(true);
    if (!state.users.some(user => user.id === id)) return null;
    if (id === state.baseId) return 0;
    syncContainers();
    return state.map.get(id) ?? null;
  },
  /** Cambia la pestaña de ese <browser> al usuario `id`. */
  async switchBrowser(browser, id) {
    await refresh(true);
    const tab = browser?.ownerGlobal?.gBrowser?.getTabForBrowser(browser);
    return tab ? switchTab(tab, id) : false;
  },
};
