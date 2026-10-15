/* Kitsune Zero · la lámina de vidrio alrededor de la ventana.
 *
 * Decisión de Risco (15-10, maqueta «D»): Zero es una lámina de vidrio con el canto redondo que dobla lo
 * que tiene detrás, alrededor de toda la ventana, con brillos en el canto, como el vidrio de Apple. Tiene
 * que ir en Windows, macOS y cualquier Linux: la dibuja Kitsune, con WebGL, en un <canvas> detrás de todo
 * (la tarjeta y las piezas van encima).
 *
 * El modelo, sencillo pero físico: la lámina es plana por dentro y su canto, de BAND px, tiene el perfil de
 * una superelipse (1 - u^P)^(1/P): empieza casi plano y se curva al final, así el doblez entra sin un límite
 * que se vea («chill», pidió Risco). La vista baja en vertical, se refracta en la superficie (Snell, vidrio
 * n ≈ 1,5, un poco distinto para cada color: dispersión) y atraviesa un grueso DEPTH hasta el fondo. Encima,
 * los brillos: especular de una luz arriba a la izquierda y de su reflejo abajo a la derecha, y el Fresnel.
 *
 * Qué hay detrás depende del fondo de Zero (zero-frame):
 * - «web» (Windows, macOS, Linux sin compositor que ayude): una foto de la web, que pinta zero-frame y
 *   llega en el evento «zero-backdrop». Se dobla en el canto.
 * - «system» (ventana transparente): detrás está el escritorio, que solo ve el compositor. Aquí la lámina
 *   pone los brillos; doblar el escritorio le toca al compositor.
 *
 * Se pinta solo cuando cambia algo (el tamaño, la foto, el fondo, la fuerza): quieta no cuesta nada. Sin
 * WebGL, no está (y zero.css pone su luz de siempre).
 */
import { prefName, PREFS } from './zero-config.sys.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';
// La maqueta elegida (D), en px CSS.
const RADIUS = 48;   // esquinas de la ventana (= zero.css)
const BAND = 34;     // el canto redondo
const DEPTH = 70;    // el grueso de la lámina
const SHINE = 1.25;  // cuánto brillan los cantos
const SPREAD = 0.05; // dispersión: el rojo y el azul se doblan un poco distinto
const PROFILE = 3;   // P de la superelipse del canto

const state = new WeakMap(); // ventana → { canvas, gl, program, texture, back, draws, … }

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize;       // la ventana, en px CSS
uniform float uScale;     // px del lienzo por px CSS
uniform float uRadius, uBand, uDepth, uShine, uSpread, uProfile;
uniform bool uHasBack;    // hay una foto detrás (fondo «web»)
uniform sampler2D uBack;
uniform vec4 uBackFit;    // la foto, ajustada a la ventana («cover»): uv = (p - xy) / zw
out vec4 outColor;

// Distancia al borde de un rectángulo redondeado (positiva dentro) y su normal hacia fuera.
float inner(vec2 p, float r, out vec2 n) {
  vec2 c = uSize * 0.5, q = abs(p - c) - (c - r), o = max(q, 0.0);
  float len = length(o);
  vec2 axis = q.x >= q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  n = (len > 0.0 ? o / len : axis) * sign(p - c);
  return r - (len + min(max(q.x, q.y), 0.0));
}

vec3 back(vec2 p) { return texture(uBack, (p - uBackFit.xy) / uBackFit.zw).rgb; }

