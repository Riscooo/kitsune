// Privacidad que se ve: lo que Kitsune ha bloqueado esta semana, debajo del buscador.
// El resumen lo escribe el módulo nativo y llega por /api/privacidad (servidor o inicio integrado).
export function privacyText(value) {
  if (!value?.available || !value.week?.total) return ''
  const total = value.week.total.toLocaleString('es-ES')
  const today = value.today?.total ? ` (${value.today.total.toLocaleString('es-ES')} hoy)` : ''
  return `Esta semana Kitsune ha bloqueado ${total} ${value.week.total === 1 ? 'rastreador' : 'rastreadores'}${today}`
}

export async function initializePrivacyLine($) {
  if (location.protocol === 'file:') return
  try {
    const response = await fetch('/api/privacidad', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000) })
    const text = privacyText(response.ok ? await response.json() : null)
    $('#privacy-count').textContent = text
    $('#privacy-line').hidden = !text
  } catch { $('#privacy-line').hidden = true }
}
