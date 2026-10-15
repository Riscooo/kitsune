/* Kitsune Zero · una lámina lisa, con el brillo de la película en el canto.
 *
 * Decisión de Risco (15-10): no un vidrio grueso que dobla lo de detrás, sino una pompa de jabón («rollo
 * burbuja, que es la clave de Opera Air y de Liquid Glass, por eso es liquid»). En una pompa, el borde es una
 * película finísima: brilla más cuanto más de lado se mira (Fresnel), con los colores irisados de una capa
 * fina (su grosor cambia despacio a lo largo del borde) y reflejos suaves de la luz; el centro, limpio.
 * Apenas dobla lo de detrás: no necesita verlo, y por eso sale igual en Windows, macOS y cualquier Linux,
 * con la ventana transparente o con la foto de la web detrás. La dibuja Kitsune, con WebGL, en un <canvas>
 * detrás de todo (la tarjeta y las piezas van encima), con alfa premultiplicado sobre lo que haya.
 *
 * El borde se ve como el de una esfera de frente: en la franja de BAND px la superficie se va poniendo de
 * lado (N.z = √(1 − u²)) y ahí crecen el Fresnel y los reflejos.
 *
 * Con el fondo de la web (el de Windows, macOS y los Linux sin refracción en el compositor), detrás está la
 * foto de la web que pinta Kitsune, y esa sí la tiene: la lámina la pinta y su canto la dobla como una lente
 * (Risco, 15-10: «haremos lo más eficaz y top»): el canto de un vidrio redondeado (superelipse, P = 3, como el
 * de niri-vidrio en Linux), que hacia el filo enseña lo de un poco más adentro, cada color un poco distinto.
 * Con el fondo del sistema (lo de detrás es el escritorio) no lo ve, y lo dobla el compositor si puede.
 *
 * Se pinta solo cuando cambia algo (el tamaño, la fuerza, la web ampliada, la foto): quieta no cuesta nada.
 * Sin WebGL, no está (y zero.css pone su luz de siempre y la foto sin doblar).
 */
import { prefName, PREFS } from './zero-config.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const RADIUS = 48;   // esquinas de la ventana si zero.css no dice otra cosa (--zero-win-radius: cada sistema las suyas)
const BAND = 22;     // el canto se recoge hacia el filo; el resto de la lámina queda plano
const CARD_RADIUS = 18; // las esquinas de la tarjeta (= zero.css)
const FILM = 0.32;   // halo nacarado junto al filo blanco del boceto, sin teñir el centro
// La variante «Sobrio» (Dani, 15-10: «que no sea tan colorido, más como concentración»): la luz de la pompa
// en gris, en una franja algo más ancha y más tenue, y un filo fino en lugar del blanco del boceto.
const SOBRIO = Object.freeze({ band: 30, film: 0.24 });
const LENS_BAND = 30; // la lente conserva su caída suave; el reflejo del filo es más estrecho
const DEPTH = 70;    // la refracción ya probada: solo en el canto, con el centro plano

const state = new WeakMap(); // ventana → { canvas, gl, draws, … }

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize;       // la ventana, en px CSS
uniform float uScale;     // px del lienzo por px CSS
uniform float uRadius, uBand, uFilm, uStrength;
uniform float uMono, uEdge; // la variante «Sobrio» (sin color) y si la ventana tiene canto (no a pantalla completa)
uniform float uTopShade;    // px de arriba que se funden con negro (un Mac con cámara, a pantalla completa)
uniform vec4 uCards[4];   // las tarjetas (x, y, ancho, alto), con su borde de pompa por fuera
uniform int uCardCount;
uniform float uCardRadius, uCardAlpha;
uniform sampler2D uPhoto; // la foto de la web (con su fondo), si está
uniform float uPhotoOn;
uniform vec4 uPhotoMap;   // de px CSS a la foto: (escala x, escala y, desplazamiento x, desplazamiento y)
uniform float uDepth, uLensBand;
out vec4 outColor;

vec3 photo(vec2 q) { return texture(uPhoto, clamp(q * uPhotoMap.xy + uPhotoMap.zw, vec2(0.0), vec2(1.0))).rgb; }

// Distancia a una caja redondeada (positiva fuera).
float box(vec2 p, vec4 r, float radius) {
  vec2 c = r.xy + r.zw * 0.5, q = abs(p - c) - (r.zw * 0.5 - radius);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

// El color de la película en un punto: su grosor cambia despacio a lo largo del borde.
vec3 filmAt(vec2 p, float extra) {
  float t = 0.55 + 0.22 * sin((p.x + 1.3 * p.y) / 140.0) + 0.12 * sin(p.y / 97.0 - p.x / 213.0) + extra;
  return mix(vec3(1.0), 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67))), 0.48);
}

