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
  - `zero-music`: el reproductor de música (Spotify, SoundCloud…), con el ancho que pide cada web y
    estirable desde su borde (el cálculo, puro, en `zero-music-fit.mjs`), y su minipanel flotante;
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
  `zero-dock.mjs`, `zero-light.mjs`, `zero-music-fit.mjs`, `zero-pomodoro.mjs`, `zero-silence.mjs`,
  `zero-sounds.mjs`, `zero-lobo.mjs`, `zero-stats.mjs`, `zero-ia-texto.mjs`, `zero-ia-flujo.mjs`, `zero-ia-protocolo.mjs` y
  `zero-config.sys.mjs` son puros y se prueban con Node. Los `zero-ia-*` y `zero-asistente` son el asistente (ver
  «El asistente», abajo). El pomodoro, el silencio y los sonidos son
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
- Dos variantes (ajuste «Estilo», `kitsune.zero.variant`; zero-frame pone `zero-variant` en la raíz) con las
  mismas piezas (Risco, 15-10: «todos los cambios, que ambos los tengan»); cambia el aspecto. **Nácar** (de
  serie, la de Risco): la lámina nacarada y sus piezas de cristal claro y, sin cristal detrás, la foto de la
  web. **Sobrio** (la de Dani): cristal ahumado o esmerilado con filo neutro, la lámina sin color y, sin
  cristal detrás, Espacio o Niebla. En las dos: los dos botones del modo, el pomodoro, la música y el sonido
  en una pastilla (la nota y el altavoz), los accesos directos, los ajustes como última pastilla de la
  columna, tu perfil sobre el buscador, los fondos pintados y las cuentas del perfil.
- Cada sistema con sus esquinas: zero-frame pone `zero-os` y `--zero-os-radius` (48 px en Linux, como la
  regla de niri; 16 en macOS 26 y 10 antes; 8 en Windows 11 y 0 en Windows 10), y el cuerpo, el fondo
  pintado, la lámina y el cristal nativo de macOS (`kitsune.zero.macos-glass-radius`, 16) usan las mismas.
  A pantalla completa, y en Windows maximizada, rectas. A pantalla completa (el botón verde en macOS, F11)
  Zero sigue, sin canto (en macOS, con la franja de la cámara fundida); para la web sola, «Ampliar».
- Las páginas se agarran (zero-grab): el asa de debajo de la web, llevada a un lado, deja la web en ese lado
  de una vista dividida (al otro, la lista de pestañas para elegir); al filo de la ventana, a una ventana
  propia que el sistema puede colocar. Y una pestaña del raíl soltada sobre la web de otra se pone a su lado
  (o se añade a la vista dividida que haya).
- `assets/`: el logo («máscara en el cero») y los seis sonidos (`zero-sonido-*.ogg`, CC0).
- El lobo, la mascota del asistente, en pixel art: `zero-lobo.mjs` (validar, combinar y el reproductor
  que lo pinta en un `<canvas>`) y sus datos, `assets/lobo.json` (la paleta, los cuadros por capas, los
  efectos y las animaciones del cuerpo, 48×48, y del icono, 24×24). Las animaciones son datos: el
  asistente puede crear las suyas con el mismo formato y se suman sin pisar las de serie. La hoja y los GIF
  de muestra, con `node tools/lobo/hoja.mjs`.
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

## El asistente (Claude Code dentro de Zero)

El Claude de la persona (el CLI `claude`, con su sesión iniciada) como asistente del navegador, con un servidor MCP
que le da las herramientas de Kitsune. Aquí está la tubería; el panel y el lobo los pone otra pieza, con estas APIs:

