#!/usr/bin/env node
/* El lobo de Kitsune Zero, a la vista: pinta zero/assets/lobo.json con el reproductor de verdad
 * (zero/modules/zero-lobo.mjs) sobre un canvas de mentira y guarda
 *
 *   tools/lobo/hoja.png       todos los cuadros y cada animación en tira, ampliados;
 *   tools/lobo/<nombre>.gif   las animaciones de cuerpo que se enseñan (quieto, pensar, hablar, feliz)
 *                             y icono.gif, el icono del raíl sobre cristal claro y oscuro.
 *
 *   node tools/lobo/hoja.mjs                      la hoja y los GIF
 *   node tools/lobo/hoja.mjs --ver a,b --escala 10 --salida /ruta.png
 *                                                 solo esos cuadros, muy grandes y con rejilla
 *
 * Sin dependencias: el PNG y el GIF se escriben a mano (zlib y LZW).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validar, crearReproductor, rasterizar, ZONAS } from '../../zero/modules/zero-lobo.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const datos = JSON.parse(readFileSync(join(RAIZ, 'zero/assets/lobo.json'), 'utf8'));

const errores = validar(datos);
if (errores.length) {
  console.error(`lobo.json tiene ${errores.length} errores:\n${errores.join('\n')}`);
  process.exit(1);
}

/* ---------------------------------------------------------------- un canvas de mentira, en RGBA */

function lienzo(ancho, alto) {
  const data = new Uint8ClampedArray(ancho * alto * 4);
  const c = { width: ancho, height: alto, data };
  const ctx = {
    canvas: c,
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData(img, x, y) {
      for (let j = 0; j < img.height; j++) {
        for (let i = 0; i < img.width; i++) {
          const d = ((y + j) * ancho + x + i) * 4;
          const s = (j * img.width + i) * 4;
          for (let k = 0; k < 4; k++) data[d + k] = img.data[s + k];
        }
      }
    },
    clearRect(x, y, w, h) {
      for (let j = Math.max(0, y); j < Math.min(alto, y + h); j++) data.fill(0, (j * ancho + Math.max(0, x)) * 4, (j * ancho + Math.min(ancho, x + w)) * 4);
    },
    fillRect(x, y, w, h) {
      const [r, g, b] = ctx.fillStyle;
      for (let j = Math.max(0, y); j < Math.min(alto, y + h); j++) {
        for (let i = Math.max(0, x); i < Math.min(ancho, x + w); i++) data.set([r, g, b, 255], (j * ancho + i) * 4);
      }
    },
    fillStyle: [0, 0, 0],
    drawImage(src, dx, dy, dw = src.width, dh = src.height) {
      for (let j = 0; j < dh; j++) {
        const y = dy + j;
        if (y < 0 || y >= alto) continue;
        const sj = Math.floor((j * src.height) / dh);
        for (let i = 0; i < dw; i++) {
          const x = dx + i;
          if (x < 0 || x >= ancho) continue;
          const si = Math.floor((i * src.width) / dw);
          const s = (sj * src.width + si) * 4;
          const a = (src.data[s + 3] / 255) * ctx.globalAlpha;
          if (a <= 0) continue;
          const d = (y * ancho + x) * 4;
          const da = data[d + 3] / 255;
          const oa = a + da * (1 - a);
          for (let k = 0; k < 3; k++) data[d + k] = Math.round((src.data[s + k] * a + data[d + k] * da * (1 - a)) / oa);
          data[d + 3] = Math.round(oa * 255);
        }
      }
    },
  };
  c.getContext = () => ctx;
  return c;
}

const hex = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));

/* ---------------------------------------------------------------- letras de 3×5 para los rótulos */

