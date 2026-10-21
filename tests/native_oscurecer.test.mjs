import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

// Oscurecer las webs claras (install/native/kitsune-oscurecer-child.sys.mjs) con un Gecko de mentira:
// solo se ejecuta este archivo local contra ajustes, ventanas y estilos falsos.
const source = await readFile(new URL('../install/native/kitsune-oscurecer-child.sys.mjs', import.meta.url), 'utf8');

function load(preferences = new Map()) {
  const observers = [];
  // Lo que comparte el proceso principal con los de las webs (Services.cpmm.sharedData).
  const shared = { data: new Map(), listeners: [], get(key) { return this.data.get(key); },
    addEventListener(type, listener) { assert.equal(type, 'change'); this.listeners.push(listener); },
    removeEventListener(type, listener) { this.listeners.splice(this.listeners.indexOf(listener), 1); } };
  const context = vm.createContext({
    JSWindowActorChild: class {},
    Services: { cpmm: { sharedData: shared }, prefs: {
      getBoolPref: (name, fallback) => preferences.has(name) ? preferences.get(name) : fallback,
      getStringPref: (name, fallback) => preferences.has(name) ? preferences.get(name) : fallback,
      addObserver: (name, observer) => observers.push([name, observer]),
      removeObserver: (name, observer) => observers.splice(observers.findIndex(item => item[0] === name && item[1] === observer), 1),
    } },
  });
  vm.runInContext(source.replaceAll('export function', 'function').replace('export class', 'class') +
    '\nglobalThis.api = { parseColor, isLightPage, KitsuneOscurecerChild, PAGE_SHEET, PDF_SHEET };', context);
  return { api: context.api, observers, preferences, shared };
}

// Una ventana de 1000×800: cada punto da el elemento que se pinte ahí (o el <body>).
function page({ background = 'rgb(255, 255, 255)', html = 'rgba(0, 0, 0, 0)', body = background, colorScheme = 'normal', dark = true,
                at = () => null, contentType = 'text/html', host = 'example.com', synthetic = false, meta = null } = {}) {
  const sheets = [];
  const element = (localName, color, parentElement = null) => ({ localName, color, parentElement });
  const root = element('html', html);
  const bodyElement = element('body', body, root);
  const document = {
    documentElement: root, body: bodyElement, contentType, mozSyntheticDocument: synthetic,
    querySelector: selector => selector === 'meta[name="color-scheme"]' && meta !== null ? { content: meta } : null,
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

test('below a short body the canvas is the body’s background, as CSS paints it, and a dark <meta name="color-scheme"> counts (Risco, 21-10)', () => {
  const { api } = load();
  // El cuerpo solo mide un párrafo: debajo, los puntos dan <html>, transparente; lo que se ve es el fondo del body.
  const short = extra => page({ html: 'rgba(0, 0, 0, 0)', body: 'rgb(32, 32, 32)', at: (x, y, { body }) => body.parentElement, ...extra }).window;
  assert.equal(api.isLightPage(short()), false);
  assert.equal(api.isLightPage(short({ body: 'rgb(250, 250, 250)' })), true);
  // Sin fondos: el lienzo es oscuro si la web pide el esquema oscuro en su <meta> y el modo es oscuro.
  const bare = extra => page({ background: 'rgba(0, 0, 0, 0)', ...extra }).window;
  assert.equal(api.isLightPage(bare({ meta: 'light dark' })), false);
  assert.equal(api.isLightPage(bare({ meta: 'light dark', dark: false })), true);
  assert.equal(api.isLightPage(bare({ meta: 'light' })), true);
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
  const { api, preferences, observers, shared } = load(new Map([['kitsune.oscurecer.enabled', true]]));
  const light = page();
  const actor = child(api, light);
  // Los avisos de preferencias y de sharedData no le llegan al actor de la web (Risco, 21-10): los cambios llegan en
  // un mensaje del proceso principal, que trae la lista de webs que no se oscurecen.
  assert.equal(observers.length, 0);
  assert.equal(shared.listeners.length, 0);
  const recheck = exceptions => actor.receiveMessage({ name: 'KitsuneOscurecer:Recheck', data: { exceptions } });
  actor.handleEvent({ type: 'DOMContentLoaded', target: light.document });
  assert.deepEqual(light.sheets, [api.PAGE_SHEET]);
  assert.match(decodeURIComponent(api.PAGE_SHEET), /:root\{filter:invert\(1\) hue-rotate\(180deg\) contrast\(\.86\)!important\}/);
  assert.match(decodeURIComponent(api.PAGE_SHEET), /:root :is\(img,picture,video,canvas,iframe,embed,object,svg image,\[style\*="url\("\]\)\{filter:hue-rotate\(180deg\) invert\(1\)!important\}/);
  // Otra vuelta no la pone dos veces.
  actor.check();
  assert.equal(light.sheets.length, 1);
  preferences.set('kitsune.oscurecer.enabled', false);
  recheck([]);
  assert.deepEqual(light.sheets, []);
  preferences.set('kitsune.oscurecer.enabled', true);
  recheck([]);
  assert.equal(light.sheets.length, 1);
  // Esta web, en la lista de «No oscurecer esta web» (la preferencia de texto no cuenta: a las webs les llega vacía).
  preferences.set('kitsune.oscurecer.excepciones', 'otra.org, EXAMPLE.com');
  actor.check();
  assert.equal(light.sheets.length, 1);
  recheck(['otra.org', 'example.com']);
  assert.deepEqual(light.sheets, []);
  recheck(['otra.org']);
  assert.equal(light.sheets.length, 1);
  // Al cargar una página, la lista sale de sharedData.
  shared.data.set('kitsune-oscurecer-excepciones', ['example.com']);
  const other = page();
  child(api, other).handleEvent({ type: 'DOMContentLoaded', target: other.document });
  assert.deepEqual(other.sheets, []);
  actor.didDestroy();
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
