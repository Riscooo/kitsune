#!/usr/bin/env python3
"""Dump the effective preferences of a Gecko engine on a brand-new empty profile.

Measures what an engine does by default (factory values, locks and the user
values its autoconfig/policies set). Talks to Marionette directly, see
install/engine_probe.py. Test/tooling only; the profile is temporary.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "install"))
from engine_probe import dump_prefs  # noqa: E402


# Remote rollouts and region lookup off, as in Kitsune's common settings (the
# harness names are left out of the result; privacy_modes.py keeps them common).
NO_REMOTE_DEFAULTS = {"app.normandy.api_url": "", "browser.region.network.url": "",
                      "browser.region.update.enabled": False}


def factory_prefs(browser: Path, env):
    """Measure the engine with no Kitsune configuration, without touching the installed one.

    A hard-linked copy of the engine (same filesystem, no extra space) gets an
    empty kitsune.cfg; Gecko finds its configuration next to the executable.
    Mozilla's remote rollouts and the network region lookup are off, as Kitsune
    always has them in both modes: otherwise a rollout rewrites default values
    during the measurement (e.g. network.http.dictionaries.enable, compiled as
    false in release builds) and the result depends on the day it was taken.
    """
    work = Path(tempfile.mkdtemp(prefix="kitsune-factory-", dir=Path.home() / ".cache"))
    try:
        copy = work / "engine"
        subprocess.run(["cp", "-al", str(browser.parent), str(copy)], check=True)
        cfg = copy / "kitsune.cfg"
        cfg.unlink()
        cfg.write_text("// Kitsune: medición de fábrica, sin configuración propia.\n")
        user_js = (ROOT / "install/user.js").read_text()
        return dump_prefs(copy / browser.name, env, user_prefs=NO_REMOTE_DEFAULTS,
                          profile_setup=lambda profile: (profile / "user.js").write_text(user_js + "\n"))
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--env", action="append", default=[], help="KEY=VALUE for the engine process")
    parser.add_argument("--factory", action="store_true",
                        help="Kitsune engine without kitsune.cfg, with its policies and the template user.js: "
                             "the factory values tools/privacy_modes.py compares (kitsune-engine-factory-prefs.json)")
    args = parser.parse_args()
    env = dict(item.split("=", 1) for item in args.env)
    browser = args.browser.resolve(strict=True)
    if args.factory:
        result = factory_prefs(browser, env)
    else:
        result = dump_prefs(browser, env)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    print(json.dumps({"app": result["app"], "prefs": len(result["prefs"]), "policies": len(result["policies"])}))


if __name__ == "__main__":
    sys.exit(main())
