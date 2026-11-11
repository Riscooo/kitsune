# Kitsune Zero · la luz y el material

Zero en Windows 11 con el material del sistema (Acrílico o Mica de DWM) detrás de una ventana transparente, superficies
blancas esmeriladas encima y una luz que cambia con el día (amanecer, día, atardecer, noche). La misma luz la puede usar
cualquier otro programa del escritorio.

## Piezas

| Archivo | Qué hace | Gecko |
|---|---|---|
| `zero/modules/zero-sol.mjs` | Motor de temas: sol (salida y puesta), paletas, interpolación en OKLab, contraste WCAG, cuándo volver a mirar, salida CSS y JSON | No (Node) |
| `zero/modules/zero-material.mjs` | Qué material toca (Acrílico, Mica, Opaco) y los ajustes de Gecko que lo encienden | No (Node) |
| `zero/modules/zero-luz.sys.mjs` | La pieza de Zero: aplica la luz y el material a cada ventana, un temporizador para todas y la sección de ajustes «Luz y material» | Sí |
| `zero/chrome/zero.css` (sección «la luz y el material») | Superficies, filo, tinte del marco y tinta de la luz | Sí |
| `zero-frame.sys.mjs` | Con Acrílico o Mica en Windows, el fondo es «el cristal del sistema» (`system`); con la luz, el modo Claro/Oscuro es el suyo | Sí |
| `chrome/kitsune-header.css` | Las ventanas normales de Kitsune siguen opacas con el material encendido | Sí |
| `tools/sol/sol.mjs` | La luz en JSON o CSS para otros programas | No (Node) |
| `tests/zero_sol.test.mjs`, `tests/zero_material.test.mjs` | Pruebas puras | Node |
| `tests/windows/*` | Pruebas nativas en Windows con el motor de verdad | Windows |

## El material en Windows 11

No hay código nativo nuevo: Gecko ya sabe poner el material de DWM y Zero solo lo enciende.

1. Zero deja transparente la raíz de su ventana (ya lo hacía). Gecko pasa entonces la ventana a transparente con
   `DwmExtendFrameIntoClientArea` y cadenas de intercambio con alfa premultiplicado (`nsWindow::SetTransparencyMode`).
   No usa `WS_EX_LAYERED`.
2. `zero-luz` pone `widget.windows.mica = true` y `widget.windows.mica.toplevel-backdrop` a 2 (Acrílico) o a 1 (Mica).
   Gecko los aplica en caliente a todas sus ventanas (`WinUtils::UpdateMicaInAllWindows`). En las ventanas con el
   atributo `windowsmica` (todas las de `browser.xhtml`), llama a `DwmSetWindowAttribute(DWMWA_SYSTEMBACKDROP_TYPE)`
   con `DWMSBT_TRANSIENTWINDOW` (Acrílico) o `DWMSBT_MAINWINDOW` (Mica). Fuente: `widget/windows/nsWindow.cpp`
   (`UpdateMicaBackdrop`) y `modules/libpref/init/StaticPrefList.yaml`.
3. Encima, Zero pinta lo suyo:
   - el **tinte del marco**: el color de la luz con su opacidad, 70 % de serie, en `#zero-bg`;
   - las **superficies** (isla, raíl, pastillas, ajustes): el color de la luz al 85 %;
   - la **web** sigue opaca, con un alfa de 0,996 que Gecko trata como opaco.

   Las opacidades van siempre en el fondo, nunca en el elemento. Así el texto, los iconos y los controles se ven
   enteros. No hay opacidad global en la ventana.
4. Las ventanas normales de Kitsune no cambian. Con el material encendido, `browser.css` de Gecko dejaría transparente
   su raíz (`@media (-moz-windows-mica)`), y `kitsune-header.css` la vuelve a pintar opaca fuera de Zero. Al cerrar la
   última ventana de Zero (en Kitsune, no en Kitsune Zero), `zero-luz` apaga el material.

Qué material toca (`resolveMaterial`):

| Situación | Material |
|---|---|
| macOS o Linux | ninguno de estos: allí sigue el cristal de su escritorio (regla de niri, Hyprland, KDE, GNOME; macOS 26) |
| Windows 10 o Windows 11 anterior a 22H2 (build < 22621) | Opaco |
| «Efectos de transparencia» de Windows apagados, o alto contraste | Opaco, aunque se pida cristal. Se ve en caliente: Zero escucha `prefers-reduced-transparency` y `forced-colors` |
| Auto | Acrílico; con el modo ahorro de Kitsune, Mica (DWM la muestrea del fondo de escritorio en vez de desenfocar en vivo) |
| Acrílico, Mica u Opaco elegidos | ese |

