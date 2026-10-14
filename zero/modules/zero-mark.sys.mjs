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
 * Una sección: { id, rows: [fila…], watch?(fn) → dejar } (con watch, las filas se vuelven a pintar
 * cuando cambia lo que vigila). Una fila: { kind: 'switch' | 'segment' | 'list' | 'slider', id, label, detail?, options?
 * ([{ value, label }], para segment), placeholder? (para list), get() → valor, set(valor),
 * watch?(fn) → dejar, when?() → si sale }.
 */
import { prefName, PREFS, readPrefs } from './zero-config.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const state = new WeakMap();      // ventana → { cleanups, mark, panel, … }
const sections = new WeakMap();   // ventana → [sección…] (las que añaden las fases)

const el = (doc, tag, attributes = {}, children = []) => {
  const node = doc.createElementNS(HTML, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
};

/** La sección de Zero: las ventanas nuevas, el fondo de la ventana y la isla. */
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
        // Una fila para dos ajustes: como la ventana de origen (de serie), siempre en Zero o normales.
        kind: 'segment', id: 'windows',
        label: host.t('Ventanas nuevas', 'New windows'),
        options: [{ value: 'inherit', label: host.t('Como esta', 'Like this') }, { value: 'always', label: host.t('En Zero', 'In Zero') },
                  { value: 'normal', label: host.t('Normales', 'Normal') }],
        get: () => {
          const { always, inherit } = readPrefs(prefs, prefix);
          return always ? 'always' : inherit ? 'inherit' : 'normal';
        },
        set: value => {
          prefs.setBoolPref(prefName(prefix, PREFS.always), value === 'always');
          prefs.setBoolPref(prefName(prefix, PREFS.inherit), value !== 'normal');
        },
        watch: fn => { const undo = [watchPref(PREFS.always)(fn), watchPref(PREFS.inherit)(fn)]; return () => undo.forEach(u => u()); },
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
  } else if (row.kind === 'slider') {
    // Un nivel de 0 a 1 (en pantalla, de 0 a 100): se aplica mientras se arrastra.
    control = el(doc, 'input', { type: 'range', class: 'zero-slider', 'data-pref': row.id, min: '0', max: '100', step: '1', 'aria-label': row.label });
    sync = () => { if (doc.activeElement !== control) control.value = String(Math.round((row.get() ?? 0) * 100)); control.style.setProperty('--zero-fill', `${control.value}%`); };
    control.addEventListener('input', () => { control.style.setProperty('--zero-fill', `${control.value}%`); row.set(Number(control.value) / 100); });
  } else if (row.kind === 'list') {
    // Una lista en una línea (dominios separados por comas): se guarda al salir del campo o con Intro.
    control = el(doc, 'input', { type: 'text', class: 'zero-list', 'data-pref': row.id, placeholder: row.placeholder ?? '', spellcheck: 'false', 'aria-label': row.label });
    sync = () => { if (doc.activeElement !== control) control.value = row.get() ?? ''; };
    const commit = () => row.set(control.value);
    control.addEventListener('change', commit);
    control.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } });
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
  if (unwatch) (st.rowCleanups ?? st.cleanups).push(unwatch);
  return el(doc, 'div', { class: 'zero-row' }, [text, control]);
}

function renderRows(win, st) {
  const doc = win.document;
  for (const undo of st.rowCleanups ?? []) { try { undo(); } catch { /* ya no estaba */ } }
  st.rowCleanups = [];
  const all = [zeroSection(win, st.host), ...(sections.get(win) ?? [])];
  const shown = row => { try { return row.when ? !!row.when() : true; } catch { return true; } };
  st.rows.replaceChildren(...all.flatMap(section => section.rows.filter(shown).map(row => rowNode(doc, row, st))));
  // Las secciones que cambian de filas (el pomodoro enseña sus tiempos solo encendido).
  for (const section of all) {
    const undo = section.watch?.(() => win.setTimeout(() => { if (state.get(win) === st) renderRows(win, st); }, 0));
    if (undo) st.rowCleanups.push(undo);
  }
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
  for (const undo of [...st.cleanups.reverse(), ...(st.rowCleanups ?? [])]) { try { undo(); } catch { /* ya no estaba */ } }
}

/** Para las fases 2 a 4: añaden su sección de ajustes (en las ventanas en Zero, al momento). */
export function addSection(win, section) {
  const list = sections.get(win) ?? [];
  sections.set(win, [...list.filter(item => item.id !== section.id), section]);
  const st = state.get(win);
  if (st) renderRows(win, st);
}
