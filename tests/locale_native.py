"""El idioma de la primera vez en el motor real (kitsune.cfg).

- Un perfil nuevo sale en el idioma del sistema: castellano con el sistema en es_ES e
  inglés con el sistema en en_US. Y lo sigue haciendo al volver a abrirlo (no se fija).
- Un perfil de antes de 0.8 (ya tiene modo de privacidad y nunca eligió idioma) sigue en
  castellano aunque el sistema esté en inglés: se le fija es-ES una vez.
- Si alguien eligió idioma en Ajustes → Idioma, se respeta.
"""
import argparse
import os
from pathlib import Path
import re
import tempfile

from browser_smoke import WebDriver, prepare_profile

PREFS = """return {
  locale: Services.locale.appLocaleAsBCP47,
  pinned: Services.prefs.prefHasUserValue('intl.locale.requested') ? Services.prefs.getStringPref('intl.locale.requested') : null,
  decided: Services.prefs.getBoolPref('kitsune.locale.decided', false),
}"""


def system(language):
    return {'LANG': f'{language}.UTF-8', 'LC_ALL': f'{language}.UTF-8', 'LC_MESSAGES': f'{language}.UTF-8', 'LANGUAGE': language.split('_')[0]}


def fresh_profile(root, name, prefs_js=''):
    """Un perfil de prueba sin el es-ES que ponen las demás pruebas (aquí se mira justo eso)."""
    folder = root / name
    folder.mkdir()
    profile, _ = prepare_profile(folder)
    user_js = profile / 'user.js'
    user_js.write_text(re.sub(r'(?m)^user_pref\("intl\.locale\.requested".*\n', '', user_js.read_text()))
    if prefs_js:
        (profile / 'prefs.js').write_text(prefs_js)
    return profile


def open_and_read(profile, evidence, browser, language):
    # El idioma del «sistema» va en el entorno de geckodriver, que lo hereda Kitsune (su
    # opción «env» no llega al navegador).
    saved = {name: os.environ.get(name) for name in system(language)}
    os.environ.update(system(language))
    try:
        driver = WebDriver(profile, evidence, browser=browser)
        try:
            driver.context('chrome')
            return driver.script(PREFS)
        finally:
            driver.close()
    finally:
        for name, value in saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-locale-'))
    evidence = root / 'evidence'
    evidence.mkdir()

    def check(name):
        print('PASS ' + name, flush=True)

    spanish = open_and_read(fresh_profile(root, 'nuevo-es'), evidence, args.browser, 'es_ES')
    assert spanish['locale'].startswith('es') and spanish['pinned'] is None and spanish['decided'], spanish
    check(f'Perfil nuevo con el sistema en castellano: {spanish["locale"]}, sin fijar')

    english_profile = fresh_profile(root, 'nuevo-en')
    english = open_and_read(english_profile, evidence, args.browser, 'en_US')
    assert english['locale'].startswith('en') and english['pinned'] is None and english['decided'], english
    again = open_and_read(english_profile, evidence, args.browser, 'en_US')
    assert again['locale'].startswith('en') and again['pinned'] is None, again
    check(f'Perfil nuevo con el sistema en inglés: {english["locale"]}, y sigue igual al volver a abrirlo')

    old = open_and_read(fresh_profile(root, 'de-antes', 'user_pref("kitsune.privacy.applied", "estricto");\n'), evidence, args.browser, 'en_US')
    assert old['locale'].startswith('es') and old['pinned'] == 'es-ES' and old['decided'], old
    check('Perfil de antes de 0.8 con el sistema en inglés: sigue en castellano (es-ES fijado una vez)')

    chosen = open_and_read(fresh_profile(root, 'elegido', 'user_pref("kitsune.privacy.applied", "comodo");\nuser_pref("intl.locale.requested", "en-US");\n'),
                           evidence, args.browser, 'es_ES')
    assert chosen['locale'].startswith('en') and chosen['pinned'] == 'en-US', chosen
    check('Un idioma elegido a mano se respeta (en-US con el sistema en castellano)')
    print(evidence)


if __name__ == '__main__':
    main()
