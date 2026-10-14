import assert from 'node:assert/strict'
import test from 'node:test'
import { lightOf, inkFor } from '../zero/modules/zero-light.mjs'

const fill = (n, rgba) => Uint8ClampedArray.from({ length: n * 4 }, (_, i) => rgba[i % 4])

test('white is all light and black is none', () => {
  assert.equal(lightOf(fill(16, [255, 255, 255, 255])), 1)
  assert.equal(lightOf(fill(16, [0, 0, 0, 255])), 0)
})

test('the light is the mean relative luminance, and see-through pixels do not count', () => {
  const half = Uint8ClampedArray.from([...fill(8, [255, 255, 255, 255]), ...fill(8, [0, 0, 0, 255]), ...fill(8, [0, 0, 0, 0])])
  assert.ok(Math.abs(lightOf(half) - 0.5) < 1e-9)
  // Verde puro es mucho más luminoso que azul puro (pesos de la luminancia relativa).
  assert.ok(lightOf(fill(4, [0, 255, 0, 255])) > 0.7 && lightOf(fill(4, [0, 0, 255, 255])) < 0.1)
  assert.equal(lightOf(new Uint8ClampedArray(0)), null)
})

test('ink above 0.62, white below 0.52, and in between it keeps what it had', () => {
  assert.equal(inkFor(0.8), 'ink')
  assert.equal(inkFor(0.3), 'white')
  assert.equal(inkFor(0.57, 'ink'), 'ink')
  assert.equal(inkFor(0.57, 'white'), 'white')
  assert.equal(inkFor(0.57), 'white')
  assert.equal(inkFor(null, 'ink'), 'ink')
})
