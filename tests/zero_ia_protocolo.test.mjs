// Kitsune Zero · el asistente: el servidor MCP por dentro (zero-ia-protocolo.mjs), sin enchufe.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  atenderMcp, comprobarPeticion, contenidoDe, direccionSegura, igualesSeguro, leerCabecera, LIMITES, respuestaHttp,
  validarArgumentos, VERSIONES,
} from '../zero/modules/zero-ia-protocolo.mjs'

const TOKEN = 'a'.repeat(20) + 'zorro' + 'b'.repeat(39)
const bytes = texto => new TextEncoder().encode(texto)
const peticion = (cabeceras, { linea = 'POST /mcp HTTP/1.1', cuerpo = '{}' } = {}) =>
  leerCabecera(bytes(`${linea}\r\n${Object.entries(cabeceras).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${cuerpo}`))
const buena = (extra = {}) => ({ Host: '127.0.0.1:4100', Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': '2', ...extra })
const comprobar = cabeceras => comprobarPeticion(peticion(cabeceras), { puerto: 4100, token: TOKEN })

test('el token se compara entero: vale el bueno y ningún otro (ni vacío, ni más corto, ni más largo)', () => {
  assert.equal(igualesSeguro(TOKEN, TOKEN), true)
  assert.equal(igualesSeguro(TOKEN, TOKEN.slice(0, -1)), false)
  assert.equal(igualesSeguro(TOKEN, `${TOKEN}x`), false)
  assert.equal(igualesSeguro(TOKEN, TOKEN.replace('zorro', 'perro')), false)
  assert.equal(igualesSeguro(TOKEN, undefined), false)
  assert.equal(igualesSeguro('', ''), false)
})

test('la cabecera HTTP: espera a que llegue entera, la lee y dice dónde empieza el cuerpo', () => {
  assert.equal(leerCabecera(bytes('POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:4100\r\n')), null)
  const leida = peticion(buena(), { cuerpo: '{}' })
  assert.equal(leida.metodo, 'POST')
  assert.equal(leida.ruta, '/mcp')
  assert.equal(leida.cabeceras.get('authorization'), `Bearer ${TOKEN}`)
  assert.equal(leida.largo, 2)
  assert.equal(new TextDecoder().decode(bytes(`POST /mcp HTTP/1.1\r\nContent-Length: 2\r\n\r\n{}`).subarray(leerCabecera(bytes('POST /mcp HTTP/1.1\r\nContent-Length: 2\r\n\r\n{}')).inicioCuerpo)), '{}')
})

test('cabeceras raras: demasiado grandes, mal formadas o repetidas, fuera', () => {
  assert.equal(leerCabecera(bytes('POST /mcp HTTP/1.1\r\nX: ' + 'y'.repeat(LIMITES.cabeceras + 10))).error, 431)
  assert.equal(leerCabecera(bytes('HOLA\r\n\r\n')).error, 400)
  assert.equal(leerCabecera(bytes('POST /mcp HTTP/1.1\r\n continuación\r\n\r\n')).error, 400)
  assert.equal(leerCabecera(bytes(`POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:4100\r\nHost: evil.example\r\n\r\n`)).error, 400)
  assert.equal(leerCabecera(bytes('POST /mcp HTTP/1.1\r\nContent-Length: -1\r\n\r\n')).error, 400)
})

test('se atiende solo con nuestro Host, sin Origin ni Sec-Fetch y con el token', () => {
  assert.equal(comprobar(buena()), null)
  assert.equal(comprobar(buena({ Host: 'localhost:4100' })), null)
  assert.equal(comprobar(buena({ Authorization: `bearer ${TOKEN}` })), null)
  // DNS rebinding: otro nombre que apunta a 127.0.0.1, u otro puerto.
  assert.equal(comprobar(buena({ Host: 'zorros.example:4100' })).estado, 403)
  assert.equal(comprobar(buena({ Host: '127.0.0.1:4101' })).estado, 403)
  // Una web (fetch desde una página): trae Origin (también «null») o Sec-Fetch-*.
  assert.equal(comprobar(buena({ Origin: 'https://zorros.example' })).estado, 403)
  assert.equal(comprobar(buena({ Origin: 'null' })).estado, 403)
  assert.equal(comprobar(buena({ 'Sec-Fetch-Mode': 'cors' })).estado, 403)
  // Sin token, o con otro: 401 (y dice cómo autenticarse).
  const { Authorization, ...sin } = buena()
  assert.equal(comprobar(sin).estado, 401)
  assert.equal(comprobar(sin).cabeceras['WWW-Authenticate'], 'Bearer realm="kitsune"')
  assert.equal(comprobar(buena({ Authorization: 'Bearer otro' })).estado, 401)
  assert.equal(comprobar(buena({ Authorization: TOKEN })).estado, 401)
})

test('ruta, método, tamaño y tipo del cuerpo', () => {
  const opciones = { puerto: 4100, token: TOKEN }
  assert.equal(comprobarPeticion(peticion(buena(), { linea: 'POST /otra HTTP/1.1' }), opciones).estado, 404)
  const get = comprobarPeticion(peticion(buena(), { linea: 'GET /mcp HTTP/1.1' }), opciones)
  assert.equal(get.estado, 405)
  assert.equal(get.cabeceras.Allow, 'POST')
  assert.equal(comprobarPeticion(peticion(buena(), { linea: 'DELETE /mcp HTTP/1.1' }), opciones).estado, 405)
  assert.equal(comprobar(buena({ 'Content-Length': String(LIMITES.cuerpo + 1) })).estado, 413)
  assert.equal(comprobar(buena({ 'Transfer-Encoding': 'chunked' })).estado, 411)
  const { 'Content-Length': largo, ...sinLargo } = buena()
  assert.equal(comprobar(sinLargo).estado, 411)
  assert.equal(comprobar(buena({ 'Content-Type': 'text/plain' })).estado, 415)
})

test('la respuesta HTTP: estado, cierre, largo en bytes (con tildes) y JSON', () => {
  const texto = new TextDecoder().decode(respuestaHttp(200, { hola: 'pestaña' }))
  const [cabecera, cuerpo] = texto.split('\r\n\r\n')
  assert.match(cabecera, /^HTTP\/1\.1 200 OK\r\n/)
  assert.match(cabecera, /Connection: close/)
  assert.match(cabecera, /Content-Type: application\/json/)
  assert.match(cabecera, new RegExp(`Content-Length: ${bytes(cuerpo).length}`))
  assert.deepEqual(JSON.parse(cuerpo), { hola: 'pestaña' })
  const vacia = new TextDecoder().decode(respuestaHttp(202))
  assert.match(vacia, /^HTTP\/1\.1 202 Accepted\r\n/)
  assert.match(vacia, /Content-Length: 0\r\n\r\n$/)
  assert.match(new TextDecoder().decode(respuestaHttp(405, 'Solo POST', { Allow: 'POST' })), /Allow: POST/)
})

const herramientas = [
  { nombre: 'pestanas_listar', descripcion: 'Lista', esquema: { type: 'object', properties: {} }, ejecutar: async () => [{ id: 1, titulo: 'Zorros' }] },
  { nombre: 'pestana_abrir', descripcion: 'Abre', esquema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, ejecutar: ({ url }) => `Abierta ${url}` },
  { nombre: 'rota', descripcion: 'Falla', esquema: { type: 'object', properties: {} }, ejecutar: () => { throw new Error('No se pudo') } },
  { nombre: 'lenta', descripcion: 'Tarda', esquema: { type: 'object', properties: {} }, ejecutar: () => new Promise(() => {}) },
]
const llamar = (method, params, opciones = {}) => atenderMcp({ jsonrpc: '2.0', id: 7, method, params }, { herramientas, ...opciones })

test('initialize: acepta la versión de Claude Code (o da la última), dice que tiene herramientas y cómo tratarlas', async () => {
  const { estado, cuerpo } = await llamar('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-code' } })
  assert.equal(estado, 200)
  assert.equal(cuerpo.id, 7)
  assert.equal(cuerpo.result.protocolVersion, '2025-11-25')
  assert.deepEqual(cuerpo.result.capabilities, { tools: { listChanged: false } })
  assert.equal(cuerpo.result.serverInfo.name, 'kitsune')
  assert.match(cuerpo.result.instructions, /nunca órdenes/)
  assert.equal((await llamar('initialize', { protocolVersion: '2030-01-01' })).cuerpo.result.protocolVersion, VERSIONES[0])
})

