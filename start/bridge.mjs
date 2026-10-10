// Inicio integrado (Windows y macOS): no hay servidor local, así que las
// peticiones de la página a /api/… van a la API «kitsuneHome» de la extensión
// inicio@kitsune, dentro del motor. En Linux (servidor local) no hace nada.
const api = globalThis.browser?.kitsuneHome
export const integrated = Boolean(api)
const images = new Map()

if (api) {
  const networkFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href)
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return networkFetch(input, init)
    if (init.signal?.aborted) throw new DOMException('La petición se ha cancelado.', 'AbortError')
    const reply = await api.request(String(init.method ?? 'GET'), url.pathname, typeof init.body === 'string' ? init.body : undefined)
    return new Response(reply.bytes ?? reply.body ?? '', {
      status: reply.status, headers: { 'Content-Type': reply.contentType ?? 'application/json; charset=utf-8' },
    })
  }
}

/** Dirección para <img> o url() de una imagen de /api/: en el integrado, un blob local. */
export async function imageUrl(path) {
  if (!api || !path.startsWith('/api/')) return path
  if (images.has(path)) return images.get(path)
  const reply = await api.request('GET', path)
  if (reply.status !== 200 || !reply.bytes) throw new Error('La imagen no está disponible.')
  const url = URL.createObjectURL(new Blob([reply.bytes], { type: reply.contentType }))
  images.set(path, url)
  return url
}
