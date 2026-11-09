import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validar, combinar, catalogo, rasterizar, crearReproductor, LIMITES, ZONAS } from '../zero/modules/zero-lobo.mjs'

const lobo = JSON.parse(readFileSync(new URL('../zero/assets/lobo.json', import.meta.url), 'utf8'))
const copia = datos => JSON.parse(JSON.stringify(datos))

// Unos datos diminutos: cada cuadro de un color, para saber qué se pinta mirando el primer píxel.
const mini = () => ({
  paleta: { r: '#ff0000', g: '#00ff00', b: '#0000ff', k: '#000000' },
  cuadros: {
    rojo: ['rr', 'rr'],
    verde: ['gg', 'gg'],
    azul: { x: 3, y: 4, filas: ['bbb', 'bbb'] },
    punto: ['k'],
  },
  efectos: { chispa: { cuadros: ['punto'], ms: 300, dy: -6, desvanecer: true } },
  animaciones: {
    cuerpo: {
      quieto: { bucle: true, pasos: [{ cuadro: 'rojo', ms: 100 }, { cuadro: 'verde', ms: 100 }] },
      saltar: {
        pasos: [{ cuadro: 'azul', ms: 50, dy: -2 }, { cuadro: 'verde', ms: 50, estirar: [1.5, 0.5] }],
        efectos: [{ efecto: 'chispa', en: 0, x: 1, y: 1 }],
      },
      fijo: { bucle: true, pasos: [{ cuadro: 'azul', ms: 500 }] },
    },
    icono: { quieto: { pasos: [{ cuadro: 'rojo', ms: 100 }] } },
  },
})

// Un canvas de mentira: guarda lo que se le pone, y un ctx que cuenta lo que se pinta.
function fabrica() {
  const creados = []
  const lienzo = (ancho, alto) => {
    const c = {
      width: ancho, height: alto, img: null,
      getContext: () => ({
        createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        putImageData(img) { c.img = img },
      }),
    }
    creados.push(c)
    return c
  }
  return { lienzo, creados }
}
function ctxFalso() {
  const ctx = {
    imageSmoothingEnabled: true, globalAlpha: 1, borrados: 0, dibujos: [],
    clearRect() { ctx.borrados++ },
    drawImage(c, x, y, w, h) { ctx.dibujos.push({ c, x, y, w, h, alfa: ctx.globalAlpha }) },
  }
  return ctx
}
const color = dibujo => Array.from(dibujo.c.img.data.slice(0, 3))
const ROJO = [255, 0, 0], VERDE = [0, 255, 0], AZUL = [0, 0, 255]
const errores = (datos, opciones) => validar(datos, opciones)
const algunoDice = (lista, trozo) => lista.some(e => e.includes(trozo))

/* ------------------------------------------------------------------------------- el lobo de serie */

test('the wolf that ships is valid, with its sizes and a short palette', () => {
  assert.deepEqual(validar(lobo), [])
  const colores = Object.keys(lobo.paleta).length
  assert.ok(colores >= 12 && colores <= 16, `${colores} colores`)
  const cat = catalogo(lobo)
  const medida = Object.fromEntries(cat.cuadros.map(c => [c.nombre, c]))
  for (const [tamaño, lado] of [['cuerpo', 48], ['icono', 24]]) {
    for (const [nombre, anim] of Object.entries(lobo.animaciones[tamaño])) {
      for (const paso of anim.pasos) {
        const m = medida[paso.cuadro]
        assert.ok(m.ancho <= lado && m.alto <= lado, `${tamaño}.${nombre}: ${paso.cuadro} mide ${m.ancho}×${m.alto}`)
      }
      assert.ok(typeof anim.descripcion === 'string' && anim.descripcion.length > 5, `${nombre} sin descripción`)
    }
  }
  assert.equal(medida.quieto.ancho, 48)
  assert.equal(medida['icono-quieto'].ancho, 24)
})

