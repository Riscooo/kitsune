/* Kitsune Zero · el lobo, la mascota del asistente, en pixel art (puro, sin Gecko: se prueba con Node).
 *
 * El lobo entero son datos (zero/assets/lobo.json): la paleta, los dibujos («cuadros»), los
 * efectos (corazones, zzz, chispas…) y las animaciones. El asistente puede crear las suyas con el mismo
 * formato sin que Kitsune se recompile: validar() le dice en español qué está mal, combinar() las suma
 * a las de serie (sin pisarlas) y crearReproductor() las pinta en un <canvas>.
 *
 * El formato (versión 1):
 *   paleta: { letra: '#rrggbb' }. Las letras son a-z, A-Z y 0-9; '.' es transparente y '_' (solo en
 *     los parches) deja el píxel que había debajo.
 *   cuadros: { nombre: dibujo }. Un dibujo es una lista de filas de texto (una letra por píxel) o un
 *     objeto con:
 *       filas: [...]                           sus píxeles;
 *       base: 'otro'                           o una copia de otro cuadro;
 *       ancho, alto                            o un dibujo vacío de ese tamaño;
 *       capas: [{ cuadro, dx, dy, voltear }]   otros cuadros encima, cada uno en su sitio (+ dx, dy);
 *       parches: [{ x, y, filas }]             y retoques de píxeles, encima de todo;
 *       x, y                                   su sitio: dónde va cuando es una capa o un paso.
 *   efectos: { nombre: { cuadros: [...], cada, ms, dx, dy, vaiven, periodo, desvanecer } }: sellos que
 *     se mueven solos dx, dy píxeles en ms milisegundos, cambian de cuadro cada `cada` ms, se mecen
 *     `vaiven` píxeles a los lados y, con desvanecer, se apagan al final.
 *   animaciones: { cuerpo: { nombre: animación }, icono: { nombre: animación } }, y una animación es
 *     { pasos: [{ cuadro, ms, dx, dy, voltear, estirar: [ancho, alto] }], bucle, luego, fijo,
 *       efectos: [{ efecto, en, x, y }], descripcion }.
 *
 * Las coordenadas son de la «zona» del lobo: 48×48 el cuerpo y 24×24 el icono, con (0, 0) arriba a la
 * izquierda. El lienzo del cuerpo deja margen (8 px a los lados, 14 arriba y 2 abajo) para los saltos y
 * los efectos; el del icono es la zona justa.
 */

export const FORMATO = 1;

export const ZONAS = Object.freeze({
  cuerpo: Object.freeze({ ancho: 48, alto: 48, lienzo: Object.freeze([64, 64]), origen: Object.freeze([8, 14]) }),
  icono: Object.freeze({ ancho: 24, alto: 24, lienzo: Object.freeze([24, 24]), origen: Object.freeze([0, 0]) }),
});

export const LIMITES = Object.freeze({
  lado: 64,              // un cuadro mide como mucho 64×64
  ladoIcono: 24,         // los del icono, 24×24
  ladoSello: 24,         // y los sellos de los efectos, 24×24
  colores: 40,
  cuadros: 400,
  pixeles: 1_000_000,    // la suma de todos los cuadros
  trabajo: 6_000_000,    // lo que cuesta componerlos (cada capa cuenta)
  capas: 24,
  parches: 64,
  profundidad: 8,        // cuadros hechos de cuadros hechos de cuadros…
  efectos: 64,
  sellos: 8,
  animaciones: 120,      // por tamaño
  pasos: 120,
  efectosPorAnimacion: 48,
  duracion: 20_000,      // una vuelta de animación, en ms
  pasoMin: 20,
  pasoMax: 10_000,
  vidaMin: 100,
  vidaMax: 6_000,
  desplazamiento: 16,    // dx, dy de un paso o de una capa
  recorrido: 48,         // dx, dy de un efecto
  nombre: 40,
  texto: 300,
  errores: 40,
});

const TAMAÑOS = ['cuerpo', 'icono'];
const NOMBRE = /^[a-z0-9ñ][a-z0-9ñ_-]*$/;
const LETRA = /^[a-zA-Z0-9]$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const TRANSPARENTE = '.';
const DEJAR = '_';
const PARTICULAS = 24;   // como mucho a la vez
const NIVELES = 4;       // la transparencia de un efecto que se apaga va a saltos, como en una consola

const esObjeto = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const tiene = (o, k) => o != null && Object.hasOwn(o, k);
const entero = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const numero = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/* ------------------------------------------------------------------------------------------------
 * Validar
 * ---------------------------------------------------------------------------------------------- */

class Lleno extends Error {}

/** Los errores, en español y con la ruta del dato («cuadros.parpadeo.filas[3]: …»). Hay un tope: con
 * datos muy rotos basta con los primeros para empezar a arreglar. */
function apuntador() {
  const lista = [];
  const fallo = (ruta, texto) => {
    if (lista.length >= LIMITES.errores) {
      lista.push(`Hay más errores; arregla estos ${LIMITES.errores} primero.`);
      throw new Lleno();
    }
    lista.push(ruta ? `${ruta}: ${texto}` : texto);
  };
  return { lista, fallo };
}

const citar = valor => {
  if (typeof valor === 'string') return `«${valor.length > 30 ? `${valor.slice(0, 30)}…` : valor}»`;
  if (Array.isArray(valor)) return 'una lista';
  if (valor === null) return 'null';
  return typeof valor === 'object' ? 'un objeto' : String(valor);
};

function nombreValido(fallo, ruta, nombre, que) {
  if (nombre.length > LIMITES.nombre) {
    fallo(ruta, `el nombre ${citar(nombre)} es demasiado largo (${LIMITES.nombre} letras como mucho)`);
    return false;
  }
  if (!NOMBRE.test(nombre)) {
    fallo(ruta, `${citar(nombre)} no vale como nombre de ${que}: usa minúsculas sin tildes, números, «-» o «_», sin espacios (por ejemplo «mi-${que}»)`);
    return false;
  }
  return true;
}

function soloCampos(fallo, ruta, objeto, campos) {
  for (const clave of Object.keys(objeto)) {
    if (!campos.includes(clave)) fallo(ruta, `el campo ${citar(clave)} no existe aquí (valen: ${campos.join(', ')})`);
  }
}

function texto(fallo, ruta, valor) {
  if (valor === undefined) return;
  if (typeof valor !== 'string') fallo(ruta, 'tiene que ser un texto');
  else if (valor.length > LIMITES.texto) fallo(ruta, `es demasiado largo (${LIMITES.texto} letras como mucho)`);
}

