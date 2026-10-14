/* Kitsune Zero · la marca de agua y los ajustes.
 *
 * La marca es el logo («la máscara en el cero»), en blanco y muy tenue, abajo a la izquierda sobre
 * el cristal del marco. Un clic abre los ajustes de Zero, que brotan de ella; se cierran con un clic
 * fuera o con Esc. Con la web ampliada se aparta como el raíl y vuelve desde el borde izquierdo.
 *
 * Los ajustes son secciones de filas. La de Zero (abrir siempre en Zero y el fondo) va siempre; las
 * fases siguientes (pomodoro, silencio, sonidos) añaden la suya con ctx.settings.add(section), así
 * que lo que no está hecho no sale.
 *
 * Una sección: { id, rows: [fila…] }. Una fila: { kind: 'switch' | 'segment', id, label, detail?,
 * options? ([{ value, label }], para segment), get() → valor, set(valor), watch?(fn) → dejar }.
 */
import { prefName, PREFS } from './zero-config.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const state = new WeakMap();      // ventana → { cleanups, mark, panel, … }
const sections = new WeakMap();   // ventana → [sección…] (las que añaden las fases)

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};

/** La sección de Zero: abrir siempre en Zero y el fondo de la ventana. */
function zeroSection(win, host) {
  const { prefs, prefix } = host;
  const watchPref = key => fn => {
    const observer = { observe: () => fn() };
    prefs.addObserver(prefName(prefix, key), observer);
    return () => prefs.removeObserver(prefName(prefix, key), observer);
  };
  return {
    id: 'zero',
    rows: [
      {
        kind: 'switch', id: PREFS.always,
        label: host.t('Abrir siempre en Zero', 'Always open in Zero'),
        detail: host.t('Las ventanas nuevas nacen en Zero', 'New windows start in Zero'),
        get: () => { try { return prefs.getBoolPref(prefName(prefix, PREFS.always), false); } catch { return false; } },
        set: value => prefs.setBoolPref(prefName(prefix, PREFS.always), value),
        watch: watchPref(PREFS.always),
      },
      {
        kind: 'segment', id: PREFS.backdrop,
        label: host.t('Fondo', 'Background'),
        options: [{ value: 'system', label: host.t('Del sistema', 'System') }, { value: 'web', label: host.t('De la web', 'Page') }],
        // Con «auto» se marca el que está puesto de verdad.
        get: () => win.document.documentElement.getAttribute('zero-backdrop'),
        set: value => prefs.setStringPref(prefName(prefix, PREFS.backdrop), value),
        watch: fn => {
          const observer = new win.MutationObserver(() => fn());
          observer.observe(win.document.documentElement, { attributes: true, attributeFilter: ['zero-backdrop'] });
          return () => observer.disconnect();
        },
      },
      {
        kind: 'segment', id: PREFS.islandIcons,
        label: host.t('Isla', 'Island'),
        options: [{ value: 'text', label: host.t('Con texto', 'With text') }, { value: 'icons', label: host.t('Solo iconos', 'Icons only') }],
        get: () => { try { return prefs.getBoolPref(prefName(prefix, PREFS.islandIcons), false) ? 'icons' : 'text'; } catch { return 'text'; } },
        set: value => prefs.setBoolPref(prefName(prefix, PREFS.islandIcons), value === 'icons'),
        watch: watchPref(PREFS.islandIcons),
      },
    ],
  };
}

function rowNode(doc, row, st) {
  const text = el(doc, 'span', { class: 'zero-row-text' }, [row.label, ...(row.detail ? [el(doc, 'small', {}, [row.detail])] : [])]);
  let control, sync;
  if (row.kind === 'switch') {
    control = el(doc, 'button', { type: 'button', class: 'zero-switch', role: 'switch', 'data-pref': row.id, 'aria-label': row.label });
    sync = () => { const on = !!row.get(); control.toggleAttribute('on', on); control.setAttribute('aria-checked', String(on)); };
    control.addEventListener('click', () => { row.set(!row.get()); sync(); });
  } else {
    control = el(doc, 'span', { class: 'zero-segment', role: 'radiogroup', 'data-pref': row.id, 'aria-label': row.label },
      row.options.map(option => el(doc, 'button', { type: 'button', role: 'radio', 'data-value': option.value }, [option.label])));
    sync = () => {
      const value = row.get();
      for (const button of control.children) {
        const on = button.dataset.value === value;
        button.toggleAttribute('on', on);
        button.setAttribute('aria-checked', String(on));
      }
    };
    control.addEventListener('click', event => {
      const button = event.target.closest('[data-value]');
      if (button) { row.set(button.dataset.value); sync(); }
    });
  }
  sync();
  const unwatch = row.watch?.(sync);
  if (unwatch) st.cleanups.push(unwatch);
  return el(doc, 'div', { class: 'zero-row' }, [text, control]);
}

function renderRows(win, st) {
  const doc = win.document;
  const all = [zeroSection(win, st.host), ...(sections.get(win) ?? [])];
  st.rows.replaceChildren(...all.flatMap(section => section.rows.map(row => rowNode(doc, row, st))));
}

function setOpen(win, st, open) {
  st.panel.toggleAttribute('open', open);
  st.mark.toggleAttribute('open', open);
  st.mark.setAttribute('aria-expanded', String(open));
}

export function attach(win, ctx) {
  const doc = win.document, { host } = ctx;
  const st = { host, cleanups: [] };
  state.set(win, st);
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); st.cleanups.push(() => target.removeEventListener(type, fn, options)); };
  const title = host.t('Ajustes de Kitsune Zero', 'Kitsune Zero settings');

  st.mark = el(doc, 'button', { type: 'button', id: 'zero-mark', title, 'aria-label': title, 'aria-expanded': 'false', 'aria-controls': 'zero-settings' },
    [el(doc, 'span', { class: 'zero-logo', 'aria-hidden': 'true' })]);
  st.rows = el(doc, 'div', { class: 'zero-rows' });
  st.panel = el(doc, 'section', { id: 'zero-settings', role: 'dialog', 'aria-label': title }, [
    el(doc, 'h4', {}, [el(doc, 'span', { class: 'zero-logo', 'aria-hidden': 'true' }), 'Kitsune Zero',
      el(doc, 'small', {}, [host.t('Ctrl+Alt+0 entra y sale', 'Ctrl+Alt+0 to enter and leave')])]),
    st.rows,
  ]);
  doc.body.append(st.mark, st.panel);
  st.cleanups.push(() => { st.mark.remove(); st.panel.remove(); });
  renderRows(win, st);

  st.mark.addEventListener('click', () => setOpen(win, st, !st.panel.hasAttribute('open')));
  // Un clic fuera (también sobre la web) o Esc lo cierran.
  listen(win, 'mousedown', event => {
    if (st.panel.hasAttribute('open') && !st.panel.contains(event.target) && !st.mark.contains(event.target)) setOpen(win, st, false);
  }, true);
  listen(win, 'keydown', event => {
    if (event.key === 'Escape' && st.panel.hasAttribute('open')) { event.preventDefault(); event.stopPropagation(); setOpen(win, st, false); st.mark.focus(); }
  }, true);
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
}

/** Para las fases 2 a 4: añaden su sección de ajustes (en las ventanas en Zero, al momento). */
export function addSection(win, section) {
  const list = sections.get(win) ?? [];
  sections.set(win, [...list.filter(item => item.id !== section.id), section]);
  const st = state.get(win);
  if (st) renderRows(win, st);
}
