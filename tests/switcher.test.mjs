import assert from 'node:assert/strict'
import test from 'node:test'
import { otherUsers, switchRequest, switchTo } from '../start/switcher.mjs'

const P1 = 'p-0123456789abcdef'

test('the integrated home asks its API to switch; the Linux home loads /?cambiar=<id> for the engine', () => {
  assert.deepEqual(switchRequest(P1, { integrated: true }), { kind: 'api', path: `/api/profiles/${P1}/open`, body: { action: 'switch' } })
  assert.deepEqual(switchRequest('default', { integrated: false }), { kind: 'navigate', url: '/?cambiar=default' })
  for (const id of ['../x', 'p-0123', '', undefined, `${P1}&x=1`]) assert.throws(() => switchRequest(id, { integrated: false }), String(id))
})

test('switching sends exactly one request and never anything but the user id', async () => {
  const sent = []
  const ok = await switchTo(P1, { integrated: true, token: 'integrado', fetcher: async (path, init) => { sent.push([path, init.method, init.headers['X-Kitsune-Token'], init.body]); return { ok: true } } })
  assert.equal(ok, true)
  assert.deepEqual(sent, [[`/api/profiles/${P1}/open`, 'POST', 'integrado', '{"action":"switch"}']])
  const visited = []
  assert.equal(await switchTo('default', { integrated: false, navigate: url => visited.push(url) }), true)
  assert.deepEqual(visited, ['/?cambiar=default'])
  assert.equal(await switchTo(P1, { integrated: true, token: 't', fetcher: async () => ({ ok: false }) }), false)
})

test('the card lists everyone except the user of this tab, in registry order', () => {
  const snapshot = { currentId: P1, profiles: [{ id: 'default', name: 'Personal' }, { id: P1, name: 'Insti' }, { id: 'p-ffffffffffffffff', name: 'Dani' }] }
  assert.deepEqual(otherUsers(snapshot).map(user => user.name), ['Personal', 'Dani'])
  assert.deepEqual(otherUsers(null), [])
})
