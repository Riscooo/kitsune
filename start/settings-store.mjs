import { cleanLinks } from './navigation.mjs'

export const WALLPAPERS = Object.freeze(['night', 'veil', 'dusk', 'ember'])
export const ACCENTS = Object.freeze(['blue', 'pink', 'system'])
export const THEMES = Object.freeze(['claro', 'oscuro'])
// Pestañas arriba (como siempre), en una barra a un lado o a un lado solo con iconos.
export const TABS = Object.freeze(['arriba', 'lado', 'iconos'])
const copy = value => JSON.parse(JSON.stringify(value))

export function normalizeSettings(value = {}) {
  return {
    links: cleanLinks(value?.links), art: value?.art !== false, motion: value?.motion !== false,
    newTab: value?.newTab === true, accent: ACCENTS.includes(value?.accent) ? value.accent : 'blue',
    focus: value?.focus === true, wallpaper: WALLPAPERS.includes(value?.wallpaper) ? value.wallpaper : 'night',
    themeSync: value?.themeSync === true,
    modules: { clock: value?.modules?.clock !== false, shortcuts: value?.modules?.shortcuts !== false },
    theme: THEMES.includes(value?.theme) ? value.theme : 'claro',
    background: typeof value?.background === 'string' && /^[a-f\d]{64}$/u.test(value.background) ? value.background : null,
    windowControls: value?.windowControls === 'derecha' ? 'derecha' : 'izquierda',
    brand: value?.brand !== false,
    performance: value?.performance === 'ahorro' ? 'ahorro' : 'normal',
    ramLimit: [1024, 2048, 4096].includes(value?.ramLimit) ? value.ramLimit : 2048,
    minimize: value?.minimize !== false,
    windowButtons: ['kitsune', 'sistema'].includes(value?.windowButtons) ? value.windowButtons : 'auto',
    tabs: TABS.includes(value?.tabs) ? value.tabs : 'arriba',
    tinta: typeof value?.tinta === 'string' && /^[a-z][a-z0-9-]{1,23}$/u.test(value.tinta) ? value.tinta : 'papel',
    densidad: value?.densidad === 'compacta' ? 'compacta' : 'normal',
    negro: value?.negro === true,
    oscurecer: value?.oscurecer === true,
    bienvenida: value?.bienvenida !== false,
  }
}

export function mergeSettings(current, patch) {
  return normalizeSettings({ ...current, ...patch, modules: { ...current.modules, ...patch.modules } })
}

