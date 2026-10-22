import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReleases, newerRelease, platformFor, releaseLabel, productDownloads, shouldAsk, FIRST_CHECK_MS, CHECK_EVERY_MS } from '../install/native/kitsune-updates.sys.mjs'
import { expectedSha256, hex, linuxPackage, platformOf, releasePackage, windowsScript } from '../install/native/kitsune-updater.sys.mjs'

test('releases order betas before the final version and compare numbers, not text', () => {
  assert.equal(compareReleases('0.7.0-beta.3', '0.7.0-beta.2'), 1)
  assert.equal(compareReleases('0.7.0-beta.10', '0.7.0-beta.9'), 1)
  assert.equal(compareReleases('0.7.0', '0.7.0-beta.9'), 1)
  assert.equal(compareReleases('0.8.0-beta.1', '0.7.0'), 1)
  assert.equal(compareReleases('0.7.0-beta.3', '0.7.0-beta.3'), 0)
  assert.equal(compareReleases('0.6.9', '0.7.0-beta.1'), -1)
  assert.equal(compareReleases('0.7.0-rc.1', '0.7.0'), null)
  assert.equal(compareReleases('<script>', '0.7.0'), null)
})

test('only a newer release for this system is announced', () => {
  const downloads = { windows: { release: '0.7.0-beta.4', url: 'x' }, macos: { release: '0.7.0-beta.3' } }
  assert.deepEqual(newerRelease(downloads, 'windows', '0.7.0-beta.3'), { release: '0.7.0-beta.4' })
  assert.equal(newerRelease(downloads, 'macos', '0.7.0-beta.3'), null)
  assert.equal(newerRelease(downloads, 'linux', '0.7.0-beta.3'), null)
  assert.equal(newerRelease({ windows: { release: 'mañana' } }, 'windows', '0.7.0-beta.3'), null)
  assert.equal(newerRelease(null, 'windows', '0.7.0-beta.3'), null)
})

test('the notice names the release the way people say it', () => {
  assert.equal(releaseLabel('0.7.0-beta.3'), '0.7 beta 3')
  assert.equal(releaseLabel('0.8.0'), '0.8')
  assert.equal(releaseLabel('0.8.1'), '0.8.1')
})

test('the Linux download also gets the notice; other systems do not exist for it', () => {
  assert.deepEqual(['WINNT', 'Darwin', 'Linux', 'Android'].map(platformFor), ['windows', 'macos', 'linux', null])
  assert.deepEqual(newerRelease({ linux: { release: '0.7.0-beta.6' } }, 'linux', '0.7.0-beta.5'), { release: '0.7.0-beta.6' })
})

test('Linux only updates itself from the release package on GitHub, with its SHA256SUMS', () => {
  const url = 'https://github.com/Riscooo/kitsune/releases/download/v0.8.0/Kitsune-0.8.0-Linux-x86_64.tar.xz'
  assert.deepEqual(linuxPackage({ url, release: '0.8.0' }, '0.8.0'), {
    archive: url, name: 'Kitsune-0.8.0-Linux-x86_64.tar.xz',
    sums: 'https://github.com/Riscooo/kitsune/releases/download/v0.8.0/SHA256SUMS.txt',
  })
  // Otra versión, otro repositorio, otra web o un nombre raro: nada.
  assert.equal(linuxPackage({ url, release: '0.8.0' }, '0.8.1'), null)
  assert.equal(linuxPackage({ url: url.replace('Riscooo', 'otro'), release: '0.8.0' }, '0.8.0'), null)
  assert.equal(linuxPackage({ url: 'https://evil.example/Kitsune-0.8.0-Linux-x86_64.tar.xz', release: '0.8.0' }, '0.8.0'), null)
  assert.equal(linuxPackage({ url: url + '?x', release: '0.8.0' }, '0.8.0'), null)
  assert.equal(linuxPackage({ url, release: '0.8.0/../x' }, '0.8.0/../x'), null)
  assert.equal(linuxPackage(null, '0.8.0'), null)
  // En las pruebas, el mismo camino pero en 127.0.0.1.
  const local = 'http://127.0.0.1:4000/v0.9.0/Kitsune-0.9.0-Linux-x86_64.tar.xz'
  assert.equal(linuxPackage({ url: local, release: '0.9.0' }, '0.9.0', 'http://127.0.0.1:4000').sums, 'http://127.0.0.1:4000/v0.9.0/SHA256SUMS.txt')
})