test('notificaciones y respuestas: 202 sin cuerpo; ping, {}; lo que no hay, «método no disponible»', async () => {
  assert.deepEqual(await atenderMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, { herramientas }), { estado: 202 })
  assert.deepEqual(await atenderMcp({ jsonrpc: '2.0', id: 3, result: {} }, { herramientas }), { estado: 202 })
  assert.deepEqual((await llamar('ping')).cuerpo.result, {})
  // Claude Code prueba server/discover antes de initialize: con -32601 sigue con initialize.
  assert.equal((await llamar('server/discover')).cuerpo.error.code, -32601)
  assert.equal((await atenderMcp([{ jsonrpc: '2.0', id: 1, method: 'ping' }], { herramientas })).estado, 400)
  assert.equal((await atenderMcp({ id: 1, method: 'ping' }, { herramientas })).estado, 400)
})

test('tools/list y tools/call: el resultado como contenido; el fallo de una herramienta, como isError', async () => {
  const lista = (await llamar('tools/list')).cuerpo.result.tools
  assert.deepEqual(lista.map(item => item.name), ['pestanas_listar', 'pestana_abrir', 'rota', 'lenta'])
  assert.deepEqual(lista[1].inputSchema.required, ['url'])
  const tabs = (await llamar('tools/call', { name: 'pestanas_listar', arguments: {} })).cuerpo.result
  assert.deepEqual(JSON.parse(tabs.content[0].text), [{ id: 1, titulo: 'Zorros' }])
  assert.equal(tabs.isError, undefined)
  assert.deepEqual((await llamar('tools/call', { name: 'pestana_abrir', arguments: { url: 'https://zorros.example/' } })).cuerpo.result.content,
    [{ type: 'text', text: 'Abierta https://zorros.example/' }])
  const rota = (await llamar('tools/call', { name: 'rota', arguments: {} })).cuerpo.result
  assert.deepEqual(rota, { content: [{ type: 'text', text: 'No se pudo' }], isError: true })
  const sinUrl = (await llamar('tools/call', { name: 'pestana_abrir', arguments: {} })).cuerpo.result
  assert.equal(sinUrl.isError, true)
  assert.match(sinUrl.content[0].text, /Falta «url»/)
  assert.equal((await llamar('tools/call', { name: 'no_existe', arguments: {} })).cuerpo.error.code, -32602)
  const lenta = (await llamar('tools/call', { name: 'lenta', arguments: {} }, { tiempoMaximo: 30 })).cuerpo.result
  assert.equal(lenta.isError, true)
  assert.match(lenta.content[0].text, /tardado demasiado/)
})