test('it has every animation the assistant needs, for the body and for the icon', () => {
  const cuerpo = ['quieto', 'saludar', 'escuchar', 'pensar', 'hablar', 'feliz', 'celebrar', 'sorpresa', 'confundido', 'triste',
    'error', 'dormir', 'bostezar', 'buscar', 'leer', 'trabajar', 'despedirse']
  const icono = ['quieto', 'atento', 'pensando', 'hablando', 'feliz', 'durmiendo']
  for (const n of cuerpo) assert.ok(lobo.animaciones.cuerpo[n], `falta cuerpo.${n}`)
  for (const n of icono) assert.ok(lobo.animaciones.icono[n], `falta icono.${n}`)
  for (const n of ['quieto', 'escuchar', 'pensar', 'hablar', 'durmiendo', 'buscar', 'leer', 'trabajar']) {
    assert.equal(lobo.animaciones.cuerpo[n].bucle, true, `${n} va en bucle`)
  }
  assert.equal(lobo.animaciones.cuerpo.dormir.luego, 'durmiendo')
  // Las que no van en bucle vuelven a una que existe.
  for (const t of ['cuerpo', 'icono']) {
    for (const [n, a] of Object.entries(lobo.animaciones[t])) if (!a.bucle) assert.ok(lobo.animaciones[t][a.luego ?? 'quieto'], `${t}.${n}`)
  }
})

test('the example for the assistant is valid on top of the wolf and only uses what ships', () => {
  const ejemplo = lobo.ejemploClaude
  assert.deepEqual(validar(ejemplo, { base: lobo }), [])
  assert.equal(ejemplo.cuadros, undefined)
  assert.equal(ejemplo.efectos, undefined)
  const todo = combinar(lobo, ejemplo)
  assert.ok(todo.animaciones.cuerpo['claude-bailar'])
  assert.equal(todo.ejemploClaude, undefined)
  const r = crearReproductor(todo, { lienzo: fabrica().lienzo })
  assert.equal(r.reproducir('claude-bailar'), true)
})

test('every animation of the wolf plays and paints', () => {
  const { lienzo } = fabrica()
  for (const tamaño of ['cuerpo', 'icono']) {
    const r = crearReproductor(lobo, { tamaño, lienzo })
    assert.deepEqual([r.ancho, r.alto], ZONAS[tamaño].lienzo)
    for (const nombre of r.animaciones()) {
      const ctx = ctxFalso()
      r.reproducir(nombre, { reiniciar: true })
      for (let t = 0; t < 4000; t += 50) if (r.avanzar(t)) r.pintar(ctx, 3)
      assert.ok(ctx.dibujos.length > 0, nombre)
      assert.ok(ctx.dibujos.every(d => Number.isInteger(d.x) && Number.isInteger(d.y) && d.w % 3 === 0 && d.h % 3 === 0), nombre)
    }
  }
})

/* ------------------------------------------------------------------------------- validar */

