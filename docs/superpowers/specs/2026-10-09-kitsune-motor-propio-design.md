# Kitsune 0.6 — motor propio — diseño

Fecha: 2026-10-09 · Estado: diseño aprobado por Risco por partes en conversación; pendiente de revisar este texto.

## Objetivo

Que Kitsune sea 100 % independiente de LibreWolf: que funcione, se actualice y se pueda usar con el paquete
`librewolf` desinstalado. Kitsune pasa a ser un fork propio de Gecko, compilado en el PC de Risco desde el
código fuente oficial de Mozilla con su identidad, marca y configuración de privacidad propias, en lugar de
una copia con marca del LibreWolf instalado.

Hoy el lanzador copia `/usr/lib/librewolf` en `runtime/` en cada actualización del paquete y lo parchea
(`prepare-runtime.py`), con `exec /usr/bin/librewolf` como último recurso. Sin el paquete, Kitsune no abre.
Además, el paquete de `extra` sigue en 154 mientras Gecko estable va por 157.0.1.

Fuera de alcance: un motor escrito desde cero o distinto de Gecko (Servo); interfaz nativa en español
(se compila en-US, como se ve hoy con `LANG=en_US.UTF-8`; se puede añadir es-ES después); cambiar la
estética «Tinta», los perfiles, el inicio o la integración con Vela; parches propios al código de Gecko
más allá de la integración del módulo nativo.

## Decisiones de Risco

- Motor: fork propio compilado desde el código de Gecko (no el tarball de LibreWolf ni el binario de Firefox).
- Actualizaciones: automáticas, en segundo plano, con prioridad baja y aviso al terminar.
- Privacidad: dos modos seleccionables en el PC, **Estricto** (como ahora) y **Cómodo**, por perfil.

## 1. Fabricación del motor (`install/kitsune-engine.py`)

Script Python con subórdenes, en el estilo de `install/*.py`: `check`, `build [--version V] [--if-new]`,
`current`, `status`, `prune`. Un bloqueo `flock` en el estado impide dos compilaciones a la vez.

**Origen y verificación.** Descarga de `archive.mozilla.org/pub/firefox/releases/<v>/`:
`source/firefox-<v>.source.tar.xz`, `SHA512SUMS` y `SHA512SUMS.asc`. Verifica la firma con un
`GNUPGHOME` temporal y privado, y exige en `--status-fd` un `VALIDSIG` cuya clave primaria sea
`14F26682D0916CDD81E37B6D61B7B526D98F0353` (Mozilla Software Releases), fijada en el código: el `KEY`
del servidor no aporta confianza. Después compara el SHA-512 del tarball con su línea en `SHA512SUMS`.
Si algo no cuadra, se detiene sin extraer nada. La versión debe casar con `^\d+\.\d+(\.\d+)?$`.

**Identidad propia, compilada dentro.**
- Marca `browser/branding/kitsune/`, creada a partir de `browser/branding/unofficial` de la misma versión:
  nombre «Kitsune» en `brand.ftl` y `brand.properties`, iconos y logos de `install/branding/`
  (los mismos PNG/SVG que generan `tools/logo/generate.py` y `render-branding-assets.sh`).
- `mozconfig` propio (valores comprobados contra el `moz.configure` de cada versión): `--enable-application=browser`,
  `--with-app-name=kitsune`, `--with-app-basename=Kitsune`, `--with-branding=browser/branding/kitsune`,
  `--enable-release`, `--enable-optimize`, `--disable-debug`, `--disable-tests`, `--disable-updater`,
  `--disable-crashreporter`, `--enable-bootstrap`, `--with-ccache=sccache`; sin telemetría ni informes
  de datos (`MOZ_TELEMETRY_REPORTING`, `MOZ_DATA_REPORTING` desactivados). La firma de extensiones sigue
  siendo obligatoria.
- Módulo nativo: `kitsune-bootstrap.js` y `kitsune-appearance.sys.mjs` se añaden al código
  (`browser/base/content/` + `jar.mn`), y la línea de arranque se inserta en `browser.xhtml` con la misma
  comprobación que hoy (exactamente un punto de entrada; si cambia, la compilación se detiene y avisa).
- «Acerca de Kitsune»: crédito «basado en Mozilla Gecko».
- No cambian: el agente de usuario estándar de Firefox (no contiene «Kitsune») ni el ID de aplicación
  usado para compatibilidad de extensiones, para que uBlock Origin, Phantom y las webs sigan igual.

**Compilación.** Código y objetos en `~/.cache/kitsune-build/` (≈40 GB durante la compilación; el script
se niega a empezar con menos de 50 GB libres). Las herramientas las descarga `--enable-bootstrap` en
`~/.mozbuild` (sin sudo). Se usan `rustc`/`cargo` del sistema salvo que la versión de Gecko los rechace.
Tras una compilación correcta se borran el código y los objetos de versiones anteriores; se conserva la
caché de `sccache`. Registro de cada compilación en `~/.local/state/kitsune-browser/engine/`.

