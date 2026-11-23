import assert from 'node:assert/strict'
import test from 'node:test'
import * as E from '../zero/modules/zero-estudio.mjs'
import { LOGROS, medidas, estado, nuevos } from '../zero/modules/zero-logros.mjs'
import { emptyData, addTime, addCount, merge, sanitize, lastDays, calendar, compare, byMonth, summarize } from '../zero/modules/zero-stats.mjs'

const page = (n, extra = {}) => ({ id: `pag-00000${n}`, url: `https://web${n}.es/`, titulo: `Web ${n}`, ...extra })
const ids = (data, space = 'e-1') => (data.espacios[space] ?? []).map(p => `${p.id.at(-1)}${p.abierta ? '' : '-'}`).join(' ')

test('a closed page stays in the study and comes back next time', () => {
  let data = E.anotar(E.vacio(), 'e-1', [page(1), page(2), page(3)])
  data = E.anotar(data, 'e-1', [page(1), page(3)])
  assert.equal(ids(data), '1 2- 3')
  assert.deepEqual(E.porAbrir(data, 'e-1', new Set(['pag-000001', 'pag-000003'])).map(p => p.url), ['https://web2.es/'])
  data = E.anotar(data, 'e-1', [])
  assert.equal(ids(data), '1- 2- 3-')
  assert.equal(E.porAbrir(data, 'e-1', new Set()).length, 3)
})

test('the order of now is kept, new pages go last, and a page opened again is not written twice', () => {
  let data = E.anotar(E.vacio(), 'e-1', [page(1), page(2), page(3)])
  data = E.anotar(data, 'e-1', [page(3), page(1)])
  assert.equal(ids(data), '3 2- 1')
  data = E.anotar(data, 'e-1', [page(3), page(1), page(4), { ...page(9), url: 'https://web2.es/' }])
  assert.equal(ids(data), '3 1 4 9')
})

test('removing it from the study is for good, and each profile has its own', () => {
  let data = E.anotar(E.anotar(E.vacio(), 'e-1', [page(1), page(2)]), 'e-2', [page(5)])
  data = E.quitar(data, 'e-1', 'pag-000001')
  assert.equal(ids(data), '2')
  assert.equal(ids(data, 'e-2'), '5')
  data = E.quitar(data, 'e-2', 'pag-000005')
  assert.deepEqual(Object.keys(data.espacios), ['e-1'])
})

test('internal pages are not kept, and there is a limit that drops closed ones first', () => {
  for (const bad of ['about:blank', 'chrome://browser/content/x', 'javascript:1', '', null]) assert.equal(E.guardable(bad), false)
  assert.equal(E.guardable('file:///C:/a.pdf'), true)
  const many = Array.from({ length: E.MAXIMO }, (_, i) => ({ id: `pag-${String(i).padStart(6, '0')}`, url: `https://w${i}.es/`, titulo: '' }))
  let data = E.anotar(E.vacio(), 'e-1', many)
  data = E.anotar(data, 'e-1', [...many.slice(1), page(1, { id: 'nueva-000001', url: 'https://nueva.es/' })])
  assert.equal(data.espacios['e-1'].length, E.MAXIMO)
  assert.ok(data.espacios['e-1'].every(p => p.abierta))
})

test('what is read from disk is checked', () => {
  const clean = E.limpia({ espacios: { 'e-1': [page(1, { estado: 5 }), page(1), { id: 'x' }, page(2, { url: 'about:config' })], '../x': [page(1)], 'e-3': 'no' } })
  assert.deepEqual(clean, { v: 1, espacios: { 'e-1': [{ ...page(1), abierta: true }] } })
  assert.deepEqual(E.limpia('hola'), E.vacio())
})

test('entering shows the study tabs and hides the rest, and leaving does the opposite', () => {
  const tabs = [
    { estudio: false, fijada: false, oculta: false, elegida: true, vista: 9 }, { estudio: true, fijada: false, oculta: true, elegida: false, vista: 2 },
    { estudio: true, fijada: false, oculta: true, elegida: false, vista: 5 }, { estudio: false, fijada: true, oculta: false, elegida: false, vista: 1 }]
  assert.deepEqual(E.plan(tabs, true), { mostrar: [1, 2], esconder: [0], elegir: 2 })
  assert.deepEqual(E.plan(tabs, false), { mostrar: [], esconder: [], elegir: 0 })
  assert.equal(E.plan([tabs[0]], true).elegir, -1)
})

// ---------------------------------------------------------------- los logros y lo nuevo de las estadísticas

test('every achievement has its texts, its goal and its own id', () => {
  assert.equal(new Set(LOGROS.map(l => l.id)).size, LOGROS.length)
  for (const l of LOGROS) {
    assert.match(l.id, /^[a-z0-9-]+$/)
    for (const text of [l.es, l.en, l.porque, l.why, l.icono]) assert.ok(text)
    assert.ok(l.meta > 0 && ['bronce', 'plata', 'oro'].includes(l.grado))
    assert.equal(l.valor(medidas(emptyData(), '2026-11-23')), 0)
  }
})

