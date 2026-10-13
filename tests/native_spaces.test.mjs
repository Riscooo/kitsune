import assert from 'node:assert/strict'
import test from 'node:test'
import * as spaces from '../install/native/kitsune-spaces.sys.mjs'

const ids = (...list) => { let index = 0; return () => list[index++] }
const two = () => spaces.addSpace(spaces.defaultSpaces(), { name: 'Trabajo', color: 'blue' }, ids('e-0000000a')).data

test('a fresh profile has one space, «General», and anything odd on disk falls back to it', () => {
  assert.deepEqual(spaces.parseSpaces('no'), spaces.defaultSpaces())
  const good = JSON.stringify(two())
  assert.deepEqual(spaces.parseSpaces(good), two())
  const bad = [
    { version: 2, spaces: two().spaces },
    { version: 1, spaces: [] },
    { version: 1, spaces: [{ id: 'e-0000000a', name: 'X', color: 'green', user: null }] },
    { version: 1, spaces: [{ id: '../x', name: 'X', color: 'blue', user: null }] },
    { version: 1, spaces: [{ id: 'e-0000000a', name: '  X ', color: 'blue', user: null }] },
    { version: 1, spaces: [{ id: 'e-0000000a', name: 'X', color: 'blue', user: 'otro' }] },
    { version: 1, spaces: [{ id: 'e-0000000a', name: 'X', color: 'blue', user: null, extra: 1 }] },
    { version: 1, spaces: [{ id: 'e-0000000a', name: 'X', color: 'blue', user: null }, { id: 'e-0000000a', name: 'Y', color: 'red', user: null }] },
    { version: 1, spaces: Array.from({ length: 10 }, (_, index) => ({ id: `e-0000000${index}`, name: `E${index}`, color: 'red', user: null })) },
  ]
  for (const value of bad) assert.deepEqual(spaces.parseSpaces(JSON.stringify(value)), spaces.defaultSpaces(), JSON.stringify(value).slice(0, 80))
})

test('names are trimmed to 24 characters, without control characters or blank ones', () => {
  assert.equal(spaces.cleanName('  Clase   de  inglés '), 'Clase de inglés')
  assert.equal(spaces.cleanName('x'.repeat(40)).length, 24)
  assert.equal(spaces.cleanName('🦊'.repeat(30)), '🦊'.repeat(24))
  for (const name of ['', '   ', 'a\u0007b', null, 3]) assert.equal(spaces.cleanName(name), null)
})

test('spaces are added up to nine, with one of the six user inks and an optional user', () => {
  let data = spaces.defaultSpaces()
  for (let index = 1; index < spaces.MAX_SPACES; index++) {
    const added = spaces.addSpace(data, { name: `Espacio ${index}`, color: spaces.COLORS[index % 6], user: index === 1 ? 'p-0123456789abcdef' : null })
    assert.ok(added, `espacio ${index}`)
    assert.match(added.id, /^e-[0-9a-f]{8}$/)
    data = added.data
  }
  assert.equal(data.spaces.length, 9)
  assert.equal(data.spaces[1].user, 'p-0123456789abcdef')
  assert.equal(spaces.addSpace(data, { name: 'Diez', color: 'red' }), null)
  assert.equal(spaces.addSpace(spaces.defaultSpaces(), { name: 'X', color: 'green' }), null)
  assert.equal(spaces.addSpace(spaces.defaultSpaces(), { name: 'X', color: 'red', user: '../x' }), null)
  // Un id repetido se vuelve a sortear.
  assert.equal(spaces.addSpace(spaces.defaultSpaces(), { name: 'X', color: 'red' }, ids(spaces.FIRST_ID, 'e-0000000b')).id, 'e-0000000b')
})

test('editing, moving and removing never break the list, and the last space cannot go', () => {
  const data = two()
  assert.equal(spaces.editSpace(data, 'e-0000000a', { name: ' Estudio ', color: 'amber', user: 'default' }).spaces[1].name, 'Estudio')
  assert.equal(spaces.editSpace(data, 'e-0000000a', { name: '' }), null)
  assert.equal(spaces.editSpace(data, 'e-0000000a', { color: 'green' }), null)
  assert.equal(spaces.editSpace(data, 'e-ffffffff', { name: 'X' }), null)
  assert.deepEqual(spaces.moveSpace(data, 'e-0000000a', -1).spaces.map(space => space.id), ['e-0000000a', spaces.FIRST_ID])
  assert.equal(spaces.moveSpace(data, 'e-0000000a', 1), null)
  assert.deepEqual(spaces.removeSpace(data, spaces.FIRST_ID).spaces.map(space => space.id), ['e-0000000a'])
  assert.equal(spaces.removeSpace(spaces.defaultSpaces(), spaces.FIRST_ID), null)
  // Lo de antes no cambia (cada operación devuelve una copia).
  assert.equal(data.spaces.length, 2)
  assert.equal(data.spaces[1].name, 'Trabajo')
})

test('a tab with no space or a removed one belongs to the first space, and next/previous wrap around', () => {
  const data = two()
  assert.equal(spaces.resolveSpace(data, 'e-0000000a'), 'e-0000000a')
  assert.equal(spaces.resolveSpace(data, ''), spaces.FIRST_ID)
  assert.equal(spaces.resolveSpace(data, 'e-99999999'), spaces.FIRST_ID)
  assert.equal(spaces.stepSpace(data, spaces.FIRST_ID, 1), 'e-0000000a')
  assert.equal(spaces.stepSpace(data, 'e-0000000a', 1), spaces.FIRST_ID)
  assert.equal(spaces.stepSpace(data, spaces.FIRST_ID, -1), 'e-0000000a')
})

test('switching shows the space\'s tabs, hides the rest, keeps pinned ones and picks the last one used', () => {
  const A = spaces.FIRST_ID, B = 'e-0000000a'
  const tabs = [
    { pinned: true, space: A, lastAccessed: 50, selected: false, hidden: false },
    { pinned: false, space: A, lastAccessed: Infinity, selected: true, hidden: false },
    { pinned: false, space: B, lastAccessed: 30, selected: false, hidden: true },
    { pinned: false, space: B, lastAccessed: 40, selected: false, hidden: true },
    { pinned: false, space: A, lastAccessed: 20, selected: false, hidden: false },
  ]
  assert.deepEqual(spaces.planSwitch(tabs, B), { select: 3, show: [2, 3], hide: [1, 4], empty: false })
  assert.deepEqual(spaces.planSwitch(tabs, A), { select: 1, show: [], hide: [], empty: false })
  // Un espacio sin pestañas: no hay a cuál ir (se abre tu inicio en él), y se ocultan las demás.
  assert.deepEqual(spaces.planSwitch(tabs, 'e-0000000c'), { select: null, show: [], hide: [1, 4], empty: true })
  // Con una fijada seleccionada y el espacio vacío, se queda en la fijada.
  const pinned = tabs.map((tab, index) => ({ ...tab, selected: index === 0 }))
  assert.equal(spaces.planSwitch(pinned, 'e-0000000c').select, 0)
})
