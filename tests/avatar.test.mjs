import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PHOTO_BYTES, inspectRaster, prepareAvatar, safeAvatarURL, validPhotoSize } from '../start/avatar.mjs'

const pngHeader = (width, height) => {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  bytes.set([73, 72, 68, 82], 12)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

test('avatars only load canonical local raster routes belonging to that profile', () => {
  const id = 'p-0123456789abcdef', hash = 'f'.repeat(64)
  assert.equal(safeAvatarURL(`/api/profile-avatars/${id}/${hash}.png`, id), `/api/profile-avatars/${id}/${hash}.png`)
  assert.equal(safeAvatarURL(`/api/profile-avatars/default/${hash}.png`, 'default'), `/api/profile-avatars/default/${hash}.png`)
  for (const path of [`https://example.com/${hash}.png`, `//example.com/${hash}.png`, `/api/profile-avatars/default/${hash}.svg`, `/api/profile-avatars/default/${hash}.png?x=1`, `/api/profile-avatars/${id}/${hash}.png/../x`, 'data:image/png;base64,eA==', null]) assert.equal(safeAvatarURL(path, 'default'), null)
  assert.equal(safeAvatarURL(`/api/profile-avatars/${id}/${hash}.png`, 'default'), null)
})

test('raster dimensions are bounded before invoking a decoder', () => {
  assert.deepEqual(inspectRaster(pngHeader(120, 180)), { type: 'image/png', width: 120, height: 180 })
  for (const size of [[0, 100], [8193, 10], [4001, 4000]]) assert.throws(() => inspectRaster(pngHeader(...size)))
  assert(validPhotoSize(4000, 4000))
  assert(!validPhotoSize(Infinity, 1))
  assert(!validPhotoSize(1.5, 3))
  assert.throws(() => inspectRaster(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')))
  assert.throws(() => inspectRaster(new Uint8Array([137, 80, 78])))
})

test('JPEG and WebP signatures and dimensions are recognized without accepting arbitrary content', () => {
  const jpg = new Uint8Array([255, 216, 255, 192, 0, 11, 8, 0, 120, 0, 180, 1, 1, 17, 0])
  assert.deepEqual(inspectRaster(jpg), { type: 'image/jpeg', width: 180, height: 120 })
  const webp = new Uint8Array(30)
  webp.set(new TextEncoder().encode('RIFF'), 0)
  webp.set(new TextEncoder().encode('WEBPVP8X'), 8)
  new DataView(webp.buffer).setUint32(16, 10, true)
  webp[24] = 119; webp[27] = 179
  assert.deepEqual(inspectRaster(webp), { type: 'image/webp', width: 120, height: 180 })
})

test('oversize files and SVG MIME types are rejected before reading their bytes', async () => {
  let read = false
  const arrayBuffer = async () => { read = true; return new ArrayBuffer(0) }
  await assert.rejects(prepareAvatar({ size: MAX_PHOTO_BYTES + 1, type: 'image/png', arrayBuffer }))
  await assert.rejects(prepareAvatar({ size: 64, type: 'image/svg+xml', arrayBuffer }))
  assert.equal(read, false)
  await assert.rejects(prepareAvatar({ size: 24, type: 'image/jpeg', arrayBuffer: async () => pngHeader(100, 100).buffer }))
})