test('validate explains the usual mistakes in Spanish, with where they are', () => {
  assert.ok(errores(null)[0].includes('objeto JSON'))
  assert.ok(errores([])[0].includes('objeto JSON'))

  const d = mini()
  d.cuadros.malo = ['rr', 'r']
  d.cuadros.raro = ['rq']
  d.cuadros.raya = ['r_']
  d.cuadros.sinbase = { base: 'no-existe' }
  d.cuadros.dos = { base: 'rojo', filas: ['r'] }
  d.paleta.z = 'rojo'
  d.paleta['ñ'] = '#123456'
  d.cosa = 1
  d.animaciones.cuerpo.quieto.pasos.push({ cuadro: 'fantasma', ms: 5 }, { cuadro: 'rojo', ms: 100, onclick: 'x' })
  d.animaciones.cuerpo.saltar.luego = 'nada'
  d.animaciones.cuerpo.saltar.pasos[1].estirar = [3, 1]
  d.animaciones.cuerpo.saltar.efectos.push({ efecto: 'humo', en: 0, x: 0, y: 0 })
  d.animaciones.cuerpo['Mal Nombre'] = { pasos: [{ cuadro: 'rojo', ms: 100 }] }
  const lista = errores(d)
  for (const [ruta, trozo] of [
    ['cuadros.malo[1]', 'miden lo mismo'],
    ['cuadros.raro', '«q» (columna 1) no está en la paleta'],
    ['cuadros.raya', 'solo vale en los parches'],
    ['cuadros.sinbase.base', '«no-existe» no existe'],
    ['cuadros.dos', 'solo una forma'],
    ['paleta.z', '#rrggbb'],
    ['paleta.ñ', 'una sola letra'],
    ['', '«cosa» no existe'],
    ['animaciones.cuerpo.quieto.pasos[2].cuadro', '«fantasma» no existe'],
    ['animaciones.cuerpo.quieto.pasos[2].ms', 'de 20 a 10000'],
    ['animaciones.cuerpo.quieto.pasos[3]', '«onclick» no existe'],
    ['animaciones.cuerpo.saltar.luego', '«nada» no existe'],
    ['animaciones.cuerpo.saltar.pasos[1].estirar', '0.5 a 1.5'],
    ['animaciones.cuerpo.saltar.efectos[1].efecto', '«humo» no existe'],
    ['animaciones.cuerpo.Mal Nombre', 'minúsculas'],
  ]) assert.ok(lista.some(e => e.startsWith(ruta) && e.includes(trozo)), `${ruta}: ${trozo}\n${lista.join('\n')}`)
})

test('validate checks patches, sizes per size and total time', () => {
  const d = mini()
  d.cuadros.parcheado = { base: 'rojo', parches: [{ x: 1, y: 1, filas: ['g_', '_g'] }] }
  d.cuadros.grande = { ancho: 30, alto: 30 }
  d.animaciones.icono.grande = { pasos: [{ cuadro: 'grande', ms: 100 }] }
  d.animaciones.cuerpo.largo = { pasos: Array.from({ length: 3 }, () => ({ cuadro: 'rojo', ms: 8000 })) }
  const lista = errores(d)
  assert.ok(algunoDice(lista, 'cuadros.parcheado.parches[0]: se sale del cuadro'))
  assert.ok(algunoDice(lista, 'en el icono caben 24×24'))
  assert.ok(algunoDice(lista, 'duran 24000 ms en total y el máximo es 20000'))
  // El mismo parche dentro del cuadro sí vale, y «_» deja lo de debajo.
  const bien = mini()
  bien.cuadros.parcheado = { base: 'rojo', parches: [{ x: 0, y: 0, filas: ['g_', '_.'] }] }
  assert.deepEqual(validar(bien), [])
  const r = rasterizar(bien, 'parcheado')
  assert.deepEqual([...r.rgba.slice(0, 4)], [0, 255, 0, 255])
  assert.deepEqual([...r.rgba.slice(4, 8)], [255, 0, 0, 255])
  assert.equal(r.rgba[15], 0)
})

test('layers go in their place, flipped if asked, and clipped to the frame', () => {
  const d = mini()
  d.cuadros.marco = { ancho: 6, alto: 6, capas: [{ cuadro: 'azul' }, { cuadro: 'rojo', dx: -1, dy: 5 }] }
  d.cuadros.medio = { filas: ['rg'], x: 1 }
  d.cuadros.volteado = { ancho: 3, alto: 1, capas: [{ cuadro: 'medio', voltear: true }] }
  assert.deepEqual(validar(d), [])
  const r = rasterizar(d, 'marco')
  const px = (x, y) => [...r.rgba.slice((y * 6 + x) * 4, (y * 6 + x) * 4 + 3)]
  assert.deepEqual(px(3, 4), AZUL)
  assert.deepEqual(px(5, 5), AZUL)
  assert.deepEqual(px(0, 5), ROJO)
  assert.equal(r.rgba[3], 0)
  const v = rasterizar(d, 'volteado')
  assert.deepEqual([...v.rgba.slice(4, 7)], VERDE)
  assert.deepEqual([...v.rgba.slice(8, 11)], ROJO)
})

