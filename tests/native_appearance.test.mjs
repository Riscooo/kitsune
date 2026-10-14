import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../install/native/kitsune-appearance.sys.mjs', import.meta.url), 'utf8');
const OWNED = 'browser.kitsune.googleRetentionManagedOrigins';
const LEGACY = 'browser.kitsune.googleRetentionManaged';
const GOOGLE = ['https://google.com', 'https://accounts.google.com'];
const PERMISSION = 'persist-data-on-shutdown';
const SCHEME_PREFS = ['ui.systemUsesDarkTheme'];
const WEBSITES = 'layout.css.prefers-color-scheme.content-override';
// Pestañas a un lado: lo único que applyTabs puede tocar.
const TAB_PREFS = ['kitsune.tabs.applied', 'sidebar.verticalTabs', 'sidebar.visibility', 'sidebar.revamp'];
const DENSITY_PREFS = ['browser.uidensity', 'kitsune.appearance.densityApplied'];

function fixture({ permissions = new Map(), preferences = new Map(), inherited = false, newTab = null, defaults = new Map() } = {}) {
  const calls = [];
  const prefs = {
    getStringPref: (name, fallback) => preferences.has(name) ? preferences.get(name) : fallback,
    getBoolPref: (name, fallback) => preferences.has(name) ? preferences.get(name) : fallback,
    getIntPref: (name, fallback) => preferences.has(name) ? preferences.get(name) : fallback,
    setIntPref(name, value) { assert.ok([...SCHEME_PREFS, ...DENSITY_PREFS].includes(name), name); preferences.set(name, value); calls.push([DENSITY_PREFS.includes(name) ? 'pref' : 'int', name, value]); },
    setBoolPref(name, value) { assert.ok(TAB_PREFS.includes(name), name); assert.equal(typeof value, 'boolean'); preferences.set(name, value); calls.push(['bool', name, value]); },
    setStringPref(name, value) { assert.ok([OWNED, 'kitsune.theme.applied', ...TAB_PREFS, ...DENSITY_PREFS].includes(name), name); assert.equal(typeof value, 'string'); preferences.set(name, value); calls.push(['pref', name, value]); },
    prefHasUserValue: name => preferences.has(name),
    getDefaultBranch: () => ({ PREF_STRING: 32, getChildList: () => [...defaults.keys()],
      getPrefType: name => typeof defaults.get(name) === 'string' ? 32 : 64,
      getStringPref: (name, fallback) => defaults.has(name) ? defaults.get(name) : fallback,
      setStringPref(name, value) { defaults.set(name, value); calls.push(['default', name, value]); } }),
    clearUserPref(name) { assert.ok([OWNED, LEGACY, WEBSITES, ...TAB_PREFS, ...DENSITY_PREFS].includes(name), name); preferences.delete(name); calls.push(['clear', name]); },
  };
  const perms = {
    ALLOW_ACTION: 1,
    testPermissionFromPrincipal(principal, type) {
      assert.equal(type, PERMISSION);
      const exact = permissions.get(principal.origin);
      if (exact) return exact.capability;
      if (inherited && principal.origin === GOOGLE[1]) return permissions.get(GOOGLE[0])?.capability ?? 0;
      return 0;
    },
    addFromPrincipal(principal, type, capability) {
      assert.equal(type, PERMISSION);
      assert.ok(GOOGLE.includes(principal.origin));
      permissions.set(principal.origin, { capability, owner: 'fixture-native' });
      calls.push(['add', principal.origin]);
    },
    removeFromPrincipal(principal, type) {
      assert.equal(type, PERMISSION);
      assert.ok(GOOGLE.includes(principal.origin));
      permissions.delete(principal.origin);
      calls.push(['remove', principal.origin]);
    },
  };
  const sheets = { USER_SHEET: 1 };
  const context = vm.createContext({
    ChromeUtils: { importESModule(specifier) {
      if (specifier === 'resource:///modules/AboutNewTab.sys.mjs' && newTab) return { AboutNewTab: newTab };
      assert.equal(specifier, 'resource://gre/modules/Timer.sys.mjs'); return { setInterval() {}, clearInterval() {} };
    } },
    Cc: { '@mozilla.org/content/style-sheet-service;1': { getService: () => sheets } },
    Ci: { nsIStyleSheetService: {}, nsIFile: {} },
    Services: {
      prefs, perms,
      io: { newURI: spec => ({ spec }), newFileURI: file => ({ spec: pathToFileURL(file.path).href }) },
      scriptSecurityManager: { createContentPrincipal: uri => ({ origin: uri.spec }) },
      dirsvc: { get() { return { path: '/temporary-kitsune-profile/profile', append(part) { this.path += '/' + part; } }; } },
    },
  });
  // Execute only this local trusted source against fake Services. No network,
  // real profile, timers or native browser APIs are available in the context.
  vm.runInContext(source.replace('export const KitsuneAppearance', 'const KitsuneAppearance') +
    '\nglobalThis.api = { validate, nativeCss, applyGoogle, applyScheme, applyNewTab, applySupportUrl, managedOrigins, IDENTITY_CSS, resolveButtons, applyButtons, applyTabs, applyDensity, shapeCss, summarizeProtections };', context);
  return { api: context.api, permissions, preferences, calls };
}

