/* Kitsune como anfitrión de Kitsune Zero (zero/, en chrome://browser/content/zero/).
 *
 * Zero no conoce a Kitsune: este módulo le da lo que necesita, que es lo único que cambiaría si
 * Zero saliera como navegador aparte. Le pasa los textos en el idioma de Kitsune, los ajustes
 * (con el prefijo kitsune.zero.), los atajos (en su propio <keyset>, como los de kitsune-layout),
 * los espacios (para el raíl) y si está el modo ahorro (para el cristal en vivo).
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

// Los espacios de Kitsune, para el raíl de Zero: la lista, el de la ventana, cambiar y enterarse de
// los cambios. Los espacios no avisan; al cambiar repintan sus tiras (.kitsune-spaces) y marcan la
// raíz, y eso es lo que se vigila.
const spacesModule = () => {
  try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs').KitsuneSpaces; } catch { return null; }
};
const spaces = {
  list: () => (spacesModule()?.list().spaces ?? []).map(({ id, name, icon, color }) => ({ id, name, icon, color })),
  current: win => spacesModule()?.active(win) ?? null,
  select: (win, id) => spacesModule()?.switchTo(win, id),
  watch(win, fn) {
    const doc = win.document;
    const observer = new win.MutationObserver(() => fn());
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['kitsune-space-color', 'kitsune-spaces-many'] });
    for (const strip of doc.querySelectorAll('.kitsune-spaces')) observer.observe(strip, { childList: true });
    return () => observer.disconnect();
  },
};

// El modo ahorro de Kitsune: con él, el cristal en vivo repinta a 15 fps.
const saver = { get active() { return Services.prefs.getStringPref('kitsune.performance.applied', 'normal') === 'ahorro'; } };

const host = () => ({ t, prefs: Services.prefs, prefix: 'kitsune.zero.', keys: { add: addKey }, spaces, saver });

export const KitsuneZeroHost = {
  decorate(win) {
    const { Zero } = ChromeUtils.importESModule(ZERO);
    if (!started) { Zero.start(host()); started = true; }
    return Zero.decorate(win);
  },
};
