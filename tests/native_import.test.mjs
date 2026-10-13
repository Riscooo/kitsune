import assert from 'node:assert/strict'
import test from 'node:test'
import * as importer from '../install/native/kitsune-import.sys.mjs'

test('profiles.ini gives every profile with its absolute folder, relative or not', () => {
  const ini = `[General]\nStartWithLastProfile=1\n\n[Profile1]\nName=Default (release)\nIsRelative=1\nPath=Profiles/abc.Default (release)\nDefault=1\n\n[Profile0]\nName=viejo\nIsRelative=0\nPath=/srv/perfiles/viejo\n\n[Install4F96D1932A9F858E]\nDefault=Profiles/abc.Default (release)\n`
  assert.deepEqual(importer.parseProfilesIni(ini, '/home/ana/.zen'), [
    { name: 'Default (release)', path: '/home/ana/.zen/Profiles/abc.Default (release)' },
    { name: 'viejo', path: '/srv/perfiles/viejo' },
  ])
  assert.deepEqual(importer.parseProfilesIni('[Profile0]\r\nName=w\r\nIsRelative=1\r\nPath=Profiles\\x.default\r\n', 'C:/Users/ana/AppData/Roaming/zen'),
    [{ name: 'w', path: 'C:/Users/ana/AppData/Roaming/zen/Profiles/x.default' }])
  assert.deepEqual(importer.parseProfilesIni('basura', '/x'), [])
})

test('Zen sessions: tabs keep their space, Essentials become pinned and a space\'s own pinned tabs stay in it', () => {
  const zen = {
    spaces: [{ uuid: '{b}', name: 'Trabajo', icon: '💼', position: 2 }, { uuid: '{a}', name: 'Ocio', icon: '', position: 1 }],
    tabs: [
      { entries: [{ url: 'https://correo.example/', title: 'Correo' }], index: 1, zenWorkspace: '{b}', zenSyncId: 't1' },
      { entries: [{ url: 'https://old.example/' }, { url: 'https://video.example/', title: 'Vídeo' }], index: 2, zenWorkspace: '{a}', zenSyncId: 't2' },
      { entries: [{ url: 'https://musica.example/', title: 'Música' }], index: 1, zenEssential: true, pinned: true, zenWorkspace: '{a}', zenSyncId: 't3' },
      { entries: [{ url: 'https://wiki.example/', title: 'Wiki' }], index: 1, pinned: true, zenWorkspace: '{b}', zenSyncId: 't4' },
      { entries: [{ url: 'about:preferences', title: 'Ajustes' }], index: 1, zenSyncId: 't5' },
      { entries: [{ url: 'https://correo.example/', title: 'Correo' }], index: 1, zenWorkspace: '{b}', zenSyncId: 't1' },
    ],
  }
  assert.deepEqual(importer.tabsFromSession(zen), [
    { url: 'https://correo.example/', title: 'Correo', pinned: false, space: '{b}' },
    { url: 'https://video.example/', title: 'Vídeo', pinned: false, space: '{a}' },
    { url: 'https://musica.example/', title: 'Música', pinned: true, space: null },
    { url: 'https://wiki.example/', title: 'Wiki', pinned: false, space: '{b}' },
  ])
  assert.deepEqual(importer.spacesFromZen(zen).map(space => space.name), ['Ocio', 'Trabajo'])
  assert.equal(importer.spaceName(zen.spaces[0]), '💼 Trabajo')
  assert.equal(importer.spaceName({ name: 'X', icon: 'chrome://browser/skin/zen-icons/selectable/airplane.svg' }), 'X')
})

test('Firefox sessions: tabs of every window, pinned stays pinned, and older Zen spaces come from Places', () => {
  const session = { windows: [
    { tabs: [{ entries: [{ url: 'https://a.example/', title: 'A' }], index: 1, pinned: true }] },
    { tabs: [{ entries: [{ url: 'file:///home/ana/nota.txt' }], index: 1 }, { entries: [{ url: 'javascript:alert(1)' }], index: 1 }] },
  ] }
  assert.deepEqual(importer.tabsFromSession(session), [
    { url: 'https://a.example/', title: 'A', pinned: true, space: null },
    { url: 'file:///home/ana/nota.txt', title: 'file:///home/ana/nota.txt', pinned: false, space: null },
  ])
  assert.deepEqual(importer.tabsFromSession(null), [])
  const rows = [{ uuid: '{z}', name: 'Clase', icon: '📚', position: 0 }]
  assert.deepEqual(importer.spacesFromZen({ windows: [{ tabs: [] }] }, rows).map(importer.spaceName), ['📚 Clase'])
})

