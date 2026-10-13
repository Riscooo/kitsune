/* Native Kitsune UI: a fixed local protocol, not a browser automation API.
 * No network listener, remote code, arbitrary CSS/URLs or website injection.
 * The upstream sandbox, certificate validation and addon signatures stay intact.
 */
const { setInterval, clearInterval } = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
const TOKENS = Object.freeze({bg:'bg',surface:'surface',surfaceHigh:'surface-high',text:'text',muted:'muted',outline:'outline',primary:'primary',primaryContainer:'primary-container',secondary:'secondary',tertiary:'tertiary'});
const GOOGLE_ORIGINS = Object.freeze(['https://google.com', 'https://accounts.google.com']);
const PERMISSION = 'persist-data-on-shutdown';
const MANAGED_PREF = 'browser.kitsune.googleRetentionManagedOrigins';
const LEGACY_MANAGED_PREF = 'browser.kitsune.googleRetentionManaged';
const THEME_APPLIED_PREF = 'kitsune.theme.applied';
const WEBSITE_SCHEME_PREF = 'layout.css.prefers-color-scheme.content-override';
// La página de inicio propia del perfil: el servidor local de Linux o el inicio
// integrado (extensión inicio@kitsune, con el UUID fijo de kitsune.cfg).
const SERVER_HOME = /^http:\/\/127\.0\.0\.1:[0-9]{2,5}\/$/;
const INTEGRATED_HOME = 'moz-extension://4b1d7c2e-9a3f-4e6b-8c51-2f7a0d9e6b13/start/index.html';
const isHome = url => SERVER_HOME.test(url) || url === INTEGRATED_HOME;
let timer = null, busy = false, current = '', sheet = null, lastAck = 0, reportedError = false;
const sheets = Cc['@mozilla.org/content/style-sheet-service;1'].getService(Ci.nsIStyleSheetService);
const profileDirectory = () => Services.dirsvc.get('ProfD', Ci.nsIFile).path;

const CONTROL_KEYS = Object.freeze({
  2: Object.freeze(['version', 'fingerprint', 'palette', 'motion', 'googleRemember']),
  // 0.7: tema claro u oscuro y fondo propio (solo el hash de una imagen ya
  // normalizada por el inicio en <perfil>/chrome; nunca una URL ni una ruta).
  3: Object.freeze(['version', 'fingerprint', 'palette', 'motion', 'googleRemember', 'theme', 'background']),
  // Botones de la ventana a la izquierda o a la derecha y el logo «KITSUNE», a elegir.
  4: Object.freeze(['version', 'fingerprint', 'palette', 'motion', 'googleRemember', 'theme', 'background', 'windowControls', 'brand']),
  // Modo ahorro, como en Opera GX: pestañas dormidas, límite de RAM, 60 fps.
  5: Object.freeze(['version', 'fingerprint', 'palette', 'motion', 'googleRemember', 'theme', 'background', 'windowControls', 'brand',
                    'performance', 'ramLimit']),
  // Botón de minimizar (en Niri no hace nada: se puede ocultar).
  6: Object.freeze(['version', 'fingerprint', 'palette', 'motion', 'googleRemember', 'theme', 'background', 'windowControls', 'brand',
                    'performance', 'ramLimit', 'minimize']),
  // Botones de la ventana: los de Kitsune, los del sistema o según el sistema.
  7: Object.freeze(['version', 'fingerprint', 'palette', 'motion', 'googleRemember', 'theme', 'background', 'windowControls', 'brand',
                    'performance', 'ramLimit', 'minimize', 'windowButtons']),
});
const WINDOW_BUTTONS = Object.freeze(['auto', 'kitsune', 'sistema']);
const PERFORMANCE = Object.freeze(['normal', 'ahorro']);
const RAM_LIMITS = Object.freeze([1024, 2048, 4096]);
const CONTROL_SIDES = Object.freeze(['izquierda', 'derecha']);
const SCHEMES = Object.freeze({claro:'light', oscuro:'dark'});

