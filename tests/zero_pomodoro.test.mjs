import assert from 'node:assert/strict'
import test from 'node:test'
import { PRESETS, initial, start, pause, resume, skip, reset, toggle, view, normalize } from '../zero/modules/zero-pomodoro.mjs'

const MIN = 60_000
const p = PRESETS['25']

test('there are three presets, and each long break is three short ones every four works', () => {
  assert.deepEqual(Object.keys(PRESETS), ['25', '50', '90'])
  assert.deepEqual(PRESETS['25'], { work: 25, short: 5, long: 15, every: 4 })
  assert.deepEqual(PRESETS['50'], { work: 50, short: 10, long: 30, every: 4 })
  assert.deepEqual(PRESETS['90'], { work: 90, short: 15, long: 45, every: 4 })
})

test('it starts idle, and starting gives 25:00 of work, the first of four', () => {
  const idle = view(initial(), p, 0)
  assert.equal(idle.phase, 'idle')
  assert.equal(idle.running, false)
  assert.equal(idle.left, 25 * MIN)
  const s = start(initial(), p, 1000)
  assert.deepEqual(view(s, p, 1000), { phase: 'work', running: true, left: 25 * MIN, total: 25 * MIN, cycle: 1, every: 4, ending: false })
  assert.equal(view(s, p, 1000 + 10 * MIN).left, 15 * MIN)
})

test('after the work comes a short break, and after the fourth work a long one', () => {
  let s = start(initial(), p, 0)
  let v = view(s, p, 25 * MIN + 1000)
  assert.equal(v.phase, 'short')
  assert.equal(v.total, 5 * MIN)
  assert.equal(v.left, 5 * MIN - 1000)
  // Tres ciclos más: el cuarto trabajo acaba en un descanso largo.
  for (let cycle = 2; cycle <= 4; cycle++) {
    s = start(normalize(s, p, 31 * MIN * (cycle - 1)), p, 31 * MIN * (cycle - 1))
    assert.equal(view(s, p, 31 * MIN * (cycle - 1)).cycle, cycle)
  }
  v = view(s, p, 31 * MIN * 3 + 25 * MIN + 1)
  assert.equal(v.phase, 'long')
  assert.equal(v.total, 15 * MIN)
})

test('when a break ends it waits for a click, and the next work is the next cycle', () => {
  const s = start(initial(), p, 0)
  const v = view(s, p, 31 * MIN)
  assert.equal(v.phase, 'waiting')
  assert.equal(v.running, false)
  assert.equal(v.cycle, 2)
  assert.equal(v.left, 25 * MIN)
  const next = toggle(normalize(s, p, 31 * MIN), p, 31 * MIN)
  assert.equal(view(next, p, 31 * MIN).phase, 'work')
  assert.equal(view(next, p, 31 * MIN).cycle, 2)
  // Tras el descanso largo, vuelta al primero.
  let t = 0, st = start(initial(), p, 0)
  for (let i = 0; i < 4; i++) { st = skip(skip(st, p, t), p, t); st = start(normalize(st, p, t), p, t) }
  assert.equal(view(st, p, t).cycle, 1)
})

test('pausing freezes what is left, and resuming keeps it', () => {
  let s = start(initial(), p, 0)
  s = pause(s, p, 10 * MIN)
  assert.deepEqual([view(s, p, 50 * MIN).left, view(s, p, 50 * MIN).running, view(s, p, 50 * MIN).phase], [15 * MIN, false, 'work'])
  s = resume(s, p, 60 * MIN)
  assert.equal(view(s, p, 65 * MIN).left, 10 * MIN)
  assert.equal(view(toggle(s, p, 65 * MIN), p, 99 * MIN).left, 10 * MIN)
})

test('skipping goes to the next phase, and reset goes back to idle', () => {
  let s = start(initial(), p, 0)
  s = skip(s, p, 5 * MIN)
  assert.equal(view(s, p, 5 * MIN).phase, 'short')
  assert.equal(view(s, p, 5 * MIN).left, 5 * MIN)
  s = skip(s, p, 6 * MIN)
  assert.equal(view(s, p, 6 * MIN).phase, 'waiting')
  assert.equal(view(reset(), p, 0).phase, 'idle')
})

test('the last minute of work is «ending», and a broken saved state goes back to idle', () => {
  const s = start(initial(), p, 0)
  assert.equal(view(s, p, 24 * MIN).ending, true)
  assert.equal(view(s, p, 23 * MIN).ending, false)
  for (const broken of [null, 'x', { phase: 'nope' }, { phase: 'work', startedAt: 'mañana' }]) {
    assert.equal(view(broken, p, 0).phase, 'idle')
  }
})
