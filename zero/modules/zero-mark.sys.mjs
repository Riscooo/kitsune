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
import { prefName, PREFS, readPrefs, variantOf } from './zero-config.sys.mjs';

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
    // Las filas que dependen del fondo (la foto, la opacidad) siguen al que está puesto de verdad.
    watch: fn => {
      const observer = new win.MutationObserver(() => fn());
      observer.observe(win.document.documentElement, { attributes: true, attributeFilter: ['zero-backdrop'] });
      return () => observer.disconnect();
    },
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
        // Dos formas de llevar Zero (Risco, 15-10: «si hace falta, dos variantes»): «Nácar», la de Risco, y
        // «Sobrio», la de Dani.
        kind: 'segment', id: PREFS.variant,
        label: host.t('Estilo', 'Style'),
        detail: host.t('Nácar: la lámina nacarada, con accesos directos y música. Sobrio: cristal ahumado, con el panel de sonido y los ajustes en la columna.',
                       'Nacre: the pearly sheet, with shortcuts and music. Sober: smoked glass, with the sound panel and the settings in the column.'),
        options: [{ value: 'nacar', label: host.t('Nácar', 'Nacre') }, { value: 'sobrio', label: host.t('Sobrio', 'Sober') }],
        get: () => variantOf(prefs.getStringPref(prefName(prefix, PREFS.variant), 'nacar')),
        set: value => prefs.setStringPref(prefName(prefix, PREFS.variant), value),
        watch: watchPref(PREFS.variant),
      },
      {
        kind: 'segment', id: PREFS.backdrop,
        label: host.t('Fondo', 'Background'),
        // Cristal solo donde el sistema lo pone (macOS 26, o un escritorio con la regla de Kitsune).
        options: [
          ...(win.document.documentElement.getAttribute('zero-glass') === 'system' ? [{ value: 'system', label: host.t('Cristal', 'Glass') }] : []),
          { value: 'space', label: host.t('Espacio', 'Space') }, { value: 'mist', label: host.t('Niebla', 'Mist') },
          { value: 'photo', label: host.t('Foto', 'Photo') }, { value: 'web', label: host.t('Web', 'Page') }],
        // Con «auto» se marca el que está puesto de verdad.
        get: () => win.document.documentElement.getAttribute('zero-backdrop'),
        // «Foto» sin foto elegida, o pulsada otra vez con la foto puesta, abre el selector para elegirla.
        set: value => {
          const photo = prefs.getStringPref(prefName(prefix, PREFS.backgroundImage), '');
          if (value === 'photo' && (!photo || win.document.documentElement.getAttribute('zero-backdrop') === 'photo')) chooseBackground(win, host);
          else prefs.setStringPref(prefName(prefix, PREFS.backdrop), value);
        },
        watch: fn => {
          const observer = new win.MutationObserver(() => fn());
          observer.observe(win.document.documentElement, { attributes: true, attributeFilter: ['zero-backdrop'] });
          return () => observer.disconnect();
        },
      },
      {
        // Siempre a la vista (Dani, 15-10: «no se puede cambiar la imagen de fondo»): elegir una pone la foto.
        kind: 'action', id: PREFS.backgroundImage,
        label: host.t('Foto de fondo', 'Background photo'),
        // Sin foto, «Elegir…»; con una, «Cambiar…» y «Quitar».
        actions: () => (prefs.getStringPref(prefName(prefix, PREFS.backgroundImage), '')
          ? [{ id: 'change', label: host.t('Cambiar…', 'Change…'), run: () => chooseBackground(win, host) },
             { id: 'remove', label: host.t('Quitar', 'Remove'), run: () => removeBackground(host) }]
          : [{ id: 'choose', label: host.t('Elegir…', 'Choose…'), run: () => chooseBackground(win, host) }]),
        watch: watchPref(PREFS.backgroundImage),
      },
      {
        // Con menos opacidad se ve lo de detrás: el cristal del sistema (acrílico) donde lo hay.
        kind: 'slider', id: PREFS.backgroundOpacity,
        label: host.t('Opacidad del fondo', 'Background opacity'),
        detail: host.t('Con menos, se ve lo que hay detrás de la ventana, desenfocado si el sistema lo permite.', 'Lower it to see what is behind the window, blurred where the system allows it.'),
        get: () => Number(prefs.getStringPref(prefName(prefix, PREFS.backgroundOpacity), '1')),
        set: value => prefs.setStringPref(prefName(prefix, PREFS.backgroundOpacity), String(Math.max(0.2, value))),
        when: () => ['space', 'mist', 'photo'].includes(win.document.documentElement.getAttribute('zero-backdrop')),
        watch: watchPref(PREFS.backgroundOpacity),
      },
      {
        kind: 'switch', id: PREFS.focus,
        label: host.t('Modo concentración', 'Focus mode'),
        detail: host.t('Activa Currar/Chill y recuerda sus ajustes por perfil.', 'Enables Work/Chill and remembers its settings per profile.'),
        get: () => prefs.getBoolPref(prefName(prefix, PREFS.focus), true),
        set: on => prefs.setBoolPref(prefName(prefix, PREFS.focus), !!on),
        watch: watchPref(PREFS.focus),
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
        label: 'Info',
        get: () => { try { return prefs.getBoolPref(prefName(prefix, PREFS.hints), true); } catch { return true; } },
        set: on => prefs.setBoolPref(prefName(prefix, PREFS.hints), !!on),
        watch: watchPref(PREFS.hints),
      },
    ],
  };
}

