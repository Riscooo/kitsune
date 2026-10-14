import assert from 'node:assert/strict'
import test from 'node:test'
import { LAYERS, parseLevels, gains } from '../zero/modules/zero-sounds.mjs'

test('six real recordings, each with its file', () => {
  assert.deepEqual(LAYERS.map(layer => layer.id), ['lluvia', 'bosque', 'cafeteria', 'olas', 'fuego', 'rio'])
  for (const layer of LAYERS) assert.equal(layer.file, `chrome://browser/content/zero/zero-sonido-${layer.id}.ogg`)
})

test('the saved levels are read safely, between 0 and 1', () => {
  assert.deepEqual(parseLevels('{"lluvia": 0.6, "olas": 2, "nada": 1, "fuego": -1}'), { lluvia: 0.6, bosque: 0, cafeteria: 0, olas: 1, fuego: 0, rio: 0 })
  assert.deepEqual(parseLevels('roto'), { lluvia: 0, bosque: 0, cafeteria: 0, olas: 0, fuego: 0, rio: 0 })
})

test('the gain follows the ear (level squared), and is silent when off or in a break that pauses', () => {
  const levels = { lluvia: 0.6, bosque: 0, cafeteria: 1, olas: 0, fuego: 0, rio: 0 }
  const on = gains(levels, { on: true, phase: 'work', pauseInBreak: true })
  assert.ok(Math.abs(on.lluvia - 0.36) < 1e-9)
  assert.equal(on.cafeteria, 1)
  assert.equal(on.bosque, 0)
  assert.deepEqual(Object.values(gains(levels, { on: false, phase: 'work', pauseInBreak: true })), [0, 0, 0, 0, 0, 0])
  assert.deepEqual(Object.values(gains(levels, { on: true, phase: 'short', pauseInBreak: true })), [0, 0, 0, 0, 0, 0])
  assert.ok(gains(levels, { on: true, phase: 'long', pauseInBreak: false }).lluvia > 0.3)
})