const LETRAS = {
  a: '.#. #.# ### #.# #.#', b: '##. #.# ##. #.# ##.', c: '.## #.. #.. #.. .##', d: '##. #.# #.# #.# ##.',
  e: '### #.. ##. #.. ###', f: '### #.. ##. #.. #..', g: '.## #.. #.# #.# .##', h: '#.# #.# ### #.# #.#',
  i: '### .#. .#. .#. ###', j: '..# ..# ..# #.# .#.', k: '#.# #.# ##. #.# #.#', l: '#.. #.. #.. #.. ###',
  m: '#.# ### ### #.# #.#', n: '##. #.# #.# #.# #.#', o: '.#. #.# #.# #.# .#.', p: '##. #.# ##. #.. #..',
  q: '.#. #.# #.# ##. .##', r: '##. #.# ##. #.# #.#', s: '.## #.. .#. ..# ##.', t: '### .#. .#. .#. .#.',
  u: '#.# #.# #.# #.# ###', v: '#.# #.# #.# #.# .#.', w: '#.# #.# ### ### #.#', x: '#.# #.# .#. #.# #.#',
  y: '#.# #.# .#. .#. .#.', z: '### ..# .#. #.. ###', ñ: '### ... ##. #.# #.#', 0: '### #.# #.# #.# ###',
  1: '.#. ##. .#. .#. ###', 2: '##. ..# .#. #.. ###', 3: '##. ..# .#. ..# ##.', 4: '#.# #.# ### ..# ..#',
  5: '### #.. ##. ..# ##.', 6: '.## #.. ### #.# ###', 7: '### ..# .#. .#. .#.', 8: '### #.# ### #.# ###',
  9: '### #.# ### ..# ##.', '-': '... ... ### ... ...', _: '... ... ... ... ###', '.': '... ... ... ... .#.',
  ':': '... .#. ... .#. ...', '(': '.#. #.. #.. #.. .#.', ')': '.#. ..# ..# ..# .#.', '×': '... #.# .#. #.# ...',
  '/': '..# ..# .#. #.. #..', ' ': '... ... ... ... ...', ',': '... ... ... .#. #..', '·': '... ... .#. ... ...',
};
// Cada letra son 5 filas de 3 píxeles, separadas por espacios.
for (const k of Object.keys(LETRAS)) LETRAS[k] = LETRAS[k].replaceAll(' ', '');

function rotulo(ctx, texto, x, y, color, escala = 2) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of texto.toLowerCase().normalize('NFC')) {
    const g = LETRAS[ch] ?? LETRAS[ch.normalize('NFD')[0]] ?? LETRAS['.'];
    for (let n = 0; n < 15; n++) if (g[n] === '#') ctx.fillRect(cx + (n % 3) * escala, y + Math.floor(n / 3) * escala, escala, escala);
    cx += 4 * escala;
  }
  return cx - x;
}
const anchoRotulo = (texto, escala = 2) => [...texto].length * 4 * escala;