export function parseSettingsSnapshot(value) {
  if (!value || typeof value.token !== 'string' || !value.token || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw new Error('Respuesta de ajustes no válida.')
  return { data: normalizeSettings(value.data), revision: value.revision, token: value.token }
}

/** One serial mutation queue. Each intent is rebased on the latest confirmed
 * snapshot, so unrelated changes in another tab are retained. A failed/timeout
 * write is uncertain, never success: fetch authoritative state before retry. */
export function createSettingsStore({ fetcher = (...args) => globalThis.fetch(...args), onChange = () => {}, onStatus = () => {} } = {}) {
  let snapshot = { data: normalizeSettings(), revision: 0, token: '' }
  let ready = false
  let pending = 0
  let queue = Promise.resolve()
  let alive = true
  let generation = 0
  let loading = null
  const controllers = new Set()
  const notify = () => { if (alive) onChange(copy(snapshot.data), { ready, pending, revision: snapshot.revision }) }
  async function request(method = 'GET', payload) {
    const controller = new AbortController()
    controllers.add(controller)
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetcher('/api/settings', {
        method, credentials: 'omit', cache: 'no-store', signal: controller.signal,
        ...(payload ? { headers: { 'Content-Type': 'application/json', 'X-Kitsune-Token': snapshot.token }, body: JSON.stringify(payload) } : {}),
      })
      let body
      try { body = await response.json() } catch { throw new Error('No se ha podido leer el guardado.') }
      if (!response.ok && response.status !== 409) throw new Error('No se ha podido conectar con los ajustes.')
      return { conflict: response.status === 409, snapshot: parseSettingsSnapshot(body) }
    } finally { clearTimeout(timeout); controllers.delete(controller) }
  }
  function accept(next) { snapshot = next; ready = true; generation++; notify() }
  async function refresh({ quiet = false } = {}) {
    if (!alive || pending) return false
    if (loading) return loading
    const started = generation
    loading = (async () => {
      try {
        const result = await request()
        if (!alive || started !== generation || pending) return false
        const changed = result.snapshot.revision !== snapshot.revision || !ready || JSON.stringify(result.snapshot.data) !== JSON.stringify(snapshot.data)
        if (changed) accept(result.snapshot)
        else snapshot = result.snapshot
        if (changed || !quiet) onStatus('', false)
        return true
      } catch {
        if (alive && started === generation && !pending) {
          ready = false; notify()
          if (!quiet) onStatus('Sin conexión con los ajustes. Puedes seguir navegando.', true)
        }
        return false
      } finally { loading = null }
    })()
    return loading
  }
  function save(intent) {
    if (!alive) return Promise.resolve(false)
    pending++; generation++
    const operation = queue.then(async () => {
      if (!alive) return false
      try {
        if (!ready) accept((await request()).snapshot)
        for (let attempt = 0; attempt < 3; attempt++) {
          const data = typeof intent === 'function' ? normalizeSettings(intent(copy(snapshot.data))) : mergeSettings(snapshot.data, intent)
          if (JSON.stringify(data) === JSON.stringify(snapshot.data)) return true
          const result = await request('PUT', { data, revision: snapshot.revision })
          if (!alive) return false
          accept(result.snapshot)
          if (!result.conflict) { onStatus('', false); return true }
        }
        onStatus('Otra ventana sigue cambiando estos ajustes. Revisa el estado y vuelve a guardar.', false)
        return false
      } catch (error) {
        if (alive) {
          ready = false; notify()
          onStatus(error?.name === 'SettingsConflict' ? error.message : 'No se ha confirmado el guardado. Tus últimos ajustes confirmados siguen aquí.', true)
        }
        return false
      }
    }).finally(() => { pending--; notify() })
    queue = operation.catch(() => false)
    return operation
  }
  /** Sets the home background: { imageData } uploads an image, { preset } picks
   * one of the preset backgrounds. The server normalizes or re-checks the image
   * and answers with the new settings snapshot; its error text is shown as is. */
  function setBackground(choice) {
    if (!alive) return Promise.resolve({ ok: false })
    pending++; generation++
    const operation = queue.then(async () => {
      if (!alive) return { ok: false }
      const controller = new AbortController()
      controllers.add(controller)
      const timeout = setTimeout(() => controller.abort(), 30000)
      try {
        if (!ready) accept((await request()).snapshot)
        const response = await fetcher('/api/background', {
          method: 'POST', credentials: 'omit', cache: 'no-store', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'X-Kitsune-Token': snapshot.token }, body: JSON.stringify(choice),
        })
        let body
        try { body = await response.json() } catch { body = null }
        if (!response.ok) return { ok: false, error: typeof body?.error === 'string' ? body.error : 'No se ha podido guardar el fondo.' }
        if (!alive) return { ok: false }
        accept(parseSettingsSnapshot(body))
        return { ok: true }
      } catch {
        return { ok: false, error: 'No se ha confirmado el fondo. Vuelve a intentarlo.' }
      } finally { clearTimeout(timeout); controllers.delete(controller) }
    }).finally(() => { pending--; notify() })
    queue = operation.catch(() => ({ ok: false }))
    return operation
  }
  return {
    refresh, save, setBackground, get data() { return copy(snapshot.data) }, get ready() { return ready },
    destroy() { alive = false; generation++; for (const controller of controllers) controller.abort() },
  }
}
