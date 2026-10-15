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

test('a touchpad swipe moves one space per gesture, and only when it is mostly horizontal', () => {
  let gesture = { total: 0, spent: false }
  const feed = (dx, dy = 0) => { const result = spaces.swipeStep(gesture, dx, dy); gesture = result.gesture; return result.step }
  assert.deepEqual([feed(40), feed(40), feed(50)], [0, 0, 1])
  // El resto del mismo gesto (y su inercia) no cambia otra vez.
  assert.deepEqual([feed(200), feed(300)], [0, 0])
  gesture = { total: 0, spent: false }
  assert.equal(feed(-130), -1)
  gesture = { total: 0, spent: false }
  // Casi vertical: es desplazar la lista de pestañas, no cambiar de espacio.
  assert.deepEqual([feed(100, 150), feed(90, 120)], [0, 0])
  assert.equal(gesture.total, 0)
  // Ir y volver en el mismo gesto se compensa.
  assert.deepEqual([feed(80), feed(-70), feed(60)], [0, 0, 0])
})

test('a space can carry one emoji as its icon; without one it keeps the four fields older Kitsune reads', () => {
  for (const icon of ['🦊', '👩‍💻', '✈️', 'K']) assert.equal(spaces.cleanIcon(icon), icon)
  for (const icon of ['', '  ', '🦊🦊', 'ab', 'chrome://x.svg', 'a\u0007', null, 7, '🦊 ']) assert.equal(spaces.cleanIcon(icon), icon === '🦊 ' ? '🦊' : '', String(icon))
  const added = spaces.addSpace(spaces.defaultSpaces(), { name: 'Juegos', color: 'pink', icon: '🎮' }, ids('e-0000000b'))
  assert.deepEqual(added.data.spaces[1], { id: 'e-0000000b', name: 'Juegos', color: 'pink', user: null, icon: '🎮' })
  assert.deepEqual(spaces.parseSpaces(JSON.stringify(added.data)), added.data)
  const plain = spaces.addSpace(spaces.defaultSpaces(), { name: 'Sin', color: 'blue', icon: 'no vale' }, ids('e-0000000c'))
  assert.equal(Object.keys(plain.data.spaces[1]).length, 4)
  const edited = spaces.editSpace(added.data, 'e-0000000b', { icon: '' })
  assert.equal('icon' in edited.spaces[1], false)
  assert.equal(spaces.editSpace(added.data, 'e-0000000b', { icon: 'xx' }), null)
  assert.equal(spaces.editSpace(added.data, 'e-0000000b', { icon: '🎵' }).spaces[1].icon, '🎵')
  const bad = { version: 1, spaces: [{ id: 'e-0000000a', name: 'X', color: 'blue', user: null, icon: 'ab' }] }
  assert.deepEqual(spaces.parseSpaces(JSON.stringify(bad)), spaces.defaultSpaces())
  assert.ok(spaces.ICONS.length >= 8 && spaces.ICONS.every(icon => spaces.cleanIcon(icon) === icon))
})

test('a space can have its own sessions (its own container): what is kept, and what is odd is dropped', () => {
  assert.deepEqual(spaces.parseSessions(''), {})
  assert.deepEqual(spaces.parseSessions('no'), {})
  assert.deepEqual(spaces.parseSessions(JSON.stringify({ 'e-0000000a': { context: 7, own: true }, 'e-0000000b': { context: 9, own: false } })),
    { 'e-0000000a': { context: 7, own: true }, 'e-0000000b': { context: 9, own: false } })
  // Lo que no es de un espacio, un contenedor que no vale o campos de más: fuera, sin tirar lo demás.
  assert.deepEqual(spaces.parseSessions(JSON.stringify({ 'e-0000000a': { context: 7, own: true }, '../x': { context: 3, own: true },
    'e-0000000c': { context: 0, own: true }, 'e-0000000d': { context: 2.5, own: true }, 'e-0000000e': { context: 4, own: 'sí' } })),
    { 'e-0000000a': { context: 7, own: true } })
})

test('the sessions of a space: its own, a Kitsune user\'s, or shared with the rest', () => {
  const data = spaces.addSpace(two(), { name: 'Casa', color: 'pink', user: 'p-0123456789abcdef' }, ids('e-0000000b')).data
  const [general, trabajo, casa] = data.spaces
  const sessions = { 'e-0000000a': { context: 7, own: true }, 'e-0000000b': { context: 8, own: false } }
  assert.equal(spaces.sessionsOf(general, sessions), 'shared')
  assert.equal(spaces.sessionsOf(trabajo, sessions), 'own')
  assert.equal(spaces.sessionsOf(casa, sessions), 'p-0123456789abcdef')
})