/* ---------------------------------------------------------------- PNG y GIF */

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function png(ancho, alto, rgba) {
  const fila = ancho * 4 + 1;
  const crudo = Buffer.alloc(fila * alto);
  for (let j = 0; j < alto; j++) Buffer.from(rgba.buffer, rgba.byteOffset + j * ancho * 4, ancho * 4).copy(crudo, j * fila + 1);
  const trozo = (tipo, datos) => {
    const t = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
    const out = Buffer.alloc(t.length + 8);
    out.writeUInt32BE(datos.length, 0);
    t.copy(out, 4);
    out.writeUInt32BE(crc32(t), t.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', deflateSync(crudo, { level: 9 })), trozo('IEND', Buffer.alloc(0))]);
}

function lzw(indices, minimo) {
  const borrar = 1 << minimo;
  const fin = borrar + 1;
  let siguiente = fin + 1;
  let tamaño = minimo + 1;
  let tabla = new Map();
  const bytes = [];
  let acumulado = 0;
  let bits = 0;
  const emitir = codigo => {
    acumulado |= codigo << bits;
    bits += tamaño;
    while (bits >= 8) { bytes.push(acumulado & 255); acumulado >>>= 8; bits -= 8; }
  };
  emitir(borrar);
  let prefijo = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const clave = (prefijo << 8) | k;
    const codigo = tabla.get(clave);
    if (codigo !== undefined) { prefijo = codigo; continue; }
    emitir(prefijo);
    if (siguiente === 4096) {
      emitir(borrar);
      siguiente = fin + 1;
      tamaño = minimo + 1;
      tabla = new Map();
    } else {
      if (siguiente >= 1 << tamaño) tamaño++;
      tabla.set(clave, siguiente++);
    }
    prefijo = k;
  }
  emitir(prefijo);
  emitir(fin);
  if (bits > 0) bytes.push(acumulado & 255);
  return bytes;
}

/** Un GIF que se repite, con los fotogramas en RGB opaco y su duración en ms. */
function gif(ancho, alto, fotogramas) {
  const indice = new Map();
  const paleta = [];
  const indexados = fotogramas.map(({ rgba }) => {
    const idx = new Uint8Array(ancho * alto);
    for (let n = 0; n < idx.length; n++) {
      const clave = (rgba[n * 4] << 16) | (rgba[n * 4 + 1] << 8) | rgba[n * 4 + 2];
      let v = indice.get(clave);
      if (v === undefined) {
        if (paleta.length === 256) throw new Error('El GIF necesita más de 256 colores');
        v = paleta.length;
        indice.set(clave, v);
        paleta.push(clave);
      }
      idx[n] = v;
    }
    return idx;
  });
  let bitsTabla = 1;
  while (1 << bitsTabla < paleta.length) bitsTabla++;
  const out = [...Buffer.from('GIF89a', 'latin1')];
  out.push(ancho & 255, ancho >> 8, alto & 255, alto >> 8, 0xf0 | (bitsTabla - 1), 0, 0);
  for (let n = 0; n < 1 << bitsTabla; n++) {
    const c = paleta[n] ?? 0;
    out.push((c >> 16) & 255, (c >> 8) & 255, c & 255);
  }
  out.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0', 'latin1'), 3, 1, 0, 0, 0);
  const minimo = Math.max(2, bitsTabla);
  fotogramas.forEach(({ ms }, f) => {
    const cs = Math.max(2, Math.round(ms / 10));
    out.push(0x21, 0xf9, 4, 0, cs & 255, cs >> 8, 0, 0);
    out.push(0x2c, 0, 0, 0, 0, ancho & 255, ancho >> 8, alto & 255, alto >> 8, 0);
    out.push(minimo);
    const datos = lzw(indexados[f], minimo);
    for (let n = 0; n < datos.length; n += 255) {
      const trozo = datos.slice(n, n + 255);
      out.push(trozo.length, ...trozo);
    }
    out.push(0);
  });
  out.push(0x3b);
  return Buffer.from(out);
}

/* ---------------------------------------------------------------- la hoja */

const FONDO = hex('#f2efe8');
const TINTA = hex('#252d2b');
const SUAVE = hex('#8a8f86');
const DAMAS = [hex('#dfe3df'), hex('#d2d7d2')];
const CRISTAL_CLARO = hex('#e8edf1');
const CRISTAL_OSCURO = hex('#1f2528');

/** Damas del tamaño del píxel del lobo, para ver lo transparente. */
function damas(ctx, x, y, w, h, escala) {
  for (let j = 0; j < h; j += escala) {
    for (let i = 0; i < w; i += escala) {
      ctx.fillStyle = DAMAS[((i + j) / escala) % 2];
      ctx.fillRect(x + i, y + j, Math.min(escala, w - i), Math.min(escala, h - j));
    }
  }
}

function imagenDeCuadro(nombre) {
  const r = rasterizar(datos, nombre);
  return { width: r.ancho, height: r.alto, data: r.rgba, x: r.x, y: r.y };
}

/** Los fotogramas de una animación: uno a mitad de cada paso, con lo que haya de efectos en ese momento. */
function tira(tamaño, nombre) {
  const r = crearReproductor(datos, { tamaño, lienzo });
  r.reproducir(nombre, { reiniciar: true });
  const anim = datos.animaciones[tamaño][nombre];
  const fotos = [];
  let t = 0;
  r.avanzar(0);
  for (const paso of anim.pasos) {
    const medio = t + Math.floor(paso.ms / 2);
    r.avanzar(medio);
    const c = lienzo(r.ancho, r.alto);
    r.pintar(c.getContext(), 1);
    fotos.push({ img: c, ms: paso.ms });
    t += paso.ms;
  }
  return fotos;
}

function hoja() {
  const ANCHO = 1800;
  const M = 24;
  const piezas = [];   // { alto, pintar(ctx, y) }
  const titulo = texto => piezas.push({ alto: 34, pintar: (ctx, y) => rotulo(ctx, texto, M, y + 8, TINTA, 3) });

  titulo(`el lobo de kitsune zero · ${Object.keys(datos.cuadros).length} cuadros, ${Object.keys(datos.paleta).length} colores`);
  // La paleta.
  piezas.push({ alto: 40, pintar(ctx, y) {
    let x = M;
    for (const [letra, color] of Object.entries(datos.paleta)) {
      ctx.fillStyle = hex(color);
      ctx.fillRect(x, y + 4, 22, 22);
      rotulo(ctx, letra, x + 26, y + 10, TINTA);
      x += 52;
    }
  } });

  // Los cuadros, en celdas a 3× (o 4× los pequeños).
  titulo('cuadros');
  const celdas = Object.keys(datos.cuadros).map(nombre => {
    const img = imagenDeCuadro(nombre);
    const escala = Math.max(img.width, img.height) <= 24 ? 4 : 3;
    const w = Math.max(img.width * escala, anchoRotulo(nombre) + 4);
    return { nombre, img, escala, w, h: img.height * escala + 18 };
  });
  let fila = [];
  let usado = M;
  const filas = [];
  for (const c of celdas) {
    if (usado + c.w > ANCHO - M && fila.length) { filas.push(fila); fila = []; usado = M; }
    fila.push(c);
    usado += c.w + 14;
  }
  if (fila.length) filas.push(fila);
  for (const f of filas) {
    const alto = Math.max(...f.map(c => c.h)) + 12;
    piezas.push({ alto, pintar(ctx, y) {
      let x = M;
      for (const c of f) {
        const { img, escala } = c;
        damas(ctx, x, y, img.width * escala, img.height * escala, escala);
        ctx.drawImage(img, x, y, img.width * escala, img.height * escala);
        rotulo(ctx, c.nombre, x, y + img.height * escala + 5, TINTA);
        x += c.w + 14;
      }
    } });
  }

  // Las animaciones, en tiras: el cuerpo a 2× y el icono a 3×.
  for (const [tamaño, escala] of [['cuerpo', 2], ['icono', 3]]) {
    const anims = Object.keys(datos.animaciones?.[tamaño] ?? {});
    titulo(`animaciones · ${tamaño} (${anims.length})`);
    for (const nombre of anims) {
      const fotos = tira(tamaño, nombre);
      const [lw, lh] = ZONAS[tamaño].lienzo;
      const w = lw * escala;
      const h = lh * escala;
      const porFila = Math.max(1, Math.floor((ANCHO - M - 190) / (w + 6)));
      const vueltas = Math.ceil(fotos.length / porFila);
      const anim = datos.animaciones[tamaño][nombre];
      const total = anim.pasos.reduce((s, p) => s + p.ms, 0);
      piezas.push({ alto: vueltas * (h + 20) + 8, pintar(ctx, y) {
        rotulo(ctx, nombre, M, y + 4, TINTA, 2);
        rotulo(ctx, `${(total / 1000).toFixed(1)} s${anim.bucle ? ' bucle' : ''}`, M, y + 20, SUAVE, 2);
        fotos.forEach((f, n) => {
          const x = M + 190 + (n % porFila) * (w + 6);
          const yy = y + Math.floor(n / porFila) * (h + 20);
          damas(ctx, x, yy, w, h, escala);
          ctx.drawImage(f.img, x, yy, w, h);
          rotulo(ctx, `${f.ms}`, x, yy + h + 4, SUAVE, 2);
        });
      } });
    }
  }

  // El icono a su tamaño de verdad (1× y 2×), sobre cristal claro y oscuro.
  titulo('icono en el raíl: 1×, 2× y 4×, sobre cristal claro y oscuro');
  piezas.push({ alto: 120, pintar(ctx, y) {
    let x = M;
    const r = crearReproductor(datos, { tamaño: 'icono', lienzo });
    r.avanzar(0);
    for (const fondo of [CRISTAL_CLARO, CRISTAL_OSCURO]) {
      ctx.fillStyle = fondo;
      ctx.fillRect(x, y, 200, 110);
      let ix = x + 12;
      for (const e of [1, 2, 4]) {
        const c = lienzo(24 * e, 24 * e);
        r.pintar(c.getContext(), e);
        ctx.drawImage(c, ix, y + 55 - 12 * e, 24 * e, 24 * e);
        ix += 24 * e + 14;
      }
      x += 220;
    }
  } });

  const alto = piezas.reduce((s, p) => s + p.alto, 0) + 2 * M;
  const c = lienzo(ANCHO, alto);
  const ctx = c.getContext();
  ctx.fillStyle = FONDO;
  ctx.fillRect(0, 0, ANCHO, alto);
  let y = M;
  for (const p of piezas) { p.pintar(ctx, y); y += p.alto; }
  return png(ANCHO, alto, c.data);
}

/* ---------------------------------------------------------------- los GIF */

/** Una animación a 20 fps, ampliada, sobre un fondo; junta los fotogramas iguales. */
function fotogramasDe(tamaño, nombre, escala, fondos, ms) {
  const r = crearReproductor(datos, { tamaño, lienzo });
  r.reproducir(nombre, { reiniciar: true, luego: nombre });
  const anim = datos.animaciones[tamaño][nombre];
  const total = ms ?? anim.pasos.reduce((s, p) => s + p.ms, 0);
  const [lw, lh] = ZONAS[tamaño].lienzo;
  const w = lw * escala;
  const ancho = (w + 16) * fondos.length + 16;
  const alto = lh * escala + 32;
  const fotos = [];
  let anterior = null;
  for (let t = 0; t < total; t += 50) {
    r.avanzar(t);
    const c = lienzo(ancho, alto);
    const ctx = c.getContext();
    ctx.fillStyle = FONDO;
    ctx.fillRect(0, 0, ancho, alto);
    fondos.forEach((fondo, n) => {
      ctx.fillStyle = fondo;
      ctx.fillRect(16 + n * (w + 16), 16, w, lh * escala);
      const capa = lienzo(w, lh * escala);
      r.pintar(capa.getContext(), escala);
      ctx.drawImage(capa, 16 + n * (w + 16), 16, w, lh * escala);
    });
    const clave = Buffer.from(c.data.buffer).toString('base64');
    if (clave === anterior) fotos[fotos.length - 1].ms += 50;
    else fotos.push({ rgba: c.data, ms: 50 });
    anterior = clave;
  }
  return { ancho, alto, fotos };
}

function gifIcono() {
  // Todas las del icono, una detrás de otra, a 4× sobre cristal claro y oscuro.
  const partes = Object.keys(datos.animaciones.icono).map(nombre => {
    const anim = datos.animaciones.icono[nombre];
    const total = anim.pasos.reduce((s, p) => s + p.ms, 0);
    return fotogramasDe('icono', nombre, 4, [CRISTAL_CLARO, CRISTAL_OSCURO], Math.max(total, 1500));
  });
  return gif(partes[0].ancho, partes[0].alto, partes.flatMap(p => p.fotos));
}

/* ---------------------------------------------------------------- a trabajar */

const args = process.argv.slice(2);
const opcion = nombre => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (opcion('ver')) {
  // Unos cuadros muy grandes, con rejilla cada píxel y una línea más fuerte cada 8.
  const nombres = opcion('ver').split(',');
  const escala = Number(opcion('escala') ?? 10);
  const salida = opcion('salida') ?? join(AQUI, 'ver.png');
  const imgs = nombres.map(imagenDeCuadro);
  const ancho = imgs.reduce((s, i) => s + i.width * escala + 20, 20);
  const alto = Math.max(...imgs.map(i => i.height)) * escala + 50;
  const c = lienzo(ancho, alto);
  const ctx = c.getContext();
  ctx.fillStyle = FONDO;
  ctx.fillRect(0, 0, ancho, alto);
  let x = 20;
  imgs.forEach((img, n) => {
    damas(ctx, x, 20, img.width * escala, img.height * escala, escala);
    ctx.drawImage(img, x, 20, img.width * escala, img.height * escala);
    ctx.fillStyle = hex('#b8bdb8');
    for (let i = 0; i <= img.width; i++) ctx.fillRect(x + i * escala, 20, i % 8 === 0 ? 2 : 1, img.height * escala);
    for (let j = 0; j <= img.height; j++) ctx.fillRect(x, 20 + j * escala, img.width * escala, j % 8 === 0 ? 2 : 1);
    rotulo(ctx, nombres[n], x, img.height * escala + 28, TINTA);
    x += img.width * escala + 20;
  });
  writeFileSync(salida, png(ancho, alto, c.data));
  console.log(salida);
} else {
  writeFileSync(join(AQUI, 'hoja.png'), hoja());
  console.log(join(AQUI, 'hoja.png'));
  for (const nombre of ['quieto', 'pensar', 'hablar', 'feliz']) {
    if (!datos.animaciones.cuerpo[nombre]) continue;
    const { ancho, alto, fotos } = fotogramasDe('cuerpo', nombre, 4, [CRISTAL_CLARO]);
    writeFileSync(join(AQUI, `${nombre}.gif`), gif(ancho, alto, fotos));
    console.log(join(AQUI, `${nombre}.gif`));
  }
  if (Object.keys(datos.animaciones.icono ?? {}).length) {
    writeFileSync(join(AQUI, 'icono.gif'), gifIcono());
    console.log(join(AQUI, 'icono.gif'));
  }
}
