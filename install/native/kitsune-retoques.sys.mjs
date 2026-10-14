/* Retoques: cambios pequeños de aspecto y de manejo, de un clic (lo que en Zen son los Mods).
 *
 * - Unos son de estilo: encienden kitsune.retoques.<id> y kitsune-retoques.css los aplica con
 *   @media -moz-pref(), al momento y en todas las ventanas.
 * - Otros son ajustes de Gecko que mucha gente busca en about:config (pestañas nuevas junto a
 *   la actual, Ctrl+Tab por uso reciente…). Apagarlos devuelve el valor de serie.
 * Se cambian en un panel (menú → «Retoques…» o la paleta).
 */
// Textos en el idioma de Kitsune (kitsune-i18n.sys.mjs); sin Gecko (pruebas de Node), en castellano.
const t = (spanish, english) => {
  try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-i18n.sys.mjs').t(spanish, english); } catch { return spanish; }
};
const HTML = 'http://www.w3.org/1999/xhtml';
const style = id => ({ pref: `kitsune.retoques.${id}`, type: 'bool', on: true });

export const RETOQUES = Object.freeze([
  { id: 'flotante', ...style('flotante'), es: ['Web flotante', 'La web en una tarjeta con margen y esquinas, como en Zen.'], en: ['Floating web', 'The site in a card with a margin and corners, like in Zen.'] },
  { id: 'centrada', ...style('centrada'), es: ['Dirección centrada', 'La dirección de la web, en el centro de la barra mientras no escribes.'], en: ['Centered address', 'The site address in the middle of the bar while you are not typing.'] },
  { id: 'sinextensiones', ...style('sinextensiones'), es: ['Sin botón de extensiones', 'Siguen en el menú, en «Extensiones y temas».'], en: ['No extensions button', 'They are still in the menu, under “Add-ons and themes”.'] },
  { id: 'junto', pref: 'browser.tabs.insertAfterCurrent', type: 'bool', on: true, es: ['Pestañas nuevas junto a la actual', 'En lugar de al final de todas.'], en: ['New tabs next to the current one', 'Instead of at the end.'] },
  { id: 'reciente', pref: 'browser.ctrlTab.sortByRecentlyUsed', type: 'bool', on: true, es: ['Ctrl+Tab por uso reciente', 'Como Alt+Tab: a la última pestaña que usaste.'], en: ['Ctrl+Tab by recent use', 'Like Alt+Tab: to the last tab you used.'] },
  { id: 'ultima', pref: 'browser.tabs.closeWindowWithLastTab', type: 'bool', on: false, es: ['Cerrar la última pestaña no cierra la ventana', 'Se queda con tu inicio.'], en: ['Closing the last tab keeps the window', 'It stays with your home.'] },
  { id: 'pip', pref: 'media.videocontrols.picture-in-picture.enable-when-switching-tabs.enabled', type: 'bool', on: true, es: ['Vídeo flotante al cambiar de pestaña', 'El vídeo que estás viendo sigue en una ventanita.'], en: ['Floating video when you switch tabs', 'The video you are watching goes on in a small window.'] },
  { id: 'movimiento', pref: 'ui.prefersReducedMotion', type: 'int', on: 1, es: ['Menos movimiento', 'Sin animaciones, en Kitsune y en las webs que lo respetan.'], en: ['Less motion', 'No animations, in Kitsune and in the sites that respect it.'] },
].map(item => Object.freeze(item)));

/** ¿Está puesto? (el valor de la pref es el de «on»). */
export function isOn(item, read) {
  const value = read(item.pref, item.type);
  return value === item.on;
}

// ---------------------------------------------------------------- en Gecko