function validate(value) {
  const keys = value && typeof value === 'object' && !Array.isArray(value) && Number.isInteger(value.version) && Object.hasOwn(CONTROL_KEYS, value.version) ? CONTROL_KEYS[value.version] : null;
  if (!keys || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) ||
      (value.version >= 3 && (!Object.hasOwn(SCHEMES, value.theme) ||
        (value.background !== null && (typeof value.background !== 'string' || !/^[a-f0-9]{64}$/.test(value.background))))) ||
      (value.version >= 4 && (!CONTROL_SIDES.includes(value.windowControls) || typeof value.brand !== 'boolean')) ||
      (value.version >= 5 && (!PERFORMANCE.includes(value.performance) || !RAM_LIMITS.includes(value.ramLimit))) ||
      (value.version >= 6 && typeof value.minimize !== 'boolean') ||
      (value.version >= 7 && !WINDOW_BUTTONS.includes(value.windowButtons)) ||
      typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
      ['motion','googleRemember'].some(key => typeof value[key] !== 'boolean') ||
      !value.palette || typeof value.palette !== 'object' || Array.isArray(value.palette) ||
      Object.keys(value.palette).length !== Object.keys(TOKENS).length ||
      Object.keys(TOKENS).some(key => typeof value.palette[key] !== 'string' || !/^#[0-9a-f]{6}$/.test(value.palette[key]))) throw Error('Invalid local appearance control');
  // Un control v2 (0.6) es papel claro y sin fondo; v2 y v3, botones a la izquierda y con logo.
  return {theme:'claro', background:null, windowControls:'izquierda', brand:true, performance:'normal', ramLimit:2048, minimize:true,
          windowButtons:'auto', ...value};
}

function backgroundUri(hash) {
  const file = Services.dirsvc.get('ProfD', Ci.nsIFile);
  file.append('chrome');
  file.append(`kitsune-background-${hash}.jpg`);
  return Services.io.newFileURI(file).spec;
}

// Papel o tinta según el tema; la nueva pestaña lleva el fondo propio, si lo hay,
// bajo un velo del color de fondo para que el texto se siga leyendo. «:root body»
// gana al body de userContent.css, que va detrás en la cascada y queda de respaldo.
function nativeCss(value) {
  const scheme = SCHEMES[value.theme];
  const variables = Object.entries(TOKENS).map(([key, name]) => `--kb-${name}:${value.palette[key]} !important;`).join('') +
    `--kb-scheme:${scheme} !important;`;
  const background = value.background
    ? `background:linear-gradient(color-mix(in srgb,var(--kb-bg) 30%,transparent),color-mix(in srgb,var(--kb-bg) 62%,transparent)),url("${backgroundUri(value.background)}") center/cover no-repeat fixed var(--kb-bg)!important;`
    : 'background-color:var(--kb-bg)!important;background-image:none!important;';
  return `@-moz-document url("chrome://browser/content/browser.xhtml"),url("about:newtab"),url("about:home"),url("about:privatebrowsing"),url("about:downloads"),url-prefix("about:preferences"),url-prefix("about:addons"),url("about:protections"),url("about:logins"),url-prefix("about:reader"){ :root{${variables}} }
    @-moz-document url("about:newtab"),url("about:home"){
      :root body{${background}}
      ${!value.motion ? '.logo-and-wordmark,.logo-and-wordmark .logo,.search-inner-wrapper{animation:none!important;transition:none!important;scale:none!important;}' : ''}
    }
    @-moz-document url("chrome://browser/content/browser.xhtml"){${windowCss(value)}}`;
}

// Más específico que userChrome.css, que va detrás en la cascada. Lado y minimizar
// solo con los botones de Kitsune (el atributo lo pone applyButtons en cada ventana).
const KITSUNE_BUTTONS = ':root#main-window[kitsune-window-buttons="kitsune"]';
function windowCss(value) {
  const right = value.windowControls === 'derecha' ? `
    ${KITSUNE_BUTTONS} #TabsToolbar>.titlebar-buttonbox-container,${KITSUNE_BUTTONS} .titlebar-buttonbox-container{order:999!important;padding-inline:8px 2px!important;}
    ${KITSUNE_BUTTONS} #navigator-toolbox[tabs-hidden]>#nav-bar>.titlebar-buttonbox-container{order:999!important;}
    ${KITSUNE_BUTTONS} .titlebar-buttonbox .titlebar-min{order:0!important;}
    ${KITSUNE_BUTTONS} .titlebar-buttonbox :is(.titlebar-max,.titlebar-restore){order:1!important;}
    ${KITSUNE_BUTTONS} .titlebar-buttonbox .titlebar-close{order:2!important;}` : '';
  const noMinimize = value.minimize ? '' : `
    ${KITSUNE_BUTTONS} .titlebar-buttonbox .titlebar-min{display:none!important;}`;
  const hidden = value.brand ? '' : `
    :root#main-window #TabsToolbar::before,:root#main-window #navigator-toolbox[tabs-hidden]>#nav-bar::before{display:none!important;}`;
  return right + noMinimize + hidden;
}

/** Los botones que se ven: «auto» son los de Apple en macOS y los de Kitsune en el resto. */
function resolveButtons(choice, os = Services.appinfo.OS) {
  if (choice === 'kitsune' || choice === 'sistema') return choice;
  return os === 'Darwin' ? 'sistema' : 'kitsune';
}
let buttonsChoice = 'auto';
function applyButtons(choice, windows = Services.wm.getEnumerator('navigator:browser'), os = Services.appinfo.OS) {
  buttonsChoice = choice;
  const resolved = resolveButtons(choice, os);
  for (const win of windows) {
    const root = win.document.documentElement;
    if (root.getAttribute('kitsune-window-buttons') !== resolved) root.setAttribute('kitsune-window-buttons', resolved);
  }
}

// Sin rastro de Mozilla: fuera las entradas de Ayuda que llevan a sus webs o
// servicios (ayuda, opiniones, informar de webs, cambiar de dispositivo, compartir).
// En Ajustes, fuera las secciones de cuenta y Sync, laboratorio y «Más de Mozilla».
const IDENTITY_CSS = '@-moz-document url("chrome://browser/content/browser.xhtml"){' +
  ['menu_openHelp', 'help_reportBrokenSite', 'feedbackPage', 'menu_HelpPopup_reportPhishingtoolmenu',
   'menu_HelpPopup_reportPhishingErrortoolmenu', 'helpSwitchDevice', 'menu_referralsPage']
    .map(id => `#${id},#appMenu_${id}`).join(',') + '{display:none!important;}}' +
  '@-moz-document url-prefix("about:preferences"),url-prefix("about:settings"){' +
  '#category-sync,#category-experimental,#category-more-from-mozilla{display:none!important;}}';

// Al cambiar de tema, la barra funde sus colores mientras el inicio pasa la veta de tinta.
let lastTheme = '';
function fadeChrome(theme) {
  if (!lastTheme || lastTheme === theme) { lastTheme = theme; return; }
  lastTheme = theme;
  for (const win of Services.wm.getEnumerator('navigator:browser')) {
    const root = win.document.documentElement;
    root.setAttribute('kitsune-theme-changing', 'true');
    win.setTimeout(() => root.removeAttribute('kitsune-theme-changing'), 1300);
  }
}
const FADE_CSS = '@-moz-document url("chrome://browser/content/browser.xhtml"){' +
  ':root[kitsune-theme-changing] :is(#navigator-toolbox,#TabsToolbar,#nav-bar,#urlbar-background,.urlbar-background,' +
  '.tab-background,#sidebar-box,#PersonalToolbar,toolbarbutton,.toolbarbutton-icon,#TabsToolbar::before){' +
  'transition:background-color 1100ms cubic-bezier(.65,0,.35,1),color 1100ms cubic-bezier(.65,0,.35,1),' +
  'border-color 1100ms cubic-bezier(.65,0,.35,1),fill 1100ms ease!important;}}';

// Modo ahorro. Ajustes de Gecko con menos memoria y CPU (solo mientras dure el
// modo: al volver a Normal se quitan los que puso Kitsune) y un vigilante que
// duerme pestañas: las que llevan 15 min sin usarse y, si Kitsune pasa del límite
// de RAM, las más antiguas hasta bajar. Nunca la activa, las fijadas ni las que suenan.
const SAVER_PREFS = Object.freeze({
  'layout.frame_rate': 60,
  'dom.ipc.processCount': 2,
  'dom.ipc.processCount.webIsolated': 1,
  'browser.sessionhistory.max_total_viewers': 0,
  'browser.cache.memory.capacity': 32768,
  'image.mem.surfacecache.max_size_kb': 262144,
});
const SAVER_IDLE_MS = 15 * 60 * 1000;
let saver = null;
function setPrefValue(name, value) {
  if (typeof value === 'number') Services.prefs.setIntPref(name, value);
}
function applyPerformance(mode, ramLimit) {
  const applied = Services.prefs.getStringPref('kitsune.performance.applied', 'normal');
  if (mode === 'ahorro') {
    for (const [name, value] of Object.entries(SAVER_PREFS)) {
      if (Services.prefs.getIntPref(name, -999) !== value) setPrefValue(name, value);
    }
  } else if (applied === 'ahorro') {
    for (const [name, value] of Object.entries(SAVER_PREFS)) {
      if (Services.prefs.prefHasUserValue(name) && Services.prefs.getIntPref(name, -999) === value) Services.prefs.clearUserPref(name);
    }
  }
  if (applied !== mode) Services.prefs.setStringPref('kitsune.performance.applied', mode);
  saver = mode === 'ahorro' ? { limit: ramLimit * 1024 * 1024, last: 0 } : null;
}
function sleepingCandidates() {
  const tabs = [];
  for (const win of Services.wm.getEnumerator('navigator:browser')) {
    for (const tab of win.gBrowser?.tabs ?? []) {
      if (tab.selected || tab.pinned || tab.soundPlaying || tab.hasAttribute('pending') || !tab.linkedPanel) continue;
      tabs.push({ win, tab });
    }
  }
  return tabs.sort((a, b) => (a.tab.lastAccessed || 0) - (b.tab.lastAccessed || 0));
}
async function watchMemory() {
  if (!saver || Date.now() - saver.last < 30000) return;
  saver.last = Date.now();
  const now = Date.now();
  for (const { win, tab } of sleepingCandidates()) {
    if (now - (tab.lastAccessed || now) > SAVER_IDLE_MS) win.gBrowser.discardBrowser(tab);
  }
  // Memoria real de todos los procesos de Kitsune; si pasa del límite, duerme
  // hasta dos de las pestañas más antiguas y lo vuelve a medir en la siguiente vuelta.
  const info = await ChromeUtils.requestProcInfo();
  const used = info.memory + info.children.reduce((sum, child) => sum + (child.memory || 0), 0);
  if (used > saver.limit) {
    for (const { win, tab } of sleepingCandidates().slice(0, 2)) win.gBrowser.discardBrowser(tab);
  }
}

// El esquema de Gecko sigue al tema: menús, ajustes y las webs que lo admiten
// se ven oscuros en Oscuro. Con el tema por defecto, browser.theme.* vale 2
// («como el sistema») y lo reescribe Gecko; manda ui.systemUsesDarkTheme.
// Al cambiar de tema (y la primera vez), las webs vuelven a «automático» para
// seguirlo, aunque antes se hubieran fijado en claro u oscuro en los ajustes.
function applyScheme(theme) {
  const wanted = theme === 'oscuro' ? 1 : 0;
  if (Services.prefs.getIntPref('ui.systemUsesDarkTheme', -1) !== wanted) Services.prefs.setIntPref('ui.systemUsesDarkTheme', wanted);
  if (Services.prefs.getStringPref(THEME_APPLIED_PREF, '') !== theme) {
    if (Services.prefs.prefHasUserValue(WEBSITE_SCHEME_PREF)) Services.prefs.clearUserPref(WEBSITE_SCHEME_PREF);
    Services.prefs.setStringPref(THEME_APPLIED_PREF, theme);
  }
}

function googlePrincipals() {
  return GOOGLE_ORIGINS.map(origin => Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(origin), {}));
}