test('streaks count study days in a row, and the one of now is alive until tomorrow', () => {
  const data = emptyData(), days = lastDays('2026-11-23', 10)
  for (const day of [...days.slice(0, 3), ...days.slice(6, 9)]) addCount(data, day, 'estudio', 20 * 60)
  addCount(data, days[4], 'estudio', 60) // un minuto no cuenta como día de estudio
  assert.equal(medidas(data, '2026-11-23').rachaMejor, 3)
  assert.equal(medidas(data, '2026-11-23').racha, 3)
  assert.equal(medidas(data, '2026-11-24').racha, 0)
})

test('balance is more study than social and video', () => {
  const data = emptyData()
  addCount(data, '2026-11-22', 'estudio', 3600); addTime(data, '2026-11-22', 'youtube.com', 4000)
  addCount(data, '2026-11-23', 'estudio', 3600); addTime(data, '2026-11-23', 'instagram.com', 600)
  assert.equal(medidas(data, '2026-11-23').equilibrio, 1)
})

test('achievements are told once; those already done the first time are noted quietly', () => {
  const data = emptyData()
  addCount(data, '2026-11-20', 'notas', 1)
  assert.deepEqual(nuevos(data, '2026-11-20'), [])
  assert.equal(data.logros['primera-nota'], '2026-11-20')
  addCount(data, '2026-11-23', 'pomos', 1)
  assert.deepEqual(nuevos(data, '2026-11-23').map(l => l.id), ['pomo-1'])
  assert.deepEqual(nuevos(data, '2026-11-23'), [])
  const shown = estado(data, '2026-11-23')
  assert.equal(shown.find(l => l.id === 'pomo-1').dia, '2026-11-23')
  assert.equal(shown.find(l => l.id === 'pomo-25').parte, 1 / 25)
})

test('counters, hours, totals and achievements survive the disk, and the wrong ones do not', () => {
  const data = emptyData()
  addTime(data, '2026-11-23', 'a.es', 50, 9); addCount(data, '2026-11-23', 'notas', 2); nuevos(data, '2026-11-23')
  const back = sanitize(JSON.parse(JSON.stringify(data)))
  assert.equal(back.days['2026-11-23'].hours[9], 50)
  assert.equal(back.days['2026-11-23'].notas, 2)
  assert.deepEqual(back.total, { notas: 2 })
  assert.deepEqual(back.logros, { 'primera-nota': '2026-11-23' })
  assert.equal(addCount(data, '2026-11-23', 'inventado', 1), false)
  const bad = sanitize({ days: { '2026-11-23': { sites: {}, hours: [1, 2], estudio: -5 } }, total: { notas: 'x' }, logros: { 'X Y': '2026', ok: 'ayer' } })
  assert.equal(bad.days['2026-11-23'].hours, undefined)
  assert.deepEqual([bad.total, bad.logros], [{}, {}])
})

test('the calendar is whole weeks from Monday, and the comparison is with the same days before', () => {
  const data = emptyData()
  addTime(data, '2026-11-23', 'a.es', 100); addTime(data, '2026-11-22', 'a.es', 50)
  const weeks = calendar(data, '2026-11-23', 4) // el 23-11-2026 es lunes
  assert.equal(weeks.length, 4)
  assert.ok(weeks.every(w => w.length === 7))
  assert.deepEqual([weeks[3][0].day, weeks[3][0].level, weeks[3][1]], ['2026-11-23', 4, null])
  assert.deepEqual([weeks[2][6].day, weeks[2][6].level], ['2026-11-22', 2])
  assert.deepEqual(compare(data, '2026-11-23', 1), { antes: 50, cambio: 1 })
  assert.equal(compare(data, '2026-11-22', 1).cambio, null)
  assert.deepEqual(byMonth(summarize(data, '2026-12-01', 10).days).map(m => m.month), ['2026-11', '2026-12'])
})

test('bringing a backup never loses anything: the bigger value of each thing, the bigger total and the older achievement stay', () => {
  const here = emptyData(), other = emptyData()
  addTime(here, '2026-11-22', 'a.es', 100); addTime(other, '2026-11-22', 'a.es', 50); addTime(other, '2026-11-21', 'b.es', 10)
  addCount(here, '2026-11-22', 'notas', 2); addCount(other, '2026-11-21', 'notas', 5)
  here.logros = { 'primera-nota': '2026-11-22' }; other.logros = { 'primera-nota': '2026-11-20', rotulador: '2026-11-21' }
  here.days['2026-11-22'].pomos = 3
  other.days['2026-11-22'].hours = Array(24).fill(0).map((_, i) => (i === 9 ? 50 : 0))
  addTime(other, '2026-11-22', 'c.es', 7)
  assert.equal(merge(here, other), 2)
  assert.equal(here.days['2026-11-22'].pomos, 3)
  assert.equal(here.days['2026-11-22'].sites['c.es'], 7)
  assert.equal(here.days['2026-11-22'].hours[9], 50)
  assert.equal(merge(here, other), 0, 'traerla otra vez no cambia nada')
  assert.equal(here.days['2026-11-22'].sites['a.es'], 100)
  assert.equal(here.days['2026-11-21'].sites['b.es'], 10)
  assert.equal(here.total.notas, 5)
  assert.deepEqual(here.logros, { 'primera-nota': '2026-11-20', rotulador: '2026-11-21' })
})
