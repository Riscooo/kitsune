/* Un cliente mínimo de Marionette (el protocolo de pruebas de Gecko), sin dependencias: arrancar el motor con un perfil
 * nuevo, hablarle por TCP y ejecutar código en el contexto chrome. Para las pruebas nativas de Windows
 * (zero_windows_native.mjs), donde no hay Python ni geckodriver de serie.
 *
 * Protocolo 3: cada mensaje es «longitud:json»; una orden es [0, id, nombre, parámetros] y su respuesta [1, id,
 * error, resultado].
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export class Marionette {
  constructor(socket) {
    this.socket = socket
    this.buffer = Buffer.alloc(0)
    this.id = 0
    this.pending = new Map()
    this.hello = null
    socket.on('data', chunk => this.#read(chunk))
    socket.on('error', error => { for (const { reject } of this.pending.values()) reject(error); this.pending.clear() })
    socket.on('close', () => { for (const { reject } of this.pending.values()) reject(new Error('Marionette cerró la conexión')); this.pending.clear() })
  }

  static async connect(port, { timeout = 30000 } = {}) {
    const until = Date.now() + timeout
    for (;;) {
      try {
        const socket = await new Promise((resolve, reject) => {
          const s = net.connect(port, '127.0.0.1', () => resolve(s))
          s.once('error', reject)
        })
        const client = new Marionette(socket)
        await client.#waitHello(5000)
        return client
      } catch (error) {
        if (Date.now() > until) throw new Error(`No se pudo hablar con Marionette en ${port}: ${error.message}`)
        await new Promise(r => setTimeout(r, 400))
      }
    }
  }

  #waitHello(ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sin saludo de Marionette')), ms)
      this.onHello = hello => { clearTimeout(timer); resolve(hello) }
    })
  }

  #read(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const colon = this.buffer.indexOf(0x3a)
      if (colon < 0) return
      const length = Number(this.buffer.subarray(0, colon).toString())
      if (this.buffer.length < colon + 1 + length) return
      const message = JSON.parse(this.buffer.subarray(colon + 1, colon + 1 + length).toString('utf8'))
      this.buffer = this.buffer.subarray(colon + 1 + length)
      if (!Array.isArray(message)) { this.hello = message; this.onHello?.(message); continue }
      const [, id, error, result] = message
      const waiting = this.pending.get(id)
      if (!waiting) continue
      this.pending.delete(id)
      if (error) waiting.reject(Object.assign(new Error(`${error.error}: ${error.message}`), { stack: error.stacktrace }))
      else waiting.resolve(result)
    }
  }

  send(name, params = {}) {
    const id = ++this.id
    const body = Buffer.from(JSON.stringify([0, id, name, params]), 'utf8')
    this.socket.write(Buffer.concat([Buffer.from(`${body.length}:`), body]))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  async session() {
    await this.send('WebDriver:NewSession', { capabilities: { alwaysMatch: { 'moz:accessibilityChecks': false } } })
    await this.send('Marionette:SetContext', { value: 'chrome' })
  }

  /** Ejecuta `script` (el cuerpo de una función, con `return`) en la ventana chrome actual; espera a las promesas. */
  async js(script, args = []) {
    const result = await this.send('WebDriver:ExecuteScript', { script, args, newSandbox: false })
    return result?.value
  }

  close() { try { this.socket.end() } catch { /* ya estaba */ } }
}

/** Un perfil nuevo con sus ajustes (user.js). */
export function makeProfile(prefs = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-zero-prueba-'))
  const lines = Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
  fs.writeFileSync(path.join(dir, 'user.js'), lines.join('\n') + '\n')
  return dir
}

/** Arranca el motor con Marionette en `port`. */
export function launch(engine, profile, port, extra = []) {
  const exe = path.join(engine, 'kitsune.exe')
  // Gecko 159 quitó --remote-allow-system-access: el contexto chrome se pide con MOZ_REMOTE_ALLOW_SYSTEM_ACCESS (como
  // tests/browser_smoke.py).
  const child = spawn(exe, ['-marionette', '-no-remote', '-profile', profile, ...extra], {
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1', MOZ_CRASHREPORTER_DISABLE: '1' },
    stdio: 'ignore',
    detached: false,
  })
  return child
}
