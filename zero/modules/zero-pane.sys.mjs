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
const FILM = 0.55;   // cuánto se ve la película irisada en el filo

const state = new WeakMap(); // ventana → { canvas, gl, draws, … }

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize;       // la ventana, en px CSS
uniform float uScale;     // px del lienzo por px CSS
uniform float uRadius, uBand, uFilm, uStrength;
out vec4 outColor;

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
  float d = min(inner(p, max(uRadius, uBand), n), window);
  float u = clamp(1.0 - d / uBand, 0.0, 0.999);         // 0 dentro, 1 en el filo
  float nz = sqrt(1.0 - u * u);                          // el borde de una esfera, de frente
  vec3 N = vec3(n * u, nz);
  float side = 1.0 - nz;                                 // cuánto se pone de lado
  float fresnel = side * side;
  // La película: su grosor cambia despacio a lo largo del borde (y crece hacia el filo); de él salen los
  // colores, como en una pompa de jabón (interferencia, aproximada con una paleta de cosenos).
  float t = 0.55 + 0.22 * sin((p.x + 1.3 * p.y) / 140.0) + 0.12 * sin(p.y / 97.0 - p.x / 213.0) + 0.35 * u;
  vec3 film = mix(vec3(1.0), 0.5 + 0.5 * cos(6.2831 * (t * 1.6 + vec3(0.0, 0.33, 0.67))), 0.75);
  float a = uFilm * fresnel;
  // Los reflejos de la luz, suaves (una arriba a la izquierda y su eco abajo a la derecha).
  float onEdge = smoothstep(0.25, 0.65, u);
  float glint = onEdge * (0.85 * blinn(N, normalize(vec3(-1.0, -1.25, 1.1)), 24.0) + 0.45 * blinn(N, normalize(vec3(1.0, 1.25, 1.1)), 30.0));
  float alpha = clamp((a + glint) * uStrength, 0.0, 1.0);
  vec3 color = min((film * a + vec3(glint)) * uStrength, vec3(alpha));   // premultiplicado
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
  const uniforms = Object.fromEntries(['uSize', 'uScale', 'uRadius', 'uBand', 'uFilm', 'uStrength'].map(n => [n, u(n)]));
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
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  st.draws += 1;
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
  // Con la web ampliada no hay lámina.
  const observer = new win.MutationObserver(() => schedule(win, st));
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['zero-full'] });
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
