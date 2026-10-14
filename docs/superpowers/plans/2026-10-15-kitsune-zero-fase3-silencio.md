# Kitsune Zero · fase 3: el silencio

> Plan para ejecutarlo en línea (executing-plans), con TDD. Diseño: `docs/superpowers/specs/2026-10-14-kitsune-zero-design.md`
> («Silencio»). Noche del 14-10: Risco durmiendo, con permiso para todo.

**Objetivo:** que Zero sirva para currar sin que nada te enganche, y que todo sea elegible.

**Lo que ya hace Kitsune y Zero no toca:** en su modo de privacidad, Kitsune rechaza los banners de
cookies (`cookiebanners.service.mode` = 1) y bloquea el autoplay con sonido (`media.autoplay.default`
= 1). Esos ajustes son de sus modos de privacidad: Zero no los cambia (se pelearía con ellos) y lo
dice en sus ajustes.

## Restricciones

- Apagado de serie (`kitsune.zero.silence` = false). Apagado no hace nada ni enseña sus opciones.
- «Durante el trabajo»: con el pomodoro encendido, mientras corre un trabajo; con el pomodoro apagado,
  siempre que haya una ventana en Zero (Zero ya es modo trabajo).
- Nada de ajustes de Gecko que sobrevivan: el «no molestar» de los avisos (`nsIAlertsDoNotDisturb.
  manualDoNotDisturb`) dura hasta reiniciar y Zero lo devuelve como estaba.
- Webs vetadas: una lista de dominios (`kitsune.zero.silence.blocked`, separada por comas; casan el
  dominio y sus subdominios). «Mantén para entrar» da 10 minutos a ese dominio.

## Tareas

### Tarea 1: las reglas (puras)

`zero/modules/zero-silence.mjs`, prueba `tests/zero_silence.test.mjs`:
- `parseHosts(text)` → lista limpia (minúsculas, sin `www.`, sin esquema ni ruta, sin repetidos).
- `blockedHost(host, list)` → el dominio de la lista que casa (o null): `youtube.com` casa
  `m.youtube.com`, no `notyoutube.com`.
- `working({ pomodoroOn, phase })` → si es «durante el trabajo».
- `ScrollWatch`: suma el tiempo bajando en una página (huecos de más de 5 s no cuentan) y avisa al
  pasar de 10 min; se reinicia al cambiar de página.

### Tarea 2: la pieza

`zero/modules/zero-silence.sys.mjs`, CSS, prueba `tests/zero_silence_native.py`:
1. Apagado de serie: en los ajustes solo el interruptor «Silencio» (con la nota de lo que ya hace
   Kitsune).
2. Encendido, salen «Avisos, al descanso», «Webs vetadas» (con la lista), «Solo currar» y «Aviso de
   scroll infinito».
3. Avisos: con el pomodoro trabajando, el «no molestar» está puesto; en el descanso, quitado; al
   apagar el silencio, como estaba.
4. Webs vetadas: durante el trabajo una web de la lista sale tapada por un cristal con el dominio y
   el tiempo, y la isla lo dice; mantener 1,5 s deja entrar; en el descanso no se tapa.
5. Solo currar: vetadas también en el descanso.
6. Scroll: tras 10 min bajando en la misma página, la isla avisa una vez.
