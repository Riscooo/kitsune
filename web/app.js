// Web de descarga de Kitsune: tema con la veta de tinta y los botones de descarga.
import { PLATFORMS, detectPlatform, parseDownloads } from './descargas.mjs'

const INK_MS = 1200
const INK_EASING = 'cubic-bezier(.65, 0, .35, 1)'
const root = document.documentElement
const toggle = document.querySelector('#theme-toggle')
// La web en inglés (/en) usa el mismo código: los textos que pone él, en su idioma.
const ENGLISH = root.lang === 'en'
const TEXT = ENGLISH ? {
  toLight: 'Switch to the light theme', toDark: 'Switch to the dark theme', download: 'Download', downloadFor: name => `Download for ${name}`,
  allReady: 'These are betas: if something breaks, tell us on GitHub.', someReady: 'If your system still says «Coming soon», it is nearly there.', version: 'Version',
} : {
  toLight: 'Cambiar a tema claro', toDark: 'Cambiar a tema oscuro', download: 'Descargar', downloadFor: name => `Descargar para ${name}`,
  allReady: 'Son betas: si algo falla, cuéntanoslo en GitHub.', someReady: 'Si tu sistema aún pone «Próximamente», ya casi está.', version: 'Versión',
}
// Las notas de downloads.json van en castellano.
const NOTES_EN = [['aún sin firmar', 'not signed yet'], ['se instala sin sudo', 'installs without sudo']]
const note = text => ENGLISH ? NOTES_EN.reduce((out, [es, en]) => out.replace(es, en), text) : text

function label() {
  toggle.setAttribute('aria-label', root.dataset.theme === 'oscuro' ? TEXT.toLight : TEXT.toDark)
}

// La misma veta que el inicio de Kitsune: hacia la derecha al pasar a Oscuro, hacia la izquierda a Claro.
function playInk(theme, apply) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (still || typeof document.startViewTransition !== 'function') { apply(); return }
  const dir = theme === 'oscuro' ? 'ltr' : 'rtl'
  const vein = document.createElement('div')
  vein.className = 'ink-vein'
  vein.dataset.dir = dir
  root.dataset.inkDir = dir
  const transition = document.startViewTransition(() => { apply(); document.body.append(vein) })
  transition.ready.then(() => vein.animate(
    { backgroundPosition: dir === 'ltr' ? ['100% 0', '0% 0'] : ['0% 0', '100% 0'] },
    { duration: INK_MS, easing: INK_EASING, fill: 'both' })).catch(() => {})
  transition.finished.finally(() => { vein.remove(); delete root.dataset.inkDir })
}

toggle.addEventListener('click', () => {
  const theme = root.dataset.theme === 'oscuro' ? 'claro' : 'oscuro'
  playInk(theme, () => { root.dataset.theme = theme; label() })
  try { localStorage.setItem('kitsune-tema', theme) } catch { /* sin almacenamiento */ }
})
label()

function render({ version, files }) {
  if (version) for (const node of document.querySelectorAll('[data-version]')) node.textContent = version
  for (const card of document.querySelectorAll('.platform')) {
    const file = files[card.dataset.platform]
    const button = card.querySelector('.platform-button')
    if (!file) continue
    button.href = file.url
    button.removeAttribute('aria-disabled')
    button.textContent = file.size ? `${TEXT.download} · ${file.size}` : TEXT.download
    card.dataset.ready = 'true'
    if (file.note) {
      const note = document.createElement('p')
      note.className = 'platform-note'
      note.textContent = note(file.note)
      button.after(note)
    }
  }
  const ready = Object.keys(files).length
  if (ready) document.querySelector('#downloads-note').textContent = ready === Object.keys(PLATFORMS).length
    ? TEXT.allReady
    : TEXT.someReady
  const mine = detectPlatform()
  const main = document.querySelector('#download-main')
  const mainLabel = document.querySelector('#download-main-label')
  const mainNote = document.querySelector('#download-main-note')
  if (mine) {
    mainLabel.textContent = TEXT.downloadFor(PLATFORMS[mine].name)
    document.querySelector(`.platform[data-platform=${mine}]`)?.setAttribute('data-mine', 'true')
  }
  const file = mine && files[mine]
  if (file) {
    main.disabled = false
    mainNote.textContent = [file.size, file.note && note(file.note)].filter(Boolean).join(' · ') || `${TEXT.version} ${version ?? ''}`.trim()
    main.addEventListener('click', () => { location.href = file.url })
    document.querySelector('#hero-note').hidden = true
  }
}

for (const disabled of document.querySelectorAll('.platform-button[aria-disabled=true]')) {
  disabled.addEventListener('click', event => { if (disabled.getAttribute('aria-disabled') === 'true') event.preventDefault() })
}

async function loadDownloads() {
  try {
    const response = await fetch('/downloads.json', { cache: 'no-store' })
    render(parseDownloads(response.ok ? await response.json() : null, location.origin))
  } catch { render(parseDownloads(null, location.origin)) }
}
void loadDownloads()
