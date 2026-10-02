import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, stat, readdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const source = await readFile(new URL('../install/kitsune-browser', import.meta.url), 'utf8');

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'kitsune-launcher-test-'));
  const data = join(root, 'data with spaces # 狐');
  const state = join(root, 'state');
  const scheme = join(root, 'scheme.json');
  const stub = join(root, 'browser-stub');
  const launcher = join(root, 'kitsune-browser');
  const argsFile = join(root, 'args.json');
  await writeFile(stub, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.KITSUNE_TEST_ARGS, JSON.stringify({args:process.argv.slice(2),remoting:process.env.MOZ_APP_REMOTINGNAME,wayland:process.env.MOZ_ENABLE_WAYLAND}));\n', { mode: 0o755 });
  // Replace only the executable in a temporary fixture, never in the installed
  // launcher. The production browser path is intentionally not env-overridable.
  await writeFile(launcher, source.replace('exec /usr/bin/librewolf ', 'exec "${KITSUNE_TEST_BINARY}" '), { mode: 0o755 });
  await writeFile(scheme, JSON.stringify({ colours: { background: '#112233', primary: 'AABBCC', onSurface: '#fafafa' } }));
  const env = { ...process.env, XDG_DATA_HOME: data, XDG_STATE_HOME: state, XDG_CONFIG_HOME: join(root, 'config'), KITSUNE_SCHEME_FILE: scheme, KITSUNE_TEST_ARGS: argsFile, KITSUNE_TEST_BINARY: stub };
  const profile = join(data, 'kitsune-browser/profile');
  const chrome = join(profile, 'chrome/palette.css');
  const start = join(data, 'kitsune-browser/start/palette.css');
  return { root, data, state, scheme, env, profile, chrome, start, argsFile, run: (...args) => exec('/bin/sh', [launcher, ...args], { env }) };
}

