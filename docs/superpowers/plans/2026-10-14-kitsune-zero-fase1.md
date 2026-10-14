# Kitsune Zero · fase 1 (el marco) — plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: superpowers:executing-plans (Risco pidió ponerse
> directamente: lo ejecuta esta sesión). Los pasos usan casillas (`- [ ]`).

**Objetivo:** Ctrl+Alt+0 convierte una ventana de Kitsune en Zero y la devuelve: ventana de cristal
(desenfoque del compositor o fondo del color de la web), web en tarjeta con ampliar, isla, raíl con
efecto Dock, botones de ventana, cristal en vivo con texto adaptable, marca de agua y ajustes.

**Arquitectura:** Zero vive en `zero/` y no importa nada de Kitsune. Recibe un `host` (textos,
ajustes, atajo, paleta) desde `install/native/kitsune-zero-host.sys.mjs`. La receta del motor
copia `zero/` a `chrome://browser/content/zero/`. Cada ventana se marca con el atributo `zero`;
el CSS de Zero (cargado por el propio módulo) hace casi todo, y los módulos ponen sus piezas y
las quitan al apagar.

**Tecnología:** módulos de chrome de Gecko 158 (`.sys.mjs`), CSS de chrome, `drawSnapshot` para el
cristal en vivo, pruebas de Node (`node --test`) y pruebas con el motor real (WebDriver/Marionette,
`tests/browser_smoke.py`).

**Spec:** `docs/superpowers/specs/2026-10-14-kitsune-zero-design.md`

## Restricciones globales

- Ajustes con el prefijo `kitsune.zero.`, definidos solo en `zero/modules/zero-config.sys.mjs`.
- Atajo `Ctrl+Alt+0` (id `kitsune-zero-key`), por ventana.
- Medidas: tarjeta a 50/46/12/12 px (izquierda/arriba/derecha/abajo), radio 18 px, 10 px entre
  tarjetas; isla 176 → 400 → 560 px de ancho y siempre 32 px de alto, a 7 px del borde; raíl de
  36 px que se abre a 186 px; Dock `--s = 1 + 0,22·exp(−(d/26)²)`.
- Curvas: `--calm: cubic-bezier(.32,.72,0,1)` y `--soft: cubic-bezier(.4,0,.2,1)`; tiempos 620
  (forma) / 280 (contenido, +140 de espera) / 720 (ampliar) / 1400 ms (color).
  Con `prefers-reduced-motion`, todo instantáneo.
- Textos con `host.t(es, en)`; sin Gecko (Node), en castellano.
- Al apagar Zero la ventana queda exactamente como antes: no se toca ningún ajuste de Gecko.

## Revisión: lo que más puede morder

1. **Apagar Zero con la web ampliada, el raíl abierto o la isla escribiendo:** todo tiene que volver
   a la ventana normal, sin estados a medias. Lo prueba la tarea 1, que enciende y apaga en cada
   estado.
2. **Una segunda ventana:** Ctrl+Alt+0 en una no puede tocar la otra. Tarea 1.
3. **Pestañas fijadas, vista dividida (2 a 4) y vista rápida dentro de Zero:** las tarjetas
   separadas y la vista rápida flotando encima. Tarea 2 (tarjetas) y tarea 4 (fijadas en el raíl).
4. **Una web muy oscura o muy clara bajo la isla con la web ampliada:** el texto tiene que seguir
   leyéndose. Tarea 5.
5. **Sin desenfoque del compositor** (otro escritorio, o niri sin la regla): ni ventana
   transparente sin desenfoque ni negro; tiene que salir el fondo del color de la web. Tarea 2,
   con `backdrop = web` forzado.

---

### Tarea 1: Esqueleto de `zero/`, integración en Kitsune y encender/apagar por ventana

**Archivos:**
- Crear: `zero/README.md`, `zero/zero.json`, `zero/modules/zero-config.sys.mjs`, `zero/modules/zero.sys.mjs`, `zero/chrome/zero.css`
- Crear: `install/native/kitsune-zero-host.sys.mjs`
- Modificar: `install/native/kitsune-bootstrap.js` (arrancar el anfitrión), `install/native/kitsune-keys.sys.mjs` (CATALOG), `install/native/kitsune-palette.sys.mjs` (ACTIONS), `install/kitsune-engine.py` (copiar `zero/` y su huella), `install/install.sh` (copiar `zero/`)
- Pruebas: `tests/zero_config.test.mjs`, `tests/test_engine_zero.py`, `tests/zero_native.py`

