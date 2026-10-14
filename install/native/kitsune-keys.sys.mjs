/* Atajos de teclado a tu gusto (como los de Zen): los de Kitsune (paleta, vista dividida,
 * modo compacto, espacios) y los más usados de Gecko.
 *
 * - Se cambian en un panel (paleta → «Atajos de teclado…» o menú): pulsas el botón del atajo
 *   y luego la combinación. Esc cancela; Retroceso lo quita. Si la combinación ya es de otra
 *   cosa, lo dice y no la pisa.
 * - Se guardan en kitsune.keys.custom (JSON {id: {key | keycode, modifiers} | {off: true}})
 *   y se aplican a los <key> de cada ventana. Gecko construye los manejadores de un <keyset>
 *   una sola vez, así que tras cambiar sus teclas el keyset se vuelve a insertar.
 * - Lo que había de serie se guarda en el propio <key> (kitsune-default) para restaurarlo.
 */
// Textos en el idioma de Kitsune (kitsune-i18n.sys.mjs); sin Gecko (pruebas de Node), en castellano.
const t = (spanish, english) => {
  try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-i18n.sys.mjs').t(spanish, english); } catch { return spanish; }
};
export const CUSTOM_PREF = 'kitsune.keys.custom';
const HTML = 'http://www.w3.org/1999/xhtml';

/** Los atajos que se pueden cambiar (los que no existan en la ventana no salen). */
export const CATALOG = Object.freeze([
  ['kitsune-palette-key', 'Paleta: buscarlo todo', 'Palette: find everything'],
  ['kitsune-split-key', 'Dividir la pestaña o añadir otra web', 'Split tab or add another site'],
  ['kitsune-unsplit-key', 'Separar la vista dividida', 'Unsplit tabs'],
  ['kitsune-compact-key', 'Modo compacto', 'Compact mode'],
  ['kitsune-zero-key', 'Kitsune Zero', 'Kitsune Zero'],
  ['kitsune-space-key-next', 'Espacio siguiente', 'Next space'],
  ['kitsune-space-key-previous', 'Espacio anterior', 'Previous space'],
  ['key_newNavigatorTab', 'Nueva pestaña', 'New tab'],
  ['key_close', 'Cerrar pestaña', 'Close tab'],
  ['key_restoreLastClosedTabOrWindowOrSession', 'Reabrir la pestaña cerrada', 'Reopen closed tab'],
  ['key_duplicateTab', 'Duplicar pestaña', 'Duplicate tab'],
  ['key_toggleMute', 'Silenciar la pestaña', 'Mute tab'],
  ['key_newNavigator', 'Nueva ventana', 'New window'],
  ['key_privatebrowsing', 'Nueva ventana privada', 'New private window'],
  ['key_reload', 'Recargar', 'Reload'],
  ['key_find', 'Buscar en la página', 'Find in page'],
  ['key_toggleReaderMode', 'Modo lectura', 'Reader view'],
  ['key_togglePictureInPicture', 'Imagen en imagen', 'Picture-in-picture'],
  ['key_screenshot', 'Captura de pantalla', 'Screenshot'],
  ['key_enterFullScreen', 'Pantalla completa', 'Full screen'],
  ['addBookmarkAsKb', 'Añadir a marcadores', 'Bookmark this page'],
  ['manBookmarkKb', 'Marcadores', 'Bookmarks'],
  ['showAllHistoryKb', 'Historial', 'History'],
  ['key_openDownloads', 'Descargas', 'Downloads'],
  ['key_toggleToolbox', 'Herramientas de desarrollo', 'Developer tools'],
].map(([id, es, en]) => Object.freeze({ id, es, en })));
const KNOWN = new Set(CATALOG.map(item => item.id));