test('the expected SHA-256 is the one listed for exactly that file name', () => {
  const sums = `${'a'.repeat(64)}  Kitsune-0.8.0-Windows-x64.exe\n${'b'.repeat(64)}  Kitsune-0.8.0-Linux-x86_64.tar.xz\n${'c'.repeat(64)} *otro.tar.xz\n`
  assert.equal(expectedSha256(sums, 'Kitsune-0.8.0-Linux-x86_64.tar.xz'), 'b'.repeat(64))
  assert.equal(expectedSha256(sums, 'otro.tar.xz'), 'c'.repeat(64))
  assert.equal(expectedSha256(sums, 'Kitsune-0.8.0-Linux-x86_64.tar'), null)
  assert.equal(expectedSha256('XYZ  Kitsune-0.8.0-Linux-x86_64.tar.xz', 'Kitsune-0.8.0-Linux-x86_64.tar.xz'), null)
  assert.equal(expectedSha256(null, 'x'), null)
  assert.equal(hex('\x00\xff\x10'), '00ff10')
})

test('each system updates from its own package of that release, and nothing else', () => {
  const base = 'https://github.com/Riscooo/kitsune/releases/download/v0.8.0/Kitsune-0.8.0'
  assert.equal(releasePackage('windows', { url: `${base}-Windows-x64.exe`, release: '0.8.0' }, '0.8.0').name, 'Kitsune-0.8.0-Windows-x64.exe')
  assert.equal(releasePackage('macos', { url: `${base}-macOS-AppleSilicon.dmg`, release: '0.8.0' }, '0.8.0').name, 'Kitsune-0.8.0-macOS-AppleSilicon.dmg')
  // El .exe no vale para macOS, ni un sistema que no existe.
  assert.equal(releasePackage('macos', { url: `${base}-Windows-x64.exe`, release: '0.8.0' }, '0.8.0'), null)
  assert.equal(releasePackage('android', { url: `${base}.apk`, release: '0.8.0' }, '0.8.0'), null)
  assert.deepEqual(['WINNT', 'Darwin', 'Linux', 'Android'].map(platformOf), ['windows', 'macos', 'linux', null])
})

test('an Intel Mac looks for its own download and package', () => {
  assert.equal(platformFor('Darwin', 'x86_64-gcc3'), 'macos-intel')
  assert.equal(platformFor('Darwin', 'aarch64-gcc3'), 'macos')
  assert.equal(platformOf('Darwin', 'x86_64-gcc3'), 'macos-intel')
  const url = 'https://github.com/Riscooo/kitsune/releases/download/v0.8.0/Kitsune-0.8.0-macOS-Intel.dmg'
  assert.equal(releasePackage('macos-intel', { url, release: '0.8.0' }, '0.8.0').name, 'Kitsune-0.8.0-macOS-Intel.dmg')
})

