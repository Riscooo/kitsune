import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsStore, mergeSettings, normalizeSettings, parseSettingsSnapshot } from '../start/settings-store.mjs'
import { parseAppearance, appearanceStatus } from '../start/appearance.mjs'
import { editLinks } from '../start/shortcuts.mjs'

const clone = value => JSON.parse(JSON.stringify(value))
const snapshot = (data = normalizeSettings(), revision = 0, token = 'local-token') => ({ version: 3, data: clone(data), revision, token })
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(body) })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('theme and background accept only their enumerated values and a content hash', () => {
  assert.equal(normalizeSettings({ theme: 'oscuro' }).theme, 'oscuro')
  for (const theme of ['dark', 'nightfall', 1, null]) assert.equal(normalizeSettings({ theme }).theme, 'claro')
  assert.equal(normalizeSettings({ background: 'ab'.repeat(32) }).background, 'ab'.repeat(32))
  for (const background of ['../x.jpg', 'url(https://example.com)', 'AB'.repeat(32), 7]) assert.equal(normalizeSettings({ background }).background, null)
})

test('legacy preferences keep their values and receive safe module/wallpaper defaults', () => {
  const state = normalizeSettings({ art: false, motion: false, newTab: true, accent: 'pink', focus: true, links: [] })
  assert.deepEqual(state, { art: false, motion: false, newTab: true, accent: 'pink', focus: true, links: [], wallpaper: 'night', themeSync: false, modules: { clock: true, shortcuts: true }, theme: 'claro', background: null, windowControls: 'izquierda', brand: true, performance: 'normal', ramLimit: 2048, minimize: true, windowButtons: 'auto', tabs: 'arriba', tinta: 'papel', densidad: 'normal', negro: false, oscurecer: false, bienvenida: true })
  assert.equal(normalizeSettings({ wallpaper: 'javascript:bad', accent: 'bad', themeSync: 'true' }).wallpaper, 'night')
  assert.equal(normalizeSettings({ themeSync: 'true' }).themeSync, false)
})

test('partial module changes never erase sibling modules or links', () => {
  const state = normalizeSettings({ modules: { clock: false }, links: [] })
  const result = mergeSettings(state, { modules: { shortcuts: false }, wallpaper: 'ember' })
  assert.deepEqual(result.modules, { clock: false, shortcuts: false })
  assert.deepEqual(result.links, [])
  assert.equal(result.wallpaper, 'ember')
})

test('snapshot rejects malformed revisions and missing mutation token', () => {
  for (const value of [{}, snapshot({}, -1), snapshot({}, 1, ''), { ...snapshot(), data: [] }]) assert.throws(() => parseSettingsSnapshot(value))
})

test('serial writes preserve multiple fast independent intents', async () => {
  let server = snapshot()
  const requests = []
  const firstWrite = deferred()
  const started = deferred()
  const store = createSettingsStore({ fetcher: async (_, options) => {
    if (options.method === 'GET') return response(server)
    const body = JSON.parse(options.body); requests.push(body)
    if (requests.length === 1) { started.resolve(); await firstWrite.promise }
    assert.equal(body.revision, server.revision)
    server = snapshot(body.data, server.revision + 1)
    return response(server)
  } })
  await store.refresh()
  const one = store.save({ art: false }); await started.promise
  const two = store.save({ modules: { clock: false } }); const three = store.save({ newTab: true })
  firstWrite.resolve()
  assert.deepEqual(await Promise.all([one, two, three]), [true, true, true])
  assert.equal(server.data.art, false); assert.equal(server.data.modules.clock, false); assert.equal(server.data.newTab, true)
  assert.equal(server.revision, 3)
  store.destroy()
})