test('one sanitized scheme snapshot writes matching atomic palettes without launching', async () => {
  const f = await setup();
  await f.run('--sync-palette-only');
  const css = await readFile(f.chrome, 'utf8');
  assert.equal(css, await readFile(f.start, 'utf8'));
  assert.match(css, /--kb-bg: #112233;/);
  assert.match(css, /--kb-primary: #AABBCC;/);
  assert.match(css, /--kb-secondary: #39b4ff;/);
  await assert.rejects(stat(f.argsFile), { code: 'ENOENT' });
  assert.equal((await stat(f.profile)).mode & 0o777, 0o700);
  assert.ok((await readdir(join(f.profile, 'chrome'))).every(name => !name.includes('.tmp.')));
});

test('invalid CSS values fall back and malformed JSON preserves the last valid palette', async () => {
  const f = await setup();
  await writeFile(f.scheme, JSON.stringify({ colours: { background: 'red; color:red', primary: {}, onSurface: null } }));
  await f.run('--sync-palette-only');
  const css = await readFile(f.chrome, 'utf8');
  assert.match(css, /--kb-bg: #00101c;/);
  assert.doesNotMatch(css, /color:red/);
  await writeFile(f.scheme, '{ "colours":');
  await f.run('--sync-palette-only');
  assert.equal(await readFile(f.chrome, 'utf8'), css);
  assert.equal(await readFile(f.start, 'utf8'), css);
});

test('unchanged and concurrent launches do not rewrite or truncate palettes', async () => {
  const f = await setup();
  await f.run('--sync-palette-only');
  const initial = await stat(f.chrome);
  await Promise.all(Array.from({ length: 10 }, () => f.run('--sync-palette-only')));
  const current = await stat(f.chrome);
  assert.equal(current.ino, initial.ino);
  assert.equal(current.mtimeMs, initial.mtimeMs);
  assert.equal(await readFile(f.chrome, 'utf8'), await readFile(f.start, 'utf8'));
});

test('URL arguments and native flags remain separate and preserve text exactly', async () => {
  const f = await setup();
  const requested = ['--new-window', 'https://example.com/?q=café%20anime&lang=es', 'https://example.org/a#fragment'];
  await f.run(...requested);
  const actual = JSON.parse(await readFile(f.argsFile, 'utf8'));
  assert.deepEqual(actual.args, ['--profile', f.profile, ...requested]);
  assert.equal(actual.remoting, 'kitsune-browser');
  assert.equal(actual.wayland, '1');
});

test('--home encodes local paths correctly and preserves additional arguments', async () => {
  const f = await setup();
  await f.run('--home', 'https://example.com/');
  const actual = JSON.parse(await readFile(f.argsFile, 'utf8'));
  const expected = pathToFileURL(resolve(f.data, 'kitsune-browser/start/index.html')).href;
  assert.deepEqual(actual.args, ['--profile', f.profile, '--new-tab', expected, 'https://example.com/']);
});

test('desktop URL associations belong to the main entry, not a desktop action', async () => {
  const desktop = await readFile(new URL('../install/kitsune-browser.desktop', import.meta.url), 'utf8');
  const main = desktop.split('\n[Desktop Action ')[0];
  assert.match(main, /^MimeType=.*x-scheme-handler\/http;.*x-scheme-handler\/https;/m);
  assert.equal((desktop.match(/^MimeType=/gm) || []).length, 1);
  assert.doesNotMatch(desktop, /x-scheme-handler\/(unknown|about)/);
});

test('profile config preserves signed extension enforcement and drops obsolete search prefs', async () => {
  const prefs = await readFile(new URL('../install/user.js', import.meta.url), 'utf8');
  assert.match(prefs, /user_pref\("xpinstall.signatures.required", true\)/);
  assert.doesNotMatch(prefs, /user_pref\("browser.search.defaultenginename/);
  assert.match(prefs, /user_pref\("browser.startup.page", 3\)/);
});

async function installProfileFixture(f) {
  const browser = join(f.data, 'kitsune-browser');
  const state = join(f.state, 'kitsune-browser');
  const templates = join(browser, 'templates');
  await mkdir(join(templates, 'chrome'), { recursive: true });
  await writeFile(join(templates, 'user.js'), 'user_pref("xpinstall.signatures.required", true);\n');
  await writeFile(join(templates, 'chrome/userChrome.css'), '/* clean fixture */');
  await cp(new URL('../install/profiles.py', import.meta.url), join(browser, 'profiles.py'));
  await cp(new URL('../install/media.py', import.meta.url), join(browser, 'media.py'));
  const bin = join(f.root, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  f.env.PATH = `${bin}:${f.env.PATH}`;
  const units = join(f.env.XDG_CONFIG_HOME, 'systemd/user');
  await mkdir(units, { recursive: true });
  await writeFile(join(units, 'kitsune-home.service'), '# fixture');
  await writeFile(join(units, 'kitsune-home@.service'), '# fixture');
  const script = 'import json,sys; sys.path.insert(0,sys.argv[1]); from profiles import ProfileManager; m=ProfileManager(sys.argv[1],sys.argv[2]); r=m.create("Trabajo","work@example.org","teal",m.snapshot()["revision"]); m.set_default(r["createdId"],r["revision"]); print(json.dumps(m.resolve(),default=str))';
  return JSON.parse((await exec('python3', ['-c', script, browser, state], { env: f.env })).stdout);
}

test('registered default and explicit profile route to separate profile paths and home origins', async () => {
  const f = await setup();
  const created = await installProfileFixture(f);
  await f.run('--home');
  let actual = JSON.parse(await readFile(f.argsFile, 'utf8'));
  assert.deepEqual(actual.args, ['--profile', created.profile, '--new-tab', created.home]);
  assert.equal(actual.remoting, created.remoting);
  await f.run('--kitsune-profile', 'default', '--kitsune-action', 'google');
  actual = JSON.parse(await readFile(f.argsFile, 'utf8'));
  assert.deepEqual(actual.args, ['--profile', f.profile, '--new-tab', 'https://accounts.google.com/ServiceLogin']);
  assert.equal(actual.remoting, 'kitsune-browser');
});

test('profile actions are enumerated and invalid IDs never launch', async () => {
  const f = await setup();
  const created = await installProfileFixture(f);
  await f.run('--kitsune-profile', created.id, '--kitsune-action', 'sync-settings');
  const actual = JSON.parse(await readFile(f.argsFile, 'utf8'));
  assert.deepEqual(actual.args, ['--profile', created.profile, '--new-tab', 'about:preferences#sync']);
  const previous = await readFile(f.argsFile, 'utf8');
  await assert.rejects(f.run('--kitsune-profile', '../escape', '--home'));
  await assert.rejects(f.run('--kitsune-profile', 'default', '--kitsune-action', 'unknown'));
  assert.equal(await readFile(f.argsFile, 'utf8'), previous);
});

test('profile service or branded runtime failures abort without falling back to another profile or engine', async () => {
  const f = await setup();
  await installProfileFixture(f);
  await writeFile(join(f.root, 'bin/systemctl'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await assert.rejects(f.run('--home'));
  await assert.rejects(stat(f.argsFile), { code: 'ENOENT' });
  await writeFile(join(f.root, 'bin/systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(join(f.data, 'kitsune-browser/prepare-runtime.py'), 'raise SystemExit(1)\n');
  await assert.rejects(f.run('--home'));
  await assert.rejects(stat(f.argsFile), { code: 'ENOENT' });
});

test('every settings action reaches the matching native destination in the selected profile', async () => {
  const f = await setup();
  const created = await installProfileFixture(f);
  const actions = { settings: 'about:preferences', general: 'about:preferences#general',
    search: 'about:preferences#search', privacy: 'about:preferences#privacy',
    downloads: 'about:downloads', extensions: 'about:addons', passwords: 'about:logins',
    sync: 'about:preferences#librewolf', 'sync-settings': 'about:preferences#sync',
    'sync-google': 'https://accounts.firefox.com/' };
  for (const [action, destination] of Object.entries(actions)) {
    await f.run('--kitsune-profile', created.id, '--kitsune-action', action);
    const actual = JSON.parse(await readFile(f.argsFile, 'utf8'));
    assert.deepEqual(actual.args, ['--profile', created.profile, '--new-tab', destination]);
    assert.equal(actual.remoting, created.remoting);
  }
});
