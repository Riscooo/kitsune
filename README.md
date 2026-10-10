# Kitsune 0.7 · Tinta · motor propio

Kitsune es un navegador propio: se compila en este PC desde el código fuente
oficial y firmado de Gecko (Mozilla), con su nombre, su marca, su módulo nativo
y su configuración de privacidad dentro. No depende de LibreWolf ni de ningún
otro navegador instalado. No es una imitación con iframes: las pestañas,
extensiones firmadas, navegación, permisos, certificados, marcadores, descargas
y herramientas de desarrollo son las funciones nativas de Gecko.

## Estética «Tinta»

La estética de InkShadow en todo el navegador: papel, tinta y óxido en **Claro**
y su negativo, tinta sumi, en **Oscuro** (ver «Qué cambia en 0.7»). Los colores
claros salen de la fuente
única de InkShadow (`design/tokens.json`): `chrome/palette.css` y
`start/palette.css` se generan con `python3 tools/design_tokens.py --kitsune
~/Projects/kitsune` desde el repo de InkShadow y no se editan a mano.

| Token | Color | Uso |
|---|---|---|
| papel | `#f6f5f1` | fondo de páginas e inicio |
| elevado | `#fbfaf7` | pestaña activa, barra de navegación, paneles |
| lavado | `#e8ece4` | tira de pestañas |
| tinta | `#252d2b` | texto y logo |
| secundario | `#59625c` | texto apagado |
| línea | `#c7cdc4` | bordes |
| óxido | `#963d32` | acento, cierre, foco |
| óxido suave | `#eadfda` | selección |
| jade | `#496b60` | modo privado y enlaces |
| apagado | `#73786f` | iconos secundarios |
| hanko | `#a8432f` | reservado para marcas de la familia InkShadow |
| bermellón | `#db452e` | reservado para marcas de la familia |

Las páginas internas y el módulo nativo usan solo los diez primeros.

Tipografías: Noto Sans en la interfaz y Noto Serif en títulos, saludo y «kitsune».

## Qué cambia en 0.7

- **Sin rastro de Mozilla.** Ni políticas de empresa (fuera «Tu navegador está
  gestionado por tu organización»: sus ajustes van ahora en el bloque «identidad» de
  `kitsune.cfg`), ni Sync ni cuentas de Mozilla, ni temas de Firefox (Alpenglow, Dark,
  Light), ni marcadores de Mozilla en perfiles nuevos, ni Firefox View, Relay, VPN,
  Monitor, Pocket, recomendaciones o mensajes, ni notificaciones push (pasaban por un
  servidor de Mozilla). La receta del motor (`rebrand_source`) pone nombres propios
  donde Gecko muestra sus marcas (Kitsune Home, Kitsune Translations, «extension
  store»…), oculta sus enlaces «Más información» y el menú Ayuda solo deja Modo de
  solución de problemas, Información técnica y Acerca de Kitsune. Los enlaces de ayuda
  que quedan llevan a la **ayuda de Kitsune** (`/ayuda/…` del inicio local, en español).
  uBlock Origin viene de serie en `distribution/extensions` (firmado), sin políticas.
  `tools/mozilla_audit.py --check` lo comprueba con el motor real: texto visible en las
  páginas internas, menú Ayuda y conexiones en reposo. Se quedan, por necesarias: la
  tienda de extensiones (instalar, actualizar, firmas, lista de bloqueo), las listas de
  seguridad y de rastreadores (Remote Settings), los códecs de vídeo (OpenH264/Widevine),
  los avisos legales de la licencia (`about:license`), la página técnica `about:support`
  y el «Mozilla/5.0 … Firefox/157.0» del agente de usuario, que las webs necesitan.
- **Mascota de Kitsune.** Un zorrito kitsune de papel, tinta y óxido
  (`tools/mascot/generate.py` → `install/mascot/`) sustituye a los 55 zorros de Firefox
  del motor (panel de protección, páginas de error, contraseñas, privacidad…) en cinco
  poses: guardia, preocupado, dormido, hola y cara, más su cola; los logos de Firefox
  pasan a ser el de Kitsune.