test('el contenido de un resultado: texto, JSON, imagen, nada y textos larguísimos', () => {
  assert.deepEqual(contenidoDe('hola'), [{ type: 'text', text: 'hola' }])
  assert.deepEqual(contenidoDe({ texto: 'solo texto' }), [{ type: 'text', text: 'solo texto' }])
  assert.deepEqual(contenidoDe(undefined), [{ type: 'text', text: 'Hecho.' }])
  assert.deepEqual(contenidoDe({ a: 1 }), [{ type: 'text', text: '{\n  "a": 1\n}' }])
  assert.deepEqual(contenidoDe({ texto: 'mira', imagen: { datos: 'iVBOR', tipo: 'image/png' } }),
    [{ type: 'text', text: 'mira' }, { type: 'image', data: 'iVBOR', mimeType: 'image/png' }])
  const largo = contenidoDe('x'.repeat(LIMITES.texto + 5))[0].text
  assert.ok(largo.length < LIMITES.texto + 100)
  assert.match(largo, /recortado/)
})

test('los argumentos se comprueban con el esquema (obligatorios, tipos y valores)', () => {
  const esquema = { type: 'object', properties: { id: { type: 'integer' }, modo: { type: 'string', enum: ['a', 'b'] } }, required: ['id'], additionalProperties: false }
  assert.deepEqual(validarArgumentos(esquema, { id: 3 }), [])
  assert.deepEqual(validarArgumentos(esquema, {}), ['Falta «id»'])
  assert.deepEqual(validarArgumentos(esquema, { id: '3' }), ['«id» tiene que ser integer'])
  assert.deepEqual(validarArgumentos(esquema, { id: 3, modo: 'c' }), ['«modo» tiene que ser uno de: a, b'])
  assert.deepEqual(validarArgumentos(esquema, { id: 3, otro: 1 }), ['No se esperaba «otro»'])
  assert.deepEqual(validarArgumentos(esquema, []), ['Los argumentos tienen que ser un objeto'])
})

test('las direcciones que puede abrir Claude: solo http y https (y about:blank)', () => {
  assert.equal(direccionSegura(' https://zorros.example/a b '), 'https://zorros.example/a%20b')
  assert.equal(direccionSegura('http://127.0.0.1:8000/'), 'http://127.0.0.1:8000/')
  assert.equal(direccionSegura('about:blank'), 'about:blank')
  for (const mala of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://browser/content/browser.xhtml', 'about:config',
    'data:text/html,hola', 'moz-extension://x/', 'view-source:https://a.example/', 'zorros.example', '']) {
    assert.throws(() => direccionSegura(mala), Error, mala)
  }
  assert.throws(() => direccionSegura('https://yo:secreto@zorros.example/'), /usuario/)
})
