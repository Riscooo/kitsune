# Kitsune 0.5 «Tinta» — diseño

Fecha: 2026-10-02 · Estado: aprobado por Risco (dirección, logo, portada y alcance).

## Objetivo

Que Kitsune deje de ser «Nightfall» (azul marino, cuatro paletas oscuras, fondos ilustrados) y pase a
compartir la estética de InkShadow, el escritorio de Risco: papel, tinta y óxido, en todo el navegador
(interfaz, portada, logo, páginas internas y extensiones). Una sola estética, sin variantes.

Fuera de alcance: modo oscuro («Tinta de noche», se puede añadir después con los mismos tokens),
restilar webs de terceros, cambiar perfiles, sesiones, búsqueda o la copia del motor con marca.

## Identidad

### Tokens (los de `InkShadow/src/theme/InkTheme.qml`)

| Token Kitsune | Uso | Valor | Origen InkShadow |
|---|---|---|---|
| `bg` | fondo, papel | `#f6f5f1` | `paper` |
| `surface` | superficies elevadas | `#fbfaf7` | `paperRaised` |
| `surfaceHigh` | lavado (tira de pestañas, hover) | `#e8ece4` | `wash` |
| `text` | tinta | `#252d2b` | `ink` |
| `muted` | texto secundario | `#59625c` | `secondary` |
| `outline` | líneas y bordes | `#c7cdc4` | `line` |
| `primary` | acento óxido | `#963d32` | `rust` |
| `primaryContainer` | fondo de acento suave | `#eadfda` | óxido al 12 % sobre papel |
| `secondary` | jade (modo privado, éxito) | `#496b60` | `jade` |
| `tertiary` | texto apagado decorativo | `#73786f` | `muted` |

Se mantienen las 10 claves actuales para que todo lo que consume `--kb-*` siga funcionando.

**Tipografía:** Noto Sans para la interfaz (la de InkShadow); Noto Serif para títulos, reloj, saludo y la palabra «kitsune».

### Logo

- Ensō (círculo zen de pincel) con la abertura y la punta de la cola en óxido, y dentro una máscara
  kitsune en papel con trazos de tinta y marcas óxido (boceto aprobado: ensō «D» + máscara «E3»).
- SVG limpio (`branding/icon.svg`, `chrome/assets/kitsune.svg`), sin filtros caros: el aspecto de pincel
  va en la geometría. Versiones ajustadas a mano para 16 y 32 px. PNG de 16 a 384 px y `about-300x236.png`
  regenerados con `install/render-branding-assets.sh`. Wordmark: logo + «kitsune» en Noto Serif + sello óxido.
- **Indicador de carga:** las pestañas que cargan muestran el ensō girando alrededor de la máscara inmóvil
  (dos capas: anillo animado y máscara fija). Con movimiento reducido el anillo late (opacidad) en vez de girar.

## Interfaz del navegador (`chrome/userChrome.css`, `chrome/kitsune-header.css`)

- Tira de pestañas sobre `surfaceHigh`; pestaña activa en `surface` con un trazo óxido de pincel arriba
  (3 px, borde irregular hecho con máscara SVG, no con filtros en vivo); inactivas en `muted`.
- Barra de navegación en `surface`; iconos de línea fina en `text`; barra de direcciones en `bg` con borde
  `outline` y foco óxido. Paneles, menús y el panel de extensiones en `surface` con borde `outline`.
- Botones de ventana (minimizar, pantalla completa, cerrar) en tinta; cerrar con fondo óxido al pasar.
- Modo privado: borde y marca en `secondary` (jade).
- Sin capas sobre indicadores de seguridad, permisos o avisos (se conservan las garantías de la 0.4).

## Portada (`start/`) — diseño «B · Caligrafía»

- Columna centrada: logo grande (120 px), saludo «Bienvenido, {nombre del perfil}» en Noto Serif, fecha y
  hora en una línea, buscador de papel con los modos actuales (todo, imágenes, vídeos, mapas) y botón
  circular de tinta, accesos como sellos hanko (cuadrado con bordes de sello, alternando óxido y tinta,
  inicial o icono en papel). Pie: «Kitsune · Tinta» y los enlaces de Enfoque y Atajos.
