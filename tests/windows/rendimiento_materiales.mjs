/* Lo que cuesta cada material de Kitsune Zero en Windows 11, en reposo con una web quieta: CPU de los procesos del motor
 * (solo los de este motor, por su ruta), CPU de dwm.exe (el compositor, que es quien desenfoca) y uso de la GPU de los
 * procesos del motor (contadores «GPU Engine» de Windows).
 *
 *   node tests/windows/rendimiento_materiales.mjs --motor <carpeta con kitsune.exe> [--rondas 2] [--probar-transparencia]
 *
 * Con las transparencias de Windows apagadas, Acrílico y Mica no se pueden medir (Zero va opaco): --probar-transparencia
 * las enciende durante la prueba y las deja como estaban.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Marionette, makeProfile, launch } from './marionette.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const engine = path.resolve(arg('--motor') ?? '')
const rounds = Number(arg('--rondas') ?? 2)
if (!fs.existsSync(path.join(engine, 'kitsune.exe'))) { console.error('Uso: --motor <carpeta con kitsune.exe>'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const pwsh = command => execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim()
const ventana = (...args) => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'ventana.ps1'), ...args], { encoding: 'utf8' }).trim()

const root = engine.replace(/'/g, "''")
const SAMPLE = `
$ids = @(Get-CimInstance Win32_Process -Filter "Name='kitsune.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${root}', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.ProcessId })
$cpu = (Get-Process -Id $ids -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum
$dwm = 0; try { $dwm = [double](Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "Name='dwm'" -ErrorAction Stop).PercentProcessorTime } catch {}
$gpu = 0
try {
  $samples = (Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop).CounterSamples
  foreach ($s in $samples) { foreach ($id in $ids) { if ($s.InstanceName -like "pid_$($id)_*") { $gpu += $s.CookedValue } } }
} catch {}
[pscustomobject]@{ cpu = $cpu; dwm = $dwm; gpu = [math]::Round($gpu, 2); n = $ids.Count } | ConvertTo-Json -Compress`

async function measure(seconds = 20) {
  const a = JSON.parse(pwsh(SAMPLE))
  const samples = []
  for (let i = 0; i < seconds / 5; i += 1) { await sleep(5000); samples.push(JSON.parse(pwsh(SAMPLE))) }
  const b = JSON.parse(pwsh(SAMPLE))
  const pct = (x, y) => Math.round((y - x) / seconds * 1000) / 10
  const avg = list => Math.round(list.reduce((s, g) => s + g, 0) / list.length * 10) / 10
  // dwm: su % de CPU de WMI (Win32_PerfFormattedData_PerfProc_Process: el mismo en cualquier idioma de Windows), en cada muestra.
  return { motorCpu: pct(a.cpu, b.cpu), dwmCpu: avg(samples.map(x => x.dwm)), motorGpu: avg(samples.map(x => x.gpu)) }
}

let restore = null
const done = () => { if (restore !== null) { ventana('-Hwnd', '0', '-Que', 'transparencia', '-Valor', String(restore)); restore = null } }
process.on('exit', done)

const original = JSON.parse(ventana('-Hwnd', '0', '-Que', 'transparencia')).transparencia
if (original === 0) {
  if (!process.argv.includes('--probar-transparencia')) { console.error('Las transparencias de Windows están apagadas: añade --probar-transparencia'); process.exit(2) }
  restore = 0
  ventana('-Hwnd', '0', '-Que', 'transparencia', '-Valor', '1')
}

const port = 27000 + Math.floor(Math.random() * 900)
// Sin el actualizador (un perfil nuevo puede bajar una versión y reiniciarse en mitad de la medida).
const profile = makeProfile({ 'kitsune.zero.importProfile': false, 'kitsune.zero.welcomed': true, 'marionette.port': port, 'browser.shell.checkDefaultBrowser': false,
  'app.update.disabledForTesting': true, 'datareporting.policy.dataSubmissionEnabled': false,
  'kitsune.zero.light.mode': 'fixed', 'kitsune.zero.light.period': 'dia' })
launch(engine, profile, port)
const m = await Marionette.connect(port, { timeout: 60000 })
await m.session()
await sleep(20000) // que acabe lo del arranque
await m.js(`return (async () => {
  const win = Services.wm.getMostRecentWindow('navigator:browser');
  win.moveTo(120, 90); win.resizeTo(1440, 900);
  const url = 'data:text/html,<title>quieta</title><body style="font:16px sans-serif;padding:40px">Una web quieta.</body>';
  win.gBrowser.selectedBrowser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  await new Promise(r => win.setTimeout(r, 2000));
  return true;
})();`)
const results = {}
for (let round = 0; round < rounds; round += 1) {
  for (const material of ['opaque', 'acrylic', 'mica']) {
    await m.js(`Services.prefs.setStringPref('kitsune.zero.material', arguments[0]); return true;`, [material])
    await sleep(12000)
    const value = await measure(20)
    ;(results[material] ??= []).push(value)
    console.log(material, round + 1, JSON.stringify(value))
  }
}
const ram = JSON.parse(pwsh(`$ids = @(Get-CimInstance Win32_Process -Filter "Name='kitsune.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${root}', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.ProcessId }); [pscustomobject]@{ mb = [math]::Round((Get-Process -Id $ids | Measure-Object WorkingSet64 -Sum).Sum / 1MB) } | ConvertTo-Json -Compress`))
await m.send('Marionette:Quit', { flags: ['eForceQuit'] }).catch(() => {})
m.close()
done()
const mean = list => Math.round(list.reduce((s, x) => s + x, 0) / list.length * 10) / 10
const summary = Object.fromEntries(Object.entries(results).map(([k, list]) => [k, {
  motorCpuPct: mean(list.map(x => x.motorCpu)), dwmCpuPct: mean(list.map(x => x.dwmCpu)), motorGpuPct: mean(list.map(x => x.motorGpu)),
}]))
console.log(JSON.stringify({ resumen: summary, ramMBalFinal: ram.mb, nota: 'CPU en % de un núcleo; GPU en % de uso de los motores de la GPU por los procesos del motor' }, null, 2))
