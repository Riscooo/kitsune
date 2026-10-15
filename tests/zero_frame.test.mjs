import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dominantColor, backdropMode, backdropOpacity, painted, desktopOf, GLASS_RULES, macGlass, macGlassOn, windowRadius, variantOf } from '../zero/modules/zero-frame.sys.mjs'

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

test('«Nácar» (de serie): the system glass where the compositor (or macOS) blurs behind Kitsune; if not, the photo of the page', () => {
  assert.equal(backdropMode('auto', { desktop: 'niri', rule: true }), 'system')
  assert.equal(backdropMode('auto', { desktop: 'niri', rule: true, variant: 'nacar' }), 'system')
  assert.equal(backdropMode('auto', { desktop: 'macos', rule: true }), 'system')   // con el cristal de macOS encendido
  assert.equal(backdropMode('auto', { desktop: 'macos', rule: false }), 'web')
  assert.equal(backdropMode('auto', { desktop: null, rule: false, dark: false }), 'web')
  assert.equal(backdropMode('raro', { desktop: 'niri', rule: true }), 'system')
})

test('«Sobrio» (Dani, 15-10): the system glass only on Linux; if not, space with the dark theme and mist with the light one', () => {
  const sobrio = env => ({ ...env, variant: 'sobrio' })
  assert.equal(backdropMode('auto', sobrio({ niri: true, desktop: 'niri', rule: true })), 'system')
  assert.equal(backdropMode('auto', sobrio({ niri: true, rule: false })), 'space')
  assert.equal(backdropMode('auto', sobrio({ niri: false, rule: false, dark: false })), 'mist')
  assert.equal(backdropMode('auto', sobrio({ desktop: 'macos', rule: true, dark: true })), 'space')
  assert.equal(backdropMode('auto', sobrio({ desktop: 'macos', rule: true, dark: false })), 'mist')
  assert.equal(backdropMode('raro', sobrio({ desktop: 'niri', rule: true })), 'system')
})

test('a background chosen by hand is the same in both variants', () => {
  for (const variant of ['nacar', 'sobrio']) {
    assert.equal(backdropMode('web', { niri: true, rule: true, variant }), 'web')
    assert.equal(backdropMode('system', { niri: false, variant }), 'system')
    assert.equal(backdropMode('space', { rule: false, variant }), 'space')
    assert.equal(backdropMode('mist', { rule: true, variant }), 'mist')
    assert.equal(backdropMode('photo', { rule: true, variant }), 'photo')
  }
})

test('the variant is «Nácar» unless it says «Sobrio»', () => {
  assert.equal(variantOf('sobrio'), 'sobrio')
  for (const value of ['nacar', '', 'raro', undefined, null]) assert.equal(variantOf(value), 'nacar')
})

test('the window corners are those of each system: niri 48, macOS 26 16 (10 before), Windows 11 8 (Windows 10 square)', () => {
  assert.equal(windowRadius({ os: 'Linux' }), 48)
  assert.equal(windowRadius({ os: 'Darwin', kernel: '25.0.0' }), 16)
  assert.equal(windowRadius({ os: 'Darwin', kernel: '26.2.0' }), 16)
  assert.equal(windowRadius({ os: 'Darwin', kernel: '24.6.0' }), 10)
  assert.equal(windowRadius({ os: 'WINNT', windows11: true }), 8)
  assert.equal(windowRadius({ os: 'WINNT', windows11: false }), 0)
})

test('the Apple glass of the engine has the same corners as Zero on macOS 26', () => {
  const recipe = readFileSync(new URL('../install/kitsune-engine.py', import.meta.url), 'utf8')
  assert.ok(recipe.includes(`Preferences::GetInt("kitsune.zero.macos-glass-radius", ${windowRadius({ os: 'Darwin', kernel: '25.0.0' })})`))
})

test('the painted backgrounds have an opacity from 0.2 to 1', () => {
  assert.equal(backdropOpacity('1'), 1)
  assert.equal(backdropOpacity('0.5'), 0.5)
  assert.equal(backdropOpacity('0'), 0.2)
  assert.equal(backdropOpacity('7'), 1)
  assert.equal(backdropOpacity('nada'), 1)
  assert.deepEqual(['system', 'web', 'space', 'mist', 'photo'].filter(painted), ['space', 'mist', 'photo'])
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
    assert.equal(backdropMode('auto', { desktop, rule: false, variant: 'sobrio' }), 'space')
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

test('Apple Liquid Glass is off unless kitsune.zero.macos-glass turns it on (it failed on a real Mac, Risco 15-10)', () => {
  const prefs = value => ({ getBoolPref: (name, fallback) => (name === 'kitsune.zero.macos-glass' && value !== undefined ? value : fallback) })
  assert.equal(macGlassOn('Darwin', '25.0.0', prefs()), false)
  assert.equal(macGlassOn('Darwin', '25.0.0', prefs(true)), true)
  assert.equal(macGlassOn('Darwin', '24.6.0', prefs(true)), false)
  assert.equal(macGlassOn('Darwin', '25.0.0', prefs(false)), false)
})
