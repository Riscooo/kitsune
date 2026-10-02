# Kitsune 0.4 · Nightfall

Rediseño de Kitsune sobre el LibreWolf instalado (Gecko 154.0-2). No es una
imitación con iframes: las pestañas, extensiones firmadas, navegación, permisos,
certificados, marcadores, descargas y herramientas de desarrollo siguen siendo
las funciones nativas del navegador.

## Qué cambia

- Inicio más limpio, con reloj y accesos que se pueden desactivar por separado.
  Personalización en tres secciones: Apariencia, Módulos y Navegación. Los
  botones de configuración abren ajustes reales del perfil elegido.
- Cuatro fondos. «Combinar tema y fondo» aplica una paleta legible al inicio,
  barra y pestañas internas ya abiertas. Desactivado, conserva el color manual
  o sigue el escritorio en directo, incluso sin tener abierto el inicio.
- Fotos de perfil locales PNG/JPEG/WebP, recortadas a 256 px y guardadas como
  PNG sin metadatos. No se envían a servicios externos. Se pueden quitar y
  recuperar las iniciales sin cambiar las sesiones del perfil.
- «Recordar sesión de Google» por perfil, con confirmación del navegador y
  persistencia comprobada tras cierre completo usando cookies ficticias.
- Marco oscuro, pestañas redondeadas, barra de direcciones despejada, paneles y
  modo privado diferenciados. Sin barridos luminosos permanentes ni capas sobre
  los indicadores de seguridad.
- Inicio con ilustración nocturna original, búsqueda Google, modos de imágenes,
  vídeos y mapas, direcciones web reales y acceso a servidores localhost.
- Accesos locales editables, validación de URL, personalización de acento y fondo,
  modo enfoque, diálogos accesibles, navegación de teclado y movimiento reducido.
- Google como búsqueda nativa normal y privada. Se repara el motor antiguo que
  tenía `?{searchTerms}` en lugar de `?q={searchTerms}`; las preferencias obsoletas
  que no seleccionaban realmente el motor se eliminan.
- Launcher con rutas correctamente codificadas
  y argumentos separados. Asociaciones MIME en la sección correcta del `.desktop`.
- Selector de hasta 24 perfiles reales: nombre, correo como etiqueta local,
  foto o avatar de color, edición, apertura independiente y perfil predeterminado.
  Cada perfil mantiene su propio inicio, historial, sesiones y marcadores.
- Títulos, logotipos internos y menú de información identificados como Kitsune.
  Los títulos originales de las webs no se alteran. Se conservan los créditos
  del motor, las licencias y la identidad técnica utilizada por los sitios.
- Panel de extensiones corregido para los tokens actuales de Gecko 154:
  superficie oscura y bordes redondeados, sin tapar avisos ni permisos.
- Logo con flotación suave y reacción al pasar el ratón, tanto en el inicio
  personalizable como en la nueva pestaña nativa. Conserva el dibujo y los
  iconos estáticos de pestañas/escritorio; no añade scripts ni recursos externos.
  Respeta el movimiento reducido del sistema. En el inicio también se puede
  desactivar desde Personalizar inicio → Animaciones suaves.

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
[Documentación de LibreWolf](https://librewolf.net/docs/faq/#how-do-i-stay-logged-into-specific-websites).

«Sincronizar entre dispositivos» guía hacia Firefox Sync: habilitarlo,
reiniciar si se solicita, iniciar sesión con una cuenta Mozilla y elegir los
datos que se compartirán. «Continuar con Google» abre el acceso oficial de
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
cd outputs/kitsune
npm run check
python3 -m unittest discover -s tests -p '*_test.py'
npm run test:browser
npm run test:profiles-ui
npm run test:accounts
npm run test:profiles-native
npm run test:logo-motion
```

La cobertura de 0.4 añade pruebas de migración v1/v2, fotos, revisiones y errores
de guardado, preferencias de apariencia y política nativa de Google. Las
pruebas de `appearance_native.py --browser <motor-Kitsune>` recorren API HTTP
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
que LibreWolf limpia al cerrar. No se relajan el aislamiento de archivos ni
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

`install/prepare-runtime.py` genera una copia privada y versionada del motor
instalado, con recursos de marca, iconos y un módulo nativo propio de Kitsune.
El módulo solo lee colores/opciones validados de un archivo privado y aplica
estilos a páginas internas y la opción enumerada de conservación de Google.
No abre puertos, recibe código de páginas web ni ejecuta CSS/URLs arbitrarios.
El servicio y el módulo intercambian un acuse con huella y caducidad para no
mostrar como aplicado un cambio pendiente. Los PNG de marca son
conversiones deterministas del SVG de Kitsune; no se generó una ilustración nueva.
Los ejecutables, las políticas de seguridad, el agente de usuario y la identidad
interna de Gecko se mantienen. `/usr/lib/librewolf` no se modifica.

El inicio está separado en módulos de estado, apariencia, accesos, diálogos,
acciones nativas, perfiles y fotos. El estado usa revisiones y una cola de
guardado que combina cambios independientes entre pestañas. El backend separa
HTTP, registro de perfiles, medios y apariencia. No se cargan módulos remotos.

El lanzador detecta los cambios del motor instalado y prepara una copia nueva
antes de abrirlo. No sustituye silenciosamente una actualización fallida por
una versión antigua. La copia ocupa aproximadamente 425 MB por versión; las
anteriores se conservan por seguridad. Actualizar el motor base sigue siendo
responsabilidad del gestor de paquetes del sistema.

## Instalación existente y copia de seguridad

- Perfil conservado: `/home/risco/.local/share/kitsune-browser/profile`.
- Inicio: `/home/risco/.local/share/kitsune-browser/start`.
- Ajustes locales: `/home/risco/.local/state/kitsune-browser/home.json`.
- Lanzador: `/home/risco/.local/bin/kitsune-browser`.
- Copia completa previa a 0.4: `/home/risco/.local/share/kitsune-0.4-backup.9KgDBM`.
- Copia previa a 0.3: `/home/risco/.local/share/kitsune-0.3-backup.JXUF2K`.
- Copia de los estilos previos al logo animado: `/home/risco/.local/share/kitsune-logo-backup.zmcq6K`.
- Copia previa a 0.2: `/home/risco/.local/share/kitsune-redesign-backup.n1vv7x`.

La actualización 0.4 reemplaza el inicio, las hojas de estilo, el lanzador,
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

## Ilustración

Generada con la herramienta integrada de imágenes, sin API externa configurada
por el usuario. Archivo final: `start/kitsune-night.png`, copiado también a
`chrome/assets/kitsune-night.png`. Prompt de producción en `ARTWORK.md`.

## Referencias técnicas

- [Búsqueda predeterminada de Gecko](https://firefox-source-docs.mozilla.org/toolkit/search/DefaultSearchEngines.html).
- [SearchService de Mozilla](https://searchfox.org/firefox-main/source/toolkit/components/search/SearchService.sys.mjs).
- [Opciones de prueba de geckodriver](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html).

El tema se comprobó contra la versión local del motor; futuras actualizaciones
pueden requerir ajustar selectores internos. No se afirma que un navegador quede
libre de cualquier fallo por superar estas pruebas.