function control() {
  const keys = ['bg', 'surface', 'surfaceHigh', 'text', 'muted', 'outline', 'primary', 'primaryContainer', 'secondary', 'tertiary'];
  return { version: 2, fingerprint: 'a'.repeat(64), motion: true, googleRemember: false,
    palette: Object.fromEntries(keys.map(key => [key, '#123456'])) };
}

test('appearance control v2 strictly requires its exact fields, string fingerprints, colors and booleans', () => {
  const { api } = fixture();
  assert.equal(api.validate(control()).version, 2);
  for (const value of [null, [], 'control', 1]) assert.throws(() => api.validate(value));
  for (const change of [{ fingerprint: ['a'.repeat(64)] }, { fingerprint: 1 }, { motion: 'false' }, { googleRemember: null }, { palette: [] }, { wallpaper: 'night' }]) {
    assert.throws(() => api.validate({ ...control(), ...change }));
  }
  for (const color of [['#123456'], 123456, '#ABCDEF', '#123456;ignored']) {
    const value = control();
    value.palette.bg = color;
    assert.throws(() => api.validate(value));
  }
});

const controlV3 = (extra = {}) => ({ ...control(), version: 3, theme: 'oscuro', background: null, ...extra });

test('appearance control v3 adds only Claro/Oscuro and a background content hash', () => {
  const { api } = fixture();
  assert.equal(api.validate(controlV3()).theme, 'oscuro');
  assert.equal(api.validate(controlV3({ background: 'ab'.repeat(32) })).background, 'ab'.repeat(32));
  // A v2 control (Kitsune 0.6) still applies, as paper without background.
  assert.deepEqual([api.validate(control()).theme, api.validate(control()).background], ['claro', null]);
  for (const change of [{ theme: 'dark' }, { theme: null }, { background: '../../x' }, { background: 'AB'.repeat(32) },
    { background: 'file:///etc/passwd' }, { background: 1 }, { version: '3' }, { extra: true }]) {
    assert.throws(() => api.validate(controlV3(change)), JSON.stringify(change));
  }
  const { theme, background, ...withoutTheme } = controlV3();
  assert.throws(() => api.validate(withoutTheme));
  assert.throws(() => api.validate({ ...control(), theme: 'oscuro' }));
});

