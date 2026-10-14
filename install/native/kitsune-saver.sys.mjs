/* Modo ahorro a la vista: la RAM de Kitsune en la barra (solo mientras el modo está
 * puesto) y un panel para entenderlo y mandar en él.
 *
 * - El medidor se actualiza cada 5 s con la memoria real de todos los procesos.
 * - El panel dice cuántas pestañas están despiertas y dormidas, duerme de golpe las que no
 *   usas y deja marcar la web de la pestaña como «no dormir nunca» (YouTube, Discord…):
 *   se guarda en kitsune.saver.keepAwake y el vigilante de kitsune-appearance la respeta.
 * - Las pestañas dormidas se ven apagadas (CSS de kitsune-layout.css, [pending]).
 * El modo se pone y se quita en «Tu inicio» → Apariencia → Rendimiento (o desde la paleta).
 */
// Textos en el idioma de Kitsune (kitsune-i18n.sys.mjs); sin Gecko (pruebas de Node), en castellano.
const t = (spanish, english) => {
  try { return ChromeUtils.importESModule('chrome://browser/content/kitsune-i18n.sys.mjs').t(spanish, english); } catch { return spanish; }
};
export const KEEP_AWAKE_PREF = 'kitsune.saver.keepAwake';
const APPLIED_PREF = 'kitsune.performance.applied';
const HTML = 'http://www.w3.org/1999/xhtml';
const windows = new Set();
let timer = null, observing = false, lastBytes = 0;

/** Las webs que nunca se duermen (hosts, sin repetir, como mucho 100). */
export function keepAwakeHosts(value = Services.prefs.getStringPref(KEEP_AWAKE_PREF, '')) {
  return [...new Set(String(value).split(',').map(host => host.trim().toLowerCase()).filter(host => /^[a-z0-9.-]{1,253}$/.test(host)))].slice(0, 100);
}
export function setKeepAwake(host, keep) {
  const hosts = keepAwakeHosts().filter(item => item !== host);
  if (keep) hosts.push(host);
  if (hosts.length) Services.prefs.setStringPref(KEEP_AWAKE_PREF, hosts.join(','));
  else if (Services.prefs.prefHasUserValue(KEEP_AWAKE_PREF)) Services.prefs.clearUserPref(KEEP_AWAKE_PREF);
}
/** Bytes → «1,4 GB» o «830 MB». */
export function formatBytes(bytes) {
  const mb = bytes / 1048576;
  return mb >= 1024 ? `${(mb / 1024).toLocaleString(t('es-ES', 'en-US'), { maximumFractionDigits: 1 })} GB` : `${Math.round(mb).toLocaleString(t('es-ES', 'en-US'))} MB`;
}
const hostOf = uri => { try { return uri?.host?.toLowerCase() ?? ''; } catch { return ''; } };
const saverOn = () => Services.prefs.getStringPref(APPLIED_PREF, 'normal') === 'ahorro';

async function measure() {
  const info = await ChromeUtils.requestProcInfo();
  return { bytes: info.memory + info.children.reduce((sum, child) => sum + (child.memory || 0), 0), processes: 1 + info.children.length };
}

async function tick() {
  if (!saverOn() || !windows.size) return;
  try {
    const { bytes } = await measure();
    lastBytes = bytes;
    for (const win of windows) {
      const button = win.document.getElementById('kitsune-ram-button');
      if (button) { button.setAttribute('label', formatBytes(bytes)); button.setAttribute('tooltiptext', t(`Kitsune usa ${formatBytes(bytes)} de RAM (modo ahorro)`, `Kitsune is using ${formatBytes(bytes)} of RAM (saver mode)`)); }
    }
  } catch { /* la próxima vuelta */ }
}

function applyState() {
  const on = saverOn();
  for (const win of windows) win.document.documentElement.toggleAttribute('kitsune-saver', on);
  const { setInterval, clearInterval } = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
  if (on && !timer) { timer = setInterval(() => void tick(), 5000); void tick(); }
  if (!on && timer) { clearInterval(timer); timer = null; }
}
const observer = { observe: () => applyState() };

