#!/usr/bin/env python3
"""Capturas de la web de Kitsune con el motor real, en castellano y en inglés.

Cada escena abre Kitsune con un perfil temporal (nunca el tuyo), lo deja como se ve en la
web y guarda la ventana entera en web/assets/capturas/<nombre>.webp (1440 px) y
<nombre>-720.webp. Las de inglés llevan «-en». Sin ventana: no toca el escritorio.

    python3 tools/capturas_web.py                    # todas
    python3 tools/capturas_web.py --escena pestanas  # solo una
    python3 tools/capturas_web.py --idioma en

Escenas:
- pestanas: pestañas a un lado, dos espacios («Trabajo» y «Casa») y una vista dividida con
  dos webs de verdad (hace falta red).
- inicio: «Tu inicio» en Claro y en Oscuro (el inicio de serie, sin fondo propio).
"""
from __future__ import annotations

import argparse
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from browser_smoke import WebDriver, eventually, prepare_profile  # noqa: E402

from PIL import Image  # noqa: E402


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


appearance = load('capturas_appearance', 'install/appearance.py')
home = load('capturas_home', 'install/home-server.py')
OUT = ROOT / 'web/assets/capturas'
SIZE = (1440, 900)
SPACES = "ChromeUtils.importESModule('chrome://browser/content/kitsune-spaces.sys.mjs').KitsuneSpaces"
TEXTS = {
    'es': {'work': 'Trabajo', 'home': 'Casa', 'name': 'Kai', 'pages': [
        'https://es.wikipedia.org/wiki/Kitsune', 'https://developer.mozilla.org/es/docs/Web/CSS',
        'https://github.com/Riscooo/kitsune', 'https://docs.python.org/es/3/']},
    'en': {'work': 'Work', 'home': 'Home', 'name': 'Kai', 'pages': [
        'https://en.wikipedia.org/wiki/Kitsune', 'https://developer.mozilla.org/en-US/docs/Web/CSS',
        'https://github.com/Riscooo/kitsune', 'https://docs.python.org/3/']},
}


class Session:
    """Kitsune con un perfil temporal, su servidor del inicio y su apariencia, en un idioma."""

    def __init__(self, browser, language):
        self.root = Path(tempfile.mkdtemp(prefix='kitsune-capturas-'))
        evidence = self.root / 'evidence'
        evidence.mkdir()
        self.profile, _ = prepare_profile(self.root)
        with (self.profile / 'user.js').open('a') as prefs:
            prefs.write(f'user_pref("intl.locale.requested", "{"es-ES" if language == "es" else "en-US"}");\n')
        state = self.root / 'state'
        state.mkdir()
        (self.root / 'native').mkdir()
        (self.root / 'native/kitsune-appearance.sys.mjs').write_text('// disponible')
        self.profiles = home.profiles_module.ProfileManager(self.root, state)
        snapshot = self.profiles.snapshot()
        self.profiles.edit('default', TEXTS[language]['name'], '', 'teal', snapshot['revision'])
        self.manager = appearance.AppearanceManager(self.root, state)
        self.server = home.create_server(self.profile / 'start', state / 'home.json', port=0, profiles=self.profiles, appearance=self.manager)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.origin = f'http://127.0.0.1:{self.server.server_port}'
        self.settings(theme='claro')
        self.driver = WebDriver(self.profile, evidence, browser=browser)
        self.driver.command('POST', '/window/rect', {'width': SIZE[0], 'height': SIZE[1]})

    def settings(self, **changes):
        snapshot = self.server.store.snapshot()
        data = {**snapshot['data'], **changes}
        self.server.store.update(data, snapshot['revision'])
        self.manager.refresh(data)

    def chrome(self, script, *values, asynchronous=False):
        self.driver.context('chrome')
        return self.driver.script(script, list(values), asynchronous)

    def shot(self, name):
        png = self.driver.screenshot(f'{name}.png', chrome=True)
        image = Image.open(io.BytesIO(png) if isinstance(png, bytes) else png).convert('RGB')
        OUT.mkdir(parents=True, exist_ok=True)
        image.resize(SIZE, Image.LANCZOS).save(OUT / f'{name}.webp', quality=82, method=6)
        image.resize((SIZE[0] // 2, SIZE[1] // 2), Image.LANCZOS).save(OUT / f'{name}-720.webp', quality=82, method=6)
        print(f'  {name}.webp y {name}-720.webp', flush=True)

    def close(self):
        self.driver.close()
        self.server.shutdown()
        self.server.server_close()


def tabs_scene(session, language, suffix):
    text = TEXTS[language]
    session.settings(tabs='lado')
    eventually(lambda: session.chrome("return Services.prefs.getBoolPref('sidebar.verticalTabs', false)"), timeout=15)
    session.chrome(f"""const S = {SPACES}; const done = arguments[arguments.length - 1];
      (async () => {{ const first = S.list().spaces[0].id; await S.edit(first, {{ name: arguments[0], color: 'blue' }});
        await S.create({{ name: arguments[1], color: 'teal' }}); }})().then(() => done(true), e => done(String(e)));""",
                   text['work'], text['home'], asynchronous=True)
    session.chrome("""const [pages] = arguments; const system = Services.scriptSecurityManager.getSystemPrincipal();
      const tabs = pages.map(url => gBrowser.addTab(url, { triggeringPrincipal: system }));
      gBrowser.selectedTab = tabs[0];
      for (const tab of [...gBrowser.tabs]) if (!tabs.includes(tab) && !tab.pinned) gBrowser.removeTab(tab, { animate: false });
      gBrowser.addTabSplitView([tabs[0], tabs[1]]);""", text['pages'])
    # Que carguen las webs (y sus fuentes) antes de la foto.
    eventually(lambda: session.chrome("return [...gBrowser.tabs].every(t => !t.hasAttribute('busy'))"), timeout=60)
    time.sleep(4)
    session.shot(f'pestanas{suffix}')


def home_scene(session, language, suffix):
    session.chrome("const [url] = arguments; gBrowser.selectedBrowser.loadURI(Services.io.newURI(url), "
                   "{ triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });", session.origin + '/')
    session.driver.context('content')
    eventually(lambda: session.driver.script("return document.documentElement.dataset.ready === 'true'"), timeout=20)
    for theme in ('claro', 'oscuro'):
        session.settings(theme=theme)
        session.driver.navigate(session.origin + '/')
        eventually(lambda: session.driver.script("return document.documentElement.dataset.ready === 'true'"), timeout=20)
        time.sleep(2)
        session.shot(f'inicio-{theme}{suffix}')


SCENES = {'pestanas': tabs_scene, 'inicio': home_scene}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    parser.add_argument('--escena', choices=sorted(SCENES), action='append')
    parser.add_argument('--idioma', choices=('es', 'en'), action='append')
    args = parser.parse_args()
    for language in args.idioma or ['es', 'en']:
        for name in args.escena or sorted(SCENES):
            if name == 'inicio' and language == 'es':
                continue  # las de castellano ya están en la web (con su fondo de aurora)
            print(f'{name} ({language})', flush=True)
            session = Session(args.browser, language)
            try:
                SCENES[name](session, language, '' if language == 'es' else '-en')
            finally:
                session.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
