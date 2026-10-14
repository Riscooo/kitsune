import assert from 'node:assert/strict'
import test from 'node:test'
import { dockScales } from '../zero/modules/zero-dock.mjs'

test('the icon under the pointer grows the most and the effect fades with distance', () => {
  const s = dockScales([0, 26, 52, 78, 104], 52)
  assert.equal(s[2], 1.22)
  assert.ok(s[1] < s[2] && s[0] < s[1] && Math.abs(s[1] - s[3]) < 1e-9)
  assert.ok(Math.abs(s[0] - 1) < 0.01)
  assert.deepEqual(dockScales([0, 26], null), [1, 1])
})

test('the gain and the spread can be tuned', () => {
  const [flat] = dockScales([0], 0, { gain: 0 })
  assert.equal(flat, 1)
  const narrow = dockScales([0, 26], 0, { spread: 10 })[1]
  const wide = dockScales([0, 26], 0, { spread: 40 })[1]
  assert.ok(narrow < wide)
})
