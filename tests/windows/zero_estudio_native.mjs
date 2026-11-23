/* Kitsune Zero en Windows, con el motor de verdad: el bloc (cifrado, contraseñas, editor), el rotulador, el reparto de la
 * ventana, el modo Estudio (sus páginas vuelven, también tras cerrar Kitsune), las estadísticas a pantalla completa y los
 * logros, y qué DRM se ofrece a Spotify.
 *
 *   node tests/windows/zero_estudio_native.mjs --motor <carpeta con kitsune.exe> [--out <carpeta>] [--spotify]
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

  // ---------------------------------------------------------------- la app de Spotify en el panel (solo mira: no da a nada)
  await js(`win.__elegir = id => { const m = mod('zero-music.sys.mjs'); $('#zero-music-pill .zero-music').click(); return !!doc.querySelector('#zero-music-services [data-service="' + id + '"]'); }`)
  check('La lista de música ofrece la app de Spotify', await js(`return win.__elegir('spotify-app')`))
  await js(`$('#zero-music-services [data-service="spotify-app"]').click()`)
  await until(() => js(`const a = mod('zero-spotify-app.sys.mjs').app; return $('#zero-music').hasAttribute('open') && !!$('#zero-music .zero-music-app')`))
  const app = await until(() => js(`const a = mod('zero-spotify-app.sys.mjs').app; return a.resto !== undefined && (a.ahora.abierta || a.error || win.__vez > 12) ? { abierta: a.ahora.abierta, error: a.error ? String(a.error) : null, cancion: !!a.ahora.titulo, portada: a.ahora.portada.length, texto: $('#zero-music .zero-app-text b').textContent } : ((win.__vez = (win.__vez ?? 0) + 1), null)`), 20000).catch(() => null)
  check('El panel dice lo que hay en la app (o que se abra), sin errores', app && !app.error && app.texto.length > 2 && (!app.abierta || app.cancion), app)
  await sleep(600); await shot('10-spotify-app')
  await js(`$('#zero-music .zero-music-minimize').click()`); await sleep(400)
  check('Y el minipanel también', await js(`return $('#zero-mini').hasAttribute('open') && $('#zero-mini .zero-mini-title').textContent.length > 1`))
  await js(`$('#zero-mini .zero-mini-close').click()`)
  await js(`await new Promise(r => win.setTimeout(r, 600))`)
  check('Al cerrarlo, el ayudante se para', await js(`const a = mod('zero-spotify-app.sys.mjs').app; return a.resto === ''`))

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
  if (process.argv.includes('--spotify')) {
    await go('https://open.spotify.com/').catch(() => {})
    await sleep(2500)
    const eme = await content(`return navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }] }]).then(() => 'widevine', e => e.name)`)
    const pr = await content(`return navigator.requestMediaKeySystemAccess('com.microsoft.playready.recommendation.3000', [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }] }]).then(a => a.createMediaKeys()).then(() => 'playready', e => e.name + ' ' + e.message)`)
    check('A Spotify se le ofrece la DRM de Windows y no Widevine', eme === 'NotSupportedError' && pr === 'playready', { eme, pr })
    await js(`Services.prefs.setStringPref('kitsune.zero.music.service', 'spotify'); $('#zero-music-pill .zero-music').click()`)
    await until(() => js(`return !!$('#zero-music .zero-music-player')`))
    await js(`for (const fn of mod('zero-spotify.sys.mjs')._debug.estado.escuchas) fn({ sistema: 'playready', dada: false, status: 403 })`)
    check('Si Spotify niega la licencia, el panel ofrece su app', await js(`const d = $('#zero-music .zero-music-drm'); return !d.hidden && /app/i.test(d.querySelector('button').textContent)`))
    await js(`$('#zero-music .zero-music-drm button').click()`)
    check('Y con un clic se pasa a ella', await until(() => js(`return !!$('#zero-music .zero-music-app') && !$('#zero-music .zero-music-player')`)).catch(() => false))
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