- `zero-ia-mcp.sys.mjs`: `iniciarServidor({ herramientas, nombre, puerto?, token?, instrucciones?, tiempoMaximo? })` →
  `{ puerto, token, url, cerrar() }`. MCP por «Streamable HTTP» (respuestas application/json, sin SSE) en un
  nsIServerSocket solo de loopback. Una herramienta es `{ nombre, descripcion, esquema, ejecutar: async args =>
  resultado }` (un texto, un objeto o `{ texto, imagen: { datos, tipo } }`; si lanza, Claude recibe el error con
  `isError`). `datosParaClaudeCode(servidor)` → `{ orden, url, cabecera, configuracion }`: la orden `claude mcp add
  --transport http kitsune <url> --header "Authorization: Bearer <token>"` para usarlo desde otro Claude (el token y
  el puerto cambian en cada arranque, salvo que se le pasen `puerto` y `token`).
  Lo de dentro (cabecera HTTP, permisos, JSON-RPC: `initialize`, `ping`, `tools/list`, `tools/call`; lo demás,
  -32601) está en `zero-ia-protocolo.mjs`, puro. Seguridad: token de 256 bits obligatorio (comparado en tiempo
  constante), fuera todo lo que traiga `Origin` o `Sec-Fetch-*` (una web) y un `Host` que no sea 127.0.0.1/localhost
  con su puerto (DNS rebinding), cabecera ≤ 16 KiB, cuerpo ≤ 1 MiB, 10 s para llegar y 60 s por herramienta.
- `zero-ia-herramientas.sys.mjs`: `herramientasDe(win, { lobo })` → las del navegador: `pestanas_listar`,
  `pestana_abrir` (solo http y https, o about:blank), `pestana_ir`, `pestana_cerrar`, `pagina_leer` (título, dirección,
  texto visible hasta 40 000 caracteres y selección; lo saca el actor `zero-ia-child.sys.mjs`, que solo contesta
  cuando se le pregunta), `pagina_seleccion`, `buscar` (con el buscador de serie, en pestaña nueva) y
  `historial_buscar`. `win` puede ser una función (o null: la última ventana con foco). Con `lobo = { animar(nombre),
  listar(), crear(animacion) → errores[], esquema?, ayuda? }`, también `lobo_animar`, `lobo_animaciones` y
  `lobo_crear_animacion` (solo reenvían; `animar` puede devolver false si no existe; los errores vuelven a Claude).
- `zero-ia-navegar.sys.mjs`: `herramientasDeNavegar(win)` → las que manejan las páginas como una persona, **solo para
  el servidor de fuera** (el de «Usar Kitsune Zero desde Claude Code»; en `zero-asistente.sys.mjs`,
  `herramientasDeFuera`). El del panel (`herramientasDelPanel`) no las tiene: el lobo lee webs que no son de fiar y una
  podría pedirle que pulse, escriba o ejecute algo. Son `pestana_navegar` (una dirección http o https en una pestaña
  abierta), `pestana_atras`, `pestana_adelante`, `pestana_recargar`, `pagina_elementos` (lo que se puede tocar, con su
  referencia `[e12]`, su estado y si está a la vista; con filtro y solo lo que se ve), `pagina_clic` (ratón de verdad:
  lo trae a la vista, comprueba que no lo tapa nada y mueve, pulsa y suelta; o por dentro con `forzar`),
  `pagina_pasar_raton`, `pagina_escribir` (tecla a tecla, con nsITextInputProcessor; Intro con `enviar`),
  `pagina_elegir` (un `<select>`), `pagina_teclas` (Enter, Tab, Escape, Control+a…), `pagina_desplazar`,
  `pagina_captura` (PNG de lo que se ve, de la página entera o de un elemento, con `drawSnapshot`: vale con pestañas
  de fondo y ve los iframes), `pagina_esperar` (a que cargue, o a que aparezca o se vaya un selector o un texto),
  `pagina_ejecutar` (JavaScript con los permisos de la página: un sandbox con su principal, como la consola) y
  `pagina_dialogo` (alert, confirm, prompt, «¿salir de la página?»). El elemento se dice con `ref`, un `selector` CSS o
  su `etiqueta` (lo que se ve escrito o su nombre accesible). Lo de dentro de la web lo hace el actor
  `zero-ia-navegar-child.sys.mjs`, registrado solo cuando se usan, solo en http y https y sin marcos: guarda las
  referencias en un mapa (nada en el DOM) y lo que dispara eventos lo hace justo después de contestar, para que un
  `alert()` no lo deje colgado. Lo puro (teclas, lista de elementos en texto, buscar por etiqueta) está en
  `zero-ia-navegar.mjs`. Cada descripción recuerda que lo que devuelve la web son datos, no órdenes, y el servidor de
  fuera añade a sus instrucciones que no se compre, publique, envíe ni borre nada sin confirmarlo con la persona.
