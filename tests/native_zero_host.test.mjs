import assert from 'node:assert/strict'
import test from 'node:test'
import { pickProfile, SKIP_FILES, lockPid } from '../install/native/kitsune-zero-host.sys.mjs'

test('Kitsune Zero brings the Kitsune profile used last, with its history, never its own', () => {
  const a = { dir: 'a', places: true, current: false, used: 10 }
  const b = { dir: 'b', places: true, current: false, used: 30 }
  const own = { dir: 'z', places: true, current: true, used: 99 }
  const empty = { dir: 'e', places: false, current: false, used: 50 }
  assert.equal(pickProfile([a, own, b, empty]).dir, 'b')
  assert.equal(pickProfile([own, empty]), null)
  assert.equal(pickProfile([]), null)
})

test('caches, locks and reports are not copied', () => {
  for (const name of ['cache2', 'startupCache', 'lock', '.parentlock', 'parent.lock', 'crashes', 'minidumps']) assert.ok(SKIP_FILES.has(name), name)
  for (const name of ['places.sqlite', 'logins.json', 'key4.db', 'cookies.sqlite', 'prefs.js', 'storage', 'sessionstore.jsonlz4', 'extensions']) assert.ok(!SKIP_FILES.has(name), name)
})

test('a Linux profile lock says which process holds it', () => {
  assert.equal(lockPid('192.168.0.173:+1929068'), 1929068)
  assert.equal(lockPid('127.0.0.1:+42'), 42)
  assert.equal(lockPid(''), null)
  assert.equal(lockPid(null), null)
})
