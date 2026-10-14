/* Kitsune se actualiza solo: descarga la versión nueva, la comprueba y la instala al cerrar.
 *
 * Cuando kitsune-updates.sys.mjs ve una versión más nueva, aquí se prepara:
 *  1. se descargan su paquete y su SHA256SUMS.txt, solo de las versiones de Riscooo/kitsune
 *     en GitHub;
 *  2. el paquete tiene que dar el SHA-256 de esa lista; si no, se borra y queda el aviso de
 *     siempre, con «Descargar»;
 *  3. se deja en la carpeta de caché (en Linux, ya descomprimido) y se marca como listo;
 *  4. al cerrar Kitsune se instala, así un Kitsune abierto nunca mezcla dos versiones:
 *     - Linux (el paquete de instalar.sh, en ~/.local/share/kitsune): su instalar.sh, que
 *       cambia la carpeta de golpe y guarda la anterior en kitsune.anterior;
 *     - macOS: se monta el .dmg, se copia la app al lado de la tuya, se le quita la cuarentena
 *       (la nueva viene del mismo sitio que la que ya abriste) y se cambia de golpe;
 *     - Windows: unos segundos después de cerrar, su instalador en silencio (/S).
 * «Reiniciar ahora» cierra Kitsune (con lo que se instala) y lo vuelve a abrir ya nuevo.
 * kitsune.update.auto lo enciende o lo apaga (queda solo el aviso). En Linux viene encendido;
 * en Windows y macOS, apagado hasta probarlo en equipos de verdad.
 */
const GITHUB = 'https://github.com/Riscooo/kitsune/releases/download';
const RELEASE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-beta\.\d{1,4})?$/;
const READY = 'listo.json';
const MINUTE = 60 * 1000;

// El paquete de cada sistema, como lo publica tools/seguir_firefox.py.
const PACKAGES = Object.freeze({
  linux: release => `Kitsune-${release}-Linux-x86_64.tar.xz`,
  windows: release => `Kitsune-${release}-Windows-x64.exe`,
  macos: release => `Kitsune-${release}-macOS-AppleSilicon.dmg`,
  'macos-intel': release => `Kitsune-${release}-macOS-Intel.dmg`,
});
export const platformOf = (os, abi = '') => os === 'Darwin' && /^x86_64/.test(abi) ? 'macos-intel'
  : ({ WINNT: 'windows', Darwin: 'macos', Linux: 'linux' })[os] ?? null;

/** El paquete de una versión para un sistema y su lista de SHA-256, si la dirección es la de esa versión. */
export function releasePackage(platform, entry, release, origin = GITHUB) {
  if (!PACKAGES[platform] || !RELEASE.test(release ?? '') || !entry || typeof entry.url !== 'string' || entry.release !== release) return null;
  const name = PACKAGES[platform](release);
  const folder = `${origin}/v${release}/`;
  return entry.url === folder + name ? { archive: folder + name, sums: `${folder}SHA256SUMS.txt`, name } : null;
}
export const linuxPackage = (entry, release, origin = GITHUB) => releasePackage('linux', entry, release, origin);

/** El SHA-256 de `name` en un SHA256SUMS.txt («<64 cifras hex>  <nombre>»), o null. */
export function expectedSha256(text, name) {
  for (const line of String(text ?? '').split('\n')) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trimEnd());
    if (match && match[2] === name) return match[1];
  }
  return null;
}

/** Los bytes de nsICryptoHash.finish(false) en hexadecimal. */
export const hex = binary => Array.from(binary, character => character.charCodeAt(0).toString(16).padStart(2, '0')).join('');

let lazy = null;
const modules = () => lazy ??= {
  ...ChromeUtils.importESModule('resource://gre/modules/AsyncShutdown.sys.mjs'),
  ...ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs'),
  ...ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs'),
  ...ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs'),
};
const home = () => Services.dirsvc.get('Home', Ci.nsIFile).path;
const xdg = (name, fallback) => Services.env.get(name) || PathUtils.join(home(), ...fallback);
const platform = () => platformOf(Services.appinfo.OS, Services.appinfo.XPCOMABI);
/** Dónde se prepara la versión nueva: la caché de cada sistema. */
function cacheRoot() {
  if (platform().startsWith('macos')) return PathUtils.join(home(), 'Library', 'Caches', 'Kitsune', 'actualizacion');
  if (platform() === 'windows') {
    let local = null;
    try { local = Services.dirsvc.get('LocalAppData', Ci.nsIFile).path; } catch { local = Services.env.get('LOCALAPPDATA'); }
    return PathUtils.join(local || Services.dirsvc.get('TmpD', Ci.nsIFile).path, 'Kitsune', 'actualizacion');
  }
  return PathUtils.join(xdg('XDG_CACHE_HOME', ['.cache']), 'kitsune', 'actualizacion');
}
/** La app de macOS en uso (…/Kitsune.app), o null. */
function macBundle() {
  const bundle = PathUtils.parent(PathUtils.parent(Services.dirsvc.get('GreBinD', Ci.nsIFile).path));
  return bundle?.endsWith('.app') ? bundle : null;
}
const realPath = path => {
  const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  file.initWithPath(path);
  try { file.normalize(); } catch { /* no existe */ }
  return file.path;
};
let installing = null;
// Solo las pruebas cambian la lista de descargas (y solo a 127.0.0.1); entonces vale su carpeta de instalación.
const testing = () => /^http:\/\/127\.0\.0\.1:\d{2,5}\//.test(Services.prefs.getStringPref('kitsune.update.testUrl', ''));

