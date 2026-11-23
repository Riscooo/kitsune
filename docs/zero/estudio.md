# El bloc, el rotulador, el modo Estudio y Spotify

Lo pidió Risco el 23-11-2026: un bloc de notas «ultra privado… rollo que sea algo en local», que la web, la IA y el bloc se
repartan solos, un modo Estudio cuyas páginas vuelvan aunque se cierren, un subrayador, unas estadísticas a toda la pantalla con
logros y que Spotify funcione sin pagar. Todo «clean, y no sobresaturar a la gente».

## Dónde está cada cosa

| Pieza | Puro (Node) | Dentro de Gecko |
|---|---|---|
| El cofre (cifrar y guardar) | `zero-cofre.mjs` | `zero-cofre.sys.mjs` |
| El bloc | `zero-notas.mjs` | `zero-notas-almacen.sys.mjs`, `zero-notas-editor.sys.mjs`, `zero-notas.sys.mjs` |
| El rotulador | `zero-notas.mjs` (anclas) | `zero-rotulador.sys.mjs`, `zero-rotulador-child.sys.mjs` |
| El reparto | `zero-reparto.mjs` | `zero-reparto.sys.mjs` |
| El modo Estudio | `zero-estudio.mjs` | `zero-estudio.sys.mjs` (el botón, en `zero-profiles`) |
| Estadísticas y logros | `zero-stats.mjs`, `zero-logros.mjs` | `zero-stats.sys.mjs` |
| Spotify | `zero-spotify.mjs` | `zero-spotify.sys.mjs`, `zero-spotify-child.sys.mjs`, `zero-spotify-app.sys.mjs` y su `.ps1` |

Pruebas: `tests/zero_{notas,reparto,estudio,stats,spotify}.test.mjs` y, con el motor de verdad en Windows,
`node tests/windows/zero_estudio_native.mjs --motor <carpeta> [--spotify] [--claro]`.

## La privacidad, en concreto

- `<perfil>/kitsune-zero-notas/`: `llave.json`, `notas/<id>.cofre`, `subrayados.cofre`, `estudio.cofre` y `copias/` (siete días).
- AES-GCM de 256 bits. Cada archivo va atado a su nombre: no se puede poner uno en el sitio de otro.
- La llave la envuelve OSKeyStore de Gecko (Administrador de credenciales, Llavero, libsecret). Se abre sola con la sesión de la
  persona. **Quien tenga esa sesión abierta puede abrir el bloc**: para lo demás están las contraseñas por nota (PBKDF2-SHA-256,
  600 000 vueltas), que Risco quiso opcionales.
- **Si se reinstala el sistema, la llave se pierde.** Para eso está «Copia para otro ordenador» (cifrada con la contraseña que se
  le ponga). `llave.json` no se rehace nunca si ya existe.
- El asistente y el MCP no tienen ninguna herramienta que llegue a las notas, y el bloc no es una web: `pagina_leer` y el
  JavaScript del MCP de fuera no lo ven. Lo del asistente puede ir al bloc; al revés, no.
- Las webs no saben que hay bloc. Los subrayados se pintan con la API de resaltado de CSS, así que una web que mirase
  `CSS.highlights` podría saber qué se ha subrayado **en ella** (no lo demás). El rotulador no atiende a eventos inventados por la
  página.
- En las ventanas privadas no se guardan subrayados ni el origen de las citas.
- De las notas, las estadísticas solo cuentan cuántas.

## El modo Estudio

- Cada perfil tiene el suyo. Cada pestaña del estudio lleva su id en la sesión de Gecko (`kitsuneZeroEstudio`) y la lista va en el
  cofre, con su historial y por dónde iba la página (sin formularios ni almacenamiento de la web).
- Cerrada con la ×, queda apuntada y vuelve. Se va solo si se quita del estudio. Los resultados de un buscador no vuelven.
- Con la privacidad en Estricto, al cerrar se borran las cookies: vuelven las páginas, pero puede haber que iniciar sesión.
- Desde Gecko 159, cerrar la última pestaña visible cierra la ventana aunque haya otras escondidas; `sinCerrarLaVentana` abre una
  nueva antes. Arregla también los perfiles.

## Spotify en Windows

Lo comprobado el 23-11-2026 con Gecko 159.0.1 y `web-player.d977a0e9.js`:

1. Sin la firma de Widevine de Google (VMP), los servidores que la exigen contestan 403 en Windows. Les pasa a Zen, Floorp o
   Waterfox, y el síntoma es el mismo: canciones que se saltan. La licencia hay que pedírsela a Google.
2. El reproductor web de Spotify prueba `com.widevine.alpha`, `com.microsoft.playready.recommendation.3000`,
   `com.microsoft.playready.recommendation`…, y coge el primero que haya; PlayReady tiene su servidor de licencias.
3. Gecko da PlayReady en Windows, pero con una lista de webs de Mozilla (`media.eme.mfcdm.origin-filter.enabled` = 4). Con 0, la web
   de Spotify crea las claves (`createMediaKeys`) con las dos variantes.

Por eso Zero abre esa lista y, solo en `open.spotify.com`, dice que no hay Widevine. **Falta por confirmar** que su servidor dé la
licencia con una cuenta iniciada (`kitsune.zero.music.diagnostico` apunta el código en `kitsune-zero-musica.log`).

No se usan los binarios firmados de Firefox: sería hacerse pasar por él ante Google, no se puede distribuir y se rompe con cada
Gecko.

La red de seguridad, que no depende de nada de eso, es la app: los controles multimedia de Windows
(`GlobalSystemMediaTransportControlsSessionManager`) dan la canción, la portada, la posición y los botones de la app oficial, con
cualquier cuenta. La Web API y el Web Playback SDK piden Premium.

Rareza: `Subprocess` de Gecko con `stderr: 'ignore'` no arranca el proceso en Windows; se lee y se tira.
