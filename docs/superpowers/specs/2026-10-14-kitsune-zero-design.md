# Kitsune Zero — diseño

Fecha: 14-10-2026. Lo pidió Risco tras ver Opera Air: «un Kitsune dentro de otro Kitsune»,
minimalista, de cristal, sutil, calmado, fluido y dócil, «currado en plan muy extremo».
Maquetas validadas por Risco: `.superpowers/brainstorm/*/content/zero-v9.html` (la última).

## Qué es

Un modo de Kitsune con su propia cara y sus propias herramientas para estar tranquilo y
concentrado. Todo es elegible: se puede usar solo por cómo se ve, sin nada de productividad.

Hecho cuando: con Ctrl+Alt+0 una ventana de Kitsune pasa a Zero y vuelve, con las mismas
pestañas, y cada pieza de abajo se puede encender y apagar por separado en sus ajustes.

## Decisiones de Risco

- **Modo que se enciende**, por ventana (Ctrl+Alt+0). Si Zero acaba siendo un navegador aparte
  no está decidido: el código tiene que poder sacarse sin lío (ver «Separable»).
- **Aspecto: cristal de verdad, casi transparente.** Toda la ventana es cristal y detrás se ve
  el escritorio desenfocado. Las piezas de cristal que flotan sobre la web la desenfocan en vivo.
  Estilo de los sistemas de Apple (Liquid Glass, Dynamic Island), ultralimpio.
- **La web es una tarjeta** dentro de la ventana; un botón la amplía a toda la ventana y otro
  la devuelve. Con la multitarea de Kitsune (vista dividida de 2 a 4, vista rápida, espacios).
- **La isla es la barra de menú**: pequeña (solo la dirección) y se abre al pasar el ratón
  (atrás, adelante, recargar, compartir, menú). Crece solo a lo ancho: nunca pisa la web.
- **Pomodoro**: un anillo arriba a la derecha; al pasar el ratón, el tiempo y el ciclo.
  Trabajo y descanso a elección. Descanso **suave** (avisa la isla) o **estricto** (un cristal
  tapa las webs, con respiración o estiramientos y «Saltar» manteniendo pulsado), a elegir.
- **Silencio**: avisos y permisos guardados para el descanso, sin autoplay ni banners de
  cookies, webs vetadas durante el trabajo (lista propia) y «Solo currar» (vetadas siempre),
  y un aviso suave de scroll infinito.
- **Sonidos**: solo grabaciones reales con licencia CC0, con mezclador por capas.
- **Raíl de pestañas**: solo iconos, compacto y centrado a la izquierda. Al pasar el ratón se
  abre con los títulos, con efecto Dock: el icono bajo el ratón crece y los de al lado se apartan.
  Iconos redondos.
- **Botones de ventana** en horizontal arriba a la izquierda, como en Kitsune.
- **Logo**: «máscara en el cero», la máscara kitsune de la marca dentro de un aro perfecto. Es
  una marca de agua blanca, muy sutil, abajo a la izquierda, y abre los ajustes de Zero.
- **Animaciones**: sutiles, calmadas, fluidas y dóciles. Cada una cuidada.

## Separable: Zero como módulo, Kitsune como anfitrión

Todo Zero vive en `zero/`, y Kitsune lo incluye a través de una sola pieza. Así, sacar
«Kitsune Zero» como navegador aparte consiste en otra marca (`install/branding`), otro app-id y
`zero.always = true`, sin tocar el código de Zero.

```
zero/
  README.md                 qué es, cómo se integra y cómo se sacaría aparte
  zero.json                 identidad: nombre, prefijo de ajustes, app-id, atajo
  modules/                  chrome://browser/content/zero/…  (sys.mjs, sin dependencias de Kitsune)
    zero.sys.mjs            entrada: start(host), decorate(win), toggle(win)
    zero-config.sys.mjs     nombres de ajustes y valores por defecto (un único sitio)
    zero-frame.sys.mjs      ventana de cristal: transparencia, velo del color de la web, tarjeta, ampliar
    zero-island.sys.mjs     la isla (barra de menú) y sus avisos
    zero-rail.sys.mjs       raíl de pestañas con efecto Dock
    zero-glass.sys.mjs      cristal en vivo sobre la web (fotos de la web desenfocadas)
    zero-mark.sys.mjs       marca de agua y panel de ajustes
    (fase 2+) zero-focus.sys.mjs, zero-quiet.sys.mjs, zero-sounds.sys.mjs
  chrome/zero.css           todo el CSS de Zero, bajo :root[zero]
  assets/                   logo (svg), y en la fase 4 los sonidos
```

