/* Kitsune Zero en Windows 11, con el motor de verdad: el material de DWM (Acrílico, Mica, Opaco), la luz, las webs con
 * sus colores, pestañas y navegación, maximizar, persistencia y lo que gasta cada material.
 *
 *   node tests/windows/zero_windows_native.mjs --motor <carpeta con kitsune.exe> [--out <carpeta>]
 *
 * El motor puede ser uno compilado o uno publicado con el Zero de este repositorio dentro
 * (tools/windows/parchear-motor.ps1). Usa un perfil nuevo cada vez y no toca el de la persona.
 * Escribe resultado.json y capturas (lo que se ve en pantalla, con el material) en --out.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Marionette, makeProfile, launch } from './marionette.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const engine = arg('--motor')
if (!engine || !fs.existsSync(path.join(engine, 'kitsune.exe'))) { console.error('Uso: --motor <carpeta con kitsune.exe>'); process.exit(2) }
const out = arg('--out') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-zero-resultado-'))
fs.mkdirSync(out, { recursive: true })

/** El alfa de un color tal como lo da getComputedStyle (rgb(), rgba() o color(srgb … / a)). */
const alpha = text => { const m = /\/\s*([\d.]+)\s*\)$|rgba\([^)]*,\s*([\d.]+)\)$/.exec(String(text ?? '')); return m ? Number(m[1] ?? m[2]) : 1 }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = null) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FALLA'} ${name}${detail !== null ? ` · ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`) }
const ps = (...args) => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'ventana.ps1'), ...args], { encoding: 'utf8' }).trim()
const dwm = hwnd => JSON.parse(ps('-Hwnd', hwnd, '-Que', 'backdrop'))
const photo = async (hwnd, name) => { ps('-Hwnd', hwnd, '-Que', 'delante'); await sleep(900); return JSON.parse(ps('-Hwnd', hwnd, '-Que', 'foto', '-Png', path.join(out, `${name}.png`))) }

// DWM_SYSTEMBACKDROP_TYPE
const DWMSBT = { 0: 'auto', 1: 'ninguno', 2: 'mica', 3: 'acrilico', 4: 'mica-alt' }

const PREFS = {
  'kitsune.zero.importProfile': false,
  'kitsune.zero.welcomed': true,
  'browser.shell.checkDefaultBrowser': false,
  'browser.aboutwelcome.enabled': false,
  'browser.startup.homepage_override.mstone': 'ignore',
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'browser.sessionstore.resume_from_crash': false,
  'app.update.disabledForTesting': true,
}

const STATE = `
  const win = Services.wm.getMostRecentWindow('navigator:browser');
  if (!win || !win.gBrowser) return null;
  const root = win.document.documentElement;
  const cs = el => (el ? win.getComputedStyle(el) : null);
  const bg = win.document.getElementById('zero-bg');
  const nav = win.document.getElementById('nav-bar');
  const container = win.gBrowser.selectedBrowser?.closest('.browserContainer');
  let hwnd = null;
  try { hwnd = win.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle; } catch {}
  return {
    zero: root.hasAttribute('zero'), material: root.getAttribute('zero-material'), backdrop: root.getAttribute('zero-backdrop'),
    sol: root.getAttribute('zero-sol'), scheme: root.getAttribute('zero-sol-scheme'), variant: root.getAttribute('zero-variant'),
    frameInk: root.hasAttribute('zero-frame-ink'), windowsmica: root.getAttribute('windowsmica'), sizemode: root.getAttribute('sizemode'),
    mica: Services.prefs.getBoolPref('widget.windows.mica', false), micaType: Services.prefs.getIntPref('widget.windows.mica.toplevel-backdrop', 0),
    micaMedia: win.matchMedia('(-moz-windows-mica)').matches,
    pane: win.document.getElementById('zero-pane') ? !win.document.getElementById('zero-pane').hidden : null,
    bgDisplay: cs(bg)?.display, bgColor: cs(bg)?.backgroundColor,
    navColor: cs(nav)?.color, navOpacity: cs(nav)?.opacity, navBackground: cs(nav)?.backgroundImage,
    containerBg: cs(container)?.backgroundColor, rootBg: cs(root).backgroundColor, radius: cs(root).getPropertyValue('--zero-win-radius').trim(),
    solSurface: root.style.getPropertyValue('--sol-surface'), solText: root.style.getPropertyValue('--sol-text'),
    surfaceAlpha: root.style.getPropertyValue('--zero-surface-alpha'), tint: root.style.getPropertyValue('--zero-frame-tint'),
    overrideUser: Services.prefs.prefHasUserValue('layout.css.prefers-color-scheme.content-override'),
    hwnd, dpr: win.devicePixelRatio, tabs: win.gBrowser.tabs.length,
  };`

