import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { detectPlatform, parseDownloads } from '../web/descargas.mjs'

const ORIGIN = 'https://kitsune.example'

test('the big button picks the visitor system and skips phones', () => {
  assert.equal(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32'), 'windows')
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)', 'MacIntel'), 'macos')
  assert.equal(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64'), 'linux')
  assert.equal(detectPlatform('Mozilla/5.0 (Linux; Android 15)', 'Linux armv8l'), null)
  assert.equal(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)', 'iPhone'), null)
})

test('downloads only link to this site or GitHub, and missing ones stay «Próximamente»', () => {
  const parsed = parseDownloads({
    version: '0.7',
    windows: { url: '/descargas/kitsune-0.7-windows.exe', size: '92 MB', note: 'Beta · sin firmar' },
    macos: { url: 'https://github.com/Riscooo/kitsune/releases/download/v0.7/kitsune.dmg' },
    linux: { url: 'https://evil.example/kitsune.tar.xz' },
  }, ORIGIN)
  assert.equal(parsed.version, '0.7')
  assert.deepEqual(parsed.files.windows, { url: `${ORIGIN}/descargas/kitsune-0.7-windows.exe`, size: '92 MB', note: 'Beta · sin firmar' })
  assert.equal(parsed.files.macos.size, '')
  assert.equal(parsed.files.linux, undefined)
  assert.deepEqual(parseDownloads({ windows: { url: 'javascript:alert(1)' } }, ORIGIN).files, {})
  assert.deepEqual(parseDownloads(null, ORIGIN), { version: null, files: {} })
})

test('published downloads only point at releases of this repository, and the page has every section it links to', async () => {
  const published = JSON.parse(await readFile(new URL('../web/downloads.json', import.meta.url), 'utf8'))
  for (const file of Object.values(parseDownloads(published, ORIGIN).files)) {
    assert.match(file.url, /^https:\/\/github\.com\/Riscooo\/kitsune\/releases\/download\/v[\w.-]+\/[\w.-]+$/)
  }
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8')
  for (const [, id] of html.matchAll(/href="#([\w-]+)"/g)) assert.match(html, new RegExp(`id="${id}"`), id)
  for (const [, src] of html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)) {
    await readFile(new URL(`../web/${src}`, import.meta.url))
  }
  assert.doesNotMatch(html, /fonts\.googleapis|googletagmanager|analytics/)
})

test('the English page mirrors the Spanish one: same sections, assets and downloads, and each links to the other', async () => {
  const es = await readFile(new URL('../web/index.html', import.meta.url), 'utf8')
  const en = await readFile(new URL('../web/en/index.html', import.meta.url), 'utf8')
  const ids = html => [...html.matchAll(/ id="([\w-]+)"/g)].map(match => match[1])
  assert.deepEqual(ids(en), ids(es))
  assert.match(en, /<html lang="en"/)
  assert.match(es, /hreflang="en" href="https:\/\/kitsune-navegador\.vercel\.app\/en"/)
  assert.match(en, /<a href="\/" hreflang="es" lang="es">Español<\/a>/)
  assert.match(es, /<a href="\/en" hreflang="en" lang="en">English<\/a>/)
  for (const [, id] of en.matchAll(/href="#([\w-]+)"/g)) assert.match(en, new RegExp(`id="${id}"`), id)
  for (const [, src] of en.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)) await readFile(new URL(`../web/${src}`, import.meta.url))
  // Nada de castellano a la vista (salvo el enlace «Español»).
  const visible = en.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<[^>]+>/g, ' ').replace('Español', '')
  assert.doesNotMatch(visible, /[¿¡ñáéíóú]|Descargar|Próximamente/)
})

test('the download cards use the note translator, not a variable with the same name', async () => {
  // Un <p> llamado «note» tapó la función note() y los botones se quedaban sin enlace.
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8')
  assert.match(source, /const noteText = text =>/)
  assert.doesNotMatch(source, /\bnote\(file\.note\)/)
})

test('the Intel Mac download is read too, as an extra link for the macOS card', async () => {
  const { parseDownloads, EXTRAS } = await import('../web/descargas.mjs')
  assert.equal(EXTRAS['macos-intel'].card, 'macos')
  const parsed = parseDownloads({ 'macos-intel': { url: 'https://github.com/Riscooo/kitsune/releases/download/v0.8.0/Kitsune-0.8.0-macOS-Intel.dmg', size: '110 MB' } }, ORIGIN)
  assert.equal(parsed.files['macos-intel'].size, '110 MB')
})