function counts(win) {
  let awake = 0, asleep = 0;
  for (const tab of win.gBrowser.tabs) (tab.hasAttribute('pending') || !tab.linkedPanel ? asleep++ : awake++);
  return { awake, asleep };
}
/** Duerme todas las pestañas que no se están usando (ni fijadas, ni con sonido, ni «no dormir nunca»). */
export function sleepAll(win) {
  const keep = new Set(keepAwakeHosts());
  let slept = 0;
  for (const tab of [...win.gBrowser.tabs]) {
    if (tab.selected || tab.pinned || tab.soundPlaying || tab.hasAttribute('pending') || !tab.linkedPanel || keep.has(hostOf(tab.linkedBrowser?.currentURI))) continue;
    win.gBrowser.discardBrowser(tab);
    slept++;
  }
  return slept;
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
  for (const [name, value] of Object.entries({ id: 'kitsune-saver-panel', type: 'arrow', class: 'kitsune-space-panel kitsune-saver-panel', noautofocus: 'true' })) panel.setAttribute(name, value);
  const keep = el(doc, 'input', { type: 'checkbox', class: 'kitsune-saver-keep' });
  const form = el(doc, 'div', { class: 'kitsune-space-form' }, [
    el(doc, 'h2', { class: 'kitsune-space-panel-title' }, [t('Modo ahorro', 'Saver mode')]),
    el(doc, 'p', { class: 'kitsune-saver-total' }),
    el(doc, 'p', { class: 'kitsune-saver-tabs' }),
    el(doc, 'label', { class: 'kitsune-saver-keep-row' }, [keep, el(doc, 'span', { class: 'kitsune-saver-keep-label' })]),
    el(doc, 'p', { class: 'kitsune-saver-note' }, [t('Duerme las pestañas que no usas en 15 minutos y, si pasa del límite de RAM, las más antiguas. Vuelven al abrirlas. El límite se cambia en Tu inicio → Apariencia.', 'Puts tabs you have not used for 15 minutes to sleep and, above the RAM limit, the oldest ones. They come back when you open them. Change the limit in Your home → Appearance.')]),
    el(doc, 'div', { class: 'kitsune-space-panel-actions' }, [
      el(doc, 'button', { type: 'button', class: 'kitsune-saver-processes' }, [t('Ver procesos', 'See processes')]),
      el(doc, 'button', { type: 'button', class: 'kitsune-space-panel-save kitsune-saver-sleep' }, [t('Dormir las que no uso', 'Sleep the ones I am not using')])]),
  ]);
  panel.append(form);
  const fill = async () => {
    const { bytes, processes } = await measure().catch(() => ({ bytes: lastBytes, processes: 0 }));
    form.querySelector('.kitsune-saver-total').textContent = t(`Kitsune usa ${formatBytes(bytes)} de RAM${processes ? ` en ${processes} procesos` : ''}.`, `Kitsune is using ${formatBytes(bytes)} of RAM${processes ? ` in ${processes} processes` : ''}.`);
    const { awake, asleep } = counts(win);
    form.querySelector('.kitsune-saver-tabs').textContent = t(`${awake} ${awake === 1 ? 'pestaña despierta' : 'pestañas despiertas'} · ${asleep} ${asleep === 1 ? 'dormida' : 'dormidas'}`, `${awake} ${awake === 1 ? 'tab awake' : 'tabs awake'} · ${asleep} asleep`);
    const host = hostOf(win.gBrowser.selectedBrowser.currentURI);
    form.querySelector('.kitsune-saver-keep-row').hidden = !host;
    form.querySelector('.kitsune-saver-keep-label').textContent = t(`No dormir nunca ${host}`, `Never sleep ${host}`);
    keep.checked = keepAwakeHosts().includes(host);
    keep.dataset.host = host;
  };
  panel.addEventListener('popupshowing', () => void fill());
  keep.addEventListener('change', () => { if (keep.dataset.host) setKeepAwake(keep.dataset.host, keep.checked); });
  form.querySelector('.kitsune-saver-sleep').addEventListener('click', () => { sleepAll(win); void fill(); });
  form.querySelector('.kitsune-saver-processes').addEventListener('click', () => { panel.hidePopup(); win.openTrustedLinkIn('about:processes', 'tab'); });
  doc.getElementById('mainPopupSet').append(panel);
  return panel;
}

export const KitsuneSaver = {
  async decorate(win) {
    if (!win.gBrowser || !win.gBrowserInit?.delayedStartupFinished) await win.delayedStartupPromise;
    if (windows.has(win) || !win.toolbar?.visible) return;
    const doc = win.document;
    const menu = doc.getElementById('PanelUI-button');
    if (!menu) return;
    windows.add(win);
    win.addEventListener('unload', () => windows.delete(win), { once: true });
    const button = doc.createXULElement('toolbarbutton');
    for (const [name, value] of Object.entries({ id: 'kitsune-ram-button', class: 'toolbarbutton-1 chromeclass-toolbar-additional', label: '…',
      tooltiptext: t('RAM de Kitsune (modo ahorro)', 'Kitsune\'s RAM (saver mode)'), 'aria-label': t('RAM de Kitsune', 'Kitsune\'s RAM') })) button.setAttribute(name, value);
    button.addEventListener('command', () => {
      const panel = doc.getElementById('kitsune-saver-panel') ?? buildPanel(win);
      panel.openPopup(button, 'bottomright topright', 0, 4);
    });
    menu.before(button);
    if (!observing) { Services.prefs.addObserver(APPLIED_PREF, observer); observing = true; }
    applyState();
  },
  sleepAll: win => sleepAll(win),
};