/** Las filas de un dibujo: listas de texto del mismo largo con letras de la paleta. Devuelve el tamaño. */
function revisarFilas(fallo, ruta, filas, letras, { dejar = false } = {}) {
  if (!Array.isArray(filas)) {
    fallo(ruta, `tiene que ser una lista de filas de texto, como ["..kk..", ".kwwk."], y es ${citar(filas)}`);
    return null;
  }
  if (filas.length === 0) {
    fallo(ruta, 'no tiene filas');
    return null;
  }
  if (filas.length > LIMITES.lado) {
    fallo(ruta, `tiene ${filas.length} filas y el máximo es ${LIMITES.lado}`);
    return null;
  }
  let ancho = null;
  let bien = true;
  for (let j = 0; j < filas.length; j++) {
    const fila = filas[j];
    if (typeof fila !== 'string') {
      fallo(`${ruta}[${j}]`, `cada fila es un texto, y esta es ${citar(fila)}`);
      bien = false;
      continue;
    }
    if (fila.length === 0 || fila.length > LIMITES.lado) {
      fallo(`${ruta}[${j}]`, `mide ${fila.length} píxeles; una fila mide de 1 a ${LIMITES.lado}`);
      bien = false;
      continue;
    }
    if (ancho === null) ancho = fila.length;
    else if (fila.length !== ancho) {
      fallo(`${ruta}[${j}]`, `mide ${fila.length} píxeles y la primera fila ${ancho}: todas las filas de un dibujo miden lo mismo`);
      bien = false;
      continue;
    }
    for (let i = 0; i < fila.length; i++) {
      const c = fila[i];
      if (c === TRANSPARENTE || letras.has(c) || (dejar && c === DEJAR)) continue;
      if (c === DEJAR) fallo(`${ruta}[${j}]`, `«_» (columna ${i}) solo vale en los parches; para un píxel transparente, «.»`);
      else fallo(`${ruta}[${j}]`, `la letra ${citar(c)} (columna ${i}) no está en la paleta`);
      bien = false;
      break;
    }
  }
  return bien && ancho !== null ? { ancho, alto: filas.length } : null;
}

const CAMPOS_CUADRO = ['filas', 'base', 'ancho', 'alto', 'capas', 'parches', 'x', 'y'];
const CAMPOS_CAPA = ['cuadro', 'dx', 'dy', 'voltear'];
const CAMPOS_PARCHE = ['x', 'y', 'filas'];
const CAMPOS_EFECTO = ['cuadros', 'cada', 'ms', 'dx', 'dy', 'vaiven', 'periodo', 'desvanecer', 'descripcion'];
const CAMPOS_ANIMACION = ['pasos', 'bucle', 'luego', 'fijo', 'efectos', 'descripcion'];
const CAMPOS_PASO = ['cuadro', 'ms', 'dx', 'dy', 'voltear', 'estirar'];
const CAMPOS_USO = ['efecto', 'en', 'x', 'y'];
// ejemploClaude: una animación de ejemplo (un añadido) para las instrucciones del asistente; aquí no se mira.
const CAMPOS_RAIZ = ['formato', 'nombre', 'descripcion', 'paleta', 'cuadros', 'efectos', 'animaciones', 'ejemploClaude'];

/** Lo que dice cada cuadro, ya revisado en su forma (sin mirar aún a quién nombra). */
function revisarCuadro(fallo, ruta, dibujo, letras) {
  if (Array.isArray(dibujo)) {
    const medida = revisarFilas(fallo, ruta, dibujo, letras);
    return { medida, base: null, capas: [], parches: [], x: 0, y: 0, roto: !medida };
  }
  if (!esObjeto(dibujo)) {
    fallo(ruta, `un cuadro es una lista de filas o un objeto con «filas», «base» o «capas», y este es ${citar(dibujo)}`);
    return null;
  }
  soloCampos(fallo, ruta, dibujo, CAMPOS_CUADRO);
  const info = { medida: null, base: null, capas: [], parches: [], x: 0, y: 0, roto: false };
  const fuentes = ['filas', 'base', 'ancho'].filter(k => tiene(dibujo, k));
  if (tiene(dibujo, 'alto') && !tiene(dibujo, 'ancho')) fuentes.push('alto');
  if (fuentes.length === 0) {
    fallo(ruta, 'le falta de dónde salir: «filas», «base» o «ancho» y «alto»');
    info.roto = true;
  } else if (fuentes.length > 1) {
    fallo(ruta, `usa solo una forma de empezar: ${fuentes.map(f => `«${f}»`).join(' o ')}`);
    info.roto = true;
  } else if (fuentes[0] === 'filas') {
    info.medida = revisarFilas(fallo, `${ruta}.filas`, dibujo.filas, letras);
    if (!info.medida) info.roto = true;
  } else if (fuentes[0] === 'base') {
    if (typeof dibujo.base !== 'string') {
      fallo(`${ruta}.base`, 'tiene que ser el nombre de otro cuadro');
      info.roto = true;
    } else info.base = dibujo.base;
  } else {
    const { ancho, alto } = dibujo;
    if (!entero(ancho, 1, LIMITES.lado) || !entero(alto, 1, LIMITES.lado)) {
      fallo(ruta, `«ancho» y «alto» van de 1 a ${LIMITES.lado} (y son ${citar(ancho)} y ${citar(alto)})`);
      info.roto = true;
    } else info.medida = { ancho, alto };
  }
  for (const eje of ['x', 'y']) {
    if (!tiene(dibujo, eje)) continue;
    if (entero(dibujo[eje], -LIMITES.lado, LIMITES.lado)) info[eje] = dibujo[eje];
    else fallo(`${ruta}.${eje}`, `es un número entero de ${-LIMITES.lado} a ${LIMITES.lado}`);
  }
  if (tiene(dibujo, 'capas')) {
    const capas = dibujo.capas;
    if (!Array.isArray(capas)) fallo(`${ruta}.capas`, 'tiene que ser una lista, como [{ "cuadro": "cabeza" }]');
    else if (capas.length > LIMITES.capas) fallo(`${ruta}.capas`, `tiene ${capas.length} capas y el máximo es ${LIMITES.capas}`);
    else {
      capas.forEach((capa, n) => {
        const r = `${ruta}.capas[${n}]`;
        if (!esObjeto(capa)) return fallo(r, 'cada capa es un objeto, como { "cuadro": "ojos-felices" }');
        soloCampos(fallo, r, capa, CAMPOS_CAPA);
        if (typeof capa.cuadro !== 'string') return fallo(r, 'le falta «cuadro»: el nombre del cuadro que se pone encima');
        for (const eje of ['dx', 'dy']) {
          if (tiene(capa, eje) && !entero(capa[eje], -LIMITES.lado, LIMITES.lado)) {
            fallo(`${r}.${eje}`, `es un número entero de ${-LIMITES.lado} a ${LIMITES.lado}`);
          }
        }
        if (tiene(capa, 'voltear') && typeof capa.voltear !== 'boolean') fallo(`${r}.voltear`, 'es true o false');
        info.capas.push({ cuadro: capa.cuadro, ruta: r });
      });
    }
  }
  if (tiene(dibujo, 'parches')) {
    const parches = dibujo.parches;
    if (!Array.isArray(parches)) fallo(`${ruta}.parches`, 'tiene que ser una lista, como [{ "x": 3, "y": 5, "filas": ["kk"] }]');
    else if (parches.length > LIMITES.parches) fallo(`${ruta}.parches`, `tiene ${parches.length} parches y el máximo es ${LIMITES.parches}`);
    else {
      parches.forEach((parche, n) => {
        const r = `${ruta}.parches[${n}]`;
        if (!esObjeto(parche)) return fallo(r, 'cada parche es un objeto con «x», «y» y «filas»');
        soloCampos(fallo, r, parche, CAMPOS_PARCHE);
        if (!entero(parche.x, 0, LIMITES.lado - 1) || !entero(parche.y, 0, LIMITES.lado - 1)) {
          return fallo(r, `«x» e «y» son enteros de 0 a ${LIMITES.lado - 1}: dónde empieza el parche dentro del cuadro`);
        }
        const medida = revisarFilas(fallo, `${r}.filas`, parche.filas, letras, { dejar: true });
        if (medida) info.parches.push({ x: parche.x, y: parche.y, ...medida, ruta: r });
      });
    }
  }
  return info;
}