/** Borra la foto de fondo guardada (salvo `keep`, la que la sustituye): solo las de Zero, en chrome/ del perfil. */
async function forgetBackground(host, keep = null) {
  let old = '';
  try { old = host.prefs.getStringPref(prefName(host.prefix, PREFS.backgroundImage), ''); } catch { /* sin ajuste */ }
  const folder = PathUtils.join(Services.dirsvc.get('ProfD', Ci.nsIFile).path, 'chrome');
  if (old && old !== keep && PathUtils.parent(old) === folder && /^kitsune-zero-background[-\w]*\.jpg$/.test(PathUtils.filename(old))) {
    try { await IOUtils.remove(old, { ignoreAbsent: true }); } catch { /* ya no estaba */ }
  }
}

/** Quita la foto de fondo: se borra y Zero vuelve a su fondo de serie. */
export async function removeBackground(host) {
  await forgetBackground(host);
  try {
    host.prefs.clearUserPref(prefName(host.prefix, PREFS.backgroundImage));
    if (host.prefs.getStringPref(prefName(host.prefix, PREFS.backdrop), 'auto') === 'photo') host.prefs.clearUserPref(prefName(host.prefix, PREFS.backdrop));
  } catch { /* sin ajustes */ }
}

/** Copia una foto normalizada al perfil: no dependemos de que el archivo original siga en su sitio. */
function chooseBackground(win, host) {
  const picker = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
  picker.init(win.browsingContext, host.t('Fondo de Kitsune Zero', 'Kitsune Zero background'), Ci.nsIFilePicker.modeOpen);
  picker.appendFilters(Ci.nsIFilePicker.filterImages);
  picker.open(result => {
    if (result === Ci.nsIFilePicker.returnOK && picker.file) setBackground(win, host, picker.file.path).catch(error => console.error('Zero: no se pudo poner el fondo', error));
  });
}

/** Pone de fondo la foto de `path`: la guarda reducida (2560 × 1600 como mucho, JPEG) en chrome/ del perfil, con
 *  un nombre nuevo, y borra la de antes. */
