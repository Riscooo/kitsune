import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userJs = await readFile(new URL('../install/user.js', import.meta.url), 'utf8');

test('the profile template uses the light browser theme, as paper needs', () => {
  assert.match(userJs, /user_pref\("browser\.theme\.toolbar-theme", 1\);/);
  assert.match(userJs, /user_pref\("browser\.theme\.content-theme", 1\);/);
  // Tinta es solo clara: el sistema no puede forzar prefers-color-scheme: dark en las webs.
  assert.match(userJs, /user_pref\("ui\.systemUsesDarkTheme", 0\);/);
  assert.doesNotMatch(userJs, /user_pref\("ui\.systemUsesDarkTheme", 1\);/);
});

test('version 0.6.0 runs Kitsune\'s own engine, with no LibreWolf left in the install', async () => {
  const version = JSON.parse(await readFile(new URL('../install/version.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(version.version, '0.6.0');
  assert.equal(version.design, 'Tinta');
  assert.equal(version.brandingRevision, 4);
  assert.equal(pkg.version, '0.6.0');
  assert.doesNotMatch(JSON.stringify(version), /librewolf/i);
  const engine = await readFile(new URL('../install/kitsune-engine.py', import.meta.url), 'utf8');
  assert.match(engine, /^BUILD_REVISION = \d+$/m);
  assert.match(engine, /^MOZILLA_RELEASE_KEY = "14F26682D0916CDD81E37B6D61B7B526D98F0353"/m);
  for (const name of ['kitsune-browser', 'user.js', 'profiles.py', 'recipe/mozconfig.in', 'recipe/policies.json', 'recipe/kitsune.cfg']) {
    assert.doesNotMatch(await readFile(new URL(`../install/${name}`, import.meta.url), 'utf8'), /librewolf/i, name);
  }
});