/** El tamaño de cada cuadro, siguiendo «base» y «capas»: caza los bucles, lo que no existe y lo que
 * está hecho de cuadros hechos de cuadros… demasiadas veces. */
function medirTodos(fallo, propios, deBase) {
  const medidas = new Map();
  const estado = new Map();   // 1: midiendo, 2: hecho
  const hondo = new Map();    // cuántos cuadros hay uno dentro de otro, contándose a sí mismo
  const demasiado = new Set();
  const trabajo = { total: 0 };
  const medir = (nombre, camino) => {
    if (estado.get(nombre) === 2) return medidas.get(nombre);
    if (estado.get(nombre) === 1) {
      const vuelta = [...camino.slice(camino.indexOf(nombre)), nombre].join(' → ');
      fallo(`cuadros.${camino[0]}`, `se usa a sí mismo dando la vuelta (${vuelta}); un cuadro no puede estar hecho de sí mismo`);
      return null;
    }
    const info = propios.get(nombre) ?? deBase.get(nombre);
    estado.set(nombre, 1);
    let medida = info.roto ? null : info.medida;
    let nivel = 1;
    let heredado = false;
    const seguir = [...camino, nombre];
    const dentro = de => {
      nivel = Math.max(nivel, 1 + (hondo.get(de) ?? 0));
      if (demasiado.has(de)) heredado = true;
    };
    if (info.base !== null && !info.roto) {
      if (!propios.has(info.base) && !deBase.has(info.base)) fallo(`cuadros.${nombre}.base`, `el cuadro ${citar(info.base)} no existe`);
      else {
        medida = medir(info.base, seguir);
        dentro(info.base);
      }
    }
    for (const capa of info.capas) {
      if (!propios.has(capa.cuadro) && !deBase.has(capa.cuadro)) fallo(`${capa.ruta}.cuadro`, `el cuadro ${citar(capa.cuadro)} no existe`);
      else {
        const suya = medir(capa.cuadro, seguir);
        dentro(capa.cuadro);
        if (suya && medida) trabajo.total += suya.ancho * suya.alto;
      }
    }
    hondo.set(nombre, nivel);
    if (nivel > LIMITES.profundidad || heredado) {
      // Solo se avisa en el primero que se pasa; los que lo usan ya están rotos por él.
      if (!heredado) fallo(`cuadros.${nombre}`, `está hecho de cuadros hechos de cuadros… más de ${LIMITES.profundidad} veces; aplánalo`);
      demasiado.add(nombre);
      medida = null;
    }
    if (medida) {
      trabajo.total += medida.ancho * medida.alto;
      for (const p of info.parches) {
        if (p.x + p.ancho > medida.ancho || p.y + p.alto > medida.alto) {
          fallo(p.ruta, `se sale del cuadro: va de (${p.x}, ${p.y}) a (${p.x + p.ancho - 1}, ${p.y + p.alto - 1}) y el cuadro mide ${medida.ancho}×${medida.alto}`);
        }
      }
      medida = { ancho: medida.ancho, alto: medida.alto, x: info.x, y: info.y };
    }
    estado.set(nombre, 2);
    medidas.set(nombre, medida);
    return medida;
  };
  for (const nombre of propios.keys()) medir(nombre, []);
  return { medidas, trabajo: trabajo.total, medir };
}

/** Lo ya aceptado (las de serie y lo que se haya sumado), para validar lo nuevo contra ello. */
function conocido(base) {
  const paleta = new Map();
  const cuadros = new Map();
  const efectos = new Map();
  const animaciones = { cuerpo: new Map(), icono: new Map() };
  if (!esObjeto(base)) return { paleta, cuadros, efectos, animaciones };
  for (const [letra, color] of Object.entries(esObjeto(base.paleta) ? base.paleta : {})) paleta.set(letra, color);
  const letras = new Set(paleta.keys());
  const mudo = () => {};
  for (const [nombre, dibujo] of Object.entries(esObjeto(base.cuadros) ? base.cuadros : {})) {
    const info = revisarCuadro(mudo, '', dibujo, letras);
    if (info) cuadros.set(nombre, info);
  }
  for (const [nombre, efecto] of Object.entries(esObjeto(base.efectos) ? base.efectos : {})) efectos.set(nombre, efecto);
  for (const t of TAMAÑOS) {
    const grupo = esObjeto(base.animaciones) && esObjeto(base.animaciones[t]) ? base.animaciones[t] : {};
    for (const [nombre, anim] of Object.entries(grupo)) animaciones[t].set(nombre, anim);
  }
  return { paleta, cuadros, efectos, animaciones };
}

/**
 * Los errores de unos datos del lobo, en español (lista vacía si están bien). Con { base }, los datos
 * son un añadido: pueden usar los cuadros, efectos y animaciones de la base, pero no repetir sus nombres
 * ni cambiar sus colores.
 */
export function validar(datos, { base = null } = {}) {
  const { lista, fallo } = apuntador();
  try {
    revisarTodo(fallo, datos, conocido(base));
  } catch (error) {
    if (!(error instanceof Lleno)) throw error;
  }
  return lista;
}

