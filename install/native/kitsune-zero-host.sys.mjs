/* Kitsune como anfitrión de Kitsune Zero (zero/, en chrome://browser/content/zero/).
 *
 * Zero no conoce a Kitsune: este módulo le da lo que necesita, que es lo único que cambiaría si
 * Zero saliera como navegador aparte. Le pasa los textos en el idioma de Kitsune, los ajustes
 * (con el prefijo kitsune.zero.), los atajos (en su propio <keyset>, como los de kitsune-layout),
 * los espacios y las pestañas de paso (para el raíl) y si está el modo ahorro (para el cristal en vivo).
 */
// Textos en el idioma de Kitsune (kitsune-i18n.sys.mjs); sin Gecko, en castellano.
const t = (spanish, english) => {
  try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-i18n.sys.mjs').t(spanish, english); } catch { return spanish; }
};
const ZERO = 'chrome://browser/content/zero/zero.sys.mjs';
let started = false;

/** Un atajo de Zero en su keyset (una tecla, o una con nombre: «VK_ESCAPE»). Gecko lee un <keyset> solo
 *  al conectarlo: se vuelve a conectar. */
function addKey(win, id, key, modifiers, run) {
  const doc = win.document;
  if (doc.getElementById(id)) return;
  const keyset = doc.getElementById('kitsune-zero-keys') ?? Object.assign(doc.createXULElement('keyset'), { id: 'kitsune-zero-keys' });
  const node = doc.createXULElement('key');
  node.id = id;
  node.setAttribute(key.startsWith('VK_') ? 'keycode' : 'key', key);
  if (modifiers) node.setAttribute('modifiers', modifiers);
  node.addEventListener('command', run);
  keyset.remove();
  keyset.append(node);
  doc.documentElement.append(keyset);
}

// Los espacios de Kitsune, para el raíl de Zero: la lista, el de la ventana, cambiar y enterarse de
// los cambios. Los espacios no avisan; al cambiar repintan sus tiras (.kitsune-spaces) y marcan la
// raíz, y eso es lo que se vigila.
const spacesModule = () => {
  try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs').KitsuneSpaces; } catch { return null; }
};
const spaces = {
  list: () => (spacesModule()?.list().spaces ?? []).map(({ id, name, icon, color }) => ({ id, name, icon, color })),
  current: win => spacesModule()?.active(win) ?? null,
  select: (win, id) => spacesModule()?.switchTo(win, id),
  /** El editor de «Nuevo espacio» de Kitsune, junto a `anchor` (en Zero, la bolita del perfil). */
  openEditor: (win, anchor) => spacesModule()?.openEditor(win, anchor),
  // Crear, cambiar (nombre, color, icono; lo demás se queda) y borrar (sus pestañas pasan al primero que
  // quede; nunca el último): la ficha de perfil de Zero.
  create: spec => spacesModule()?.create(spec) ?? null,
  edit: (id, patch) => spacesModule()?.edit(id, patch),
  remove: id => spacesModule()?.remove(id),
  // Sus sesiones: 'own' (las suyas, en su contenedor), 'shared' o el id de un usuario de Kitsune; null si este
  // Kitsune aún no sabe (entonces la ficha no las enseña).
  sessions: id => spacesModule()?.sessions?.(id) ?? null,
  setSessions: (id, choice) => spacesModule()?.setSessions?.(id, choice),
  watch(win, fn) {
    const doc = win.document;
    const observer = new win.MutationObserver(() => fn());
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['kitsune-space-color', 'kitsune-spaces-many'] });
    for (const strip of doc.querySelectorAll('.kitsune-spaces')) observer.observe(strip, { childList: true });
    return () => observer.disconnect();
  },
};

// El modo ahorro de Kitsune: con él, el cristal en vivo repinta a 15 fps.
const saver = { get active() { return Services.prefs.getStringPref('kitsune.performance.applied', 'normal') === 'ahorro'; } };

// Las pestañas «de paso», que el raíl no enseña: la vista rápida (va unida a la de debajo).
const tabs = { passing: tab => tab.hasAttribute('kitsune-glance') };

