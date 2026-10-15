/* Kitsune Zero · la lámina alrededor de la ventana: una burbuja.
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
 * Se pinta solo cuando cambia algo (el tamaño, la fuerza, la web ampliada): quieta no cuesta nada. Sin
 * WebGL, no está (y zero.css pone su luz de siempre).
 */
import { prefName, PREFS } from './zero-config.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
const RADIUS = 48;   // esquinas de la ventana (= zero.css)
const BAND = 30;     // la franja del borde de la pompa, en px CSS
const CARD_RADIUS = 18; // las esquinas de la tarjeta (= zero.css)
const FILM = 0.24;   // cuánto se ve la película en el filo: poco, como una pompa (no «luces de feria»)

const state = new WeakMap(); // ventana → { canvas, gl, draws, … }

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize;       // la ventana, en px CSS
uniform float uScale;     // px del lienzo por px CSS
uniform float uRadius, uBand, uFilm, uStrength;
uniform vec4 uCards[4];   // las tarjetas (x, y, ancho, alto), con su borde de pompa por fuera
uniform int uCardCount;
uniform float uCardRadius, uCardAlpha;
out vec4 outColor;

// Distancia a una caja redondeada (positiva fuera).
float box(vec2 p, vec4 r, float radius) {
  vec2 c = r.xy + r.zw * 0.5, q = abs(p - c) - (r.zw * 0.5 - radius);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

// El color de la película en un punto: su grosor cambia despacio a lo largo del borde.
vec3 filmAt(vec2 p, float extra) {
  float t = 0.55 + 0.22 * sin((p.x + 1.3 * p.y) / 140.0) + 0.12 * sin(p.y / 97.0 - p.x / 213.0) + extra;
  return mix(vec3(1.0), 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67))), 0.55);
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
  if (window <= 0.0 || uStrength <= 0.0) { outColor = vec4(0.0); return; }
  // El borde de cada tarjeta: una línea fina de película pegada a ella por fuera, con un halo corto.
  float cardA = 0.0; vec3 cardC = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= uCardCount) break;
    float dc = box(p, uCards[i], uCardRadius);
    if (dc < 0.0 || dc > 8.0) continue;
    float k = uCardAlpha * (0.5 * (1.0 - smoothstep(0.6, 2.2, dc)) + 0.08 * exp(-dc / 2.5));
    cardA = max(cardA, k); cardC = filmAt(p, 0.2);
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
  // Y el filo mismo, una línea fina y limpia que hace de borde de la ventana (Risco, 15-10).
  float a = uFilm * fresnel + 0.15 * clamp(1.8 - window, 0.0, 1.0);
  // Los reflejos de la luz, suaves (una arriba a la izquierda y su eco abajo a la derecha).
  float onEdge = smoothstep(0.25, 0.65, u);
  float glint = onEdge * (0.85 * blinn(N, normalize(vec3(-1.0, -1.25, 1.1)), 24.0) + 0.45 * blinn(N, normalize(vec3(1.0, 1.25, 1.1)), 30.0));
  float alpha = clamp((a + glint + cardA) * uStrength, 0.0, 1.0);
  vec3 color = min((film * a + vec3(glint) + cardC * cardA) * uStrength, vec3(alpha));   // premultiplicado
  outColor = vec4(color, alpha);
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
  const uniforms = Object.fromEntries(['uSize', 'uScale', 'uRadius', 'uBand', 'uFilm', 'uStrength', 'uCards', 'uCardCount', 'uCardRadius', 'uCardAlpha'].map(n => [n, u(n)]));
  return { gl, program, uniforms };
}

function strength(win, st) {
  try { return Math.max(0, st.host.prefs.getIntPref(prefName(st.host.prefix, PREFS.glassStrength), 100)) / 100; } catch { return 1; }
}

function draw(win, st) {
  st.frame = 0;
  const { canvas } = st;
  const root = win.document.documentElement;
  const hidden = root.hasAttribute('zero-full');
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
  gl.uniform1f(u.uRadius, RADIUS);
  gl.uniform1f(u.uBand, BAND);
  gl.uniform1f(u.uFilm, FILM);
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
  const st = { host: ctx.host, canvas, gl: null, draws: 0, frame: 0, cleanups: [] };
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
  listen(win.gBrowser.tabContainer, 'TabSelect', () => schedule(win, st));
  const panels = doc.getElementById('tabbrowser-tabpanels');
  if (panels) { listen(panels, 'transitionstart', () => schedule(win, st)); listen(panels, 'transitionend', () => schedule(win, st)); }
  // Con la web ampliada no hay lámina; la pestaña vacía no tiene tarjeta.
  const observer = new win.MutationObserver(() => schedule(win, st));
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['zero-full', 'zero-empty'] });
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