Lo que Windows no deja elegir no se finge:
- El radio del desenfoque y la saturación del Acrílico los decide DWM. No hay API para pedir 20 px. La variable
  `--zero-blur: 20px` solo se aplica donde el desenfoque lo hace Gecko (CSS), no en el material.
- Con la ventana inactiva, DWM pinta Acrílico y Mica con su color de reserva, sin desenfoque. Es el comportamiento de
  Windows.
- El tinte de DWM (claro u oscuro) sigue a `DWMWA_USE_IMMERSIVE_DARK_MODE`, que pone Gecko según su tema. Zero pinta
  encima su propio tinte, de modo que el resultado lo marca la luz.

### Webs transparentes (experimental, apagado)

Con «Webs transparentes», `browser.tabs.allow_transparent_browser = true` y `.browserContainer` sin fondo: las páginas
sin fondo propio dejan ver el material. Solo afecta a las pestañas creadas desde entonces, porque Gecko pone
`transparent` al crear el `<browser>`. Muchas webs cuentan con un lienzo blanco, así que viene apagado.

## La luz

`themeAt(fecha, config)` devuelve:

- `period`: la luz que manda;
- `from`, `to` y `progress`: el tramo en el que está y cuánto lleva;
- `scheme`: `light` o `dark`;
- `colors`: `surface`, `raised`, `line`, `text`, `quiet`, `accent`, `shadow`;
- `material`: cuánto se deja ver lo de detrás;
- `sun`: la salida y la puesta del sol;
- `next`: cuándo volver a mirar.

**Línea del día.** Hay fotogramas clave alrededor de la salida (R) y la puesta (S) del sol. T es la transición:
50 minutos de serie, configurable.

| Momento | Luz |
|---|---|
| R − T | noche |
| R + T/2 | amanecer |
| R + 2T | día |
| S − 2T | día |
| S − T/2 | atardecer |
| S + T | noche |

- Entre dos fotogramas, mezcla en OKLab con una curva suave.
- En días cortos, las transiciones de día se acortan para que el día siga existiendo.
- Se calculan ayer, hoy y mañana, porque una transición puede cruzar la medianoche.
- Cerca de los polos hay días sin noche y noches sin día.

**Modos.**
- **Del sol**: calcula con las coordenadas, si las hay. Se guardan con un decimal (unos 10 km) y nunca se pide la
  ubicación. Sin coordenadas, va por la hora.
- **Por la hora**: salida y puesta fijas (07:30–19:30 de serie).
- **Fija**: una sola luz.
- **Apagada**: el aspecto de siempre.

**Siempre legible.**
- El texto no se mezcla entre un esquema y otro. Se toma el de la luz del esquema que manda, y el esquema lo decide la
  luminancia real de la superficie (umbral 0,179, donde el negro y el blanco contrastan igual).
- Luego se empuja en OKLab, hacia el lado del esquema, hasta tener contraste sobre las dos superficies: 4,5 para el
  texto, 3 para el secundario y el acento.
- Cerca del cruce de esquemas, la superficie elevada se acerca a la base para que siempre exista un texto legible.
- Las pruebas lo comprueban minuto a minuto durante días enteros (por la hora, Madrid en invierno y en verano,
  Helsinki en invierno).

**Sin bucles.**
- Hay un temporizador para todas las ventanas. Durante una transición se despierta cada 5 minutos, y fuera de ellas al
  empezar la siguiente.
- También se despierta al volver de una suspensión (`wake_notification`) y si cambia la hora del sistema.
- Solo se escriben las variables que cambian. Nada recarga la web ni recrea la ventana.
- Los cambios entre dos miradas son pequeños, por debajo de 0,03 de luminancia por minuto. El tinte del marco los
  suaviza con una transición CSS de 1,2 s.

**Con la luz, el modo es el suyo.**
- De noche, Oscuro (las piezas de «Sobrio»); de día, Claro. La fila «Estilo» se esconde.
- Las webs se quedan con sus colores: Zero no fuerza `layout.css.prefers-color-scheme.content-override` ni oscurece las
  webs claras. Eso sigue siendo cosa de Oscuro con la luz apagada.

### Paletas

| Luz | Superficie | Elevada | Texto | Acento | Esquema |
|---|---|---|---|---|---|
| Amanecer | `#fff6e8` | `#fffbf5` | `#2a251e` | `#94733d` | claro |
| Día | `#f5f7fa` | `#fbfcfd` | `#1d222a` | `#4f6984` | claro |
| Atardecer | `#ede2df` | `#f5edea` | `#2d2422` | `#975f49` | claro |
| Noche | `#252d39` | `#2d3644` | `#e8ecf1` | `#93a9c4` | oscuro |

