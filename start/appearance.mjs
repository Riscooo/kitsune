const PALETTE_KEYS = ['bg', 'surface', 'surfaceHigh', 'text', 'muted', 'outline', 'primary', 'primaryContainer', 'secondary', 'tertiary']
const CSS_KEYS = { bg: '--bg', surface: '--surface', surfaceHigh: '--surface-high', text: '--text', muted: '--muted', outline: '--outline', primary: '--accent', primaryContainer: '--accent-dark', secondary: '--secondary', tertiary: '--tertiary' }

// Kitsune 0.5 «Tinta»: una sola paleta (papel); solo varía el movimiento.
export function parseAppearance(value) {
  if (value?.version !== 2 || typeof value.fingerprint !== 'string' || !/^[a-f\d]{64}$/iu.test(value.fingerprint) || typeof value.motion !== 'boolean' || !value.palette || PALETTE_KEYS.some(key => typeof value.palette[key] !== 'string' || !/^#[a-f\d]{6}$/iu.test(value.palette[key]))) throw new Error('Paleta no válida.')
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
  }
  async function refresh() {
    if (!alive || document.hidden || location.protocol === 'file:') return false
    const run = ++generation
    controller?.abort()
    const requestController = new AbortController()
    controller = requestController
    const relevant = settings => JSON.stringify([settings.motion])
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
      for (const key of PALETTE_KEYS) {
        document.documentElement.style.setProperty(CSS_KEYS[key], result.palette[key])
        document.documentElement.style.setProperty(`--kb-${key.replace(/[A-Z]/gu, char => `-${char.toLowerCase()}`)}`, result.palette[key])
      }
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', result.palette.bg)
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
