import assert from 'node:assert/strict'
import test from 'node:test'
import * as users from '../install/native/kitsune-users.sys.mjs'

const P1 = 'p-0123456789abcdef'
const P2 = 'p-fedcba9876543210'

test('the six Kitsune user colors map to Gecko container colors', () => {
  assert.deepEqual(Object.keys(users.GECKO_COLORS).sort(), ['amber', 'blue', 'pink', 'red', 'teal', 'violet'])
  assert.equal(users.GECKO_COLORS.violet, 'purple')
  assert.equal(users.GECKO_COLORS.teal, 'turquoise')
})

test('the container map is read strictly: anything odd is an empty map', () => {
  assert.deepEqual([...users.parseContainerMap(JSON.stringify({ version: 1, containers: { [P1]: 7 } }))], [[P1, 7]])
  for (const text of ['no', '{}', JSON.stringify({ version: 2, containers: {} }), JSON.stringify({ version: 1, containers: [] }),
    JSON.stringify({ version: 1, containers: { '../x': 7 } }), JSON.stringify({ version: 1, containers: { [P1]: 0 } }),
    JSON.stringify({ version: 1, containers: { [P1]: '7' } }), JSON.stringify({ version: 1, containers: { [P1]: 7, [P2]: 7 } })]) {
    assert.equal(users.parseContainerMap(text).size, 0, text)
  }
})

test('the home is either the local Linux server or the integrated home', () => {
  assert.deepEqual(users.homeKind('http://127.0.0.1:49721/'), { kind: 'server', origin: 'http://127.0.0.1:49721', port: 49721 })
  assert.deepEqual(users.homeKind('moz-extension://4b1d7c2e-9a3f-4e6b-8c51-2f7a0d9e6b13/start/index.html'), { kind: 'integrated' })
  for (const url of ['https://127.0.0.1:49721/', 'http://localhost:49721/', 'http://127.0.0.1:49721/x', 'http://127.0.0.1:99999/', '', undefined]) {
    assert.equal(users.homeKind(url), null, String(url))
  }
})

test('only the home itself can ask to switch, only with ?cambiar=<id> and only as a page load', () => {
  const home = 'http://127.0.0.1:49721'
  const ask = (patch = {}) => users.switchTarget({ url: `${home}/?cambiar=${P1}`, triggeringOrigin: home, homeOrigin: home, isDocument: true, ...patch })
  assert.equal(ask(), P1)
  assert.equal(ask({ url: `${home}/?cambiar=default` }), 'default')
  assert.equal(ask({ triggeringOrigin: 'https://example.com' }), null)
  assert.equal(ask({ triggeringOrigin: null }), null)
  assert.equal(ask({ isDocument: false }), null)
  assert.equal(ask({ homeOrigin: null }), null)
  for (const url of [`${home}/?cambiar=../x`, `${home}/?cambiar=${P1}&otro=1`, `${home}/x?cambiar=${P1}`, `${home}/?cambiar=${P1}#a`,
    `http://127.0.0.1:1234/?cambiar=${P1}`, `${home}/?usuario=${P1}`, 'no es una url']) {
    assert.equal(ask({ url }), null, url)
  }
})

test('a container belongs to a user, and no container or a foreign one is the base user (null)', () => {
  const map = new Map([[P1, 7], [P2, 9]])
  assert.equal(users.userForContainer(map, 7), P1)
  assert.equal(users.userForContainer(map, 9), P2)
  assert.equal(users.userForContainer(map, 0), null)
  assert.equal(users.userForContainer(map, 3), null)
})

test('the registry gives the users and the base user: default on Linux, this Gecko profile in the integrated home', () => {
  const linux = { version: 2, profiles: [{ id: 'default', name: 'Personal', color: 'blue', port: 49721 }, { id: P1, name: 'Insti', color: 'teal', port: 49722 }] }
  assert.deepEqual(users.parseRegistry(linux, 'server', '/x'), { baseId: 'default',
    users: [{ id: 'default', name: 'Personal', color: 'blue' }, { id: P1, name: 'Insti', color: 'teal' }] })
  const integrated = { version: 1, profiles: [
    { id: 'default', name: 'Personal', color: 'blue', path: 'C:\\Users\\R\\Kitsune\\Profiles\\abc\\' },
    { id: P1, name: 'Insti', color: 'pink', path: `kitsune-usuario:${P1}` }] }
  assert.equal(users.parseRegistry(integrated, 'integrated', 'c:\\users\\r\\kitsune\\profiles\\abc').baseId, 'default')
  assert.equal(users.parseRegistry(integrated, 'integrated', '/otro/perfil'), null)
  assert.equal(users.parseRegistry({ profiles: [{ id: 'default', name: 'P', color: 'black' }] }, 'server', '/'), null)
  assert.equal(users.parseRegistry({ profiles: [{ id: P1, name: 'P', color: 'blue' }] }, 'server', '/'), null)
  assert.equal(users.parseRegistry(null, 'server', '/'), null)
})

