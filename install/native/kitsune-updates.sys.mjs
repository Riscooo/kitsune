/* Aviso de versión nueva de Kitsune (Windows, macOS y el paquete de Linux).
 *
 * Al poco de abrirse y cada cuarto de hora mientras está abierto (Risco, 22-10: «tiene que aparecer al toque, no en x
 * tiempo») se mira la lista de descargas de la web de Kitsune (sin cookies ni identificadores) y, si hay una versión
 * más nueva para este sistema, se dice en una barra.
 * kitsune-updater.sys.mjs la descarga, la comprueba y la deja lista para instalarse al cerrar
 * («Reiniciar ahora»): en Linux y Windows de serie y en macOS con kitsune.update.auto (hasta
 * probarlo allí). Si no, o si falla, la barra lleva a la descarga. Se apaga con kitsune.update.check = false. Solo actúa si el motor trae
 * kitsune.release (lo ponen los paquetes que se descargan); en el Linux de Risco el motor se
 * compila y actualiza solo, sin kitsune.release, y aquí no hace nada.
 */
// Textos en el idioma de Kitsune (kitsune-i18n.sys.mjs); sin Gecko (pruebas de Node), en castellano.
const t = (spanish, english) => {
  try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-i18n.sys.mjs').t(spanish, english); } catch { return spanish; }
};
const DOWNLOADS = 'https://kitsune-navegador.vercel.app/downloads.json';
const PAGE = 'https://kitsune-navegador.vercel.app/#descargar';
/** La primera mirada, al poco de abrirse; luego, cada cuarto de hora. */
export const FIRST_CHECK_MS = 10 * 1000;
export const CHECK_EVERY_MS = 15 * 60 * 1000;
/** Entre dos miradas, al menos este rato: con varias ventanas o un reinicio seguido se pregunta una vez. */
const MIN_GAP_MS = 5 * 60 * 1000;

/** ¿Toca preguntar a la web? Sí si pasó el rato mínimo desde la última vez, o si el reloj fue hacia atrás. */
export const shouldAsk = (now, last) => now < last || now - last >= MIN_GAP_MS;
const RELEASE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-beta\.(\d{1,4}))?$/;

/** Orden de versiones: 0.7.0-beta.2 < 0.7.0-beta.3 < 0.7.0 < 0.8.0-beta.1. null si no se entiende. */
export function compareReleases(a, b) {
  const left = RELEASE.exec(a ?? ''), right = RELEASE.exec(b ?? '');
  if (!left || !right) return null;
  for (let index = 1; index <= 3; index++) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference) return Math.sign(difference);
  }
  // Una versión final va después de todas sus betas.
  const beta = value => value === undefined ? Infinity : Number(value);
  return Math.sign(beta(left[4]) - beta(right[4])) || 0;
}

/** La parte de downloads.json de un producto: la de Kitsune es la lista misma; la de Kitsune Zero, su clave «zero». */
export function productDownloads(downloads, product) {
  if (!downloads || typeof downloads !== 'object') return null;
  if (product !== 'zero') return downloads;
  return downloads.zero && typeof downloads.zero === 'object' ? downloads.zero : null;
}
const product = () => { try { return Services.prefs.getStringPref('kitsune.product', 'kitsune') === 'zero' ? 'zero' : 'kitsune'; } catch { return 'kitsune'; } };
const productName = () => product() === 'zero' ? 'Kitsune Zero' : 'Kitsune';

/** La versión publicada para este sistema en downloads.json, si es más nueva que la instalada. */
export function newerRelease(downloads, platform, installed) {
  const entry = downloads && typeof downloads === 'object' ? downloads[platform] : null;
  if (!entry || typeof entry !== 'object' || typeof entry.release !== 'string') return null;
  const order = compareReleases(entry.release, installed);
  return order === 1 ? { release: entry.release } : null;
}

/** «0.7.0-beta.3» → «0.7 beta 3»; «0.8.0» → «0.8». */
export function releaseLabel(release) {
  const match = RELEASE.exec(release ?? '');
  if (!match) return release;
  const version = match[3] === '0' ? `${match[1]}.${match[2]}` : `${match[1]}.${match[2]}.${match[3]}`;
  return match[4] ? `${version} beta ${match[4]}` : version;
}

let pending = null, started = false;
// El actualizador de Linux, junto a este archivo (en el motor, chrome://browser/content/; en las
// pruebas, donde se cargue); con un motor que no lo trae, o en las pruebas de Node, null.
const updater = () => {
  try { return ChromeUtils.importESModule(new URL('kitsune-updater.sys.mjs', import.meta.url).href).KitsuneUpdater; } catch { return null; }
};
/** El sistema en downloads.json: windows, macos o linux. */
/** El sistema en downloads.json: windows, macos (Apple Silicon), macos-intel o linux. */
export const platformFor = (os, abi = '') => os === 'Darwin' && /^x86_64/.test(abi) ? 'macos-intel'
  : ({ WINNT: 'windows', Darwin: 'macos', Linux: 'linux' })[os] ?? null;
