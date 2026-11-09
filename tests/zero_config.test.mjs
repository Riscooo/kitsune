import assert from 'node:assert/strict'
import test from 'node:test'
import { PREFS, DEFAULTS, prefName, readPrefs, shortcutText, websiteScheme, darkensWebs } from '../zero/modules/zero-config.sys.mjs'

test('Zero keeps every setting name in one place, under the prefix its host gives', () => {
  assert.equal(prefName('kitsune.zero.', PREFS.backdrop), 'kitsune.zero.backdrop')
  assert.equal(prefName('zero.', PREFS.always), 'zero.always')
})

test('Zero reads its settings from the host prefs, and falls back to its defaults', () => {
  const prefs = { getBoolPref: (name, value) => name === 'kitsune.zero.always' ? true : value, getStringPref: (name, value) => value }
  assert.deepEqual(readPrefs(prefs, 'kitsune.zero.'), { ...DEFAULTS, always: true })
  const broken = { getBoolPref() { throw new Error('sin ajustes') }, getStringPref() { throw new Error('sin ajustes') } }
  assert.deepEqual(readPrefs(broken, 'kitsune.zero.'), DEFAULTS)
  assert.deepEqual(DEFAULTS, { always: false, inherit: true, variant: 'nacar', backdrop: 'auto', backgroundImage: '', backgroundOpacity: '1', focus: true, volume: '1', islandIcons: false,
    pomodoro: false, pomodoroPreset: '25', pomodoroBreak: 'soft', pomodoroGuide: 'breathe', pomodoroState: '',
    silence: false, silenceNotify: true, silenceBlock: true, silenceBlocked: '', silenceOnlyWork: false, silenceScroll: true,
    sounds: false, soundsLevels: '{"lluvia":0.5}', soundsPause: true, welcomed: false, railIcons: false, railWindow: false, shortcutsWindow: true, hints: true, growAt: '' })
  assert.equal(prefName('kitsune.zero.', PREFS.welcomed), 'kitsune.zero.welcomed')
  assert.equal(prefName('kitsune.zero.', PREFS.railIcons), 'kitsune.zero.railIcons')
  assert.equal(prefName('kitsune.zero.', PREFS.hints), 'kitsune.zero.hints')
  assert.equal(prefName('kitsune.zero.', PREFS.growAt), 'kitsune.zero.growAt')
  assert.equal(prefName('kitsune.zero.', PREFS.soundsLevels), 'kitsune.zero.sounds.levels')
  assert.equal(prefName('kitsune.zero.', PREFS.silenceBlocked), 'kitsune.zero.silence.blocked')
  assert.equal(prefName('kitsune.zero.', PREFS.pomodoroBreak), 'kitsune.zero.pomodoro.break')
  assert.equal(prefName('kitsune.zero.', PREFS.islandIcons), 'kitsune.zero.islandIcons')
  assert.equal(prefName('kitsune.zero.', PREFS.inherit), 'kitsune.zero.inherit')
  assert.equal(prefName('kitsune.zero.', PREFS.backgroundImage), 'kitsune.zero.background.image')
  assert.equal(prefName('kitsune.zero.', PREFS.focus), 'kitsune.zero.focus.enabled')
  assert.equal(prefName('kitsune.zero.', PREFS.variant), 'kitsune.zero.variant')
})

test('the shortcut is written as each system writes it (Cmd and Option on a Mac)', () => {
  assert.equal(shortcutText('Darwin'), '⌘⌥0')
  assert.equal(shortcutText('Linux'), 'Ctrl+Alt+0')
  assert.equal(shortcutText('WINNT'), 'Ctrl+Alt+0')
})

test('las webs siguen el modo (Risco, 21-10): en Claro, su versión clara; en Oscuro, la oscura', () => {
  // layout.css.prefers-color-scheme.content-override: 0 oscuro, 1 claro.
  assert.equal(websiteScheme('nacar'), 1)
  assert.equal(websiteScheme('sobrio'), 0)
  for (const value of ['', 'raro', undefined, null]) assert.equal(websiteScheme(value), 1)
})

test('en Oscuro, también las webs claras sin versión oscura se oscurecen (Risco, 21-10); en Claro, no', () => {
  assert.equal(darkensWebs('sobrio'), true)
  for (const value of ['nacar', '', 'raro', undefined, null]) assert.equal(darkensWebs(value), false)
})

test('de 3 en 3: la rueda pasa de una en una sin salirse, y la elegida siempre cabe en la ventana (Risco, 9-11)', async () => {
  const { windowStep, windowFor, WINDOW_ROWS } = await import('../zero/modules/zero-config.sys.mjs')
  assert.equal(WINDOW_ROWS, 3)
  assert.equal(windowStep(0, 120, 8), 1)
  assert.equal(windowStep(1, -3, 8), 0)
  assert.equal(windowStep(0, -50, 8), 0)
  assert.equal(windowStep(5, 100, 8), 5)   // la última ventana enseña las tres últimas
  assert.equal(windowStep(4, 0, 5), 2)
  assert.equal(windowStep(0, 100, 2), 0)   // con menos de tres, nada que pasar
  assert.equal(windowFor(0, 1, 8), 0)      // ya se ve: no se mueve
  assert.equal(windowFor(0, 5, 8), 3)      // abajo: la deja la última de la ventana
  assert.equal(windowFor(4, 2, 8), 2)      // arriba: la deja la primera
  assert.equal(windowFor(6, -1, 8), 5)
})
