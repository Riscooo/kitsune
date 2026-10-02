# Kitsune 0.5 «Tinta» — plan de implementación

> Ejecutar con superpowers:executing-plans, tarea a tarea. Spec: `docs/superpowers/specs/2026-10-02-kitsune-tinta-design.md`.

**Base:** commit `268d4cf` (0.4 tal cual). Tests base: `npm test` (57) y `npm run test:python` (75), en verde.

## Restricciones globales
- Tokens exactos de la spec (papel `#f6f5f1`, elevado `#fbfaf7`, lavado `#e8ece4`, tinta `#252d2b`, secundario `#59625c`, línea `#c7cdc4`, óxido `#963d32`, óxido suave `#eadfda`, jade `#496b60`, apagado `#73786f`).
- Noto Sans (interfaz) y Noto Serif (títulos, reloj, saludo, «kitsune»).
- Nunca WebDriver con el perfil real; pruebas nativas solo con perfiles temporales.
- No tocar perfiles, sesiones, búsqueda ni indicadores de seguridad.

## Tareas
1. **Paleta y protocolo v2** — `install/appearance.py` (PAPEL único; fuera PALETTES/desktop_palette/scheme_file; control `{version:2, palette, motion, googleRemember, fingerprint}`), `install/native/kitsune-appearance.sys.mjs` (valida v2, sin fondos), `start/appearance.mjs`, `start/settings-store.mjs` (fuera WALLPAPERS/ACCENTS/themeSync/art), `install/home-server.py` (defaults y validación sin wallpaper). Tests: adaptar `appearance_test.py`, `native_appearance.test.mjs`, `settings-store.test.mjs`, `home_server_test.py`, `backend_v04_test.py`, `profiles_test.py`; nuevos: paleta == tokens, v1 rechazado, ajustes antiguos normalizados conservando enlaces.
2. **Plantilla de preferencias** — `install/user.js`: `browser.theme.toolbar-theme` y `content-theme` a 1 (claro). Quitar `sync_palette` del lanzador `install/kitsune-browser` y su test en `launcher.test.mjs`.
3. **Logo** — redibujar ensō D + máscara E3 (bocetos en el compañero visual) en `install/branding/icon.svg`, `start/favicon.svg`, `chrome/assets/kitsune.svg` (mismo archivo), `wordmark.svg`; versión 16/32 px ajustada; `sh install/render-branding-assets.sh`; `version.json` brandingRevision 4, version 0.5.0, design «Tinta»; `package.json` 0.5.0. Test: renders deterministas (`runtime_branding_test.py`).
4. **Interfaz del navegador** — `chrome/palette.css` (tokens papel), `chrome/userChrome.css` (color-scheme light; sombras suaves; cierre de pestaña óxido; privado jade), `chrome/kitsune-header.css` (tira en lavado, activa en elevado con trazo óxido arriba, sin la tinta oscura actual), `chrome/window-controls.css` (puntos tinta/óxido), indicador de carga: `.tab-throbber[busy]` con anillo SVG girando + máscara fija; con movimiento reducido, latido de opacidad.
5. **Páginas internas** — `chrome/userContent.css`: tokens papel, color-scheme light, sin `kitsune-night.png`, modo lectura (`about:reader`) en papel con Noto Serif; errores de seguridad intactos.
6. **Portada B** — `start/index.html` (sin `.scene`, logo grande, saludo «Bienvenido, {perfil}», fecha·hora en una línea, accesos como sellos hanko alternando óxido/tinta, pie «Kitsune · Tinta»; Ajustes→Apariencia solo movimiento), `start/app.css` (tokens papel, Noto Serif, sellos, transición «la tinta se posa» ≤400 ms), colores de perfil oscurecidos para papel (mismas claves); borrar `kitsune-night.png` y `anime-veil.webp`; `npm run build`.
7. **Verificación** — `npm run check`, `npm run test:python`, pruebas nativas con perfiles temporales; capturas de una ventana real (perfil temporal) frente a los bocetos.
8. **Instalación** — copia de seguridad `~/.local/share/kitsune-0.4-backup.*`; copiar según el mapa de archivos (install/*.py y version.json → `~/.local/share/kitsune-browser/`; start/ → `start/`; chrome/ → `templates/chrome/` y `profile/chrome/` (assets incluidos); install/user.js → `templates/user.js` y fusionar en `profile/user.js` conservando `kitsune.migrations.*`; native/ y branding/; lanzador → `~/.local/bin/`). README actualizado.

## Pendiente fuera del plan
- LibreWolf 157: Risco ejecuta `sudo pacman -Syu`; luego revisar selectores de las tareas 4–5.
- Pinterest: probar con el perfil limpio; si falla, excepción de uBlock y de protección antihuellas para pinterest.com.
