"""Arnés de las pruebas de Kitsune Zero con el motor real.

Con «desde el repositorio» (--zero-del-repo), las URL de Zero (chrome://browser/content/zero/…) y la del
anfitrión de Kitsune (chrome://browser/content/kitsune-zero-host.sys.mjs) se sustituyen por los
archivos del repositorio con un chrome.manifest temporal («override»), y se hace a mano lo que hará el
arranque de la ventana (kitsune-bootstrap.js). Así se prueba antes de compilar el motor, con las
mismas URL que en producción.
"""
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ZERO = ROOT / "zero"
HOST = "chrome://browser/content/kitsune-zero-host.sys.mjs"

# Lo mismo que hace kitsune-bootstrap.js en cada ventana.
BOOT = """
const { KitsuneZeroHost } = ChromeUtils.importESModule(arguments[0]);
for (const win of Services.wm.getEnumerator('navigator:browser')) KitsuneZeroHost.decorate(win);
"""

# Las ventanas nuevas también. En el motor lo hace kitsune-bootstrap.js, un <script> de browser.xhtml
# que corre mientras se lee la página, antes de que la ventana tenga gBrowser: aquí, igual de pronto
# (en DOMContentLoaded, antes que el propio arranque de Gecko), para que las pruebas lo vean.
WATCH_NEW = """
const { KitsuneZeroHost } = ChromeUtils.importESModule(arguments[0]);
if (!globalThis.__zeroWatching) {
  globalThis.__zeroWatching = true;
  Services.obs.addObserver(win => win.addEventListener('DOMContentLoaded', () => KitsuneZeroHost.decorate(win), { once: true, capture: true }), 'domwindowopened');
}
"""

REGISTER = """
const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
file.initWithPath(arguments[0]);
Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(file);
"""


def manifest_from_repo(folder: Path) -> Path:
    """Un chrome.manifest con un «override» por archivo de Zero y otro para el anfitrión."""
    lines = []
    for part in ("modules", "chrome", "assets"):
        for path in sorted((ZERO / part).iterdir()):
            if path.is_file():
                lines.append(f"override chrome://browser/content/zero/{path.name} {path.as_uri()}")
    lines.append(f"override {HOST} {(ROOT / 'install/native/kitsune-zero-host.sys.mjs').as_uri()}")
    manifest = folder / "chrome.manifest"
    manifest.write_text("\n".join(lines) + "\n")
    return manifest


def prepare(chrome, from_repo: bool):
    """Deja Zero listo en todas las ventanas. `chrome(script, args)` ejecuta en contexto chrome."""
    if from_repo:
        manifest = manifest_from_repo(Path(tempfile.mkdtemp(prefix="kitsune-zero-manifest-")))
        chrome(REGISTER, [str(manifest)])
        chrome(BOOT, [HOST])
        chrome(WATCH_NEW, [HOST])
