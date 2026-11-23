# Avisos de licencias

Kitsune y Kitsune Zero se apoyan en software y recursos de otros, que conservan sus licencias.

| Qué | Licencia | Dónde |
|---|---|---|
| **Gecko**, el motor de Mozilla | [MPL 2.0](https://www.mozilla.org/MPL/2.0/) | El código de cada versión, en [archive.mozilla.org](https://archive.mozilla.org/pub/firefox/releases/). Los cambios de Kitsune a sus archivos, en `install/kitsune-engine.py` (`TEXT_PATCHES`) e `install/recipe/`: se aplican al compilar y siguen bajo la MPL 2.0. El aviso completo va dentro del navegador, en `about:license`. |
| **uBlock Origin** | [GPL 3.0](https://www.gnu.org/licenses/gpl-3.0.html) | [github.com/gorhill/uBlock](https://github.com/gorhill/uBlock), sin cambios |
| **Noto Sans** y **Noto Serif** | [SIL OFL 1.1](https://openfontlicense.org/) | `chrome/assets/fuentes`, `start/fuentes` |
| Los sonidos de Zero | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/deed.es) | `zero/assets/zero-sonido-*.ogg`; los autores, en `zero/SONIDOS.md` |

**Widevine** no va en Kitsune: lo descarga Gecko de Google cuando una web lo pide, con sus condiciones. **Spotify** suena por la app
oficial de cada uno, si la tiene.

El nombre Kitsune, el logo, la mascota y la estética «Tinta» son de su autor. Mozilla y Firefox son marcas de la Mozilla Foundation;
Spotify, de Spotify AB; Google y Widevine, de Google LLC. Kitsune no está afiliado a ninguno ni cuenta con su respaldo.
