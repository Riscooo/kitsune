import assert from 'node:assert/strict'
import test from 'node:test'
import * as cofre from '../zero/modules/zero-cofre.mjs'
import * as N from '../zero/modules/zero-notas.mjs'

const key = () => cofre.importarLlave(cofre.llaveNueva())

test('what is sealed comes back the same, and cannot be read in the sealed file', async () => {
  const k = await key(), value = { titulo: 'Biología', bloques: [{ t: 'p', x: ['la mitosis'] }] }
  const sealed = await cofre.cerrar(k, value, 'notas/abc-123456')
  assert.ok(!JSON.stringify(sealed).includes('mitosis'))
  assert.deepEqual(await cofre.abrir(k, sealed, 'notas/abc-123456'), value)
})

test('a sealed file does not open with another key, in another place, or once touched', async () => {
  const k = await key(), sealed = await cofre.cerrar(k, { a: 1 }, 'notas/abc-123456')
  await assert.rejects(cofre.abrir(await key(), sealed, 'notas/abc-123456'))
  await assert.rejects(cofre.abrir(k, sealed, 'notas/otra-123456'))
  const bytes = cofre.deBase64(sealed.data); bytes[0] ^= 1
  await assert.rejects(cofre.abrir(k, { ...sealed, data: cofre.aBase64(bytes) }, 'notas/abc-123456'))
  await assert.rejects(cofre.abrir(k, null, 'notas/abc-123456'))
})

test('a note with a password opens only with it, and closes again without asking', async () => {
  const lock = await cofre.cerraduraNueva('hola1234', 1000)
  const sealed = await cofre.cerrarConCerradura(lock, ['secreto'], 'nota')
  await assert.rejects(cofre.abrirConContrasena('hola', sealed, 'nota'), /contraseña/)
  const { valor, cerradura } = await cofre.abrirConContrasena('hola1234', sealed, 'nota')
  assert.deepEqual(valor, ['secreto'])
  const again = await cofre.cerrarConCerradura(cerradura, ['otra cosa'], 'nota')
  assert.deepEqual((await cofre.abrirConContrasena('hola1234', again, 'nota')).valor, ['otra cosa'])
})

test('base64 survives big data', () => {
  const bytes = new Uint8Array(100_000).map((_, i) => i % 256)
  assert.deepEqual(cofre.deBase64(cofre.aBase64(bytes)), bytes)
})

test('a note from disk is checked: unknown blocks, marks and links are dropped', () => {
  const note = N.notaLimpia({ id: 'abc-123456', titulo: ' Uno\ndos ', creada: 5, tocada: 9, fijada: 1, bloques: [
    { t: 'script', x: ['<b>hola</b>'] }, { t: 'q', x: [['cita', 'zbm']], de: { url: 'javascript:alert(1)', titulo: 'Web' } }, null, { t: 'c', x: ['a', 'b', ['c', '']], hecho: true }] })
  assert.equal(note.titulo, ' Uno dos ')
  assert.deepEqual(note.bloques, [
    { t: 'p', x: ['<b>hola</b>'] }, { t: 'q', x: [['cita', 'bm']], de: { url: '', titulo: 'Web' } }, { t: 'c', x: ['abc'], hecho: true }])
  assert.equal(N.notaLimpia({ id: '../../x', bloques: [] }), null)
  assert.deepEqual(N.notaLimpia({ id: 'abc-123456', bloques: 'x' }).bloques, [{ t: 'p', x: [] }])
})

test('control characters never get in', () => {
  assert.deepEqual(N.trozosLimpios(['a\u0000b\u001bc\u007f', ['\td', 'b']]), ['abc', ['\td', 'b']])
})

test('the list shows a title and where the text goes; a locked note shows nothing of its text', () => {
  const note = { ...N.notaNueva(1), titulo: '', bloques: N.deTexto('# Tema 1\n- la célula\n\n[x] repasar') }
  assert.deepEqual(N.resumen(note), { titulo: 'Tema 1', texto: 'la célula · repasar' })
  assert.deepEqual(N.resumen({ id: 'abc-123456', titulo: 'Diario', cerrada: {} }), { titulo: 'Diario', texto: '' })
  assert.equal(N.vacia(N.notaNueva(1)), true)
  assert.equal(N.vacia(note), false)
})

