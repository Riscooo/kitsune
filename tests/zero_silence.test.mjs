import assert from 'node:assert/strict'
import test from 'node:test'
import { parseHosts, blockedHost, working, ScrollWatch } from '../zero/modules/zero-silence.mjs'

test('the list of blocked sites is cleaned up', () => {
  assert.deepEqual(parseHosts(' YouTube.com, https://www.x.com/home ,reddit.com\nreddit.com;  , m.twitch.tv '),
    ['youtube.com', 'x.com', 'reddit.com', 'm.twitch.tv'])
  assert.deepEqual(parseHosts(''), [])
  assert.deepEqual(parseHosts('localhost, nada, a..b'), ['localhost'])
  assert.deepEqual(parseHosts(null), [])
})

test('a blocked site covers its subdomains, not other sites that end the same', () => {
  const list = ['youtube.com', 'x.com']
  assert.equal(blockedHost('youtube.com', list), 'youtube.com')
  assert.equal(blockedHost('m.youtube.com', list), 'youtube.com')
  assert.equal(blockedHost('www.x.com', list), 'x.com')
  assert.equal(blockedHost('notyoutube.com', list), null)
  assert.equal(blockedHost('box.com', list), null)
  assert.equal(blockedHost('', list), null)
})

test('«while working» is a running work with the pomodoro, or always without it', () => {
  assert.equal(working({ pomodoroOn: false, phase: 'idle' }), true)
  assert.equal(working({ pomodoroOn: true, phase: 'work', running: true }), true)
  assert.equal(working({ pomodoroOn: true, phase: 'work', running: false }), false)
  assert.equal(working({ pomodoroOn: true, phase: 'short', running: true }), false)
  assert.equal(working({ pomodoroOn: true, phase: 'waiting', running: false }), false)
})

test('scrolling for ten minutes on the same page warns once, and pauses do not count', () => {
  const watch = new ScrollWatch({ limit: 10 * 60_000, gap: 5_000 })
  let t = 0, warned = 0
  // 9 minutos bajando sin parar: aún no.
  for (; t < 9 * 60_000; t += 1000) if (watch.scrolled('feed', t)) warned++
  assert.equal(warned, 0)
  // Una pausa de 10 minutos (no cuenta) y luego un minuto más: ahora sí, una vez.
  t += 10 * 60_000
  for (const end = t + 70_000; t < end; t += 1000) if (watch.scrolled('feed', t)) warned++
  assert.equal(warned, 1)
  // Otra página empieza de cero.
  assert.equal(watch.scrolled('otra', t), false)
  assert.equal(watch.minutes('otra'), 0)
})
