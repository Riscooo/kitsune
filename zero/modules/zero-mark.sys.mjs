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

/** La sección de Zero: las ventanas nuevas, el fondo de la ventana y el raíl de pestañas. */
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
        // El raíl de pestañas (la isla de la izquierda): con sus títulos al abrirse, o solo iconos.
        kind: 'segment', id: PREFS.railIcons,
        label: host.t('Pestañas', 'Tabs'),
        options: [{ value: 'text', label: host.t('Con texto', 'With text') }, { value: 'icons', label: host.t('Solo iconos', 'Icons only') }],
        get: () => { try { return prefs.getBoolPref(prefName(prefix, PREFS.railIcons), false) ? 'icons' : 'text'; } catch { return 'text'; } },
        set: value => prefs.setBoolPref(prefName(prefix, PREFS.railIcons), value === 'icons'),
        watch: watchPref(PREFS.railIcons),
      },
      {
        // Quien ya sabe qué hace cada cosa no necesita la «i».
        kind: 'switch', id: PREFS.hints,
        label: host.t('La «i» de ayuda', 'The help «i»'),
        get: () => { try { return prefs.getBoolPref(prefName(prefix, PREFS.hints), true); } catch { return true; } },
        set: on => prefs.setBoolPref(prefName(prefix, PREFS.hints), !!on),
        watch: watchPref(PREFS.hints),
      },
    ],
  };
}

function rowNode(doc, row, undo) {
  // Sin texto debajo: la explicación, en una «i» junto al nombre (sale al pasar el ratón; ver attach).
  const info = row.detail ? [el(doc, 'span', { class: 'zero-info', role: 'img', tabindex: '0', 'aria-label': row.detail })] : [];
  const text = el(doc, 'span', { class: 'zero-row-text' }, [row.label, ...info]);
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
    // La elegida lleva una pastilla que se desliza hasta ella (no salta de una a otra).
    const thumb = el(doc, 'span', { class: 'zero-seg-thumb', 'aria-hidden': 'true', still: '' });
    control = el(doc, 'span', { class: 'zero-segment', role: 'radiogroup', 'data-pref': row.id, 'aria-label': row.label },
      [thumb, ...row.options.map(option => el(doc, 'button', { type: 'button', role: 'radio', 'data-value': option.value }, [option.label]))]);
    const place = still => {
      const on = control.querySelector('button[on]');
      if (!on || !on.offsetWidth) { thumb.toggleAttribute('hidden', true); return; }
      thumb.toggleAttribute('hidden', false);
      thumb.toggleAttribute('still', still);
      thumb.style.width = `${on.offsetWidth}px`;
      thumb.style.transform = `translateX(${on.offsetLeft}px)`;
    };
    sync = () => {
      const value = row.get();
      for (const button of control.querySelectorAll('button')) {
        const on = button.dataset.value === value;
        button.toggleAttribute('on', on);
        button.setAttribute('aria-checked', String(on));
      }
      place(false);
    };
    // Al abrirse el panel o entrar la fila, se coloca sin viaje (ver setOpen y renderRows).
    control.zeroPlace = place;
    control.addEventListener('click', event => {
      const button = event.target.closest('[data-value]');
      if (button) { row.set(button.dataset.value); sync(); }
    });
  }
  sync();
  const unwatch = row.watch?.(sync);
  if (unwatch) undo.push(unwatch);
  return el(doc, 'div', { class: 'zero-row' }, [text, control]);
}

const calm = 'cubic-bezier(.32, .72, 0, 1)';
const quiet = win => win.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Una fila que llega: se abre su hueco y su contenido entra un poco después (nada de golpe). */
function enter(win, node) {
  if (quiet(win)) return;
  const cs = win.getComputedStyle(node);
  const height = node.getBoundingClientRect().height;
  node.style.overflow = 'clip';
  node.animate([
    { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0, transform: 'translateY(-6px)' },
    { opacity: 0, offset: .25 },
    { height: `${height}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1, transform: 'none' },
  ], { duration: 460, easing: calm }).finished.then(() => { node.style.overflow = ''; }, () => { node.style.overflow = ''; });
}

/** Una fila que se va: su contenido se va antes y luego se cierra su hueco. */
function leave(win, node) {
  node.setAttribute('leaving', '');
  if (quiet(win)) { node.remove(); return; }
  const cs = win.getComputedStyle(node);
  const height = node.getBoundingClientRect().height;
  node.style.overflow = 'clip';
  node.animate([
    { height: `${height}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1, transform: 'none' },
    { opacity: 0, offset: .45 },
    { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0, transform: 'translateY(-6px)', borderTopColor: 'transparent' },
  ], { duration: 380, easing: calm, fill: 'forwards' }).finished.then(() => node.remove(), () => node.remove());
}

/** Pone las filas que tocan sin rehacer las que ya están: las nuevas entran y las que sobran se van
 *  (con animación si el panel está a la vista), y un interruptor pulsado sigue siendo el mismo. */
