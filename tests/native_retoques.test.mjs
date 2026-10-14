import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { RETOQUES, isOn } from '../install/native/kitsune-retoques.sys.mjs'

test('each tweak has its pref, its value and its text in both languages', () => {
  assert.ok(RETOQUES.length >= 6)
  assert.equal(new Set(RETOQUES.map(item => item.id)).size, RETOQUES.length)
  for (const item of RETOQUES) {
    assert.match(item.pref, /^[a-z][\w.-]+$/)
    assert.ok(item.type === 'bool' ? typeof item.on === 'boolean' : Number.isInteger(item.on), item.id)
    for (const lang of [item.es, item.en]) assert.ok(lang.length === 2 && lang.every(text => text.length > 3), item.id)
  }
})

test('a tweak is on only when its pref has the «on» value', () => {
  const junto = RETOQUES.find(item => item.id === 'junto')
  assert.equal(isOn(junto, () => true), true)
  assert.equal(isOn(junto, () => false), false)
  assert.equal(isOn(junto, () => undefined), false)
  const ultima = RETOQUES.find(item => item.id === 'ultima')
  assert.equal(isOn(ultima, () => false), true)
})

test('every style tweak has its rule in kitsune-retoques.css, and the sheet is imported', async () => {
  const css = await readFile(new URL('../chrome/kitsune-retoques.css', import.meta.url), 'utf8')
  for (const item of RETOQUES.filter(entry => entry.pref.startsWith('kitsune.retoques.'))) assert.ok(css.includes(`-moz-pref("${item.pref}")`), item.id)
  assert.match(await readFile(new URL('../chrome/userChrome.css', import.meta.url), 'utf8'), /@import url\("kitsune-retoques.css"\);/)
})
