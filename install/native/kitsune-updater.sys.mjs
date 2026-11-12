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
 *     - Windows: en cuanto Kitsune se ha cerrado del todo, su instalador en silencio (/S) en la
 *       misma carpeta (actualizar.cmd, ver windowsScript). Si esa carpeta es de administrador
 *       (C:\Program Files, lo normal si al instalar se dijo «Sí» a Windows), no se instala a
 *       escondidas al cerrar: el instalador pediría el permiso desde un proceso oculto, ya sin
 *       ventana, y Windows lo deja parpadeando en la barra de tareas (nadie lo ve y no se instala).
 *       Entonces el permiso se pide con «Instalar y reiniciar», delante y con Kitsune abierto
 *       (actualizar-admin.cmd, ver windowsAdminScript y runElevated).
 * «Reiniciar ahora» cierra Kitsune (con lo que se instala) y lo vuelve a abrir ya nuevo.
 * kitsune.update.auto lo enciende o lo apaga (queda solo el aviso). En Linux y en Windows viene
 * encendido (Risco, 22-10: en el portátil del insti tuvo que bajarse la beta 4 a mano); en macOS,
 * apagado hasta probarlo en un Mac de verdad.
 */
const GITHUB = 'https://github.com/Riscooo/kitsune/releases/download';
const RELEASE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-beta\.\d{1,4})?$/;
const READY = 'listo.json';
// Windows: el instalador corre cuando Kitsune ya se ha cerrado, así que si ha ido bien solo se sabe en la próxima
// apertura. Esta marca dice que se intentó; si entonces sigue la versión vieja, esa versión ya no se intenta sola
// (kitsune.update.failed) y queda el aviso con «Descargar».
const TRIED = 'intentado.json';
const FAILED = 'kitsune.update.failed';
const MINUTE = 60 * 1000;

// El paquete de cada sistema, como lo publica tools/seguir_firefox.py. Kitsune Zero (kitsune.product = "zero", el
// navegador aparte desde la 0.8 beta 3) tiene los suyos, Kitsune-Zero-<versión>-…, y su carpeta en Linux.
const PACKAGES = Object.freeze({
  linux: 'Linux-x86_64.tar.xz', windows: 'Windows-x64.exe', macos: 'macOS-AppleSilicon.dmg', 'macos-intel': 'macOS-Intel.dmg',
});
const PRODUCTS = Object.freeze({
  kitsune: { file: 'Kitsune', folder: 'kitsune', name: 'Kitsune' },
  zero: { file: 'Kitsune-Zero', folder: 'kitsune-zero', name: 'Kitsune Zero' },
});
const productNow = () => { try { return Services.prefs.getStringPref('kitsune.product', 'kitsune') === 'zero' ? 'zero' : 'kitsune'; } catch { return 'kitsune'; } };
export const platformOf = (os, abi = '') => os === 'Darwin' && /^x86_64/.test(abi) ? 'macos-intel'
  : ({ WINNT: 'windows', Darwin: 'macos', Linux: 'linux' })[os] ?? null;

/** El paquete de una versión para un sistema (de Kitsune o de Kitsune Zero) y su lista de SHA-256, si la dirección
 *  es la de esa versión. */
