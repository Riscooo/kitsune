import assert from 'node:assert/strict'
import test from 'node:test'
import { describe, pickArtwork } from '../install/native/kitsune-media.sys.mjs'

test('the artwork is the biggest https (or data:) image the site gives, never http or chrome', () => {
  assert.equal(pickArtwork([
    { src: 'https://cdn.example/96.jpg', sizes: '96x96' },
    { src: 'https://cdn.example/512.jpg', sizes: '256x256 512x512' },
    { src: 'http://cdn.example/1024.jpg', sizes: '1024x1024' },
    { src: 'chrome://browser/content/x.png', sizes: '2048x2048' },
  ]), 'https://cdn.example/512.jpg')
  assert.equal(pickArtwork([{ src: 'data:image/png;base64,AAAA' }]), 'data:image/png;base64,AAAA')
  assert.equal(pickArtwork([{ src: 'javascript:alert(1)' }, {}]), '')
  assert.equal(pickArtwork(), '')
})

test('the card shows the title and artist of the Media Session, or the tab and its site', () => {
  const song = describe({ metadata: { title: 'Kitsune no yomeiri', artist: 'Tinta' }, tabLabel: 'YouTube', host: 'www.youtube.com',
    playing: true, keys: ['play', 'pause', 'nexttrack'] })
  assert.deepEqual(song, { title: 'Kitsune no yomeiri', subtitle: 'Tinta', playing: true, prev: false, next: true, muted: false })
  const bare = describe({ metadata: { title: '', artist: '' }, tabLabel: 'Radio', host: 'radio.example', keys: ['previoustrack'], muted: true })
  assert.deepEqual(bare, { title: 'Radio', subtitle: 'radio.example', playing: false, prev: true, next: false, muted: true })
  // Si el artista repite el título, abajo va la web.
  assert.equal(describe({ metadata: { title: 'Directo', artist: 'Directo' }, host: 'twitch.tv' }).subtitle, 'twitch.tv')
  assert.equal(describe({ metadata: { title: 'x'.repeat(500) } }).title.length, 200)
})
