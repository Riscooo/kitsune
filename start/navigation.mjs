export const MODES = new Set(['all', 'images', 'videos', 'maps'])

export function googleSearch(query, mode = 'all') {
  const url = new URL(mode === 'maps' ? 'https://www.google.com/maps/search/' : 'https://www.google.com/search')
  url.searchParams.set(mode === 'maps' ? 'query' : 'q', query)
  if (mode === 'maps') url.searchParams.set('api', '1')
  if (mode === 'images') url.searchParams.set('udm', '2')
  if (mode === 'videos') url.searchParams.set('tbm', 'vid')
  return url.href
}

export function safeLink(input) {
  const value = String(input || '').trim()
  if (!value || value.length > 4096) throw new Error('Escribe una dirección válida.')
  const withScheme = /^(https?):\/\//i.test(value) ? value : `https://${value}`
  let url
  try { url = new URL(withScheme) } catch { throw new Error('Revisa la dirección. Por ejemplo: https://example.com') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname || /\s/.test(value)) {
    throw new Error('Usa una dirección web http o https, sin contraseñas.')
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value) && !/^[^/:]+:\d+(?:\/|$)/.test(value)) {
    throw new Error('Solo se admiten direcciones web http o https.')
  }
  return url.href
}

export function resolveNavigation(input, mode = 'all') {
  const value = String(input || '').trim()
  if (!value) return null
  if (value.length > 4096) throw new Error('La búsqueda es demasiado larga.')
  if (/^(?:javascript|data|file|vbscript|about|chrome|resource|blob):/i.test(value)) {
    throw new Error('Escribe una dirección web o una búsqueda, no código ni rutas internas.')
  }
  if (/^https?:/i.test(value)) return { url: safeLink(value), kind: 'address' }
  const addressLike = !/\s/.test(value) && (
    /^(?:localhost|127\.\d+\.\d+\.\d+|\[[:a-f\d]+\])(?::\d+)?(?:[/?#]|$)/i.test(value) ||
    /^(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?::\d+)?(?:[/?#]|$)/u.test(value) ||
    /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#]|$)/.test(value)
  )
  if (addressLike) {
    const local = /^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::|\/|\?|#|$)/i.test(value)
    return { url: safeLink(`${local ? 'http' : 'https'}://${value}`), kind: 'address' }
  }
  return { url: googleSearch(value, MODES.has(mode) ? mode : 'all'), kind: 'search' }
}

export const DEFAULT_LINKS = [
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/', color: 'red', icon: 'play' },
  { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com/', color: 'blue', icon: 'mail' },
  { id: 'github', name: 'GitHub', url: 'https://github.com/', color: 'white', icon: 'code' },
  { id: 'anime', name: 'MyAnimeList', url: 'https://myanimelist.net/', color: 'violet', icon: 'sparkles' },
  { id: 'wiki', name: 'Wikipedia', url: 'https://es.wikipedia.org/', color: 'teal', icon: 'book' },
]

export function cleanLinks(value) {
  if (!Array.isArray(value)) return DEFAULT_LINKS.map((item) => ({ ...item }))
  const ids = new Set()
  return value.slice(0, 12).flatMap((item) => {
    try {
      if (!item || typeof item.name !== 'string' || !item.name.trim() || typeof item.id !== 'string' || ids.has(item.id)) return []
      ids.add(item.id)
      return [{ id: item.id.slice(0, 80), name: item.name.trim().slice(0, 36), url: safeLink(item.url), color: ['red', 'blue', 'white', 'violet', 'teal'].includes(item.color) ? item.color : 'blue', icon: ['play', 'mail', 'code', 'sparkles', 'book'].includes(item.icon) ? item.icon : '' }]
    } catch { return [] }
  })
}
