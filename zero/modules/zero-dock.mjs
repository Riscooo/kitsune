/* Kitsune Zero · el efecto Dock del raíl (puro, sin Gecko: se prueba con Node).
 *
 * Con el ratón encima, cada icono crece según lo cerca que esté: 1 + gain · e^(−(d/spread)²), con d
 * la distancia vertical del puntero al centro del icono. El de debajo crece un 22 % y la caída es
 * gaussiana, así que los vecinos crecen menos y los lejanos nada (como el Dock de macOS).
 */
export function dockScales(centers, pointerY, { gain = 0.22, spread = 26 } = {}) {
  if (pointerY === null || pointerY === undefined) return centers.map(() => 1);
  return centers.map(center => {
    const d = (pointerY - center) / spread;
    return 1 + gain * Math.exp(-d * d);
  });
}