const NAMED = Object.freeze({
  ArrowLeft: 'VK_LEFT', ArrowRight: 'VK_RIGHT', ArrowUp: 'VK_UP', ArrowDown: 'VK_DOWN', PageUp: 'VK_PAGE_UP', PageDown: 'VK_PAGE_DOWN',
  Home: 'VK_HOME', End: 'VK_END', Insert: 'VK_INSERT', Delete: 'VK_DELETE', Backspace: 'VK_BACK', Enter: 'VK_RETURN', Tab: 'VK_TAB', ' ': 'VK_SPACE',
});
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'OS', 'AltGraph', 'CapsLock', 'Fn', 'Hyper', 'Super']);
const MODIFIERS = new Set(['accel', 'alt', 'shift', 'control', 'meta']);
const VALID_KEYCODE = /^VK_(F([1-9]|1[0-9]|2[0-4])|LEFT|RIGHT|UP|DOWN|PAGE_UP|PAGE_DOWN|HOME|END|INSERT|DELETE|BACK|RETURN|TAB|SPACE)$/;

/** Una pulsación → { key | keycode, modifiers }, o null si no vale de atajo (o es solo un
 * modificador). Hace falta Ctrl/Cmd, Alt o Ctrl en Mac, salvo con las teclas F. */
export function comboFromEvent(event, mac = false) {
  if (!event || MODIFIER_KEYS.has(event.key)) return null;
  const modifiers = [];
  if (mac ? event.metaKey : event.ctrlKey) modifiers.push('accel');
  if (event.altKey) modifiers.push('alt');
  if (event.shiftKey) modifiers.push('shift');
  if (mac && event.ctrlKey) modifiers.push('control');
  if (!mac && event.metaKey) modifiers.push('meta');
  const code = String(event.code ?? '');
  let combo = null;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) combo = { keycode: `VK_${event.key}` };
  else if (NAMED[event.key]) combo = { keycode: NAMED[event.key] };
  // La tecla de base, no lo que escribe con Mayús o Alt (Mayús+1 es «1», no «!»).
  else if (/^Key[A-Z]$/.test(code)) combo = { key: code.slice(3) };
  else if (/^Digit[0-9]$/.test(code)) combo = { key: code.slice(5) };
  else if ([...String(event.key ?? '')].length === 1) combo = { key: event.key.toUpperCase() };
  if (!combo) return null;
  const strong = modifiers.some(name => name !== 'shift');
  if (!strong && !/^VK_F/.test(combo.keycode ?? '')) return null;
  return { ...combo, modifiers: modifiers.join(',') };
}

/** Forma única de una combinación para comparar (accel es Ctrl, o Cmd en Mac). */
export function comboId(combo, mac = false) {
  if (!combo || combo.off) return '';
  const modifiers = [...new Set(String(combo.modifiers ?? '').split(/[\s,]+/).filter(Boolean)
    .map(name => name === 'accel' ? (mac ? 'meta' : 'control') : name).filter(name => MODIFIERS.has(name)))].sort();
  const key = combo.keycode ? String(combo.keycode).toUpperCase() : String(combo.key ?? '').toUpperCase();
  return key ? `${modifiers.join('+')}|${key}` : '';
}

/** Lo guardado, comprobado: solo atajos conocidos y combinaciones con forma de atajo. */
export function parseCustom(text) {
  let value;
  try { value = JSON.parse(String(text || '{}')); } catch { return {}; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [id, combo] of Object.entries(value)) {
    if (!KNOWN.has(id) || !combo || typeof combo !== 'object') continue;
    if (combo.off === true) { out[id] = { off: true }; continue; }
    const modifiers = String(combo.modifiers ?? '').split(',').filter(Boolean);
    if (!modifiers.every(name => MODIFIERS.has(name))) continue;
    if (typeof combo.keycode === 'string' && VALID_KEYCODE.test(combo.keycode)) out[id] = { keycode: combo.keycode, modifiers: modifiers.join(',') };
    else if (typeof combo.key === 'string' && [...combo.key].length === 1 && combo.key.trim()) out[id] = { key: combo.key.toUpperCase(), modifiers: modifiers.join(',') };
  }
  return out;
}

