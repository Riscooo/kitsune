import assert from 'node:assert/strict'
import test from 'node:test'
import { repartir, parteEn, MARCO, HUECO, WEB, PANEL } from '../zero/modules/zero-reparto.mjs'

const ia = extra => ({ lado: 'der', forma: 'columna', ancho: 380, alto: 520, ...extra })
const notas = extra => ({ lado: 'der', ancho: 400, ...extra })
const web = (r, ancho) => ancho - MARCO.izq - MARCO.web - r.web.izq - r.web.der

test('with nothing open the web has it all', () => {
  assert.deepEqual(repartir({ ancho: 1920, alto: 1040 }).web, { izq: 0, der: 0 })
})

test('one panel alone takes a column and the web makes room, as the assistant always did', () => {
  const only = repartir({ ancho: 1920, alto: 1040, ia: ia() })
  assert.deepEqual([only.forma, only.web, only.ia.der, only.ia.ancho, only.ia.arriba, only.ia.abajo], ['ia', { izq: 0, der: 390 }, 10, 380, 46, 26])
  const left = repartir({ ancho: 1920, alto: 1040, notas: notas({ lado: 'izq' }) })
  assert.deepEqual([left.forma, left.web, left.notas.izq, left.notas.der], ['notas', { izq: 410, der: 0 }, 50, null])
})

test('on a normal screen both share one column, notes on top, and the web stays wide', () => {
  const r = repartir({ ancho: 1920, alto: 1040, ia: ia(), notas: notas() })
  assert.equal(r.forma, 'pila')
  assert.equal(r.web.der, 410)
  assert.ok(web(r, 1920) > 1400)
  const alto = 1040 - 46 - 26, hNotas = 1040 - r.notas.arriba - r.notas.abajo, hIa = 1040 - r.ia.arriba - r.ia.abajo
  assert.equal(hNotas + hIa + HUECO, alto)
  assert.equal(r.notas.arriba + hNotas + HUECO, r.ia.arriba)
  assert.equal(r.linea.arriba, r.notas.arriba + hNotas)
})

test('on a wide screen there are two columns, the notes next to the web', () => {
  const r = repartir({ ancho: 2560, alto: 1400, ia: ia(), notas: notas() })
  assert.equal(r.forma, 'columnas')
  assert.ok(r.notas.der > r.ia.der)
  assert.equal(r.notas.der, 10 + 380 + HUECO)
  assert.equal(r.web.der, 380 + 400 + 2 * HUECO)
  assert.ok(web(r, 2560) >= WEB.comoda)
})

test('each on its side when the person put them on different sides', () => {
  const r = repartir({ ancho: 1920, alto: 1040, ia: ia(), notas: notas({ lado: 'izq' }) })
  assert.equal(r.forma, 'lados')
  assert.deepEqual(r.web, { izq: 410, der: 390 })
})

test('on a low window they take turns: the last one opened is the one you see', () => {
  const low = { ancho: 1400, alto: 480, ia: ia(), notas: notas() }
  assert.deepEqual([repartir({ ...low, ultimo: 'ia' })].map(r => [r.forma, r.ia.oculto, r.notas.oculto]), [['turnos', false, true]])
  assert.deepEqual([repartir({ ...low, ultimo: 'notas' })].map(r => [r.ia.oculto, r.notas.oculto]), [[true, false]])
})

test('on a narrow window they float: the web is never left as a strip', () => {
  const r = repartir({ ancho: 800, alto: 900, ia: ia(), notas: notas() })
  assert.deepEqual(r.web, { izq: 0, der: 0 })
  assert.equal(r.notas.flota, true)
  for (let ancho = 420; ancho <= 3000; ancho += 37) for (const alto of [380, 700, 1040, 1400]) for (const lado of ['izq', 'der']) for (const forma of ['columna', 'esquina', 'pestana']) {
    const x = repartir({ ancho, alto, ia: ia({ forma }), notas: notas({ lado }) })
    if (x.web.izq || x.web.der) assert.ok(web(x, ancho) >= WEB.minima, `${ancho}x${alto} ${lado} ${forma}`)
    for (const p of [x.ia, x.notas]) if (p.arriba !== undefined && p.abajo !== undefined && alto >= 700) assert.ok(alto - p.arriba - p.abajo >= PANEL.minAlto)
  }
})

test('the corner and the tab shapes of the assistant respect the notes', () => {
  const corner = repartir({ ancho: 1920, alto: 1040, ia: ia({ forma: 'esquina' }), notas: notas() })
  assert.equal(corner.ia.der, 26 + 400 + HUECO)
  assert.equal(corner.web.der, 410)
  const tab = repartir({ ancho: 1920, alto: 1040, ia: ia({ forma: 'pestana' }), notas: notas() })
  assert.equal(tab.ia.der, 26 + 410)
})

test('the line between both moves within reason', () => {
  assert.equal(parteEn(46, 1040), 0.2)
  assert.equal(parteEn(1040, 1040), 0.8)
  const r = repartir({ ancho: 1920, alto: 1040, ia: ia(), notas: notas(), parte: parteEn(525, 1040) })
  assert.ok(Math.abs(r.linea.arriba - 525) <= 2)
})