// Los usuarios de Kitsune: Zero los lee de los contenedores de Gecko; de aquí, el nombre del base.
const users = {
  baseName() {
    try {
      const { KitsuneUsers } = ChromeUtils.importESModule('chrome://browser/content/kitsune-users.sys.mjs');
      const { users: list, baseId } = KitsuneUsers.list();
      return list.find(user => user.id === baseId)?.name ?? null;
    } catch { return null; }
  },
  /** El nombre de un usuario de Kitsune (para la ficha de un perfil que va con él), o null. */
  nameOf(id) {
    try {
      const { KitsuneUsers } = ChromeUtils.importESModule('chrome://browser/content/kitsune-users.sys.mjs');
      return KitsuneUsers.list().users.find(user => user.id === id)?.name ?? null;
    } catch { return null; }
  },
};

// Kitsune Zero como navegador aparte (su paquete pone kitsune.product = "zero"): todas sus ventanas son Zero y no hay
// atajo ni fila del menú para entrar o salir. Sin eso (las pruebas, que lo encienden a mano), Zero se entra y se sale.
const isApp = () => { try { return Services.prefs.getStringPref('kitsune.product', 'kitsune') === 'zero'; } catch { return false; } };

// El modo de privacidad del perfil, Estricto o Cómodo, como en «Tu inicio» de Kitsune (Risco, 21-10: «que haya dos
// modos, como en Kitsune normal»). Se guarda en el user.js del perfil con el mismo código que usa el inicio
// (withProfileBlock) y lo aplica kitsune.cfg al arrancar: hace falta reiniciar.
const HOME_CORE = 'resource://builtin-addons/kitsune-home/api/core.sys.mjs';
const PRIVACY_MODES = ['estricto', 'comodo'];
const homeCore = () => {
  try { return ChromeUtils.importESModule(HOME_CORE); } catch { return null; }
};
export const privacy = {
  available: () => !!homeCore()?.withProfileBlock,
  /** El que lleva el perfil ahora (lo pone kitsune.cfg). */
  active: () => {
    const value = Services.prefs.getStringPref('kitsune.privacy.active', 'estricto');
    return PRIVACY_MODES.includes(value) ? value : 'estricto';
  },
  /** El que tendrá al volver a abrirse: el pedido, si hay uno; si no, el de ahora. */
  requested() {
    const value = Services.prefs.getStringPref('kitsune.privacy.requested', '');
    return PRIVACY_MODES.includes(value) ? value : this.active();
  },
  async request(mode) {
    const core = homeCore();
    if (!core?.withProfileBlock || !PRIVACY_MODES.includes(mode)) return false;
    const file = PathUtils.join(PathUtils.profileDir, 'user.js');
    let text = '';
    try { text = await IOUtils.readUTF8(file); } catch { /* aún no hay user.js */ }
    await IOUtils.writeUTF8(file, core.withProfileBlock(text, mode));
    Services.prefs.setStringPref('kitsune.privacy.requested', mode);
    return true;
  },
  restart: () => Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart),
};

const host = () => ({ t, prefs: Services.prefs, prefix: 'kitsune.zero.', app: isApp(), keys: { add: addKey }, spaces, saver, tabs, users, privacy });

// ---------------------------------------------------------------- traer el perfil de Kitsune (la primera vez)

// Kitsune Zero es otro navegador, con su perfil (Gecko da uno propio a cada instalación). La primera vez trae una copia
// del de Kitsune (Risco, 15-10): sesiones iniciadas, pestañas, contraseñas y perfiles de Zero; luego cada uno va por su
// lado. Solo con kitsune.zero.importProfile (lo pone el paquete de Zero); kitsune.zero.profileImport dice cómo quedó:
// 'waiting' (Kitsune estaba abierto: se intenta al volver a abrir), 'done', 'none' (no había) o 'kept' (sin traerlo).
const IMPORT_ON = 'kitsune.zero.importProfile';
const IMPORT = 'kitsune.zero.profileImport';

/** Lo que no se copia: cachés, bloqueos e informes que el navegador rehace solo. */
export const SKIP_FILES = new Set(['cache2', 'startupCache', 'shader-cache', 'thumbnails', 'crashes', 'minidumps', 'saved-telemetry-pings',
  'datareporting', 'safebrowsing', 'lock', '.parentlock', 'parent.lock', 'jumpListCache', 'OfflineCache']);

