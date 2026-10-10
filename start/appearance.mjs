const PALETTE_KEYS = ['bg', 'surface', 'surfaceHigh', 'text', 'muted', 'outline', 'primary', 'primaryContainer', 'secondary', 'tertiary']
const THEME_COLORS = Object.freeze({ claro: '#f6f5f1', oscuro: '#161a19' })

// Papel (Claro) o sumi (Oscuro). El inicio pinta su paleta con CSS según
// data-theme; la respuesta del servidor solo confirma lo que recibe el navegador.
export function parseAppearance(value) {
  if (![2, 3, 4, 5].includes(value?.version) || typeof value.fingerprint !== 'string' || !/^[a-f\d]{64}$/iu.test(value.fingerprint) || typeof value.motion !== 'boolean' || !value.palette || PALETTE_KEYS.some(key => typeof value.palette[key] !== 'string' || !/^#[a-f\d]{6}$/iu.test(value.palette[key]))) throw new Error('Paleta no válida.')
  if (value.version >= 3 && (!Object.hasOwn(THEME_COLORS, value.theme) || (value.background !== null && (typeof value.background !== 'string' || !/^[a-f\d]{64}$/u.test(value.background))))) throw new Error('Tema no válido.')
  return value
}

export function appearanceStatus(value) {
  if (value?.native?.available && value.native.status === 'applied') return 'Tema aplicado al navegador.'
  if (value?.native?.available && value.native.status === 'queued') return 'Aplicando el tema al navegador…'
  return 'Color aplicado al inicio. El tema del navegador no está disponible.'
}

export function createAppearance({ getSettings, refreshSettings = async () => {}, onStatus = () => {}, fetcher = (...args) => globalThis.fetch(...args) } = {}) {
  let controller = null
  let timer = null
  let alive = true
  let generation = 0
  let polling = false
  function applySettings(settings = getSettings()) {
    for (const [key, value] of Object.entries({ motion: settings.motion ? 'on' : 'off', focus: settings.focus ? 'on' : 'off', clock: settings.modules.clock ? 'on' : 'off', shortcuts: settings.modules.shortcuts ? 'on' : 'off' })) document.body.dataset[key] = value
    const root = document.documentElement
    root.dataset.theme = settings.theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[settings.theme] ?? THEME_COLORS.claro)
    // El icono de la pestaña también en negativo: la tinta no se ve sobre una pestaña oscura.
    const icon = document.querySelector('link[rel="icon"]')
    const href = settings.theme === 'oscuro' ? 'favicon-dark.svg' : 'favicon.svg'
    if (icon && icon.getAttribute('href') !== href) icon.setAttribute('href', href)
    // Solo un hash validado llega a la URL, y siempre es la ruta local del propio inicio.
    if (settings.background && location.protocol !== 'file:') {
      root.style.setProperty('--home-background', `url("/api/background/${settings.background}.jpg")`)
      root.dataset.background = 'on'
    } else {
      root.style.removeProperty('--home-background')
      root.dataset.background = 'off'
    }
  }
  async function refresh() {
    if (!alive || document.hidden || location.protocol === 'file:') return false
    const run = ++generation
    controller?.abort()
    const requestController = new AbortController()
    controller = requestController
    const relevant = settings => JSON.stringify([settings.motion, settings.theme, settings.background])
    const startedWith = relevant(getSettings())
    const timeout = setTimeout(() => requestController.abort(), 4000)
    try {
      const response = await fetcher('/api/appearance', { credentials: 'omit', cache: 'no-store', signal: requestController.signal })
      if (!response.ok) throw new Error('Appearance unavailable')
      const result = parseAppearance(await response.json())
      if (!alive || run !== generation) return false
      const settings = getSettings()
      // Ignore a response computed before the most recent preference change.
      if (startedWith !== relevant(settings) || result.motion !== settings.motion) return false
      onStatus(appearanceStatus(result))
      return true
    } catch (error) {
      if (alive && run === generation && error?.name !== 'AbortError') onStatus('No se ha podido actualizar el tema. Reintentando…')
      return false
    } finally { clearTimeout(timeout) }
  }
  async function tick() {
    if (!alive || document.hidden || polling) return
    polling = true
    try { await refreshSettings(); await refresh() }
    finally { polling = false }
  }
  function visibility() {
    clearInterval(timer)
    if (document.hidden) { controller?.abort(); return }
    void tick()
    timer = setInterval(() => void tick(), 2000)
  }
  document.addEventListener('visibilitychange', visibility)
  return { applySettings, refresh,
    start() { visibility() },
    destroy() { alive = false; generation++; clearInterval(timer); controller?.abort(); document.removeEventListener('visibilitychange', visibility) },
  }
}