- **Ventana.** «Tu inicio» → Apariencia → Ventana: botones de cerrar y ampliar a la
  izquierda o a la derecha, y mostrar u ocultar el logo «KITSUNE» de la barra (control
  de apariencia v4, en directo).
- **Logo del inicio en dos capas:** al abrir y al pasar el ratón gira el ensō; la
  máscara del zorro se queda quieta.

- **Modo oscuro.** «Tu inicio» → Apariencia → Tema: Claro (papel) u Oscuro (sumi:
  `#161a19` de fondo, `#ebe8e0` de texto, óxido `#e0806b` y jade `#8fb8aa`, con
  los mismos contrastes AA que el papel). Se guarda por perfil y llega a la ventana
  abierta sin reiniciar: el módulo nativo publica `--kb-scheme` (el CSS usa
  `color-scheme: var(--kb-scheme, light)`) y fija `ui.systemUsesDarkTheme`, así que
  menús, ajustes y las webs que tienen modo oscuro también se ponen oscuros (también
  en Estricto). `browser.theme.*` ya no va en `user.js`: Gecko lo deja en «como el
  sistema». Los logos tienen variante en negativo (`*-dark.svg`, de
  `tools/logo/generate.py`).
- **Fondo propio.** Apariencia → Fondo → «Elegir imagen» (PNG, JPEG o WebP, hasta
  12 MB). El inicio lo reduce a un JPEG de 2560×1600 como mucho, sin metadatos, y lo
  guarda en `<perfil>/chrome/kitsune-background-<sha256>.jpg`; el navegador solo
  recibe el hash. Se ve en el inicio y en la nueva pestaña bajo un velo del color de
  fondo. «Quitar fondo» borra el archivo.
- **Fondos de serie.** Debajo de «Elegir imagen»: «Original» (el fondo liso de
  siempre) y 51 fondos de la nueva pestaña de Gecko (abstractos, espacio, fotos de
  Unsplash con su autor y colores). `install/wallpapers.py sync` (lo llama
  `install.sh`) lee el catálogo del propio motor (`newtab-wallpapers-v2.json` en
  `browser/omni.ja`), descarga cada imagen una vez del CDN de Mozilla, la acepta solo
  si coincide con el sha256 y el tamaño del catálogo y la guarda normalizada en
  `~/.local/share/kitsune-browser/wallpapers/`. La categoría con la marca Firefox no
  se usa. Sin conexión quedan «Original» y «Elegir imagen».
- **La pestaña nueva es el inicio de Kitsune.** El módulo nativo pone el inicio local
  del perfil (`browser.startup.homepage`) como pestaña nueva, con la barra de
  direcciones vacía y enfocada; ya no aparece la página de Gecko ni su panel de
  fondos. Una extensión que cambie la pestaña nueva sigue mandando.
- **Webs en oscuro.** Al cambiar de tema (y la primera vez), «Apariencia de las webs»
  vuelve a automático: un «Claro» guardado de antes ya no deja Google en claro.
- **Estricto ⇄ Cómodo desde la ficha del perfil.** Perfiles → el perfil → Privacidad:
  Estricto | Cómodo, sin entrar en Editar. Al cambiar sale una ventana breve con lo
  que hace cada modo y lo que supone el cambio (Aceptar / Cancelar); en Editar, el
  mismo aviso y Cancelar devuelve la opción. Se aplica al volver a abrir Kitsune.
- **Icono de pestaña** del inicio en negativo en Oscuro (`favicon-dark.svg`).
- **Pie del inicio limpio.** Fuera «狐 Kitsune · Tinta» de abajo a la izquierda; solo
  quedan Enfoque y Atajos.
- Control de apariencia v3 (`theme`, `background`); el motor sigue aceptando el v2.

## Qué cambia en 0.6

- **Motor propio.** `install/kitsune-engine.py` descarga el código de Gecko de
  `archive.mozilla.org`, exige la firma de la clave de versiones de Mozilla
  (`14F2 6682 D091 6CDD 81E3 7B6D 61B7 B526 D98F 0353`, fijada en el código) y el
  SHA-512 firmado, compila Kitsune con su identidad (`kitsune`, `--with-branding`
  propio, sin actualizador de Mozilla ni informe de fallos) y lo instala en
  `~/.local/share/kitsune-browser/engine/<versión>-<huella>/`. Solo se activa
  (`engine/current`) tras una prueba de humo sin ventana.
