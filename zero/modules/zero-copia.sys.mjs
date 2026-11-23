/* Kitsune Zero · lo de Zero en la copia del anfitrión (la «Copia de Kitsune», un archivo cifrado con contraseña): las notas,
 * los subrayados, las páginas del estudio y las estadísticas con sus logros.
 *
 * Aquí solo se junta y se trae, ya en claro; cifrarlo es cosa de quien lo pide. Las notas con contraseña siguen cerradas con
 * la suya. Al traer, nada se pisa: de una nota se queda la tocada más tarde, los subrayados y las páginas se suman, y de
 * cada día de estadísticas se queda el que tenga más.
 * Los estudios van por perfil, y el id de un perfil cambia de un ordenador a otro: `espacios` ([{ id, name }]) los casa por
 * su nombre.
 */
import * as almacen from './zero-notas-almacen.sys.mjs';
import * as rotulador from './zero-rotulador.sys.mjs';
import * as estudio from './zero-estudio.sys.mjs';
import * as stats from './zero-stats.sys.mjs';

const intentar = async (que, si, no, faltan = null) => {
  try { return await si(); } catch (error) { console.error(`Kitsune Zero: copia (${que})`, error); faltan?.push(que); return no; }
};

export const ZeroCopia = {
  async juntar({ espacios = [] } = {}) {
    const nombre = id => espacios.find(e => e.id === id)?.name ?? '';
    const faltan = []; // lo que no se ha podido leer: quien guarda la copia lo dice
    const notas = await intentar('notas', () => almacen.todas(), [], faltan);
    if (!faltan.length && almacen.cuantasEstropeadas()) faltan.push('notas');
    return {
      version: 1,
      notas,
      subrayados: await intentar('subrayados', () => rotulador.todos(), {}, faltan),
      estudio: Object.entries(await intentar('estudio', () => estudio.todo(), {}, faltan)).map(([id, paginas]) => ({ espacio: nombre(id), paginas })),
      estadisticas: await intentar('estadisticas', () => stats.todo(), null, faltan),
      faltan,
    };
  },

  /** Devuelve cuánto ha entrado: { notas, subrayados, paginas, dias }. */
  async traer(copia, { espacios = [] } = {}) {
    const out = { notas: 0, subrayados: 0, paginas: 0, dias: 0 };
    if (!copia || typeof copia !== 'object' || copia.version !== 1) return out;
    out.notas = await intentar('notas', () => almacen.traerNotas(Array.isArray(copia.notas) ? copia.notas : []), 0);
    out.subrayados = await intentar('subrayados', () => rotulador.traer(copia.subrayados), 0);
    for (const uno of Array.isArray(copia.estudio) ? copia.estudio.slice(0, 50) : []) {
      const id = (espacios.find(e => e.name === uno?.espacio) ?? espacios[0])?.id;
      if (id) out.paginas += await intentar('estudio', () => estudio.traer(id, uno.paginas), 0);
    }
    if (copia.estadisticas) out.dias = await intentar('estadisticas', () => stats.traer(copia.estadisticas), 0);
    return out;
  },

  /** Se ha hecho una copia: no hay que recordarla en un tiempo. */
  hecha: () => almacen.copiaHecha(),
};
