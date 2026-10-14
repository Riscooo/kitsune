// Privacidad que se ve: lo que Kitsune ha bloqueado esta semana, debajo del buscador.
// El resumen lo escribe el módulo nativo y llega por /api/privacidad (servidor o inicio integrado).
import { tr } from './idioma.mjs'
export function privacyText(value) {
  if (!value?.available || !value.week?.total) return ''
  const total = value.week.total.toLocaleString(tr('es-ES', 'en-US'))
  const today = value.today?.total ? tr(` (${value.today.total.toLocaleString('es-ES')} hoy)`, ` (${value.today.total.toLocaleString('en-US')} today)`) : ''
  return tr(`Esta semana Kitsune ha bloqueado ${total} ${value.week.total === 1 ? 'rastreador' : 'rastreadores'}${today}`, `This week Kitsune blocked ${total} ${value.week.total === 1 ? 'tracker' : 'trackers'}${today}`)
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
