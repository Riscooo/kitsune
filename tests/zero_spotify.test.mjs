import assert from 'node:assert/strict'
import test from 'node:test'
import { esSpotify, esReproductor, filaDe, suenaEn, haceFalta, licencia, ORIGENES } from '../zero/modules/zero-spotify.mjs'

test('it is only needed on Windows, and only while the engine is not signed for Widevine', () => {
  assert.equal(haceFalta({ os: 'WINNT', firmado: false }), true)
  assert.equal(haceFalta({ os: 'WINNT', firmado: true }), false)
  assert.equal(haceFalta({ os: 'Linux', firmado: false }), false)
  assert.equal(haceFalta({ os: 'Darwin', firmado: false }), false)
})

test('it only touches Spotify', () => {
  assert.deepEqual([...ORIGENES], ['https://open.spotify.com/*'])
  assert.equal(esSpotify('https://open.spotify.com/playlist/x'), true)
  for (const other of ['https://spotify.com/', 'https://open.spotify.com.evil.example/', 'about:blank', '', null]) assert.equal(esSpotify(other), false)
})

test('this computer is the device whose name ends the row, in any language', () => {
  const rows = ['Este navegador web', 'Conectar a este dispositivo\n  DESKTOP-ABC123', 'Connect to this device Salón']
  assert.equal(filaDe(rows, 'desktop-abc123'), 1)
  assert.equal(filaDe(rows, 'DESKTOP'), -1)
  assert.equal(filaDe(rows, ''), -1)
  // El que es justo su nombre gana al que solo acaba igual.
  assert.equal(filaDe(['Salón PC', 'PC'], 'pc'), 1)
  assert.equal(suenaEn('Cambiar el volumen Reproduciendo en DESKTOP-ABC123', 'DESKTOP-ABC123'), true)
  assert.equal(suenaEn('Cambiar el volumen', 'DESKTOP-ABC123'), false)
  assert.equal(suenaEn('lo que sea', ''), false)
})

test('a licence answer is read from its status alone, and nothing else counts as one', () => {
  const at = (path, status = 200, extra = {}) => licencia({ host: 'gew1-spclient.spotify.com', path, status, method: 'POST', ...extra })
  assert.deepEqual(at('/playready-license/v1/audio/license'), { sistema: 'playready', dada: true, status: 200 })
  assert.deepEqual(at('/widevine-license/v1/audio/license', 403), { sistema: 'widevine', dada: false, status: 403 })
  assert.equal(at('/widevine-license/v1/application-certificate'), null)
  assert.equal(at('/playready-license/v1/audio/license', 200, { method: 'OPTIONS' }), null)
  assert.equal(at('/melody/v1/license_url'), null)
  assert.equal(at('/playready-license/v1/audio/license', 200, { host: 'notspotify.com' }), null)
  assert.equal(at('/playready-license/v1/audio/license', 200, { host: 'evil-spotify.com.example' }), null)
})

test('only its own player can hold a license back: never one embedded in another page', () => {
  for (const url of ['https://open.spotify.com/', 'https://open.spotify.com/intl-es/track/1', 'https://open.spotify.com/search/embed']) assert.equal(esReproductor(url), true, url)
  for (const url of ['https://open.spotify.com/embed/track/1', 'https://open.spotify.com/intl-es/embed/track/1', 'https://open.spotify.com/embed-podcast/show/1',
    'https://example.com/?https://open.spotify.com/', 'https://open.spotify.com.example.com/', 'about:blank', null]) assert.equal(esReproductor(url), false, String(url))
})