function managedOrigins() {
  const raw = Services.prefs.getStringPref(MANAGED_PREF, '[]');
  if (typeof raw !== 'string' || raw.length > 512) throw Error('Invalid local retention record');
  let origins;
  try { origins = JSON.parse(raw); } catch { throw Error('Invalid local retention record'); }
  if (!Array.isArray(origins) || origins.length > GOOGLE_ORIGINS.length ||
      origins.some(origin => typeof origin !== 'string' || !GOOGLE_ORIGINS.includes(origin)) ||
      new Set(origins).size !== origins.length) throw Error('Invalid local retention record');
  return origins;
}

function saveManagedOrigins(origins) {
  const ordered = GOOGLE_ORIGINS.filter(origin => origins.includes(origin));
  if (ordered.length) {
    const encoded = JSON.stringify(ordered);
    if (Services.prefs.getStringPref(MANAGED_PREF, '') !== encoded) Services.prefs.setStringPref(MANAGED_PREF, encoded);
  } else if (Services.prefs.prefHasUserValue(MANAGED_PREF)) {
    Services.prefs.clearUserPref(MANAGED_PREF);
  }
}

function applyGoogle(enabled) {
  if (typeof enabled !== 'boolean') throw Error('Invalid local retention option');
  let owned = managedOrigins();
  const principals = googlePrincipals();
  if (enabled) {
    for (let index = 0; index < GOOGLE_ORIGINS.length; index++) {
      const principal = principals[index], origin = GOOGLE_ORIGINS[index];
      // An existing explicit or inherited allow rule belongs to the user.
      // Do not rewrite its expiration/metadata or claim ownership of it.
      if (Services.perms.testPermissionFromPrincipal(principal, PERMISSION) === Services.perms.ALLOW_ACTION) continue;
      Services.perms.addFromPrincipal(principal, PERMISSION, Services.perms.ALLOW_ACTION);
      if (!owned.includes(origin)) owned.push(origin);
      saveManagedOrigins(owned);
    }
  } else {
    for (const origin of [...owned]) {
      const principal = principals[GOOGLE_ORIGINS.indexOf(origin)];
      // A later manual deny/removal must also remain untouched. The only
      // removals we perform are allow rules recorded as added by Kitsune.
      if (Services.perms.testPermissionFromPrincipal(principal, PERMISSION) === Services.perms.ALLOW_ACTION) {
        Services.perms.removeFromPrincipal(principal, PERMISSION);
      }
      owned = owned.filter(item => item !== origin);
      saveManagedOrigins(owned);
    }
  }
  if (Services.prefs.prefHasUserValue(LEGACY_MANAGED_PREF)) {
    // Pre-release tests used a boolean marker. It cannot prove which rules
    // were ours, so discard the marker without deleting any untracked rule.
    Services.prefs.clearUserPref(LEGACY_MANAGED_PREF);
  }
}