**La interfaz con el anfitrión** (`host`, la pasa Kitsune en `start`):
`t(es, en)` para los textos, `prefs` (prefijo, por defecto `kitsune.zero.`),
`keys.add(id, combo, fn)` para el atajo, y `palette.add(...)` y `menu.add(...)` si existen.
Zero nunca importa módulos de Kitsune. Si una función del anfitrión no está, Zero sigue
funcionando sin ella.

**En Kitsune**:
- `install/native/kitsune-zero-host.sys.mjs` crea el `host` y llama a `Zero.start(host)`.
- La receta (`install/kitsune-engine.py`) copia `zero/modules` y `zero/chrome` al motor.
- `chrome/userChrome.css` importa `zero.css`.

## Arquitectura

**Encender y apagar (por ventana).** `toggle(win)` pone o quita el atributo `zero` en la raíz
de esa ventana. Cada módulo decora la ventana y escucha el atributo con un `MutationObserver`.
El CSS hace casi todo. Con `zero.always`, las ventanas nuevas nacen en Zero. Al apagar, todo
vuelve a como estaba: no se cambia ningún ajuste de Gecko de forma permanente (las pestañas al
lado, la densidad, etc., se aplican con atributos y CSS propios, no con los ajustes de Gecko).

**Ventana de cristal (zero-frame).**
- En Zero, `:root`, `#browser`, la caja de las pestañas y el resto del marco tienen fondo
  transparente. Gecko pasa entonces la ventana a transparente él solo
  (`nsLayoutUtils::GetFrameTransparency` mira si el fondo de la raíz es opaco;
  `widget.transparent-windows` vale `true` en Gecko 158).
- El desenfoque del escritorio lo pone el compositor:
  - **niri 26.04 o posterior:** una regla para `app-id="^kitsune-browser$"` con
    `background-effect { blur true }` (xray, el desenfoque eficiente). Fuera de Zero la ventana
    es opaca, así que la regla no se nota.
  - **Sin desenfoque del compositor** (otros escritorios, Windows, macOS), mientras no haya
    algo mejor: **fondo del color de la web**, una foto diminuta de la web (2 % de escala),
    muy desenfocada y saturada, detrás del marco. Es la personalización que Risco aprobó.
- Un velo muy leve (opacidad 0,2) toma el color dominante de la web y cambia con
  `background-color 1400ms`.

**La tarjeta (zero-frame).** Los paneles de las pestañas (`#tabbrowser-tabpanels`) quedan
con márgenes (izquierda 50 px, arriba 46 px, derecha y abajo 12 px), radio 18 px y sombra. La vista
dividida de Kitsune (2 a 4) queda como tarjetas separadas por 10 px. «Ampliar» lleva los márgenes
a 0 y el radio a 0, en 720 ms con la curva de llegada, y entonces el raíl se aparta. Los botones
⤢/⤡ y ◫ aparecen a la izquierda de la tarjeta al acercarse; con la tarjeta ampliada se ponen
junto a los botones de ventana.

**La isla (zero-island).** Es la barra de navegación de Gecko (`#nav-bar`), reestilada, no
rehecha: se conservan la barra de direcciones, sus sugerencias, los botones y las extensiones.
Se queda en la franja de arriba, centrada.
- Pequeña: 176 × 32 px y solo el dominio.
- Al pasar el ratón: 400 px y entran los botones, primero la forma y luego el contenido.
- Al escribir (barra de direcciones con el foco): 560 px.
- Los avisos (fases 2 y 3) la ensanchan, con el texto en una línea.
- La altura nunca cambia: no pisa la web.
- Las pestañas de arriba de Gecko (`#TabsToolbar`) se esconden; las pestañas están en el raíl.

**El raíl (zero-rail).** Las pestañas verticales de Gecko (`sidebar-main` con
`sidebar.verticalTabs`) en una cápsula de cristal de 36 px, centrada a la izquierda.
- Al pasar el ratón: 186 px, con los títulos entrando uno tras otro (28 ms de diferencia).
- Efecto Dock: con el ratón encima, cada icono recibe `--s = 1 + 0,22·exp(−(d/26)²)`, que lo
  escala y separa a los vecinos.
- Iconos redondos. Los espacios de Kitsune arriba.
- Abierto sobre la web se esmerila (velo claro); en reposo es casi transparente.
- Si al llamar a Zero las pestañas no estaban al lado, Zero las pone al lado solo en esa
  ventana y con su propio atributo, sin cambiar los ajustes de Gecko.

