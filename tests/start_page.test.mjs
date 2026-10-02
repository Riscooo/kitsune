import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const html = await read('start/index.html');
const css = await read('start/app.css');
const PAPEL = ['#f6f5f1', '#fbfaf7', '#e8ece4', '#252d2b', '#59625c', '#c7cdc4', '#963d32', '#eadfda', '#496b60', '#73786f'];
// Colores de identidad de los perfiles, en tonos de tinta legibles sobre papel.
const PROFILE_INKS = ['#35587a', '#9c4a68', '#5b4a7a', '#8a6326'];

test('the home page has no Nightfall scene, wallpapers or accents', () => {
  for (const source of [html, css]) assert.doesNotMatch(source, /scene|kitsune-night|anime-veil|wallpaper|data-accent|theme-sync/);
  assert.match(html, /<meta name="theme-color" content="#f6f5f1">/);
});

test('B · Caligrafía: big ensō logo, greeting, date and time on one line', () => {
  assert.match(html, /<section class="greeting"[^>]*>[\s\S]*<img src="logo\.svg" width="120" height="120"[\s\S]*id="welcome-line"/);
  assert.match(html, /class="clock-module"[^>]*>[\s\S]*id="date"[\s\S]*id="clock-time"/);
  assert.match(html, /<span class="footer-note">Kitsune · Tinta<\/span>/);
});

test('Ajustes → Apariencia only offers motion', () => {
  const panel = html.match(/<section id="settings-panel-appearance"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(panel, /id="motion-toggle"/);
  assert.doesNotMatch(panel, /art-toggle|theme-sync-toggle|data-accent|data-wallpaper/);
});

test('every literal color on the home page is paper or a profile ink', () => {
  const allowed = new Set([...PAPEL, ...PROFILE_INKS]);
  for (const [hex] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const base = hex.length === 9 ? hex.slice(0, 7) : hex;
    assert.ok(allowed.has(base.toLowerCase()), `app.css: ${hex} no es un color de papel`);
  }
  assert.doesNotMatch(css, /color-scheme:\s*dark/);
  assert.match(css, /"Noto Serif"/);
});

test('quick links are hanko seals alternating rust and ink', () => {
  assert.match(css, /\.link-icon::before \{[^}]*mask: url\("seal\.svg"\)/);
  assert.doesNotMatch(html + css, /seal-edge|feDisplacementMap/);
  assert.match(css, /\.quick-link:nth-child\(odd\) \.link-icon \{[^}]*var\(--accent\)/);
  assert.match(css, /\.quick-link:nth-child\(even\) \.link-icon \{[^}]*var\(--text\)/);
});

test('the home server serves the logo and no longer the Nightfall art', async () => {
  const server = await read('install/home-server.py');
  assert.match(server, /"\/logo\.svg": \("logo\.svg", "image\/svg\+xml"\)/);
  assert.match(server, /"\/seal\.svg": \("seal\.svg", "image\/svg\+xml"\)/);
  assert.doesNotMatch(server, /kitsune-night|anime-veil/);
});

test('the home page loads the same paper palette as the browser chrome', async () => {
  assert.equal(await read('start/palette.css'), await read('chrome/palette.css'));
});
