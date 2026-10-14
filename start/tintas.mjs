// Tintas: el selector de «Tu inicio» → Apariencia. El catálogo llega de /api/tintas.
export async function initializeTintas({ $, save, getSettings }) {
  const grid = $('#tinta-grid')
  let catalog = []
  try {
    const response = await fetch('/api/tintas', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (response.ok) catalog = (await response.json()).tintas ?? []
  } catch { /* sin catálogo: el selector se queda vacío */ }
  const render = (settings = getSettings(), ready = true) => {
    grid.replaceChildren(...catalog.map(tinta => {
      const palette = tinta[settings.theme] ?? tinta.claro
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'tinta'
      button.setAttribute('role', 'radio')
      button.setAttribute('aria-checked', String(tinta.id === settings.tinta))
      button.dataset.tinta = tinta.id
      button.disabled = !ready
      button.title = tinta.author && tinta.author !== 'Kitsune' ? `${tinta.name} · de ${tinta.author}` : tinta.name
      const swatch = document.createElement('span')
      swatch.className = 'tinta-swatch'
      swatch.setAttribute('aria-hidden', 'true')
      swatch.style.setProperty('--swatch-bg', palette.bg)
      swatch.style.setProperty('--swatch-primary', palette.primary)
      swatch.style.setProperty('--swatch-secondary', palette.secondary)
      swatch.style.setProperty('--swatch-text', palette.text)
      const name = document.createElement('span')
      name.className = 'tinta-name'
      name.textContent = tinta.name
      button.append(swatch, name)
      button.addEventListener('click', () => void save({ tinta: tinta.id }))
      return button
    }))
  }
  render()
  return { render }
}
