/* Kitsune se actualiza solo en el paquete de Linux.
 *
 * Cuando kitsune-updates.sys.mjs ve una versión más nueva y este Kitsune es el paquete de
 * Linux (el de instalar.sh, en ~/.local/share/kitsune), aquí se prepara la nueva:
 *  1. se descargan el .tar.xz de esa versión y su SHA256SUMS.txt, solo de las versiones de
 *     Riscooo/kitsune en GitHub;
 *  2. el .tar.xz tiene que dar el SHA-256 de esa lista; si no, se borra y queda el aviso de
 *     siempre, con «Descargar»;
 *  3. se descomprime en ~/.cache/kitsune/actualizacion/<versión> y se marca como lista;
 *  4. al cerrar Kitsune se ejecuta su instalar.sh, que cambia la carpeta de golpe y guarda la
 *     anterior en kitsune.anterior. Así un Kitsune abierto nunca mezcla dos versiones.
 * «Reiniciar ahora» cierra Kitsune (con lo que se instala) y lo vuelve a abrir ya nuevo.
 * Se apaga con kitsune.update.auto = false (queda solo el aviso). En Windows y macOS no hace
 * nada todavía: hay que probarlo antes en un equipo de verdad.
 */
const GITHUB = 'https://github.com/Riscooo/kitsune/releases/download';
const RELEASE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-beta\.\d{1,4})?$/;
const READY = 'listo.json';
const MINUTE = 60 * 1000;

/** El paquete de Linux de una versión y su lista de SHA-256, si la dirección es la de esa versión. */
export function linuxPackage(entry, release, origin = GITHUB) {
  if (!RELEASE.test(release ?? '') || !entry || typeof entry.url !== 'string' || entry.release !== release) return null;
  const name = `Kitsune-${release}-Linux-x86_64.tar.xz`;
  const folder = `${origin}/v${release}/`;
  return entry.url === folder + name ? { archive: folder + name, sums: `${folder}SHA256SUMS.txt`, name } : null;
}

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
const cacheRoot = () => PathUtils.join(xdg('XDG_CACHE_HOME', ['.cache']), 'kitsune', 'actualizacion');
const realPath = path => {
  const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  file.initWithPath(path);
  try { file.normalize(); } catch { /* no existe */ }
  return file.path;
};
let installing = null;
// Solo las pruebas cambian la lista de descargas (y solo a 127.0.0.1); entonces vale su carpeta de instalación.
const testing = () => /^http:\/\/127\.0\.0\.1:\d{2,5}\//.test(Services.prefs.getStringPref('kitsune.update.testUrl', ''));

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

export const KitsuneUpdater = {
  /** ¿Puede este Kitsune actualizarse solo? */
  async available() {
    return Services.appinfo.OS === 'Linux' && Services.prefs.getBoolPref('kitsune.update.auto', true) && !!await packagedFolder();
  },

  /** Descarga, comprueba y deja lista la versión; la instala al cerrar. Devuelve su carpeta o lanza. */
  async stage({ release, entry, origin = GITHUB }) {
    const found = linuxPackage(entry, release, origin);
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
      if (!expected) throw new Error('La versión no trae el SHA-256 de su paquete de Linux.');
      const archive = PathUtils.join(folder, found.name);
      await modules().Downloads.fetch(found.archive, archive);
      if (await sha256File(archive) !== expected) throw new Error('El paquete descargado no coincide con su SHA-256.');
      const tar = await modules().Subprocess.pathSearch('tar');
      if (await run(tar, ['-xJf', archive, '-C', folder, '--no-same-owner'], 5 * MINUTE) !== 0) throw new Error('No se ha podido descomprimir el paquete.');
      await IOUtils.remove(archive);
      for (const name of ['instalar.sh', 'kitsune']) {
        if (!await IOUtils.exists(PathUtils.join(folder, 'kitsune', name))) throw new Error('Al paquete le falta ' + name + '.');
      }
      await IOUtils.writeJSON(ready, { release, sha256: expected, at: new Date().toISOString() });
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

  /** Lo que se hace al cerrar: su instalar.sh y, si ha ido bien, fuera la copia preparada. */
  async install(folder) {
    try {
      const exitCode = await run('/bin/sh', [PathUtils.join(folder, 'kitsune', 'instalar.sh')], 2 * MINUTE);
      if (exitCode === 0) await IOUtils.remove(folder, { recursive: true, ignoreAbsent: true });
      return exitCode === 0;
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