export function releasePackage(platform, entry, release, origin = GITHUB, product = 'kitsune') {
  if (!PACKAGES[platform] || !PRODUCTS[product] || !RELEASE.test(release ?? '') || !entry || typeof entry.url !== 'string' || entry.release !== release) return null;
  const name = `${PRODUCTS[product].file}-${release}-${PACKAGES[platform]}`;
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
/** Dónde se prepara la versión nueva: la caché de cada sistema (Kitsune y Kitsune Zero, cada uno la suya). */
function cacheRoot() {
  const { name, folder } = PRODUCTS[productNow()];
  if (platform().startsWith('macos')) return PathUtils.join(home(), 'Library', 'Caches', name, 'actualizacion');
  if (platform() === 'windows') {
    let local = null;
    try { local = Services.dirsvc.get('LocalAppData', Ci.nsIFile).path; } catch { local = Services.env.get('LOCALAPPDATA'); }
    return PathUtils.join(local || Services.dirsvc.get('TmpD', Ci.nsIFile).path, name, 'actualizacion');
  }
  return PathUtils.join(xdg('XDG_CACHE_HOME', ['.cache']), folder, 'actualizacion');
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
// Windows: «Reiniciar ahora» pidió volver a abrir Kitsune después de instalar.
let reopen = false;
// Windows: la carpeta cuya instalación ya corre con permiso de administrador (actualizar-admin.cmd, pedido delante).
let elevated = null;
// Solo las pruebas cambian la lista de descargas (y solo a 127.0.0.1); entonces vale su carpeta de instalación.
const testing = () => /^http:\/\/127\.0\.0\.1:\d{2,5}\//.test(Services.prefs.getStringPref('kitsune.update.testUrl', ''));

/** ¿Se puede actualizar solo este Kitsune? (el paquete de Linux, una app de macOS o una instalación de Windows) */
async function installed() {
  if (platform() === 'linux') return !!await packagedFolder();
  if (platform().startsWith('macos')) return !!macBundle();
  return platform() === 'windows';
}

/** Windows: ¿hace falta permiso de administrador para escribir en la carpeta de Kitsune? (C:\Program Files…)
 *  Es la misma prueba que hace el instalador de Mozilla antes de pedir el permiso él solo. */
async function needsAdmin() {
  if (platform() !== 'windows') return false;
  const folder = testing() && Services.prefs.getStringPref('kitsune.update.testInstallDir', '') || Services.dirsvc.get('GreBinD', Ci.nsIFile).path;
  const probe = PathUtils.join(folder, `.kitsune-escritura-${Services.appinfo.processID}`);
  try {
    await IOUtils.writeUTF8(probe, '');
    await IOUtils.remove(probe, { ignoreAbsent: true });
    return false;
  } catch {
    return true;
  }
}

/** La carpeta del paquete de Linux en uso, o null si este Kitsune no se instaló con instalar.sh. */
async function packagedFolder() {
  const folder = testing() ? Services.prefs.getStringPref('kitsune.update.testInstallDir', '') : Services.dirsvc.get('GreBinD', Ci.nsIFile).path;
  if (!folder || !await IOUtils.exists(PathUtils.join(folder, 'instalar.sh'))) return null;
  // instalar.sh instala en $XDG_DATA_HOME/kitsune (o kitsune-zero): si este está en otro sitio, no serviría de nada.
  if (!testing() && realPath(folder) !== realPath(PathUtils.join(xdg('XDG_DATA_HOME', ['.local', 'share']), PRODUCTS[productNow()].folder))) return null;
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
 * Windows: la orden (actualizar.cmd) que instala la versión nueva cuando Kitsune se ha cerrado del todo.
 * - El instalador no puede cambiar los archivos de un Kitsune abierto ni de sus procesos: si lo intenta, deja la
 *   instalación a medias hasta reiniciar el equipo. Así que espera a que acabe el proceso de Kitsune y unos segundos
 *   más; si en 2 minutos no se ha cerrado, no instala nada. Lo busca por número y por nombre: el número de un proceso
 *   que acaba se reutiliza (en Wine, enseguida, hasta para el propio tasklist).
 * - Instala en la misma carpeta (/InstallDirectoryPath): así solo pide permiso de administrador si esa carpeta lo
 *   necesita (sin ella, el instalador de Mozilla lo pide siempre). No vuelve a poner los accesos del escritorio ni de
 *   la barra de tareas que hayas quitado.
 * - Con «Reiniciar ahora», después vuelve a abrir Kitsune.
 * - Si la instala actualizar-admin.cmd (carpeta de administrador, KITSUNE_ACTUALIZAR_ADMIN=1), aquí no se instala:
 *   solo se espera a que acabe (su marca hecho.txt) para volver a abrir Kitsune sin permiso de administrador.
 * Las rutas llegan por el entorno (KITSUNE_ACTUALIZAR_*), no escritas aquí: un .cmd se lee en la página de códigos
 * de la consola, y una carpeta con tildes saldría estropeada.
 */
export function windowsScript(file) {
  if (!/^[\w.-]+\.exe$/.test(file ?? '')) return null;
  return [
    '@echo off',
    'set vueltas=0',
    ':espera',
    'ping -n 2 127.0.0.1 >nul',
    'set /a vueltas+=1',
    'if %vueltas% geq 120 exit /b 1',
    'tasklist /FI "PID eq %KITSUNE_ACTUALIZAR_PID%" /FI "IMAGENAME eq %KITSUNE_ACTUALIZAR_IMAGEN%" /NH 2>nul | find " %KITSUNE_ACTUALIZAR_PID% " >nul && goto espera',
    'if "%KITSUNE_ACTUALIZAR_ADMIN%"=="1" goto administrador',
    'ping -n 4 127.0.0.1 >nul',
    `"%~dp0${file}" /S /InstallDirectoryPath="%KITSUNE_ACTUALIZAR_CARPETA%" /DesktopShortcut=false /TaskbarShortcut=false`,
    'goto reabrir',
    ':administrador',
    'set vueltas=0',
    ':instalando',
    'if exist "%~dp0hecho.txt" goto reabrir',
    'ping -n 2 127.0.0.1 >nul',
    'set /a vueltas+=1',
    'if %vueltas% lss 600 goto instalando',
    ':reabrir',
    'if "%KITSUNE_ACTUALIZAR_REABRIR%"=="1" start "" "%KITSUNE_ACTUALIZAR_EXE%"',
    '',
  ].join('\r\n');
}

/**
 * Windows, carpeta de administrador: la orden (actualizar-admin.cmd) que corre ya con permiso de administrador.
 * Un proceso elevado no hereda el entorno de quien lo pide, así que llega todo por argumentos (Unicode, sin pasar por
 * la página de códigos): %1 el número del proceso de Kitsune, %2 su nombre y %3 su carpeta. Espera a que se cierre
 * como actualizar.cmd, instala y deja hecho.txt con el código del instalador. Nunca vuelve a abrir Kitsune: lo
 * abriría como administrador (eso lo hace actualizar.cmd, sin permiso).
 */
export function windowsAdminScript(file) {
  if (!/^[\w.-]+\.exe$/.test(file ?? '')) return null;
  return [
    '@echo off',
    'set vueltas=0',
    ':espera',
    'ping -n 2 127.0.0.1 >nul',
    'set /a vueltas+=1',
    'if %vueltas% geq 120 goto fin',
    'tasklist /FI "PID eq %~1" /FI "IMAGENAME eq %~2" /NH 2>nul | find " %~1 " >nul && goto espera',
    'ping -n 4 127.0.0.1 >nul',
    `"%~dp0${file}" /S /InstallDirectoryPath="%~3" /DesktopShortcut=false /TaskbarShortcut=false`,
    ':fin',
    '>"%~dp0hecho.txt" echo %errorlevel%',
    '',
  ].join('\r\n');
}

/** Windows: la línea con la que cmd.exe corre actualizar-admin.cmd. null si una ruta trae " o % (cmd /c las
 *  rompería): entonces no se instala solo y queda «Descargar». */
export function windowsAdminParameters(script, pid, image, folder) {
  if ([script, image, folder].some(value => typeof value !== 'string' || !value || /["%]/.test(value)) || !/^\d+$/.test(String(pid))) return null;
  return `/c ""${script}" ${pid} "${image}" "${folder}""`;
}

/** Windows: lanza `file` con permiso de administrador (ShellExecuteExW, «runas»). El aviso de Windows sale delante
 *  solo si se le da la ventana que está delante (sin ella, o desde un proceso oculto, Windows lo deja parpadeando en
 *  la barra de tareas). Devuelve false si se dice que no o si algo falla. */
function runElevated(win, file, parameters) {
  const { ctypes } = ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
  const shell32 = ctypes.open('shell32.dll');
  try {
    const text = ctypes.char16_t.ptr;
    const INFO = new ctypes.StructType('SHELLEXECUTEINFOW', [
      { cbSize: ctypes.uint32_t }, { fMask: ctypes.uint32_t }, { hwnd: ctypes.voidptr_t }, { lpVerb: text },
      { lpFile: text }, { lpParameters: text }, { lpDirectory: text }, { nShow: ctypes.int },
      { hInstApp: ctypes.voidptr_t }, { lpIDList: ctypes.voidptr_t }, { lpClass: text }, { hkeyClass: ctypes.voidptr_t },
      { dwHotKey: ctypes.uint32_t }, { hIconOrMonitor: ctypes.voidptr_t }, { hProcess: ctypes.voidptr_t },
    ]);
    const ShellExecuteExW = shell32.declare('ShellExecuteExW', ctypes.winapi_abi, ctypes.int32_t, INFO.ptr);
    const verb = ctypes.char16_t.array()('runas'), target = ctypes.char16_t.array()(file);
    const args = ctypes.char16_t.array()(parameters);
    const info = new INFO();
    info.cbSize = INFO.size;
    info.fMask = 0x100 | 0x400; // SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI
    const handle = win?.docShell?.treeOwner?.QueryInterface(Ci.nsIBaseWindow).nativeHandle;
    info.hwnd = handle ? ctypes.voidptr_t(ctypes.UInt64(BigInt(handle).toString())) : ctypes.voidptr_t(0);
    info.lpVerb = verb.addressOfElement(0);
    info.lpFile = target.addressOfElement(0);
    info.lpParameters = args.addressOfElement(0);
    info.nShow = 0; // SW_HIDE: sin ventana de consola
    return ShellExecuteExW(info.address()) !== 0;
  } catch (error) {
    console.warn('Kitsune: no se ha podido pedir permiso de administrador', error);
    return false;
  } finally {
    shell32.close();
  }
}

/** Windows, carpeta de administrador: pide el permiso ahora (con Kitsune abierto y delante) y deja corriendo
 *  actualizar-admin.cmd, que instala en cuanto Kitsune se cierre. false si no se da el permiso. */
async function launchElevatedInstaller(folder, win) {
  const ready = await IOUtils.readJSON(PathUtils.join(folder, READY));
  const text = windowsAdminScript(ready?.file);
  if (!text) return false;
  const script = PathUtils.join(folder, 'actualizar-admin.cmd');
  await IOUtils.writeUTF8(script, text);
  await IOUtils.remove(PathUtils.join(folder, 'hecho.txt'), { ignoreAbsent: true });
  const dir = name => Services.dirsvc.get(name, Ci.nsIFile).path;
  const parameters = windowsAdminParameters(script, Services.appinfo.processID, PathUtils.filename(dir('XREExeF')), dir('GreBinD'));
  if (!parameters) return false;
  if (!runElevated(win, Services.env.get('ComSpec') || 'C:\\Windows\\System32\\cmd.exe', parameters)) return false;
  elevated = folder;
  return true;
}

/** Windows: lanza actualizar.cmd aparte (nsIProcess, que no muere con Kitsune). En una carpeta de administrador
 *  solo si el permiso ya se dio delante (launchElevatedInstaller): si no, no se lanza nada y la versión queda lista
 *  para «Instalar y reiniciar». */
async function launchWindowsInstaller(folder) {
  const ready = await IOUtils.readJSON(PathUtils.join(folder, READY));
  const text = windowsScript(ready?.file);
  if (!text) return false;
  const admin = elevated === folder;
  if (!admin && await needsAdmin()) return false;
  const script = PathUtils.join(folder, 'actualizar.cmd');
  await IOUtils.writeUTF8(script, text);
  const dir = name => Services.dirsvc.get(name, Ci.nsIFile).path;
  const env = {
    KITSUNE_ACTUALIZAR_PID: String(Services.appinfo.processID),
    KITSUNE_ACTUALIZAR_CARPETA: dir('GreBinD'),
    KITSUNE_ACTUALIZAR_EXE: dir('XREExeF'),
    KITSUNE_ACTUALIZAR_IMAGEN: PathUtils.filename(dir('XREExeF')),
    KITSUNE_ACTUALIZAR_REABRIR: reopen ? '1' : '',
    KITSUNE_ACTUALIZAR_ADMIN: admin ? '1' : '',
  };
  // Al volver a abrirse, con este mismo perfil, como cuando Gecko se reinicia (AppShutdown::MaybeDoRestart).
  if (reopen) Object.assign(env, { XRE_PROFILE_PATH: dir('ProfD'), XRE_PROFILE_LOCAL_PATH: dir('ProfLD') });
  for (const [name, value] of Object.entries(env)) Services.env.set(name, value);
  // Con permiso de administrador ya instala actualizar-admin.cmd; actualizar.cmd solo hace falta para volver a abrir.
  if (!admin || reopen) {
    const cmd = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
    cmd.initWithPath(Services.env.get('ComSpec') || 'C:\\Windows\\System32\\cmd.exe');
    const process = Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess);
    process.init(cmd);
    process.startHidden = true;
    process.runw(false, ['/c', script]);
  }
  // De «listo» a «intentado»: la próxima apertura mira si se instaló (resume).
  await IOUtils.writeJSON(PathUtils.join(folder, TRIED), { ...ready, at: new Date().toISOString() });
  await IOUtils.remove(PathUtils.join(folder, READY), { ignoreAbsent: true });
  return true;
}

export const KitsuneUpdater = {
  /** ¿Puede este Kitsune actualizarse solo? */
  async available() {
    return !!platform() && Services.prefs.getBoolPref('kitsune.update.auto', ['linux', 'windows'].includes(platform())) && await installed();
  },

  /** Descarga, comprueba y deja lista la versión; la instala al cerrar. Devuelve su carpeta o lanza. */
  async stage({ release, entry, origin = GITHUB }) {
    const found = releasePackage(platform(), entry, release, origin, productNow());
    if (!found) throw new Error('La dirección del paquete no es la de esa versión de Kitsune.');
    if (Services.prefs.getStringPref(FAILED, '') === release) throw new Error('Esta versión no se pudo instalar sola; queda «Descargar».');
    const folder = PathUtils.join(cacheRoot(), release);
    // Windows: el instalador de esta versión puede estar aún trabajando (se volvió a abrir Kitsune enseguida).
    if (await IOUtils.exists(PathUtils.join(folder, TRIED))) throw new Error('Esta versión ya se está instalando.');
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
          if (!await IOUtils.exists(PathUtils.join(folder, PRODUCTS[productNow()].folder, name))) throw new Error('Al paquete le falta ' + name + '.');
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
      let ready = null, tried = null;
      try { ready = await IOUtils.readJSON(PathUtils.join(folder, READY)); } catch { /* a medias */ }
      try { tried = await IOUtils.readJSON(PathUtils.join(folder, TRIED)); } catch { /* no se intentó */ }
      if (ready?.release === release && newer(release, installed) === 1 && !found) {
        found = release;
        this.installAtQuit(folder);
      } else if (tried?.release === release && newer(release, installed) === 1 && Date.now() - Date.parse(tried.at) < 10 * MINUTE) {
        // Windows: se intentó hace nada; puede que el instalador siga trabajando. Se mira en la próxima apertura.
      } else {
        // Windows: se intentó y sigue la versión vieja (falló el instalador, o Kitsune no llegó a cerrarse). Sin el
        // permiso de administrador ya no se llega aquí: entonces no se intenta (queda lista, ver launchWindowsInstaller).
        if (tried?.release === release && newer(release, installed) === 1) Services.prefs.setStringPref(FAILED, release);
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
      if (platform() === 'linux') done = await run('/bin/sh', [PathUtils.join(folder, PRODUCTS[productNow()].folder, 'instalar.sh')], 2 * MINUTE) === 0;
      else if (platform().startsWith('macos')) done = await installMac(folder);
      else if (platform() === 'windows') return launchWindowsInstaller(folder);
      if (done) await IOUtils.remove(folder, { recursive: true, ignoreAbsent: true });
      return done;
    } catch {
      return false;
    }
  },

  /** Windows: ¿instalarla pide permiso de administrador? (Kitsune en C:\Program Files) */
  needsAdmin,

  /** «Reiniciar ahora» («Instalar y reiniciar»): se cierra como siempre (preguntando si hay descargas, etc.) y vuelve
   *  a abrir. `win`, la ventana del aviso: en Windows, el permiso de administrador se pide delante de ella. */
  async restart(win) {
    const cancel = Cc['@mozilla.org/supports-PRBool;1'].createInstance(Ci.nsISupportsPRBool);
    Services.obs.notifyObservers(cancel, 'quit-application-requested', 'restart');
    if (cancel.data) return;
    if (platform() !== 'windows' || !installing) {
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
      return;
    }
    // Windows en C:\Program Files: el permiso, ahora y delante; si se dice que no, Kitsune sigue abierto como estaba.
    if (elevated !== installing && await needsAdmin() && !await launchElevatedInstaller(installing, win)) return;
    // Windows: Gecko volvería a abrir el Kitsune viejo antes de que el instalador pudiera cambiarlo. Se cierra sin
    // más y lo vuelve a abrir actualizar.cmd, ya nuevo y con las pestañas de ahora, como tras un reinicio.
    const SESSION = 'browser.sessionstore.resume_session_once';
    const resumed = Services.prefs.getBoolPref(SESSION, false);
    reopen = true;
    Services.prefs.setBoolPref(SESSION, true);
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    if (Services.startup.shuttingDown) return;
    reopen = false;
    if (!resumed) Services.prefs.clearUserPref(SESSION);
  },
};
