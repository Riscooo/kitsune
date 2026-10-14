// Lo que decide los botones de descarga, sin DOM (lo prueba tests/web.test.mjs).
export const PLATFORMS = {
  windows: { name: 'Windows' },
  macos: { name: 'macOS' },
  linux: { name: 'Linux' },
}
// Descargas que no tienen tarjeta propia: van como enlace en la de su sistema. Desde la web no se
// sabe si un Mac es Intel o Apple Silicon (los dos dicen «Intel Mac» en su identificación).
export const EXTRAS = { 'macos-intel': { name: 'macOS (Intel)', card: 'macos' } }

/** El sistema de quien visita, para el botón grande. */
export function detectPlatform(agent = navigator.userAgent, platform = navigator.userAgentData?.platform ?? navigator.platform ?? '') {
  const text = `${platform} ${agent}`
  if (/android|iphone|ipad|ipod/i.test(text)) return null
  if (/win/i.test(text)) return 'windows'
  if (/mac/i.test(text)) return 'macos'
  if (/linux|x11/i.test(text)) return 'linux'
  return null
}

/** downloads.json: solo enlaces del propio sitio o https de GitHub, con versión, tamaño y nota opcionales. */
export function parseDownloads(value, origin) {
  const result = { version: typeof value?.version === 'string' ? value.version.slice(0, 20) : null, files: {} }
  for (const key of [...Object.keys(PLATFORMS), ...Object.keys(EXTRAS)]) {
    const entry = value?.[key]
    if (!entry || typeof entry.url !== 'string') continue
    let url
    try { url = new URL(entry.url, origin) } catch { continue }
    const allowed = url.origin === origin || (url.protocol === 'https:' && url.hostname === 'github.com')
    if (!allowed) continue
    result.files[key] = { url: url.href, size: typeof entry.size === 'string' ? entry.size.slice(0, 20) : '',
      note: typeof entry.note === 'string' ? entry.note.slice(0, 60) : '' }
  }
  return result
}
