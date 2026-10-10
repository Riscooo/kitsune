import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const html = await read('start/index.html');
const css = await read('start/app.css');
const PAPEL = ['#f6f5f1', '#fbfaf7', '#e8ece4', '#252d2b', '#59625c', '#c7cdc4', '#963d32', '#eadfda', '#496b60', '#73786f'];
const SUMI = ['#161a19', '#1e2321', '#2a302d', '#ebe8e0', '#a9b0a8', '#3f4743', '#e0806b', '#4b2a23', '#8fb8aa', '#8d9389'];
// Colores de identidad de los perfiles: tintas legibles sobre papel y, aclaradas, sobre sumi.
const PROFILE_INKS = ['#35587a', '#9c4a68', '#5b4a7a', '#8a6326', '#8fb0d4', '#e09ab3', '#b4a3d6', '#d9ac62'];

test('the home page has no Nightfall scene, wallpapers or accents', () => {
  for (const source of [html, css]) assert.doesNotMatch(source, /scene|kitsune-night|anime-veil|wallpaper|data-accent|theme-sync/);
  assert.match(html, /<meta name="theme-color" content="#f6f5f1">/);
});

test('B · Caligrafía: big ensō logo, greeting, date and time on one line', () => {
  assert.match(html, /<section class="greeting"[^>]*>[\s\S]*<span class="logo-art logo-light"><img class="logo-ring" src="logo-ring\.svg"[^>]*><img class="logo-mask" src="logo-mask\.svg"[^>]*><\/span><span class="logo-art logo-dark">[\s\S]*id="welcome-line"/);
  // Solo gira el ensō: la máscara del zorro se queda quieta.
  assert.match(css, /\.brand:hover \.logo-ring[^{]*\{ rotate:/);
  assert.doesNotMatch(css, /\.logo-mask[^{]*\{[^}]*(rotate|animation)/);
  assert.match(html, /class="clock-module"[^>]*>[\s\S]*id="date"[\s\S]*id="clock-time"/);
});

test('the footer has nothing in the bottom-left corner: only Enfoque and Atajos, on the right', () => {
  assert.doesNotMatch(html, /footer-note|footer-seal|Kitsune · Tinta/);
  assert.match(html, /<footer class="footer"><div><button id="focus-toggle"/);
  assert.match(css, /\.footer \{[^}]*justify-content: flex-end/);
  assert.doesNotMatch(css, /footer-note|footer-seal/);
});

test('Ajustes → Apariencia offers Claro/Oscuro, your own background and motion', () => {
  const panel = html.match(/<section id="settings-panel-appearance"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(panel, /id="motion-toggle"/);
  assert.match(panel, /<input id="theme-claro" type="radio" name="theme" value="claro"/);
  assert.match(panel, /<input id="theme-oscuro" type="radio" name="theme" value="oscuro"/);
  assert.match(panel, /<input id="background-file" type="file" accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(panel, /id="background-remove"/);
  assert.doesNotMatch(panel, /una sola estética/);
  assert.doesNotMatch(panel, /art-toggle|theme-sync-toggle|data-accent|data-wallpaper/);
});

test('every literal color on the home page is paper, sumi or a profile ink', () => {
  const allowed = new Set([...PAPEL, ...SUMI, ...PROFILE_INKS]);
  for (const [hex] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const base = hex.length === 9 ? hex.slice(0, 7) : hex;
    assert.ok(allowed.has(base.toLowerCase()), `app.css: ${hex} no es un color de papel`);
  }
  // Oscuro solo existe bajo data-theme=oscuro, que pone el propio inicio desde los ajustes.
  assert.equal([...css.matchAll(/color-scheme:\s*dark/g)].length, 1);
  assert.match(css, /:root\[data-theme=oscuro\] \{\s*color-scheme: dark;/);
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
  assert.match(server, /"\/logo-dark\.svg": \("logo-dark\.svg", "image\/svg\+xml"\)/);
  for (const name of ['logo-ring', 'logo-mask', 'logo-ring-dark', 'logo-mask-dark']) assert.match(server, new RegExp(`"/${name}\\.svg"`));
  assert.match(server, /"\/seal\.svg": \("seal\.svg", "image\/svg\+xml"\)/);
  assert.doesNotMatch(server, /kitsune-night|anime-veil/);
});

test('the home page loads the same paper palette as the browser chrome', async () => {
  assert.equal(await read('start/palette.css'), await read('chrome/palette.css'));
});

