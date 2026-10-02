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

function fixture({ permissions = new Map(), preferences = new Map(), inherited = false } = {}) {
  const calls = [];
  const prefs = {
    getStringPref: (name, fallback) => preferences.has(name) ? preferences.get(name) : fallback,
    getBoolPref: (name, fallback) => preferences.has(name) ? preferences.get(name) : fallback,
    setStringPref(name, value) { assert.equal(name, OWNED); assert.equal(typeof value, 'string'); preferences.set(name, value); calls.push(['pref', name, value]); },
    prefHasUserValue: name => preferences.has(name),
    clearUserPref(name) { assert.ok([OWNED, LEGACY].includes(name)); preferences.delete(name); calls.push(['clear', name]); },
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
    ChromeUtils: { importESModule(specifier) { assert.equal(specifier, 'resource://gre/modules/Timer.sys.mjs'); return { setInterval() {}, clearInterval() {} }; } },
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
    '\nglobalThis.api = { validate, nativeCss, applyGoogle, managedOrigins };', context);
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

test('a Nightfall (v1) control is rejected instead of half-applied', () => {
  const { api } = fixture();
  assert.throws(() => api.validate({ ...control(), version: 1, wallpaper: 'night', themeSync: false, art: true }));
  assert.throws(() => api.validate({ ...control(), version: 1 }));
});

test('native styles remain restricted to enumerated internal pages and carry no background images', () => {
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
