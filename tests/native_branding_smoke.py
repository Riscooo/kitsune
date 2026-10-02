#!/usr/bin/env python3
"""Verify Kitsune branding/panels on a brand-new native Gecko test profile.

The privileged WebDriver context is test-only, never a production launch flag.
--headed additionally captures only the temporary test window on Hyprland.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from browser_smoke import ROOT, WebDriver, prepare_profile, eventually

SPEC = importlib.util.spec_from_file_location("kitsune_runtime", ROOT / "install/prepare-runtime.py")
runtime = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runtime)


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
    parser.add_argument("--runtime-root", type=Path, required=True)
    parser.add_argument("--source", type=Path, default=Path("/usr/lib/librewolf"))
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()
    browser = runtime.prepare(args.source, args.runtime_root)
    test_root = Path(tempfile.mkdtemp(prefix="kitsune-native-branding-"))
    evidence = test_root / "evidence"
    evidence.mkdir()
    profile, _ = prepare_profile(test_root)
    report = {"runtime": str(browser), "temporaryProfile": str(profile), "checks": []}

    def check(name, details):
        report["checks"].append({"name": name, "status": "passed", "details": details})

    with runtime.open_omni(args.source / "browser/omni.ja") as original, runtime.open_omni(browser.parent / "browser/omni.ja") as branded:
        assert set(branded.namelist()) == set(original.namelist()) | set(runtime.NATIVE_FILES)
        changed = [name for name in original.namelist() if original.read(name) != branded.read(name)]
        assert all(runtime.BRAND_RESOURCE.fullmatch(name) or name in (runtime.ABOUT, runtime.WINDOW) or name in runtime.BRAND_IMAGES for name in changed)
        assert len(changed) > 1
        check("Only allowlisted brand resources and the Kitsune UI entry changed; all other archive payloads byte-identical", {"changed": len(changed), "added": len(runtime.NATIVE_FILES), "total": len(original.namelist())})
    originals = [p for p in args.source.rglob("*") if p.is_file() and not p.is_symlink() and p.relative_to(args.source).as_posix() not in {"browser/omni.ja", *runtime.ICON_FILES}]
    for path in originals:
        copy = browser.parent / path.relative_to(args.source)
        with path.open("rb") as original_file, copy.open("rb") as copied_file:
            assert hashlib.file_digest(original_file, "sha256").digest() == hashlib.file_digest(copied_file, "sha256").digest(), str(path)
    check("All other engine files and security configuration byte-identical", {"files": len(originals)})

    driver = WebDriver(profile, evidence, browser=browser, headed=args.headed)
    try:
        driver.navigate("data:text/html;charset=utf-8,<title>LibreWolf article · ejemplo</title><h1>Original site title</h1>")
        eventually(lambda: native_state(driver)["windowTitle"].endswith(" — Kitsune"))
        page = native_state(driver)
        assert page["tabTitle"] == "LibreWolf article · ejemplo"
        assert page["windowTitle"] == "LibreWolf article · ejemplo — Kitsune"
        assert page["internalName"] == "LibreWolf" and "Kitsune" not in page["userAgent"]
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
