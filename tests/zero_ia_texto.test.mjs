import assert from 'node:assert/strict';
import test from 'node:test';
import { parse, inline, safeHref, plain } from '../zero/modules/zero-ia-texto.mjs';

// El texto del asistente de Zero: markdown → nodos sencillos, sin HTML y sin enlaces peligrosos.

test('inline marks: code, links, bold, italics and strike', () => {
  assert.deepEqual(inline('hola **mundo** y `x = 1`'), ['hola ', { tag: 'b', children: ['mundo'] }, ' y ', { tag: 'code', text: 'x = 1' }]);
  assert.deepEqual(inline('[Kitsune](https://kitsune.example/a)'), [{ tag: 'a', href: 'https://kitsune.example/a', children: ['Kitsune'] }]);
  assert.deepEqual(inline('*suave* y ~~no~~'), [{ tag: 'i', children: ['suave'] }, ' y ', { tag: 's', children: ['no'] }]);
  // Dentro del código no hay marcas.
  assert.deepEqual(inline('`**no**`'), [{ tag: 'code', text: '**no**' }]);
});

test('only http(s) links become links: javascript:, data: and chrome: stay as plain text', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,hola', 'chrome://browser/content/browser.xhtml', 'file:///etc/passwd', 'nada']) {
    assert.equal(safeHref(bad), null, bad);
    assert.deepEqual(inline(`[pulsa](${bad})`), ['pulsa'], bad);
  }
  assert.equal(safeHref('http://ejemplo.org'), 'http://ejemplo.org/');
});

test('blocks: paragraphs, headings, lists, quotes and code fences (also unfinished, while it streams)', () => {
  const doc = parse('# Título\n\nUna línea\notra línea\n\n- uno\n- **dos**\n\n1. primero\n2. segundo\n\n> cita\n\n```js\nlet a = 1;\n```');
  assert.deepEqual(doc.map(b => b.tag), ['h', 'p', 'ul', 'ol', 'quote', 'pre']);
  assert.equal(doc[0].level, 1);
  assert.deepEqual(doc[1].children, ['Una línea', '\n', 'otra línea']);
  assert.equal(doc[2].children.length, 2);
  assert.deepEqual(doc[2].children[1].children, [{ tag: 'b', children: ['dos'] }]);
  assert.equal(doc[5].lang, 'js');
  assert.equal(doc[5].text, 'let a = 1;');
  const streaming = parse('Mira:\n```\nsin cerrar');
  assert.deepEqual(streaming.map(b => b.tag), ['p', 'pre']);
  assert.equal(streaming[1].text, 'sin cerrar');
});

test('HTML in the text stays text (the panel never uses innerHTML)', () => {
  const doc = parse('<img src=x onerror=alert(1)> <script>alert(1)</script>');
  assert.equal(doc.length, 1);
  assert.equal(plain(doc), '<img src=x onerror=alert(1)> <script>alert(1)</script>');
});

test('huge input is cut, never hangs', () => {
  const start = Date.now();
  const doc = parse('**'.repeat(150_000) + '\n' + '- x\n'.repeat(20_000));
  assert.ok(Date.now() - start < 2000);
  assert.ok(Array.isArray(doc));
});