test('v4 moves the window buttons to the right and hides the brand only when asked; Mozilla help items are always hidden', () => {
  const { api } = fixture();
  const v4 = (extra = {}) => ({ ...controlV3(), version: 4, windowControls: 'izquierda', brand: true, ...extra });
  const left = api.nativeCss(api.validate(v4()));
  assert.doesNotMatch(left, /order:999/);
  assert.doesNotMatch(left, /#TabsToolbar::before[^{]*\{display:none/);
  assert.match(api.IDENTITY_CSS, /#menu_openHelp,#appMenu_menu_openHelp/);
  assert.match(api.IDENTITY_CSS, /#feedbackPage,#appMenu_feedbackPage/);
  assert.match(api.IDENTITY_CSS, /url-prefix\("about:preferences"\)[^{]*\{#category-sync,#category-experimental,#category-more-from-mozilla\{display:none/);
  const right = api.nativeCss(api.validate(v4({ windowControls: 'derecha', brand: false })));
  assert.match(right, /\.titlebar-buttonbox-container\{order:999!important/);
  // Más específico que «#main-window #TabsToolbar > .titlebar-buttonbox-container» de kitsune-header.css.
  assert.match(right, /:root#main-window\[kitsune-window-buttons="kitsune"\] #TabsToolbar>\.titlebar-buttonbox-container/);
  assert.match(right, /#TabsToolbar::before[^{]*\{display:none!important/);
  for (const change of [{ windowControls: 'arriba' }, { brand: 'no' }, { brand: undefined }]) assert.throws(() => api.validate(v4(change)));
});

test('v5 adds the saver mode with a RAM limit of 1, 2 or 4 GB', () => {
  const { api } = fixture();
  const v5 = (extra = {}) => ({ ...controlV3(), version: 5, windowControls: 'izquierda', brand: true, performance: 'ahorro', ramLimit: 1024, ...extra });
  assert.equal(api.validate(v5()).performance, 'ahorro');
  assert.deepEqual([api.validate(control()).performance, api.validate(control()).ramLimit], ['normal', 2048]);
  for (const change of [{ performance: 'turbo' }, { ramLimit: 3000 }, { ramLimit: '1024' }]) assert.throws(() => api.validate(v5(change)));
});

test('v6 shows the minimize button unless hidden, and on the right it goes first, like Windows', () => {
  const { api } = fixture();
  const v6 = (extra = {}) => ({ ...controlV3(), version: 6, windowControls: 'derecha', brand: true, performance: 'normal', ramLimit: 2048, minimize: true, ...extra });
  const shown = api.nativeCss(api.validate(v6()));
  assert.doesNotMatch(shown, /\.titlebar-min\{display:none/);
  assert.match(shown, /\.titlebar-min\{order:0!important/);
  assert.match(api.nativeCss(api.validate(v6({ minimize: false }))), /\.titlebar-min\{display:none!important/);
  assert.throws(() => api.validate(v6({ minimize: 'no' })));
  assert.equal(api.validate(control()).minimize, true);
});

test('v7 chooses Kitsune or system window buttons; auto is system on macOS and Kitsune elsewhere', () => {
  const { api } = fixture();
  const v7 = (extra = {}) => ({ ...controlV3(), version: 7, windowControls: 'derecha', brand: true, performance: 'normal', ramLimit: 2048,
    minimize: false, windowButtons: 'auto', ...extra });
  assert.equal(api.validate(v7()).windowButtons, 'auto');
  assert.equal(api.validate(v7({ windowButtons: 'sistema' })).windowButtons, 'sistema');
  for (const change of [{ windowButtons: 'macos' }, { windowButtons: null }, { windowButtons: undefined }]) assert.throws(() => api.validate(v7(change)));
  // Controles anteriores: como hasta ahora (auto).
  assert.equal(api.validate(control()).windowButtons, 'auto');
  assert.equal(api.resolveButtons('auto', 'Darwin'), 'sistema');
  assert.equal(api.resolveButtons('auto', 'WINNT'), 'kitsune');
  assert.equal(api.resolveButtons('auto', 'Linux'), 'kitsune');
  assert.equal(api.resolveButtons('kitsune', 'Darwin'), 'kitsune');
  assert.equal(api.resolveButtons('sistema', 'Linux'), 'sistema');
  // Lado y minimizar solo con los botones de Kitsune, también en macOS.
  const css = api.nativeCss(api.validate(v7()));
  assert.match(css, /:root#main-window\[kitsune-window-buttons="kitsune"\] \.titlebar-buttonbox \.titlebar-min\{display:none!important/);
  assert.match(css, /:root#main-window\[kitsune-window-buttons="kitsune"\] #TabsToolbar>\.titlebar-buttonbox-container/);
  assert.doesNotMatch(css, /-moz-platform: macos/);
});

test('v8 puts the tabs on top, at one side or at one side with only icons', () => {
  const { api } = fixture();
  const v8 = (extra = {}) => ({ ...controlV3(), version: 8, windowControls: 'izquierda', brand: true, performance: 'normal', ramLimit: 2048,
    minimize: true, windowButtons: 'auto', tabs: 'lado', ...extra });
  assert.equal(api.validate(v8()).tabs, 'lado');
  assert.equal(api.validate(v8({ tabs: 'iconos' })).tabs, 'iconos');
  for (const change of [{ tabs: 'vertical' }, { tabs: null }, { tabs: true }]) assert.throws(() => api.validate(v8(change)));
  const { tabs, ...withoutTabs } = v8();
  assert.throws(() => api.validate(withoutTabs));
  // Controles anteriores: arriba, como siempre.
  assert.equal(api.validate(control()).tabs, 'arriba');
});

test('v9 brings the ink shape (corners and lettering) and the window density', () => {
  const { api } = fixture();
  const v9 = (extra = {}) => ({ ...controlV3(), version: 9, windowControls: 'izquierda', brand: true, performance: 'normal', ramLimit: 2048,
    minimize: true, windowButtons: 'auto', tabs: 'arriba', esquinas: 'rectas', letra: 'serif', densidad: 'compacta', ...extra });
  const value = api.validate(v9());
  assert.deepEqual([value.esquinas, value.letra, value.densidad], ['rectas', 'serif', 'compacta']);
  for (const change of [{ esquinas: 'picudas' }, { letra: 'comic' }, { densidad: 'enorme' }, { esquinas: null }]) assert.throws(() => api.validate(v9(change)));
  // Controles anteriores: la forma de Papel y densidad normal; y Papel no añade CSS.
  const old = api.validate(control());
  assert.deepEqual([old.esquinas, old.letra, old.densidad], ['suaves', 'sans', 'normal']);
  assert.equal(api.shapeCss(old), '');
  const css = api.shapeCss(value);
  assert.match(css, /--tab-border-radius:1\.5px!important/);
  assert.match(css, /\.tab-label/);
  assert.match(css, /Noto Serif/);
  assert.match(api.shapeCss(api.validate(v9({ esquinas: 'redondas', letra: 'sans' }))), /--border-radius-medium:14px!important/);
});

test('density changes Gecko only when the choice changes', () => {
  const { api, calls } = fixture();
  api.applyDensity('compacta');
  assert.deepEqual(calls, [['pref', 'browser.uidensity', 1], ['pref', 'kitsune.appearance.densityApplied', 'compacta']]);
  calls.length = 0;
  api.applyDensity('compacta');
  assert.deepEqual(calls, []);
});

test('tabs change Gecko only when the choice changes, and going back to the top removes what Kitsune set', () => {
  const { api, preferences, calls } = fixture();
  api.applyTabs('arriba');
  assert.deepEqual(calls, [['pref', 'kitsune.tabs.applied', 'arriba']]);
  calls.length = 0;
  api.applyTabs('arriba');
  assert.deepEqual(calls, []);
  api.applyTabs('lado');
  assert.deepEqual(calls, [['bool', 'sidebar.verticalTabs', true], ['pref', 'sidebar.visibility', 'always-show'], ['pref', 'kitsune.tabs.applied', 'lado']]);
  calls.length = 0;
  api.applyTabs('iconos');
  assert.deepEqual(calls, [['bool', 'sidebar.verticalTabs', true], ['pref', 'sidebar.visibility', 'expand-on-hover'], ['pref', 'kitsune.tabs.applied', 'iconos']]);
  // Gecko enciende sidebar.revamp al poner las verticales; al volver arriba se quita.
  preferences.set('sidebar.revamp', true);
  calls.length = 0;
  api.applyTabs('arriba');
  assert.deepEqual(calls, [['bool', 'sidebar.verticalTabs', false], ['clear', 'sidebar.visibility'], ['clear', 'sidebar.revamp'], ['pref', 'kitsune.tabs.applied', 'arriba']]);
});

test('vertical tabs set by hand in the browser settings survive the first control', () => {
  const { api, preferences, calls } = fixture({ preferences: new Map([['sidebar.verticalTabs', true], ['sidebar.revamp', true]]) });
  api.applyTabs('arriba');
  assert.deepEqual(calls, [['pref', 'kitsune.tabs.applied', 'arriba']]);
  assert.equal(preferences.get('sidebar.verticalTabs'), true);
  assert.equal(preferences.get('sidebar.revamp'), true);
});

test('each window carries the resolved button style as an attribute', () => {
  const { api } = fixture();
  const window = () => { const attributes = new Map(); return { document: { documentElement: {
    setAttribute: (name, value) => attributes.set(name, value), getAttribute: name => attributes.get(name) ?? null } }, attributes }; };
  const windows = [window(), window()];
  api.applyButtons('sistema', windows, 'WINNT');
  assert.deepEqual(windows.map(item => item.attributes.get('kitsune-window-buttons')), ['sistema', 'sistema']);
  api.applyButtons('auto', windows, 'Darwin');
  assert.deepEqual(windows.map(item => item.attributes.get('kitsune-window-buttons')), ['sistema', 'sistema']);
  api.applyButtons('auto', windows, 'Linux');
  assert.deepEqual(windows.map(item => item.attributes.get('kitsune-window-buttons')), ['kitsune', 'kitsune']);
});

test('dark controls set the scheme variable, and the background is a file inside the profile chrome folder', () => {
  const { api } = fixture();
  const dark = api.nativeCss(api.validate(controlV3()));
  assert.match(dark, /--kb-scheme:dark !important/);
  assert.match(dark, /background-image:none/);
  assert.match(api.nativeCss(api.validate(control())), /--kb-scheme:light !important/);
  const digest = 'cd'.repeat(32);
  const withImage = api.nativeCss(api.validate(controlV3({ background: digest })));
  const urls = [...withImage.matchAll(/url\("(file:[^"]+)"\)/g)].map(match => match[1]);
  assert.deepEqual(urls, [`file:///temporary-kitsune-profile/profile/chrome/kitsune-background-${digest}.jpg`]);
  assert.doesNotMatch(withImage, /https?:/);
});

test('the Gecko dark-scheme pref follows the theme and is written only when it changes', () => {
  const f = fixture();
  f.api.applyScheme('oscuro');
  assert.deepEqual(SCHEME_PREFS.map(name => f.preferences.get(name)), [1]);
  const writes = f.calls.length;
  f.api.applyScheme('oscuro');
  assert.equal(f.calls.length, writes);
  f.api.applyScheme('claro');
  assert.deepEqual(SCHEME_PREFS.map(name => f.preferences.get(name)), [0]);
});

test('new tabs open the profile\'s own Kitsune home, unless an extension already changed them', () => {
  const tab = (overridden = false, url = 'about:newtab') => ({ newTabURLOverridden: overridden, newTabURL: url });
  const home = 'http://127.0.0.1:49721/';
  let newTab = tab();
  fixture({ newTab, preferences: new Map([['browser.startup.homepage', home]]) }).api.applyNewTab();
  assert.equal(newTab.newTabURL, home);
  newTab = tab(true, 'moz-extension://fixture/newtab.html');
  fixture({ newTab, preferences: new Map([['browser.startup.homepage', home]]) }).api.applyNewTab();
  assert.equal(newTab.newTabURL, 'moz-extension://fixture/newtab.html');
  for (const homepage of ['https://example.com/', 'http://127.0.0.1:49721/evil', 'http://localhost:49721/', '']) {
    newTab = tab();
    fixture({ newTab, preferences: new Map([['browser.startup.homepage', homepage]]) }).api.applyNewTab();
    assert.equal(newTab.newTabURL, 'about:newtab', homepage);
  }
});

test('switching theme puts websites back on automatic once, so an old forced-light choice cannot win', () => {
  const f = fixture({ preferences: new Map([[WEBSITES, 1]]) });
  f.api.applyScheme('oscuro');
  assert.equal(f.preferences.has(WEBSITES), false);
  assert.equal(f.preferences.get('kitsune.theme.applied'), 'oscuro');
  // A later manual choice in Gecko's settings stays until the next theme change.
  f.preferences.set(WEBSITES, 1);
  f.api.applyScheme('oscuro');
  assert.equal(f.preferences.get(WEBSITES), 1);
  f.api.applyScheme('claro');
  assert.equal(f.preferences.has(WEBSITES), false);
});

test('help links go to the profile\'s own Kitsune help, as a default that is never saved', () => {
  const defaults = new Map([['app.support.baseURL', 'https://support.mozilla.org/1/firefox/%VERSION%/%OS%/%LOCALE%/'],
    ['browser.contentblocking.report.social.url', 'https://support.mozilla.org/1/firefox/%VERSION%/%OS%/%LOCALE%/social-media-tracking-report'],
    ['identity.sendtab.deviceissues.url', 'https://support.mozilla.org/1/firefox/%VERSION%/%OS%/%LOCALE%/send-tab#w_i-dont-see'],
    ['browser.startup.homepage_override.buildID', 'https://example.com/'], ['some.number', 3]]);
  const f = fixture({ defaults, preferences: new Map([['browser.startup.homepage', 'http://127.0.0.1:49722/']]) });
  f.api.applySupportUrl();
  assert.equal(defaults.get('app.support.baseURL'), 'http://127.0.0.1:49722/ayuda/');
  assert.equal(defaults.get('browser.contentblocking.report.social.url'), 'http://127.0.0.1:49722/ayuda/social-media-tracking-report');
  assert.equal(defaults.get('identity.sendtab.deviceissues.url'), 'http://127.0.0.1:49722/ayuda/send-tab');
  assert.equal(defaults.get('browser.startup.homepage_override.buildID'), 'https://example.com/');
  const writes = f.calls.length;
  f.api.applySupportUrl();
  assert.equal(f.calls.length, writes);
  assert.equal(f.preferences.has('app.support.baseURL'), false);
  const other = new Map([['app.support.baseURL', 'x']]);
  fixture({ defaults: other, preferences: new Map([['browser.startup.homepage', 'https://example.com/']]) }).api.applySupportUrl();
  assert.equal(other.get('app.support.baseURL'), 'x');
});

test('a Nightfall (v1) control is rejected instead of half-applied', () => {
  const { api } = fixture();
  assert.throws(() => api.validate({ ...control(), version: 1, wallpaper: 'night', themeSync: false, art: true }));
  assert.throws(() => api.validate({ ...control(), version: 1 }));
});

test('native styles remain restricted to enumerated internal pages and carry no background image unless chosen', () => {
  const { api } = fixture();
  const css = api.nativeCss(api.validate(control()));
  assert.match(css, /url\("chrome:\/\/browser\/content\/browser.xhtml"\)/);
  assert.match(css, /url\("about:newtab"\)/);
  assert.doesNotMatch(css, /kitsune-night|anime-veil|file:/);
  assert.doesNotMatch(css, /url-prefix\("https?:|url\("https?:|@import/);
  assert.match(css, /--kb-bg:#123456/);
  const still = api.nativeCss({ ...control(), motion: false });
  assert.match(still, /animation:none/);
});

test('on records only newly added exceptions; off removes exactly those', () => {
  const f = fixture();
  f.api.applyGoogle(true);
  assert.deepEqual(JSON.parse(f.preferences.get(OWNED)), GOOGLE);
  assert.deepEqual(f.calls.filter(call => call[0] === 'add').map(call => call[1]), GOOGLE);
  f.api.applyGoogle(false);
  assert.equal(f.permissions.size, 0);
  assert.equal(f.preferences.has(OWNED), false);
  assert.deepEqual(f.calls.filter(call => call[0] === 'remove').map(call => call[1]), GOOGLE);
});

test('pre-existing manual allow and unrelated site exceptions survive on/off unchanged', () => {
  const manual = { capability: 1, owner: 'user', expiry: 'manual-fixture' };
  const unrelated = { capability: 1, owner: 'user-other' };
  const f = fixture({ permissions: new Map([[GOOGLE[0], manual], ['https://example.invalid', unrelated]]) });
  f.api.applyGoogle(true);
  assert.equal(f.permissions.get(GOOGLE[0]), manual);
  assert.deepEqual(JSON.parse(f.preferences.get(OWNED)), [GOOGLE[1]]);
  f.api.applyGoogle(false);
  assert.equal(f.permissions.get(GOOGLE[0]), manual);
  assert.equal(f.permissions.get('https://example.invalid'), unrelated);
  assert.equal(f.permissions.has(GOOGLE[1]), false);
  assert.ok(f.calls.filter(call => ['add', 'remove'].includes(call[0])).every(call => call[1] === GOOGLE[1]));
});

test('inherited manual allow rules are not rewritten or claimed', () => {
  const manual = { capability: 1, owner: 'user' };
  const f = fixture({ permissions: new Map([[GOOGLE[0], manual]]), inherited: true });
  f.api.applyGoogle(true);
  assert.equal(f.preferences.has(OWNED), false);
  assert.equal(f.calls.length, 0);
  f.api.applyGoogle(false);
  assert.equal(f.permissions.get(GOOGLE[0]), manual);
  assert.equal(f.calls.length, 0);
});

test('owned-origin JSON survives a simulated module restart and repeated on is idempotent', () => {
  const original = fixture();
  original.api.applyGoogle(true);
  const restarted = fixture(original);
  restarted.api.applyGoogle(true);
  assert.equal(restarted.calls.length, 0);
  restarted.api.applyGoogle(false);
  assert.equal(restarted.permissions.size, 0);
  assert.equal(restarted.preferences.has(OWNED), false);
});

test('later manual deny or removal is preserved when disabling', () => {
  const f = fixture();
  f.api.applyGoogle(true);
  const deny = { capability: 2, owner: 'user' };
  f.permissions.set(GOOGLE[0], deny);
  f.permissions.delete(GOOGLE[1]);
  f.calls.length = 0;
  f.api.applyGoogle(false);
  assert.equal(f.permissions.get(GOOGLE[0]), deny);
  assert.equal(f.permissions.has(GOOGLE[1]), false);
  assert.equal(f.calls.filter(call => call[0] === 'remove').length, 0);
  assert.equal(f.preferences.has(OWNED), false);
});

test('invalid ownership records and non-boolean options are rejected without permission changes', () => {
  for (const stored of ['not json', '{}', 'null', 'true', JSON.stringify([GOOGLE[0], GOOGLE[0]]), JSON.stringify(['https://example.invalid']), JSON.stringify([[GOOGLE[0]]]), true]) {
    const f = fixture({ preferences: new Map([[OWNED, stored]]) });
    assert.throws(() => f.api.applyGoogle(false));
    assert.equal(f.permissions.size, 0);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.throws(() => f.api.applyGoogle('true'));
  assert.equal(f.calls.length, 0);
});

test('the pre-release boolean marker cannot authorize deletion of untracked manual exceptions', () => {
  const manual = { capability: 1, owner: 'manual-before-upgrade' };
  const f = fixture({ preferences: new Map([[LEGACY, true]]), permissions: new Map([[GOOGLE[0], manual]]) });
  f.api.applyGoogle(false);
  assert.equal(f.permissions.get(GOOGLE[0]), manual);
  assert.equal(f.preferences.has(LEGACY), false);
  assert.equal(f.calls.filter(call => call[0] === 'remove').length, 0);
});

test('privacy summary counts what Gecko blocked today and in the last 7 days, by kind', () => {
  const { api } = fixture();
  // A las 23:50 UTC del 13 (01:50 del 14 en Madrid), para Gecko aún es el día 13.
  const now = Date.UTC(2026, 9, 13, 23, 50);
  const rows = [
    { type: 1, count: 10, timestamp: '2026-10-13' },
    { type: 2, count: 4, timestamp: '2026-10-11' },
    { type: 4, count: 2, timestamp: '2026-10-07' },
    { type: 6, count: 1, timestamp: '2026-10-13' },
    { type: 5, count: 3, timestamp: '2026-10-04' },
    { type: 0, count: 50, timestamp: '2026-10-13' },
    { type: 3, count: -2, timestamp: '2026-10-13' },
    { type: 1, count: 5, timestamp: '2026-10-14' },
  ];
  const summary = JSON.parse(JSON.stringify(api.summarizeProtections(rows, now)));
  assert.deepEqual(summary.today, { trackers: 10, cookies: 0, cryptominers: 0, fingerprinters: 1, social: 0, bounce: 0, total: 11 });
  assert.deepEqual(summary.week, { trackers: 10, cookies: 4, cryptominers: 0, fingerprinters: 3, social: 0, bounce: 0, total: 17 });
});