function revisarTodo(fallo, datos, previo) {
  if (!esObjeto(datos)) {
    fallo('', `el lobo es un objeto JSON como { "paleta": {…}, "cuadros": {…}, "animaciones": {…} }, y esto es ${citar(datos)}`);
    return;
  }
  soloCampos(fallo, '', datos, CAMPOS_RAIZ);
  if (tiene(datos, 'formato') && datos.formato !== FORMATO) fallo('formato', `solo existe el formato ${FORMATO}`);
  texto(fallo, 'nombre', datos.nombre);
  texto(fallo, 'descripcion', datos.descripcion);

  // La paleta.
  const letras = new Set(previo.paleta.keys());
  if (tiene(datos, 'paleta')) {
    if (!esObjeto(datos.paleta)) fallo('paleta', 'tiene que ser un objeto letra → color, como { "k": "#252d2b" }');
    else {
      for (const [letra, color] of Object.entries(datos.paleta)) {
        const r = `paleta.${letra}`;
        if (letra === TRANSPARENTE || letra === DEJAR) { fallo(r, `«${letra}» ya está reservada (${letra === TRANSPARENTE ? 'transparente' : 'dejar el píxel de debajo'})`); continue; }
        if (!LETRA.test(letra)) { fallo(r, `${citar(letra)} no vale: cada color es una sola letra o número (a-z, A-Z, 0-9)`); continue; }
        if (typeof color !== 'string' || !COLOR.test(color)) { fallo(r, `el color es ${citar(color)} y tiene que ser «#rrggbb», como «#963d32»`); continue; }
        const antes = previo.paleta.get(letra);
        if (antes !== undefined && antes.toLowerCase() !== color.toLowerCase()) {
          fallo(r, `la letra «${letra}» ya es ${antes}; usa otra letra para ${color}`);
          continue;
        }
        letras.add(letra);
      }
      if (letras.size > LIMITES.colores) fallo('paleta', `hay ${letras.size} colores y el máximo es ${LIMITES.colores}`);
    }
  }

  // Los cuadros: primero su forma, luego a quién nombran y cuánto miden.
  const propios = new Map();
  if (tiene(datos, 'cuadros')) {
    if (!esObjeto(datos.cuadros)) fallo('cuadros', 'tiene que ser un objeto nombre → dibujo');
    else {
      const nombres = Object.keys(datos.cuadros);
      if (nombres.length + previo.cuadros.size > LIMITES.cuadros) {
        fallo('cuadros', `habría ${nombres.length + previo.cuadros.size} cuadros y el máximo es ${LIMITES.cuadros}`);
      } else {
        for (const nombre of nombres) {
          const r = `cuadros.${nombre}`;
          if (!nombreValido(fallo, r, nombre, 'cuadro')) continue;
          if (previo.cuadros.has(nombre)) { fallo(r, `ya hay un cuadro «${nombre}» de serie; ponle otro nombre`); continue; }
          const info = revisarCuadro(fallo, r, datos.cuadros[nombre], letras);
          if (info) propios.set(nombre, info);
        }
      }
    }
  }
  const { medidas, trabajo, medir } = medirTodos(fallo, propios, previo.cuadros);
  const medida = nombre => (medidas.has(nombre) ? medidas.get(nombre) : medir(nombre, []));
  const existe = nombre => typeof nombre === 'string' && (propios.has(nombre) || previo.cuadros.has(nombre));
  let pixeles = 0;
  for (const nombre of new Set([...previo.cuadros.keys(), ...propios.keys()])) {
    const m = medida(nombre);
    if (m) pixeles += m.ancho * m.alto;
  }
  if (pixeles > LIMITES.pixeles) fallo('cuadros', `entre todos suman ${pixeles} píxeles y el máximo es ${LIMITES.pixeles}`);
  if (trabajo > LIMITES.trabajo) fallo('cuadros', `componer las capas cuesta ${trabajo} píxeles y el máximo es ${LIMITES.trabajo}; usa menos capas`);

  // Los efectos.
  const efectos = new Set(previo.efectos.keys());
  if (tiene(datos, 'efectos')) {
    if (!esObjeto(datos.efectos)) fallo('efectos', 'tiene que ser un objeto nombre → efecto');
    else {
      const nombres = Object.keys(datos.efectos);
      if (nombres.length + previo.efectos.size > LIMITES.efectos) fallo('efectos', `habría ${nombres.length + previo.efectos.size} efectos y el máximo es ${LIMITES.efectos}`);
      else {
        for (const nombre of nombres) {
          const r = `efectos.${nombre}`;
          if (!nombreValido(fallo, r, nombre, 'efecto')) continue;
          if (previo.efectos.has(nombre)) { fallo(r, `ya hay un efecto «${nombre}» de serie; ponle otro nombre`); continue; }
          if (revisarEfecto(fallo, r, datos.efectos[nombre], existe, medida)) efectos.add(nombre);
        }
      }
    }
  }

  // Las animaciones de cada tamaño.
  if (!tiene(datos, 'animaciones')) return;
  if (!esObjeto(datos.animaciones)) {
    fallo('animaciones', 'tiene que ser un objeto: { "cuerpo": { nombre: animación }, "icono": { … } }');
    return;
  }
  soloCampos(fallo, 'animaciones', datos.animaciones, TAMAÑOS);
  for (const tamaño of TAMAÑOS) {
    if (!tiene(datos.animaciones, tamaño)) continue;
    const grupo = datos.animaciones[tamaño];
    const r0 = `animaciones.${tamaño}`;
    if (!esObjeto(grupo)) { fallo(r0, 'tiene que ser un objeto nombre → animación'); continue; }
    const nombres = Object.keys(grupo);
    const antes = previo.animaciones[tamaño];
    if (nombres.length + antes.size > LIMITES.animaciones) {
      fallo(r0, `habría ${nombres.length + antes.size} animaciones y el máximo es ${LIMITES.animaciones}`);
      continue;
    }
    const todas = new Set([...antes.keys(), ...nombres]);
    for (const nombre of nombres) {
      const r = `${r0}.${nombre}`;
      if (!nombreValido(fallo, r, nombre, 'animación')) continue;
      if (antes.has(nombre)) { fallo(r, `ya hay una animación «${nombre}» de serie; ponle otro nombre (por ejemplo «claude-${nombre}»)`); continue; }
      revisarAnimacion(fallo, r, grupo[nombre], { tamaño, existe, medida, efectos, todas });
    }
  }
}

