import { $ } from './dialogs.mjs'
import { imageUrl } from './bridge.mjs'

const IDENTIFIER = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u
const DIGEST = /^[\da-f]{64}$/u

/** Only well-formed presets from the local home server become buttons. */
export function parsePresets(value) {
  if (!Array.isArray(value?.categories)) return []
  return value.categories.filter(category => typeof category?.name === 'string' && Array.isArray(category.items)).map(category => ({
    name: category.name.slice(0, 40),
    items: category.items.filter(item => IDENTIFIER.test(item?.id) && DIGEST.test(item?.sha256)).map(item => ({
      id: item.id, sha256: item.sha256,
      label: typeof item.credit === 'string' ? item.credit.slice(0, 100) : typeof item.color === 'string' ? `Color ${item.color.slice(0, 7)}` : '',
    })),
  })).filter(category => category.items.length)
}

/** Fondos de serie: «Original» (sin imagen) y los de la librería local. */
export function initializePresets({ choose, fetcher = (...args) => globalThis.fetch(...args) }) {
  const gallery = $('#preset-gallery')
  let busy = false
  let ready = false
  async function pick(button) {
    if (busy) return
    busy = true
    for (const tile of gallery.querySelectorAll('.preset-tile')) tile.disabled = true
    try { await choose(button.dataset.preset) } finally {
      busy = false
      for (const tile of gallery.querySelectorAll('.preset-tile')) tile.disabled = !ready
    }
  }
  gallery.querySelector('.preset-original').addEventListener('click', event => void pick(event.currentTarget))
  let last = null
  let retries = 0
  async function load() {
    if (location.protocol === 'file:' || gallery.dataset.loaded) return
    try {
      const response = await fetcher('/api/wallpapers', { credentials: 'omit', cache: 'no-store' })
      if (!response.ok) return
      const body = await response.json()
      // Inicio integrado: la primera vez los fondos se bajan mientras tanto; la galería se completa sola.
      for (const node of gallery.querySelectorAll('.preset-heading, .preset-grid')) node.remove()
      for (const category of parsePresets(body)) {
        const heading = document.createElement('h4')
        heading.className = 'preset-heading'
        heading.textContent = category.name
        const grid = document.createElement('div')
        grid.className = 'preset-grid'
        category.items.forEach((item, index) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'preset-tile'
          button.dataset.preset = item.id
          button.dataset.sha = item.sha256
          button.disabled = true
          button.setAttribute('aria-pressed', 'false')
          button.setAttribute('aria-label', `${category.name} ${index + 1}${item.label ? ` · ${item.label}` : ''}`)
          if (item.label) button.title = item.label
          const image = document.createElement('img')
          void imageUrl(`/api/wallpapers/${item.id}.jpg`).then(url => { image.src = url }).catch(() => {})
          image.alt = ''
          image.loading = 'lazy'
          image.decoding = 'async'
          button.append(image)
          button.addEventListener('click', () => void pick(button))
          grid.append(button)
        })
        gallery.append(heading, grid)
      }
      if (last) sync(...last)
      if (body?.pending === true && retries++ < 60) setTimeout(() => void load(), 3000)
      else gallery.dataset.loaded = 'true'
    } catch { /* sin librería, queda Original y «Elegir imagen» */ }
  }
  function sync(settings, isReady) {
    last = [settings, isReady]
    ready = isReady
    for (const tile of gallery.querySelectorAll('.preset-tile')) {
      tile.setAttribute('aria-pressed', String(tile.dataset.preset ? tile.dataset.sha === settings.background : !settings.background))
      if (!busy) tile.disabled = !isReady
    }
  }
  return { load, sync }
}