/** De los perfiles que hay, el que se trae: el último usado, con historial, que no sea el de Zero. */
export function pickProfile(candidates) {
  return candidates.filter(item => item.places && !item.current).sort((a, b) => b.used - a.used)[0] ?? null;
}

/** El proceso que tiene un perfil abierto en Linux (su «lock» apunta a «ip:+pid»), o null. */
export function lockPid(target) {
  const match = /:\+(\d+)$/.exec(String(target ?? ''));
  return match ? Number(match[1]) : null;
}

/** Los perfiles de Kitsune de este equipo: el del Kitsune de Risco (Linux, su lanzador) y los de profiles.ini. */
async function kitsuneProfiles(service) {
  const here = Services.dirsvc.get('ProfD', Ci.nsIFile);
  const found = [];
  const add = async (dir, profile) => {
    try {
      if (!dir?.exists() || dir.equals(here) || !(await IOUtils.exists(PathUtils.join(dir.path, 'places.sqlite')))) return;
      const prefs = await IOUtils.stat(PathUtils.join(dir.path, 'prefs.js')).catch(() => null);
      found.push({ dir, profile, places: true, current: false, used: prefs?.lastModified ?? 0 });
    } catch { /* no se puede leer */ }
  };
  if (Services.appinfo.OS === 'Linux') {
    const data = Services.env.get('XDG_DATA_HOME') || PathUtils.join(Services.dirsvc.get('Home', Ci.nsIFile).path, '.local', 'share');
    const dir = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
    dir.initWithPath(PathUtils.join(data, 'kitsune-browser', 'profile'));
    await add(dir, null);
  }
  for (const profile of service.profiles) await add(profile.rootDir, profile);
  return found;
}

/** ¿Lo tiene abierto un Kitsune? En Linux, el «lock» con su proceso; si no, intentando bloquearlo. */
function openElsewhere(source) {
  if (source.profile) {
    try { return { lock: source.profile.lock({}) }; } catch { return null; }
  }
  const lock = source.dir.clone();
  lock.append('lock');
  try {
    if (!lock.isSymlink()) return { lock: null };
    const pid = lockPid(lock.target);
    const proc = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
    proc.initWithPath(`/proc/${pid}`);
    return pid && proc.exists() ? null : { lock: null };
  } catch { return { lock: null }; }
}

async function copyProfile(from, to) {
  await IOUtils.makeDirectory(to, { createAncestors: true, permissions: 0o700 });
  for (const child of await IOUtils.getChildren(from)) {
    if (SKIP_FILES.has(PathUtils.filename(child))) continue;
    await IOUtils.copy(child, PathUtils.join(to, PathUtils.filename(child)), { recursive: true });
  }
  // El perfil copiado ya está traído: que no lo vuelva a intentar.
  const prefs = PathUtils.join(to, 'prefs.js');
  const text = (await IOUtils.readUTF8(prefs).catch(() => '')).replace(new RegExp(`^user_pref\\("${IMPORT.replace(/\./g, '\\.')}".*$`, 'gm'), '');
  await IOUtils.writeUTF8(prefs, `${text.trimEnd()}\nuser_pref("${IMPORT}", "done");\n`);
}

function notice(win, id, label, buttons = []) {
  try {
    const box = win.gNotificationBox;
    box.getNotificationWithValue(id)?.close();
    void box.appendNotification(id, { label, priority: box.PRIORITY_INFO_HIGH }, buttons);
  } catch { /* sin barra de avisos */ }
}

/** La primera vez de Kitsune Zero: copia el perfil de Kitsune, lo pone de serie y abre Kitsune Zero con él. Con
 *  `options` (las pruebas, que no deben tocar el profiles.ini de verdad): force, firstRun, profiles (en lugar de los
 *  del equipo), root (la carpeta donde va la copia), register (en lugar del servicio de perfiles) y launch (en lugar
 *  de abrir Kitsune Zero con él y cerrar este). */
