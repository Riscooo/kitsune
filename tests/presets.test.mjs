import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePresets } from '../start/presets.mjs'

const id = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

test('only well-formed presets from the home server become gallery tiles', () => {
  const parsed = parsePresets({ categories: [
    { name: 'Fotografías', items: [{ id: id(1), sha256: 'a'.repeat(64), credit: 'Foto: Ana · Unsplash' }, { id: '../x', sha256: 'a'.repeat(64) }, { id: id(2), sha256: 'nope' }] },
    { name: 'Colores', items: [{ id: id(3), sha256: 'b'.repeat(64), color: '#76c1ff' }] },
    { name: 'Vacía', items: [] }, { items: [{ id: id(4), sha256: 'c'.repeat(64) }] },
  ] })
  assert.deepEqual(parsed, [
    { name: 'Fotografías', items: [{ id: id(1), sha256: 'a'.repeat(64), label: 'Foto: Ana · Unsplash' }] },
    { name: 'Colores', items: [{ id: id(3), sha256: 'b'.repeat(64), label: 'Color #76c1ff' }] },
  ])
  for (const value of [null, {}, { categories: 'x' }]) assert.deepEqual(parsePresets(value), [])
})