**Interfaces:**
- Produce `Zero.start(host)`, `Zero.decorate(win)`, `Zero.toggle(win)`, `Zero.active(win) → bool` y
  `Zero.onChange(win, fn)` (llama a `fn(active)`).
- `host = { t(es, en), prefs: Services.prefs, prefix: 'kitsune.zero.', keys: { add(win, id, key, modifiers, run) } }`.
- `zero-config`: `PREFS = { always: 'always', backdrop: 'backdrop' }`, `DEFAULTS = { always: false, backdrop: 'auto' }`,
  `prefName(prefix, key)` y `readPrefs(prefs, prefix)`, que devuelve `{ always, backdrop }`.
- Los módulos de pieza exportan `attach(win, ctx)` y `detach(win)`. `ctx = { host, onChange }`.

- [ ] **Paso 1: prueba de Node de la configuración (falla).**
```js
// tests/zero_config.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { PREFS, DEFAULTS, prefName, readPrefs } from '../zero/modules/zero-config.sys.mjs'
test('Zero keeps every setting name in one place, under the host prefix', () => {
  assert.equal(prefName('kitsune.zero.', PREFS.backdrop), 'kitsune.zero.backdrop')
  assert.equal(prefName('zero.', PREFS.always), 'zero.always')
  const prefs = { getBoolPref: (n, d) => n === 'kitsune.zero.always' ? true : d, getStringPref: (n, d) => d }
  assert.deepEqual(readPrefs(prefs, 'kitsune.zero.'), { ...DEFAULTS, always: true })
  assert.deepEqual(readPrefs({ getBoolPref() { throw new Error('x') }, getStringPref() { throw new Error('x') } }, 'p.'), DEFAULTS)
})
```
- [ ] **Paso 2:** `node --test tests/zero_config.test.mjs` → falla (no existe el módulo).
- [ ] **Paso 3:** escribir `zero-config.sys.mjs` (exportaciones de arriba, con `readPrefs` dentro de `try` y los valores por defecto si falla).
- [ ] **Paso 4:** la prueba pasa.
- [ ] **Paso 5: prueba de Python de la receta (falla):** `integrate_native` copia `zero/modules/*`, `zero/chrome/*` y `zero/assets/*` a
  `browser/base/content/zero/` y añade al `jar.mn` la línea `content/browser/zero/ (content/zero/**)` una sola vez (idempotente);
  `input_files()` incluye cada archivo de `zero/`. Se prueba sobre un árbol de mentira en un directorio temporal, como las otras
  pruebas de `kitsune-engine.py`.
- [ ] **Paso 6:** en `kitsune-engine.py`: `ZERO = HERE / "zero" if (HERE / "zero").is_dir() else HERE.parent / "zero"`,
  `ZERO_JAR_ENTRY = "content/browser/zero/ (content/zero/**)"`, copia en `integrate_native` y huella en `input_files`. En `install.sh`,
  añadir `zero` a la lista de carpetas que se copian. La prueba pasa.
- [ ] **Paso 7: prueba con el motor real (falla):** `tests/zero_native.py`:
  1. Ctrl+Alt+0 pone `zero` en `documentElement` y otra vez lo quita.
  2. Una segunda ventana abierta no cambia.
  3. Con `kitsune.zero.always = true`, una ventana nueva nace en Zero.
  4. Con Zero, `chrome://browser/content/zero/zero.css` está cargado en esa ventana (`windowUtils`); sin Zero, no.
  5. Al apagar no queda ningún nodo `[id^="zero-"]` ni atributo `zero-*` en la raíz.
  Se puede probar sin compilar el motor con `--zero-del-repo` (sustituye `chrome://browser/content/zero/` por `resource://zerotest/`, igual que `glance_native.py --modulo-del-repo`).
- [ ] **Paso 8:** escribir `zero.sys.mjs`:
  - `start(host)` una vez por proceso.
  - `decorate(win)`:
    - espera a `delayedStartupPromise`;
    - registra el atajo con `host.keys.add(win, 'kitsune-zero-key', 'Z', 'accel,alt', () => toggle(win))`;
    - si `always`, enciende.
  - `toggle`:
    - pone o quita el atributo;
    - carga o descarga la hoja (`win.windowUtils.loadSheetUsingURIString(url, AUTHOR_SHEET)`);
    - guarda el estado con `SessionStore.setCustomWindowValue(win, 'kitsune-zero', '1'|'')`;
    - avisa a `onChange`.
  - Al decorar, si `SessionStore.getCustomWindowValue(win, 'kitsune-zero') === '1'`, la ventana vuelve en Zero.
