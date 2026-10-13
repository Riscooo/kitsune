# Kitsune 0.7 beta 5 — usuarios en la misma ventana, botones de la ventana y Linux público — diseño

Fecha: 2026-10-13 · Estado: aprobado por Risco en conversación («dale»), con permiso para seguir hasta publicar.

## Objetivo

1. Cambiar de usuario **como en Google**: dentro de la misma pestaña del inicio, sin ventana nueva, y sin
   tocar las demás pestañas, que siguen con su usuario.
2. Elegir entre los botones de la ventana de Kitsune (los puntos) y los del sistema (Windows, escritorio de
   Linux, semáforos de macOS), en los tres sistemas.
3. Publicar Kitsune para Linux junto a Windows y macOS (GitHub Releases y web) como 0.7.0-beta.5.

## Decisiones de Risco

- Los usuarios viven **dentro del mismo Kitsune**: cada usuario es un contenedor de Gecko (contextual
  identity). Van aparte las sesiones, cookies y datos de las webs; se comparten historial, marcadores,
  contraseñas y extensiones. Se descartaron los perfiles separados con ventana oculta: Risco no quiere que
  nada se oculte ni se cierre.
- Los puntos de Kitsune también se pueden poner en macOS.
- La release de GitHub forma parte del trabajo.

## 1. Modelo

- Un usuario es una ficha del registro de siempre (nombre, correo, color, foto). El registro no cambia de
  formato: en Linux sigue siendo `profiles.json` v2 (lo lee el puente de Vela) y en el inicio integrado
  `kitsune-profiles.json` v1.
- **Usuario base**: el del perfil de Gecko en marcha (`default` en Linux; en el integrado, la ficha cuya
  `path` es el perfil actual). Va **sin contenedor** (`userContextId` 0) y conserva todos los datos de hoy.
- El resto de fichas son usuarios con contenedor. El módulo nativo guarda la correspondencia
  `id → userContextId` en `<perfil>/kitsune-users.json` y crea el contenedor la primera vez que hace falta.
  Colores: blue→blue, pink→pink, violet→purple, teal→turquoise, amber→orange, red→red; icono `circle`.
- Las fichas de perfiles separados que ya existan pasan a ser usuarios con contenedor. Sus carpetas de Gecko
  se quedan en disco sin tocar. El lanzador mantiene `--kitsune-profile` por compatibilidad, pero el inicio
  ya no abre perfiles en otra ventana.
- Los 4 contenedores de ejemplo de Gecko (Personal, Trabajo, Bancos, Compras) se quitan una vez si no tienen
  pestañas ni cookies.
- **Privacidad común**: Estricto/Cómodo y «Conservar Google» son del motor entero, así que pasan a ser de
  todo Kitsune y se guardan en la ficha del usuario base (como hoy). Se editan en Ajustes → Privacidad.
- Por usuario solo van nombre, correo, color y foto. Tema, fondo, accesos directos y botones son comunes.
- Sin «perfil predeterminado» en la interfaz: los enlaces que llegan de fuera abren con el usuario base.

## 2. Comportamiento

- **Cambio**: en el inicio, el avatar abre una tarjeta (estilo Google) con el usuario de esa pestaña arriba
  («Gestionar usuarios»), los demás debajo y «Añadir usuario». Al elegir otro, la pestaña se sustituye en
  su mismo sitio por el inicio de ese usuario (pestaña nueva en el contenedor, seleccionada, y fuera la
  vieja). El resto de pestañas no se tocan. En la ventana de gestión, «Cambiar a este usuario» hace lo mismo.
- **Pestaña nueva** (Ctrl+T, «+», doble clic en la barra): con el usuario de la pestaña seleccionada
  (parche de la receta en `BrowserCommands.openTab`). Los enlaces abiertos desde una pestaña heredan su
  contenedor (Gecko ya lo hace).
- Cada pestaña de un usuario con contenedor lleva la línea de color de Gecko (`.tab-context-line`).
- El inicio saluda y muestra el avatar del usuario de **su** pestaña.

## 3. Por dentro

**Módulo nativo `kitsune-users.sys.mjs`** (en el motor, cargado desde `kitsune-bootstrap.js`, una sola vez
por proceso):
- `containerFor(user)`: crea o actualiza el contenedor (nombre y color) y devuelve su `userContextId`;
  0 para el usuario base.
