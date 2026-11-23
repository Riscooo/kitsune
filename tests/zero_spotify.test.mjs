import assert from 'node:assert/strict'
import test from 'node:test'
import { esWidevine, haceFalta, licencia, ORIGENES } from '../zero/modules/zero-spotify.mjs'

test('it is only needed on Windows, and only while the engine is not signed for Widevine', () => {
  assert.equal(haceFalta({ os: 'WINNT', firmado: false }), true)
  assert.equal(haceFalta({ os: 'WINNT', firmado: true }), false)
  assert.equal(haceFalta({ os: 'Linux', firmado: false }), false)
  assert.equal(haceFalta({ os: 'Darwin', firmado: false }), false)
})

test('only Spotify stops being offered Widevine, and only Widevine', () => {
  assert.deepEqual([...ORIGENES], ['https://open.spotify.com/*'])
  assert.equal(esWidevine('com.widevine.alpha'), true)
  assert.equal(esWidevine('com.widevine.alpha.experiment'), true)
  for (const other of ['com.microsoft.playready.recommendation', 'com.microsoft.playready.recommendation.3000', 'org.w3.clearkey', '', null, undefined]) assert.equal(esWidevine(other), false)
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