float blinn(vec3 N, vec3 L, float power) {
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  return pow(max(dot(N, H), 0.0), power);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uScale * uSize.y - gl_FragCoord.y) / uScale;
  vec2 nw, n;
  float window = inner(p, uRadius, nw);
  // El canto sigue una esquina al menos tan redonda como él es ancho: el doblez gira suave.
  float d = min(inner(p, max(uRadius, uBand), n), window);
  float edge = uBand > 0.0 ? clamp(1.0 - d / uBand, 0.0, 0.999) : 0.0;
  float slope = min(pow(edge, uProfile - 1.0) * pow(1.0 - pow(edge, uProfile), (1.0 - uProfile) / uProfile), 5.0);
  vec3 N = normalize(vec3(n * slope, 1.0));
  bool inside = window > 0.0;

  vec3 color = vec3(0.0);
  if (uHasBack) {
    if (inside && uDepth > 0.0) {
      // Refracción por color (la vista baja por -z): dónde cae en el fondo.
      float etas[3] = float[3](1.0 / (1.5 - uSpread), 1.0 / 1.5, 1.0 / (1.5 + uSpread));
      for (int i = 0; i < 3; i++) {
        vec3 T = refract(vec3(0.0, 0.0, -1.0), N, etas[i]);
        vec2 at = p + T.xy / abs(T.z) * uDepth;
        color[i] = back(at)[i];
      }
    } else {
      color = back(p);
    }
  }
  // Los brillos del canto.
  float light = 0.0;
  if (inside && uShine > 0.0) {
    vec3 L1 = normalize(vec3(-1.0, -1.25, 1.1)), L2 = normalize(vec3(1.0, 1.25, 1.1));
    float spec = (edge > 0.02 ? 1.0 : 0.0) * (blinn(N, L1, 48.0) + 0.75 * blinn(N, L2, 48.0));
    // (Sin el 4 % de base del vidrio: sería un velo blanco en toda la lámina.)
    float fresnel = 0.96 * pow(1.0 - N.z, 5.0);
    // El filo. Sobre una foto doblada se lee como vidrio; sin nada que doblar (ventana transparente), un filo
    // entero sería una raya blanca alrededor (Risco, captura 46): ahí solo donde le da la luz, en las esquinas.
    float lit = clamp(blinn(N, L1, 6.0) + blinn(N, L2, 6.0), 0.0, 1.0);
    float rim = clamp(1.6 - window, 0.0, 1.0) * (uHasBack ? 0.35 + 0.65 * lit : lit);
    // Y, sin foto, una luz suave que nace del canto (el grosor del vidrio) y se funde hacia dentro.
    float glow = uHasBack ? 0.0 : 0.05 * pow(edge, 2.5);
    light = clamp(uShine * (spec + (uHasBack ? 0.8 : 0.05) * fresnel + 0.8 * rim + glow), 0.0, 1.0);
  }
  if (uHasBack) {
    // Opaca (la ventana es un rectángulo): fuera de las esquinas, la foto tal cual.
    color = color * (1.0 - light) + light;
    if (inside) color *= 1.0 - 0.18 * pow(edge, 3.0) * min(uShine, 1.0);
    outColor = vec4(color, 1.0);
  } else {
    // Transparente: solo la luz (alfa premultiplicado).
    outColor = vec4(vec3(light), light);
  }
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
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const u = name => gl.getUniformLocation(program, name);
  const uniforms = Object.fromEntries(['uSize', 'uScale', 'uRadius', 'uBand', 'uDepth', 'uShine', 'uSpread', 'uProfile', 'uHasBack', 'uBack', 'uBackFit'].map(n => [n, u(n)]));
  return { gl, program, texture, uniforms };
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
  const web = root.getAttribute('zero-backdrop') === 'web' && !!st.back;
  const s = strength(win, st);
  gl.viewport(0, 0, width, height);
  gl.uniform2f(u.uSize, W, H);
  gl.uniform1f(u.uScale, k);
  gl.uniform1f(u.uRadius, RADIUS);
  gl.uniform1f(u.uBand, BAND);
  gl.uniform1f(u.uDepth, DEPTH * s);
  gl.uniform1f(u.uShine, SHINE * s);
  gl.uniform1f(u.uSpread, SPREAD);
  gl.uniform1f(u.uProfile, PROFILE);
  gl.uniform1i(u.uHasBack, web ? 1 : 0);
  gl.uniform1i(u.uBack, 0);
  if (web) {
    // La foto, a pantalla completa como un «cover» (como la del CSS).
    const scale = Math.max(W / st.back.width, H / st.back.height);
    const bw = st.back.width * scale, bh = st.back.height * scale;
    gl.uniform4f(u.uBackFit, (W - bw) / 2, (H - bh) / 2, bw, bh);
  }
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
  const st = { host: ctx.host, canvas, gl: null, back: null, draws: 0, frame: 0, cleanups: [] };
  state.set(win, st);
  try { st.gl = setup(canvas); } catch (error) { console.error('Zero: la lámina no tiene WebGL', error); }
  if (!st.gl) { state.delete(win); return; }
  doc.body.prepend(canvas);
  doc.documentElement.setAttribute('zero-pane', '');
  const listen = (target, type, fn) => { target.addEventListener(type, fn); st.cleanups.push(() => target.removeEventListener(type, fn)); };
  // La foto de la web que pinta zero-frame (con el fondo «web»); sin foto, null.
  listen(win, 'zero-backdrop', event => {
    const image = event.detail?.canvas ?? null;
    st.back = image;
    if (image) {
      const { gl, texture } = st.gl;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    }
    schedule(win, st);
  });
  listen(win, 'resize', () => schedule(win, st));
  // La web ampliada (no hay lámina) y el fondo (con foto o transparente).
  const observer = new win.MutationObserver(() => schedule(win, st));
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['zero-full', 'zero-backdrop'] });
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
