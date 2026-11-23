/* Kitsune Zero en Windows, con el motor de verdad: el bloc (cifrado, contraseñas, editor), el rotulador, el reparto de la
 * ventana, el modo Estudio (sus páginas vuelven, también tras cerrar Kitsune), las estadísticas a pantalla completa y los
 * logros, y el ayudante de la app de Spotify.
 *
 *   node tests/windows/zero_estudio_native.mjs --motor <carpeta con kitsune.exe> [--out <carpeta>] [--spotify] [--claro]
 *
 * El motor puede ser uno publicado con el Zero de este repositorio dentro (tools/windows/parchear-motor.ps1). Usa un perfil
 * nuevo y no toca el de la persona. Con --spotify entra en open.spotify.com (hace falta red).
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Marionette, makeProfile, launch } from './marionette.mjs'

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const engine = arg('--motor')
if (!engine || !fs.existsSync(path.join(engine, 'kitsune.exe'))) { console.error('Uso: --motor <carpeta con kitsune.exe>'); process.exit(2) }
const out = arg('--out') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-zero-estudio-'))
fs.mkdirSync(out, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = null) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'ok   ' : 'FALLA'} ${name}${ok || detail === null ? '' : ` · ${JSON.stringify(detail)}`}`) }

const PAGE = n => `<!doctype html><meta charset="utf-8"><title>Tema ${n}</title><style>body{font:18px/1.6 Georgia,serif;max-width:640px;margin:60px auto;color:#222;background:#fff}</style>
<h1>Tema ${n}: la célula</h1><p id="p1">La célula es la unidad básica de la vida. Todos los seres vivos están hechos de células.</p>
<p id="p2">La mitosis es la división de una célula en dos células hijas iguales. Ocurre en varias fases seguidas.</p><p style="height:1400px"></p><p id="fin">Final del tema ${n}.</p>`
/** Un PDF de una página con una línea de texto. */
const PDF = (() => {
  const text = 'BT /F1 28 Tf 72 700 Td (La mitosis en un PDF) Tj ET'
  const objects = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>', `<</Length ${text.length}>>stream\n${text}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>']
  let body = '%PDF-1.4\n'
  const at = objects.map((o, i) => { const here = body.length; body += `${i + 1} 0 obj${o}endobj\n`; return here })
  const xref = body.length
  return Buffer.from(body + `xref\n0 6\n0000000000 65535 f \n${at.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`)
})()
const server = http.createServer((req, res) => { if (req.url.endsWith('.pdf')) { res.setHeader('content-type', 'application/pdf'); res.end(PDF); return } res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE(/\/(\d)/.exec(req.url)?.[1] ?? '0')) })
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const PREFS = {
  'kitsune.zero.importProfile': false, 'kitsune.zero.welcomed': true, 'browser.shell.checkDefaultBrowser': false, 'browser.aboutwelcome.enabled': false,
  'browser.startup.homepage_override.mstone': 'ignore', 'datareporting.policy.dataSubmissionEnabled': false, 'app.update.disabledForTesting': true,
  'toolkit.telemetry.reportingpolicy.firstRun': false, 'kitsune.zero.ia.external': false, 'browser.startup.page': 3, 'browser.sessionstore.resume_from_crash': true,
  'browser.startup.homepage': 'about:blank', 'kitsune.privacy.requested': 'comodo', 'media.eme.enabled': true, 'browser.tabs.warnOnClose': false,
  'extensions.torlauncher.x': false, 'network.trr.mode': 5,
}
if (process.argv.includes('--claro')) Object.assign(PREFS, { 'kitsune.zero.light.mode': 'fixed', 'kitsune.zero.light.period': 'dia', 'kitsune.zero.light.scheme': 'light' })
let port = 3100 + Math.floor(Math.random() * 300)
const profile = makeProfile({ ...PREFS, 'marionette.port': port })
let child = null, c = null
const open = async () => {
  child = launch(engine, profile, port, ['-purgecaches'])
  c = await Marionette.connect(port, { timeout: 60000 })
  await c.session()
  await c.send('WebDriver:SetTimeouts', { script: 60000, pageLoad: 30000 })
  await until(() => c.js(`const w = Services.wm.getMostRecentWindow('navigator:browser'); return !!w?.document.getElementById('zero-notas') && !!w.document.getElementById('zero-mode')`), 30000)
  await sleep(1500)
}
async function until(fn, ms = 8000) {
  const end = Date.now() + ms
  let last
  for (;;) { try { last = await fn(); if (last) return last } catch (error) { last = error.message } if (Date.now() > end) throw new Error(`no llegó: ${String(fn).slice(0, 160)} → ${JSON.stringify(last)}`); await sleep(120) }
}
const W = `const win = Services.wm.getMostRecentWindow('navigator:browser'), doc = win.document, $ = s => doc.querySelector(s), mod = n => ChromeUtils.importESModule('chrome://browser/content/zero/' + n);`
const js = (script, args = []) => c.js(`${W} return (async () => { ${script} })();`, args)
const shot = async name => { const { value } = await c.send('WebDriver:TakeScreenshot', { full: false }); fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(value, 'base64')) }
const size = (w, h) => js(`win.restore(); win.moveTo(20, 20); win.resizeTo(${w}, ${h}); await new Promise(r => win.setTimeout(r, 500)); return [win.innerWidth, win.innerHeight]`)
const go = async url => { await js(`const b = win.gBrowser.selectedBrowser; b.loadURI(Services.io.newURI(arguments0), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`.replace('arguments0', JSON.stringify(url))); await until(() => js(`return win.gBrowser.selectedBrowser.currentURI.spec === ${JSON.stringify(url)} && !win.gBrowser.selectedTab.hasAttribute('busy')`)); await sleep(500) }
const box = id => js(`const e = $('#${id}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom, open: e.hasAttribute('open'), oculto: e.hasAttribute('oculto') }`)
const web = () => js(`const r = win.gBrowser.selectedBrowser.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }`)
/** Selecciona un trozo de la página con el ratón de verdad (los eventos que inventa una web no le valen al rotulador). */
const select = async (id, from, to) => {
  await c.send('Marionette:SetContext', { value: 'content' })
  try {
    const { value: p } = await until(async () => { const r = await c.send('WebDriver:ExecuteScript', { script: `if (document.readyState !== "complete") return null; getSelection().removeAllRanges(); const n = document.getElementById(${JSON.stringify(id)}).firstChild; n.parentNode.scrollIntoView({ block: 'center', behavior: 'instant' });
      const at = i => { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); return r.getBoundingClientRect(); }; const a = at(${from}), b = at(${to - 1}); return [a.left + 1, (a.top + a.bottom) / 2, b.right - 1, (b.top + b.bottom) / 2].map(Math.round)`, args: [], newSandbox: false }); return r.value ? r : null })
    const move = (x, y, duration = 0) => ({ type: 'pointerMove', x, y, duration, origin: 'viewport' })
    await c.send('WebDriver:PerformActions', { actions: [{ type: 'pointer', id: 'raton', parameters: { pointerType: 'mouse' }, actions: [move(p[0], p[1]), { type: 'pointerDown', button: 0 }, move((p[0] + p[2]) >> 1, p[1], 60), move(p[2], p[3], 60), { type: 'pointerUp', button: 0 }] }] })
    return (await c.send('WebDriver:ExecuteScript', { script: 'return String(getSelection())', args: [], newSandbox: false })).value
  } finally { await c.send('Marionette:SetContext', { value: 'chrome' }) }
}
const content = async script => { await c.send('Marionette:SetContext', { value: 'content' }); try { return (await c.send('WebDriver:ExecuteScript', { script, args: [], newSandbox: false })).value } finally { await c.send('Marionette:SetContext', { value: 'chrome' }) } }
const type = text => js(`const st = mod('zero-notas.sys.mjs')._debug.estado(win); st.editor.enfocar(); const d = st.editor.frame.contentDocument; const lines = ${JSON.stringify(text)}.split('\\n');
  for (let i = 0; i < lines.length; i++) { if (i) d.execCommand('insertParagraph', false, null); if (lines[i]) d.execCommand('insertText', false, lines[i]); } mod('zero-notas.sys.mjs')._debug.recoger(win); return true`)