function read(pref, type) {
  try {
    if (Services.prefs.getPrefType(pref) === Services.prefs.PREF_INVALID) return undefined;
    return type === 'int' ? Services.prefs.getIntPref(pref) : Services.prefs.getBoolPref(pref);
  } catch { return undefined; }
}
export function setRetoque(id, on) {
  const item = RETOQUES.find(entry => entry.id === id);
  if (!item) return false;
  if (on) item.type === 'int' ? Services.prefs.setIntPref(item.pref, item.on) : Services.prefs.setBoolPref(item.pref, item.on);
  else if (Services.prefs.prefHasUserValue(item.pref)) Services.prefs.clearUserPref(item.pref);
  // Si el valor de serie ya era el de «on» (o alguien lo cambió a mano), al apagar se pone el contrario.
  if (!on && isOn(item, read)) item.type === 'int' ? Services.prefs.setIntPref(item.pref, 0) : Services.prefs.setBoolPref(item.pref, !item.on);
  return true;
}

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};

function buildPanel(win) {
  const doc = win.document;
  const panel = doc.createXULElement('panel');
  for (const [name, value] of Object.entries({ id: 'kitsune-retoques-panel', type: 'arrow', class: 'kitsune-space-panel kitsune-retoques-panel' })) panel.setAttribute(name, value);
  const list = el(doc, 'div', { class: 'kitsune-retoques-list' });
  const form = el(doc, 'div', { class: 'kitsune-space-form kitsune-retoques-form' }, [
    el(doc, 'h2', { class: 'kitsune-space-panel-title' }, [t('Retoques', 'Tweaks')]),
    el(doc, 'p', { class: 'kitsune-retoques-help' }, [t('Pequeños cambios de aspecto y de manejo. Se aplican al momento.', 'Small changes to the look and the way Kitsune works. They apply at once.')]),
    list,
    el(doc, 'div', { class: 'kitsune-space-panel-actions' }, [el(doc, 'button', { type: 'button', class: 'kitsune-space-panel-save kitsune-retoques-close' }, [t('Hecho', 'Done')])]),
  ]);
  panel.append(form);
  const fill = () => list.replaceChildren(...RETOQUES.map(item => {
    const [title, detail] = t(item.es, item.en);
    const input = el(doc, 'input', { type: 'checkbox', 'data-id': item.id });
    input.checked = isOn(item, read);
    return el(doc, 'label', { class: 'kitsune-retoques-row', 'data-id': item.id }, [input, el(doc, 'span', {}, [el(doc, 'b', {}, [title]), el(doc, 'small', {}, [detail])])]);
  }));
  list.addEventListener('change', event => {
    const input = event.target.closest('input[data-id]');
    if (input) setRetoque(input.dataset.id, input.checked);
  });
  form.querySelector('.kitsune-retoques-close').addEventListener('click', () => panel.hidePopup());
  panel.addEventListener('popupshowing', fill);
  doc.getElementById('mainPopupSet').append(panel);
  return panel;
}

function openPanel(win) {
  const panel = win.document.getElementById('kitsune-retoques-panel') ?? buildPanel(win);
  win.PanelUI?.hide?.();
  panel.openPopup(win.document.getElementById('PanelUI-menu-button'), 'bottomright topright', 0, 4);
  return panel;
}

const decorated = new WeakSet();
export const KitsuneRetoques = {
  async decorate(win) {
    if (!win.gBrowser || !win.gBrowserInit?.delayedStartupFinished) await win.delayedStartupPromise;
    if (decorated.has(win) || !win.toolbar?.visible) return;
    decorated.add(win);
    const doc = win.document;
    const insert = () => {
      const settings = doc.getElementById('appMenu-settings-button');
      if (!settings || doc.getElementById('appMenu-kitsune-retoques')) return;
      const button = doc.createXULElement('toolbarbutton');
      for (const [name, value] of Object.entries({ id: 'appMenu-kitsune-retoques', class: 'subviewbutton', label: t('Retoques…', 'Tweaks…') })) button.setAttribute(name, value);
      button.addEventListener('command', () => openPanel(win));
      settings.before(button);
    };
    insert();
    doc.addEventListener('ViewShowing', event => { if (event.target.id === 'appMenu-mainView') insert(); }, true);
  },
  open: win => openPanel(win),
  set: (id, on) => setRetoque(id, on),
  list: () => RETOQUES.map(item => ({ id: item.id, on: isOn(item, read) })),
};