test('CAS conflict rebases only changed preferences and uses fresh token', async () => {
  let server = snapshot()
  let writes = 0
  const store = createSettingsStore({ fetcher: async (_, options) => {
    if (options.method === 'GET') return response(server)
    const body = JSON.parse(options.body)
    if (!writes++) {
      server = snapshot({ ...server.data, newTab: true }, 1, 'rotated-token')
      return response(server, 409)
    }
    assert.equal(options.headers['X-Kitsune-Token'], 'rotated-token')
    assert.equal(body.data.newTab, true)
    server = snapshot(body.data, 2, 'rotated-token')
    return response(server)
  } })
  await store.refresh(); assert.equal(await store.save({ art: false }), true)
  assert.equal(store.data.art, false); assert.equal(store.data.newTab, true)
  store.destroy()
})

test('failed save keeps last confirmed state and can reconnect/retry without reload', async () => {
  let server = snapshot(); let fail = true
  const notices = []
  const store = createSettingsStore({ onStatus: (...args) => notices.push(args), fetcher: async (_, options) => {
    if (options.method === 'GET') return response(server)
    if (fail) return response({ error: 'disk unavailable' }, 503)
    server = snapshot(JSON.parse(options.body).data, server.revision + 1)
    return response(server)
  } })
  await store.refresh(); assert.equal(await store.save({ motion: false }), false)
  assert.equal(store.data.motion, true); assert.equal(store.ready, false)
  assert.equal(notices.at(-1)[1], true)
  fail = false; assert.equal(await store.refresh(), true)
  assert.equal(await store.save({ motion: false }), true); assert.equal(store.data.motion, false)
  store.destroy()
})

test('uncertain committed write is not reported successful and reconnect reads the truth', async () => {
  let server = snapshot(); let writes = 0
  const store = createSettingsStore({ fetcher: async (_, options) => {
    if (options.method === 'GET') return response(server)
    writes++; server = snapshot(JSON.parse(options.body).data, 1)
    throw new Error('connection dropped after commit')
  } })
  await store.refresh(); assert.equal(await store.save({ accent: 'pink' }), false)
  assert.equal(store.data.accent, 'blue')
  await store.refresh(); assert.equal(store.data.accent, 'pink')
  assert.equal(await store.save({ accent: 'pink' }), true)
  assert.equal(writes, 1, 'no duplicate mutation once state is confirmed')
  store.destroy()
})

test('unchanged polling does not rerender controls or steal focus', async () => {
  let renders = 0
  const store = createSettingsStore({ fetcher: async () => response(snapshot()), onChange: () => renders++ })
  await store.refresh(); await store.refresh({ quiet: true }); await store.refresh({ quiet: true })
  assert.equal(renders, 1); store.destroy()
})

test('other-window changes resynchronize during idle refresh', async () => {
  let server = snapshot()
  const store = createSettingsStore({ fetcher: async () => response(server) })
  await store.refresh(); server = snapshot({ ...server.data, wallpaper: 'dusk', modules: { clock: false, shortcuts: true } }, 1)
  await store.refresh({ quiet: true }); assert.equal(store.data.wallpaper, 'dusk'); assert.equal(store.data.modules.clock, false)
  store.destroy()
})

test('endless CAS contention stops after three attempts without claiming success', async () => {
  let server = snapshot(); let writes = 0
  const store = createSettingsStore({ fetcher: async (_, options) => {
    if (options.method === 'GET') return response(server)
    writes++; server = snapshot(server.data, server.revision + 1)
    return response(server, 409)
  } })
  await store.refresh(); assert.equal(await store.save({ art: false }), false)
  assert.equal(writes, 3); assert.equal(store.data.art, true)
  store.destroy()
})

test('link edits merge with independent additions and do not overwrite same-link conflicts', () => {
  const original = { id: 'a', name: 'A', url: 'https://example.com/', color: 'blue', icon: '' }
  const other = { ...original, id: 'b', name: 'B' }
  const state = normalizeSettings({ links: [original, other] })
  const renamed = { ...original, name: 'Renamed' }
  assert.deepEqual(editLinks(state, { item: renamed, expected: original }).links, [renamed, other])
  assert.throws(() => editLinks(state, { item: renamed, expected: { ...original, name: 'Outdated' } }), { name: 'SettingsConflict' })
  assert.deepEqual(editLinks(state, { item: original, expected: null }), state)
  assert.deepEqual(editLinks(state, { id: 'absent', remove: true }), state)
})

