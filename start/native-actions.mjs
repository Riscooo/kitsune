/** Opens native settings; success confirms dispatch, never an external login. */
export function initializeNativeActions({ announce }) {
  let busy = false
  const buttons = [...document.querySelectorAll('[data-native-action]')]
  for (const button of buttons) button.addEventListener('click', async () => {
    if (busy || location.protocol === 'file:') return
    busy = true; buttons.forEach(item => { item.disabled = true })
    try {
      const get = await fetch('/api/profiles', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000) })
      if (!get.ok) throw new Error('No se ha podido leer el perfil actual.')
      const profile = await get.json()
      if (typeof profile.currentId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/u.test(profile.currentId) || typeof profile.token !== 'string' || !Number.isSafeInteger(profile.revision)) throw new Error('Perfil no disponible.')
      const response = await fetch(`/api/profiles/${encodeURIComponent(profile.currentId)}/open`, {
        method: 'POST', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json', 'X-Kitsune-Token': profile.token },
        body: JSON.stringify({ action: button.dataset.nativeAction, revision: profile.revision }),
      })
      if (!response.ok) throw new Error(response.status === 409 ? 'El perfil cambió. Vuelve a pulsar para abrir el ajuste.' : 'No se ha podido confirmar la apertura. Puedes volver a intentarlo.')
      announce('Apertura solicitada en este perfil.')
    } catch (error) { announce(error.message || 'No se ha podido abrir el ajuste.') }
    finally { busy = false; buttons.forEach(item => { item.disabled = false }) }
  })
}
