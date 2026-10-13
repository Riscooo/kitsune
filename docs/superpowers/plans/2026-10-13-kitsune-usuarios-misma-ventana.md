# Usuarios en la misma ventana, botones de la ventana y Linux público — plan

> Ejecución en línea en la sesión que lo escribe (Risco aprobó seguir hasta publicar). Pasos con casillas.

**Objetivo:** cambiar de usuario dentro de la misma pestaña (usuarios = contenedores de Gecko), elegir botones de
ventana Kitsune/sistema en los tres sistemas y publicar 0.7.0-beta.5 para Windows, macOS y Linux.

**Arquitectura:** un módulo nativo nuevo (`kitsune-users.sys.mjs`) lleva contenedores y cambios de pestaña; el
inicio sabe su usuario por el contenedor de la pestaña (integrado) o por una cabecera que pone el motor
(servidor de Linux). Los botones viajan en el control de apariencia v7. El paquete de Linux sale del motor de
Linux con el inicio integrado.

**Spec:** `docs/superpowers/specs/2026-10-13-kitsune-usuarios-misma-ventana-design.md`

## Restricciones globales

- El registro de usuarios no cambia de formato (`profiles.json` v2 en Linux, `kitsune-profiles.json` v1).
- Usuario base = `default` (Linux) o la ficha con `path` del perfil actual (integrado); `userContextId` 0.
- Cabecera `X-Kitsune-Usuario`; parámetro de cambio `?cambiar=<id>`; acción de API `switch`.
- Control de apariencia v7 con `windowButtons` ∈ `auto|kitsune|sistema`; atributo de ventana
  `kitsune-window-buttons` = `kitsune|sistema`.
- Textos en castellano; «usuario» en vez de «perfil» en el inicio.
- Compilar Gecko solo en unidades systemd (`kitsune-engine-*`), nunca suelto.
- Nada se borra del disco de Risco (perfiles de prueba incluidos).

## Puntos de revisión

- Una pestaña en un contenedor que no es de ningún usuario (de ejemplo o ajeno) abre el inicio: sale el usuario
  base, sin error → test en Task 2 (`userForContainer` desconocido → base) y Task 3 (cabecera vacía → base).
- Una web que intenta `?cambiar=` o pone su propia cabecera `X-Kitsune-Usuario`: no cambia nada → tests de
  decisión en Task 2.
- Cambiar al mismo usuario de la pestaña: no hace nada → Task 2.
- Un usuario recién creado sin contenedor todavía: el contenedor se crea al cambiar → Task 2 y prueba real Task 6.
- «Del sistema» en macOS y «Kitsune» en macOS: el CSS no deja reglas de puntos con «sistema» → Task 1.

---

### Task 1: Botones de la ventana (Kitsune / Del sistema)

**Archivos:** `start/settings-store.mjs`, `start/index.html`, `start/app.js`, `install/home-server.py` (ajustes),
`install/appearance.py`, `install/home-extension/api/core.sys.mjs`, `install/native/kitsune-appearance.sys.mjs`,
`chrome/window-controls.css`; tests `tests/settings-store.test.mjs`, `tests/home_core.test.mjs`,
`tests/appearance_test.py`, `tests/home_server_test.py`, `tests/native_appearance.test.mjs`, `tests/chrome_css.test.mjs`.

- Produce: ajuste `windowButtons` (`'auto'` por defecto); control `version: 7` con `windowButtons`; función nativa
  `resolveButtons(value, os)` → `'kitsune'|'sistema'`; atributo `kitsune-window-buttons` en `<html>` de cada ventana.
- [ ] Tests que fallan: ajuste por defecto y valores no válidos (página, servidor, core); control v7 en Python y
  core; validación v7 y `resolveButtons` en el nativo; el CSS de puntos va bajo
  `:root[kitsune-window-buttons="kitsune"]` y en macOS quita `-moz-window-button-box` solo con «kitsune».
- [ ] Implementación y fila «Botones de la ventana» en Ajustes → Ventana (lado y minimizar desactivados con «sistema»).
- [ ] `npm test`, `npm run test:python`, `npm run build`; commit.

### Task 2: Módulo nativo de usuarios y parche de pestaña nueva

**Archivos:** crear `install/native/kitsune-users.sys.mjs`; modificar `install/native/kitsune-bootstrap.js`,
`install/kitsune-engine.py` (`NATIVE_FILES`, `TEXT_PATCHES` de `browser/base/content/browser-commands.js`);
tests `tests/native_users.test.mjs`, `tests/engine_test.py`.

