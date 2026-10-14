import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, stat, readdir, cp, rm } from 'node:fs/promises';
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
  const launcher = join(root, 'kitsune-browser');
  const argsFile = join(root, 'args.json');
  // The launcher only runs Kitsune's own engine at engine/current/kitsune; the
  // fixture places a stub there. The engine path is intentionally not env-overridable.
  const engine = join(data, 'kitsune-browser/engine/current');
  await mkdir(engine, { recursive: true });
  await writeFile(join(engine, 'kitsune'), '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.KITSUNE_TEST_ARGS, JSON.stringify({args:process.argv.slice(2),remoting:process.env.MOZ_APP_REMOTINGNAME,wayland:process.env.MOZ_ENABLE_WAYLAND,privacy:process.env.KITSUNE_PRIVACY_MODE}));\n', { mode: 0o755 });
  await writeFile(launcher, source, { mode: 0o755 });
  await cp(new URL('../install/kitsune-engine.py', import.meta.url), join(data, 'kitsune-browser/kitsune-engine.py'));
  await writeFile(scheme, JSON.stringify({ colours: { background: '#112233', primary: 'AABBCC', onSurface: '#fafafa' } }));
  const env = { ...process.env, XDG_DATA_HOME: data, XDG_STATE_HOME: state, XDG_CONFIG_HOME: join(root, 'config'), KITSUNE_SCHEME_FILE: scheme, KITSUNE_TEST_ARGS: argsFile };
  const profile = join(data, 'kitsune-browser/profile');
  const chrome = join(profile, 'chrome/palette.css');
  const start = join(data, 'kitsune-browser/start/palette.css');
  return { root, data, state, scheme, env, profile, chrome, start, argsFile, engine, run: (...args) => exec('/bin/sh', [launcher, ...args], { env }) };
}

test('the desktop scheme never rewrites the paper palette (Kitsune 0.5 «Tinta»)', async () => {
  const f = await setup();
  const paper = ':root {\n  --kb-bg: #f6f5f1;\n}\n';
  await mkdir(join(f.profile, 'chrome'), { recursive: true, mode: 0o700 });
  await mkdir(join(f.data, 'kitsune-browser/start'), { recursive: true });
  await writeFile(f.chrome, paper);
  await writeFile(f.start, paper);
  await f.run('https://example.com/');
  await f.run('--sync-palette-only');
  assert.equal(await readFile(f.chrome, 'utf8'), paper);
  assert.equal(await readFile(f.start, 'utf8'), paper);
});

test('URL arguments and native flags remain separate and preserve text exactly', async () => {
  const f = await setup();
  const requested = ['--new-window', 'https://example.com/?q=café%20anime&lang=es', 'https://example.org/a#fragment'];
  await f.run(...requested);
  const actual = JSON.parse(await readFile(f.argsFile, 'utf8'));
  assert.deepEqual(actual.args, ['--profile', f.profile, ...requested]);
  assert.equal(actual.remoting, 'kitsune-browser');
  assert.equal(actual.wayland, '1');
  assert.equal(actual.privacy, 'estricto');
});

test('without its own engine Kitsune explains how to build it and launches nothing else', async () => {
  const f = await setup();
  await rm(f.engine, { recursive: true });
  await assert.rejects(f.run('https://example.com/'), error => {
    assert.match(error.stderr, /El motor de Kitsune aún no está compilado/);
    return true;
  });
  await assert.rejects(stat(f.argsFile), { code: 'ENOENT' });
  assert.doesNotMatch(source, /librewolf/i);
});

