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
let timer = null, busy = false, current = '', sheet = null, lastAck = 0, reportedError = false;
const sheets = Cc['@mozilla.org/content/style-sheet-service;1'].getService(Ci.nsIStyleSheetService);
const profileDirectory = () => Services.dirsvc.get('ProfD', Ci.nsIFile).path;

const CONTROL_KEYS = Object.freeze({
  2: Object.freeze(['version', 'fingerprint', 'palette', 'motion', 'googleRemember']),
  // 0.7: tema claro u oscuro y fondo propio (solo el hash de una imagen ya
  // normalizada por el inicio en <perfil>/chrome; nunca una URL ni una ruta).
  3: Object.freeze(['version', 'fingerprint', 'palette', 'motion', 'googleRemember', 'theme', 'background']),
});
const SCHEMES = Object.freeze({claro:'light', oscuro:'dark'});

function validate(value) {
  const keys = value && typeof value === 'object' && !Array.isArray(value) && Number.isInteger(value.version) && Object.hasOwn(CONTROL_KEYS, value.version) ? CONTROL_KEYS[value.version] : null;
  if (!keys || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) ||
      (value.version === 3 && (!Object.hasOwn(SCHEMES, value.theme) ||
        (value.background !== null && (typeof value.background !== 'string' || !/^[a-f0-9]{64}$/.test(value.background))))) ||
      typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
      ['motion','googleRemember'].some(key => typeof value[key] !== 'boolean') ||
      !value.palette || typeof value.palette !== 'object' || Array.isArray(value.palette) ||
      Object.keys(value.palette).length !== Object.keys(TOKENS).length ||
      Object.keys(TOKENS).some(key => typeof value.palette[key] !== 'string' || !/^#[0-9a-f]{6}$/.test(value.palette[key]))) throw Error('Invalid local appearance control');
  // Un control v2 (Kitsune 0.6) es papel claro y sin fondo.
  return value.version === 2 ? {...value, theme:'claro', background:null} : value;
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
    }`;
}

// El esquema de Gecko sigue al tema: menús, ajustes y las webs que lo admiten
// se ven oscuros en Oscuro. Con el tema por defecto, browser.theme.* vale 2
// («como el sistema») y lo reescribe Gecko; manda ui.systemUsesDarkTheme.
function applyScheme(theme) {
  const wanted = theme === 'oscuro' ? 1 : 0;
  if (Services.prefs.getIntPref('ui.systemUsesDarkTheme', -1) !== wanted) Services.prefs.setIntPref('ui.systemUsesDarkTheme', wanted);
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

async function update() {
  if (busy) return;
  busy = true;
  try {
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
      applyScheme(value.theme);
      applyGoogle(value.googleRemember);
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
  } catch (error) {
    // No payload, profile path or private state enters the browser log.
    if (error.name !== 'NotFoundError' && !reportedError) {
      Services.console.logStringMessage('Kitsune: local appearance could not be applied.');
      reportedError = true;
    }
  } finally { busy = false; }
}

export const KitsuneAppearance = {
  start() {
    if (timer !== null) return;
    void update();
    timer = setInterval(update, 2000);
    Services.obs.addObserver(this, 'quit-application-granted');
  },
  observe() {
    clearInterval(timer); timer = null;
    Services.obs.removeObserver(this, 'quit-application-granted');
  },
};
