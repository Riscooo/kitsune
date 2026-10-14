# Kitsune Zero

Un Kitsune dentro de Kitsune: una ventana de cristal, tranquila y para concentrarse. Ctrl+Alt+0 pasa
la ventana a Zero y la devuelve, con las mismas pestañas. Diseño completo en
`docs/superpowers/specs/2026-10-14-kitsune-zero-design.md`.

## Cómo está hecho

- `modules/`: los módulos de chrome (`zero.sys.mjs` es la entrada; cada pieza se registra con
  `Zero.piece({ attach, detach })`). Se importan entre sí con rutas relativas y **no importan nada de
  Kitsune**.
- `chrome/zero.css`: todo el aspecto, bajo `:root[zero]`. Lo carga `zero.sys.mjs` solo en las
  ventanas con Zero.
- `assets/`: el logo («máscara en el cero») y, más adelante, los sonidos.
- `zero.json`: la identidad (nombre, prefijo de ajustes, app-id, atajo).

## Cómo lo lleva Kitsune (el anfitrión)

- `install/native/kitsune-zero-host.sys.mjs` le da a Zero lo que necesita: los textos en el idioma de
  Kitsune, los ajustes con el prefijo `kitsune.zero.` y los atajos en su propio `<keyset>`.
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
5. un anfitrión propio, una copia de `kitsune-zero-host.sys.mjs` con su nombre.

El código de `modules/` y `chrome/` no se toca.

## Pruebas

`tests/zero_*.test.mjs` (Node) y `tests/zero_*_native.py` (motor real). Con `--zero-del-repo`, las
pruebas nativas usan este directorio sin compilar el motor: un `chrome.manifest` temporal sustituye
las URL de `chrome://browser/content/zero/` (ver `tests/zero_harness.py`).
