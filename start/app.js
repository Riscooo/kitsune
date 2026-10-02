import { resolveNavigation } from './navigation.mjs'
import { initializeProfiles } from './profiles.mjs'
import { createSettingsStore } from './settings-store.mjs'
import { createAppearance } from './appearance.mjs'
import { initializeShortcuts } from './shortcuts.mjs'
import { $, initializeDialogs } from './dialogs.mjs'
import { initializeNativeActions } from './native-actions.mjs'

let toastTimer
let mode = 'all'
let shortcuts
let appearance
const announce = message => {
  clearTimeout(toastTimer)
  $('#status').textContent = message; $('#status').hidden = !message
  toastTimer = setTimeout(() => { $('#status').hidden = true }, 4000)
}
const toggles = { 'art-toggle': 'art', 'motion-toggle': 'motion', 'newtab-toggle': 'newTab', 'theme-sync-toggle': 'themeSync' }
const store = createSettingsStore({
  onChange(settings, state) {
    appearance?.applySettings(settings); shortcuts?.render(settings)
    for (const [id, key] of Object.entries(toggles)) { $(`#${id}`).checked = settings[key]; $(`#${id}`).disabled = !state.ready }
    for (const key of ['clock', 'shortcuts']) { $(`#module-${key}`).checked = settings.modules[key]; $(`#module-${key}`).disabled = !state.ready }
    document.querySelectorAll('button[data-accent]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.accent === settings.accent)); button.disabled = !state.ready || settings.themeSync })
    document.querySelectorAll('button[data-wallpaper]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.wallpaper === settings.wallpaper)); button.disabled = !state.ready })
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
appearance = createAppearance({ getSettings: () => store.data, refreshSettings: () => store.refresh({ quiet: true }), onStatus: message => { $('#theme-status').textContent = message } })
shortcuts = initializeShortcuts({ store, announce })
initializeDialogs(); initializeNativeActions({ announce })

async function save(patch) { if (await store.save(patch)) await appearance.refresh() }
for (const [id, key] of Object.entries(toggles)) $(`#${id}`).addEventListener('change', event => void save({ [key]: event.target.checked }))
for (const key of ['clock', 'shortcuts']) $(`#module-${key}`).addEventListener('change', event => void save({ modules: { [key]: event.target.checked } }))
document.querySelectorAll('button[data-accent]').forEach(button => button.addEventListener('click', () => void save({ accent: button.dataset.accent })))
document.querySelectorAll('button[data-wallpaper]').forEach(button => button.addEventListener('click', () => void save({ wallpaper: button.dataset.wallpaper })))
$('#focus-toggle').addEventListener('click', () => void save({ focus: !store.data.focus }))
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
  void store.refresh().finally(() => { document.documentElement.dataset.ready = 'true'; appearance.start() })
}
void initializeProfiles({ announce })
window.addEventListener('pagehide', () => { clearInterval(clockTimer); clearTimeout(toastTimer); appearance.destroy(); store.destroy() }, { once: true })
// A restored bfcache document must not retain a disposed store or old tokens.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload() })