- Produce (exportado): `GECKO_COLORS`, `parseContainerMap(text)`, `homeKind(url)` → `{kind:'server', port}` |
  `{kind:'integrated'}` | `null`, `switchDecision({url, triggeringOrigin, homeOrigin, isDocument})` →
  id o `null`, `userForContainer(map, ucid, baseId)`, y el objeto `KitsuneUsers` con `start()`,
  `decorate(window)`, `setUsers(users, baseId)`, `containerFor(user)`, `switchTab(tab, user)`.
- [ ] Tests que fallan de las funciones puras (colores, mapa inválido → vacío, contenedor desconocido → base,
  `?cambiar` solo desde el propio inicio y solo en documento, mismo usuario → no cambia).
- [ ] Implementación: contenedores con `ContextualIdentityService` (moz-src), mapa en `<perfil>/kitsune-users.json`,
  quitar los de ejemplo sin cookies ni pestañas (una vez, `kitsune.users.samplesRemoved`), observador HTTP solo con
  inicio de servidor, lista de usuarios desde `GET <inicio>api/profiles` cada 3 s (servidor).
- [ ] Parche: en `openTab`, `userContextId: gBrowser.selectedTab?.userContextId ?? 0` en las opciones.
- [ ] Tests; commit.

### Task 3: Servidor de Linux con usuario por petición

**Archivos:** `install/home-server.py`, `install/profiles.py`; tests `tests/home_server_test.py`, `tests/profiles_test.py`.

- Consume: cabecera `X-Kitsune-Usuario` (Task 2). Produce: `baseId` en la instantánea; `currentId` = usuario de
  la cabecera si existe; crear sin carpeta de Gecko; apariencia solo al editar el base.
- [ ] Tests que fallan; implementación; tests; commit.

### Task 4: Inicio integrado con usuario por pestaña y acción `switch`

**Archivos:** `install/home-extension/api/parent.js`, `install/home-extension/api/core.sys.mjs`; tests
`tests/home_core.test.mjs`.

- Consume: `KitsuneUsers.userForBrowser(browser)`, `KitsuneUsers.switchTab(tab, user)`, `setUsers` (Task 2).
- Produce: `ACTIONS.switch`; `profilesSnapshot(record, currentId, baseId)`; crear con `path: 'kitsune-usuario:<id>'`.
- [ ] Tests de core que fallan; implementación; tests; commit.

### Task 5: Página: tarjeta de usuarios, textos y privacidad en Ajustes

**Archivos:** crear `start/switcher.mjs`; modificar `start/profiles.mjs`, `start/index.html`, `start/app.css`,
`start/app.js`; tests `tests/profiles.test.mjs`, `tests/start_page.test.mjs`, crear `tests/switcher.test.mjs`.

- Consume: `GET /api/profiles` (`baseId`, `currentId`), `POST /api/profiles/<id>/open {action:'switch'}`,
  `location.assign('/?cambiar=<id>')`.
- Produce: `switchTo(id, {integrated, fetcher, navigate})`, `initializeSwitcher(...)`.
- [ ] Tests que fallan; implementación; `npm run build`; tests; commit.

### Task 6: Motor de Linux y prueba real

- [ ] Compilar el motor (`systemd-run --user … kitsune-engine.py build`), `tests/users_native.py` con Marionette:
  inicio integrado en contenedor, cambio en la misma pestaña, pestaña nueva hereda, cabecera y `?cambiar` con un
  servidor de prueba, botones con el atributo.
- [ ] Commit.

### Task 7: Linux público

**Archivos:** `install/kitsune-engine.py` (`package-linux`), crear `install/linux-package/instalar.sh`,
`install/linux-package/desinstalar.sh`, `install/native/kitsune-updates.sys.mjs` (Linux con `kitsune.release`);
tests `tests/engine_test.py`, `tests/updates.test.mjs`.

- [ ] Tests que fallan; implementación; paquete real; probar `instalar.sh` en un HOME temporal; commit.

### Task 8: beta.5, Windows, macOS, publicación e instalación

- [ ] `version.json` → `0.7.0-beta.5`; compilar Windows y macOS; `inspect_windows_installer.py`, `inspect_macos_dmg.py`.
- [ ] Release `v0.7.0-beta.5` en GitHub con los tres; `web/downloads.json` con `release`; push (Vercel publica la web).
- [ ] Instalar el motor y los archivos en el Kitsune de Risco (`install/install.sh`); tareas de prueba en Nori.
