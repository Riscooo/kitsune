import assert from 'node:assert/strict'
import test from 'node:test'
import { privacyText } from '../start/privacy-line.mjs'

test('the home line says how many trackers were blocked this week, and nothing when there are none', () => {
  // En español, los números de cuatro cifras van sin punto de millar (1234) y los de cinco, con él.
  assert.equal(privacyText({ available: true, week: { total: 12345 }, today: { total: 12 } }), 'Esta semana Kitsune ha bloqueado 12.345 rastreadores (12 hoy)')
  assert.equal(privacyText({ available: true, week: { total: 1234 }, today: { total: 0 } }), 'Esta semana Kitsune ha bloqueado 1234 rastreadores')
  assert.equal(privacyText({ available: true, week: { total: 1 }, today: { total: 0 } }), 'Esta semana Kitsune ha bloqueado 1 rastreador')
  assert.equal(privacyText({ available: true, week: { total: 0 }, today: { total: 0 } }), '')
  assert.equal(privacyText({ available: false }), '')
  assert.equal(privacyText(null), '')
})