test('validate does not hang or eat memory with malicious data', () => {
  const rapido = (nombre, datos, trozo) => {
    const t0 = performance.now()
    const lista = validar(datos)
    const ms = performance.now() - t0
    assert.ok(ms < 1500, `${nombre}: ${ms} ms`)
    assert.ok(lista.length > 0 && lista.length <= LIMITES.errores + 1, `${nombre}: ${lista.length} errores`)
    if (trozo) assert.ok(algunoDice(lista, trozo), `${nombre}: ${lista.join('\n')}`)
  }
  const base = () => { const d = mini(); return d }
  let d = base(); d.cuadros.enorme = Array.from({ length: 5000 }, () => 'r'.repeat(5000)); rapido('cuadro enorme', d, 'el máximo es 64')
  d = base(); d.cuadros.ancho = ['r'.repeat(2_000_000)]; rapido('fila enorme', d, 'mide 2000000 píxeles')
  d = base(); d.cuadros.vacio = { ancho: 1e9, alto: 1e9 }; rapido('tamaño enorme', d, 'van de 1 a 64')
  d = base(); d.animaciones.cuerpo.mil = { pasos: Array.from({ length: 100_000 }, () => ({ cuadro: 'rojo', ms: 20 })) }; rapido('miles de pasos', d, 'el máximo es 120')
  d = base(); for (let i = 0; i < 50_000; i++) d.cuadros[`c${i}`] = ['r']; rapido('miles de cuadros', d, 'el máximo es 400')
  d = base(); d.cuadros.a = { base: 'b' }; d.cuadros.b = { base: 'a' }; rapido('bucle de base', d, 'a → b → a')
  d = base(); d.cuadros.yo = { ancho: 2, alto: 2, capas: [{ cuadro: 'yo' }] }; rapido('capa de sí mismo', d, 'yo → yo')
  d = base(); for (let i = 0; i < 300; i++) d.cuadros[`k${i}`] = i ? { base: `k${i - 1}` } : ['r']; rapido('cadena larga', d, 'más de 8 veces')
  // Capas que se multiplican: cada cuadro, 24 capas del anterior y de 64×64. Con la memoria de lo ya
  // compuesto no explota, pero el presupuesto de trabajo lo para.
  d = base(); d.cuadros.n0 = { ancho: 64, alto: 64 }
  for (let i = 1; i < 4; i++) d.cuadros[`n${i}`] = { ancho: 64, alto: 64, capas: Array.from({ length: 24 }, () => ({ cuadro: `n${i - 1}` })) }
  for (let i = 0; i < 300; i++) d.cuadros[`m${i}`] = { ancho: 64, alto: 64, capas: Array.from({ length: 24 }, () => ({ cuadro: 'n3' })) }
  rapido('capas que se multiplican', d, 'componer las capas cuesta')
  // Errores a montones: el tope corta la lista.
  d = base(); for (let i = 0; i < 300; i++) d.cuadros[`e${i}`] = ['q']; rapido('miles de errores', d, 'arregla estos 40 primero')
  // Nada ejecutable: funciones, objetos donde van textos, nombres que tocan el prototipo.
  d = base(); d.cuadros.f = () => 1; d.animaciones.cuerpo.quieto.bucle = 'true'
  d.cuadros.__proto__x = ['r']; d.cuadros.constructor = ['r']
  const lista = validar(d)
  assert.ok(algunoDice(lista, 'cuadros.f: un cuadro es una lista de filas'))
  assert.ok(algunoDice(lista, 'animaciones.cuerpo.quieto.bucle: es true o false'))
  assert.ok(algunoDice(lista, '«__proto__x» no vale'))
  assert.deepEqual(validar({ ...mini(), cuadros: { ...mini().cuadros, constructor: ['r'] } }), [])
  assert.deepEqual(validar(JSON.parse('{"paleta":{"r":"#ff0000"},"cuadros":{"__proto__":["r"]}}')).length, 1)
})

