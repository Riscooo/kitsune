#!/usr/bin/env python3
"""Start Kitsune's real engine in both privacy modes and compare with the measurements.

1. Estricto on a fresh profile reproduces Kitsune 0.5 (LibreWolf 154 + 0.5 user.js)
   for every preference kitsune.cfg manages.
2. Cómodo on a fresh profile uses Gecko's factory value (or the Cómodo value).
3. A pre-0.6 profile that opens in Estricto keeps a manual change.
4. Switching modes clears managed values once, and switching back restores Estricto.
Temporary profiles only; no network access is needed.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "install"))
from engine_probe import dump_prefs  # noqa: E402

SPEC = importlib.util.spec_from_file_location("privacy_modes", ROOT / "tools/privacy_modes.py")
modes = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(modes)
DEFAULT_BROWSER = Path.home() / ".local/share/kitsune-browser/engine/current/kitsune"
USER_JS = (ROOT / "install/user.js").read_text()


def effective(dump, name):
    entry = dump["prefs"].get(name)
    return None if entry is None else modes.effective(entry)


def fresh(browser, mode, profile=None, setup=None):
    def seed(directory):
        if not (directory / "user.js").exists():
            (directory / "user.js").write_text(USER_JS + "\n")
        if setup:
            setup(directory)
    return dump_prefs(browser, {"KITSUNE_PRIVACY_MODE": mode}, profile_setup=seed, profile_dir=profile)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", type=Path, default=DEFAULT_BROWSER)
    args = parser.parse_args()
    browser = args.browser.resolve(strict=True)
    reference = json.loads(modes.REFERENCE.read_text())
    factory = json.loads(modes.FACTORY.read_text())
    sets, unclassified, _ = modes.generate(reference, factory)
    assert not unclassified, unclassified
    checks = []

    strict = fresh(browser, "estricto")
    assert effective(strict, "kitsune.privacy.active") == "estricto"
    wrong = {name: (effective(strict, name), value) for name, value in {**sets["common"],
             **{n: v[0] for n, v in sets["mode"].items()}}.items() if effective(strict, name) != value}
    assert not wrong, f"Estricto no reproduce 0.5: {wrong}"
    checks.append(f"Estricto reproduce 0.5 en {len(sets['common']) + len(sets['mode'])} ajustes gestionados")

    comfort = fresh(browser, "comodo")
    assert effective(comfort, "kitsune.privacy.active") == "comodo"
    wrong = {}
    for name, (_, comfort_value) in sets["mode"].items():
        expected = comfort_value if comfort_value is not None else effective(factory, name)
        if effective(comfort, name) != expected:
            wrong[name] = (effective(comfort, name), expected)
    wrong.update({name: (effective(comfort, name), value) for name, value in sets["common"].items()
                  if effective(comfort, name) != value})
    assert not wrong, f"Cómodo no aplica sus valores: {wrong}"
    checks.append(f"Cómodo usa fábrica o su valor en {len(sets['mode'])} ajustes y comparte {len(sets['common'])}")

    sanitize = "privacy.sanitize.sanitizeOnShutdown"
    assert sanitize in sets["mode"] and sets["mode"][sanitize][0] is True, "Estricto debe limpiar al cerrar"
    work = Path(tempfile.mkdtemp(prefix="kitsune-privacy-modes-"))
    try:
        profile = work / "profile"
        profile.mkdir(mode=0o700)
        # A pre-0.6 profile: the 0.5 user.js left strict values in prefs.js, plus a manual change.
        (profile / "prefs.js").write_text(
            'user_pref("browser.contentblocking.category", "strict");\n'
            f'user_pref("{sanitize}", true);\n'
            'user_pref("privacy.clearOnShutdown_v2.formdata", false);\n')
        first = fresh(browser, "estricto", profile)
        assert effective(first, "privacy.clearOnShutdown_v2.formdata") is False, "Estricto no respetó un cambio manual"
        assert first["prefs"]["kitsune.privacy.applied"]["user"] == "estricto"
        checks.append("Un perfil anterior a 0.6 abre en Estricto sin perder cambios manuales")
        switched = fresh(browser, "comodo", profile)
        assert effective(switched, "browser.contentblocking.category") == "standard"
        assert effective(switched, sanitize) == effective(factory, sanitize)
        assert switched["prefs"][sanitize]["user"] is None
        assert switched["prefs"]["kitsune.privacy.applied"]["user"] == "comodo"
        back = fresh(browser, "estricto", profile)
        assert effective(back, sanitize) is True and effective(back, "browser.contentblocking.category") == "strict"
        assert back["prefs"]["kitsune.privacy.applied"]["user"] == "estricto"
        checks.append("Cambiar a Cómodo limpia los restos de Estricto y volver a Estricto lo restaura")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(json.dumps({"passed": len(checks), "checks": checks}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
