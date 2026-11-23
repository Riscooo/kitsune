/* Firmar las versiones de Kitsune (Ed25519): sin la firma, Kitsune no se actualiza solo.
 *
 *   node tools/firmar.mjs crear                        crea las dos claves (la de siempre y la de reserva) y dice las públicas
 *   node tools/firmar.mjs firmar <SHA256SUMS.txt>      deja al lado SHA256SUMS.txt.firma (se sube con la versión)
 *   node tools/firmar.mjs comprobar <SHA256SUMS.txt>   mira la firma con las claves que lleva el actualizador
 *   node tools/firmar.mjs exportar <archivo>           guarda las claves en un archivo con contraseña (para un pendrive)
 *   node tools/firmar.mjs importar <archivo>           las trae (a otro ordenador, o tras reinstalar)
 *
 * Las privadas no están en el repositorio: van en ~/.kitsune-firma. En Windows, cifradas con la cuenta (DPAPI): si se
 * reinstala, solo valen las del archivo exportado. En los demás, un archivo que solo lee su dueño.
 * Con --reserva, firmar usa la de reserva (si se pierde o se filtra la de siempre: se firma con ella una versión que cambie
 * las claves de install/native/kitsune-updater.sys.mjs).
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { CLAVES, MARCA_FIRMA, firmaBuena } from '../install/native/kitsune-updater.sys.mjs'

const CARPETA = process.env.KITSUNE_FIRMA_CARPETA ?? path.join(os.homedir(), '.kitsune-firma')
const ARCHIVO = { siempre: path.join(CARPETA, 'clave.bin'), reserva: path.join(CARPETA, 'clave-reserva.bin') }
const windows = process.platform === 'win32'
const ps = (orden, datos) => Buffer.from(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `Add-Type -AssemblyName System.Security; $b = [Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${orden}($b, $null, 'CurrentUser'))`],
{ input: datos.toString('base64'), encoding: 'utf8' }).trim(), 'base64')
const proteger = datos => (windows ? ps('Protect', datos) : datos)
const desproteger = datos => (windows ? ps('Unprotect', datos) : datos)

function guardar(cual, privada) {
  fs.mkdirSync(CARPETA, { recursive: true, mode: 0o700 })
  if (fs.existsSync(ARCHIVO[cual])) throw new Error(`Ya hay una clave en ${ARCHIVO[cual]}: no se pisa`)
  fs.writeFileSync(ARCHIVO[cual], proteger(privada.export({ type: 'pkcs8', format: 'der' })), { mode: 0o600 })
}
const leer = cual => crypto.createPrivateKey({ key: desproteger(fs.readFileSync(ARCHIVO[cual])), type: 'pkcs8', format: 'der' })
/** La pública, en hexadecimal, como va en el actualizador. */
export const publica = privada => crypto.createPublicKey(privada).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')
export const firmarTexto = (texto, privada) => crypto.sign(null, Buffer.from(MARCA_FIRMA + texto, 'utf8'), privada).toString('base64')

function preguntar(texto) {
  const r = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(listo => r.question(texto, v => { r.close(); listo(v) }))
}

async function main([orden, archivo, ...resto]) {
  const cual = resto.includes('--reserva') ? 'reserva' : 'siempre'
  switch (orden) {
    case 'crear':
      for (const una of ['siempre', 'reserva']) {
        const { privateKey } = crypto.generateKeyPairSync('ed25519')
        guardar(una, privateKey)
        console.log(`${una}: ${publica(privateKey)}`)
      }
      break
    case 'publicas':
      for (const una of ['siempre', 'reserva']) if (fs.existsSync(ARCHIVO[una])) console.log(`${una}: ${publica(leer(una))}`)
      break
    case 'firmar': {
      const privada = leer(cual), texto = fs.readFileSync(archivo, 'utf8')
      if (!CLAVES.includes(publica(privada))) throw new Error('Esa clave no está en el actualizador: Kitsune no aceptaría la firma')
      fs.writeFileSync(`${archivo}.firma`, firmarTexto(texto, privada) + '\n')
      if (!await firmaBuena(texto, fs.readFileSync(`${archivo}.firma`, 'utf8'))) throw new Error('La firma no se comprueba')
      console.log(`Firmado: ${archivo}.firma`)
      break
    }
    case 'comprobar': {
      const bien = await firmaBuena(fs.readFileSync(archivo, 'utf8'), fs.readFileSync(`${archivo}.firma`, 'utf8'))
      console.log(bien ? 'La firma es buena' : 'LA FIRMA NO VALE')
      process.exitCode = bien ? 0 : 1
      break
    }
    case 'exportar': {
      const clave = await preguntar('Contraseña para el archivo (apúntala: sin ella no sirve): ')
      if ([...clave].length < 10) throw new Error('Al menos 10 caracteres')
      const sal = crypto.randomBytes(16), iv = crypto.randomBytes(12)
      const c = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(clave, sal, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 2 ** 28 }), iv)
      const dentro = JSON.stringify(Object.fromEntries(Object.keys(ARCHIVO).filter(k => fs.existsSync(ARCHIVO[k])).map(k => [k, leer(k).export({ type: 'pkcs8', format: 'der' }).toString('base64')])))
      const datos = Buffer.concat([c.update(dentro, 'utf8'), c.final()])
      fs.writeFileSync(archivo, JSON.stringify({ kitsune: 'firma', v: 1, sal: sal.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), datos: datos.toString('base64') }), { mode: 0o600 })
      console.log(`Guardado en ${archivo}`)
      break
    }
    case 'importar': {
      const f = JSON.parse(fs.readFileSync(archivo, 'utf8')), b = x => Buffer.from(x, 'base64')
      const clave = await preguntar('Contraseña del archivo: ')
      const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(clave, b(f.sal), 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 2 ** 28 }), b(f.iv))
      d.setAuthTag(b(f.tag))
      const claves = JSON.parse(Buffer.concat([d.update(b(f.datos)), d.final()]).toString('utf8'))
      for (const [k, v] of Object.entries(claves)) if (k in ARCHIVO) guardar(k, crypto.createPrivateKey({ key: b(v), type: 'pkcs8', format: 'der' }))
      console.log('Traídas')
      break
    }
    default:
      console.error('Uso: node tools/firmar.mjs crear | firmar <archivo> [--reserva] | comprobar <archivo> | exportar <archivo> | importar <archivo>')
      process.exitCode = 2
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
