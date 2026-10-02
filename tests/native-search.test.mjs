import assert from 'node:assert/strict';
import test from 'node:test';
import { configureGoogle, configureGoogleScript, inspectGoogleScript } from '../install/configure-search.mjs';

function fixture(googleTemplate) {
  const events = [];
  const values = new Map([
    ['browser.search.defaultenginename', 'Google'],
    ['browser.search.defaultenginename.private', 'Google'],
  ]);
  let count = 0;
  const makeEngine = (name, template) => ({
    id: `engine-${++count}`, name, hidden: false, template,
    getSubmission(query) {
      return { uri: { spec: this.template.replace('{searchTerms}', encodeURIComponent(query)) }, postData: null };
    },
    changeUrl(type, url, postData) {
      assert.equal(type, 'text/html');
      assert.equal(postData, null);
      this.template = url;
      events.push('repair');
    },
  });
  const ddg = makeEngine('DuckDuckGo', 'https://duckduckgo.com/?q={searchTerms}');
  const engines = [ddg];
  if (googleTemplate) engines.push(makeEngine('Google', googleTemplate));
  const prefs = {
    getBoolPref: (key, fallback) => values.get(key) ?? fallback,
    setBoolPref: (key, value) => { values.set(key, value); events.push(`pref:${key}`); },
    prefHasUserValue: key => values.has(key),
    clearUserPref: key => values.delete(key),
    savePrefFile: () => events.push('save-prefs'),
  };
  const search = {
    init: async () => {},
    getEngineByName: name => engines.find(engine => engine.name === name),
    addUserEngine: async ({ name, url }) => {
      const engine = makeEngine(name, url);
      engines.push(engine);
      events.push('add');
      return engine;
    },
    defaultEngine: ddg,
    defaultPrivateEngine: ddg,
    CHANGE_REASON: { USER: 'user' },
    async setDefault(engine, reason) { assert.equal(reason, 'user'); this.defaultEngine = engine; events.push('normal'); },
    async setDefaultPrivate(engine, reason) { assert.equal(reason, 'user'); this.defaultPrivateEngine = engine; events.push('private'); },
    _settings: { _ensurePendingWritesCompleted: async () => events.push('flush-search') },
  };
  return { search, prefs, engines, values, events, ddg };
}

test('creates a real Google engine and selects it in both modes', async () => {
  const f = fixture();
  const result = await configureGoogle(f.search, f.prefs);
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.repaired, false);
  assert.equal(result.after.normal.name, 'Google');
  assert.equal(result.after.private.id, result.after.normal.id);
  const url = new URL(result.after.normal.submission);
  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.searchParams.get('q'), result.after.query);
  assert.equal(f.engines.length, 2);
  assert.ok(f.events.indexOf('flush-search') < f.events.indexOf('save-prefs'));
  assert.equal(f.values.has('browser.search.defaultenginename'), false);
  assert.equal(f.values.has('browser.search.defaultenginename.private'), false);
});

test('repairs the exact old profile defect without replacing the existing engine', async () => {
  const f = fixture('https://www.google.com/search?{searchTerms}');
  const oldId = f.engines[1].id;
  const result = await configureGoogle(f.search, f.prefs);
  assert.equal(result.repaired, true);
  assert.equal(result.created, false);
  assert.equal(result.after.normal.id, oldId);
  assert.equal(f.engines.length, 2);
  assert.equal(new URL(result.after.normal.submission).searchParams.get('q'), result.after.query);
});

test('correct Google engines are not needlessly edited', async () => {
  const f = fixture('https://www.google.com/search?q={searchTerms}');
  const result = await configureGoogle(f.search, f.prefs);
  assert.equal(result.created, false);
  assert.equal(result.repaired, false);
  assert.ok(!f.events.includes('repair'));
});

test('a later user selection survives the one-off migration being called again', async () => {
  const f = fixture();
  await configureGoogle(f.search, f.prefs);
  f.search.defaultEngine = f.ddg;
  f.search.defaultPrivateEngine = f.ddg;
  f.events.length = 0;
  const result = await configureGoogle(f.search, f.prefs);
  assert.equal(result.alreadyApplied, true);
  assert.equal(result.after.normal.name, 'DuckDuckGo');
  assert.equal(result.after.private.name, 'DuckDuckGo');
  assert.deepEqual(f.events, []);
});

test('unsupported immutable Google configuration reports an error, not false success', async () => {
  const f = fixture('https://www.google.com/search?{searchTerms}');
  delete f.engines[1].changeUrl;
  await assert.rejects(configureGoogle(f.search, f.prefs), /no se puede corregir/);
  assert.equal(f.search.defaultEngine.name, 'DuckDuckGo');
  assert.equal(f.values.has('kitsune.migrations.googleSearch.v2'), false);
});

test('failed persistence does not mark the migration as complete', async () => {
  const f = fixture();
  f.search._settings._ensurePendingWritesCompleted = async () => { throw new Error('disk write failed'); };
  await assert.rejects(configureGoogle(f.search, f.prefs), /disk write failed/);
  assert.equal(f.values.has('kitsune.migrations.googleSearch.v2'), false);
});

test('browser script exports are valid independent WebDriver async bodies', () => {
  assert.doesNotThrow(() => new Function(configureGoogleScript));
  assert.doesNotThrow(() => new Function(inspectGoogleScript));
  assert.match(configureGoogleScript, /moz-src:\/\/\/toolkit\/components\/search\/SearchService.sys.mjs/);
  assert.doesNotMatch(configureGoogleScript, /signatures\.required.*false/);
});
