import test from 'node:test'
import assert from 'node:assert/strict'
import { PROFILE_COLORS, googleRetentionStatus, privacyMode, privacyModeStatus, profileInitials, validateProfileDraft, parseProfilesSnapshot } from '../start/profiles.mjs'

test('Google retention distinguishes a matching acknowledgement, pending application and existing manual privacy exceptions', () => {
  const state = (desired, effective, managed, status = 'applied') => ({ googleRemember: desired, native: { status, googleRemember: effective, googlePolicyManaged: managed } })
  assert.match(googleRetentionStatus(state(true, true, true), true), /^Se conservará/)
  assert.equal(googleRetentionStatus(state(true, false, true), true), null)
  assert.equal(googleRetentionStatus(state(true, true, true, 'queued'), true), null)
  assert.equal(googleRetentionStatus(state(false, false, false), true), null)
  assert.equal(googleRetentionStatus(state(false, false, true), false), null)
  assert.match(googleRetentionStatus(state(false, false, false), false), /^Sin una excepción/)
  assert.equal(googleRetentionStatus(state(false, true, false), false), 'Kitsune no gestiona esta excepción; Google se conserva por tus ajustes de privacidad.')
})

test('profile identity uses readable Unicode initials without requiring an online account', () => {
  assert.equal(profileInitials('  Akira Noche  '), 'AN')
  assert.equal(profileInitials('夜の狐'), '夜')
  assert.equal(profileInitials(''), 'K')
  assert.deepEqual(validateProfileDraft({ name: '  夜の狐  ', email: '', color: 'violet' }), { name: '夜の狐', email: '', color: 'violet' })
})

test('profile draft validates names, optional email annotations and all allowed colors', () => {
  for (const color of PROFILE_COLORS) assert.equal(validateProfileDraft({ name: 'Personal', email: 'hola@example.com', color }).color, color)
  assert.equal(validateProfileDraft({ name: '狐'.repeat(48), email: '', color: 'blue' }).name.length, 48)
  for (const name of ['', '   ', 'a'.repeat(49), 'foo\nbar', '\u0000', '\ud800']) assert.throws(() => validateProfileDraft({ name, email: '', color: 'blue' }))
  for (const email of ['not-an-email', 'me@example.com evil', 'me@example.com\nother', 'a'.repeat(255) + '@example.com', '\ud800@example.com']) assert.throws(() => validateProfileDraft({ name: 'Personal', email, color: 'blue' }))
  assert.throws(() => validateProfileDraft({ name: 'Personal', email: '', color: 'transparent' }))
})

function snapshot() {
  return { version: 1, revision: 0, token: 'test-token', currentId: 'default', defaultId: 'default', profiles: [{ id: 'default', name: 'Personal', email: '', color: 'blue' }] }
}

test('profiles API snapshots require an actual current/default profile and bounded identities', () => {
  assert.equal(parseProfilesSnapshot(snapshot()).currentId, 'default')
  for (const change of [
    { revision: -1 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { token: '' },
    { currentId: 'missing' }, { defaultId: 'missing' }, { profiles: [] },
    { profiles: [{ ...snapshot().profiles[0], id: '../profile' }] },
    { profiles: [{ ...snapshot().profiles[0], name: '\ud800' }] },
    { profiles: [snapshot().profiles[0], snapshot().profiles[0]] },
    { profiles: Array.from({ length: 25 }, (_, i) => ({ ...snapshot().profiles[0], id: String(i) })) },
  ]) assert.throws(() => parseProfilesSnapshot({ ...snapshot(), ...change }))
})

test('privacy mode defaults to Estricto and reports active, pending and other-profile states', () => {
  assert.equal(privacyMode({}), 'estricto')
  assert.equal(privacyMode({ privacyMode: 'comodo' }), 'comodo')
  assert.equal(privacyMode({ privacyMode: 'toString' }), 'estricto')
  const applied = mode => ({ native: { status: 'applied', privacyMode: mode } })
  assert.equal(privacyModeStatus({ privacyMode: 'comodo' }, false), 'Privacidad: Cómodo · se aplica al abrir este perfil')
  assert.equal(privacyModeStatus({ privacyMode: 'comodo' }, true, applied('comodo')), 'Privacidad: Cómodo · activo')
  assert.equal(privacyModeStatus({ privacyMode: 'comodo' }, true, applied('estricto')), 'Privacidad: Cómodo · se aplicará al reiniciar Kitsune')
  assert.equal(privacyModeStatus({}, true, applied('estricto')), 'Privacidad: Estricto · activo')
  assert.equal(privacyModeStatus({}, true, { native: { status: 'queued', privacyMode: 'comodo' } }), 'Privacidad: Estricto')
  assert.equal(privacyModeStatus({}, true), 'Privacidad: Estricto')
})

test('profiles API snapshots reject unknown privacy modes', () => {
  const base = { version: 1, revision: 1, currentId: 'default', defaultId: 'default', token: 't',
    profiles: [{ id: 'default', name: 'Personal', email: '', color: 'blue' }] }
  assert.equal(parseProfilesSnapshot(base).profiles.length, 1)
  assert.equal(parseProfilesSnapshot({ ...base, profiles: [{ ...base.profiles[0], privacyMode: 'comodo' }] }).profiles[0].privacyMode, 'comodo')
  assert.throws(() => parseProfilesSnapshot({ ...base, profiles: [{ ...base.profiles[0], privacyMode: 'abierto' }] }))
})