const ERRORS = `
  return Services.console.getMessageArray()
    .filter(m => m instanceof Ci.nsIScriptError && !(m.flags & Ci.nsIScriptError.warningFlag))
    .filter(m => /zero/i.test(m.sourceName || '') || /Kitsune Zero/.test(m.errorMessage || ''))
    .map(m => (m.errorMessage || '').slice(0, 240) + ' @' + (m.sourceName || '').split('/').pop() + ':' + m.lineNumber);`

const setPrefs = (m, prefs) => m.js(`
  for (const [name, value] of Object.entries(arguments[0])) {
    if (typeof value === 'boolean') Services.prefs.setBoolPref(name, value);
    else Services.prefs.setStringPref(name, String(value));
  }
  return true;`, [prefs])

async function waitFor(m, test, ms = 20000) {
  const until = Date.now() + ms
  let state = null
  while (Date.now() < until) {
    try { state = await m.js(STATE) } catch { state = null }
    if (state && test(state)) return state
    await sleep(250)
  }
  return state
}

/** Si la fila «Fondo» de los ajustes (abiertos desde antes) ofrece «Cristal» ahora; y lo que ofrecía con el material apagado. */
const BACKDROP_OPTIONS = `return (async () => {
  const win = Services.wm.getMostRecentWindow('navigator:browser'); const doc = win.document;
  await new Promise(r => win.setTimeout(r, 600));
  const despues = !!doc.querySelector('#zero-settings [data-pref="backdrop"] [data-value="system"]');
  doc.getElementById('zero-mark').click();
  return { antes: win.zeroCristalAntes, despues };
})();`
/** Pixel de la web (lo que pinta su proceso), para ver que conserva sus colores. */
const PIXEL = `return (async () => {
  const win = Services.wm.getMostRecentWindow('navigator:browser');
  const global = win.gBrowser.selectedBrowser.browsingContext.currentWindowGlobal;
  // Lejos de cualquier texto (en 21,21 cae una letra de «sin fondo»).
  const bitmap = await global.drawSnapshot(new win.DOMRect(600, 400, 4, 4), 1, 'transparent');
  const canvas = new win.OffscreenCanvas(4, 4), ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  return [...ctx.getImageData(1, 1, 1, 1).data];
})();`

const LOAD = `const args = arguments; return (async () => {
  const [url] = args;
  const win = Services.wm.getMostRecentWindow('navigator:browser');
  const browser = win.gBrowser.selectedBrowser;
  try { browser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); }
  catch (error) { return 'error: ' + error; }
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    await new Promise(r => win.setTimeout(r, 150));
    if (browser.currentURI?.spec === url && !browser.webProgress?.isLoadingDocument) return true;
  }
  return browser.currentURI?.spec;
})();`

/** Los procesos de ESTE motor (por su ruta): nunca los de otro Kitsune que la persona tenga abierto. */
function processes() {
  const root = path.resolve(engine).replace(/'/g, "''")
  const text = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `$p = Get-CimInstance Win32_Process -Filter "Name='kitsune.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${root}', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }; ` +
    "[pscustomobject]@{ n = @($p).Count; ws = ($p | Measure-Object WorkingSet64 -Sum).Sum; cpu = ($p | Measure-Object CPU -Sum).Sum } | ConvertTo-Json -Compress"], { encoding: 'utf8' })
  return JSON.parse(text)
}

