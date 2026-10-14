import assert from 'node:assert/strict'
import test from 'node:test'
import { CATALOG, comboFromEvent, comboId, parseCustom } from '../install/native/kitsune-keys.sys.mjs'

const press = (key, code, mods = {}) => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods })

test('a key press becomes a shortcut from the base key, with Ctrl/Cmd as accel', () => {
  assert.deepEqual(comboFromEvent(press('j', 'KeyJ', { ctrlKey: true, shiftKey: true })), { key: 'J', modifiers: 'accel,shift' })
  // Mayús+1 es «1», no «!»; en Mac, Cmd es accel y Ctrl es control.
  assert.deepEqual(comboFromEvent(press('!', 'Digit1', { ctrlKey: true, shiftKey: true })), { key: '1', modifiers: 'accel,shift' })
  assert.deepEqual(comboFromEvent(press('k', 'KeyK', { metaKey: true, ctrlKey: true }), true), { key: 'K', modifiers: 'accel,control' })
  assert.deepEqual(comboFromEvent(press('ArrowRight', 'ArrowRight', { altKey: true })), { keycode: 'VK_RIGHT', modifiers: 'alt' })
  assert.deepEqual(comboFromEvent(press('F7', 'F7')), { keycode: 'VK_F7', modifiers: '' })
  assert.deepEqual(comboFromEvent(press(',', 'Comma', { ctrlKey: true })), { key: ',', modifiers: 'accel' })
})

test('plain letters, Shift alone and lone modifiers are not shortcuts', () => {
  assert.equal(comboFromEvent(press('a', 'KeyA')), null)
  assert.equal(comboFromEvent(press('A', 'KeyA', { shiftKey: true })), null)
  assert.equal(comboFromEvent(press('Control', 'ControlLeft', { ctrlKey: true })), null)
  assert.equal(comboFromEvent(press('Dead', 'BracketLeft', { ctrlKey: true })), null)
  assert.equal(comboFromEvent(), null)
})

test('combinations compare by meaning: accel is Ctrl (Cmd on Mac), order and case do not matter', () => {
  assert.equal(comboId({ key: 't', modifiers: 'accel' }), comboId({ key: 'T', modifiers: 'control' }))
  assert.equal(comboId({ key: 'd', modifiers: 'alt,accel' }), comboId({ key: 'D', modifiers: 'accel,alt' }))
  assert.notEqual(comboId({ key: 'T', modifiers: 'accel' }, true), comboId({ key: 'T', modifiers: 'control' }, true))
  assert.equal(comboId({ keycode: 'VK_F5' }), '|VK_F5')
  assert.equal(comboId({ off: true }), '')
})

test('saved shortcuts are checked: only known ones, with a valid shape', () => {
  const saved = parseCustom(JSON.stringify({
    'kitsune-palette-key': { key: 'p', modifiers: 'accel,shift' },
    'kitsune-compact-key': { off: true },
    key_reload: { keycode: 'VK_F5', modifiers: '' },
    key_close: { key: 'WW', modifiers: 'accel' },
    key_find: { key: 'F', modifiers: 'accel,hyper' },
    key_newNavigatorTab: { keycode: 'VK_EVIL', modifiers: 'accel' },
    'not-a-key': { key: 'X', modifiers: 'accel' },
  }))
  assert.deepEqual(saved, {
    'kitsune-palette-key': { key: 'P', modifiers: 'accel,shift' },
    'kitsune-compact-key': { off: true },
    key_reload: { keycode: 'VK_F5', modifiers: '' },
  })
  assert.deepEqual(parseCustom('no es json'), {})
  assert.deepEqual(parseCustom('[1]'), {})
  assert.ok(CATALOG.length >= 20 && CATALOG.every(item => item.id && item.es && item.en))
})