function revisarEfecto(fallo, ruta, efecto, existe, medida) {
  if (!esObjeto(efecto)) {
    fallo(ruta, 'un efecto es un objeto como { "cuadros": ["corazon"], "ms": 1200, "dy": -10, "desvanecer": true }');
    return false;
  }
  soloCampos(fallo, ruta, efecto, CAMPOS_EFECTO);
  let bien = true;
  const mal = (campo, que) => { fallo(`${ruta}.${campo}`, que); bien = false; };
  if (!Array.isArray(efecto.cuadros) || efecto.cuadros.length === 0 || efecto.cuadros.length > LIMITES.sellos) {
    mal('cuadros', `es una lista de 1 a ${LIMITES.sellos} cuadros (los sellos del efecto, que se van turnando)`);
  } else {
    efecto.cuadros.forEach((nombre, n) => {
      if (!existe(nombre)) return mal(`cuadros[${n}]`, `el cuadro ${citar(nombre)} no existe`);
      const m = medida(nombre);
      if (m && (m.ancho > LIMITES.ladoSello || m.alto > LIMITES.ladoSello)) {
        mal(`cuadros[${n}]`, `«${nombre}» mide ${m.ancho}×${m.alto} y un sello mide como mucho ${LIMITES.ladoSello}×${LIMITES.ladoSello}`);
      }
    });
  }
  if (tiene(efecto, 'ms') && !entero(efecto.ms, LIMITES.vidaMin, LIMITES.vidaMax)) mal('ms', `cuánto vive, en ms: de ${LIMITES.vidaMin} a ${LIMITES.vidaMax}`);
  if (tiene(efecto, 'cada') && !entero(efecto.cada, LIMITES.pasoMin, LIMITES.vidaMax)) mal('cada', `cada cuántos ms cambia de sello: de ${LIMITES.pasoMin} a ${LIMITES.vidaMax}`);
  for (const eje of ['dx', 'dy']) {
    if (tiene(efecto, eje) && !entero(efecto[eje], -LIMITES.recorrido, LIMITES.recorrido)) mal(eje, `cuántos píxeles recorre en toda su vida: de ${-LIMITES.recorrido} a ${LIMITES.recorrido}`);
  }
  if (tiene(efecto, 'vaiven') && !entero(efecto.vaiven, 0, 8)) mal('vaiven', 'cuántos píxeles se mece a cada lado: de 0 a 8');
  if (tiene(efecto, 'periodo') && !entero(efecto.periodo, 100, LIMITES.vidaMax)) mal('periodo', `cuántos ms dura un vaivén: de 100 a ${LIMITES.vidaMax}`);
  if (tiene(efecto, 'desvanecer') && typeof efecto.desvanecer !== 'boolean') mal('desvanecer', 'es true o false');
  texto(fallo, `${ruta}.descripcion`, efecto.descripcion);
  return bien;
}

function revisarAnimacion(fallo, ruta, anim, { tamaño, existe, medida, efectos, todas }) {
  if (!esObjeto(anim)) {
    fallo(ruta, 'una animación es un objeto como { "pasos": [{ "cuadro": "quieto", "ms": 500 }], "bucle": true }');
    return;
  }
  soloCampos(fallo, ruta, anim, CAMPOS_ANIMACION);
  const lado = tamaño === 'icono' ? LIMITES.ladoIcono : LIMITES.lado;
  const cabe = (r, nombre) => {
    if (!existe(nombre)) return fallo(r, `el cuadro ${citar(nombre)} no existe`);
    const m = medida(nombre);
    if (m && (m.ancho > lado || m.alto > lado)) fallo(r, `«${nombre}» mide ${m.ancho}×${m.alto} y en el ${tamaño} caben ${lado}×${lado}`);
  };
  let total = 0;
  const pasos = anim.pasos;
  if (!Array.isArray(pasos) || pasos.length === 0) fallo(`${ruta}.pasos`, 'hace falta una lista de pasos, como [{ "cuadro": "quieto", "ms": 400 }]');
  else if (pasos.length > LIMITES.pasos) fallo(`${ruta}.pasos`, `tiene ${pasos.length} pasos y el máximo es ${LIMITES.pasos}`);
  else {
    pasos.forEach((paso, n) => {
      const r = `${ruta}.pasos[${n}]`;
      if (!esObjeto(paso)) return fallo(r, 'cada paso es un objeto como { "cuadro": "feliz", "ms": 200 }');
      soloCampos(fallo, r, paso, CAMPOS_PASO);
      if (typeof paso.cuadro !== 'string') fallo(r, 'le falta «cuadro»: el nombre del cuadro que se ve');
      else cabe(`${r}.cuadro`, paso.cuadro);
      if (!entero(paso.ms, LIMITES.pasoMin, LIMITES.pasoMax)) fallo(`${r}.ms`, `cuánto dura, en ms: un entero de ${LIMITES.pasoMin} a ${LIMITES.pasoMax} (y es ${citar(paso.ms)})`);
      else total += paso.ms;
      for (const eje of ['dx', 'dy']) {
        if (tiene(paso, eje) && !entero(paso[eje], -LIMITES.desplazamiento, LIMITES.desplazamiento)) {
          fallo(`${r}.${eje}`, `es un entero de ${-LIMITES.desplazamiento} a ${LIMITES.desplazamiento} (píxeles; dy negativo es hacia arriba)`);
        }
      }
      if (tiene(paso, 'voltear') && typeof paso.voltear !== 'boolean') fallo(`${r}.voltear`, 'es true o false');
      if (tiene(paso, 'estirar')) {
        const e = paso.estirar;
        if (!Array.isArray(e) || e.length !== 2 || !numero(e[0], 0.5, 1.5) || !numero(e[1], 0.5, 1.5)) {
          fallo(`${r}.estirar`, 'es [ancho, alto], dos números de 0.5 a 1.5: [1.2, 0.8] aplasta y [0.9, 1.1] estira');
        }
      }
    });
    if (total > LIMITES.duracion) fallo(`${ruta}.pasos`, `duran ${total} ms en total y el máximo es ${LIMITES.duracion} (${LIMITES.duracion / 1000} s)`);
  }
  if (tiene(anim, 'bucle') && typeof anim.bucle !== 'boolean') fallo(`${ruta}.bucle`, 'es true o false');
  if (tiene(anim, 'luego') && (typeof anim.luego !== 'string' || !todas.has(anim.luego))) {
    fallo(`${ruta}.luego`, `la animación ${citar(anim.luego)} no existe en el ${tamaño}`);
  }
  if (tiene(anim, 'fijo')) {
    if (typeof anim.fijo !== 'string') fallo(`${ruta}.fijo`, 'es el nombre del cuadro que se ve con «reducir movimiento»');
    else cabe(`${ruta}.fijo`, anim.fijo);
  }
  texto(fallo, `${ruta}.descripcion`, anim.descripcion);
  if (!tiene(anim, 'efectos')) return;
  const usos = anim.efectos;
  if (!Array.isArray(usos)) return fallo(`${ruta}.efectos`, 'es una lista, como [{ "efecto": "corazon", "en": 0, "x": 30, "y": 2 }]');
  if (usos.length > LIMITES.efectosPorAnimacion) return fallo(`${ruta}.efectos`, `tiene ${usos.length} y el máximo es ${LIMITES.efectosPorAnimacion}`);
  const zona = ZONAS[tamaño];
  usos.forEach((uso, n) => {
    const r = `${ruta}.efectos[${n}]`;
    if (!esObjeto(uso)) return fallo(r, 'cada efecto es un objeto como { "efecto": "corazon", "en": 0, "x": 30, "y": 2 }');
    soloCampos(fallo, r, uso, CAMPOS_USO);
    if (typeof uso.efecto !== 'string' || !efectos.has(uso.efecto)) fallo(`${r}.efecto`, `el efecto ${citar(uso.efecto)} no existe`);
    if (!entero(uso.en ?? 0, 0, Math.max(0, total - 1))) fallo(`${r}.en`, `cuándo sale, en ms desde que empieza la animación: de 0 a ${Math.max(0, total - 1)}`);
    const [mx, my] = zona.origen;
    if (!entero(uso.x, -mx - 8, zona.ancho + 8)) fallo(`${r}.x`, `es un entero de ${-mx - 8} a ${zona.ancho + 8} (la zona del ${tamaño} mide ${zona.ancho} de ancho)`);
    if (!entero(uso.y, -my - 8, zona.alto + 8)) fallo(`${r}.y`, `es un entero de ${-my - 8} a ${zona.alto + 8} (negativo, por encima de la zona)`);
  });
}

