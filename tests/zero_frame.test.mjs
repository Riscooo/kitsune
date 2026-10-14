import assert from 'node:assert/strict'
import test from 'node:test'
import { dominantColor, backdropMode } from '../zero/modules/zero-frame.sys.mjs'

const block = (...parts) => {
  const bytes = []
  for (const [hex, count] of parts) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
    for (let i = 0; i < count; i++) bytes.push(r, g, b, 255)
  }
  return new Uint8ClampedArray(bytes)
}
const warm = hex => { const [r, , b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return r > b + 60 }

test('the tint takes the colour of the page, not its white paper or black text', () => {
  assert.ok(warm(dominantColor(block(['#c8553d', 40], ['#ffffff', 60]))))
  assert.ok(warm(dominantColor(block(['#c8553d', 30], ['#101010', 30], ['#fbfaf7', 40]))))
})

test('a page that is only white (or only black) still gives its own colour', () => {
  assert.equal(dominantColor(block(['#ffffff', 50])), '#ffffff')
  assert.equal(dominantColor(block(['#000000', 50])), '#000000')
  assert.equal(dominantColor(new Uint8ClampedArray(0)), null)
})

test('the system glass is used only when the compositor can blur behind Kitsune', () => {
  assert.equal(backdropMode('auto', { niri: true, rule: true }), 'system')
  assert.equal(backdropMode('auto', { niri: true, rule: false }), 'web')
  assert.equal(backdropMode('auto', { niri: false, rule: false }), 'web')
  assert.equal(backdropMode('web', { niri: true, rule: true }), 'web')
  assert.equal(backdropMode('system', { niri: false }), 'system')
  assert.equal(backdropMode('raro', { niri: true, rule: true }), 'system')
})
