# Kitsune Zero · qué parte de arriba de las webs se usa menos

14-10-2026. Para colocar los botones de ventana y los de ampliar y dividir cuando la web ocupa toda la
ventana (sin marco, van encima de ella).

## Cómo

`tools/zonas_web.py` carga 52 webs populares de todo tipo con el motor real, sin Zero y a dos anchos
(1540 y 1280 px): buscadores, vídeo, redes, prensa española y de fuera, tiendas, documentación,
herramientas de trabajo, viajes y servicios. Las que piden cuenta enseñan su portada o su acceso. En
una rejilla de 6 px de los 140 px de arriba anota qué hay en cada punto: algo que se pulsa (enlace,
botón, campo…), texto, imagen (también los fondos con imagen, que suelen ser logos) o nada. Después,
para cada forma y cada sitio posible, cuenta en cuántas webs taparía algo.

Se repite con `python3 tools/zonas_web.py --salida zonas.json` (usa la red y tarda unos 10 minutos).

## Resultados (104 cargas, ninguna fallida)

| Forma y sitio | Webs en las que tapa algo |
|---|---|
| Botones de ampliar donde estaban (70 × 30, arriba a la izquierda) | 58,7 % |
| Botones de ventana donde estaban (60 × 14, arriba a la izquierda) | 40,4 % |
| Lo mejor para una píldora de 70 × 30 (borde derecho, bajo la cabecera) | 22,1 % |
| Lo mejor para una píldora de 56 × 24 (borde izquierdo, bajo la cabecera) | 19,2 % |
| Lo mejor para una píldora vertical de 24 × 56 (borde derecho, bajo la cabecera) | 13,5 % |
| **Un tirador de 36 × 6 pegado al filo de arriba, en la esquina derecha** | **9,6 %** |
| El mismo tirador en la esquina izquierda | 11,5 % |
| Cualquier cosa de 8 px o más de alto en ese filo | 21,2 % |

Lo que se ve: la fila de arriba de las webs (la cabecera) está muy ocupada, con los logos a la
izquierda y los botones de cuenta a la derecha. Ningún sitio de la franja está libre en todas, y lo
menos usado es el filo de arriba (los primeros 6 px), sobre todo en la esquina derecha. Donde chocan
casi siempre es con cabeceras pegadas al borde (BBC, The Guardian, idealista, Airbnb).

## Qué hace Zero con esto

- **Con la web en tarjeta** hay marco: los botones de ampliar van en él, a la derecha de los de
  ventana, y no tapan nada.
- **Con la web ampliada**, en reposo solo queda un tirador de 36 × 4 pegado al filo de arriba, en la
  esquina derecha. Al acercar el ratón a esa esquina salen juntos los de ventana y los de ampliar y
  dividir, y al irse se vuelven a guardar: tapan la web solo cuando los buscas.