/* ------------------------------------------------------------------------------------------------
 * Combinar
 * ---------------------------------------------------------------------------------------------- */

/**
 * Las de serie con los añadidos (las animaciones del asistente), en ese orden. Cada añadido se valida
 * contra lo que ya hay y, si tiene algún error, se queda fuera entero: lo de serie no se pisa nunca.
 * Para saber por qué no entró uno, validar(añadido, { base }).
 */
export function combinar(base, ...extra) {
  const datos = {
    formato: FORMATO,
    paleta: { ...base?.paleta },
    cuadros: { ...base?.cuadros },
    efectos: { ...base?.efectos },
    animaciones: { cuerpo: { ...base?.animaciones?.cuerpo }, icono: { ...base?.animaciones?.icono } },
  };
  for (const añadido of extra) {
    if (añadido == null || validar(añadido, { base: datos }).length) continue;
    Object.assign(datos.paleta, añadido.paleta);
    Object.assign(datos.cuadros, añadido.cuadros);
    Object.assign(datos.efectos, añadido.efectos);
    for (const t of TAMAÑOS) Object.assign(datos.animaciones[t], añadido.animaciones?.[t]);
  }
  return datos;
}

/** Lo que hay, para contárselo al asistente: los cuadros con su tamaño y sitio, los efectos y las
 * animaciones de cada tamaño con su descripción y su duración. */
