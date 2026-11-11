#!/usr/bin/env node
/* La luz del día de Kitsune Zero (zero/modules/zero-sol.mjs) para cualquier otro programa: escribe el tema de ahora en
 * JSON (o en variables CSS), sin servicios ni procesos que se queden abiertos. Ver docs/zero/luz.md.
 *
 *   node tools/sol/sol.mjs                                   el tema de ahora, por la hora (07:30–19:30)
 *   node tools/sol/sol.mjs --coords "40.4, -3.7"             con el sol de esas coordenadas
 *   node tools/sol/sol.mjs --modo clock --salida 07:00 --puesta 20:15
 *   node tools/sol/sol.mjs --modo fixed --periodo noche
 *   node tools/sol/sol.mjs --css                             variables CSS (--sol-*) en lugar de JSON
 *   node tools/sol/sol.mjs --escribir C:\ruta\luz.json       al archivo (se reemplaza entero: nadie lo lee a medias)
 *   node tools/sol/sol.mjs --a-las 2026-11-11T18:30          otro momento (pruebas)
 *   node tools/sol/sol.mjs --config luz.json                 { mode, latitude, longitude, sunrise, sunset, period,
 *                                                             transition, step, palettes } (las opciones lo pisan)
 *
 * Termina con 0 y, en «next» del JSON, dice cuándo merece la pena volver a llamarlo.
 */
import fs from 'node:fs'
import path from 'node:path'
import { themeAt, exportTheme, cssVars, parseCoords } from '../../zero/modules/zero-sol.mjs'

const argv = process.argv.slice(2)
const option = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const flag = name => argv.includes(name)

if (flag('--ayuda') || flag('--help')) {
  const text = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 17).map(l => l.replace(/^ \*? ?/, '')).join('\n')
  console.log(text)
  process.exit(0)
}

let config = {}
if (option('--config')) config = JSON.parse(fs.readFileSync(option('--config'), 'utf8'))
const coords = option('--coords') ? parseCoords(option('--coords')) : null
if (option('--coords') && !coords) { console.error('Coordenadas no válidas: "lat, lon" (p. ej. "40.4, -3.7")'); process.exit(2) }
if (coords) Object.assign(config, coords, { mode: config.mode ?? 'solar' })
if (option('--modo')) config.mode = option('--modo')
if (option('--salida')) config.sunrise = option('--salida')
if (option('--puesta')) config.sunset = option('--puesta')
if (option('--periodo')) config.period = option('--periodo')
if (option('--transicion')) config.transition = Number(option('--transicion'))
if (!config.mode) config.mode = 'clock'

const at = option('--a-las') ? new Date(option('--a-las')) : new Date()
if (Number.isNaN(+at)) { console.error('Fecha no válida en --a-las'); process.exit(2) }
const theme = themeAt(at, config)

const text = flag('--css')
  ? `:root {\n${Object.entries(cssVars(theme)).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n  color-scheme: ${theme.scheme};\n}\n`
  : `${JSON.stringify(exportTheme(theme), null, 2)}\n`

const target = option('--escribir')
if (target) {
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, target)
} else {
  process.stdout.write(text)
}