/** ¿Se puede actualizar solo este Kitsune? (el paquete de Linux, una app de macOS o una instalación de Windows) */
async function installed() {
  if (platform() === 'linux') return !!await packagedFolder();
  if (platform().startsWith('macos')) return !!macBundle();
  return platform() === 'windows';
}

/** La carpeta del paquete de Linux en uso, o null si este Kitsune no se instaló con instalar.sh. */
async function packagedFolder() {
  const folder = testing() ? Services.prefs.getStringPref('kitsune.update.testInstallDir', '') : Services.dirsvc.get('GreBinD', Ci.nsIFile).path;
  if (!folder || !await IOUtils.exists(PathUtils.join(folder, 'instalar.sh'))) return null;
  // instalar.sh instala en $XDG_DATA_HOME/kitsune: si este Kitsune está en otro sitio, no serviría de nada.
  if (!testing() && realPath(folder) !== realPath(PathUtils.join(xdg('XDG_DATA_HOME', ['.local', 'share']), 'kitsune'))) return null;
  return folder;
}

/** SHA-256 de un archivo, a trozos para no parar la ventana con un paquete de 90 MB. */
async function sha256File(path) {
  const hasher = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
  hasher.init(Ci.nsICryptoHash.SHA256);
  const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  file.initWithPath(path);
  const stream = Cc['@mozilla.org/network/file-input-stream;1'].createInstance(Ci.nsIFileInputStream);
  stream.init(file, -1, -1, 0);
  try {
    for (let left = stream.available(); left > 0; left = stream.available()) {
      hasher.updateFromStream(stream, Math.min(left, 4 * 1024 * 1024));
      await new Promise(resolve => Services.tm.dispatchToMainThread(resolve));
    }
  } finally { stream.close(); }
  return hex(hasher.finish(false));
}

/** Ejecuta una orden, leyendo lo que escriba (si nadie lo lee, se queda esperando), con tiempo máximo. */
async function run(command, args, timeoutMs) {
  const { Subprocess, setTimeout, clearTimeout } = modules();
  const process = await Subprocess.call({ command, arguments: args, stderr: 'stdout' });
  const timer = setTimeout(() => process.kill(), timeoutMs);
  try {
    while (await process.stdout.readString()) { /* se descarta */ }
    return (await process.wait()).exitCode;
  } finally { clearTimeout(timer); }
}

