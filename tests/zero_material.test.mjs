import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveMaterial, glassy, geckoPrefs, surfaceAlpha, tintAlpha, MATERIALS } from '../zero/modules/zero-material.mjs'

const win11 = { os: 'WINNT', build: 26100 }

test('el material solo lo pone Windows 11 22H2 o posterior; en los demás sistemas manda su escritorio', () => {
  assert.equal(resolveMaterial('auto', { os: 'Linux' }), null)
  assert.equal(resolveMaterial('acrylic', { os: 'Darwin' }), null)
  assert.equal(resolveMaterial('auto', { os: 'WINNT', build: 19045 }), 'opaque')   // Windows 10
  assert.equal(resolveMaterial('acrylic', { os: 'WINNT', build: 22000 }), 'opaque') // Windows 11 21H2: sin DWMWA_SYSTEMBACKDROP_TYPE
  assert.equal(resolveMaterial('auto', { os: 'WINNT', build: 22621 }), 'acrylic')
})

test('«auto» es Acrílico, Mica con el modo ahorro, y lo elegido se respeta', () => {
  assert.equal(resolveMaterial('auto', win11), 'acrylic')
  assert.equal(resolveMaterial('auto', { ...win11, saver: true }), 'mica')
  for (const value of ['acrylic', 'mica', 'opaque']) assert.equal(resolveMaterial(value, win11), value)
  for (const value of ['', 'cristal', undefined, null]) assert.equal(resolveMaterial(value, win11), 'acrylic')
  assert.deepEqual(MATERIALS, ['auto', 'acrylic', 'mica', 'opaque'])
})

test('sin transparencias (ajuste de Windows) o con alto contraste, opaco aunque se pida cristal', () => {
  assert.equal(resolveMaterial('acrylic', { ...win11, reducedTransparency: true }), 'opaque')
  assert.equal(resolveMaterial('mica', { ...win11, highContrast: true }), 'opaque')
})

test('cada material, con los ajustes de Gecko que lo encienden (widget.windows.mica.*)', () => {
  assert.deepEqual(geckoPrefs('acrylic'), { 'widget.windows.mica': true, 'widget.windows.mica.toplevel-backdrop': 2 })
  assert.deepEqual(geckoPrefs('mica'), { 'widget.windows.mica': true, 'widget.windows.mica.toplevel-backdrop': 1 })
  assert.deepEqual(geckoPrefs('opaque'), { 'widget.windows.mica': false })
  assert.deepEqual(geckoPrefs(null), { 'widget.windows.mica': false })
  assert.equal(glassy('acrylic'), true)
  assert.equal(glassy('opaque'), false)
})

test('la opacidad de las superficies y el tinte del marco tienen sus límites y sus valores de serie', () => {
  assert.equal(surfaceAlpha('0.85'), 0.85)
  assert.equal(surfaceAlpha('0.1'), 0.5)
  assert.equal(surfaceAlpha('3'), 1)
  assert.equal(surfaceAlpha(''), 0.85)
  assert.equal(surfaceAlpha('x'), 0.85)
  assert.equal(tintAlpha('0.55'), 0.55)
  assert.equal(tintAlpha('1'), 0.95)
  assert.equal(tintAlpha('-1'), 0)
  assert.equal(tintAlpha(undefined), 0.7)
})