// ---------------------------------------------------------------- en Gecko

const isMac = () => { try { return Services.appinfo.OS === 'Darwin'; } catch { return false; } };
const readCustom = () => parseCustom(Services.prefs.getStringPref(CUSTOM_PREF, '{}'));
function writeCustom(custom) {
  if (Object.keys(custom).length) Services.prefs.setStringPref(CUSTOM_PREF, JSON.stringify(custom));
  else if (Services.prefs.prefHasUserValue(CUSTOM_PREF)) Services.prefs.clearUserPref(CUSTOM_PREF);
}
const comboOf = node => node.hasAttribute('keycode') ? { keycode: node.getAttribute('keycode'), modifiers: node.getAttribute('modifiers') ?? '' }
  : { key: node.getAttribute('key') ?? '', modifiers: node.getAttribute('modifiers') ?? '' };
function defaultsOf(node) {
  if (!node.hasAttribute('kitsune-default')) {
    node.setAttribute('kitsune-default', JSON.stringify({ ...comboOf(node), disabled: node.getAttribute('disabled') === 'true',
      l10n: node.getAttribute('data-l10n-id') ?? '', l10nAttrs: node.getAttribute('data-l10n-attrs') ?? '' }));
  }
  try { return JSON.parse(node.getAttribute('kitsune-default')); } catch { return comboOf(node); }
}
function setCombo(node, combo, disabled, base) {
  for (const name of ['key', 'keycode', 'modifiers']) node.removeAttribute(name);
  if (combo.keycode) node.setAttribute('keycode', combo.keycode); else node.setAttribute('key', combo.key);
  if (combo.modifiers) node.setAttribute('modifiers', combo.modifiers);
  if (disabled) node.setAttribute('disabled', 'true'); else node.removeAttribute('disabled');
  // Muchas teclas de Gecko toman su letra de Fluent (data-l10n-id): al reinsertar el keyset la
  // volvería a poner. Con un atajo propio se le quita; al volver al de serie, se le devuelve.
  const own = combo !== base;
  if (own) { node.removeAttribute('data-l10n-id'); node.removeAttribute('data-l10n-attrs'); }
  else if (base?.l10n) {
    node.setAttribute('data-l10n-id', base.l10n);
    if (base.l10nAttrs) node.setAttribute('data-l10n-attrs', base.l10nAttrs);
  }
}

/** Aplica lo guardado a los <key> de la ventana (y deja lo de serie donde no hay nada). */
function apply(win) {
  const doc = win.document;
  const custom = readCustom();
  const touched = new Set();
  for (const { id } of CATALOG) {
    const node = doc.getElementById(id);
    if (!node || node.localName !== 'key') continue;
    const wanted = custom[id];
    if (!wanted && !node.hasAttribute('kitsune-default')) continue;
    const base = defaultsOf(node);
    const next = wanted?.off ? { combo: base, disabled: true } : { combo: wanted ?? base, disabled: wanted ? false : base.disabled };
    if (comboId(comboOf(node)) === comboId(next.combo) && (node.getAttribute('disabled') === 'true') === next.disabled) continue;
    setCombo(node, next.combo, next.disabled, base);
    if (node.parentNode?.localName === 'keyset') touched.add(node.parentNode);
  }
  // Gecko solo lee las teclas de un keyset al conectarlo: se vuelve a poner en su sitio.
  for (const keyset of touched) keyset.parentNode?.insertBefore(keyset, keyset.nextSibling);
  if (touched.size) win.document.getElementById('kitsune-keys-panel')?.dispatchEvent(new win.CustomEvent('kitsune-keys-changed'));
}