// Un Gecko de mentira: registro, contenedores y pestañas, sin disco ni navegador.
function fakeGecko(registry) {
  const files = new Map([['/estado/kitsune-browser/profiles.json', JSON.stringify(registry)]])
  const identities = new Map([[1, { userContextId: 1, l10nId: 'user-context-personal' }]])
  let next = 10
  const calls = []
  globalThis.Ci = { nsIFile: {} }
  globalThis.PathUtils = { join: (...parts) => parts.join('/'), profileDir: '/perfil' }
  globalThis.IOUtils = {
    async stat(path) { if (!files.has(path)) throw Object.assign(new Error('no'), { name: 'NotFoundError' }); return { lastModified: files.get(path).length, size: files.get(path).length } },
    async read(path) { if (!files.has(path)) throw new Error('no'); return new TextEncoder().encode(files.get(path)) },
    async writeJSON(path, value) { files.set(path, JSON.stringify(value)) },
  }
  globalThis.Services = {
    prefs: { getStringPref: name => name === 'browser.startup.homepage' ? 'http://127.0.0.1:49721/' : '', getBoolPref: () => true },
    env: { get: name => name === 'KITSUNE_STATE_ROOT' ? '/estado/kitsune-browser' : '' },
    dirsvc: { get: () => ({ path: '/home/r' }) },
    scriptSecurityManager: { getSystemPrincipal: () => 'sistema' },
  }
  globalThis.ChromeUtils = { importESModule: () => ({ ContextualIdentityService: {
    getPublicIdentityFromId: id => identities.get(id) ?? null,
    create(name, icon, color) { const identity = { userContextId: next++, name, icon, color }; identities.set(identity.userContextId, identity); calls.push(['create', name, color]); return identity },
    update(id, name, icon, color) { Object.assign(identities.get(id), { name, color }); calls.push(['update', id, name, color]) },
  } }) }
  const window = { PrivateBrowsingUtils: { isWindowPrivate: () => false } }
  const tab = (context, position) => ({ userContextId: context, _tPos: position, pinned: false, ownerGlobal: window, linkedBrowser: { tab: null, ownerGlobal: window } })
  const gBrowser = {
    tabs: [tab(0, 0), tab(0, 1)],
    addTab(url, options) { calls.push(['addTab', url, options.userContextId, options.tabIndex, options.triggeringPrincipal]); const fresh = tab(options.userContextId, options.tabIndex); this.tabs.splice(options.tabIndex, 0, fresh); return fresh },
    removeTab(old, options) { calls.push(['removeTab', old._tPos, options.animate]); this.tabs.splice(this.tabs.indexOf(old), 1) },
    getTabForBrowser: browser => browser.tab,
  }
  window.gBrowser = gBrowser
  gBrowser.selectedTab = gBrowser.tabs[1]
  for (const item of gBrowser.tabs) item.linkedBrowser.tab = item
  return { files, identities, calls, gBrowser }
}

test('switching replaces only that tab, in its place, with the home in the user container', async () => {
  const gecko = fakeGecko({ version: 2, profiles: [{ id: 'default', name: 'Personal', color: 'blue' }, { id: P1, name: 'Insti', color: 'violet' }] })
  const [first, second] = gecko.gBrowser.tabs
  assert.equal(await users.KitsuneUsers.switchBrowser(second.linkedBrowser, P1), true)
  assert.deepEqual(gecko.calls, [['create', 'Insti', 'purple'], ['addTab', 'http://127.0.0.1:49721/', 10, 2, 'sistema'], ['removeTab', 1, false]])
  assert.equal(gecko.gBrowser.tabs[0], first)
  assert.equal(gecko.gBrowser.tabs.length, 2)
  assert.equal(gecko.gBrowser.selectedTab.userContextId, 10)
  assert.deepEqual(JSON.parse(gecko.files.get('/perfil/kitsune-users.json')), { version: 1, containers: { [P1]: 10 } })
  // El mismo usuario: nada. Un usuario que no existe: nada.
  gecko.calls.length = 0
  const current = gecko.gBrowser.selectedTab
  current.linkedBrowser = { tab: current, ownerGlobal: current.ownerGlobal }
  assert.equal(await users.KitsuneUsers.switchBrowser(current.linkedBrowser, P1), false)
  assert.equal(await users.KitsuneUsers.switchBrowser(current.linkedBrowser, P2), false)
  assert.deepEqual(gecko.calls, [])
  // Y de vuelta al usuario base: sin contenedor.
  assert.equal(await users.KitsuneUsers.switchBrowser(current.linkedBrowser, 'default'), true)
  assert.deepEqual(gecko.calls.find(call => call[0] === 'addTab').slice(2, 3), [0])
  assert.equal(await users.KitsuneUsers.userFor({ getAttribute: () => '10' }), P1)
  assert.equal(await users.KitsuneUsers.userFor({ getAttribute: () => '0' }), null)
  assert.equal(await users.KitsuneUsers.contextFor(P1), 10)
  assert.equal(await users.KitsuneUsers.contextFor('default'), 0)
  assert.equal(await users.KitsuneUsers.contextFor(P2), null)
  // Cambiarle el nombre y el color a un usuario cambia su contenedor, no hace otro.
  gecko.calls.length = 0
  gecko.files.set('/estado/kitsune-browser/profiles.json', JSON.stringify({ version: 2, profiles: [
    { id: 'default', name: 'Personal', color: 'blue' }, { id: P1, name: 'Instituto', color: 'red' }] }))
  await users.KitsuneUsers.refresh()
  assert.deepEqual(gecko.calls, [['update', 10, 'Instituto', 'red']])
})
