import assert from 'node:assert/strict'
import test from 'node:test'
import { PREFS, DEFAULTS, prefName, readPrefs } from '../zero/modules/zero-config.sys.mjs'

test('Zero keeps every setting name in one place, under the prefix its host gives', () => {
  assert.equal(prefName('kitsune.zero.', PREFS.backdrop), 'kitsune.zero.backdrop')
  assert.equal(prefName('zero.', PREFS.always), 'zero.always')
})

test('Zero reads its settings from the host prefs, and falls back to its defaults', () => {
  const prefs = { getBoolPref: (name, value) => name === 'kitsune.zero.always' ? true : value, getStringPref: (name, value) => value }
  assert.deepEqual(readPrefs(prefs, 'kitsune.zero.'), { ...DEFAULTS, always: true })
  const broken = { getBoolPref() { throw new Error('sin ajustes') }, getStringPref() { throw new Error('sin ajustes') } }
  assert.deepEqual(readPrefs(broken, 'kitsune.zero.'), DEFAULTS)
  assert.deepEqual(DEFAULTS, { always: false, backdrop: 'auto', islandIcons: false })
  assert.equal(prefName('kitsune.zero.', PREFS.islandIcons), 'kitsune.zero.islandIcons')
})
