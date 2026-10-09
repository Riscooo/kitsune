#!/usr/bin/env python3
"""Probe exact-origin shutdown storage exceptions in an isolated Kitsune engine.

Never opens or modifies the installed Kitsune user profile. The test uses the
native Sanitizer's shutdown entry point, not a global clearing-preference change.
"""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile

from browser_smoke import WebDriver, prepare_profile


PROBE_PERMISSION = """
const urls = arguments[0];
const principal = url => Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(url), {});
const read = object => {
  const result = {};
  for (const name of ['origin', 'asciiSpec', 'host', 'baseDomain']) {
    try { result[name] = object[name]; } catch (error) { result[name] = String(error); }
  }
  return result;
};
Services.perms.addFromPrincipal(principal(urls[0]), 'persist-data-on-shutdown',
  Ci.nsIPermissionManager.ALLOW_ACTION, Ci.nsIPermissionManager.EXPIRE_NEVER, 0);
return {
  sanitize: Services.prefs.getBoolPref('privacy.sanitize.sanitizeOnShutdown'),
  strictFileOrigins: Services.prefs.getBoolPref('security.fileuri.strict_origin_policy'),
  cookiesAndStorage: Services.prefs.getBoolPref('privacy.clearOnShutdown_v2.cookiesAndStorage'),
  emptyHostMatchesItself: Services.eTLD.hasRootDomain('', ''),
  principals: urls.map(url => ({...read(principal(url)),
    permission: Services.perms.testPermissionFromPrincipal(principal(url), 'persist-data-on-shutdown')})),
  permissions: Array.from(Services.perms.getAllByTypes(['persist-data-on-shutdown']), permission =>
    ({...read(permission.principal), capability: permission.capability})),
};
"""


def main():
    root = Path(tempfile.mkdtemp(prefix="kitsune-storage-scope-"))
    evidence = root / "evidence"
    evidence.mkdir()
    profile, _ = prepare_profile(root)
    original = profile / "start/index.html"
    sibling = profile / "start/storage-sibling.html"
    unrelated = root / "unrelated.html"
    shutil.copy2(original, sibling)
    shutil.copy2(original, unrelated)
    urls = [path.as_uri() for path in (original, sibling, unrelated)]
    driver = WebDriver(profile, evidence)
    report = {"profile": str(profile)}
    try:
        # GeckoDriver otherwise disables the browser's real file-origin policy.
        driver.context("chrome")
        driver.script("Services.prefs.setBoolPref('security.fileuri.strict_origin_policy', true);")
        for index, url in enumerate(urls):
            driver.navigate(url)
            driver.script("localStorage.setItem('kitsune.scope.test', arguments[0]); return localStorage.getItem('kitsune.scope.test');", [str(index)])
        driver.context("chrome")
        report["permission"] = driver.script(PROBE_PERMISSION, [urls + ["https://example.com/"]])
        report["sanitize"] = driver.script("""
          const done = arguments[arguments.length - 1];
          const {Sanitizer} = ChromeUtils.importESModule('resource:///modules/Sanitizer.sys.mjs');
          Sanitizer.runSanitizeOnShutdown().then(() => done({ok: true})).catch(error => done({error: String(error), stack: error.stack}));
        """, asynchronous=True)
        report["after_sanitize"] = []
        for url in urls:
            driver.navigate(url)
            report["after_sanitize"].append({"url": url, "value": driver.script("return localStorage.getItem('kitsune.scope.test');")})
    finally:
        driver.close()
    driver = WebDriver(profile, evidence)
    try:
        driver.context("chrome")
        driver.script("Services.prefs.setBoolPref('security.fileuri.strict_origin_policy', true);")
        report["after_restart"] = []
        for url in urls:
            driver.navigate(url)
            report["after_restart"].append({"url": url, "value": driver.script("return localStorage.getItem('kitsune.scope.test');")})
    finally:
        driver.close()
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