export function catalogo(datos) {
  const cuadros = resolver(datos);
  const duracion = anim => anim.pasos.reduce((suma, paso) => suma + paso.ms, 0);
  return {
    paleta: { ...datos.paleta },
    cuadros: [...cuadros].map(([nombre, c]) => ({ nombre, ancho: c.ancho, alto: c.alto, x: c.x, y: c.y })),
    efectos: Object.entries(datos.efectos ?? {}).map(([nombre, e]) => ({ nombre, descripcion: e.descripcion ?? '' })),
    animaciones: Object.fromEntries(TAMAÑOS.map(t => [t, Object.entries(datos.animaciones?.[t] ?? {}).map(([nombre, a]) => ({
      nombre, descripcion: a.descripcion ?? '', ms: duracion(a), bucle: a.bucle === true,
    }))])),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Píxeles
 * ---------------------------------------------------------------------------------------------- */

/** La paleta como colores RGB; el índice 0 es transparente y el resto, una letra cada uno. */
function colores(datos) {
  const indice = new Map();
  const rgb = [[0, 0, 0]];
  for (const [letra, color] of Object.entries(datos.paleta ?? {})) {
    indice.set(letra, rgb.length);
    rgb.push([1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)));
  }
  return { indice, rgb };
}

function deFilas(filas, indice) {
  const alto = filas.length;
  const ancho = filas[0].length;
  const px = new Uint8Array(ancho * alto);
  for (let j = 0; j < alto; j++) {
    for (let i = 0; i < ancho; i++) px[j * ancho + i] = indice.get(filas[j][i]) ?? 0;
  }
  return { ancho, alto, px };
}

function encima(destino, capa, ox, oy, voltear) {
  for (let j = 0; j < capa.alto; j++) {
    const y = oy + j;
    if (y < 0 || y >= destino.alto) continue;
    for (let i = 0; i < capa.ancho; i++) {
      const x = ox + i;
      if (x < 0 || x >= destino.ancho) continue;
      const v = capa.px[j * capa.ancho + (voltear ? capa.ancho - 1 - i : i)];
      if (v) destino.px[y * destino.ancho + x] = v;
    }
  }
}

/** Todos los cuadros ya compuestos (píxeles como índices de la paleta). Los datos tienen que ser válidos. */
function resolver(datos) {
  const { indice } = colores(datos);
  const fuente = datos.cuadros ?? {};
  const hechos = new Map();
  const hacer = nombre => {
    if (hechos.has(nombre)) return hechos.get(nombre);
    const dibujo = fuente[nombre];
    let c;
    if (Array.isArray(dibujo)) c = { ...deFilas(dibujo, indice), x: 0, y: 0 };
    else {
      if (dibujo.filas) c = deFilas(dibujo.filas, indice);
      else if (dibujo.base) {
        const b = hacer(dibujo.base);
        c = { ancho: b.ancho, alto: b.alto, px: b.px.slice() };
      } else c = { ancho: dibujo.ancho, alto: dibujo.alto, px: new Uint8Array(dibujo.ancho * dibujo.alto) };
      for (const capa of dibujo.capas ?? []) {
        const de = hacer(capa.cuadro);
        encima(c, de, de.x + (capa.dx ?? 0), de.y + (capa.dy ?? 0), capa.voltear === true);
      }
      for (const parche of dibujo.parches ?? []) {
        parche.filas.forEach((fila, j) => {
          for (let i = 0; i < fila.length; i++) {
            if (fila[i] === DEJAR) continue;
            c.px[(parche.y + j) * c.ancho + parche.x + i] = fila[i] === TRANSPARENTE ? 0 : indice.get(fila[i]);
          }
        });
      }
      c.x = dibujo.x ?? 0;
      c.y = dibujo.y ?? 0;
    }
    hechos.set(nombre, c);
    return c;
  };
  for (const nombre of Object.keys(fuente)) hacer(nombre);
  return hechos;
}

/** Un cuadro en RGBA (para herramientas y vistas previas): { ancho, alto, x, y, rgba }. */
export function rasterizar(datos, nombre) {
  const errores = validar(datos);
  if (errores.length) throw new Error(`El lobo no es válido:\n${errores.join('\n')}`);
  const c = resolver(datos).get(nombre);
  if (!c) throw new Error(`No hay ningún cuadro «${nombre}»`);
  return { ancho: c.ancho, alto: c.alto, x: c.x, y: c.y, rgba: rgba(c, colores(datos).rgb) };
}

function rgba(c, rgb) {
  const out = new Uint8ClampedArray(c.ancho * c.alto * 4);
  for (let n = 0; n < c.px.length; n++) {
    const v = c.px[n];
    if (!v) continue;
    out.set(rgb[v], n * 4);
    out[n * 4 + 3] = 255;
  }
  return out;
}

/** El cuadro volteado o estirado (vecino más cercano, sin suavizar), con el pie en el mismo sitio. */
function variar(c, voltear, sx, sy) {
  const ancho = Math.max(1, Math.round(c.ancho * sx));
  const alto = Math.max(1, Math.round(c.alto * sy));
  const px = new Uint8Array(ancho * alto);
  for (let j = 0; j < alto; j++) {
    const fj = Math.min(c.alto - 1, Math.floor(j * c.alto / alto));
    for (let i = 0; i < ancho; i++) {
      const fi = Math.min(c.ancho - 1, Math.floor(i * c.ancho / ancho));
      px[j * ancho + i] = c.px[fj * c.ancho + (voltear ? c.ancho - 1 - fi : fi)];
    }
  }
  return { ancho, alto, px, x: c.x + Math.round((c.ancho - ancho) / 2), y: c.y + c.alto - alto };
}

/* ------------------------------------------------------------------------------------------------
 * Reproductor
 * ---------------------------------------------------------------------------------------------- */

function lienzoPorDefecto(ancho, alto, ctx) {
  const doc = ctx?.canvas?.ownerDocument;
  if (doc?.createElementNS) {
    const c = doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
    c.width = ancho;
    c.height = alto;
    return c;
  }
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(ancho, alto);
  throw new Error('zero-lobo: no hay dónde preparar los cuadros; pasa { lienzo: (ancho, alto) => canvas }');
}

/**
 * Un reproductor para un tamaño del lobo. Precalcula los cuadros que usan sus animaciones (volteados y
 * estirados incluidos) y, al pintar por primera vez cada uno, lo guarda en un canvas pequeño: cada
 * fotograma es un clearRect y un drawImage por cuadro y por efecto. avanzar() dice si hace falta
 * repintar y proximoCambio() cuándo volverá a hacer falta, así que el lienzo puede dormirse.
 *
 * Opciones: tamaño ('cuerpo' | 'icono'), quieto (reducir movimiento: solo el cuadro fijo de cada
 * animación, sin saltos ni efectos) y lienzo ((ancho, alto, ctx) => canvas, para los cuadros guardados).
 */
export function crearReproductor(datos, { tamaño = 'cuerpo', quieto = false, lienzo = lienzoPorDefecto } = {}) {
  if (!ZONAS[tamaño]) throw new Error(`zero-lobo: el tamaño es «cuerpo» o «icono», no ${citar(tamaño)}`);
  const errores = validar(datos);
  if (errores.length) throw new Error(`zero-lobo: el lobo no es válido:\n${errores.join('\n')}`);
  const zona = ZONAS[tamaño];
  const [ancho, alto] = zona.lienzo;
  const [ox, oy] = zona.origen;
  const { rgb } = colores(datos);
  const cuadros = resolver(datos);

  // Las variantes de cuadro que hacen falta (cuadro + volteo + estirado), una vez cada una.
  const variantes = new Map();
  const variante = (nombre, voltear = false, estirar = null) => {
    const [sx, sy] = estirar ?? [1, 1];
    const clave = `${nombre}|${voltear ? 1 : 0}|${sx}|${sy}`;
    if (!variantes.has(clave)) {
      const c = cuadros.get(nombre);
      variantes.set(clave, voltear || sx !== 1 || sy !== 1 ? variar(c, voltear, sx, sy) : c);
    }
    return variantes.get(clave);
  };

  const efectos = new Map(Object.entries(datos.efectos ?? {}).map(([nombre, e]) => [nombre, {
    sellos: e.cuadros.map(c => variante(c)),
    ms: e.ms ?? 1200, cada: e.cada ?? 150, dx: e.dx ?? 0, dy: e.dy ?? 0,
    vaiven: e.vaiven ?? 0, periodo: e.periodo ?? 1000, desvanecer: e.desvanecer === true,
  }]));

  const animaciones = new Map(Object.entries(datos.animaciones?.[tamaño] ?? {}).map(([nombre, a]) => {
    let t = 0;
    const pasos = a.pasos.map(p => {
      const paso = { desde: t, hasta: t + p.ms, c: variante(p.cuadro, p.voltear === true, p.estirar), dx: p.dx ?? 0, dy: p.dy ?? 0 };
      t += p.ms;
      return paso;
    });
    const usos = (a.efectos ?? []).map(u => ({ efecto: u.efecto, en: u.en ?? 0, x: u.x, y: u.y })).sort((u, v) => u.en - v.en);
    const fijo = { desde: 0, hasta: t, c: variante(a.fijo ?? a.pasos[0].cuadro), dx: 0, dy: 0 };
    return [nombre, { nombre, pasos, total: t, bucle: a.bucle === true, luego: a.luego ?? 'quieto', usos, fijo }];
  }));

  const bitmaps = new Map();
  const bitmap = (c, ctx) => {
    let b = bitmaps.get(c);
    if (!b) {
      b = lienzo(c.ancho, c.alto, ctx);
      const g = b.getContext('2d');
      const img = g.createImageData(c.ancho, c.alto);
      img.data.set(rgba(c, rgb));
      g.putImageData(img, 0, 0);
      bitmaps.set(c, b);
    }
    return b;
  };

  let reducido = quieto === true;
  let anim = animaciones.get('quieto') ?? animaciones.values().next().value ?? null;
  let bucle = anim?.bucle ?? false;
  let luego = anim?.luego ?? null;
  let inicio = null;      // cuándo empezó la animación (lo pone el primer avanzar)
  let visto = 0;          // hasta qué ms de la animación se han lanzado ya sus efectos
  let acabada = false;
  let paso = anim ? anim.pasos[0] : null;
  let particulas = [];
  let ahoraUltimo = 0;
  let clave = '';
  let sucio = true;

  const empezar = (siguiente, cuando, opciones = {}) => {
    anim = siguiente;
    bucle = opciones.bucle ?? anim.bucle;
    luego = opciones.luego ?? anim.luego;
    inicio = cuando;
    visto = 0;
    acabada = false;
    paso = anim.pasos[0];
  };

  const lanzar = (desde, hasta, base) => {
    // Los efectos de la vuelta que empieza en `base`, con «en» dentro de [desde, hasta).
    for (const uso of anim.usos) {
      if (uso.en < desde) continue;
      if (uso.en >= hasta) break;
      const efecto = efectos.get(uso.efecto);
      if (!efecto) continue;
      particulas.push({ efecto, x: uso.x, y: uso.y, nacio: base + uso.en });
      if (particulas.length > PARTICULAS) particulas.shift();
    }
  };

  const pasoEn = t => {
    for (const p of anim.pasos) if (t < p.hasta) return p;
    return anim.pasos[anim.pasos.length - 1];
  };

  const estadoParticula = (p, ahora) => {
    const e = p.efecto;
    const edad = ahora - p.nacio;
    const f = edad / e.ms;
    const x = Math.round(p.x + e.dx * f + (e.vaiven ? e.vaiven * Math.sin((2 * Math.PI * edad) / e.periodo) : 0));
    const y = Math.round(p.y + e.dy * f);
    const sello = e.sellos[Math.floor(edad / e.cada) % e.sellos.length];
    const nivel = e.desvanecer && f > 0.6 ? Math.max(1, Math.ceil(((1 - f) / 0.4) * NIVELES)) : NIVELES;
    return { x, y, sello, alfa: nivel / NIVELES };
  };

  const reproductor = {
    /** El nombre de la animación que suena. */
    get actual() { return anim?.nombre ?? null; },
    /** El tamaño del lienzo, en píxeles del lobo (el canvas mide esto por la escala). */
    ancho,
    alto,
    tamaño,
    /** Reducir movimiento: con true, solo el cuadro fijo de cada animación, sin saltos ni efectos. */
    get quieto() { return reducido; },
    set quieto(valor) {
      reducido = valor === true;
      if (reducido) particulas = [];
      clave = '';
      sucio = true;
    },
    animaciones: () => [...animaciones.keys()],

    /**
     * Pone una animación. bucle cambia el de la animación y luego dice a cuál volver al acabar (por
     * defecto, la suya o «quieto»). Si ya suena, sigue por donde iba, salvo con reiniciar. Devuelve si
     * existe.
     */
    reproducir(nombre, { bucle: b, luego: l, reiniciar = false } = {}) {
      const siguiente = animaciones.get(nombre);
      if (!siguiente) return false;
      if (siguiente === anim && !acabada && !reiniciar && inicio !== null) {
        if (bucle && b === false) {
          // Deja de repetirse: acaba la vuelta que va dando.
          const vuelta = Math.floor((ahoraUltimo - inicio) / anim.total) * anim.total;
          inicio += vuelta;
          visto = Math.max(0, visto - vuelta);
        }
        if (b !== undefined) bucle = b;
        if (l !== undefined) luego = l;
        return true;
      }
      empezar(siguiente, null, { bucle: b, luego: l });
      clave = '';
      sucio = true;
      return true;
    },

    /** Lleva el reloj a `ahora` (ms) y dice si hay que repintar. */
    avanzar(ahora) {
      if (!anim) return false;
      if (inicio === null || ahora < inicio) { inicio = ahora; visto = 0; }
      ahoraUltimo = ahora;
      // Las animaciones que acaban dan paso a la siguiente (si el reloj salta horas, se empieza ahora).
      let vueltas = 0;
      while (!bucle && !acabada && ahora - inicio >= anim.total) {
        if (!reducido) lanzar(visto, anim.total, inicio);
        const siguiente = animaciones.get(luego);
        if (!siguiente) { acabada = true; break; }
        empezar(siguiente, ++vueltas > 16 ? ahora : inicio + anim.total);
      }
      const t = ahora - inicio;
      if (reducido) {
        paso = anim.fijo;
      } else if (acabada) {
        paso = anim.pasos[anim.pasos.length - 1];
      } else {
        // Los efectos que tocan desde la última vez (de la última vuelta como mucho, si ha pasado mucho).
        if (bucle) {
          let desde = Math.max(visto, t - anim.total);
          while (desde < t) {
            const vuelta = Math.floor(desde / anim.total);
            const base = vuelta * anim.total;
            const hasta = Math.min(t, base + anim.total);
            lanzar(desde - base, hasta - base, inicio + base);
            desde = hasta;
          }
        } else lanzar(visto, t, inicio);
        visto = t;
        paso = pasoEn(bucle ? t % anim.total : t);
      }
      particulas = particulas.filter(p => ahora - p.nacio < p.efecto.ms && ahora >= p.nacio);
      let nueva = `${anim.nombre}:${anim.pasos.indexOf(paso)}:${reducido ? 'q' : ''}`;
      for (const p of particulas) {
        const s = estadoParticula(p, ahora);
        nueva += `|${s.x},${s.y},${s.alfa},${p.efecto.sellos.indexOf(s.sello)}`;
      }
      if (nueva !== clave) {
        clave = nueva;
        sucio = true;
      }
      return sucio;
    },

    /** Cuándo (ms) cambiará lo que se ve si nadie toca nada; Infinity si nunca (el lienzo puede dormir). */
    proximoCambio() {
      if (!anim) return Infinity;
      if (particulas.length) return ahoraUltimo + 1000 / 60;
      if (inicio === null) return ahoraUltimo;
      if (acabada) return Infinity;
      if (reducido) return bucle ? Infinity : inicio + anim.total;
      // El siguiente cambio de paso o el siguiente efecto que sale, lo que llegue antes.
      const t = ahoraUltimo - inicio;
      const vuelta = bucle ? Math.floor(t / anim.total) * anim.total : 0;
      const dentro = t - vuelta;
      let cuando = Infinity;
      if (!bucle || anim.pasos.length > 1) cuando = pasoEn(dentro).hasta;
      const efecto = anim.usos.find(u => u.en >= dentro);
      if (efecto) cuando = Math.min(cuando, efecto.en);
      else if (bucle && anim.usos.length) cuando = Math.min(cuando, anim.total + anim.usos[0].en);
      return inicio + vuelta + cuando;
    },

    /** Pinta el cuadro y los efectos en un CanvasRenderingContext2D, a escala entera. */
    pintar(ctx, escala = 1) {
      const e = Math.max(1, Math.floor(escala));
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, ancho * e, alto * e);
      sucio = false;
      if (!paso) return;
      const c = paso.c;
      ctx.drawImage(bitmap(c, ctx), (ox + c.x + paso.dx) * e, (oy + c.y + paso.dy) * e, c.ancho * e, c.alto * e);
      if (reducido || particulas.length === 0) return;
      for (const p of particulas) {
        const s = estadoParticula(p, ahoraUltimo);
        ctx.globalAlpha = s.alfa;
        ctx.drawImage(bitmap(s.sello, ctx), (ox + s.x + s.sello.x) * e, (oy + s.y + s.sello.y) * e, s.sello.ancho * e, s.sello.alto * e);
      }
      ctx.globalAlpha = 1;
    },
  };
  return reproductor;
}
