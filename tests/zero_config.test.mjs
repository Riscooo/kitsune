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
  assert.deepEqual(DEFAULTS, { always: false, backdrop: 'auto', islandIcons: false,
    pomodoro: false, pomodoroPreset: '25', pomodoroBreak: 'soft', pomodoroGuide: 'breathe', pomodoroState: '',
    silence: false, silenceNotify: true, silenceBlock: true, silenceBlocked: '', silenceOnlyWork: false, silenceScroll: true,
    sounds: false, soundsLevels: '{"lluvia":0.5}', soundsPause: true })
  assert.equal(prefName('kitsune.zero.', PREFS.soundsLevels), 'kitsune.zero.sounds.levels')
  assert.equal(prefName('kitsune.zero.', PREFS.silenceBlocked), 'kitsune.zero.silence.blocked')
  assert.equal(prefName('kitsune.zero.', PREFS.pomodoroBreak), 'kitsune.zero.pomodoro.break')
  assert.equal(prefName('kitsune.zero.', PREFS.islandIcons), 'kitsune.zero.islandIcons')
})
