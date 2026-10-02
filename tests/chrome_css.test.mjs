import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = name => readFile(new URL(`../chrome/${name}`, import.meta.url), 'utf8');
const PAPEL = {
  bg: '#f6f5f1', surface: '#fbfaf7', 'surface-high': '#e8ece4', text: '#252d2b', muted: '#59625c',
  outline: '#c7cdc4', primary: '#963d32', 'primary-container': '#eadfda', secondary: '#496b60', tertiary: '#73786f',
};
const ALLOWED = new Set(Object.values(PAPEL));
const CHROME = ['userChrome.css', 'kitsune-header.css', 'window-controls.css'];

test('the chrome palette is exactly the ten paper tokens', async () => {
  const css = await read('palette.css');
  const tokens = Object.fromEntries([...css.matchAll(/--kb-([a-z-]+):\s*(#[0-9a-f]{6});/g)].map(m => [m[1], m[2]]));
  assert.deepEqual(tokens, PAPEL);
});

test('every literal color in the browser chrome is a paper token (homogeneous, no Nightfall leftovers)', async () => {
  for (const name of CHROME) {
    const css = (await read(name)).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [hex] of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const base = hex.length === 9 ? hex.slice(0, 7) : hex;
      assert.ok(ALLOWED.has(base.toLowerCase()), `${name}: ${hex} no es un token de papel`);
    }
    assert.doesNotMatch(css, /color-scheme:\s*dark/, `${name} sigue en modo oscuro`);
    assert.doesNotMatch(css, /rgba?\(|hsla?\(/, `${name} usa colores fuera de los tokens`);
  }
});

test('the chrome uses the light color scheme and InkShadow typography', async () => {
  const css = await read('userChrome.css');
  assert.match(css, /color-scheme:\s*light\s*!important/);
  assert.doesNotMatch(css, /"Inter"/);
  assert.match(css, /font-family:\s*"Noto Sans"/);
});

test('the selected tab carries the rust brush stroke on top', async () => {
  const css = await read('kitsune-header.css');
  assert.match(css, /:is\(\[selected\], \[visually-selected\]\) \.tab-background \{[^}]*url\("assets\/kitsune-stroke\.svg"\)/s);
});

test('loading tabs spin only the ensō around a still mask, and only pulse with reduced motion', async () => {
  const css = await read('userChrome.css');
  const ring = css.match(/\.tab-throbber\[busy\]::before \{[^}]*\}/s)?.[0] ?? '';
  const mask = css.match(/\.tab-throbber\[busy\] \{[^}]*\}/s)?.[0] ?? '';
  assert.match(ring, /url\("assets\/kitsune-throbber-ring\.svg"\)/);
  assert.match(ring, /animation:\s*kitsune-enso-spin/);
  assert.match(mask, /url\("assets\/kitsune-throbber-mask\.svg"\)/);
  assert.doesNotMatch(mask, /animation/);
  assert.match(css, /@keyframes kitsune-enso-spin \{[^}]*rotate\(1turn\)/s);
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(reduced, /\.tab-throbber\[busy\]::before \{[^}]*animation:\s*kitsune-enso-pulse/s);
  assert.match(css, /@keyframes kitsune-enso-pulse \{[^}]*opacity/s);
  assert.doesNotMatch(css.match(/@keyframes kitsune-enso-pulse \{[\s\S]*?\n\}/)?.[0] ?? '', /rotate/);
});
