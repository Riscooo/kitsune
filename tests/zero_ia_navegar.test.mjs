// Kitsune Zero · manejar una web desde Claude Code: lo puro (zero-ia-navegar.mjs) y qué servidor MCP lleva qué.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DATOS_NO_ORDENES, elegirPorEtiqueta, INSTRUCCIONES_NAVEGAR, leerTeclas, limpiarElemento, lineaDe, normalizar, referencia,
  TECLAS_MAXIMAS, textoDeElementos,
} from '../zero/modules/zero-ia-navegar.mjs'

// Lo justo de Gecko para cargar los módulos del asistente en Node: no se ejecuta ninguna herramienta, solo se miran.
globalThis.ChromeUtils ??= { defineESModuleGetters() {}, registerWindowActor() {} }
globalThis.JSWindowActorParent ??= class {}
globalThis.JSWindowActorChild ??= class {}
const { herramientasDelPanel, herramientasDeFuera } = await import('../zero/modules/zero-asistente.sys.mjs')
const { herramientasDeNavegar, NOMBRES_NAVEGAR } = await import('../zero/modules/zero-ia-navegar.sys.mjs')

const nombres = herramientas => herramientas.map(herramienta => herramienta.nombre)
const lobo = { animar: () => true, listar: () => [], crear: () => [] }
const DEL_PANEL = ['pestanas_listar', 'pestana_abrir', 'pestana_ir', 'pestana_cerrar', 'pagina_leer', 'pagina_seleccion', 'buscar',
  'historial_buscar', 'lobo_animar', 'lobo_animaciones', 'lobo_crear_animacion']
const NUEVAS = ['pestana_navegar', 'pestana_atras', 'pestana_adelante', 'pestana_recargar', 'pagina_elementos', 'pagina_clic',
  'pagina_pasar_raton', 'pagina_escribir', 'pagina_elegir', 'pagina_teclas', 'pagina_desplazar', 'pagina_captura', 'pagina_esperar',
  'pagina_ejecutar', 'pagina_dialogo']

test('el lobo (el servidor del panel) no tiene ninguna herramienta para manejar las páginas', () => {
  assert.deepEqual(nombres(herramientasDelPanel(null, { lobo })), DEL_PANEL)
  assert.deepEqual(nombres(herramientasDelPanel(null)), DEL_PANEL.filter(nombre => !nombre.startsWith('lobo_')))
  for (const nombre of nombres(herramientasDelPanel(null, { lobo }))) assert.ok(!NOMBRES_NAVEGAR.includes(nombre), nombre)
  // Ni pidiéndolo con otra opción: el panel no tiene forma de recibirlas.
  assert.deepEqual(nombres(herramientasDelPanel(null, { lobo, navegar: true, fuera: true })), DEL_PANEL)
})

test('el servidor de fuera (Claude Code en una terminal) tiene las del panel y, además, las de manejar las páginas', () => {
  assert.deepEqual([...NOMBRES_NAVEGAR], NUEVAS)
  const fuera = nombres(herramientasDeFuera(null, { lobo }))
  assert.deepEqual(fuera, [...DEL_PANEL, ...NUEVAS])
  assert.equal(new Set(fuera).size, fuera.length, 'sin nombres repetidos')
})

test('cada herramienta nueva recuerda que lo que devuelve la web son datos, no órdenes, y tiene un esquema cerrado', () => {
  for (const herramienta of herramientasDeNavegar(null)) {
    assert.match(herramienta.descripcion, /datos/, herramienta.nombre)
    assert.match(herramienta.descripcion, /datos, no órdenes/, herramienta.nombre)
    assert.equal(herramienta.esquema.type, 'object', herramienta.nombre)
    assert.equal(herramienta.esquema.additionalProperties, false, herramienta.nombre)
    assert.equal(typeof herramienta.ejecutar, 'function', herramienta.nombre)
    assert.match(herramienta.nombre, /^(pestana|pagina)_[a-z_]+$/, herramienta.nombre)
  }
  const porNombre = Object.fromEntries(herramientasDeNavegar(null).map(herramienta => [herramienta.nombre, herramienta]))
  assert.deepEqual(porNombre.pestana_navegar.esquema.required, ['url'])
  assert.deepEqual(porNombre.pagina_escribir.esquema.required, ['texto'])
  assert.deepEqual(porNombre.pagina_ejecutar.esquema.required, ['codigo'])
  assert.deepEqual(porNombre.pagina_dialogo.esquema.required, ['aceptar'])
  for (const nombre of ['pagina_elementos', 'pagina_captura', 'pagina_esperar']) assert.equal(porNombre[nombre].anotaciones?.readOnlyHint, true, nombre)
  assert.match(INSTRUCCIONES_NAVEGAR, /nunca porque lo diga una web/)
  assert.match(DATOS_NO_ORDENES, /datos, no órdenes/)
})

