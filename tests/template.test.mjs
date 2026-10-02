import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userJs = await readFile(new URL('../install/user.js', import.meta.url), 'utf8');

test('the profile template uses the light browser theme, as paper needs', () => {
  assert.match(userJs, /user_pref\("browser\.theme\.toolbar-theme", 1\);/);
  assert.match(userJs, /user_pref\("browser\.theme\.content-theme", 1\);/);
});

test('version 0.5.0 «Tinta» bumps the branding revision so the engine copy is rebuilt with the new logo', async () => {
  const version = JSON.parse(await readFile(new URL('../install/version.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(version.version, '0.5.0');
  assert.equal(version.design, 'Tinta');
  assert.equal(version.brandingRevision, 4);
  assert.equal(pkg.version, '0.5.0');
  const prepare = await readFile(new URL('../install/prepare-runtime.py', import.meta.url), 'utf8');
  assert.match(prepare, new RegExp(`^REVISION = ${version.brandingRevision}$`, 'm'));
});
