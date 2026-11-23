/* Revisión visual de Kitsune Zero en Windows 11: cada panel de Zero con cada luz, capturado de la pantalla (con el
 * material de DWM detrás). No comprueba nada solo: deja hojas para mirarlas (una por panel, con las luces en fila).
 *
 *   node tests/windows/zero_capturas.mjs --motor <carpeta con kitsune.exe> --out <carpeta> [--luces dia,atardecer,noche]
 *        [--probar-transparencia]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Marionette, makeProfile, launch } from './marionette.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const engine = arg('--motor'), out = arg('--out')
const lights = (arg('--luces') ?? 'dia,atardecer,noche').split(',')
const only = arg('--paneles')?.split(',') ?? null
if (!engine || !out) { console.error('Uso: --motor <carpeta> --out <carpeta>'); process.exit(2) }
fs.mkdirSync(out, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ventana = (...a) => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'ventana.ps1'), ...a], { encoding: 'utf8' }).trim()
const pantalla = (...a) => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(process.env.USERPROFILE, '.claude', 'skills', 'pantalla', 'pantalla.ps1'), ...a], { encoding: 'utf8' }).trim()

let restore = null
const done = () => { if (restore !== null) { ventana('-Hwnd', '0', '-Que', 'transparencia', '-Valor', String(restore)); restore = null } }
process.on('exit', done)
if (JSON.parse(ventana('-Hwnd', '0', '-Que', 'transparencia')).transparencia === 0 && process.argv.includes('--probar-transparencia')) {
  restore = 0
  ventana('-Hwnd', '0', '-Que', 'transparencia', '-Valor', '1')
}

const port = 24000 + Math.floor(Math.random() * 900)
const profile = makeProfile({ 'kitsune.zero.importProfile': false, 'kitsune.zero.welcomed': true, 'marionette.port': port, 'app.update.disabledForTesting': true,
  'browser.shell.checkDefaultBrowser': false, 'kitsune.zero.light.mode': 'fixed' })
launch(engine, profile, port)
const m = await Marionette.connect(port, { timeout: 60000 })
await m.session()
await sleep(9000)
const W = `const win = Services.wm.getMostRecentWindow('navigator:browser'); const doc = win.document;`
await m.js(`${W} win.moveTo(120, 90); win.resizeTo(1440, 900); return true;`)
await sleep(800)
const hwnd = await m.js(`${W} return win.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle;`)
const screen = await m.js(`${W} return { x: win.mozInnerScreenX, y: win.mozInnerScreenY, k: win.devicePixelRatio };`)
const shot = async name => { ventana('-Hwnd', hwnd, '-Que', 'delante'); await sleep(700); ventana('-Hwnd', hwnd, '-Que', 'foto', '-Png', path.join(out, `${name}.png`)) }
const escape = () => m.js(`${W} for (const t of [doc.documentElement, doc.activeElement]) t?.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); doc.getElementById('zero-mark')?.removeAttribute('open'); return true;`)
const click = selector => m.js(`${W} const el = doc.querySelector(arguments[0]); if (!el) return false; el.click(); return true;`, [selector])
/** El ratón de verdad encima de un elemento (para lo que se abre al pasar por encima). */
const hover = async selector => {
  const r = await m.js(`${W} const el = doc.querySelector(arguments[0]); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };`, [selector])
  if (!r) return false
  pantalla('-Que', 'mover', '-X', String(Math.round((screen.x + r.x) * screen.k)), '-Y', String(Math.round((screen.y + r.y) * screen.k)))
  return true
}
const away = () => pantalla('-Que', 'mover', '-X', String(Math.round((screen.x + 900) * screen.k)), '-Y', String(Math.round((screen.y + 500) * screen.k)))

// Una web con algo de contenido, para que la isla y la tarjeta tengan algo que enseñar.
const page = 'data:text/html;charset=utf-8,<title>Una web</title><body style="font:16px system-ui;margin:48px;max-width:760px"><h1>Una web cualquiera</h1><p>Texto de prueba para ver la isla, la tarjeta y las sugerencias sobre una página normal.</p></body>'
await m.js(`${W} win.gBrowser.selectedBrowser.fixupAndLoadURIString(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); return true;`, [page])
await sleep(1500)

const panels = [
  ['base', async () => {}],
  ['perfiles', () => click('#zero-profile .zero-profile-bubble')],
  ['musica', () => click('#zero-music-pill .zero-music')],
  ['sonido', () => click('#zero-music-pill .zero-sound-button')],
  ['estadisticas', () => click('#zero-stats-pill .zero-stats-button')],
  ['lobo', () => click('#zero-wolf')],
  ['ajustes', () => click('#zero-mark')],
  ['raíl', () => hover('#zero-rail .zero-item')],
  ['sugerencias', async () => { await m.js(`${W} win.gURLBar.focus(); win.gURLBar.value = ''; return true;`); ventana('-Hwnd', hwnd, '-Que', 'delante'); pantalla('-Que', 'escribir', '-Texto', 'kitsune') }],
]
for (const light of lights) {
  await m.js(`Services.prefs.setStringPref('kitsune.zero.light.period', arguments[0]); return true;`, [light])
  await sleep(1800)
  for (const [name, open] of panels) {
    if (only && !only.includes(name)) continue
    await open()
    await sleep(900)
    await shot(`${name}-${light}`)
    await escape(); away()
    if (name === 'lobo' || name === 'musica' || name === 'estadisticas' || name === 'perfiles' || name === 'sonido') await click(name === 'lobo' ? '#zero-wolf' : '#zero-dock') // por si no se cierra con Esc
    await m.js(`${W} win.gURLBar.blur?.(); win.gBrowser.selectedBrowser.focus(); return true;`)
    await sleep(500)
    console.log(light, name)
  }
}
const errors = await m.js(`return Services.console.getMessageArray().filter(m => m instanceof Ci.nsIScriptError && !(m.flags & Ci.nsIScriptError.warningFlag) && /zero/i.test(m.sourceName || '')).map(m => m.errorMessage.slice(0, 200) + ' @' + (m.sourceName || '').split('/').pop() + ':' + m.lineNumber);`)
console.log('errores de Zero:', JSON.stringify(errors))
await m.send('Marionette:Quit', { flags: ['eForceQuit'] }).catch(() => {})
m.close()
done()

// Una hoja por panel: las luces en fila, cada una a 900 px de ancho.
const sheets = `
Add-Type -AssemblyName System.Drawing
$out = '${out.replace(/'/g, "''")}'
$lights = @(${lights.map(l => `'${l}'`).join(',')})
foreach ($panel in @(${panels.map(([n]) => `'${n}'`).join(',')})) {
  $imgs = foreach ($l in $lights) { $f = Join-Path $out "$panel-$l.png"; if (Test-Path $f) { [System.Drawing.Image]::FromFile($f) } }
  if (-not $imgs) { continue }
  $w = 900; $h = [int]($imgs[0].Height * $w / $imgs[0].Width)
  $sheet = New-Object System.Drawing.Bitmap ($w * $imgs.Count), $h
  $g = [System.Drawing.Graphics]::FromImage($sheet); $g.InterpolationMode = 'HighQualityBicubic'
  for ($i = 0; $i -lt $imgs.Count; $i++) { $g.DrawImage($imgs[$i], $i * $w, 0, $w, $h); $imgs[$i].Dispose() }
  $sheet.Save((Join-Path $out "hoja-$panel.png"), [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $sheet.Dispose()
}`
execFileSync('powershell.exe', ['-NoProfile', '-Command', sheets], { encoding: 'utf8' })
console.log(`hojas en ${out}`)
