# Publicar una versión

## Antes de sacar la siguiente (0.8.0-beta.9): arreglar el actualizador de Windows

Lo pidió Risco el 24-11-2026, al pasar de la beta 7 a la beta 8 con Kitsune Zero en `C:\Program Files`. Los dos fallos están medidos en su
portátil y siguen en la beta 8. Al arreglar cada uno, se quita de aquí; con los dos, sobra la sección entera.

- [ ] **Al despertar el ordenador sin red, tarda 15 minutos en volver a mirar.** El portátil despertó a las 8:58:24, la wifi conectó a las
  8:58:29 y la primera mirada que llegó a la web fue a las 9:13:25. En `KitsuneUpdates.start()` (`install/native/kitsune-updates.sys.mjs`),
  el reintento de `RETRY_MS` solo lo lleva la primera mirada (`FIRST_CHECK_MS`); las de `setInterval` se tragan el fallo con
  `.catch(() => {})`. Propuesta: el mismo reintento al minuto en todas, y mirar también al despertar (`wake_notification`) y al volver la
  red (`network:offline-status-changed`). Que la mirada de las 8:58 fallara por la wifi se deduce de las horas: no quedó registrada.
- [ ] **«Instalar y reiniciar» no enseña nada mientras instala y deja abrir la versión vieja.** Zero se cerró a las 9:13:33; a las 9:13:46
  se volvió a abrir (lo más probable, a mano, al no verse nada); el instalador cambió los archivos entre las 9:13:53 y las 9:14:01, con esa
  ventana ya abierta. Quedó todo bien instalado (código 0), pero la ventana seguía siendo la beta 7 y `actualizar.cmd` no la cambia: parece
  que no ha hecho nada. Está en `windowsScript`, `windowsAdminScript`, `restart` y `resume` (`install/native/kitsune-updater.sys.mjs`).
  Propuesta:
  - algo a la vista mientras instala («Instalando Kitsune Zero…, se abre solo»);
  - si se abre con `intentado.json` reciente y sin `hecho.txt`, decirlo y cerrarse, para que lo abra `actualizar.cmd` ya nuevo (con un
    tope de tiempo, para no dejar a nadie sin navegador si el instalador falla);
  - si la ventana vieja sigue abierta con `hecho.txt` a 0, ofrecer «Reiniciar» y no «Descargar»: ahora `stage()` lanza «Esta versión ya se
    está instalando» y `check()` enseña el aviso de descarga.

Pruebas: `tests/updates.test.mjs`, `tests/updates_native.py`, `tests/updater_native.py` y `tests/updater_windows_wine.py`. Ojo: pasar de la
beta 8 a la beta 9 lo hace todavía el actualizador de la beta 8, así que el arreglo se nota de la beta 9 en adelante.

## Los pasos

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
