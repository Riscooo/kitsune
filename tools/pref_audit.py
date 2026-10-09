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
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "install"))
from engine_probe import dump_prefs  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--env", action="append", default=[], help="KEY=VALUE for the engine process")
    args = parser.parse_args()
    env = dict(item.split("=", 1) for item in args.env)
    result = dump_prefs(args.browser.resolve(strict=True), env)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    print(json.dumps({"app": result["app"], "prefs": len(result["prefs"]), "policies": len(result["policies"])}))


if __name__ == "__main__":
    sys.exit(main())