export async function setBackground(win, host, path) {
  const bytes = await IOUtils.read(path, { maxBytes: 20 * 1024 * 1024 });
  const bitmap = await win.createImageBitmap(new win.Blob([bytes]));
  const scale = Math.min(1, 2560 / bitmap.width, 1600 / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new win.OffscreenCanvas(width, height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .88 });
  const file = Services.dirsvc.get('ProfD', Ci.nsIFile).clone();
  file.append('chrome'); await IOUtils.makeDirectory(file.path, { ignoreExisting: true });
  // Un nombre nuevo cada vez: con el mismo, el ajuste no cambiaba y se seguía viendo la foto de antes
  // (Dani, 15-10: «si pongo una foto no me deja cambiarla luego»). La anterior se borra.
  file.append(`kitsune-zero-background-${Date.now()}.jpg`);
  await IOUtils.write(file.path, new Uint8Array(await blob.arrayBuffer()));
  await forgetBackground(host, file.path);
  host.prefs.setStringPref(prefName(host.prefix, PREFS.backgroundImage), file.path);
  host.prefs.setStringPref(prefName(host.prefix, PREFS.backdrop), 'photo');
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
  } else if (row.kind === 'action') {
    // Uno o varios botones (actions(): [{ id, label, run }]); se rehacen cuando cambia lo que vigila la fila.
    control = el(doc, 'span', { class: 'zero-actions', 'data-pref': row.id });
    sync = () => {
      const actions = row.actions?.() ?? [{ id: 'run', label: row.actionLabel, run: row.run }];
      if (control.dataset.ids === actions.map(a => a.id).join(' ')) return;
      control.dataset.ids = actions.map(a => a.id).join(' ');
      control.replaceChildren(...actions.map(action => {
        const button = el(doc, 'button', { type: 'button', class: 'zero-action-button', 'data-action': action.id }, [action.label]);
        button.addEventListener('click', () => action.run());
        return button;
      }));
    };
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
  // Con la altura máxima, no la altura: la fila es flexible y, con una altura fija mayor que la suya,
  // separaba sus líneas y al final daba un salto (visto por Risco, 15-10).
  node.animate([
    { maxHeight: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', opacity: 0, transform: 'translateY(-6px)' },
    { opacity: 0, offset: .25 },
    { maxHeight: `${height}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, borderTopWidth: cs.borderTopWidth, opacity: 1, transform: 'none' },
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
    { maxHeight: `${height}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, borderTopWidth: cs.borderTopWidth, opacity: 1, transform: 'none' },
    { opacity: 0, offset: .45 },
    // También su borde de 1 px: si no, cada fila dejaba 1 px que desaparecía de golpe al quitarla (el
    // «tironcillo» al apagar el pomodoro, Risco 15-10).
    { maxHeight: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', opacity: 0, transform: 'translateY(-6px)', borderTopColor: 'transparent' },
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
  if (open) {
    const mark = st.mark.getBoundingClientRect();
    const height = st.panel.offsetHeight || 520;
    const y = Math.max(8, Math.min(mark.top + mark.height / 2 - height / 2, win.innerHeight - height - 8));
    st.panel.style.setProperty('--zero-settings-x', `${Math.round(mark.right + 12)}px`);
    st.panel.style.setProperty('--zero-settings-y', `${Math.round(y)}px`);
    st.panel.style.setProperty('--zero-settings-origin-y', `${Math.round(mark.top + mark.height / 2 - y)}px`);
  }
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
  // Con la web ampliada no hay ajustes, como el pomodoro (Risco, 15-10): si estaban abiertos, se cierran.
  const fullWatch = new win.MutationObserver(() => { if (doc.documentElement.hasAttribute('zero-full') && st.panel?.hasAttribute('open')) setOpen(win, st, false); });
  fullWatch.observe(doc.documentElement, { attributes: true, attributeFilter: ['zero-full'] });
  st.cleanups.push(() => fullWatch.disconnect());
  const title = host.t('Ajustes de Kitsune Zero', 'Kitsune Zero settings');

  st.mark = el(doc, 'button', { type: 'button', id: 'zero-mark', class: 'zero-pill', title, 'aria-label': title, 'aria-expanded': 'false', 'aria-controls': 'zero-settings' },
    [el(doc, 'span', { class: 'zero-logo', 'aria-hidden': 'true' })]);
  st.rows = el(doc, 'div', { class: 'zero-rows' });
  st.panel = el(doc, 'section', { id: 'zero-settings', role: 'dialog', 'aria-label': title }, [
    el(doc, 'h4', {}, [el(doc, 'span', { class: 'zero-logo', 'aria-hidden': 'true' }), 'Kitsune Zero']),
    st.rows,
  ]);
  doc.body.append(st.panel);
  // La marca: la última pastilla de la columna (Dani, 15-10), en las dos variantes; sin columna (una ventana
  // privada no la tiene entera), junto al panel.
  const dock = doc.getElementById('zero-dock');
  if (dock) dock.append(st.mark); else st.panel.before(st.mark);
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
