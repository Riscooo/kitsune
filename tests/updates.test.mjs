import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReleases, newerRelease, releaseLabel } from '../install/native/kitsune-updates.sys.mjs'

test('releases order betas before the final version and compare numbers, not text', () => {
  assert.equal(compareReleases('0.7.0-beta.3', '0.7.0-beta.2'), 1)
  assert.equal(compareReleases('0.7.0-beta.10', '0.7.0-beta.9'), 1)
  assert.equal(compareReleases('0.7.0', '0.7.0-beta.9'), 1)
  assert.equal(compareReleases('0.8.0-beta.1', '0.7.0'), 1)
  assert.equal(compareReleases('0.7.0-beta.3', '0.7.0-beta.3'), 0)
  assert.equal(compareReleases('0.6.9', '0.7.0-beta.1'), -1)
  assert.equal(compareReleases('0.7.0-rc.1', '0.7.0'), null)
  assert.equal(compareReleases('<script>', '0.7.0'), null)
})

test('only a newer release for this system is announced', () => {
  const downloads = { windows: { release: '0.7.0-beta.4', url: 'x' }, macos: { release: '0.7.0-beta.3' } }
  assert.deepEqual(newerRelease(downloads, 'windows', '0.7.0-beta.3'), { release: '0.7.0-beta.4' })
  assert.equal(newerRelease(downloads, 'macos', '0.7.0-beta.3'), null)
  assert.equal(newerRelease(downloads, 'linux', '0.7.0-beta.3'), null)
  assert.equal(newerRelease({ windows: { release: 'mañana' } }, 'windows', '0.7.0-beta.3'), null)
  assert.equal(newerRelease(null, 'windows', '0.7.0-beta.3'), null)
})

test('the notice names the release the way people say it', () => {
  assert.equal(releaseLabel('0.7.0-beta.3'), '0.7 beta 3')
  assert.equal(releaseLabel('0.8.0'), '0.8')
  assert.equal(releaseLabel('0.8.1'), '0.8.1')
})