**Instalación del resultado.** `./mach package` → se extrae en
`~/.local/share/kitsune-browser/engine/<v>-k<rev>/` (`rev` = revisión de la receta de Kitsune, para
recompilar si cambia la receta aunque Gecko no cambie). En esa carpeta se añaden `distribution/policies.json`,
`defaults/pref/autoconfig.js` y `kitsune.cfg` (sección 3) y un `kitsune-engine.json` con versión, fecha,
huella del tarball y revisión.

**Prueba de humo antes de activar.** Arranque sin ventana con un perfil temporal y geckodriver:
`Services.appinfo.name == "Kitsune"`, versión esperada, módulo nativo cargado, políticas activas,
`kitsune.privacy.active` presente y agente de usuario sin «Kitsune». Si falla, el motor nuevo no se activa,
se conserva el actual y se avisa.

## 2. Arranque y actualizaciones

- `kitsune-browser` ejecuta `engine/current/kitsune --profile <perfil>`. `current` es un enlace simbólico
  que se cambia de forma atómica (enlace temporal + `rename`). Perfiles, servicio del inicio, acciones,
  `--home` y `MOZ_APP_REMOTINGNAME=kitsune-browser` no cambian.
- Sin motor compilado: no se abre ninguna copia antigua a escondidas; mensaje «El motor de Kitsune aún no
  está compilado» con la orden para compilarlo.
- `kitsune-engine-update.timer` (systemd de usuario, diario, `Persistent=true`) lanza
  `kitsune-engine-update.service`, que ejecuta `build --if-new` con `Nice=19`, `IOSchedulingClass=idle` y
  `CPUWeight=idle`. `check` lee `LATEST_FIREFOX_VERSION` de `product-details.mozilla.org/1.0/firefox_versions.json`.
- Al terminar, éxito o fallo, una notificación del escritorio (`notify-send`).
- El cambio de `current` no afecta a la ventana abierta: el proceso sigue usando su carpeta real hasta que
  se cierra Kitsune; la siguiente apertura usa el motor nuevo.
- Retención: el motor actual y el anterior. `prune` nunca borra un motor en uso (procesos cuyo
  `/proc/<pid>/exe` está dentro de esa carpeta) ni el que apunta `current`.
- Órdenes del lanzador: `--actualizar-motor` (compila ya) y `--estado-motor` (versión, fecha, última
  comprobación y resultado).
- Transición: hasta que el primer motor propio pase la prueba de humo, el lanzador instalado sigue usando
  la copia actual de `runtime/`. Se instala el lanzador nuevo solo con el motor propio ya activo.

## 3. Modos de privacidad

**Común a los dos modos** (`distribution/policies.json`): `DisableTelemetry`, `DisableFirefoxStudies`,
`DisableAppUpdate`, sin contenido patrocinado ni mensajes de Mozilla, `NoDefaultBookmarks`,
`DontCheckDefaultBrowser`, y uBlock Origin con `normal_installed` (solo afecta a perfiles nuevos; los
existentes ya lo tienen). Sync de Firefox disponible (lo activa el usuario al iniciar sesión).

**Estricto** (predeterminado; el de todos los perfiles existentes y nuevos): reproduce el comportamiento
efectivo actual. El conjunto no se escribe a ojo: se mide (fase 1) con el motor actual y un perfil limpio,
se compara con los valores de fábrica del motor propio, se descartan los ajustes propios de LibreWolf
(`librewolf.*`, URLs de soporte/marca) y el resultado se guarda como conjunto Estricto de `kitsune.cfg`.
Incluye, entre otros, limpieza de cookies y datos de sitios al cerrar (la excepción de Google la sigue
gestionando el módulo nativo), HTTPS obligatorio, bloqueo estricto, protección contra huella, WebGL
bloqueado y DRM desactivado.

**Cómodo:** las sesiones de todas las webs se conservan al cerrar, bloqueo de rastreadores estándar,
WebGL activo y DRM disponible si el gestor de complementos multimedia puede descargar Widevine (se
comprueba; si no puede, se documenta). Se mantienen sin telemetría y sin sugerencias de búsqueda remotas.

**Dónde se elige y cómo se aplica.**
- Inicio → Perfiles → Editar: selector Estricto / Cómodo junto a «Recordar sesión de Google». En Cómodo
  el interruptor de Google queda desactivado con la nota «En modo Cómodo las sesiones ya se conservan»
  (su valor guardado no se borra).
- El modo se guarda en `~/.local/state/kitsune-browser/privacy.json` (`{version: 1, modes: {id: modo}}`),
  escrito por `profiles.py` bajo el mismo bloqueo y en la misma operación de edición que el registro. El
  registro sigue en v2 porque el puente de Vela solo acepta las versiones 1 y 2. Perfil sin entrada → Estricto.
  Valores válidos: `estricto`, `comodo`.