/* ------------------------------------------------------------------------------- combinar */

test('the assistant animations are added, but never over the ones that ship', () => {
  const serie = mini()
  const antes = JSON.stringify(serie)
  const suyo = {
    paleta: { p: '#ff00ff' },
    cuadros: { rosa: ['pp', 'pp'], mezcla: { ancho: 2, alto: 2, capas: [{ cuadro: 'rojo' }, { cuadro: 'rosa', dy: 1 }] } },
    efectos: { brillo: { cuadros: ['punto'], ms: 200 } },
    animaciones: { cuerpo: { 'claude-rosa': { pasos: [{ cuadro: 'mezcla', ms: 100 }, { cuadro: 'verde', ms: 100 }], efectos: [{ efecto: 'chispa', en: 0, x: 0, y: 0 }] } } },
  }
  assert.deepEqual(validar(suyo, { base: serie }), [])
  // Lo mismo sin base no vale: usa cuadros y efectos de serie.
  assert.ok(algunoDice(validar(suyo), '«verde» no existe'))
  const pisa = { animaciones: { cuerpo: { quieto: { pasos: [{ cuadro: 'azul', ms: 100 }] }, nueva: { pasos: [{ cuadro: 'azul', ms: 100 }] } } } }
  assert.ok(algunoDice(validar(pisa, { base: serie }), 'ya hay una animación «quieto» de serie'))
  const colorin = { paleta: { r: '#00ffff' } }
  assert.ok(algunoDice(validar(colorin, { base: serie }), 'la letra «r» ya es #ff0000'))
  const roto = { animaciones: { cuerpo: { rota: { pasos: [] } } } }
  // El segundo usa el cuadro del primero.
  const otro = { animaciones: { icono: { 'claude-mini': { pasos: [{ cuadro: 'rosa', ms: 50 }] } } } }

  const todo = combinar(serie, suyo, pisa, colorin, roto, null, otro)
  assert.equal(JSON.stringify(serie), antes, 'la base no se toca')
  assert.deepEqual(Object.keys(todo.animaciones.cuerpo), ['quieto', 'saltar', 'fijo', 'claude-rosa'])
  assert.deepEqual(Object.keys(todo.animaciones.icono), ['quieto', 'claude-mini'])
  assert.equal(todo.paleta.r, '#ff0000')
  assert.equal(todo.paleta.p, '#ff00ff')
  assert.equal(todo.animaciones.cuerpo.quieto.pasos[0].cuadro, 'rojo')
  assert.deepEqual(validar(todo), [])
  const r = crearReproductor(todo, { lienzo: fabrica().lienzo })
  assert.ok(r.reproducir('claude-rosa'))
})

test('the catalogue tells what there is', () => {
  const cat = catalogo(mini())
  assert.deepEqual(cat.cuadros.find(c => c.nombre === 'azul'), { nombre: 'azul', ancho: 3, alto: 2, x: 3, y: 4 })
  assert.deepEqual(cat.animaciones.cuerpo.map(a => [a.nombre, a.ms, a.bucle]), [['quieto', 200, true], ['saltar', 100, false], ['fijo', 500, true]])
  assert.deepEqual(cat.efectos.map(e => e.nombre), ['chispa'])
})

/* ------------------------------------------------------------------------------- el reproductor */