// Las pestañas nuevas abren el inicio de Kitsune del perfil en vez de la página
// de Gecko. Una extensión que ya haya cambiado la pestaña nueva manda: solo se
// fija cuando nadie la ha cambiado (Gecko la restablece al iniciar Activity Stream).
function applyNewTab() {
  const home = Services.prefs.getStringPref('browser.startup.homepage', '');
  if (!isHome(home)) return;
  const { AboutNewTab } = ChromeUtils.importESModule('resource:///modules/AboutNewTab.sys.mjs');
  if (!AboutNewTab.newTabURLOverridden) AboutNewTab.newTabURL = home;
}

// Todos los enlaces de ayuda de Gecko (app.support.baseURL y los informes de
// protección, entre otros) llevan a la ayuda de Kitsune del perfil, en su inicio
// local, no a la de Mozilla. Solo los valores por defecto: nada se guarda en el perfil.
const MOZILLA_SUPPORT = /^https:\/\/support\.mozilla\.org\//;
let supportHome = '';
function applySupportUrl() {
  const home = Services.prefs.getStringPref('browser.startup.homepage', '');
  if (!isHome(home) || supportHome === home) return;
  // Servidor: <inicio>/ayuda/<tema>. Integrado: start/ayuda.html?tema=<tema>. Gecko pone
  // el tema detrás de app.support.baseURL, así que esa acaba justo antes del tema.
  const integrated = home === INTEGRATED_HOME;
  const page = home.replace(/index\.html$/, 'ayuda.html');
  const help = (topic, base) => integrated ? (base || topic ? `${page}?tema=${topic}` : page) : `${home}ayuda/${topic}`;
  const defaults = Services.prefs.getDefaultBranch('');
  for (const name of defaults.getChildList('')) {
    if (defaults.getPrefType(name) !== defaults.PREF_STRING) continue;
    const value = defaults.getStringPref(name, '');
    if (!MOZILLA_SUPPORT.test(value)) continue;
    const topic = value.split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop().replace(/[^A-Za-z0-9._-]/g, '');
    const base = name === 'app.support.baseURL';
    defaults.setStringPref(name, help(base ? '' : topic, base));
  }
  supportHome = home;
}