Se pueden cambiar con `palettes` en la configuración (`normalizePalettes`): solo los colores `#rrggbb` válidos.

## Ajustes (`kitsune.zero.*`)

| Ajuste | Valores | De serie |
|---|---|---|
| `light.mode` | `solar`, `clock`, `fixed`, `off` | `solar` |
| `light.coords` | `"40.4, -3.7"` | vacío (va por la hora) |
| `light.clock` | `"07:30-19:30"` | `07:30-19:30` |
| `light.period` | `amanecer`, `dia`, `atardecer`, `noche` | `dia` |
| `light.transition` | minutos | `50` |
| `material` | `auto`, `acrylic`, `mica`, `opaque` | `auto` |
| `surface.opacity` | 0,5 a 1 | `0.85` |
| `surface.tint` | 0 a 0,95 | `0.7` |
| `web.transparent` | booleano (experimental) | `false` |

Todos están en el panel de Zero, en la sección «Luz y material». Se aplican en caliente y se guardan en el perfil.

## Para otros programas

`tools/sol/sol.mjs` escribe el tema de ahora sin quedarse abierto:

```powershell
node tools\sol\sol.mjs --coords "40.4, -3.7" --escribir "$env:LOCALAPPDATA\Kitsune\luz.json"
node tools\sol\sol.mjs --css
```

El JSON (esquema 1) es estable. Ejemplo:

```json
{
  "schema": 1,
  "at": "2026-11-11T16:40:00.000Z",
  "mode": "solar",
  "source": "solar",
  "period": "atardecer",
  "from": "atardecer",
  "to": "noche",
  "progress": 0.002,
  "scheme": "light",
  "colors": { "surface": "#ede2df", "raised": "#f5edea", "line": "#d8c7c2", "text": "#2d2422", "quiet": "#655652", "accent": "#975f49", "shadow": "#3a1f18" },
  "colorsUnit": { "surface": "0.929 0.886 0.875" },
  "material": 0.85,
  "sun": { "sunrise": "2026-11-11T06:57:12.412Z", "sunset": "2026-11-11T17:03:07.625Z" },
  "next": "2026-11-11T16:45:00.000Z"
}
```

`colorsUnit` lleva los mismos colores como «r g b» de 0 a 1, el formato de las propiedades de color de Wallpaper Engine.

Hay tres formas de integrarlo:
- **JS o Node**: `import { themeAt, exportTheme } from 'zero/modules/zero-sol.mjs'`. No tiene dependencias.
- **Programas en otros lenguajes**: leen el JSON. Si hace falta en vivo, una tarea programada de Windows puede llamar
  a `sol.mjs --escribir` cada 5 minutos (`windows/luz/instalar-tarea.ps1`). No hace falta un servicio.
- **Wallpaper Engine**: ver `windows/wallpaper-engine/`. El fondo puede ir solo, porque SceneScript tiene
  `engine.timeOfDay`, o recibir la luz por la línea de órdenes de Wallpaper Engine (`-control applyProperties`).

## Pruebas

```powershell
# Puras (cualquier sistema)
node --test tests/zero_sol.test.mjs tests/zero_material.test.mjs tests/zero_config.test.mjs tests/zero_frame.test.mjs

# Windows, con el motor de verdad: uno compilado, o uno publicado con el Zero de este repositorio dentro
7z x Kitsune-Zero-<versión>-Windows-x64.exe -oinstalador
.\tools\windows\parchear-motor.ps1 -Motor .\instalador\core -Destino $env:TEMP\kz
node tests\windows\zero_windows_native.mjs --motor $env:TEMP\kz [--probar-transparencia]
node tests\windows\rendimiento_materiales.mjs --motor $env:TEMP\kz [--probar-transparencia]
```

- `zero_windows_native.mjs` comprueba:
  - el material que DWM tiene puesto en el HWND real (`DwmGetWindowAttribute(DWMWA_SYSTEMBACKDROP_TYPE)`), además de
    lo que dice Gecko;
  - el tinte, la isla y la tarjeta opaca;
  - los píxeles de la web, pestañas y navegación;
  - las cuatro luces sin recargar la web;
  - el temporizador del sol;
  - maximizar y restaurar, los ajustes, la consola sin errores y la persistencia tras reiniciar.

  Guarda capturas reales de la pantalla. Con `--probar-transparencia`, enciende los «Efectos de transparencia» de
  Windows durante la prueba si estaban apagados, y al terminar los deja como estaban.
- Las pruebas usan un perfil nuevo y solo tocan los procesos de su propio motor, que identifican por su ruta.