/** RAM y CPU en reposo: la CPU usada durante `seconds` (en % de un núcleo) y la memoria al final. */
async function idle(seconds = 15, settle = 10) {
  await sleep(settle * 1000)
  const a = processes()
  await sleep(seconds * 1000)
  const b = processes()
  return { procesos: b.n, ramMB: Math.round(b.ws / 1048576), cpuNucleoPct: Math.round((b.cpu - a.cpu) / seconds * 1000) / 10 }
}

let restoreTransparency = null
async function run() {
  const port = 28000 + Math.floor(Math.random() * 1000)
  const profile = makeProfile({ ...PREFS, 'marionette.port': port })
  console.log(`perfil ${profile} · salida ${out}`)
  let child = launch(engine, profile, port, ['-purgecaches'])
  let m = await Marionette.connect(port, { timeout: 60000 })
  await m.session()
  check('Marionette conecta con el motor', true, m.hello)

  let d = null
  let s = await waitFor(m, st => st.zero && st.material !== undefined && st.sol)
  check('la ventana nace en Kitsune Zero', s?.zero, s && { material: s.material, backdrop: s.backdrop, sol: s.sol })
  await m.js(`const w = Services.wm.getMostRecentWindow('navigator:browser'); w.moveTo(120, 90); w.resizeTo(1440, 900); return true;`)
  await sleep(1200)
  s = await m.js(STATE)
  const hwnd = s.hwnd
  check('Gecko da el HWND de la ventana', /^(0x)?[0-9a-f]+$/i.test(String(hwnd ?? '')), hwnd)
  const rect = JSON.parse(ps('-Hwnd', hwnd, '-Que', 'rect'))
  check('rectángulo y DPI de la ventana', rect.width > 0, rect)

  // ---- Las transparencias de Windows: apagadas, Zero va opaco (sin fingir el material); encendidas, Acrílico.
  await setPrefs(m, { 'kitsune.zero.light.mode': 'fixed', 'kitsune.zero.light.period': 'dia' })
  const original = JSON.parse(ps('-Hwnd', '0', '-Que', 'transparencia')).transparencia
  check('«Efectos de transparencia» de Windows al empezar', true, { EnableTransparency: original })
  if (original === 0) {
    s = await waitFor(m, st => st.sol === 'dia' && st.material === 'opaque', 8000)
    d = dwm(hwnd)
    check('con las transparencias de Windows apagadas, Zero va opaco', s.material === 'opaque' && !s.mica && d.backdrop !== 3, { material: s.material, dwm: DWMSBT[d.backdrop] })
    await photo(hwnd, '0-transparencias-apagadas')
    // Los ajustes abiertos con el material apagado: «Fondo» sin «Cristal».
    await m.js(`Services.wm.getMostRecentWindow('navigator:browser').document.getElementById('zero-mark').click(); return true;`)
    await sleep(900)
    await m.js(`const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document; win.zeroCristalAntes = !!doc.querySelector('#zero-settings [data-pref=\"backdrop\"] [data-value=\"system\"]'); return true;`)
    if (!process.argv.includes('--probar-transparencia')) throw new Error('Las transparencias de Windows están apagadas: añade --probar-transparencia para encenderlas durante la prueba (se dejan como estaban)')
    restoreTransparency = original
    ps('-Hwnd', '0', '-Que', 'transparencia', '-Valor', '1')
  }
  // ---- Acrílico (de serie), sin reiniciar: Zero se entera del cambio de Windows
  s = await waitFor(m, st => st.sol === 'dia' && st.material === 'acrylic', 15000)
  if (original === 0) {
    const cristal = await m.js(BACKDROP_OPTIONS)
    check('los ajustes ofrecen «Cristal» al encenderse el material, sin reabrir la ventana', cristal.antes === false && cristal.despues === true, cristal)
  }
  check('de serie, Acrílico', s.material === 'acrylic', s.material)
  check('con Acrílico, el fondo de Zero es el cristal del sistema', s.backdrop === 'system', s.backdrop)
  check('Gecko tiene encendido el material (widget.windows.mica, 2 = Acrílico)', s.mica && s.micaType === 2, { mica: s.mica, tipo: s.micaType, media: s.micaMedia })
  d = dwm(hwnd)
  check('DWM tiene puesto Acrílico en la ventana (DWMWA_SYSTEMBACKDROP_TYPE = 3)', d.backdrop === 3, { ...d, nombre: DWMSBT[d.backdrop] })
  check('la raíz es transparente (deja ver el material)', /rgba\(0, 0, 0, 0\)|transparent/.test(s.rootBg), s.rootBg)
  await sleep(1600) // el tinte llega con una transición (1,2 s)
  s = await m.js(STATE)
  check('el tinte del marco es el blanco del día al 70 %', s.bgDisplay === 'block' && Math.abs(alpha(s.bgColor) - 0.7) < 0.01 && /0\.96078\d* 0\.96862\d* 0\.98039/.test(s.bgColor), { display: s.bgDisplay, color: s.bgColor })
  check('la isla no es transparente entera (opacidad 1: texto e iconos enteros)', s.navOpacity === '1', s.navOpacity)
  check('el texto de la isla es la tinta del día', s.navColor === 'rgb(29, 34, 42)', s.navColor)
  check('la isla lleva la superficie al 85 %', /0\.85/.test(s.navBackground ?? ''), (s.navBackground ?? '').slice(0, 160))
  check('la tarjeta de la web es opaca (alfa 0,996: Gecko la trata como opaca y no se ve nada detrás)', alpha(s.containerBg) >= 0.99, s.containerBg)
  check('sin la lámina WebGL con el material de Windows', s.pane === false || s.pane === null, s.pane)
  check('las webs no reciben un esquema forzado', s.overrideUser === false, s.overrideUser)
  await photo(hwnd, '1-acrilico-dia')
  const acrylicIdle = await idle()
  check('reposo con Acrílico (medido)', true, acrylicIdle)

  // ---- La web conserva sus colores
  const loaded = await m.js(LOAD, ['data:text/html,<title>rojo</title><body style="margin:0;background:%23d03030">'])
  check('navega a una página', loaded === true, loaded)
  const red = await m.js(PIXEL)
  check('una web con fondo propio conserva su color (sin transparencia)', red[0] > 190 && red[1] < 80 && red[3] === 255, red)
  await m.js(LOAD, ['data:text/html,<title>blanco</title><p>sin fondo</p>'])
  const white = await m.js(PIXEL)
  check('una web sin fondo propio sigue siendo blanca y opaca (lo experimental, apagado)', white[0] > 245 && white[3] === 255, white)
  await photo(hwnd, '2-acrilico-web-blanca')

  // ---- Pestañas
  const tabs = await m.js(`
    const win = Services.wm.getMostRecentWindow('navigator:browser');
    const before = win.gBrowser.tabs.length;
    const added = [1, 2, 3].map(() => win.gBrowser.addTrustedTab('about:blank'));
    win.gBrowser.selectedTab = added[1];
    const selected = win.gBrowser.selectedTab === added[1];
    for (const tab of added) win.gBrowser.removeTab(tab, { animate: false });
    return { before, during: before + 3, after: win.gBrowser.tabs.length, selected };`)
  check('pestañas: abrir, cambiar y cerrar', tabs.selected && tabs.after === tabs.before, tabs)

  // ---- Mica
  await setPrefs(m, { 'kitsune.zero.material': 'mica' })
  s = await waitFor(m, st => st.material === 'mica')
  await sleep(500)
  d = dwm(hwnd)
  check('Mica: Gecko (tipo 1) y DWM (DWMWA_SYSTEMBACKDROP_TYPE = 2)', s.micaType === 1 && d.backdrop === 2, { tipo: s.micaType, dwm: DWMSBT[d.backdrop] })
  await photo(hwnd, '3-mica-dia')
  const micaIdle = await idle()
  check('reposo con Mica (medido)', true, micaIdle)

  // ---- Opaco
  await setPrefs(m, { 'kitsune.zero.material': 'opaque' })
  s = await waitFor(m, st => st.material === 'opaque')
  await sleep(500)
  d = dwm(hwnd)
  check('Opaco: Gecko apaga el material', s.mica === false, { mica: s.mica })
  check('Opaco: DWM sin Acrílico ni Mica', d.backdrop !== 2 && d.backdrop !== 3, DWMSBT[d.backdrop])
  check('Opaco: el fondo es la niebla de la luz', s.backdrop === 'mist' && s.bgDisplay === 'block', { backdrop: s.backdrop, color: s.bgColor })
  await photo(hwnd, '4-opaco-dia')
  const opaqueIdle = await idle()
  check('reposo en Opaco (medido)', true, opaqueIdle)

  // ---- La luz: noche, amanecer y atardecer (sin recargar la web)
  await setPrefs(m, { 'kitsune.zero.material': 'auto' })
  const marker = await m.js(`const w = Services.wm.getMostRecentWindow('navigator:browser'); return w.gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.innerWindowId;`)
  for (const period of ['noche', 'amanecer', 'atardecer']) {
    await setPrefs(m, { 'kitsune.zero.light.period': period })
    s = await waitFor(m, st => st.sol === period && st.material === 'acrylic')
    // Si no cambia, en qué se queda: el ajuste, lo que calcula la luz y cuántas ventanas tiene (¿llegó el aviso?).
    const why = s.sol === period ? {} : await m.js(`
      const luz = ChromeUtils.importESModule('chrome://browser/content/zero/zero-luz.sys.mjs'), snap = luz.snapshot();
      return { ajuste: Services.prefs.getStringPref('kitsune.zero.light.mode', '?') + '/' + Services.prefs.getStringPref('kitsune.zero.light.period', '?'),
               calculada: snap.theme?.period ?? null, ventanas: snap.windows, sol: Services.wm.getMostRecentWindow('navigator:browser').document.documentElement.getAttribute('zero-sol') };`)
    check(`${period}: la luz cambia (${s.solSurface})`, s.sol === period, { scheme: s.scheme, variant: s.variant, superficie: s.solSurface, texto: s.solText, ...why })
    if (period === 'noche') {
      check('de noche, oscuro (modo Oscuro en las piezas)', s.scheme === 'dark' && s.variant === 'sobrio', { scheme: s.scheme, variant: s.variant })
      check('de noche, las webs no se oscurecen a la fuerza', s.overrideUser === false, s.overrideUser)
      d = dwm(hwnd)
      check('de noche, DWM sigue con Acrílico', d.backdrop === 3, { ...d })
    }
    await photo(hwnd, `5-acrilico-${period}`)
  }
  const after = await m.js(`const w = Services.wm.getMostRecentWindow('navigator:browser'); return w.gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.innerWindowId;`)
  check('cambiar la luz no recarga la web', marker === after, { antes: marker, despues: after })

  // ---- Del sol, con coordenadas: un temporizador, no un bucle
  await setPrefs(m, { 'kitsune.zero.light.mode': 'solar', 'kitsune.zero.light.coords': '40.4, -3.7' })
  await sleep(500)
  const luz = await m.js(`
    const luz = ChromeUtils.importESModule('chrome://browser/content/zero/zero-luz.sys.mjs');
    const snap = luz.snapshot();
    return { period: snap.theme?.period, source: snap.theme?.source, next: snap.theme?.next, now: Date.now(), timer: snap.timer, sun: snap.theme?.sun };`)
  check('del sol: tema calculado con el sol de Madrid', luz.source === 'solar', luz)
  check('del sol: la próxima mirada está programada (sin bucle)', luz.timer && luz.next > luz.now, { enMinutos: Math.round((luz.next - luz.now) / 60000) })

  // ---- Maximizar y restaurar
  await m.js(`Services.wm.getMostRecentWindow('navigator:browser').maximize(); return true;`)
  s = await waitFor(m, st => st.sizemode === 'maximized', 5000)
  await sleep(700)
  d = dwm(hwnd)
  check('maximizada: esquinas rectas y el material sigue', s.sizemode === 'maximized' && s.radius === '0px' && d.backdrop === 3, { radius: s.radius, dwm: DWMSBT[d.backdrop] })
  await photo(hwnd, '6-maximizada')
  await m.js(`Services.wm.getMostRecentWindow('navigator:browser').restore(); return true;`)
  s = await waitFor(m, st => st.sizemode === 'normal', 5000)
  check('restaurada: esquinas de Windows 11 (8 px)', s.radius === '8px', s.radius)

  // ---- Los ajustes: la sección «Luz y material»
  await setPrefs(m, { 'kitsune.zero.light.mode': 'fixed', 'kitsune.zero.light.period': 'dia' })
  const panel = await m.js(`return (async () => {
    const win = Services.wm.getMostRecentWindow('navigator:browser');
    const doc = win.document;
    (doc.querySelector('#zero-mark') ?? doc.querySelector('[data-action="settings"]'))?.click();
    await new Promise(r => win.setTimeout(r, 900));
    const settings = doc.getElementById('zero-settings');
    const rows = [...(settings?.querySelectorAll('[data-pref]') ?? [])].map(el => el.dataset.pref);
    const bg = settings ? win.getComputedStyle(settings).backgroundColor : null;
    return { open: !!settings && settings.getBoundingClientRect().height > 50, rows, bg };
  })();`)
  check('los ajustes enseñan Luz, Material, Superficies y Tinte', ['light.mode', 'material', 'surface.opacity', 'surface.tint'].every(id => panel.rows.includes(id)),
    { abiertos: panel.open, filas: panel.rows.filter(id => /light|material|surface|web\./.test(id)), fondo: panel.bg })
  await photo(hwnd, '7-ajustes')
  await m.js(`const doc = Services.wm.getMostRecentWindow('navigator:browser').document; doc.documentElement.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true;`)

  const errors = await m.js(ERRORS)
  check('sin errores de Zero en la consola', errors.length === 0, errors)

  // ---- Persistencia: Mica y el atardecer, después de reiniciar
  await setPrefs(m, { 'kitsune.zero.material': 'mica', 'kitsune.zero.light.mode': 'fixed', 'kitsune.zero.light.period': 'atardecer' })
  await m.js(`Services.prefs.savePrefFile(null); return true;`)
  await m.send('Marionette:Quit', { flags: ['eForceQuit'] }).catch(() => {})
  m.close()
  await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 15000) })
  await sleep(1500)
  child = launch(engine, profile, port)
  m = await Marionette.connect(port, { timeout: 60000 })
  await m.session()
  s = await waitFor(m, st => st.zero && st.material && st.sol)
  const d2 = dwm(s.hwnd)
  check('tras reiniciar: Mica y el atardecer siguen', s.material === 'mica' && s.sol === 'atardecer' && d2.backdrop === 2, { material: s.material, sol: s.sol, dwm: DWMSBT[d2.backdrop] })
  const errors2 = await m.js(ERRORS)
  check('tras reiniciar, sin errores de Zero', errors2.length === 0, errors2)
  await m.send('Marionette:Quit', { flags: ['eForceQuit'] }).catch(() => {})
  m.close()
  await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 15000) })
  check('Kitsune Zero se cierra', true)

  const summary = { motor: engine, perfil: profile, salida: out, fecha: new Date().toISOString(), reposo: { acrilico: acrylicIdle, mica: micaIdle, opaco: opaqueIdle }, resultados: results }
  fs.writeFileSync(path.join(out, 'resultado.json'), JSON.stringify(summary, null, 2))
  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} bien · ${out}`)
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* el motor aún lo tiene abierto */ }
  process.exit(failed.length ? 1 : 0)
}

const restore = () => {
  if (restoreTransparency === null) return
  try { ps('-Hwnd', '0', '-Que', 'transparencia', '-Valor', String(restoreTransparency)); console.log(`transparencias de Windows, como estaban (${restoreTransparency})`) } catch (error) { console.error('No se pudo devolver EnableTransparency', error.message) }
  restoreTransparency = null
}
process.on('exit', restore)
run().catch(error => {
  restore()
  console.error(error?.message ?? error)
  fs.writeFileSync(path.join(out, 'resultado.json'), JSON.stringify({ error: String(error?.stack ?? error), resultados: results }, null, 2))
  process.exit(1)
})