- **Actualización automática.** `kitsune-engine-update.timer` comprueba cada día
  la versión estable de Gecko y, si hay una nueva, compila con prioridad mínima de
  CPU y disco y avisa al terminar. La ventana abierta sigue con su motor; la
  siguiente apertura usa el nuevo. Se guardan el motor activo y el anterior.
  `kitsune-browser --actualizar-motor` y `--estado-motor` lo hacen a mano.
- **Modos de privacidad por perfil**, en Perfiles → Editar: **Estricto** (el de
  siempre: borra cookies y sesiones al cerrar salvo Google si lo pides, HTTPS
  obligatorio, bloqueo estricto, anti-huella) y **Cómodo** (conserva sesiones,
  bloqueo estándar, rompe menos webs). Ninguno envía telemetría.
- **Sin LibreWolf.** El lanzador ya no copia `/usr/lib/librewolf` ni lo usa como
  último recurso; «Sincronizar» abre el panel nativo de Firefox Sync.

## Qué cambia en 0.5

- **Logo nuevo:** un ensō de pincel con la máscara kitsune dentro. Se genera de
  forma determinista con `tools/logo/generate.py` (la textura de pincel va en la
  geometría, sin filtros) y de ahí salen el icono, el favicon, la marca de la barra
  y los iconos del escritorio. A 16 y 32 px la máscara va llena de tinta.
- **Indicador de carga:** en las pestañas que cargan solo gira el ensō; la máscara
  queda quieta. Con movimiento reducido el anillo late en vez de girar.
- **Barra del navegador:** tira de pestañas en lavado, pestaña activa de papel con
  un trazo óxido de pincel arriba, barra de direcciones de papel, botones de
  ventana óxido y gris, modo privado en jade.
- **Páginas internas:** nueva pestaña, ajustes, complementos, descargas,
  protecciones y modo lectura en papel, con los tokens de Gecko 154 (acento,
  botones, foco y enlaces) llevados a óxido y jade. Las páginas de error de
  seguridad no se tocan.
- **Inicio «B · Caligrafía»:** logo grande, «Bienvenido, {perfil}» en serif, fecha
  y hora en una línea, buscador de papel con botón de tinta y accesos como sellos
  hanko que alternan óxido y tinta. Al abrir, la tinta se posa (≤ 400 ms).
  Personalizar inicio → Apariencia solo ofrece las animaciones suaves.
- Fuera la ilustración Nightfall, los cuatro fondos, los acentos y la
  sincronización con la paleta del escritorio: el tema ya no cambia con caelestia.
- Se mantienen perfiles, fotos, «Recordar sesión de Google», búsqueda Google,
  modos de búsqueda, accesos editables, modo enfoque, atajos y movimiento reducido.

La nueva pestaña nativa conserva su propio buscador Google. La página de inicio
personalizable se abre con `Alt+Inicio`, o con la acción
«Abrir Kitsune Home» del lanzador. Sus accesos no reemplazan los marcadores
nativos. La integración Kitsune → Vela → Yomi conserva las mismas rutas.

## Controles propios de la ventana

El marco de Kitsune usa los botones **nativos de Gecko**, integrados a la
izquierda de las pestañas: cierre óxido y maximizar/restaurar gris, con puntos
de 12 px y zonas de pulsación de 26 × 28 px. No son controles de una página web
ni una superposición global. Conservan las etiquetas traducidas, los comandos
del navegador y las reglas de visibilidad de sus barras. Minimizar no se ofrece
en este diseño para Niri, que no tiene ese estado. Pantalla completa sigue en
`F11` y en el menú nativo; no se simula un tercer botón de pantalla completa.