/** ¿A qué otra cosa pertenece ya esta combinación? (null si a nada). */
function owner(doc, combo, except) {
  const id = comboId(combo, isMac());
  for (const node of doc.querySelectorAll('key')) {
    if (node.id === except || node.getAttribute('disabled') === 'true' || !node.closest('keyset')) continue;
    if (comboId(comboOf(node), isMac()) === id) return node;
  }
  return null;
}
const labelOf = id => { const item = CATALOG.find(entry => entry.id === id); return item ? t(item.es, item.en) : id; };
function pretty(node) {
  const none = t('Sin atajo', 'No shortcut');
  if (node.getAttribute('disabled') === 'true' || !(node.getAttribute('key') || node.getAttribute('keycode'))) return none;
  try {
    const { ShortcutUtils } = ChromeUtils.importESModule('resource://gre/modules/ShortcutUtils.sys.mjs');
    return ShortcutUtils.prettifyShortcut(node) || none;
  } catch { return none; }
}

const windows = new Set();
let observing = false;
const observer = { observe: () => { for (const win of windows) apply(win); } };

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};

function buildPanel(win) {
  const doc = win.document;
  const panel = doc.createXULElement('panel');
  for (const [name, value] of Object.entries({ id: 'kitsune-keys-panel', type: 'arrow', class: 'kitsune-space-panel kitsune-keys-panel' })) panel.setAttribute(name, value);
  const list = el(doc, 'div', { class: 'kitsune-keys-list', role: 'list' });
  const status = el(doc, 'p', { class: 'kitsune-keys-status', role: 'status' });
  const form = el(doc, 'div', { class: 'kitsune-space-form kitsune-keys-form' }, [
    el(doc, 'h2', { class: 'kitsune-space-panel-title' }, [t('Atajos de teclado', 'Keyboard shortcuts')]),
    el(doc, 'p', { class: 'kitsune-keys-help' }, [t('Pulsa un atajo y luego la combinación nueva. Esc cancela; Retroceso lo quita.',
      'Press a shortcut, then the new combination. Esc cancels; Backspace removes it.')]),
    list, status,
    el(doc, 'div', { class: 'kitsune-space-panel-actions' }, [
      el(doc, 'button', { type: 'button', class: 'kitsune-keys-reset-all' }, [t('Restaurar todos', 'Reset all')]),
      el(doc, 'button', { type: 'button', class: 'kitsune-space-panel-save kitsune-keys-close' }, [t('Hecho', 'Done')])]),
  ]);
  panel.append(form);
  let recording = null;
  const stop = () => { recording = null; panel.removeAttribute('recording'); fill(); };
  const fill = () => {
    const custom = readCustom();
    list.replaceChildren(...CATALOG.filter(({ id }) => doc.getElementById(id)?.localName === 'key').map(({ id }) => {
      const node = doc.getElementById(id);
      const combo = el(doc, 'button', { type: 'button', class: 'kitsune-keys-combo', 'data-id': id, 'aria-label': `${labelOf(id)}: ${pretty(node)}` },
        [recording === id ? t('Pulsa la combinación…', 'Press the combination…') : pretty(node)]);
      if (recording === id) combo.setAttribute('recording', 'true');
      const reset = el(doc, 'button', { type: 'button', class: 'kitsune-keys-reset', 'data-id': id, title: t('Volver al de serie', 'Back to default'), 'aria-label': t(`Volver al de serie: ${labelOf(id)}`, `Back to default: ${labelOf(id)}`) }, ['↺']);
      reset.hidden = !custom[id];
      return el(doc, 'div', { class: 'kitsune-keys-row', role: 'listitem', 'data-id': id }, [el(doc, 'span', { class: 'kitsune-keys-label' }, [labelOf(id)]), combo, reset]);
    }));
  };
  list.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const { id } = button.dataset;
    if (button.classList.contains('kitsune-keys-reset')) {
      const custom = readCustom(); delete custom[id]; writeCustom(custom);
      status.textContent = '';
      stop();
    } else {
      recording = id; panel.setAttribute('recording', 'true'); status.textContent = ''; fill();
      list.querySelector(`.kitsune-keys-combo[data-id="${id}"]`)?.focus();
    }
  });
  // Mientras se graba, la pulsación es para el panel: ni Gecko ni la web la ven.
  panel.addEventListener('keydown', event => {
    if (!recording) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey) { stop(); return; }
    const custom = readCustom();
    if (event.key === 'Backspace' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      custom[recording] = { off: true }; writeCustom(custom); status.textContent = t(`«${labelOf(recording)}» se queda sin atajo.`, `“${labelOf(recording)}” has no shortcut now.`); stop(); return;
    }
    const combo = comboFromEvent(event, isMac());
    if (!combo) {
      if (!MODIFIER_KEYS.has(event.key)) status.textContent = t('Hace falta Ctrl, Alt o una tecla F.', 'It needs Ctrl, Alt or an F key.');
      return;
    }
    const other = owner(doc, combo, recording);
    if (other) {
      status.textContent = t(`Esa combinación ya es de «${labelOf(other.id)}».`, `That combination already belongs to “${labelOf(other.id)}”.`);
      return;
    }
    custom[recording] = combo; writeCustom(custom); status.textContent = ''; stop();
  }, true);
  panel.addEventListener('kitsune-keys-changed', () => { if (panel.state === 'open') fill(); });
  form.querySelector('.kitsune-keys-reset-all').addEventListener('click', () => { writeCustom({}); status.textContent = ''; stop(); });
  form.querySelector('.kitsune-keys-close').addEventListener('click', () => panel.hidePopup());
  panel.addEventListener('popupshowing', () => { recording = null; status.textContent = ''; fill(); });
  panel.addEventListener('popuphidden', () => { recording = null; panel.removeAttribute('recording'); });
  doc.getElementById('mainPopupSet').append(panel);
  return panel;
}

