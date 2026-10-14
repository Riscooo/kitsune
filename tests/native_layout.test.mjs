import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_SPLIT, splitAction } from '../install/native/kitsune-layout.sys.mjs'

test('Ctrl+Alt+D splits, adds panels up to four, and puts several selected tabs together', () => {
  assert.equal(MAX_SPLIT, 4)
  assert.equal(splitAction({ splitCount: 0, selected: 1 }), 'split')
  assert.equal(splitAction({ splitCount: 0, selected: 3 }), 'join')
  assert.equal(splitAction({ splitCount: 2, selected: 1 }), 'add')
  assert.equal(splitAction({ splitCount: 3, selected: 2 }), 'add')
  assert.equal(splitAction({ splitCount: 4, selected: 1 }), 'full')
  assert.equal(splitAction(), 'split')
})
