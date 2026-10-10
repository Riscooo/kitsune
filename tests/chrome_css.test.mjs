import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = name => readFile(new URL(`../chrome/${name}`, import.meta.url), 'utf8');
// The ten interface colours; internal pages and the native module use only these.
const INTERFACE = {
  bg: '#f6f5f1', surface: '#fbfaf7', 'surface-high': '#e8ece4', text: '#252d2b', muted: '#59625c',
  outline: '#c7cdc4', primary: '#963d32', 'primary-container': '#eadfda', secondary: '#496b60', tertiary: '#73786f',
};
// Plus the InkShadow seal colours, for the hanko marks.
const PAPEL = { ...INTERFACE, hanko: '#a8432f', vermilion: '#db452e' };
// Y el óxido de la paleta sumi (Oscuro), para la barra de scroll de las páginas oscuras.
const ALLOWED = new Set([...Object.values(PAPEL), '#e0806b']);
const CHROME = ['userChrome.css', 'kitsune-header.css', 'window-controls.css'];

test('the chrome palette is exactly the InkShadow paper tokens, generated from their single source', async () => {
  const css = await read('palette.css');
  assert.match(css, /generado por tools\/design_tokens\.py de InkShadow desde design\/tokens\.json/);
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
    // Oscuro solo llega por --kb-scheme del módulo nativo, nunca fijo en el CSS.
    assert.doesNotMatch(css, /(?<!prefers-)color-scheme:\s*dark/, `${name} fija el modo oscuro`);
    assert.doesNotMatch(css, /rgba?\(|hsla?\(/, `${name} usa colores fuera de los tokens`);
  }
});

test('the chrome follows the Kitsune theme (light unless the native module says dark) and InkShadow typography', async () => {
  const css = await read('userChrome.css');
  assert.match(css, /color-scheme:\s*var\(--kb-scheme, light\)\s*!important/);
  assert.doesNotMatch(css, /color-scheme:\s*light\s*!important/);
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

test('internal pages are paper unless the theme says dark: paper fallback tokens, no Nightfall art', async () => {
  const css = (await read('userContent.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /(?<!prefers-)color-scheme:\s*dark/);
  assert.doesNotMatch(css, /kitsune-night|anime-veil/);
  assert.doesNotMatch(css, /rgba?\(|hsla?\(/);
  for (const [hex] of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const base = hex.length === 9 ? hex.slice(0, 7) : hex;
    assert.ok(ALLOWED.has(base.toLowerCase()), `userContent.css: ${hex} no es un token de papel`);
  }
  const fallback = Object.fromEntries([...css.matchAll(/--kb-([a-z-]+):\s*(#[0-9a-f]{6});/g)].map(m => [m[1], m[2]]));
  assert.deepEqual(fallback, INTERFACE);
});

test('scrollbars are a rust stroke on a transparent track, lighter on dark pages', async () => {
  const content = await read('userContent.css');
  assert.match(content, /:root \{\s*scrollbar-color: light-dark\(color-mix\(in srgb, #963d32 62%, transparent\), color-mix\(in srgb, #e0806b 72%, transparent\)\) transparent;/);
  assert.match(await read('userChrome.css'), /scrollbar-color: color-mix\(in srgb, var\(--kb-primary\) 62%, transparent\) transparent;/);
});

test('reader view is paper and ink with a serif body', async () => {
  const css = await read('userContent.css');
  const reader = css.match(/@-moz-document url-prefix\("about:reader"\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(reader, /--kb-bg|var\(--kb-bg\)|#f6f5f1/);
  assert.match(reader, /"Noto Serif"/);
});

test('security error pages are never restyled', async () => {
  const css = (await read('userContent.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /about:(certerror|neterror|blocked)/);
});

test('internal pages map Gecko 154 design tokens (accent, buttons, focus) to rust, not system blue', async () => {
  const css = await read('userContent.css');
  const block = css.match(/@-moz-document url\("about:downloads"\)[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  for (const token of ['--color-accent-primary', '--button-background-color-primary', '--focus-outline-color', '--link-color']) {
    assert.match(block, new RegExp(`${token}:\\s*var\\(--kb-(primary|secondary)\\)`), `${token} sin mapear`);
  }
});

test('every chrome panel maps Gecko 154 accent, primary button and focus tokens to rust (jade in private windows)', async () => {
  const css = await read('userChrome.css');
  const root = css.match(/\n:root \{([\s\S]*?)\n\}/)?.[1] ?? '';
  for (const token of ['--color-accent-primary', '--button-background-color-primary', '--button-text-color-primary', '--focus-outline-color', '--link-color']) {
    assert.match(root, new RegExp(`${token}:\\s*var\\(--kb-(accent|surface|secondary)\\)`), `${token} sin mapear en :root`);
  }
});

test('the private browsing page is paper and jade: search field, info box and promo never keep Gecko purple', async () => {
  const css = await read('userContent.css');
  const block = css.match(/@-moz-document url\("about:privatebrowsing"\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(block, /html\.private \{[^}]*color-scheme:\s*var\(--kb-scheme, light\)[^}]*background:\s*var\(--kb-bg\)/s);
  assert.match(block, /content-search-handoff-ui \{[^}]*--content-search-handoff-ui-background-color:\s*var\(--kb-surface\)[^}]*--content-search-handoff-ui-color:\s*var\(--kb-text\)/s);
  assert.match(block, /\.info \{[^}]*background(-color)?:\s*var\(--kb-surface\)/s);
  assert.match(block, /\.info-border \{[^}]*background:\s*(transparent|none)/s);
  assert.match(block, /\.promo-cta \.primary \{[^}]*background(-color)?:\s*var\(--kb-secondary\)/s);
});

test('the native new tab maps Nova design tokens (violet accent, button ring, icons) to paper tokens', async () => {
  const css = await read('userContent.css');
  const block = css.match(/@-moz-document url\("about:newtab"\), url\("about:home"\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  for (const token of ['--color-accent-primary', '--button-border-color', '--button-border-color-hover', '--icon-color', '--focus-outline-color', '--border-color-interactive']) {
    assert.match(block, new RegExp(`${token}:\\s*var\\(--kb-[a-z-]+\\)`), `${token} sin mapear en la nueva pestaña`);
  }
});

test("a page's <select> drop-down follows the page: paper on a light select, the system's dark menu on a dark one", async () => {
  const css = (await read('userChrome.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  // Gecko marks the drop-down dark (inline color-scheme) when the select is dark; the
  // paper override for every menupopup must not cover that one with paper and ink.
  const rule = css.match(/#ContentSelectDropdownPopup\s*\{([^}]*)\}/);
  assert.ok(rule, 'no rule for the content select drop-down');
  for (const token of ['--panel-background', '--panel-background-color', '--panel-text-color']) {
    const value = rule[1].match(new RegExp(`${token}:\\s*([^;]+);`));
    assert.ok(value, `${token} is not set for the select drop-down`);
    assert.match(value[1], /^light-dark\(var\(--kb-[a-z-]+\),\s*Menu(Text)?\)\s*!important$/, `${token}: ${value[1]}`);
  }
});
