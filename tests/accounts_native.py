#!/usr/bin/env python3
"""Check the real, opt-in account controls without signing in to any account."""
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
        assert report["baseline"]["sync"] is True
        assert all(report["baseline"][key] for key in ("signatures", "strictFiles", "sanitization"))
        # Kitsune's own engine offers Firefox Sync natively: nothing to unlock,
        # nothing synchronizes until the user signs in to a Mozilla account.
        driver.navigate("about:preferences#sync")
        driver.settle()
        report["sync"] = driver.script("""return {
          url: location.href, signIn: [...document.querySelectorAll('[id]')]
            .filter(el=>/fxa|syncNoFxaSignIn|syncSignIn/i.test(el.id) && el.getBoundingClientRect().width > 0)
            .map(el=>({id:el.id,label:el.getAttribute('label'),text:el.textContent.trim().slice(0,100)}))
        }""")
        report["screenshots"] = [driver.screenshot("native-sync-ready.png", chrome=True)]
        assert report["sync"]["signIn"], report["sync"]
        driver.close()
        driver = h.WebDriver(profile, evidence, browser=args.browser)
        driver.context("chrome")
        report["protectionsAfterRestart"] = driver.script("""return {
          sync: Services.prefs.getBoolPref('identity.fxaccounts.enabled', false),
          signatures: Services.prefs.getBoolPref('xpinstall.signatures.required', true),
          strictFiles: Services.prefs.getBoolPref('security.fileuri.strict_origin_policy', true),
          sanitization: Services.prefs.getBoolPref('privacy.sanitize.sanitizeOnShutdown', true)
        }""")
        assert all(report["protectionsAfterRestart"].values())
        report["ok"] = True
    finally:
        if driver:
            driver.close()
        (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
