import assert from 'node:assert/strict'
import test from 'node:test'
import { bookmarksFromTree, checkCopy, decryptCopy, encryptCopy, summary } from '../install/native/kitsune-copia.sys.mjs'

const copy = () => ({
  version: 1, created: '2026-10-14T08:00:00.000Z',
  bookmarks: [{ title: 'Barra', children: [{ title: 'Kitsune', url: 'https://github.com/Riscooo/kitsune' }, { title: 'Docs', children: [{ title: 'MDN', url: 'https://developer.mozilla.org/' }] }] }],
  spaces: [{ name: 'Trabajo', color: 'blue' }, { name: 'Casa', color: 'teal' }],
  tabs: [{ url: 'https://es.wikipedia.org/wiki/Kitsune', title: 'Kitsune', pinned: false, space: 'Trabajo' }],
  history: [{ url: 'https://example.com/', title: 'Example', visits: [{ date: 1760000000000, transition: 1 }] }],
  logins: [{ origin: 'https://example.com', formActionOrigin: 'https://example.com', httpRealm: null, username: 'kai', password: 's3creta', usernameField: 'u', passwordField: 'p' }],
})

test('a copy only opens with its password, and a touched file does not open at all', async () => {
  const envelope = await encryptCopy(copy(), 'una contraseña larga', { iterations: 100000 })
  assert.equal(envelope.kitsune, 'copia')
  assert.doesNotMatch(JSON.stringify(envelope), /Kitsune|s3creta|wikipedia/)
  assert.deepEqual(await decryptCopy(envelope, 'una contraseña larga'), checkCopy(copy()))
  await assert.rejects(decryptCopy(envelope, 'otra contraseña'), /password/)
  const touched = { ...envelope, data: envelope.data.slice(0, -4) + (envelope.data.at(-4) === 'A' ? 'B' : 'A') + envelope.data.slice(-3) }
  await assert.rejects(decryptCopy(touched, 'una contraseña larga'), /password|format/)
  await assert.rejects(decryptCopy({ ...envelope, kdf: { ...envelope.kdf, iterations: 10 } }, 'una contraseña larga'), /format/)
  await assert.rejects(encryptCopy(copy(), 'corta'), /password/)
})

test('what a copy brings is checked and trimmed: no strange addresses, spaces or passwords', () => {
  const value = checkCopy({ ...copy(),
    bookmarks: [{ title: 'X', children: [{ title: 'Mal', url: 'chrome://browser/content/browser.xhtml' }, { title: 'Bien', url: 'https://a.example/' }] }],
    spaces: Array.from({ length: 12 }, (_, i) => ({ name: `E${i}` })).concat([{ name: '' }]),
    tabs: [{ url: 'about:config' }, { url: 'https://b.example/', space: 'E1' }],
    logins: [{ origin: 'javascript:alert(1)', password: 'x' }, { origin: 'https://c.example', username: 'u', password: '' }, { origin: 'https://d.example', username: 'u', password: 'p' }] })
  assert.deepEqual(value.bookmarks[0].children, [{ title: 'Bien', url: 'https://a.example/' }])
  assert.equal(value.spaces.length, 9)
  assert.deepEqual(value.tabs.map(tab => tab.url), ['https://b.example/'])
  assert.deepEqual(value.logins.map(login => login.origin), ['https://d.example'])
  assert.throws(() => checkCopy({ version: 2 }), /format/)
  assert.equal(summary(checkCopy(copy())), '2 marcadores · 2 espacios con 1 pestaña · 1 página del historial · 1 contraseña')
})

test('the bookmarks tree from Gecko becomes the roots with something inside', () => {
  const tree = { children: [
    { guid: 'menu________', children: [{ type: 'text/x-moz-place', title: 'Uno', uri: 'https://uno.example/' }, { type: 'text/x-moz-place-separator' }] },
    { guid: 'toolbar_____', children: [{ type: 'text/x-moz-place-container', title: 'Carpeta', children: [{ type: 'text/x-moz-place', title: 'Dos', uri: 'https://dos.example/' }] }] },
    { guid: 'unfiled_____', children: [] },
    { guid: 'tags________', children: [{ type: 'text/x-moz-place', title: 'etiqueta', uri: 'https://tres.example/' }] },
  ] }
  const roots = bookmarksFromTree(tree)
  assert.deepEqual(roots.map(root => root.title), ['Menú de marcadores', 'Barra de marcadores'])
  assert.deepEqual(roots[1].children, [{ title: 'Carpeta', children: [{ title: 'Dos', url: 'https://dos.example/' }] }])
})
