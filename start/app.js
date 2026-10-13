// Primero el puente: en el inicio integrado responde a /api/ antes de que nadie pregunte.
import { integrated } from './bridge.mjs'
import { resolveNavigation } from './navigation.mjs'
import { initializeProfiles } from './profiles.mjs'
import { initializeSwitcher } from './switcher.mjs'
import { createSettingsStore } from './settings-store.mjs'
import { createAppearance } from './appearance.mjs'
import { initializeShortcuts } from './shortcuts.mjs'
import { $, initializeDialogs } from './dialogs.mjs'
import { initializeNativeActions } from './native-actions.mjs'
import { initializePresets } from './presets.mjs'
import { initializePrivacyLine } from './privacy-line.mjs'

let toastTimer
let mode = 'all'
let shortcuts
let appearance
let presets
const announce = message => {
  clearTimeout(toastTimer)
  $('#status').textContent = message; $('#status').hidden = !message
  toastTimer = setTimeout(() => { $('#status').hidden = true }, 4000)
}
const toggles = { 'motion-toggle': 'motion', 'newtab-toggle': 'newTab', 'brand-toggle': 'brand', 'minimize-toggle': 'minimize' }
const store = createSettingsStore({
  onChange(settings, state) {
    appearance?.applySettings(settings); shortcuts?.render(settings)
    for (const [id, key] of Object.entries(toggles)) { $(`#${id}`).checked = settings[key]; $(`#${id}`).disabled = !state.ready }
    for (const key of ['clock', 'shortcuts']) { $(`#module-${key}`).checked = settings.modules[key]; $(`#module-${key}`).disabled = !state.ready }
    for (const radio of document.querySelectorAll('input[name="theme"]')) { radio.checked = radio.value === settings.theme; radio.disabled = !state.ready }
    $('#background-file').disabled = !state.ready
    // «auto»: los de Apple en macOS y los de Kitsune en el resto. Con los del sistema, el lado y minimizar los decide él.
    const buttons = settings.windowButtons === 'auto' ? (navigator.userAgent.includes('Macintosh') ? 'sistema' : 'kitsune') : settings.windowButtons
    for (const button of document.querySelectorAll('[data-tabs]')) { button.setAttribute('aria-pressed', String(button.dataset.tabs === settings.tabs)); button.disabled = !state.ready }
    for (const button of document.querySelectorAll('[data-window-buttons]')) { button.setAttribute('aria-pressed', String(button.dataset.windowButtons === buttons)); button.disabled = !state.ready }
    for (const button of document.querySelectorAll('[data-window-controls]')) { button.setAttribute('aria-pressed', String(button.dataset.windowControls === settings.windowControls)); button.disabled = !state.ready || buttons === 'sistema' }
    $('#minimize-toggle').disabled = !state.ready || buttons === 'sistema'
    for (const button of document.querySelectorAll('[data-performance]')) { button.setAttribute('aria-pressed', String(button.dataset.performance === settings.performance)); button.disabled = !state.ready }
    for (const button of document.querySelectorAll('[data-ram-limit]')) { button.setAttribute('aria-pressed', String(Number(button.dataset.ramLimit) === settings.ramLimit)); button.disabled = !state.ready }
    $('#ram-row').hidden = settings.performance !== 'ahorro'
    $('#background-remove').hidden = !settings.background; $('#background-remove').disabled = !state.ready
    presets?.sync(settings, state.ready)
    $('#focus-toggle').setAttribute('aria-pressed', String(settings.focus)); $('#focus-toggle').disabled = !state.ready
    $('#focus-toggle').textContent = settings.focus ? 'Salir de enfoque' : 'Enfoque'
    $('#save-state').textContent = state.pending ? 'Guardando…' : state.ready ? 'Guardado en este perfil' : 'Sin conexión'
    document.documentElement.dataset.storageReady = String(state.ready)
  },
  onStatus(message, retry) {
    $('#settings-notice').hidden = !message; $('#settings-message').textContent = message
    $('#settings-retry').hidden = !retry
    if (message) announce(message)
  },
})
// Botones de los ajustes: se registran una sola vez (no en cada cambio de ajustes).
for (const button of document.querySelectorAll('[data-window-controls]')) button.addEventListener('click', () => void save({ windowControls: button.dataset.windowControls }))
for (const button of document.querySelectorAll('[data-tabs]')) button.addEventListener('click', () => void save({ tabs: button.dataset.tabs }))
for (const button of document.querySelectorAll('[data-window-buttons]')) button.addEventListener('click', () => void save({ windowButtons: button.dataset.windowButtons }))
for (const button of document.querySelectorAll('[data-performance]')) button.addEventListener('click', () => void save({ performance: button.dataset.performance }))
for (const button of document.querySelectorAll('[data-ram-limit]')) button.addEventListener('click', () => void save({ ramLimit: Number(button.dataset.ramLimit) }))
// Cuánta memoria usa ahora Kitsune en este perfil (mientras el panel está abierto).
async function updateMemory() {
  if (!$('#settings-dialog').open || location.protocol === 'file:') return
  try {
    const response = await fetch('/api/rendimiento', { credentials: 'omit', cache: 'no-store' })
    const value = await response.json()
    $('#memory-status').textContent = Number.isFinite(value?.memoryMB)
      ? `Ahora Kitsune usa ${value.memoryMB >= 1024 ? `${(value.memoryMB / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1 })} GB` : `${value.memoryMB} MB`} de RAM en este perfil (${value.processes} procesos).`
      : ''
  } catch { $('#memory-status').textContent = '' }
}
setInterval(() => void updateMemory(), 5000)
$('#settings-open').addEventListener('click', () => setTimeout(() => void updateMemory(), 50))
appearance = createAppearance({ getSettings: () => store.data, refreshSettings: () => store.refresh({ quiet: true }), onStatus: message => { $('#theme-status').textContent = message } })
shortcuts = initializeShortcuts({ store, announce })
initializeDialogs(); initializeNativeActions({ announce })
void initializePrivacyLine($)
presets = initializePresets({
  async choose(preset) {
    const result = preset ? await store.setBackground({ preset }) : { ok: await store.save({ background: null }) }
    $('#background-status').textContent = result.ok ? BACKGROUND_HINT : result.error ?? 'No se ha podido cambiar el fondo.'
    if (result.ok) { announce(preset ? 'Fondo puesto.' : 'Fondo original.'); await appearance.refresh() }
  },
})