- [ ] **Paso 9:** `kitsune-zero-host.sys.mjs`:
  - crea el `host` (`t` con kitsune-i18n);
  - `keys.add` crea un `<keyset id="kitsune-zero-keys">` como hace `kitsune-layout`.
  - El bootstrap lo llama con `try`, después de `KitsuneLayout` y antes de `KitsuneKeys`.
  - `CATALOG` y `ACTIONS` llevan `kitsune-zero-key` («Kitsune Zero» / «Kitsune Zero»).
- [ ] **Paso 10:** la prueba pasa (`--zero-del-repo`); `npm test` y las pruebas de Python, en verde.
- [ ] **Paso 11:** commit «Kitsune Zero: esqueleto separable y Ctrl+Alt+0 por ventana».

### Tarea 2: Ventana de cristal, tarjeta, ampliar y botones de ventana

**Archivos:** crear `zero/modules/zero-frame.sys.mjs`; ampliar `zero/chrome/zero.css`; crear `zero/linux/kitsune-zero.kdl` y la parte de niri en `install/install.sh`; prueba `tests/zero_frame_native.py` y `tests/zero_frame.test.mjs`.

**Interfaces:** `attach(win, ctx)` y `detach(win)`; `dominantColor(rgbaBytes) → '#rrggbb'` (pura, exportada); `backdropMode(pref, env) → 'system' | 'web'` (pura).
El atributo `zero-full` en la raíz (web ampliada) y `zero-backdrop="system|web"`.

- [ ] **Paso 1: pruebas de Node (fallan):**
  - `dominantColor` de un bloque de bytes mitad `#c8553d` y mitad blanco da un color cálido, no blanco: ignora los casi blancos y los casi negros salvo que no haya otra cosa.
  - `backdropMode('auto', { niri: true, rule: true })` → `system`; `('auto', { niri: true, rule: false })` → `web`; `('web', …)` → `web`; `('system', { niri: false })` → `system` (lo pide quien sabe).
- [ ] **Paso 2:** implementarlas en `zero-frame.sys.mjs`; pasan.
- [ ] **Paso 3: prueba con el motor real (falla)**, `zero_frame_native.py` con `--zero-del-repo`:
  1. En Zero, `getComputedStyle(root).backgroundColor` es `rgba(0, 0, 0, 0)` con `backdrop=system`.
  2. `#tabbrowser-tabpanels` queda a 50/46/12/12 px de los bordes de la ventana, con radio 18 px.
  3. Con la vista dividida de 2, dos paneles separados 10 px.
  4. `zero-full` deja los paneles a 0 px y radio 0; el botón ⤡ lo devuelve.
  5. Los tres botones de ventana están en fila arriba a la izquierda (misma `y`, `x` creciente), y la franja de arriba tiene `-moz-window-dragging: drag`.
  6. Con `backdrop=web`, la capa `#zero-backdrop` tiene una imagen y el fondo de la raíz no es transparente.
  7. El velo `#zero-tint` toma el color dominante de una página de prueba roja (tono rojo).
- [ ] **Paso 4:** CSS y módulo:
  - `:root[zero]` y el resto del marco, transparentes;
  - márgenes y radio de la tarjeta, y `zero-full`;
  - botones de ventana propios: `window.minimize()`, cambiar entre `maximize()` y `restore()` según `windowState`, y `window.close()`;
  - capa `#zero-backdrop` (modo web: `drawSnapshot` a 0,02 en un `<canvas>` con `filter: blur(60px) saturate(1.35)`);
  - `#zero-tint` (repinta al cambiar de pestaña o al cargar, no más de una vez cada 500 ms);
  - botones ⤢/⤡ y ◫ a la izquierda de la tarjeta al acercarse.
- [ ] **Paso 5:** niri:
  - `zero/linux/kitsune-zero.kdl` con `window-rule { match app-id="^kitsune-browser$"; background-effect { blur true; } }`;
  - `install.sh` lo copia a `~/.config/niri/` y añade `include "kitsune-zero.kdl"` solo si hay niri 26.04 o posterior y no está ya, con copia de seguridad `config.kdl.pre-kitsune-zero-<fecha>`;
  - `kitsune.cfg` fija `mozilla.widget.use-argb-visuals = true`.