function renderRows(win, st) {
  const doc = win.document;
  for (const undo of st.sectionCleanups ?? []) { try { undo(); } catch { /* ya no estaba */ } }
  st.sectionCleanups = [];
  st.live ??= new Map(); // sección:fila → { node, section, undo }
  st.zeroSection ??= zeroSection(win, st.host);
  const all = [st.zeroSection, ...(sections.get(win) ?? [])];
  const shown = row => { try { return row.when ? !!row.when() : true; } catch { return true; } };
  const wanted = all.flatMap(section => section.rows.filter(shown).map(row => ({ key: `${section.id}:${row.id}`, row, section })));
  const visible = st.panel.hasAttribute('open');
  const drop = (key, item, animate) => {
    st.live.delete(key);
    for (const undo of item.undo) { try { undo(); } catch { /* ya no estaba */ } }
    if (animate) leave(win, item.node); else item.node.remove();
  };
  const keep = new Set(wanted.map(({ key }) => key));
  for (const [key, item] of st.live) if (!keep.has(key)) drop(key, item, visible);
  // Una sección puesta de nuevo (otra vez la misma fase) rehace sus filas, sin animación (antes de
  // recorrer: así el recorrido no tropieza con filas que ya no están).
  for (const { key, section } of wanted) { const item = st.live.get(key); if (item && item.section !== section) drop(key, item, false); }
  let cursor = st.rows.firstChild;
  for (const { key, row, section } of wanted) {
    let item = st.live.get(key);
    const fresh = !item;
    if (fresh) {
      item = { section, undo: [] };
      item.node = rowNode(doc, row, item.undo);
      st.live.set(key, item);
    }
    while (cursor?.hasAttribute('leaving')) cursor = cursor.nextSibling;
    if (cursor === item.node) { cursor = cursor.nextSibling; continue; }
    st.rows.insertBefore(item.node, cursor);
    if (fresh && visible) { placeThumbs(item.node); enter(win, item.node); }
  }
  // Las secciones que cambian de filas (el pomodoro enseña sus tiempos solo encendido).
  for (const section of all) {
    const undo = section.watch?.(() => win.setTimeout(() => { if (state.get(win) === st) renderRows(win, st); }, 0));
    if (undo) st.sectionCleanups.push(undo);
  }
}

/** Coloca sin viaje las pastillas de los segmentos (necesitan el panel a la vista para medirse). */
function placeThumbs(root) {
  for (const segment of root.querySelectorAll('.zero-segment')) segment.zeroPlace?.(true);
}

function setOpen(win, st, open) {
  st.panel.toggleAttribute('open', open);
  st.mark.toggleAttribute('open', open);
  st.mark.setAttribute('aria-expanded', String(open));
  if (open) placeThumbs(st.rows);
  else st.tip?.removeAttribute('shown');
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
    el(doc, 'h4', {}, [el(doc, 'span', { class: 'zero-logo', 'aria-hidden': 'true' }), 'Kitsune Zero']),
    st.rows,
  ]);
  doc.body.append(st.mark, st.panel);
  st.cleanups.push(() => { st.mark.remove(); st.panel.remove(); });
  renderRows(win, st);

  // La explicación de cada «i», en una etiqueta de cristal junto a ella; y quitarlas todas.
  st.tip = el(doc, 'div', { id: 'zero-settings-tip', 'aria-hidden': 'true' });
  doc.body.append(st.tip);
  st.cleanups.push(() => st.tip.remove());
  const showTip = target => {
    const info = target?.closest?.('.zero-info');
    if (!info) { st.tip.removeAttribute('shown'); return; }
    // Fuera del panel, a su derecha (dentro taparía los botones de la fila).
    const r = info.getBoundingClientRect(), panel = st.panel.getBoundingClientRect();
    st.tip.textContent = info.getAttribute('aria-label');
    st.tip.style.left = `${panel.right + 10}px`;
    st.tip.style.top = `${r.top + r.height / 2}px`;
    st.tip.setAttribute('shown', '');
  };
  for (const type of ['mouseover', 'focusin']) st.panel.addEventListener(type, event => showTip(event.target));
  st.panel.addEventListener('mouseout', event => { if (!event.relatedTarget?.closest?.('.zero-info')) showTip(null); });
  st.panel.addEventListener('focusout', () => showTip(null));
  const hintsPref = prefName(host.prefix, PREFS.hints);
  const hints = () => { let on = true; try { on = host.prefs.getBoolPref(hintsPref, true); } catch { /* de serie */ } st.panel.toggleAttribute('no-hints', !on); if (!on) showTip(null); };
  const hintsObserver = { observe: hints };
  host.prefs.addObserver(hintsPref, hintsObserver);
  st.cleanups.push(() => host.prefs.removeObserver(hintsPref, hintsObserver));
  hints();

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
  const rows = [...(st.live?.values() ?? [])].flatMap(item => item.undo);
  for (const undo of [...st.cleanups.reverse(), ...(st.sectionCleanups ?? []), ...rows]) { try { undo(); } catch { /* ya no estaba */ } }
}

/** Para las fases 2 a 4: añaden su sección de ajustes (en las ventanas en Zero, al momento). */
export function addSection(win, section) {
  const list = sections.get(win) ?? [];
  sections.set(win, [...list.filter(item => item.id !== section.id), section]);
  const st = state.get(win);
  if (st) renderRows(win, st);
}
