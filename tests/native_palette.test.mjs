import assert from 'node:assert/strict'
import test from 'node:test'
import * as palette from '../install/native/kitsune-palette.sys.mjs'

test('matching ignores case and accents and prefers the start, then words, then inside, then letters in order', () => {
  assert.equal(palette.fold('Pestaña ÁRBOL'), 'pestana arbol')
  const s = text => palette.score('pes', text)
  assert.ok(s('Pestañas arriba') > s('Nueva pestaña'))
  assert.ok(s('Nueva pestaña') > s('Despestañar'))
  assert.ok(s('Despestañar') > s('pxexs'))
  assert.equal(palette.score('xyz', 'Nueva pestaña'), 0)
  assert.ok(palette.score('nvp', 'Nueva pestaña') > 0)
})

test('ranking needs every word to match and keeps the best ones', () => {
  const items = [{ label: 'Nueva pestaña' }, { label: 'Nueva ventana privada', keywords: ['incognito'] }, { label: 'Cerrar pestaña' }, { label: 'Modo compacto' }]
  assert.deepEqual(palette.rank('nueva pes', items).map(item => item.label), ['Nueva pestaña'])
  assert.deepEqual(palette.rank('incog', items).map(item => item.label), ['Nueva ventana privada'])
  assert.deepEqual(palette.rank('pestaña', items).map(item => item.label), ['Nueva pestaña', 'Cerrar pestaña'])
  assert.equal(palette.rank('', items, 2).length, 2)
})

test('letters in order only count when nothing matches better, and every kind competes together', () => {
  const items = [
    { label: 'General', detail: 'Espacio', keywords: ['espacio', 'workspace'], weight: 1.05 },
    { label: 'Nueva ventana privada', keywords: ['incognito', 'privado'] },
    { label: 'Copia de Kitsune (llevar tus cosas a otro ordenador)', keywords: ['backup'] },
  ]
  assert.deepEqual(palette.rank('copia', items).map(item => item.label), ['Copia de Kitsune (llevar tus cosas a otro ordenador)'])
  // Si no hay nada mejor, las letras en orden siguen sirviendo.
  assert.equal(palette.rank('nvp', items)[0].label, 'Nueva ventana privada')
})

test('an address is something.tld without spaces, or a URL with its scheme', () => {
  for (const text of ['kitsune.example', 'es.wikipedia.org/wiki/Zorro', 'https://x.example/a b', 'about:config', 'localhost.dev:8080/x']) {
    assert.equal(palette.looksLikeAddress(text), !text.includes(' '), text)
  }
  for (const text of ['modo compacto', 'zorro', 'v1.2 notas']) assert.equal(palette.looksLikeAddress(text), false, text)
})