- [ ] **Paso 6:** la prueba pasa. Commit «Kitsune Zero: ventana de cristal, tarjeta y ampliar».

### Tarea 3: La isla

**Archivos:** crear `zero/modules/zero-island.sys.mjs`; ampliar `zero.css`; prueba `tests/zero_island_native.py`.

**Interfaces:**
- `attach` y `detach`.
- Estados en el atributo `zero-island` del `#navigator-toolbox`: `""` (reposo), `open` y `typing`.
- `ctx.island.alert(text, detail, ms)` para las fases 2 y 3: ensancha y vuelve.

- [ ] **Paso 1: prueba (falla):**
  1. En reposo, el `#nav-bar` mide 176 × 32 y enseña solo el dominio (`#zero-host` con el host de la página).
  2. Con el ratón encima (o el atributo `open`), mide 400 de ancho y 32 de alto, y salen atrás, adelante y recargar.
  3. Con el foco en `gURLBar`, mide 560 × 32.
  4. Su borde de abajo queda al menos 4 px por encima de la tarjeta en los tres casos.
  5. `#TabsToolbar` y la barra de marcadores no se ven.
  6. Las sugerencias de la barra de direcciones se abren y se leen.
  7. `alert()` lo ensancha y vuelve a reposo.
- [ ] **Paso 2:** CSS:
  - `#navigator-toolbox` absoluto y centrado, con la anchura en transición por `--calm`;
  - `#nav-bar` de cristal;
  - el contenido entra con 140 ms de espera y un desenfoque de 3 px → 0;
  - `#zero-host` se superpone a la barra de direcciones en reposo y se va al abrir.
  El módulo pone `typing` mientras `gURLBar` tiene el foco y actualiza el host en `onLocationChange`.
- [ ] **Paso 3:** la prueba pasa. Commit «Kitsune Zero: la isla».

### Tarea 4: El raíl con efecto Dock

**Archivos:** crear `zero/modules/zero-dock.mjs` (puro), `zero/modules/zero-rail.sys.mjs`; ampliar `zero.css`; pruebas `tests/zero_dock.test.mjs`, `tests/zero_rail_native.py`.

**Interfaces:**
- `dockScales(centers, pointerY, { gain = 0.22, spread = 26 }) → number[]`.
- `host.spaces?` (de Kitsune, opcional): `{ list(win) → [{ id, name, icon, color }], current(win) → id, select(win, id) }`.

- [ ] **Paso 1: prueba de Node (falla):**
```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { dockScales } from '../zero/modules/zero-dock.mjs'
test('the icon under the pointer grows the most and the effect fades with distance', () => {
  const s = dockScales([0, 26, 52, 78, 104], 52)
  assert.equal(s[2], 1.22)
  assert.ok(s[1] < s[2] && s[0] < s[1] && Math.abs(s[1] - s[3]) < 1e-9)
  assert.ok(Math.abs(s[0] - 1) < 0.01)
  assert.deepEqual(dockScales([0, 26], null), [1, 1])
})
```
- [ ] **Paso 2:** implementar `zero-dock.mjs`; pasa.
- [ ] **Paso 3: prueba con el motor real (falla):**
  1. El raíl tiene un icono redondo por pestaña visible (con su favicon o su inicial), en orden, y las fijadas arriba.
  2. Un clic selecciona la pestaña y el clic central la cierra.
  3. Una pestaña nueva aparece con fundido.
  4. El ancho pasa de 36 a 186 con el ratón encima y los títulos entran escalonados.
  5. Al mover el ratón por encima, `--s` del icono más cercano es el mayor.
  6. Con `zero-full`, el raíl se aparta (`opacity 0`) y vuelve al acercarse al borde izquierdo (`#zero-edge`).
  7. Con espacios, arriba salen sus iconos y un clic cambia de espacio.
- [ ] **Paso 4:** módulo y CSS:
  - la lista sale de `gBrowser.visibleTabs` y escucha `TabOpen`, `TabClose`, `TabSelect`, `TabAttrModified`, `TabMove`, `TabPinned` y `TabHide`;
  - abierto encima de la web se esmerila (velo claro);
  - el kitsune-zero-host le pasa `spaces` desde `KitsuneSpaces`.
- [ ] **Paso 5:** la prueba pasa. Commit «Kitsune Zero: el raíl con efecto Dock».

### Tarea 5: Cristal en vivo y texto adaptable