// Distancia al borde de un rectángulo redondeado (positiva dentro) y su normal hacia fuera.
float inner(vec2 p, float r, out vec2 n) {
  vec2 c = uSize * 0.5, q = abs(p - c) - (c - r), o = max(q, 0.0);
  float len = length(o);
  vec2 axis = q.x >= q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  n = (len > 0.0 ? o / len : axis) * sign(p - c);
  return r - (len + min(max(q.x, q.y), 0.0));
}

float blinn(vec3 N, vec3 L, float power) {
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  return pow(max(dot(N, H), 0.0), power);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uScale * uSize.y - gl_FragCoord.y) / uScale;
  vec2 nw, n;
  float window = inner(p, uRadius, nw);
  bool lens = uPhotoOn > 0.5;
  // A pantalla completa en un Mac con cámara, macOS deja negra la franja de arriba: la foto se funde con ella.
  float shade = uTopShade > 0.0 ? smoothstep(0.0, uTopShade, p.y) : 1.0;
  if (window <= 0.0 || uStrength <= 0.0) { outColor = lens ? vec4(photo(p) * shade, 1.0) : vec4(0.0); return; }
  // El borde de cada tarjeta: una línea fina de película pegada a ella por fuera, con un halo corto.
  float cardA = 0.0; vec3 cardC = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= uCardCount) break;
    float dc = box(p, uCards[i], uCardRadius);
    if (dc < 0.0 || dc > 8.0) continue;
    float k = uCardAlpha * (0.76 * (1.0 - smoothstep(0.6, 2.2, dc)) + 0.1 * exp(-dc / 2.5));
    vec3 cardFilm = filmAt(p, 0.2);
    if (uMono > 0.5) cardFilm = vec3(dot(cardFilm, vec3(0.299, 0.587, 0.114)));
    cardA = max(cardA, k); cardC = mix(vec3(1.0), cardFilm, 0.6);
  }
  float d = min(inner(p, max(uRadius, uBand), n), window);
  float u = clamp(1.0 - d / uBand, 0.0, 0.999);         // 0 dentro, 1 en el filo
  float nz = sqrt(1.0 - u * u);                          // el borde de una esfera, de frente
  vec3 N = vec3(n * u, nz);
  float side = 1.0 - nz;                                 // cuánto se pone de lado
  float fresnel = side * side;
  // La película: su grosor cambia despacio a lo largo del borde (y crece hacia el filo); de él salen los
  // colores, como en una pompa de jabón (interferencia, aproximada con una paleta de cosenos).
  vec3 film = filmAt(p, 0.35 * u);
  float edgeA; vec3 edgeC;
  if (uMono > 0.5) {
    // Sobrio: sin los colores de la pompa, su luz en gris; y el filo, una línea fina y limpia.
    film = vec3(dot(film, vec3(0.299, 0.587, 0.114)));
    edgeA = uFilm * fresnel + 0.15 * clamp(1.8 - window, 0.0, 1.0);
    edgeC = film * edgeA;
  } else {
    // Nácar: el boceto aprobado tiene un filo blanco continuo de 2–3 px, no solo el Fresnel tenue.
    // Bajo él asoma la película nacarada; su luz cae sin escalones y a 22 px el centro está limpio.
    float rim = 0.97 * (1.0 - smoothstep(2.2, 4.4, window));
    float pearl = uFilm * (fresnel + 0.6 * exp(-window / 4.0) + 1.2 * exp(-pow((window - 4.2) / 1.6, 2.0)))
      * (1.0 - smoothstep(14.0, uBand, window));
    edgeA = rim + pearl * (1.0 - rim);
    edgeC = mix(vec3(1.0), film, 0.04) * rim + film * pearl * (1.0 - rim);
  }
  // A pantalla completa la ventana no tiene canto (sus bordes son los de la pantalla): ni filo ni lente.
  edgeA *= uEdge; edgeC *= uEdge;
  // Los reflejos de la luz, suaves (una arriba a la izquierda y su eco abajo a la derecha).
  float onEdge = smoothstep(0.25, 0.65, u);
  float glint = uEdge * onEdge * (0.92 * blinn(N, normalize(vec3(-1.0, -1.25, 1.1)), 36.0) + 0.52 * blinn(N, normalize(vec3(1.0, 1.25, 1.1)), 44.0));
  float alpha = clamp((edgeA + glint + cardA) * uStrength, 0.0, 1.0);
  vec3 color = min((edgeC + vec3(glint) + cardC * cardA) * uStrength, vec3(alpha));   // premultiplicado
  if (!lens) { outColor = vec4(color, alpha); return; }
  // La foto de detrás, doblada en el canto: la pendiente del canto (superelipse, P = 3, hasta 4) dice
  // cuánto se desvía la mirada hacia dentro; el rojo un poco menos y el azul un poco más (dispersión).
  float lensU = clamp(1.0 - d / uLensBand, 0.0, 0.999);
  float P = 3.0, w = pow(lensU, P);
  float slope = lensU > 0.0 ? min(pow(lensU, P - 1.0) * pow(max(1.0 - w, 1e-4), 1.0 / P - 1.0), 4.0) / 4.0 : 0.0;
  vec2 bend = -n * uDepth * uStrength * uEdge * slope;
  vec3 behind = vec3(photo(p + bend * 0.94).r, photo(p + bend).g, photo(p + bend * 1.06).b);
  outColor = vec4((behind * (1.0 - alpha) + color) * shade, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function setup(canvas) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const u = name => gl.getUniformLocation(program, name);
  const uniforms = Object.fromEntries(['uSize', 'uScale', 'uRadius', 'uBand', 'uFilm', 'uStrength', 'uCards', 'uCardCount', 'uCardRadius', 'uCardAlpha',
    'uPhoto', 'uPhotoOn', 'uPhotoMap', 'uDepth', 'uLensBand', 'uMono', 'uEdge', 'uTopShade'].map(n => [n, u(n)]));
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.uniform1i(uniforms.uPhoto, 0);
  return { gl, program, uniforms, texture, photo: null };
}

