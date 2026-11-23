# Publicar una versión

1. **Número**: `release` en `install/version.json`. Notas en `docs/notas/<versión>.md` y novedades en `web/novedades.html` y
   `web/en/whats-new.html`.
2. **Paquetes**:
   - Todo (si cambia Gecko, la receta o lo compilado): `tools/seguir_firefox.py`, en Linux.
   - Solo Kitsune Zero para Windows, con el mismo Gecko: `node tools/windows/empaquetar.mjs --desde <instalador anterior> --salida <carpeta>`.
3. **Probar ese paquete**: `node tests/windows/zero_estudio_native.mjs --motor <trabajo>/nuevo/core` y `zero_windows_native.mjs`.
4. **Firmar la lista**: `node tools/firmar.mjs firmar <carpeta>/SHA256SUMS.txt` (empaquetar lo hace solo) y subir también
   `SHA256SUMS.txt.firma`. **Sin la firma, desde la 0.8.0-beta.8 nadie se actualiza solo**: queda el aviso con «Descargar». El borrador
   que deja `seguir_firefox.py` sale sin firmar: hay que bajarse su `SHA256SUMS.txt`, firmarlo y subir la firma antes de publicarlo.
5. **Versión en GitHub**: etiqueta `v<versión>`, con los paquetes, la lista y su firma.
6. **`web/downloads.json`** con las direcciones nuevas, y a `main`: Vercel publica la web. Primero la versión y luego la web: los
   Kitsune instalados miran `downloads.json` cada cuarto de hora.

## La clave con la que se firma

La creó `tools/firmar.mjs crear` el 23-11-2026. Las privadas están en `~/.kitsune-firma` del ordenador de Risco, cifradas con su cuenta
de Windows, y **no** en el repositorio ni en GitHub. Hay que guardar una copia fuera:
`node tools/firmar.mjs exportar D:\kitsune-firma.json` (pide una contraseña) y llevarla a un pendrive. Para firmar en otro ordenador
(el Linux): `node tools/firmar.mjs importar <archivo>`.

Si se pierde la de siempre o se filtra: se firma con la de reserva (`--reserva`) una versión que cambie `CLAVES` en
`install/native/kitsune-updater.sys.mjs`. Si se pierden las dos, la gente tendrá que bajarse la siguiente versión a mano.

## Lo que falta para la 1.0 y no depende del código

- **Firma de los instaladores.** Windows: además de los certificados de pago, [SignPath Foundation](https://signpath.org/) firma gratis
  proyectos de código abierto, pero pide una licencia de código abierto, compilar de forma automática y verificación en dos pasos, y firma
  a su nombre. macOS: cuenta de desarrollador de Apple (de pago).
- **Una licencia para el código propio.** El repositorio es público, pero sin licencia nadie puede usar ese código. Elegirla es cosa de
  su autor: publicada, no se puede retirar de lo ya publicado. Los avisos de lo de otros están en `AVISOS.md`.
- **Widevine**: `docs/zero/widevine.md`.
