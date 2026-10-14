# Kitsune Zero

Un Kitsune dentro de Kitsune: una ventana de cristal, tranquila y para concentrarse. Ctrl+Alt+0 pasa
la ventana a Zero y la devuelve, con las mismas pestañas. Diseño completo en
`docs/superpowers/specs/2026-10-14-kitsune-zero-design.md`.

## Cómo está hecho

- `modules/`: los módulos de chrome. `zero.sys.mjs` es la entrada; cada pieza es un módulo con
  `attach(win, ctx)` y `detach(win)`, en su lista de piezas. Se importan entre sí con rutas relativas y
  **no importan nada de Kitsune**. Las piezas, en orden:
  - `zero-frame`: la ventana de cristal, la web en tarjeta (y ampliada), la vista dividida, los botones
    de ventana y el velo del color de la web;
  - `zero-island`: la isla (la barra de navegación de Gecko, reestilada) y sus avisos (`alert()`);
  - `zero-rail`: el raíl de pestañas con efecto Dock (`zero-dock.mjs`) y los espacios del anfitrión;
  - `zero-mark`: la marca de agua y los ajustes;
  - `zero-pomodoro`: el anillo, los avisos y los descansos (el reloj, puro, en `zero-pomodoro.mjs`);
  - `zero-silence`: avisos en silencio, webs vetadas, «Solo currar» y el aviso de scroll infinito
    (las reglas, puras, en `zero-silence.mjs`);
  - `zero-sounds`: los sonidos CC0 por capas (el mezclador, puro, en `zero-sounds.mjs`; los
    créditos, en `SONIDOS.md`);
  - `zero-glass`: el cristal en vivo sobre la web y el texto que se adapta (`zero-light.mjs`). Su
    actor (`zero-glass-child.sys.mjs`) solo cuenta el scroll de la página.
  `zero-dock.mjs`, `zero-light.mjs`, `zero-pomodoro.mjs`, `zero-silence.mjs`, `zero-sounds.mjs` y
  `zero-config.sys.mjs` son puros y se prueban con Node. El pomodoro, el silencio y los sonidos son
  opcionales y vienen apagados.
- `chrome/zero.css`: todo el aspecto, bajo `:root[zero]`. Lo carga `zero.sys.mjs` solo en las
  ventanas con Zero, como hoja de usuario (así sus `!important` pueden con los de Kitsune y Gecko).
  Dos curvas (`--zero-calm` para forma y sitio, `--zero-soft` para opacidad y color) y los tiempos
  en variables, que «reducir movimiento» pone a cero.
- `assets/`: el logo («máscara en el cero») y los seis sonidos (`zero-sonido-*.ogg`, CC0).
- `linux/`: la regla de niri que desenfoca lo que hay detrás de la ventana (`kitsune-zero.kdl`) y su
  instalador, que la añade a `~/.config/niri/config.kdl` con copia de seguridad. Sin ella, el fondo es
  una foto desenfocada de la web.
- `zero.json`: la identidad (nombre, prefijo de ajustes, app-id, atajo).

## Ajustes de las fases siguientes

Cada pieza añade su sección al panel de ajustes con `ctx.settings.add(section)`, así que lo que no
está no sale. Una sección es `{ id, rows, watch? }`, y una fila
`{ kind: 'switch' | 'segment' | 'list' | 'slider', id, label, detail?, options?, placeholder?, get(),
set(valor), watch?(fn), when?() }` (con `when`, la fila sale solo si toca; con el `watch` de la
sección, las filas se vuelven a pintar). Los avisos de la isla, con `ctx.island.alert(texto, detalle,
ms)`.

## Cómo lo lleva Kitsune (el anfitrión)

- `install/native/kitsune-zero-host.sys.mjs` le da a Zero lo que necesita: los textos en el idioma de
  Kitsune, los ajustes con el prefijo `kitsune.zero.`, los atajos en su propio `<keyset>`, los espacios
  de Kitsune (`spaces`: lista, el de la ventana, cambiar y enterarse de los cambios), las pestañas «de
  paso» que el raíl no enseña (`tabs.passing`: la vista rápida) y si está el modo ahorro
  (`saver.active`: el cristal en vivo baja a 15 fps).
- `install/kitsune-engine.py` copia `modules/`, `chrome/` y `assets/` al motor, en
  `chrome://browser/content/zero/`. Su huella entra en la receta, así que un cambio en Zero recompila
  el motor.
- `install/install.sh` copia `zero/` junto al motor instalado, y `kitsune-bootstrap.js` llama al anfitrión
  en cada ventana.

## Si Zero sale como navegador aparte

Sería el mismo motor y la misma receta, cambiando solo cinco cosas:

1. otra marca (`install/branding`, con el logo de `assets/zero-logo.svg`),
2. otro app-id y otra carpeta de perfil,
3. `kitsune.zero.always = true` en su configuración, para que todas las ventanas nazcan en Zero,
4. el prefijo de ajustes, si se quiere otro (`prefsPrefix` aquí y en el anfitrión),
5. un anfitrión propio, una copia de `kitsune-zero-host.sys.mjs` con su nombre (sin `spaces` ni
   `saver`, si ese navegador no los tiene: Zero funciona sin ellos).

El código de `modules/` y `chrome/` no se toca.

## Pruebas

`tests/zero_*.test.mjs` (Node) y `tests/zero_*_native.py` (motor real). Con `--zero-del-repo`, las
pruebas nativas usan este directorio sin compilar el motor: un `chrome.manifest` temporal sustituye
las URL de `chrome://browser/content/zero/` (ver `tests/zero_harness.py`).