- `profiles.py resolve` devuelve también `privacyMode`; el lanzador lo exporta como `KITSUNE_PRIVACY_MODE`.
- `kitsune.cfg` (autoconfig) lee esa variable al arrancar (valor desconocido o ausente → Estricto), aplica
  el conjunto del modo con `pref()` y deja `kitsune.privacy.active` con el modo aplicado.
- Cada ajuste gestionado tiene valor en los dos modos (explícito o `clearPref` a la fábrica), para que
  cambiar de modo no deje restos.
- El cambio vale al volver a abrir Kitsune (si ya hay una ventana, el lanzador solo le pasa la URL). El
  módulo nativo añade `privacyMode` (el activo) al acuse que ya escribe; el inicio muestra «Activo» o
  «Se aplicará al reiniciar Kitsune».
- `install/user.js` pierde los ajustes de privacidad que pasan a los modos; conserva apariencia, inicio y búsqueda.

## 4. Migración, limpieza y pruebas

**Migración.** Antes de instalar 0.6, copia completa en `~/.local/share/kitsune-0.6-backup.XXXX` (perfil
≈253 MB, inicio, estado, lanzador y servicios), como en versiones anteriores: tras abrir el perfil con
Gecko 157 ya no puede volver a abrirse con LibreWolf 154. La instalación se hace con Kitsune cerrado, con
el visto bueno de Risco. El buscador, extensiones, marcadores, historial, sesiones y la excepción de Google
no se tocan.

**Fuera los restos de LibreWolf.** Se eliminan `prepare-runtime.py`, `runtime_branding_test.py` y el
`exec /usr/bin/librewolf`. La acción `sync` pasa a `about:preferences#sync` (el panel `#librewolf` no
existe en el motor propio). `version.json`: `Kitsune 0.6.0 · Gecko <v>`. Se actualizan README,
`tests/README.md`, las pruebas que usan `/usr/lib/librewolf` y la skill `using-kitsune-browser`
(`kitsune_driver.py` y `SKILL.md` pasan a resolver `engine/current`).

**Sin preguntar no se toca:** el paquete `librewolf` (lo desinstala Risco con `sudo pacman -R librewolf`
cuando el motor propio esté activo) ni las tres copias de `runtime/` (≈1,3 GB), que solo se borran si
Risco lo confirma.

**Pruebas.**
- `kitsune-engine`: rechaza firma de otra clave, firma inválida, SHA-512 distinto y versiones mal formadas;
  no activa un motor que falla la prueba de humo; el cambio de `current` es atómico; `prune` no borra el
  motor en uso ni `current`; comparación de versiones (157.0.1 > 157.0 > 154.0).
- Modos: validación de `privacy.json` y de la edición; `resolve` devuelve el modo; los dos conjuntos de
  `kitsune.cfg` cubren las mismas claves; prueba nativa de que un valor viejo en `prefs.js` queda
  sustituido por el modo al arrancar y de que cambiar de modo y reiniciar invierte los valores.
- Auditoría: el conjunto Estricto se compara con la medición del motor actual guardada en
  `tests/fixtures/` (se toma ahora, con LibreWolf aún instalado, para que la prueba siga funcionando sin él).
- Lanzador: usa `engine/current`; sin motor, mensaje y salida con error; exporta `KITSUNE_PRIVACY_MODE`.
- Las pruebas nativas existentes (navegador, apariencia, perfiles, cuentas, controles de ventana, cabecera,
  marca) contra el motor propio, y una revisión visual del chrome en Gecko 157 (los selectores internos
  pueden haber cambiado desde 154).

## Fases

1. Auditoría de ajustes del motor actual → `tests/fixtures/`.
2. `kitsune-engine.py` (descarga, verificación, marca, mozconfig, compilación, instalación, prueba de humo,
   cambio, limpieza) con sus pruebas.
3. Primera compilación real (≈1 h) y pruebas nativas existentes contra el motor propio; ajustes de chrome.
4. Modos de privacidad: `kitsune.cfg`, `policies.json`, `privacy.json`, inicio, lanzador y acuse.
5. Lanzador nuevo, temporizador, limpieza de LibreWolf, README y skill.
6. Copia de seguridad e instalación con el visto bueno de Risco; después, Risco desinstala `librewolf` y
   decide sobre `runtime/`.

## Riesgos

- Compilar puede fallar por la cadena de herramientas (rust del sistema más nuevo que el probado por
  Mozilla): `--enable-bootstrap` cubre clang, cbindgen, nasm, node y el sysroot de wasm; si rust falla,
  se fija la versión que pida Gecko.
- Cada versión de Gecko puede mover selectores del chrome o el punto de entrada de `browser.xhtml`: la
  compilación se detiene con un aviso en vez de producir un Kitsune a medias, y se sigue con el motor anterior.
- Recompilar consume ≈20–60 min de CPU cada pocas semanas; con prioridad mínima no debería notarse.
