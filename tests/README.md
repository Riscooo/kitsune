# Kitsune native browser tests

## 0.4: appearance, Google retention and photos

Run `npm run check` and `npm run test:python` from `outputs/kitsune`.
The verified 0.4 baseline is 57 JavaScript tests, 75 Python tests, and 20
integration tests in `../kitsune-vela-integration/test_bridge.py`.

`python3 tests/appearance_native.py --browser <absolute-Kitsune-runtime>`
exercises real HTTP settings/profile writes, the private control file, the
packaged native module, and full browser restarts. Its seven checks verify live
native themes, desktop changes with Home closed, unmodified security controls,
no internal theme variables on ordinary websites, and Google-only retention.
Cookies have the explicit value `synthetic-test-only`; no real account data is
read or signed in. Google cookies persist when enabled, an unrelated fixture
cookie is cleared, and Google cleanup returns when the setting is disabled.
Mozilla's current cookie API takes expiry timestamps in milliseconds.

`python3 tests/profile_photos.py --browser <runtime>` covers twelve photo/UI
flows against the real profile and image backend: center crop, transparency,
metadata removal, persistence, removal, fallback initials, independent profiles,
late decoder cancellation, 409/503 and responsive layout. The Google native
acknowledgement is explicitly synthetic in this visual test; native behavior
is verified separately above. No real photos or accounts are copied.

`python3 tests/settings_panels.py --browser <runtime>` covers the modular
settings UI, actual persisted settings, appearance, modules, dispatch buttons,
cross-tab conflicts, reconnection and narrow layouts. Native-action dispatch
is recorded instead of opening remote sites; `profiles_native.py` separately
verifies the real launcher and desktop IPC.

The 0.4 native engine has **two product resource modules**, not an automation
endpoint. The module reads only its fixed private appearance file. GeckoDriver
and privileged testing flags remain confined to temporary test instances.
Branding tests compare non-allowlisted archive entries and compiled engine
files byte-for-byte with the installed upstream engine.

Evidence directories include `appearance-native-0.4-2026-09-12`,
`profile-photos-2026-09-12`, `profiles-0.4-2026-09-12`,
`profiles-native-0.4-2026-09-12`, `branding-0.4-2026-09-12`,
`accounts-0.4-2026-09-12`, and `nightfall-0.4-2026-09-12` under `evidence/`.
Sync activation/restart is tested, but no real Google/Mozilla login or
cross-device synchronization is claimed.

## General browser coverage

Run `python3 outputs/kitsune/tests/browser_smoke.py` from the workspace root.
`--probe` checks the native browser/search API without modifying search settings.
`--headed` displays the **temporary test instance**, never the user's instance.
`--online` sends one harmless search through the native address bar and reports
whether Google returned content, a consent page, or an anti-bot challenge. It
does not accept consent or attempt to solve challenges.

The harness uses Python, Pillow for local avatar fixtures, and Mozilla geckodriver. Each
run creates a fresh `/tmp/kitsune-browser-smoke-*` profile and download directory.
It copies only Kitsune's source theme, start-page assets and preference template;
it never imports real cookies, credentials, history, extensions or downloads.
A copy of the real start-page server listens on an ephemeral loopback port and
saves only test settings outside the disposable Firefox profile.
Evidence paths and assertions are written to the run's `evidence/report.json`.

Coverage includes real Gecko navigation/history, downloads with byte-for-byte
verification, native tabs and restore shortcut, visible native controls, Google
registration/repair, search terms with Unicode and punctuation, private search,
persistence after restart, and preserving a later user-selected search engine.
It also checks start-page quick-link CRUD, field validation, keyboard/dialog
behavior, preferences and focus mode, failed-save and failed-delete behavior,
Gecko layout at 1540/1024/390 pixels, console errors, a strict-origin file-page
fallback, and keeping start settings through a full browser restart while other
site/file data still undergoes normal shutdown cleanup.

## Driver provenance

- Mozilla release: <https://github.com/mozilla/geckodriver/releases/tag/v0.37.1>
- Archive: `geckodriver-v0.37.1-linux64.tar.gz`
- SHA-256: `e815130ea95983e162ae91843b48d3a3ce991735635fce83a647afde21e09f7e`
- Executable: `outputs/kitsune/tools/geckodriver-0.37.1/geckodriver`
- Browser: `/usr/lib/librewolf/librewolf` (tested with `154.0-2`)

