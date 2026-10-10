// Lo que decide los botones de descarga, sin DOM (lo prueba tests/web.test.mjs).
export const PLATFORMS = {
  windows: { name: 'Windows' },
  macos: { name: 'macOS' },
  linux: { name: 'Linux' },
}

/** El sistema de quien visita, para el botón grande. */
export function detectPlatform(agent = navigator.userAgent, platform = navigator.userAgentData?.platform ?? navigator.platform ?? '') {
  const text = `${platform} ${agent}`
  if (/android|iphone|ipad|ipod/i.test(text)) return null
  if (/win/i.test(text)) return 'windows'
  if (/mac/i.test(text)) return 'macos'
  if (/linux|x11/i.test(text)) return 'linux'
  return null
}

/** downloads.json: solo enlaces del propio sitio o https de GitHub, con versión y tamaño opcionales. */
export function parseDownloads(value, origin) {
  const result = { version: typeof value?.version === 'string' ? value.version.slice(0, 20) : null, files: {} }
  for (const key of Object.keys(PLATFORMS)) {
    const entry = value?.[key]
    if (!entry || typeof entry.url !== 'string') continue
    let url
    try { url = new URL(entry.url, origin) } catch { continue }
    const allowed = url.origin === origin || (url.protocol === 'https:' && url.hostname === 'github.com')
    if (!allowed) continue
    result.files[key] = { url: url.href, size: typeof entry.size === 'string' ? entry.size.slice(0, 20) : '' }
  }
  return result
}
