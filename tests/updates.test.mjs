import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReleases, newerRelease, platformFor, releaseLabel } from '../install/native/kitsune-updates.sys.mjs'
import { expectedSha256, hex, linuxPackage, platformOf, releasePackage } from '../install/native/kitsune-updater.sys.mjs'

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

test('the Linux download also gets the notice; other systems do not exist for it', () => {
  assert.deepEqual(['WINNT', 'Darwin', 'Linux', 'Android'].map(platformFor), ['windows', 'macos', 'linux', null])
  assert.deepEqual(newerRelease({ linux: { release: '0.7.0-beta.6' } }, 'linux', '0.7.0-beta.5'), { release: '0.7.0-beta.6' })
})

test('Linux only updates itself from the release package on GitHub, with its SHA256SUMS', () => {
  const url = 'https://github.com/Riscooo/kitsune/releases/download/v0.8.0/Kitsune-0.8.0-Linux-x86_64.tar.xz'
  assert.deepEqual(linuxPackage({ url, release: '0.8.0' }, '0.8.0'), {
    archive: url, name: 'Kitsune-0.8.0-Linux-x86_64.tar.xz',
    sums: 'https://github.com/Riscooo/kitsune/releases/download/v0.8.0/SHA256SUMS.txt',
  })
  // Otra versión, otro repositorio, otra web o un nombre raro: nada.
  assert.equal(linuxPackage({ url, release: '0.8.0' }, '0.8.1'), null)
  assert.equal(linuxPackage({ url: url.replace('Riscooo', 'otro'), release: '0.8.0' }, '0.8.0'), null)
  assert.equal(linuxPackage({ url: 'https://evil.example/Kitsune-0.8.0-Linux-x86_64.tar.xz', release: '0.8.0' }, '0.8.0'), null)
  assert.equal(linuxPackage({ url: url + '?x', release: '0.8.0' }, '0.8.0'), null)
  assert.equal(linuxPackage({ url, release: '0.8.0/../x' }, '0.8.0/../x'), null)
  assert.equal(linuxPackage(null, '0.8.0'), null)
  // En las pruebas, el mismo camino pero en 127.0.0.1.
  const local = 'http://127.0.0.1:4000/v0.9.0/Kitsune-0.9.0-Linux-x86_64.tar.xz'
  assert.equal(linuxPackage({ url: local, release: '0.9.0' }, '0.9.0', 'http://127.0.0.1:4000').sums, 'http://127.0.0.1:4000/v0.9.0/SHA256SUMS.txt')
})

test('the expected SHA-256 is the one listed for exactly that file name', () => {
  const sums = `${'a'.repeat(64)}  Kitsune-0.8.0-Windows-x64.exe\n${'b'.repeat(64)}  Kitsune-0.8.0-Linux-x86_64.tar.xz\n${'c'.repeat(64)} *otro.tar.xz\n`
  assert.equal(expectedSha256(sums, 'Kitsune-0.8.0-Linux-x86_64.tar.xz'), 'b'.repeat(64))
  assert.equal(expectedSha256(sums, 'otro.tar.xz'), 'c'.repeat(64))
  assert.equal(expectedSha256(sums, 'Kitsune-0.8.0-Linux-x86_64.tar'), null)
  assert.equal(expectedSha256('XYZ  Kitsune-0.8.0-Linux-x86_64.tar.xz', 'Kitsune-0.8.0-Linux-x86_64.tar.xz'), null)
  assert.equal(expectedSha256(null, 'x'), null)
  assert.equal(hex('\x00\xff\x10'), '00ff10')
})

test('each system updates from its own package of that release, and nothing else', () => {
  const base = 'https://github.com/Riscooo/kitsune/releases/download/v0.8.0/Kitsune-0.8.0'
  assert.equal(releasePackage('windows', { url: `${base}-Windows-x64.exe`, release: '0.8.0' }, '0.8.0').name, 'Kitsune-0.8.0-Windows-x64.exe')
  assert.equal(releasePackage('macos', { url: `${base}-macOS-AppleSilicon.dmg`, release: '0.8.0' }, '0.8.0').name, 'Kitsune-0.8.0-macOS-AppleSilicon.dmg')
  // El .exe no vale para macOS, ni un sistema que no existe.
  assert.equal(releasePackage('macos', { url: `${base}-Windows-x64.exe`, release: '0.8.0' }, '0.8.0'), null)
  assert.equal(releasePackage('android', { url: `${base}.apk`, release: '0.8.0' }, '0.8.0'), null)
  assert.deepEqual(['WINNT', 'Darwin', 'Linux', 'Android'].map(platformOf), ['windows', 'macos', 'linux', null])
})