- `userForContainer(ucid)`: id del usuario de un contenedor, o el base si no es de ningún usuario.
- `switchTab(tab, user)`: pestaña nueva con la página de inicio (`browser.startup.homepage`) en el
  contenedor del usuario, en la posición siguiente; se selecciona y se cierra la vieja sin animación.
- Solo en Linux con servidor (página de inicio `http://127.0.0.1:<puerto>/`), un observador
  `http-on-modify-request` para las peticiones a ese puerto:
  - pone la cabecera `X-Kitsune-Usuario` con el id del usuario del contenedor de la petición (y la vacía si
    no es de nadie), siempre por encima de lo que mande la página;
  - si es la carga de documento de `/?cambiar=<id>` y la pide la propia página de inicio (mismo origen),
    la cancela y hace `switchTab` en la pestaña de esa carga.
- La lista de usuarios: en Linux la lee del servidor (`GET /api/profiles`); en el integrado, del registro
  (`kitsune-profiles.json`).

**Servidor de Linux (`home-server.py`)**: el usuario de cada petición sale de `X-Kitsune-Usuario` (si es
un id válido y existe; si no, el base). Crear un usuario ya no prepara carpeta de Gecko.

**Inicio integrado (`parent.js` + `core.sys.mjs`)**: el usuario de la petición es el del contenedor de la
pestaña (`context.xulBrowser`). Nueva acción `switch` en `POST /api/profiles/<id>/open`, que llama a
`switchTab`. Crear un usuario ya no crea un perfil de Gecko: la ficha lleva `path` = `kitsune-usuario:<id>`.

**Página (`start/`)**: tarjeta de cambio (`switcher.mjs`), textos «usuario» en vez de «perfil», sin
«Hacer predeterminado», privacidad y Google en Ajustes → Privacidad. Para cambiar: integrado → API;
Linux → `location.assign('/?cambiar=<id>')`.

## 4. Botones de la ventana

- Ajustes → Ventana: «Botones de la ventana: Kitsune / Del sistema». Por defecto, Kitsune en Windows y
  Linux y del sistema en macOS (valor `auto`). Con «Del sistema» se desactivan lado y minimizar.
- El ajuste viaja en el control de apariencia **v7** (`windowButtons`: `auto`|`kitsune`|`sistema`), que
  escriben `appearance.py` y `core.sys.mjs`. El módulo nativo pone `kitsune-window-buttons="kitsune"` o
  `"sistema"` en cada ventana (resolviendo `auto` por sistema).
- `window-controls.css` y las reglas de lado y minimizar solo se aplican con `kitsune`. En macOS, con
  `kitsune`, la caja de botones pierde `-moz-window-button-box`: Gecko deja vacío el hueco de los semáforos
  y los oculta (`windowButtonsRect` vacío), y se ven los puntos.

## 5. Linux público y publicación

- `kitsune-engine.py package-linux`: a partir del paquete del motor de Linux, un
  `Kitsune-<release>-Linux-x86_64.tar.xz` con `kitsune/` (motor, `kitsune.cfg`, `autoconfig.js`, uBlock en
  `distribution/extensions`, `kitsune-release.js`) más `instalar.sh` (copia a `~/.local/share/kitsune`,
  crea el `.desktop` y el icono en el menú) y `desinstalar.sh`. Usa el inicio integrado, sin servidor.
- El aviso de versión nueva también en Linux cuando el motor trae `kitsune.release` (el de Risco no lo trae).
- `version.json` → `0.7.0-beta.5`. Release de GitHub `v0.7.0-beta.5` con Windows, macOS y Linux;
  `web/downloads.json` con los tres y con `release` (para el aviso).

## 6. Pruebas

- Node: lógica de usuarios y contenedores (módulo nativo con dobles), tarjeta de cambio, ajustes v7 y CSS.
- Python: cabecera y usuario por petición en el servidor, creación sin carpeta de Gecko, control v7,
  `package-linux`.
- Motor real (Marionette, perfiles desechables): cambio en la misma pestaña con el inicio integrado y con el
  servidor, la pestaña nueva hereda el usuario, la cabecera llega, `?cambiar` solo desde el inicio, botones.
- Windows y macOS: compilación, `inspect_*`; prueba a mano en sus equipos (tarea en Nori).

## Fuera de alcance

Historial, contraseñas o extensiones por usuario; borrar usuarios; fondo o tema por usuario; migrar los
datos de los perfiles separados a contenedores.