test('Kitsune Zero updates from its own part of the downloads list and its own packages, never from Kitsune ones', () => {
  const downloads = { linux: { release: '0.8.0-beta.3', url: 'k' }, zero: { linux: { release: '0.8.0-beta.4', url: 'z' } } }
  assert.deepEqual(productDownloads(downloads, 'zero'), downloads.zero)
  assert.equal(productDownloads(downloads, 'kitsune'), downloads)
  assert.equal(productDownloads({ linux: {} }, 'zero'), null)
  assert.deepEqual(newerRelease(productDownloads(downloads, 'zero'), 'linux', '0.8.0-beta.3'), { release: '0.8.0-beta.4' })
  const base = 'https://github.com/Riscooo/kitsune/releases/download/v0.8.0-beta.3'
  const zero = (platform, file) => releasePackage(platform, { url: `${base}/${file}`, release: '0.8.0-beta.3' }, '0.8.0-beta.3', undefined, 'zero')
  assert.equal(zero('linux', 'Kitsune-Zero-0.8.0-beta.3-Linux-x86_64.tar.xz').name, 'Kitsune-Zero-0.8.0-beta.3-Linux-x86_64.tar.xz')
  assert.equal(zero('windows', 'Kitsune-Zero-0.8.0-beta.3-Windows-x64.exe').name, 'Kitsune-Zero-0.8.0-beta.3-Windows-x64.exe')
  assert.equal(zero('macos', 'Kitsune-Zero-0.8.0-beta.3-macOS-AppleSilicon.dmg').name, 'Kitsune-Zero-0.8.0-beta.3-macOS-AppleSilicon.dmg')
  assert.equal(zero('macos-intel', 'Kitsune-Zero-0.8.0-beta.3-macOS-Intel.dmg').name, 'Kitsune-Zero-0.8.0-beta.3-macOS-Intel.dmg')
  // El paquete de Kitsune no vale para Kitsune Zero (ni al revés).
  assert.equal(zero('linux', 'Kitsune-0.8.0-beta.3-Linux-x86_64.tar.xz'), null)
  assert.equal(releasePackage('linux', { url: `${base}/Kitsune-Zero-0.8.0-beta.3-Linux-x86_64.tar.xz`, release: '0.8.0-beta.3' }, '0.8.0-beta.3'), null)
})

test('a new version shows up right away: soon after opening and every quarter of an hour, not once a day (Risco, 22-10)', () => {
  assert.ok(FIRST_CHECK_MS <= 15 * 1000, FIRST_CHECK_MS)
  assert.ok(CHECK_EVERY_MS <= 15 * 60 * 1000, CHECK_EVERY_MS)
  const minute = 60 * 1000, now = Date.UTC(2026, 9, 22, 18, 0)
  assert.equal(shouldAsk(now, 0), true)
  assert.equal(shouldAsk(now, now - 2 * minute), false)  // varias ventanas o un reinicio seguido: una sola pregunta
  assert.equal(shouldAsk(now, now - 6 * minute), true)
  assert.equal(shouldAsk(now, now + 60 * minute), true)  // el reloj se ha ido hacia atrás
})


test('Windows installs the new version in the same folder once Kitsune has really closed (Risco, 22-10)', () => {
  const script = windowsScript('Kitsune-0.8.0-beta.5-Windows-x64.exe')
  const lines = script.split('\r\n')
  assert.ok(!/[^\x00-\x7f]/.test(script), 'un .cmd se lee en la página de códigos de la consola: solo ASCII')
  assert.ok(!/\n/.test(script.replaceAll('\r\n', '')), 'líneas de Windows')
  const wait = lines.findIndex(line => line.startsWith('tasklist /FI "PID eq %KITSUNE_ACTUALIZAR_PID%" /FI "IMAGENAME eq %KITSUNE_ACTUALIZAR_IMAGEN%"'))
  const install = lines.findIndex(line => line.startsWith('"%~dp0Kitsune-0.8.0-beta.5-Windows-x64.exe" /S '))
  const reopen = lines.findIndex(line => line.startsWith('if "%KITSUNE_ACTUALIZAR_REABRIR%"=="1" start "" "%KITSUNE_ACTUALIZAR_EXE%"'))
  assert.ok(wait > 0 && install > wait && reopen > install, script)
  // Si Kitsune no se cierra en 2 minutos, no se instala nada (el instalador lo dejaría a medias hasta reiniciar).
  assert.ok(lines.slice(0, install).includes('if %vueltas% geq 120 exit /b 1'), script)
  // En su carpeta (y así solo pide permiso de administrador si hace falta), sin volver a poner accesos quitados.
  assert.match(lines[install], / \/InstallDirectoryPath="%KITSUNE_ACTUALIZAR_CARPETA%" /)
  assert.match(lines[install], / \/DesktopShortcut=false \/TaskbarShortcut=false$/)
  for (const bad of ['x.exe" & calc & "', '..\\otro.exe', 'Kitsune.msi', '', null]) assert.equal(windowsScript(bad), null, bad)
})