test('a profile last opened by another engine is copied before its first launch, and only once', async () => {
  const f = await setup();
  await mkdir(f.profile, { recursive: true });
  await writeFile(join(f.profile, 'places.sqlite'), 'history');
  await writeFile(join(f.profile, 'compatibility.ini'), '[Compatibility]\nLastPlatformDir=/usr/lib/librewolf\n');
  await f.run('https://example.com/');
  const copies = (await readdir(f.data)).filter(name => name.startsWith('kitsune-0.6-profile-backup.'));
  assert.equal(copies.length, 1);
  assert.equal(await readFile(join(f.data, copies[0], 'profile/places.sqlite'), 'utf8'), 'history');
  await writeFile(join(f.profile, 'compatibility.ini'), `[Compatibility]\nLastPlatformDir=${f.engine}\n`);
  await f.run('https://example.com/');
  assert.equal((await readdir(f.data)).filter(name => name.startsWith('kitsune-0.6-profile-backup.')).length, 1);
  assert.doesNotMatch(source, /prepare-runtime/);
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

test('each profile launches with its own privacy mode', async () => {
  const f = await setup();
  const created = await installProfileFixture(f);
  const script = 'import sys; sys.path.insert(0,sys.argv[1]); from profiles import ProfileManager; m=ProfileManager(sys.argv[1],sys.argv[2]); s=m.snapshot(); m.edit(sys.argv[3],"Trabajo","work@example.org","teal",s["revision"],privacyMode="comodo")';
  await exec('python3', ['-c', script, join(f.data, 'kitsune-browser'), join(f.state, 'kitsune-browser'), created.id], { env: f.env });
  await f.run('--kitsune-profile', created.id);
  assert.equal(JSON.parse(await readFile(f.argsFile, 'utf8')).privacy, 'comodo');
  await f.run('--kitsune-profile', 'default');
  assert.equal(JSON.parse(await readFile(f.argsFile, 'utf8')).privacy, 'estricto');
});

test('profile actions are enumerated and invalid IDs never launch', async () => {
  const f = await setup();
  const created = await installProfileFixture(f);
  await f.run('--kitsune-profile', created.id, '--kitsune-action', 'passwords');
  const actual = JSON.parse(await readFile(f.argsFile, 'utf8'));
  assert.deepEqual(actual.args, ['--profile', created.profile, '--new-tab', 'about:logins']);
  // Las acciones de Sync ya no existen (sin cuentas de Mozilla).
  for (const action of ['sync', 'sync-settings', 'sync-google']) await assert.rejects(f.run('--kitsune-profile', created.id, '--kitsune-action', action));
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
  await rm(f.engine, { recursive: true });
  await assert.rejects(f.run('--home'));
  await assert.rejects(stat(f.argsFile), { code: 'ENOENT' });
});

test('every settings action reaches the matching native destination in the selected profile', async () => {
  const f = await setup();
  const created = await installProfileFixture(f);
  const actions = { settings: 'about:preferences', general: 'about:preferences#general',
    search: 'about:preferences#search', privacy: 'about:preferences#privacy',
    downloads: 'about:downloads', extensions: 'about:addons', passwords: 'about:logins' };
  for (const [action, destination] of Object.entries(actions)) {
    await f.run('--kitsune-profile', created.id, '--kitsune-action', action);
    const actual = JSON.parse(await readFile(f.argsFile, 'utf8'));
    assert.deepEqual(actual.args, ['--profile', created.profile, '--new-tab', destination]);
    assert.equal(actual.remoting, created.remoting);
  }
});

test('every action the home page can ask for opens its page (none is turned away)', async () => {
  // Las acciones que acepta el servidor del inicio (install/profiles.py, ACTIONS) y su página.
  const profiles = await readFile(new URL('../install/profiles.py', import.meta.url), 'utf8');
  const block = profiles.match(/^ACTIONS = \{\n([\s\S]*?)^\}/m)[1];
  const actions = [...block.matchAll(/^\s+"(\w+)": (None|"([^"]+)"),$/gm)].map(([, name, , url]) => [name, url ?? null]);
  assert.ok(actions.some(([name]) => name === 'protections'), 'el informe de protecciones está entre las acciones');
  // Las mismas que el inicio integrado de Windows y macOS (que además tiene «switch», de los usuarios).
  const { ACTIONS } = await import('../install/home-extension/api/core.sys.mjs');
  assert.deepEqual(Object.keys(ACTIONS).filter(name => name !== 'switch').sort(), actions.map(([name]) => name).sort());
  for (const [name, url] of actions) assert.equal(ACTIONS[name], url, name);
  for (const [action, url] of actions.filter(([, page]) => page)) {
    const f = await setup();
    await f.run('--kitsune-action', action);
    const { args } = JSON.parse(await readFile(f.argsFile, 'utf8'));
    assert.ok(args.includes(url), `${action} → ${url}: ${args.join(' ')}`);
  }
});