const appearance = () => ({ version: 2, motion: true, googleRemember: false, fingerprint: 'a'.repeat(64), palette: Object.fromEntries(['bg', 'surface', 'surfaceHigh', 'text', 'muted', 'outline', 'primary', 'primaryContainer', 'secondary', 'tertiary'].map(key => [key, '#aabbcc'])), native: { available: true, status: 'queued' } })
test('appearance v2 validates all colors, motion and fingerprint before CSS use', () => {
  assert.equal(parseAppearance(appearance()).version, 2)
  for (const invalid of ['red', '#fff', 'url(https://example.com)', 123, {}, null]) { const value = appearance(); value.palette.bg = invalid; assert.throws(() => parseAppearance(value)) }
  for (const patch of [{ fingerprint: 'short' }, { motion: 'true' }, { version: 1 }]) assert.throws(() => parseAppearance({ ...appearance(), ...patch }))
})
test('a Nightfall appearance response is rejected', () => {
  assert.throws(() => parseAppearance({ ...appearance(), version: 1, wallpaper: 'night', art: true, themeSync: false, source: 'manual' }))
})
test('native theme success requires actual acknowledgement even in manual mode', () => {
  assert.match(appearanceStatus(appearance()), /Aplicando/u)
  assert.match(appearanceStatus({ ...appearance(), native: { available: true, status: 'applied' } }), /aplicado al navegador/u)
  assert.match(appearanceStatus({ ...appearance(), native: { available: false, status: 'unavailable' } }), /no está disponible/u)
})

test('window buttons are Kitsune, system or automatic, and anything else is automatic', () => {
  assert.equal(normalizeSettings({}).windowButtons, 'auto')
  assert.equal(normalizeSettings({ windowButtons: 'sistema' }).windowButtons, 'sistema')
  assert.equal(normalizeSettings({ windowButtons: 'kitsune' }).windowButtons, 'kitsune')
  assert.equal(normalizeSettings({ windowButtons: 'macos' }).windowButtons, 'auto')
})

test('tabs go on top, at one side or as icons at one side, and anything else is on top', () => {
  assert.equal(normalizeSettings({}).tabs, 'arriba')
  assert.equal(normalizeSettings({ tabs: 'lado' }).tabs, 'lado')
  assert.equal(normalizeSettings({ tabs: 'iconos' }).tabs, 'iconos')
  assert.equal(normalizeSettings({ tabs: 'izquierda' }).tabs, 'arriba')
})

test('the tinta is an id from the catalogue (the server checks it), and anything odd is Papel', () => {
  assert.equal(normalizeSettings({}).tinta, 'papel')
  assert.equal(normalizeSettings({ tinta: 'sakura' }).tinta, 'sakura')
  for (const tinta of ['Sakura', '../x', '', 7, 'a'.repeat(30)]) assert.equal(normalizeSettings({ tinta }).tinta, 'papel')
})

test('the home accepts the appearance control of every version the browser writes, v8 included', async () => {
  const { parseAppearance } = await import('../start/appearance.mjs')
  const palette = { bg: '#f8f2f2', surface: '#fdf9f9', surfaceHigh: '#f0e3e5', text: '#2e2326', muted: '#6a565b', outline: '#dcc7cb', primary: '#a8365a', primaryContainer: '#f6dce4', secondary: '#7a4f66', tertiary: '#8a7479' }
  for (const version of [6, 7, 8]) {
    assert.equal(parseAppearance({ version, fingerprint: 'a'.repeat(64), motion: true, palette, theme: 'claro', background: null }).version, version)
  }
  assert.throws(() => parseAppearance({ version: 99, fingerprint: 'a'.repeat(64), motion: true, palette, theme: 'claro', background: null }))
})