/** macOS: la app del .dmg pasa a ser la tuya, de golpe (la anterior se borra al final). */
async function installMac(folder) {
  const app = macBundle();
  const { file } = await IOUtils.readJSON(PathUtils.join(folder, READY));
  if (!app || typeof file !== 'string') return false;
  const mount = PathUtils.join(folder, 'disco');
  await IOUtils.makeDirectory(mount, { ignoreExisting: true });
  if (await run('/usr/bin/hdiutil', ['attach', PathUtils.join(folder, file), '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount], 2 * MINUTE) !== 0) return false;
  try {
    const source = (await IOUtils.getChildren(mount)).find(path => path.endsWith('.app'));
    if (!source) return false;
    const fresh = `${app}.nuevo`, previous = `${app}.anterior`;
    await IOUtils.remove(fresh, { recursive: true, ignoreAbsent: true });
    await IOUtils.remove(previous, { recursive: true, ignoreAbsent: true });
    if (await run('/usr/bin/ditto', [source, fresh], 5 * MINUTE) !== 0) return false;
    // Sin cuarentena: si no, macOS volvería a pedir «Abrir igualmente» con cada versión.
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', fresh], MINUTE);
    await IOUtils.move(app, previous);
    await IOUtils.move(fresh, app);
    await IOUtils.remove(previous, { recursive: true, ignoreAbsent: true });
    return true;
  } finally {
    await run('/usr/bin/hdiutil', ['detach', mount, '-quiet'], MINUTE);
  }
}

/**
 * Windows: el instalador no puede cambiar los archivos de un Kitsune abierto, así que se lanza
 * aparte (nsIProcess, que no muere con Kitsune) y espera unos segundos a que acabe de cerrarse.
 * Si Windows pide permiso de administrador, lo pide entonces.
 */
async function launchWindowsInstaller(folder) {
  const { file } = await IOUtils.readJSON(PathUtils.join(folder, READY));
  if (typeof file !== 'string') return false;
  const script = PathUtils.join(folder, 'actualizar.cmd');
  await IOUtils.writeUTF8(script, `@echo off\r\nping -n 6 127.0.0.1 >nul\r\n"%~dp0${file}" /S\r\n`);
  const cmd = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  cmd.initWithPath(Services.env.get('ComSpec') || 'C:\\Windows\\System32\\cmd.exe');
  const process = Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess);
  process.init(cmd);
  process.startHidden = true;
  process.runw(false, ['/c', script]);
  // La marca se quita: si la instalación falla, la próxima apertura vuelve a preparar la versión.
  await IOUtils.remove(PathUtils.join(folder, READY), { ignoreAbsent: true });
  return true;
}

export const KitsuneUpdater = {
  /** ¿Puede este Kitsune actualizarse solo? */
  async available() {
    return !!platform() && Services.prefs.getBoolPref('kitsune.update.auto', platform() === 'linux') && await installed();
  },

  /** Descarga, comprueba y deja lista la versión; la instala al cerrar. Devuelve su carpeta o lanza. */
  async stage({ release, entry, origin = GITHUB }) {
    const found = releasePackage(platform(), entry, release, origin);
    if (!found) throw new Error('La dirección del paquete no es la de esa versión de Kitsune.');
    const folder = PathUtils.join(cacheRoot(), release);
    const ready = PathUtils.join(folder, READY);
    if (await IOUtils.exists(ready) && (await IOUtils.readJSON(ready))?.release === release) {
      this.installAtQuit(folder);
      return folder;
    }
    await IOUtils.remove(folder, { recursive: true, ignoreAbsent: true });
    await IOUtils.makeDirectory(folder, { createAncestors: true, permissions: 0o700 });
    try {
      const response = await fetch(found.sums, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
      const expected = response.ok ? expectedSha256(await response.text(), found.name) : null;
      if (!expected) throw new Error('La versión no trae el SHA-256 de su paquete.');
      const archive = PathUtils.join(folder, found.name);
      await modules().Downloads.fetch(found.archive, archive);
      if (await sha256File(archive) !== expected) throw new Error('El paquete descargado no coincide con su SHA-256.');
      if (platform() === 'linux') {
        const tar = await modules().Subprocess.pathSearch('tar');
        if (await run(tar, ['-xJf', archive, '-C', folder, '--no-same-owner'], 5 * MINUTE) !== 0) throw new Error('No se ha podido descomprimir el paquete.');
        await IOUtils.remove(archive);
        for (const name of ['instalar.sh', 'kitsune']) {
          if (!await IOUtils.exists(PathUtils.join(folder, 'kitsune', name))) throw new Error('Al paquete le falta ' + name + '.');
        }
      }
      await IOUtils.writeJSON(ready, { release, sha256: expected, file: found.name, at: new Date().toISOString() });
    } catch (error) {
      await IOUtils.remove(folder, { recursive: true, ignoreAbsent: true });
      throw error;
    }
    this.installAtQuit(folder);
    return folder;
  },

  /** Una versión ya preparada en otra sesión (más nueva que la instalada): se instala al cerrar. */
  async resume(installed, newer) {
    const root = cacheRoot();
    if (!await IOUtils.exists(root)) return null;
    let found = null;
    for (const folder of await IOUtils.getChildren(root)) {
      const release = PathUtils.filename(folder);
      let ready = null;
      try { ready = await IOUtils.readJSON(PathUtils.join(folder, READY)); } catch { /* a medias */ }
      if (ready?.release === release && newer(release, installed) === 1 && !found) {
        found = release;
        this.installAtQuit(folder);
      } else {
        // Ya instalada, más vieja o a medias: sobra.
        await IOUtils.remove(folder, { recursive: true, ignoreAbsent: true });
      }
    }
    return found;
  },

  installAtQuit(folder) {
    if (installing) return;
    installing = folder;
    modules().AsyncShutdown.appShutdownConfirmed.addBlocker('Kitsune: instalar la versión nueva', () => this.install(folder));
  },

  /** Lo que se hace al cerrar. Si ha ido bien, fuera lo preparado (en Windows, en la próxima apertura). */
  async install(folder) {
    try {
      let done = false;
      if (platform() === 'linux') done = await run('/bin/sh', [PathUtils.join(folder, 'kitsune', 'instalar.sh')], 2 * MINUTE) === 0;
      else if (platform().startsWith('macos')) done = await installMac(folder);
      else if (platform() === 'windows') return launchWindowsInstaller(folder);
      if (done) await IOUtils.remove(folder, { recursive: true, ignoreAbsent: true });
      return done;
    } catch {
      return false;
    }
  },

  /** «Reiniciar ahora»: se cierra como siempre (preguntando si hay descargas, etc.) y vuelve a abrir. */
  restart() {
    const cancel = Cc['@mozilla.org/supports-PRBool;1'].createInstance(Ci.nsISupportsPRBool);
    Services.obs.notifyObservers(cancel, 'quit-application-requested', 'restart');
    if (!cancel.data) Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
  },
};
