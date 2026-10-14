import assert from 'node:assert/strict'
import test from 'node:test'

// idioma.mjs lee el idioma guardado al cargarse: cada caso lo importa de nuevo con su almacenamiento.
async function load(storage) {
  globalThis.localStorage = storage
  globalThis.location = { protocol: 'http:', reloads: 0, reload() { this.reloads++ } }
  return import(`../start/idioma.mjs?caso=${Math.random()}`)
}
const memory = (values = {}) => ({ getItem: key => values[key] ?? null, setItem: (key, value) => { values[key] = String(value) } })
const answer = locale => async () => ({ json: async () => ({ locale }) })

test('the home page starts in Spanish, switches to English once Kitsune says so, and does not reload again', async () => {
  const storage = memory()
  const first = await load(storage)
  assert.equal(first.tr('Hola', 'Hello'), 'Hola')
  await first.initializeLanguage({ fetcher: answer('en-US') })
  assert.equal(location.reloads, 1)
  const second = await load(storage)
  assert.equal(second.tr('Hola', 'Hello'), 'Hello')
  globalThis.document = { documentElement: {}, title: '', body: null }
  globalThis.MutationObserver = class { observe() {} }
  await second.initializeLanguage({ fetcher: answer('en-US') })
  assert.equal(location.reloads, 0)
})

test('without storage the home page stays in Spanish instead of reloading forever', async () => {
  const broken = { getItem() { throw new Error('bloqueado') }, setItem() { throw new Error('bloqueado') } }
  const page = await load(broken)
  await page.initializeLanguage({ fetcher: answer('en-US') })
  assert.equal(location.reloads, 0)
  const ignored = await load({ getItem: () => null, setItem() {} })
  await ignored.initializeLanguage({ fetcher: answer('en-US') })
  assert.equal(location.reloads, 0)
})
