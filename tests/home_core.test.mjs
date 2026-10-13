import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as core from '../install/home-extension/api/core.sys.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// Lo mismo, por el servidor de Linux: así el inicio integrado no se aparta de él.
function python(script, input) {
  const result = spawnSync('python3', ['-c', script], { cwd: ROOT, input: JSON.stringify(input), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
const SERVER = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('home', 'install/home-server.py')
home = importlib.util.module_from_spec(spec); spec.loader.exec_module(home)
`

const base = core.DEFAULT_DATA
const link = (patch = {}) => ({ id: 'mio', name: 'Mi sitio', url: 'https://example.com/', color: 'teal', icon: 'book', ...patch })
const SETTINGS_CASES = [
  { ...base },
  { links: base.links, art: true, motion: false, newTab: true, accent: 'pink', focus: true },
  { ...base, theme: 'oscuro', background: 'a'.repeat(64), windowControls: 'derecha', brand: false, performance: 'ahorro', ramLimit: 1024, minimize: false },
  { ...base, windowButtons: 'sistema' },
  { ...base, windowButtons: 'kitsune' },
  { ...base, windowButtons: 'macos' },
  { ...base, theme: 'sepia' },
  { ...base, ramLimit: 3000 },
  { ...base, background: 'xyz' },
  { ...base, modules: { clock: true } },
  { ...base, unknown: 1 },
  { art: true },
  { ...base, motion: 'yes' },
  { ...base, links: [link()] },
  { ...base, links: [link({ url: 'javascript:alert(1)' })] },
  { ...base, links: [link({ url: 'https://user:pass@example.com/' })] },
  { ...base, links: [link({ url: 'https://exa mple.com/' })] },
  { ...base, links: [link({ url: 'http://exa%41mple.com/' })] },
  { ...base, links: [link({ url: 'https://example.com:99999/' })] },
  { ...base, links: [link({ name: ' espacio' })] },
  { ...base, links: [link({ name: 'x'.repeat(37) })] },
  { ...base, links: [link(), link()] },
  { ...base, links: [link({ id: '-malo' })] },
  { ...base, links: [link({ color: 'black' })] },
  { ...base, links: [link({ icon: 'skull' })] },
  { ...base, links: [{ ...link(), extra: true }] },
  { ...base, links: Array.from({ length: 13 }, (_, index) => link({ id: `l${index}` })) },
]

test('home settings accept and reject exactly what the Linux server does, with its messages', () => {
  const expected = python(`${SERVER}
out = []
for case in json.load(sys.stdin):
    try:
        out.append({"ok": home.validate_data(case)})
    except home.InvalidSettings as error:
        out.append({"error": str(error)})
print(json.dumps(out))`, SETTINGS_CASES)
  SETTINGS_CASES.forEach((value, index) => {
    let actual
    try { actual = { ok: core.validateSettings(value) } } catch (error) { actual = { error: error.message } }
    assert.deepEqual(actual, expected[index], `caso ${index}: ${JSON.stringify(value).slice(0, 120)}`)
  })
})

test('a save needs the current revision and the background can only stay, go or become the new one', () => {
  const record = core.defaultSettingsRecord()
  const first = core.updateSettings(record, { ...record.data, theme: 'oscuro' }, 0)
  assert.equal(first.updated, true)
  assert.equal(first.record.revision, 1)
  assert.equal(core.updateSettings(first.record, first.record.data, 0).updated, false)
  assert.throws(() => core.updateSettings(first.record, { ...first.record.data, background: 'b'.repeat(64) }, 1), /El fondo no es válido/)
  const stored = core.updateSettings(first.record, { ...first.record.data, background: 'b'.repeat(64) }, 1, 'b'.repeat(64))
  assert.equal(stored.record.data.background, 'b'.repeat(64))
  assert.equal(core.updateSettings(stored.record, { ...stored.record.data, background: null }, 2).record.data.background, null)
  assert.throws(() => core.parseSettingsRecord('{"version":2}'), error => error.status === 503)
  assert.deepEqual(core.parseSettingsRecord(JSON.stringify(stored.record)), stored.record)
})

test('the appearance control is the same v7 control that appearance.py writes', () => {
  const settings = { ...base, theme: 'oscuro', background: 'c'.repeat(64), windowControls: 'derecha', performance: 'ahorro', ramLimit: 4096, windowButtons: 'sistema' }
  const expected = python(`
import importlib.util, json, sys, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('appearance', 'install/appearance.py')
appearance = importlib.util.module_from_spec(spec); spec.loader.exec_module(appearance)
root = Path(tempfile.mkdtemp())
manager = appearance.AppearanceManager(root / 'browser', root / 'state')
settings = json.load(sys.stdin)
manager.background(settings['background']).parent.mkdir(parents=True)
manager.background(settings['background']).write_bytes(b'jpeg')
value = manager.refresh(settings)
value.pop('fingerprint'); value.pop('native')
print(json.dumps(value))`, settings)
  assert.deepEqual(core.appearanceControl(settings), expected)
  assert.equal(expected.version, 7)
  assert.equal(expected.windowButtons, 'sistema')
  assert.equal(core.appearanceControl(settings, { backgroundExists: false }).background, null)
  assert.equal(core.canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), '{"a":[{"c":3,"d":2}],"b":1}')
  const fresh = Date.now()
  assert.equal(core.nativeStatus({ version: 1, fingerprint: 'f', at: fresh, privacyMode: 'comodo' }, 'f', fresh).status, 'applied')
  assert.equal(core.nativeStatus({ version: 1, fingerprint: 'f', at: fresh - 60000 }, 'f', fresh).status, 'queued')
})

test('a fresh install has one generic profile, and the page sees what profiles.py shows', () => {
  const record = core.defaultProfilesRecord('2026-10-10T12:00:00+00:00', '/perfiles/abc')
  core.validateProfilesRecord(record)
  assert.equal(record.profiles[0].name, 'Personal')
  assert.equal(record.profiles[0].email, '')
  const snapshot = core.profilesSnapshot(record, 'default')
  assert.equal(JSON.stringify(snapshot).includes('/perfiles/abc'), false)
  const expected = python(`
import importlib.util, json, sys, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('profiles', 'install/profiles.py')
profiles = importlib.util.module_from_spec(spec); spec.loader.exec_module(profiles)
root = Path(tempfile.mkdtemp())
print(json.dumps(profiles.ProfileManager(root / 'browser', root / 'state').snapshot()))`, null)
  assert.deepEqual(Object.keys(snapshot).sort(), Object.keys(expected).sort())
  assert.deepEqual(Object.keys(snapshot.profiles[0]).sort(), Object.keys(expected.profiles[0]).sort())
  assert.deepEqual({ ...snapshot.profiles[0], createdAt: null }, { ...expected.profiles[0], createdAt: null })
})

test('profile requests are checked like the server: labels, revision, mode and actions', () => {
  const record = core.defaultProfilesRecord('2026-10-10T12:00:00+00:00', '/p')
  assert.throws(() => core.parseProfileBody({ name: '', email: '', color: 'blue', revision: 0 }), /nombre de entre 1 y 48/)
  assert.throws(() => core.parseProfileBody({ name: 'Ana', email: 'no-es-correo', color: 'blue', revision: 0 }), /correo válido/)
  assert.throws(() => core.parseProfileBody({ name: 'Ana', email: '', color: 'black', revision: 0 }), /color del perfil/)
  assert.throws(() => core.parseProfileBody({ name: 'Ana', email: '', color: 'blue', revision: 0, privacyMode: 'laxo' }), /Estricto o Cómodo/)
  assert.throws(() => core.parseProfileBody({ name: 'Ana', email: '', color: 'blue', revision: 0, path: '/etc' }), /no es válida/)
  const body = core.parseProfileBody({ name: 'Ana', email: 'ana@example.com', color: 'pink', revision: 0, privacyMode: 'comodo' })
  assert.equal(body.privacyMode, 'comodo')
  assert.equal(core.isOmitted(body.avatarData), true)
  assert.throws(() => core.checkProfilesRevision(record, 5, 'default'), error => error.status === 409 && error.extra.revision === 0)
  assert.throws(() => core.findProfile(record, '../x'), /identificador/)
  assert.deepEqual(Object.keys(core.ACTIONS), ['home', 'google', 'privacy', 'passwords', 'settings', 'general', 'search', 'downloads', 'extensions'])
})

test('the privacy mode goes into a managed block of user.js and nothing else is touched', () => {
  const mine = 'user_pref("browser.startup.page", 3);\n'
  const once = core.withProfileBlock(mine, 'comodo')
  assert.ok(once.startsWith(mine))
  assert.match(once, /user_pref\("kitsune\.privacy\.requested", "comodo"\);/)
  const twice = core.withProfileBlock(once, 'estricto')
  assert.equal(twice.split(core.USER_JS_BEGIN).length, 2)
  assert.match(twice, /"estricto"/)
  assert.doesNotMatch(twice, /"comodo"/)
  assert.ok(twice.startsWith(mine))
  assert.throws(() => core.withProfileBlock('', 'todo'), /Estricto o Cómodo/)
})

test('preset backgrounds come from the engine catalogue, without the Firefox ones, checked like wallpapers.py', () => {
  const id = n => `0000000${n}-0000-4000-8000-000000000000`
  const attachment = { hash: 'a'.repeat(64), size: 1000, location: 'main-workspace/x/1.avif', mimetype: 'image/avif' }
  const catalog = { data: [
    { id: id(1), category: 'abstracts', title: 'b', order: 2, attachment, attribution: { name: { string: 'Ana' } } },
    { id: id(2), category: 'abstracts', title: 'a', order: 1, attachment },
    { id: id(3), category: 'firefox', title: 'zorro', attachment },
    { id: id(4), category: 'solid-colors', title: 'verde', solid_color: '#00AA00' },
    { id: 'no-es-un-id', category: 'abstracts', attachment },
    { id: id(5), category: 'celestial', attachment: { ...attachment, location: '../fuera' } },
    { id: id(6), category: 'celestial', attachment: { ...attachment, mimetype: 'image/svg+xml' } },
    { id: id(7), category: 'photographs', attachment: { ...attachment, size: 13 * 1024 * 1024 } },
    { id: id(8), category: 'photographs', visible: false, attachment },
  ] }
  const plan = core.planWallpapers(catalog)
  assert.deepEqual(plan.map(category => category.id), ['abstracts', 'solid-colors'])
  assert.deepEqual(plan[0].items.map(item => item.id), [id(2), id(1)])
  assert.equal(plan[0].items[1].credit, 'Foto: Ana · Unsplash')
  assert.deepEqual(plan[1].items[0], { id: id(4), credit: null, source: 'color:#00aa00', color: '#00aa00' })
  assert.throws(() => core.planWallpapers({}), error => error.status === 503)
  const shown = core.publicWallpapers({ categories: [{ id: 'abstracts', name: 'Abstractos', items: [{ id: id(2), sha256: 'b'.repeat(64), source: 'x', credit: null }, { id: id(1) }] }] })
  assert.deepEqual(shown, [{ id: 'abstracts', name: 'Abstractos', items: [{ id: id(2), sha256: 'b'.repeat(64) }] }])
  assert.deepEqual(core.coverCrop(1000, 1000, 320, 200), { x: 0, y: 187, width: 1000, height: 625 })
})
