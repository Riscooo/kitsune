import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userJs = await readFile(new URL('../install/user.js', import.meta.url), 'utf8');

test('the profile template leaves the light/dark scheme to the native module', () => {
  // Claro u Oscuro se elige en «Tu inicio»; un valor fijo aquí lo pisaría en cada arranque.
  for (const name of ['ui.systemUsesDarkTheme', 'browser.theme.toolbar-theme', 'browser.theme.content-theme']) {
    assert.doesNotMatch(userJs, new RegExp(`user_pref\\("${name.replaceAll('.', '\\.')}"`), name);
  }
});

test('version 0.7.0 (modo oscuro y fondo propio) runs Kitsune\'s own engine, with no LibreWolf left in the install', async () => {
  const version = JSON.parse(await readFile(new URL('../install/version.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(version.version, '0.7.0');
  assert.equal(version.design, 'Tinta');
  assert.equal(version.brandingRevision, 4);
  assert.equal(pkg.version, '0.7.0');
  assert.doesNotMatch(JSON.stringify(version), /librewolf/i);
  const engine = await readFile(new URL('../install/kitsune-engine.py', import.meta.url), 'utf8');
  assert.match(engine, /^BUILD_REVISION = \d+$/m);
  assert.match(engine, /^MOZILLA_RELEASE_KEY = "14F26682D0916CDD81E37B6D61B7B526D98F0353"/m);
  for (const name of ['kitsune-browser', 'user.js', 'profiles.py', 'recipe/mozconfig.in', 'recipe/policies.json', 'recipe/kitsune.cfg']) {
    assert.doesNotMatch(await readFile(new URL(`../install/${name}`, import.meta.url), 'utf8'), /librewolf/i, name);
  }
});
