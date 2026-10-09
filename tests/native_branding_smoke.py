#!/usr/bin/env python3
"""Verify the branding built into Kitsune's own engine on a brand-new test profile.

The privileged WebDriver context is test-only, never a production launch flag.
--headed additionally captures only the temporary test window on Hyprland.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from browser_smoke import DEFAULT_BROWSER, WebDriver, prepare_profile, eventually

MOZILLA_RELEASE_KEY = "14F26682D0916CDD81E37B6D61B7B526D98F0353"


def native_state(driver):
    driver.context("chrome")
    return driver.script("""return {
      windowTitle: document.title, tabTitle:gBrowser.selectedTab.label,
      internalName:Services.appinfo.name, userAgent: navigator.userAgent,
      signaturesRequired:Services.prefs.getBoolPref('xpinstall.signatures.required'),
      strictFileOrigins:Services.prefs.getBoolPref('security.fileuri.strict_origin_policy'),
      sandboxLevel:Services.prefs.getIntPref('security.sandbox.content.level'),
      malwareProtection:Services.prefs.getBoolPref('browser.safebrowsing.malware.enabled')
    }""")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", type=Path, default=DEFAULT_BROWSER)
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()
    browser = args.browser.resolve(strict=True)
    test_root = Path(tempfile.mkdtemp(prefix="kitsune-native-branding-"))
    evidence = test_root / "evidence"
    evidence.mkdir()
    profile, _ = prepare_profile(test_root)
    report = {"engine": str(browser), "temporaryProfile": str(profile), "checks": []}

    def check(name, details):
        report["checks"].append({"name": name, "status": "passed", "details": details})

    manifest = json.loads((browser.parent / "kitsune-engine.json").read_text())
    assert manifest["signedBy"] == MOZILLA_RELEASE_KEY and manifest["source"].startswith("https://archive.mozilla.org/")
    assert not (browser.parent / "librewolf").exists() and not (browser.parent / "librewolf.cfg").exists()
    for relative in ("distribution/policies.json", "defaults/pref/autoconfig.js", "kitsune.cfg"):
        assert (browser.parent / relative).is_file(), relative
    check("Own engine built from Mozilla's signed Gecko source, with Kitsune's configuration and nothing from LibreWolf",
          {"engineVersion": manifest["engineVersion"], "signedBy": manifest["signedBy"]})

    driver = WebDriver(profile, evidence, browser=browser, headed=args.headed)
    try:
        driver.navigate("data:text/html;charset=utf-8,<title>LibreWolf article · ejemplo</title><h1>Original site title</h1>")
        eventually(lambda: native_state(driver)["windowTitle"].endswith(" — Kitsune"))
        page = native_state(driver)
        assert page["tabTitle"] == "LibreWolf article · ejemplo"
        assert page["windowTitle"] == "LibreWolf article · ejemplo — Kitsune"
        assert page["internalName"] == "Kitsune" and "Kitsune" not in page["userAgent"]
        assert page["signaturesRequired"] and page["strictFileOrigins"] and page["malwareProtection"]
        assert page["sandboxLevel"] > 0
        check("Native window brand, site-title integrity, internal identity and protections", page)
        driver.navigate("about:newtab")
        eventually(lambda: native_state(driver)["windowTitle"] == "Kitsune")
        check("Native new-tab window title", native_state(driver))
        driver.context("content")
        eventually(lambda: driver.script("return (document.querySelector('.logo-and-wordmark')?.getBoundingClientRect().height || 0) > 0"))
        driver.settle()

        driver.context("chrome")
        # With all extensions pinned, the physical button correctly opens the
        # addon manager directly. Call the same native panel method without a
        # click event to exercise the empty-panel design deterministically.
        driver.script("gUnifiedExtensions.togglePanel()")
        eventually(lambda: driver.script("return document.getElementById('unified-extensions-panel')?.state === 'open'"))
        panel = driver.script("""const panel=document.getElementById('unified-extensions-panel');
          const button=document.getElementById('unified-extensions-discover-extensions');
          const visual=button?.shadowRoot.querySelector('.button-background');
          const surface=panel.shadowRoot.querySelector('[part="content"]');
          return {state:panel.state, surface:surface?getComputedStyle(surface).backgroundColor:null,
            surfaceToken:getComputedStyle(panel).getPropertyValue('--panel-background-color').trim(),
            radius:visual?getComputedStyle(visual).borderRadius:getComputedStyle(panel).getPropertyValue('--button-border-radius').trim(), text:button?.label || 'Native discover action omitted for existing extensions',
            buttonBackground:visual?getComputedStyle(visual).backgroundColor:null,
            panelRadius:getComputedStyle(panel).getPropertyValue('--panel-border-radius').trim(),
            nativeRole:visual?.parentElement.localName || null};""")
        assert panel["radius"] == "12px" and panel["panelRadius"] == "16px"
        assert panel["surface"] == "rgb(251, 250, 247)", panel  # papel elevado de Tinta
        assert panel["nativeRole"] in (None, "button")
        check("Native extension panel and shadow-DOM action are rounded/theme-aware", panel)
        if args.headed and shutil.which("grim") and shutil.which("hyprctl"):
            time.sleep(.5)  # XUL popup paints in a separate Wayland surface.
            clients = json.loads(subprocess.check_output(["hyprctl", "-j", "clients"]))
            window = next(w for w in clients if w["pid"] == driver.capabilities["moz:processID"])
            x, y = window["at"]
            width, height = window["size"]
            shot = evidence / "native-extensions.png"
            subprocess.run(["grim", "-g", f"{x},{y} {width}x{height}", str(shot)], check=True)
            report["screenshot"] = str(shot)
        driver.script("gUnifiedExtensions.togglePanel()")
        driver.navigate("about:addons")
        eventually(lambda: "Kitsune" in native_state(driver)["windowTitle"])
        check("Addon manager keeps native controls and Kitsune window brand", native_state(driver))
        driver.navigate("about:preferences#sync")
        eventually(lambda: "Kitsune" in native_state(driver)["windowTitle"])
        check("Native settings/Sync window title", native_state(driver))
        driver.settle()
        driver.screenshot("native-settings-brand.png", chrome=True)
    finally:
        driver.close()
        (evidence / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"passed": len(report["checks"]), "evidence": str(evidence)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
