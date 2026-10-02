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
        assert report["baseline"]["sync"] is False
        assert all(report["baseline"][key] for key in ("signatures", "strictFiles", "sanitization"))
        driver.navigate("about:preferences#librewolf")
        h.eventually(lambda: driver.script("return document.readyState === 'complete' && document.body.innerText.length > 100"))
        driver.settle()
        report["preferences"] = driver.script("""return {
          title: document.title, url: location.href, text: document.body.innerText.slice(0,14000),
          controls: [...document.querySelectorAll('setting-control, moz-checkbox, checkbox, button')]
            .map(el => ({tag:el.localName,id:el.id,label:el.getAttribute('label'),
              setting:el.getAttribute('setting'),settingId:el.getAttribute('setting-id'),
              text:el.textContent.trim().slice(0,120)}))
            .filter(el=> /sync|cookie|librewolf/i.test(JSON.stringify(el)))
        }""")
        report["screenshots"] = [driver.screenshot("native-accounts-options.png", chrome=True)]
        driver.navigate("about:preferences#privacy")
        driver.settle()
        report["privacy"] = driver.script("""return {
          url: location.href,
          controls: [...document.querySelectorAll('button, setting-control')]
            .map(el=>({id:el.id,setting:el.getAttribute('setting-id'),text:el.textContent.trim().slice(0,120)}))
            .filter(el=>/cookie|exception|history|permission/i.test(JSON.stringify(el)))
        }""")
        driver.navigate("about:preferences#sync")
        control = h.eventually(lambda: driver.script("""return [...document.querySelectorAll('#librewolfSync')]
          .find(el=>el.getBoundingClientRect().width > 0 && !el.closest('[hidden]')) || null"""))
        driver.command("POST", f"/element/{control['element-6066-11e4-a52e-4f735466cecf']}/click", {})
        report["restartPrompt"] = h.eventually(lambda: driver.command("GET", "/alert/text"))
        # Do not let the native restart detach the test controller. Dismiss the
        # immediate-restart prompt, then close/reopen this temporary profile.
        driver.command("POST", "/alert/dismiss", {})
        driver.context("chrome")
        report["syncOptIn"] = driver.script("return Services.prefs.getBoolPref('identity.fxaccounts.enabled', false)")
        assert report["syncOptIn"] is True
        driver.close()
        driver = h.WebDriver(profile, evidence, browser=args.browser)
        driver.navigate("about:preferences#sync")
        driver.settle()
        report["syncAfterRestart"] = driver.script("""return {
          url: location.href, signIn: [...document.querySelectorAll('[id]')]
            .filter(el=>/fxa|syncNoFxaSignIn|syncSignIn/i.test(el.id) && el.getBoundingClientRect().width > 0)
            .map(el=>({id:el.id,label:el.getAttribute('label'),text:el.textContent.trim().slice(0,100)}))
        }""")
        report["screenshots"].append(driver.screenshot("native-sync-ready.png", chrome=True))
        driver.context("chrome")
        report["protectionsAfterRestart"] = driver.script("""return {
          sync: Services.prefs.getBoolPref('identity.fxaccounts.enabled', false),
          signatures: Services.prefs.getBoolPref('xpinstall.signatures.required', true),
          strictFiles: Services.prefs.getBoolPref('security.fileuri.strict_origin_policy', true),
          sanitization: Services.prefs.getBoolPref('privacy.sanitize.sanitizeOnShutdown', true)
        }""")
        assert all(report["protectionsAfterRestart"].values())
        assert report["syncAfterRestart"]["signIn"], report["syncAfterRestart"]
        report["ok"] = True
    finally:
        if driver:
            driver.close()
        (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