async function save(patch) { if (await store.save(patch)) await appearance.refresh() }
for (const [id, key] of Object.entries(toggles)) $(`#${id}`).addEventListener('change', event => void save({ [key]: event.target.checked }))
for (const key of ['clock', 'shortcuts']) $(`#module-${key}`).addEventListener('change', event => void save({ modules: { [key]: event.target.checked } }))
$('#focus-toggle').addEventListener('click', () => void save({ focus: !store.data.focus }))
// La veta de tinta, como en Hakufu: 1,2 s, la misma curva y en espejo al volver a Claro.
const INK_MS = 1200
const INK_EASING = 'cubic-bezier(.65, 0, .35, 1)'
function playInk(theme, apply) {
  const still = document.body.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches
  if (still || typeof document.startViewTransition !== 'function' || document.documentElement.dataset.theme === theme) { apply(); return }
  const dir = theme === 'oscuro' ? 'ltr' : 'rtl'
  const vein = document.createElement('div')
  vein.className = 'ink-vein'; vein.dataset.dir = dir
  document.documentElement.dataset.inkDir = dir
  const transition = document.startViewTransition(() => { apply(); document.body.append(vein) })
  transition.ready.then(() => vein.animate(
    { backgroundPosition: dir === 'ltr' ? ['100% 0', '0% 0'] : ['0% 0', '100% 0'] },
    { duration: INK_MS, easing: INK_EASING, fill: 'both' })).catch(() => {})
  transition.finished.finally(() => { vein.remove(); delete document.documentElement.dataset.inkDir })
}
for (const radio of document.querySelectorAll('input[name="theme"]')) radio.addEventListener('change', event => {
  if (!event.target.checked) return
  const theme = event.target.value
  playInk(theme, () => { document.documentElement.dataset.theme = theme })
  void save({ theme })
})
const BACKGROUND_HINT = 'PNG, JPG o WebP · hasta 12 MB. Se ve en el inicio y en las pestañas nuevas.'
const readImage = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.addEventListener('load', () => resolve(reader.result))
  reader.addEventListener('error', () => reject(reader.error))
  reader.readAsDataURL(file)
})
$('#background-file').addEventListener('change', async event => {
  const input = event.target
  const [file] = input.files
  input.value = ''
  if (!file) return
  const status = $('#background-status')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { status.textContent = 'Elige una imagen PNG, JPEG o WebP.'; return }
  if (file.size > 12 * 1024 * 1024) { status.textContent = 'La imagen es demasiado grande. Elige una de hasta 12 MB.'; return }
  status.textContent = 'Preparando el fondo…'
  try {
    const result = await store.setBackground({ imageData: await readImage(file) })
    status.textContent = result.ok ? BACKGROUND_HINT : result.error ?? BACKGROUND_HINT
    if (result.ok) { announce('Fondo puesto.'); await appearance.refresh() }
  } catch { status.textContent = 'No se ha podido leer la imagen.' }
})
$('#background-remove').addEventListener('click', async () => {
  if (await store.save({ background: null })) { $('#background-status').textContent = BACKGROUND_HINT; announce('Fondo quitado.'); await appearance.refresh() }
})
$('#settings-retry').addEventListener('click', async () => {
  $('#settings-retry').disabled = true
  try { if (await store.refresh()) { await appearance.refresh(); announce('Conectado. Puedes volver a guardar.') } }
  finally { $('#settings-retry').disabled = false }
})
$('#search-form').addEventListener('submit', event => {
  event.preventDefault()
  try {
    const result = resolveNavigation($('#query').value, mode)
    if (!result) { $('#query').focus(); return }
    $('#search-error').hidden = true; window.location.assign(result.url)
  } catch (error) { $('#search-error').textContent = error.message; $('#search-error').hidden = false }
})
$('#query').addEventListener('input', () => { $('#search-error').hidden = true })
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode
  document.querySelectorAll('[data-mode]').forEach(other => other.setAttribute('aria-pressed', String(other === button)))
  $('#query').focus()
}))
function updateClock() {
  const now = new Date()
  $('#clock-time').dateTime = now.toISOString(); $('#clock-time').textContent = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(now)
  $('#date').dateTime = now.toISOString(); $('#date').textContent = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)
}
updateClock()
const clockTimer = setInterval(() => { if (!document.hidden) updateClock() }, 1000)
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateClock() })
appearance.applySettings(); shortcuts.render()
if (location.protocol === 'file:') {
  $('#offline-home').hidden = false
  document.querySelectorAll('[data-native-action]').forEach(button => { button.disabled = true })
  document.documentElement.dataset.ready = 'true'
} else {
  void store.refresh().finally(() => { document.documentElement.dataset.ready = 'true'; appearance.start(); void presets.load().then(() => presets.sync(store.data, store.ready)) })
}
// Usuarios: la tarjeta del avatar cambia esta pestaña de usuario; «Gestionar» abre la ventana grande.
let profiles = null
const switcher = initializeSwitcher({ integrated, onManage: () => profiles?.show(), onAdd: () => profiles?.show({ create: true }) })
void initializeProfiles({ announce, onSnapshot: snapshot => switcher.render(snapshot), switchTo: id => switcher.switchTo(id) })
  .then(controller => { profiles = controller ?? null })
window.addEventListener('pagehide', () => { clearInterval(clockTimer); clearTimeout(toastTimer); appearance.destroy(); store.destroy() }, { once: true })
// A restored bfcache document must not retain a disposed store or old tokens.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload() })