`chrome/window-controls.css` contiene solo presentación;
`browser.tabs.inTitlebar = 1` solicita la decoración propia. Los cambios de
`userChrome.css` se cargan al cerrar completamente y volver a abrir Kitsune:
no se reinicia la sesión del usuario automáticamente. La respuesta al comando
de maximizar depende del compositor; la prueba headless confirma el comando y
el estado de Gecko, **no** que Niri lo implemente. No se reemplaza por acciones
contra otra ventana enfocada ni por scripts privilegiados de remapeo.

El código de Niri 26.04 (`8ed0da4`), instalado en este equipo, sí implementa
la petición nativa de maximización para ventanas normales y flotantes. Esto
se verificó en su [handler de Wayland](https://github.com/YaLTeR/niri/blob/8ed0da4/src/handlers/xdg_shell.rs#L376)
y en la [gestión del workspace](https://github.com/YaLTeR/niri/blob/8ed0da4/src/layout/workspace.rs#L1323);
la negociación y el resultado visible de Kitsune en esa sesión Wayland quedan
pendientes de comprobar al reabrir el navegador.

## Perfiles, cuentas y sincronización

El avatar de la esquina superior derecha abre el gestor. «Nuevo perfil» crea
un espacio limpio, sin copiar cookies, contraseñas o historial del original.
Seleccionar una tarjeta solo muestra sus detalles; «Cambiar a este perfil»
abre su ventana real. La ventana anterior conserva su identidad. El perfil
predeterminado se aplica a posteriores aperturas y enlaces externos.

El correo del perfil es una etiqueta local: no verifica identidad ni inicia
sesión en una cuenta. «Cuenta de Google» abre directamente el sitio oficial
de Google en el perfil elegido. Kitsune no añade un formulario de contraseña
propio ni guarda credenciales en el JSON del inicio.

Para conservar Google, activa Perfiles → Editar → «Recordar sesión de Google»
antes de iniciar sesión. En esta actualización se activa en el perfil Personal
original a petición del usuario, no en los demás. Aplica la excepción nativa
`persist-data-on-shutdown` solo a Google (`google.com` y `accounts.google.com`),
no el permiso general para aceptar cookies. La limpieza del resto de sitios
permanece activa. Al desactivar, retira solo las excepciones añadidas por Kitsune,
respetando las que ya fueran manuales. Si los datos anteriores se borraron,
hay que iniciar sesión de nuevo; ni el nombre ni el correo pueden recuperarlos.
El estado confirma la política de conservación, no que Google haya autenticado
la cuenta. Google también puede cerrar una sesión por sus propias reglas.
Las ventanas privadas siguen siendo temporales.

«Sincronizar entre dispositivos» guía hacia Firefox Sync, disponible de serie
en el motor propio: iniciar sesión con una cuenta Mozilla y elegir los datos que
se compartirán. Nada se sincroniza sin iniciar sesión. «Continuar con Google» abre el acceso oficial de
Mozilla, donde puede elegirse Google como identidad. Sync puede pedir crear
una contraseña de Mozilla para cifrar los datos; la contraseña de Google no
se comparte con Kitsune ni Mozilla. No conecta con Chrome Sync.
[Google como identidad de Mozilla y el requisito de contraseña de Sync](https://support.mozilla.org/en-US/kb/why-cant-i-use-firefox-sync-my-google-or-apple-id).
El servicio de sincronización
es de Mozilla y cifra los datos de extremo a extremo; no es un servidor propio
de Kitsune. [Funcionamiento de Sync](https://support.mozilla.org/en-US/kb/sync).

Nada se sincroniza automáticamente por crear un perfil. La lista de perfiles,
el correo usado como etiqueta y la personalización del inicio siguen siendo
locales; no se presenta esa información como sincronizada. Las cookies y sesiones
web tampoco se convierten en sesiones compartidas entre equipos. La activación
del gestor de contraseñas y una contraseña principal se deciden desde sus
ajustes nativos, no desde la página de inicio.

Los perfiles separan contextos de navegación, pero no son una barrera frente
a otra persona que tenga acceso a la misma cuenta del sistema operativo.
Esta versión no ofrece borrado de perfiles, para evitar eliminar datos por
accidente desde el selector. Una cuenta única propia de todo el ecosistema
necesitaría un servicio de identidad y sincronización adicional; no se simula.

## Verificación

```sh
cd ~/Projects/kitsune
npm run check
python3 -m unittest discover -s tests -p '*_test.py'
python3 tools/privacy_modes.py --check
python3 tests/privacy_modes_native.py
npm run test:browser
npm run test:profiles-ui
npm run test:accounts
npm run test:profiles-native
npm run test:logo-motion
npm run test:settings-ui
python3 tests/header_native.py
python3 tests/window_chrome.py
python3 tests/appearance_native.py
python3 tests/native_branding_smoke.py
```

Las pruebas nativas usan por defecto el motor activo
(`~/.local/share/kitsune-browser/engine/current/kitsune`) con perfiles temporales.

Resultado 0.7 (10 de octubre de 2026), con el motor `157.0.1-9d145f908173`:
92 pruebas JS y 129 Python (fondo propio, fondos de serie y librería). Nativas:
`theme_native.py` 8/8 (Oscuro en directo en ventana, nueva pestaña y webs, también
con «Claro» guardado de antes; fondo propio y de serie visibles, comprobado en
píxeles; vuelta a Claro), `newtab_native.py` 2/2 (Ctrl+T y + abren el inicio),
`privacy_switch_native.py` 4/4 (ventana de Estricto/Cómodo con Aceptar y Cancelar),
apariencia 7, ajustes, cabecera y navegador.

Resultado 0.6 «motor propio» (10 de octubre de 2026), con el motor
`157.0.1-5d576f85e0ef` (Gecko 157.0.1, canal release, LTO thin para Rust):
85 pruebas JS y 115 Python (25 del motor, 4 de los modos); `privacy_modes.py --check`
al día (156 ajustes comunes y 64 por modo). Pruebas nativas superadas con perfiles
temporales: modos de privacidad 4/4 (Estricto reproduce 0.5 en los 220 ajustes
gestionados), navegador 19, marca 6, cabecera 9, perfiles nativos 8, apariencia 7,
animación del logo 4, cuentas, ajustes, perfiles visuales, controles de ventana y
fotos. `tools/profile_upgrade_trial.py` abrió una copia del perfil real con el
motor propio, sin red: 1213 entradas de historial, uBlock Origin y Phantom activas,
Google normal y privado y Estricto aplicado. Con Sync disponible aparece el botón
de cuenta nativo en la barra; a 500 px la barra de direcciones conserva ~90 px.

Resultado 0.5 «Tinta» (3 de octubre de 2026): 78 pruebas JS y 83 Python; 12 pruebas
nativas superadas, todas con perfiles temporales (navegador, ajustes, apariencia
con el motor 0.5, animación, cabecera, controles de ventana, marca, perfiles,
cuentas, persistencia, fotos y apertura nativa de perfiles). Las pruebas de CSS
exigen que el chrome, las páginas internas y el inicio usen solo los tokens de
papel (y las tintas de perfil en el inicio), que los paneles nativos, la nueva
pestaña (Nova) y la navegación privada no conserven el azul o el violeta de Gecko,
y que los recursos del logo coincidan byte a byte con lo que genera
`tools/logo/generate.py`.

La cobertura de 0.4 añade pruebas de migración v1/v2, fotos, revisiones y errores
de guardado, preferencias de apariencia y política nativa de Google. Las
pruebas de `appearance_native.py` recorren API HTTP
real → archivo local validado → módulo nativo → cierre y reinicio. Comprueban
también el tema en pestañas ya abiertas, cambios del escritorio sin Home abierto,
y que las páginas web normales no reciben los estilos internos. No usan cuentas
Google reales. Los informes de 0.4 están separados de los históricos siguientes.

Resultado 0.4: 57 pruebas JS, 75 Python y 20 de integración con Vela; 20
comprobaciones generales de navegador, 12 de fotos, 11 de perfiles visuales,
11 de ajustes, 11 de animación, 8 de IPC/perfiles nativos, 7 de apariencia y
conservación tras reinicio y 7 de integridad de marca/recursos superadas.
Se comprobó también activar Sync y reiniciar, sin iniciar sesión en cuentas reales.
Instalación abierta normalmente y confirmación nativa de conservación de Google
en Personal recibida; preferencias existentes y buscador conservados.

Resultados históricos de 0.3 (12 de septiembre de 2026): 29 pruebas unitarias de JavaScript,
48 de Python (servicio, perfiles y recursos de marca), 20 comprobaciones del
navegador real, 11 del gestor visual de perfiles, 7 de marca/paneles y 8 de
apertura y aislamiento con dos ventanas nativas superadas.
También pasan las 19 pruebas de la integración con Vela, ahora multiperfil.
Evidencias y capturas de la versión 0.3: `tests/evidence/nightfall-0.3-2026-09-12/`.
El gestor visual se documenta en `tests/evidence/profiles-2026-09-12/` y la marca
en `tests/evidence/branding-2026-09-12/`. Las pruebas de apertura real por perfil
están en `tests/evidence/profiles-native-2026-09-12/`, separadas de las pruebas
de UI que simulan el despacho de ventanas. La activación nativa de Sync y su
reinicio se comprobaron en `tests/evidence/accounts-2026-09-12/`; no se inició
sesión ni se comprobó una sincronización entre cuentas o dispositivos reales.
La animación del logo se comprueba aparte en
`tests/evidence/logo-motion-2026-09-12/`, con avance real de fotogramas,
ratón, teclado, guardado de la opción de movimiento y movimiento reducido.
Se verificaron los tamaños 1540, 1024 y 390, la persistencia tras reiniciar y
los errores de guardado sin perder el borrador ni mostrar cambios no guardados.
Google recibió la consulta de prueba, pero respondió con una verificación
antibot; no se intentó eludirla ni se da por comprobada la página de resultados.

Las pruebas nativas usan perfiles nuevos y servidores de descarga en loopback.
No copian cookies, contraseñas, historial ni sesiones del usuario. Los detalles
del controlador, su procedencia y las comprobaciones están en `tests/README.md`.

La migración de búsqueda se prepara con `install/migrate-google.py`: solo copia
el archivo de búsqueda a un perfil temporal, lo modifica con la API del propio
navegador y verifica su integridad en un segundo perfil y tras otro reinicio.
No introduce preferencias de automatización en el perfil instalado. La migración
se aplica una vez y no impide cambiar de buscador más adelante.

El inicio original se sirve en `http://127.0.0.1:49721/` mediante
`kitsune-home.service`. Los demás perfiles usan puertos distintos del mismo
loopback, con una instancia `kitsune-home@<id>.service` por perfil. No se expone
ningún servidor a la red local o Internet. Los ajustes se guardan en un JSON privado bajo
`~/.local/state/kitsune-browser/`, fuera de las cookies y del almacenamiento
que Kitsune limpia al cerrar en modo Estricto. No se relajan el aislamiento de archivos ni
la sanitización de sitios. La API valida origen, cabecera Host, un token de
sesión y revisiones para evitar sobrescribir cambios de otra pestaña.
El servicio espera a tener el puerto preparado antes de abrir el inicio.
Las ventanas se lanzan en unidades de usuario independientes: reiniciar el
servidor del inicio no cierra el navegador ni le transmite sus restricciones
de red. Las operaciones del registro usan bloqueo entre procesos y revisiones.

El puente con Vela consulta solo los IDs de perfiles registrados y sus metadatos
de descargas terminadas. No copia datos de navegación entre perfiles; una sola
cola deduplica las entregas del mismo archivo.

El JavaScript se compila como script clásico, por lo que el inicio de emergencia
`file://` también funciona con el aislamiento de archivos activado. En ese
modo la búsqueda funciona, pero la personalización necesita el servicio local.
Con la gestión de perfiles instalada, un fallo de su servicio detiene la
apertura en lugar de redirigir accidentalmente al inicio de otro perfil.

## Marca y actualizaciones del motor

El motor de Kitsune se compila con su marca (`install/branding/`), sus iconos y un
módulo nativo propio (`install/native/`) dentro de `omni.ja`; ya no se parchea el
binario de otro navegador. El módulo solo lee colores/opciones validados de un archivo privado y aplica
estilos a páginas internas y la opción enumerada de conservación de Google.
No abre puertos, recibe código de páginas web ni ejecuta CSS/URLs arbitrarios.
El servicio y el módulo intercambian un acuse con huella y caducidad para no
mostrar como aplicado un cambio pendiente. Desde 0.5 el archivo de control es la
versión 2 (`{version, palette, motion, googleRemember, fingerprint}`, siempre con la
paleta de papel); un archivo antiguo se rechaza sin aplicar nada. Los PNG de marca
son conversiones deterministas de los SVG generados por `tools/logo/generate.py`.
El agente de usuario sigue siendo el estándar de Firefox (no menciona Kitsune) y
la firma de extensiones sigue siendo obligatoria. Su acuse incluye también el
modo de privacidad que aplicó el motor al arrancar.

Junto al ejecutable, `kitsune-engine.py` instala `distribution/policies.json`
(sin telemetría, estudios, actualizador de Mozilla ni contenido patrocinado; uBlock
Origin en perfiles nuevos), `defaults/pref/autoconfig.js` y `kitsune.cfg`. Este
último aplica el modo que el lanzador pasa en `KITSUNE_PRIVACY_MODE` (lo guarda
`~/.local/state/kitsune-browser/privacy.json`, aparte del registro de perfiles,
que sigue en v2 para el puente de Vela). Gecko lee `prefs.js` y `user.js` antes
que `kitsune.cfg`, así que los valores de cada modo son valores por defecto: los
cambios manuales se respetan y solo al cambiar de modo se limpian una vez los
ajustes gestionados. Los conjuntos los genera `tools/privacy_modes.py` a partir de
mediciones con perfil limpio (`tests/fixtures/`): Estricto es exactamente lo que
hacía 0.5 (LibreWolf 154 + su `user.js`).

El inicio está separado en módulos de estado, apariencia, accesos, diálogos,
acciones nativas, perfiles y fotos. El estado usa revisiones y una cola de
guardado que combina cambios independientes entre pestañas. El backend separa
HTTP, registro de perfiles, medios y apariencia. No se cargan módulos remotos.

El lanzador solo ejecuta `engine/current/kitsune`. Si no hay motor, lo dice y no
abre nada en su lugar. Compilar necesita ≈40 GB temporales en
`~/.cache/kitsune-build` (el script exige 50 GB libres) y las herramientas que
Mozilla descarga en `~/.mozbuild`; no hace falta sudo. Si falta `unzip`, se usa un
sustituto mínimo con `zipfile` de Python. Una receta nueva sobre la misma versión
de Gecko recompila de forma incremental. Si cambia el punto de entrada de la
ventana o del diálogo Acerca de en una versión futura, la compilación se detiene y
se sigue con el motor anterior. Estado y registros: `kitsune-browser --estado-motor`
y `~/.local/state/kitsune-browser/engine/`.

## Instalación existente y copia de seguridad

- Motor: `/home/risco/.local/share/kitsune-browser/engine/current` (el activo y el
  anterior; los compila `kitsune-engine.py`, su estado en
  `~/.local/state/kitsune-browser/engine/` y la compilación en `~/.cache/kitsune-build`).
- Modos de privacidad: `/home/risco/.local/state/kitsune-browser/privacy.json`.
- Perfil conservado: `/home/risco/.local/share/kitsune-browser/profile`.
- Inicio: `/home/risco/.local/share/kitsune-browser/start`.
- Ajustes locales: `/home/risco/.local/state/kitsune-browser/home.json`.
- Lanzador: `/home/risco/.local/bin/kitsune-browser`.
- Copia completa previa a 0.5: `/home/risco/.local/share/kitsune-0.5-backup.VzI1GN`
  (perfil, inicio, plantillas, estado, lanzador y servicios; el motor no se copia
  porque las versiones anteriores siguen en `runtime/`).
- Copia completa previa a 0.4: `/home/risco/.local/share/kitsune-0.4-backup.9KgDBM`.
- Copia previa a 0.3: `/home/risco/.local/share/kitsune-0.3-backup.JXUF2K`.
- Copia de los estilos previos al logo animado: `/home/risco/.local/share/kitsune-logo-backup.zmcq6K`.
- Copia previa a 0.2: `/home/risco/.local/share/kitsune-redesign-backup.n1vv7x`.

`sh install/install.sh` instala la versión de `install/version.json` cuando el motor propio ya está activo: guarda
antes en `~/.local/share/kitsune-0.6-backup.*` el inicio, las plantillas, los
módulos, el estado, el lanzador y los servicios; copia los módulos, la receta del
motor, el inicio y las plantillas; deja el `user.js` de cada perfil como la
plantilla más sus marcas `kitsune.migrations.*`; instala el lanzador y los
servicios y activa `kitsune-engine-update.timer`. El perfil no se copia ahí,
porque puede estar abierto: el lanzador lo copia **cerrado** en
`~/.local/share/kitsune-0.6-profile-backup.*` justo antes de que el motor propio lo
abra por primera vez (un Gecko más nuevo actualiza el perfil y uno más antiguo ya no
puede abrirlo). Los valores de privacidad que el `user.js` de 0.5 dejó en `prefs.js`
coinciden con Estricto y se conservan.

Con el motor propio activo ya no hacen falta el paquete `librewolf`
(`sudo pacman -R librewolf`) ni las copias de `runtime/` (≈1,3 GB), que no se
borran solas.

La actualización 0.5 reemplaza el inicio, el chrome de la plantilla y del perfil,
el backend de apariencia, el módulo nativo, la marca y el lanzador, y prepara el
motor `154.0-2-kitsune4`. El `user.js` del perfil pasa a ser el de la plantilla
(tema claro) más las marcas `kitsune.migrations.*` que ya tenía; el buscador, las
extensiones, marcadores, historial, sesiones y la conservación de Google no se
tocan. La paleta deja de seguir a caelestia: `--sync-palette-only` queda como una
salida sin efecto para no romper llamadas antiguas.

La actualización 0.4 reemplazó el inicio, las hojas de estilo, el lanzador,
los servicios locales y el puente con Vela (compatible con el registro v2).
Actualiza las plantillas limpias y añade el módulo nativo de apariencia y
conservación de Google en la copia privada del motor. Conserva
el `user.js` y el archivo de búsqueda del perfil original: no restablece las
preferencias de seguridad ni el buscador elegido. Nunca reemplaza ese perfil
con uno de pruebas. Las extensiones, marcadores, historial y archivos
descargados se conservan; las sesiones web siguen las reglas de limpieza y
excepciones que el usuario ya tenga configuradas, más la conservación de Google
solicitada para Personal. Las sesiones borradas anteriormente no se recuperan.

El servidor y las fotos requieren Python 3 con Pillow (comprobado con Python
3.14 y Pillow 12.3 del equipo). La interfaz se compila con `npm run build`;
Node y el compilador no son necesarios para navegar con la app instalada.

## Logo

`tools/logo/generate.py` dibuja el ensō, la máscara kitsune, las capas del indicador
de carga, el trazo de la pestaña activa, la marca y el sello hanko del inicio sin
dependencias y de forma determinista: la textura de pincel se hornea en la geometría
(ruido de valor fijo), así que los SVG no llevan filtros y se ven igual en todas
partes. `python3 tools/logo/generate.py` reescribe los SVG y
`sh install/render-branding-assets.sh` los PNG. La ilustración Nightfall de 0.4 se
retiró con su fondo; sigue en el historial de git y en la copia previa a 0.5.

## Referencias técnicas

- [Búsqueda predeterminada de Gecko](https://firefox-source-docs.mozilla.org/toolkit/search/DefaultSearchEngines.html).
- [SearchService de Mozilla](https://searchfox.org/firefox-main/source/toolkit/components/search/SearchService.sys.mjs).
- [Opciones de prueba de geckodriver](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html).

El tema se comprobó contra la versión local del motor; futuras actualizaciones
pueden requerir ajustar selectores internos. No se afirma que un navegador quede
libre de cualquier fallo por superar estas pruebas.