async function update() {
  if (busy) return;
  busy = true;
  try {
    try { applyNewTab(); applySupportUrl(); } catch { /* sin inicio propio, Gecko sigue con lo suyo */ }
    const directory = PathUtils.join(profileDirectory(), 'chrome');
    const control = PathUtils.join(directory, 'kitsune-appearance.json');
    const info = await IOUtils.stat(control);
    if (info.type !== 'regular' || info.size > 8192) throw Error('Invalid appearance file');
    const value = validate(JSON.parse(new TextDecoder().decode(await IOUtils.read(control, {maxBytes:8192}))));
    if (current !== value.fingerprint) {
      const next = Services.io.newURI('data:text/css;charset=utf-8,' + encodeURIComponent(nativeCss(value)));
      sheets.loadAndRegisterSheet(next, sheets.USER_SHEET);
      if (sheet && sheets.sheetRegistered(sheet, sheets.USER_SHEET)) sheets.unregisterSheet(sheet, sheets.USER_SHEET);
      sheet = next;
      fadeChrome(value.theme);
      applyScheme(value.theme);
      applyPerformance(value.performance, value.ramLimit);
      applyGoogle(value.googleRemember);
      applyButtons(value.windowButtons);
      current = value.fingerprint;
      lastAck = 0;
    }
    if (Date.now() - lastAck > 10000) {
      const ack = {version:1,fingerprint:current,at:Date.now(),
        googleRemember:googlePrincipals().every(p => Services.perms.testPermissionFromPrincipal(p, PERMISSION) === Services.perms.ALLOW_ACTION),
        googlePolicyManaged:managedOrigins().length > 0,
        // Modo de privacidad que kitsune.cfg aplicó al arrancar este motor.
        privacyMode:Services.prefs.getStringPref('kitsune.privacy.active', '')};
      await IOUtils.writeJSON(PathUtils.join(directory,'kitsune-appearance-ack.json'), ack, {tmpPath:PathUtils.join(directory,'.kitsune-appearance-ack.tmp'),permissions:0o600});
      lastAck = ack.at;
    }
    reportedError = false;
    void watchMemory().catch(() => {});
  } catch (error) {
    // No payload, profile path or private state enters the browser log.
    if (error.name !== 'NotFoundError' && !reportedError) {
      Services.console.logStringMessage('Kitsune: local appearance could not be applied.');
      reportedError = true;
    }
  } finally { busy = false; }
}

