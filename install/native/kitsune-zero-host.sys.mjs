/* Kitsune como anfitrión de Kitsune Zero (zero/, en chrome://browser/content/zero/).
 *
 * Zero no conoce a Kitsune: este módulo le da lo que necesita, que es lo único que cambiaría si
 * Zero saliera como navegador aparte. Le pasa los textos en el idioma de Kitsune, los ajustes
 * (con el prefijo kitsune.zero.) y los atajos (en su propio <keyset>, como los de kitsune-layout).
 */
// Textos en el idioma de Kitsune (kitsune-i18n.sys.mjs); sin Gecko, en castellano.
const t = (spanish, english) => {
  try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-i18n.sys.mjs').t(spanish, english); } catch { return spanish; }
};
const ZERO = 'chrome://browser/content/zero/zero.sys.mjs';
let started = false;

/** Un atajo de Zero en su keyset. Gecko lee un <keyset> solo al conectarlo: se vuelve a conectar. */
function addKey(win, id, key, modifiers, run) {
  const doc = win.document;
  if (doc.getElementById(id)) return;
  const keyset = doc.getElementById('kitsune-zero-keys') ?? Object.assign(doc.createXULElement('keyset'), { id: 'kitsune-zero-keys' });
  const node = doc.createXULElement('key');
  node.id = id;
  node.setAttribute('key', key);
  node.setAttribute('modifiers', modifiers);
  node.addEventListener('command', run);
  keyset.remove();
  keyset.append(node);
  doc.documentElement.append(keyset);
}

const host = () => ({ t, prefs: Services.prefs, prefix: 'kitsune.zero.', keys: { add: addKey } });

export const KitsuneZeroHost = {
  decorate(win) {
    const { Zero } = ChromeUtils.importESModule(ZERO);
    if (!started) { Zero.start(host()); started = true; }
    return Zero.decorate(win);
  },
};
