import assert from 'node:assert/strict'
import test from 'node:test'
import { dominantColor, backdropMode, desktopOf, GLASS_RULES, macGlass } from '../zero/modules/zero-frame.sys.mjs'

const block = (...parts) => {
  const bytes = []
  for (const [hex, count] of parts) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
    for (let i = 0; i < count; i++) bytes.push(r, g, b, 255)
  }
  return new Uint8ClampedArray(bytes)
}
const warm = hex => { const [r, , b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return r > b + 60 }

test('the tint takes the colour of the page, not its white paper or black text', () => {
  assert.ok(warm(dominantColor(block(['#c8553d', 40], ['#ffffff', 60]))))
  assert.ok(warm(dominantColor(block(['#c8553d', 30], ['#101010', 30], ['#fbfaf7', 40]))))
})

test('a page that is only white (or only black) still gives its own colour', () => {
  assert.equal(dominantColor(block(['#ffffff', 50])), '#ffffff')
  assert.equal(dominantColor(block(['#000000', 50])), '#000000')
  assert.equal(dominantColor(new Uint8ClampedArray(0)), null)
})

test('the system glass is used only when the compositor can blur behind Kitsune', () => {
  assert.equal(backdropMode('auto', { niri: true, rule: true }), 'system')
  assert.equal(backdropMode('auto', { niri: true, rule: false }), 'web')
  assert.equal(backdropMode('auto', { niri: false, rule: false }), 'web')
  assert.equal(backdropMode('web', { niri: true, rule: true }), 'web')
  assert.equal(backdropMode('system', { niri: false }), 'system')
  assert.equal(backdropMode('raro', { niri: true, rule: true }), 'system')
})

test('the desktop comes from the session: niri, Hyprland, KDE or GNOME', () => {
  const env = vars => name => vars[name] ?? ''
  assert.equal(desktopOf(env({ NIRI_SOCKET: '/run/user/1000/niri.sock', XDG_CURRENT_DESKTOP: 'niri' })), 'niri')
  assert.equal(desktopOf(env({ HYPRLAND_INSTANCE_SIGNATURE: 'abc', XDG_CURRENT_DESKTOP: 'Hyprland' })), 'hyprland')
  assert.equal(desktopOf(env({ KDE_SESSION_VERSION: '6', XDG_CURRENT_DESKTOP: 'KDE' })), 'kde')
  assert.equal(desktopOf(env({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })), 'gnome')
  assert.equal(desktopOf(env({ XDG_CURRENT_DESKTOP: 'sway' })), null)
  assert.equal(desktopOf(env({})), null)
})

test('the desktop glass is used with the Kitsune rule of any desktop that has one', () => {
  for (const desktop of ['niri', 'hyprland', 'kde', 'gnome']) {
    assert.equal(backdropMode('auto', { desktop, rule: true }), 'system')
    assert.equal(backdropMode('auto', { desktop, rule: false }), 'web')
  }
  assert.equal(backdropMode('auto', { desktop: null, rule: false }), 'web')
  assert.deepEqual(Object.keys(GLASS_RULES).sort(), ['gnome', 'hyprland', 'kde', 'niri'])
  assert.deepEqual(GLASS_RULES.niri, ['.config/niri/kitsune-zero.kdl'])
})

test('on macOS, Apple Liquid Glass from macOS 26 (Darwin 25) on', () => {
  assert.equal(macGlass('Darwin', '25.0.0'), true)
  assert.equal(macGlass('Darwin', '26.1.0'), true)
  assert.equal(macGlass('Darwin', '24.6.0'), false)
  assert.equal(macGlass('Linux', '25.0.0'), false)
  assert.equal(macGlass('WINNT', '10.0'), false)
})
