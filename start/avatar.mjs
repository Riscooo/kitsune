import { imageUrl } from './bridge.mjs'
/** Local raster-only avatar preparation. No URLs, SVG, metadata or remote fetch. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024
export const MAX_AVATAR_DATA = 128 * 1024
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function safeAvatarURL(value, profileId) {
  if (typeof value !== 'string' || typeof profileId !== 'string') return null
  const match = /^\/api\/profile-avatars\/(default|p-[0-9a-f]{16})\/([0-9a-f]{64})\.png$/u.exec(value)
  return match && match[1] === profileId ? value : null
}

export function validPhotoSize(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16_000_000
}

export function inspectRaster(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const word = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  let type, width, height
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) && word(12) === 'IHDR') {
    type = 'image/png'; width = view.getUint32(16); height = view.getUint32(20)
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    type = 'image/jpeg'
    let offset = 2
    while (offset + 8 < bytes.length) {
      if (bytes[offset++] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break
      }
      offset += length
    }
  } else if (bytes.length >= 30 && word(0) === 'RIFF' && word(8) === 'WEBP') {
    type = 'image/webp'
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const chunk = word(offset), length = view.getUint32(offset + 4, true), payload = offset + 8
      if (payload + length > bytes.length) break
      if (chunk === 'VP8X' && length >= 10) {
        width = 1 + bytes[payload + 4] + (bytes[payload + 5] << 8) + (bytes[payload + 6] << 16)
        height = 1 + bytes[payload + 7] + (bytes[payload + 8] << 8) + (bytes[payload + 9] << 16)
        break
      }
      if (chunk === 'VP8 ' && length >= 10 && bytes[payload + 3] === 157 && bytes[payload + 4] === 1 && bytes[payload + 5] === 42) {
        width = view.getUint16(payload + 6, true) & 16383; height = view.getUint16(payload + 8, true) & 16383; break
      }
      if (chunk === 'VP8L' && length >= 5 && bytes[payload] === 47) {
        const bits = view.getUint32(payload + 1, true)
        width = 1 + (bits & 16383); height = 1 + ((bits >>> 14) & 16383); break
      }
      offset = payload + length + (length & 1)
    }
  }
  if (!type || !width || !height) throw new Error('No se puede leer la imagen. Elige un PNG, JPG o WebP válido.')
  if (!validPhotoSize(width, height)) throw new Error('La foto debe tener como máximo 16 megapíxeles y 8192 px por lado.')
  return { type, width, height }
}

export async function prepareAvatar(file) {
  if (!file || !Number.isFinite(file.size) || file.size < 1 || file.size > MAX_PHOTO_BYTES) throw new Error('Elige una foto de hasta 8 MB.')
  if (!TYPES.has(file.type)) throw new Error('Usa PNG, JPG o WebP. No se admiten SVG ni otros formatos.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const metadata = inspectRaster(bytes)
  if (metadata.type !== file.type) throw new Error('El formato de la foto no coincide con su contenido.')
  let bitmap
  try { bitmap = await createImageBitmap(new Blob([bytes], { type: metadata.type }), { imageOrientation: 'from-image' }) }
  catch { throw new Error('No se ha podido abrir esa foto. Prueba con otra imagen.') }
  try {
    if (!validPhotoSize(bitmap.width, bitmap.height)) throw new Error('La foto es demasiado grande para procesarla.')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!context) throw new Error('No se ha podido preparar la foto.')
    const side = Math.min(bitmap.width, bitmap.height)
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256)
    const pixels = context.getImageData(0, 0, 256, 256).data
    let transparent = false
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 255) { transparent = true; break }
    let data = canvas.toDataURL(transparent ? 'image/png' : 'image/jpeg', .88)
    if (!transparent) for (const quality of [.75, .6, .45, .3]) {
      if (data.length <= MAX_AVATAR_DATA) break
      data = canvas.toDataURL('image/jpeg', quality)
    }
    if (data.length > MAX_AVATAR_DATA) throw new Error('La foto tiene demasiado detalle. Prueba una imagen más sencilla o sin transparencia.')
    return data
  } finally { bitmap.close() }
}

export function paintAvatar(node, profile, initials, previewData) {
  node.dataset.profileColor = profile.color
  node.textContent = initials
  const source = previewData === undefined ? safeAvatarURL(profile.avatar, profile.id) : previewData
  if (!source) return
  if (previewData !== undefined && (typeof source !== 'string' || source.length > MAX_AVATAR_DATA || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/u.test(source))) return
  const image = document.createElement('img')
  image.alt = ''
  image.hidden = true
  image.decoding = 'async'
  image.referrerPolicy = 'no-referrer'
  image.addEventListener('load', () => { if (node.contains(image)) { image.hidden = false; node.replaceChildren(image) } }, { once: true })
  image.addEventListener('error', () => { if (node.contains(image)) node.textContent = initials }, { once: true })
  node.append(image)
  if (source.startsWith('/api/')) void imageUrl(source).then(url => { image.src = url }).catch(() => { if (node.contains(image)) node.textContent = initials })
  else image.src = source
}