test('searching ignores accents and case, wants every word, and pinned notes go first', () => {
  const make = (id, titulo, texto, tocada, fijada = false) => ({ id, titulo, creada: 1, tocada, fijada, bloques: N.deTexto(texto) })
  const notes = [make('aaa-111', 'Física', 'la inercia', 1), make('bbb-222', 'Química', 'átomo', 3), make('ccc-333', 'Lista', 'física y más', 2, true)]
  assert.deepEqual(N.buscar(notes).map(n => n.id), ['ccc-333', 'bbb-222', 'aaa-111'])
  assert.deepEqual(N.buscar(notes, 'FISICA').map(n => n.id), ['ccc-333', 'aaa-111'])
  assert.deepEqual(N.buscar(notes, 'fisica inercia').map(n => n.id), ['aaa-111'])
  assert.deepEqual(N.buscar([{ id: 'ddd-444', titulo: 'Privada', tocada: 1, fijada: false, cerrada: {} }], 'secreto'), [])
})

test('a quote goes to the end with its source, before the empty line you were on', () => {
  const note = N.conCita({ ...N.notaNueva(1), bloques: N.deTexto('hola\n') }, ' uno \n\n dos ', { url: 'https://es.wikipedia.org/wiki/C%C3%A9lula', titulo: 'Célula' }, 7)
  assert.deepEqual(note.bloques, [{ t: 'p', x: ['hola'] }, { t: 'q', x: ['uno'] }, { t: 'q', x: ['dos'], de: { url: 'https://es.wikipedia.org/wiki/C%C3%A9lula', titulo: 'Célula' } }, { t: 'p', x: [] }])
  assert.equal(note.tocada, 7)
  assert.equal(N.conCita(note, '  \n '), note)
  assert.equal('de' in N.conCita(N.notaNueva(1), 'x', { url: 'about:config', titulo: '' }).bloques[0], false)
})

test('writing shortcuts and Markdown out', () => {
  assert.deepEqual(['#', '- ', '[]', '> ', 'hola', ''].map(N.atajo), ['h', 'l', 'c', 'q', null, null])
  const note = { titulo: 'T', bloques: [{ t: 'h', x: ['A'] }, { t: 'l', x: ['uno', [' dos', 'b']] }, { t: 'l', x: [['x', 'm']] }, { t: 'c', x: ['hecho'], hecho: true }, { t: 'q', x: ['c'], de: { url: 'https://a.es/', titulo: 'W' } }] }
  assert.equal(N.aMarkdown(note), '# T\n\n## A\n- uno** dos**\n- ==x==\n- [x] hecho\n\n> c\n>\n> — [W](https://a.es/)\n')
})

test('a highlight belongs to its page, whatever the tracking or the anchor', () => {
  assert.equal(N.pagina('https://a.es/x?utm_source=1&b=2#trozo'), 'https://a.es/x?b=2')
  assert.equal(N.pagina('https://a.es/app#/tema/3'), 'https://a.es/app#/tema/3')
  assert.equal(N.pagina('file:///C:/apuntes.pdf'), 'file:///C:/apuntes.pdf')
  for (const bad of ['about:blank', 'javascript:1', 'resource://x/y', 'no']) assert.equal(N.pagina(bad), '')
})

test('a highlight is found again although the page has moved, and lost if its text is gone', () => {
  const before = 'Intro. La célula es la unidad. Otra vez: la célula vive.'
  const start = before.lastIndexOf('la célula'), anchor = N.ancla(before, start, start + 9)
  const after = 'Un anuncio nuevo. ' + before
  const [from, to] = N.encontrar(after, anchor)
  assert.equal(after.slice(from, to), 'la célula')
  assert.equal(from, after.lastIndexOf('la célula'))
  assert.equal(N.encontrar('nada que ver', anchor), null)
  assert.equal(N.encontrar(after, null), null)
})

test('with the same text around, the closest one wins', () => {
  const text = 'aXa aXa aXa'
  assert.deepEqual(N.encontrar(text, { exacto: 'X', antes: '', despues: '', donde: 5 }), [5, 6])
})

test('highlights from disk are checked', () => {
  const clean = N.subrayadosLimpios({ 'https://a.es/': [{ id: 'abc-123456', color: 'negro', exacto: 'hola', antes: 'x'.repeat(99), donde: 3 }, { id: 'abc-999999', exacto: '' }, 7], 'about:config': [{ id: 'abc-123456', exacto: 'x' }], 'https://b.es/': 'no' })
  assert.deepEqual(clean, { 'https://a.es/': [{ id: 'abc-123456', color: 'amarillo', exacto: 'hola', antes: 'x'.repeat(40), despues: '', donde: 3, cuando: 0 }] })
  assert.deepEqual(N.subrayadosLimpios(null), {})
})
