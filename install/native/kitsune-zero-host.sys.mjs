/* Kitsune como anfitrión de Kitsune Zero (zero/, en chrome://browser/content/zero/).
 *
 * Zero no conoce a Kitsune: este módulo le da lo que necesita, que es lo único que cambiaría si
 * Zero saliera como navegador aparte. Le pasa los textos en el idioma de Kitsune, los ajustes
 * (con el prefijo kitsune.zero.), los atajos (en su propio <keyset>, como los de kitsune-layout),
 * los espacios y las pestañas de paso (para el raíl) y si está el modo ahorro (para el cristal en vivo).
 */
// Textos en el idioma de Kitsune (kitsune-i18n.sys.mjs); sin Gecko, en castellano.
const t = (spanish, english) => {
  try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-i18n.sys.mjs').t(spanish, english); } catch { return spanish; }
};
const ZERO = 'chrome://browser/content/zero/zero.sys.mjs';
let started = false;

/** Un atajo de Zero en su keyset (una tecla, o una con nombre: «VK_ESCAPE»). Gecko lee un <keyset> solo
 *  al conectarlo: se vuelve a conectar. */
function addKey(win, id, key, modifiers, run) {
  const doc = win.document;
  if (doc.getElementById(id)) return;
  const keyset = doc.getElementById('kitsune-zero-keys') ?? Object.assign(doc.createXULElement('keyset'), { id: 'kitsune-zero-keys' });
  const node = doc.createXULElement('key');
  node.id = id;
  node.setAttribute(key.startsWith('VK_') ? 'keycode' : 'key', key);
  if (modifiers) node.setAttribute('modifiers', modifiers);
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

// Las pestañas «de paso», que el raíl no enseña: la vista rápida (va unida a la de debajo).
const tabs = { passing: tab => tab.hasAttribute('kitsune-glance') };

// Los usuarios de Kitsune: Zero los lee de los contenedores de Gecko; de aquí, el nombre del base.
const users = {
  baseName() {
    try {
      const { KitsuneUsers } = ChromeUtils.importESModule('chrome://browser/content/kitsune-users.sys.mjs');
      const { users: list, baseId } = KitsuneUsers.list();
      return list.find(user => user.id === baseId)?.name ?? null;
    } catch { return null; }
  },
};

const host = () => ({ t, prefs: Services.prefs, prefix: 'kitsune.zero.', keys: { add: addKey }, spaces, saver, tabs, users });

/** «Kitsune Zero» en el menú ≡ de Kitsune (con Retoques… y Copia…), con su atajo a la vista: entra, y
 *  dentro de Zero la misma fila dice «Salir de Kitsune Zero» y sale. */
const withMenu = new WeakSet();
function addMenuRow(win, Zero) {
  if (withMenu.has(win)) return;
  withMenu.add(win);
  const doc = win.document;
  const insert = () => {
    const settings = doc.getElementById('appMenu-settings-button');
    if (!settings) return;
    let button = doc.getElementById('appMenu-kitsune-zero');
    if (!button) {
      button = doc.createXULElement('toolbarbutton');
      button.id = 'appMenu-kitsune-zero';
      button.className = 'subviewbutton';
      button.addEventListener('command', () => { win.PanelUI?.hide?.(); Zero.toggle(win); });
      settings.before(button);
    }
    button.setAttribute('label', Zero.active(win) ? t('Salir de Kitsune Zero', 'Leave Kitsune Zero') : 'Kitsune Zero');
    const key = doc.getElementById('kitsune-zero-key');
    if (key) {
      try {
        const { ShortcutUtils } = ChromeUtils.importESModule('resource://gre/modules/ShortcutUtils.sys.mjs');
        button.setAttribute('shortcut', ShortcutUtils.prettifyShortcut(key));
      } catch { /* sin atajo a la vista */ }
    }
  };
  doc.addEventListener('ViewShowing', event => { if (event.target.id === 'appMenu-mainView') insert(); }, true);
}

export const KitsuneZeroHost = {
  decorate(win) {
    const { Zero } = ChromeUtils.importESModule(ZERO);
    if (!started) { Zero.start(host()); started = true; }
    addMenuRow(win, Zero);
    return Zero.decorate(win);
  },
};
