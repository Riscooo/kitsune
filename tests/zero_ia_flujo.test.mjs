// Kitsune Zero · el asistente: el traductor de las líneas de Claude Code (zero-ia-flujo.mjs).
// Las líneas de tests/fixtures/zero-ia/ las escribió el CLI de verdad (2.1.319): de-verdad.jsonl, con la API de
// verdad y haiku (zero_ia_native.py --claude-de-verdad); las demás, contra una API de Anthropic de pega en local
// (para ver errores, reintentos y el corte sin gastar). Solo se cambiaron las rutas, los puertos y el uso de la cuenta.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { crearTraductor, mensajeUsuario, nombreCorto, ordenParar, traducir } from '../zero/modules/zero-ia-flujo.mjs'

const lineas = nombre => readFileSync(new URL(`./fixtures/zero-ia/${nombre}.jsonl`, import.meta.url), 'utf8').split('\n')
const tipos = eventos => eventos.map(evento => evento.tipo)
const texto = eventos => eventos.filter(evento => evento.tipo === 'texto').map(evento => evento.delta).join('')
const resultadoDe = nombre => lineas(nombre).filter(Boolean).map(linea => JSON.parse(linea)).filter(linea => linea.type === 'result')

test('un turno con una herramienta de Kitsune: listo, texto, herramienta, su resultado, más texto y fin', () => {
  const eventos = traducir(lineas('herramienta'))
  assert.deepEqual(tipos(eventos), ['listo', 'texto', 'herramienta', 'resultado-herramienta', 'texto', 'texto', 'texto', 'texto', 'fin'])
  const [listo] = eventos
  assert.equal(listo.sesion, 'd73903c5-c279-4862-9db0-415e324b9d7d')
  assert.equal(listo.mcp, 'connected')
  assert.deepEqual(listo.herramientas, ['WebFetch', 'WebSearch', 'pestanas_listar'])
  assert.deepEqual(eventos[2], { tipo: 'herramienta', id: 'toolu_01A', nombre: 'pestanas_listar', entrada: {} })
  assert.deepEqual(eventos[3], { tipo: 'resultado-herramienta', id: 'toolu_01A', nombre: 'pestanas_listar', error: null })
  // El texto llega a trozos y una sola vez (el mensaje entero que viene detrás no se repite); cada bloque
  // empieza con «nuevo».
  assert.equal(texto(eventos), 'Miro tus pestañas.Hola, soy el lobo.')
  assert.equal(eventos[1].nuevo, true)
  assert.equal(eventos[4].nuevo, true)
  assert.equal(eventos[5].nuevo, undefined)
  const fin = eventos.at(-1)
  assert.equal(fin.sesion, listo.sesion)
  assert.equal(fin.duracion, 156)
  assert.ok(fin.coste > 0 && fin.coste < 0.01)
  assert.equal(fin.parado, undefined)
  // Lo que dice el «result» de Claude Code es lo último que se ha escrito.
  assert.ok(texto(eventos).endsWith(resultadoDe('herramienta')[0].result))
})

test('con la API de verdad (haiku): pestanas_listar por MCP y la respuesta a trozos', () => {
  const eventos = traducir(lineas('de-verdad'))
  assert.deepEqual(tipos(eventos), ['listo', 'herramienta', 'resultado-herramienta', 'texto', 'texto', 'texto', 'fin'])
  assert.equal(eventos[0].mcp, 'connected')
  assert.equal(eventos[0].modelo, 'claude-haiku-5-5')
  assert.ok(eventos[0].herramientas.includes('pagina_leer') && !eventos[0].herramientas.includes('Bash'))
  assert.equal(eventos[1].nombre, 'pestanas_listar')
  assert.equal(eventos[2].error, null)
  assert.equal(texto(eventos), resultadoDe('de-verdad')[0].result)
  assert.equal(eventos.at(-1).sesion, eventos[0].sesion)
})