// Windows y macOS: sin copia de chrome/ en el perfil, el aspecto de Kitsune viene del
// propio motor. userContent.css para todo (como el del perfil) y userChrome.css en
// cada ventana. En Linux el perfil trae su copia y manda esa.
const BUILTIN_STYLE = 'chrome://browser/content/kitsune-chrome/';
function profileHasStyle(name) {
  const file = Services.dirsvc.get('ProfD', Ci.nsIFile);
  file.append('chrome');
  file.append(name);
  return file.exists();
}
function registerBuiltinContent() {
  if (profileHasStyle('userContent.css')) return;
  const uri = Services.io.newURI(BUILTIN_STYLE + 'userContent.css');
  if (!sheets.sheetRegistered(uri, sheets.USER_SHEET)) sheets.loadAndRegisterSheet(uri, sheets.USER_SHEET);
}

// Siempre, haya o no ajustes de apariencia: la identidad no depende del inicio.
function registerIdentity() {
  const uri = Services.io.newURI('data:text/css;charset=utf-8,' + encodeURIComponent(IDENTITY_CSS + FADE_CSS));
  if (!sheets.sheetRegistered(uri, sheets.USER_SHEET)) sheets.loadAndRegisterSheet(uri, sheets.USER_SHEET);
}

export const KitsuneAppearance = {
  integratedHome: INTEGRATED_HOME,
  // Cada ventana nueva: el aspecto de Kitsune del motor si el perfil no trae el suyo.
  decorate(window) {
    // Antes de pintar: los botones elegidos (o los del sistema según dónde corre, si aún no hay ajustes).
    try { applyButtons(buttonsChoice, [window]); } catch { /* la ventana sigue con los de Gecko */ }
    try {
      if (!profileHasStyle('userChrome.css')) window.windowUtils.loadSheetUsingURIString(BUILTIN_STYLE + 'userChrome.css', window.windowUtils.USER_SHEET);
    } catch { /* la ventana sigue con el aspecto de Gecko */ }
  },
  start() {
    if (timer !== null) return;
    try { registerIdentity(); } catch { /* el resto de Kitsune sigue */ }
    try { registerBuiltinContent(); } catch { /* sin estilo propio, Gecko sigue con el suyo */ }
    void update();
    timer = setInterval(update, 2000);
    Services.obs.addObserver(this, 'quit-application-granted');
  },
  observe() {
    clearInterval(timer); timer = null;
    Services.obs.removeObserver(this, 'quit-application-granted');
  },
};
