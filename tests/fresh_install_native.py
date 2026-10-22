"""Instalación nueva (como en Windows o macOS) con las piezas actuales de la receta.

Toma una copia del motor instalado y le mete kitsune.cfg, el módulo nativo, el estilo
de chrome/, la extensión del inicio integrado y el parche de la barra, sin recompilar.
Luego abre un perfil vacío (sin chrome/ ni inicio fijado) y comprueba que sale Kitsune:
el inicio integrado por defecto, la barra limpia, su aspecto y letras, el modo de
privacidad del user.js, la pestaña nueva y la ayuda.
"""
import argparse

import importlib.util, json, os, shutil, sys, tempfile, time, zipfile
from pathlib import Path

ROOT = Path('/home/risco/Projects/kitsune')
spec = importlib.util.spec_from_file_location('engine', ROOT / 'install/kitsune-engine.py')
engine = importlib.util.module_from_spec(spec); spec.loader.exec_module(engine)

def patched_engine(dest):
    dest = Path(dest)
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(Path.home() / '.local/share/kitsune-browser/engine/current', dest, symlinks=True)
    shutil.copyfile(ROOT / 'install/recipe/kitsune.cfg', dest / 'kitsune.cfg')

    omni = dest / 'browser/omni.ja'
    replace = {}
    base = 'chrome/browser/content/browser/'
    for name in engine.NATIVE_FILES:
        replace[base + name] = (ROOT / 'install/native' / name).read_bytes()
    for name in engine.chrome_style_files():
        replace[base + 'kitsune-chrome/' + name] = (engine.CHROME_STYLE / name).read_bytes()
    staged = engine.stage_home_extension(Path(tempfile.mkdtemp()) / 'ext', '0.7.2')
    for path in staged.rglob('*'):
        if path.is_file():
            replace['chrome/browser/builtin-addons/kitsune-home/' + path.relative_to(staged).as_posix()] = path.read_bytes()
    with engine.open_jar(Path(omni)) as source:
        identity = source.read(base + 'browser-siteIdentity.js').decode()
        (old, new), = engine.TEXT_PATCHES['browser/base/content/browser-siteIdentity.js']
        # Un motor compilado con la receta actual ya trae el parche y la extensión.
        assert old in identity or new in identity
        replace[base + 'browser-siteIdentity.js'] = identity.replace(old, new).encode()
        builtins = json.loads(source.read(base + 'built_in_addons.json'))
        builtins['builtins'] = [b for b in builtins['builtins'] if b['addon_id'] != 'inicio@kitsune']
        builtins['builtins'].append({'addon_id': 'inicio@kitsune', 'addon_version': '0.7.2', 'res_url': 'resource://builtin-addons/kitsune-home/'})
        replace[base + 'built_in_addons.json'] = json.dumps(builtins).encode()
        patched = omni.with_suffix('.new')
        with zipfile.ZipFile(patched, 'w', zipfile.ZIP_DEFLATED) as target:
            for info in source.infolist():
                if info.filename not in replace:
                    target.writestr(info, source.read(info.filename))
            for name, data in replace.items():
                target.writestr(name, data)
    patched.replace(omni)
    return dest / 'kitsune'


from browser_smoke import WebDriver, eventually

parser = argparse.ArgumentParser()
parser.add_argument('--engine-copy', type=Path, default=Path(tempfile.mkdtemp(prefix='kitsune-motor-')) / 'motor')
engine = patched_engine(parser.parse_args().engine_copy)
root = Path(tempfile.mkdtemp(prefix='kitsune-fresh-'))
profile = root / 'profile'; profile.mkdir()
evidence = root / 'evidence'; evidence.mkdir()
(profile / 'user.js').write_text('// Como lo deja el inicio integrado al elegir Cómodo.\n'
                                 'user_pref("kitsune.privacy.requested", "comodo");\n'
                                 'user_pref("browser.shell.checkDefaultBrowser", false);\n')
fake_home = root / 'home'; fake_home.mkdir()
real_home = os.environ['HOME']; os.environ['HOME'] = str(fake_home)
HOME = 'moz-extension://4b1d7c2e-9a3f-4e6b-8c51-2f7a0d9e6b13/start/index.html'
results = {}
d = WebDriver(profile, evidence, browser=engine, headed=True)
os.environ['HOME'] = real_home

def chrome(script, *args, asynchronous=False):
    d.context('chrome'); return d.script(script, list(args), asynchronous)

def check(name, ok, detail=''):
    results[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail and not ok else ''), flush=True)

try:
    # geckodriver abre about:blank; el arranque de verdad abre el inicio: lo pedimos como lo haría Kitsune.
    home_pref = chrome("return Services.prefs.getStringPref('browser.startup.homepage', '')")
    check('El inicio por defecto es el integrado', home_pref == HOME, home_pref)
    chrome("gBrowser.selectedBrowser.loadURI(Services.io.newURI(Services.prefs.getStringPref('browser.startup.homepage')), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()})")
    eventually(lambda: chrome("return gBrowser.selectedBrowser.currentURI.spec") == HOME, timeout=20)
    d.context('content')
    eventually(lambda: d.script("return document.documentElement.dataset.storageReady") == 'true', timeout=20)
    welcome = d.script("return document.querySelector('#welcome-line').textContent")
    check('La extensión del inicio viene instalada en el motor y carga', 'Personal' in welcome, welcome)
    time.sleep(1)
    check('La barra no enseña la dirección moz-extension://', chrome("return gURLBar.value") == '', chrome("return gURLBar.value"))
    identity = chrome("return [document.getElementById('identity-box').className, document.getElementById('identity-icon-label').value]")
    check('La barra presenta el inicio como «Kitsune», no como extensión', identity[0] == 'chromeUI' and identity[1] == 'Kitsune', identity)
    accent = chrome("return getComputedStyle(document.documentElement).getPropertyValue('--kb-accent').trim()")
    check('El aspecto de Kitsune (userChrome) viene del motor', bool(accent), accent)
    registered = chrome("const s = Cc['@mozilla.org/content/style-sheet-service;1'].getService(Ci.nsIStyleSheetService); return s.sheetRegistered(Services.io.newURI('chrome://browser/content/kitsune-chrome/userContent.css'), s.USER_SHEET)")
    check('userContent del motor registrado', registered)
    mode = chrome("return Services.prefs.getStringPref('kitsune.privacy.active', '')")
    check('El modo de privacidad sale del user.js del perfil (sin lanzador)', mode == 'comodo', mode)
    tabs = chrome("return gBrowser.tabs.length")
    chrome("BrowserCommands.openTab()")
    eventually(lambda: chrome("return gBrowser.tabs.length") == tabs + 1, timeout=10)
    eventually(lambda: chrome("return gBrowser.selectedBrowser.currentURI.spec") == HOME, timeout=15)
    check('Una pestaña nueva abre el inicio integrado', True)
    support = chrome("return Services.prefs.getDefaultBranch('').getStringPref('app.support.baseURL', '')")
    check('La ayuda va al inicio integrado', support == HOME.replace('index.html', 'ayuda.html?tema='), support)
    fonts = chrome("const done = arguments[0]; document.fonts.load('12px \"Kitsune Sans\"').then(f => done(f.length), () => done(-1));", asynchronous=True)
    check('Las letras de Kitsune del motor cargan', fonts and fonts > 0, fonts)
    d.settle(); time.sleep(1.5)
    d.screenshot('instalacion-nueva.png', chrome=True)
finally:
    d.close()
print(str(evidence), flush=True)
assert all(results.values()), results