async function bringKitsuneProfile(win, options = {}) {
  if (!options.force && !Services.prefs.getBoolPref(IMPORT_ON, false)) return null;
  const state = Services.prefs.getStringPref(IMPORT, '');
  if (state && state !== 'waiting') return null;
  const service = Cc['@mozilla.org/toolkit/profile-service;1'].getService(Ci.nsIToolkitProfileService);
  if (!state && !(options.firstRun ?? service.isFirstRun)) { Services.prefs.setStringPref(IMPORT, 'kept'); return null; }
  const source = pickProfile(options.profiles ?? await kitsuneProfiles(service));
  if (!source) { Services.prefs.setStringPref(IMPORT, 'none'); return null; }
  const held = openElsewhere(source);
  if (!held) {
    Services.prefs.setStringPref(IMPORT, 'waiting');
    notice(win, 'kitsune-zero-import', t('Para traer tu perfil de Kitsune (sesiones, pestañas y contraseñas), cierra Kitsune y vuelve a abrir Kitsune Zero.',
      'To bring your Kitsune profile (sign-ins, tabs and passwords), close Kitsune and open Kitsune Zero again.'),
      [{ label: t('Empezar sin él', 'Start without it'), callback: () => { Services.prefs.setStringPref(IMPORT, 'kept'); } }]);
    return 'waiting';
  }
  notice(win, 'kitsune-zero-import', t('Trayendo tu perfil de Kitsune…', 'Bringing your Kitsune profile…'));
  const target = options.root ?? Services.dirsvc.get('DefProfRt', Ci.nsIFile);
  target.append(`${Math.random().toString(36).slice(2, 10)}.kitsune-zero`);
  try {
    await copyProfile(source.dir.path, target.path);
  } finally {
    try { held.lock?.unlock(); } catch { /* ya se soltó */ }
  }
  const profile = options.register ? options.register(target) : service.createUniqueProfile(target, 'Kitsune Zero', 'kitsune-zero');
  if (!options.register) {
    try { service.defaultProfile = profile; } catch { /* esta compilación no deja cambiarlo: se abre igual */ }
    await service.asyncFlush();
  }
  Services.prefs.setStringPref(IMPORT, 'done');
  if (options.launch) options.launch(profile);
  else { Services.startup.createInstanceWithProfile(profile); Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit); }
  return target.path;
}

/** «Kitsune Zero» en el menú ≡ de Kitsune (con Retoques… y Copia…), con su atajo a la vista: entra, y
 *  dentro de Zero la misma fila dice «Salir de Kitsune Zero» y sale. */
const withMenu = new WeakSet();
function addMenuRow(win, Zero) {
  if (withMenu.has(win)) return;
  withMenu.add(win);
  const doc = win.document;
  const insert = () => {
    const settings = doc.getElementById('appMenu-settings-button');
    if (!settings) return;
    let button = doc.getElementById('appMenu-kitsune-zero');
    if (!button) {
      button = doc.createXULElement('toolbarbutton');
      button.id = 'appMenu-kitsune-zero';
      button.className = 'subviewbutton';
      button.addEventListener('command', () => { win.PanelUI?.hide?.(); Zero.toggle(win); });
      settings.before(button);
    }
    button.setAttribute('label', Zero.active(win) ? t('Salir de Kitsune Zero', 'Leave Kitsune Zero') : 'Kitsune Zero');
    const key = doc.getElementById('kitsune-zero-key');
    if (key) {
      try {
        const { ShortcutUtils } = ChromeUtils.importESModule('resource://gre/modules/ShortcutUtils.sys.mjs');
        button.setAttribute('shortcut', ShortcutUtils.prettifyShortcut(key));
      } catch { /* sin atajo a la vista */ }
    }
  };
  doc.addEventListener('ViewShowing', event => { if (event.target.id === 'appMenu-mainView') insert(); }, true);
}

export const KitsuneZeroHost = {
  /** Para las pruebas: traer un perfil de Kitsune como la primera vez (ver bringKitsuneProfile). */
  bringProfile: (win, options) => bringKitsuneProfile(win, options),
  decorate(win) {
    const { Zero } = ChromeUtils.importESModule(ZERO);
    if (!started) {
      Zero.start(host()); started = true;
      if (isApp()) void bringKitsuneProfile(win).catch(error => console.error('Kitsune Zero: no se pudo traer el perfil de Kitsune', error));
    }
    if (!isApp()) addMenuRow(win, Zero);
    return Zero.decorate(win);
  },
};