test('cortar la respuesta: el turno acaba con «parado» y sin error', () => {
  const eventos = traducir(lineas('parar'))
  const segundo = eventos.slice(eventos.findIndex((evento, i) => i > 0 && evento.tipo === 'listo'))
  assert.deepEqual(tipos(segundo), ['listo', 'texto', 'fin'])
  assert.equal(segundo.at(-1).parado, true)
  assert.ok(!eventos.some(evento => evento.tipo === 'error'))
})

test('un error de la API sale como error (con su mensaje) y luego fin; el texto del mensaje sintético no sale', () => {
  const eventos = traducir(lineas('error-api'))
  assert.deepEqual(tipos(eventos), ['listo', 'error', 'fin'])
  assert.equal(eventos[1].mensaje, 'API Error: 400 Fallo de prueba 400')
})

test('sin la sesión de Claude iniciada, el error lo dice', () => {
  const eventos = traducir(lineas('sin-sesion'))
  assert.deepEqual(tipos(eventos), ['listo', 'error', 'fin'])
  assert.match(eventos[1].mensaje, /Not logged in/)
})

test('los reintentos de la API se cuentan', () => {
  const eventos = traducir(lineas('reintento'))
  assert.deepEqual(tipos(eventos), ['listo', 'reintento', 'reintento', 'reintento'])
  assert.deepEqual(eventos[1], { tipo: 'reintento', intento: 1, maximo: 10, espera: 550, error: 'authentication_failed', estado: 401 })
})

test('sin los mensajes a trozos, el texto sale entero; una herramienta vetada vuelve con su error', () => {
  const eventos = traducir(lineas('herramienta-vetada'))
  assert.deepEqual(tipos(eventos), ['listo', 'herramienta', 'resultado-herramienta', 'texto', 'fin'])
  assert.equal(eventos[1].nombre, 'Bash')
  assert.match(eventos[2].error, /No such tool available: Bash/)
  assert.deepEqual(eventos[3], { tipo: 'texto', delta: 'Hola, soy el lobo.', nuevo: true })
})

test('lo de los subagentes, las líneas vacías y lo que no es JSON no sale', () => {
  const traductor = crearTraductor()
  const real = lineas('herramienta').find(linea => linea.includes('"text_delta"'))
  const deSubagente = JSON.stringify({ ...JSON.parse(real), parent_tool_use_id: 'toolu_otro' })
  assert.deepEqual(traductor.linea(deSubagente), [])
  assert.deepEqual(traductor.linea(''), [])
  assert.deepEqual(traductor.linea('   '), [])
  assert.deepEqual(traductor.linea('Warning: algo raro'), [])
  assert.deepEqual(traductor.linea('null'), [])
  assert.deepEqual(traductor.linea('{"type":"system","subtype":"status","status":"requesting"}'), [])
})

test('lo que se le escribe a Claude Code: un mensaje y la orden de parar, una línea JSON cada uno', () => {
  const mensaje = mensajeUsuario('¿Qué pestañas\ntengo?')
  assert.ok(mensaje.endsWith('\n'))
  assert.equal(mensaje.trimEnd().split('\n').length, 1)
  assert.deepEqual(JSON.parse(mensaje), { type: 'user', message: { role: 'user', content: '¿Qué pestañas\ntengo?' }, parent_tool_use_id: null, session_id: '' })
  const parar = ordenParar('parar-1')
  assert.deepEqual(JSON.parse(parar), { type: 'control_request', request_id: 'parar-1', request: { subtype: 'interrupt' } })
})

test('los nombres de las herramientas de Kitsune van sin su prefijo; los demás, tal cual', () => {
  assert.equal(nombreCorto('mcp__kitsune__pagina_leer'), 'pagina_leer')
  assert.equal(nombreCorto('mcp__otro__pagina_leer'), 'mcp__otro__pagina_leer')
  assert.equal(nombreCorto('WebSearch'), 'WebSearch')
  assert.equal(nombreCorto(undefined), '')
})
