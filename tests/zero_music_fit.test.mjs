import assert from 'node:assert/strict'
import test from 'node:test'
import { fitMusic } from '../zero/modules/zero-music-fit.mjs'

test('a web that adapts keeps the usual narrow panel at full size', () => {
  assert.deepEqual(fitMusic({ need: 0, room: 1800 }), { width: 380, zoom: 1 })
})

test('a web with a fixed layout (Spotify needs 800 px) gets the width it needs', () => {
  assert.deepEqual(fitMusic({ need: 800, room: 1800 }), { width: 800, zoom: 1 })
})

test('when it does not fit in the window, the web is shown whole but smaller', () => {
  assert.deepEqual(fitMusic({ need: 800, room: 600 }), { width: 600, zoom: 0.75 })
})

test('the width the person chose wins, within the window, and the web still fits', () => {
  assert.deepEqual(fitMusic({ need: 800, chosen: 1000, room: 1800 }), { width: 1000, zoom: 1 })
  assert.deepEqual(fitMusic({ need: 800, chosen: 400, room: 1800 }), { width: 400, zoom: 0.5 })
  assert.deepEqual(fitMusic({ need: 0, chosen: 1000, room: 700 }), { width: 700, zoom: 1 })
  assert.deepEqual(fitMusic({ need: 0, chosen: 100, room: 1800 }), { width: 320, zoom: 1 })
})
