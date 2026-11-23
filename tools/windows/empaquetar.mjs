/* Rehace el instalador de Kitsune Zero para Windows con lo que hay en el repositorio, sin compilar Gecko: parte del instalador
 * de la versión anterior (el mismo Gecko) y cambia solo lo que va en browser/omni.ja, el número de versión y el BuildID.
 *
 *   node tools/windows/empaquetar.mjs --desde <instalador anterior.exe> --salida <carpeta> [--trabajo <carpeta>]
 *
 * - En browser/omni.ja: zero/, las hojas de chrome/ y los módulos de install/native que ya lleva.
 * - defaults/pref: kitsune.release, la de install/version.json.
 * - kitsune.exe: su BuildID, un segundo más. Gecko tira las cachés del perfil cuando cambia; sin eso seguiría corriendo el
 *   Zero viejo (comprobado en la 0.8.0-beta.7).
 * - Se comprueba que no cambia nada más, archivo por archivo.
 * Vale mientras no cambie Gecko, la receta (install/recipe) ni lo compilado: si cambian, hace falta compilar
 * (install/kitsune-engine.py). Necesita 7-Zip. Al terminar, firma la lista con tools/firmar.mjs, si está la clave.
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const desde = arg('--desde'), salida = arg('--salida')
if (!desde || !salida) { console.error('Uso: --desde <instalador anterior.exe> --salida <carpeta>'); process.exit(2) }
const SIETE = ['C:/Program Files/7-Zip/7z.exe', '/usr/bin/7z'].find(p => fs.existsSync(p)) ?? '7z'
const siete = (args, opciones = {}) => execFileSync(SIETE, args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...opciones })
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const { release } = JSON.parse(fs.readFileSync(path.join(REPO, 'install/version.json'), 'utf8'))
const trabajo = arg('--trabajo') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-paquete-'))
if (fs.existsSync(trabajo) && fs.readdirSync(trabajo).some(n => !['antes', 'antes.7z', 'nuevo', 'omni', 'app.7z'].includes(n))) throw new Error(`${trabajo} tiene otras cosas: elige una carpeta vacía`)
fs.rmSync(trabajo, { recursive: true, force: true })
fs.mkdirSync(trabajo, { recursive: true })
fs.mkdirSync(salida, { recursive: true })

// El instalador: un programa que se descomprime solo, con su 7z pegado detrás.
const exe = fs.readFileSync(desde)
const firma7z = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
let corte = -1
for (let i = exe.indexOf(firma7z); i >= 0; i = exe.indexOf(firma7z, i + 1)) { if (exe[i + 6] === 0) { corte = i; break } }
if (corte < 0) throw new Error('No parece el instalador de Kitsune')
fs.writeFileSync(path.join(trabajo, 'antes.7z'), exe.subarray(corte))
const antes = path.join(trabajo, 'antes'), nuevo = path.join(trabajo, 'nuevo')
siete(['x', '-y', '-bso0', '-bsp0', `-o${antes}`, path.join(trabajo, 'antes.7z')])
fs.cpSync(antes, nuevo, { recursive: true })

// browser/omni.ja
const omni = path.join(nuevo, 'core/browser/omni.ja')
const dentro = siete(['l', '-ba', '-slt', omni], {}).split(/\r?\n/).filter(l => l.startsWith('Path = ')).map(l => l.slice(7).replaceAll('\\', '/'))
const puesta = path.join(trabajo, 'omni'), BASE = 'chrome/browser/content/browser'
const poner = (de, a) => { const t = path.join(puesta, a); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(de, t) }
const archivos = d => fs.readdirSync(path.join(REPO, d), { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name)
for (const parte of ['modules', 'chrome', 'assets']) for (const n of archivos(`zero/${parte}`)) poner(path.join(REPO, 'zero', parte, n), `${BASE}/zero/${n}`)
for (const n of archivos('chrome').filter(n => n.endsWith('.css') && dentro.includes(`${BASE}/kitsune-chrome/${n}`))) poner(path.join(REPO, 'chrome', n), `${BASE}/kitsune-chrome/${n}`)
const nativos = archivos('install/native').filter(n => dentro.includes(`${BASE}/${n}`))
if (nativos.length < 15) throw new Error(`En omni.ja solo hay ${nativos.length} módulos de Kitsune: ¿han cambiado de sitio?`)
for (const n of nativos) poner(path.join(REPO, 'install/native', n), `${BASE}/${n}`)
siete(['u', '-tzip', '-mx=5', '-bso0', '-bsp0', omni, 'chrome'], { cwd: puesta })

// La versión
const pref = path.join(nuevo, 'core/defaults/pref')
const deVersion = fs.readdirSync(pref).filter(n => fs.readFileSync(path.join(pref, n), 'utf8').includes('"kitsune.release"'))
if (deVersion.length !== 1) throw new Error('No encuentro kitsune.release')
const viejaVersion = /"kitsune\.release", "([^"]+)"/.exec(fs.readFileSync(path.join(pref, deVersion[0]), 'utf8'))[1]
fs.writeFileSync(path.join(pref, deVersion[0]), fs.readFileSync(path.join(pref, deVersion[0]), 'utf8').replaceAll(viejaVersion, release))

// El BuildID
const programa = path.join(nuevo, 'core/kitsune.exe'), bytes = fs.readFileSync(programa)
const ids = [...new Set([...bytes.toString('latin1').matchAll(/(?<!\d)20\d{12}(?!\d)/g)].map(m => m[0]))]
if (ids.length !== 1) throw new Error(`BuildID: ${ids}`)
const [id] = ids, f = id.match(/(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/).slice(1).map(Number)
const d = new Date(Date.UTC(f[0], f[1] - 1, f[2], f[3], f[4], f[5] + 1))
const siguiente = d.toISOString().replace(/\D/g, '').slice(0, 14)
for (let i = bytes.indexOf(id, 0, 'latin1'); i >= 0; i = bytes.indexOf(id, i + 1, 'latin1')) bytes.write(siguiente, i, 'latin1')
fs.writeFileSync(programa, bytes)

// Nada más ha cambiado.
const lista = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? lista(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).replaceAll('\\', '/')]))
const A = lista(antes).sort(), B = lista(nuevo).sort()
if (A.join() !== B.join()) throw new Error('Han cambiado los archivos del instalador')
const cambian = A.filter(n => sha(path.join(antes, n)) !== sha(path.join(nuevo, n)))
const esperados = ['core/browser/omni.ja', `core/defaults/pref/${deVersion[0]}`, 'core/kitsune.exe']
if (cambian.sort().join() !== esperados.sort().join()) throw new Error(`Cambian ${cambian}`)

// Otra vez el instalador, con la misma compresión que usa Mozilla (la que sabe abrir su programa).
const app = path.join(trabajo, 'app.7z')
siete(['a', '-r', '-t7z', '-bso0', '-bsp0', app, '-mx', '-m0=BCJ2', '-m1=LZMA:d25', '-m2=LZMA:d19', '-m3=LZMA:d19', '-mb0:1', '-mb0s1:2', '-mb0s2:3', '.'], { cwd: nuevo })
const nombre = `Kitsune-Zero-${release}-Windows-x64.exe`, final = path.join(salida, nombre)
fs.writeFileSync(final, Buffer.concat([exe.subarray(0, corte), fs.readFileSync(app)]))
siete(['t', '-bso0', '-bsp0', final])
const sumas = path.join(salida, 'SHA256SUMS.txt')
// Si en la carpeta ya hay lista (la de otros paquetes de esta versión), solo cambia la línea de este.
const otras = fs.existsSync(sumas) ? fs.readFileSync(sumas, 'utf8').split(/\r?\n/).filter(l => l.trim() && l.trim().split(/\s+/)[1] !== nombre) : []
fs.writeFileSync(sumas, [...otras, `${sha(final)}  ${nombre}`].join('\n') + '\n')
console.log(`${nombre} · ${(fs.statSync(final).size / 1048576).toFixed(1)} MB · ${viejaVersion} → ${release} · BuildID ${id} → ${siguiente}`)
console.log(`Cambian ${cambian.length} archivos: ${cambian.join(', ')} (Zero y ${nativos.length} módulos de Kitsune)`)
try { console.log(execFileSync(process.execPath, [path.join(REPO, 'tools/firmar.mjs'), 'firmar', sumas], { encoding: 'utf8' }).trim()) } catch (error) { console.log(`SIN FIRMAR: ${String(error.stderr ?? error.message).trim()}`) }
console.log(`Motor para probar: ${path.join(nuevo, 'core')}`)
