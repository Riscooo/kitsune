#!/usr/bin/env python3
"""Sin cuentas de Mozilla: Sync no existe en Kitsune y las protecciones siguen activas."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import tempfile

import browser_smoke as h


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", type=Path, default=h.DEFAULT_BROWSER)
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix="kitsune-accounts-native-"))
    evidence = root / "evidence"
    evidence.mkdir()
    profile, _ = h.prepare_profile(root)
    report = {"ok": False, "work": str(root), "accountSignInAttempted": False}
    driver = None
    try:
        driver = h.WebDriver(profile, evidence, browser=args.browser)
        driver.context("chrome")
        report["baseline"] = driver.script("""return {
          sync: Services.prefs.getBoolPref('identity.fxaccounts.enabled', false),
          signatures: Services.prefs.getBoolPref('xpinstall.signatures.required', true),
          strictFiles: Services.prefs.getBoolPref('security.fileuri.strict_origin_policy', true),
          sanitization: Services.prefs.getBoolPref('privacy.sanitize.sanitizeOnShutdown', true),
          cookieBehavior: Services.prefs.getIntPref('network.cookie.cookieBehavior')
        }""")
        assert report["baseline"]["sync"] is False
        assert all(report["baseline"][key] for key in ("signatures", "strictFiles", "sanitization"))
        # Sin Sync ni cuentas de Mozilla: ni botón de cuenta en la barra ni sección en Ajustes.
        report["accountButton"] = driver.script("const b=document.getElementById('fxa-toolbar-menu-button'); return !!b && !b.hidden && b.getBoundingClientRect().width > 0;")
        assert report["accountButton"] is False
        driver.navigate("about:preferences")
        driver.settle()
        report["syncCategory"] = driver.script("const c=document.querySelector('#category-sync'); return !!c && !c.hidden && c.getBoundingClientRect().width > 0;")
        assert report["syncCategory"] is False, report
        report["screenshots"] = [driver.screenshot("native-no-sync.png", chrome=True)]
        driver.close()
        driver = h.WebDriver(profile, evidence, browser=args.browser)
        driver.context("chrome")
        report["protectionsAfterRestart"] = driver.script("""return {
          sync: Services.prefs.getBoolPref('identity.fxaccounts.enabled', false),
          signatures: Services.prefs.getBoolPref('xpinstall.signatures.required', true),
          strictFiles: Services.prefs.getBoolPref('security.fileuri.strict_origin_policy', true),
          sanitization: Services.prefs.getBoolPref('privacy.sanitize.sanitizeOnShutdown', true)
        }""")
        sync = report["protectionsAfterRestart"].pop("sync")
        assert sync is False and all(report["protectionsAfterRestart"].values())
        report["ok"] = True
    finally:
        if driver:
            driver.close()
        (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