function strength(win, st) {
  try { return Math.max(0, st.host.prefs.getIntPref(prefName(st.host.prefix, PREFS.glassStrength), 100)) / 100; } catch { return 1; }
}

function draw(win, st) {
  st.frame = 0;
  const { canvas } = st;
  const root = win.document.documentElement;
  // Con la web ampliada no hay lámina. Con un fondo que pinta Zero (espacio, niebla, foto), en «Sobrio» tampoco
  // (su fondo lleva su propio filo); en «Nácar» la lámina pone su canto encima.
  const sobrio = root.getAttribute('zero-variant') === 'sobrio';
  const hidden = root.hasAttribute('zero-full') || (sobrio && ['space', 'mist', 'photo'].includes(root.getAttribute('zero-backdrop')));
  if (canvas.hidden !== hidden) canvas.hidden = hidden;
  if (hidden || !st.gl) return;
  const W = win.innerWidth, H = win.innerHeight, k = win.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(W * k)), height = Math.max(1, Math.round(H * k));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const { gl, uniforms: u } = st.gl;
  gl.viewport(0, 0, width, height);
  gl.uniform2f(u.uSize, W, H);
  gl.uniform1f(u.uScale, k);
  // Las esquinas de la ventana, las de zero.css (las de cada sistema; 0 a pantalla completa).
  const radius = parseFloat(win.getComputedStyle(root).getPropertyValue('--zero-win-radius'));
  gl.uniform1f(u.uRadius, Number.isFinite(radius) ? radius : RADIUS);
  gl.uniform1f(u.uBand, sobrio ? SOBRIO.band : BAND);
  gl.uniform1f(u.uFilm, sobrio ? SOBRIO.film : FILM);
  gl.uniform1f(u.uMono, sobrio ? 1 : 0);
  const fullscreen = root.matches('[inFullscreen], [sizemode="fullscreen"]');
  gl.uniform1f(u.uEdge, fullscreen ? 0 : 1);
  gl.uniform1f(u.uTopShade, fullscreen && root.getAttribute('zero-os') === 'mac' ? 96 : 0);
  gl.uniform1f(u.uStrength, strength(win, st));
  // Las tarjetas a la vista (la web, las de la vista dividida, la barra lateral), donde estén en este
  // fotograma; su borde se va con ellas (con la tarjeta escondida, sin borde).
  const panels = win.document.getElementById('tabbrowser-tabpanels');
  const cards = [...(panels?.querySelectorAll(':scope > :is(.deck-selected, .split-view-panel-active)') ?? []), win.document.getElementById('sidebar-box')]
    .filter(el => el && !el.hidden && el.getBoundingClientRect().width > 1).slice(0, 4).map(el => el.getBoundingClientRect());
  const rects = new Float32Array(16);
  cards.forEach((r, i) => rects.set([r.left, r.top, r.width, r.height], i * 4));
  gl.uniform4fv(u.uCards, rects);
  gl.uniform1i(u.uCardCount, cards.length);
  gl.uniform1f(u.uCardRadius, CARD_RADIUS);
  gl.uniform1f(u.uCardAlpha, panels ? Number(win.getComputedStyle(panels).opacity) : 0);
  // Con el fondo de la web, la foto (como la pone zero.css: «cover», centrada) y la lente del canto.
  const source = root.getAttribute('zero-backdrop') === 'web' ? win.document.getElementById('zero-backdrop') : null;
  const on = !!source?.dataset.painted && source.width > 1;
  if (on && st.gl.photo !== st.photoVersion) {
    gl.bindTexture(gl.TEXTURE_2D, st.gl.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    st.gl.photo = st.photoVersion;
  }
  gl.uniform1f(u.uPhotoOn, on ? 1 : 0);
  if (on) {
    const scale = Math.max(W / source.width, H / source.height), dw = source.width * scale, dh = source.height * scale;
    gl.uniform4f(u.uPhotoMap, 1 / dw, 1 / dh, -(W - dw) / 2 / dw, -(H - dh) / 2 / dh);
  }
  gl.uniform1f(u.uDepth, DEPTH);
  gl.uniform1f(u.uLensBand, LENS_BAND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  st.draws += 1;
  // Mientras la tarjeta se mueve (ampliar, entrar, volver a una web), su borde la sigue.
  if (panels?.getAnimations({ subtree: true }).some(a => a.playState === 'running')) schedule(win, st);
}

function schedule(win, st) {
  if (!st.frame) st.frame = win.requestAnimationFrame(() => draw(win, st));
}

export function attach(win, ctx) {
  const doc = win.document;
  const canvas = doc.createElementNS(HTML, 'canvas');
  canvas.id = 'zero-pane';
  canvas.setAttribute('aria-hidden', 'true');
  const st = { host: ctx.host, canvas, gl: null, draws: 0, frame: 0, photoVersion: 0, cleanups: [] };
  state.set(win, st);
  try { st.gl = setup(canvas); } catch (error) { console.error('Zero: la lámina no tiene WebGL', error); }
  if (!st.gl) { state.delete(win); return; }
  doc.body.prepend(canvas);
  doc.documentElement.setAttribute('zero-pane', '');
  const listen = (target, type, fn) => { target.addEventListener(type, fn); st.cleanups.push(() => target.removeEventListener(type, fn)); };
  listen(win, 'resize', () => schedule(win, st));
  // La tarjeta se mueve o cambia (ampliar, entrar en Zero, otra pestaña, la vista dividida, la barra
  // lateral): se vuelve a pintar su borde (y, mientras se anima, en cada fotograma).
  listen(win, 'zero-move', () => schedule(win, st));
  // Una foto nueva de la web (con su fondo): a la lámina, que la dobla en el canto.
  listen(win, 'zero-backdrop-photo', () => { st.photoVersion += 1; schedule(win, st); });
  listen(win.gBrowser.tabContainer, 'TabSelect', () => schedule(win, st));
  const panels = doc.getElementById('tabbrowser-tabpanels');
  if (panels) { listen(panels, 'transitionstart', () => schedule(win, st)); listen(panels, 'transitionend', () => schedule(win, st)); }
  // Con la web ampliada no hay lámina; la pestaña vacía no tiene tarjeta.
  const observer = new win.MutationObserver(() => schedule(win, st));
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['zero-full', 'zero-empty', 'zero-backdrop', 'zero-variant', 'zero-os', 'sizemode', 'inFullscreen'] });
  const sidebar = doc.getElementById('sidebar-box');
  if (sidebar) observer.observe(sidebar, { attributes: true, attributeFilter: ['hidden'] });
  if (panels) observer.observe(panels, { attributes: true, attributeFilter: ['splitview'] });
  st.cleanups.push(() => observer.disconnect());
  const pref = prefName(ctx.host.prefix, PREFS.glassStrength);
  const prefs = { observe: () => schedule(win, st) };
  ctx.host.prefs.addObserver(pref, prefs);
  st.cleanups.push(() => ctx.host.prefs.removeObserver(pref, prefs));
  schedule(win, st);
}

export function detach(win) {
  const st = state.get(win);
  if (!st) return;
  state.delete(win);
  if (st.frame) win.cancelAnimationFrame(st.frame);
  for (const undo of st.cleanups.reverse()) { try { undo(); } catch { /* ya no estaba */ } }
  st.canvas.remove();
  win.document.documentElement.removeAttribute('zero-pane');
  try { st.gl.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ya se fue */ }
}

/** Para las pruebas: cuántas veces se ha pintado la lámina de esta ventana. */
export const ZeroPane = { draws: win => state.get(win)?.draws ?? 0 };