**Cristal en vivo sobre la web (zero-glass).** El desenfoque de CSS no ve la web, porque va en
otro proceso (comprobado con Gecko 158). Cada pieza de cristal que queda encima de la web
(la isla y el raíl con la web ampliada, los botones de ampliar) lleva un `<canvas>` detrás que
pinta `windowGlobal.drawSnapshot` de lo que tiene debajo, desenfocado y saturado (medido:
3,4 ms por pieza y fotograma a escala 0,5).
- Se repinta a 60 fps mientras algo se mueve (scroll, animación, vídeo) y se para en reposo.
- De esa foto sale la luz media: el texto del cristal pasa a tinta sobre lo claro y a blanco
  sobre lo oscuro, con un fundido de 420 ms.

**Botones de ventana.** Los de Kitsune (`window-controls.css`), en horizontal arriba a la
izquierda: discretos y con color al acercarse.

**La marca y los ajustes (zero-mark).** El logo «máscara en el cero» en blanco con opacidad
0,34, abajo a la izquierda, sobre el cristal del marco. Al pasar el ratón sube a 0,92 en 700 ms.
Un clic abre el panel de ajustes de Zero, que brota de la marca (escala 0,94 → 1, desenfoque
4 px → 0). En el panel:
- un interruptor por pieza: Aspecto, Silencio, Pomodoro, Webs vetadas, Solo currar, Aviso de
  scroll y Sonidos;
- Suave/Estricto para el descanso;
- los tiempos del pomodoro y la lista de webs vetadas.

Lo de las fases que aún no estén hechas no sale en el panel.

## Movimiento

- Curvas: **llegar** `cubic-bezier(.32,.72,0,1)` (todo lo que cambia de forma o de sitio) y
  **aparecer** `cubic-bezier(.4,0,.2,1)` (opacidades y colores).
- Tiempos: forma 620 ms, contenido 280 ms (entra 140 ms después de que empiece la forma, con un
  desenfoque de 3 px → 0), ampliar 720 ms, color 1400 ms.
- Nada rebota y nada salta: todo frena despacio.
- Al cerrar, el contenido se va antes que la forma.
- Con `prefers-reduced-motion`, todo es instantáneo.

## Fases

1. **El marco Zero**: encender y apagar, ventana de cristal (con el fondo del color de la web
   si no hay desenfoque del compositor), tarjeta y ampliar, isla, raíl, botones de ventana,
   marca y ajustes, cristal en vivo y texto adaptable. Multitarea de Kitsune dentro.
2. **Pomodoro**: el anillo, los tiempos y los ciclos; descanso suave y estricto (respiración y
   estiramientos guiados).
3. **Silencio**: avisos y permisos guardados, sin autoplay ni cookies, webs vetadas, «Solo
   currar» y aviso de scroll.
4. **Sonidos**: biblioteca CC0, mezclador por capas y bucles sin corte (fundido entre dos copias).

Cada fase tiene su plan y sus pruebas, y se publica cuando está entera.

## Pruebas

- Por cada módulo, una prueba con el motor real (`tests/zero_*_native.py`, perfil temporal y
  sin ventana en pantalla):
  - encender y apagar (y que todo vuelva igual),
  - la geometría de la tarjeta y del ampliar,
  - la isla en sus tres anchos sin cambiar de alto,
  - el raíl y el efecto Dock,
  - el cristal en vivo (la foto cambia al hacer scroll),
  - el texto adaptable,
  - la marca y los ajustes.
- La lógica pura (curvas del Dock, luz media, nombres de ajustes) va en pruebas de Node.
- La transparencia real de la ventana y el desenfoque de niri se comprueban a mano en el PC de
  Risco, con una instancia de prueba y una captura de su ventana por id (nunca de la pantalla
  entera).

## Riesgos

- **Transparencia en Wayland:** que la ventana principal no use un visual con alfa. Se comprueba
  lo primero de todo. Si falla, la fase 1 sale con el fondo del color de la web y la
  transparencia queda para un parche de Gecko.
- **La regla de niri** vive en la configuración que genera InkShadow: hay que añadirla a su
  plantilla (rama `astra-v1`), no a mano en `~/.config/niri/config.kdl`.
- **El cristal en vivo gasta CPU:** se para en reposo, se limita a las piezas visibles y baja de
  frecuencia con el modo ahorro de Kitsune.
- **La barra de direcciones de Gecko es delicada:** se reestila sin moverla del DOM.