const platformKey = () => platformFor(Services.appinfo.OS, Services.appinfo.XPCOMABI);

export async function showUpdateNotice(win, info) {
  const box = win.gNotificationBox;
  if (!box || box.getNotificationWithValue('kitsune-update')) return;
  if (info.ready) {
    await box.appendNotification('kitsune-update', {
      label: t(`${productName()} ${releaseLabel(info.release)} está listo: se instala al cerrar ${productName()}.`,
               `${productName()} ${releaseLabel(info.release)} is ready: it installs when you close ${productName()}.`),
      priority: box.PRIORITY_INFO_MEDIUM,
    }, [{
      label: t('Reiniciar ahora', 'Restart now'),
      accessKey: 'R',
      callback: () => { updater()?.restart(); },
    }]);
    return;
  }
  await box.appendNotification('kitsune-update', {
    label: t(`Hay una versión nueva de ${productName()}: ${releaseLabel(info.release)}.`, `There is a new version of ${productName()}: ${releaseLabel(info.release)}.`),
    priority: box.PRIORITY_INFO_MEDIUM,
  }, [{
    label: t('Descargar', 'Download'),
    accessKey: 'D',
    callback: () => { win.openTrustedLinkIn(PAGE, 'tab'); },
  }]);
}

export const KitsuneUpdates = {
  /** Una vez por sesión: programa la comprobación diaria. */
  start() {
    if (started) return;
    started = true;
    const installed = Services.prefs.getStringPref('kitsune.release', '');
    if (!installed || !Services.prefs.getBoolPref('kitsune.update.check', true) || !platformKey()) return;
    const { setTimeout, setInterval } = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
    setTimeout(() => void this.check().catch(() => {}), FIRST_CHECK_MS);
    setInterval(() => void this.check().catch(() => {}), CHECK_EVERY_MS);
    // Una versión que se preparó en otra sesión y no llegó a instalarse (Kitsune no se cerró bien).
    void this.resume().catch(() => {});
  },
  async resume() {
    const installed = Services.prefs.getStringPref('kitsune.release', '');
    if (!installed || !await updater()?.available()) return null;
    const release = await updater().resume(installed, compareReleases);
    if (release && !pending) {
      pending = { release, ready: true };
      for (const win of Services.wm.getEnumerator('navigator:browser')) await showUpdateNotice(win, pending);
    }
    return release;
  },
  /** Mira la web (como mucho cada pocos minutos) y avisa en las ventanas abiertas. */
  async check(now = Date.now()) {
    const installed = Services.prefs.getStringPref('kitsune.release', '');
    // Solo los tests cambian la dirección (y solo a 127.0.0.1) y, con ella, el sistema.
    const override = Services.prefs.getStringPref('kitsune.update.testUrl', '');
    const testing = /^http:\/\/127\.0\.0\.1:\d{2,5}\/[\w./-]*$/.test(override);
    const platform = platformKey() ?? (testing ? Services.prefs.getStringPref('kitsune.update.testPlatform', '') || null : null);
    if (!installed || !platform || !Services.prefs.getBoolPref('kitsune.update.check', true)) return null;
    const last = Number(Services.prefs.getStringPref('kitsune.update.lastCheck', '0'));
    if (!shouldAsk(now, last)) return pending;
    Services.prefs.setStringPref('kitsune.update.lastCheck', String(now));
    const url = testing ? override : DOWNLOADS;
    // AbortSignal.timeout necesita una ventana; aquí, un temporizador normal.
    const { setTimeout, clearTimeout } = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let downloads;
    try {
      const response = await fetch(url, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!response.ok) return null;
      downloads = await response.json();
    } finally { clearTimeout(timer); }
    const list = productDownloads(downloads, product());
    const found = newerRelease(list, platform, installed);
    // La misma versión que ya se avisó (y se preparó, si se pudo): ni se vuelve a bajar ni se avisa otra vez.
    if (found && pending?.release === found.release) return pending;
    pending = found;
    if (pending && await updater()?.available()) {
      try {
        await updater().stage({ release: pending.release, entry: list[platform], ...(testing ? { origin: new URL(override).origin } : {}) });
        pending = { ...pending, ready: true };
      } catch (error) {
        console.warn('Kitsune: no se ha podido preparar la versión nueva', error);
      }
    }
    if (pending) for (const win of Services.wm.getEnumerator('navigator:browser')) await showUpdateNotice(win, pending);
    return pending;
  },
  /** Cada ventana nueva: si ya se sabe que hay una versión nueva, también lo dice. */
  decorate(win) {
    if (pending) void showUpdateNotice(win, pending).catch(() => {});
  },
};
