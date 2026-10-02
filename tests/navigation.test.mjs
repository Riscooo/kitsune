import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanLinks, DEFAULT_LINKS, googleSearch, resolveNavigation, safeLink } from '../start/navigation.mjs'

test('Google receives one correctly encoded query including Unicode and ampersands', () => {
  const query = 'café & anime + montaña 日本'
  const result = resolveNavigation(query)
  const url = new URL(result.url)
  assert.equal(url.origin, 'https://www.google.com')
  assert.equal(url.pathname, '/search')
  assert.equal(url.searchParams.get('q'), query)
  assert.equal(result.kind, 'search')
})
test('empty input never navigates and natural language remains a query', () => {
  assert.equal(resolveNavigation('   '), null)
  assert.equal(resolveNavigation('receta: pasta fácil').kind, 'search')
  assert.equal(resolveNavigation('2.0 release notes').kind, 'search')
})
test('typed domains, paths, query strings and IDNs become real URLs', () => {
  for (const input of ['example.com', 'example.com/path?q=1#x', 'https://example.com/path', 'música.es']) {
    const result = resolveNavigation(input)
    assert.equal(result.kind, 'address')
    assert.equal(new URL(result.url).protocol, 'https:')
  }
})
test('loopback developer addresses use HTTP without affecting remote hosts', () => {
  for (const input of ['localhost:5173', '127.0.0.1:8000/test', '[::1]:3000', 'localhost/path']) {
    assert.equal(new URL(resolveNavigation(input).url).protocol, 'http:', input)
  }
  assert.equal(new URL(resolveNavigation('192.168.1.2').url).protocol, 'https:')
  assert.equal(new URL(resolveNavigation('https://localhost:5173').url).protocol, 'https:')
})
test('images, videos and Maps use their own Google query mode', () => {
  assert.equal(new URL(googleSearch('luna', 'images')).searchParams.get('udm'), '2')
  assert.equal(new URL(googleSearch('luna', 'videos')).searchParams.get('tbm'), 'vid')
  const maps = new URL(googleSearch('Madrid', 'maps'))
  assert.equal(maps.pathname, '/maps/search/')
  assert.equal(maps.searchParams.get('query'), 'Madrid')
  assert.equal(maps.searchParams.get('api'), '1')
})
test('search and shortcuts reject script, local file and privileged schemes', () => {
  for (const value of ['javascript:void(0)', 'data:text/plain,hello', 'file:///tmp/test', 'about:config', 'chrome://browser']) {
    assert.throws(() => resolveNavigation(value), /código|internas/)
    assert.throws(() => safeLink(value))
  }
})
test('saved links reject credentials and malformed inputs', () => {
  for (const value of ['', 'https://', 'https://user:password@example.com', 'https://has spaces.example']) assert.throws(() => safeLink(value))
  assert.equal(safeLink('example.com/hello'), 'https://example.com/hello')
})
test('saved shortcuts are bounded, sanitized and never injected as markup', () => {
  const items = cleanLinks([{ id: 'one', name: 'Demo <test>', url: 'https://example.com', color: 'unknown', icon: 'unknown' }, { id: 'bad', name: 'Broken', url: 'data:text/plain,no' }, { id: 'one', name: 'Duplicate', url: 'https://example.com' }])
  assert.equal(items.length, 1)
  assert.equal(items[0].name, 'Demo <test>')
  assert.equal(items[0].icon, '')
  assert.equal(items[0].color, 'blue')
  assert.equal(cleanLinks(Array.from({ length: 25 }, (_, i) => ({ id: String(i), name: 'Demo', url: 'https://example.com' }))).length, 12)
})
test('no saved shortcuts gives independent defaults; deliberately empty list stays empty', () => {
  assert.deepEqual(cleanLinks(undefined), DEFAULT_LINKS)
  assert.notEqual(cleanLinks(undefined)[0], DEFAULT_LINKS[0])
  assert.deepEqual(cleanLinks([]), [])
})
