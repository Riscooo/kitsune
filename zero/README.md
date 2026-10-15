# Kitsune Zero

Un Kitsune dentro de Kitsune: una ventana de cristal, tranquila y para concentrarse. Ctrl+Alt+0 pasa
la ventana a Zero y la devuelve, con las mismas pestañas. Diseño completo en
`docs/superpowers/specs/2026-10-14-kitsune-zero-design.md`.

## Cómo está hecho

- `modules/`: los módulos de chrome. `zero.sys.mjs` es la entrada (y aparta Zero mientras se
  personaliza la barra); cada pieza es un módulo con
  `attach(win, ctx)` y `detach(win)`, en su lista de piezas. Se importan entre sí con rutas relativas y
  **no importan nada de Kitsune**. Las piezas, en orden:
  - `zero-pane`: la lámina de detrás de todo (el canto de la ventana, con WebGL), solo con el cristal;
  - `zero-frame`: la ventana y su fondo (el cristal del sistema, el de la web, o los que pinta Zero en
    `#zero-bg`: Espacio, Niebla o una foto, con su opacidad), la web en tarjeta (y ampliada), la vista
    dividida, la barra lateral de Gecko (historial, marcadores, extensiones) como otra tarjeta, los botones
    de ventana (en macOS, el verde pone la pantalla completa) y el velo del color de la web;
  - `zero-island`: la isla (la barra de navegación de Gecko, reestilada), sus avisos (`alert()`), la
    línea de carga y las actividades en directo (las descargas, en `zero-downloads`); las barras de
    aviso de Gecko salen de ella como tarjetas, y la de buscar en la página (solo CSS) flota abajo;
  - `zero-rail`: el raíl de pestañas con efecto Dock (`zero-dock.mjs`) y los espacios del anfitrión;
  - `zero-profiles`: los perfiles (los espacios del anfitrión) en su pastilla, su ficha (nombre, correo,
    cuentas, icono, color, sesiones e imagen), el modo Currar/Chill y tu perfil sobre el buscador de la
    pestaña nueva;
  - `zero-shortcuts`: la pastilla de abajo, la del sonido (sin abrir pestañas);
  - `zero-music`: el reproductor de música (Spotify, SoundCloud…) y su minipanel flotante;
  - `zero-audio`: el panel de sonido (lo que suena en cada pestaña, silenciar y el volumen de Kitsune,
    que multiplica el de cada audio y vídeo; lo aplica su actor, `zero-audio-child.sys.mjs`);
  - `zero-mark`: los ajustes (la última pastilla de la columna);
  - `zero-pomodoro`: el anillo, los avisos y los descansos (el reloj, puro, en `zero-pomodoro.mjs`);
  - `zero-silence`: avisos en silencio, webs vetadas, «Solo currar» y el aviso de scroll infinito
    (las reglas, puras, en `zero-silence.mjs`);
  - `zero-sounds`: los sonidos CC0 por capas (el mezclador, puro, en `zero-sounds.mjs`; los
    créditos, en `SONIDOS.md`);
  - `zero-media`: lo que suena en otra pestaña, en la isla (aviso, onda, pausa y siguiente), con el
    MediaController de Gecko;
  - `zero-glass`: el cristal en vivo sobre la web y el texto que se adapta (`zero-light.mjs`). Su
    actor (`zero-glass-child.sys.mjs`) solo cuenta el scroll de la página.
  Y dos pequeños que usan el raíl y la isla: `zero-who`, de qué usuario (contenedor) es una pestaña, y
  `zero-icon`, si un favicon es claro sobre transparente (para darle un fondo oscuro).
  `zero-dock.mjs`, `zero-light.mjs`, `zero-pomodoro.mjs`, `zero-silence.mjs`, `zero-sounds.mjs` y
  `zero-config.sys.mjs` son puros y se prueban con Node. El pomodoro, el silencio y los sonidos son
  opcionales y vienen apagados.
- `chrome/zero.css`: todo el aspecto, bajo `:root[zero]`. Lo carga `zero.sys.mjs` solo en las
  ventanas con Zero, como hoja de usuario (así sus `!important` pueden con los de Kitsune y Gecko).
  Dos curvas (`--zero-calm` para forma y sitio, `--zero-soft` para opacidad y color) y los tiempos
  en variables, que «reducir movimiento» pone a cero.
- El acabado mantiene la lámina plana y las píldoras y botones de su tamaño original. El canto de
  la lámina tiene el filo blanco continuo de 2–3 px del boceto aprobado, con un halo nacarado que se
  extingue en 22 px; su lente conserva una caída de 30 px, para que
  la refracción no termine en una franja. Las piezas comparten el relleno, el filo y la sombra corta
  (`--zero-glass-fill`, `--zero-glass-rim`, `--zero-glass-edge`): cristal sobre cristal, también en
  las pastillas de perfiles, modos, música y accesos. No añade capturas ni animaciones al cristal.
- Dos variantes (ajuste «Estilo», `kitsune.zero.variant`; zero-frame pone `zero-variant` en la raíz):
  **Nácar** (de serie, la de Risco: la lámina nacarada, los accesos directos con la música en su
  pastilla, la marca abajo a la izquierda y, sin cristal detrás, la foto de la web) y **Sobrio** (la de
  Dani: cristal ahumado o esmerilado con filo neutro, la lámina sin color, el panel de sonido en lugar
  de accesos y música, los ajustes en la columna, tu perfil sobre el buscador y, sin cristal detrás,
  Espacio o Niebla). Lo demás es común: los dos botones del modo, el pomodoro, los fondos pintados, las
  cuentas del perfil.
- Cada sistema con sus esquinas: zero-frame pone `zero-os` y `--zero-os-radius` (48 px en Linux, como la
  regla de niri; 16 en macOS 26 y 10 antes; 8 en Windows 11 y 0 en Windows 10), y el cuerpo, el fondo
  pintado, la lámina y el cristal nativo de macOS (`kitsune.zero.macos-glass-radius`, 16) usan las mismas.
  A pantalla completa, y en Windows maximizada, rectas. En macOS el botón verde es pantalla completa y Zero
  sigue (la lámina, sin canto y con la franja de la cámara fundida); en Windows y Linux con Nácar, F11 es la
  web sola.
- Las páginas se agarran: una pestaña del raíl soltada sobre la web de otra se pone a su lado (vista
  dividida, en el lado en que se suelta, o se añade a la que hay); lejos del raíl y fuera de esa web, a una
  ventana nueva que el sistema puede colocar.
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
las URL de `chrome://browser/content/zero/` (ver `tests/zero_harness.py`). Solo sirve con un motor que no
arranque su propio Zero (desde la 0.8 beta 2 el de serie lo trae: el arnés lo detecta y falla); en Linux,
una copia del motor con el bloque de Zero quitado de `kitsune-bootstrap.js`. `zero_platform_native` simula
las reglas de macOS y Windows en Linux; que casen con sus ventanas de verdad se mira en esos sistemas.
