import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

// Oscurecer las webs claras (install/native/kitsune-oscurecer-child.sys.mjs) con un Gecko de mentira:
// solo se ejecuta este archivo local contra ajustes, ventanas y estilos falsos.
const source = await readFile(new URL('../install/native/kitsune-oscurecer-child.sys.mjs', import.meta.url), 'utf8');

function load(preferences = new Map()) {
  const observers = [];
  const context = vm.createContext({
    JSWindowActorChild: class {},
    Services: { prefs: {
      getBoolPref: (name, fallback) => preferences.has(name) ? preferences.get(name) : fallback,
      getStringPref: (name, fallback) => preferences.has(name) ? preferences.get(name) : fallback,
      addObserver: (name, observer) => observers.push([name, observer]),
      removeObserver: (name, observer) => observers.splice(observers.findIndex(item => item[0] === name && item[1] === observer), 1),
    } },
  });
  vm.runInContext(source.replaceAll('export function', 'function').replace('export class', 'class') +
    '\nglobalThis.api = { parseColor, isLightPage, KitsuneOscurecerChild, PAGE_SHEET, PDF_SHEET };', context);
  return { api: context.api, observers, preferences };
}

// Una ventana de 1000×800: cada punto da el elemento que se pinte ahí (o el <body>).
function page({ background = 'rgb(255, 255, 255)', html = 'rgba(0, 0, 0, 0)', body = background, colorScheme = 'normal', dark = true,
                at = () => null, contentType = 'text/html', host = 'example.com', synthetic = false } = {}) {
  const sheets = [];
  const element = (localName, color, parentElement = null) => ({ localName, color, parentElement });
  const root = element('html', html);
  const bodyElement = element('body', body, root);
  const document = {
    documentElement: root, contentType, mozSyntheticDocument: synthetic,
    documentURIObject: { get host() { if (!host) throw Error('sin nombre'); return host; } },
    elementFromPoint: (x, y) => at(x, y, { element, body: bodyElement }) ?? bodyElement,
  };
  const media = { matches: dark, addEventListener() {}, removeEventListener() {} };
  const window = {
    document, innerWidth: 1000, innerHeight: 800,
    matchMedia: () => media,
    getComputedStyle: node => ({ backgroundColor: node.color, colorScheme: node === root ? colorScheme : 'normal' }),
    setTimeout() {},
    windowUtils: { USER_SHEET: 1,
      loadSheetUsingURIString: (uri, kind) => { assert.equal(kind, 1); sheets.push(uri); },
      removeSheetUsingURIString: (uri, kind) => { assert.equal(kind, 1); sheets.splice(sheets.indexOf(uri), 1); } },
  };
  return { window, document, sheets };
}

function child(api, fixture) {
  const actor = new api.KitsuneOscurecerChild();
  Object.defineProperties(actor, { contentWindow: { value: fixture.window }, document: { value: fixture.document } });
  actor.actorCreated();
  return actor;
}

test('the colours Gecko computes are read in any notation: rgb, color(), oklab/oklch and lab', () => {
  const { api } = load();
  // Los objetos vienen de otro contexto de vm: se comparan por su JSON.
  const read = css => JSON.parse(JSON.stringify(api.parseColor(css)));
  assert.deepEqual(read('rgb(255, 255, 255)'), { l: 1, a: 1 });
  assert.deepEqual(read('rgba(0, 0, 0, 0)'), { l: 0, a: 0 });
  assert.ok(api.parseColor('rgb(22, 26, 25)').l < 0.02);
  assert.ok(api.parseColor('color(srgb 0.96 0.96 0.95)').l > 0.85);
  assert.ok(api.parseColor('oklch(0.97 0.01 90)').l > 0.85);
  assert.ok(api.parseColor('oklab(0.2 0.01 0.01 / 0.8)').l < 0.02);
  assert.equal(api.parseColor('oklab(0.2 0.01 0.01 / 0.8)').a, 0.8);
  assert.ok(api.parseColor('lab(95 0 0)').l > 0.85);
  assert.equal(api.parseColor('transparent-ish'), null);
});