test('the player follows the step times and loops', () => {
  const { lienzo } = fabrica()
  const r = crearReproductor(mini(), { lienzo })
  assert.equal(r.actual, 'quieto')
  assert.deepEqual([r.ancho, r.alto], [64, 64])
  const ctx = ctxFalso()
  const en = t => { r.avanzar(t); ctx.dibujos.length = 0; r.pintar(ctx, 1); return color(ctx.dibujos[0]) }
  assert.deepEqual(en(1000), ROJO)
  assert.deepEqual(en(1099), ROJO)
  assert.deepEqual(en(1100), VERDE)
  assert.deepEqual(en(1200), ROJO)
  assert.deepEqual(en(1350), VERDE)
  assert.equal(r.proximoCambio(), 1400)
  // El cuadro va en la zona, dentro del margen del lienzo.
  assert.deepEqual([ctx.dibujos[0].x, ctx.dibujos[0].y], ZONAS.cuerpo.origen)
})

test('a one-off animation goes back to «luego» when it ends, and its jump and effects are painted', () => {
  const { lienzo } = fabrica()
  const r = crearReproductor(mini(), { lienzo })
  r.avanzar(0)
  assert.equal(r.reproducir('saltar'), true)
  assert.equal(r.reproducir('no-existe'), false)
  const ctx = ctxFalso()
  r.avanzar(500)
  r.avanzar(510)
  r.pintar(ctx, 4)
  assert.equal(ctx.imageSmoothingEnabled, false)
  assert.equal(ctx.borrados, 1)
  const [lobo_, chispa] = ctx.dibujos
  assert.deepEqual(color(lobo_), AZUL)
  // azul está en (3, 4) y el paso sube 2: (8 + 3, 14 + 4 − 2) a escala 4.
  assert.deepEqual([lobo_.x, lobo_.y, lobo_.w, lobo_.h], [44, 64, 12, 8])
  assert.ok(chispa, 'la chispa sale')
  assert.equal(chispa.alfa, 1)
  // Estirar [1.5, 0.5]: 3×1 con el pie en el mismo sitio.
  ctx.dibujos.length = 0
  r.avanzar(560)
  r.pintar(ctx, 1)
  assert.deepEqual([ctx.dibujos[0].w, ctx.dibujos[0].h, ctx.dibujos[0].y], [3, 1, 14 + 1])
  // Al acabar vuelve a «quieto», y la chispa, que vive 300 ms, se apaga y se va.
  r.avanzar(600)
  assert.equal(r.actual, 'quieto')
  ctx.dibujos.length = 0
  r.avanzar(760)
  r.pintar(ctx, 1)
  assert.ok(ctx.dibujos[1].alfa < 1)
  ctx.dibujos.length = 0
  r.avanzar(800)
  r.pintar(ctx, 1)
  assert.equal(ctx.dibujos.length, 1)
})

test('bucle and luego can be changed, and playing the same one again does not restart it', () => {
  const { lienzo } = fabrica()
  const r = crearReproductor(mini(), { lienzo })
  r.reproducir('saltar', { bucle: true })
  r.avanzar(0)
  r.avanzar(250)
  assert.equal(r.actual, 'saltar')
  // Sin bucle, acaba la vuelta que va dando (la tercera, de 200 a 300) y pasa a «luego».
  r.reproducir('saltar', { bucle: false, luego: 'fijo' })
  r.avanzar(290)
  assert.equal(r.actual, 'saltar')
  r.avanzar(300)
  assert.equal(r.actual, 'fijo')
  r.avanzar(1000)
  assert.equal(r.proximoCambio(), Infinity)
  r.reproducir('quieto')
  r.avanzar(1000)
  r.reproducir('quieto')
  r.avanzar(1050)
  assert.equal(r.proximoCambio(), 1100, 'sigue por donde iba')
  r.reproducir('quieto', { reiniciar: true })
  r.avanzar(1050)
  assert.equal(r.proximoCambio(), 1150)
})

