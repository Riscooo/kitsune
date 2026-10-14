# Contribuir a Kitsune

Kitsune es un navegador propio: Gecko (el motor de Firefox) compilado desde el código
oficial de Mozilla, con su marca, su módulo nativo, su inicio y su estética Tinta. Se
agradece cualquier ayuda: fallos, ideas, temas, traducciones y código.

## Antes de nada

- **Fallos e ideas**: abre una issue con su plantilla. Si es un fallo, di el sistema
  (Windows, macOS o Linux), la versión de Kitsune (`about:config` → `kitsune.release`) y
  cómo repetirlo.
- **Cambios pequeños** (textos, estilos, una prueba): manda el PR directamente.
- **Cambios grandes** (una función nueva, otro módulo): cuéntalo antes en una issue, para
  no hacer trabajo que no encaje.

## Cómo está hecho

| Carpeta | Qué hay |
|---|---|
| `install/kitsune-engine.py` | Descarga Gecko, comprueba la firma de Mozilla, aplica la receta de Kitsune y compila, prueba y activa el motor. |
| `install/native/` | El módulo nativo: código de la ventana (espacios, paleta, vista rápida, modo ahorro…). Va dentro del motor. |
| `install/recipe/kitsune.cfg` | La configuración del motor: privacidad (Estricto/Cómodo, generada por `tools/privacy_modes.py`) e identidad sin rastro de Mozilla. |
| `chrome/` | La estética Tinta de la ventana y de las páginas internas. Solo tokens de color de papel (`palette.css`). |
| `start/` | «Tu inicio»: la página de inicio, sus ajustes y la ayuda. |
| `install/home-server.py`, `install/home-extension/` | El inicio en Linux (servidor local) y en Windows/macOS (extensión interna). Hacen lo mismo y hay pruebas que lo comparan. |
| `web/` | La web de descarga. Se publica a mano con cada versión, no al subir a `main`. |
| `tests/` | Pruebas: `*.test.mjs` (Node), `*_test.py` (Python) y `*_native.py` (con el motor real). |

## Compilar sin congelar el ordenador

Compilar Gecko es pesado: el primer motor puede tardar horas y pedir más de 13 GB de RAM
en el enlazado si no se limita. Hazlo siempre en una unidad de systemd con límites, nunca
como proceso suelto:

```sh
systemd-run --user --unit kitsune-engine --collect \
  -p MemoryMax=65% -p MemorySwapMax=0 -p OOMScoreAdjust=900 -p Nice=19 -p IOSchedulingClass=idle -p CPUWeight=idle \
  python3 install/kitsune-engine.py build --version 157.0.1
```

`kitsune-engine.py` ya elige las tareas en paralelo según la memoria libre y usa LTO thin
para Rust. Necesita unos 50 GB libres en `~/.cache/kitsune-build`. Con el código ya
extraído, cambiar solo el módulo nativo o el estilo recompila en menos de un minuto.
Windows y macOS se compilan desde Linux: `build --target windows` y `--target macos`.

## Probar

```sh
npm ci
npm run check                                         # sintaxis, pruebas de Node y el inicio empaquetado
python3 -m unittest discover -s tests -p '*_test.py'  # pruebas de Python
python3 tools/privacy_modes.py --check                # kitsune.cfg al día con las mediciones
python3 tests/spaces_native.py                        # y las *_native.py de lo que toques
```

Las pruebas `*_native.py` abren el motor real con un perfil temporal (sin tocar el tuyo) y
casi todas sin ventana. Pasa las de lo que hayas cambiado y di en el PR cuáles.

## Tintas

Una tinta pone los colores de todo Kitsune (la ventana, el inicio y las páginas internas),
en Claro y en Oscuro. Son los diez tokens de papel, en hexadecimal y en minúsculas:

| Token | Para qué |
|---|---|
| `bg`, `surface`, `surfaceHigh` | El fondo, las tarjetas y lo que va encima de ellas. |
| `text`, `muted`, `tertiary` | El texto, el secundario y el más suave. |
| `outline` | Bordes y líneas. |
| `primary`, `primaryContainer` | El acento (botones, enlaces, el ensō) y su fondo suave. |
| `secondary` | El segundo color, para lo que no es el acento. |

Para proponer una:

1. Añádela al final de `start/tintas.json`, con un `id` corto (`[a-z][a-z0-9-]`), su
   `name`, tu nombre en `author` y las dos paletas, `claro` y `oscuro`.
2. `python3 tools/tintas.py`: comprueba que se lea al menos tan bien como Papel (los
   contrastes mínimos de `install/tintas.py`) y la copia al inicio de Windows y macOS y a
   la web. Si algún color se queda corto, te dice cuál y cuánto le falta.
3. `python3 tests/tintas_native.py` si tienes el motor compilado, y una captura en Claro
   y en Oscuro en el PR.

Si no quieres tocar código, abre una issue con la plantilla «Una tinta» y los colores.

## Estilo

- **Textos para la gente en castellano de España**, claros y cortos («Traer de otro
  navegador», no «Importar datos»). Sin anglicismos que tengan palabra en castellano.
- **Comentarios del código en castellano**, contando el porqué, no el qué.
- **Mensajes de commit en castellano**: una primera línea que diga qué cambia para quien
  usa Kitsune, y debajo el porqué y cómo se ha probado.
- **Estética Tinta**: papel, tinta y óxido; nada de los azules ni violetas de Gecko. Las
  pruebas de `tests/chrome_css.test.mjs` rechazan colores fuera de los tokens.
- **Sin rastro de Mozilla** en la interfaz y **nada que salga del equipo** sin que la
  persona lo pida.

## Licencia

Los archivos de Gecko que se modifican siguen con la MPL 2.0. La licencia del resto del
repositorio está pendiente de decidir; hasta entonces, al mandar un PR aceptas que tu
aportación se publique con la licencia que se elija para Kitsune.