function openPanel(win) {
  const panel = win.document.getElementById('kitsune-keys-panel') ?? buildPanel(win);
  win.PanelUI?.hide?.();
  panel.openPopup(win.document.getElementById('PanelUI-menu-button'), 'bottomright topright', 0, 4);
  return panel;
}

export const KitsuneKeys = {
  async decorate(win) {
    if (!win.gBrowser || !win.gBrowserInit?.delayedStartupFinished) await win.delayedStartupPromise;
    if (windows.has(win) || !win.toolbar?.visible) return;
    windows.add(win);
    const doc = win.document;
    // Los keysets de Kitsune llegan cuando cada módulo acaba de prepararse: se aplica al llegar.
    const watch = new win.MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node.localName === 'keyset' && node.id !== 'mainKeyset' && !node.hasAttribute('kitsune-keys-seen')))) {
        for (const keyset of doc.querySelectorAll('keyset')) keyset.setAttribute('kitsune-keys-seen', 'true');
        apply(win);
      }
    });
    watch.observe(doc.documentElement, { childList: true });
    win.addEventListener('unload', () => { watch.disconnect(); windows.delete(win); }, { once: true });
    if (!observing) { Services.prefs.addObserver(CUSTOM_PREF, observer); observing = true; }
    apply(win);
    const insert = () => {
      const settings = doc.getElementById('appMenu-settings-button');
      if (!settings || doc.getElementById('appMenu-kitsune-keys')) return;
      const button = doc.createXULElement('toolbarbutton');
      for (const [name, value] of Object.entries({ id: 'appMenu-kitsune-keys', class: 'subviewbutton', label: t('Atajos de teclado…', 'Keyboard shortcuts…') })) button.setAttribute(name, value);
      button.addEventListener('command', () => openPanel(win));
      settings.before(button);
    };
    insert();
    doc.addEventListener('ViewShowing', event => { if (event.target.id === 'appMenu-mainView') insert(); }, true);
  },
  open: win => openPanel(win),
  apply: win => apply(win),
};