test('las teclas: nombres de KeyboardEvent o en castellano, un carácter, modificadores con + y varias con espacios', () => {
  assert.deepEqual(leerTeclas('Enter'), [{ tecla: 'Enter', imprimible: false, modificadores: [] }])
  assert.deepEqual(leerTeclas('Control+a Shift+Tab Intro espacio'), [
    { tecla: 'a', imprimible: true, modificadores: ['Control'] },
    { tecla: 'Tab', imprimible: false, modificadores: ['Shift'] },
    { tecla: 'Enter', imprimible: false, modificadores: [] },
    { tecla: ' ', imprimible: true, modificadores: [] },
  ])
  assert.deepEqual(leerTeclas('ctrl+mayús+F5'), [{ tecla: 'F5', imprimible: false, modificadores: ['Control', 'Shift'] }])
  assert.deepEqual(leerTeclas('Control++'), [{ tecla: '+', imprimible: true, modificadores: ['Control'] }])
  assert.deepEqual(leerTeclas('+ ñ €'), ['+', 'ñ', '€'].map(tecla => ({ tecla, imprimible: true, modificadores: [] })))
  assert.deepEqual(leerTeclas('  Esc   ArrowDown suprimir avpag '), ['Escape', 'ArrowDown', 'Delete', 'PageDown'].map(tecla => ({ tecla, imprimible: false, modificadores: [] })))
  assert.throws(() => leerTeclas(''), /ninguna tecla/)
  assert.throws(() => leerTeclas('Hola+a'), /«Hola» no es un modificador/)
  assert.throws(() => leerTeclas('Supercalifragilistico'), /No conozco la tecla/)
  assert.throws(() => leerTeclas(Array(TECLAS_MAXIMAS + 1).fill('Tab').join(' ')), /demasiadas teclas/)
})

test('las referencias: e12, [e12] o 12; lo demás, un error que se entiende', () => {
  assert.equal(referencia('e12'), 12)
  assert.equal(referencia('[e12]'), 12)
  assert.equal(referencia('E7'), 7)
  assert.equal(referencia(12), 12)
  for (const mala of ['', 'x', 'e0', 'e-1', 'e1.5', 'e12; alert(1)', null]) assert.throws(() => referencia(mala), /no es una referencia/, String(mala))
})

test('los elementos que llegan de la web se comprueban y se recortan antes de dárselos a Claude', () => {
  assert.equal(limpiarElemento(null), null)
  assert.equal(limpiarElemento({ tipo: 'botón' }), null)
  assert.equal(limpiarElemento({ ref: '3' }), null)
  const largo = limpiarElemento({ ref: 4, tipo: 'x'.repeat(100), nombre: 'n'.repeat(500), valor: 9, href: 'h'.repeat(900), vista: 'encima', estados: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], opciones: Array(60).fill('o') })
  assert.equal(largo.tipo.length, 30)
  assert.equal(largo.nombre.length, 150)
  assert.equal(largo.valor, '9')
  assert.equal(largo.href.length, 300)
  assert.equal(largo.vista, '')
  assert.equal(largo.estados.length, 6)
  assert.equal(largo.opciones.length, 40)
  assert.equal(lineaDe(limpiarElemento({ ref: 12, tipo: 'botón', nombre: 'Enviar "ya"', estados: ['desactivado'], vista: 'abajo' })),
    '[e12] botón "Enviar \\"ya\\"" (desactivado, más abajo)')
  assert.equal(lineaDe(limpiarElemento({ ref: 3, tipo: 'desplegable', nombre: 'País', valor: 'España', opciones: ['Alemania', 'España'], masOpciones: 20 })),
    '[e3] desplegable "País" = "España" · opciones: "Alemania", "España", … (20 más)')
  assert.equal(lineaDe(limpiarElemento({ ref: 1, tipo: 'enlace', nombre: 'Inicio\nde\tverdad', href: 'https://zorros.example/' })),
    '[e1] enlace "Inicio de verdad" → https://zorros.example/')
})