test('a page is light when most of what you see is light, and its canvas counts when nothing is painted', () => {
  const { api } = load();
  assert.equal(api.isLightPage(page().window), true);
  assert.equal(api.isLightPage(page({ background: 'rgb(13, 17, 23)' }).window), false);
  // Sin fondo en html ni body: el lienzo blanco… salvo que la web pida el esquema oscuro.
  const transparent = { background: 'rgba(0, 0, 0, 0)' };
  assert.equal(api.isLightPage(page(transparent).window), true);
  assert.equal(api.isLightPage(page({ ...transparent, colorScheme: 'light dark' }).window), false);
  assert.equal(api.isLightPage(page({ ...transparent, colorScheme: 'light dark', dark: false }).window), true);
  // Un envoltorio oscuro encima del body blanco manda (como en muchas webs con modo oscuro hecho a mano).
  const wrapped = page({ at: (x, y, { element, body }) => element('div', 'rgb(18, 18, 18)', body) });
  assert.equal(api.isLightPage(wrapped.window), false);
  // Las fotos no cuentan: se mira lo que hay detrás.
  const photo = page({ at: (x, y, { element, body }) => element('img', 'rgb(0, 0, 0)', body) });
  assert.equal(api.isLightPage(photo.window), true);
  // Dos de cuatro puntos claros no bastan.
  const half = page({ at: (x, y, { element, body }) => element('div', x < 500 ? 'rgb(255, 255, 255)' : 'rgb(20, 20, 20)', body) });
  assert.equal(api.isLightPage(half.window), false);
});

test('the fixed sheet goes on a light page only with Oscuro and the option on, and comes off when either changes', () => {
  const { api, preferences, observers } = load(new Map([['kitsune.oscurecer.enabled', true]]));
  const light = page();
  const actor = child(api, light);
  assert.equal(observers.length, 2);
  actor.handleEvent({ type: 'DOMContentLoaded', target: light.document });
  assert.deepEqual(light.sheets, [api.PAGE_SHEET]);
  assert.match(decodeURIComponent(api.PAGE_SHEET), /:root\{filter:invert\(1\) hue-rotate\(180deg\) contrast\(\.86\)!important\}/);
  assert.match(decodeURIComponent(api.PAGE_SHEET), /:root :is\(img,picture,video,canvas,iframe,embed,object,svg image,\[style\*="url\("\]\)\{filter:hue-rotate\(180deg\) invert\(1\)!important\}/);
  // Otra vuelta no la pone dos veces.
  actor.check();
  assert.equal(light.sheets.length, 1);
  preferences.set('kitsune.oscurecer.enabled', false);
  actor.observe();
  assert.deepEqual(light.sheets, []);
  preferences.set('kitsune.oscurecer.enabled', true);
  actor.observe();
  assert.equal(light.sheets.length, 1);
  // Esta web, en la lista de «No oscurecer esta web».
  preferences.set('kitsune.oscurecer.excepciones', 'otra.org, EXAMPLE.com');
  actor.observe();
  assert.deepEqual(light.sheets, []);
  actor.didDestroy();
  assert.equal(observers.length, 0);
});

test('dark pages, dark-scheme browsing off, images and other documents are left alone; PDFs only get their pages darkened', () => {
  const { api } = load(new Map([['kitsune.oscurecer.enabled', true]]));
  for (const options of [{ background: 'rgb(13, 17, 23)' }, { dark: false }, { synthetic: true }, { contentType: 'image/svg+xml' }]) {
    const fixture = page(options);
    child(api, fixture).handleEvent({ type: 'DOMContentLoaded', target: fixture.document });
    assert.deepEqual(fixture.sheets, [], JSON.stringify(options));
  }
  const pdf = page({ contentType: 'application/pdf', host: '' });
  child(api, pdf).handleEvent({ type: 'pageshow', target: pdf.document });
  assert.deepEqual(pdf.sheets, [api.PDF_SHEET]);
  assert.match(decodeURIComponent(api.PDF_SHEET), /^data:text\/css;charset=utf-8,\.pdfViewer \.page\{filter:invert\(1\)/);
  // Una web en texto plano también es papel blanco.
  const text = page({ contentType: 'text/plain' });
  child(api, text).handleEvent({ type: 'DOMContentLoaded', target: text.document });
  assert.deepEqual(text.sheets, [api.PAGE_SHEET]);
  // Lo que no es el documento (una imagen que termina de cargar) no hace nada.
  const other = page();
  child(api, other).handleEvent({ type: 'DOMContentLoaded', target: {} });
  assert.deepEqual(other.sheets, []);
});