- Al abrir, transición corta «la tinta se posa» (≤ 400 ms, opacidad + leve desenfoque); nada con movimiento
  reducido.
- Se conservan: edición de accesos, perfiles y avatar, modo enfoque, atajos de teclado, módulos (reloj y
  accesos) y accesibilidad de la 0.4.
- **Ajustes → Apariencia:** solo movimiento (normal o reducido) y módulos. Se quitan fondos, acentos,
  «Combinar tema y fondo» y «Seguir el escritorio».

## Páginas internas y extensiones (`chrome/userContent.css`)

- `about:preferences`, `about:addons`, `about:downloads`, `about:protections`, `about:logins`,
  `about:privatebrowsing`, páginas de error y el modo lectura en papel y tinta con los mismos tokens.
- Modo lectura: fondo `bg`, texto `text`, Noto Serif para el cuerpo.
- uBlock Origin: acento óxido mediante su ajuste nativo de color de acento cuando esté disponible; si no,
  se documenta el ajuste manual (no se modifican archivos de la extensión).
- Ninguna web normal recibe variables ni estilos de Kitsune.

## Apariencia: protocolo y datos

- `install/appearance.py`: una sola paleta `PAPEL` con los tokens de arriba. Se eliminan `PALETTES`,
  `desktop_palette`, `scheme_file` y la lógica de fondo/acento/sincronía.
- Archivo de control `kitsune-appearance.json` pasa a **versión 2**: `{version: 2, palette, motion,
  googleRemember, fingerprint}`. El módulo nativo y la portada solo aceptan la versión 2; un archivo
  antiguo se rechaza de forma segura (se reescribe en el siguiente refresco).
- Módulo nativo `install/native/kitsune-appearance.sys.mjs`: valida v2, inyecta `--kb-*` en chrome y
  páginas internas, sin imágenes de fondo. La retención de Google no cambia.
- Ajustes guardados: `normalizeSettings` ignora `wallpaper`, `accent`, `themeSync` y `art`; se
  conservan enlaces, módulos, motion, focus y newTab. No se tocan perfiles, fotos ni sesiones.
- Se borran los recursos `kitsune-night.png` y `anime-veil.webp`.

## Versiones y motor

- `version.json`: `version 0.5.0`, `design "Tinta"`, `brandingRevision 4` (fuerza una copia nueva del
  motor con el logo nuevo). `package.json` 0.5.0.
- LibreWolf 157 (`extra`, 2026-09-30): Risco actualiza con `sudo pacman -Syu`; `prepare-runtime.py` crea la
  copia nueva sola. El CSS se valida en el motor que haya instalado al probar y se revisa en 157.

## Pruebas

- Base: los 57 tests de JavaScript y 75 de Python de la 0.4 en verde, adaptados donde dependían de paletas.
- Nuevos: la paleta coincide con los tokens de InkShadow; el control v2 se valida y rechaza el v1; los
  ajustes antiguos se normalizan sin perder enlaces; el logo y sus PNG se generan de forma determinista;
  el indicador de carga existe con su variante de movimiento reducido; ninguna web normal recibe `--kb-*`.
- Integración con el navegador real (`browser_smoke`, `appearance_native`, `header_native`, `logo_motion`,
  `window_chrome`) siempre con perfiles temporales. **Nunca se maneja el perfil real de Risco con WebDriver.**
- Revisión visual: capturas de una ventana real de Kitsune (perfil temporal) comparadas con los bocetos.

## Instalación y vuelta atrás

- Copia de seguridad de lo instalado (`~/.local/share/kitsune-0.4-backup.*`, como las anteriores) antes de
  instalar. Instalación = copiar los archivos del repo a `~/.local/share/kitsune-browser` y a la plantilla
  del perfil, igual que la 0.4. Vuelta atrás: restaurar la copia.