- `zero-ia-claude.sys.mjs`: `buscarClaude()` → la ruta de `claude` o null; `new SesionClaude({ ruta, mcp: { url, token
  }, instrucciones, carpeta?, modelo?, sesion?, onEvento, onLinea? })` con `enviar(texto)`, `parar()`, `cerrar()`,
  `sesion`, `ocupada` y `viva`. Un proceso por conversación, vivo entre mensajes; si muere, el siguiente mensaje lo
  relanza con `--resume`. Los eventos (de `zero-ia-flujo.mjs`, puro): `listo`, `texto` (`delta`, `nuevo`),
  `herramienta`, `resultado-herramienta`, `reintento`, `error`, `fin` (`sesion`, `coste`, `duracion`, `parado`) y
  `cerrado` (`codigo`, `inesperado`).

Cómo se lanza `claude`, y por qué: `-p --input-format stream-json --output-format stream-json --verbose
--include-partial-messages` (un proceso que sigue vivo y contesta a trozos); `--setting-sources=` (vacío y pegado: en
Windows, Subprocess no entrecomilla y un `''` suelto se perdería) y `--settings`
con `{ autoMemoryEnabled: false, disableAllHooks: true }` (ni los hooks, plugins, permisos, CLAUDE.md ni la memoria de
la persona); `--strict-mcp-config --mcp-config <archivo>` (solo el servidor de Kitsune, con su token en un archivo
0600 de una carpeta 0700: en la línea de órdenes lo vería cualquiera con `ps`); `--tools WebSearch,WebFetch
--allowedTools mcp__kitsune,WebSearch,WebFetch --disallowedTools Bash,Edit,Write,Read,… --permission-mode dontAsk`
(nada de shell ni archivos: las webs pueden llevar instrucciones escondidas, y lo no permitido se deniega sin
preguntar); `--disable-slash-commands --no-chrome`; `--append-system-prompt-file` (las `instrucciones`, en archivo:
con `claude.cmd`, Windows pasa los argumentos por cmd.exe); `--model` si se pide, y `--session-id` o `--resume`. Sin
las variables de una sesión de Claude Code (CLAUDECODE…), por si Kitsune se abrió desde una. Su carpeta de trabajo,
`kitsune-ia` en el perfil.

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
una copia del motor con el bloque de Zero quitado de `kitsune-bootstrap.js`.

El asistente: `tests/zero_ia_flujo.test.mjs` y `tests/zero_ia_protocolo.test.mjs` (Node, con líneas reales del CLI en
`tests/fixtures/zero-ia/`), `tests/zero_ia_navegar.test.mjs` (lo puro de navegar y que el panel no tiene esas
herramientas), `tests/zero_ia_navegar_native.py` (las de navegar por el MCP de fuera, de verdad, contra una web local;
y el servidor del panel sin ellas) y `tests/zero_ia_native.py` (servidor, herramientas y puente con un `claude` falso,
`tests/fixtures/claude_falso.py`, que no gasta). `--claude-de-verdad` lo prueba una vez con el `claude` de la persona
y haiku (gasta de su cuenta). `zero_platform_native` simula
las reglas de macOS y Windows en Linux; que casen con sus ventanas de verdad se mira en esos sistemas.