test('bookmarks keep their folders and separators, only from roots with something in them', () => {
  const rows = [
    { id: 1, parent: 0, type: 2, title: '', position: 0, guid: 'root________' },
    { id: 2, parent: 1, type: 2, title: 'menu', position: 0, guid: 'menu________' },
    { id: 3, parent: 1, type: 2, title: 'toolbar', position: 1, guid: 'toolbar_____' },
    { id: 4, parent: 1, type: 2, title: 'unfiled', position: 3, guid: 'unfiled_____' },
    { id: 10, parent: 3, type: 1, title: 'Kitsune', position: 1, guid: 'b1', url: 'https://kitsune.example/' },
    { id: 11, parent: 3, type: 2, title: 'Clase', position: 0, guid: 'f1' },
    { id: 12, parent: 11, type: 1, title: 'Apuntes', position: 0, guid: 'b2', url: 'https://apuntes.example/' },
    { id: 13, parent: 11, type: 3, title: null, position: 1, guid: 's1' },
    { id: 14, parent: 11, type: 1, title: 'Consulta', position: 2, guid: 'b3', url: 'place:sort=8&maxResults=10' },
    { id: 15, parent: 2, type: 2, title: 'Vacía', position: 0, guid: 'f2' },
    { id: 16, parent: 4, type: 1, title: 'Marcapáginas', position: 0, guid: 'b4', url: 'javascript:void(0)' },
  ]
  const trees = importer.bookmarkTrees(rows)
  assert.deepEqual(trees, [
    { title: 'Barra de marcadores', children: [
      { title: 'Clase', type: 'folder', children: [{ title: 'Apuntes', url: 'https://apuntes.example/' }, { type: 'separator' }] },
      { title: 'Kitsune', url: 'https://kitsune.example/' }] },
    { title: 'Otros marcadores', children: [{ title: 'Marcapáginas', url: 'javascript:void(0)' }] },
  ])
  assert.equal(importer.countBookmarks(trees), 3)
})

test('history keeps web pages with up to 20 visits each, never embedded loads or future dates', () => {
  const now = Date.UTC(2026, 9, 14)
  const rows = [
    { url: 'https://a.example/', title: 'A', visit_date: (now - 1000) * 1000, visit_type: 2 },
    { url: 'https://a.example/', title: 'A', visit_date: (now - 5000) * 1000, visit_type: 1 },
    { url: 'https://img.example/x.png', title: null, visit_date: (now - 1000) * 1000, visit_type: 4 },
    { url: 'about:config', title: 'about', visit_date: (now - 1000) * 1000, visit_type: 1 },
    { url: 'https://b.example/', title: null, visit_date: (now + 9e9) * 1000, visit_type: 1 },
    ...Array.from({ length: 30 }, (_, index) => ({ url: 'https://c.example/', title: 'C', visit_date: (now - index * 1e6) * 1000, visit_type: 1 })),
  ]
  const pages = importer.historyPages(rows, now)
  assert.deepEqual(pages.map(page => page.url), ['https://a.example/', 'https://b.example/', 'https://c.example/'])
  assert.deepEqual(pages[0].visits, [{ date: now - 1000, transition: 2 }, { date: now - 5000, transition: 1 }])
  assert.equal(pages[1].visits[0].date, now)
  assert.equal('title' in pages[1], false)
  assert.equal(pages[2].visits.length, 20)
})

test('only the extensions the person installed are listed, not the browser\'s own', () => {
  const json = { addons: [
    { id: 'uBlock0@raymondhill.net', type: 'extension', location: 'app-profile', defaultLocale: { name: 'uBlock Origin' } },
    { id: 'formautofill@mozilla.org', type: 'extension', location: 'app-system-defaults' },
    { id: 'google@search.mozilla.org', type: 'extension', location: 'app-builtin' },
    { id: 'theme@x', type: 'theme', location: 'app-profile' },
    { id: 'zen-theme@zen-browser.app', type: 'extension', location: 'app-profile' },
    { id: '{446900e4-71c2-419f-a6a7-df9c091e268b}', type: 'extension', location: 'app-profile', defaultLocale: { name: 'Bitwarden' } },
  ] }
  assert.deepEqual(importer.userExtensions(json), [
    { id: 'uBlock0@raymondhill.net', name: 'uBlock Origin' },
    { id: '{446900e4-71c2-419f-a6a7-df9c091e268b}', name: 'Bitwarden' },
  ])
  assert.deepEqual(importer.userExtensions({}), [])
})
