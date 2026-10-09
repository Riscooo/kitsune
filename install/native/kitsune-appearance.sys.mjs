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

const CONTROL_KEYS = Object.freeze(['version', 'fingerprint', 'palette', 'motion', 'googleRemember']);

function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 2 ||
      Object.keys(value).length !== CONTROL_KEYS.length || CONTROL_KEYS.some(key => !Object.hasOwn(value, key)) ||
      typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
      ['motion','googleRemember'].some(key => typeof value[key] !== 'boolean') ||
      !value.palette || typeof value.palette !== 'object' || Array.isArray(value.palette) ||
      Object.keys(value.palette).length !== Object.keys(TOKENS).length ||
      Object.keys(TOKENS).some(key => typeof value.palette[key] !== 'string' || !/^#[0-9a-f]{6}$/.test(value.palette[key]))) throw Error('Invalid local appearance control');
  return value;
}

// Kitsune 0.5 «Tinta»: papel liso, sin imágenes de fondo.
function nativeCss(value) {
  const variables = Object.entries(TOKENS).map(([key, name]) => `--kb-${name}:${value.palette[key]} !important;`).join('');
  return `@-moz-document url("chrome://browser/content/browser.xhtml"),url("about:newtab"),url("about:home"),url("about:privatebrowsing"),url("about:downloads"),url-prefix("about:preferences"),url-prefix("about:addons"),url("about:protections"),url("about:logins"){ :root{${variables}} }
    @-moz-document url("about:newtab"),url("about:home"){
      body{background-color:var(--kb-bg)!important;background-image:none!important;}
      ${!value.motion ? '.logo-and-wordmark,.logo-and-wordmark .logo,.search-inner-wrapper{animation:none!important;transition:none!important;scale:none!important;}' : ''}
    }`;
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