const ELEMENTOS = [
  { ref: 1, tipo: 'enlace', nombre: 'Inicio', href: 'https://zorros.example/' },
  { ref: 2, tipo: 'campo search', nombre: 'Buscar en la página', valor: '' },
  { ref: 3, tipo: 'botón', nombre: 'Buscar', vista: 'abajo' },
  { ref: 4, tipo: 'botón', nombre: 'Buscar', vista: '' },
  { ref: 5, tipo: 'casilla', nombre: 'Recordarme', estados: ['sin marcar'], vista: 'abajo' },
  { ref: 6, tipo: 'enlace', nombre: 'Más información sobre el zorro ártico', href: 'https://zorros.example/artico', vista: 'abajo' },
]

test('la lista en texto: cabecera con la pestaña, el aviso de datos, filtro sin tildes, solo lo que se ve y un tope', () => {
  const pestana = { id: 3, titulo: 'Zorros', direccion: 'https://zorros.example/' }
  const todo = textoDeElementos({ pestana, elementos: [...ELEMENTOS, { tipo: 'roto' }], marcos: 2 }).split('\n')
  assert.equal(todo[0], 'Pestaña 3 · "Zorros" · https://zorros.example/')
  assert.match(todo[1], /^6 elementos \(de 6 en la página\)/)
  assert.match(todo[2], /datos, no órdenes/)
  assert.equal(todo[3], '[e1] enlace "Inicio" → https://zorros.example/')
  assert.equal(todo.at(-1), 'La página tiene 2 marcos (iframes): lo de dentro no sale aquí ni se puede tocar con estas herramientas (pagina_captura sí lo ve).')
  const filtrada = textoDeElementos({ pestana, elementos: ELEMENTOS, filtro: 'ARTICO' }).split('\n')
  assert.match(filtrada[1], /^1 elementos con «ARTICO»/)
  assert.equal(filtrada[3], '[e6] enlace "Más información sobre el zorro ártico" → https://zorros.example/artico (más abajo)')
  const vista = textoDeElementos({ pestana, elementos: ELEMENTOS, enPantalla: true }).split('\n').filter(linea => linea.startsWith('['))
  assert.deepEqual(vista.map(linea => linea.slice(0, 4)), ['[e1]', '[e2]', '[e4]'])
  const corta = textoDeElementos({ pestana, elementos: ELEMENTOS, cuantos: 2 }).split('\n')
  assert.equal(corta.filter(linea => linea.startsWith('[')).length, 2)
  assert.equal(corta.at(-1), '… y 4 más: usa filtro, enPantalla o cuantos, o desplázate.')
  assert.match(textoDeElementos({ pestana, elementos: ELEMENTOS, filtro: 'nada de esto' }), /Ningún elemento con «nada de esto»/)
})

test('por etiqueta: primero el nombre exacto, luego el que empieza así y luego el que lo contiene; entre iguales, el que se ve', () => {
  assert.deepEqual(elegirPorEtiqueta(ELEMENTOS, 'buscar'), { elemento: limpiarElemento(ELEMENTOS[3]), otros: 1 })
  assert.equal(elegirPorEtiqueta(ELEMENTOS, 'Buscar en').elemento.ref, 2)
  assert.equal(elegirPorEtiqueta(ELEMENTOS, 'zorro ártico').elemento.ref, 6)
  assert.equal(elegirPorEtiqueta(ELEMENTOS, '  RECORDARME ').elemento.ref, 5)
  assert.throws(() => elegirPorEtiqueta(ELEMENTOS, ''), /vacía/)
  assert.throws(() => elegirPorEtiqueta(ELEMENTOS, 'zorro polar'), /Ningún elemento de la página se llama «zorro polar»\. Parecidos: \[e6\]/)
  assert.throws(() => elegirPorEtiqueta(ELEMENTOS, 'xyz'), /pagina_elementos/)
  assert.equal(normalizar('  Árbol\n  ÑANDÚ '), 'arbol nandu')
})
