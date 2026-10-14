"""Estricto ⇄ Cómodo from the profile card, with Kitsune's confirmation popup (real engine).

Cancel leaves the mode as it was; Aceptar saves it in the registry. In Editar, changing
the radio asks the same question and Cancel puts the radio back. Temporary profile only.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import threading

from browser_smoke import ROOT, WebDriver, prepare_profile, eventually

home_spec = importlib.util.spec_from_file_location('native_test_home', ROOT / 'install/home-server.py')
home = importlib.util.module_from_spec(home_spec)
home_spec.loader.exec_module(home)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', type=Path, default=Path.home() / '.local/share/kitsune-browser/engine/current/kitsune')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='kitsune-privacy-switch-'))
    evidence = root / 'evidence'; evidence.mkdir()
    profile, _ = prepare_profile(root)
    state = root / 'state'; state.mkdir()
    profiles = home.profiles_module.ProfileManager(root, state)
    profiles.snapshot()
    server = home.create_server(profile / 'start', state / 'home.json', port=0, profiles=profiles)
    worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
    origin = f'http://127.0.0.1:{server.server_port}/'
    report = {'root': str(root), 'checks': []}
    driver = None

    def check(name):
        report['checks'].append(name); print('PASS ' + name, flush=True)

    def js(script):
        driver.context('content'); return driver.script(script)

    def stored():
        return profiles.snapshot()['profiles'][0].get('privacyMode')

    def popup():
        return js("""const d=document.querySelector('#privacy-dialog');
          return {open:d.open, title:document.querySelector('#privacy-dialog-title').textContent,
            effect:document.querySelector('#privacy-dialog-effect').textContent,
            target:document.querySelector('.privacy-card[data-target=true]')?.dataset.mode};""")

    try:
        driver = WebDriver(profile, evidence, browser=args.browser)
        driver.navigate(origin)
        eventually(lambda: js("return document.documentElement.dataset.profilesReady") == 'true', timeout=15)
        # Desde la beta 5 el avatar abre la tarjeta de usuarios; «Gestionar usuarios», el diálogo con la privacidad.
        driver.click('#profiles-open')
        eventually(lambda: js("return !!document.getElementById('users-manage')?.getBoundingClientRect().width"), timeout=10)
        driver.click('#users-manage')
        eventually(lambda: js("return document.getElementById('profiles-dialog').open && !document.querySelector('[data-privacy-switch=comodo]').disabled"), timeout=10)
        assert js("return document.querySelector('[data-privacy-switch=estricto]').getAttribute('aria-pressed')") == 'true'
        driver.click('[data-privacy-switch=comodo]')
        shown = eventually(lambda: (p := popup())['open'] and p, timeout=5)
        assert shown['title'] == '¿Pasar a Cómodo?' and shown['target'] == 'comodo' and 'cuentas abiertas' in shown['effect'], shown
        driver.settle()
        driver.screenshot('popup-comodo.png')
        driver.click('#privacy-cancel')
        eventually(lambda: not popup()['open'], timeout=5)
        assert stored() in (None, 'estricto')
        assert js("return document.querySelector('[data-privacy-switch=estricto]').getAttribute('aria-pressed')") == 'true'
        check('Cancelar en la ventana deja el perfil en Estricto')
        driver.click('[data-privacy-switch=comodo]')
        eventually(lambda: popup()['open'], timeout=5)
        driver.click('#privacy-accept')
        eventually(lambda: stored() == 'comodo', timeout=10)
        eventually(lambda: js("return document.querySelector('[data-privacy-switch=comodo]').getAttribute('aria-pressed')") == 'true', timeout=5)
        assert 'Cómodo' in js("return document.querySelector('#profile-privacy-status').textContent")
        check('Aceptar pasa el perfil a Cómodo desde su ficha, sin entrar en Editar')
        driver.click('[data-privacy-switch=estricto]')
        shown = eventually(lambda: (p := popup())['open'] and p, timeout=5)
        assert shown['title'] == '¿Pasar a Estricto?' and 'volver a entrar' in shown['effect'], shown
        driver.screenshot('popup-estricto.png')
        driver.click('#privacy-accept')
        eventually(lambda: stored() == 'estricto', timeout=10)
        check('Volver a Estricto avisa de que se cerrarán las sesiones')
        driver.click('#profile-edit')
        eventually(lambda: js("return !document.querySelector('#profile-form').hidden"), timeout=5)
        driver.click('label[for=profile-privacy-comodo]')
        eventually(lambda: popup()['open'], timeout=5)
        driver.click('#privacy-cancel')
        eventually(lambda: not popup()['open'], timeout=5)
        assert js("return document.querySelector('#profile-privacy-estricto').checked") is True
        check('En Editar, cambiar el modo pregunta lo mismo y Cancelar devuelve la opción')
        report['status'] = 'passed'
    finally:
        if driver: driver.close()
        server.shutdown(); server.server_close(); worker.join(timeout=3)
        (evidence / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(str(evidence), flush=True)


if __name__ == '__main__': main()