try {
  await open()
  const dir = path.join(profile, 'kitsune-zero-notas')
  await js(`win.__errores = []; const o = { observe(m) { try { const e = m.QueryInterface(Ci.nsIScriptError); if (/zero/.test(e.sourceName || '') && !(e.flags & 1)) win.__errores.push(e.errorMessage + ' @ ' + e.sourceName + ':' + e.lineNumber); } catch {} } }; win.__oe = o; Services.console.registerListener(o);`)
  await size(1700, 1000)
  await go(`${base}/1`)

  // ---------------------------------------------------------------- el bloc
  await js(`$('#zero-notas-boton').click()`)
  await until(() => js(`return $('#zero-notas').getAttribute('vista') === 'nota' && !!mod('zero-notas.sys.mjs')._debug.estado(win).editor`))
  check('Sin notas, el bloc abre una en blanco', true)
  await type('Apuntes de biología\nLa célula es lo primero')
  await js(`$('#zero-notas .zn-titulo').value = 'Biología'; $('#zero-notas .zn-titulo').dispatchEvent(new win.Event('input')); mod('zero-notas.sys.mjs')._debug.recoger(win);`)
  await js(`await mod('zero-notas-almacen.sys.mjs').guardarYa();`)
  const files = fs.readdirSync(path.join(dir, 'notas'))
  const raw = files.map(f => fs.readFileSync(path.join(dir, 'notas', f), 'utf8')).join('') + fs.readFileSync(path.join(dir, 'llave.json'), 'utf8')
  check('La nota se guarda sola, en el perfil y cifrada', files.length === 1 && !/c[eé]lula|biolog/i.test(raw), { files })
  const blocks = await js(`const [n] = mod('zero-notas-almacen.sys.mjs').lista(''); return [n.titulo, n.bloques]`)
  check('Con su título y sus bloques', blocks[0] === 'Biología' && blocks[1].length === 2 && blocks[1][1].x[0] === 'La célula es lo primero', blocks)
  const md = await js(`const st = mod('zero-notas.sys.mjs')._debug.estado(win), d = st.editor.frame.contentDocument, h = st.editor.hoja;
    st.editor.alFinal(); d.execCommand('insertParagraph', false, null);
    const fire = data => { const e = new (st.editor.frame.contentWindow.InputEvent)('beforeinput', { inputType: 'insertText', data, bubbles: true, cancelable: true }); if (h.dispatchEvent(e)) d.execCommand('insertText', false, data); };
    d.execCommand('insertText', false, '[]'); fire(' '); d.execCommand('insertText', false, 'repasar');
    const b = h.lastElementChild; return [b.dataset.t, b.textContent]`)
  check('«[] » hace una casilla', md[0] === 'c' && md[1] === 'repasar', md)
  const mark = await js(`const st = mod('zero-notas.sys.mjs')._debug.estado(win), d = st.editor.frame.contentDocument, w = st.editor.frame.contentWindow;
    const n = st.editor.hoja.children[1].firstChild, r = d.createRange(); r.setStart(n, 3); r.setEnd(n, 9); const s = w.getSelection(); s.removeAllRanges(); s.addRange(r); st.editor.orden('rotulador');
    const on = JSON.stringify(st.editor.leer()[1].x); const s2 = w.getSelection(); st.editor.orden('rotulador'); return [on, JSON.stringify(st.editor.leer()[1].x)]`)
  check('El rotulador de la nota marca y, otra vez, desmarca', mark[0] === '["La ",["célula","m"]," es lo primero"]' && mark[1] === '["La célula es lo primero"]', mark)
  const paste = await js(`const st = mod('zero-notas.sys.mjs')._debug.estado(win), w = st.editor.frame.contentWindow; st.editor.alFinal();
    const cadena = t => { const x = Cc['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString); x.data = t; return x; };
    const tr = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable); tr.init(null);
    for (const [tipo, dato] of [['text/html', '<img src=x onerror=alert(1)><b>malo</b>'], ['text/plain', ' pegado']]) { tr.addDataFlavor(tipo); tr.setTransferData(tipo, cadena(dato)); }
    const clip = Services.clipboard, era = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable); era.init(null); era.addDataFlavor('text/plain');
    let guardado = null; try { clip.getData(era, clip.kGlobalClipboard, win.browsingContext.currentWindowContext); const o = {}; era.getTransferData('text/plain', o); guardado = o.value.QueryInterface(Ci.nsISupportsString).data; } catch {}
    clip.setData(tr, null, clip.kGlobalClipboard);
    st.editor.frame.focus(); st.editor.alFinal(); win.goDoCommand('cmd_paste'); await new Promise(r => win.setTimeout(r, 300));
    if (guardado !== null) Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(guardado);
    return [st.editor.hoja.querySelectorAll('img').length, st.editor.hoja.lastElementChild.textContent]`)
  check('Lo que se pega entra como texto, sin HTML', paste[0] === 0 && /pegado$/.test(paste[1]), paste)
  await js(`mod('zero-notas.sys.mjs')._debug.recoger(win)`)
  await sleep(700)
  await shot('01-bloc')

  // ---------------------------------------------------------------- el rotulador
  const text = await select('p2', 3, 10)
  const pill = await until(() => box('zero-rotulador').then(b => b?.open && b)).catch(() => null)
  const w1 = await web()
  check('Al seleccionar con el bloc abierto sale la píldora, encima de la web y cerca de lo marcado', pill && pill.x > w1.x && pill.r < w1.r && pill.y > w1.y && pill.y < w1.y + 400, { pill, w1, text })
  await shot('02-pildora')
  await js(`$('#zero-rotulador .zr-bloc').click()`)
  const cite = await until(() => js(`const n = mod('zero-notas-almacen.sys.mjs').lista('')[0]; const q = n.bloques.find(b => b.t === 'q'); return q ? [q.x.join(''), q.de] : null`)).catch(() => null)
  check('«Al bloc» lleva lo marcado como cita, con su página', cite?.[0] === 'mitosis' && cite[1]?.url === `${base}/1` && cite[1]?.titulo === 'Tema 1', cite)
  await select('p1', 3, 9)
  await until(() => box('zero-rotulador').then(b => b?.open))
  await js(`$('#zero-rotulador [data-color="amarillo"]').click()`)
  await until(() => content(`return CSS.highlights.get('kitsune-zero-amarillo')?.size === 1`))
  check('Subrayar lo pinta en la página sin tocar su contenido', await content(`return document.querySelectorAll('mark').length === 0 && [...CSS.highlights.get('kitsune-zero-amarillo')][0].toString() === 'célula'`))
  await sleep(300)
  await shot('03-subrayado')
  await js(`await mod('zero-rotulador.sys.mjs')._debug.guardarYa()`)
  const marks = fs.readFileSync(path.join(dir, 'subrayados.cofre'), 'utf8')
  check('Los subrayados se guardan cifrados', !/lula|127\.0\.0\.1/.test(marks))
  await js(`win.gBrowser.selectedBrowser.reload()`)
  check('Al volver a la página, el subrayado sigue ahí', await until(() => content(`return CSS.highlights.get('kitsune-zero-amarillo')?.size === 1 && [...CSS.highlights.get('kitsune-zero-amarillo')][0].toString() === 'célula'`), 10000).catch(() => false))
  // En un PDF: la palabra, con doble clic, al bloc.
  await go(`${base}/apuntes.pdf`)
  await c.send('Marionette:SetContext', { value: 'content' })
  const word = await until(async () => { const r = await c.send('WebDriver:ExecuteScript', { script: `const s = [...document.querySelectorAll('.textLayer span')].find(e => /mitosis/.test(e.textContent)); if (!s) return null; const r = document.createRange(), i = s.textContent.indexOf('mitosis'); r.setStart(s.firstChild, i); r.setEnd(s.firstChild, i + 7); const b = r.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]`, args: [], newSandbox: false }); return r.value }, 12000).catch(() => null)
  if (word) {
    const down = { type: 'pointerDown', button: 0 }, up = { type: 'pointerUp', button: 0 }
    await c.send('WebDriver:PerformActions', { actions: [{ type: 'pointer', id: 'raton', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: word[0], y: word[1], duration: 0, origin: 'viewport' }, down, up, down, up] }] })
  }
  await c.send('Marionette:SetContext', { value: 'chrome' })
  check('En un PDF también sale la píldora', await until(() => box('zero-rotulador').then(b => b?.open)).catch(() => false), word)
  await js(`$('#zero-rotulador .zr-bloc').click()`)
  const pdf = await until(() => js(`const n = mod('zero-notas-almacen.sys.mjs').lista('')[0]; const q = n.bloques.filter(b => b.t === 'q').at(-1); return /pdf$/.test(q?.de?.url ?? '') ? [q.x.join(''), q.de.url] : null`)).catch(() => null)
  check('Y lo marcado en él va al bloc', pdf?.[0] === 'mitosis' && pdf[1] === `${base}/apuntes.pdf`, pdf)
  await go(`${base}/1`)
  // Con el bloc cerrado y sin Estudio, nada sobre la página.
  await js(`$('#zero-notas .zn-cerrar').click()`)
  await select('p1', 0, 9)
  await sleep(500)
  check('Con el bloc cerrado no sale nada al seleccionar', !(await box('zero-rotulador')).open)

  // ---------------------------------------------------------------- el reparto
  const alone = await web()
  await js(`$('#zero-notas-boton').click()`)
  await until(() => box('zero-notas').then(b => b.open))
  check('Al volver a abrirlo, está la última nota', await until(() => js(`return $('#zero-notas').getAttribute('vista') === 'nota' && $('#zero-notas .zn-titulo').value === 'Biología'`)).catch(() => false))
  await js(`$('#zero-wolf').click()`)
  await sleep(1200)
  const gap = async () => ({ web: await web(), notas: await box('zero-notas'), ia: await box('zero-ia') })
  const pile = await gap()
  check('En una ventana normal, bloc arriba y asistente abajo, en una columna y sin pisar la web', Math.abs(pile.notas.x - pile.ia.x) < 1 && pile.notas.b < pile.ia.y && pile.web.r <= pile.notas.x && pile.web.w > 1000 && pile.web.w < alone.w, pile)
  await shot('04-los-tres')
  await js(`const l = $('#zero-reparto-linea'); for (let i = 0; i < 3; i++) l.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowUp' }));`)
  await sleep(400)
  const moved = await gap()
  check('La línea entre los dos reparte el sitio', moved.notas.h < pile.notas.h - 40 && moved.ia.h > pile.ia.h + 40)
  await size(900, 900); await sleep(400)
  const narrow = await gap()
  check('En una ventana estrecha flotan: la web no se queda en una tira', narrow.web.w > 600, narrow)
  await size(1500, 560); await sleep(400)
  const low = await gap()
  check('En una ventana baja, uno cada vez', (low.notas.oculto !== low.ia.oculto), low)
  await js(`$('#zero-notas-boton').click()`); await sleep(300)
  check('Y su botón trae delante el que no se ve', !(await box('zero-notas')).oculto && (await box('zero-ia')).oculto)
  await size(1700, 1000); await sleep(400)
  await js(`$('#zero-ia .zero-ia-close').click()`)

  // ---------------------------------------------------------------- una nota con contraseña
  const id = await js(`return mod('zero-notas.sys.mjs')._debug.estado(win).id`)
  await js(`await mod('zero-notas-almacen.sys.mjs').ponerContrasena(${JSON.stringify(id)}, 'clave-larga')`)
  await js(`$('#zero-notas .zn-atras').click()`)
  await until(() => js(`return $('#zero-notas').getAttribute('vista') === 'lista'`))
  await until(() => js(`return !!$('#zero-notas .zn-nota[cerrada]')`))
  const row = await js(`return $('#zero-notas .zn-nota[cerrada]').textContent`)
  check('De una nota con contraseña la lista solo enseña el título', /Biología/.test(row) && !/célula/.test(row), row)
  await sleep(300); await shot('05-lista')
  await js(`$('#zero-notas .zn-nota').click()`)
  await until(() => js(`return $('#zero-notas').getAttribute('vista') === 'cerrada'`))
  await js(`$('#zero-notas .zn-cerrada .zn-clave').value = 'mala-mala'; $('#zero-notas .zn-cerrada').requestSubmit();`)
  check('Con otra contraseña no se abre', await until(() => js(`return !$('#zero-notas .zn-cerrada .zn-mal').hidden && $('#zero-notas').getAttribute('vista') === 'cerrada'`), 15000).catch(() => false))
  await js(`$('#zero-notas .zn-cerrada .zn-clave').value = 'clave-larga'; $('#zero-notas .zn-cerrada').requestSubmit();`)
  check('Con la suya, sí', await until(() => js(`const st = mod('zero-notas.sys.mjs')._debug.estado(win); return $('#zero-notas').getAttribute('vista') === 'nota' && /célula/.test(st.editor.hoja.textContent)`), 15000).catch(() => false))
  await js(`$('#zero-notas .zn-cerrar').click()`)
  check('Al cerrar el panel se vuelve a cerrar', await until(() => js(`return !mod('zero-notas-almacen.sys.mjs').abiertaAhora(${JSON.stringify(id)})`)).catch(() => false))
  const two = await js(`const a = mod('zero-notas-almacen.sys.mjs');
    const otra = win.OpenBrowserWindow({ private: false }); await new Promise(r => otra.addEventListener('load', r, { once: true })); await otra.delayedStartupPromise;
    for (let i = 0; i < 60 && !otra.document.getElementById('zero-notas'); i++) await new Promise(r => win.setTimeout(r, 100));
    otra.document.getElementById('zero-notas-boton').click();
    for (let i = 0; i < 60 && otra.document.getElementById('zero-notas').getAttribute('vista') !== 'cerrada'; i++) await new Promise(r => win.setTimeout(r, 100));
    const pedia = otra.document.getElementById('zero-notas').getAttribute('vista');
    await a.abrirNota(${JSON.stringify(id)}, 'clave-larga'); const antes = a.abiertaAhora(${JSON.stringify(id)});
    otra.close(); await new Promise(r => win.setTimeout(r, 900));
    return [pedia, antes, a.abiertaAhora(${JSON.stringify(id)})]`)
  check('Cerrar una ventana vuelve a cerrar su nota con contraseña', two[0] === 'cerrada' && two[1] === true && two[2] === false, two)
  const race = await js(`const a = mod('zero-notas-almacen.sys.mjs'); const x = a.crear({ titulo: 'Carrera' }); const g = a.guardarYa(x); await a.borrar(x); await g; await new Promise(r => win.setTimeout(r, 900)); return IOUtils.exists(PathUtils.join(Services.dirsvc.get('ProfD', Ci.nsIFile).path, 'kitsune-zero-notas', 'notas', x + '.cofre'))`)
  check('Una nota borrada mientras se guardaba no reaparece', race === false, race)
  await js(`const a = mod('zero-notas-almacen.sys.mjs'); await a.abrirNota(${JSON.stringify(id)}, 'clave-larga'); await a.quitarContrasena(${JSON.stringify(id)});`)
  const back = await js(`const a = mod('zero-notas-almacen.sys.mjs'); const copia = await a.hacerCopia('copia-1234'); const uno = a.lista('').length; const deshacer = await a.borrar(${JSON.stringify(id)}); const sin = a.lista('').length;
    let mala = ''; try { await a.traerCopia(copia, 'otra-cosa'); } catch (e) { mala = e.message; } const n = await a.traerCopia(copia, 'copia-1234'); return [uno, sin, mala, n, a.lista('').length, /célula/.test(copia)]`)
  check('La copia para otro ordenador va cifrada y se puede traer', back[0] === 1 && back[1] === 0 && back[2] === 'contraseña' && back[3] === 1 && back[4] === 1 && back[5] === false, back)
  const tools = await js(`return mod('zero-ia-herramientas.sys.mjs').herramientasDe(win, {}).map(h => h.nombre)`)
  check('El asistente no tiene ninguna herramienta que llegue a las notas', !tools.some(n => /nota|bloc|subray|estudio/.test(n)), tools)

  // ---------------------------------------------------------------- el modo Estudio
  const tabs = () => js(`return [...win.gBrowser.tabs].filter(t => !t.closing).map(t => ({ url: t.linkedBrowser.currentURI.spec, oculta: t.hidden, estudio: !!mod('zero-estudio.sys.mjs')._debug.idDe(t), elegida: t.selected, texto: t.label }))`)
  await js(`$('#zero-mode [data-mode="study"]').click()`)
  await until(() => js(`return doc.documentElement.hasAttribute('zero-estudio')`))
  await sleep(1200)
  let list = await tabs()
  check('Al entrar en Estudio, lo de antes se aparta sin cerrarse', list.some(t => t.url === `${base}/1` && t.oculta && !t.estudio) && list.filter(t => !t.oculta).every(t => t.estudio), list)
  check('Y se abre el bloc', await until(() => box('zero-notas').then(b => b.open)).catch(() => false))
  await go(`${base}/2`)
  await js(`win.gBrowser.selectedTab = win.gBrowser.addTrustedTab(${JSON.stringify(`${base}/3`)})`)
  await until(() => js(`return win.gBrowser.selectedBrowser.currentURI.spec === ${JSON.stringify(`${base}/3`)}`))
  await content(`scrollTo(0, 600); return 1`)
  await sleep(1600)
  await js(`await mod('zero-estudio.sys.mjs')._debug.guardarYa()`)
  check('Las páginas del estudio se apuntan cifradas', fs.existsSync(path.join(dir, 'estudio.cofre')) && !/127\.0\.0\.1/.test(fs.readFileSync(path.join(dir, 'estudio.cofre'), 'utf8')))
  await js(`$('#zero-mode [data-mode="study"]').click()`)
  check('Otro clic en el libro enseña las páginas del estudio', await until(() => js(`return $('#zero-estudio').hasAttribute('open') && doc.querySelectorAll('#zero-estudio .ze-pagina').length === 2`)).catch(() => false), await js(`return doc.querySelectorAll('#zero-estudio .ze-pagina').length`))
  await sleep(400); await shot('06-estudio')
  await js(`$('#zero-mode [data-mode="study"]').click()`)
  // Se cierra una con la ×.
  await js(`win.gBrowser.removeTab(win.gBrowser.selectedTab, { animate: false })`)
  await sleep(1500)
  await js(`$('#zero-mode [data-mode="chill"]').click()`)
  await until(() => js(`return !doc.documentElement.hasAttribute('zero-estudio')`)); await sleep(700)
  list = await tabs()
  check('Al salir vuelve lo de antes y lo del estudio se esconde', list.filter(t => !t.oculta).every(t => !t.estudio) && list.some(t => t.url === `${base}/1` && t.elegida), list)
  await js(`$('#zero-mode [data-mode="study"]').click()`)
  await until(() => js(`return doc.documentElement.hasAttribute('zero-estudio')`)); await sleep(1500)
  list = await tabs()
  check('La página que se cerró vuelve al volver a entrar', list.filter(t => t.estudio && !t.oculta).length === 2, list)
  // Se cierra la última y no se cae en una de fuera.
  await js(`for (const t of [...win.gBrowser.tabs].filter(t => !t.hidden)) win.gBrowser.removeTab(t, { animate: false })`)
  await sleep(1200)
  list = await tabs()
  check('Cerrando todas las del estudio no se cae en las de fuera', list.filter(t => !t.oculta).length >= 1 && list.filter(t => !t.oculta).every(t => t.estudio), list)

  // ---------------------------------------------------------------- las estadísticas y los logros
  await js(`const s = mod('zero-stats.sys.mjs'), p = mod('zero-stats.mjs'); await s._debug.load(); const d = s._debug.data(), hoy = p.dayKey(), dias = p.lastDays(hoy, 150);
    const webs = ['youtube.com','wikipedia.org','github.com','spotify.com','instagram.com','claude.ai','docs.google.com','elpais.com'];
    dias.forEach((dia, i) => { if (i % 9 === 4) return; for (let k = 0; k < 5; k++) p.addTime(d, dia, webs[(i * 3 + k) % webs.length], 400 + ((i * 137 + k * 911) % 2600), (9 + k * 2 + i % 3) % 24); d.days[dia].searches = i % 7; d.days[dia].pages = 12 + i % 20; if (i > 140) p.addCount(d, dia, 'estudio', 3000 + i * 5); });
    p.addCount(d, hoy, 'pomos', 3); p.addCount(d, hoy, 'subrayados', 4); s.sumar('notas', 1);`)
  await js(`$('.zero-stats-button').click()`)
  await until(() => box('zero-stats').then(b => b.open)); await sleep(1300)
  const dash = await js(`const p = $('#zero-stats'), r = p.getBoundingClientRect(); return { full: Math.round(r.width) === win.innerWidth && Math.round(r.height) === win.innerHeight, dias: p.querySelectorAll('.zero-stats-day').length, logros: p.querySelectorAll('.zero-logro').length, hechos: p.querySelectorAll('.zero-logro[hecho]').length, semanas: p.querySelectorAll('.zero-heat-week').length, total: p.querySelector('.zero-stats-big b').textContent, delta: p.querySelector('.zero-stats-delta').textContent }`)
  check('Las estadísticas ocupan toda la ventana, con su gráfica, el calendario y los logros', dash.full && dash.dias === 7 && dash.logros === 20 && dash.hechos >= 3 && dash.semanas === 27 && /h|min/.test(dash.total), dash)
  await shot('07-estadisticas')
  for (const [span, n] of [[1, 24], [30, 30], [365, 12]]) {
    await js(`$('#zero-stats [data-span="${span}"]').click()`); await sleep(250)
    const got = await js(`return doc.querySelectorAll('#zero-stats .zero-stats-day').length`)
    check(`La gráfica de ${span} día(s) tiene sus columnas`, got >= Math.min(n, 5) && got <= n, got)
  }
  await js(`$('#zero-stats [data-span="30"]').click()`); await sleep(900); await shot('08-estadisticas-30')
  await js(`$('#zero-stats .zero-stats-scroll').scrollTop = 99999`); await sleep(300); await shot('09-logros')
  const over = await js(`const p = $('#zero-stats .zero-stats-page'); const bad = []; for (const e of p.querySelectorAll('*')) { if (e.scrollWidth > e.clientWidth + 2 && !['I'].includes(e.tagName) && win.getComputedStyle(e).overflowX === 'visible' && e.clientWidth) bad.push(e.className + ' ' + e.scrollWidth + '>' + e.clientWidth); } return bad.slice(0, 5)`)
  check('Nada se sale de su sitio', over.length === 0, over)
  await js(`win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  check('Esc las cierra', await until(() => box('zero-stats').then(b => !b.open)).catch(() => false))

  // ---------------------------------------------------------------- la app de Spotify (solo mira: no da a nada)
  const app = await js(`const { app } = mod('zero-spotify-app.sys.mjs'); const dejar = app.usar(); for (let i = 0; i < 80 && app.resto === undefined; i++) await new Promise(r => win.setTimeout(r, 150)); await app.pedir('estado'); const out = { error: app.error ? String(app.error) : null, abierta: app.ahora.abierta, cancion: !!app.ahora.titulo }; dejar(); await new Promise(r => win.setTimeout(r, 300)); out.parado = app.resto === ''; return out`)
  check('El ayudante de la app de Spotify contesta sin errores y se para al dejarlo', app && !app.error && (!app.abierta || app.cancion) && app.parado, app)

  // ---------------------------------------------------------------- la copia de Kitsune, con lo de Zero
  const conCopia = await js(`try { return !!ChromeUtils.importESModule('chrome://browser/content/kitsune-copia.sys.mjs').KitsuneCopia && /zero-copia/.test(await (await fetch('chrome://browser/content/kitsune-copia.sys.mjs')).text()); } catch { return false }`)
  const z = await js(`const { ZeroCopia } = mod('zero-copia.sys.mjs'), e = [{ id: 'e-00000000', name: 'General' }]; const j = await ZeroCopia.juntar({ espacios: e }); const a = mod('zero-notas-almacen.sys.mjs'); const id = a.lista('')[0].id; await a.borrar(id);
    const r = await ZeroCopia.traer(JSON.parse(JSON.stringify(j)), { espacios: e }); const otra = await ZeroCopia.traer(JSON.parse(JSON.stringify(j)), { espacios: e });
    return { notas: j.notas.length, paginas: j.estudio.map(x => [x.espacio, x.paginas.length]), sub: Object.keys(j.subrayados).length, dias: Object.keys(j.estadisticas.days).length > 50, r, otra, quedan: a.lista('').length, estado: JSON.stringify(j.estudio).includes('"estado"') }`)
  check('Lo de Zero se junta para la copia y vuelve sin repetirse', z.notas === 1 && z.sub === 1 && z.dias && z.r.notas === 1 && z.otra.notas === 0 && z.otra.subrayados === 0 && z.quedan === 1 && !z.estado, z)
  check('Traer basura no rompe nada', JSON.stringify(await js(`return mod('zero-copia.sys.mjs').ZeroCopia.traer({ version: 1, notas: [7, { id: '../x' }], subrayados: 'x', estudio: [null], estadisticas: 3 }, { espacios: [] })`)) === JSON.stringify({ notas: 0, subrayados: 0, paginas: 0, dias: 0 }))
  if (conCopia) {
    const file = path.join(profile, 'prueba.kitsune')
    const c1 = await js(`const { KitsuneCopia } = ChromeUtils.importESModule('chrome://browser/content/kitsune-copia.sys.mjs'); await KitsuneCopia.save(win, { path: ${JSON.stringify(file)}, password: 'clave-de-copia', bookmarks: false, tabs: false }); const t = await IOUtils.readUTF8(${JSON.stringify(file)}); const a = mod('zero-notas-almacen.sys.mjs'); await a.borrar(a.lista('')[0].id); const { result } = await KitsuneCopia.load(win, { path: ${JSON.stringify(file)}, password: 'clave-de-copia', bookmarks: false, tabs: false }); return [/lula|biolog/i.test(t), result.notes, a.lista('').length]`)
    check('La Copia de Kitsune lleva las notas cifradas y las devuelve', c1[0] === false && c1[1] === 1 && c1[2] === 1, c1)
  }
  const rec = await js(`const a = mod('zero-notas-almacen.sys.mjs'); Services.prefs.clearUserPref('kitsune.zero.copia.ultima'); const pocas = a.tocaCopia(); const ids = [1, 2, 3, 4, 5].map(n => a.crear({ titulo: 'Nota ' + n })); const si = a.tocaCopia(); a.copiaLuego(); const luego = a.tocaCopia(); for (const i of ids) await a.borrar(i); Services.prefs.clearUserPref('kitsune.zero.copia.luego'); return [pocas, si, luego]`)
  check('Con varias notas y sin copia se recuerda una vez, y se puede dejar para luego', rec[0] === false && rec[1] === true && rec[2] === false, rec)

  // Una nota que no se puede abrir: la copia lo dice, y no cuenta como copia hecha.
  const rota = await js(`const a = mod('zero-notas-almacen.sys.mjs'), c = mod('zero-cofre.sys.mjs'), { ZeroCopia } = mod('zero-copia.sys.mjs');
    const id = a.lista('')[0].id, mala = PathUtils.join(c.carpeta(), 'notas', id.slice(0, -1) + (id.at(-1) === 'a' ? 'b' : 'a') + '.cofre'); await a.guardarYa(); await IOUtils.writeUTF8(mala, 'basura'); a._debug.olvidar();
    const j = await ZeroCopia.juntar({ espacios: [] }); let hecha = null;
    try { const { KitsuneCopia } = ChromeUtils.importESModule('chrome://browser/content/kitsune-copia.sys.mjs'); Services.prefs.clearUserPref('kitsune.zero.copia.ultima'); const f = PathUtils.join(PathUtils.profileDir, 'rota.kitsune'); await KitsuneCopia.save(win, { path: f, password: 'clave-de-copia', bookmarks: false, tabs: false }); hecha = Services.prefs.prefHasUserValue('kitsune.zero.copia.ultima'); await IOUtils.remove(f); } catch (e) { hecha = String(e); }
    await IOUtils.remove(mala); a._debug.olvidar(); const bien = await ZeroCopia.juntar({ espacios: [] }); return { faltan: j.faltan, notas: j.notas.length, hecha, bien: bien.faltan }`)
  check('Si una nota no se puede abrir, la copia lo dice', rota.faltan.join() === 'notas' && rota.notas === 1 && rota.bien.length === 0, rota)
  if (conCopia) check('…y no calla el recordatorio', rota.hecha === false, rota)

  // ---------------------------------------------------------------- Spotify por la app (sin cuenta: la web y la app, de mentira)
  const spo = await js(`const s = mod('zero-spotify.sys.mjs'), { app } = mod('zero-spotify-app.sys.mjs'); if (!s.porLaApp()) return null;
    const eme = Services.prefs.getBoolPref('media.eme.enabled', false), antes = app.asegurar; Services.prefs.setBoolPref('media.eme.enabled', true); let abre = 0; app.asegurar = async () => { abre++; return 'sin-app'; };
    const web = spec => { const dicho = []; return { dicho, isConnected: true, currentURI: { spec }, browsingContext: { currentWindowGlobal: { getActor: () => ({ sendQuery: () => new Promise(() => {}), sendAsyncMessage: n => dicho.push(n) }) } } }; };
    const canal = browser => ({ QueryInterface() { return this; }, URI: { host: 'gue1-spclient.spotify.com', filePath: '/widevine-license/v1/audio/license' }, requestMethod: 'POST', loadInfo: { browsingContext: { top: { embedderElement: browser } } }, pasos: [], suspend() { this.pasos.push('retenida'); }, resume() { this.pasos.push('suelta'); }, cancel() { this.pasos.push('cancelada'); } });
    const pausa = ms => new Promise(r => win.setTimeout(r, ms));
    try {
      const t0 = Date.now(), b = web('https://open.spotify.com/'), como = await s.conectar(b), tarda = Date.now() - t0, aperturas = abre;
      const c1 = canal(web('https://example.com/')), c2 = canal(web('https://open.spotify.com/embed/track/1')), c3 = canal(web('https://open.spotify.com/track/1'));
      for (const c of [c1, c2, c3]) s._debug.observador.observe(c, 'http-on-modify-request');
      await pausa(600);
      return { como, tarda, dicho: b.dicho, ajena: c1.pasos, incrustada: c2.pasos, suya: c3.pasos, abreDeMas: abre - aperturas - 1 };
    } finally { app.asegurar = antes; Services.prefs.setBoolPref('media.eme.enabled', eme); }`)
  if (spo) {
    check('Sin la app de Spotify no se espera: se dice enseguida y la web deja de buscarla', spo.como === 'sin-app' && spo.tarda < 2500 && spo.dicho.join() === 'ZeroSpotify:dejar', spo)
    check('Un Spotify incrustado en otra web ni se retiene ni abre la app', spo.ajena.length === 0 && spo.incrustada.length === 0 && spo.abreDeMas === 0, spo)
    check('Lo del reproductor se retiene y siempre se suelta', spo.suya.join() === 'retenida,suelta', spo)
  }

  // ---------------------------------------------------------------- las actualizaciones firmadas
  const firma = await js(`const u = ChromeUtils.importESModule('chrome://browser/content/kitsune-updater.sys.mjs'); if (!u.firmaBuena) return null;
    const p = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']); const k = new Uint8Array(await crypto.subtle.exportKey('raw', p.publicKey)).toHex(); const s = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, p.privateKey, new TextEncoder().encode(u.MARCA_FIRMA + 'lista'))).toBase64();
    return [await u.firmaBuena('lista', s, [k]), await u.firmaBuena('otra', s, [k]), await u.firmaBuena('lista', s), u.CLAVES.length]`)
  if (firma) check('El actualizador comprueba la firma con el motor de verdad', firma[0] === true && firma[1] === false && firma[2] === false && firma[3] === 2, firma)

  // ---------------------------------------------------------------- el primer arranque
  await js(`const b = mod('zero-bienvenida.sys.mjs'); const st = b._debug.estado(win); if (st) b._debug.abrir(win);`)
  const bv = await js(`const b = mod('zero-bienvenida.sys.mjs'); return !!b._debug.estado(win)`)
  check('Quien ya conoce Zero no ve la bienvenida', bv === false)

  // ---------------------------------------------------------------- cerrar Kitsune y volver
  await js(`await mod('zero-estudio.sys.mjs')._debug.guardarYa();`)
  const errors = await js(`return win.__errores`)
  check('Ningún error de Zero en la consola', errors.length === 0, errors.slice(0, 6))
  await c.send('Marionette:Quit', { flags: ['eAttemptQuit'] }).catch(() => {})
  c.close()
  await until(() => child.exitCode !== null, 20000).catch(() => {})
  await sleep(1500)
  await open()
  const again = await until(() => js(`const e = mod('zero-estudio.sys.mjs'); return doc.documentElement.hasAttribute('zero-estudio') && [...win.gBrowser.tabs].filter(t => !t.hidden && e._debug.idDe(t)).length >= 2`), 15000).catch(() => false)
  list = await tabs()
  check('Al cerrar Kitsune y volver, sigue en Estudio y están sus páginas', again, list)
  const urls = await js(`const e = mod('zero-estudio.sys.mjs'); await e._debug.cargar(); return Object.values(e._debug.tienda.datos.espacios).flat().map(p => p.url).sort()`)
  check('Las dos, y sin repetirse', JSON.stringify(urls) === JSON.stringify([`${base}/2`, `${base}/3`]), urls)
  const kept = await js(`const a = mod('zero-notas-almacen.sys.mjs'); await a.cargar(); return a.lista('').map(n => [n.titulo, n.bloques?.length > 2])`)
  check('Y las notas de antes se abren', kept.length === 1 && kept[0][0] === 'Biología' && kept[0][1], kept)
  // La llave no se puede abrir (otro Windows): nada se pierde, y se puede empezar de cero.
  await js(`const cofre = mod('zero-cofre.sys.mjs'); $('#zero-notas').hasAttribute('open') && $('#zero-notas .zn-cerrar').click(); await new Promise(r => win.setTimeout(r, 900));
    await IOUtils.writeJSON(PathUtils.join(cofre.carpeta(), 'llave.json'), { v: 1, data: 'AAAA' }); cofre._debug.olvidar(); mod('zero-notas-almacen.sys.mjs')._debug.olvidar(); $('#zero-notas-boton').click();`)
  check('Si la llave no abre, el bloc lo dice y no toca nada', await until(() => js(`return $('#zero-notas').getAttribute('vista') === 'sin-llave'`), 12000).catch(() => false) && fs.readdirSync(path.join(dir, 'notas')).length === 1)
  await js(`const b = $('#zero-notas .zn-v-sin-llave .zn-no'); b.click(); b.click();`)
  await until(() => js(`return $('#zero-notas').getAttribute('vista') === 'lista'`)).catch(() => {})
  const old = fs.readdirSync(profile).filter(n => n.startsWith('kitsune-zero-notas.viejo-'))
  check('Empezar de cero aparta lo de antes entero, sin borrarlo', old.length === 1 && fs.readdirSync(path.join(profile, old[0], 'notas')).length === 1 && await js(`return mod('zero-notas-almacen.sys.mjs').lista('').length`) === 0, old)
  if (process.argv.includes('--spotify')) {
    await go('https://open.spotify.com/').catch(() => {})
    await sleep(2500)
    // Sin sesión no hay nada que conectar, y se dice.
    check('En la web de Spotify sin sesión iniciada no se toca nada', await js(`return mod('zero-spotify.sys.mjs').conectar(win.gBrowser.selectedBrowser)`) === 'sin-sesion' && await js(`return mod('zero-spotify.sys.mjs')._debug.estado.en`))
  }
} catch (error) {
  let mas = null
  try { mas = await js(`const st = mod('zero-notas.sys.mjs')._debug.estado(win); return { vista: $('#zero-notas').getAttribute('vista'), open: $('#zero-notas').hasAttribute('open'), frame: !!st.editorListo, editor: !!st.editor, errores: win.__errores }`) } catch { /* sin ventana */ }
  check('La prueba llega al final', false, [error.message, mas])
  try { await shot('99-fallo') } catch { /* sin ventana */ }
} finally {
  try { c?.close() } catch { /* ya */ }
  try { child?.kill() } catch { /* ya */ }
  server.close()
  fs.writeFileSync(path.join(out, 'resultado.json'), JSON.stringify(results, null, 1))
  const bad = results.filter(r => !r.ok)
  console.log(`\n${results.length - bad.length} de ${results.length} bien · ${out}`)
  await sleep(2500)
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* abierto aún */ }
  process.exit(bad.length ? 1 : 0)
}