**Archivos:** crear `zero/modules/zero-glass.sys.mjs` y `zero/modules/zero-light.mjs` (puro); pruebas `tests/zero_light.test.mjs`, `tests/zero_glass_native.py`.

**Interfaces:**
- `lightOf(rgbaBytes) → 0..1` (luminancia relativa media).
- `inkFor(light) → 'ink' | 'white'`, con histéresis: cambia a tinta por encima de 0,62 y a blanco por debajo de 0,52.
- `GlassPane.attach(element, win)`: pone un `<canvas class="zero-glass">` detrás del elemento y lo repinta.
- `GlassPane.detach(element)`.

- [ ] **Paso 1: pruebas de Node (fallan):** blanco → 1; negro → 0; con histéresis, 0,57 no cambia lo que había antes.
- [ ] **Paso 2:** implementarlas; pasan.
- [ ] **Paso 3: prueba con el motor real (falla):**
  1. Con la web ampliada y una página negra arriba y blanca abajo, el canvas de la isla tiene píxeles oscuros.
  2. Tras hacer scroll hasta lo blanco, tiene píxeles claros y la isla pasa a `zero-ink`.
  3. Sin moverse nada durante 1 s, no se repinta (contador de repintados quieto).
  4. Con la tarjeta (no ampliada), la isla no lleva canvas, porque está sobre el marco.
- [ ] **Paso 4:** implementación:
  - `drawSnapshot(rect, 0.5)` de la zona bajo el elemento, `filter blur(10px) saturate(1.7)` en el contexto, más los filos de luz por CSS;
  - repinta a 60 fps mientras haya scroll, rueda, teclas, ratón sobre la web, un vídeo sonando o una transición de Zero, y 1,5 s después se para;
  - a 15 fps con el modo ahorro de Kitsune (`host.saver?.active`).
- [ ] **Paso 5:** la prueba pasa. Commit «Kitsune Zero: cristal en vivo sobre la web».

### Tarea 6: Marca de agua y ajustes de Zero

**Archivos:** crear `zero/assets/zero-logo.svg` (la «máscara en el cero» de la maqueta v9, `currentColor`) y `zero/modules/zero-mark.sys.mjs`; ampliar `zero.css`; prueba `tests/zero_mark_native.py`.

**Interfaces:** `attach` y `detach`; `ctx.settings.add(section)` para que las fases 2 a 4 añadan sus filas.

- [ ] **Paso 1: prueba (falla):**
  1. La marca está abajo a la izquierda (a 13 px y 16 px de los bordes), en blanco y con opacidad 0,34.
  2. Un clic abre `#zero-settings`, que brota con origen en la marca y se cierra con un clic fuera o con Esc.
  3. En el panel, «Abrir siempre en Zero» cambia `kitsune.zero.always`, y «Fondo: del sistema / de la web» cambia `kitsune.zero.backdrop` y el aspecto al momento.
  4. No salen filas de fases sin hacer.
- [ ] **Paso 2:** implementación con el logo, el panel de cristal esmerilado (velo 0,72), los interruptores y el segmento de dos opciones.
- [ ] **Paso 3:** la prueba pasa. Commit «Kitsune Zero: marca de agua y ajustes».

### Tarea 7: Movimiento, pruebas enteras, motor real y el PC de Risco

- [ ] **Paso 1:** repasar cada transición contra la spec, dejando una sola curva por tipo de movimiento. Al cerrar, el contenido se va antes que la forma. Añadir `prefers-reduced-motion`.
- [ ] **Paso 2:**
  - instalar desde el worktree y compilar el motor;
  - pasar todas las pruebas `zero_*_native.py` sin `--zero-del-repo`, más `npm test`, las pruebas de Python y las 26 nativas de Kitsune (Zero apagado no puede cambiar nada).
- [ ] **Paso 3:** en el PC de Risco, con su permiso:
  - instancia de prueba con `--class kitsune-zero-prueba`;
  - comprobar que la ventana es transparente y que niri la desenfoca, con una captura de esa ventana por id;
  - la regla de niri, instalada con su copia de seguridad.
- [ ] **Paso 4:**
  - `zero/README.md`: qué es, cómo se integra y cómo sacarlo como navegador aparte (otra marca, otro app-id, `kitsune.zero.always=true`);
  - Nori (tarea «Kitsune Zero · fase 1») y 🚀・avances.
  - Commit y fusión en main cuando Risco lo vea.