test('it sleeps: nothing to paint while nothing changes', () => {
  const { lienzo, creados } = fabrica()
  const r = crearReproductor(mini(), { lienzo })
  r.reproducir('fijo')
  const ctx = ctxFalso()
  assert.equal(r.avanzar(0), true)
  r.pintar(ctx, 2)
  for (let t = 16; t < 5000; t += 16) assert.equal(r.avanzar(t), false)
  assert.equal(r.proximoCambio(), Infinity)
  // Sin pintar, sigue diciendo que hay que pintar.
  r.reproducir('quieto')
  assert.equal(r.avanzar(5000), true)
  assert.equal(r.avanzar(5001), true)
  r.pintar(ctx, 2)
  assert.equal(r.avanzar(5002), false)
  assert.equal(r.avanzar(5100), true)
  // Cada cuadro se prepara una sola vez.
  for (let t = 5100; t < 5300; t += 16) if (r.avanzar(t)) r.pintar(ctx, 2)
  const antes = creados.length
  assert.equal(antes, 3)
  for (let t = 5300; t < 9000; t += 16) if (r.avanzar(t)) r.pintar(ctx, 2)
  assert.equal(creados.length, antes)
})

test('a clock that jumps hours ahead does not spawn a pile of effects', () => {
  const d = mini()
  d.animaciones.cuerpo.lluvia = { bucle: true, pasos: [{ cuadro: 'rojo', ms: 100 }], efectos: [{ efecto: 'chispa', en: 10, x: 0, y: 0 }, { efecto: 'chispa', en: 60, x: 2, y: 0 }] }
  const r = crearReproductor(d, { lienzo: fabrica().lienzo })
  r.reproducir('lluvia')
  r.avanzar(0)
  r.avanzar(3_600_000 + 70)
  const ctx = ctxFalso()
  r.pintar(ctx, 1)
  assert.ok(ctx.dibujos.length <= 3, `${ctx.dibujos.length} dibujos`)
  // Y una que acaba, tras un salto, vuelve a la de siempre.
  r.reproducir('saltar')
  r.avanzar(3_600_100)
  r.avanzar(7_200_000)
  assert.equal(r.actual, 'quieto')
})

test('reduce motion leaves only the still frame, without jumps or effects', () => {
  const d = mini()
  d.animaciones.cuerpo.saltar.fijo = 'verde'
  const r = crearReproductor(d, { quieto: true, lienzo: fabrica().lienzo })
  assert.equal(r.quieto, true)
  r.reproducir('saltar')
  const ctx = ctxFalso()
  r.avanzar(0)
  r.avanzar(20)
  r.pintar(ctx, 1)
  assert.equal(ctx.dibujos.length, 1)
  assert.deepEqual(color(ctx.dibujos[0]), VERDE)
  assert.deepEqual([ctx.dibujos[0].x, ctx.dibujos[0].y], [8, 14])
  assert.equal(r.proximoCambio(), 100)
  // «quieto» en bucle, con reducir movimiento, no cambia nunca: el primer cuadro y a dormir.
  r.avanzar(100)
  assert.equal(r.actual, 'quieto')
  ctx.dibujos.length = 0
  r.pintar(ctx, 1)
  assert.deepEqual(color(ctx.dibujos[0]), ROJO)
  for (let t = 116; t < 2000; t += 16) assert.equal(r.avanzar(t), false)
  assert.equal(r.proximoCambio(), Infinity)
  // Se puede quitar en marcha.
  r.quieto = false
  assert.equal(r.avanzar(2000), true)
})

test('the icon player uses the icon animations and its own canvas', () => {
  const r = crearReproductor(mini(), { tamaño: 'icono', lienzo: fabrica().lienzo })
  assert.deepEqual(r.animaciones(), ['quieto'])
  assert.deepEqual([r.ancho, r.alto], [24, 24])
  assert.throws(() => crearReproductor(mini(), { tamaño: 'grande' }), /cuerpo» o «icono/)
  const malo = mini()
  malo.cuadros.roto = ['x']
  assert.throws(() => crearReproductor(malo), /no está en la paleta/)
})
