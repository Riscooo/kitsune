import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userJs = await readFile(new URL('../install/user.js', import.meta.url), 'utf8');

test('the profile template uses the light browser theme, as paper needs', () => {
  assert.match(userJs, /user_pref\("browser\.theme\.toolbar-theme", 1\);/);
  assert.match(userJs, /user_pref\("browser\.theme\.content-theme", 1\);/);
});