The driver listens on loopback and is shut down at the end of the test.
Firefox 138+ requires `--allow-system-access` on geckodriver for native chrome
testing. This privilege is enabled **only for the disposable test browser**;
it is not added to the installed launcher or any system-wide configuration.
See [Mozilla's flag documentation](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html#allow-system-access).

Two default automation overrides are explicitly corrected for faithful tests:
native new-tab feeds remain initialized, and `security.fileuri.strict_origin_policy`
remains **true**. Other-site cleanup and signed-extension requirements are
asserted to remain enabled. At 390 pixels the test window's CSS minimum width is
temporarily relaxed; actual Gecko viewport dimensions are measured and checked.
## Gestor de perfiles

`python3 tests/profiles_ui.py` prueba el inicio en LibreWolf real contra el servidor
HTTP y el registro de perfiles reales, siempre dentro de un directorio temporal.
Usa únicamente las plantillas de la aplicación. La apertura de perfiles se
intercepta con un callback de prueba: no abre perfiles personales ni contacta con
Google o Mozilla, y no instala servicios.

Comprueba creación, edición, validación, iniciales y colores, predeterminado,
las seis acciones de apertura, contexto independiente por origen, conflictos
409 y errores 503 con borrador conservado, doble envío, recarga, 24 perfiles,
textos largos, teclado, Escape y diseño a 390 px. Guarda capturas y `report.json`
en el directorio temporal que imprime al terminar. Las pruebas unitarias de
`profiles.test.mjs` se incluyen en `npm test`.

## Dos perfiles reales y apertura desde el escritorio

Desde el proyecto Kitsune, con un runtime de marca ya preparado:

```sh
npm run test:profiles-native -- --browser /ruta/absoluta/al/runtime/librewolf
```

`tests/profiles_native.py` requiere una sesión gráfica Linux activa. Abre dos
ventanas temporales **visibles** y conecta geckodriver mediante
`--connect-existing`, con un puerto Marionette distinto por perfil. No utiliza
`-no-remote`: comprueba el IPC nativo real del escritorio, no una simulación.
Los permisos de automatización existen únicamente en los adaptadores y perfiles
temporales. Nunca se abren ni modifican perfiles instalados del usuario.

La prueba usa `ProfileManager.open` y la API HTTP real para iniciar el lanzador
de Kitsune mediante unidades transitorias `systemd-run --user`. Solo se simulan
dos operaciones de preparación: el arranque del servicio de inicio (los dos
servidores HTTP reales ya están escuchando en el proceso de prueba) y la
selección del runtime (la copia de marca indicada ya está preparada). No se
simulan el navegador, el almacenamiento, el registro, el IPC ni las cookies.

Los ocho checks verifican dos procesos y rutas independientes; Google nativo en
modo normal/privado; títulos Kitsune y protecciones intactas; contexto HTTP y
ajustes propios; cookies y localStorage separados para una misma web; envío de
URL solo al perfil elegido; cambio de perfil predeterminado; y reutilización de
la ventana correcta desde «Abrir perfil». Los sitios de prueba son locales. No
se envían credenciales, no se inicia sesión en Google o Mozilla, no se habilita
Sync y no se prueba una sincronización entre equipos. Google se inspecciona en
SearchService, sin afirmar que esta prueba haya cargado resultados de búsqueda.

El modo diagnóstico `--headless` conserva las pruebas de aislamiento, pero en
este entorno Gecko rechaza el IPC de escritorio con «already running, but is
not responding». Por eso el modo predeterminado y el script npm son **headed**.
No se introdujo ningún cambio en el lanzador de producción para eludir esa
limitación de la prueba sin ventanas.

Al terminar se cierran los controladores y únicamente las unidades transitorias
propias de los IDs aleatorios de esa ejecución. Se conservan el informe y las
capturas en `tests/evidence/profiles-native-2026-09-12/`; `--evidence` permite
elegir otra carpeta. La ejecución verificada obtuvo **8/8**, sin procesos ni
unidades de prueba restantes.

## Controles de ventana nativos sin abrir el escritorio

```sh
python tests/window_chrome.py --browser /ruta/absoluta/al/runtime/librewolf
```

Crea un perfil temporal independiente y utiliza Gecko headless. Solo ese
fixture simula las capacidades GTK CSD mediante preferencias `ui.GtkCSD*`;
no se copian a los perfiles instalados. Comprueba posiciones, colores, tamaños,
etiquetas nativas, ausencia de superposición, maximizar/restaurar, F11 y cierre
real de una segunda ventana propia. También verifica que el CSS no exponga
botones deshabilitados por la plataforma ni deshaga la ocultación de la barra.

El informe distingue esta simulación del compositor: no certifica el
comportamiento de maximizar de Niri, ni reinicia el navegador del usuario.
Las capturas muestran únicamente el navegador temporal vacío. Se guardan en
`tests/evidence/window-chrome-2026-10-02/`, ajustable con `--evidence`.
