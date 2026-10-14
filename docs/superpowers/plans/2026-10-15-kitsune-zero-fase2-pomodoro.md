# Kitsune Zero · fase 2: el pomodoro

> Plan para ejecutarlo en línea (executing-plans), con TDD. Diseño: `docs/superpowers/specs/2026-10-14-kitsune-zero-design.md`
> (Decisiones de Risco: «Pomodoro»; «Tras verlo en pantalla»: opcional, con interruptor). Risco dio
> permiso para todo la noche del 14-10 («no pares, perfecciona y mejora»): no se le pregunta, se
> deja todo apuntado en el registro.

**Objetivo:** un pomodoro opcional, calmado y precioso: un anillo que se vacía, avisos de la isla y,
si se quiere, un descanso estricto con respiración o estiramientos guiados.

**Arquitectura:** el reloj es puro (`zero/modules/zero-pomodoro.mjs`, probado con Node): un estado
guardado (fase, cuándo empezó, cuánto quedaba en pausa, ciclo) y una función que dice qué toca en
cada instante. La pieza (`zero-pomodoro.sys.mjs`) lo guarda en un ajuste del anfitrión, así que es
uno solo para todas las ventanas y sobrevive a reinicios; pinta el anillo, avisa con la isla y pone
el descanso estricto. El tiempo sale de `clock.now()`, que las pruebas adelantan.

## Restricciones

- Apagado de serie (`kitsune.zero.pomodoro` = false). Apagado no sale nada: ni anillo, ni avisos, ni
  filas de tiempos en los ajustes (solo el interruptor).
- Tiempos a elegir: 25·5, 50·10 y 90·15 (trabajo·descanso); cada 4 trabajos, un descanso largo del
  triple.
- Descanso suave (avisa la isla) o estricto (un cristal tapa las webs); guía: respirar (4 s dentro,
  6 s fuera), estirar (cuello y hombros, por pasos) o alternar.
- Al acabar un descanso, la isla lo dice y el anillo espera a que se pulse: nada arranca solo.
- El anillo va en el marco, arriba a la derecha, sin tapar la web. Con la web ampliada se guarda en
  el tirador de la esquina, que hace de barra de progreso, y sale con los demás al acercarse.
- Movimiento: las dos curvas de Zero; «reducir movimiento» lo deja quieto (la guía de respiración
  pasa a solo texto).

## Tareas

### Tarea 1: el reloj (puro)

`zero/modules/zero-pomodoro.mjs`, prueba `tests/zero_pomodoro.test.mjs`:
- `PRESETS`: `{ '25': { work: 25, short: 5, long: 15, every: 4 }, '50': …, '90': … }` (minutos).
- `initial()` → `{ phase: 'idle', cycle: 1, startedAt: null, left: null }`.
- `start(state, preset, now)`, `pause(state, preset, now)`, `resume(state, preset, now)`,
  `skip(state, preset, now)`, `reset()`.
- `view(state, preset, now)` → `{ phase, running, left, total, cycle, every, ending }`: avanza solo de
  trabajo a descanso (y a «waiting» al acabar el descanso), corto o largo según el ciclo.
- Pruebas: empezar da 25:00 de trabajo; a los 25 min, descanso corto; tras el cuarto trabajo, largo;
  al acabar un descanso, «waiting» hasta que se pulse; pausar congela lo que queda y seguir lo
  respeta; saltar pasa a la fase siguiente; «ending» el último minuto; un estado guardado roto vuelve
  a «idle».

### Tarea 2: la pieza, el anillo y los ajustes

`zero/modules/zero-pomodoro.sys.mjs`, CSS en `zero.css`, prueba `tests/zero_pomodoro_native.py`:
1. Apagado de serie: no hay anillo; en los ajustes solo sale el interruptor «Pomodoro».
2. Al encenderlo sale el anillo arriba a la derecha, en el marco (no toca la tarjeta), y las filas de
   tiempos, descanso y guía.
3. Un clic empieza: el anillo se va vaciando; con el ratón encima se abre con «25:00 · Trabajo 1 de 4»
   y los botones de saltar y reiniciar.
4. Es uno para todas las ventanas: otra ventana en Zero enseña el mismo tiempo.
5. Con la web ampliada el anillo se guarda: el tirador hace de barra de progreso.
6. Apagarlo quita todo.

### Tarea 3: los descansos

En la misma pieza:
1. Suave: al acabar el trabajo la isla avisa («Descanso · 5:00») y el anillo cambia de color.
2. Estricto: un cristal tapa las webs (no las piezas de Zero), con la guía (respirar o estirar), el
   tiempo que queda y «Mantén para saltar» (1,5 s); soltar antes no salta.
3. Al acabar el descanso, la isla dice «¿Seguimos?» y el anillo espera.

### Tarea 4: motor real, pantalla y repaso

Compilar el motor de prueba, todas las pruebas, medir la fluidez con ventana real y capturas.
